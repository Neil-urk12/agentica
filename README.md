# Agentica

A visual workspace operating system for your agents with infinite canvas

The repository currently contains an initial development scaffold: a Svelte canvas
shell, a Tauri desktop host with a shared Rust runtime, and a detached Axum
backend for the same UI in a local browser. Both modes support validated health
checks and visible connection failures. The shared runtime persists workspaces,
canvases, and text artifacts in SQLite with one writer per workspace; the UI
creates and reopens them, edits text and node placement, persists pan/zoom, and
autosaves changes through the runtime commands. OpenRouter conversations place
editable prompts and replies directly on the canvas. Tool-capable models can
propose text, shape, placement, and connection changes for review.

## Canvas conversation

Open Settings to choose OpenRouter, a named hosted provider (NVIDIA NIM, Groq,
Together AI, Mistral AI, or DeepSeek, under **Advanced > Where the AI runs**), or
a custom OpenAI-compatible provider. Named providers fill in their endpoint and
keep a separate API key, model, and tools flag, so switching providers never
sends one provider's key to another. Custom
providers accept a base URL (for example `https://api.example.com/v1` or
`http://localhost:1234/v1`), API key, and model ID. Leave the key blank for endpoints
that need no authentication. Enable canvas tools only for models that support
function calling; disable them for text-only replies. OpenRouter checks its model
catalog automatically. Each provider keeps separate settings and keys locally.
**Check** sends one small message and reports a bad key, an unreachable server,
the provider's own error (for example a retired model, with any key redacted), or
no answer within 30 seconds.
The desktop app sends custom requests through its native HTTP client, so providers
do not need browser CORS support. Browser mode sends requests directly and requires
CORS from the app's origin. Custom URLs support HTTPS, or HTTP at `localhost` and `127.0.0.1`.
The app appends `/chat/completions` to the base URL; pasting the full Chat
Completions URL is also supported.

Select objects to focus
the next request, or clear the selection to use the current canvas. The composer
shows what will be sent: object text and geometry plus up to eight recent
exchanges. Text-only models can reply but cannot propose object changes.

Prompts and replies remain editable canvas text: double-click or focus the text
and press Enter to edit it. Escape or Ctrl/Cmd+Enter ends editing. Text and
geometric shapes can be moved and resized with selection controls.

**Undo** and **Redo** (Ctrl+Z and Ctrl+Y or Ctrl+Shift+Z; ⌘Z and ⇧⌘Z on macOS)
reverse moves, resizes, and text edits on the open canvas. A whole drag or a
burst of typing is one step, and undone changes are autosaved like any other
edit. While a text field has focus, the shortcuts use that field's own undo.
Creating, deleting, connecting, applied proposals, and panning or zooming are
not undoable. History belongs to the open canvas and is cleared when you leave
it; a step for an object deleted since is skipped.

Proposed changes use dashed outlines and a **Proposed** label. Choose **Apply**
beside the reply to commit the whole proposal, or **Discard** to keep the reply
without changing existing objects. Pending proposals survive reopening; changed
targets cause a conflict rather than overwriting manual edits. Only one generation
or unresolved proposal can be active on a canvas. Cancel stops generation, and
interrupted requests require an explicit retry.

The first tool set supports text, labeled rectangles and ellipses, placement,
connectors, and self-contained HTML/CSS designs. Ask for a screen (for example
“design a login page”) and the agent proposes a page rendered on the canvas in
a sandboxed frame: scripts, remote resources, and form submission are blocked,
and **Read HTML source** shows the exact source. Designs are stored with the
workspace, not written into a project folder, and appear in the agent's outline
as `design` objects named by their title or first heading. The agent does not
generate images or execute code. A prompt's canvas context shares the 128 KiB
model request budget instead of the 16 KiB runtime RPC frame limit; oversized
requests fail visibly without truncation and report the measured size. If saving a generated response fails, keep the canvas open to retry
or copy the response for recovery. Basic manual editing needs no AI account.

