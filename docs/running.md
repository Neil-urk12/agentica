# Running Agentica

Agentica runs as a desktop app or in a local browser. Both use the same Rust
runtime and the same data, so you can switch between them. No mode needs Codex or
an AI account.

Run every command from the repository root.

## Prerequisites

| To                                  | You need                                                                                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Work on or preview the frontend     | Node.js 24, pnpm 11.6.0                                                                                                            |
| Build the browser-mode backend      | The above, plus stable Rust. Desktop libraries are not needed.                                                                     |
| Develop or build the desktop app    | The above, plus the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) (GTK/WebKitGTK on Linux, WebView2 on Windows) |
| Run an already built backend or app | Nothing beyond the platform runtime libraries                                                                                      |

Then install dependencies once:

```sh
pnpm install --frozen-lockfile
```

## Pick a mode

| Mode                                             | Command                                   | Opens                    |
| ------------------------------------------------ | ----------------------------------------- | ------------------------ |
| [Desktop, development](#desktop-development)     | `pnpm dev`                                | Tauri window, hot reload |
| [Desktop, release build](#desktop-release-build) | `pnpm build:desktop`, then run the binary | Tauri window             |
| [Browser, development](#browser-development)     | `pnpm dev:backend` + `pnpm dev:web`       | `http://127.0.0.1:1420`  |
| [Browser, release build](#browser-release-build) | `pnpm build:backend`, then run the binary | `http://127.0.0.1:1421`  |
| [Frontend only](#frontend-only)                  | `pnpm dev:web`                            | UI with no backend       |
| [Landing page](#landing-page)                    | `pnpm dev:landing`                        | `http://127.0.0.1:1430`  |

Data is stored in `AGENTICA_DATA_DIR` if set, otherwise the OS data directory
(`~/.local/share/agentica` on Linux, `%APPDATA%\agentica` on Windows).

## Desktop development

```sh
pnpm dev
```

Builds the protocol package, starts Vite on port 1420, compiles the app, and opens
a window. The runtime is linked into the app, so no separate backend is needed.
Closing the window stops it; Ctrl+C stops the dev command.

## Desktop release build

```sh
pnpm build:desktop
./target/release/agentica-desktop        # Windows: .\target\release\agentica-desktop.exe
```

A single executable with the frontend and runtime embedded. Installers are not
produced yet.

## Browser development

In two terminals:

```sh
pnpm dev:backend    # or: cargo run --locked -p agentica-runtime --bin agentica-backend
pnpm dev:web
```

Then [connect](#connecting-the-browser).

## Browser release build

```sh
pnpm build:backend
./target/release/agentica-backend        # Windows: .\target\release\agentica-backend.exe
```

The executable embeds the UI and can be copied anywhere. Open
`http://127.0.0.1:1421` and [connect](#connecting-the-browser). At runtime it
needs no Node, Vite, or Rust; on Linux it needs a compatible glibc, libgcc, and
libm.

To build without the embedded UI (no Node needed), drop the feature flag and
serve the frontend separately with `pnpm dev:web`:

```sh
cargo build --locked --release -p agentica-runtime --bin agentica-backend
```

To preview the production frontend against any backend:

```sh
pnpm --filter @agentica/desktop... build
pnpm --filter @agentica/desktop exec vite preview --host 127.0.0.1 --port 1420 --strictPort
```

## Frontend only

```sh
pnpm dev:web
```

Opens the canvas UI at `http://127.0.0.1:1420` without Rust or desktop libraries.
It stays disconnected until you start a backend and connect.

## Landing page

```sh
pnpm dev:landing      # http://127.0.0.1:1430
pnpm build:landing    # static site in apps/landing/dist
```

The landing page is a standalone static site with no runtime dependency.

## Connecting the browser

1. Start the backend. It prints a **Connection key**.
2. Open `http://127.0.0.1:1421` (release build) or `http://127.0.0.1:1420`
   (development).
3. Paste the key and choose **Connect**. The workspace screen shows **Ready**.

The backend listens only on `127.0.0.1:1421` and accepts requests from exactly
`http://127.0.0.1:1421`, `http://127.0.0.1:1420`, and `http://localhost:1420`.
Other ports, or opening the HTML file directly, are rejected.

The key stays in memory; it is never put in a URL or browser storage. Each
backend start makes a new key, so after a restart paste the new one and choose
**Reconnect**. Closing a tab leaves the backend running; Ctrl+C stops it.

Health is checked every five seconds. After a lost connection, reconnect and use
**Retry save**; unsaved drafts are kept.

## Ports

| Port | Used by                                                  |
| ---- | -------------------------------------------------------- |
| 1420 | Vite dev server or preview (run one at a time)           |
| 1421 | Browser-mode backend (one at a time), and the test suite |
| 1430 | Landing page dev server                                  |

The desktop release build uses no ports.
