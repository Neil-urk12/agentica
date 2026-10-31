import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, MAX_FRAME_BYTES } from "@agentica/protocol";
import {
  CARD,
  PROPOSAL_RESERVE,
  compactSize,
  fitTextField,
  fitTextHeight,
  fitViewport,
  overlayInsets,
  projectStatusItems,
  proposedContent,
  turnStatus,
  unionBox,
  usableArea,
  zoomAbout,
  getZoomShortcutFactor,
  isZoomResetShortcut,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
} from "../apps/desktop/src/lib/canvas-view.ts";
import { proposalAnchor } from "../apps/desktop/src/lib/canvas-agent.ts";
import {
  attentionLabel,
  isQueueShortcut,
  sortWaiting,
  waitedLabel,
} from "../apps/desktop/src/lib/session-attention.ts";

test("attention labels describe only received signals, independent of tile kind", () => {
  const label = (kind, message = null, details = {}) =>
    attentionLabel({
      attention: { kind, message },
      exitCode: null,
      exitSignal: null,
      error: null,
      ...details,
    });
  assert.equal(label("bell"), "Waiting for you");
  assert.equal(label("notification", ""), "Sent a notification");
  assert.equal(label("notification"), "Sent a notification");
  assert.equal(
    label("notification", "Approval requested <script>"),
    "Approval requested <script>",
  );
  assert.equal(label("exited", null, { exitCode: 0 }), "Stopped (exit code 0)");
  assert.equal(
    label("exited", null, { exitSignal: "SIGTERM" }),
    "Stopped (signal SIGTERM)",
  );
  assert.equal(label("exited"), "Stopped");
  assert.equal(
    label("failed", null, { error: "Launch error" }),
    "Failed: Launch error",
  );
  assert.equal(label("failed"), "Failed to start");
});

test("waited time reads in coarse units and clamps clock skew", () => {
  const now = 10 * 86_400_000;
  const ago = (ms) => waitedLabel(now - ms, now);
  assert.equal(waitedLabel(null, now), "");
  assert.equal(ago(0), "just now");
  assert.equal(ago(59_999), "just now");
  assert.equal(ago(-120_000), "just now");
  assert.equal(ago(60_000), "1 min ago");
  assert.equal(ago(59 * 60_000), "59 min ago");
  assert.equal(ago(60 * 60_000), "1 h ago");
  assert.equal(ago(125 * 60_000), "2 h 5 min ago");
  assert.equal(ago(24 * 3_600_000), "1 d ago");
});

test("waiting entries sort oldest first, stable, untimed last", () => {
  const entry = (id, at) => ({ id, status: { attention: { at } } });
  const sorted = sortWaiting([
    entry("a", null),
    entry("b", 300),
    entry("c", 100),
    entry("d", 300),
    entry("e", null),
  ]);
  assert.deepEqual(
    sorted.map((item) => item.id),
    ["c", "b", "d", "a", "e"],
  );
});

test("the queue shortcut uses Cmd on Apple and Ctrl elsewhere", () => {
  const key = (mods = {}) => ({
    key: "j",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });
  assert.equal(isQueueShortcut(key({ ctrlKey: true }), false), true);
  assert.equal(isQueueShortcut(key({ ctrlKey: true, key: "J" }), false), true);
  assert.equal(isQueueShortcut(key({ metaKey: true }), false), false);
  assert.equal(isQueueShortcut(key({ metaKey: true }), true), true);
  assert.equal(isQueueShortcut(key({ ctrlKey: true }), true), false);
  assert.equal(
    isQueueShortcut(key({ ctrlKey: true, shiftKey: true }), false),
    false,
  );
  assert.equal(
    isQueueShortcut(key({ ctrlKey: true, altKey: true }), false),
    false,
  );
  assert.equal(isQueueShortcut(key(), false), false);
});

test("project status items list non-zero counts separately", () => {
  const counts = {
    running: 0,
    starting: 0,
    stopping: 0,
    stopped: 0,
    waiting: 0,
  };
  assert.deepEqual(projectStatusItems(counts), [
    { label: "No sessions yet", tone: "neutral" },
  ]);
  assert.deepEqual(
    projectStatusItems({ ...counts, running: 1, stopped: 2, waiting: 1 }),
    [
      { label: "1 running", tone: "ok" },
      { label: "2 stopped", tone: "neutral" },
      { label: "1 waiting for you", tone: "pending" },
    ],
  );
  assert.deepEqual(
    projectStatusItems({ ...counts, starting: 1, stopping: 2 }),
    [
      { label: "1 starting", tone: "busy" },
      { label: "2 stopping", tone: "busy" },
    ],
  );
});

const node = (id, x, y, width, height) => ({ id, x, y, width, height });

