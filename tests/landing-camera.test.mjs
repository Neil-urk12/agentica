import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOLD,
  atStop,
  boardProgress,
  buildStops,
  cameraAt,
  connector,
  fit,
  jumpBehavior,
} from "../apps/landing/src/camera.ts";

const view = { width: 1280, height: 800, padX: 96, padY: 200 };

test("fit centers a box and never zooms past 100%", () => {
  assert.deepEqual(fit({ x: 100, y: 200, w: 400, h: 200 }, view), {
    x: 300,
    y: 300,
    z: 1,
  });
  const wide = fit({ x: 0, y: 0, w: 2368, h: 300 }, view);
  assert.equal(wide.z, 0.5);
});

test("overview stop fits the bounds of every cluster", () => {
  const boxes = {
    a: { x: 0, y: 0, w: 100, h: 100 },
    b: { x: 1084, y: 500, w: 100, h: 100 },
  };
  const [a, overview, b] = buildStops(["a", "overview", "b"], boxes, view);
  assert.equal(a.z, 1);
  assert.deepEqual(overview, { x: 592, y: 300, z: 1 });
  assert.equal(b.x, 1134);
});

test("camera rests at stops and reaches each endpoint", () => {
  const stops = [
    { x: 0, y: 0, z: 1 },
    { x: 1000, y: 500, z: 0.5 },
  ];
  assert.deepEqual(cameraAt(stops, 0), stops[0]);
  assert.deepEqual(cameraAt(stops, HOLD), stops[0]);
  assert.deepEqual(cameraAt(stops, 1), stops[1]);
  assert.deepEqual(cameraAt(stops, 1 - HOLD / 2), stops[1]);
  assert.deepEqual(cameraAt(stops, 7), stops[1]);
  const mid = cameraAt(stops, 0.5);
  assert.equal(mid.x, 500);
  // Geometric midpoint of 1 and 0.5, reduced by the mid-flight dip.
  assert.ok(mid.z < Math.SQRT1_2 && mid.z > 0.5);
});

test("boards build on approach and stay built", () => {
  assert.equal(boardProgress(0, 0), 1);
  assert.equal(boardProgress(0, 2), 0);
  assert.ok(boardProgress(1.5, 2) > 0 && boardProgress(1.5, 2) < 1);
  assert.equal(boardProgress(4, 2), 1);
});

test("drag is allowed only while the camera rests", () => {
  assert.equal(atStop(0.1, 0), true);
  assert.equal(atStop(0.5, 0), false);
});

test("long jumps are instant, adjacent ones smooth", () => {
  assert.equal(jumpBehavior(0, 1, false), "smooth");
  assert.equal(jumpBehavior(0, 5, false), "auto");
  assert.equal(jumpBehavior(3, 2, true), "auto");
});

test("connector runs between facing edges", () => {
  const path = connector(
    { x: 0, y: 0, w: 100, h: 100 },
    { x: 300, y: 0, w: 100, h: 100 },
  );
  // Ends sit 4px off each edge; the control point bends 14% of the run sideways.
  assert.equal(path, "M104.0 50.0 Q200.0 76.9 296.0 50.0");
});
