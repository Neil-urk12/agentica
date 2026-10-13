# Contributing to Agentica

Thanks for taking the time to contribute. This guide reflects how this repo is set up today: a pnpm monorepo with Svelte/TypeScript frontend packages and a shared Rust workspace, so the day-to-day workflow leans on `pnpm`, `cargo`, and this repo's own check commands. Start with the [development guide](docs/development/README.md) for deep technical context. The generic fork-and-PR outline below still applies, but the specifics here are what this project actually uses.

---

## Code of Conduct

By participating in this project, you agree to follow the project's [Code of Conduct](.github/CODE_OF_CONDUCT.md). If you need to report a code of conduct concern, contact the maintainers privately at [neilvallecer12@gmail.com](mailto:neilvallecer12@gmail.com).

---

## Security issues

Do not open public issues, discussions, or social posts for suspected security vulnerabilities. This project asks that security reports be handled privately; see [the security policy](.github/SECURITY.md) for the preferred private reporting path, what to include in a report, and the maintainers' response expectations.

---

## Asking questions and reporting issues

- Before opening a new issue, check whether it has already been reported.
- Use the appropriate issue type when the repo provides templates, and include enough detail to reproduce the behavior.
- For bugs, include a clear title, steps to reproduce, expected vs. actual behavior, and environment details (OS, frontend/browser, Rust toolchain, and relevant launch mode if it matters).
- For feature ideas, open an issue to discuss the proposal before spending time on implementation. The project evolves around its roadmap and current scope, so alignment helps.

---

## Repository layout

Run commands from the repository root.

```text
apps/desktop/              Svelte 5, Svelte Flow, and Vite canvas shell; Tauri 2 native host under src-tauri/
packages/protocol/        TypeScript wire contracts and response validation
packages/agent-runtime/   Shared Rust logic and the detached Axum backend
tests/                    Browser protocol integration checks against Rust
Cargo.toml / Cargo.lock   Rust workspace and reproducible dependency versions
.github/workflows/        Frontend and runtime checks plus native compilation
```

Frontend development uses Node.js 24 and pnpm 11.6.0. Rust work uses stable Rust with rustfmt and Clippy. Desktop builds also need the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). For architectural background on launch modes and runtime lifecycles, consult the [development guide](docs/development/README.md).

---

## Getting started

1. **Install dependencies**

   ```sh
   pnpm install --frozen-lockfile
   ```

2. **Pick a workflow**

   | Goal                                        | How to start                                                |
   | ------------------------------------------- | ----------------------------------------------------------- |
   | Desktop development                         | `pnpm dev`                                                  |
   | Browser development                         | `pnpm dev:backend` and `pnpm dev:web` in separate terminals |
   | Frontend-only work                          | `pnpm dev:web`                                              |
   | Build the frontend and protocol package     | `pnpm --filter @agentica/desktop... build`                  |
   | Build the detached backend with embedded UI | `pnpm build:backend`                                        |
   | Build the native desktop app                | `pnpm build:desktop`                                        |

   The [README](README.md) and [development guide](docs/development/README.md) have full details for each launch mode, connection steps, and shutdown behavior.

3. **Run a quick smoke check**

   ```sh
   pnpm check
   pnpm lint
   pnpm format:check
   ```

   Run `pnpm format` to auto-format supported frontend files and Markdown.

   For Rust:

   ```sh
   pnpm check:rust
   pnpm test:rust
   ```

---

## Making changes

- Keep each change focused on a complete, verifiable development slice. One PR should generally address one concern.
- Work on a branch off the primary branch (`develop`). Use a branch name that reflects the change, for example `feat/short-description` or `fix/short-description`.
- Match the existing conventions in the files you touch. This repo uses Oxfmt for TypeScript/frontend formatting and Oxlint for linting, and the Rust side uses `cargo fmt` and Clippy. Use `pnpm format` to automatically format supported files.
- Test the parts your change touches. Add focused checks for new behavior, handle errors, and preserve permission and revision constraints.
- Update documentation to distinguish planned, implemented, and validated capabilities. Do not describe an experimental build as meeting the public-alpha release contract.
- Because workspace storage and the shared runtime are central to this project, changes that touch persistence, transport, locking, or error contracts should be validated with the existing integration paths rather than only in the frontend.

