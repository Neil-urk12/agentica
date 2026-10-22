import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeOperation,
  taskView,
} from "../apps/desktop/src/lib/agent-task.ts";
import { runCanvasTurn } from "../apps/desktop/src/lib/canvas-harness.ts";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const turn = (overrides = {}) => ({
  id: id(1),
  sequence: 1,
  model: "m",
  prompt: "Design a landing page\nwith a hero",
  reply: "",
  promptNodeId: id(2),
  replyNodeId: null,
  anchor: { x: 0, y: 0 },
  status: "generating",
  operations: [],
  error: "",
  ...overrides,
});
const progress = (overrides = {}) => ({
  requests: 1,
  maxRequests: 8,
  stagedEdits: 0,
  rejectedToolCalls: 0,
  toolsEnabled: true,
  phase: "thinking",
  steps: [],
  ...overrides,
});

test("staged edits are described in plain words", () => {
  const base = { nodeId: id(3), artifactId: id(4), x: 0, y: 0 };
  assert.equal(
    describeOperation({
      op: "createHtml",
      ...base,
      width: 960,
      height: 640,
      html: "<p>",
    }),
    "Create a 960×640 design",
  );
  assert.equal(
    describeOperation({
      op: "createShape",
      ...base,
      width: 10,
      height: 10,
      kind: "ellipse",
      color: "#123456",
      label: "  Start\nhere ",
    }),
    "Add ellipse “Start here”",
  );
  assert.equal(
    describeOperation({
      op: "createText",
      ...base,
      width: 10,
      height: 10,
      text: "x".repeat(80),
    }),
    `Add text “${"x".repeat(39)}…”`,
  );
  assert.equal(
    describeOperation({
      op: "connect",
      edgeId: id(5),
      sourceNodeId: id(6),
      targetNodeId: id(7),
    }),
    "Connect two objects",
  );
});

test("the task follows live progress, then the saved outcome", () => {
  assert.equal(taskView(turn(), null, null).headline, "Preparing the request…");
  const first = taskView(turn(), progress(), null);
  assert.equal(first.goal, "Design a landing page");
  assert.equal(first.state, "working");
  assert.match(first.headline, /Reading the canvas .* request 1 of 8/);
  const steps = [
    { kind: "note", text: "I'll add a hero section." },
    { kind: "edit", text: "Create a 960×640 design" },
    { kind: "rejected", text: "Duplicate proposed object identity." },
  ];
  const staging = taskView(
    turn(),
    progress({ phase: "staging", requests: 2, steps }),
    null,
  );
  assert.equal(staging.headline, "Staging canvas edits · request 2 of 8");
  assert.deepEqual(staging.steps, steps);
  assert.ok(staging.live);

  const operation = {
    op: "createHtml",
    nodeId: id(3),
    artifactId: id(4),
    x: 0,
    y: 0,
    width: 960,
    height: 640,
    html: "<p>",
  };
  const pending = turn({ status: "pending", operations: [operation] });
  const remembered = taskView(pending, null, steps);
  assert.equal(remembered.state, "review");
  assert.equal(remembered.headline, "1 change proposed · review to apply");
  assert.deepEqual(remembered.steps, steps, "the remembered log is kept");
  const reopened = taskView(
    turn({ status: "applied", operations: [operation] }),
    null,
    null,
  );
  assert.equal(reopened.headline, "Applied 1 change");
  assert.deepEqual(reopened.steps, [
    { kind: "edit", text: "Create a 960×640 design" },
  ]);
  assert.equal(reopened.live, false);
  assert.equal(
    taskView(turn({ status: "failed", error: "Timed out." }), null, null)
      .headline,
    "Timed out.",
  );
  assert.equal(
    taskView(turn({ status: "complete" }), null, null).state,
    "replied",
  );
  assert.equal(
    taskView(
      turn({ prompt: `Revise design ${id(9)} as a new design.` }),
      null,
      null,
    ).goal,
    "Revise a design from review comments",
  );
});

test("text sent with tool calls is reported as the model's note", async () => {
  const progress = [];
  let round = 0;
  const reply = (message, finishReason) => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ finish_reason: finishReason, message }],
    }),
  });
  await runCanvasTurn(
    {
      turn: { id: id(8), prompt: "Go", model: "m", anchor: { x: 0, y: 0 } },
      context: { nodes: [], artifacts: [], edges: [] },
      outline: { items: [], truncated: false },
      history: [],
    },
    {
      signal: new AbortController().signal,
      tools: true,
      request: { model: "m" },
      label: "Test",
      post: async () =>
        round++ === 0
          ? reply(
              {
                content: "  First I will add a title.  ",
                tool_calls: [
                  {
                    id: "call-1",
                    type: "function",
                    function: {
                      name: "canvas_read",
                      arguments: JSON.stringify({ nodeIds: [id(9)] }),
                    },
                  },
                ],
              },
              "tool_calls",
            )
          : reply({ content: "Done." }, "stop"),
      read: async () => ({ content: [] }),
      onProgress: (entry) => progress.push(entry),
    },
  );
  assert.deepEqual(progress.at(-1).steps, [
    { kind: "note", text: "First I will add a title." },
  ]);
});
