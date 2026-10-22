## Why

With several shell and Codex tiles on a canvas, users cannot tell when a session they are not watching needs them. A Codex approval prompt or a finished turn stays unnoticed until the user happens to look at that tile, and the header only says `running`. Users need a trustworthy signal that something happened elsewhere, without Agentica inventing agent or task state.

## What Changes

- The backend scans each session's PTY output for program-declared terminal signals (BEL and OSC 9 notifications). OSC string terminators, OSC 9 progress subcommands, and other escape-string contents do not count as signals.
- An unseen process exit or failure also raises attention.
- Each live session holds an attention latch in its backend status: whether attention is raised, a signal count, the latest signal kind and time, and a bounded verbatim OSC 9 message when one exists. The latch survives renderer detach, canvas switches, and browser refresh within the same backend lifetime.
- Signals arriving while that tile's terminal is focused do not raise attention. Focusing the terminal or choosing Dismiss clears it. Jumping to the tile does not.
- Attention uses its own warning color pair, a bell icon, and text, and is absent when nothing needs attention. Surfaces: a top-bar pill with a jump list, a tile outline and full-width header strip with Dismiss, and markers plus Go controls in the Nodes panel. Collapsed groups report member attention. Changes are announced without moving focus.
- New attention plays one short, throttled pulse that is skipped under reduced motion. The document title shows the count, and the desktop app requests window-system attention when unfocused; no OS notifications or sounds.
- Labels use plain language for what was received ("Rang the bell", the program's own notification text with "Notification from Codex", "Exited with code 3", "Couldn't start") and name the source program. Agentica never classifies a notification as an approval, turn completion, or task result.
- Shell and Codex tiles share one mechanism. Codex tiles show a static hint linking to documented, opt-in Codex setup (`tui.notifications`, `notification_method = "osc9"`, `notification_condition = "always"`). Agentica does not read or modify Codex configuration and passes no additional flags.

## Capabilities

### New Capabilities

- `session-attention`: Backend detection of program-declared terminal signals and unseen exits, the per-session attention latch, focus-gated raising, explicit clearing, the canvas-level attention list with jump navigation, and labeling limited to what the signal establishes.

### Modified Capabilities

- `cli-agent-tiles`: The observable-status requirement now allows program-declared terminal notifications to raise attention, while still forbidding inferred thinking, approval, completion, or failure task state. Codex tiles document the opt-in notification setup.

## Impact

- Rust runtime: an escape-sequence signal scanner on the session output path, with an attention latch on `SessionStatus` and its wire/status updates. A clear-attention session command is bound to session identity.
- Protocol: `SessionStatus` attention fields and the new command, with validation in TypeScript contracts.
- Frontend: attention styling tokens, a top-bar pill and jump list (replacing the canvas-navigation count button), tile outline and header strip with Dismiss, Nodes panel markers and Go, a throttled arrival pulse, document-title count, focus reporting to clear and gate attention, and accessible announcements.
- Desktop host: the `core:window:allow-request-user-attention` capability for the window-system attention request.
- Documentation: README guidance for Codex notification setup and what indicators do and do not mean. Changelog rationale.
- Out of scope: attention for tiles on other canvases or workspaces, OS desktop notifications and sounds, off-screen edge pointers (revisit if users still miss off-screen tiles), persistence across backend restart, Codex hooks or structured protocols, and managed execution.
