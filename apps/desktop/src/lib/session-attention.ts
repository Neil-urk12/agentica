import type { SessionStatus } from "@agentica/protocol";

export function attentionLabel(status: SessionStatus): string {
  switch (status.attention.kind) {
    case "bell":
      return "Bell";
    case "notification":
      return status.attention.message
        ? `Notification “${status.attention.message}”`
        : "Notification";
    case "exited":
      return `Process exited${status.exitSignal ? ` (signal ${status.exitSignal})` : status.exitCode !== null ? ` (code ${status.exitCode})` : ""}`;
    case "failed":
      return `Process failed${status.error ? `: ${status.error}` : ""}`;
    default:
      return "";
  }
}
