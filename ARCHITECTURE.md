# Architecture

Agentica is a local-first desktop app. One Svelte UI runs either inside a Tauri
window or in a local browser, and both talk to the same Rust runtime. The runtime
owns all persistence, process management, and validation; the UI never writes
storage or spawns processes itself.

This page describes what is built today. Decisions and their reasoning live in the
[ADRs](docs/architecture/README.md) and the [changelog](CHANGELOG.md).

## System overview

```text
                ┌─────────────────────────────────────────────┐
                │  Svelte 5 UI  (apps/desktop/src)            │
                │  Svelte Flow canvas · xterm · Tailwind      │
                │  canvas agent loop → OpenRouter / OpenAI-   │
                │  compatible provider (HTTPS, user's key)    │
                └───────────────┬─────────────────────────────┘
          lib/runtime.ts        │        lib/session-client.ts
     ┌──────────────────────────┴──────────────────────────┐
     │ Desktop mode                    Browser mode        │
     │ Tauri invoke (in-process)       POST /rpc + WS      │
     │                                 /sessions on        │
     │                                 127.0.0.1:1421      │
     ▼                                                     ▼
┌────────────────────────┐               ┌──────────────────────────┐
│ Tauri 2 host           │               │ agentica-backend (Axum)  │
│ apps/desktop/src-tauri │               │ bearer key, exact Origin │
│                        │               │ and Host checks          │
└───────────┬────────────┘               └────────────┬─────────────┘
            └──────────────┬──────────────────────────┘
                           ▼
        ┌─────────────────────────────────────────────────┐
        │ agentica-runtime  (packages/agent-runtime)      │
        │ Runtime::handle_request · contracts · commands  │
        ├───────────────┬────────────────┬────────────────┤
        │ SQLite store  │ Sessions       │ Outside lock   │
        │ one writer    │ PTY, attention │ Git (Changes)  │
        │ per workspace │ paste, paging  │ stdio MCP      │
        └───────────────┴────────────────┴────────────────┘
```

An interactive diagram of the launch modes and connection lifecycle is in
[application-flow.html](docs/architecture/application-flow.html) (open it in a browser).

## Components

| Component        | Path                                                   | Built with                                                  | Responsibility                                                                                                                            |
| ---------------- | ------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| UI               | `apps/desktop/src`                                     | Svelte 5, Svelte Flow (`@xyflow/svelte`), Tailwind 4, xterm | Canvas, editing, autosave, settings, terminal tiles, Changes review, and the canvas agent loop.                                           |
| Desktop host     | `apps/desktop/src-tauri`                               | Tauri 2 (dialog and HTTP plugins)                           | Links the runtime in-process. Exposes `runtime_request` and session commands; native folder picker and HTTP client for providers.         |
| Detached backend | `packages/agent-runtime/src/{main,http,session_ws}.rs` | Axum, Tokio                                                 | Serves the same runtime on `127.0.0.1:1421`: `POST /rpc`, `/sessions` WebSocket, and optionally the embedded UI (`bundled-frontend`).     |
| Runtime          | `packages/agent-runtime`                               | Rust                                                        | Request validation, command dispatch, and every domain rule. Shared by both hosts.                                                        |
| Storage          | `store.rs`, `schema_v*.sql`                            | SQLite (`rusqlite`, bundled)                                | Workspaces, canvases, nodes, conversations, projects, tasks, review feedback, MCP config. Versioned migrations; one writer per workspace. |
| Sessions         | `sessions/`, `sessions.rs`                             | `portable-pty`, pidfds (Linux), Job Objects (Windows)       | Terminal and CLI agent tiles: launch, output paging, bracketed paste, attention signals (BEL, OSC 9, exit), cleanup on shutdown.          |
| Changes          | `changes.rs`, `review.rs`                              | `git` CLI                                                   | Read-only Git status and diffs for a project, plus stored review feedback.                                                                |
| MCP client       | `mcp.rs`, `mcp_store.rs`                               | Model Context Protocol over stdio                           | Starts user-configured tool servers and forwards read-only tool calls from the canvas agent.                                              |
| Protocol         | `packages/protocol`                                    | TypeScript, Zod                                             | Request/response schemas and limits. Mirrors `contracts.rs`; fixtures in `tests/fixtures` check both sides agree.                         |
| Landing page     | `apps/landing`                                         | Vite, static HTML                                           | Marketing site. Talks to nothing.                                                                                                         |

### Runtime modules

| Module            | Owns                                                                   |
| ----------------- | ---------------------------------------------------------------------- |
| `lib.rs`          | `Runtime::handle_request`: raw JSON in, JSON out, for both hosts       |
| `contracts.rs`    | Wire shapes and size limits                                            |
| `commands.rs`     | Workspace, canvas, and text-artifact commands                          |
| `conversation.rs` | Canvas agent proposals: simulate for review, then commit atomically    |
| `projects.rs`     | Project folder references and stopped session presets                  |
| `tasks.rs`        | User-owned task state on text nodes; the agent cannot read or write it |
| `changes.rs`      | Git status and diffs, run outside the workspace lock                   |
| `review.rs`       | Changes review feedback records                                        |
| `mcp.rs`          | Stdio MCP processes, kept outside the runtime lock                     |
| `sessions/`       | PTY launch, output pages, paste, attention, Linux/Windows cleanup      |

