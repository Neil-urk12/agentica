import { LIMITS, MAX_FRAME_BYTES } from "@agentica/protocol";

/**
 * Transport-agnostic harness for the main canvas agent.
 *
 * The harness owns every budget and validation rule so a provider adapter can
 * only translate messages into a completion. Guard rails enforced here:
 * bounded provider requests, a total and per-response tool-call budget, a tool
 * allowlist, unique call IDs, bounded arguments and reply text, a per-request
 * timeout, cancellation, rejection feedback for repair, and an early stop when
 * the model repeats the same rejected edit.
 */

export interface CanvasAgentLimits {
  /** Provider round trips per turn, including the turn's final answer. */
  maxRequests: number;
  /** Canvas edits accepted or rejected across the whole turn. */
  maxToolCalls: number;
  /** Tool calls the model may request in one response. */
  maxToolCallsPerResponse: number;
  /** Bytes allowed in one tool-call argument payload. */
  maxToolArgumentBytes: number;
  /** Characters allowed in the final reply. */
  maxReplyChars: number;
  /** Characters of a rejected call echoed back to the model. */
  maxFeedbackChars: number;
  /** Identical rejected calls tolerated before the turn stops. */
  maxRepeatedRejections: number;
  /** Deadline for one provider request. */
  requestTimeoutMs: number;
}

export const CANVAS_AGENT_LIMITS: CanvasAgentLimits = {
  maxRequests: 8,
  maxToolCalls: 32,
  maxToolCallsPerResponse: 16,
  maxToolArgumentBytes: MAX_FRAME_BYTES,
  maxReplyChars: LIMITS.text,
  maxFeedbackChars: 500,
  maxRepeatedRejections: 3,
  requestTimeoutMs: 90_000,
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

export type CanvasAgentGuardCode =
  | "INVALID_OUTPUT"
  | "REQUEST_LIMIT"
  | "TOOL_LIMIT"
  | "REPEATED_REJECTION"
  | "TIMEOUT";

/** A guard-rail failure. Provider and transport errors keep their own shapes. */
export class AgentGuardError extends Error {
  code: CanvasAgentGuardCode;

  constructor(code: CanvasAgentGuardCode, message: string) {
    super(message);
    this.name = "AgentGuardError";
    this.code = code;
  }
}

export type HarnessRole = "system" | "user" | "assistant" | "tool";

export interface HarnessToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface HarnessMessage {
  role: HarnessRole;
  content: string | null;
  tool_calls?: HarnessToolCall[];
  tool_call_id?: string;
}

export interface HarnessToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface HarnessCompletion {
  content: string | null;
  toolCalls: HarnessToolCall[];
  finishReason?: string;
}

export interface HarnessRequestContext {
  messages: HarnessMessage[];
  /** The single allowed tool, or null when tools are disabled for this turn. */
  tool: HarnessToolDefinition | null;
  signal: AbortSignal;
}

/** Translate one request into a completion. Transport errors pass through. */
export type HarnessModel = (
  request: HarnessRequestContext,
) => Promise<HarnessCompletion>;

/**
 * Apply one tool call. Return the feedback sent back to the model, or throw to
 * reject the call. A rejected call never changes application state.
 */
export interface HarnessTool {
  definition: HarnessToolDefinition;
  apply: (argumentsJson: string) => unknown;
}

export type CanvasHarnessEvent =
  | { type: "request"; index: number }
  | { type: "note"; text: string }
  | { type: "tool"; index: number; callId: string }
  | { type: "rejected"; callId: string; error: string }
  | { type: "completed"; requests: number; toolCalls: number };

export interface CanvasHarnessResult {
  reply: string;
  stats: { requests: number; toolCalls: number; rejectedToolCalls: number };
}

export interface CanvasHarnessOptions {
  model: HarnessModel;
  messages: HarnessMessage[];
  /** Enabled only when the model supports function calling. */
  toolsEnabled: boolean;
  tool?: HarnessTool;
  signal: AbortSignal;
  providerLabel: string;
  limits?: Partial<CanvasAgentLimits>;
  onEvent?: (event: CanvasHarnessEvent) => void;
}

const encoder = new TextEncoder();

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Invalid tool call.";
}

