# ADR 0003: Workspace storage, writer ownership, and durable writes

Status: accepted on 11 October 2026. Scope: M0 managed workspaces with text artifacts.

The runtime needs a minimal persisted workspace that both launch modes can open,
with one writer per workspace and no silent data loss. This ADR fixes the M0
layout, lock identity, schema, and write path. It does not add attached
projects, managed files, history, or archives.

## Workspace roots

The shared Rust runtime is configured with one data root at startup:
`AGENTICA_DATA_DIR` when set, otherwise the OS data directory joined with
`agentica` (`~/.local/share/agentica` on Linux, `%APPDATA%\agentica` on
Windows). Each workspace command creates `<data root>/workspaces` if needed and
derives paths from its canonical form, so a missing or unwritable root is a
visible `STORAGE_ERROR` rather than a startup failure. Desktop and detached
modes use the same default, so they contend for the same workspaces. The
detached backend prints the configured root at startup.

Each managed workspace has its own root, `<data root>/workspaces/<workspace-id>/`:

| Path                               | Purpose                                                  |
| ---------------------------------- | -------------------------------------------------------- |
| `writer.lock`                      | Exclusive writer lock; contains no data                  |
| `workspace.sqlite3` (+ `-journal`) | Authoritative domain state and text content              |
| `content/`                         | Reserved for managed files; not created or written in M0 |

Clients never send paths. They send runtime-generated lowercase UUIDs, which the
runtime validates before joining them to the data root, so requests cannot
traverse outside it. Attached external resources are out of scope.

## Writer lock and canonical identity

Before the first write to a workspace root — creation, migration, or any
command — the runtime opens `writer.lock` and takes a non-blocking OS exclusive
lock on it (`File::try_lock`: `flock` on Linux, `LockFileEx` on Windows). The
lock is held for as long as that workspace is open in the runtime and is
released on close, on opening another workspace, on normal exit, and by the OS
when the process is killed. Files are opened close-on-exec, so child processes
do not keep it after `exec`; a child forked from a multithreaded runtime holds
an inherited descriptor only until then, so a release can be delayed briefly
while a process is being spawned.

The lock identity is the lock file object itself, not a path string. Any alias
that reaches the same file — symlinks, `..` segments, case variants on Windows,
or a different `AGENTICA_DATA_DIR` spelling — contends for the same lock. The
canonical path is used for diagnostics and for deriving the database path.
Network filesystems with unreliable advisory locks are unsupported.

A second writer, in either launch mode and in the same or another process,
receives `WORKSPACE_LOCKED` with an actionable message and opens no database
connection. A runtime holds at most one open workspace; reopening it reuses the
held lock, and opening another acquires the new lock before releasing the old.
Browser tabs are clients of one runtime, not writers; every workspace-scoped
request names its `workspaceId`, and requests for a workspace that is not
currently open in that runtime fail with `WORKSPACE_NOT_OPEN`.

`workspace.list` reads each workspace's name through a read-only SQLite
connection without taking the writer lock, so locked workspaces stay visible.
Entries this build cannot read are listed with a null name; opening them
reports the reason.

## Initial schema and migrations

The schema lives in one SQLite database per workspace, so the workspace owner
is implicit and cross-workspace references cannot be stored. `PRAGMA
application_id` identifies Agentica files and `PRAGMA user_version` is the
storage schema version (1). Version 1:

| Table          | Fields                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `workspace`    | single row: `id`, `name`                                                                          |
| `canvas`       | `id`, `title`, layout `revision`, `viewport_x`, `viewport_y`, `viewport_zoom`                     |
| `text_content` | `id`, `body`                                                                                      |
| `artifact`     | `id`, `type` (`text`), `schema_version` (1), `revision`, `content_store` (`sqlite`), `content_id` |
| `canvas_node`  | `id`, `canvas_id`, `kind` (`artifact`), `artifact_id`, `x`, `y`, `width`, `height`                |
| `canvas_edge`  | `id`, `canvas_id`, `kind` (`relationship`), `source_node_id`, `target_node_id`                    |

Tables are `STRICT` with foreign keys enforced. Edge endpoints use composite
foreign keys to nodes on the same canvas; self-links and duplicate node pairs
are rejected. The schema is
[schema_v1.sql](../../packages/agent-runtime/src/schema_v1.sql).

Artifact identity, type, schema version, and revision live in `artifact`; its
content reference is `(content_store, content_id)`, which M0 resolves only to
`text_content`. Placement and size belong to `canvas_node`; viewport belongs to
`canvas`. Several nodes may reference one artifact, and removing a node never
deletes its artifact. M0 does not expose placement removal.

Migrations are an ordered list applied inside one `BEGIN IMMEDIATE`
transaction that also sets `user_version`; any failure rolls back the whole
upgrade. Workspace creation applies migrations and inserts the workspace row in
the same transaction, so a crash leaves either no workspace or a complete one.
Directories without a committed workspace row are skipped by listing and are
never deleted automatically. Reopening a current database applies nothing. A
database with a newer `user_version`, a foreign `application_id`, or missing
workspace row is rejected without modification. Backups before upgrading
existing data are required from the first migration beyond version 1 (M5).

## Revisions and versions

- `protocolVersion` versions the wire envelope; `user_version` the storage
  schema; `artifact.schema_version` the text content schema.
- `artifact.revision` starts at 1 and increments on each content change.
  `artifact.saveText` requires `expectedRevision` and fails with `CONFLICT`
  on stale state.
- `canvas.revision` covers the canvas layout: viewport, node geometry, and
  edges. `node.createText`, `edge.create`, and `canvas.save` require
  `expectedRevision`, apply atomically, and increment it. `canvas.save` updates
  the viewport and the geometry of the listed nodes; unknown or other-canvas
  nodes reject the whole save.

## Durable write and recovery path

M0 content is stored only in SQLite, so every mutation is one transaction and
no filesystem staging is needed. The database uses SQLite's default rollback
journal with `synchronous=FULL`; it lets read-only listing connections work
without shared-memory files. Each command validates the request and its expected
revision, runs in `BEGIN IMMEDIATE`, and returns success only after commit; the
UI marks content saved only after a correlated success reply. A crash before
commit leaves the previous committed state, which SQLite restores on reopen.
Tests kill a process in the middle of an uncommitted transaction and verify
recovery.

The first feature that writes managed files must, before shipping, add an
intent table and follow PROJECT.md §6.3: record a durable intent with an
idempotent operation ID; write and fsync a staged file under `content/`;
replace the target atomically; commit the state transition and mark the intent
complete in one transaction. On startup the runtime reconciles unfinished
intents — discarding staged files never applied, and completing or rolling
back replacements — with fault-injection tests for each partial state.

## Consequences

One runtime writes a given workspace at a time, while different workspaces may
be open in desktop and detached modes simultaneously. Request frames remain
limited to 16 KiB, which bounds a single text save and a single layout save.
History, undo, attachments, export, and backup-backed upgrades are deferred.
