import assert from "node:assert/strict";
import { test } from "node:test";
import { CanvasOperationSchema, MAX_FRAME_BYTES } from "@agentica/protocol";
import {
  exchangePosition,
  stageOperations,
  checkedToolOperation,
} from "../apps/desktop/src/lib/canvas-agent.ts";
import {
  canvasToolSupport,
  runCanvasAgent,
} from "../apps/desktop/src/lib/openrouter.ts";

const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const context = {
  nodes: [
    { id: id(1), artifactId: id(2), x: 0, y: 0, width: 240, height: 160 },
  ],
  artifacts: [
    {
      id: id(2),
      type: "text",
      schemaVersion: 1,
      revision: 1,
      text: "Original",
    },
  ],
  edges: [],
};
const start = () => ({
  turn: {
    id: id(3),
    prompt: "Make a diagram",
    model: "openrouter/free",
    anchor: { x: 500, y: 0 },
  },
  context: structuredClone(context),
  history: [
    { prompt: "Earlier question", reply: "Earlier reply", status: "discarded" },
  ],
});
const result = (content, calls) => ({
  ok: true,
  json: async () => ({
    choices: [
      {
        message: { content, ...(calls ? { tool_calls: calls } : {}) },
        finish_reason: calls ? "tool_calls" : "stop",
      },
    ],
  }),
});
const tool = (n, operation) => ({
  id: `call-${n}`,
  type: "function",
  function: { name: "canvas_edit", arguments: JSON.stringify(operation) },
});
const options = () => ({
  apiKey: "test-only",
  tools: true,
  signal: new AbortController().signal,
});

test("staging creates stable editable objects and connectors without changing the source", () => {
  const before = structuredClone(context);
  const created = checkedToolOperation({
    op: "createShape",
    kind: "rectangle",
    x: 500,
    y: 0,
    width: 200,
    height: 100,
    color: "#123456",
    label: "Start",
  });
  assert.ok(CanvasOperationSchema.safeParse(created).success);
  const staged = stageOperations(context, [
    created,
    { op: "updateText", nodeId: id(1), text: "Changed" },
    {
      op: "connect",
      edgeId: id(4),
      sourceNodeId: id(1),
      targetNodeId: created.nodeId,
    },
  ]);
  assert.deepEqual(context, before);
  assert.equal(staged.artifacts[0].text, "Changed");
  assert.equal(staged.artifacts[1].drawing.shapes[0].label, "Start");
  assert.equal(staged.edges.length, 1);
  assert.throws(
    () =>
      stageOperations(context, [
        { op: "updateText", nodeId: id(99), text: "Outside" },
      ]),
    /outside/,
  );
  assert.throws(
    () =>
      checkedToolOperation({
        op: "createShape",
        kind: "image",
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        color: "#123456",
      }),
    /Invalid canvas/,
  );
});

test("exchange placement uses selected content and finds open space without moving anything", () => {
  const nodes = [
    { ...context.nodes[0] },
    { id: id(5), x: 304, y: 0, width: 200, height: 160 },
  ];
  const before = structuredClone(nodes);
  assert.deepEqual(exchangePosition(nodes, [id(1)], { x: 0, y: 0 }), {
    x: 568,
    y: 0,
  });
  assert.deepEqual(exchangePosition(nodes, [], { x: 1000, y: 500 }), {
    x: 1000,
    y: 500,
  });
  assert.deepEqual(nodes, before);
});

test("geometric edits and resizing preserve identities while freehand edits stay limited", () => {
  const shape = checkedToolOperation({
    op: "createShape",
    kind: "rectangle",
    x: 500,
    y: 0,
    width: 200,
    height: 100,
    color: "#123456",
  });
  const staged = stageOperations(context, [
    shape,
    {
      op: "updateShape",
      nodeId: shape.nodeId,
      kind: "ellipse",
      color: "#aabbcc",
      label: "Refined",
    },
    {
      op: "place",
      nodeId: shape.nodeId,
      x: 600,
      y: 100,
      width: 300,
      height: 150,
    },
  ]);
  assert.equal(staged.nodes[1].id, shape.nodeId);
  assert.equal(staged.nodes[1].width, 300);
  assert.equal(staged.artifacts[1].drawing.shapes[0].kind, "ellipse");
  const freehand = {
    nodes: context.nodes,
    edges: [],
    artifacts: [
      {
        ...context.artifacts[0],
        type: "drawing",
        drawing: {
          shapes: [
            {
              kind: "path",
              points: [
                [1, 1],
                [20, 20],
              ],
              color: "#123456",
              width: 2,
            },
          ],
        },
      },
    ],
  };
  assert.throws(
    () =>
      stageOperations(freehand, [
        { op: "place", nodeId: id(1), x: 0, y: 0, width: 300, height: 160 },
      ]),
    /moving only/,
  );
  assert.equal(
    stageOperations(freehand, [
      { op: "place", nodeId: id(1), x: 100, y: 100, width: 240, height: 160 },
    ]).nodes[0].x,
    100,
  );
});

