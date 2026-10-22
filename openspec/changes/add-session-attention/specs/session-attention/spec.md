## ADDED Requirements

### Requirement: Program-declared terminal signal detection

The backend SHALL detect attention signals in each session's PTY output independently of any attached renderer. A BEL byte (0x07) in ground state SHALL count as a bell signal. A complete OSC 9 sequence SHALL count as a notification signal carrying its payload unless the payload is a ConEmu-style numeric subcommand (one or more ASCII digits followed by `;`, such as `4;` progress or `9;` working-directory reports). 8-bit C1 control bytes SHALL NOT be interpreted as escape introducers, because they occur inside UTF-8 text. A BEL or ST that terminates an OSC string SHALL NOT count as a bell. Content inside OSC, DCS, APC, PM, and SOS strings SHALL NOT produce signals except for the OSC 9 notification itself. Detection SHALL be correct across arbitrary output chunk boundaries, SHALL use bounded parser state, and SHALL NOT alter, delay, or drop the output delivered to renderers.

#### Scenario: Shell sets its window title every prompt

- **WHEN** a shell emits `ESC ] 0 ; <title> BEL` before each prompt
- **THEN** no attention signal is raised

#### Scenario: Program rings the bell

- **WHEN** a session emits a BEL byte outside any escape string
- **THEN** a bell signal is recorded for that session

#### Scenario: Codex emits an OSC 9 notification

- **WHEN** a session emits `ESC ] 9 ; Approval requested BEL`
- **THEN** a notification signal is recorded with the payload `Approval requested`
- **AND** the terminating BEL is not counted as a separate bell

#### Scenario: Progress or directory report uses OSC 9

- **WHEN** a session emits `ESC ] 9 ; 4 ; 1 ; 50 BEL` or `ESC ] 9 ; 9 ; /home/user/project ST`
- **THEN** no attention signal is raised

#### Scenario: UTF-8 text contains C1-valued bytes

- **WHEN** a session prints UTF-8 text whose encoding contains byte 0x9D or 0x90
- **THEN** the text is not treated as an OSC or DCS introducer and no signal is raised

#### Scenario: Sequence split across output chunks

- **WHEN** an OSC 9 notification or an OSC title sequence is split across two or more output reads
- **THEN** detection produces the same result as when the sequence arrives in one read

#### Scenario: Oversized escape string

- **WHEN** an OSC payload exceeds the parser's payload bound
- **THEN** parser memory stays bounded, the retained notification text is truncated to the declared limit, and the sequence's terminator is still recognized

### Requirement: Unseen exit raises attention

A session that exits or fails while its terminal is not focused SHALL raise attention with the process exit or failure as its signal. Exit or failure resulting from a user-requested Stop, Restart, or removal SHALL NOT raise attention.

#### Scenario: Process exits while user works elsewhere

- **WHEN** a session's process exits on its own while the user is focused on a different tile
- **THEN** that session's tile raises attention labeled as a process exit with available code or signal

#### Scenario: User stops a session

- **WHEN** the user chooses Stop and the process exits
- **THEN** no attention is raised for that exit

### Requirement: Backend-held attention latch

Each session status SHALL include an attention latch with raised state, signal count, latest signal kind (`bell`, `notification`, `exited`, or `failed`), latest signal time, a bounded latest notification message when one exists, and a monotonically increasing attention sequence. Repeated signals SHALL coalesce into the existing latch by incrementing its count and replacing its latest signal rather than queuing separate alerts. The latch SHALL belong to its session identity: renderer detach, canvas switching, group collapse, and browser refresh within one backend lifetime SHALL preserve it, and Restart SHALL start the replacement session with a clear latch. The latch SHALL NOT be persisted across backend restart. Notification messages SHALL be limited to 256 characters with control characters removed and SHALL be presented as plain text.

#### Scenario: Browser refresh preserves attention

- **WHEN** a session has raised attention and the browser refreshes and reconnects to the same backend
- **THEN** the session status still reports raised attention with its count and latest signal

