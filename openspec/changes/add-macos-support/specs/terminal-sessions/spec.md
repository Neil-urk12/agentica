## MODIFIED Requirements

### Requirement: Explicit platform support

Session capabilities SHALL report the actual host platform, executable availability, and supported launch status. Native sessions SHALL be supported on Linux, Windows, and macOS on Apple Silicon, in both desktop and detached local-browser modes. On macOS, Stop and Restart SHALL meet the same owned-job cleanup guarantees as on Linux. On other platforms Start SHALL be unavailable with an explanatory reason that names the supported platforms, while existing manual canvas features remain usable. Support documentation SHALL identify the launch modes and executable versions actually exercised.

#### Scenario: Unsupported session platform

- **WHEN** the application runs on a platform outside this slice's support envelope
- **THEN** project references and manual canvas content remain usable and session Start explains why it is unavailable

#### Scenario: Start a shell on macOS

- **WHEN** the user starts a shell tile on macOS
- **THEN** the session launches the account's login shell (for example `/bin/zsh`) in the project directory as an interactive terminal
- **AND** session capabilities report the platform as `macos` with Start available

#### Scenario: Stop a macOS shell with a background job

- **WHEN** the user chooses Stop for a macOS shell running an ordinary background job started with `&`
- **THEN** the shell and that job terminate and are reaped before the tile reports cleanup complete
