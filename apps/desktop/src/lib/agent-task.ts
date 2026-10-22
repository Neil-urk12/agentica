/**
 * The task node: what the canvas agent is working on for one turn. While a
 * turn runs it shows the live harness log; afterwards it is rebuilt from the
 * saved turn, so the summary survives reopening even though rejected calls
 * and the model's interim notes are only kept in memory.
 */
import type { CanvasOperation, ConversationTurn } from "@agentica/protocol";
import type { CanvasAgentProgress, CanvasAgentStep } from "./canvas-harness.ts";

export const TASK_NODE = { width: 280, gap: 32 } as const;

const quoted = (value: string | undefined, limit = 40) => {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return ` “${text.length > limit ? `${text.slice(0, limit - 1)}…` : text}”`;
};

/** A short human description of one staged canvas edit. */
export function describeOperation(operation: CanvasOperation): string {
  switch (operation.op) {
    case "createHtml":
      return `Create a ${Math.round(operation.width)}×${Math.round(operation.height)} design`;
    case "createText":
      return `Add text${quoted(operation.text)}`;
    case "createShape":
      return `Add ${operation.kind}${quoted(operation.label)}`;
    case "updateText":
      return `Rewrite text${quoted(operation.text)}`;
    case "updateShape":
      return `Change shape to ${operation.kind}${quoted(operation.label)}`;
    case "place":
      return "Move or resize an object";
    case "connect":
      return "Connect two objects";
  }
}

export type TaskState =
  | "working"
  | "review"
  | "applied"
  | "discarded"
  | "replied"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface TaskView {
  /** The first line of the prompt: what the agent was asked to do. */
  goal: string;
  state: TaskState;
  /** The current activity, or the outcome once the turn ends. */
  headline: string;
  steps: CanvasAgentStep[];
  /** True when the steps came from the live harness log. */
  live: boolean;
}

function goal(prompt: string) {
  const first = prompt.split("\n").find((line) => line.trim()) ?? prompt;
  // Revision prompts start with an internal marker; describe them plainly.
  if (first.startsWith("Revise design "))
    return "Revise a design from review comments";
  const text = first.trim();
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Describe a turn. `log` holds the live (or last remembered) harness steps for
 * this turn; without it the steps are the saved proposal's operations.
 */
export function taskView(
  turn: ConversationTurn,
  progress: CanvasAgentProgress | null,
  log: CanvasAgentStep[] | null,
): TaskView {
  const saved = turn.operations.map((operation) => ({
    kind: "edit" as const,
    text: describeOperation(operation),
  }));
  const steps = progress?.steps ?? log ?? saved;
  const live = !!(progress || log);
  const edits = live
    ? steps.filter((step) => step.kind === "edit").length
    : saved.length;
  const view = (state: TaskState, headline: string): TaskView => ({
    goal: goal(turn.prompt),
    state,
    headline,
    steps,
    live,
  });
  switch (turn.status) {
    case "generating": {
      if (!progress) return view("working", "Preparing the request…");
      const request = `request ${Math.min(progress.requests, progress.maxRequests)} of ${progress.maxRequests}`;
      return view(
        "working",
        progress.phase === "staging"
          ? `Staging canvas edits · ${request}`
          : progress.requests <= 1 && !progress.steps.length
            ? `Reading the canvas and your prompt · ${request}`
            : `Waiting for the model · ${request}`,
      );
    }
    case "pending":
      return view(
        "review",
        `${plural(edits, "change")} proposed · review to apply`,
      );
    case "applied":
      return view("applied", `Applied ${plural(saved.length, "change")}`);
    case "discarded":
      return view("discarded", "Proposal discarded; nothing changed");
    case "complete":
      return view("replied", "Answered without changing the canvas");
    case "failed":
      return view("failed", turn.error || "The request failed.");
    case "cancelled":
      return view("cancelled", "Cancelled; nothing was applied");
    case "interrupted":
      return view("interrupted", "Interrupted; retry from the prompt card");
  }
}
