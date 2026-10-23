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
