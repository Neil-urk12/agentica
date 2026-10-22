import {
  CONVERSATION_READ,
  IdSchema,
  LIMITS,
  type CanvasOperation,
  type RuntimeResult,
} from "@agentica/protocol";
import {
  canvasTools,
  checkedToolOperation,
  stageOperations,
  systemPrompt,
} from "./canvas-agent.ts";
import { describeOperation } from "./agent-task.ts";

/** Limits the harness owns; reads are budgeted by the runtime instead. */
export const BUDGET = Object.freeze({
  rounds: 8,
  toolCalls: 32,
  /** Tool calls the model may request in one response. */
  perResponse: 16,
  /** Identical rejected calls tolerated before the turn stops. */
  repeatedRejections: 3,
  requestBytes: 128 * 1024,
  // A design can be up to 128 KiB; it is streamed to the backend in ordered
  // chunks when the proposal is finished, so one canvas_edit tool argument must
  // be allowed to carry a full design even though no single RPC frame does.
  toolArgBytes: 128 * 1024,
  ms: 120_000,
});
/** Every limit is a number, so callers can supply their own values. */
export type Budget = { readonly [K in keyof typeof BUDGET]: number };
const BUDGET_NAMES: Record<keyof Budget, string> = {
  rounds: "model request",
  toolCalls: "tool call",
  perResponse: "tool calls per response",
  repeatedRejections: "repeated rejected edit",
  requestBytes: "request size",
  toolArgBytes: "tool argument size",
  ms: "time",
};

/** One line of a turn's task log, shown in the task node. */
export interface CanvasAgentStep {
  kind: "edit" | "rejected" | "note";
  text: string;
}

/** Live counters shown while a turn generates. */
export interface CanvasAgentProgress {
  requests: number;
  maxRequests: number;
  stagedEdits: number;
  rejectedToolCalls: number;
  toolsEnabled: boolean;
  /** Waiting for the model, or applying the edits it asked for. */
  phase: "thinking" | "staging";
  /** Edits staged or rejected, and the model's own notes, in order. */
  steps: CanvasAgentStep[];
}

/** One compact line for the composer, for example "Request 2 of 8 · 1 edit staged". */
export function agentProgressLabel(progress: CanvasAgentProgress): string {
  const request = `Request ${Math.min(progress.requests, progress.maxRequests)} of ${progress.maxRequests}`;
  if (!progress.toolsEnabled) return request;
  const edits = `${progress.stagedEdits} ${progress.stagedEdits === 1 ? "edit" : "edits"} staged`;
  const rejected = progress.rejectedToolCalls
    ? ` · ${progress.rejectedToolCalls} rejected`
    : "";
  return `${request} · ${edits}${rejected}`;
}

/** Read rejections the model caused and can recover from; anything else ends the turn. */
const MODEL_READ_ERRORS = new Set([
  "SCOPE_DENIED",
  "BUDGET_EXCEEDED",
  "INVALID_PARAMS",
]);

type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};
type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
type ChatReply = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

export type HarnessDeps = {
  signal: AbortSignal;
  tools: boolean;
  /** Model ID and provider-specific request fields. */
  request: Record<string, unknown>;
  /** "OpenRouter" or "Provider", for error messages. */
  label: string;
  post(body: string, signal: AbortSignal): Promise<ChatReply>;
  read(nodeIds: string[]): Promise<RuntimeResult<"conversation.read">>;
  budget?: Budget;
  /** Called whenever a request starts or an edit is staged or rejected. */
  onProgress?: (progress: CanvasAgentProgress) => void;
};

export type TurnResult = {
  reply: string;
  operations: CanvasOperation[];
  /** The budget that ran out before the model finished, if any. */
  partial?: keyof Budget;
};

class Exhausted extends Error {
  readonly budget: keyof Budget;
  constructor(budget: keyof Budget, message: string) {
    super(message);
    this.budget = budget;
  }
}

/** Embedded `<` is escaped so data can never close its delimiter. */
const data = (value: unknown) =>
  JSON.stringify(value).replaceAll("<", "\\u003c");

function checkedReadIds(args: unknown): string[] {
  const ids =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as { nodeIds?: unknown }).nodeIds
      : undefined;
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > CONVERSATION_READ.nodes ||
    new Set(ids).size !== ids.length ||
    !ids.every((id) => IdSchema.safeParse(id).success)
  )
    throw new Error(
      `canvas_read needs nodeIds: 1–${CONVERSATION_READ.nodes} unique object IDs from the outline.`,
    );
  return ids;
}

