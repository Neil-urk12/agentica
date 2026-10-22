## Context

`apps/landing` is a static Vite page: `index.html` (~745 lines), `src/main.ts`
(theme, platform detection, clipboard, a draggable hero board, IntersectionObserver
fade-up), and `src/style.css` (~2,500 lines). Its only dependencies are two
`@fontsource` packages. There are no landing tests; `pnpm build:landing` and the
package `check` script (tsc) are the gates.

The direction was chosen from three throwaway HTML prototypes (page as canvas, canvas
backdrop, zoom-out hero). This design follows prototype A, "page is the canvas",
with the follow-ups agreed during exploration: hero-only drag, instant long jumps,
hash deep links, a skip link, a shorter scroll track, and camera-follows-focus.

## Goals / Non-Goals

**Goals:**

- Scroll moves a camera across one canvas world; it never reads as a document.
- The page looks like the desktop app: same tokens, dot grid, node, tile, connector,
  proposal, and attention visuals.
- Every piece of text is reachable by keyboard, find-in-page, and screen readers, and
  the page is complete with motion disabled.
- Smooth on a mid-range laptop; no new dependencies.

**Non-Goals:**

- User-controlled pan and zoom (wheel, pinch, drag on empty canvas).
- Dragging nodes outside the hero board.
- Real release artifacts, version checks, or analytics.
- Sharing components or CSS with `apps/desktop`; tokens are copied, not imported.

## Decisions

### World, stage, and camera

A `.tour` scroll track contains a sticky full-viewport `.stage`; inside it one
absolutely sized `.world` (about 2800 × 1900 px) holds the clusters at fixed world
coordinates. The camera is `{x, y, z}` (world point at viewport center, zoom) and is
applied as one `translate() scale()` on `.world` with `transform-origin: 0 0`. The
stage's dot grid takes `background-size: 24px * z` and `background-position` from the
same translation so it moves with the world.

Stops are computed from cluster boxes (`offsetLeft/Top/Width/Height`, unaffected by
the transform): fit each cluster in the viewport minus nav and chrome, capped at
100%. The overview stop fits the bounding box of all clusters. Order: hero,
conversation, projects, tasks, overview, download.

Scroll progress `f = progress × (stops − 1)`. Each segment holds near its stops and
eases between them (smoothstep over the middle ~64%). Zoom interpolates
geometrically and dips about 20% mid-flight (`× (1 − 0.2·sin πe)`) so travel reads as
a canvas fly-over. The track is about 120vh per stop (~600vh total).

_Alternatives:_ CSS scroll-driven animations (`animation-timeline`) cannot compute
fit-to-viewport stops or geometric zoom and lack full cross-browser support; GSAP
ScrollTrigger adds a dependency for what is ~60 lines of math. A single
`requestAnimationFrame`-throttled scroll handler is enough.

### Board assembly from one variable

Each board is authored in a fixed 640 × 400 design space and scaled by a
`ResizeObserver`-set `--s`. A single `--p` (0–1) per board drives everything in CSS:
nodes derive `--t = clamp(0, p·6 − i, 1)` from a per-node `--i` stagger; opacity,
translate, and scale come from `--t`; generated dashed ghosts fade as nodes land;
connectors use `pathLength="1"` and `stroke-dashoffset: 1 − t`; the cursor
interpolates between two points; `.att` elements (attention ring, waiting chip and
strip) appear above `p ≈ 0.82`. JavaScript only writes `--p`: assembly starts as the
camera approaches a stop and stays assembled afterwards, so revisiting is calm.

_Alternative:_ per-element JS animation or Web Animations — more code and harder to
keep the reduced-motion and flat paths identical.

### Connectors from data

Board connectors (`data-from` / `data-to`) and world links between clusters are
computed from node rectangles with the existing `edgeAnchor` + quadratic-bend logic
from `main.ts`. Board connectors are computed once per layout except on the hero
board, which recomputes during drag.

### Hero drag under a zoomed camera

Reuse the current pointer-capture and arrow-key handlers on hero nodes only. Pointer
deltas are divided by `camera.z × board scale` before converting to board
coordinates, and drag is ignored while the camera is between stops (|f − 0| > 0.25)
so a scroll gesture never moves a node. Nodes keep `touch-action: none`; the board
background does not, so touch scrolling still works.

### Navigation, jumps, and deep links

`go(stop)` computes the stop's scroll offset. If the target is more than one stop
away, scroll with `behavior: "auto"`; otherwise smooth (auto under reduced motion).
On load, a hash matching a stop sets the scroll offset before the first frame. Nav
buttons reflect the nearest stop via `aria-current`. "Skip to content" targets the
hero cluster; the hero has "Skip to download".

### Focus follows the camera

A `focusin` listener on `.world` finds the focused element's cluster and calls
`go()` for its stop (instant). Because all text is real DOM, find-in-page highlights
it, but the browser cannot move a transformed camera, so focus-follow covers keyboard
users and the flat layout covers everything else. Off-screen clusters are not
`inert` or `aria-hidden`: screen readers read the page in DOM order, which matches the
tour order.

### Flat layout

The stacked layout is the default, so the page also works without JavaScript. The
camera layout is opt-in: `.camera` on `<html>` is set by the pre-paint script in
`index.html` when `(min-width: 761px) and (prefers-reduced-motion: no-preference)`
matches, so the first paint already uses the final layout. Without it, the track,
stage, and world are normal flow: clusters stack (two columns from 900px), boards
fill the width, chrome and world links hide, and boards scrub `--p` from their
viewport position (or sit at 1 under reduced motion). The same DOM serves both
layouts; media query changes re-measure live. In camera mode the nav is fixed
rather than sticky so the stage fills the viewport from the top.

### Theming and copy

Copy the desktop tokens (`--bg`, `--surface`, `--ink`, `--accent`, note, proposal,
attention, terminal colors) into `style.css` for light and dark, keeping the existing
`data-theme` toggle and stored preference. Product claims follow `README.md`:
terminal and Codex tiles are Linux-only; Send pastes without pressing Enter; task
status is factual; model calls go only to the configured provider.

## Risks / Trade-offs

- [A large transformed world janks on low-end GPUs] → one transform per frame,
  `will-change: transform` on `.world` only, no filters or shadows animated; validate
  on a low-end laptop and drop the mid-flight zoom dip or shadows if needed.
- [Find-in-page matches text the camera is not showing] → accepted; focus-follow plus
  the flat layout under reduced motion keep content reachable. Revisit if it confuses
  users.
- [Scroll-driven tours feel like scroll-jacking] → native scrolling is never
  intercepted; the page only reacts to scroll position, and jumps plus deep links let
  visitors skip the tour.
- [Text is tiny at the overview stop] → the overview is a picture of the whole canvas,
  not a reading stop; every cluster has its own 1:1-ish stop.
- [Copied tokens drift from `apps/desktop/src/app.css`] → note the source in a
  comment; tokens change rarely.
- [Removing the plates, ledger, and steps loses content] → their substance (local
  storage, two launch modes, MIT license, getting started) moves into the clusters
  and the download card.

## Migration Plan

Single static deploy; rollback is reverting the commit. No data or URLs change except
that old section anchors (`#surface`, `#how`) stop existing; `#download` keeps
working.

## Open Questions

- Should the overview stop label clusters by name, or stay unlabeled? Default:
  frame names are always visible above clusters, so no extra labels.
