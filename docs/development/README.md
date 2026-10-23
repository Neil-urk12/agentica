# Development

Reference for working on Agentica's code. To run the app, see
[Running Agentica](../running.md); for the workflow, see
[CONTRIBUTING.md](../../CONTRIBUTING.md); for the big picture, see
[ARCHITECTURE.md](../../ARCHITECTURE.md).

## Checks

| Command                   | What it checks                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm check`              | Svelte and strict TypeScript                                                                                                             |
| `pnpm lint`               | Oxlint on JavaScript, TypeScript, and Svelte                                                                                             |
| `pnpm format:check`       | Oxfmt formatting of source and Markdown (`pnpm format` fixes it)                                                                         |
| `pnpm check:rust`         | `cargo fmt --check` and Clippy with `-D warnings`, all targets and features                                                              |
| `pnpm test:unit`          | Node unit tests (what CI runs)                                                                                                           |
| `pnpm test:unit:coverage` | Node unit tests with an lcov report at `coverage/js.lcov` (uploaded by the coverage job)                                                 |
| `pnpm test:rust`          | Rust workspace tests                                                                                                                     |
| `pnpm test`               | Everything: builds protocol and frontend, Rust tests with the embedded UI, then all Node tests including the real HTTP and browser tests |
| `pnpm build`              | Protocol, frontend, and an RPC-only debug backend                                                                                        |
| `pnpm build:desktop`      | Release desktop binary (no installer)                                                                                                    |
| `pnpm package:desktop`    | Desktop installers; pass `--bundles` to pick formats ([details](../running.md#installers))                                               |
| `pnpm build:backend`      | Release backend with the embedded UI                                                                                                     |

Notes:

- On a fresh checkout, run `pnpm -r build` before `pnpm check:rust`; the
  all-features build embeds frontend assets.
- `tests/*.test.mjs` import `@agentica/protocol` from its built `dist/`. Rebuild
  it after changing the protocol package.
- `tests/http.test.mjs` starts the real backend on port 1421 and drives Chrome
  (`CHROME_PATH` overrides the browser). Stop any dev backend first.
- Tests use temporary data directories and never call real agents or paid
  providers.

Run a single test:

```sh
cargo test --locked -p agentica-runtime <name_filter>
node --test --test-name-pattern "<regex>" tests/<file>.test.mjs
```

### Git hooks

`pnpm install` sets `core.hooksPath` to `.githooks`. The pre-commit hook runs
`pnpm format:check`, `pnpm lint`, and `cargo fmt --all --check`.

### CI

[GitHub Actions](../../.github/workflows/ci.yml) runs the checks on pull requests
and on pushes to `main` and `develop`: formatting, lint, type checks, frontend
build, and Node unit tests on Linux, then Rust format, Clippy, unit tests, and a
desktop build. The native job runs only when Rust code, Cargo files, the shared
`tests/fixtures` (Rust tests embed them), `package.json`, the pnpm lockfile, or
the workflow change, and always on `main`. It runs on Linux, plus
Windows for `main` and pull requests into `main`. The desktop build is a debug
build except on `main`, which does a release build. A coverage job runs on pushes
to `main` and `develop` only: `cargo llvm-cov` covers the Rust runtime and Node's
built-in coverage covers the unit tests, and both lcov reports are uploaded to
Codecov, which serves the README badge. Uploads use GitHub OIDC, so no token is
stored; the Codecov GitHub App must be installed on the repository. A newer push
to a pull request cancels its running workflow; branch pushes are never
cancelled. Tag pushes run no checks, so tag only commits that passed CI on
`main`. On `vX.Y.Z` tags, the [release workflow](../../.github/workflows/release.yml)
and the [GitLab mirror](../../.gitlab-ci.yml), which runs only on those tags, each
build installers and publish a release
([how to cut one](../running.md#cutting-a-release)).

## Protocol

Every request is a JSON envelope. The schemas are in
[`packages/protocol/src/index.ts`](../../packages/protocol/src/index.ts) and
mirrored in [`contracts.rs`](../../packages/agent-runtime/src/contracts.rs);
[`tests/fixtures`](../../tests/fixtures) holds shared round-trip examples.

```json
{ "protocolVersion": 1, "id": "health-1", "method": "runtime.ping" }
```

```json
{ "protocolVersion": 1, "id": "health-1", "result": { "status": "ok" } }
```

Other methods take `params`:

```json
{
  "protocolVersion": 1,
  "id": "create-1",
  "method": "workspace.create",
  "params": { "name": "Research" }
}
```

- Requests are limited to 16 KiB.
- Mutations name an `expectedRevision` and fail with `CONFLICT` if state moved on.
- Errors for a valid envelope carry the request `id` and a stable code. Invalid
  JSON or an unknown envelope returns an error with a `null` id.

To call the browser-mode backend by hand, start `pnpm dev:backend` and `POST` to
`http://127.0.0.1:1421/rpc` with `Content-Type: application/json`,
`Origin: http://127.0.0.1:1420`, and `Authorization: Bearer <connection key>`.

## Storage

Each workspace is a directory under the data root holding `writer.lock` and
`workspace.sqlite3`. Only the Rust runtime writes them.

- Opening a workspace another process holds fails with `WORKSPACE_LOCKED`.
- A database from a newer or unknown schema fails with `UNSUPPORTED_STORAGE` and
  is left untouched.
- Migrations are `packages/agent-runtime/src/schema_vN.sql`. Bumping the schema
  makes older builds refuse the workspace, so note it in the changelog.

[ADR 0003](../architecture/0003-workspace-storage.md) explains the design.

## Validation records

Manual and end-to-end validation, with dates and evidence:

| Record                                   | Covers                                         |
| ---------------------------------------- | ---------------------------------------------- |
| [Verification index](verification.md)    | Summary of every validation run                |
| [M0-09 Linux](m0-09-linux.md)            | Desktop and browser launch lifecycle on Linux  |
| [M0-11 Linux](m0-11-linux.md)            | Detached delivery and an RPM package prototype |
| [M1 validation](m1-validation.md)        | Typed operations and the execution boundary    |
| [Windows handoff](windows-validation.md) | Steps still to run on Windows                  |

Changes review feedback persistence is validated on Linux (Fedora 44) in browser
mode by the `tests/http.test.mjs` case "review feedback survives browser reload
and backend restart". Desktop restart and close-time flush are not yet validated.

Not yet validated anywhere: Windows lifecycle, installers, and system-wide
package installation.

## Licenses

[rust-backend-notices.md](rust-backend-notices.md) lists the licenses of the
Rust dependencies compiled into the backend. Bundled frontend code is in
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
