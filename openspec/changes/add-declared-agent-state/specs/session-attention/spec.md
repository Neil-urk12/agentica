## ADDED Requirements

### Requirement: Reported waiting or finished state raises attention

When a session's `declaredState` (defined by `declared-agent-state`) changes to `waiting` or `finished`, the backend SHALL record a `declared` attention signal carrying that state, subject to the same focus gating, coalescing, sequence, and clearing rules as other signals. A change to `working` SHALL NOT raise or clear attention. Repeating the same reported state without a change SHALL NOT record another signal. A declared signal SHALL NOT block or enable a task send beyond the existing rule that raised attention refuses a guarded paste.

#### Scenario: Permission prompt while the user works elsewhere

- **WHEN** an unfocused Claude Code tile reports `waiting`
- **THEN** its attention is raised with a `declared` signal and it appears in the waiting queue

#### Scenario: Turn finishes while focused

- **WHEN** a focused Claude Code tile reports `finished`
- **THEN** no attention is raised, and the tile still shows the reported state

#### Scenario: Agent goes back to work

- **WHEN** a tile with raised `declared` attention reports `working`
- **THEN** its attention stays raised until the user focuses the terminal or chooses **Mark seen**

## MODIFIED Requirements

### Requirement: Backend-held attention latch

Each session status SHALL include an attention latch with raised state, signal count, latest signal kind (`bell`, `notification`, `declared`, `exited`, or `failed`), latest signal time, a bounded latest notification message when one exists, the reported state for a `declared` signal, and a monotonically increasing attention sequence. Repeated signals SHALL coalesce into the existing latch by incrementing its count and replacing its latest signal rather than queuing separate alerts. The latch SHALL belong to its session identity: renderer detach, canvas switching, group collapse, and browser refresh within one backend lifetime SHALL preserve it, and Restart SHALL start the replacement session with a clear latch. The latch SHALL NOT be persisted across backend restart. Notification messages SHALL be limited to 256 characters with control characters removed and SHALL be presented as plain text.

#### Scenario: Browser refresh preserves attention

- **WHEN** a session has raised attention and the browser refreshes and reconnects to the same backend
- **THEN** the session status still reports raised attention with its count and latest signal

#### Scenario: Bell storm

- **WHEN** a session emits hundreds of bells while unfocused
- **THEN** its latch remains a single raised indicator whose count reflects the signals, and status updates stay within existing transport limits

#### Scenario: Notification contains escape or control bytes

- **WHEN** an OSC 9 payload includes control characters or markup-like text
- **THEN** the stored message excludes control characters and the UI renders it as inert plain text

#### Scenario: Declared signal after a bell

- **WHEN** a session rings the bell and then reports `waiting` while unfocused
- **THEN** the latch count is 2 and its latest signal is `declared` with state `waiting`

### Requirement: Plain-language labels limited to received signals

Attention labels SHALL use plain language and describe only the received signal:

- bell: `Waiting for you`;
- OSC 9 notification: the program's own message, or `Sent a notification` when it is empty;
- declared state: `<agent label> reports: waiting for you` or `<agent label> reports: turn finished`;
- exit: `Stopped`, with `(exit code <n>)` or `(signal <name>)` when known;
- failure: `Failed: <error>`, or `Failed to start` when no error is reported.

Queue entries SHALL identify the tile by its name: `Terminal` for shell tiles, and for CLI-agent tiles the agent label (the built-in label or the custom agent's label), or `Agent` when a custom agent is not configured on this machine. Except for declared-state labels, which repeat the agent's own report attributed to it, labels SHALL NOT state or imply an approval request, turn completion, task success, task failure, or agent activity, and SHALL NOT be derived by interpreting notification text. No label SHALL state task success or failure. Notification text and custom agent labels SHALL be rendered as inert plain text.

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

#### Scenario: Claude Code reports a finished turn

- **WHEN** an unfocused Claude Code tile reports `finished`
- **THEN** the attention label is `Claude Code reports: turn finished` and no task is marked done
