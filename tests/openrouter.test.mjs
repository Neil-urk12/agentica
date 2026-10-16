import test from "node:test";
import assert from "node:assert/strict";

// Setup mock localStorage
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, val) => storage.set(key, String(val)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
};

import {
  DEFAULT_MODEL,
  askOpenRouter,
  getOpenRouterApiKey,
  setOpenRouterApiKey,
  getOpenRouterModel,
  setOpenRouterModel,
} from "../apps/desktop/src/lib/openrouter.ts";

test("OpenRouter: API key storage and retrieval", () => {
  storage.clear();
  assert.equal(getOpenRouterApiKey(), "");

  setOpenRouterApiKey("sk-or-v1-testkey123");
  assert.equal(getOpenRouterApiKey(), "sk-or-v1-testkey123");

  // Handles whitespace trimming
  setOpenRouterApiKey("   sk-or-v1-trimmed   ");
  assert.equal(getOpenRouterApiKey(), "sk-or-v1-trimmed");
});

test("OpenRouter: model storage and defaults", () => {
  storage.clear();
  assert.equal(getOpenRouterModel(), DEFAULT_MODEL);
  assert.equal(DEFAULT_MODEL, "openrouter/free");

  setOpenRouterModel("google/gemma-4-31b-it:free");
  assert.equal(getOpenRouterModel(), "google/gemma-4-31b-it:free");

  // Empty string resets to default model
  setOpenRouterModel("  ");
  assert.equal(getOpenRouterModel(), DEFAULT_MODEL);
});

test("OpenRouter: askOpenRouter throws helpful error when key is missing", async () => {
  storage.clear();
  await assert.rejects(
    () => askOpenRouter("Hello"),
    /OpenRouter API key is required/i,
  );
});

test("OpenRouter: askOpenRouter sends request and extracts response content", async () => {
  storage.clear();
  setOpenRouterApiKey("sk-or-v1-validkey");

  const originalFetch = globalThis.fetch;
  try {
    let capturedUrl = "";
    let capturedOptions = null;

    globalThis.fetch = async (url, options) => {
      capturedUrl = String(url);
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                role: "assistant",
                content: "Hello from OpenRouter!",
              },
            },
          ],
        }),
      };
    };

    const result = await askOpenRouter("Tell me something");
    assert.equal(result, "Hello from OpenRouter!");
    assert.equal(capturedUrl, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal(capturedOptions.method, "POST");
    assert.equal(
      capturedOptions.headers["Authorization"],
      "Bearer sk-or-v1-validkey",
    );

    const body = JSON.parse(capturedOptions.body);
    assert.equal(body.model, DEFAULT_MODEL);
    assert.deepEqual(body.messages, [
      { role: "user", content: "Tell me something" },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenRouter: askOpenRouter handles API error responses", async () => {
  storage.clear();
  setOpenRouterApiKey("sk-or-v1-invalidkey");

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({
        error: {
          message: "Invalid API Key",
          code: 401,
        },
      }),
      text: async () => "Invalid API Key",
    });

    await assert.rejects(() => askOpenRouter("Test error"), /Invalid API Key/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenRouter: askOpenRouter handles empty response error", async () => {
  storage.clear();
  setOpenRouterApiKey("sk-or-v1-valid");

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              role: "assistant",
              content: "   ",
            },
          },
        ],
      }),
    });

    await assert.rejects(() => askOpenRouter("Test empty"), /empty response/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
