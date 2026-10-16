import assert from "node:assert/strict";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { SessionEventSchema } from "@agentica/protocol";

const sessionsUrl = new URL(
  "../apps/desktop/src/lib/sessions.ts",
  import.meta.url,
);
const mocks = {
  "@xterm/xterm": "export const Terminal = globalThis.sessionTest.Terminal;",
  "@xterm/addon-fit": "export class FitAddon {}",
  "./session-client":
    "export const createSessionClient = () => globalThis.sessionTest.client;",
  "./runtime": "export const desktopMode = false;",
};
// Exercise the manager with controlled transport replies and renderer callbacks.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === sessionsUrl.href && specifier in mocks)
      return { url: `session-test:${specifier}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith("session-test:"))
      return {
        format: "module",
        source: mocks[url.slice("session-test:".length)],
        shortCircuit: true,
      };
    const result = nextLoad(url, context);
    return url === sessionsUrl.href
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

class Terminal {
  rows = 24;
  cols = 80;
  parser = { registerOscHandler() {} };
  written = [];
  constructor(options) {
    this.options = options;
  }
  loadAddon() {}
  onData() {}
  onBinary() {}
  attachCustomKeyEventHandler() {}
  resize() {}
  reset() {}
  dispose() {}
  write(bytes, callback) {
    this.written.push(...bytes);
    if (globalThis.sessionTest.client.blockWrites)
      globalThis.sessionTest.client.writes.push(callback);
    else callback();
  }
}
globalThis.sessionTest = { Terminal };
const { SessionManager } = await import(sessionsUrl.href);
hooks.deregister();

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const workspaceId = id(1);
const canvasId = id(2);
const owner = (n, canvas = canvasId) => ({
  workspaceId,
  canvasId: canvas,
  tileId: id(n + 10),
});
const status = (n, state = "running", canvas) => ({
  owner: owner(n, canvas),
  sessionId: id(n + 100),
  backendId: id(3),
  state,
  rows: 24,
  cols: 80,
  exitCode: null,
  exitSignal: null,
  error: null,
  executable: "/bin/bash",
  shellFallback: false,
  projectId: id(5),
});
const document = (statuses, canvas = canvasId) => ({
  canvas: { id: canvas },
  sessionTiles: statuses.map((item) => ({ id: item.owner.tileId })),
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

function setup(t, statuses) {
  const client = {
    statuses,
    active: new Set(),
    subscriptions: new Map(),
    calls: [],
    writes: [],
    async request(command) {
      this.calls.push(command);
      if (command.op === "capabilities")
        return { capabilities: { supported: true } };
      if (command.op === "list")
        return {
          sessions: structuredClone(
            this.statuses.filter(
              (item) =>
                item.owner.workspaceId === command.workspaceId &&
                item.owner.canvasId === command.canvasId,
            ),
          ),
        };
      if (command.op === "acknowledge") {
        await this.acknowledging?.promise;
        return {};
      }
      if (command.op === "status")
        return {
          status: this.statuses.find(
            (item) => item.owner.tileId === command.owner.tileId,
          ),
        };
      if (command.op === "stop") {
        const item = this.statuses.find(
          (item) => item.owner.tileId === command.owner.tileId,
        );
        item.state = "exited";
        return { status: structuredClone(item) };
      }
      if (command.op === "start") {
        const item = this.statuses.find(
          (item) => item.owner.tileId === command.owner.tileId,
        );
        item.sessionId = id(900);
        item.state = "running";
        return { status: structuredClone(item) };
      }
      throw new Error(`Unexpected command: ${command.op}`);
    },
    async subscribe(owner, sessionId, after, event, error) {
      assert.ok(
        this.active.size < 8,
        "ninth subscription closes the connection",
      );
      const attachmentId = id(this.calls.length + 1000);
      this.calls.push({ op: "subscribe", sessionId, after });
      this.active.add(attachmentId);
      this.subscriptions.set(sessionId, { event, error, attachmentId });
      if (this.replay) queueMicrotask(() => this.emit(sessionId, [], 0, 0));
      return {
        id: attachmentId,
        detach: async () => {
          this.calls.push({ op: "detach", sessionId });
          await this.detaching?.promise;
          this.active.delete(attachmentId);
        },
      };
    },
    emit(sessionId, frames, nextSequence, lastSequence) {
      const subscription = this.subscriptions.get(sessionId);
      const status = this.statuses.find((item) => item.sessionId === sessionId);
      subscription.event(
        SessionEventSchema.parse({
          event: "session",
          sessionId,
          attachmentId: subscription.attachmentId,
          owner: status.owner,
          status: structuredClone(status),
          output: { frames, nextSequence, lastSequence, historyGap: false },
        }),
      );
    },
    async close() {
      this.active.clear();
    },
  };
  globalThis.sessionTest.client = client;
  const manager = new SessionManager(
    () => "key",
    () => {},
  );
  t.after(() => manager.dispose());
  return { manager, client };
}

test("eight exited subscriptions drain and release before a ninth live subscription", async (t) => {
  const statuses = Array.from({ length: 8 }, (_, n) => status(n));
  const { manager, client } = setup(t, statuses);
  await manager.reconcile(workspaceId, document(statuses));
  assert.equal(client.active.size, 8);
  client.blockWrites = true;
  client.acknowledging = deferred();
  client.detaching = deferred();
  for (const item of statuses) {
    item.state = "exited";
    client.emit(item.sessionId, [{ sequence: 1, bytes: [65] }], 1, 1);
  }
  statuses.push(status(8));
  const reconcile = manager.reconcile(workspaceId, document(statuses));
  await setImmediate();
  assert.equal(client.writes.length, 8);
  assert.equal(
    client.calls.filter((call) => call.op === "subscribe").length,
    8,
  );
  for (const write of client.writes) write();
  await setImmediate();
  assert.equal(client.calls.filter((call) => call.op === "detach").length, 0);
  client.acknowledging.resolve();
  await setImmediate();
  assert.equal(client.calls.filter((call) => call.op === "detach").length, 8);
  assert.equal(
    client.calls.filter((call) => call.op === "subscribe").length,
    8,
  );
  client.detaching.resolve();
  await reconcile;
  assert.equal(client.active.size, 1);
  assert.equal(
    client.calls.filter((call) => call.op === "subscribe").length,
    9,
  );
  assert.equal(manager.connected, true);
  assert.equal(manager.view(statuses[8].owner).connected, true);
  assert.equal(manager.view(statuses[0].owner).connected, false);
});

test("exited output spanning pages survives an empty backpressured page", async (t) => {
  const item = status(0);
  const { manager, client } = setup(t, [item]);
  await manager.reconcile(workspaceId, document([item]));
  item.state = "exited";
  assert.throws(() => client.emit(item.sessionId, [], 1, 0));
  client.emit(item.sessionId, [{ sequence: 1, bytes: [65] }], 1, 3);
  client.emit(item.sessionId, [], 1, 3);
  await setImmediate();
  assert.equal(client.active.size, 1);
  client.emit(item.sessionId, [{ sequence: 2, bytes: [66] }], 2, 3);
  await setImmediate();
  assert.equal(client.active.size, 1);
  client.emit(item.sessionId, [{ sequence: 3, bytes: [67] }], 3, 3);
  await setImmediate();
  assert.equal(client.active.size, 0);
  const entry = [...manager.entries.values()][0];
  assert.deepEqual(entry.terminal.written, [65, 66, 67]);
  assert.equal(entry.cursor, 3);
  // Delayed events from the released attachment cannot revive or write to it.
  client.emit(item.sessionId, [{ sequence: 3, bytes: [67] }], 3, 3);
  await setImmediate();
  assert.deepEqual(entry.terminal.written, [65, 66, 67]);
});

test("more than eight exited tiles replay once without retaining subscriptions", async (t) => {
  const statuses = Array.from({ length: 10 }, (_, n) => status(n, "exited"));
  const { manager, client } = setup(t, statuses);
  client.replay = true;
  await manager.reconcile(workspaceId, document(statuses));
  await setImmediate();
  assert.equal(client.active.size, 0);
  assert.equal(
    client.calls.filter((call) => call.op === "subscribe").length,
    10,
  );
  await manager.reconcile(workspaceId, document(statuses), true);
  assert.equal(
    client.calls.filter((call) => call.op === "subscribe").length,
    10,
  );
});

test("switching canvases releases exited attachments before subscribing", async (t) => {
  const statuses = Array.from({ length: 8 }, (_, n) => status(n));
  const { manager, client } = setup(t, statuses);
  await manager.reconcile(workspaceId, document(statuses));
  for (const item of statuses) {
    item.state = "exited";
    client.emit(item.sessionId, [], 0, 0);
  }
  const next = status(8, "running", id(4));
  statuses.push(next);
  await manager.reconcile(workspaceId, document([next], next.owner.canvasId));
  assert.equal(client.active.size, 1);
  assert.equal(manager.entries.size, 1);
  assert.equal(manager.view(next.owner).connected, true);
});

test("starting a replacement waits for an in-flight detach without detaching twice", async (t) => {
  const item = status(0);
  const { manager, client } = setup(t, [item]);
  await manager.reconcile(workspaceId, document([item]));
  client.detaching = deferred();
  item.state = "exited";
  client.emit(item.sessionId, [], 0, 0);
  await setImmediate();
  const start = manager.start(item.owner);
  await setImmediate();
  assert.equal(client.calls.filter((call) => call.op === "detach").length, 1);
  assert.equal(
    client.calls.filter((call) => call.op === "subscribe").length,
    1,
  );
  client.detaching.resolve();
  await start;
  assert.equal(
    client.calls.filter((call) => call.op === "subscribe").length,
    2,
  );
  assert.equal(client.active.size, 1);
  assert.equal(manager.view(item.owner).status.state, "running");
  assert.equal(manager.view(item.owner).connected, true);
});

for (const scope of ["canvas", "workspace"])
  for (const stopped of [true, false])
    test(`${scope} removal waits for final output after ${stopped ? "stop polling" : "natural exit"}`, async (t) => {
      const item = status(0);
      const { manager, client } = setup(t, [item]);
      await manager.reconcile(workspaceId, document([item]));
      if (stopped) await manager.stopSessions([structuredClone(item)]);
      else item.state = "exited";
      client.blockWrites = true;
      client.acknowledging = deferred();
      client.detaching = deferred();
      let removed = false;
      const removal = (async () => {
        await manager.drainScope(
          workspaceId,
          scope === "canvas" ? canvasId : undefined,
        );
        removed = true;
        client.statuses = [];
      })();
      await setImmediate();
      assert.equal(removed, false, "metadata must outlive the final event");
      client.emit(item.sessionId, [{ sequence: 1, bytes: [65] }], 1, 1);
      await setImmediate();
      assert.equal(removed, false);
      client.writes[0]();
      await setImmediate();
      assert.equal(removed, false, "metadata must outlive acknowledgement");
      client.acknowledging.resolve();
      await setImmediate();
      assert.equal(removed, false, "metadata must outlive detach");
      client.detaching.resolve();
      await removal;
      const next = status(1, "running", id(4));
      if (scope === "workspace") next.owner.workspaceId = id(6);
      client.statuses = [next];
      await manager.reconcile(
        next.owner.workspaceId,
        document([next], next.owner.canvasId),
      );
      assert.equal(manager.view(next.owner).connected, true);
      assert.equal(manager.entries.size, 1);
      assert.equal(client.active.size, 1);
    });

test("scoped draining leaves unrelated live sessions alone", async (t) => {
  const target = status(0);
  const sameCanvas = status(1);
  const otherCanvas = status(2, "running", id(4));
  const otherWorkspace = status(3);
  otherWorkspace.owner.workspaceId = id(6);
  const statuses = [target, sameCanvas, otherCanvas, otherWorkspace];
  const { manager, client } = setup(t, statuses);
  await manager.reconcile(workspaceId, document([target, sameCanvas]));
  await manager.reconcile(
    workspaceId,
    document([otherCanvas], otherCanvas.owner.canvasId),
  );
  await manager.reconcile(
    otherWorkspace.owner.workspaceId,
    document([otherWorkspace]),
  );
  target.state = "exited";
  const drain = manager.drainScope(
    workspaceId,
    canvasId,
    (status) => status.owner.tileId === target.owner.tileId,
  );
  client.emit(target.sessionId, [], 0, 0);
  await drain;
  assert.equal(client.active.size, 3);
  for (const item of [sameCanvas, otherCanvas, otherWorkspace])
    assert.equal(manager.view(item.owner).connected, true);
});
