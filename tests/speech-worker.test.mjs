import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

// Exercise the worker messages with no model downloads or real GPU/worker APIs.
const source = stripTypeScriptTypes(
  readFileSync(
    new URL("../apps/desktop/src/lib/speech-worker.ts", import.meta.url),
    "utf8",
  ).replace(/import\s*\{[\s\S]*?\}\s*from "@huggingface\/transformers";/, ""),
);
const flush = () => new Promise((resolve) => setImmediate(resolve));
function worker(pipeline, gpu) {
  const messages = [];
  const handlers = new Map();
  runInNewContext(source, {
    pipeline,
    env: { backends: { onnx: { wasm: {} } } },
    navigator: { gpu },
    self: {
      postMessage: (message) => messages.push(message),
      addEventListener: (type, handler) => handlers.set(type, handler),
    },
    Error,
    Float32Array,
  });
  return {
    messages,
    send: (data) => handlers.get("message")({ data }),
  };
}

test("speech initialization shares failure, retries, and caches the successful pipeline", async () => {
  let calls = 0;
  let rejectLoad;
  const instance = worker(async () => {
    calls++;
    if (calls === 1)
      return new Promise((_, reject) => {
        rejectLoad = reject;
      });
    return async () => ({ text: " Retried successfully. " });
  });
  instance.send({ type: "load" });
  instance.send({ type: "transcribe", id: 1, audio: new Float32Array(1) });
  await flush();
  assert.equal(calls, 1);
  rejectLoad(new Error("Temporary download failure"));
  await flush();
  assert.equal(instance.messages.length, 2);
  assert.ok(instance.messages.every((message) => message.type === "error"));
  assert.equal(
    instance.messages.find((message) => message.id === 1).message,
    "Temporary download failure",
  );

  instance.messages.length = 0;
  instance.send({ type: "load" });
  instance.send({ type: "transcribe", id: 2, audio: new Float32Array(1) });
  await flush();
  assert.equal(calls, 2);
  assert.equal(
    instance.messages.find((message) => message.type === "ready")?.backend,
    "wasm",
  );
  assert.equal(
    instance.messages.find((message) => message.id === 2)?.text,
    "Retried successfully.",
  );
  instance.send({ type: "load" });
  await flush();
  assert.equal(calls, 2);
});

test("speech retries after both GPU initialization and its WASM fallback fail", async () => {
  const devices = [];
  const instance = worker(
    async (_task, _model, options) => {
      devices.push(options.device);
      if (devices.length <= 2 || options.device === "webgpu")
        throw new Error("Backend unavailable");
      return async () => ({ text: "CPU fallback" });
    },
    { requestAdapter: async () => ({}) },
  );
  instance.send({ type: "load" });
  await flush();
  assert.deepEqual(devices, ["webgpu", "wasm"]);
  assert.equal(instance.messages[0].type, "error");
  instance.send({ type: "load" });
  instance.send({ type: "transcribe", id: 3, audio: new Float32Array(1) });
  await flush();
  assert.deepEqual(devices, ["webgpu", "wasm", "webgpu", "wasm"]);
  assert.equal(
    instance.messages.find((message) => message.type === "ready")?.backend,
    "wasm",
  );
  assert.equal(
    instance.messages.find((message) => message.id === 3)?.text,
    "CPU fallback",
  );
  instance.send({ type: "load" });
  await flush();
  assert.equal(devices.length, 4);
});

test("speech caches a successful GPU pipeline after one warmup", async () => {
  let calls = 0;
  const audioLengths = [];
  const instance = worker(
    async (_task, _model, options) => {
      calls++;
      assert.equal(options.device, "webgpu");
      return async (audio) => {
        audioLengths.push(audio.length);
        return { text: "GPU transcript" };
      };
    },
    { requestAdapter: async () => ({}) },
  );
  instance.send({ type: "load" });
  instance.send({ type: "load" });
  await flush();
  instance.send({ type: "transcribe", id: 4, audio: new Float32Array(5) });
  await flush();
  assert.equal(calls, 1);
  assert.deepEqual(audioLengths, [16_000, 5]);
  assert.equal(instance.messages[0].backend, "webgpu");
  assert.equal(
    instance.messages.find((message) => message.id === 4)?.text,
    "GPU transcript",
  );
});
