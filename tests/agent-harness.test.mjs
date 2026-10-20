import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_FRAME_BYTES } from "@agentica/protocol";
import {
  AgentGuardError,
  CANVAS_AGENT_LIMITS,
  agentProgressLabel,
  runCanvasAgentHarness,
} from "../apps/desktop/src/lib/canvas-harness.ts";

const definition = {
  name: "canvas_edit",
  description: "Stage one canvas operation.",
  parameters: { type: "object" },
};
const messages = () => [{ role: "user", content: "Make a diagram" }];
const call = (n, args = { op: "updateText", text: `t${n}` }, name) => ({
  id: `call-${n}`,
  type: "function",
  function: {
    name: name ?? "canvas_edit",
    arguments: JSON.stringify(args),
  },
});
const options = (model, overrides = {}) => ({
  model,
  messages: messages(),
  toolsEnabled: true,
  tool: { definition, apply: () => ({ status: "preview-only" }) },
  signal: new AbortController().signal,
  providerLabel: "Test",
  ...overrides,
});
test("the harness bounds requests and total tool calls regardless of provider", async () => {
  const requests = [];
  const bounded = await runCanvasAgentHarness(
    options(
      async ({ messages }) => {
        requests.push(messages);
        return { content: null, toolCalls: [call(requests.length)] };
      },
      { limits: { maxRequests: 3 } },
    ),
  ).catch((error) => error);
  assert.ok(bounded instanceof AgentGuardError);
  assert.equal(bounded.code, "REQUEST_LIMIT");
  assert.match(bounded.message, /3-request limit/);
  assert.equal(requests.length, 3);

  let responses = 0;
  let applied = 0;
  const limited = await runCanvasAgentHarness(
    options(
      async () => {
        responses++;
        return {
          content: null,
          toolCalls: [call(responses * 2 - 1), call(responses * 2)],
        };
      },
      {
        limits: { maxToolCalls: 2 },
        tool: {
          definition,
          apply: () => {
            applied++;
            return { status: "preview-only" };
          },
        },
      },
    ),
  ).catch((error) => error);
  assert.ok(limited instanceof AgentGuardError);
  assert.equal(limited.code, "TOOL_LIMIT");
  assert.match(limited.message, /2-tool-call limit/);
  assert.equal(applied, 2);
  assert.equal(
    responses,
    2,
    "the oversize batch is rejected before applying it",
  );
});

test("one response cannot exceed the per-response tool budget", async () => {
  let applied = 0;
  const error = await runCanvasAgentHarness(
    options(
      async () => ({ content: null, toolCalls: [call(1), call(2), call(3)] }),
      {
        limits: { maxToolCallsPerResponse: 2 },
        tool: {
          definition,
          apply: () => {
            applied++;
            return {};
          },
        },
      },
    ),
  ).catch((failure) => failure);
  assert.equal(error.code, "TOOL_LIMIT");
  assert.match(error.message, /3 canvas edits in one response/);
  assert.equal(applied, 0);
});

test("malformed, foreign, duplicate, or oversized calls end the turn", async () => {
  const cases = [
    {
      calls: [call(1, {}, "shell")],
      limits: {},
      message: /invalid or unsupported/,
    },
    {
      calls: [call(1, {}), call(1, {})],
      limits: {},
      message: /invalid or unsupported/,
    },
    {
      calls: [{ ...call(1, {}), type: "text" }],
      limits: {},
      message: /invalid or unsupported/,
    },
    {
      calls: [call(1, { op: "updateText", text: "x".repeat(100) })],
      limits: { maxToolArgumentBytes: 20 },
      message: /invalid or unsupported/,
    },
    {
      calls: [
        { ...call(1, {}), function: { name: "canvas_edit", arguments: 3 } },
      ],
      limits: {},
      message: /invalid or unsupported/,
    },
  ];
  for (const entry of cases) {
    let applied = 0;
    const error = await runCanvasAgentHarness(
      options(async () => ({ content: null, toolCalls: entry.calls }), {
        limits: entry.limits,
        tool: {
          definition,
          apply: () => {
            applied++;
            return {};
          },
        },
      }),
    ).catch((failure) => failure);
    assert.equal(error.code, "INVALID_OUTPUT", error.stack);
    assert.match(error.message, entry.message);
    assert.ok(applied <= 1, "no call after the invalid one is applied");
  }
});