test("the agent stages multi-round tools, returns generated IDs, and includes resolution history", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (_url, request) => {
    const body = JSON.parse(request.body);
    requests.push(body);
    if (requests.length === 1) {
      assert.match(body.messages[1].content, /Earlier question/);
      assert.match(body.messages[2].content, /discarded/);
      assert.equal(body.provider.require_parameters, true);
      const variants = body.tools[0].function.parameters.oneOf;
      assert.ok(
        !variants
          .find((s) => s.properties.op.const === "createShape")
          .required.includes("nodeId"),
      );
      return result(null, [
        tool(1, {
          op: "createShape",
          kind: "ellipse",
          x: 500,
          y: 0,
          width: 200,
          height: 100,
          color: "#123456",
          label: "Finish",
        }),
      ]);
    }
    if (requests.length === 2) {
      const operation = JSON.parse(body.messages.at(-1).content).operation;
      assert.equal(CanvasOperationSchema.safeParse(operation).success, true);
      return result(null, [
        tool(2, {
          op: "connect",
          sourceNodeId: id(1),
          targetNodeId: operation.nodeId,
        }),
      ]);
    }
    return result("Review the proposed diagram.");
  });
  const input = start();
  const before = structuredClone(input);
  const response = await runCanvasAgent(input, options());
  assert.equal(response.operations.length, 2);
  assert.equal(
    response.operations[1].targetNodeId,
    response.operations[0].nodeId,
  );
  assert.equal(response.reply, "Review the proposed diagram.");
  assert.deepEqual(input, before);
  assert.equal(requests.length, 3);
});

test("the canvas agent reports live request, staged-edit, and rejection progress", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_url, request) => {
    const body = JSON.parse(request.body);
    requests++;
    if (requests === 1)
      return result(null, [
        tool(1, { op: "updateText", nodeId: id(1), text: "Staged" }),
        tool(2, { op: "updateText", nodeId: id(99), text: "Outside" }),
      ]);
    assert.equal(
      JSON.parse(body.messages.at(-1).content).status,
      "rejected",
      "the invalid call still reaches the model as feedback",
    );
    return result("Review the staged edit.");
  });
  const progress = [];
  await runCanvasAgent(start(), {
    ...options(),
    onProgress: (entry) => progress.push(entry),
  });
  assert.deepEqual(progress[0], {
    requests: 1,
    maxRequests: 8,
    stagedEdits: 0,
    rejectedToolCalls: 0,
    toolsEnabled: true,
  });
  assert.ok(
    progress.some(
      (entry) =>
        entry.requests === 1 &&
        entry.stagedEdits === 1 &&
        entry.rejectedToolCalls === 1,
    ),
  );
  assert.deepEqual(progress.at(-1), {
    requests: 2,
    maxRequests: 8,
    stagedEdits: 1,
    rejectedToolCalls: 1,
    toolsEnabled: true,
  });
});

test("text-only models retain conversation replies and never receive canvas tools", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, request) => {
    if (String(url).endsWith("/models"))
      return {
        ok: true,
        json: async () => ({
          data: [{ id: "text/model", supported_parameters: [] }],
        }),
      };
    assert.equal(JSON.parse(request.body).tools, undefined);
    return result("A plain canvas reply.");
  });
  assert.equal(await canvasToolSupport("text/model"), false);
  assert.equal(await canvasToolSupport("openrouter/free"), true);
  const response = await runCanvasAgent(start(), {
    ...options(),
    tools: false,
  });
  assert.deepEqual(response, {
    reply: "A plain canvas reply.",
    operations: [],
  });
});

