import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanMicName,
  downmixToMono,
  pickRecorderType,
} from "../apps/desktop/src/lib/voice-input.ts";

test("microphone names drop the trailing USB vendor:product suffix only", () => {
  assert.equal(cleanMicName("Blue Yeti (046d:0aaa)"), "Blue Yeti");
  assert.equal(
    cleanMicName("  Built-in Audio (ABCD:ef01)  "),
    "Built-in Audio",
  );
  assert.equal(cleanMicName("Headset (USB)"), "Headset (USB)");
  assert.equal(cleanMicName("Mic (046d:0aaa) left"), "Mic (046d:0aaa) left");
  assert.equal(cleanMicName(""), "");
});

test("recorder type is the first supported preference", () => {
  assert.deepEqual(
    pickRecorderType(() => true),
    { mime: "audio/webm;codecs=opus", format: "webm" },
  );
  assert.deepEqual(
    pickRecorderType((mime) => mime.startsWith("audio/ogg")),
    { mime: "audio/ogg;codecs=opus", format: "ogg" },
  );
  assert.deepEqual(
    pickRecorderType((mime) => mime === "audio/wav"),
    { mime: "audio/wav", format: "wav" },
  );
});

test("recorder type falls back to the browser default", () => {
  const fallback = { mime: "", format: "webm" };
  assert.deepEqual(
    pickRecorderType(() => false),
    fallback,
  );
  assert.deepEqual(pickRecorderType(undefined), fallback);
});

test("downmix averages channels sample by sample", () => {
  const left = new Float32Array([1, 0.5, -1]);
  const right = new Float32Array([0, 0.5, 1]);
  assert.deepEqual([...downmixToMono([left, right], 3)], [0.5, 0.5, 0]);
});

test("downmix keeps a mono channel and tolerates missing input", () => {
  const mono = new Float32Array([0.25, -0.75]);
  assert.deepEqual([...downmixToMono([mono], 2)], [0.25, -0.75]);
  assert.deepEqual([...downmixToMono([], 2)], [0, 0]);
  assert.deepEqual([...downmixToMono([new Float32Array([1])], 2)], [1, 0]);
});
