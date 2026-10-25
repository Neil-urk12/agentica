import "./style.css";
import { loadStats } from "./stats";
import { version } from "../package.json";
import {
  atStop,
  boardProgress,
  buildStops,
  cameraAt,
  clamp,
  connector,
  jumpBehavior,
  smoothstep,
  type Box,
  type Camera,
} from "./camera";

void loadStats();

/* --------------------------------------------------------------- helpers */

type PlatformId = "windows" | "macos" | "linux";

const PLATFORMS: Record<PlatformId, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
};

// The release process bumps every package.json, so this tracks the latest tag.
const TAG = `v${version}`;
const RELEASES = "https://github.com/Neil-urk12/agentica/releases";
const asset = (name: string) => `${RELEASES}/download/${TAG}/${name}`;

const SETUP = `agentica-${TAG}-windows-x64-setup.exe`;
const DEB = `agentica-${TAG}-linux-amd64.deb`;
const RPM = `agentica-${TAG}-linux-x86_64.rpm`;
const APPIMAGE = `agentica-${TAG}-linux-x86_64.AppImage`;

type Installer = {
  /** First file is the recommended one the main button downloads. */
  files: { title: string; format: string; url: string }[];
  /** One-line install commands; index.html has a block for each slot. */
  commands: { label: string; command: string }[];
};

// No macOS build yet: macOS falls back to the releases page and building from source.
const INSTALLERS: Partial<Record<PlatformId, Installer>> = {
  windows: {
    files: [
      { title: "Windows 10 and 11", format: "setup.exe", url: asset(SETUP) },
    ],
    commands: [
      {
        label: "PowerShell",
        command: `curl.exe -Lo agentica-setup.exe ${asset(SETUP)}; .\\agentica-setup.exe`,
      },
    ],
  },
  linux: {
    files: [
      { title: "Debian, Ubuntu", format: ".deb", url: asset(DEB) },
      { title: "Fedora, RHEL, openSUSE", format: ".rpm", url: asset(RPM) },
      {
        title: "Any distro, portable",
        format: "AppImage",
        url: asset(APPIMAGE),
      },
    ],
    commands: [
      {
        label: "Debian, Ubuntu",
        command: `curl -LO ${asset(DEB)} && sudo apt install ./${DEB}`,
      },
      { label: "Fedora, RHEL", command: `sudo dnf install ${asset(RPM)}` },
    ],
  },
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

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

/* ------------------------------------------------------------------ theme */

const THEME_KEY = "agentica.landing.theme";
type Theme = "light" | "dark";

const root = document.documentElement;
const themeToggles = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-theme-toggle]"),
);
const themeMeta = document.querySelector<HTMLMetaElement>("#theme-color");

function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme, persist: boolean) {
  root.dataset.theme = theme;
  const dark = theme === "dark";

  for (const toggle of themeToggles) {
    toggle.setAttribute("aria-pressed", String(dark));
    const label = dark ? "Switch to light theme" : "Switch to dark theme";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
  }

  if (themeMeta) themeMeta.content = dark ? "#171717" : "#eef0fa";

  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // The chosen theme still applies for this page view.
    }
  }
}

applyTheme(root.dataset.theme === "dark" ? "dark" : "light", false);

for (const toggle of themeToggles) {
  toggle.addEventListener("click", () => {
    applyTheme(root.dataset.theme === "dark" ? "light" : "dark", true);
  });
}

const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
colorScheme.addEventListener("change", (event) => {
  if (storedTheme()) return;
  applyTheme(event.matches ? "dark" : "light", false);
});

/* ------------------------------------------------------------- downloads */

const platformButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-platform]"),
);
const downloadLabels = Array.from(
  document.querySelectorAll<HTMLElement>("[data-download-label]"),
);
const downloadHint = document.querySelector<HTMLElement>(
  "[data-download-hint]",
);
const downloadLink = document.querySelector<HTMLAnchorElement>(
  "[data-download-link]",
);
const filesSection = document.querySelector<HTMLElement>("[data-files]");
const filesTitle = document.querySelector<HTMLElement>("[data-files-title]");
const filesList = document.querySelector<HTMLElement>("[data-files-list]");
const filesEmpty = document.querySelector<HTMLElement>("[data-files-empty]");
const fileTemplate = document.querySelector<HTMLTemplateElement>(
  "[data-file-template]",
);
const installSection = document.querySelector<HTMLElement>("[data-installs]");
const installBlocks = Array.from(
  document.querySelectorAll<HTMLElement>("[data-install]"),
);
const releaseLink = document.querySelector<HTMLAnchorElement>(
  "[data-release-link]",
);
if (releaseLink) releaseLink.href = `${RELEASES}/tag/${TAG}`;

function fileRow(file: Installer["files"][number]): Node {
  const row = fileTemplate!.content.cloneNode(true) as DocumentFragment;
  row.querySelector("a")!.href = file.url;
  row.querySelector("[data-file-title]")!.textContent = file.title;
  row.querySelector("[data-file-format]")!.textContent = `${file.format} · x64`;
  return row;
}

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

  const installer = platform ? INSTALLERS[platform] : undefined;
  const primary = installer?.files[0];
  const label = !platform
    ? "Download for desktop"
    : primary
      ? `Download for ${PLATFORMS[platform]}`
      : "See all releases";

  for (const element of downloadLabels) element.textContent = label;
  // The hero button scrolls here; only the download section's button fetches the file.
  if (downloadLink) {
    downloadLink.href = primary?.url ?? `${RELEASES}/latest`;
    const linkLabel = downloadLink.querySelector("[data-download-label]");
    if (linkLabel && platform && primary) {
      linkLabel.textContent = `Download for ${PLATFORMS[platform]} (${primary.format})`;
    }
  }

  if (filesSection && filesTitle && filesList && filesEmpty) {
    filesSection.hidden = !platform;
    filesTitle.textContent = platform
      ? `Downloads for ${PLATFORMS[platform]}`
      : "";
    filesList.replaceChildren(...(installer?.files ?? []).map(fileRow));
    filesEmpty.hidden = Boolean(installer);
  }

  if (installSection) installSection.hidden = !installer;
  installBlocks.forEach((block, index) => {
    const entry = installer?.commands[index];
    block.hidden = !entry;
    block.querySelector("[data-install-label]")!.textContent =
      entry?.label ?? "";
    block.querySelector("code")!.textContent = entry?.command ?? "";
    block.querySelector<HTMLElement>("[data-copy]")!.dataset.copy =
      entry?.command ?? "";
  });

  if (downloadHint) {
    downloadHint.textContent = `${TAG} pre-release`;
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

/* ---------------------------------------------------------------- boards */

/** Board nodes are placed by inline px in the design space `.board` sets in CSS. */
function nodeBox(node: HTMLElement): Box {
  return {
    x: parseFloat(node.style.left),
    y: parseFloat(node.style.top),
    w: parseFloat(node.style.width),
    h: parseFloat(node.style.height),
  };
}

function drawConnectors(board: HTMLElement) {
  const boxes = new Map<string, Box>();
  for (const node of board.querySelectorAll<HTMLElement>(
    ":scope > .n[data-id]",
  )) {
    boxes.set(node.dataset.id ?? "", nodeBox(node));
  }
  for (const edge of board.querySelectorAll<SVGPathElement>(
    ".edges [data-from]",
  )) {
    const from = boxes.get(edge.dataset.from ?? "");
    const to = boxes.get(edge.dataset.to ?? "");
    if (from && to) edge.setAttribute("d", connector(from, to));
  }
}

const boardWraps = Array.from(
  document.querySelectorAll<HTMLElement>("[data-board-wrap]"),
);
const boardScale = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const board = entry.target.firstElementChild as HTMLElement | null;
    // offsetWidth ignores the scale transform, so it is the CSS design width.
    if (!board?.offsetWidth) continue;
    board.style.setProperty(
      "--s",
      String(entry.target.clientWidth / board.offsetWidth),
    );
  }
});

