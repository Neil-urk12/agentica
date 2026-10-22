/* Pure geometry for the canvas tour. No DOM access, so Node tests can run it. */

export type Box = { x: number; y: number; w: number; h: number };
/** World point shown at the viewport center, and zoom. */
export type Camera = { x: number; y: number; z: number };
/** Viewport size and the space chrome reserves on each axis. */
export type Viewport = {
  width: number;
  height: number;
  padX: number;
  padY: number;
};

/** Fraction of each segment the camera rests at either end. */
export const HOLD = 0.18;
/** How far zoom dips mid-flight between two stops. */
export const DIP = 0.2;

export const clamp = (value: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, value));

export const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Center a box in the viewport at the zoom that fits it, never above 100%. */
export function fit(box: Box, view: Viewport): Camera {
  return {
    x: box.x + box.w / 2,
    y: box.y + box.h / 2,
    z: Math.min(
      1,
      (view.width - view.padX) / box.w,
      (view.height - view.padY) / box.h,
    ),
  };
}

export function bounds(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  return { x, y, w: right - x, h: bottom - y };
}

/** One camera per stop in tour order; `overview` fits every cluster. */
export function buildStops(
  order: readonly string[],
  boxes: Record<string, Box>,
  view: Viewport,
): Camera[] {
  const all = bounds(Object.values(boxes));
  return order.map((name) => {
    const box = name === "overview" ? all : boxes[name];
    if (!box) throw new Error(`No cluster for tour stop "${name}"`);
    return fit(box, view);
  });
}

/** Camera at tour position `f` (0 = first stop, stops.length - 1 = last). */
export function cameraAt(stops: Camera[], f: number): Camera {
  const i = Math.min(Math.max(0, stops.length - 2), Math.max(0, Math.floor(f)));
  const a = stops[i];
  const b = stops[i + 1];
  if (!a) throw new Error("The tour needs at least one stop");
  if (!b) return a;
  const e = smoothstep(clamp((f - i - HOLD) / (1 - 2 * HOLD)));
  return {
    x: a.x + (b.x - a.x) * e,
    y: a.y + (b.y - a.y) * e,
    // Geometric zoom reads evenly; the dip makes travel feel like a fly-over.
    z: a.z * (b.z / a.z) ** e * (1 - DIP * Math.sin(Math.PI * e)),
  };
}

/** Board assembly for the cluster at stop `index`: builds on approach, then stays built. */
export const boardProgress = (f: number, index: number) =>
  clamp((f - index + 0.85) * 1.6);

/** Whether the camera is resting at stop `index` rather than travelling. */
export const atStop = (f: number, index: number) => Math.abs(f - index) <= HOLD;

/** Jumps farther than one stop skip the tour instead of replaying it. */
export function jumpBehavior(
  from: number,
  to: number,
  reducedMotion: boolean,
): "auto" | "smooth" {
  return reducedMotion || Math.abs(to - from) > 1 ? "auto" : "smooth";
}

/** Point on a box's edge (plus a small gap) facing a target point. */
export function edgeAnchor(box: Box, tx: number, ty: number): [number, number] {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const sx = dx === 0 ? Infinity : (box.w / 2 + 4) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (box.h / 2 + 4) / Math.abs(dy);
  const s = Math.min(sx, sy);
  return [cx + dx * s, cy + dy * s];
}

/** Gently bent SVG path between the facing edges of two boxes. */
export function connector(a: Box, b: Box): string {
  const start = edgeAnchor(a, b.x + b.w / 2, b.y + b.h / 2);
  const end = edgeAnchor(b, a.x + a.w / 2, a.y + a.h / 2);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const control: [number, number] = [
    (start[0] + end[0]) / 2 - dy * 0.14,
    (start[1] + end[1]) / 2 + dx * 0.14,
  ];
  const point = (p: [number, number]) =>
    `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  return `M${point(start)} Q${point(control)} ${point(end)}`;
}
