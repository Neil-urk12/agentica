import assert from "node:assert/strict";
import { test } from "node:test";
import { readLayout, saveLayout } from "../apps/desktop/src/lib/layout.ts";

function withStorage(storage, run) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  try {
    run();
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
}

test("layout defaults to Classic without a saved choice", () => {
  withStorage(memoryStorage(), () => assert.equal(readLayout(), "classic"));
});

test("layout reads both saved presets and survives a reload", () => {
  const storage = memoryStorage();
  withStorage(storage, () => {
    assert.equal(saveLayout("activity-bar"), true);
    assert.equal(storage.values.get("agentica.layout"), "activity-bar");
    assert.equal(readLayout(), "activity-bar");
    assert.equal(saveLayout("classic"), true);
    assert.equal(readLayout(), "classic");
  });
});

test("layout ignores unknown stored values", () => {
  const storage = memoryStorage();
  storage.values.set("agentica.layout", "vscode");
  withStorage(storage, () => assert.equal(readLayout(), "classic"));
});

test("layout falls back when storage cannot be read or written", () => {
  const failing = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("quota");
    },
  };
  withStorage(failing, () => {
    assert.equal(readLayout(), "classic");
    assert.equal(saveLayout("activity-bar"), false);
  });
});
