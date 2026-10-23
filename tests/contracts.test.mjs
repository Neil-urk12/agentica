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
  ReviewRecordSchema,
  MAX_FRAME_BYTES,
  CONVERSATION_READ,
  MCP_LIMITS,
  BUILTIN_AGENT_IDS,
  BUILTIN_AGENT_LABELS,
  AGENT_LIMITS,
  AgentPresetSchema,
  AgentCapabilitySchema,
} from "@agentica/protocol";

test("review records and method contracts are bounded within RPC frames", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const record = {
    id,
    order: 1,
    path: "😀".repeat(250),
    section: "unstaged",
    hunk: {
      header: "@@ -1 +1 @@",
      range: "@@ -1 +1 @@",
      fingerprint: "ab".repeat(32),
    },
    comment: "\u0001".repeat(1800),
    sent: false,
    outdated: false,
  };
  const scope = { workspaceId: id, canvasId: id, projectId: id, tileId: id };
  const request = {
    protocolVersion: 1,
    id: "review",
    method: "changes.review.save",
    params: { ...scope, expectedRevision: 1, record, deleteId: "composer" },
  };
  assert.equal(RuntimeRequestSchema.safeParse(request).success, true);
  assert.ok(Buffer.byteLength(JSON.stringify(request)) < MAX_FRAME_BYTES);
  assert.ok(
    Buffer.byteLength(
      JSON.stringify({
        protocolVersion: 1,
        id: "review",
        result: { revision: 1, record, next: null },
      }),
    ) < MAX_FRAME_BYTES,
  );
  for (const invalid of [
    { ...record, comment: "😀".repeat(1001) },
    { ...record, path: "" },
    { ...record, order: -1 },
    { ...record, hunk: undefined },
    { ...record, comment: "\u0001".repeat(4000) },
  ])
    assert.equal(ReviewRecordSchema.safeParse(invalid).success, false);
  for (const params of [
    { ...scope, after: id },
    { ...scope, expectedRevision: 0 },
    { ...scope, record: null },
  ])
    assert.equal(
      RuntimeRequestSchema.safeParse({
        protocolVersion: 1,
        id: "review",
        method: "changes.review.load",
        params,
      }).success,
      false,
    );
});

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

test("task requests, results and the guarded paste are strict", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const ref = { workspaceId: id, canvasId: id, nodeId: id };
  const request = (method, params) =>
    RuntimeRequestSchema.safeParse({
      protocolVersion: 1,
      id: "t",
      method,
      params,
    }).success;
  assert.equal(request("task.set", { ...ref, enabled: true }), true);
  assert.equal(
    request("task.update", {
      ...ref,
      expectedRevision: 1,
      assignedTileId: null,
    }),
    true,
  );
  assert.equal(
    request("task.update", { ...ref, expectedRevision: 1, done: true }),
    true,
  );
  assert.equal(
    request("task.recordSent", {
      ...ref,
      expectedRevision: 1,
      tileId: id,
      textRevision: 3,
    }),
    true,
  );
  for (const [method, params] of [
    ["task.set", { ...ref }],
    ["task.update", { ...ref, expectedRevision: 1 }],
    ["task.update", { ...ref, expectedRevision: 0, done: true }],
    ["task.update", { ...ref, expectedRevision: 1, assignedTileId: "codex" }],
    ["task.update", { ...ref, expectedRevision: 1, done: true, sentAt: "now" }],
    ["task.recordSent", { ...ref, expectedRevision: 1, tileId: id }],
  ])
    assert.equal(
      request(method, params),
      false,
      `${method} ${JSON.stringify(params)}`,
    );
  const task = {
    done: false,
    assignedTileId: id,
    sentAt: null,
    sentRevision: null,
    revision: 1,
  };
  assert.equal(ResultSchemas["task.update"].safeParse({ task }).success, true);
  assert.equal(
    ResultSchemas["task.set"].safeParse({ task: null }).success,
    true,
  );
  assert.equal(
    ResultSchemas["task.update"].safeParse({
      task: { ...task, sentAt: "2026-01-01T00:00:00.000Z" },
    }).success,
    false,
  );
  // Agent context nodes stay task-free.
  const node = { id, artifactId: id, x: 0, y: 0, width: 100, height: 100 };
  assert.equal(
    ResultSchemas["conversation.read"].safeParse({
      nodes: [{ ...node, task }],
      edges: [],
      artifacts: [],
      remaining: { reads: 1, bytes: 1 },
    }).success,
    false,
  );
  const paste = {
    op: "paste",
    owner: { workspaceId: id, canvasId: id, tileId: id },
    sessionId: id,
    attachmentId: id,
    text: "Do it",
  };
  for (const command of [paste, { ...paste, refuseIfAttention: true }])
    assert.equal(
      SessionRequestSchema.safeParse({ id: "p", command }).success,
      true,
    );
  assert.equal(
    SessionRequestSchema.safeParse({
      id: "p",
      command: { ...paste, refuseIfAttention: "yes" },
    }).success,
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
      doc.sessionTiles[0].preset = "";
    },
    (doc) => {
      doc.sessionTiles[0].preset = "x".repeat(65);
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
  // A preset this build does not know still loads; only launching it fails.
  for (const preset of ["other", "custom:not-a-uuid"]) {
    const unknown = structuredClone(document);
    unknown.sessionTiles[0].preset = preset;
    assert.equal(schema.safeParse(unknown).success, true, preset);
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
  for (const preset of [
    "claude",
    "custom:00000000-0000-4000-8000-000000000001",
  ])
    assert.equal(
      RuntimeRequestSchema.safeParse({
        ...request,
        params: { ...request.params, preset },
      }).success,
      true,
      preset,
    );
  for (const extra of [
    { command: "evil" },
    { cwd: "/other" },
    { preset: "other" },
    { preset: null },
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

test("conversation read limits match the runtime's", () => {
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        new URL("./fixtures/conversation-read-limits.json", import.meta.url),
        "utf8",
      ),
    ),
    CONVERSATION_READ,
  );
});

test("agent registry and custom agent limits match the runtime's", () => {
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        new URL("./fixtures/agent-registry.json", import.meta.url),
        "utf8",
      ),
    ),
    {
      builtinIds: [...BUILTIN_AGENT_IDS],
      builtinLabels: BUILTIN_AGENT_LABELS,
      limits: AGENT_LIMITS,
    },
  );
});