test("legacy cards compact and proposals reserve only their own room", () => {
  assert.deepEqual(CARD, { width: 340, height: 220, minHeight: 160, gap: 32 });
  assert.deepEqual(PROPOSAL_RESERVE, { width: 400, height: 240 });
  // A tall saved card nearby only pushes the proposal origin sideways.
  const nodes = [node("a", 0, 0, 340, 1800)];
  assert.deepEqual(proposalAnchor(nodes, [], { x: 0, y: 0 }), {
    x: 404,
    y: 0,
  });
  assert.deepEqual(compactSize({ width: 600, height: 1800 }), {
    width: 340,
    height: 220,
  });
  assert.deepEqual(compactSize({ width: 340, height: 160 }), {
    width: 340,
    height: 160,
  });
});

test("status labels come from persisted turn state", () => {
  assert.equal(turnStatus("pending", "Agent").label, "Changes pending review");
  assert.equal(turnStatus("applied", "Agent").label, "Changes applied");
  assert.equal(turnStatus("discarded", "Agent").label, "Changes discarded");
  assert.equal(turnStatus("complete", "Agent").label, "Complete");
  assert.equal(turnStatus("generating", "You").label, "Waiting for reply");
  assert.equal(turnStatus("applied", "You").label, "Sent");
  for (const status of ["failed", "cancelled", "interrupted"]) {
    assert.equal(turnStatus(status, "You").tone, "bad");
    assert.equal(turnStatus(status, "Agent").tone, "bad");
  }
  assert.equal(turnStatus(undefined, "Agent"), undefined);
});

test("fitting grows from the top-left and refuses limits or occupied space", () => {
  const target = node("t", 0, 0, 200, 100);
  const others = [target, node("right", 220, 0, 100, 400)];
  assert.deepEqual(fitTextHeight(target, 180.2, others), {
    ok: true,
    height: 181,
  });
  assert.equal(fitTextHeight(target, 90, others).ok, false);
  assert.match(
    fitTextHeight(target, LIMITS.maxSize + 1, others).reason,
    /size limit/,
  );
  const below = [...others, node("below", 50, 150, 100, 50)];
  assert.match(fitTextHeight(target, 200, below).reason, /occupies/);
  // A neighbour already overlapping the current bounds does not block growth.
  const overlapping = [...others, node("inside", 10, 10, 20, 20)];
  assert.equal(fitTextHeight(target, 200, overlapping).ok, true);
  assert.deepEqual(target, node("t", 0, 0, 200, 100));
});

test("overlay insets charge each obstacle to its cheapest edge", () => {
  const canvas = { left: 100, top: 50, right: 1100, bottom: 850 };
  const insets = overlayInsets(canvas, [
    // Composer dock across the bottom.
    { left: 400, top: 700, right: 800, bottom: 830 },
    // Navigation column at the bottom-left.
    { left: 110, top: 600, right: 150, bottom: 830 },
    // An overlay inspector covering the right edge.
    { left: 900, top: 50, right: 1100, bottom: 850 },
    // Outside the canvas: ignored.
    { left: 0, top: 0, right: 90, bottom: 40 },
  ]);
  assert.deepEqual(insets, { top: 0, right: 200, bottom: 150, left: 50 });
  assert.deepEqual(usableArea({ width: 1000, height: 800 }, insets), {
    x: 66,
    y: 16,
    width: 718,
    height: 618,
  });
});

test("fit and focus place targets inside the usable area without moving them", () => {
  const area = { x: 0, y: 0, width: 800, height: 400 };
  const target = { x: 1000, y: 1000, width: 200, height: 100 };
  const before = structuredClone(target);
  const view = fitViewport(target, area);
  assert.equal(view.zoom, 1);
  // Centred: screen = world * zoom + offset.
  assert.equal(target.x * view.zoom + view.x, 300);
  assert.equal(target.y * view.zoom + view.y, 150);
  assert.deepEqual(target, before);
  // Large targets zoom out to fit entirely.
  const wide = fitViewport({ x: 0, y: 0, width: 3000, height: 100 }, area);
  assert.ok(3000 * wide.zoom <= area.width);
  // Beyond the minimum zoom, the top-left portion stays visible.
  const huge = fitViewport({ x: 0, y: 0, width: 100_000, height: 100 }, area);
  assert.equal(huge.zoom, LIMITS.minZoom);
  assert.equal(huge.x, 24);
});

test("zoom keeps the usable centre fixed and respects limits", () => {
  const area = { x: 100, y: 0, width: 400, height: 400 };
  const view = { x: 0, y: 0, zoom: 1 };
  const next = zoomAbout(view, area, 2);
  assert.equal(next.zoom, 2);
  assert.equal((300 - next.x) / next.zoom, 300);
  assert.equal((200 - next.y) / next.zoom, 200);
  assert.equal(zoomAbout(view, area, 100).zoom, LIMITS.maxZoom);
  assert.equal(zoomAbout(view, area, 0.001).zoom, LIMITS.minZoom);
  assert.equal(unionBox([]), undefined);
  assert.deepEqual(
    unionBox([node("a", 0, 0, 10, 10), node("b", 20, -5, 10, 10)]),
    { x: 0, y: -5, width: 30, height: 15 },
  );
});

