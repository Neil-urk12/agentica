import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor } from "../apps/desktop/src/lib/editor.ts";

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
    if (method === "node.createDrawing") {
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
        type: "drawing",
        schemaVersion: 1,
        revision: 1,
        drawing: params.drawing,
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
