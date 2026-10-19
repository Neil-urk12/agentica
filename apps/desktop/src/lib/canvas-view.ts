import { LIMITS } from "@agentica/protocol";

export type Box = { x: number; y: number; width: number; height: number };
export type Rect = { left: number; top: number; right: number; bottom: number };
export type Viewport = { x: number; y: number; zoom: number };
export type Insets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/**
 * Starting layout budget for new conversation cards, in canvas units. The
 * runtime uses the same width and maximum height when it creates turn nodes.
 */
export const CARD = { width: 340, height: 220, minHeight: 160, gap: 32 };

/** Room reserved for a prompt, its reply, and a nearby proposal. */
export const EXCHANGE_RESERVE = {
  width: 760,
  height: CARD.height * 2 + CARD.gap,
};

/** Dimensions applied by the explicit Compact conversation action. */
export function compactSize(node: Pick<Box, "width" | "height">) {
  return {
    width: CARD.width,
    height: Math.min(Math.max(node.height, LIMITS.minSize), CARD.height),
  };
}

export type StatusTone = "neutral" | "busy" | "pending" | "ok" | "bad";

/** Session counts shown on a project group, by state. */
export type ProjectCounts = {
  running: number;
  starting: number;
  stopping: number;
  stopped: number;
  waiting: number;
};

/** Separate status items for a project group; zero counts are omitted. */
export function projectStatusItems(
  counts: ProjectCounts,
): { label: string; tone: StatusTone }[] {
  const items: { label: string; tone: StatusTone }[] = [];
  if (counts.running)
    items.push({ label: `${counts.running} running`, tone: "ok" });
  if (counts.starting)
    items.push({ label: `${counts.starting} starting`, tone: "busy" });
  if (counts.stopping)
    items.push({ label: `${counts.stopping} stopping`, tone: "busy" });
  if (counts.stopped)
    items.push({ label: `${counts.stopped} stopped`, tone: "neutral" });
  if (counts.waiting)
    items.push({
      label: `${counts.waiting} waiting for you`,
      tone: "pending",
    });
  return items.length ? items : [{ label: "No sessions yet", tone: "neutral" }];
}

/** Readable header state derived from the persisted turn status. */
export function turnStatus(
  status: string | undefined,
  role: "You" | "Agent",
): { label: string; tone: StatusTone } | undefined {
  if (!status) return undefined;
  if (role === "You") {
    if (status === "generating")
      return { label: "Waiting for reply", tone: "busy" };
    if (status === "failed") return { label: "Failed", tone: "bad" };
    if (status === "cancelled") return { label: "Cancelled", tone: "bad" };
    if (status === "interrupted") return { label: "Interrupted", tone: "bad" };
    return { label: "Sent", tone: "neutral" };
  }
  switch (status) {
    case "pending":
      return { label: "Changes pending review", tone: "pending" };
    case "applied":
      return { label: "Changes applied", tone: "ok" };
    case "discarded":
      return { label: "Changes discarded", tone: "neutral" };
    case "complete":
      return { label: "Complete", tone: "neutral" };
    case "generating":
      return { label: "Generating…", tone: "busy" };
    case "failed":
      return { label: "Failed", tone: "bad" };
    case "cancelled":
      return { label: "Cancelled", tone: "bad" };
    case "interrupted":
      return { label: "Interrupted", tone: "bad" };
    default:
      return { label: status, tone: "neutral" };
  }
}

/**
 * Insets of the canvas covered by overlays. Each obstacle (screen rect) is
 * charged to the edge where it removes the least usable area.
 */
export function overlayInsets(canvas: Rect, obstacles: Rect[]): Insets {
  const insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const width = canvas.right - canvas.left;
  const height = canvas.bottom - canvas.top;
  for (const item of obstacles) {
    const left = Math.max(item.left, canvas.left);
    const right = Math.min(item.right, canvas.right);
    const top = Math.max(item.top, canvas.top);
    const bottom = Math.min(item.bottom, canvas.bottom);
    if (right <= left || bottom <= top) continue;
    const candidates: [keyof Insets, number, number][] = [
      ["top", bottom - canvas.top, (bottom - canvas.top) * width],
      ["bottom", canvas.bottom - top, (canvas.bottom - top) * width],
      ["left", right - canvas.left, (right - canvas.left) * height],
      ["right", canvas.right - left, (canvas.right - left) * height],
    ];
    const [side, depth] = candidates.reduce((best, next) =>
      next[2] < best[2] ? next : best,
    );
    insets[side] = Math.max(insets[side], depth);
  }
  return insets;
}

