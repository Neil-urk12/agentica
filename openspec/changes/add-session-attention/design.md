## Context

Shell and Codex tiles run in backend-owned PTY sessions (`sessions.rs`, `sessions/process.rs`). One output thread per session reads PTY bytes and pushes them into `Output` under the supervisor lock. Each subscription event (`SessionService::event`) carries both the current `SessionStatus` and pending output. The frontend `SessionManager` stays attached to every live tile on the current canvas, mounted or not, so status already reaches the UI for off-viewport and collapsed tiles.

Process state is authoritative, but it cannot tell users that an unwatched session wants them. The `cli-agent-tiles` spec forbids inferring task state from output text or silence. Codex can opt in to emitting terminal notifications itself. From Codex source (`codex-rs/tui/src/notifications`): `notification_method = auto` selects OSC 9 only for detected Ghostty, iTerm2, Kitty, Warp, or WezTerm and otherwise selects BEL. OSC 9 is written as `ESC ] 9 ; <message> BEL`. Agentica sets `TERM=xterm-256color` and inherits the remaining environment, so `auto` depends on the terminal that launched the backend. The documented setup therefore pins `osc9`.

## Goals / Non-Goals

**Goals:**

- Detect program-declared signals (BEL, OSC 9) and unseen exits in the backend, independent of renderer lifetime.
- Keep one coalescing attention latch per session. Raising is gated on terminal focus; clearing happens only on focus or Dismiss.
- Let users notice, jump to, and clear attention for tiles on the current canvas.
- Label only what was received.

**Non-Goals:**

- Attention for other canvases or workspaces, OS desktop notifications, sounds, and off-screen edge pointers.
- Persisting attention across backend restart (sessions do not survive restart).
- Reading or writing Codex configuration, adding launch flags or environment overrides, using Codex hooks or `notify`, or using app-server/JSON protocols.
- Any approval, turn, or task state, and managed execution.
- Setting `TERM_PROGRAM` or otherwise changing the inherited launch environment.

## Decisions

### Scan in the backend output thread

Run a small VT-style escape-sequence state machine on each chunk inside the existing `with_session` call that pushes output, and store the scanner state on `Session`.

- Alternative: xterm.js `onBell` / `registerOscHandler` in the renderer. Rejected because renderers are disposed when the canvas changes and lost on browser refresh, while sessions keep running. Signals would be missed in exactly the cases that matter.
- Alternative: scan retained `Output` frames lazily. Rejected because eviction would lose signals and the scanner would need to re-parse.

Scanner states follow the VT500 parser model, reduced to what matters here:

```
Ground ──ESC──▶ Escape ──]──▶ OscParam ──;──▶ OscPayload ──BEL / ESC \──▶ emit? ▶ Ground
   │              │──P X ^ _──▶ String (ignored) ──ESC \──▶ Ground
   │              │──[──▶ Csi ──final byte──▶ Ground
   │              └──other──▶ Ground
   └──BEL──▶ bell signal
CAN/SUB in any escape state ▶ Ground. ESC inside a string ▶ StringEsc.
In an OSC parameter or payload, a non-`\` byte after ESC aborts OSC and is processed in Escape state.
Ignored DCS/APC/PM/SOS strings remain ignored until ESC \ or CAN/SUB.
8-bit C1 bytes are treated as ordinary text (UTF-8 mode).
```

- The OSC parameter is collected as at most a few digits. The payload is retained only for OSC 9 and capped at 1 KiB before decoding. Overflow is discarded, but the scanner still waits for the terminator.
- OSC 9 payloads matching `^[0-9]+;` (ConEmu subcommands such as `4;` progress and `9;` cwd) are ignored.
- The payload is decoded as lossy UTF-8, control characters are stripped, and it is truncated to 256 characters.
- BEL in Escape or CSI raises a bell signal without changing parser state. BEL terminating OSC ends that sequence without raising a bell; BEL inside ignored DCS/APC/PM/SOS strings is ignored.

### Latch on `SessionStatus`

```
attention: {
  raised: bool,
  count: u32 (saturating),
  sequence: u64,          // increments on every accepted signal
  kind: bell | notification | exited | failed | null,
  at: timestamp | null,
  message: string | null  // OSC 9 only, ≤256 chars
}
```

