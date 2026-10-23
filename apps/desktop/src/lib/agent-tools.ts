import type { RuntimeResult } from "@agentica/protocol";

/** An enabled, read-only MCP tool as the runtime offers it to a turn. */
export type McpTool = RuntimeResult<"mcp.tools.list">["tools"][number];

/** Tools every canvas agent turn has; shown, but not changeable, in Settings. */
export const BUILTIN_TOOLS = [
  {
    name: "canvas_read",
    description:
      "Reads the full content of objects on this canvas that are listed in its outline. Never edits anything.",
  },
  {
    name: "canvas_edit",
    description:
      "Stages one change to the canvas as a proposal. Nothing is applied until you accept it.",
  },
] as const;

/** Model providers accept letters, digits, `_` and `-`, up to 64 characters. */
export function mcpToolName(server: string, tool: string) {
  const name = `${server}__${tool}`;
  return /^[A-Za-z0-9_-]{1,64}$/.test(name) ? name : undefined;
}

/** Offered MCP tools by model-facing name; tools whose name does not fit are left out. */
export function offeredMcpTools(tools: McpTool[]) {
  const offered = new Map<string, McpTool>();
  for (const tool of tools) {
    const name = mcpToolName(tool.server, tool.name);
    if (name && !offered.has(name)) offered.set(name, tool);
  }
  return offered;
}

export function mcpToolSpecs(offered: Map<string, McpTool>) {
  return [...offered].map(([name, tool]) => ({
    type: "function",
    function: {
      name,
      description: tool.description || `Read-only tool from ${tool.server}.`,
      parameters: tool.inputSchema,
    },
  }));
}
