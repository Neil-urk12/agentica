# M1 typed operations and execution boundary

Status: accepted, 2026-10-15.

Reuse protocol version 1, existing transports, bounded requests, UUID identities,
revision-checked text persistence, and SQLite transactions. Add typed operations
without inventing a second mutation path. The first atomic batch implementation
supports text replacement only and checks canvas membership. Unsupported mind-map
operations reject the entire batch before writes. Topic identity is stable and
separate from its title or parent. Initially allow one operation per artifact in
a batch; extend grouping with the mind-map implementation.

Normalize provider events independently of app-server wire messages. Use bounded,
cursor-based pull on the existing RPC with contiguous sequence numbers and the
start request ID. Reserve cancellation/terminal capacity. Cancellation serializes
after any admitted transaction and before any further mutation. Buffer saturation
pauses reads or fails the provider; it never silently drops data.

Treat requested scope as untrusted input. Future tool dispatch must use
runtime-owned grants, approval decisions, and enforcement evidence. No available
CLI version or schema field proves provider-internal tools are restricted.
Execution therefore stays unsupported until a verified bridge exists. OpenRouter
text generation remains independent.

Instruction notes are text artifacts with a persisted purpose. Reuse their
existing editor, save queue, revision, and placement. Keep selection as a local
UI preference. Preserve legacy text with a transactional additive migration.

Implementation results, verification, and follow-up ownership are recorded in
`docs/development/m1-validation.md`.
