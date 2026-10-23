import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getProviderConfig,
  getCustomProvider,
  PROVIDER_PRESETS,
  getActivePreset,
  getProviderProfile,
  savePresetSetting,
  saveProviderProfile,
  saveProviderSetting,
  validateProvider,
} from "../apps/desktop/src/lib/provider.ts";
import {
  checkProvider,
  runCanvasAgent,
  setOpenRouterApiKey,
  setOpenRouterModel,
} from "../apps/desktop/src/lib/openrouter.ts";

const custom = () => ({
  kind: "custom",
  baseUrl: "https://api.example.com/v1///",
  apiKey: " custom-key ",
  model: " custom-model ",
  tools: true,
});
const start = () => ({
  turn: { model: "custom-model", prompt: "Draw", anchor: { x: 0, y: 0 } },
  history: [],
  context: { nodes: [], artifacts: [], edges: [] },
});
const response = (message) =>
  new Response(JSON.stringify({ choices: [{ message }] }), {
    headers: { "Content-Type": "application/json" },
  });

test("provider settings preserve separate credentials and models when switching", (t) => {
  const storage = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  });
  setOpenRouterApiKey("router-key");
  setOpenRouterModel("router-model");
  assert.equal(getProviderConfig().kind, "openrouter");
  saveProviderSetting("provider", "custom");
  assert.equal(getProviderConfig().apiKey, "");
  saveProviderSetting("customBaseUrl", " https://example.com/v1 ");
  saveProviderSetting("customApiKey", "custom-key");
  saveProviderSetting("customModel", "custom-model");
  saveProviderSetting("customTools", "false");
  assert.deepEqual(getProviderConfig(), {
    ...custom(),
    baseUrl: "https://example.com/v1",
    apiKey: "custom-key",
    model: "custom-model",
    tools: false,
  });
  saveProviderSetting("provider", "openrouter");
  assert.equal(getProviderConfig().apiKey, "router-key");
  assert.equal(getProviderConfig().model, "router-model");
  assert.equal(getCustomProvider().apiKey, "custom-key");
});

test("provider validation normalizes base paths and rejects unsafe or incomplete settings", () => {
  assert.equal(
    validateProvider(custom()).baseUrl,
    "https://api.example.com/v1",
  );
  assert.equal(
    validateProvider({ ...custom(), baseUrl: "https://api.example.com/v1?" })
      .baseUrl,
    "https://api.example.com/v1",
  );
  for (const baseUrl of [
    "http://localhost:1234/v1",
    "http://127.0.0.1:11434/v1",
    "https://api.example.com/prefix/v1/",
  ])
    assert.ok(validateProvider({ ...custom(), baseUrl, apiKey: "" }));
  for (const baseUrl of [
    "",
    "/v1",
    "file:///tmp/v1",
    "javascript:alert(1)",
    "http://api.example.com/v1",
    "https://key@example.com/v1",
    "https://example.com/v1?key=secret",
    "https://example.com/v1#fragment",
  ])
    assert.throws(() => validateProvider({ ...custom(), baseUrl }), /Settings/);
  assert.throws(
    () => validateProvider({ ...custom(), model: " " }),
    /model ID/,
  );
  assert.throws(
    () => validateProvider({ ...custom(), kind: "openrouter", apiKey: "" }),
    /API key/,
  );
});

test("custom canvas calls use a normalized endpoint and snapshot settings across tool rounds", async (t) => {
  const provider = custom();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(url, "https://api.example.com/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer custom-key");
    assert.equal(options.headers["HTTP-Referer"], undefined);
    assert.equal(options.headers["X-Title"], undefined);
    const body = JSON.parse(options.body);
    assert.equal(body.model, "custom-model");
    assert.equal(body.provider, undefined);
    assert.equal(body.tools[0].function.name, "canvas_edit");
    assert.ok(!JSON.stringify(body).includes("custom-key"));
    if (calls === 1) {
      provider.baseUrl = "https://other.example.com";
      provider.apiKey = "other-key";
      provider.model = "other-model";
      return response({
        content: null,
        tool_calls: [
          {
            id: "create",
            type: "function",
            function: {
              name: "canvas_edit",
              arguments: JSON.stringify({
                op: "createShape",
                kind: "rectangle",
                x: 400,
                y: 0,
                width: 100,
                height: 100,
                color: "#123456",
              }),
            },
          },
        ],
      });
    }
    assert.equal(
      JSON.parse(body.messages.at(-1).content).status,
      "preview-only",
    );
    return response({ content: "Ready for review." });
  });
  const result = await runCanvasAgent(start(), {
    provider,
    tools: true,
    signal: new AbortController().signal,
  });
  assert.equal(result.reply, "Ready for review.");
  assert.equal(result.operations.length, 1);
  assert.equal(calls, 2);
});

