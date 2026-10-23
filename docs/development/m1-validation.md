# M1 implementation and validation — 2026-10-15

This is a reviewable slice of M1-01, M1-02, and M1-03. It does not complete
live agent execution or the agent-edited mind-map milestone. ClickUp was read
for the updated task descriptions and was not modified.

## Implemented contracts

The existing protocol version 1, request correlation, UUID validation, and
16 KiB request bound remain in use. Unknown fields and operations are rejected
in both TypeScript and Rust. No caller-supplied filesystem paths are accepted.

`artifact.applyBatch` accepts a workspace, canvas, and 1–32 operations. Each
operation names an artifact and its expected revision. The initial implementation
allows one operation per artifact per batch. `text.replace` uses the same helper
as `artifact.saveText`; all changes run in one SQLite transaction. An incorrect
revision or an artifact not placed on that canvas rolls back every write.
Content saves increment artifact revisions and preserve canvas placement and
text purpose. A content-only batch does not increment the canvas revision.
This is a manual application RPC, not an authorized agent tool.

The typed topic vocabulary is `mindmap.addTopic`, `mindmap.renameTopic`,
`mindmap.moveTopic`, and `mindmap.removeTopic`. Topic IDs are stable lowercase
UUIDs, assigned on creation and never recycled. A null parent denotes a root;
self-parenting is invalid. Mind-map persistence is not implemented, so even a
mixed text/mind-map batch fails with `UNSUPPORTED_CAPABILITY` before any writes.
Tree existence, unique roots, duplicate child IDs, cycle prevention, and deletion
semantics belong to M1-04/M1-05 before enabling those operations.

`agent.start` defines explicit read/write artifact sets and an instruction
artifact. Instructions and writable artifacts must be in the read set; lists
are bounded to 128 unique IDs. These fields describe requested scope, not a
grant. A future provider bridge must intersect requests with runtime-owned
authorization and recheck it at every tool call. Current valid start/cancel/events
requests return correlated `UNSUPPORTED_CAPABILITY` errors and cannot launch a
provider or mutate artifacts. Malformed scopes/cursors return `INVALID_PARAMS`.

## Events and streaming decision

Normalized events carry protocol version, the original start request ID, a
runtime-issued run ID, a monotonic sequence, and a typed payload. Payloads cover
start, text delta, committed batch revisions, cancellation request, and terminal
completion/cancellation/failure. TypeScript and Rust validate the same complete
history fixtures, including identity, bounds, and ordering. Histories used for
these contract fixtures are limited to 128 events; this validator is not a live
supervisor or an unbounded transcript store.

The defined transport is cursor-based pull over the existing RPC:
`agent.events({ workspaceId, runId, after })`. Each response contains up to
16 events and `nextSequence`, which equals the last delivered sequence, or the
unchanged cursor for an empty page. Each result is limited to 14 KiB of serialized
UTF-8 JSON, leaving room for the response envelope. Pages have contiguous,
correlated sequences. The TypeScript result schema checks these page bounds.

The future supervisor must retain at most 128 unacknowledged events per run,
reserve two slots for cancellation and a terminal event, and pause provider
reads before filling the remaining capacity. It must not drop deltas or mutation
results. A provider that cannot pause must be stopped with an actionable
`BACKPRESSURE` failure. Cursor acknowledgement, replay retention, slow-reader
timeouts, Rust page production, and provider read control still need implementation
and integration tests in M1-09/M1-10. No streaming execution is enabled here.

Cancellation must serialize with mutation admission. A transaction already
admitted must finish and publish its committed revisions before `cancelRequested`.
After that event, no new writes or text deltas are accepted. Exactly one terminal
event follows, either `cancelled` or `failed`; nothing follows a terminal event.
Cancelling a terminal run must return terminal status without adding events.
The fixture validators enforce the event ordering; a live cancellation barrier
is still required in the supervisor.

## Codex evidence and restriction boundary

Test environment: Fedora 44, Linux x86_64, Codex CLI `0.162.1`.

Read-only local checks:

```sh
codex --version
codex app-server --help
codex app-server generate-json-schema --experimental --out /tmp/agentica-codex-schema
```

An isolated app-server was launched with a fresh temporary `CODEX_HOME` and
stdio. The only request sent was `initialize`, with client name
`agentica-capability-probe` and `experimentalApi: true`. It returned the matching
request ID, a `0.162.1` user agent, `platformFamily: unix`, and `platformOs: linux`.
The process was terminated after that response. No model turn, inherited MCP
configuration, provider request, or real data access was exercised.