for (const wrap of boardWraps) {
  const board = wrap.firstElementChild as HTMLElement | null;
  if (!board) continue;
  // Dashed placeholders mark where each node will land while the board assembles.
  const ghosts = document.createDocumentFragment();
  for (const node of board.querySelectorAll<HTMLElement>(":scope > .n")) {
    const ghost = document.createElement("div");
    ghost.className = "ghost";
    ghost.setAttribute("aria-hidden", "true");
    for (const prop of ["left", "top", "width", "height", "--i"]) {
      ghost.style.setProperty(prop, node.style.getPropertyValue(prop));
    }
    ghosts.append(ghost);
  }
  board.prepend(ghosts);
  drawConnectors(board);
  boardScale.observe(wrap);
}

/* ------------------------------------------------------------ canvas tour */

/** Must match the media query in index.html's pre-paint script. */
const CAMERA_QUERY =
  "(min-width: 761px) and (prefers-reduced-motion: no-preference)";
const STOPS = [
  "hero",
  "conversation",
  "projects",
  "tasks",
  "overview",
  "download",
];
/** Room for the nav and chrome when fitting a cluster to the viewport. */
const FIT_PAD = { x: 96, y: 200 };
/** The nav covers the top of the stage, so frame clusters slightly lower. */
const NAV_OFFSET = 18;

const cameraMode = window.matchMedia(CAMERA_QUERY);
const tour = document.querySelector<HTMLElement>("[data-tour]");
const stage = document.querySelector<HTMLElement>("[data-stage]");
const world = document.querySelector<HTMLElement>("[data-world]");

