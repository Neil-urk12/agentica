## Why

The landing page reads as a document with a canvas illustration in the hero. Its only
scroll motion is a uniform fade-up, its palette (warm paper and indigo) differs from the
desktop app, and its content predates project groups, native sessions, attention, and
tasks. Visitors should feel the product, an infinite canvas, before they read about it.

## What Changes

- Replace the document layout of `apps/landing` with one canvas world. A pinned stage
  shows five clusters (hero, canvas conversation, projects and sessions, tasks,
  download); page scroll drives a camera that pans and zooms between them, with an
  overview stop before download.
- Each cluster's board assembles as the camera arrives: dashed placeholders become
  nodes, connectors draw in, a cursor moves, and the Codex tile's attention ring
  appears last.
- Add canvas chrome: a zoom and position readout and a minimap with the viewport.
- Navigation and a "Skip to download" link jump the camera; jumps farther than one stop
  are instant. Hash links (`#conversation`, `#projects`, `#tasks`, `#download`) open at
  that stop.
- Keyboard focus inside a cluster moves the camera to it.
- Keep the hero board draggable with pointer and arrow keys; connectors follow live and
  drag accounts for camera zoom.
- Narrow screens and reduced motion get the same clusters as a stacked page with no
  camera.
- Adopt the desktop app's color tokens in both themes; keep Poppins and DM Mono.
- Rewrite copy to cover canvas conversation, project groups with terminal and Codex
  tiles, session attention, and tasks. State that terminal and Codex tiles run on Linux
  only.
- Keep the theme toggle, platform detection for downloads, copy-to-clipboard, and the
  footer year.
- **BREAKING** (page content only): remove the current "surface" plates, ledger, and
  "How it works" steps; their substance moves into the clusters.

## Capabilities

### New Capabilities

- `landing-page`: the public landing page's canvas tour, navigation, accessibility
  fallbacks, theming, and the product claims it must keep accurate.

### Modified Capabilities

None.

## Impact

- `apps/landing/index.html`, `apps/landing/src/main.ts`, `apps/landing/src/style.css`.
- No new dependencies; animation uses the platform (CSS custom properties, transforms,
  `requestAnimationFrame`).
- No runtime, protocol, or desktop app changes. `pnpm build:landing` and the landing
  `check` script must stay green.
- `CHANGELOG.md` gains an Unreleased entry.
