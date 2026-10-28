import {
  SESSION_LIMITS,
  type Artifact,
  type SessionStatus,
  type Task,
} from "@agentica/protocol";
import { sanitize } from "./changes.ts";

/** Paste text bytes left after both bracketed-paste markers. */
export const MAX_TASK_BYTES = SESSION_LIMITS.frameBytes - 12;

/** A context node's saved text, as a send pastes it. */
export type TaskContextItem = {
  nodeId: string;
  label: string;
  text: string;
  revision: number;
};

/** Text a context node sends, or null when it cannot be context. */
export function contextText(artifact: Artifact | undefined) {
  if (artifact?.type === "text") return artifact.text;
  if (
    artifact?.type === "file" &&
    !artifact.mime.startsWith("image/") &&
    artifact.text
  )
    return artifact.text;
  return null;
}

/** File name, or a note's first non-empty line cut to 80 characters. */
export function contextLabel(artifact: Artifact) {
  if (artifact.type === "file") return artifact.name;
  const line =
    (artifact.type === "text" &&
      artifact.text
        .split("\n")
        .find((item) => item.trim())
        ?.trim()) ||
    "Untitled note";
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

const utf8 = (text: string) => new TextEncoder().encode(text).length;

/** The exact text the backend will paste, its UTF-8 size, and whether it fits. */
export function taskPayload(text: string, context: TaskContextItem[] = []) {
  // Each part is sanitized alone so section sizes add up to the total; the
  // backend sanitizer leaves the already-clean result unchanged.
  const sections = context.map((item) => {
    const part = sanitize(
      `\n\n--- Context: ${item.label.replace(/\s+/g, " ")} ---\n${item.text}`,
    );
    return { nodeId: item.nodeId, label: item.label, part, bytes: utf8(part) };
  });
  const own = sanitize(text);
  const payload = own + sections.map((section) => section.part).join("");
  const bytes = utf8(payload);
  return {
    payload,
    bytes,
    empty: !own.trim(),
    fits: bytes <= MAX_TASK_BYTES,
    sections: sections.map(({ nodeId, label, bytes }) => ({
      nodeId,
      label,
      bytes,
    })),
  };
}

/** Labels of the two largest payload parts, for an over-limit message. */
export function largestParts({
  bytes,
  sections,
}: ReturnType<typeof taskPayload>) {
  const own = bytes - sections.reduce((sum, item) => sum + item.bytes, 0);
  return [{ label: "task text", bytes: own }, ...sections]
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 2)
    .map((part) => part.label);
}

/** True when the context list, its order, or a context revision changed after the recorded send. */
export function contextChangedSinceSent(
  task: Task | null | undefined,
  revisionOf: (nodeId: string) => number | undefined,
) {
  if (!task?.sentAt) return false;
  // A send recorded before context existed sent none.
  const sent = task.sentContext ?? [];
  return (
    sent.length !== task.context.length ||
    task.context.some(
      (item, index) =>
        item.nodeId !== sent[index]?.nodeId ||
        revisionOf(item.nodeId) !== sent[index]?.revision,
    )
  );
}

/** Why Send is unavailable for this task, or "" when it can be offered. */
export function sendBlocker(
  task: Task | null | undefined,
  target: {
    label: string;
    connected: boolean;
    status: SessionStatus | null;
  } | null,
) {
  if (!task?.assignedTileId) return "Assign an agent tile to send this task.";
  if (!target) return "The assigned agent tile is no longer on this canvas.";
  if (!target.connected || target.status?.state !== "running")
    return `${target.label} is not running. Start it first; Send never starts a session.`;
  return "";
}

/** True when the text changed after the recorded send. */
export const editedSinceSent = (
  task: Task | null | undefined,
  textRevision: number,
) => task?.sentRevision != null && textRevision > task.sentRevision;
