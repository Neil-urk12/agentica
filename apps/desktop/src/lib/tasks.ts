import {
  SESSION_LIMITS,
  type SessionStatus,
  type Task,
} from "@agentica/protocol";
import { sanitize } from "./changes.ts";

/** Paste text bytes left after both bracketed-paste markers. */
export const MAX_TASK_BYTES = SESSION_LIMITS.frameBytes - 12;

/** The exact text the backend will paste, its UTF-8 size, and whether it fits. */
export function taskPayload(text: string) {
  const payload = sanitize(text);
  const bytes = new TextEncoder().encode(payload).length;
  return {
    payload,
    bytes,
    empty: !payload.trim(),
    fits: bytes <= MAX_TASK_BYTES,
  };
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
