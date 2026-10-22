# terminal-sessions Specification

## Purpose

TBD - created by archiving change add-project-session-groups. Update Purpose after archive.

## Requirements

### Requirement: Explicit shell session launch

The system SHALL provide a shell tile within a project group and SHALL launch its interactive shell only on explicit Start. The backend SHALL derive its initial working directory from the saved group association, revalidate that directory, and resolve a usable user shell with a visible `/bin/sh` fallback when necessary. Persisting or restoring a tile SHALL NOT start a process. Session launch SHALL run with the local user's permissions and SHALL NOT claim project-directory isolation.

#### Scenario: Start a project shell

- **WHEN** the user starts a shell tile in a valid project group on a supported host
- **THEN** the shell opens in a PTY with the project's directory as its initial working directory
- **AND** the tile identifies its shell, project, and running process state

#### Scenario: Directory disappears before launch

- **WHEN** the project's directory becomes unavailable after opening but before Start
- **THEN** launch fails visibly without starting in a fallback working directory

### Requirement: Native interactive terminal behavior

The terminal SHALL support interactive input, ordered byte-safe output, ANSI cursor/color behavior, full-screen terminal applications, bounded scrollback, text selection, explicit clipboard paste, and foreground interruption through Ctrl+C. Resizing a visible tile SHALL update the PTY's valid row/column dimensions using its logical content size. Canvas zoom SHALL NOT independently resize the PTY. Terminal output SHALL NOT execute application commands, silently write the clipboard, or activate links without explicit user action.

#### Scenario: Interact and resize

- **WHEN** the user types into a shell, runs an interactive terminal application, and resizes its tile
- **THEN** the application receives the keystrokes and updated terminal dimensions and renders in the tile
- **AND** zooming the canvas alone preserves those terminal dimensions

#### Scenario: Interrupt a foreground command

- **WHEN** the user presses Ctrl+C while a foreground command owns terminal input
- **THEN** the terminal forwards the interruption to that command without triggering a canvas action
- **AND** the shell remains available if the command exits back to it

### Requirement: Terminal focus and canvas gesture separation

Tile headers SHALL provide dragging and lifecycle controls; terminal bodies SHALL own their focused keyboard, selection, and scroll interaction. Characters, arrows, Tab, Escape, and Ctrl+C intended for the terminal SHALL NOT invoke canvas tools or navigation. Users SHALL have a discoverable keyboard route out of terminal focus back to the header, with visible focus and labeled controls in both themes.

#### Scenario: Type and scroll in a terminal

- **WHEN** the terminal body is focused and the user types a canvas tool shortcut or scrolls its history
- **THEN** the terminal receives that interaction without switching canvas tools, dragging a node, or panning the canvas

#### Scenario: Leave terminal focus with a keyboard

- **WHEN** the user invokes the documented leave-terminal-focus action
- **THEN** focus moves to the tile header and keyboard navigation reaches Start, Stop, and Restart as applicable

### Requirement: Unique backend-owned session lifecycle

A backend supervisor SHALL own sessions outside the serialized database command lock. Each launch SHALL receive a fresh session identity tied to its backend instance, workspace, canvas, and tile. At most one live session SHALL exist per tile. The system SHALL expose stopped, starting, running, stopping, exited, and failed states, with exit details or actionable errors when available. Duplicate or retried starts SHALL NOT create duplicate processes. Input and lifecycle requests SHALL be bound to the named session identity.

#### Scenario: Start reply is lost

- **WHEN** a start succeeds but its reply is lost and the client reconciles or retries that start
- **THEN** it discovers the existing session rather than launching a second process

#### Scenario: Delayed input after restart

- **WHEN** an input message for an old session arrives after the tile has restarted
- **THEN** it is rejected and never delivered to the replacement session

#### Scenario: Two attachments request control

- **WHEN** a second frontend tries to control an already attached session
- **THEN** the system reports that the session is in use and does not accept duplicate input or conflicting resize ownership

### Requirement: Stop and restart owned processes

Stop SHALL terminate and reap the session launcher and its owned ordinary foreground/background jobs, escalating after a bounded graceful wait if needed. Stop SHALL remain available during high output or subscriber backpressure. Restart SHALL complete cleanup before starting a replacement. Failed launch SHALL release partial resources and allow a manual retry. Cleanup failures SHALL remain visible and SHALL NOT be reported as successful termination. Deliberately daemonized processes are outside session ownership and SHALL be described as such.