test("a pasted full Chat Completions URL is requested without duplicating its path", async (t) => {
  const endpoint = "https://hyper.charm.land/v1/chat/completions";
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(url, endpoint);
    return response({ content: "Connected." });
  });
  for (const suffix of ["", "/", "///"]) {
    const provider = { ...custom(), baseUrl: endpoint + suffix };
    assert.equal(
      validateProvider(provider).baseUrl,
      "https://hyper.charm.land/v1",
    );
    assert.equal(
      (
        await runCanvasAgent(start(), {
          provider,
          tools: false,
          signal: new AbortController().signal,
        })
      ).reply,
      "Connected.",
    );
  }
});

test("custom text-only local endpoints need no key or tool fields", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "http://localhost:1234/v1/chat/completions");
    assert.equal(options.headers.Authorization, undefined);
    const body = JSON.parse(options.body);
    assert.equal(body.tools, undefined);
    assert.equal(body.provider, undefined);
    return response({ content: "Hello." });
  });
  assert.equal(
    (
      await runCanvasAgent(start(), {
        provider: {
          ...custom(),
          baseUrl: "http://localhost:1234/v1/",
          apiKey: "",
          tools: false,
        },
        tools: false,
        signal: new AbortController().signal,
      })
    ).reply,
    "Hello.",
  );
});

test("custom provider validation fails before a network request and errors omit provider secrets", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(JSON.stringify({ error: { message: "secret-key" } }), {
      status: 401,
    });
  });
  const options = {
    provider: { ...custom(), baseUrl: "http://example.com" },
    tools: false,
    signal: new AbortController().signal,
  };
  await assert.rejects(runCanvasAgent(start(), options), /Settings/);
  assert.equal(calls, 0);
  options.provider = custom();
  await assert.rejects(
    runCanvasAgent(start(), options),
    (error) =>
      /Provider request failed \(401\)/.test(error.message) &&
      !error.message.includes("secret-key"),
  );
});

