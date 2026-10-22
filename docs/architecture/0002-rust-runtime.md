# ADR 0002: Shared Rust runtime and Axum detached backend

Status: accepted on 11 October 2026.

The Node sidecar required a second runtime and a separate packaging strategy.
Use `packages/agent-runtime` as a Rust library with an `agentica-backend`
executable. The desktop host links the library and calls it through Tauri IPC;
the detached executable exposes the same handler through Axum. Svelte remains
the shared frontend.

The version 1 JSON request and response formats, frontend/backend ports, exact
origin/host checks, per-start random connection key, constant-time credential
comparison, 16 KiB request bound, and manual browser reconnect are preserved.
HTTP header and request deadlines remain five seconds. The browser deadline is
three seconds. Desktop health calls are direct Rust operations, with no stdio
channel or child-process response deadline.

Rust and TypeScript validate the wire contract separately. Cross-language HTTP
tests validate Rust replies with the frontend's Zod schema. Request IDs use
JavaScript's UTF-16 length semantics in Rust as well. Unsupported commands and
unknown fields remain rejected.

The Rust runtime is the sole domain database writer. Neither transport may
write independently. The shared exclusive workspace-writer lock and SQLite
storage are defined in [ADR 0003](0003-workspace-storage.md). No persistence or stored user data exists in the
current slice, so this migration has no data conversion step.

The compiled detached backend runs without Node or Cargo; frontend development
still uses Node/pnpm. Frontend asset serving, native PTY/preview operations,
Codex integration, installers, and platform acceptance are not added here.

This replaces the Node/stdio portions of ADR 0001. The old implementation can be
restored from version control without changing the frontend wire contract or
converting data. Deployment overlap is not supported: only one detached backend
can bind port 1421. A restart requires copying the new connection key.
