import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS } from "@agentica/protocol";
import {
  REVIEW_LIMITS,
  describeElement,
  loadDraft,
  revisionPrompt,
  revisionTarget,
  saveDraft,
} from "../apps/desktop/src/lib/design-review.ts";

const designId = "00000000-0000-4000-8000-0000000000aa";
const design = { id: designId, width: 960.4, height: 640 };
const element = (tagName, extra = {}, parentElement = null) => ({
  tagName,
  classList: [],
  textContent: "",
  parentElement,
  ...extra,
});

test("pins describe the element under them in a short, bounded form", () => {
  const body = element("BODY");
  const main = element("MAIN", { id: "app" }, body);
  const nav = element("NAV", { classList: ["top", "bar", "extra"] }, main);
  const link = element(
    "A",
    { classList: ["cta"], textContent: "  Get\n started `now`  " },
    nav,
  );
  assert.equal(
    describeElement(link),
    'main#app > nav.top.bar > a.cta "Get started now"',
  );
  // At most three levels, so deep pages stay short.
  const deep = element("SPAN", {}, element("B", {}, link));
  assert.equal(describeElement(deep), "a.cta > b > span");
  assert.equal(describeElement(body), "", "the page itself is no target");
  assert.equal(describeElement(null), "");
  const huge = element("P", { textContent: "x".repeat(5000) });
  assert.ok(describeElement(huge).length <= REVIEW_LIMITS.target);
});

test("a revision prompt lists usable comments and targets one design", () => {
  const prompt = revisionPrompt(design, [
    {
      id: "1",
      text: "  Make the headline bolder ",
      pin: { x: 0.504, y: 0.151, target: 'h1 "Launch"' },
    },
    { id: "2", text: "   ", pin: { x: 0.1, y: 0.1, target: "" } },
    { id: "3", text: "Warmer palette", pin: null },
    { id: "4", text: "Footer", pin: { x: 2, y: -1, target: "" } },
  ]);
  const lines = prompt.split("\n");
  assert.equal(
    lines[0],
    `Revise design ${designId} as a new design. Do not change, move, or resize the original.`,
  );
  assert.deepEqual(lines.slice(2, 5), [
    '1. [At 50% across, 15% down, on h1 "Launch"] Make the headline bolder',
    "2. [Whole design] Warmer palette",
    "3. [At 100% across, 0% down] Footer",
  ]);
  assert.match(lines.at(-1), /createHtml .* 960 wide and 640 high/);
  assert.equal(revisionTarget(prompt), designId);
  assert.equal(revisionTarget("Design a landing page"), null);
  assert.equal(revisionTarget("Revise design not-an-id as new"), null);
  assert.throws(
    () => revisionPrompt(design, [{ id: "1", text: " ", pin: null }]),
    /at least one comment/,
  );
  const many = Array.from({ length: 30 }, (_, index) => ({
    id: String(index),
    text: "y".repeat(1000),
    pin: { x: 0.5, y: 0.5, target: "z".repeat(REVIEW_LIMITS.target) },
  }));
  const capped = revisionPrompt(design, many);
  assert.ok(capped.length <= LIMITS.text, "the prompt fits a turn");
  assert.equal(
    capped.split("\n").filter((line) => /^\d+\. /.test(line)).length,
    REVIEW_LIMITS.comments,
  );
});

test("drafts round-trip per canvas and design and reject foreign values", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  try {
    const comments = [
      { id: "a", text: "One", pin: { x: 0.2, y: 0.3, target: "h1" } },
      { id: "b", text: "Two", pin: null },
    ];
    saveDraft("canvas", designId, comments);
    assert.deepEqual(loadDraft("canvas", designId), comments);
    assert.deepEqual(loadDraft("other", designId), []);
    store.set(
      `agentica.review.canvas.${designId}`,
      JSON.stringify([
        { id: "ok", text: "x".repeat(900), pin: null },
        { id: 3, text: "bad" },
        { id: "bad-pin", text: "t", pin: { x: "1" } },
      ]),
    );
    const loaded = loadDraft("canvas", designId);
    assert.deepEqual(
      loaded.map((item) => item.id),
      ["ok"],
    );
    assert.equal(loaded[0].text.length, REVIEW_LIMITS.text);
    store.set(`agentica.review.canvas.${designId}`, "{not json");
    assert.deepEqual(loadDraft("canvas", designId), []);
    saveDraft("canvas", designId, []);
    assert.equal(store.has(`agentica.review.canvas.${designId}`), false);
  } finally {
    delete globalThis.localStorage;
  }
});