/** Run the bounded canvas agent loop and return the final reply. */
export async function runCanvasAgentHarness(
  options: CanvasHarnessOptions,
): Promise<CanvasHarnessResult> {
  const limits = { ...CANVAS_AGENT_LIMITS, ...options.limits };
  const tool = options.toolsEnabled ? options.tool : undefined;
  const messages = [...options.messages];
  const callIds = new Set<string>();
  const rejections = new Map<string, number>();
  let requests = 0;
  let toolCalls = 0;
  let rejectedToolCalls = 0;
  let lastToolError = "";

  async function requestCompletion(): Promise<HarnessCompletion> {
    options.signal.throwIfAborted();
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(options.signal.reason);
    options.signal.addEventListener("abort", forwardAbort, { once: true });
    const seconds = Math.max(1, Math.round(limits.requestTimeoutMs / 1000));
    const unit = seconds === 1 ? "second" : "seconds";
    const timeoutMessage = `The ${options.providerLabel} request exceeded ${seconds} ${unit} without a response. Nothing was applied; check that this device can reach the endpoint, raise the agent timeout in Settings, or retry.`;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const failure = new AgentGuardError("TIMEOUT", timeoutMessage);
        controller.abort(failure);
        reject(failure);
      }, limits.requestTimeoutMs);
    });
    try {
      return await Promise.race([
        options.model({
          messages,
          tool: tool?.definition ?? null,
          signal: controller.signal,
        }),
        timeout,
      ]);
    } catch (error) {
      // Keep a provider's own cancellation error (native cancel reports one),
      // but surface a plain abort as the caller's cancellation reason.
      if (options.signal.aborted && isAbortError(error))
        options.signal.throwIfAborted();
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", forwardAbort);
    }
  }

  for (let round = 0; round < limits.maxRequests; round++) {
    // Identical calls in one response are a bad batch, not a retry loop.
    const rejectedThisResponse = new Set<string>();
    requests += 1;
    options.onEvent?.({ type: "request", index: requests });
    const completion = await requestCompletion();
    options.signal.throwIfAborted();

    if (completion.content !== null && typeof completion.content !== "string")
      throw new AgentGuardError(
        "INVALID_OUTPUT",
        `${options.providerLabel} returned an invalid response.`,
      );
    if (completion.finishReason === "length")
      throw new AgentGuardError(
        "INVALID_OUTPUT",
        "The model response was cut short. Ask for a smaller change; nothing was applied.",
      );
    if (!Array.isArray(completion.toolCalls))
      throw new AgentGuardError(
        "INVALID_OUTPUT",
        "Invalid tool calls returned by the model.",
      );

    const calls = completion.toolCalls;
    if (calls.length === 0) {
      const reply = completion.content?.trim() ?? "";
      if (!reply)
        throw new AgentGuardError(
          "INVALID_OUTPUT",
          `${options.providerLabel} returned an empty response.`,
        );
      if (reply.length > limits.maxReplyChars)
        throw new AgentGuardError(
          "INVALID_OUTPUT",
          "The reply exceeds the text limit. Ask for a shorter answer; nothing was truncated.",
        );
      options.onEvent?.({ type: "completed", requests, toolCalls });
      return {
        reply,
        stats: { requests, toolCalls, rejectedToolCalls },
      };
    }

    if (!tool || toolCalls + calls.length > limits.maxToolCalls)
      throw new AgentGuardError(
        "TOOL_LIMIT",
        `The model exceeded its allowed canvas tools or ${limits.maxToolCalls}-tool-call limit.`,
      );
    if (calls.length > limits.maxToolCallsPerResponse)
      throw new AgentGuardError(
        "TOOL_LIMIT",
        `The model requested ${calls.length} canvas edits in one response; at most ${limits.maxToolCallsPerResponse} are allowed.`,
      );

    messages.push({
      role: "assistant",
      content: completion.content ?? null,
      tool_calls: calls,
    });
    // Text sent alongside tool calls is the model's own account of its plan.
    const note = completion.content?.trim();
    if (note)
      options.onEvent?.({
        type: "note",
        text: note.slice(0, limits.maxFeedbackChars),
      });

    for (const call of calls) {
      options.signal.throwIfAborted();
      if (
        typeof call?.id !== "string" ||
        !call.id ||
        callIds.has(call.id) ||
        call.type !== "function" ||
        call.function?.name !== tool.definition.name ||
        typeof call.function.arguments !== "string" ||
        byteLength(call.function.arguments) > limits.maxToolArgumentBytes
      )
        throw new AgentGuardError(
          "INVALID_OUTPUT",
          "The model returned an invalid or unsupported tool call.",
        );
      callIds.add(call.id);
      toolCalls += 1;
      options.onEvent?.({ type: "tool", index: toolCalls, callId: call.id });

      let feedback: unknown;
      try {
        feedback = tool.apply(call.function.arguments);
        lastToolError = "";
      } catch (error) {
        const message = errorMessage(error).slice(0, limits.maxFeedbackChars);
        lastToolError = message;
        rejectedToolCalls += 1;
        options.onEvent?.({
          type: "rejected",
          callId: call.id,
          error: message,
        });
        const key = `${call.function.name}\u0000${call.function.arguments}`;
        if (!rejectedThisResponse.has(key)) {
          rejectedThisResponse.add(key);
          const repeats = (rejections.get(key) ?? 0) + 1;
          rejections.set(key, repeats);
          if (repeats >= limits.maxRepeatedRejections)
            throw new AgentGuardError(
              "REPEATED_REJECTION",
              `The model repeated the same rejected canvas edit ${repeats} times. Nothing was applied. Last rejected edit: ${message}`,
            );
        }
        feedback = { status: "rejected", error: message };
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(feedback),
      });
    }
  }

  throw new AgentGuardError(
    "REQUEST_LIMIT",
    `The agent reached the ${limits.maxRequests}-request limit. Ask for a smaller change; nothing was applied.${lastToolError ? ` Last rejected edit: ${lastToolError}` : ""}`,
  );
}
