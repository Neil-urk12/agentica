# Development

## Prerequisites

- Node.js 24 and pnpm 11.6.0 for frontend/runtime development.
- Stable Rust with rustfmt, plus the
  [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/), for
  native desktop development. Linux requires GTK and WebKitGTK development
  libraries; Windows requires the applicable build tools and WebView2.

Run commands from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm dev:web
```

`pnpm dev` opens the Tauri desktop shell and starts Vite automatically. Both
development modes use port 1420; run one mode at a time. Neither mode requires
Codex or an AI account.

## Verification

| Command              | Checks                                                            |
| -------------------- | ----------------------------------------------------------------- |
| `pnpm check`         | Strict TypeScript and Svelte checks                               |
| `pnpm test`          | Compiled runtime stdio, validation, correlation, and EOF behavior |
| `pnpm build`         | Frontend and TypeScript package builds                            |
| `pnpm format:check`  | Source and documentation formatting                               |
| `pnpm check:rust`    | Rust formatting and native compilation checks                     |
| `pnpm build:desktop` | Native release binary with embedded frontend; no installer        |

The runtime tests build their required workspace packages first. No real agent
execution or paid provider calls happen in tests. CI runs the JavaScript checks
and native compilation on Linux and Windows; that is not packaged-release or
security acceptance validation.

## Runtime health check

Build with `pnpm build`, then run `pnpm runtime` and enter this JSON line:

```json
{ "protocolVersion": 1, "id": "health-1", "method": "runtime.ping" }
```

The runtime emits:

```json
{ "protocolVersion": 1, "id": "health-1", "result": { "status": "ok" } }
```

The package-manager command can print its own startup text. A native bridge must
launch `node packages/agent-runtime/dist/index.js` directly, not through pnpm,
so stdout remains a protocol stream. End stdin to stop the runtime.

## Next slice

Complete M0 by connecting and supervising the sidecar through typed Tauri IPC,
adding SQLite persistence, and checking a save-and-reopen loop. Then implement
the manual mind-map workflow before connecting mock and real agents. Sidecar
packaging and enforceable Codex scopes need early validation on both target
platforms.
