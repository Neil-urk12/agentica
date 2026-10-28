import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_TASK_BYTES,
  contextChangedSinceSent,
  contextLabel,
  contextText,
  editedSinceSent,
  largestParts,
  sendBlocker,
  taskPayload,
} from "../apps/desktop/src/lib/tasks.ts";

const id = "00000000-0000-4000-8000-000000000001";
const task = {
  done: false,
  assignedTileId: id,
  sentAt: null,
  sentRevision: null,
  revision: 1,
  context: [],
  sentContext: null,
};
const status = (state, raised = false) => ({ state, attention: { raised } });

test("send is gated on an assignee and a running, attached tile", () => {
  const running = {
    label: "Api · Codex 1",
    connected: true,
    status: status("running"),
  };
  assert.match(sendBlocker(null, running), /Assign/);
  assert.match(
    sendBlocker({ ...task, assignedTileId: null }, running),
    /Assign/,
  );
  assert.match(sendBlocker(task, null), /no longer on this canvas/);
  for (const target of [
    { ...running, status: status("stopped") },
    { ...running, status: status("exited") },
    { ...running, status: null },
    { ...running, connected: false },
  ])
    assert.match(sendBlocker(task, target), /not running.*never starts/);
  assert.equal(sendBlocker(task, running), "");
  // Raised attention is refused by the backend at write time, not hidden here.
  assert.equal(
    sendBlocker(task, { ...running, status: status("running", true) }),
    "",
  );
});

test("payload is the sanitized paste and too-large text cannot be sent", () => {
  const sent = taskPayload("Fix\r\nit\u001b[31m\tnow");
  assert.equal(sent.payload, "Fix\nit[31m\tnow");
  assert.equal(sent.bytes, new TextEncoder().encode(sent.payload).length);
  assert.equal(sent.fits, true);
  assert.equal(taskPayload("\u0007\u0001 ").empty, true);
  assert.equal(taskPayload("é".repeat(MAX_TASK_BYTES / 2)).fits, true);
  const large = taskPayload("é".repeat(MAX_TASK_BYTES / 2 + 1));
  assert.equal(large.fits, false);
  assert.equal(large.bytes, MAX_TASK_BYTES + 2);
});

test("edited since sent compares the text revision with the sent one", () => {
  assert.equal(editedSinceSent(task, 5), false);
  const sent = { ...task, sentAt: "2026-01-01T00:00:00.000Z", sentRevision: 3 };
  assert.equal(editedSinceSent(sent, 3), false);
  assert.equal(editedSinceSent(sent, 4), true);
  assert.equal(editedSinceSent(null, 4), false);
});

test("context sections follow the task text in order with labels and sizes", () => {
  const text = "Fix\r\nit";
  const none = taskPayload(text, []);
  assert.deepEqual(
    { ...none, sections: undefined },
    { ...taskPayload(text), sections: undefined },
  );
  assert.equal(none.payload, "Fix\nit");
  assert.deepEqual(none.sections, []);

  const note = { id, type: "text", text: "\n  Criteria \nMust pass" };
  const pdf = {
    id,
    type: "file",
    name: "spec.pdf",
    mime: "application/pdf",
    text: "Grammar",
  };
  const image = {
    id,
    type: "file",
    name: "a.png",
    mime: "image/png",
    text: "",
  };
  assert.equal(contextLabel(note), "Criteria");
  assert.equal(contextLabel(pdf), "spec.pdf");
  assert.equal(contextLabel({ ...note, text: "x".repeat(100) }).length, 80);
  assert.equal(contextText(image), null);
  for (const mime of [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/svg+xml",
  ])
    assert.equal(contextText({ ...image, mime, text: "Supplied text" }), null);
  assert.equal(contextText({ id, type: "drawing" }), null);
  assert.equal(contextText(pdf), "Grammar");

  const sent = taskPayload(text, [
    { nodeId: "a", label: "Criteria", text: "Must\r\npass\u001b", revision: 1 },
    { nodeId: "b", label: "spec.pdf", text: "é", revision: 1 },
  ]);
  assert.equal(
    sent.payload,
    "Fix\nit\n\n--- Context: Criteria ---\nMust\npass\n\n--- Context: spec.pdf ---\né",
  );
  assert.deepEqual(sent.sections, [
    { nodeId: "a", label: "Criteria", bytes: 37 },
    // "é" is two UTF-8 bytes.
    { nodeId: "b", label: "spec.pdf", bytes: 30 },
  ]);
  assert.equal(sent.bytes, 6 + 37 + 30);
  const large = taskPayload("ok", [
    {
      nodeId: "a",
      label: "big",
      text: "x".repeat(MAX_TASK_BYTES),
      revision: 1,
    },
  ]);
  assert.equal(large.fits, false);
  assert.equal(large.empty, false);
  assert.deepEqual(largestParts(large), ["big", "task text"]);
  assert.deepEqual(largestParts(sent), ["Criteria", "spec.pdf"]);
});

test("context changed since sent detects additions, removals, order, and edits", () => {
  const revisions = { a: 1, b: 2 };
  const revisionOf = (nodeId) => revisions[nodeId];
  const sent = {
    ...task,
    sentAt: "2026-01-01T00:00:00.000Z",
    sentRevision: 1,
    context: [{ nodeId: "a" }, { nodeId: "b" }],
    sentContext: [
      { nodeId: "a", revision: 1 },
      { nodeId: "b", revision: 2 },
    ],
  };
  assert.equal(contextChangedSinceSent(sent, revisionOf), false);
  assert.equal(contextChangedSinceSent(task, revisionOf), false);
  for (const context of [
    [{ nodeId: "a" }],
    [{ nodeId: "a" }, { nodeId: "b" }, { nodeId: "c" }],
    [{ nodeId: "b" }, { nodeId: "a" }],
  ])
    assert.equal(
      contextChangedSinceSent({ ...sent, context }, revisionOf),
      true,
    );
  assert.equal(
    contextChangedSinceSent(sent, (nodeId) => (nodeId === "b" ? 3 : 1)),
    true,
  );
  // A send recorded before context existed counts as sent with none.
  const legacy = { ...sent, sentContext: null };
  assert.equal(contextChangedSinceSent(legacy, revisionOf), true);
  assert.equal(
    contextChangedSinceSent({ ...legacy, context: [] }, revisionOf),
    false,
  );
});
