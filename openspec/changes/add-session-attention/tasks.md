## 1. Signal scanner

- [x] 1.1 Add a `sessions/attention.rs` escape-sequence scanner (ground, escape, CSI, OSC param/payload, ignored DCS/APC/PM/SOS strings, string-ESC, CAN/SUB abort) that reports bell and OSC 9 notification signals from a borrowed byte slice with bounded state
- [x] 1.2 Ignore OSC 9 numeric subcommands (`^[0-9]+;`), treat OSC-terminating BEL/ST as non-bells, and treat 8-bit C1 bytes as text
- [x] 1.3 Cap retained OSC 9 payload at 1 KiB, decode as lossy UTF-8, strip control characters, and truncate to 256 characters
- [x] 1.4 Unit-test the title-per-prompt, cwd report, progress report, Codex OSC 9, ST and BEL terminators, byte-by-byte chunk splits, UTF-8 text containing 0x9D/0x90, oversized payloads, CAN abort, and DCS-wrapped content cases

## 2. Backend attention latch

- [x] 2.1 Add the `attention` latch (raised, saturating count, sequence, kind, at, message) to `SessionStatus`, and add per-session scanner and focus state to `Session`
- [x] 2.2 Run the scanner in the output thread's existing `with_session` push, raising or coalescing the latch only when the session is not focused
- [x] 2.3 Raise `exited`/`failed` attention in the process monitor when the stop flag is unset and the session is unfocused; leave Stop, Restart, and removal exits unraised
- [x] 2.4 Add `Focus` (controlling attachment only; clears through the current sequence when focused) and `ClearAttention` (session identity + acknowledged sequence; idempotent) commands with wire validation and service handling
- [x] 2.5 Reset focus to false on detach, supersession, and connection loss; confirm the replacement session after Restart starts with a clear latch
- [x] 2.6 Add Rust tests for focus gating, coalescing under a bell flood, the sequence-guarded clear race, attention surviving detach/reattach, user-stop exits not raising, stale-identity rejection, and status size staying within wire limits

## 3. Protocol and host adapters

- [x] 3.1 Extend `@agentica/protocol` `SessionStatus` and session command schemas with attention, `focus`, and `clearAttention`, including bounds validation
- [x] 3.2 Route the new commands through the Tauri session host and the detached WebSocket endpoint under existing authentication and rate limits
- [x] 3.3 Add contract tests for valid and invalid attention payloads and commands

## 4. Frontend

- [x] 4.1 Track terminal focus in `SessionManager` (xterm textarea focus and `document.hasFocus()`), reporting `focus` on change, on window focus/blur, and on Ctrl+Shift+Escape
- [x] 4.2 Add a tile header attention indicator with a signal label (`Bell`, `Notification` + quoted message as plain text, `Process exited` + code/signal, `Process failed` + error) and a Dismiss control that sends `clearAttention`
- [x] 4.3 Show member attention counts in collapsed group headers
- [x] 4.4 Add a canvas-chrome attention control with a count and a keyboard-operable list (tile kind, project, label, Go) that is reachable at 680×800
- [x] 4.5 Implement Go via the existing usable-area navigation for the tile box, or the group box when collapsed, changing only the viewport
- [x] 4.6 Announce attention-count changes through a polite live region without moving focus, and verify accessible names and visible focus in both themes
- [x] 4.7 Add the static Codex setup hint to Codex tiles, linking to the README section
- [x] 4.8 Confirm attention data is excluded from conversation context, autosave, and storage, with a test

## 5. Documentation and verification

- [x] 5.1 Add README guidance on what attention indicators do and do not mean, plus the opt-in Codex `[tui]` setup and its global-config trade-off
- [x] 5.2 Add a concise CHANGELOG entry with the backend-scanning and labeling rationale
- [ ] 5.3 Manually verify on Linux in desktop and browser modes: a `printf '\a'` and a `cargo test` bell in an off-viewport shell tile, a Codex approval and turn notification with the documented setup, Go then Dismiss, focus-clears, browser refresh preserving attention, and no attention from prompt title sequences
  - Browser checks completed at 680×800 in both themes: real shell and cargo-test bells, offscreen attention, keyboard Go and Dismiss, refresh/reopen retention, collapsed counts, and Go preserving collapse. Focus reporting/gating, prompt-title filtering, and connection loss pass unit and real-PTY integration tests.
  - Still unverified: desktop GUI interactions and live Codex approval/turn notifications with the documented opt-in configuration.
- [x] 5.4 Run `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm format:check`, `pnpm check:rust`, and `pnpm test:rust`
  - All seven checks passed, including 107 JavaScript tests and the Rust workspace tests. Run builds and the HTTP/browser tests sequentially because they share the backend executable and port.

## 6. Attention presentation redesign

Shipped in c76e94f as a top-bar waiting queue instead of the pill design first planned here; the `session-attention` spec delta was updated to describe what shipped.

- [x] 6.1 Derive attention entries once in `App.svelte` and pass them to the top bar, project groups, and session tiles
- [x] 6.2 Plain-language labels: `Waiting for you`, the notification text or `Sent a notification`, `Stopped (exit code n)` / `Stopped (signal s)`, and `Failed: <error>` / `Failed to start`
- [x] 6.3 Replace the `●N` button in `CanvasNavigation` with a top-bar `N waiting` queue: Ctrl+J/⌘J, oldest first, waited time, **Jump to**, **Mark seen**, and a polite live region
- [x] 6.4 Tile ring (red for a failed launch) and a reason strip with waited time and **Mark seen**, outside `.terminal-body`
- [x] 6.5 A single arrival pulse on the tile ring, off under `prefers-reduced-motion`
- [x] 6.6 Project groups show separate status items, including `N waiting for you`, from structured counts
- [x] 6.7 Tests for queue order, the shortcut, waited time, and project status items (`tests/canvas-view.test.mjs`)
- [x] 6.8 README and CHANGELOG updated for the queue

Not built, and removed from this change's spec delta (candidates for a later change): Nodes panel markers, the `(N)` document title prefix, and desktop window-level attention requests.
