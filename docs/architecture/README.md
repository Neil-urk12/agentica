# Architecture decision records

The current system is described in [ARCHITECTURE.md](../../ARCHITECTURE.md).
These records explain why the main choices were made. Smaller decisions are
recorded in the [changelog](../../CHANGELOG.md).

| ADR                                | Decision                                                 | Status   |
| ---------------------------------- | -------------------------------------------------------- | -------- |
| [0001](0001-local-launch-modes.md) | One UI in a Tauri window and in a local browser          | Accepted |
| [0002](0002-rust-runtime.md)       | A shared Rust runtime, with Axum for browser mode        | Accepted |
| [0003](0003-workspace-storage.md)  | SQLite per workspace, one writer, durable writes         | Accepted |
| [0004](0004-m1-contracts.md)       | Typed canvas operations and the agent execution boundary | Accepted |

[application-flow.html](application-flow.html) is an interactive diagram of both
launch modes and the connection lifecycle. Its source is
[application-flow.architecture.json](application-flow.architecture.json); the
viewer's attribution is in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

## Adding a record

Copy the shape of an existing ADR: title, status with date, context, decision,
and consequences. Number it sequentially and add it to the table above. Larger
features go through an [OpenSpec](../../openspec/) change first.
