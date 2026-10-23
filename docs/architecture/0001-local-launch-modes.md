# ADR 0001: Desktop and detached local launch modes

Status: accepted. Scope: local, single-user development foundation.

The same canvas should work in a Tauri window and a browser while retaining one
domain implementation. This decision adds detached mode to PROJECT.md without
introducing a second backend or promising remote access.

Desktop mode sends versioned JSON through the capability-scoped `runtime_request`
Tauri command to the shared Rust runtime compiled into the app. The host
serializes exchanges and bounds requests. Explicit connect enables the health
session; reconnect checks the same in-process runtime. Closing the app ends its
backend. The desktop does not start an HTTP listener. The original Node stdio
sidecar decision was replaced by [ADR 0002](0002-rust-runtime.md).

Detached mode starts the same Rust handler behind an Axum HTTP server on
`127.0.0.1:1421`. Only `POST /rpc` is supported. Requests require the exact
`http://127.0.0.1:1420` frontend origin, the expected backend Host header, and a
random per-start bearer key. CORS permits only that origin. Preflight grants no
command access. Frames are limited to 16 KiB; server timeouts and a three-second
frontend deadline bound waiting. Keys are copied from the backend terminal into
an in-memory password field, never URLs or browser storage. Restart rotates the
key. A browser tab does not own or stop the backend.

Both paths use the same versioned JSON protocol and Rust runtime handler. It
initially allowed only `runtime.ping`; workspace commands were added by
[ADR 0003](0003-workspace-storage.md). Authentication is not authorization for
future privileged operations. The shared frontend validates response schemas and
request correlation. It checks health every five seconds while connected,
shows failure, and waits for explicit reconnect. The canvas stays usable.

This slice had no persistence or native terminal/preview operations. Both
launch paths now acquire the same exclusive workspace-writer lock before any
SQLite write, and a second writer fails visibly rather than relying on SQLite
locking alone ([ADR 0003](0003-workspace-storage.md)). Native PTYs and preview supervision will require a
headless Rust operations reusable by both modes; browser code cannot call Tauri APIs.

Node.js is used for frontend tooling and integration tests. Desktop builds link
the Rust runtime; the detached backend is a Rust executable that does not require
Node at run time. Installers and platform acceptance remain pending. WebSocket/
event streaming, remote hosting, and multiple users are deferred until required.