Embedding the latch in `SessionStatus` reuses the existing status delivery path and the `list`/`status` commands, so reconnect and refresh need no new channel. A new session identity starts with a clear latch, which covers Restart. Coalescing keeps status payloads constant-size under bell storms.

- Alternative: a separate attention event stream. Rejected because it adds a second ordering and identity problem for no benefit at this scale.

### Focus reporting and clearing commands

Add two session commands:

- `Focus { owner, sessionId, attachmentId, focused }` is accepted only from the controlling attachment. Detach, supersession, or a lost connection resets focus to false. When focus becomes true, the latch is cleared through the current sequence.
- `ClearAttention { owner, sessionId, sequence }` is bound to session identity. It clears only if `sequence >= attention.sequence`, so a signal arriving during dismissal survives. It is idempotent and needs no attachment, so Dismiss works even while a renderer is reconnecting.

The frontend treats a terminal as focused when its xterm textarea has focus and `document.hasFocus()` is true. Focus is reported on focus and blur and on window focus changes. Ctrl+Shift+Escape moves focus to the header, which blurs the terminal and reports unfocused.

- Alternative: frontend-only focus gating (drop the indicator client-side). Rejected because the backend would still latch, and a refresh would surface stale attention for signals the user saw while typing.
- Alternative: Codex's default `notification_condition = "unfocused"` with Agentica forwarding DEC 1004 focus reports faithfully. Deferred. Agentica would have to synthesize `CSI O` on detach, and that only fixes Codex, not BEL from other programs. With `always`, Agentica's own focus gating suppresses duplicates.

### Exit attention

When the process monitor transitions to `exited` or `failed`, the latch is raised only if the session's `stop` flag was not set (no user Stop, Restart, or removal) and the terminal is not focused. The kind is `exited` with code/signal from status, or `failed` with the status error.

### UI surfaces

The first implementation (a `●N` button in the zoom stack, a `● Bell` line in the tile header, and no Nodes-panel marker) tested poorly: a user did not notice it, and did not know what "Bell" meant. The causes were no visual change (same button style, always visible at zero, same text color as other notices), jargon labels, and no marker where users actually look. The redesign fixes all three.

```
 Top bar      Agentica  ws / canvas          [🔔 2 sessions ▾]   Open project …
                                              └ appears only when >0, --warn

 Tile        ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓  2px --warn outline
             ┃🔔 Rang the bell · 2×   just now    [Dismiss] ┃  --warn-soft strip
             ┃>_ Terminal  beta   Running   Stop Restart …  ┃

 Nodes panel  ≡ Nodes            4   🔔 2
              [▣]  beta                 🔔
              [>_] Terminal · beta      🔔 [Go]
                   Rang the bell · 2m ago
```

- Color: use the existing `--warn`, `--warn-soft`, and `--warn-line` tokens in both themes. Light-mode accent is indigo and dark-mode accent is amber, so the accent can't serve as a consistent attention color. Strip text uses `--ink` on `--warn-soft` for 4.5:1. Outline and icon use `--warn` for 3:1 non-text contrast. Every surface also has a bell icon and text, so color is never the only cue.
- Absent at zero: the pill, Nodes-panel markers, outline, and strip render only when raised. The `●N` button in `CanvasNavigation` is removed, and its list moves to the pill's dropdown. The polite live region stays, near the pill.
- Nodes panel: `NodeDrawer` receives attention entries keyed by tile ID. An affected row gets a tinted background, a bell on its icon, and the signal label as its subtitle. Its project row gets a bell, and the header gets a count. Row selection keeps its current select-only behavior, and a separate Go button on the row navigates. That way attention doesn't silently change what clicking a row does.
- Go: unchanged. It reuses `focusObject` (`fitViewport` + `usableArea`), targets the parent group when the tile is hidden, and changes only the viewport.

Alternative considered: edge pointers at the viewport border for off-screen tiles. Deferred: they need per-pan/zoom projection and clamping, while the pill and Nodes panel already cover off-screen tiles. Revisit if users still miss them.

### Arrival cue and performance

