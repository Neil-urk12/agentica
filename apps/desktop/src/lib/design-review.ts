/**
 * Review comments on a design node, and the prompt that asks the canvas agent
 * for a revised copy. Drafts live in browser storage until a revision turn is
 * started; the sent prompt is the durable record of the comments.
 */
import { LIMITS } from "@agentica/protocol";

export interface DesignComment {
  id: string;
  text: string;
  /** Where the comment was pinned, as fractions of the design's size. */
  pin: { x: number; y: number; target: string } | null;
}

export const REVIEW_LIMITS = { comments: 12, text: 400, target: 160 } as const;

/** First words of every revision prompt; Retry uses them to find the design. */
const MARKER = "Revise design ";

interface ElementLike {
  tagName: string;
  id?: string;
  classList?: Iterable<string>;
  textContent?: string | null;
  parentElement?: ElementLike | null;
}

/** Collapse whitespace and drop control characters and backticks. */
const clean = (value: string) =>
  [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 || character === "`" ? " " : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A short, bounded description of the element under a pin, such as
 * `nav > a.cta "Get started"`, so the agent can find it in the source.
 * The design is untrusted markup; the description is capped and only used
 * as prompt text.
 */
export function describeElement(element: ElementLike | null): string {
  const parts: string[] = [];
  let current = element;
  while (
    current &&
    parts.length < 3 &&
    !["HTML", "BODY"].includes(current.tagName.toUpperCase())
  ) {
    let part = current.tagName.toLowerCase();
    if (current.id) part += `#${clean(current.id).slice(0, 32)}`;
    else {
      const classes = [...(current.classList ?? [])].slice(0, 2).map(clean);
      if (classes.length) part += `.${classes.join(".")}`;
    }
    parts.unshift(part);
    current = current.parentElement ?? null;
  }
  if (!parts.length || !element) return "";
  const text = clean(element.textContent ?? "").slice(0, 60);
  const selector = parts.join(" > ").slice(0, 100);
  return (text ? `${selector} "${text}"` : selector).slice(
    0,
    REVIEW_LIMITS.target,
  );
}

const percent = (fraction: number) =>
  `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;

/** Comments with text, in order; empty drafts are not sent. */
export function usableComments(comments: DesignComment[]) {
  return comments
    .map((comment) => ({ ...comment, text: comment.text.trim() }))
    .filter((comment) => comment.text);
}

/**
 * The turn prompt for a revision: one new design beside the original, which
 * stays unchanged. Only the selected design is sent as context.
 */
export function revisionPrompt(
  design: { id: string; width: number; height: number },
  comments: DesignComment[],
): string {
  const items = usableComments(comments).slice(0, REVIEW_LIMITS.comments);
  if (!items.length) throw new Error("Add at least one comment to revise.");
  const lines = items.map((comment, index) => {
    const text = comment.text.slice(0, REVIEW_LIMITS.text);
    const where = comment.pin
      ? `At ${percent(comment.pin.x)} across, ${percent(comment.pin.y)} down${comment.pin.target ? `, on ${comment.pin.target}` : ""}`
      : "Whole design";
    return `${index + 1}. [${where}] ${text}`;
  });
  const prompt = [
    `${MARKER}${design.id} as a new design. Do not change, move, or resize the original.`,
    "Apply these review comments and keep everything they do not mention:",
    ...lines,
    `Create exactly one createHtml operation with the complete revised document at the proposal anchor, ${Math.round(design.width)} wide and ${Math.round(design.height)} high. Then reply with one short sentence listing what changed.`,
  ].join("\n");
  if (prompt.length > LIMITS.text)
    throw new Error("These comments are too long. Shorten them and retry.");
  return prompt;
}

/** The design a revision prompt targets, so Retry sends the same context. */
export function revisionTarget(prompt: string): string | null {
  if (!prompt.startsWith(MARKER)) return null;
  const id = prompt.slice(MARKER.length).split(/\s/, 1)[0] ?? "";
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

const storageKey = (canvasId: string, nodeId: string) =>
  `agentica.review.${canvasId}.${nodeId}`;

export function loadDraft(canvasId: string, nodeId: string): DesignComment[] {
  try {
    const raw = localStorage.getItem(storageKey(canvasId, nodeId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is DesignComment =>
          !!item &&
          typeof item.id === "string" &&
          typeof item.text === "string" &&
          (item.pin === null ||
            (typeof item.pin?.x === "number" &&
              typeof item.pin?.y === "number" &&
              typeof item.pin?.target === "string")),
      )
      .slice(0, REVIEW_LIMITS.comments)
      .map((item) => ({
        id: item.id,
        text: item.text.slice(0, REVIEW_LIMITS.text),
        pin: item.pin
          ? {
              x: item.pin.x,
              y: item.pin.y,
              target: item.pin.target.slice(0, REVIEW_LIMITS.target),
            }
          : null,
      }));
  } catch {
    // Storage can be unavailable or hold a foreign value.
    return [];
  }
}

export function saveDraft(
  canvasId: string,
  nodeId: string,
  comments: DesignComment[],
) {
  try {
    if (comments.length)
      localStorage.setItem(
        storageKey(canvasId, nodeId),
        JSON.stringify(comments),
      );
    else localStorage.removeItem(storageKey(canvasId, nodeId));
  } catch {
    // Drafts still work for this session when storage is unavailable.
  }
}