To revise a design, choose **Annotate design** in its header. Click the design
to pin a numbered comment to that spot, or add a general comment, then choose
**Generate revision**. The agent receives only that design's source plus your
comments (each pin names the element under it, such as `header > h1 "Launch
faster"`) and proposes one new design beside the original, which stays
unchanged; Apply or Discard it like any proposal. Unsent comments are kept in
this browser per design, shown as a count on the node, and cleared once the
revision turn starts; the prompt card then records them, and Retry resends the
same design. Pins need a pointer; keyboard users can add general comments.
Revisions require a tool-capable model.

While a turn runs, the composer reports the current request (for example,
"Request 2 of 8"), how many edits are staged, and any rejected calls. Besides
its request, tool-call, size, and time limits, the harness accepts at most 16
tool calls per response and ends the turn when the model repeats the same
rejected edit a third time; edits staged before then remain a partial proposal.
The whole turn's time limit defaults to 180 seconds and can be changed in
**Settings > Advanced > Agent time limit** (30–600 seconds) for slow models.

## Canvas files

Use **Add a file** in the canvas toolbar, the composer, or the empty-canvas
prompt — or drag files onto the canvas — to place an image (PNG, JPEG, WebP,
GIF, SVG), PDF, Word document (DOCX or legacy DOC), or text-like file (TXT,
Markdown, CSV) on the canvas. Dropped files land where the pointer is; picked
files land near the middle of the view. Files up to 8 MB are copied into the
open workspace, so they survive the original moving or being deleted. The import streams in ordered chunks to keep every runtime
request inside the 16 KiB frame; abandoned imports expire after an hour.

Images render inline, PDFs page through with a page count, DOCX files show a
converted preview, and text files show their content. Legacy DOC files have no
in-app preview and no extractable text, but can still be opened. Word and PDF
preview frames are inert: scripts never run. **Open** launches the copied file
with the system application on desktop; in browser mode it downloads a copy.

Imported text is capped at 10,000 characters per file and is shared with the
agent when the file node is selected, exactly like note text. File bytes are
never included in canvas context or a provider prompt; select the node to attach
its extracted text to the next request. Images and scanned PDFs without a text
layer contribute no text. The canvas agent cannot create or upload files itself.

## Project groups and native sessions

Choose **Open project** to place an existing folder on the canvas as a project
group. The desktop app shows a folder picker; browser mode asks for an absolute
folder path on the backend computer. Opening a folder copies and creates nothing
and runs no command. Groups start collapsed on every canvas visit; the header
chevron expands one. Each group header offers **Add terminal** (your login shell,
or `/bin/sh` as a visible fallback; on Windows, PowerShell 7 or Windows PowerShell,
with `cmd.exe` as the fallback) and **Add agent** (the installed Codex CLI with
its own sign-in, prompts, and approvals). Tiles belong to their group, move with it,
and start only when you choose **Start**. Sessions run with your user permissions;
the project folder sets the working directory and is not a sandbox.

Codex must be installed as `codex` on the PATH of the backend process (or the
desktop app); on Windows, `codex.exe` or the npm `codex.cmd` launcher. Agentica
passes no prompt, approval, or sandbox flags and never answers native prompts for
you.

- **Focus terminal** sends keys, Ctrl+C, Tab, and Escape to the program.
  **Ctrl+Shift+Escape** returns focus to the tile controls; **Ctrl+Shift+C** copies
  the selection. Paste needs an explicit paste action, and multi-line pastes ask
  for confirmation. Links open only with Ctrl/Cmd+click in browser mode.
- Moving, resizing, collapsing a group, switching canvases, or refreshing the
  browser does not stop a session; returning reattaches without replaying input.
  If earlier output was dropped, the tile says so. **Redraw** asks the program to
  repaint its current screen; it does not recover lost history.
- Removing a tile, group, canvas, or workspace with live sessions asks you to
  **Stop and remove** or **Cancel**. Removal never deletes project files.
- Process ownership: closing the desktop window stops and reaps its sessions.
  In browser mode the backend owns them; closing a tab only detaches, and
  stopping the backend (Ctrl+C) stops them. After a restart, tiles reappear
  stopped. Deliberately daemonized processes and abrupt backend crashes are
  outside this cleanup.