/** One canvas agent turn: budgets, tool allowlist, and transcript. Never edits the canvas. */
export async function runCanvasTurn(
  start: RuntimeResult<"conversation.start">,
  deps: HarnessDeps,
): Promise<TurnResult> {
  const budget = deps.budget ?? BUDGET;
  const { label } = deps;
  // The timeout is its own controller so a user cancel is never mistaken for it.
  const timeout = new AbortController();
  const turn = new AbortController();
  const cancel = () => turn.abort(deps.signal.reason);
  if (deps.signal.aborted) cancel();
  deps.signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    timeout.abort();
    turn.abort();
  }, budget.ms);
  const signal = turn.signal;

  const messages: Message[] = [
    { role: "system", content: systemPrompt(deps.tools) },
  ];
  for (const previous of start.history) {
    messages.push({ role: "user", content: previous.prompt });
    if (previous.reply)
      messages.push({
        role: "assistant",
        content: `${previous.reply}\n[Previous turn status: ${previous.status}. Only applied proposals changed canvas objects.]`,
      });
  }
  messages.push({
    role: "user",
    content: `${start.turn.prompt}\n\n<canvas-data>\n${data({
      proposalAnchor: { x: start.turn.anchor.x + 404, y: start.turn.anchor.y },
      writeScope: start.context,
      outline: start.outline,
    })}\n</canvas-data>`,
  });
  let operations: CanvasOperation[] = [];
  let toolCalls = 0;
  let lastToolError = "";
  let lastText = "";
  const callIds = new Set<string>();
  let requests = 0;
  let rejectedToolCalls = 0;
  let phase: CanvasAgentProgress["phase"] = "thinking";
  const steps: CanvasAgentStep[] = [];
  /** Identical rejected calls, keyed by tool name and arguments. */
  const rejections = new Map<string, number>();
  const report = () =>
    deps.onProgress?.({
      requests,
      maxRequests: budget.rounds,
      stagedEdits: operations.length,
      rejectedToolCalls,
      toolsEnabled: deps.tools,
      phase,
      steps: [...steps],
    });

  async function loop(): Promise<TurnResult> {
    for (let round = 0; round < budget.rounds; round++) {
      signal.throwIfAborted();
      requests = round + 1;
      phase = "thinking";
      report();
      const body = JSON.stringify({
        ...deps.request,
        messages,
        ...(deps.tools ? { tools: canvasTools() } : {}),
      });
      if (new TextEncoder().encode(body).length > budget.requestBytes)
        throw new Exhausted(
          "requestBytes",
          `Conversation and canvas context exceed the ${budget.requestBytes / 1024} KiB request budget. Select fewer objects or use a new canvas; nothing was truncated.`,
        );
      const response = await deps.post(body, signal);
      if (!response.ok)
        throw new Error(
          `${label} request failed (${response.status}). Check the model's availability, tool support, or API key in Settings.`,
        );
      const reply = (await response.json()) as {
        error?: { message?: string };
        choices?: {
          finish_reason?: string;
          message?: { content?: string | null; tool_calls?: ToolCall[] };
        }[];
      } | null;
      if (reply?.error)
        throw new Error(
          `${label} could not complete this request. Check model availability and your API key in Settings.`,
        );
      const choice = reply?.choices?.[0];
      const message = choice?.message;
      if (
        !message ||
        (message.content != null && typeof message.content !== "string")
      )
        throw new Error(`${label} returned an invalid response.`);
      if (choice?.finish_reason === "length")
        throw new Error(
          "The model response was cut short. Ask for a smaller change; nothing was applied.",
        );
      const calls = message.tool_calls ?? [];
      if (!Array.isArray(calls))
        throw new Error("Invalid tool calls returned by the model.");
      if (!calls.length) {
        const text = message.content?.trim();
        if (!text) throw new Error(`${label} returned an empty response.`);
        if (text.length > LIMITS.text)
          throw new Error(
            "The reply exceeds the text limit. Ask for a shorter answer; nothing was truncated.",
          );
        return { reply: text, operations };
      }
      if (!deps.tools)
        throw new Error("The model called canvas tools it was not offered.");
      if (toolCalls + calls.length > budget.toolCalls)
        throw new Exhausted(
          "toolCalls",
          `The model exceeded its ${budget.toolCalls}-tool-call limit.`,
        );
      if (calls.length > budget.perResponse)
        throw new Exhausted(
          "perResponse",
          `The model requested ${calls.length} canvas edits in one response; at most ${budget.perResponse} are allowed.`,
        );
      toolCalls += calls.length;
      // Text sent alongside tool calls is the model's own account of its plan.
      const note = message.content?.trim();
      if (note) steps.push({ kind: "note", text: note.slice(0, 500) });
      if (note) lastText = note;
      phase = "staging";
      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: calls,
      });
      // Identical calls in one response are a bad batch, not a retry loop.
      const rejectedThisResponse = new Set<string>();
      for (const call of calls) {
        signal.throwIfAborted();
        if (
          !call ||
          typeof call.id !== "string" ||
          !call.id ||
          callIds.has(call.id) ||
          call.type !== "function" ||
          typeof call.function?.name !== "string" ||
          typeof call.function.arguments !== "string" ||
          new TextEncoder().encode(call.function.arguments).length >
            budget.toolArgBytes
        )
          throw new Error(
            "The model returned an invalid or unsupported tool call.",
          );
        callIds.add(call.id);
        const outcome = (await runTool(call.function)) as { status?: string };
        if (outcome?.status === "rejected") {
          rejectedToolCalls += 1;
          const key = `${call.function.name}\u0000${call.function.arguments}`;
          if (!rejectedThisResponse.has(key)) {
            rejectedThisResponse.add(key);
            const repeats = (rejections.get(key) ?? 0) + 1;
            rejections.set(key, repeats);
            if (repeats >= budget.repeatedRejections)
              throw new Exhausted(
                "repeatedRejections",
                `The model repeated the same rejected canvas edit ${repeats} times. Nothing was applied.${lastToolError ? ` Last rejected edit: ${lastToolError}` : ""}`,
              );
          }
        }
        report();
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: data(outcome),
        });
      }
    }
    throw new Exhausted(
      "rounds",
      `The agent reached the ${budget.rounds}-request limit. Ask for a smaller change; nothing was applied.${lastToolError ? ` Last rejected edit: ${lastToolError}` : ""}`,
    );
  }

  async function runTool(call: ToolCall["function"]): Promise<unknown> {
    if (call.name !== "canvas_edit" && call.name !== "canvas_read")
      return {
        status: "rejected",
        error: `Unknown tool ${call.name.slice(0, 64)}. Only canvas_read and canvas_edit exist.`,
      };
    let args: unknown;
    try {
      args = JSON.parse(call.arguments);
    } catch {
      return {
        status: "rejected",
        error: `Tool arguments must be valid JSON matching the ${call.name} schema.`,
      };
    }
    if (call.name === "canvas_read") {
      let ids: string[];
      try {
        ids = checkedReadIds(args);
      } catch (error) {
        return { status: "rejected", error: (error as Error).message };
      }
      try {
        const result = await deps.read(ids);
        signal.throwIfAborted();
        return { status: "ok", ...result };
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        if (code && MODEL_READ_ERRORS.has(code))
          return { status: "rejected", error: (error as Error).message };
        throw error;
      }
    }
    try {
      const operation = checkedToolOperation(args);
      const next = [...operations, operation];
      stageOperations(start.context, next);
      operations = next;
      lastToolError = "";
      steps.push({ kind: "edit", text: describeOperation(operation) });
      return { status: "preview-only", operation };
    } catch (error) {
      lastToolError =
        error instanceof Error ? error.message : "Invalid canvas operation.";
      steps.push({ kind: "rejected", text: lastToolError });
      return { status: "rejected", error: lastToolError };
    }
  }

  try {
    return await loop();
  } catch (error) {
    if (deps.signal.aborted) throw error;
    const exhausted = timeout.signal.aborted
      ? new Exhausted(
          "ms",
          `The agent ran past its ${budget.ms / 1000}-second limit. Ask for a smaller change, or raise the agent time limit in Settings > Advanced; nothing was applied.`,
        )
      : error;
    if (!(exhausted instanceof Exhausted)) throw error;
    if (!operations.length) throw exhausted;
    const note = `Partial proposal: the agent stopped at its ${BUDGET_NAMES[exhausted.budget]} limit before finishing. Review what it staged.`;
    const reply = lastText ? `${note}\n\n${lastText}` : note;
    return {
      reply: reply.length > LIMITS.text ? note : reply,
      operations,
      partial: exhausted.budget,
    };
  } finally {
    clearTimeout(timer);
    deps.signal.removeEventListener("abort", cancel);
  }
}
