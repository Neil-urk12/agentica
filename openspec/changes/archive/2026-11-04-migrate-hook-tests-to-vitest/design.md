## Context

See proposal.md for motivation. The root `tests/` directory holds every JavaScript test. `test:unit` runs `node --test "tests/*.test.mjs"` (147 tests across the four target files today: changes 29, sessions 16, markdown-render 2, editor 100, counting nested subtests), and CI uploads Node's `coverage/js.lcov` with Rust's `coverage/rust.lcov` to Codecov.

The four files load app code through `registerHooks`:

| File              | Hook work                                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `changes`         | add `.ts` to `./changes`, `../changes`, `./review-persistence`; compile `.svelte.ts` (`compileModule`) and `.svelte` (`compile`) with `generate: "server"` |
| `sessions`        | strip types from `sessions.ts`; replace `@xterm/xterm`, `@xterm/addon-fit`, `./session-client`, `./runtime` with `globalThis.sessionTest` stand-ins        |
| `markdown-render` | add `.ts` to `../runtime`, `../markdown`; compile `Markdown.svelte` for the server; transform `runtime.ts`                                                 |
| `editor`          | transform `runtime.ts`, whose constructor parameter property cannot be type-stripped                                                                       |

They also use `node:test` context APIs: `t.after` (editor and sessions, also inside the `setup(t)`, `taskSendSetup(t)`, and `projectSetup(t)` helpers), nested `await t.test(...)` in five editor tests, and one `t.mock.method(globalThis, "fetch", ...)`.

Vite, `@sveltejs/vite-plugin-svelte`, and Svelte resolve only from `apps/desktop`; the repository root currently has only `svelte`, `typescript`, `@types/node`, oxc tools, and the protocol workspace link.

## Goals / Non-Goals

**Goals:**

- No loader hooks, `svelte/compiler`, or `svelte/server` compile calls in the migrated files; the components and modules under test load through Vite.
- The same test cases and assertions, with `node:assert/strict` retained.
- One `pnpm test:unit` entry point that runs both runners and fails if either fails.

**Non-Goals:**

- Sharing `apps/desktop/vite.config.ts` (Tailwind, dev server headers, dependency pre-bundling) with tests.
- DOM environments, client-side component mounting, or `expect`-style rewrites.
- Changing extensionless or `.ts` import conventions in application source.

## Decisions

### 1. Root Vitest config, tests stay in `tests/` with a `.vitest.mjs` suffix

Add `vitest.config.ts` at the repository root with only the Svelte plugin, `environment: "node"`, `include: ["tests/*.vitest.mjs"]`, and `restoreMocks: true`. Rename the four files in place, e.g. `tests/changes.test.mjs` → `tests/changes.vitest.mjs`, so `new URL("../apps/...", import.meta.url)` paths and fixture URLs stay valid and `node --test "tests/*.test.mjs"` does not load Vitest files.

The explicit `include` is required: Vitest's default pattern matches `*.test.mjs` and would try to run the Node files.

Alternatives: configure Vitest inside `apps/desktop`. Rejected because all JavaScript tests and their documented commands live at the root, and `landing` tests would need a second home later. A `tests/vitest/` subdirectory was rejected because it changes every relative path in the moved files.

### 2. Let Vitest's SSR transform replace server compilation

In the `node` environment Vitest transforms modules for SSR, so `vite-plugin-svelte` emits server output for `.svelte` and `.svelte.ts`, matching the hooks' `generate: "server"`. `render` from `svelte/server` and the rune-backed `ChangesManager` therefore behave as they do today. No `svelte.config.js` is used at the root; the current hooks do not preprocess either, and Svelte compiles `<script lang="ts">` itself. Vite resolves extensionless imports and transforms `runtime.ts` parameter properties, which removes the remaining hook work.

Verify this first on `markdown-render`, the smallest component file, before converting the rest (see Risks).

Alternative: point the plugin at `apps/desktop/svelte.config.js` for `vitePreprocess` parity with the app build. Not needed for these files; adopt it only if a component under test needs preprocessing.

### 3. Map `node:test` APIs one-for-one

