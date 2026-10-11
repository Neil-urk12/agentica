# Development

## Prerequisites

- Node.js 24 and pnpm 11.6.0 for frontend development and integration tests.
- Stable Rust with rustfmt and Clippy for either backend mode.
- The
  [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/), for
  native desktop development. Linux requires GTK and WebKitGTK development
  libraries; Windows requires the applicable build tools and WebView2.

Run commands from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` builds the frontend protocol package, starts Vite, and opens the Tauri
desktop app. The shared Rust runtime is compiled into the app. The window calls
it through a scoped Tauri command and shows **Backend connected** after a validated
ping. Closing the app ends its backend; there is no separate child process.

For browser mode, Rust is needed to build the backend, but GTK, WebKitGTK, and
other desktop prerequisites are not needed. In two terminals:

```sh
pnpm dev:backend
pnpm dev:web
```

Open `http://127.0.0.1:1420`, paste the backend terminal's connection key, and
select **Connect**. The backend listens only on `127.0.0.1:1421`; use the exact
frontend URL, not `localhost`, because origin/host checks are strict. The key
stays in memory and is never placed in URLs or browser storage. Closing the tab
leaves the backend running; Ctrl+C in its terminal stops it. After restarting
the backend, paste its new key and reconnect.

Both modes check health every five seconds and wait for explicit reconnect on
failure. Browser health checks have a three-second response deadline. Persistence
calls await their outcome; only request reading and runtime admission time out.
After a lost connection, reload before retrying a mutation. The desktop
health command directly calls the Rust handler. The canvas
remains usable. Both frontends use port 1420; run one frontend mode at a time.
Neither mode requires Codex or an AI account. The UI implements health checks;
workspace persistence is available through the runtime protocol below.

## Verification

| Command              | Checks                                                                  |
| -------------------- | ----------------------------------------------------------------------- |
| `pnpm check`         | Strict TypeScript and Svelte checks                                     |
| `pnpm lint`          | Oxlint linter on JavaScript, TypeScript, and Svelte scripts             |
| `pnpm test`          | Rust unit/contract tests and real HTTP protocol, persistence, lifecycle |
| `pnpm build`         | Frontend, TypeScript protocol, and Rust backend builds                  |
| `pnpm format:check`  | Source and documentation formatting with Oxfmt                          |
| `pnpm check:rust`    | Rust formatting and Clippy on all targets/features                      |
| `pnpm test:rust`     | Rust workspace tests, including desktop connection state                |
| `pnpm build:desktop` | Native release binary with embedded frontend; no installer              |
| `pnpm build:backend` | Detached Rust release executable                                        |

The integration tests build the protocol package and Rust executable first.
They use port 1421; stop a development backend before running them. Tests use
temporary data directories and never touch your workspaces. No real agent
execution or paid provider calls happen in tests. CI runs frontend checks and
Rust integration/static checks on Linux and Windows; that is not installer or
security acceptance validation.

See the [local verification record](verification.md) for the checked behaviors
and remaining platform limitations.

`pnpm build:desktop` links the Rust runtime into the release app. Installer
generation and platform acceptance remain pending.

## Runtime health check

Start `pnpm dev:backend`, then use its terminal key to send this JSON body to
`http://127.0.0.1:1421/rpc` with POST, `Content-Type: application/json`,
`Origin: http://127.0.0.1:1420`, and `Authorization: Bearer <connection key>`:

```json
{ "protocolVersion": 1, "id": "health-1", "method": "runtime.ping" }
```

The backend returns:

```json
{ "protocolVersion": 1, "id": "health-1", "result": { "status": "ok" } }
```

## Workspace storage

Both modes store workspaces under `AGENTICA_DATA_DIR`, or the OS data directory
joined with `agentica`. Each workspace directory holds `writer.lock` and
`workspace.sqlite3`; only the Rust runtime writes them. Opening a workspace that
another desktop window or detached backend holds fails with `WORKSPACE_LOCKED`;
close it there and retry. Newer or foreign storage fails with
`UNSUPPORTED_STORAGE` and is left unmodified. The
[changelog](../../CHANGELOG.md) records the storage rationale.

Commands besides `runtime.ping` take `params`; the
[protocol package](../../packages/protocol/src/index.ts) defines them, and
[the shared fixture](../../tests/fixtures/workspace-roundtrip.json) shows a full
create/edit/reopen sequence. For example:

```json
{
  "protocolVersion": 1,
  "id": "create-1",
  "method": "workspace.create",
  "params": { "name": "Research" }
}
```

Mutations name an `expectedRevision` and fail with `CONFLICT` on stale state.
Errors for a valid envelope carry the request id.

To build a backend executable, run `pnpm build:backend`, or directly:

```sh
cargo build --locked --release -p agentica-runtime --bin agentica-backend
./target/release/agentica-backend
```

Windows uses `target\release\agentica-backend.exe`. Running the compiled backend
requires neither Node nor Cargo. It serves RPC; it does not yet serve the frontend
assets. Ctrl+C stops it; SIGTERM is also handled on Unix.

## Next slice

Complete M0 by connecting the shared UI to the persistence commands: text
editing, autosave, visible save failures, and reopen in both modes (M0-08).
Then implement the manual mind-map workflow before connecting mock and real agents. Installer
packaging and enforceable Codex scopes need early validation on both target
platforms.
