import "./style.css";

/* --------------------------------------------------------------- helpers */

type PlatformId = "windows" | "macos" | "linux";

const PLATFORMS: Record<PlatformId, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
};

const reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

/** Best-effort OS detection; never throws and never assumes a platform. */
function detectPlatform(): PlatformId | null {
  const data = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const source = `${data?.platform ?? ""} ${navigator.platform ?? ""} ${
    navigator.userAgent
  }`.toLowerCase();

  if (source.includes("win")) return "windows";
  if (source.includes("mac") || source.includes("iphone")) return "macos";
  if (source.includes("linux") || source.includes("x11")) return "linux";
  return null;
}

/* ------------------------------------------------------------- downloads */

const platformButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-platform]"),
);
const downloadLabels = Array.from(
  document.querySelectorAll<HTMLElement>(".btn--hero [data-download-label]"),
);
const downloadHint = document.querySelector<HTMLElement>(".download__hint");

function selectedPlatform(): PlatformId | null {
  const active = platformButtons.find(
    (button) => button.getAttribute("aria-pressed") === "true",
  );
  return (active?.dataset.platform as PlatformId | undefined) ?? null;
}

function renderPlatform(platform: PlatformId | null) {
  for (const button of platformButtons) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.platform === platform),
    );
  }

  const label = platform
    ? `Download for ${PLATFORMS[platform]}`
    : "Download for desktop";

  for (const element of downloadLabels) element.textContent = label;

  if (downloadHint) {
    downloadHint.textContent = platform
      ? `GitHub Releases · pre-release · ${PLATFORMS[platform]}`
      : "GitHub Releases · pre-release";
  }
}

for (const button of platformButtons) {
  button.addEventListener("click", () => {
    const next = button.dataset.platform as PlatformId;
    renderPlatform(selectedPlatform() === next ? null : next);
  });
}

renderPlatform(detectPlatform());

/* -------------------------------------------------------------- clipboard */

const toast = document.querySelector<HTMLElement>("[data-toast]");
let toastTimer = 0;

function announce(message: string) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-on");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("is-on"), 1800);
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    return copied;
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-copy]",
)) {
  button.addEventListener("click", async () => {
    const value = button.dataset.copy ?? "";
    if (!(await copyText(value))) {
      announce("Copy failed — select the command instead");
      return;
    }
    announce("Copied command");
    button.classList.add("is-copied");
    window.setTimeout(() => button.classList.remove("is-copied"), 1600);
  });
}

/* ----------------------------------------------------------- canvas demo */

const board = document.querySelector<HTMLElement>("[data-board]");
const edges = document.querySelector<SVGSVGElement>("[data-edges]");

type Point = { x: number; y: number };

function nodeCenter(node: HTMLElement): Point {
  return {
    x: node.offsetLeft + node.offsetWidth / 2,
    y: node.offsetTop + node.offsetHeight / 2,
  };
}

/** Leave a point on the node's rectangle edge, pointed at `target`. */
function edgeAnchor(node: HTMLElement, target: Point): Point {
  const center = nodeCenter(node);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (dx === 0 && dy === 0) return center;

  const halfWidth = node.offsetWidth / 2 + 4;
  const halfHeight = node.offsetHeight / 2 + 4;
  const tx = dx === 0 ? Infinity : halfWidth / Math.abs(dx);
  const ty = dy === 0 ? Infinity : halfHeight / Math.abs(dy);
  const scale = Math.min(tx, ty);

  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

function drawEdges() {
  if (!board || !edges) return;
  const nodes = new Map<string, HTMLElement>();
  for (const node of board.querySelectorAll<HTMLElement>("[data-node]")) {
    if (node.dataset.node) nodes.set(node.dataset.node, node);
  }

  for (const group of edges.querySelectorAll<SVGGElement>("[data-edge]")) {
    const path = group.querySelector("path");
    const from = nodes.get(group.dataset.edge ?? "");
    const to = nodes.get(group.dataset.to ?? "");
    if (!path || !from || !to) continue;

    const start = edgeAnchor(from, nodeCenter(to));
    const end = edgeAnchor(to, nodeCenter(from));
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const bend = 0.16;
    const control = {
      x: (start.x + end.x) / 2 - dy * bend,
      y: (start.y + end.y) / 2 + dx * bend,
    };

    path.setAttribute(
      "d",
      `M${start.x.toFixed(1)} ${start.y.toFixed(1)} Q${control.x.toFixed(
        1,
      )} ${control.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
    );
  }
}

if (board && edges) {
  const boardElement = board;
  const nodes = Array.from(
    boardElement.querySelectorAll<HTMLElement>("[data-node]"),
  );
  const boardRect = () => boardElement.getBoundingClientRect();
  let drag: {
    node: HTMLElement;
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
  } | null = null;

  function setPosition(node: HTMLElement, x: number, y: number) {
    const maxX = 100 - (node.offsetWidth / boardElement.clientWidth) * 100;
    const maxY = 100 - (node.offsetHeight / boardElement.clientHeight) * 100;
    const clampedX = Math.min(Math.max(0, x), Math.max(0, maxX));
    const clampedY = Math.min(Math.max(0, y), Math.max(0, maxY));
    node.style.setProperty("--x", `${clampedX.toFixed(2)}%`);
    node.style.setProperty("--y", `${clampedY.toFixed(2)}%`);
    drawEdges();
  }

  for (const node of nodes) {
    node.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const rect = boardRect();
      drag = {
        node,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: node.offsetLeft,
        originY: node.offsetTop,
        width: rect.width,
        height: rect.height,
      };
      node.setPointerCapture(event.pointerId);
      node.classList.add("is-dragging");
      event.preventDefault();
    });

    node.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = ((event.clientX - drag.startX) / drag.width) * 100;
      const dy = ((event.clientY - drag.startY) / drag.height) * 100;
      setPosition(
        drag.node,
        (drag.originX / drag.width) * 100 + dx,
        (drag.originY / drag.height) * 100 + dy,
      );
    });

    const endDrag = (event: PointerEvent) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.node.classList.remove("is-dragging");
      if (drag.node.hasPointerCapture(event.pointerId)) {
        drag.node.releasePointerCapture(event.pointerId);
      }
      drag = null;
      drawEdges();
    };

    node.addEventListener("pointerup", endDrag);
    node.addEventListener("pointercancel", endDrag);

    node.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 4 : 1;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      const rect = boardRect();
      setPosition(
        node,
        (node.offsetLeft / rect.width) * 100 + move[0],
        (node.offsetTop / rect.height) * 100 + move[1],
      );
    });
  }

  const observer = new ResizeObserver(() => drawEdges());
  observer.observe(boardElement);
  window.addEventListener("load", drawEdges);
  drawEdges();
}

/* ---------------------------------------------------------------- reveals */

const revealables = document.querySelectorAll<HTMLElement>("[data-reveal]");

if (reducedMotion || !("IntersectionObserver" in window)) {
  for (const element of revealables) element.classList.add("is-visible");
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
  );
  for (const element of revealables) observer.observe(element);
}

/* ------------------------------------------------------------------- year */

const year = document.querySelector<HTMLElement>("[data-year]");
if (year) year.textContent = String(new Date().getFullYear());