test("rejected calls are returned for repair and repeated identical edits stop the turn", async () => {
  const seen = [];
  const error = await runCanvasAgentHarness(
    options(
      async ({ messages }) => {
        seen.push(structuredClone(messages));
        return {
          content: null,
          toolCalls: [call(seen.length, { color: "blue" })],
        };
      },
      {
        limits: { maxRepeatedRejections: 2, maxFeedbackChars: 12 },
        tool: {
          definition,
          apply: () => {
            throw new Error("Use #rrggbb for color.");
          },
        },
      },
    ),
  ).catch((failure) => failure);
  assert.equal(error.code, "REPEATED_REJECTION");
  assert.match(error.message, /repeated the same rejected canvas edit 2 times/);
  assert.match(error.message, /Use #rrggbb/);
  const feedback = JSON.parse(seen[1].at(-1).content);
  assert.deepEqual(feedback, {
    status: "rejected",
    error: "Use #rrggbb ",
  });
  assert.equal(seen[1].at(-1).tool_call_id, "call-1");
});

test("valid tool feedback, assistant echoes, stats, and events describe the turn", async () => {
  const seen = [];
  const events = [];
  const result = await runCanvasAgentHarness(
    options(
      async ({ messages, tool }) => {
        seen.push({ messages, tool });
        if (seen.length === 1)
          return { content: null, toolCalls: [call(1, { op: "updateText" })] };
        return { content: "  Review the proposal.  ", toolCalls: [] };
      },
      {
        tool: {
          definition,
          apply: () => ({
            status: "preview-only",
            operation: { op: "updateText" },
          }),
        },
        onEvent: (event) => events.push(event),
      },
    ),
  );
  assert.deepEqual(result, {
    reply: "Review the proposal.",
    stats: { requests: 2, toolCalls: 1, rejectedToolCalls: 0 },
  });
  assert.equal(seen[0].tool.name, "canvas_edit");
  const assistant = seen[1].messages[1];
  assert.equal(assistant.role, "assistant");
  assert.deepEqual(assistant.tool_calls, [call(1, { op: "updateText" })]);
  assert.deepEqual(JSON.parse(seen[1].messages[2].content), {
    status: "preview-only",
    operation: { op: "updateText" },
  });
  assert.deepEqual(events, [
    { type: "request", index: 1 },
    { type: "tool", index: 1, callId: "call-1" },
    { type: "request", index: 2 },
    { type: "completed", requests: 2, toolCalls: 1 },
  ]);
});

test("tools stay disabled for text-only models and calls are refused", async () => {
  const seen = [];
  const error = await runCanvasAgentHarness(
    options(
      async ({ messages, tool }) => {
        seen.push(tool);
        return {
          content: messages.length === 1 ? null : "text",
          toolCalls: [call(1)],
        };
      },
      { toolsEnabled: false },
    ),
  ).catch((failure) => failure);
  assert.equal(error.code, "TOOL_LIMIT");
  assert.equal(seen[0], null);
  assert.equal(seen.length, 1);
});

test("a per-request deadline stops a provider that never answers", async () => {
  const error = await runCanvasAgentHarness(
    options(
      ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason));
        }),
      { limits: { requestTimeoutMs: 10 } },
    ),
  ).catch((failure) => failure);
  assert.equal(error.code, "TIMEOUT");
  assert.match(error.message, /exceeded 1 seconds without a response/);
});

test("caller cancellation stays an abort and no request is made", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(
    runCanvasAgentHarness(
      options(
        async () => {
          called = true;
          return { content: "never", toolCalls: [] };
        },
        { signal: controller.signal },
      ),
    ),
    { name: "AbortError" },
  );
  assert.equal(called, false);
});

test("oversized replies and truncated completions fail without a partial reply", async () => {
  const oversized = await runCanvasAgentHarness(
    options(async () => ({
      content: "x".repeat(CANVAS_AGENT_LIMITS.maxReplyChars + 1),
      toolCalls: [],
    })),
  ).catch((failure) => failure);
  assert.equal(oversized.code, "INVALID_OUTPUT");
  assert.match(oversized.message, /exceeds the text limit/);

  const truncated = await runCanvasAgentHarness(
    options(async () => ({
      content: "partial",
      toolCalls: [],
      finishReason: "length",
    })),
  ).catch((failure) => failure);
  assert.equal(truncated.code, "INVALID_OUTPUT");
  assert.match(truncated.message, /cut short/);

  const empty = await runCanvasAgentHarness(
    options(async () => ({ content: "   ", toolCalls: [] })),
  ).catch((failure) => failure);
  assert.equal(empty.code, "INVALID_OUTPUT");
  assert.match(empty.message, /empty response/);

  const invalid = await runCanvasAgentHarness(
    options(async () => ({ content: null, toolCalls: null })),
  ).catch((failure) => failure);
  assert.equal(invalid.code, "INVALID_OUTPUT");
  assert.match(invalid.message, /Invalid tool calls/);
});

test("progress labels stay compact and distinguish staged from rejected calls", () => {
  const progress = (overrides) => ({
    requests: 1,
    maxRequests: 8,
    stagedEdits: 0,
    rejectedToolCalls: 0,
    toolsEnabled: true,
    ...overrides,
  });
  assert.equal(
    agentProgressLabel(progress({})),
    "Request 1 of 8 · 0 edits staged",
  );
  assert.equal(
    agentProgressLabel(progress({ requests: 2, stagedEdits: 1 })),
    "Request 2 of 8 · 1 edit staged",
  );
  assert.equal(
    agentProgressLabel(progress({ stagedEdits: 3, rejectedToolCalls: 2 })),
    "Request 1 of 8 · 3 edits staged · 2 rejected",
  );
  assert.equal(
    agentProgressLabel(progress({ toolsEnabled: false, stagedEdits: 0 })),
    "Request 1 of 8",
  );
  assert.equal(
    agentProgressLabel(progress({ requests: 12 })).startsWith("Request 8 of 8"),
    true,
  );
});

test("the default canvas agent limits are explicit and shared", () => {
  assert.deepEqual(CANVAS_AGENT_LIMITS, {
    maxRequests: 8,
    maxToolCalls: 32,
    maxToolCallsPerResponse: 16,
    maxToolArgumentBytes: MAX_FRAME_BYTES,
    maxReplyChars: 10_000,
    maxFeedbackChars: 500,
    maxRepeatedRejections: 3,
    requestTimeoutMs: 90_000,
  });
});
