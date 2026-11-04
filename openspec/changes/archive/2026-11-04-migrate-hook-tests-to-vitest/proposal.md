## Why

Four Node unit test files carry hand-written `node:module` loader hooks that re-implement what Vite already does for the app: resolving extensionless imports, compiling `.svelte` and `.svelte.ts` files for the server, transforming non-erasable TypeScript, and swapping modules for test doubles. Each new component or rune module under test needs another hook branch. Running these files under Vitest with the app's existing Svelte plugin removes that loader code and makes the next component test a plain import.

## What Changes

- Run `tests/changes`, `tests/sessions`, `tests/markdown-render`, and `tests/editor` under Vitest instead of `node --test`, renamed so the existing `node --test "tests/*.test.mjs"` glob does not pick them up.
- Delete their `registerHooks` loaders and `svelte/compiler` calls; import components, rune modules, and `runtime.ts` directly. Replace the sessions module overrides with Vitest module mocks.
- Convert the `node:test` APIs these files use (test-context cleanup, nested subtests, method mocks) to Vitest equivalents. Keep `node:assert/strict` assertions and test bodies unchanged otherwise.
- Keep every other `tests/*.test.mjs` and all `*.browser.mjs` tests on `node --test`. Source-text extraction from `App.svelte` inside `changes` moves with the file unchanged.
- Run both runners from `test:unit`, `test:unit:coverage`, and `test`; upload Vitest coverage alongside the existing Node and Rust reports.
- Add root dev dependencies for Vitest, Vite, the Svelte Vite plugin, and V8 coverage.

Non-goals: migrating the other 19 Node unit files or the browser tests, rewriting `composer-microphone`/`speech-worker`/`App.svelte` source extraction, mounting components in a DOM environment, changing application source, or replacing `node:assert` with `expect`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This changes test tooling only; no product behavior or spec requirement changes, so the change sets `skip_specs: true`.

## Impact

- `tests/changes.test.mjs`, `tests/sessions.test.mjs`, `tests/markdown-render.test.mjs`, `tests/editor.test.mjs`: renamed and converted to Vitest.
- New root `vitest.config.ts`.
- Root `package.json`: `test:unit`, `test:unit:coverage`, and `test` scripts; dev dependencies `vitest`, `vite`, `@sveltejs/vite-plugin-svelte`, `@vitest/coverage-v8`; `pnpm-lock.yaml`.
- `.github/workflows/ci.yml`: add the Vitest lcov file to the Codecov upload.
- `docs/development/README.md`: test layout and single-test commands. Record the rationale in `CHANGELOG.md` when applying.
- No application, runtime, protocol, or Rust changes.
