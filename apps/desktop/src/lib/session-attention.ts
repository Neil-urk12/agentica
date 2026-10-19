import type { SessionStatus } from "@agentica/protocol";

export function attentionLabel(status: SessionStatus): string {
  switch (status.attention.kind) {
    case "bell":
      return "Waiting for you";
    case "notification":
      return status.attention.message || "Sent a notification";
    case "exited":
      return `Stopped${status.exitSignal ? ` (signal ${status.exitSignal})` : status.exitCode !== null ? ` (exit code ${status.exitCode})` : ""}`;
    case "failed":
      return status.error ? `Failed: ${status.error}` : "Failed to start";
    default:
      return "";
  }
}

/**
 * How long ago attention was raised. `at` is the backend's Unix epoch
 * milliseconds; clock skew that puts it in the future reads as "just now".
 */
export function waitedLabel(at: number | null, now: number): string {
  if (at === null) return "";
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min ago` : `${hours} h ago`;
  }
  return `${Math.floor(hours / 24)} d ago`;
}

/** Oldest attention first; entries without a timestamp keep order, last. */
export function sortWaiting<T extends { status: SessionStatus }>(
  entries: T[],
): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const x = a.entry.status.attention.at;
      const y = b.entry.status.attention.at;
      if (x === y) return a.index - b.index;
      if (x === null) return 1;
      if (y === null) return -1;
      return x - y;
    })
    .map(({ entry }) => entry);
}

export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/** Ctrl+J, or Cmd+J on Apple platforms, toggles the waiting queue. */
export function isQueueShortcut(
  event: Pick<
    KeyboardEvent,
    "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
  apple: boolean,
): boolean {
  if (event.key.toLowerCase() !== "j" || event.altKey || event.shiftKey)
    return false;
  return apple
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

export const queueShortcutLabel = (apple: boolean) => (apple ? "⌘J" : "Ctrl+J");

export const queueAriaShortcut = (apple: boolean) =>
  apple ? "Meta+J" : "Control+J";