Generated schema inspection found `thread/start` dynamic tools, approval policy,
environment and sandbox configuration; `turn/start` sandbox policy overrides;
and `item/tool/call` arguments with thread/turn/call identity. Its
`ThreadStartResponse.disabledPluginIds` description explicitly says that it does
not yet filter plugin capabilities. These are protocol surfaces, not enforcement
evidence. The official [app-server documentation](https://developers.openai.com/codex/app-server)
also documents experimental dynamic tools and approval mediation.

Proposed topology: Agentica runtime owns grants and persistence; a future
app-server client receives tool calls and forwards only typed, authorized
operations to the runtime. Application MCP tools would use the same authorization
boundary. Provider-internal tools and third-party MCP servers would otherwise be
separate access paths and need independent restriction proof.

There is no verified allowlist-only provider configuration, approval mediator,
scoped MCP bridge, or OS enforcement test in this slice. Consequently
`agent.capabilities` always reports `unsupported`, `executionEnabled: false`, and
`osIsolationVerified: false`. Settings displays that reason. Installation,
initialization, or an approval/sandbox field cannot enable execution. Nothing
here claims OS isolation or treats prompts as authorization.

OpenRouter is unchanged: its Composer path returns free-form response text,
which the existing manual editor saves. It has no artifact tool dispatcher and
does not satisfy the Codex capability requirements.

## Manual instruction experience

**Add instruction note** is a normal keyboard-focusable button. Enter creates a
persisted text artifact with purpose `instruction` and focuses **Agent
instructions** in the existing inspector. Content, position, and dimensions use
the existing editor, revision checks, autosave, retry, and reopen paths. The
inspector exposes the stable artifact UUID as **Instruction reference**. Editing
instructions does not start an agent. Ordinary text remains purpose `note`.

Selection is remembered per canvas in browser storage and restored on reopen;
selection still works when browser storage is unavailable. Instruction content
and placement remain in SQLite, independent of that selection preference.

Storage version 3 adds a checked purpose column to `text_content`. Migration
defaults existing text to `note` and preserves content, identities, and placement.
As with earlier storage upgrades, older builds reject an upgraded workspace;
they cannot reopen storage version 3. Back up workspaces before using an older
build again. No alternate instruction store or Codex dependency was introduced.

## Verification and follow-up

Final checks on Linux:

| Command                            | Result                                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                        | Passed: 21 Rust unit tests, 3 Rust contract tests, and 48 Node tests including the headless browser regression |
| `pnpm check`                       | Passed: TypeScript and Svelte                                                                                  |
| `pnpm check:rust`                  | Passed: rustfmt and all-target/all-feature Clippy with warnings denied                                         |
| `pnpm exec oxlint`                 | Passed                                                                                                         |
| Targeted `pnpm exec oxfmt --check` | Passed for changed frontend, protocol, fixtures, tests, and notes                                              |
| `git diff --check`                 | Passed; nothing staged                                                                                         |

The sandboxed full-suite attempt could not bind the detached backend's localhost
socket. The successful full suite ran with localhost socket permission. Both
storage version 1 and version 2 migration fixtures passed.

Shared desktop/HTTP fixtures cover stale-revision rollback after an earlier
successful operation, scope rejection after an earlier write, invalid/duplicate
operations, unsupported mixed batches, valid atomic text changes, instruction
purpose, and save/restart/reopen identities and placement. Run-event fixtures cover
cancel ordering, committed mutations before/after cancellation, terminal ordering,
correlation, invalid payloads, and bounds.

The browser regression uses the real bundled frontend, SQLite backend, and
headless Chrome. The backend starts with an empty PATH, so Codex is unavailable.
It activates note creation with Enter, types instructions, changes placement
with the keyboard, checks saved content/reference/selection on reopen, and checks
the unsupported state in Settings. Existing drawing and persistence coverage
remains in the same suite.

Follow-up ownership is by backlog item (no person assigned here):

| Item        | Remaining work                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1-04/M1-05 | Mind-map storage, tree validation, multi-operation topic batches, grants, provenance, and mutation authorization                                                               |
| M1-02/M1-10 | Tested capability negotiation, a scoped app-server/MCP bridge, approval mediation, provider-internal tool bypass tests, and OS enforcement evidence on each supported platform |
| M1-09/M1-10 | Live run supervisor, bounded queue/replay, actual provider backpressure, transaction/cancellation barrier, and terminal idempotence                                            |

Native window interaction and Windows execution were not revalidated in this
slice. Neither a real Codex model turn nor OS-level restriction acceptance was run.
