import assert from "node:assert/strict";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import {
  FILE_LIMITS,
  LIMITS,
  MAX_FRAME_BYTES,
  MAX_IDS,
} from "@agentica/protocol";
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
const CHAT_ID = "00000000-0000-4000-8000-000000000005";

test("preview saves use artifact revisions and leave other previews unchanged on conflict", async (t) => {
  let conflict = false;
  const { editor, disk } = await setup(t, async (method) => {
    if (method === "artifact.saveWebPreview" && conflict)
      throw new Error("CONFLICT: newer preview");
  });
  disk.nodes = [];
  disk.artifacts = [];
  await editor.openCanvas(canvasId);
  const first = await editor.addWebPreview("http://localhost:5173");
  const second = await editor.addWebPreview("http://localhost:6000");
  assert.ok(first && second);
  assert.ok(second.node.x >= first.node.x + first.node.width);
  assert.equal(
    await editor.saveWebPreview(first.artifact.id, "http://localhost:5173/new"),
    true,
  );
  assert.equal(
    disk.artifacts.find((a) => a.id === second.artifact.id).url,
    "http://localhost:6000",
  );
  conflict = true;
  assert.equal(
    await editor.saveWebPreview(
      first.artifact.id,
      "http://localhost:5173/draft",
    ),
    false,
  );
  assert.equal(
    disk.artifacts.find((a) => a.id === first.artifact.id).url,
    "http://localhost:5173/new",
  );
  assert.match(editor.state.error, /CONFLICT/);
});

test("a rejected preview does not block a retry, but a failed save does", async (t) => {
  let reject = true;
  let failSave = false;
  const { editor, calls } = await setup(t, async (method) => {
    if (method === "node.createWebPreview" && reject)
      throw new Error("Preview rejected.");
    if (method === "artifact.saveText" && failSave)
      throw new Error("lost transport");
  });
  const creates = () =>
    calls.filter((call) => call.method === "node.createWebPreview").length;
  await editor.openCanvas(canvasId);
  assert.equal(await editor.addWebPreview("http://localhost:5173"), undefined);
  assert.match(editor.state.error, /rejected/);
  reject = false;
  assert.ok(await editor.addWebPreview("http://localhost:5173"));
  assert.equal(creates(), 2);
  failSave = true;
  editor.editText(artifactId, "unsaved draft");
  await editor.save();
  assert.equal(editor.state.dirty, true);
  assert.match(editor.state.error, /lost transport/);
  assert.equal(await editor.addWebPreview("http://localhost:6000"), undefined);
  assert.equal(creates(), 2);
});

for (const commitBeforeFailure of [false, true]) {
  for (const retry of ["tile", "banner"]) {
    test(`preview ${retry} retry recovers a failure ${commitBeforeFailure ? "after" : "before"} commit`, async (t) => {
      const { editor, disk, call, calls } = await setup(t);
      const { artifact } = await editor.addWebPreview("http://localhost:5173");
      let failOnce = true;
      editor.call = async (...args) => {
        if (args[2] === "artifact.saveWebPreview" && failOnce) {
          failOnce = false;
          if (commitBeforeFailure) await call(...args);
          throw new Error("Connection lost");
        }
        return call(...args);
      };
      const url = "http://localhost:5173/recovery";
      assert.equal(await editor.saveWebPreview(artifact.id, url), false);
      assert.equal(editor.state.dirty, true);
      assert.match(editor.recovery(), /5173\/recovery/);
      assert.equal(editor.savedWebPreviewUrl(artifact.id), artifact.url);
      await editor.closeCanvas();
      assert.ok(
        editor.state.document,
        "a failed preview save prevents navigation away",
      );

      if (retry === "tile")
        assert.equal(await editor.saveWebPreview(artifact.id, url), true);
      else await editor.retrySave();
      assert.equal(editor.state.error, "");
      assert.equal(editor.state.dirty, false);
      assert.equal(editor.savedWebPreviewUrl(artifact.id), url);
      assert.equal(disk.artifacts.find((a) => a.id === artifact.id).url, url);
      assert.equal(
        disk.artifacts.find((a) => a.id === artifact.id).revision,
        2,
      );
      assert.equal(
        calls.filter((c) => c.method === "artifact.saveWebPreview").length,
        1,
        "an acknowledged or reconciled write is not repeated",
      );
    });
  }
}

test("preview retry keeps a newer submitted URL after a lost reply", async (t) => {
  const { editor, disk, call } = await setup(t);
  const { artifact } = await editor.addWebPreview("http://localhost:5173");
  let loseReply = true;
  editor.call = async (...args) => {
    const result = await call(...args);
    if (args[2] === "artifact.saveWebPreview" && loseReply) {
      loseReply = false;
      throw new Error("Reply lost");
    }
    return result;
  };
  assert.equal(
    await editor.saveWebPreview(artifact.id, "http://localhost:5173/first"),
    false,
  );
  assert.equal(
    await editor.saveWebPreview(artifact.id, "http://localhost:5173/newer"),
    true,
  );
  assert.equal(
    disk.artifacts.find((a) => a.id === artifact.id).url,
    "http://localhost:5173/newer",
  );
  assert.equal(disk.artifacts.find((a) => a.id === artifact.id).revision, 3);
  assert.equal(editor.state.dirty, false);
});

