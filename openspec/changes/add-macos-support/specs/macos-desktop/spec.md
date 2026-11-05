## Purpose

Defines how Agentica is packaged, launched, and installed on macOS so the desktop
app finds the user's tools, can use the microphone, and can be installed without
an Apple Developer ID.

## ADDED Requirements

### Requirement: Apple Silicon release artifacts

Each tagged release SHALL publish a macOS disk image containing the Agentica desktop app for Apple Silicon (arm64), and a browser-mode backend executable for the same architecture, alongside the existing Linux and Windows artifacts. Intel (x86_64) Macs SHALL NOT be offered a macOS artifact. Release notes and installation documentation SHALL state that only Apple Silicon is supported.

#### Scenario: Install from a release on Apple Silicon

- **WHEN** a user downloads the macOS disk image from a release on an Apple Silicon Mac and copies Agentica to Applications
- **THEN** the app launches after the documented Gatekeeper approval and opens the workspace home

#### Scenario: Release assets for macOS

- **WHEN** a version tag publishes a release
- **THEN** the release contains a macOS arm64 disk image and a macOS arm64 backend executable whose names identify the version, platform, and architecture

### Requirement: Login-shell launch environment

When the macOS desktop app starts, it SHALL adopt the `PATH` reported by the user's login shell, so that executables installed in user or package-manager directories are found the same way a Terminal window finds them. Only `PATH` SHALL be taken from the login shell. The lookup SHALL be bounded in time and SHALL NOT read from or wait on user input. If the lookup fails, times out, or returns an empty or non-absolute `PATH`, the app SHALL keep its inherited `PATH` and continue starting. The detached browser-mode backend SHALL keep the environment it was started with.

#### Scenario: Agent installed with Homebrew is detected from Finder

- **WHEN** `claude` is installed in `/opt/homebrew/bin`, which the user's login shell adds to `PATH`, and Agentica is opened from Finder or the Dock
- **THEN** Claude Code is reported as an available agent

#### Scenario: Login shell does not answer

- **WHEN** the user's login shell hangs or exits with an error during startup
- **THEN** the app opens within the lookup bound using its inherited `PATH`
- **AND** agents not found on that `PATH` report the installation or backend `PATH` issue

### Requirement: Microphone access declaration

The macOS app SHALL declare a microphone usage description so that the first voice-input attempt shows the system microphone permission prompt naming Agentica. A denied or revoked permission SHALL leave voice input unavailable with an explanation and SHALL NOT affect other features.

#### Scenario: First dictation on macOS

- **WHEN** the user starts dictation for the first time in the macOS app
- **THEN** macOS asks whether Agentica may use the microphone, and dictation records after the user allows it

#### Scenario: Microphone permission denied

- **WHEN** the user denies microphone access
- **THEN** dictation explains that the microphone is unavailable and the rest of the app keeps working

### Requirement: Documented unsigned installation

macOS release builds SHALL be ad-hoc signed and SHALL NOT be presented as notarized or as signed by an identified developer. Installation documentation SHALL explain how to allow the app through Gatekeeper per app (System Settings → Privacy & Security → Open Anyway) and how to remove the download quarantine from the backend executable. Documentation SHALL NOT instruct users to disable Gatekeeper system-wide.

#### Scenario: First launch is blocked by Gatekeeper

- **WHEN** a user opens the downloaded app for the first time and macOS blocks it as from an unidentified developer
- **THEN** the installation documentation gives the per-app steps to allow it, and following them launches the app