test("agent presets and custom agent definitions are validated", () => {
  const uuid = "00000000-0000-4000-8000-000000000001";
  for (const preset of ["claude", "cursor-agent", `custom:${uuid}`])
    assert.equal(AgentPresetSchema.safeParse(preset).success, true, preset);
  for (const preset of ["", "Codex", "other", "custom:", "custom:codex"])
    assert.equal(AgentPresetSchema.safeParse(preset).success, false, preset);
  const create = (params) =>
    RuntimeRequestSchema.safeParse({
      protocolVersion: 1,
      id: "agent",
      method: "agents.custom.create",
      params: {
        label: "Aider",
        executable: "/usr/bin/aider",
        argv: ["; rm -rf ~"],
        ...params,
      },
    }).success;
  assert.equal(create({}), true);
  for (const invalid of [
    { executable: "aider" },
    { executable: "/usr/bin/a\0" },
    { label: " " },
    { argv: ["a\0b"] },
    { argv: Array(65).fill("x") },
    { argv: ["é".repeat(4097)] },
    { workspaceId: uuid },
  ])
    assert.equal(create(invalid), false, JSON.stringify(invalid));
  const agent = { id: uuid, label: "Aider", executable: "/a", argv: [] };
  assert.equal(
    ResultSchemas["agents.custom.list"].safeParse({ agents: [agent] }).success,
    true,
  );
  const capability = {
    id: `custom:${uuid}`,
    label: "Aider",
    custom: true,
    path: null,
    reason: "Agent not configured on this machine.",
    setupHint: null,
  };
  assert.equal(AgentCapabilitySchema.safeParse(capability).success, true);
  assert.equal(
    AgentCapabilitySchema.safeParse({ ...capability, setupHint: "claude" })
      .success,
    false,
  );
});

test("mcp limits match the runtime's", () => {
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        new URL("./fixtures/mcp-limits.json", import.meta.url),
        "utf8",
      ),
    ),
    MCP_LIMITS,
  );
});

test("mcp configuration is bounded and its results never carry env values", () => {
  const base = {
    workspaceId: "00000000-0000-4000-8000-000000000001",
    name: "docs",
    command: "npx",
    args: ["-y", "server"],
    env: { TOKEN: "x" },
  };
  const create = (patch) =>
    RuntimeRequestSchema.safeParse({
      protocolVersion: 1,
      id: "mcp",
      method: "mcp.server.create",
      params: { ...base, ...patch },
    }).success;
  assert.equal(create({}), true);
  assert.equal(create({ name: "Has Space" }), false);
  assert.equal(create({ command: "  " }), false);
  assert.equal(create({ args: Array(33).fill("a") }), false);
  assert.equal(create({ env: { "1BAD": "x" } }), false);
  assert.equal(create({ env: { OK: "x".repeat(4097) } }), false);
  assert.equal(create({ extra: true }), false);
  const server = {
    id: base.workspaceId,
    name: "docs",
    transport: "stdio",
    command: "npx",
    args: [],
    envKeys: ["TOKEN"],
    enabled: false,
    status: "stopped",
    error: "",
    tools: [],
  };
  assert.equal(
    ResultSchemas["mcp.server.create"].safeParse({ server }).success,
    true,
  );
  assert.equal(
    ResultSchemas["mcp.server.create"].safeParse({
      server: { ...server, env: { TOKEN: "x" } },
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

test("conversation reads and outline items stay bounded", () => {
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const read = (nodeIds) =>
    RuntimeRequestSchema.safeParse({
      protocolVersion: 1,
      id: "read",
      method: "conversation.read",
      params: { workspaceId: id(0), canvasId: id(0), turnId: id(0), nodeIds },
    }).success;
  const ids = Array.from({ length: CONVERSATION_READ.nodes }, (_, n) =>
    id(n + 1),
  );
  assert.equal(read(ids), true);
  assert.equal(read([]), false);
  assert.equal(read([...ids, id(99)]), false);
  assert.equal(read([id(1), id(1)]), false);
  const outline = ResultSchemas["conversation.start"].shape.outline;
  const item = {
    nodeId: id(1),
    kind: "text",
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    title: "a".repeat(CONVERSATION_READ.title),
    writable: false,
  };
  assert.equal(
    outline.safeParse({ items: [item], truncated: false }).success,
    true,
  );
  for (const invalid of [
    { ...item, title: "a".repeat(CONVERSATION_READ.title + 1) },
    { ...item, kind: "path" },
    { ...item, conversation: false },
  ])
    assert.equal(
      outline.safeParse({ items: [invalid], truncated: false }).success,
      false,
    );
});