| `node:test`                                                       | Vitest                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `import { test } from "node:test"`                                | `import { describe, test, vi } from "vitest"` (only what each file uses)             |
| `t.after(fn)`                                                     | `t.onTestFinished(fn)`; helpers keep receiving the test context                      |
| `t.mock.method(globalThis, "fetch", impl)`                        | `vi.spyOn(globalThis, "fetch").mockImplementation(impl)`, restored by `restoreMocks` |
| `test(parent, async (t) => { for (...) await t.test(name, fn) })` | `describe(parent, () => { for (...) test(name, fn) })`                               |

Vitest has no nested tests at runtime. Each of the five editor parents, except one, contains only its loop, and each case builds its own state through `setup(t)` and similar helpers, so it becomes a `describe` without behavior changes. "text creation saves the complete response or reports failure" also checks the frame-boundary arithmetic before its cases. Move its pure fixture computation to the `describe` body and the boundary assertion into its own first test. Tests within a file run sequentially by default, like the current awaited subtests.

### 4. Module mocks for sessions

Replace the four sessions overrides with `vi.mock` factories that keep the existing lazy `globalThis.sessionTest` lookups, e.g. `vi.mock("@xterm/xterm", () => ({ Terminal: globalThis.sessionTest.Terminal }))`. Keep the dynamic `await import(".../sessions.ts")` after `globalThis.sessionTest` is set so factories see the stand-ins. Relative mocks are written relative to the test file (`../apps/desktop/src/lib/session-client.ts`, `../apps/desktop/src/lib/runtime.ts`) and match the modules `sessions.ts` imports. Unlike the hook, a `vi.mock` applies to the whole file's module graph; the sessions file imports nothing else that needs the real modules.

Alternative: `vi.hoisted` with static imports. Rejected as a larger rewrite of the test setup for no behavior gain.

### 5. Dependencies, scripts, and coverage

Add root dev dependencies `vitest`, `@vitest/coverage-v8` (same version as `vitest`), `@sveltejs/vite-plugin-svelte` (`^7.3.1`, matching desktop), and `vite` (`^8.3.4`, matching desktop) so tests and the app use one Vite and one plugin version. Vitest 5.1 accepts Vite 8.

Scripts:

- `test:unit`: existing protocol build and `node --test`, then `vitest run`.
- `test:unit:coverage`: existing Node lcov run, then `vitest run --coverage` with `coverage: { provider: "v8", reporter: ["lcov"], reportsDirectory: "coverage/vitest" }`, producing `coverage/vitest/lcov.info`.
- `test`: add `vitest run` alongside the existing `node --test` invocation.

Add `coverage/vitest/lcov.info` to the Codecov `files:` list in `ci.yml`. The unit CI job already runs `pnpm test:unit`, so it needs no other change.

## Risks / Trade-offs

- [Vitest's node environment emits client rather than server Svelte output] → Convert `markdown-render` first and confirm `render` output and rune behavior. If it fails, stop and revisit this design before converting the other files.
- [Vitest coverage cleans its `reportsDirectory` on each run] → Use `coverage/vitest`, never `coverage`, so `js.lcov` and `rust.lcov` survive.
- [pnpm's release-age policy rejects a just-published Vitest] → Use the newest Vitest 5 release the policy accepts. Do not add `minimumReleaseAgeExclude` entries without asking.
- [Two runners and two coverage reports] → Accepted for this slice; the documented commands say which runner owns which files. Modules imported by both runners appear in both reports, and Codecov merges them.
- [Test inventory silently shrinks during conversion] → Compare per-file test names before and after. Expected Vitest counts: changes 29, sessions 16, markdown-render 2, and editor 96 (100 minus five parent wrappers, plus the split-out boundary test).
- [`vi.mock` scope is wider than the hook's parent-scoped override] → Acceptable for the sessions file's single import; revisit if that file starts importing other app modules.

## Migration Plan

Convert and verify one file at a time in the order markdown-render, sessions, changes, editor, running both runners after each. Rollback is a revert: the Node runner and the remaining files are untouched.
