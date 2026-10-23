// A minimal stdio MCP server for backend tests: no network, deterministic.
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";

// Tests that check process cleanup ask for the server's pid.
if (process.env.FAKE_MCP_PID_FILE)
  writeFileSync(process.env.FAKE_MCP_PID_FILE, String(process.pid));
// Model a server that ignores a closed stdin, so only an explicit stop ends it.
if (process.env.FAKE_MCP_LINGER) setInterval(() => {}, 1000);

const tool = (name, description) => ({
  name,
  description,
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
  annotations: { readOnlyHint: true },
});

createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return;
  const reply = (result, delay = 0) =>
    setTimeout(
      () =>
        process.stdout.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`,
        ),
      delay,
    );
  if (message.method === "initialize")
    return reply({
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "fake", version: "0" },
    });
  if (message.method === "tools/list")
    return reply({
      tools: [tool("echo", "Echoes text."), tool("slow", "Answers late.")],
    });
  if (message.method === "tools/call") {
    const { name, arguments: args } = message.params;
    return reply(
      { content: [{ type: "text", text: `${name}:${args.text ?? ""}` }] },
      name === "slow" ? 1500 : 0,
    );
  }
  reply({});
});
