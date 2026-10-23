## 1. Tokens and canvas vocabulary

- [x] 1.1 Replace landing color tokens in `src/style.css` with the desktop app's light and dark tokens (source noted in a comment), keeping the `data-theme` toggle and pre-paint theme script
- [x] 1.2 Add the dot-grid, node, note, prompt/reply, proposal, project group, terminal/Codex tile, task, connector, ghost, cursor, and attention styles driven by `--p`/`--i`/`--t`
- [x] 1.3 Remove styles for the retired plates, ledger, steps, and fade-up reveal

## 2. Page structure

- [x] 2.1 Rewrite `index.html` as nav + tour track + sticky stage + world with five clusters (hero, conversation, projects, tasks, download) at fixed world coordinates, each with a frame name, copy, and a 640 × 400 board
- [x] 2.2 Write cluster copy from `README.md` claims (Linux-only tiles, Send without Enter, factual task status, Apply/Discard, configured provider only, pre-release downloads)
- [x] 2.3 Add zoom/position readout and minimap markup, marked `aria-hidden`
- [x] 2.4 Add "Skip to download" in the hero and point the skip link at the hero cluster

## 3. Camera

- [x] 3.1 Add `src/camera.ts` with pure functions: fit a box to the viewport, build stops (including overview), interpolate the camera for a tour position (hold, smoothstep, geometric zoom with mid-flight dip), and decide instant vs smooth jumps
- [x] 3.2 Add `tests/landing-camera.test.mjs` covering fit capping at 100%, overview bounds, stop holds, interpolation endpoints, and the jump rule
- [x] 3.3 In `src/main.ts`, measure clusters, apply the camera transform and dot-grid sync on `requestAnimationFrame`-throttled scroll, and recompute on resize and font load
- [x] 3.4 Drive each board's `--p` from tour position so boards assemble on approach and stay assembled
- [x] 3.5 Compute board connectors and world links from node rectangles with the existing anchor and bend logic; update the readout and minimap each frame

## 4. Navigation and accessibility

- [x] 4.1 Wire nav buttons and the skip-to-download action to `go(stop)` with the instant/smooth rule and `aria-current` on the nearest stop
- [x] 4.2 Open at the stop named by `#conversation`, `#projects`, `#tasks`, or `#download` before the first visible frame
- [x] 4.3 Move the camera to a cluster when focus enters it
- [x] 4.4 Implement the `.flat` layout for `(max-width: 760px)` and `(prefers-reduced-motion: reduce)`, switching live on media changes; fully assembled boards under reduced motion

## 5. Hero board

- [x] 5.1 Port pointer drag and arrow-key movement to hero nodes only, dividing pointer deltas by camera zoom × board scale and ignoring drags while the camera travels
- [x] 5.2 Redraw hero connectors live during drag

## 6. Keep existing behavior

- [x] 6.1 Keep platform detection on download labels, copy-to-clipboard with fallback and toast, and the footer year

## 7. Validation and docs

- [x] 7.1 Run `pnpm --filter @agentica/landing check`, `pnpm build:landing`, `pnpm lint`, `pnpm format:check`, and `node --test tests/landing-camera.test.mjs`
- [x] 7.2 Check in Chrome at 1440, 1024, and 400px in light and dark: tour order, deep links, focus-follow, hero drag at reduced zoom, no horizontal scroll
- [x] 7.3 Check reduced motion shows the stacked, fully assembled page
- [x] 7.4 Check scrolling smoothness with CPU throttling (4×) in DevTools; drop the zoom dip or node shadows if frames drop
- [x] 7.5 Add a dated `CHANGELOG.md` Unreleased entry with the rationale