if (tour && stage && world) {
  const tourEl = tour;
  const stageEl = stage;
  const worldEl = world;
  const clusters = new Map<string, HTMLElement>();
  for (const cluster of worldEl.querySelectorAll<HTMLElement>(
    "[data-cluster]",
  )) {
    clusters.set(cluster.dataset.cluster ?? "", cluster);
  }
  const links = Array.from(
    worldEl.querySelectorAll<SVGPathElement>(".links [data-from]"),
  );
  const navLinks = Array.from(
    document.querySelectorAll<HTMLAnchorElement>(".nav__links a"),
  );
  const zoomReadout = stageEl.querySelector<HTMLElement>("[data-hud-zoom]");
  const posReadout = stageEl.querySelector<HTMLElement>("[data-hud-pos]");
  const miniView = stageEl.querySelector<SVGRectElement>("[data-mini-view]");
  const last = STOPS.length - 1;

  let stops: Camera[] = [];
  let camera: Camera = { x: 0, y: 0, z: 1 };
  let position = 0;
  let span = 1;
  let tourTop = 0;
  let width = 0;
  let height = 0;
  /** Stop a navigation is heading to, so focus-follow does not fight it. */
  let heading = -1;
  let queued = false;

  const clusterBox = (el: HTMLElement): Box => ({
    x: el.offsetLeft,
    y: el.offsetTop,
    w: el.offsetWidth,
    h: el.offsetHeight,
  });
  const boardOf = (el: HTMLElement) => el.querySelector<HTMLElement>(".board");
  const cameraOn = () => cameraMode.matches;

  function measure() {
    root.classList.toggle("camera", cameraOn());
    if (!cameraOn()) {
      worldEl.style.transform = "";
      return;
    }
    width = stageEl.clientWidth;
    height = stageEl.clientHeight;
    const boxes: Record<string, Box> = {};
    for (const [name, el] of clusters) boxes[name] = clusterBox(el);
    stops = buildStops(STOPS, boxes, {
      width,
      height,
      padX: FIT_PAD.x,
      padY: FIT_PAD.y,
    });
    for (const link of links) {
      const from = boxes[link.dataset.from ?? ""];
      const to = boxes[link.dataset.to ?? ""];
      if (from && to) link.setAttribute("d", connector(from, to));
    }
    for (const rect of stageEl.querySelectorAll<SVGRectElement>(
      "[data-mini]",
    )) {
      const box = boxes[rect.dataset.mini ?? ""];
      if (!box) continue;
      rect.setAttribute("x", String(box.x));
      rect.setAttribute("y", String(box.y));
      rect.setAttribute("width", String(box.w));
      rect.setAttribute("height", String(box.h));
      rect.setAttribute("rx", "24");
    }
    tourTop = tourEl.getBoundingClientRect().top + window.scrollY;
    span = Math.max(1, tourEl.offsetHeight - height);
  }

  /** Stacked layout: boards assemble as they rise into view. */
  function scrubStacked() {
    const viewport = window.innerHeight;
    for (const [name, el] of clusters) {
      const board = boardOf(el);
      if (!board || name === "hero") continue;
      const top = el.getBoundingClientRect().top;
      const p = reducedMotion.matches
        ? 1
        : smoothstep(clamp((viewport - top) / (viewport * 0.62)));
      board.style.setProperty("--p", p.toFixed(3));
    }
  }

  function frame() {
    if (!cameraOn()) {
      scrubStacked();
      return;
    }
    position = clamp((window.scrollY - tourTop) / span) * last;
    camera = cameraAt(stops, position);
    const { x, y, z } = camera;
    const tx = width / 2 - x * z;
    const ty = height / 2 + NAV_OFFSET - y * z;
    worldEl.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${z.toFixed(4)})`;
    stageEl.style.setProperty("--z", z.toFixed(4));
    stageEl.style.setProperty("--bx", `${tx.toFixed(1)}px`);
    stageEl.style.setProperty("--by", `${ty.toFixed(1)}px`);

    for (const [name, el] of clusters) {
      boardOf(el)?.style.setProperty(
        "--p",
        boardProgress(position, STOPS.indexOf(name)).toFixed(3),
      );
    }
    for (const link of links) {
      const from = STOPS.indexOf(link.dataset.from ?? "");
      const to = STOPS.indexOf(link.dataset.to ?? "");
      link.style.setProperty(
        "--t",
        clamp((position - from) / (to - from)).toFixed(3),
      );
    }

    if (zoomReadout) zoomReadout.textContent = `${Math.round(z * 100)}%`;
    if (posReadout)
      posReadout.textContent = `x ${Math.round(x)} · y ${Math.round(y)}`;
    if (miniView) {
      miniView.setAttribute("x", String(-tx / z));
      miniView.setAttribute("y", String(-ty / z));
      miniView.setAttribute("width", String(width / z));
      miniView.setAttribute("height", String(height / z));
    }

    const nearest = STOPS[Math.round(position)];
    for (const link of navLinks) {
      if (link.hash === `#${nearest}`)
        link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
    if (heading >= 0 && atStop(position, heading)) heading = -1;
  }

  function request() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      frame();
    });
  }

  /** Move the camera to a stop; jumps past the next stop skip the tour. */
  function go(name: string, instant = false) {
    const index = STOPS.indexOf(name);
    const cluster = clusters.get(name);
    if (index < 0 || !cluster) return;
    if (!cameraOn()) {
      cluster.scrollIntoView({
        behavior: reducedMotion.matches ? "auto" : "smooth",
      });
      return;
    }
    heading = index;
    window.scrollTo({
      top: tourTop + (index / last) * span,
      behavior: instant
        ? "auto"
        : jumpBehavior(position, index, reducedMotion.matches),
    });
  }

  // In-page links move the camera instead of scrolling to a transformed element.
  document.addEventListener("click", (event) => {
    if (
      !cameraOn() ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey
    )
      return;
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>(
      'a[href^="#"]',
    );
    const name = link?.hash.slice(1) ?? "";
    const cluster = clusters.get(name);
    if (!cluster) return;
    event.preventDefault();
    if (location.hash !== `#${name}`) history.pushState(null, "", `#${name}`);
    go(name);
    cluster.focus({ preventScroll: true });
  });

  // Fragment history restores the camera after the browser's own scroll restore.
  window.addEventListener("hashchange", () => {
    if (cameraOn()) go(location.hash.slice(1) || "hero", true);
  });

  worldEl.addEventListener("focusin", (event) => {
    if (!cameraOn()) return;
    const name =
      (event.target as Element).closest<HTMLElement>("[data-cluster]")?.dataset
        .cluster ?? "";
    const index = STOPS.indexOf(name);
    if (index < 0 || index === heading || Math.round(position) === index)
      return;
    // Let the browser finish its own focus scrolling, then place the camera.
    requestAnimationFrame(() => go(name, true));
  });

  // A jump that ends or is interrupted short of its stop must not keep
  // suppressing focus-follow for that stop.
  const abandonJump = () => {
    heading = -1;
  };
  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
    window.addEventListener(type, abandonJump, {
      capture: true,
      passive: true,
    });
  }
  window.addEventListener("scrollend", abandonJump);

  /* Hero board: drag and arrow keys, the one place visitors move nodes. */
  const heroBoard = clusters
    .get("hero")
    ?.querySelector<HTMLElement>(".board--hero");
  if (heroBoard) {
    const board = heroBoard;
    let drag: {
      node: HTMLElement;
      pointerId: number;
      startX: number;
      startY: number;
      origin: Box;
      scale: number;
    } | null = null;

    const moveNode = (node: HTMLElement, x: number, y: number) => {
      const box = nodeBox(node);
      const right = board.offsetWidth - box.w;
      const bottom = board.offsetHeight - box.h;
      node.style.left = `${clamp(x, 0, right).toFixed(1)}px`;
      node.style.top = `${clamp(y, 0, bottom).toFixed(1)}px`;
      drawConnectors(board);
    };

    for (const node of board.querySelectorAll<HTMLElement>(":scope > .n")) {
      node.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        // A scroll gesture mid-flight must never pick up a node.
        if (cameraOn() && !atStop(position, 0)) return;
        const scale =
          (cameraOn() ? camera.z : 1) *
          (parseFloat(board.style.getPropertyValue("--s")) || 1);
        drag = {
          node,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          origin: nodeBox(node),
          scale,
        };
        node.setPointerCapture(event.pointerId);
        node.classList.add("is-dragging");
        event.preventDefault();
      });

      node.addEventListener("pointermove", (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        moveNode(
          drag.node,
          drag.origin.x + (event.clientX - drag.startX) / drag.scale,
          drag.origin.y + (event.clientY - drag.startY) / drag.scale,
        );
      });

      const endDrag = (event: PointerEvent) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag.node.classList.remove("is-dragging");
        if (drag.node.hasPointerCapture(event.pointerId)) {
          drag.node.releasePointerCapture(event.pointerId);
        }
        drag = null;
      };
      node.addEventListener("pointerup", endDrag);
      node.addEventListener("pointercancel", endDrag);

      node.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 32 : 8;
        const moves: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        const move = moves[event.key];
        if (!move) return;
        event.preventDefault();
        const box = nodeBox(node);
        moveNode(node, box.x + move[0], box.y + move[1]);
      });
    }
  }

  const remeasure = () => {
    measure();
    frame();
  };
  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", remeasure);
  cameraMode.addEventListener("change", remeasure);
  reducedMotion.addEventListener("change", remeasure);
  void document.fonts?.ready.then(remeasure);
  remeasure();

  // Deep links open at their stop; repeat on load in case the browser's own
  // fragment scroll lands after this module runs.
  const initial = location.hash.slice(1);
  if (cameraOn() && clusters.has(initial)) {
    go(initial, true);
    window.addEventListener("load", () => go(initial, true), { once: true });
  }

  // Tells the pre-paint script in index.html that the camera layout can stay.
  root.dataset.camera = "ready";
}

/* ------------------------------------------------------------------- year */

const year = document.querySelector<HTMLElement>("[data-year]");
if (year) year.textContent = String(new Date().getFullYear());