- Pulse a `::after` overlay on the tile outline, and the pill, using only `opacity` and `transform` (compositor-only, with no box-shadow or layout animation). It runs once for 600 ms and does not loop.
- Trigger the pulse only when `attention.sequence` increases for a tile, throttled to once per tile per 5 s, and keep the last-pulse time in `SessionManager`. Status heartbeats that leave the sequence unchanged do not replay it.
- Under `@media (prefers-reduced-motion: reduce)`, extend the existing block in `app.css` to remove the animation. Surfaces still appear statically.
- Don't re-render the terminal: the strip and outline sit outside `.terminal-body`, and the tile height doesn't change, so neither PTY resize nor xterm re-fit happens. The strip replaces the current header notice row and gets a fixed height.
- Derive attention entries once per `sessionRevision`, in the same place as today, and pass them to the pill, `NodeDrawer`, and tiles instead of filtering per component.

### Window-level attention

- Document title: set `document.title` to `(N) Agentica` while N > 0, and restore it on zero. Update it only when N changes. Desktop mode currently has no `set-title` permission and its window title comes from config, so the title count applies to browser tabs; desktop relies on the request below.
- Desktop: when a sequence increases while `document.hasFocus()` is false, call `getCurrentWindow().requestUserAttention(UserAttentionType.Informational)` once, and call `requestUserAttention(null)` on window focus. This needs `core:window:allow-request-user-attention` added to `capabilities/main.json` and its description. On Linux the effect depends on the window manager's urgency-hint support.
- No OS notifications, no sounds, no focus stealing, and no notification text in any window-level surface.

### Labels

| Kind         | Headline                                               | Detail / caption                                                                                                       |
| ------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| bell         | `Rang the bell` (`Codex rang the bell` in Codex tiles) | Tooltip and accessible description: "Programs ring the terminal bell to ask for attention. Agentica doesn't know why." |
| notification | the program's text, verbatim                           | `Notification from Codex` / `Notification from Terminal`                                                               |
| exited       | `Exited with code 3` / `Exited by signal SIGTERM`      | —                                                                                                                      |
| failed       | `Couldn't start`                                       | the reported error (`failed` is raised only by launch failure today)                                                   |

Naming the source program is allowed because it describes where the signal came from, not task state. Labels never interpret notification text.

### Codex setup guidance

Codex tiles show expandable setup guidance locally in both desktop and browser modes:

```toml
[tui]
notifications = true
notification_method = "osc9"
notification_condition = "always"
```

The README states that this is a global Codex setting that also affects Codex in other terminals.

## Risks / Trade-offs

- [Shell prompts emit OSC title sequences ending in BEL on every prompt] → Consume OSC-terminating BEL without raising a bell. Report BEL in Ground, Escape, and CSI states. Cover title and cwd sequences, including split chunks.
- [Some programs or shell configs ring bells frequently (failed completion, `less` at end of file)] → Focus gating removes the common in-terminal case. Coalescing prevents spam. Residual bells while unfocused are accurate, if noisy.
- [`notification_condition = "always"` is global Codex config and may cause notifications in the user's other terminals while focused] → Document the trade-off. A per-project Codex config layer may scope it, but that has not been verified and is not claimed.
- [The OSC 9 message is untrusted program text] → Strip control characters, cap length, render as plain text, and keep it out of conversation context, autosave, and storage.
- [A focus message can race with a signal] → Focus=true clears through the current sequence, so a signal raised just before focus clears on arrival. A signal after focus is suppressed. Neither path leaves stale attention.
- [Scanner bugs could corrupt output] → The scanner reads a borrowed slice and never mutates output. Pushing output is unchanged.
- [Inherited `TERM_PROGRAM` from the launching terminal can make Codex `auto` behave differently] → The documented setup pins `osc9`. Changing the inherited environment is out of scope.
- [Animation could add jank with many tiles or bell storms] → Compositor-only properties, one 600 ms run, a per-tile 5 s throttle, triggering only on sequence increases, and a reduced-motion opt-out.
- [The urgency hint is ignored by some Linux window managers] → Treat it as best-effort. The in-app pill and browser tab title are the guaranteed surfaces.
- [A warning color could be confused with errors] → Pair it with the bell icon and plain-language labels, and keep error notices in their existing style.

## Migration Plan

No storage migration. `SessionStatus` gains a field and the wire protocol gains two commands. Desktop and detached modes ship frontend and backend together, and protocol validation rejects mismatches as it does today. Rollback removes the field and commands without affecting saved canvases.

## Open Questions

- Whether a later slice should cover attention for other canvases (a workspace-wide `list` already exists by omitting `canvasId`), OS notifications, or edge pointers.
- Whether a per-project `.codex/config.toml` can scope `notification_condition`. Verify before documenting it as an option.