#### Scenario: Stop a shell with a background job

- **WHEN** the user chooses Stop for a shell with an ordinary background child
- **THEN** the shell and owned job terminate and are reaped before the tile reports cleanup complete

#### Scenario: Restart while termination is slow

- **WHEN** the user chooses Restart for a process that does not exit during the graceful interval
- **THEN** forced cleanup completes before a replacement is launched
- **AND** a cleanup failure prevents replacement launch and remains actionable

### Requirement: Bounded and responsive output transport

Desktop and detached modes SHALL provide ordered session streaming independently of database RPC. The implementation SHALL enforce named finite limits for live sessions, input/output frames, pending acknowledgements, retained output, and renderer scrollback. Initial limits SHALL be 8 live sessions per backend, 16 KiB input/output payloads, 256 KiB unacknowledged output per subscriber, 1 MiB retained output per session, and 2,000 renderer scrollback lines. Output backpressure SHALL follow renderer consumption, and terminal status SHALL remain available independently of evicted output. Resource-limit failures SHALL preserve existing sessions and canvas data.

#### Scenario: Flood output while saving a note

- **WHEN** a terminal produces output faster than the renderer consumes while a note is saved
- **THEN** queues and retained output remain within their declared limits, Stop remains responsive, and the note save can complete
- **AND** output is not inserted into canvas autosave or conversation records

#### Scenario: Live-session limit reached

- **WHEN** the user starts a ninth session while eight are live
- **THEN** launch is rejected with a resource-limit message and the existing sessions remain usable

### Requirement: Authenticated local session access

Detached streaming SHALL enforce the existing loopback host/origin policy and authenticate using the current backend connection key before revealing or controlling any session. Credentials SHALL NOT be put in URLs or persistent browser storage. All host adapters SHALL validate operation size, dimensions, cursors, session ownership, and supported messages. Input control SHALL belong to one attachment at a time; disconnected or superseded attachments SHALL lose control.

#### Scenario: Unauthorized streaming connection

- **WHEN** an unexpected-origin client or a client without the current connection key attempts session access
- **THEN** access is rejected without disclosing terminal data, listing sessions, launching processes, or accepting input

#### Scenario: Malformed session message

- **WHEN** a client sends an oversized input, invalid dimensions, or a session ID for an unrelated tile
- **THEN** the request is rejected without affecting the target process or database

### Requirement: Reconnection and backend lifetime

Changing canvases, navigating workspaces, collapsing groups, or losing a frontend connection SHALL NOT itself stop a session. A frontend returning during the same backend lifetime SHALL query and reattach to existing sessions without relaunching or replaying input. Output replay SHALL be bounded; unavailable history SHALL be explicitly identified, and the renderer SHALL reset before resuming instead of displaying an arbitrary ANSI tail as a complete screen. The UI SHALL provide a redraw action. Orderly backend shutdown SHALL stop and reap owned sessions; closing a desktop app SHALL trigger this shutdown, while closing a browser tab SHALL only detach. Backend restart SHALL restore saved tiles as stopped and SHALL NOT adopt PIDs or launch commands automatically.

#### Scenario: Browser refresh with a running shell

- **WHEN** the browser refreshes and authenticates again while its backend remains alive
- **THEN** it reattaches to the same shell session and can resume input
- **AND** no shell is duplicated and no prior keystroke is replayed

#### Scenario: Reconnect after retained output was evicted

- **WHEN** requested output is outside the retained history window
- **THEN** the UI reports the history gap, resets presentation, and exposes redraw while retaining process controls
- **AND** it does not claim that a complete previous full-screen display was restored

#### Scenario: Backend stops and restarts

- **WHEN** the backend shuts down orderly and a new backend later opens the canvas
- **THEN** the prior owned sessions were stopped and the saved tiles offer explicit Start controls
- **AND** neither backend attempts automatic session resurrection

### Requirement: Explicit platform support

Session capabilities SHALL report the actual host platform, executable availability, and supported launch status. This change SHALL support Linux in both desktop and detached local-browser modes. On other platforms Start SHALL be unavailable with an explanatory reason while existing manual canvas features remain usable. Support documentation SHALL identify the launch modes and executable versions actually exercised.

#### Scenario: Unsupported session platform

- **WHEN** the application runs on a platform outside this slice's support envelope
- **THEN** project references and manual canvas content remain usable and session Start explains why it is unavailable