- If a project folder moves, Start is disabled and **Locate folder** rebinds the
  group once its sessions are stopped.

Native sessions are supported on Linux and Windows. Linux is verified with zsh 5.9
and `codex-cli 0.163.0` in desktop and browser modes. Windows 10 1809 or later
uses ConPTY, and each session's processes run in a Job Object that is stopped with
the session; automated tests cover PowerShell and `cmd.exe` on Windows 11, but
interactive Codex use on Windows is not yet verified. On other systems project
groups remain visible but Start explains why it is unavailable. Project paths,
session settings, and terminal output are never added to canvas conversation
context.

## Getting started

Run all commands from the repository root.

| What you want to run                     | Prerequisites                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Frontend development or built-UI preview | Node.js 24 and pnpm 11.6.0                                                                              |
| Build the detached distribution          | Frontend tools, stable Rust and Cargo; desktop libraries are not needed                                 |
| Desktop development or builds            | Frontend tools, Rust, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/) |
| An already compiled backend              | No Node, pnpm, or Rust toolchain required                                                               |
| An already compiled desktop app          | Platform runtime libraries/webview; no Node, pnpm, or Rust toolchain required                           |

Install JavaScript dependencies before using the frontend or desktop commands:

```sh
pnpm install --frozen-lockfile
```

## Session attention

Session tiles show attention for terminal bells (BEL), program-declared OSC 9
notifications, and an unseen process exit or launch failure. An affected tile gets
an amber ring (red for a failed launch) and a strip under the terminal with the
reason, how long it has waited, and **Mark seen**. Project groups list separate
status items, such as "1 running" and "2 waiting for you", also when collapsed.

The top bar shows how many sessions on the current canvas are waiting. Select it,
or press Ctrl+J (⌘J on macOS) outside text fields and terminals, to open the
queue: every waiting session, oldest first, with its project, reason, and waited
time. Up and Down move between rows, Enter jumps to the tile, and Escape closes
the queue. **Jump to** moves the viewport without expanding a collapsed project or
clearing attention. Focus the terminal or choose **Mark seen** to clear it.

Labels describe only received signals: **Waiting for you** for a terminal bell,
the program's notification text (or **Sent a notification** when it is empty),
**Stopped** with the exit code or signal, and **Failed** with the error (or
**Failed to start**). They do not establish approval, thinking, turn completion,
or task results. Title, directory, and progress escape sequences do not raise
attention.

Attention remains in the backend across canvas switches and browser refreshes;
it resets when the session is restarted or the backend ends. Signals while the
terminal is focused, and user-requested Stop/Restart/removal exits, do not raise
attention. Notification text stays out of saved canvas content and conversations.

Codex tiles include expandable notification setup instructions. To opt in, add
these settings to your Codex configuration:

```toml
[tui]
notifications = true
notification_method = "osc9"
notification_condition = "always"
```

These are global Codex settings (normally `~/.codex/config.toml`) and also affect
Codex in other terminals, including notifications while focused there. `osc9`
avoids relying on inherited terminal detection; `always` lets Agentica apply its
own terminal-focus gating. Agentica does not inspect or modify Codex configuration
or add launch flags. Without this opt-in, bell and process-exit attention still
work; the setup hint does not indicate whether Codex is configured.

## Running the application