test("custom connection failures explain CORS while cancellation stays cancellable", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.redirect, "error");
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(
    runCanvasAgent(start(), {
      provider: custom(),
      tools: false,
      signal: new AbortController().signal,
    }),
    /base URL in Settings.*CORS/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runCanvasAgent(start(), {
      provider: custom(),
      tools: false,
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
});

test("desktop custom requests use native HTTP and cancel through native IPC", async (t) => {
  const descriptors = new Map(
    ["window", "isTauri"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  t.after(() => {
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("The webview fetch must not be used.");
  });
  Object.defineProperty(globalThis, "isTauri", {
    configurable: true,
    value: true,
  });
  const controller = new AbortController();
  let bodyRead = false;
  let cancelling = false;
  let cancelled = false;
  let rejectSend;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (command, args) => {
          if (command === "plugin:http|fetch") {
            const config = args.clientConfig;
            assert.equal(
              config.url,
              "https://hyper.charm.land/v1/chat/completions",
            );
            assert.equal(config.method, "POST");
            assert.equal(config.maxRedirections, 0);
            assert.equal(config.connectTimeout, 30_000);
            assert.equal(
              new Headers(config.headers).get("authorization"),
              "Bearer custom-key",
            );
            assert.equal(
              JSON.parse(new TextDecoder().decode(new Uint8Array(config.data)))
                .model,
              "custom-model",
            );
            return 10;
          }
          assert.equal(args.rid, 10);
          if (command === "plugin:http|fetch_send") {
            if (cancelling)
              return new Promise((_resolve, reject) => {
                rejectSend = reject;
                controller.abort();
              });
            return {
              status: 200,
              statusText: "OK",
              url: "https://hyper.charm.land/v1/chat/completions",
              headers: [],
              rid: 10,
            };
          }
          if (command === "plugin:http|fetch_read_body") {
            if (bodyRead) return [1];
            bodyRead = true;
            return [
              ...new TextEncoder().encode(
                JSON.stringify({
                  choices: [{ message: { content: "Native reply." } }],
                }),
              ),
              0,
            ];
          }
          if (command === "plugin:http|fetch_cancel") {
            cancelled = true;
            rejectSend(new Error("Request cancelled"));
            return;
          }
          assert.fail(`Unexpected IPC command: ${command}`);
        },
      },
    },
  });
  const provider = {
    ...custom(),
    baseUrl: "https://hyper.charm.land/v1/chat/completions",
  };
  assert.equal(
    (
      await runCanvasAgent(start(), {
        provider,
        tools: false,
        signal: new AbortController().signal,
      })
    ).reply,
    "Native reply.",
  );
  cancelling = true;
  await assert.rejects(
    runCanvasAgent(start(), {
      provider,
      tools: false,
      signal: controller.signal,
    }),
    /Request cancelled/,
  );
  assert.equal(cancelled, true);
});

test("settings check reports plain results without changing settings", async (t) => {
  const signal = new AbortController().signal;
  let reply = () => response({ content: "OK" });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.example.com/v1/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer custom-key");
    assert.equal(JSON.parse(options.body).model, "custom-model");
    return reply();
  });
  assert.deepEqual(await checkProvider(custom(), signal), { result: "ok" });
  for (const status of [401, 403]) {
    reply = () => new Response("{}", { status });
    assert.deepEqual(await checkProvider(custom(), signal), { result: "key" });
  }
  reply = () => new Response("{}", { status: 404 });
  const other = await checkProvider(custom(), signal);
  assert.equal(other.result, "other");
  assert.match(other.detail, /error 404/);
  reply = () => {
    throw new TypeError("fetch failed");
  };
  assert.deepEqual(await checkProvider(custom(), signal), {
    result: "unreachable",
  });
  const invalid = await checkProvider({ ...custom(), baseUrl: "" }, signal);
  assert.equal(invalid.result, "other");
  assert.match(invalid.detail, /base URL/);
});

test("settings check rejects unsuccessful completion bodies even with HTTP success", async (t) => {
  const bodies = [
    { error: { message: "secret-key", code: 503 } },
    {
      error: { message: "secret-key" },
      choices: [{ message: { content: "OK" } }],
    },
    null,
    {},
    { choices: [] },
    { choices: { 0: { message: { content: "OK" } } } },
    { choices: [null] },
    { choices: [{}] },
    { choices: [{ message: { content: null } }] },
    { choices: [{ message: { content: 42 } }] },
    { choices: [{ message: { content: "" } }] },
    { choices: [{ message: { content: "  \n" } }] },
  ];
  let body;
  t.mock.method(globalThis, "fetch", async () => new Response(body));
  for (const payload of bodies) {
    body = JSON.stringify(payload);
    const result = await checkProvider(custom(), new AbortController().signal);
    assert.equal(result.result, "other", body);
    assert.ok(result.detail);
    assert.ok(!result.detail.includes("secret-key"));
  }
  for (const invalidJson of ["", "<html>Service unavailable</html>", "{"]) {
    body = invalidJson;
    const result = await checkProvider(custom(), new AbortController().signal);
    assert.equal(result.result, "other", invalidJson);
    assert.ok(result.detail);
  }
});

test("settings check preserves cancellation while reading the response body", async (t) => {
  const controller = new AbortController();
  const error = new DOMException("Request cancelled", "AbortError");
  t.mock.method(globalThis, "fetch", async () => ({
    status: 200,
    ok: true,
    json: async () => {
      controller.abort(error);
      throw error;
    },
  }));
  await assert.rejects(checkProvider(custom(), controller.signal), error);
});