/** The unobscured region in canvas-element (screen) coordinates. */
export function usableArea(
  size: { width: number; height: number },
  insets: Insets,
  margin = 16,
): Box {
  const x = insets.left + margin;
  const y = insets.top + margin;
  return {
    x,
    y,
    // Never collapse entirely; a tiny window still gets a usable target.
    width: Math.max(40, size.width - insets.right - margin - x),
    height: Math.max(40, size.height - insets.bottom - margin - y),
  };
}

export function unionBox(boxes: Box[]): Box | undefined {
  if (!boxes.length) return undefined;
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const clampZoom = (zoom: number) =>
  Math.min(LIMITS.maxZoom, Math.max(LIMITS.minZoom, zoom));

/**
 * Viewport placing a canvas-space target inside the usable screen area.
 * Targets larger than the minimum zoom allows align their top-left corner so
 * a useful portion stays visible. Only the viewport is computed.
 */
export function fitViewport(
  target: Box,
  area: Box,
  maxZoom = 1,
  padding = 24,
): Viewport {
  const fitZoom = Math.min(
    (area.width - padding * 2) / Math.max(target.width, 1),
    (area.height - padding * 2) / Math.max(target.height, 1),
  );
  const zoom = clampZoom(Math.min(fitZoom, maxZoom));
  const w = target.width * zoom;
  const h = target.height * zoom;
  const x =
    w <= area.width
      ? area.x + (area.width - w) / 2
      : area.x + Math.min(padding, area.width / 4);
  const y =
    h <= area.height
      ? area.y + (area.height - h) / 2
      : area.y + Math.min(padding, area.height / 4);
  return { x: x - target.x * zoom, y: y - target.y * zoom, zoom };
}

/** Zoom by a factor about the centre of the usable area. */
export function zoomAbout(view: Viewport, area: Box, factor: number): Viewport {
  const zoom = clampZoom(view.zoom * factor);
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  const worldX = (cx - view.x) / view.zoom;
  const worldY = (cy - view.y) / view.zoom;
  return { x: cx - worldX * zoom, y: cy - worldY * zoom, zoom };
}

/** Canvas-space point at the centre of the usable area. */
export function areaCentre(view: Viewport, area: Box) {
  return {
    x: (area.x + area.width / 2 - view.x) / view.zoom,
    y: (area.y + area.height / 2 - view.y) / view.zoom,
  };
}

export type FitResult =
  | { ok: true; height: number }
  | { ok: false; reason: string };

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

/**
 * Height that fits measured content, anchored at the node's top-left. Growth
 * is refused rather than moving neighbours when the new strip is occupied or
 * the result would exceed the protocol size limit.
 */
export function fitTextHeight(
  node: Box & { id: string },
  requiredHeight: number,
  others: (Box & { id: string })[],
): FitResult {
  const height = Math.ceil(requiredHeight);
  if (height <= node.height)
    return { ok: false, reason: "The text already fits this object." };
  if (height > LIMITS.maxSize)
    return {
      ok: false,
      reason: `The text needs more than the ${LIMITS.maxSize}-unit size limit. Use Read to view it in full.`,
    };
  const strip = {
    x: node.x,
    y: node.y + node.height,
    width: node.width,
    height: height - node.height,
  };
  const blocked = others.find(
    (other) => other.id !== node.id && overlaps(strip, other),
  );
  if (blocked)
    return {
      ok: false,
      reason:
        "Another object occupies the space below. Move it or resize this object; you can still read the full text.",
    };
  return { ok: true, height };
}

/** Read-only text carried by a pending proposal, for the review disclosure. */
export type ProposedContent = { title: string; text: string };

type ContentOperation =
  | { op: "createText" | "updateText"; text: string }
  | { op: "createShape" | "updateShape"; kind: string; label?: string }
  | { op: string };

export function proposedContent(
  operations: readonly ContentOperation[],
): ProposedContent[] {
  const items: ProposedContent[] = [];
  operations.forEach((operation, index) => {
    const step = `Change ${index + 1}`;
    if ("text" in operation)
      items.push({
        title: `${step}: ${operation.op === "createText" ? "new text" : "updated text"}`,
        text: operation.text,
      });
    else if ("label" in operation && operation.label)
      items.push({
        title: `${step}: ${operation.kind} label`,
        text: operation.label,
      });
  });
  return items;
}
