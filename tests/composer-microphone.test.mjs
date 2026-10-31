import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Run the component's actual script with rune/lifecycle and browser mocks.
const source = readFileSync(
  new URL(
    "../apps/desktop/src/lib/components/Composer.svelte",
    import.meta.url,
  ),
  "utf8",
).match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const script = ts.transpileModule(
  source.replace(/^  import[\s\S]*?;\n/gm, "") +
    `\nglobalThis.composer = { prewarmMic, startVoice, cancelVoice,
      releaseWarmStream, toggleVoice, get state() { return voiceState; },
      setDisabled(value) { disabled = value; },
      setLoading(value) { loading = value; } };`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  },
).outputText;

function setup() {
  const requests = [];
  const recorders = [];
  const effects = [];
  const timers = new Map();
  let timerId = 0;
  const context = {
    $state: (value) => value,
    $derived: (value) => value,
    $props: () => ({ onTranscribe: async () => "words" }),
    $effect: (effect) => effects.push(effect),
    navigator: {
      mediaDevices: {
        getUserMedia: () =>
          new Promise((resolve, reject) => requests.push({ resolve, reject })),
      },
    },
    MediaRecorder: class {
      state = "inactive";
      constructor(stream) {
        this.stream = stream;
        recorders.push(this);
      }
      start() {
        this.state = "recording";
        this.onstart?.();
      }
      stop() {
        this.state = "inactive";
        this.onstop?.();
      }
    },
    cleanMicName: (value) => value,
    pickRecorderType: () => ({ mime: "", format: "webm" }),
    setTimeout: (callback) => {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
    AbortController,
    Blob,
  };
  runInNewContext(script, context);
  const cleanups = effects.map((effect) => effect());
  return {
    ...context.composer,
    composer: context.composer,
    requests,
    recorders,
    update: () => effects.at(-2)(),
    destroy: () => cleanups.forEach((cleanup) => cleanup?.()),
    expire: () => {
      for (const [id, callback] of timers) {
        timers.delete(id);
        callback();
      }
    },
  };
}

function stream() {
  const track = {
    readyState: "live",
    label: "Microphone",
    stops: 0,
    stop() {
      this.stops++;
      this.readyState = "ended";
    },
  };
  return { track, getAudioTracks: () => [track], getTracks: () => [track] };
}

test("hover, focus and click share acquisition and reuse the warm microphone", async () => {
  const mic = setup();
  mic.prewarmMic();
  mic.prewarmMic();
  const started = mic.startVoice();
  assert.equal(mic.requests.length, 1);
  const audio = stream();
  mic.requests[0].resolve(audio);
  await started;
  assert.equal(mic.recorders.length, 1);
  mic.cancelVoice();
  await mic.startVoice();
  assert.equal(mic.requests.length, 1);
  assert.equal(mic.recorders.length, 2);
  mic.cancelVoice();
  mic.expire();
  assert.equal(audio.track.stops, 1);
});

for (const reason of ["release", "disabled", "loading", "destroy"]) {
  test(`late acquisition after ${reason} stops every track and never records`, async () => {
    const mic = setup();
    mic.prewarmMic();
    const started = mic.startVoice();
    if (reason === "release") mic.releaseWarmStream();
    if (reason === "disabled") {
      mic.composer.setDisabled(true);
      mic.update();
    }
    if (reason === "loading") {
      mic.composer.setLoading(true);
      mic.update();
    }
    if (reason === "destroy") mic.destroy();
    const audio = stream();
    mic.requests.forEach((request) => request.resolve(audio));
    await started;
    assert.equal(audio.track.readyState, "ended");
    assert.equal(mic.recorders.length, 0);
  });
}

test("cancel then restart during permission creates only the latest recorder", async () => {
  const mic = setup();
  const first = mic.startVoice();
  mic.cancelVoice();
  const second = mic.startVoice();
  assert.equal(mic.requests.length, 1);
  mic.requests[0].resolve(stream());
  await Promise.all([first, second]);
  assert.equal(mic.recorders.length, 1);
  assert.equal(mic.composer.state, "recording");
  mic.destroy();
});

test("permission failure can be retried and stale release cannot clear a newer request", async () => {
  const mic = setup();
  const failed = mic.startVoice();
  mic.requests[0].reject(new Error("denied"));
  await failed;
  assert.equal(mic.composer.state, "error");
  const stale = mic.startVoice();
  mic.cancelVoice();
  mic.releaseWarmStream();
  const restarted = mic.startVoice();
  const oldAudio = stream();
  mic.requests[1].resolve(oldAudio);
  await stale;
  assert.equal(oldAudio.track.stops, 1);
  assert.equal(mic.composer.state, "preparing");
  const currentAudio = stream();
  mic.requests[2].resolve(currentAudio);
  await restarted;
  assert.equal(mic.recorders.length, 1);
  assert.equal(mic.recorders[0].stream, currentAudio);
  mic.destroy();
  assert.equal(currentAudio.track.stops, 1);
});

test("idle expiry invalidates an unresolved hover request and permits a fresh start", async () => {
  const mic = setup();
  mic.prewarmMic();
  mic.expire();
  const started = mic.startVoice();
  assert.equal(mic.requests.length, 2);
  const abandoned = stream();
  mic.requests[0].resolve(abandoned);
  const audio = stream();
  mic.requests[1].resolve(audio);
  await started;
  assert.equal(abandoned.track.stops, 1);
  assert.equal(audio.track.stops, 0);
  assert.equal(mic.recorders.length, 1);
  mic.destroy();
});