| Option                                                              | How to start                                                 | What opens                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| [Desktop development](#desktop-development)                         | `pnpm dev`                                                   | Tauri window with the shared Rust runtime             |
| [Compiled desktop app](#compiled-desktop-app)                       | `pnpm build:desktop`, then run the executable                | Tauri window with the built frontend and Rust runtime |
| [Browser development](#browser-development)                         | `pnpm dev:backend` and `pnpm dev:web` in separate terminals  | Browser UI connected to an independent Axum backend   |
| [Browser with a compiled backend](#browser-with-a-compiled-backend) | `pnpm build:backend`, then run the executable                | Embedded browser UI and Rust runtime on port 1421     |
| [Preview the built browser UI](#preview-the-built-browser-ui)       | Run a backend and serve the built frontend with Vite preview | Local preview of the built UI                         |
| [Frontend only](#frontend-only)                                     | `pnpm dev:web`                                               | Canvas UI without a connected backend                 |
| [Landing page](#landing-page)                                       | `pnpm dev:landing`                                           | Marketing page with the desktop download links        |

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

Build the release distribution (frontend tooling is required at build time):

```sh
pnpm build:backend
```

Copy `target/release/agentica-backend` (Windows: `.exe`) to the destination and
run it. It embeds the built UI; open `http://127.0.0.1:1421`, paste the terminal
key, and select **Connect**. No Vite, asset directory, Node, pnpm, or Cargo is
needed at runtime. Linux still requires compatible glibc, libgcc, and libm;
use a local browser.

For an RPC-only development executable, build directly without Node or pnpm:

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
These direct Cargo builds omit the embedded frontend. For them, start
`pnpm dev:web` or the built-UI preview below in another terminal, then follow
[the browser connection steps](#browser-connection-and-shutdown).

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
This is a development preview requiring Node/Vite. The `pnpm build:backend`
distribution serves these assets itself on port 1421.

### Frontend only

```sh
pnpm dev:web
```

Open `http://127.0.0.1:1420` to work on the canvas UI. This needs no Rust toolchain
or desktop libraries. Backend health stays disconnected until you start a backend,
enter its connection key, and connect.

### Landing page

```sh
pnpm dev:landing
```

Open `http://127.0.0.1:1430` for the standalone marketing page. It detects the
visitor's platform for the download call to action and links to GitHub Releases;
the source-build commands are listed alongside. Its light/dark theme follows the
system preference until a visitor picks one. `pnpm build:landing` writes the
static site to `apps/landing/dist`. The page does not talk to the runtime and has
no backend dependency.

### Browser connection and shutdown

1. Keep the backend running (and the frontend server for development).
2. Open **`http://127.0.0.1:1421`** for the distribution, or **`http://127.0.0.1:1420`** for development.
3. Copy the **Connection key** from the backend terminal into the UI's password field.
4. Select **Connect**; a successful health check shows **Ready** at the top of the workspace screen.

The backend listens on `http://127.0.0.1:1421/rpc` for authenticated API requests.
It accepts the production origin `http://127.0.0.1:1421` and the development
frontend at either `http://127.0.0.1:1420` or its `http://localhost:1420`
equivalent; another port or opening the HTML directly does not satisfy that check.

Closing a browser tab leaves the backend running. Stop each server with Ctrl+C
in its terminal. A backend restart generates a new key: paste it and select
**Reconnect**. The UI reports connection failures and waits for manual reconnect.
Keys stay in memory and are never placed in URLs or browser storage.

Desktop development, browser development, and built-UI preview all use frontend
port 1420; run one of those frontend servers at a time. Only one detached backend
can bind port 1421. Compiled desktop mode does not use either server port.

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

`pnpm build` builds the frontend, TypeScript protocol package, and RPC-only debug
backend. Build frontend assets before `pnpm check:rust`, whose all-features check
includes embedding. `pnpm test` also builds the frontend and embedded debug backend.
Stop only your own detached backend before running tests, which use port 1421.

## Repository

```text
apps/desktop/              Svelte 5, Svelte Flow, Tailwind CSS, Vite
apps/desktop/src-tauri/    Tauri 2 native host
apps/landing/              Standalone marketing page, Vite and static assets
packages/protocol/        TypeScript wire contracts and response validation
packages/agent-runtime/   Shared Rust logic and the detached Axum executable
tests/                    Browser protocol integration checks against Rust
Cargo.toml / Cargo.lock   Rust workspace and reproducible dependency versions
.github/workflows/        Frontend/runtime checks and native compilation
```

Additional domain packages will be created when their implementations begin.
See the [contribution guide](CONTRIBUTING.md).

## References

The product draws on [Dim0](https://github.com/vcmf/dim0) for editable artifact
interactions, [ccanvas](https://github.com/DevoidSloth/ccanvas) for spatial
coding-agent workflows, and [tldraw](https://github.com/tldraw/tldraw) for canvas
interaction patterns. Review each upstream license before incorporating code or assets.

Licensed under [MIT](LICENSE).
