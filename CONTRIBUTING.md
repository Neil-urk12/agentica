# Contributing to Agentica

Agentica is a pnpm and Cargo monorepo: a Svelte/TypeScript frontend and a shared
Rust runtime. Read [ARCHITECTURE.md](ARCHITECTURE.md) first to see how the parts
fit.

By participating you agree to the [Code of Conduct](.github/CODE_OF_CONDUCT.md).
Report conduct concerns privately to
[neilvallecer12@gmail.com](mailto:neilvallecer12@gmail.com).

**Security issues:** do not open a public issue. Follow the
[security policy](.github/SECURITY.md).

## Issues

Search existing issues first, then use a template:

- [Bug report](.github/ISSUE_TEMPLATE/BUG_REPORT.yaml): steps, expected and actual
  behavior, OS, browser or desktop, and launch mode.
- [Feature request](.github/ISSUE_TEMPLATE/FEATURE_REQUEST.yaml): open one before
  writing code so the scope can be agreed.

## Setup

You need Node.js 24, pnpm 11.6.0, and stable Rust with rustfmt and Clippy. Desktop
work also needs the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
pnpm install --frozen-lockfile   # also enables the pre-commit hook
pnpm dev                         # desktop app
```

[Running Agentica](docs/running.md) lists every launch mode.

## Layout

```text
apps/desktop/             Svelte UI (src/) and the Tauri host (src-tauri/)
apps/landing/             Static marketing page
packages/protocol/        Zod wire schemas shared by the UI and tests
packages/agent-runtime/   Rust runtime and the browser-mode Axum backend
tests/                    Node tests, including real backend and browser tests
openspec/                 Spec-driven change proposals
docs/                     User guide, running, ADRs, development reference
```

## Making a change

1. Branch off `develop`: `feat/<short-name>`, `fix/<short-name>`, or
   `docs/<short-name>`.
2. Keep one concern per branch. For a sizable feature, start with an
   [OpenSpec](openspec/) change (proposal, design, specs, tasks) and archive it
   when done.
3. Match the code around you. Formatting and lint are enforced: Oxfmt and Oxlint
   for the frontend, `cargo fmt` and Clippy for Rust.
4. Add tests for new behavior. Changes to storage, transport, locking, or error
   codes need a runtime or HTTP test, not only a frontend one. Keep the TypeScript
   schemas and `contracts.rs` in sync and update `tests/fixtures` when the wire
   shape changes.
5. Update the docs (below).

## Checks

Before pushing:

```sh
pnpm format          # fix formatting
pnpm check
pnpm lint
pnpm check:rust      # on a fresh checkout run `pnpm -r build` first
pnpm test            # full suite; stop any dev backend on port 1421 first
```

[docs/development](docs/development/README.md) explains each check and how to run
a single test.

## Updating the docs

| When you…                                    | Update                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Change anything users or contributors notice | [CHANGELOG.md](CHANGELOG.md), under `Unreleased` with today's date: what changed and why           |
| Add or change a feature                      | [docs/user-guide.md](docs/user-guide.md) and the feature table in [README.md](README.md)           |
| Change components, transports, or boundaries | [ARCHITECTURE.md](ARCHITECTURE.md); add an [ADR](docs/architecture/README.md) for a major decision |
| Change commands, ports, or build steps       | [docs/running.md](docs/running.md) or [docs/development](docs/development/README.md)               |
| Validate on a platform                       | A record under [docs/development](docs/development/README.md#validation-records)                   |

Say whether a capability is **planned**, **implemented**, or **validated** (tested
end to end, with the platform named). Don't describe untested behavior as working.

## Line endings

Tracked files use LF (`.gitattributes` and `.editorconfig` enforce it). A
checkout made before `.gitattributes` existed may still have CRLF files, which
fail `pnpm format:check`. Fix it once, after committing or stashing your work:

```sh
git rm --cached -r .
git reset --hard
```

## Commits and pull requests

Write [Conventional Commits](https://www.conventionalcommits.org/) with a scope:
`feat(canvas): …`, `fix(runtime): …`, `docs: …`, `chore(deps): …`. The subject
should say which part of the project changed.

Open the PR against `main` and fill in the
[template](.github/PULL_REQUEST_TEMPLATE.md): what changed, why, which launch
modes it affects, how you tested it, and any follow-up. Rebase onto the base
branch to resolve conflicts.

## License

Contributions are licensed under the [MIT License](LICENSE). Before adding
third-party code, assets, prompts, or fixtures, check their licenses and record
them in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
