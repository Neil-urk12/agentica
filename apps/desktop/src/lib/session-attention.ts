import type { SessionStatus } from "@agentica/protocol";

export function attentionLabel(status: SessionStatus): string {
  switch (status.attention.kind) {
    case "bell":
      return "Bell";
    case "notification":
      return `Notification “${status.attention.message ?? ""}”`;
    case "exited":
      return `Process exited${status.exitSignal ? ` (signal ${status.exitSignal})` : status.exitCode !== null ? ` (code ${status.exitCode})` : ""}`;
    case "failed":
      return `Process failed${status.error ? `: ${status.error}` : ""}`;
    default:
      return "";
  }
}