#### Scenario: Bell storm

- **WHEN** a session emits hundreds of bells while unfocused
- **THEN** its latch remains a single raised indicator whose count reflects the signals, and status updates stay within existing transport limits

#### Scenario: Notification contains escape or control bytes

- **WHEN** an OSC 9 payload includes control characters or markup-like text
- **THEN** the stored message excludes control characters and the UI renders it as inert plain text

### Requirement: Focus-gated raising and explicit clearing

The controlling attachment SHALL report whether a session's terminal is focused. Signals received while the terminal is reported focused SHALL NOT raise attention. Focusing the terminal or choosing Dismiss SHALL clear the latch. A clear request SHALL name the session identity and the attention sequence it acknowledges and SHALL NOT clear signals received after that sequence. Navigating to a tile, selecting it, or bringing it into the viewport SHALL NOT clear attention. A detached session SHALL be treated as unfocused.

#### Scenario: Bell while typing in the terminal

- **WHEN** a zsh completion bell occurs while that shell's terminal is focused
- **THEN** no attention is raised

#### Scenario: Jump does not clear

- **WHEN** the user chooses Go for a tile with raised attention
- **THEN** the canvas navigates to the tile and its attention remains raised until the user focuses its terminal or chooses Dismiss

#### Scenario: Signal arrives during dismissal

- **WHEN** the user dismisses attention at sequence 4 while a new notification raises sequence 5
- **THEN** the latch remains raised for the sequence 5 notification

#### Scenario: Renderer is unmounted while focused

- **WHEN** a focused terminal's renderer detaches because the user switched canvases
- **THEN** later signals from that session raise attention

### Requirement: Distinct attention presentation