A typical frontend and shared-protocol change looks like this:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm format
pnpm format:check
pnpm build
```

A change that touches the Rust runtime often needs this:

```sh
pnpm build
pnpm check:rust
pnpm test:rust
```

The top-level `pnpm test` builds the frontend and embedded backend before running the Rust and Node checks, so it is useful when a change crosses layers.

---

## Line endings

Tracked text files use LF endings in both the repository and the working tree.
[`.gitattributes`](.gitattributes) (`* text=auto eol=lf`) enforces this and
overrides Git for Windows' `core.autocrlf=true` default, while
[`.editorconfig`](.editorconfig) declares `end_of_line = lf`. Oxfmt follows
`.editorconfig`, so a CRLF working tree fails `pnpm format:check` for nearly
every file. No per-user Git configuration change is needed once
`.gitattributes` is present.

A fresh clone is already correct. An existing checkout made before
`.gitattributes` was added may still hold CRLF files; renormalize it once. The
commands below rewrite tracked files from the index, so commit or stash your
work first:

```sh
git rm --cached -r .
git reset --hard
pnpm format:check
```

`git add --renormalize .` also normalizes the index, but Git considers a CRLF
file clean and will not rewrite it, so the working tree still needs the removal
and reset above (or a fresh clone). Running `pnpm format` converts only the
files Oxfmt checks; the reset covers the rest, such as Rust, TOML, and
lockfiles. Do not commit CRLF files or weaken the check to work around a
line-ending failure.

---

## Commit style

This repo is far enough along that clear commit messages matter more than enforcing a strict commit-format rule. Write messages that explain what changed and why:

- `fix(runtime): ...`
- `feat(canvas): ...`
- `fix(web): ...`
- `chore(deps): ...`
- `docs: ...`

If a commit lands in this repo, it should be possible to tell from the subject what part of the project it affects.

---

## Pull requests

1. Keep your branch up to date with the primary branch before opening a PR.
2. Push to your fork and open a PR against the primary branch.
3. Fill out the PR description so a reviewer can understand the change without reconstructing it from the diff. Include what changed, why, and how you validated it.
4. Be ready to iterate. Review feedback is part of the process.

Good PRs usually include:

- the scope of the change
- how it behaves in the relevant launch mode(s)
- how it was tested
- any follow-up work needed

---

## Validation you can run before sending

```sh
pnpm check
pnpm lint
pnpm test
pnpm build
pnpm format:check
pnpm check:rust
pnpm test:rust
```

Use `pnpm format` to format supported files before validating. `pnpm test` builds the frontend and embedded debug backend, runs the Rust unit/contract tests, and runs the Node protocol checks. `pnpm check:rust` includes formatting and Clippy across all targets and features. If you are changing frontend assets that the embedded backend serves, build frontend assets before the all-features Rust check. Integration tests use a temporary port and temporary data directories and do not touch your normal workspace storage.

---

## Attribution

By contributing, you agree that your contributions will be licensed under this project's [MIT License](LICENSE). The copyright holder listed in the license is Neil Vallecer.

Keep the primary references visible when discussing inspiration or comparisons. Before reusing third-party code, assets, prompts, or fixtures, review their exact licenses and notices. Record incorporated material and bundled runtime dependencies in an attribution ledger with source URL/revision, license text, copyright/NOTICE obligations, modifications, and distribution location. Support competitive claims with dated, version-specific evidence.

---

If anything here is out of date with the current repository, that is a contribution too: update the docs or open an issue describing what is wrong.
