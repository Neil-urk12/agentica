import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  RunHistorySchema,
  RunEventSchema,
  ArtifactBatchSchema,
  AgentStartSchema,
  RunEventPageSchema,
  MAX_EVENT_PAGE_BYTES,
  ResultSchemas,
  RuntimeRequestSchema,
  SessionRequestSchema,
  SessionAttentionSchema,
} from "@agentica/protocol";

test("attention is bounded plain text and controls require identities and safe sequences", () => {
  const clear = {
    raised: false,
    count: 0,
    sequence: 4,
    kind: null,
    at: null,
    message: null,
  };
  const notification = {
    raised: true,
    count: 2,
    sequence: 5,
    kind: "notification",
    at: Date.now(),
    message: "<b>Received</b>",
  };
  for (const value of [
    clear,
    notification,
    { ...notification, message: "😀".repeat(256) },
  ])
    assert.equal(SessionAttentionSchema.safeParse(value).success, true);
  for (const value of [
    { ...notification, message: "x".repeat(257) },
    { ...notification, message: "\u001b[31m" },
    { ...notification, message: "\u009d" },
    { ...notification, count: 2 ** 32 },
    { ...notification, sequence: Number.MAX_SAFE_INTEGER + 1 },
    { ...notification, kind: "approval" },
    { ...notification, at: -1 },
    { ...notification, message: null },
    { ...clear, count: 1 },
  ])
    assert.equal(SessionAttentionSchema.safeParse(value).success, false);
  const id = "00000000-0000-4000-8000-000000000001";
  const owner = { workspaceId: id, canvasId: id, tileId: id };
  const commands = [
    { op: "focus", owner, sessionId: id, attachmentId: id, focused: true },
    { op: "clearAttention", owner, sessionId: id, sequence: 4 },
  ];
  for (const command of commands) {
    assert.equal(
      SessionRequestSchema.safeParse({ id: "test", command }).success,
      true,
    );
    assert.equal(
      SessionRequestSchema.safeParse({
        id: "test",
        command: { ...command, sessionId: "stale" },
      }).success,
      false,
    );
  }
  for (const command of [
    { ...commands[0], focused: 1 },
    { ...commands[0], attachmentId: undefined },
    { ...commands[1], sequence: -1 },
    { ...commands[1], sequence: 2 ** 53 },
  ])
    assert.equal(
      SessionRequestSchema.safeParse({ id: "test", command }).success,
      false,
    );
});

test("session controls enforce ownership shape and payload, cursor and dimension bounds", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const owner = { workspaceId: id, canvasId: id, tileId: id };
  const reference = { owner, sessionId: id, attachmentId: id };
  const request = (command) => ({ id: "session", command });
  assert.equal(
    SessionRequestSchema.safeParse(
      request({ op: "input", ...reference, bytes: [0, 255] }),
    ).success,
    true,
  );
  for (const command of [
    { op: "input", ...reference, bytes: [-1] },
    { op: "input", ...reference, bytes: [256] },
    { op: "input", ...reference, bytes: Array(16385).fill(1) },
    { op: "resize", ...reference, rows: 0, cols: 80 },
    { op: "resize", ...reference, rows: 24, cols: 401 },
    { op: "acknowledge", ...reference, sequence: -1 },
    {
      op: "subscribe",
      owner,
      sessionId: id,
      after: Number.MAX_SAFE_INTEGER + 1,
    },
    {
      op: "start",
      owner,
      requestId: "launch",
      rows: 24,
      cols: 80,
      command: "evil",
    },
    {
      op: "start",
      owner: { ...owner, tileId: "foreign" },
      requestId: "launch",
      rows: 24,
      cols: 80,
    },
  ])
    assert.equal(
      SessionRequestSchema.safeParse(request(command)).success,
      false,
    );
});

