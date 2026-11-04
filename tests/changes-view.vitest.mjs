import assert from "node:assert/strict";
import { render } from "svelte/server";
import { test } from "vitest";
import ChangesView from "../apps/desktop/src/lib/components/ChangesView.svelte";

const view = (drafts) =>
  render(ChangesView, {
    props: {
      uid: "t",
      layout: "overlay",
      pasting: false,
      onPaste() {},
      targets: [{ owner: { tileId: "agent" }, label: "Codex 1" }],
      state: {
        drafts,
        unsent: drafts.length,
        hydrated: true,
        loading: false,
        composing: null,
        entries: [],
        selected: "",
        diff: null,
        status: null,
        target: "agent",
      },
    },
  }).body;
const draft = (id, comment) => ({
  id,
  path: "src/a.ts",
  section: "unstaged",
  comment,
  sent: false,
});
const pasteDisabled = (body) =>
  /<button[^>]*disabled[^>]*>Paste into Codex 1/.test(body);

test("feedback larger than one terminal frame cannot be pasted and says why", () => {
  const long = view(
    [1, 2, 3, 4, 5].map((n) => draft(`d${n}`, "x".repeat(4000))),
  );
  assert.ok(pasteDisabled(long));
  // The separator follows the test runner's locale.
  assert.match(long, /of 16\D?372 bytes — too\s+large\s+to paste/);

  const short = view([draft("d1", "Rename this.")]);
  assert.ok(!pasteDisabled(short));
  assert.doesNotMatch(short, /too\s+large\s+to paste/);
});
