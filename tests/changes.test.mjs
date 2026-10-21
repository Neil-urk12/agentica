import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compile, compileModule } from "svelte/compiler";
import { render } from "svelte/server";
import { feedbackMessage } from "../apps/desktop/src/lib/changes.ts";

// Exercise the real rune state and component without a browser or generated files.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === "./changes" ||
      specifier === "../changes" ||
      specifier === "./review-persistence"
    )
      specifier += ".ts";
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const result = nextLoad(
      url,
      url.endsWith(".svelte") ? { ...context, format: "module" } : context,
    );
    if (url.endsWith(".svelte.ts"))
      return {
        ...result,
        format: "module",
        source: compileModule(
          stripTypeScriptTypes(result.source.toString(), { mode: "transform" }),
          { filename: new URL(url).pathname, generate: "server" },
        ).js.code,
      };
    if (url.endsWith(".svelte"))
      return {
        ...result,
        format: "module",
        source: compile(result.source.toString(), {
          filename: new URL(url).pathname,
          generate: "server",
        }).js.code,
      };
    return result;
  },
});
const { ChangesManager } =
  await import("../apps/desktop/src/lib/changes-manager.svelte.ts");
const { default: ChangesView } =
  await import("../apps/desktop/src/lib/components/ChangesView.svelte");
hooks.deregister();

const entry = (path) => ({ path, section: "unstaged", status: "M" });
const hunk = (line, text) => ({
  header: `@@ -${line} +${line} @@`,
  oldStart: line,
  newStart: line,
  lines: [["+", text]],
});

