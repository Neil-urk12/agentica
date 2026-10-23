## MODIFIED Requirements

### Requirement: Plain-language labels limited to received signals

Attention labels SHALL use plain language and describe only the received signal:

- bell: `Rang the bell`, with an accessible explanation that programs ring the terminal bell to ask for attention and Agentica does not know why;
- OSC 9 notification: the program's own message as the headline, with a `Notification from <source>` caption;
- exit: `Exited with code <n>` or `Exited by signal <name>`;
- failure: `Couldn't start`, with the reported error as detail.

The source SHALL be `Terminal` for shell tiles. For CLI-agent tiles it SHALL be the tile's agent label (the built-in label or the custom agent's label), or `Agent` when a custom agent is not configured on this machine. The source MAY prefix the bell label (for example `Claude Code rang the bell`). Labels SHALL NOT state or imply an approval request, turn completion, task success, task failure, or agent activity, and SHALL NOT be derived by interpreting notification text. Notification text and custom agent labels SHALL be rendered as inert plain text.

#### Scenario: Bell from a terminal tile

- **WHEN** `cargo test` in a shell tile emits a bell
- **THEN** the tile is labeled `Rang the bell` with its explanation available and is not described as agent activity

#### Scenario: Codex notification text mentions approval

- **WHEN** Codex sends an OSC 9 notification whose text says an approval is requested
- **THEN** the UI shows that text verbatim as the headline with the caption `Notification from Codex`
- **AND** no approval state is recorded or displayed

#### Scenario: Notification from a custom agent

- **WHEN** a custom agent labeled `<b>Aider</b>` emits an OSC 9 notification
- **THEN** the caption reads `Notification from <b>Aider</b>` as literal text with no markup rendered