test("preview retry retains its draft and refuses an unrelated remote URL", async (t) => {
  const { editor, disk, call, calls } = await setup(t);
  const { artifact } = await editor.addWebPreview("http://localhost:5173");
  editor.call = async (...args) => {
    if (args[2] === "artifact.saveWebPreview") throw new Error("CONFLICT");
    return call(...args);
  };
  assert.equal(
    await editor.saveWebPreview(artifact.id, "http://localhost:5173/mine"),
    false,
  );
  const remote = disk.artifacts.find((a) => a.id === artifact.id);
  remote.url = "http://localhost:5173/another-editor";
  remote.revision++;
  await editor.retrySave();
  assert.match(editor.state.error, /changed elsewhere/);
  assert.equal(editor.state.dirty, true);
  assert.match(editor.recovery(), /5173\/mine/);
  assert.equal(editor.savedWebPreviewUrl(artifact.id), artifact.url);
  assert.equal(remote.url, "http://localhost:5173/another-editor");
  assert.equal(
    calls.filter((c) => c.method === "artifact.saveWebPreview").length,
    0,
  );
});

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
  const uploads = new Map();
  // The stub owns the lists the runtime would return after a delete.
  let workspaceList = [{ id: workspaceId, name: "Work", canvases: 1 }];
  let canvasList = [{ id: canvasId, title: "Plan" }];
  const call = async (_key, _connect, method, params) => {
    calls.push({ method, params });
    await intercept(method, params);
    if (method === "workspace.list")
      return { workspaces: structuredClone(workspaceList) };
    if (method === "conversation.list") return { turns: [], nextBefore: 0 };
    if (method === "conversation.chats")
      return {
        chats: [{ chatId: CHAT_ID, title: "Plan", turns: 1, lastSequence: 1 }],
      };
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
    if (
      method === "node.createDrawing" ||
      method === "node.createText" ||
      method === "node.createWebPreview"
    ) {
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
        type:
          method === "node.createDrawing"
            ? "drawing"
            : method === "node.createWebPreview"
              ? "web-preview"
              : "text",
        schemaVersion: 1,
        revision: 1,
        ...(method === "node.createDrawing"
          ? { drawing: params.drawing }
          : method === "node.createWebPreview"
            ? { url: params.url }
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
    if (method === "file.begin") {
      sequence += 1;
      const uploadId = `00000000-0000-4000-8000-${String(700 + sequence).padStart(12, "0")}`;
      uploads.set(uploadId, { received: 0, size: params.size });
      return { uploadId };
    }
    if (method === "file.chunk") {
      const upload = uploads.get(params.uploadId);
      assert.ok(upload, "a chunk names its upload");
      assert.equal(params.offset, upload.received);
      const length = Buffer.from(params.data, "base64").length;
      upload.received += length;
      return { received: upload.received };
    }
    if (method === "file.discard") {
      uploads.delete(params.uploadId);
      return {};
    }
    if (method === "file.finish") {
      assert.equal(params.expectedRevision, disk.canvas.revision);
      const upload = uploads.get(params.uploadId);
      assert.ok(upload, "finish names its upload");
      assert.equal(upload.received, upload.size);
      uploads.delete(params.uploadId);
      sequence += 1;
      const node = {
        id: `00000000-0000-4000-8000-${String(800 + sequence).padStart(12, "0")}`,
        artifactId: `00000000-0000-4000-8000-${String(900 + sequence).padStart(12, "0")}`,
        x: params.x,
        y: params.y,
        width: params.width,
        height: params.height,
      };
      const artifact = {
        id: node.artifactId,
        type: "file",
        schemaVersion: 1,
        revision: 1,
        name: "report.txt",
        mime: "text/plain",
        size: upload.size,
        text: "summary",
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
    if (method === "node.deleteMany") {
      assert.equal(params.expectedRevision, disk.canvas.revision);
      // Like the runtime: one missing object leaves every object in place.
      if (!params.nodeIds.every((id) => disk.nodes.some((n) => n.id === id)))
        throw new Error("NOT_FOUND: Node on this canvas");
      const doomed = new Set(params.nodeIds);
      disk.nodes = disk.nodes.filter((item) => !doomed.has(item.id));
      disk.edges = disk.edges.filter(
        (edge) =>
          !doomed.has(edge.sourceNodeId) && !doomed.has(edge.targetNodeId),
      );
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
    // Like the runtime, canvas.open always reports each node's task.
    if (method === "canvas.open")
      return structuredClone({
        ...disk,
        nodes: disk.nodes.map((node) => ({ task: null, ...node })),
      });
    if (method === "artifact.saveText") {
      assert.equal(params.expectedRevision, disk.artifacts[0].revision);
      disk.artifacts[0] = {
        ...disk.artifacts[0],
        text: params.text,
        revision: params.expectedRevision + 1,
      };
      return { artifact: structuredClone(disk.artifacts[0]) };
    }
    if (method === "artifact.saveWebPreview") {
      const index = disk.artifacts.findIndex(
        (item) => item.id === params.artifactId,
      );
      assert.equal(params.expectedRevision, disk.artifacts[index].revision);
      disk.artifacts[index] = {
        ...disk.artifacts[index],
        url: params.url,
        revision: params.expectedRevision + 1,
      };
      return { artifact: structuredClone(disk.artifacts[index]) };
    }
    if (method === "canvas.save") {
      assert.equal(params.expectedRevision, disk.canvas.revision);
      disk.canvas = {
        ...disk.canvas,
        viewport: params.viewport,
        revision: params.expectedRevision + 1,
      };
      // Like the runtime, a saved layout states each node's full grouping.
      disk.nodes = disk.nodes.map((node) => {
        const update = params.nodes.find((item) => item.id === node.id);
        if (!update) return node;
        const { groupId: _previous, ...rest } = node;
        return { ...rest, ...update };
      });
      for (const collection of ["projectGroups", "sessionTiles"])
        for (const patch of params[collection] ?? []) {
          const item = disk[collection].find((entry) => entry.id === patch.id);
          const { expectedRevision, ...layout } = patch;
          assert.equal(expectedRevision, item.revision);
          disk[collection] = disk[collection].map((entry) =>
            entry.id === item.id
              ? { ...entry, ...layout, revision: entry.revision + 1 }
              : entry,
          );
        }
      return { revision: disk.canvas.revision };
    }
    throw new Error(`Unexpected method ${method}`);
  };
  const clock = { now: 0 };
  const editor = new Editor(
    call,
    () => "",
    () => {},
    () => clock.now,
  );
  t.after(() => editor.dispose());
  await editor.openWorkspace(workspaceId);
  await editor.openCanvas(canvasId);
  return { editor, calls, disk, call, clock };
}

async function taskSendSetup(t) {
  const fixture = await setup(t);
  const { editor, disk, call } = fixture;
  const tileId = "00000000-0000-4000-8000-000000000007";
  disk.nodes[0].task = {
    done: false,
    assignedTileId: tileId,
    sentAt: null,
    sentRevision: null,
    revision: 2,
  };
  await editor.openCanvas(canvasId);
  const records = [];
  editor.call = async (...args) => {
    if (args[2] !== "task.recordSent") return call(...args);
    const params = args[3];
    records.push(params);
    const task = disk.nodes[0].task;
    if (
      params.expectedRevision !== task?.revision ||
      params.tileId !== task?.assignedTileId ||
      params.textRevision !== disk.artifacts[0].revision
    )
      throw new Error("CONFLICT: task or text changed");
    disk.nodes[0].task = {
      ...task,
      revision: task.revision + 1,
      sentAt: new Date(
        Date.UTC(2026, 9, 22, 0, 0, records.length),
      ).toISOString(),
      sentRevision: params.textRevision,
      sentContext: params.contextRevisions,
    };
    return { task: structuredClone(disk.nodes[0].task) };
  };
  return { ...fixture, tileId, records };
}

test("task context resolves saved text and refuses unsaved context", async (t) => {
  const { editor, disk, call } = await taskSendSetup(t);
  disk.nodes[0].task.context = [{ nodeId }];
  await editor.openCanvas(canvasId);
  assert.deepEqual(await editor.settledContext(nodeId), [
    { nodeId, label: "Original", text: "Original", revision: 1 },
  ]);
  editor.call = async (...args) => {
    if (args[2] === "artifact.saveText") throw new Error("Disk full");
    return call(...args);
  };
  editor.editText(artifactId, "Unsaved");
  await assert.rejects(editor.settledContext(nodeId), /unsaved changes/);
});

test("deleting a context node removes it from the task's local context", async (t) => {
  const { editor, disk } = await taskSendSetup(t);
  const note = "00000000-0000-4000-8000-000000000031";
  const noteArtifact = "00000000-0000-4000-8000-000000000032";
  disk.nodes.push({
    id: note,
    artifactId: noteArtifact,
    x: 0,
    y: 400,
    width: 200,
    height: 100,
  });
  disk.artifacts.push({
    id: noteArtifact,
    type: "text",
    schemaVersion: 1,
    revision: 1,
    text: "Spec",
  });
  disk.nodes[0].task.context = [{ nodeId: note }];
  await editor.openCanvas(canvasId);
  await editor.deleteNode(note);
  assert.deepEqual(editor.state.document.nodes[0].task.context, []);
  assert.equal(editor.state.document.nodes[0].task.revision, 2);
});

test("task recording retry does not adopt a send of different context", async (t) => {
  const { editor, tileId, records } = await taskSendSetup(t);
  const call = editor.call;
  editor.call = async (...args) => {
    const result = await call(...args);
    if (args[2] === "task.recordSent")
      throw new TypeError("Reply lost after commit");
    return result;
  };
  const context = [{ nodeId, revision: 1 }];
  await assert.rejects(
    editor.recordSent(nodeId, tileId, 1, false, context),
    /Reply lost/,
  );
  editor.call = call;
  await editor.recordSent(nodeId, tileId, 1, true, []);
  assert.equal(records.length, 2);
  assert.deepEqual(records[1].contextRevisions, []);
  await editor.recordSent(nodeId, tileId, 1, true, []);
  assert.equal(records.length, 2);
});

test("task recording retry adopts a committed send without rewriting it or losing drafts", async (t) => {
  const { editor, disk, tileId, records } = await taskSendSetup(t);
  const call = editor.call;
  editor.call = async (...args) => {
    const result = await call(...args);
    if (args[2] === "task.recordSent")
      throw new TypeError("Reply lost after commit");
    return result;
  };
  await assert.rejects(editor.recordSent(nodeId, tileId, 1), /Reply lost/);
  assert.equal(editor.state.document.nodes[0].task.revision, 2);
  assert.equal(disk.nodes[0].task.revision, 3);
  editor.editText(artifactId, "Unsaved newer text");
  editor.placeNode(nodeId, { x: 777 });
  for (let attempt = 0; attempt < 3; attempt++)
    await editor.recordSent(nodeId, tileId, 1, true);
  assert.equal(records.length, 1);
  assert.deepEqual(editor.state.document.nodes[0].task, disk.nodes[0].task);
  assert.equal(editor.state.document.artifacts[0].text, "Unsaved newer text");
  assert.equal(editor.state.document.nodes[0].x, 777);
  assert.equal(editor.state.dirty, true);
  // A new paste of unchanged text must still get a fresh send record.
  editor.call = call;
  await editor.recordSent(nodeId, tileId, 1);
  assert.equal(records.length, 2);
});

test("task recording retry never adopts an earlier send of the same text", async (t) => {
  const { editor, disk, tileId, records } = await taskSendSetup(t);
  await editor.recordSent(nodeId, tileId, 1);
  const first = disk.nodes[0].task;
  const call = editor.call;
  editor.call = async (...args) => {
    if (args[2] === "task.recordSent") throw new TypeError("Network down");
    return call(...args);
  };
  await assert.rejects(editor.recordSent(nodeId, tileId, 1), /Network down/);
  assert.deepEqual(disk.nodes[0].task, first);
  editor.call = call;
  await editor.recordSent(nodeId, tileId, 1, true);
  assert.equal(records.length, 2);
  assert.notEqual(disk.nodes[0].task.sentAt, first.sentAt);
  assert.deepEqual(editor.state.document.nodes[0].task, disk.nodes[0].task);
});

test("task recording retry records a fresh send when the attempt started before the acknowledged send", async (t) => {
  const { editor, disk, tileId, records } = await taskSendSetup(t);
  const live = editor.call;
  // The previous send committed, but its reply was lost, so the next attempt
  // starts behind the persisted stamp.
  editor.call = async (...args) => {
    const result = await live(...args);
    if (args[2] === "task.recordSent")
      throw new TypeError("Reply lost after commit");
    return result;
  };
  await assert.rejects(editor.recordSent(nodeId, tileId, 1), /Reply lost/);
  const previous = structuredClone(disk.nodes[0].task);
  editor.call = async (...args) => {
    if (args[2] === "task.recordSent") throw new TypeError("Network down");
    return live(...args);
  };
  // Resending unchanged text fails to record before committing anything.
  await assert.rejects(editor.recordSent(nodeId, tileId, 1), /Network down/);
  editor.call = live;
  // The retry must record the send instead of reporting the earlier stamp.
  await editor.recordSent(nodeId, tileId, 1, true);
  assert.equal(records.length, 2);
  assert.notEqual(disk.nodes[0].task.sentAt, previous.sentAt);
  assert.deepEqual(editor.state.document.nodes[0].task, disk.nodes[0].task);
});

test("task recording retry reconciles concurrent changes before attempting a write", async (t) => {
  for (const change of ["none", "done", "assignee", "text", "unmarked"])
    await t.test(change, async (t) => {
      const { editor, disk, tileId, records } = await taskSendSetup(t);
      if (change === "unmarked") disk.nodes[0].task = null;
      else if (change !== "none") {
        disk.nodes[0].task.revision++;
        if (change === "done") disk.nodes[0].task.done = true;
        if (change === "assignee") disk.nodes[0].task.assignedTileId = null;
        if (change === "text") disk.artifacts[0].revision++;
      }
      if (change === "none" || change === "done") {
        await editor.recordSent(nodeId, tileId, 1, true);
        assert.equal(disk.nodes[0].task.done, change === "done");
        assert.equal(disk.nodes[0].task.sentRevision, 1);
      } else {
        await assert.rejects(
          editor.recordSent(nodeId, tileId, 1, true),
          /CONFLICT|no longer a task/,
        );
        assert.equal(disk.nodes[0].task?.sentAt ?? null, null);
      }
      if (records.length)
        assert.equal(records[0].expectedRevision, change === "none" ? 2 : 3);
      assert.deepEqual(editor.state.document.nodes[0].task, disk.nodes[0].task);
    });
});

test("task recording retry does not write when reconciliation fails", async (t) => {
  const { editor, records } = await taskSendSetup(t);
  const call = editor.call;
  editor.call = async (...args) => {
    if (args[2] === "canvas.open") throw new TypeError("Read failed");
    return call(...args);
  };
  await assert.rejects(
    editor.recordSent(nodeId, "tile", 1, true),
    /Read failed/,
  );
  assert.equal(records.length, 0);
});

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
  assert.equal(
    editor.state.document.sessionTiles[0].revision,
    1,
    "an unchanged tile is not rewritten",
  );
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

test("undo restores a whole drag, saves it, and redo reapplies it", async (t) => {
  const { editor, disk, clock } = await setup(t);
  assert.equal(editor.state.canUndo, false);
  editor.checkpoint();
  // A drag reports many positions in quick succession: one undo step.
  for (const [x, y] of [
    [30, 40],
    [80, 90],
    [400, 300],
  ]) {
    clock.now += 16;
    editor.placeNode(nodeId, { x, y });
  }
  assert.equal(editor.state.canUndo, true);
  assert.equal(editor.state.canRedo, false);
  editor.undo();
  const restored = editor.state.document.nodes[0];
  assert.deepEqual(
    [restored.x, restored.y, restored.width, restored.height],
    [10, 20, 240, 160],
  );
  assert.equal(editor.state.canUndo, false);
  assert.equal(editor.state.canRedo, true);
  // The undone position goes through the normal autosave path.
  await editor.save();
  assert.deepEqual([disk.nodes[0].x, disk.nodes[0].y], [10, 20]);
  editor.redo();
  assert.deepEqual(
    [editor.state.document.nodes[0].x, editor.state.document.nodes[0].y],
    [400, 300],
  );
  await editor.save();
  assert.deepEqual([disk.nodes[0].x, disk.nodes[0].y], [400, 300]);
  assert.equal(editor.state.canRedo, false);
});

test("separate gestures undo one at a time and a new edit clears redo", async (t) => {
  const { editor, clock } = await setup(t);
  editor.placeNode(nodeId, { x: 100 });
  // A pause ends the gesture, so the next move is its own step.
  clock.now += 1000;
  editor.placeNode(nodeId, { width: 320, height: 200 });
  // A drag start ends the gesture even without a pause.
  editor.checkpoint();
  clock.now += 10;
  editor.placeNode(nodeId, { y: 500 });
  const position = () => {
    const { x, y, width, height } = editor.state.document.nodes[0];
    return [x, y, width, height];
  };
  editor.undo();
  assert.deepEqual(position(), [100, 20, 320, 200]);
  editor.undo();
  assert.deepEqual(position(), [100, 20, 240, 160]);
  editor.redo();
  assert.deepEqual(position(), [100, 20, 320, 200]);
  clock.now += 1000;
  editor.placeNode(nodeId, { x: 0 });
  assert.equal(editor.state.canRedo, false, "a new edit discards redo");
  editor.undo();
  editor.undo();
  editor.undo();
  assert.deepEqual(position(), [10, 20, 240, 160]);
  assert.equal(editor.state.canUndo, false);
  editor.undo();
  assert.deepEqual(position(), [10, 20, 240, 160], "extra undo is a no-op");
});

test("a held drag stays one step across pauses", async (t) => {
  const { editor, clock } = await setup(t);
  editor.checkpoint(true);
  editor.placeNode(nodeId, { x: 50 });
  clock.now += 2000;
  editor.placeNode(nodeId, { x: 90 });
  editor.release();
  clock.now += 1000;
  editor.placeNode(nodeId, { y: 70 });
  editor.undo();
  assert.equal(editor.state.document.nodes[0].x, 90);
  editor.undo();
  assert.deepEqual(
    [editor.state.document.nodes[0].x, editor.state.document.nodes[0].y],
    [10, 20],
  );
});

test("collapsing a project is not an undo step and keeps redo", async (t) => {
  const { editor, disk, clock } = await projectSetup(t);
  const id = disk.projectGroups[0].id;
  editor.placeProject(id, { x: 99 });
  editor.undo();
  clock.now += 1000;
  editor.placeProject(id, { collapsed: true });
  assert.equal(editor.state.canUndo, false);
  assert.equal(editor.state.canRedo, true);
  editor.redo();
  assert.equal(editor.state.document.projectGroups[0].x, 99);
});

test("reloading the canvas from the server clears undo history", async (t) => {
  const { editor } = await setup(t);
  editor.placeNode(nodeId, { x: 77 });
  await editor.save();
  assert.equal(editor.state.canUndo, true);
  await editor.reloadConversation();
  assert.equal(editor.state.canUndo, false);
  editor.undo();
  assert.equal(editor.state.document.nodes[0].x, 77);
});

test("starting or discarding a conversation keeps undo, applying clears it", async (t) => {
  const { editor, call } = await setup(t);
  const turnId = "00000000-0000-4000-8000-000000000021";
  editor.call = async (...args) => {
    const [, , method] = args;
    if (method === "conversation.start") return { turn: { id: turnId } };
    if (method === "conversation.resolve") return {};
    return call(...args);
  };
  editor.placeNode(nodeId, { x: 77 });
  await editor.save();
  await editor.startConversation({ workspaceId, canvasId, turnId });
  assert.equal(editor.state.canUndo, true);
  await editor.resolveConversation(turnId, "discard");
  assert.equal(editor.state.canUndo, true);
  await editor.resolveConversation(turnId, "apply");
  assert.equal(editor.state.canUndo, false);
});

test("applied proposals clear history even when the canvas or status reload fails", async (t) => {
  for (const failedMethod of ["canvas.open", "conversation.list"])
    await t.test(failedMethod, async (t) => {
      const { editor, call, disk } = await setup(t);
      editor.placeNode(nodeId, { x: 77 });
      editor.checkpoint();
      editor.editText(artifactId, "Temporary edit");
      editor.undo();
      await editor.save();
      assert.equal(editor.state.canUndo, true);
      assert.equal(editor.state.canRedo, true);

      let failReload = false;
      editor.call = async (...args) => {
        const method = args[2];
        if (method === "conversation.resolve") {
          disk.artifacts[0].text = "Agent result";
          disk.artifacts[0].revision += 1;
          disk.canvas.revision += 1;
          failReload = true;
          return {};
        }
        if (failReload && method === failedMethod) {
          failReload = false;
          throw new Error("Reload failed");
        }
        return call(...args);
      };

      await editor.resolveConversation(
        "00000000-0000-4000-8000-000000000021",
        "apply",
      );
      assert.match(editor.state.error, /Reload failed/);
      assert.equal(editor.state.canUndo, false);
      assert.equal(editor.state.canRedo, false);
      editor.undo();
      editor.redo();
      assert.equal(editor.state.dirty, false);
      await editor.reloadConversation();
      assert.equal(editor.state.error, "");
      assert.equal(editor.state.document.artifacts[0].text, "Agent result");
      assert.equal(editor.state.document.nodes[0].x, 77);
    });
});

test("an aborted drag stops holding once text is edited or undo runs", async (t) => {
  const { editor, clock } = await setup(t);
  editor.checkpoint(true);
  editor.placeNode(nodeId, { x: 50 });
  // No release: the drag aborted without a stop event.
  clock.now += 2000;
  editor.editText(artifactId, "Typed later");
  editor.undo();
  assert.equal(editor.state.document.artifacts[0].text, "Original");
  assert.equal(editor.state.document.nodes[0].x, 50, "drag is its own step");
  clock.now += 2000;
  editor.checkpoint(true);
  editor.placeNode(nodeId, { y: 90 });
  editor.undo();
  clock.now += 2000;
  editor.placeNode(nodeId, { x: 5 });
  clock.now += 2000;
  editor.placeNode(nodeId, { x: 6 });
  editor.undo();
  assert.equal(editor.state.document.nodes[0].x, 5, "undo ended the hold");
});

test("undo covers text edits, skips deleted objects, and resets per canvas", async (t) => {
  const { editor, disk, clock } = await setup(t);
  editor.editText(artifactId, "Orig");
  clock.now += 100;
  editor.editText(artifactId, "Original plus typing");
  editor.undo();
  assert.equal(editor.state.document.artifacts[0].text, "Original");
  await editor.save();
  assert.equal(disk.artifacts[0].text, "Original");
  editor.redo();
  assert.equal(editor.state.document.artifacts[0].text, "Original plus typing");

  // A move of an object that is later deleted cannot be undone; the earlier
  // step for an object that still exists is reached instead.
  clock.now += 1000;
  const created = await editor.addText({ x: 0, y: 0 }, "Temporary");
  clock.now += 1000;
  editor.placeNode(created.node.id, { x: 900 });
  await editor.deleteNode(created.node.id);
  editor.undo();
  assert.equal(editor.state.document.artifacts[0].text, "Original");
  assert.equal(editor.state.document.nodes.length, 1);

  // History belongs to one canvas.
  editor.placeNode(nodeId, { x: 77 });
  await editor.save();
  assert.equal(editor.state.canUndo, true);
  await editor.closeCanvas();
  assert.equal(editor.state.canUndo, false);
  await editor.openCanvas(canvasId);
  assert.equal(editor.state.canUndo, false);
  editor.undo();
  assert.equal(editor.state.document.nodes[0].x, 77);
});

test("undo and redo restore grouping as one step", async (t) => {
  const { editor, disk } = await setup(t);
  const other = await editor.addText({ x: 400 }, "Second");
  const ids = [nodeId, other.node.id];
  const groupOf = () => editor.state.document.nodes.map((n) => n.groupId);
  editor.checkpoint();
  editor.placeNode(nodeId, { x: 50 });
  const groupId = editor.groupNodes(ids);
  assert.deepEqual(groupOf(), [groupId, groupId]);

  editor.undo();
  assert.deepEqual(groupOf(), [undefined, undefined], "undo ungroups");
  assert.equal(
    editor.state.document.nodes[0].x,
    50,
    "the move is its own step",
  );
  await editor.save();
  assert.ok(disk.nodes.every((n) => !("groupId" in n)));
  editor.redo();
  assert.deepEqual(groupOf(), [groupId, groupId], "redo regroups");

  editor.ungroupNodes([nodeId]);
  editor.undo();
  assert.deepEqual(groupOf(), [groupId, groupId], "undo restores the group");
  await editor.save();
  assert.ok(disk.nodes.every((n) => n.groupId === groupId));
  editor.undo();
  editor.undo();
  assert.equal(
    editor.state.document.nodes[0].x,
    10,
    "earlier moves still undo",
  );
});

test("deleting several objects is one request that fails as a whole", async (t) => {
  const { editor, disk, calls } = await setup(t);
  const other = await editor.addText({ x: 400 }, "Second");
  const third = await editor.addText({ x: 800 }, "Third");
  const before = calls.length;
  await editor.deleteNodes([nodeId, other.node.id]);
  assert.equal(editor.state.error, "");
  const sent = calls
    .slice(before)
    .filter(({ method }) => method.startsWith("node.delete"));
  assert.deepEqual(
    sent.map(({ method }) => method),
    ["node.deleteMany"],
  );
  assert.deepEqual(
    disk.nodes.map((n) => n.id),
    [third.node.id],
  );
  assert.deepEqual(
    editor.state.document.nodes.map((n) => n.id),
    [third.node.id],
  );

  // A stale object fails the request and leaves everything in place.
  const kept = await editor.addText({ x: 1200 }, "Kept");
  disk.nodes = disk.nodes.filter((n) => n.id !== third.node.id);
  await editor.deleteNodes([third.node.id, kept.node.id]);
  assert.match(editor.state.error, /NOT_FOUND/);
  assert.ok(disk.nodes.some((n) => n.id === kept.node.id));
});

test("deleting more than MAX_IDS objects sends one request per chunk", async (t) => {
  const { editor, disk, calls } = await setup(t);
  for (let index = 0; index < MAX_IDS; index += 1)
    assert.ok(await editor.addText({ x: 300 * (index + 1) }, "More"));
  const ids = editor.state.document.nodes.map((n) => n.id);
  assert.equal(ids.length, MAX_IDS + 1);
  const before = calls.length;
  await editor.deleteNodes(ids);
  assert.equal(editor.state.error, "");
  assert.deepEqual(
    calls
      .slice(before)
      .filter(({ method }) => method === "node.deleteMany")
      .map(({ params }) => params.nodeIds.length),
    [MAX_IDS, 1],
  );
  assert.equal(disk.nodes.length, 0);
  assert.equal(editor.state.document.nodes.length, 0);
});

test("grouping and ungrouping save through the layout", async (t) => {
  const { editor, calls } = await setup(t);
  const other = await editor.addText({ x: 400 }, "Second");
  assert.ok(other);
  const ids = [nodeId, other.node.id];
  assert.equal(editor.groupNodes([nodeId]), "", "one object is not a group");
  const groupId = editor.groupNodes(ids);
  assert.match(groupId, /^[0-9a-f-]{36}$/);
  assert.ok(editor.state.document.nodes.every((n) => n.groupId === groupId));
  await editor.save();
  const saved = calls.findLast(({ method }) => method === "canvas.save");
  assert.ok(saved.params.nodes.every((n) => n.groupId === groupId));
  assert.equal(editor.state.dirty, false);

  // Ungrouping one member dissolves the whole group.
  editor.ungroupNodes([other.node.id]);
  assert.ok(editor.state.document.nodes.every((n) => !("groupId" in n)));
  await editor.save();
  assert.ok(
    calls
      .findLast(({ method }) => method === "canvas.save")
      .params.nodes.every((n) => !("groupId" in n)),
  );
  assert.equal(editor.state.dirty, false);

  // Regrouping survives a reopen with the same members.
  const reopened = editor.groupNodes(ids);
  await editor.save();
  await editor.closeWorkspace();
  await editor.openWorkspace(workspaceId);
  await editor.openCanvas(canvasId);
  assert.ok(
    editor.state.document.nodes.every((n) => n.groupId === reopened),
    "the saved group reopens with its members",
  );
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

function canvasNode(index, x = 0) {
  return {
    id: `00000000-0000-4000-8000-${String(1000 + index).padStart(12, "0")}`,
    artifactId: `00000000-0000-4000-8000-${String(5000 + index).padStart(12, "0")}`,
    x,
    y: index % 100,
    width: 240,
    height: 160,
  };
}

async function largeCanvas(t, intercept) {
  const fixture = await setup(t, intercept);
  fixture.disk.nodes = [
    ...fixture.disk.nodes,
    ...Array.from({ length: 400 }, (_, index) => canvasNode(index)),
  ];
  await fixture.editor.openCanvas(canvasId);
  return fixture;
}

test("a large canvas saves only the changed node instead of the whole layout", async (t) => {
  const { editor, disk, calls } = await largeCanvas(t);
  const fullLayout = frameBytes("canvas.save", {
    workspaceId,
    canvasId,
    expectedRevision: disk.canvas.revision,
    viewport: disk.canvas.viewport,
    nodes: disk.nodes.map(({ id, x, y, width, height }) => ({
      id,
      x,
      y,
      width,
      height,
    })),
  });
  assert.ok(fullLayout > MAX_FRAME_BYTES, "the full layout exceeds one frame");

  const target = disk.nodes.at(-1);
  editor.placeNode(target.id, { x: 777 });
  await editor.save();

  assert.equal(editor.state.error, "");
  assert.equal(editor.state.dirty, false);
  assert.equal(disk.nodes.find((node) => node.id === target.id).x, 777);
  const saves = calls.filter((call) => call.method === "canvas.save");
  assert.equal(saves.length, 1);
  assert.deepEqual(
    saves[0].params.nodes.map((node) => node.id),
    [target.id],
    "unchanged nodes are not resent",
  );
  assert.ok(frameBytes("canvas.save", saves[0].params) <= MAX_FRAME_BYTES);
});

test("a layout change larger than one frame is split across canvas saves", async (t) => {
  const { editor, disk, calls } = await largeCanvas(t);
  const before = calls.filter((call) => call.method === "canvas.save").length;
  const expected = new Map();
  for (const [index, node] of disk.nodes.entries()) {
    const x = node.x + index + 1;
    expected.set(node.id, x);
    editor.placeNode(node.id, { x });
  }
  await editor.save();

  assert.equal(editor.state.error, "");
  assert.equal(editor.state.dirty, false);
  const saves = calls
    .filter((call) => call.method === "canvas.save")
    .slice(before);
  assert.ok(saves.length > 1, "the delta was split across requests");
  for (const save of saves)
    assert.ok(
      frameBytes("canvas.save", save.params) <= MAX_FRAME_BYTES,
      `canvas.save fits the frame limit (${frameBytes("canvas.save", save.params)} bytes)`,
    );
  for (const node of disk.nodes)
    assert.equal(node.x, expected.get(node.id), `${node.id} persisted`);
  // Every request except the last is maximal: the next changed node on its
  // own would push it past the limit.
  for (let index = 0; index < saves.length - 1; index++) {
    const next = saves[index + 1].params.nodes[0];
    const combined = {
      ...saves[index].params,
      nodes: [...saves[index].params.nodes, next],
    };
    assert.ok(
      frameBytes("canvas.save", combined) > MAX_FRAME_BYTES,
      `batch ${index} leaves no room for the next node`,
    );
  }
});

test("a project change too large for one request reports a clear error", async (t) => {
  const { editor, disk, calls } = await projectSetup(t);
  disk.sessionTiles = Array.from({ length: 100 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(7000 + index).padStart(12, "0")}`,
    projectId: disk.projectGroups[0].id,
    kind: "shell",
    preset: null,
    x: 16,
    y: 96,
    width: 500,
    height: 400,
    revision: 1,
  }));
  await editor.openCanvas(canvasId);
  for (const tile of disk.sessionTiles)
    editor.placeSessionTile(tile.id, { x: tile.x + 1 });
  const [group] = disk.projectGroups;
  editor.placeProject(group.id, { width: group.width + 1 });
  await editor.save();

  assert.match(editor.state.error, /one save request holds/);
  assert.equal(
    calls.filter((call) => call.method === "canvas.save").length,
    0,
    "no oversized request was sent",
  );
});

test("a split layout save that fails midway retries only the remaining changes", async (t) => {
  let attempts = 0;
  let fail = true;
  const { editor, disk, calls } = await largeCanvas(t, async (method) => {
    if (method === "canvas.save" && ++attempts === 2 && fail) {
      fail = false;
      throw new TypeError("Simulated layout failure");
    }
  });
  const expected = new Map();
  for (const [index, node] of disk.nodes.entries()) {
    const x = node.x + index + 1;
    expected.set(node.id, x);
    editor.placeNode(node.id, { x });
  }
  await editor.save();
  assert.equal(editor.state.dirty, true);
  assert.match(editor.state.error, /Simulated layout failure/);
  const committed = calls.filter(
    (call) => call.method === "canvas.save",
  ).length;
  assert.equal(
    committed,
    2,
    "the second request failed after the first committed",
  );

  await editor.retrySave();
  assert.equal(editor.state.error, "");
  assert.equal(editor.state.dirty, false);
  for (const node of disk.nodes)
    assert.equal(node.x, expected.get(node.id), `${node.id} persisted`);
  for (const save of calls.filter((call) => call.method === "canvas.save"))
    assert.ok(frameBytes("canvas.save", save.params) <= MAX_FRAME_BYTES);
});

// With these counts, a frame boundary used to fall between a project and its
// tile, so the shrunken project was sent before the tile that makes it fit.
for (const moved of [185, 186])
  test(`a shrunken project and its tile share one split save (${moved} nodes moved)`, async (t) => {
    const { editor, disk, calls } = await projectSetup(t);
    disk.nodes = Array.from({ length: moved }, (_, index) => canvasNode(index));
    await editor.openCanvas(canvasId);
    for (const [index, node] of disk.nodes.entries())
      editor.placeNode(node.id, { x: node.x + index + 1 });
    const [group] = disk.projectGroups;
    const [tile] = disk.sessionTiles;
    // A project cannot shrink past its tiles, so the tile shrinks first.
    editor.placeSessionTile(tile.id, { width: 300, height: 200 });
    editor.placeProject(group.id, { width: 400, height: 400 });
    await editor.save();

    assert.equal(editor.state.error, "");
    assert.equal(editor.state.dirty, false);
    const saves = calls.filter((call) => call.method === "canvas.save");
    assert.ok(saves.length > 1, "the delta was split across requests");
    const shared = saves.filter((save) =>
      save.params.projectGroups?.some((item) => item.id === group.id),
    );
    assert.equal(shared.length, 1);
    assert.ok(
      shared[0].params.sessionTiles?.some((item) => item.id === tile.id),
      "the tile is saved with its project",
    );
    for (const save of saves)
      assert.ok(frameBytes("canvas.save", save.params) <= MAX_FRAME_BYTES);
    assert.equal(disk.projectGroups[0].width, 400);
    assert.equal(disk.sessionTiles[0].width, 300);
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
    { id: workspaceId, name: "Work", canvases: 1 },
  ]);

  assert.equal(await editor.deleteCanvas(canvasId), true);
  assert.equal(editor.state.error, "");
  assert.deepEqual(editor.state.workspace.canvases, []);
  assert.deepEqual(calls.at(-1).params, {
    workspaceId,
    canvasId,
  });

  assert.equal(await editor.deleteWorkspace(workspaceId), true);
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
  assert.equal(await editor.deleteCanvas(canvasId), false);
  assert.match(editor.state.error, /Cannot remove the canvas/);
  assert.deepEqual(editor.state.workspace.canvases, [
    { id: canvasId, title: "Plan" },
  ]);
  assert.equal(editor.state.busy, false);
});

test("restoring a backup reloads the list and a cancelled dialog changes nothing", async (t) => {
  const restoredId = "00000000-0000-4000-8000-0000000000aa";
  let listed = [{ id: workspaceId, name: "Work", canvases: 1 }];
  const calls = [];
  const editor = new Editor(
    async (_key, _connect, method) => {
      calls.push(method);
      if (method === "workspace.list")
        return { workspaces: structuredClone(listed) };
      throw new Error(`Unexpected method ${method}`);
    },
    () => "",
    () => {},
  );
  t.after(() => editor.dispose());
  await editor.listWorkspaces();

  await editor.restoreWorkspace(async () => null);
  assert.deepEqual(calls, ["workspace.list"]);
  assert.equal(editor.state.workspaces.length, 1);

  await editor.restoreWorkspace(async () => {
    listed = [
      ...listed,
      { id: restoredId, name: "Work (restored)", canvases: 1 },
    ];
    return restoredId;
  });
  assert.deepEqual(calls, ["workspace.list", "workspace.list"]);
  assert.deepEqual(editor.state.workspaces.at(-1), {
    id: restoredId,
    name: "Work (restored)",
    canvases: 1,
  });
  assert.equal(editor.state.busy, false);

  await editor.restoreWorkspace(async () => {
    throw "This backup is damaged and cannot be restored. No workspace was added.";
  });
  assert.match(editor.state.error, /damaged/);
  assert.equal(editor.state.workspaces.length, 2);

  assert.equal(await editor.backupWorkspace(async () => true), true);
  assert.equal(editor.state.error, "");
  assert.equal(await editor.backupWorkspace(async () => false), false);
  assert.equal(
    await editor.backupWorkspace(async () => {
      throw "Cannot access workspace storage: disk full.";
    }),
    false,
  );
  assert.match(editor.state.error, /disk full/);
});

test("skipped deletes do not report success", async (t) => {
  const { editor, calls } = await setup(t);
  for (const guard of ["busy", "saving", "dirty"]) {
    editor.state[guard] = true;
    const before = calls.length;
    assert.equal(await editor.deleteCanvas(canvasId), false);
    assert.equal(await editor.deleteWorkspace(workspaceId), false);
    assert.equal(calls.length, before);
    editor.state[guard] = false;
  }
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

const turnAt = (sequence, status = "complete") => ({
  id: `00000000-0000-4000-8000-${String(1000 + sequence).padStart(12, "0")}`,
  sequence,
  model: "openrouter/free",
  prompt: `Prompt ${sequence}`,
  reply: `Reply ${sequence}`,
  promptNodeId: null,
  replyNodeId: null,
  anchor: { x: 0, y: 0 },
  status,
  operations: [],
  error: "",
});

/** `conversation.list` as the runtime pages it: eight turns, newest first. */
function listPage(stored, before) {
  const turns = stored
    .filter((turn) => !before || turn.sequence < before)
    .sort((a, b) => b.sequence - a.sequence)
    .slice(0, 8);
  return {
    turns: structuredClone(turns),
    nextBefore: turns.length === 8 ? turns[7].sequence : 0,
  };
}

test("history beyond one page loads once in order, keeps pages on refresh, and retries the same page", async (t) => {
  const { editor, call, calls } = await setup(t);
  const stored = Array.from({ length: 20 }, (_, index) => turnAt(index + 1));
  stored[19].status = "pending";
  const requested = [];
  let failing = false;
  editor.call = async (...args) => {
    const [, , method, params] = args;
    if (method === "conversation.list") {
      requested.push(params.before);
      if (failing) throw new Error("Connection lost");
      return listPage(stored, params.before);
    }
    if (method === "conversation.resolve") {
      stored[19].status = "applied";
      return { turn: structuredClone(stored[19]) };
    }
    return call(...args);
  };
  await editor.refreshConversation();
  assert.equal(editor.state.turns.length, 8);
  assert.equal(editor.state.olderTurns, 13);

  failing = true;
  await editor.loadOlderTurns();
  assert.match(editor.state.historyError, /Connection lost/);
  assert.equal(editor.state.historyLoading, false);
  assert.equal(editor.state.turns.length, 8);
  failing = false;
  await editor.loadOlderTurns();
  assert.equal(editor.state.historyError, "");
  assert.equal(editor.state.turns.length, 16);
  assert.equal(editor.state.olderTurns, 5);

  // Apply and a new turn refresh the newest page without dropping older ones.
  await editor.resolveConversation(stored[19].id, "apply");
  assert.equal(editor.state.turns[0].status, "applied");
  stored.push(turnAt(21));
  await editor.refreshConversation();
  assert.equal(editor.state.turns.length, 17);
  assert.equal(editor.state.olderTurns, 5);

  await editor.loadOlderTurns();
  await editor.loadOlderTurns();
  assert.equal(editor.state.olderTurns, 0);
  assert.deepEqual(
    editor.state.turns.map((turn) => turn.sequence),
    Array.from({ length: 21 }, (_, index) => 21 - index),
  );
  assert.deepEqual(requested, [0, 13, 13, 0, 0, 5]);
  // Browsing history never starts a turn or writes the canvas.
  assert.ok(
    !calls.some(({ method }) =>
      /^(conversation\.(start|finish)|node\.|artifact\.|canvas\.(save|update))/.test(
        method,
      ),
    ),
  );
});

test("new chats start empty, adopt their first turn's chat, and past chats reopen by ID", async (t) => {
  const { editor, call } = await setup(t);
  const first = turnAt(1);
  const listed = [];
  editor.call = async (...args) => {
    const [, , method, params] = args;
    if (method === "conversation.list") {
      listed.push(params.chatId);
      return {
        turns: params.chatId === CHAT_ID ? [] : [structuredClone(first)],
        nextBefore: 0,
      };
    }
    if (method === "conversation.start")
      return { turn: { ...first, chatId: first.id }, context: {}, outline: {} };
    return call(...args);
  };
  assert.equal(editor.state.chatId, CHAT_ID, "a canvas opens its latest chat");
  await editor.openChat(null);
  assert.equal(editor.state.chatId, null);
  assert.deepEqual(editor.state.turns, []);
  assert.deepEqual(listed, [], "an unsent new chat lists nothing");
  await editor.startConversation({ newChat: true });
  assert.equal(editor.state.chatId, first.id);
  assert.deepEqual(
    editor.state.turns.map((turn) => turn.id),
    [first.id],
  );
  await editor.openChat(CHAT_ID);
  assert.equal(editor.state.chatId, CHAT_ID);
  assert.deepEqual(editor.state.turns, []);
  assert.deepEqual(listed, [first.id, CHAT_ID]);
});

test("a delayed history page for the previous canvas is ignored", async (t) => {
  const { editor, call, disk } = await setup(t);
  const otherId = "00000000-0000-4000-8000-000000000099";
  const stored = Array.from({ length: 10 }, (_, index) => turnAt(index + 1));
  const delayed = deferred();
  editor.call = async (...args) => {
    const [, , method, params] = args;
    if (method === "conversation.list") {
      if (params.canvasId === otherId) return { turns: [], nextBefore: 0 };
      if (params.before) await delayed.promise;
      return listPage(stored, params.before);
    }
    if (method === "canvas.open" && params.canvasId === otherId)
      return structuredClone({
        ...disk,
        canvas: { ...disk.canvas, id: otherId },
        nodes: [],
        artifacts: [],
      });
    return call(...args);
  };
  await editor.refreshConversation();
  assert.equal(editor.state.olderTurns, 3);
  const older = editor.loadOlderTurns();
  await editor.openCanvas(otherId);
  delayed.resolve();
  await older;
  assert.equal(editor.state.document.canvas.id, otherId);
  assert.deepEqual(editor.state.turns, []);
  assert.equal(editor.state.olderTurns, 0);
  assert.equal(editor.state.historyLoading, false);
});

test("a maximum file chunk still fits one runtime frame", () => {
  const data = Buffer.alloc(FILE_LIMITS.chunkBytes, 7).toString("base64");
  const bytes = frameBytes("file.chunk", {
    workspaceId,
    uploadId: nodeId,
    offset: FILE_LIMITS.maxBytes - FILE_LIMITS.chunkBytes,
    data,
  });
  assert.ok(bytes <= MAX_FRAME_BYTES, `${bytes} bytes`);
  // A full 8 MiB file needs a bounded number of these requests.
  assert.equal(Math.ceil(FILE_LIMITS.maxBytes / FILE_LIMITS.chunkBytes), 763);
});

test("files upload in bounded chunks and become saved canvas nodes", async (t) => {
  const { editor, calls } = await setup(t);
  const bytes = Uint8Array.from({ length: 20_000 }, (_, index) => index % 251);
  const progress = [];
  await editor.addFile(
    {
      name: "report.txt",
      mime: "text/plain",
      size: bytes.length,
      text: "summary",
      bytes,
    },
    { x: 5, y: 6 },
    (fraction) => progress.push(fraction),
  );
  assert.equal(editor.state.error, "");
  assert.equal(editor.state.busy, false);
  assert.equal(editor.state.dirty, false);
  const artifact = editor.state.document.artifacts.find(
    (item) => item.type === "file",
  );
  assert.deepEqual(
    {
      name: artifact.name,
      mime: artifact.mime,
      size: artifact.size,
      text: artifact.text,
    },
    {
      name: "report.txt",
      mime: "text/plain",
      size: bytes.length,
      text: "summary",
    },
  );
  const node = editor.state.document.nodes.find(
    (item) => item.artifactId === artifact.id,
  );
  assert.deepEqual({ x: node.x, y: node.y }, { x: 5, y: 6 });

  const chunks = calls.filter((call) => call.method === "file.chunk");
  assert.equal(chunks.length, 2);
  const uploaded = Buffer.concat(
    chunks.map((call) => Buffer.from(call.params.data, "base64")),
  );
  assert.deepEqual(new Uint8Array(uploaded), bytes);
  assert.deepEqual(progress, [11_000 / 20_000, 1]);
  assert.equal(calls.filter((call) => call.method === "file.finish").length, 1);
});

test("a failed file import discards its staged upload and keeps the canvas saved", async (t) => {
  const { editor, calls } = await setup(t, async (method) => {
    if (method === "file.chunk") throw new Error("The upload was interrupted.");
  });
  await editor.addFile({
    name: "report.txt",
    mime: "text/plain",
    size: 4,
    text: "",
    bytes: Uint8Array.from([1, 2, 3, 4]),
  });
  assert.match(editor.state.error, /interrupted/);
  assert.equal(
    calls.filter((call) => call.method === "file.discard").length,
    1,
  );
  assert.equal(
    editor.state.document.artifacts.some((item) => item.type === "file"),
    false,
  );
});