async function setup(savedDisk) {
  const disk = savedDisk ?? {
    status: { state: "ready", entries: [entry("a.ts"), entry("b.ts")] },
    diff: { kind: "text", hunks: [hunk(1, "original")] },
  };
  disk.records ??= new Map();
  disk.revision ??= 1;
  const calls = [];
  const manager = new ChangesManager(async (method, params) => {
    calls.push({ method, ...params });
    if (disk.fail && method.startsWith("changes.review")) throw disk.fail;
    if (method === "changes.review.load") {
      if (params.expectedRevision && params.expectedRevision !== disk.revision)
        throw Object.assign(new Error("Review changed"), { code: "CONFLICT" });
      const records = [...disk.records.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter((r) => !params.after || r.id > params.after);
      return {
        revision: disk.revision,
        record: records[0] ?? null,
        next: records.length > 1 ? records[0].id : null,
      };
    }
    if (method === "changes.review.save") {
      if (params.expectedRevision !== disk.revision)
        throw Object.assign(new Error("Review changed"), { code: "CONFLICT" });
      if (disk.beforeSave) await disk.beforeSave();
      if (params.deleteId) disk.records.delete(params.deleteId);
      if (params.record)
        disk.records.set(params.record.id, structuredClone(params.record));
      return { revision: ++disk.revision };
    }
    return method === "changes.status"
      ? disk.status
      : { diff: disk.diffs?.[params.path] ?? disk.diff };
  });
  const state = manager.get("changes", {
    workspaceId: "workspace",
    canvasId: "canvas",
    projectId: "project",
  });
  await state.refresh();
  return { state, disk, manager, calls };
}

function save(state, comment = "Review this change") {
  state.compose("file");
  state.composeText = comment;
  state.saveDraft();
}

test("loss guards count active composer text without making it pasteable", async () => {
  const { state, manager } = await setup();
  state.compose("file");
  assert.equal(manager.pending(), 0);
  state.composeText = " \n ";
  assert.equal(manager.pending(), 0);
  state.composeText = "Keep this feedback";
  assert.equal(manager.pending(), 1);
  assert.equal(manager.pending(["changes"]), 1);
  assert.equal(manager.pending(["other"]), 0);
  assert.equal(state.unsent, 0);
  state.composing = null;
  assert.equal(manager.pending(), 0);
  save(state);
  assert.equal(manager.pending(), 1);
  state.compose(0);
  state.composeText = "Another comment";
  assert.equal(manager.pending(), 2);
  assert.equal(state.unsent, 1);
  state.markSent(state.drafts.map((draft) => draft.id));
  assert.equal(manager.pending(), 1);
  assert.equal(state.unsent, 0);
  state.saveDraft();
  assert.equal(manager.pending(), 1);
  state.markSent(state.drafts.map((draft) => draft.id));
  assert.equal(manager.pending(), 0);
});

test("file selection saves composer text against its original hunk", async () => {
  const { state, manager } = await setup();
  state.compose(0);
  state.composeText = "Keep this feedback";
  await state.select("unstaged:b.ts");
  assert.equal(manager.pending(), 1);
  assert.equal(state.composing, null);
  assert.equal(state.composeText, "");
  assert.equal(state.drafts[0].path, "a.ts");
  assert.equal(state.drafts[0].hunk.text, "+original");
  assert.equal(state.drafts[0].comment, "Keep this feedback");
  assert.equal(state.drafts[0].outdated, false);
});

test("comment buttons save typed feedback against the previous anchor", async () => {
  for (const [from, to] of [
    ["file", 0],
    [0, "file"],
    [0, 1],
    [0, 0],
  ]) {
    const { state, disk, manager } = await setup();
    disk.diff.hunks.push(hunk(10, "second"));
    state.compose(from);
    const anchor = structuredClone(state.composing);
    state.composeText = "Keep this feedback";
    state.compose(to);
    assert.equal(state.composeText, "");
    assert.equal(state.drafts.length, 1);
    assert.equal(state.drafts[0].comment, "Keep this feedback");
    assert.equal(state.drafts[0].path, anchor.path);
    assert.deepEqual(state.drafts[0].hunk, anchor.hunk);
    assert.equal(manager.pending(), 1);
    assert.equal(
      state.composing.hunk?.text ?? null,
      to === "file" ? null : to === 1 ? "+second" : "+original",
    );
  }
});

test("scope deletion clears feedback only after success and preserves other scopes", async () => {
  const source = readFileSync(
    new URL("../apps/desktop/src/App.svelte", import.meta.url),
    "utf8",
  );
  const helper = source.match(
    /  async function deleteScope\([\s\S]*?\n  \}/,
  )?.[0];
  assert.ok(helper, "scope deletion helper exists");
  for (const canvasId of ["canvas", undefined]) {
    for (const result of [true, false, "error"]) {
      const { state, manager } = await setup();
      save(state);
      const sameWorkspace = manager.get("other-canvas", {
        ...state.scope,
        canvasId: "other",
      });
      sameWorkspace.composing = {
        path: "b.ts",
        section: "unstaged",
        hunk: null,
      };
      sameWorkspace.composeText = "Other canvas feedback";
      const otherWorkspace = manager.get("other-workspace", {
        ...state.scope,
        workspaceId: "other",
      });
      otherWorkspace.composing = {
        path: "c.ts",
        section: "unstaged",
        hunk: null,
      };
      otherWorkspace.composeText = "Other workspace feedback";
      const calls = [];
      const remove = async (...args) => {
        calls.push(args);
        assert.equal(
          manager.pending(),
          3,
          "feedback survives until deletion completes",
        );
        if (result === "error") throw new Error("Deletion failed");
        return result;
      };
      const run = new Function(
        "editor",
        "changes",
        `${stripTypeScriptTypes(helper, { mode: "transform" })}; return deleteScope;`,
      )({ deleteWorkspace: remove, deleteCanvas: remove }, manager);
      if (result === "error") await assert.rejects(run("workspace", canvasId));
      else await run("workspace", canvasId);
      assert.deepEqual(calls, [[canvasId ?? "workspace"]]);
      assert.equal(
        manager.peek("changes"),
        result === true ? undefined : state,
      );
      assert.equal(
        manager.peek("other-canvas"),
        result === true && !canvasId ? undefined : sameWorkspace,
      );
      assert.equal(manager.peek("other-workspace"), otherWorkspace);
      assert.equal(manager.pending(), result === true ? (canvasId ? 2 : 1) : 3);
    }
  }
});

test("refresh checks unselected hunk anchors once per file without changing selection", async () => {
  const { state, disk, calls } = await setup();
  state.compose(0);
  state.composeText = "First comment";
  state.saveDraft();
  state.compose(0);
  state.composeText = "Second comment";
  state.saveDraft();
  save(state, "Whole-file comment");
  await state.select("unstaged:b.ts");
  disk.diffs = { "a.ts": { kind: "text", hunks: [hunk(1, "replacement")] } };
  calls.length = 0;
  await state.refresh();
  assert.equal(state.selected, "unstaged:b.ts");
  assert.deepEqual(
    state.drafts.map((draft) => draft.outdated),
    [true, true, false],
  );
  assert.equal(state.diff.hunks[0].lines[0][1], "original");
  assert.deepEqual(
    calls
      .filter((call) => call.method === "changes.diff")
      .map((call) => call.path)
      .sort(),
    ["a.ts", "b.ts"],
  );
});

test("native close flushes drafts and composer text before session shutdown", async () => {
  const source = readFileSync(
    new URL("../apps/desktop/src/App.svelte", import.meta.url),
    "utf8",
  );
  const body = source.match(
    /\.onCloseRequested\(async \(event\) => \{([\s\S]*?)\n {8}\}\)/,
  )?.[1];
  assert.ok(body, "native close callback is registered");
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const close = new AsyncFunction(
    "event",
    "editorState",
    "pendingReply",
    "closing",
    "closeNotice",
    "invoke",
    "getCurrentWindow",
    "changes",
    "window",
    body,
  );
  for (const kind of ["draft", "composer", "none"]) {
    for (const discard of [false, true]) {
      const { state, manager } = await setup();
      if (kind === "draft") save(state);
      if (kind === "composer") {
        state.compose("file");
        state.composeText = "Keep this feedback";
      }
      const calls = [];
      await close(
        { preventDefault() {} },
        { dirty: false, saving: false },
        false,
        false,
        "",
        async (command) => calls.push(command),
        () => ({
          async destroy() {
            calls.push("destroy");
          },
        }),
        manager,
        {
          confirm(message) {
            assert.match(message, /unsaved feedback/);
            calls.push("confirm");
            return discard;
          },
        },
      );
      assert.deepEqual(
        calls,
        ["session_shutdown", "destroy"],
        `${kind}, discard=${discard}`,
      );
    }
  }
  for (const discard of [false, true]) {
    const { state, manager, disk } = await setup();
    state.compose("file");
    state.composeText = "Unsaved";
    disk.fail = new Error("Disk offline");
    const calls = [];
    await close(
      { preventDefault() {} },
      { dirty: false, saving: false },
      false,
      false,
      "",
      async (command) => calls.push(command),
      () => ({
        async destroy() {
          calls.push("destroy");
        },
      }),
      manager,
      {
        confirm(message) {
          assert.match(message, /unsaved feedback/);
          calls.push("confirm");
          return discard;
        },
      },
    );
    assert.deepEqual(
      calls,
      discard ? ["confirm", "session_shutdown", "destroy"] : ["confirm"],
    );
    assert.equal(state.composeText, "Unsaved");
  }
});

const appSource = readFileSync(
  new URL("../apps/desktop/src/App.svelte", import.meta.url),
  "utf8",
);
const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
const appFunction = (name, ...params) =>
  new AsyncFn(
    ...params,
    stripTypeScriptTypes(
      appSource.match(
        new RegExp(
          `async function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}\\n`,
        ),
      )[0],
    ).replace(/^[^{]*\{|\}\s*$/g, ""),
  );

test("in-app navigation flushes feedback and keeps it unless discarded", async () => {
  const settle = appFunction(
    "settle",
    "generating",
    "pendingReply",
    "editorState",
    "editor",
    "changes",
    "window",
  );
  const run = (manager, confirm) =>
    settle(
      false,
      false,
      {
        dirty: false,
        document: { canvas: { id: "canvas" } },
        workspace: { workspace: { id: "workspace" } },
      },
      {},
      manager,
      { confirm },
    );
  const ok = await setup();
  save(ok.state, "Saved before leaving");
  assert.equal(await run(ok.manager, () => assert.fail("no prompt")), true);
  assert.equal(ok.disk.records.size, 1);
  for (const discard of [false, true]) {
    const { state, manager, disk } = await setup();
    save(state, "Unsaved");
    disk.fail = new Error("Disk offline");
    assert.equal(await run(manager, () => discard), discard);
    assert.equal(manager.peek("changes") === state, !discard);
    assert.equal(state.drafts[0].comment, "Unsaved");
  }
});

test("removal warns about saved and unloaded feedback and retains it when cancelled", async () => {
  const removeObject = appFunction(
    "removeObject",
    "id",
    "editorState",
    "changes",
    "editor",
    "window",
    "requestRemoval",
  );
  const document = {
    canvas: { id: "canvas" },
    projectGroups: [],
    sessionTiles: [{ id: "changes", kind: "changes", projectId: "project" }],
  };
  const run = async (manager, answer) => {
    const prompts = [];
    const deleted = [];
    await removeObject(
      "changes",
      { document, workspace: { workspace: { id: "workspace" } } },
      manager,
      { deleteSessionTile: async (id) => deleted.push(id) },
      { confirm: (m) => (prompts.push(m), answer) },
      async () => assert.fail("Changes tiles have no sessions"),
    );
    return { prompts, deleted };
  };
  // Saved (acknowledged) feedback still warns, even before its tile was opened.
  const saved = await setup();
  save(saved.state, "Persisted");
  await saved.state.flush();
  saved.state.dispose();
  const fresh = await setup(saved.disk);
  fresh.manager.forget("changes");
  let result = await run(fresh.manager, false);
  assert.match(result.prompts[0], /Discard 1 unsent feedback item/);
  assert.deepEqual(result.deleted, []);
  assert.equal(fresh.disk.records.size, 1);
  result = await run(fresh.manager, true);
  assert.deepEqual(result.deleted, ["changes"]);
  // Unloadable feedback is never deleted silently.
  const offline = await setup(saved.disk);
  offline.manager.forget("changes");
  offline.disk.fail = new Error("Offline");
  result = await run(offline.manager, false);
  assert.match(result.prompts[0], /could not be checked/);
  assert.deepEqual(result.deleted, []);
});

test("saves racing successful deletion settle without resurrecting state", async () => {
  const { state, disk, manager } = await setup();
  let release;
  disk.beforeSave = async () => {
    await new Promise((r) => (release = r));
    throw new Error("Owner deleted");
  };
  save(state, "In flight");
  const saving = state.flush();
  await new Promise((r) => setTimeout(r));
  manager.forget("changes");
  release();
  assert.equal(await saving, true);
  assert.equal(state.saveError, "");
  assert.equal(manager.peek("changes"), undefined);
  assert.equal(manager.unsaved(), false);
});

test("refresh cannot move an open comment onto another file", async () => {
  const { state, disk } = await setup();
  state.compose("file");
  state.composeText = "Written about a.ts";
  disk.status.entries = [entry("b.ts")];
  await state.refresh();
  assert.equal(state.selected, "unstaged:b.ts");
  state.saveDraft();
  assert.equal(state.drafts[0].path, "a.ts");
  assert.equal(state.drafts[0].comment, "Written about a.ts");
  assert.equal(state.drafts[0].outdated, true);
});

test("a refreshed hunk at the same index cannot replace a composer's anchor", async () => {
  const { state, disk } = await setup();
  state.compose(0);
  state.composeText = "Written about the original hunk";
  disk.diff = { kind: "text", hunks: [hunk(10, "replacement")] };
  await state.refresh();
  state.saveDraft();
  assert.deepEqual(state.drafts[0].hunk, {
    header: "@@ -1 +1 @@",
    range: "@@ -1 +1 @@",
    text: "+original",
  });
  assert.equal(state.drafts[0].outdated, true);
});

test("an unchanged hunk stays current when refresh moves its index", async () => {
  const { state, disk } = await setup();
  state.compose(0);
  state.composeText = "Still applies";
  disk.diff.hunks = [hunk(10, "another"), ...disk.diff.hunks];
  await state.refresh();
  state.saveDraft();
  assert.equal(state.drafts[0].hunk.text, "+original");
  assert.equal(state.drafts[0].outdated, false);
});

test("paste completion marks only submitted IDs, leaving newer feedback unsent", async () => {
  const { state } = await setup();
  save(state, "Submitted comment");
  const drafts = state.drafts.filter((draft) => !draft.sent);
  const ids = drafts.map((draft) => draft.id);
  const submitted = feedbackMessage(drafts);
  let complete;
  const pending = new Promise((resolve) => (complete = resolve)).then(() =>
    state.markSent(ids),
  );
  save(state, "Added during paste");
  complete();
  await pending;
  assert.equal(state.drafts[0].sent, true);
  assert.equal(state.drafts[1].sent, false);
  assert.equal(state.unsent, 1);
  assert.doesNotMatch(submitted, /Added during paste/);
  assert.match(feedbackMessage(state.drafts), /Added during paste/);
  assert.doesNotMatch(feedbackMessage(state.drafts), /Submitted comment/);
});

const targets = [{ owner: { tileId: "codex" }, label: "Codex" }];

test("restart restores ordered feedback, Sent flags and exact composer text", async () => {
  const { state, disk } = await setup();
  state.compose(0);
  state.composeText = "First hunk";
  state.saveDraft();
  save(state, "Second file");
  state.markSent([state.drafts[0].id]);
  state.compose(0);
  state.composeText = "  unfinished\n ";
  assert.equal(await state.flush(), true);
  state.dispose();
  const reopened = (await setup(disk)).state;
  assert.deepEqual(
    reopened.drafts.map((r) => [r.comment, r.sent]),
    [
      ["First hunk", true],
      ["Second file", false],
    ],
  );
  assert.equal(reopened.composeText, "  unfinished\n ");
  assert.equal(reopened.composing.path, "a.ts");
  // Recovered from the matching fingerprint once the diff loads.
  assert.equal(reopened.composing.hunk.text, "+original");
  assert.match(reopened.composing.hunk.fingerprint, /^[a-f0-9]{64}$/);
  reopened.saveDraft();
  assert.equal(await reopened.flush(), true);
  assert.equal(disk.records.has("composer"), false);
  assert.equal(disk.records.size, 3);
  reopened.dispose();
});

test("restored hunk fingerprints revalidate across changed and unavailable Git", async () => {
  const { state, disk } = await setup();
  state.compose(0);
  state.composeText = "Original anchor";
  state.saveDraft();
  await state.flush();
  state.dispose();
  disk.diff = { kind: "text", hunks: [hunk(1, "replacement")] };
  const reopened = (await setup(disk)).state;
  assert.equal(reopened.drafts[0].outdated, true);
  assert.equal(reopened.drafts[0].unverified, false);
  await reopened.flush();
  reopened.dispose();
  disk.status = { state: "folderUnavailable" };
  const unavailable = (await setup(disk)).state;
  assert.equal(unavailable.drafts[0].comment, "Original anchor");
  assert.equal(unavailable.drafts[0].outdated, true);
  unavailable.dispose();
});

test("failed hydration never overwrites saved records; retry restores them", async () => {
  const { state, disk } = await setup();
  save(state, "Keep on disk");
  await state.flush();
  state.dispose();
  disk.fail = new Error("Offline");
  const reopened = (await setup(disk)).state;
  assert.equal(reopened.hydrated, false);
  reopened.compose("file");
  reopened.composeText = "Cannot replace unknown data";
  // Nothing local to save, so leaving is not blocked.
  assert.equal(await reopened.flush(), true);
  assert.equal(reopened.dirty, false);
  assert.equal(disk.records.size, 1);
  disk.fail = null;
  await reopened.retrySave();
  assert.equal(reopened.drafts[0].comment, "Keep on disk");
  reopened.dispose();
});

test("failed and oversized saves retain local edits; retry saves without paste", async () => {
  const { state, disk, manager, calls } = await setup();
  state.compose("file");
  state.composeText = "Keep locally";
  disk.fail = new Error("Disk unavailable");
  assert.equal(await state.flush(), false);
  assert.equal(manager.unsaved(), true);
  assert.equal(state.composeText, "Keep locally");
  disk.fail = null;
  assert.equal(await state.retrySave(), true);
  assert.equal(manager.unsaved(), false);
  state.composeText = "😀".repeat(1001);
  assert.equal(await state.flush(), false);
  assert.equal(state.composeText.length, 2002);
  state.composeText = "Fits again";
  assert.equal(await state.retrySave(), true);
  assert.equal(disk.records.get("composer").comment, "Fits again");
  assert.ok(calls.every((c) => c.method.startsWith("changes.")));
  state.dispose();
});

test("late acknowledgements do not mark newer typing Saved", async () => {
  const { state, disk } = await setup();
  let started, release;
  const waiting = new Promise((r) => (started = r));
  const gate = new Promise((r) => (release = r));
  disk.beforeSave = async () => {
    started();
    await gate;
    disk.beforeSave = null;
  };
  state.compose("file");
  state.composeText = "Old";
  const saving = state.flush();
  await waiting;
  state.composeText = "Newer";
  assert.equal(state.dirty, true);
  release();
  assert.equal(await saving, true);
  assert.equal(disk.records.get("composer").comment, "Newer");
  assert.equal(state.dirty, false);
  state.dispose();
});

test("conflicts preserve local text and newer persisted feedback", async () => {
  const { state, disk } = await setup();
  state.compose("file");
  state.composeText = "Original";
  await state.flush();
  disk.records.get("composer").comment = "Other client";
  disk.revision++;
  state.composeText = "My local edit";
  assert.equal(await state.flush(), false);
  assert.equal(state.conflicted, true);
  assert.match(state.recoveryText(), /My local edit/);
  assert.equal(await state.retrySave(), undefined);
  assert.equal(disk.records.get("composer").comment, "Other client");
  await state.reloadReview();
  assert.equal(state.composeText, "Other client");
  state.dispose();
});

test("paste status save failures retry persistence without replaying delivery", async () => {
  const { state, disk, calls } = await setup();
  save(state, "Pasted");
  await state.flush();
  state.markSent([state.drafts[0].id]);
  disk.fail = new Error("Disk offline");
  assert.equal(await state.flush(), false);
  assert.equal(state.unsent, 0);
  disk.fail = null;
  await state.retrySave();
  assert.equal([...disk.records.values()][0].sent, true);
  assert.ok(calls.every((c) => c.method.startsWith("changes.")));
  state.dispose();
});

test("clearing composer and Sent comments remains cleared after restart", async () => {
  const { state, disk } = await setup();
  save(state, "Sent");
  state.markSent([state.drafts[0].id]);
  state.compose("file");
  state.composeText = "Cancel this";
  await state.flush();
  state.cancelCompose();
  state.clearSent();
  await state.flush();
  state.dispose();
  const reopened = (await setup(disk)).state;
  assert.equal(reopened.drafts.length, 0);
  assert.equal(reopened.composing, null);
  reopened.dispose();
});
function view(state, layout) {
  return render(ChangesView, {
    props: {
      uid: "changes",
      state,
      layout,
      targets,
      pasting: false,
      onPaste() {},
    },
  }).body;
}

for (const layout of ["tile", "overlay"]) {
  test(`${layout}: a clean refresh preserves drafts, preview, and paste controls`, async () => {
    const { state, disk } = await setup();
    save(state, "Keep this feedback");
    state.previewing = true;
    disk.status.entries = [];
    await state.refresh();
    const html = view(state, layout);
    assert.match(html, /working tree is clean/);
    assert.match(html, /Keep this feedback/);
    assert.match(html, /Remove comment/);
    assert.match(html, /Outdated/);
    assert.match(html, /Message preview/);
    assert.match(html, /Paste into Codex/);
    assert.equal(state.unsent, 1);
  });

  test(`${layout}: a removed file's open composer stays accessible and saveable`, async () => {
    const { state, disk } = await setup();
    state.compose(0);
    state.composeText = "Unsaved feedback";
    disk.status.entries = [];
    await state.refresh();
    const html = view(state, layout);
    assert.match(html, /Unsaved feedback/);
    assert.match(html, /a.ts/);
    assert.match(html, /@@ -1 \+1 @@/);
    assert.match(html, /Add comment/);
    state.saveDraft();
    assert.equal(state.drafts[0].path, "a.ts");
    assert.equal(state.drafts[0].hunk.text, "+original");
    assert.equal(state.drafts[0].outdated, true);
  });

  test(`${layout}: a restored composer attaches inline only when its fingerprint matches`, async () => {
    const { state, disk } = await setup();
    state.compose(0);
    state.composeText = "Restored feedback";
    await state.flush();
    state.dispose();
    const inline = (await setup(disk)).state;
    const html = view(inline, layout);
    assert.ok(html.search(/class="composer/) > html.search(/class="file-bar/));
    inline.dispose();
    disk.diff = { kind: "text", hunks: [hunk(1, "replacement")] };
    const reopened = (await setup(disk)).state;
    assert.equal(reopened.composing.hunk.text, undefined);
    const detached = view(reopened, layout);
    assert.ok(
      detached.search(/class="composer/) < detached.search(/class="file-bar/),
    );
    reopened.saveDraft();
    assert.equal(reopened.drafts.at(-1).outdated, true);
    reopened.dispose();
  });
}