Raised attention SHALL use a dedicated attention color pair (the theme's warning tokens), distinct from selection, focus, and accent styling, in both themes. Attention text SHALL meet 4.5:1 contrast and attention-only graphics 3:1 against their background. Color SHALL NOT be the only cue: every attention surface SHALL also show a bell icon and text. Attention surfaces SHALL be absent, not shown as zero, when nothing needs attention.

#### Scenario: Attention is visible at reduced zoom

- **WHEN** a tile raises attention while the canvas is zoomed out so terminal text is unreadable
- **THEN** the tile is still distinguishable from tiles without attention by its outline and header strip

#### Scenario: Nothing needs attention

- **WHEN** no session tile on the current canvas has raised attention
- **THEN** no attention pill, badge, ring, or zero count is displayed

### Requirement: Attention surfaces and navigation

While any session tile on the current canvas has raised attention, the system SHALL show:

- an attention pill in the top bar, reporting the number of affected tiles and opening a list of entries (source, project, signal label, Go);
- on each affected tile, an outline in the attention color and a full-width header strip with the signal label, relative time, repeat count when greater than one, and Dismiss;
- in the Nodes panel, a marker on each affected tile row, its project row, and the panel header, with the tile row's subtitle replaced by the signal label and a Go control on the row.

A collapsed group SHALL report attention for its member tiles in its collapsed header. Go SHALL navigate using the existing navigation that accounts for unobscured canvas space, to the group when collapsed, and SHALL change only the viewport. Selecting a row or navigating SHALL NOT clear attention. Attention-count changes SHALL be announced through a polite live region without moving focus. The pill, list, Nodes-panel controls, Go, and Dismiss SHALL be keyboard-operable with accessible names and visible focus in both themes and SHALL remain reachable at a 680 by 800 CSS pixel viewport.

#### Scenario: Notice and jump from another tile

- **WHEN** the user is working in one tile and an off-viewport Codex tile emits an OSC 9 notification
- **THEN** the top-bar pill appears with a count of one and the change is announced without moving focus
- **AND** choosing Go for that entry brings the Codex tile into the usable canvas area with its attention still raised

#### Scenario: Notice from the Nodes panel

- **WHEN** the Nodes panel is open and a listed shell tile rings the bell
- **THEN** that row, its project row, and the panel header show the attention marker and the row subtitle shows the signal label
- **AND** the row's Go control navigates to the tile

#### Scenario: Attention in a collapsed group

- **WHEN** a member tile of a collapsed group raises attention
- **THEN** the collapsed group header reports it and Go navigates to the group without expanding it

#### Scenario: Keyboard-only clearing

- **WHEN** a keyboard user opens the pill's list, chooses Go, and activates the tile's Dismiss control
- **THEN** the tile's attention clears and the pill's count decreases or the pill disappears

### Requirement: Lightweight arrival cue

When a tile's attention sequence increases, its tile outline and the top-bar pill SHALL play a single brief pulse of at most 600 milliseconds, at most once per tile every 5 seconds. The pulse SHALL animate only compositor-friendly properties (opacity and transform), SHALL NOT loop, SHALL NOT cause terminal re-layout or PTY resize, and SHALL be omitted when the user prefers reduced motion. Status updates that do not increase the sequence SHALL NOT replay the cue.

#### Scenario: Bell storm does not animate continuously

- **WHEN** a tile emits hundreds of bells within a few seconds while unfocused
- **THEN** its outline pulses at most once per 5 seconds and the canvas stays responsive

#### Scenario: Reduced motion

- **WHEN** the operating system or browser requests reduced motion and a tile raises attention
- **THEN** the outline, strip, and pill appear without animation

### Requirement: Window-level attention

While attention is raised on the current canvas, the document title SHALL be prefixed with the affected-tile count in parentheses, and SHALL return to its normal title when the count reaches zero. In desktop mode, when a sequence increases while the application window is unfocused, the system SHALL request informational user attention from the window system and SHALL cancel the request when the window regains focus. The system SHALL NOT send operating-system notifications, play sounds, or steal window focus. Notification text SHALL NOT appear in the document title or window-system request.

#### Scenario: Browser tab in the background

- **WHEN** the Agentica tab is in the background and two tiles raise attention
- **THEN** the tab title reads `(2) Agentica` and returns to `Agentica` after both are cleared

#### Scenario: Desktop window behind another app

- **WHEN** the desktop window is unfocused and a tile raises attention
- **THEN** the window system's attention request is made once, without focusing the window or showing notification text

### Requirement: Plain-language labels limited to received signals

Attention labels SHALL use plain language and describe only the received signal:

- bell: `Rang the bell`, with an accessible explanation that programs ring the terminal bell to ask for attention and Agentica does not know why;
- OSC 9 notification: the program's own message as the headline, with a `Notification from <source>` caption;
- exit: `Exited with code <n>` or `Exited by signal <name>`;
- failure: `Couldn't start`, with the reported error as detail.

The source SHALL be the tile's program name (`Terminal` or `Codex`) and MAY prefix the bell label (for example `Codex rang the bell`). Labels SHALL NOT state or imply an approval request, turn completion, task success, task failure, or agent activity, and SHALL NOT be derived by interpreting notification text. Notification text SHALL be rendered as inert plain text.

#### Scenario: Bell from a terminal tile

- **WHEN** `cargo test` in a shell tile emits a bell
- **THEN** the tile is labeled `Rang the bell` with its explanation available and is not described as agent activity

#### Scenario: Codex notification text mentions approval

- **WHEN** Codex sends an OSC 9 notification whose text says an approval is requested
- **THEN** the UI shows that text verbatim as the headline with the caption `Notification from Codex`
- **AND** no approval state is recorded or displayed

### Requirement: Attention data stays out of canvas content

Attention signals, counts, and notification messages SHALL NOT be added to canvas conversation context, autosaved canvas documents, workspace storage, or proposal operations.

#### Scenario: Submit a canvas conversation while attention is raised

- **WHEN** the user submits a canvas conversation while a session shows a notification message
- **THEN** the request context contains no attention data or notification text
