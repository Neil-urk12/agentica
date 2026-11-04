## 1. Tooling

- [x] 1.1 Record the baseline: run `node --test` on the four target files and save per-file test names (expected counts: changes 29, sessions 16, markdown-render 2, editor 100); verify all pass.
- [x] 1.2 Add root dev dependencies `vitest`, `@vitest/coverage-v8` (same version), `vite` (`^8.3.4`), and `@sveltejs/vite-plugin-svelte` (`^7.3.1`) using the newest Vitest 5 release pnpm's release-age policy accepts; verify `pnpm install` succeeds and `pnpm why vite` shows a single Vite version. Stop and ask if the policy blocks every Vitest 5 release.
- [x] 1.3 Add root `vitest.config.ts` with the Svelte plugin, `environment: "node"`, `include: ["tests/*.vitest.mjs"]`, `restoreMocks: true`, and V8 lcov coverage in `coverage/vitest`; verify `vitest run` collects no `*.test.mjs` file.

## 2. Convert files

- [x] 2.1 Rename `tests/markdown-render.test.mjs` to `tests/markdown-render.vitest.mjs`; delete its hooks and compile calls and import `Markdown.svelte` directly. Verify both cases pass under `vitest run` and that rendered output is server HTML. If Svelte output is not server-mode, stop and revisit design decision 2.
- [x] 2.2 Convert `tests/sessions.test.mjs` to `tests/sessions.vitest.mjs`: replace the hooks with `vi.mock` factories using the existing `globalThis.sessionTest` stand-ins, and `t.after` with `t.onTestFinished`. Verify 16 tests pass.
- [x] 2.3 Convert `tests/changes.test.mjs` to `tests/changes.vitest.mjs`: delete the hooks and `svelte/compiler` calls, import `changes-manager.svelte.ts` and `ChangesView.svelte` directly, and keep the `App.svelte` source extraction unchanged. Verify 29 tests pass.
- [x] 2.4 Convert `tests/editor.test.mjs` to `tests/editor.vitest.mjs`: import `runtime.ts` directly; map `t.after` to `t.onTestFinished` (including in `setup`, `taskSendSetup`, and `projectSetup` callers), `t.mock.method` to `vi.spyOn`, and the five nested-subtest parents to `describe` blocks. Split the text-creation frame-boundary assertion into its own test. Verify 96 tests pass.
- [x] 2.5 Compare Vitest test names with the 1.1 baseline; verify every original case is present (parent wrappers excepted) and the converted files contain no `registerHooks`, `svelte/compiler`, `svelte/server` compile hooks, or `node:test` imports.

## 3. Scripts, CI, and docs

- [x] 3.1 Update root `test:unit`, `test:unit:coverage`, and `test` scripts to run `vitest run` alongside `node --test`; verify `pnpm test:unit` runs both and fails when a Vitest test fails.
- [x] 3.2 Verify `pnpm test:unit:coverage` writes `coverage/js.lcov` and `coverage/vitest/lcov.info`, with the Vitest report covering `changes-manager.svelte.ts`, `sessions.ts`, and `editor.ts`; add `coverage/vitest/lcov.info` to the Codecov `files:` list in `.github/workflows/ci.yml`.
- [x] 3.3 Update `docs/development/README.md` with which runner owns which files and the single-test commands for both; record the rationale in `CHANGELOG.md`.

## 4. Verification

- [x] 4.1 Run `pnpm format:check`, `pnpm lint`, `pnpm check`, and `pnpm test:unit`; report actual results, including any failures or skipped checks.