test("proposed content lists text and labels for read-only review", () => {
  assert.deepEqual(
    proposedContent([
      { op: "createText", text: "Long note" },
      { op: "connect" },
      { op: "createShape", kind: "rectangle", label: "Start" },
      { op: "updateShape", kind: "ellipse" },
    ]),
    [
      { title: "Change 1: new text", text: "Long note" },
      { title: "Change 3: rectangle label", text: "Start" },
    ],
  );
});

test("zoom keyboard shortcuts identify zoom in, zoom out, and reset factors", () => {
  // Zoom in via Ctrl/Cmd + '+' or '='
  assert.equal(
    getZoomShortcutFactor({ ctrlKey: true, key: "+" }),
    ZOOM_IN_FACTOR,
  );
  assert.equal(
    getZoomShortcutFactor({ ctrlKey: true, key: "=" }),
    ZOOM_IN_FACTOR,
  );
  assert.equal(
    getZoomShortcutFactor({ ctrlKey: true, code: "Equal" }),
    ZOOM_IN_FACTOR,
  );
  assert.equal(
    getZoomShortcutFactor({ ctrlKey: true, code: "NumpadAdd" }),
    ZOOM_IN_FACTOR,
  );
  assert.equal(
    getZoomShortcutFactor({ metaKey: true, key: "+" }),
    ZOOM_IN_FACTOR,
  );

  // Zoom out via Ctrl/Cmd + '-' or '_'
  assert.equal(
    getZoomShortcutFactor({ ctrlKey: true, key: "-" }),
    ZOOM_OUT_FACTOR,
  );
  assert.equal(
    getZoomShortcutFactor({ ctrlKey: true, key: "_" }),
    ZOOM_OUT_FACTOR,
  );
  assert.equal(
    getZoomShortcutFactor({ ctrlKey: true, code: "Minus" }),
    ZOOM_OUT_FACTOR,
  );
  assert.equal(
    getZoomShortcutFactor({ ctrlKey: true, code: "NumpadSubtract" }),
    ZOOM_OUT_FACTOR,
  );
  assert.equal(
    getZoomShortcutFactor({ metaKey: true, key: "-" }),
    ZOOM_OUT_FACTOR,
  );

  // Modifiers ignored or non-zoom keys
  assert.equal(getZoomShortcutFactor({ ctrlKey: false, key: "+" }), null);
  assert.equal(
    getZoomShortcutFactor({ ctrlKey: true, altKey: true, key: "+" }),
    null,
  );
  assert.equal(getZoomShortcutFactor({ ctrlKey: true, key: "a" }), null);

  // Reset zoom via Ctrl/Cmd + '0'
  assert.equal(isZoomResetShortcut({ ctrlKey: true, key: "0" }), true);
  assert.equal(isZoomResetShortcut({ metaKey: true, code: "Digit0" }), true);
  assert.equal(isZoomResetShortcut({ ctrlKey: true, code: "Numpad0" }), true);
  assert.equal(isZoomResetShortcut({ ctrlKey: true, key: "1" }), false);
  assert.equal(isZoomResetShortcut({ ctrlKey: false, key: "0" }), false);
});

test("note fields keep only what one save request can carry", () => {
  const zero = "00000000-0000-4000-8000-000000000000";
  const saveBytes = (text) =>
    Buffer.byteLength(
      JSON.stringify({
        protocolVersion: 1,
        id: zero,
        method: "artifact.saveText",
        params: {
          workspaceId: zero,
          artifactId: zero,
          expectedRevision: Number.MAX_SAFE_INTEGER,
          text,
        },
      }),
    );
  const ascii = { value: "a".repeat(LIMITS.text) };
  assert.equal(fitTextField(ascii), "a".repeat(LIMITS.text));
  for (const char of ["中", "ж", "\n", "😀"]) {
    const typed = char.repeat(LIMITS.text);
    const field = { value: typed };
    const kept = fitTextField(field);
    assert.equal(field.value, kept, `${char}: the field shows what is kept`);
    assert.ok(typed.startsWith(kept) && kept.length % char.length === 0);
    assert.ok(saveBytes(kept) <= MAX_FRAME_BYTES, `${char}: fits one request`);
    assert.ok(
      saveBytes(kept + char) > MAX_FRAME_BYTES,
      `${char}: nothing that fits is trimmed`,
    );
  }
  // Typing into the middle of a full note drops the new text, not the note's end.
  const full = fitTextField({ value: "中".repeat(LIMITS.text) });
  const middle = {
    value: `${full.slice(0, 100)}中中${full.slice(100)}`,
    selectionEnd: 102,
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
  };
  assert.equal(fitTextField(middle), full);
  assert.equal(middle.selectionEnd, 100, "the caret stays at the typed text");
});