test("invalid canvas fields are returned to the model for correction without staging the rejected edit", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_url, request) => {
    const body = JSON.parse(request.body);
    requests++;
    if (requests === 1)
      return result(null, [
        tool(1, {
          op: "createShape",
          kind: "rectangle",
          x: 500,
          y: 0,
          width: 200,
          height: 100,
          color: "blue",
          label: "Start",
        }),
      ]);
    if (requests === 2) {
      const feedback = JSON.parse(body.messages.at(-1).content);
      assert.equal(body.messages.at(-1).tool_call_id, "call-1");
      assert.equal(feedback.status, "rejected");
      assert.match(feedback.error, /color/);
      return result(null, [
        tool(2, {
          op: "createShape",
          kind: "rectangle",
          x: 500,
          y: 0,
          width: 200,
          height: 100,
          color: "#0000ff",
          label: "Start",
        }),
      ]);
    }
    return result("Review the corrected shape.");
  });
  const input = start();
  const response = await runCanvasAgent(input, options());
  assert.equal(requests, 3);
  assert.equal(response.operations.length, 1);
  assert.equal(response.operations[0].color, "#0000ff");
  assert.deepEqual(input.context, context);
});

test("tool repair preserves valid staged edits and reports every rejected call in a batch", async (t) => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_url, request) => {
    const body = JSON.parse(request.body);
    requests++;
    if (requests === 1)
      return result(null, [
        tool(1, {
          op: "createText",
          x: 500,
          y: 0,
          width: 200,
          height: 100,
          text: "Keep this proposal",
        }),
        tool(2, { op: "updateText", nodeId: id(99), text: "Outside context" }),
      ]);
    if (requests === 2) {
      const feedback = body.messages.slice(-2);
      assert.deepEqual(
        feedback.map((m) => m.tool_call_id),
        ["call-1", "call-2"],
      );
      assert.deepEqual(
        feedback.map((m) => JSON.parse(m.content).status),
        ["preview-only", "rejected"],
      );
      assert.match(JSON.parse(feedback[1].content).error, /outside/);
      return result(null, [
        {
          id: "call-3",
          type: "function",
          function: { name: "canvas_edit", arguments: "{" },
        },
      ]);
    }
    if (requests === 3) {
      assert.match(
        JSON.parse(body.messages.at(-1).content).error,
        /valid JSON/,
      );
      return result(null, [
        tool(4, { op: "updateText", nodeId: id(1), text: "Correct target" }),
      ]);
    }
    return result("Review the corrected changes.");
  });
  const input = start();
  const response = await runCanvasAgent(input, options());
  assert.deepEqual(
    response.operations.map((op) => op.op),
    ["createText", "updateText"],
  );
  assert.equal(response.operations[1].nodeId, id(1));
  assert.deepEqual(input.context, context);
});

test("rejected tool calls count toward the turn limit", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () =>
    result(
      null,
      Array.from({ length: calls === 0 ? 16 : 17 }, () => tool(++calls, {})),
    ),
  );
  await assert.rejects(
    runCanvasAgent(start(), options()),
    /32-tool-call limit/,
  );
  assert.equal(
    calls,
    33,
    "the second batch is rejected before any of its calls are processed",
  );
});

test("malformed tools, foreign targets, and oversized replies fail without changes", async (t) => {
  for (const response of [
    result(null, [
      { ...tool(1, {}), function: { name: "shell", arguments: "{}" } },
    ]),
    result(null, [tool(1, { op: "updateText", nodeId: id(99), text: "No" })]),
    result(null, [
      { ...tool(1, {}), function: { name: "canvas_edit", arguments: "{" } },
    ]),
    result("x".repeat(10001)),
    result(
      null,
      Array.from({ length: 33 }, (_, i) =>
        tool(i, { op: "updateText", nodeId: id(1), text: "No" }),
      ),
    ),
  ]) {
    const mock = t.mock.method(globalThis, "fetch", async () => response);
    const input = start();
    await assert.rejects(runCanvasAgent(input, options()));
    assert.deepEqual(input.context, context);
    mock.mock.restore();
  }
});

test("agent request limits, cancellation, and provider failures keep the canvas untouched", async (t) => {
  let calls = 0;
  const mock = t.mock.method(globalThis, "fetch", async () =>
    result(null, [
      tool(++calls, {
        op: "updateText",
        nodeId: id(1),
        text: `Draft ${calls}`,
      }),
    ]),
  );
  await assert.rejects(runCanvasAgent(start(), options()), /8-request limit/);
  assert.equal(calls, 8);
  mock.mock.restore();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    runCanvasAgent(start(), { ...options(), signal: controller.signal }),
    { name: "AbortError" },
  );
  const large = start();
  large.context.artifacts[0].text = "中".repeat(MAX_FRAME_BYTES);
  await assert.rejects(runCanvasAgent(large, options()), /exceed 16 KiB/);
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 503 }));
  await assert.rejects(runCanvasAgent(start(), options()), /503/);
});
