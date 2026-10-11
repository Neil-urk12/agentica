# Agentica

A visual workspace operating system for your agents with infinite canvas

The repository currently contains an initial development scaffold: a Svelte canvas
shell, a Tauri desktop host with a shared Rust runtime, and a detached Axum
backend for the same UI in a local browser. Both modes support validated health
checks and visible connection failures. The shared runtime persists workspaces,
canvases, and text artifacts in SQLite with one writer per workspace; the UI
creates and reopens them, edits text and node placement, persists pan/zoom, and
autosaves changes through the runtime commands. Agent integration is planned.

## Getting started

Run all commands from the repository root.

| What you want to run                     | Prerequisites                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Frontend development or built-UI preview | Node.js 24 and pnpm 11.6.0                                                                              |
| Build the Rust backend                   | Stable Rust and Cargo; desktop libraries are not needed                                                 |
| Desktop development or builds            | Frontend tools, Rust, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) |
| An already compiled backend              | No Node, pnpm, or Rust toolchain required                                                               |
| An already compiled desktop app          | Platform runtime libraries/webview; no Node, pnpm, or Rust toolchain required                           |

Install JavaScript dependencies before using the frontend or desktop commands:

```sh
pnpm install --frozen-lockfile
```

## Running the application

| Option                                                              | How to start                                                 | What opens                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| [Desktop development](#desktop-development)                         | `pnpm dev`                                                   | Tauri window with the shared Rust runtime             |
| [Compiled desktop app](#compiled-desktop-app)                       | `pnpm build:desktop`, then run the executable                | Tauri window with the built frontend and Rust runtime |
| [Browser development](#browser-development)                         | `pnpm dev:backend` and `pnpm dev:web` in separate terminals  | Browser UI connected to an independent Axum backend   |
| [Browser with a compiled backend](#browser-with-a-compiled-backend) | Run the backend executable and start the frontend separately | Browser UI using a debug or release Rust backend      |
| [Preview the built browser UI](#preview-the-built-browser-ui)       | Run a backend and serve the built frontend with Vite preview | Local preview of the built UI                         |
| [Frontend only](#frontend-only)                                     | `pnpm dev:web`                                               | Canvas UI without a connected backend                 |

The UI implements canvas display, runtime health checks, workspace and canvas
creation and reopening, text and node placement editing, persisted pan/zoom,
and debounced autosave with recovery when saves fail. None of these options
requires Codex or an AI account. Workspaces are stored in `AGENTICA_DATA_DIR`
when set, otherwise in the OS data directory (`~/.local/share/agentica` on Linux,
`%APPDATA%\agentica` on Windows); both launch modes share it.

### Desktop development

```sh
pnpm dev
```

This builds the protocol package, starts Vite, compiles the desktop app, and opens
a Tauri window. The app calls its linked Rust runtime through Tauri commands and
connects automatically. A separate backend terminal is not needed. Closing the
window ends its backend; stop the development command with Ctrl+C when finished.

### Compiled desktop app

Build the release app with its frontend embedded:

```sh
pnpm build:desktop
```

Then launch it on your platform:

| Platform           | Command                                 |
| ------------------ | --------------------------------------- |
| Linux              | `./target/release/agentica-desktop`     |
| Windows PowerShell | `.\target\release\agentica-desktop.exe` |

The executable includes the Rust runtime. No Vite server or separate backend is
needed. Closing the app ends the runtime. This command builds an executable;
installer generation remains pending.

### Browser development

Terminal 1 — backend:

```sh
pnpm dev:backend
```

Terminal 2 — frontend:

```sh
pnpm dev:web
```

The backend command compiles and starts the Rust/Axum server. It is a convenience
alias for this direct Cargo command, which needs no Node or pnpm:

```sh
cargo run --locked -p agentica-runtime --bin agentica-backend
```

Follow [the browser connection steps](#browser-connection-and-shutdown) below.

### Browser with a compiled backend

Build the release backend:

```sh
pnpm build:backend
```

Or build it directly without Node or pnpm:

```sh
cargo build --locked --release -p agentica-runtime --bin agentica-backend
```

Launch the executable in one terminal:

| Build   | Linux                               | Windows PowerShell                      |
| ------- | ----------------------------------- | --------------------------------------- |
| Release | `./target/release/agentica-backend` | `.\target\release\agentica-backend.exe` |
| Debug   | `./target/debug/agentica-backend`   | `.\target\debug\agentica-backend.exe`   |

To produce the debug executable, use
`cargo build --locked -p agentica-runtime --bin agentica-backend`, or `pnpm build`.
Running either executable requires neither Node nor Cargo.

In another terminal, start `pnpm dev:web`, or use the built-UI preview below.
Then follow [the browser connection steps](#browser-connection-and-shutdown).

### Preview the built browser UI

Build the frontend and its protocol dependency:

```sh
pnpm --filter @agentica/desktop... build
```

Start a backend using any detached option above. In a separate terminal, serve
the built frontend on the required origin:

```sh
pnpm --filter @agentica/desktop exec vite preview --host 127.0.0.1 --port 1420 --strictPort
```

Follow [the browser connection steps](#browser-connection-and-shutdown).
This previews the built UI locally. The Rust backend currently serves RPC;
frontend asset hosting and a packaged browser distribution remain pending.

### Frontend only

```sh
pnpm dev:web
```

Open `http://127.0.0.1:1420` to work on the canvas UI. This needs no Rust toolchain
or desktop libraries. Backend health stays disconnected until you start a backend,
enter its connection key, and connect.

### Browser connection and shutdown

1. Keep the backend and frontend server running.
2. Open **`http://127.0.0.1:1420`** in your browser.
3. Copy the **Connection key** from the backend terminal into the UI's password field.
4. Select **Connect**; a successful health check shows **Backend connected**.

The backend listens on `http://127.0.0.1:1421/rpc` for API requests and does not
serve the UI. Browser access requires the exact `http://127.0.0.1:1420` origin;
`localhost`, another port, or opening the HTML directly does not satisfy that check.

Closing a browser tab leaves the backend running. Stop each server with Ctrl+C
in its terminal. A backend restart generates a new key: paste it and select
**Reconnect**. The UI reports connection failures and waits for manual reconnect.
Keys stay in memory and are never placed in URLs or browser storage.

Desktop development, browser development, and built-UI preview all use frontend
port 1420; run one of those frontend servers at a time. Only one detached backend
can bind port 1421. Compiled desktop mode does not use either server port.

See the [development guide](docs/development/README.md) for more details and the
[verification record](docs/development/verification.md) for checked platforms and
remaining limitations.

## Development checks

```sh
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm format:check
pnpm check:rust
pnpm test:rust
```

`pnpm build` builds the frontend, TypeScript protocol package, and debug Rust
backend. Stop a detached backend before running `pnpm test`, which uses port 1421.

## Repository

```text
apps/desktop/              Svelte 5, Svelte Flow, Tailwind CSS, Vite
apps/desktop/src-tauri/    Tauri 2 native host
packages/protocol/        TypeScript wire contracts and response validation
packages/agent-runtime/   Shared Rust logic and the detached Axum executable
tests/                    Browser protocol integration checks against Rust
Cargo.toml / Cargo.lock   Rust workspace and reproducible dependency versions
docs/architecture/        Component ownership and current boundaries
docs/development/         Setup, commands, and next development slice
.github/workflows/        Frontend/runtime checks and native compilation
```

Additional domain packages will be created when their implementations begin.
See the [development guide](docs/development/README.md) and
[contribution guide](CONTRIBUTING.md).

## References

The product draws on [Dim0](https://github.com/vcmf/dim0) for editable artifact
interactions, [ccanvas](https://github.com/DevoidSloth/ccanvas) for spatial
coding-agent workflows, and [tldraw](https://github.com/tldraw/tldraw) for canvas
interaction patterns. See [the reference mapping and attribution rules](PROJECT.md#15-primary-references-prior-art-and-differentiation)
in the specification.

Licensed under [MIT](LICENSE).