test("project collections validate explicit membership, geometry and saved presets", () => {
  const canvasId = "00000000-0000-4000-8000-000000000001";
  const projectId = "00000000-0000-4000-8000-000000000002";
  const tileId = "00000000-0000-4000-8000-000000000003";
  const document = {
    canvas: {
      id: canvasId,
      title: "Canvas",
      revision: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    nodes: [],
    edges: [],
    artifacts: [],
    projectGroups: [
      {
        id: projectId,
        canvasId,
        root: "/tmp/project",
        label: "Project",
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        collapsed: false,
        revision: 1,
        available: true,
      },
    ],
    sessionTiles: [
      {
        id: tileId,
        projectId,
        canvasId,
        kind: "cli-agent",
        preset: "codex",
        x: 16,
        y: 96,
        width: 400,
        height: 300,
        revision: 1,
      },
    ],
  };
  const schema = ResultSchemas["canvas.open"];
  assert.equal(schema.safeParse(document).success, true);
  for (const mutate of [
    (doc) => {
      doc.projectGroups[0].canvasId = tileId;
    },
    (doc) => {
      doc.sessionTiles[0].canvasId = tileId;
    },
    (doc) => {
      doc.sessionTiles[0].projectId = canvasId;
    },
    (doc) => {
      doc.sessionTiles[0].width = 800;
    },
    (doc) => {
      doc.sessionTiles[0].y = 0;
    },
    (doc) => {
      doc.sessionTiles[0].preset = "other";
    },
    (doc) => {
      doc.sessionTiles[0].preset = null;
    },
    (doc) => {
      doc.projectGroups.push(doc.projectGroups[0]);
    },
    (doc) => {
      doc.sessionTiles[0].id = projectId;
    },
  ]) {
    const invalid = structuredClone(document);
    mutate(invalid);
    assert.equal(schema.safeParse(invalid).success, false);
  }
  const request = {
    protocolVersion: 1,
    id: "tile",
    method: "project.createTile",
    params: {
      workspaceId: canvasId,
      canvasId,
      projectId,
      expectedRevision: 1,
      kind: "cli-agent",
      preset: "codex",
      x: 16,
      y: 96,
      width: 400,
      height: 300,
    },
  };
  assert.equal(RuntimeRequestSchema.safeParse(request).success, true);
  for (const extra of [
    { command: "evil" },
    { cwd: "/other" },
    { preset: "other" },
    { kind: "shell", preset: "codex" },
  ])
    assert.equal(
      RuntimeRequestSchema.safeParse({
        ...request,
        params: { ...request.params, ...extra },
      }).success,
      false,
    );
});

test("normalized run events enforce correlation, bounds, and cancellation ordering", () => {
  const fixtures = JSON.parse(
    readFileSync(
      new URL("./fixtures/run-events.json", import.meta.url),
      "utf8",
    ),
  );
  for (const fixture of fixtures)
    assert.equal(
      RunHistorySchema.safeParse(fixture.events).success,
      fixture.valid,
      fixture.name,
    );
  const started = fixtures[0].events[0];
  assert.equal(
    RunHistorySchema.safeParse(Array(129).fill(started)).success,
    false,
  );
  assert.equal(
    RunEventSchema.safeParse({
      ...started,
      sequence: Number.MAX_SAFE_INTEGER + 1,
    }).success,
    false,
  );
  const events = fixtures[0].events;
  assert.equal(
    RunEventPageSchema.safeParse({ events, nextSequence: 3 }).success,
    true,
  );
  assert.equal(
    RunEventPageSchema.safeParse({ events, nextSequence: 2 }).success,
    false,
  );
  const large = Array.from({ length: 16 }, (_, index) => ({
    ...started,
    sequence: index + 1,
    event: { type: "textDelta", text: "中".repeat(2000) },
  }));
  assert.equal(
    RunEventPageSchema.safeParse({ events: large, nextSequence: 16 }).success,
    false,
  );
  const page = {
    events: large
      .slice(0, 8)
      .map((event) => ({ ...event, event: { type: "textDelta", text: "x" } })),
    nextSequence: 8,
  };
  let remaining =
    MAX_EVENT_PAGE_BYTES - Buffer.byteLength(JSON.stringify(page));
  for (const event of page.events) {
    const extra = Math.min(remaining, 1999);
    event.event.text += "x".repeat(extra);
    remaining -= extra;
  }
  assert.equal(remaining, 0);
  assert.equal(Buffer.byteLength(JSON.stringify(page)), MAX_EVENT_PAGE_BYTES);
  assert.equal(RunEventPageSchema.safeParse(page).success, true);
  page.events.at(-1).event.text += "x";
  assert.equal(RunEventPageSchema.safeParse(page).success, false);
});

test("operation and agent scope bounds reject oversized and duplicate identities", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const operation = {
    op: "text.replace",
    artifactId: id,
    expectedRevision: 1,
    text: "new",
  };
  assert.equal(
    ArtifactBatchSchema.safeParse({
      workspaceId: id,
      canvasId: id,
      operations: Array(33).fill(operation),
    }).success,
    false,
  );
  assert.equal(
    AgentStartSchema.safeParse({
      workspaceId: id,
      canvasId: id,
      instructionArtifactId: id,
      readArtifactIds: Array(129).fill(id),
      writeArtifactIds: [],
    }).success,
    false,
  );
});