test("named provider presets keep separate endpoints, keys, and models", (t) => {
  assert.deepEqual(
    PROVIDER_PRESETS.map((preset) => preset.id),
    ["nvidia", "groq", "together", "mistral", "deepseek"],
  );
  const storage = new Map();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  });
  // Settings saved before presets existed keep working as the custom server.
  saveProviderSetting("customBaseUrl", "https://legacy.example.com/v1");
  saveProviderSetting("customModel", "legacy-model");
  assert.equal(getProviderProfile(), "openrouter");
  saveProviderProfile("nvidia");
  assert.equal(getProviderProfile(), "nvidia");
  assert.equal(getActivePreset().name, "NVIDIA API (NIM)");
  let config = getProviderConfig();
  assert.equal(config.kind, "custom");
  assert.equal(config.baseUrl, "https://integrate.api.nvidia.com/v1");
  assert.equal(config.apiKey, "");
  assert.equal(config.model, "");
  savePresetSetting("apiKey", " nv-key ");
  savePresetSetting("model", "meta/llama-3.3-70b-instruct");
  savePresetSetting("tools", "false");
  config = getProviderConfig();
  assert.equal(config.apiKey, "nv-key");
  assert.equal(config.model, "meta/llama-3.3-70b-instruct");
  assert.equal(config.tools, false);

  saveProviderProfile("groq");
  assert.equal(getProviderConfig().apiKey, "", "keys never cross providers");
  assert.equal(getProviderConfig().baseUrl, "https://api.groq.com/openai/v1");
  savePresetSetting("apiKey", "groq-key");
  saveProviderProfile("nvidia");
  assert.equal(getProviderConfig().apiKey, "nv-key");
  assert.equal(getProviderConfig().tools, false);

  saveProviderProfile("custom");
  assert.equal(getActivePreset(), null);
  assert.equal(getProviderConfig().baseUrl, "https://legacy.example.com/v1");
  assert.equal(getProviderConfig().model, "legacy-model");
  savePresetSetting("baseUrl", "http://localhost:11434/v1");
  assert.equal(getProviderConfig().baseUrl, "http://localhost:11434/v1");

  saveProviderProfile("openrouter");
  assert.equal(getProviderConfig().kind, "openrouter");
});

test("settings check accepts a reply cut off by the probe's token budget", async (t) => {
  let body = {
    choices: [
      {
        message: { content: null, reasoning_content: "Thinking" },
        finish_reason: "length",
      },
    ],
  };
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify(body)),
  );
  assert.deepEqual(
    await checkProvider(custom(), new AbortController().signal),
    {
      result: "ok",
    },
  );
  body = {
    choices: [{ message: { content: "OK" }, finish_reason: "length" }],
  };
  assert.deepEqual(
    await checkProvider(custom(), new AbortController().signal),
    {
      result: "ok",
    },
  );
});

test("settings check names the provider's error, redacts the key, and times out", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          detail: "The model has been retired; key custom-key was rejected.",
        }),
        { status: 410 },
      ),
  );
  const retired = await checkProvider(custom(), new AbortController().signal);
  assert.equal(retired.result, "other");
  assert.match(retired.detail, /error 410: The model has been retired/);
  assert.match(retired.detail, /\[redacted\]/);
  assert.ok(!retired.detail.includes("custom-key"));
  t.mock.restoreAll();
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>Bad gateway</html>", { status: 502 }),
  );
  const gateway = await checkProvider(custom(), new AbortController().signal);
  assert.equal(
    gateway.detail,
    "The AI service returned error 502. Check the model in Advanced.",
  );
  t.mock.restoreAll();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(
    globalThis,
    "fetch",
    (_url, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason)),
      ),
  );
  const pending = checkProvider(custom(), new AbortController().signal);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(30_000);
  const slow = await pending;
  assert.equal(slow.result, "other");
  assert.match(slow.detail, /No answer within 30 seconds/);
});
