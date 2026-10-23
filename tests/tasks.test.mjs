import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_TASK_BYTES,
  editedSinceSent,
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
