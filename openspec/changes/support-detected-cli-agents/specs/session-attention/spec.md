## MODIFIED Requirements

### Requirement: Plain-language labels limited to received signals

Attention labels SHALL use plain language and describe only the received signal:

- bell: `Waiting for you`;
- OSC 9 notification: the program's own message, or `Sent a notification` when it is empty;
- exit: `Stopped`, with `(exit code <n>)` or `(signal <name>)` when known;
- failure: `Failed: <error>`, or `Failed to start` when no error is reported.

Queue entries SHALL identify the tile by its name: `Terminal` for shell tiles, and for CLI-agent tiles the agent label (the built-in label or the custom agent's label), or `Agent` when a custom agent is not configured on this machine. Labels SHALL NOT state or imply an approval request, turn completion, task success, task failure, or agent activity, and SHALL NOT be derived by interpreting notification text. Notification text and custom agent labels SHALL be rendered as inert plain text.

#### Scenario: Bell from a terminal tile

- **WHEN** `cargo test` in a shell tile emits a bell
- **THEN** the tile is labeled `Waiting for you` and is not described as agent activity

#### Scenario: Codex notification text mentions approval

- **WHEN** Codex sends an OSC 9 notification whose text says an approval is requested
- **THEN** the UI shows that text verbatim as the label, and the queue entry names the tile `Codex`
- **AND** no approval state is recorded or displayed

#### Scenario: Notification from a custom agent

- **WHEN** a custom agent labeled `<b>Aider</b>` emits an OSC 9 notification
- **THEN** its queue entry names the tile `<b>Aider</b>` as literal text with no markup rendered
