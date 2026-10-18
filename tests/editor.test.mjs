import assert from "node:assert/strict";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { LIMITS, MAX_FRAME_BYTES } from "@agentica/protocol";
import { Editor } from "../apps/desktop/src/lib/editor.ts";
import { stageOperations } from "../apps/desktop/src/lib/canvas-agent.ts";

// The runtime's TypeScript parameter property needs transformation, not stripping.
const runtimeUrl = new URL(
  "../apps/desktop/src/lib/runtime.ts",
  import.meta.url,
);
const hooks = registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    return url === runtimeUrl.href
      ? {
          ...result,
          format: "module",
          source: stripTypeScriptTypes(result.source.toString(), {
            mode: "transform",
          }),
        }
      : result;
  },
});
const { callRuntime } = await import(runtimeUrl.href);
hooks.deregister();

const workspaceId = "00000000-0000-4000-8000-000000000001";
const canvasId = "00000000-0000-4000-8000-000000000002";
const nodeId = "00000000-0000-4000-8000-000000000003";
const artifactId = "00000000-0000-4000-8000-000000000004";

async function setup(t, intercept = async () => {}) {
  let disk = {
    canvas: {
      id: canvasId,
      title: "Plan",
      revision: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    nodes: [{ id: nodeId, artifactId, x: 10, y: 20, width: 240, height: 160 }],
    edges: [],
    artifacts: [
      {
        id: artifactId,
        type: "text",
        schemaVersion: 1,
        revision: 1,
        text: "Original",
      },
    ],
  };
  const calls = [];
  let sequence = 0;
  // The stub owns the lists the runtime would return after a delete.
  let workspaceList = [{ id: workspaceId, name: "Work" }];
  let canvasList = [{ id: canvasId, title: "Plan" }];
  const call = async (_key, _connect, method, params) => {
    calls.push({ method, params });
    await intercept(method, params);
    if (method === "workspace.list")
      return { workspaces: structuredClone(workspaceList) };
    if (method === "conversation.list") return { turns: [], nextBefore: 0 };
    if (method === "workspace.delete") {
      workspaceList = workspaceList.filter(
        (workspace) => workspace.id !== params.workspaceId,
      );
      return { workspaces: structuredClone(workspaceList) };
    }
    if (method === "canvas.delete") {
      canvasList = canvasList.filter((canvas) => canvas.id !== params.canvasId);
      return { canvases: structuredClone(canvasList) };
    }
    if (method === "workspace.open")
      return {
        workspace: { id: workspaceId, name: "Work" },
        canvases: structuredClone(canvasList),
      };
    if (method === "workspace.close") return {};
    if (method === "node.createDrawing" || method === "node.createText") {
      assert.equal(params.expectedRevision, disk.canvas.revision);
      sequence += 1;
      const node = {
        id: `00000000-0000-4000-8000-${String(100 + sequence).padStart(12, "0")}`,
        artifactId: `00000000-0000-4000-8000-${String(200 + sequence).padStart(12, "0")}`,
        x: params.x,
        y: params.y,
        width: params.width,
        height: params.height,
      };
      const artifact = {
        id: node.artifactId,
        type: method === "node.createDrawing" ? "drawing" : "text",
        schemaVersion: 1,
        revision: 1,
        ...(method === "node.createDrawing"
          ? { drawing: params.drawing }
          : { text: params.text }),
      };
      disk.nodes = [...disk.nodes, node];
      disk.artifacts = [...disk.artifacts, artifact];
      disk.canvas = { ...disk.canvas, revision: params.expectedRevision + 1 };
      return {
        revision: disk.canvas.revision,
        node: structuredClone(node),
        artifact: structuredClone(artifact),
      };
    }
    if (method === "node.delete") {
      assert.equal(params.expectedRevision, disk.canvas.revision);
      const node = disk.nodes.find((item) => item.id === params.nodeId);
      if (!node) throw new Error("NOT_FOUND: Node on this canvas");
      disk.nodes = disk.nodes.filter((item) => item.id !== params.nodeId);
      const retained = new Set(disk.nodes.map((item) => item.artifactId));
      disk.artifacts = disk.artifacts.filter((item) => retained.has(item.id));
      disk.canvas = { ...disk.canvas, revision: params.expectedRevision + 1 };
      return { revision: disk.canvas.revision };
    }
    if (method === "edge.create") {
      assert.equal(params.expectedRevision, disk.canvas.revision);
      sequence += 1;
      const edge = {
        id: `00000000-0000-4000-8000-${String(300 + sequence).padStart(12, "0")}`,
        kind: params.kind,
        sourceNodeId: params.sourceNodeId,
        targetNodeId: params.targetNodeId,
      };
      disk.edges = [...disk.edges, edge];
      disk.canvas = { ...disk.canvas, revision: params.expectedRevision + 1 };
      return { revision: disk.canvas.revision, edge: structuredClone(edge) };
    }
    if (method === "canvas.open") return structuredClone(disk);
    if (method === "artifact.saveText") {
      assert.equal(params.expectedRevision, disk.artifacts[0].revision);
      disk.artifacts[0] = {
        ...disk.artifacts[0],
        text: params.text,
        revision: params.expectedRevision + 1,
      };
      return { artifact: structuredClone(disk.artifacts[0]) };
    }
    if (method === "canvas.save") {
      assert.equal(params.expectedRevision, disk.canvas.revision);
      disk.canvas = {
        ...disk.canvas,
        viewport: params.viewport,
        revision: params.expectedRevision + 1,
      };
      disk.nodes = disk.nodes.map((node) => ({
        ...node,
        ...params.nodes.find((item) => item.id === node.id),
      }));
      for (const collection of ["projectGroups", "sessionTiles"])
        if (params[collection])
          disk[collection] = disk[collection].map((item) => {
            const { expectedRevision, ...layout } = params[collection].find(
              (p) => p.id === item.id,
            );
            assert.equal(expectedRevision, item.revision);
            return { ...item, ...layout, revision: item.revision + 1 };
          });
      return { revision: disk.canvas.revision };
    }
    throw new Error(`Unexpected method ${method}`);
  };
  const editor = new Editor(
    call,
    () => "",
    () => {},
  );
  t.after(() => editor.dispose());
  await editor.openWorkspace(workspaceId);
  await editor.openCanvas(canvasId);
  return { editor, calls, disk, call };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function projectSetup(t, intercept) {
  const fixture = await setup(t, intercept);
  const group = (id, x) => ({
    id,
    root: "/tmp/example",
    label: "example",
    available: true,
    x,
    y: 10,
    width: 800,
    height: 700,
    collapsed: false,
    revision: 1,
  });
  fixture.disk.projectGroups = [
    group("00000000-0000-4000-8000-000000000005", 30),
    group("00000000-0000-4000-8000-000000000006", 900),
  ];
  fixture.disk.sessionTiles = [
    {
      id: "00000000-0000-4000-8000-000000000007",
      projectId: fixture.disk.projectGroups[0].id,
      kind: "shell",
      preset: null,
      x: 16,
      y: 96,
      width: 576,
      height: 440,
      revision: 1,
    },
  ];
  await fixture.editor.openCanvas(canvasId);
  return fixture;
}

test("a rejected project folder does not block a corrected retry", async (t) => {
  const { editor, calls } = await projectSetup(t, async (method, params) => {
    if (method === "project.open" && params.path === "/missing")
      throw new Error("This directory is unavailable.");
  });
  assert.equal(await editor.openProject("/missing"), undefined);
  assert.match(editor.state.error, /unavailable/);
  assert.equal(editor.state.dirty, false);
  // The fixture does not implement project.open, so the retry fails after reaching it.
  await editor.openProject("/tmp/example");
  assert.deepEqual(
    calls
      .filter((call) => call.method === "project.open")
      .map((call) => call.params.path),
    ["/missing", "/tmp/example"],
  );
});

test("project layout keeps duplicate roots independent and children relative across save and reopen", async (t) => {
  const { editor, disk, calls } = await projectSetup(t);
  const [first, second] = disk.projectGroups;
  const tile = disk.sessionTiles[0];
  editor.placeProject(first.id, { x: 150, y: 240, collapsed: true });
  editor.placeProject(first.id, { width: 20, height: 20 });
  editor.placeSessionTile(tile.id, { x: 9999, y: -50 });
  const draft = editor.state.document;
  assert.equal(draft.projectGroups[0].width, 608);
  assert.equal(draft.projectGroups[0].height, 552);
  assert.equal(draft.sessionTiles[0].x, 16);
  assert.equal(draft.sessionTiles[0].y, 96);
  assert.equal(draft.sessionTiles[0].projectId, first.id);
  assert.deepEqual(draft.projectGroups[1], second);
  await editor.save();
  await editor.openCanvas(canvasId);
  assert.equal(editor.state.document.projectGroups[0].collapsed, true);
  assert.equal(editor.state.document.projectGroups[0].x, 150);
  assert.equal(editor.state.document.projectGroups[0].height, 552);
  assert.equal(editor.state.document.sessionTiles[0].revision, 2);
  assert.ok(calls.every((call) => !call.method.startsWith("session.")));
});

test("project save failures retain drafts and retry refuses unknown remote layout or association", async (t) => {
  for (const change of ["none", "layout", "root"])
    await t.test(change, async (t) => {
      let fail = true;
      const { editor, disk } = await projectSetup(t, async (method) => {
        if (method === "canvas.save" && fail) {
          fail = false;
          throw new Error("lost transport");
        }
      });
      const id = disk.projectGroups[0].id;
      editor.placeProject(id, { x: 99 });
      await editor.save();
      assert.equal(editor.state.dirty, true);
      assert.equal(editor.state.document.projectGroups[0].x, 99);
      if (change === "layout") disk.projectGroups[0].x = 777;
      if (change === "root") disk.projectGroups[0].root = "/other";
      await editor.retrySave();
      if (change === "none") {
        assert.equal(editor.state.error, "");
        assert.equal(disk.projectGroups[0].x, 99);
      } else {
        assert.match(editor.state.error, /changed elsewhere/);
        assert.equal(editor.state.dirty, true);
      }
    });
});

test("project acknowledgement preserves newer collapse and placement during an in-flight save", async (t) => {
  const gate = deferred();
  const entered = deferred();
  let block = true;
  const { editor, disk } = await projectSetup(t, async (method) => {
    if (method === "canvas.save" && block) {
      block = false;
      entered.resolve();
      await gate.promise;
    }
  });
  const id = disk.projectGroups[0].id;
  editor.placeProject(id, { x: 100 });
  const save = editor.save();
  await entered.promise;
  editor.placeProject(id, { x: 200, collapsed: true });
  gate.resolve();
  await save;
  assert.equal(editor.state.error, "");
  assert.equal(disk.projectGroups[0].x, 200);
  assert.equal(disk.projectGroups[0].collapsed, true);
  assert.equal(editor.state.dirty, false);
});

test("proposal approval publishes the canvas and turn status together, even if status reload fails", async (t) => {
  for (const failReload of [false, true])
    await t.test(
      failReload
        ? "failed status reload and recovery"
        : "delayed status reload",
      async (t) => {
        const { call, disk } = await setup(t);
        const operation = {
          op: "createShape",
          nodeId: "00000000-0000-4000-8000-000000000010",
          artifactId: "00000000-0000-4000-8000-000000000011",
          kind: "rectangle",
          x: 400,
          y: 0,
          width: 200,
          height: 100,
          color: "#123456",
        };
        const pending = {
          id: "00000000-0000-4000-8000-000000000012",
          status: "pending",
          operations: [operation],
        };
        const applied = { ...pending, status: "applied" };
        const updated = {
          ...disk,
          ...stageOperations(disk, [operation]),
          canvas: { ...disk.canvas, revision: 2 },
        };
        let approved = false;
        let delayReload = true;
        const listing = deferred();
        const release = deferred();
        const snapshots = [];
        const previewErrors = [];
        const editor = new Editor(
          async (...args) => {
            const method = args[2];
            if (method === "conversation.resolve") {
              approved = true;
              return { turn: applied };
            }
            if (method === "canvas.open" && approved)
              return structuredClone(updated);
            if (method === "conversation.list") {
              if (approved && delayReload) {
                listing.resolve();
                await release.promise;
                delayReload = false;
                if (failReload) throw new Error("Conversation reload failed");
              }
              return { turns: [approved ? applied : pending], nextBefore: 0 };
            }
            return call(...args);
          },
          () => "",
          (state) => {
            snapshots.push(structuredClone(state));
            if (state.document && state.turns[0]?.status === "pending") {
              try {
                stageOperations(state.document, state.turns[0].operations);
              } catch (error) {
                previewErrors.push(error.message);
              }
            }
          },
        );
        t.after(() => {
          release.resolve();
          editor.dispose();
        });
        await editor.openWorkspace(workspaceId);
        await editor.openCanvas(canvasId);
        const resolving = editor.resolveConversation(pending.id, "apply");
        await listing.promise;
        assert.deepEqual(
          previewErrors,
          [],
          "an applied creation must never be previewed a second time",
        );
        assert.equal(editor.state.document.nodes.length, disk.nodes.length);
        release.resolve();
        await resolving;
        if (failReload) {
          assert.match(editor.state.error, /Conversation reload failed/);
          assert.equal(editor.state.document.nodes.length, disk.nodes.length);
          await editor.reloadConversation();
        }
        assert.equal(editor.state.error, "");
        assert.equal(editor.state.turns[0].status, "applied");
        assert.equal(editor.state.document.nodes.length, updated.nodes.length);
        assert.deepEqual(previewErrors, []);
        assert.ok(
          snapshots.every(
            (state) =>
              !state.document?.nodes.some(
                (node) => node.id === operation.nodeId,
              ) || state.turns[0]?.status === "applied",
          ),
        );
      },
    );
});

const drawingGeometry = { x: 120, y: 80, width: 60, height: 60 };
const drawingContent = {
  shapes: [
    {
      kind: "path",
      points: [
        [0, 0],
        [40, 40],
      ],
      color: "#7b7bf0",
      width: 3,
    },
  ],
};

test("retry adopts a drawing committed without a reply and saves newer placement", async (t) => {
  const { editor, disk, calls, call } = await setup(t);
  let loseReply = true;
  editor.call = async (...args) => {
    const result = await call(...args);
    if (args[2] === "node.createDrawing" && loseReply) {
      loseReply = false;
      throw new TypeError("Connection lost after commit");
    }
    return result;
  };
  await editor.addDrawing(drawingGeometry, drawingContent);
  assert.equal(disk.nodes.length, 2);
  assert.equal(editor.state.dirty, true);
  const draftId = editor.state.document.nodes[1].id;
  editor.placeNode(draftId, { x: 777 });
  await editor.retrySave();
  assert.equal(editor.state.error, "");
  assert.equal(editor.state.dirty, false);
  assert.equal(editor.state.document.nodes[1].id, disk.nodes[1].id);
  assert.equal(disk.nodes[1].x, 777);
  assert.equal(
    calls.filter(({ method }) => method === "node.createDrawing").length,
    1,
  );
  await editor.retrySave();
  assert.equal(
    disk.nodes.length,
    2,
    "further retries do not duplicate the drawing",
  );
  await editor.deleteNode(draftId);
  assert.equal(editor.state.error, "");
  assert.equal(
    disk.nodes.length,
    1,
    "retained temporary IDs resolve after reconciliation",
  );
  const expected = structuredClone(editor.state.document);
  await editor.closeCanvas();
  assert.equal(editor.state.document, null);
  await editor.openCanvas(canvasId);
  assert.deepEqual(editor.state.document, expected);
});

test("drawing acknowledgements preserve placement edits made during creation", async (t) => {
  const started = deferred();
  const finish = deferred();
  const { editor, disk, calls } = await setup(t, async (method) => {
    if (method === "node.createDrawing") {
      started.resolve();
      await finish.promise;
    }
  });
  const adding = editor.addDrawing(drawingGeometry, drawingContent);
  await started.promise;
  const draftId = editor.state.document.nodes[1].id;
  const geometry = { x: 777, y: -50, width: 300, height: 200 };
  editor.placeNode(draftId, geometry);
  finish.resolve();
  await adding;
  assert.equal(editor.state.error, "");
  assert.equal(editor.state.dirty, false);
  for (const [key, value] of Object.entries(geometry)) {
    assert.equal(editor.state.document.nodes[1][key], value);
    assert.equal(disk.nodes[1][key], value);
  }
  assert.equal(
    calls.filter(({ method }) => method === "canvas.save").length,
    1,
  );
});

test("queued deletions follow a drawing's server ID after creation", async (t) => {
  const started = deferred();
  const finish = deferred();
  const { editor, disk, calls } = await setup(t, async (method) => {
    if (method === "node.createDrawing") {
      started.resolve();
      await finish.promise;
    }
  });
  const adding = editor.addDrawing(drawingGeometry, drawingContent);
  await started.promise;
  const draftId = editor.state.document.nodes[1].id;
  const deleting = editor.deleteNode(draftId);
  finish.resolve();
  await Promise.all([adding, deleting]);
  assert.equal(editor.state.error, "");
  assert.equal(editor.state.dirty, false);
  assert.notEqual(
    calls.find(({ method }) => method === "node.delete").params.nodeId,
    draftId,
  );
  assert.equal(disk.nodes.length, 1);
  assert.equal(disk.artifacts.length, 1);
  assert.equal(editor.state.document.nodes.length, 1);
});

for (const change of [
  "content",
  "geometry",
  "revision",
  "saved text",
  "extra drawing",
]) {
  test(`retry refuses a lost drawing reply with unexpected remote ${change}`, async (t) => {
    const { editor, disk, call } = await setup(t);
    editor.call = async (...args) => {
      const result = await call(...args);
      if (args[2] === "node.createDrawing") throw new TypeError("Reply lost");
      return result;
    };
    await editor.addDrawing(drawingGeometry, drawingContent);
    if (change === "content")
      disk.artifacts[1].drawing = {
        shapes: [{ ...drawingContent.shapes[0], color: "#ffffff" }],
      };
    if (change === "geometry") disk.nodes[1].x = 999;
    if (change === "revision") disk.canvas.revision += 1;
    if (change === "saved text")
      disk.artifacts[0].text = "Another editor's text";
    if (change === "extra drawing") {
      disk.artifacts.push({ ...disk.artifacts[1], id: crypto.randomUUID() });
      disk.nodes.push({
        ...disk.nodes[1],
        id: crypto.randomUUID(),
        artifactId: disk.artifacts[2].id,
      });
    }
    const draft = structuredClone(editor.state.document);
    await editor.retrySave();
    assert.match(editor.state.error, /changed elsewhere/);
    assert.equal(editor.state.dirty, true);
    assert.deepEqual(
      editor.state.document,
      draft,
      "failed reconciliation leaves drafts intact",
    );
    assert.equal(disk.nodes.length, change === "extra drawing" ? 3 : 2);
  });
}

test("retry reconciles a lost split-stroke reply and creates only uncommitted segments", async (t) => {
  const { editor, disk, calls, call } = await setup(t);
  let creates = 0;
  editor.call = async (...args) => {
    const result = await call(...args);
    if (args[2] === "node.createDrawing" && ++creates === 2)
      throw new TypeError("Second segment committed without a reply");
    return result;
  };
  const points = [...denseLoop(), ...denseLoop()];
  await editor.addDrawing(
    { x: 0, y: 0, width: 40, height: 40 },
    { shapes: [{ kind: "path", points, color: "#7b7bf0", width: 3 }] },
  );
  const total = editor.state.document.nodes.length - 1;
  assert.ok(total > 2);
  assert.equal(disk.nodes.length - 1, 2);
  await editor.retrySave();
  assert.equal(editor.state.error, "");
  assert.equal(editor.state.dirty, false);
  assert.equal(disk.nodes.length - 1, total);
  assert.equal(
    calls.filter(({ method }) => method === "node.createDrawing").length,
    total,
  );
  assert.deepEqual(
    reassemble(disk.artifacts.filter(({ type }) => type === "drawing")),
    points,
  );
});

/** A dense loop that stays in a small area yet serializes past one frame. */
function denseLoop() {
  return Array.from({ length: 2000 }, (_, index) => {
    const angle = index * 0.05;
    return [
      Number((20 * Math.cos(angle)).toFixed(2)),
      Number((20 * Math.sin(angle)).toFixed(2)),
    ];
  });
}

function frameBytes(method, params) {
  return new TextEncoder().encode(
    JSON.stringify({
      protocolVersion: 1,
      id: crypto.randomUUID(),
      method,
      params,
    }),
  ).length;
}

test("text creation saves the complete response or reports failure", async (t) => {
  const params = {
    workspaceId,
    canvasId,
    expectedRevision: 1,
    x: 40,
    y: 40,
    width: 240,
    height: 160,
    text: "",
  };
  const budget = MAX_FRAME_BYTES - frameBytes("node.createText", params);
  const token = '中😀"\\\n\u0000\ud800';
  const tokenBytes = Buffer.byteLength(JSON.stringify(token).slice(1, -1));
  const boundary = token.repeat(Math.floor(budget / tokenBytes));
  const padding = budget % tokenBytes;
  assert.equal(
    frameBytes("node.createText", {
      ...params,
      text: boundary + "a".repeat(padding),
    }),
    MAX_FRAME_BYTES,
  );
  const cases = [
    { name: "empty text", text: "" },
    { name: "multibyte text", text: "中文😀".repeat(500) },
    { name: "text length limit", text: "a".repeat(LIMITS.text) },
    { name: "below frame limit", text: boundary + "a".repeat(padding - 1) },
    { name: "at frame limit", text: boundary + "a".repeat(padding) },
    {
      name: "above frame limit",
      text: boundary + "a".repeat(padding + 1),
      error: /larger than 16 KiB.*not sent/,
    },
    {
      name: "6000 Chinese characters",
      text: "中".repeat(6000),
      error: /larger than 16 KiB.*not sent/,
    },
    {
      name: "above text length limit",
      text: "a".repeat(LIMITS.text + 1),
      error: /invalid.*not sent/,
    },
  ];
  for (const { name, text, error } of cases) {
    await t.test(name, async (t) => {
      const { editor, disk, calls, call } = await setup(t);
      // Exercise the real transport validation before the simulated disk write.
      t.mock.method(globalThis, "fetch", async (_url, options) => {
        const request = JSON.parse(options.body);
        const result = await call("", false, request.method, request.params);
        return {
          ok: true,
          json: async () => ({ protocolVersion: 1, id: request.id, result }),
        };
      });
      editor.call = async (...args) =>
        args[2] === "node.createText" ? callRuntime(...args) : call(...args);

      const created = await editor.addText(undefined, text);
      if (error) {
        assert.equal(
          created,
          undefined,
          "oversized text must not report success",
        );
        assert.match(editor.state.error, error);
        assert.equal(disk.nodes.length, 1);
        assert.equal(disk.artifacts.length, 1);
        assert.equal(disk.canvas.revision, 1);
        assert.equal(
          calls.filter(({ method }) => method === "node.createText").length,
          0,
        );
        await editor.retrySave();
        assert.equal(editor.state.error, "");
        const retried = await editor.addText(undefined, "Short response");
        assert.equal(retried.artifact.text, "Short response");
      } else {
        assert.equal(editor.state.error, "");
        assert.equal(created.artifact.text, text);
        assert.equal(disk.artifacts[1].text, text);
        assert.equal(
          frameBytes("node.createText", { ...params, text }) <= MAX_FRAME_BYTES,
          true,
        );
        await editor.closeCanvas();
        await editor.openCanvas(canvasId);
        assert.equal(editor.state.document.artifacts[1].text, text);
      }
      assert.equal(editor.state.dirty, false);
    });
  }
});

function reassemble(drawings) {
  const combined = [];
  for (const [index, artifact] of drawings.entries()) {
    const segment = artifact.drawing.shapes[0].points;
    if (index === 0) combined.push(...segment);
    else {
      assert.deepEqual(
        segment[0],
        combined.at(-1),
        "segments meet continuously",
      );
      combined.push(...segment.slice(1));
    }
  }
  return combined;
}

test("text, placement, dimensions and view save and reopen without AI", async (t) => {
  const { editor } = await setup(t);
  editor.editText(artifactId, "Edited ✓\nSecond line");
  editor.placeNode(nodeId, { x: -50, y: 120, width: 300, height: 200 });
  editor.setViewport({ x: -100, y: 40, zoom: 1.25 });
  await editor.save();
  assert.equal(editor.state.dirty, false);
  assert.equal(editor.state.error, "");
  const expected = structuredClone(editor.state.document);
  await editor.closeWorkspace();
  await editor.openWorkspace(workspaceId);
  await editor.openCanvas(canvasId);
  assert.deepEqual(editor.state.document, expected);
});

test("newer text and layout edits survive in-flight saves, including a reverted draft", async (t) => {
  const started = deferred();
  const finish = deferred();
  let delayed = false;
  const { editor, disk, calls } = await setup(t, async (method) => {
    if (method === "artifact.saveText" && !delayed) {
      delayed = true;
      started.resolve();
      await finish.promise;
    }
  });
  editor.editText(artifactId, "In flight");
  const saving = editor.save();
  await started.promise;
  editor.editText(artifactId, "Original");
  editor.placeNode(nodeId, { x: 500 });
  await editor.closeWorkspace();
  assert.ok(editor.state.workspace, "navigation cannot drop in-flight edits");
  finish.resolve();
  await saving;
  assert.equal(disk.artifacts[0].text, "Original");
  assert.equal(disk.nodes[0].x, 500);
  assert.equal(editor.state.document.artifacts[0].text, "Original");
  assert.equal(editor.state.dirty, false);
  assert.deepEqual(
    calls
      .filter((call) => call.method === "artifact.saveText")
      .map((call) => call.params.expectedRevision),
    [1, 2],
  );
});

test("new placement and view changes during canvas saves are saved afterward", async (t) => {
  const started = deferred();
  const finish = deferred();
  let delayed = false;
  const { editor, disk } = await setup(t, async (method) => {
    if (method === "canvas.save" && !delayed) {
      delayed = true;
      started.resolve();
      await finish.promise;
    }
  });
  editor.placeNode(nodeId, { x: 100 });
  const saving = editor.save();
  await started.promise;
  editor.placeNode(nodeId, { x: 200 });
  editor.setViewport({ x: 80, y: -40, zoom: 2 });
  finish.resolve();
  await saving;
  assert.equal(disk.nodes[0].x, 200);
  assert.deepEqual(disk.canvas.viewport, { x: 80, y: -40, zoom: 2 });
  assert.equal(editor.state.dirty, false);
});

for (const failedMethod of ["artifact.saveText", "canvas.save"]) {
  test(`${failedMethod} failure retains drafts and partial progress for explicit retry`, async (t) => {
    let fail = true;
    const { editor, disk, calls } = await setup(t, async (method) => {
      if (method === failedMethod && fail)
        throw new Error("Disk full — free space and retry.");
    });
    editor.editText(artifactId, "Keep my edit");
    editor.placeNode(nodeId, { x: 90 });
    await editor.save();
    assert.equal(editor.state.dirty, true);
    assert.match(editor.state.error, /Disk full/);
    assert.equal(editor.state.document.artifacts[0].text, "Keep my edit");
    assert.match(editor.recovery(), /Keep my edit/);
    await editor.openCanvas(canvasId);
    await editor.closeWorkspace();
    assert.equal(
      calls.filter((call) => call.method === "canvas.open").length,
      1,
    );
    assert.ok(editor.state.workspace);
    editor.editText(artifactId, "Newer recovery edit");
    const before = calls.length;
    await editor.save();
    assert.equal(calls.length, before, "failed saves pause automatic retries");
    fail = false;
    await editor.retrySave();
    assert.equal(editor.state.error, "");
    assert.equal(editor.state.dirty, false);
    assert.equal(disk.artifacts[0].text, "Newer recovery edit");
    assert.equal(disk.nodes[0].x, 90);
  });
}

test("retry reconciles a committed write with a lost response while retaining newer edits", async (t) => {
  const { editor, disk, call } = await setup(t);
  let loseReply = true;
  editor.call = async (...args) => {
    const result = await call(...args);
    if (args[2] === "artifact.saveText" && loseReply) {
      loseReply = false;
      throw new TypeError("Connection lost");
    }
    return result;
  };
  editor.editText(artifactId, "Committed without reply");
  await editor.save();
  assert.equal(editor.state.dirty, true);
  editor.editText(artifactId, "Newer draft");
  await editor.retrySave();
  assert.equal(editor.state.error, "");
  assert.equal(editor.state.dirty, false);
  assert.equal(disk.artifacts[0].revision, 3);
  assert.equal(disk.artifacts[0].text, "Newer draft");
});

test("retry refuses to overwrite unknown persisted changes", async (t) => {
  const { editor, disk } = await setup(t, async (method) => {
    if (method === "artifact.saveText") throw new Error("CONFLICT");
  });
  editor.editText(artifactId, "My unsaved draft");
  await editor.save();
  disk.artifacts[0].text = "Another editor's text";
  disk.artifacts[0].revision = 2;
  await editor.retrySave();
  assert.equal(editor.state.dirty, true);
  assert.match(editor.state.error, /changed elsewhere/);
  assert.equal(editor.state.document.artifacts[0].text, "My unsaved draft");
  assert.equal(disk.artifacts[0].text, "Another editor's text");
});

test("a reverted edit remains unsaved after an in-flight failure until reconciliation", async (t) => {
  const started = deferred();
  const finish = deferred();
  const { editor } = await setup(t, async (method) => {
    if (method === "artifact.saveText") {
      started.resolve();
      await finish.promise;
      throw new Error("Reply lost");
    }
  });
  editor.editText(artifactId, "Attempted edit");
  const saving = editor.save();
  await started.promise;
  editor.editText(artifactId, "Original");
  finish.resolve();
  await saving;
  assert.equal(editor.state.dirty, true);
  assert.match(editor.state.error, /Reply lost/);
  await editor.retrySave();
  assert.equal(editor.state.dirty, false);
  assert.equal(editor.state.error, "");
});

test("drawings are created, moved and erased, and survive a reopen", async (t) => {
  const { editor, disk } = await setup(t);
  await editor.addDrawing(
    { x: 120, y: 80, width: 60, height: 60 },
    {
      shapes: [
        {
          kind: "path",
          points: [
            [0, 0],
            [40, 40],
          ],
          color: "#7b7bf0",
          width: 3,
        },
      ],
    },
  );
  assert.equal(editor.state.error, "");
  assert.equal(editor.state.dirty, false);
  const drawingNode = editor.state.document.nodes.find(
    (node) => node.id !== nodeId,
  );
  assert.ok(drawingNode, "the drawing node was added");
  assert.equal(
    editor.state.document.artifacts.find(
      (item) => item.id === drawingNode.artifactId,
    ).type,
    "drawing",
  );

  editor.placeNode(drawingNode.id, { x: 320 });
  await editor.save();
  assert.equal(disk.nodes.find((node) => node.id === drawingNode.id).x, 320);

  const expected = structuredClone(editor.state.document);
  await editor.closeWorkspace();
  await editor.openWorkspace(workspaceId);
  await editor.openCanvas(canvasId);
  assert.deepEqual(editor.state.document, expected);

  await editor.deleteNode(drawingNode.id);
  assert.equal(editor.state.error, "");
  assert.equal(editor.state.document.nodes.length, 1);
  assert.equal(editor.state.document.artifacts.length, 1);
  assert.equal(disk.nodes.length, 1);
  assert.equal(disk.artifacts.length, 1);
});

test("the arrow tool links two nodes and ignores self-links", async (t) => {
  const { editor, disk } = await setup(t);
  await editor.addDrawing(
    { x: 400, y: 400, width: 60, height: 60 },
    {
      shapes: [
        {
          kind: "path",
          points: [
            [0, 0],
            [10, 10],
          ],
          color: "#7b7bf0",
          width: 3,
        },
      ],
    },
  );
  const second = editor.state.document.nodes.find((node) => node.id !== nodeId);
  await editor.createEdge(nodeId, second.id);
  assert.equal(editor.state.error, "");
  assert.equal(editor.state.document.edges.length, 1);
  assert.equal(disk.edges.length, 1);
  assert.equal(disk.edges[0].sourceNodeId, nodeId);
  assert.equal(disk.edges[0].targetNodeId, second.id);

  await editor.createEdge(nodeId, nodeId);
  assert.equal(editor.state.document.edges.length, 1);
  assert.equal(disk.edges.length, 1);
});

test("drawings queued behind an in-flight save are not dropped", async (t) => {
  const started = deferred();
  const finish = deferred();
  let delayed = false;
  const { editor, disk } = await setup(t, async (method) => {
    if (method === "artifact.saveText" && !delayed) {
      delayed = true;
      started.resolve();
      await finish.promise;
    }
  });
  editor.editText(artifactId, "Pending text");
  void editor.save();
  await started.promise;
  const drawing = editor.addDrawing(
    { x: 10, y: 10, width: 60, height: 60 },
    {
      shapes: [
        {
          kind: "path",
          points: [
            [0, 0],
            [40, 40],
          ],
          color: "#7b7bf0",
          width: 3,
        },
      ],
    },
  );
  finish.resolve();
  await drawing;
  assert.equal(editor.state.error, "");
  assert.equal(editor.state.dirty, false);
  assert.equal(disk.artifacts[0].text, "Pending text");
  assert.equal(disk.artifacts.length, 2);
  assert.equal(disk.nodes.length, 2);
});

test("a failed drawing creation stays recoverable and retries exactly once", async (t) => {
  let fail = true;
  const { editor, disk, calls } = await setup(t, async (method) => {
    if (method === "node.createDrawing" && fail)
      throw new TypeError("Simulated backend failure");
  });
  await editor.addDrawing(
    { x: 120, y: 80, width: 60, height: 60 },
    {
      shapes: [
        {
          kind: "path",
          points: [
            [0, 0],
            [40, 40],
          ],
          color: "#7b7bf0",
          width: 3,
        },
      ],
    },
  );
  // The failed stroke stays drawn and remains part of the recoverable edits.
  assert.equal(editor.state.dirty, true);
  assert.match(editor.state.error, /Simulated backend failure/);
  assert.equal(editor.state.document.nodes.length, 2);
  assert.equal(editor.state.document.artifacts.length, 2);
  assert.match(editor.recovery(), /#7b7bf0/);
  assert.equal(disk.nodes.length, 1, "the failed create reached no storage");
  assert.equal(disk.artifacts.length, 1);

  fail = false;
  await editor.retrySave();
  assert.equal(editor.state.error, "");
  assert.equal(editor.state.dirty, false);
  assert.equal(
    calls.filter((call) => call.method === "node.createDrawing").length,
    2,
    "one failed attempt plus one retry",
  );
  assert.equal(disk.nodes.length, 2);
  assert.equal(disk.artifacts.length, 2);

  // A further retry with nothing pending creates nothing more.
  await editor.retrySave();
  assert.equal(disk.nodes.length, 2);

  const expected = structuredClone(editor.state.document);
  await editor.closeWorkspace();
  await editor.openWorkspace(workspaceId);
  await editor.openCanvas(canvasId);
  assert.deepEqual(editor.state.document, expected);
});

test("a long stroke is split into frame-sized requests that stay continuous", async (t) => {
  const { editor, disk, calls } = await setup(t);
  const points = denseLoop();
  assert.ok(
    frameBytes("node.createDrawing", {
      workspaceId,
      canvasId,
      expectedRevision: 1,
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      drawing: {
        shapes: [{ kind: "path", points, color: "#7b7bf0", width: 3 }],
      },
    }) > MAX_FRAME_BYTES,
    "the stroke alone would exceed one frame",
  );
  await editor.addDrawing(
    { x: 0, y: 0, width: 40, height: 40 },
    { shapes: [{ kind: "path", points, color: "#7b7bf0", width: 3 }] },
  );
  assert.equal(editor.state.error, "");
  assert.equal(editor.state.dirty, false);

  const creates = calls.filter((call) => call.method === "node.createDrawing");
  assert.ok(creates.length > 1, "the stroke was split across requests");
  // Every request the flow sent — not just the creates — fits one frame.
  for (const call of calls)
    assert.ok(
      frameBytes(call.method, call.params) <= MAX_FRAME_BYTES,
      `${call.method} fits the frame limit (${frameBytes(call.method, call.params)} bytes)`,
    );

  const drawings = disk.artifacts.filter((item) => item.type === "drawing");
  assert.equal(drawings.length, creates.length);
  assert.deepEqual(reassemble(drawings), points, "the whole stroke persists");

  const expected = structuredClone(editor.state.document);
  await editor.closeWorkspace();
  await editor.openWorkspace(workspaceId);
  await editor.openCanvas(canvasId);
  assert.deepEqual(editor.state.document, expected);
});

test("a split stroke that fails midway retries only the unfinished segments", async (t) => {
  let fail = true;
  let attempts = 0;
  const { editor, disk, calls } = await setup(t, async (method) => {
    if (method !== "node.createDrawing") return;
    attempts += 1;
    if (attempts >= 2 && fail) throw new TypeError("Simulated backend failure");
  });
  const points = denseLoop();
  await editor.addDrawing(
    { x: 0, y: 0, width: 40, height: 40 },
    { shapes: [{ kind: "path", points, color: "#7b7bf0", width: 3 }] },
  );
  // The failed stroke stays drawn and entirely recoverable.
  assert.equal(editor.state.dirty, true);
  assert.match(editor.state.error, /Simulated backend failure/);
  const total = editor.state.document.nodes.length - 1;
  assert.ok(total > 1, "the stroke was split");
  assert.match(editor.recovery(), /#7b7bf0/);
  assert.equal(disk.nodes.length - 1, 1, "only the first segment persisted");
  assert.equal(attempts, 2, "the second segment failed and stopped the flush");

  fail = false;
  const before = calls.filter(
    (call) => call.method === "node.createDrawing",
  ).length;
  await editor.retrySave();
  assert.equal(editor.state.error, "");
  assert.equal(editor.state.dirty, false);
  assert.equal(disk.nodes.length - 1, total, "every segment persisted");
  assert.equal(
    calls.filter((call) => call.method === "node.createDrawing").length,
    before + (total - 1),
    "retry created only the unfinished segments",
  );

  const drawings = disk.artifacts.filter((item) => item.type === "drawing");
  assert.equal(drawings.length, total);
  assert.deepEqual(reassemble(drawings), points, "no segment is duplicated");

  const expected = structuredClone(editor.state.document);
  await editor.closeWorkspace();
  await editor.openWorkspace(workspaceId);
  await editor.openCanvas(canvasId);
  assert.deepEqual(editor.state.document, expected);
  assert.deepEqual(
    reassemble(
      editor.state.document.artifacts.filter((item) => item.type === "drawing"),
    ),
    points,
    "reopening shows the whole stroke",
  );
});

test("deleting a saved canvas and workspace updates the lists the pickers show", async (t) => {
  const { editor, calls } = await setup(t);
  await editor.listWorkspaces();
  assert.deepEqual(editor.state.workspaces, [
    { id: workspaceId, name: "Work" },
  ]);

  await editor.deleteCanvas(canvasId);
  assert.equal(editor.state.error, "");
  assert.deepEqual(editor.state.workspace.canvases, []);
  assert.deepEqual(calls.at(-1).params, {
    workspaceId,
    canvasId,
  });

  await editor.deleteWorkspace(workspaceId);
  assert.equal(editor.state.error, "");
  assert.deepEqual(editor.state.workspaces, []);
  assert.equal(editor.state.busy, false);
  assert.deepEqual(
    calls
      .filter((call) => call.method.endsWith(".delete"))
      .map((call) => call.method),
    ["canvas.delete", "workspace.delete"],
  );
});

test("a refused delete keeps the list and reports the runtime message", async (t) => {
  const { editor } = await setup(t, async (method) => {
    if (method === "canvas.delete")
      throw new Error("Cannot remove the canvas. Nothing was deleted; retry.");
  });
  await editor.deleteCanvas(canvasId);
  assert.match(editor.state.error, /Cannot remove the canvas/);
  assert.deepEqual(editor.state.workspace.canvases, [
    { id: canvasId, title: "Plan" },
  ]);
  assert.equal(editor.state.busy, false);
});

test("typing autosaves after the debounce", async (t) => {
  const saved = deferred();
  const { editor, disk } = await setup(t, async (method) => {
    if (method === "artifact.saveText") saved.resolve();
  });
  editor.editText(artifactId, "Autosaved");
  await saved.promise;
  // The intercepted call and its acknowledgement finish in the same task.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disk.artifacts[0].text, "Autosaved");
  assert.equal(editor.state.dirty, false);
});

test("a finish committed without an acknowledgement is found for adoption", async (t) => {
  const { editor, call } = await setup(t);
  const turnId = "00000000-0000-4000-8000-000000000020";
  const operations = [{ op: "updateText", artifactId, text: "Proposed" }];
  let stored = { id: turnId, status: "generating", reply: "", operations: [] };
  editor.call = async (...args) => {
    const [, , method, params] = args;
    if (method === "conversation.list")
      return { turns: [structuredClone(stored)], nextBefore: 0 };
    if (method === "conversation.resolve") {
      stored = { ...stored, status: "discarded" };
      return { turn: structuredClone(stored) };
    }
    if (method === "conversation.finish") {
      if (stored.status !== "generating")
        throw new Error(
          "This turn has already finished. Reload the conversation.",
        );
      stored = {
        ...stored,
        status: "pending",
        reply: params.reply,
        operations,
      };
      throw new TypeError("Connection lost after commit");
    }
    return call(...args);
  };
  assert.equal(await editor.finishedTurn(turnId), undefined);
  const reply = {
    workspaceId,
    canvasId,
    turnId,
    reply: "Done",
    operations,
    status: "complete",
    error: "",
  };
  assert.equal(await editor.finishConversation(reply), undefined);
  assert.match(editor.state.error, /Connection lost/);
  assert.equal((await editor.finishedTurn(turnId)).status, "pending");
  assert.equal(editor.state.error, "");
  // Stripping operations from the buffer cannot match the saved proposal.
  await editor.finishConversation({ ...reply, operations: [] });
  assert.match(editor.state.error, /already finished/);
  await editor.resolveConversation(turnId, "discard");
  assert.equal((await editor.finishedTurn(turnId)).status, "discarded");
});
