# Agentica

An infinite canvas for working with coding agents. Put notes, diagrams, project
folders, terminals, and CLI agents side by side, ask a model to sketch on the
canvas, and review every change it proposes before it lands.

Agentica runs locally as a desktop app (Tauri) or in your browser against a local
backend. There is no Agentica account or server; you bring your own model
provider.

<!-- Demo video and screenshots go here. -->

## Features

| Feature                                                                                                                                                               | Status                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Canvas with text, shapes, connectors, pan/zoom, and autosave                                                                                                          | Implemented                                      |
| [Canvas files](docs/user-guide.md#canvas-files): images, PDFs, Word documents, and text files copied into the workspace                                               | Implemented                                      |
| [Canvas conversation](docs/user-guide.md#canvas-conversation) with OpenRouter or any OpenAI-compatible provider; model edits arrive as proposals you apply or discard | Implemented                                      |
| [MCP tools](docs/user-guide.md#tools-from-mcp-servers) (local stdio, read-only) for the canvas agent                                                                  | Validated in browser mode on Linux               |
| [Project groups](docs/user-guide.md#projects-and-native-sessions) with terminal and Codex CLI tiles                                                                   | Validated on Linux; other OSes not yet supported |
| [Session attention](docs/user-guide.md#session-attention): bell, OSC 9, and exit signals with a waiting queue                                                         | Validated on Linux                               |
| [Changes review](docs/user-guide.md#changes-review): Git diffs with feedback pasted into an agent                                                                     | Validated in browser mode on Linux               |
| [Canvas tasks](docs/user-guide.md#canvas-tasks) assigned and sent to agent tiles                                                                                      | Implemented                                      |
| [Voice input](docs/user-guide.md#dictate-a-prompt): dictate prompts, transcribed on this machine by a local Whisper model                                             | Implemented; not yet validated                   |
| [Coding agents](docs/user-guide.md#coding-agents) beyond Codex (Claude Code, OpenCode, Crush, pi, and more) found on `PATH`, plus custom agents                       | Implemented; not yet validated                   |
| [Installers](docs/running.md#installers) for Linux (AppImage, deb, rpm) and Windows, published as GitLab Releases                                                     | Implemented; not yet validated                   |
| Remote MCP servers, tools that change data, macOS                                                                                                                     | Planned                                          |

"Validated" means tested end to end on the stated platform; see
[validation records](docs/development/README.md#validation-records).

## Quick start

Prebuilt installers are on the
[releases page](https://gitlab.com/Neil-urk12/agentica/-/releases). To build from
source you need Node.js 24, pnpm 11.6.0, stable Rust, and the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
pnpm install --frozen-lockfile
pnpm dev
```

This opens the desktop app. To use a browser instead, run `pnpm dev:backend` and
`pnpm dev:web` in two terminals, open `http://127.0.0.1:1420`, and paste the
connection key the backend prints. [Running Agentica](docs/running.md) covers
release builds and every other mode.

## Architecture

```text
Svelte UI ──► Tauri host (in-process)  ─┐
         └──► Axum backend (localhost) ─┴─► Rust runtime ─► SQLite, PTY sessions, Git, MCP
```

One Svelte UI and one Rust runtime, with two ways to connect them. The runtime
owns all storage and processes; the UI validates every message against shared
schemas. See [ARCHITECTURE.md](ARCHITECTURE.md) for components, trust
boundaries, and design choices.

## Documentation

| Document                                        | Contents                                      |
| ----------------------------------------------- | --------------------------------------------- |
| [User guide](docs/user-guide.md)                | How each feature works                        |
| [Running Agentica](docs/running.md)             | Launch modes, builds, connecting the browser  |
| [Architecture](ARCHITECTURE.md)                 | Components, request flow, trust boundaries    |
| [Decision records](docs/architecture/README.md) | Why the main design choices were made         |
| [Development](docs/development/README.md)       | Tests, protocol, storage, validation records  |
| [Contributing](CONTRIBUTING.md)                 | Workflow, checks, commits, pull requests      |
| [Changelog](CHANGELOG.md)                       | What changed and why                          |
| [Specs](openspec/)                              | OpenSpec change proposals, designs, and tasks |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](.github/CODE_OF_CONDUCT.md). Report security issues privately
as described in the [security policy](.github/SECURITY.md).

## Acknowledgements

Interaction ideas come from [Dim0](https://github.com/vcmf/dim0) (editable
artifacts), [ccanvas](https://github.com/DevoidSloth/ccanvas) (spatial
coding-agent workflows), and [tldraw](https://github.com/tldraw/tldraw) (canvas
interaction). Bundled third-party code is listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

[MIT](LICENSE)
