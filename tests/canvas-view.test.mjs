import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS } from "@agentica/protocol";
import {
  CARD,
  EXCHANGE_RESERVE,
  compactSize,
  fitTextHeight,
  fitViewport,
  overlayInsets,
  proposedContent,
  turnStatus,
  unionBox,
  usableArea,
  zoomAbout,
} from "../apps/desktop/src/lib/canvas-view.ts";
import { exchangePosition } from "../apps/desktop/src/lib/canvas-agent.ts";

const node = (id, x, y, width, height) => ({ id, x, y, width, height });

test("new conversation cards and their reservation stay bounded", () => {
  assert.deepEqual(CARD, { width: 340, height: 220, minHeight: 160, gap: 32 });
  assert.equal(EXCHANGE_RESERVE.height, 472);
  // A tall saved reply nearby only pushes the new exchange sideways.
  const nodes = [node("a", 0, 0, 340, 1800)];
  assert.deepEqual(exchangePosition(nodes, [], { x: 0, y: 0 }), {
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