## Request flow

1. The UI builds a request and validates it with the protocol schema.
2. `lib/runtime.ts` sends it through Tauri `invoke` (desktop) or `fetch` to
   `/rpc` with the connection key (browser).
3. `Runtime::handle_request` checks the envelope and size, dispatches the method,
   and returns a result or an error with a stable code (`CONFLICT`,
   `WORKSPACE_LOCKED`, `STORAGE_ERROR`, …).
4. The UI validates the reply against the same schema before using it.

Mutations carry an `expectedRevision`, so a stale write fails with `CONFLICT`
instead of overwriting newer state. Terminal output does not go through `/rpc`;
it streams over a Tauri IPC channel (desktop) or the `/sessions` WebSocket (browser).

## Canvas agent

The agent loop runs in the UI (`canvas-agent.ts`, `canvas-harness.ts`). It calls
the user's chosen provider directly, with the user's own key. Each turn has fixed
limits: 8 model requests, 32 tool calls, and 2 minutes.

The model never edits the canvas. Its tool calls become a **proposal** that the
runtime simulates and stores. The user applies or discards it, and the runtime
refuses the apply if the target objects changed in the meantime. Read tools
(`canvas_read`, enabled MCP tools) are checked by the runtime, not the loop,
because any code in the webview can call `/rpc` directly.

## Trust boundaries

- **Browser mode**: the backend binds only `127.0.0.1`. Every RPC and WebSocket
  request needs the bearer key printed at startup, an exact allowed `Origin`, and
  an exact `Host`. The key lives in memory only, never in URLs or storage.
- **Desktop mode**: the main window may only send runtime and session requests,
  open a folder picker, and make HTTP requests to `*/chat/completions` URLs
  (HTTPS, or HTTP on localhost). A scoped `open_file` command writes one copied
  canvas file to a temp path for the system application. It has no folder,
  shell, or database permissions
  ([capabilities](apps/desktop/src-tauri/capabilities/)).
- **Canvas files** are copied into SQLite in ordered chunks and read on demand
  for previews. Only their extracted text can enter canvas context; file bytes
  never reach a provider prompt.
- **Sessions and MCP servers** run as the user with the user's permissions. A
  project folder is the working directory, not a sandbox. Agentica never answers
  an agent's prompts for it.
- **Paste into sessions** is always bracketed and never presses Enter, so text
  sent to an agent waits for the user to submit it.
- **Git** runs with fixed argv, `GIT_*` overrides cleared, and a 10 s deadline.
- **Voice input** records from the microphone only after the user grants
  permission, and transcribes in a Web Worker in the webview with a local Whisper
  model ([ADR 0005](docs/architecture/0005-local-speech-to-text.md)). Audio and
  transcripts never leave the machine. The worker downloads the model from
  `huggingface.co` and the ONNX runtime from `cdn.jsdelivr.net` on first use;
  both are allowed by the existing `https:` in the CSP `connect-src`. The CSP
  adds `'wasm-unsafe-eval'` to `script-src` so the runtime can compile
  WebAssembly, and `blob:` to `worker-src` for the runtime's worker. It still
  disallows `eval` of JavaScript.

## Why this stack

| Choice                               | Reason                                                                                                                                                                |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One Rust runtime behind two hosts    | Desktop and browser behave the same because they run the same code. No Node sidecar to ship ([ADR 0002](docs/architecture/0002-rust-runtime.md)).                     |
| Tauri 2                              | Small native binary using the system webview, with a capability model that limits what the window can call.                                                           |
| Detached Axum backend                | Lets the UI run in any local browser and keeps sessions alive across tab closes ([ADR 0001](docs/architecture/0001-local-launch-modes.md)).                           |
| SQLite, one writer per workspace     | A single local file per workspace with transactional writes. A lock file stops two processes corrupting it ([ADR 0003](docs/architecture/0003-workspace-storage.md)). |
| Zod schemas mirrored in Rust         | Both sides reject malformed messages. Shared fixtures catch drift.                                                                                                    |
| Svelte Flow                          | Pan, zoom, selection, and node layout without building a canvas engine.                                                                                               |
| Proposals instead of direct AI edits | The user stays in control of every change, and edits made by hand are never overwritten.                                                                              |
| Bring your own provider              | No Agentica server or account. Keys and data stay on the user's machine.                                                                                              |

## Scaling limits

Agentica is single-user and local. One process writes a workspace at a time;
another process opening it gets `WORKSPACE_LOCKED`. Native sessions run on Linux
and Windows; other systems refuse to start them. Request frames are capped at 16 KiB, and long output is paged
rather than sent whole. Adding a feature usually means a protocol schema, a
runtime module, and a schema migration, each tested on its own.
