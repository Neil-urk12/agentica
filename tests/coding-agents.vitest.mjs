import assert from "node:assert/strict";
import { render } from "svelte/server";
import { test } from "vitest";
import CodingAgents from "../apps/desktop/src/lib/components/CodingAgents.svelte";

const agent = (id, label, declaredState = null) => ({
  id,
  label,
  custom: false,
  path: `/usr/bin/${id}`,
  reason: null,
  setupHint: null,
  declaredState,
});
// Whitespace collapsed, so source line wrapping cannot break the assertions.
const view = (agents) =>
  render(CodingAgents, {
    props: {
      connectionKey: "key",
      connected: true,
      sessions: { agents, connected: true },
    },
  }).body.replace(/\s+/g, " ");
const switches = (body) => body.match(/role="switch"[^>]*>/g) ?? [];

test("only agents that can report state get the Show agent state switch", () => {
  const body = view([
    agent("codex", "Codex"),
    agent("claude", "Claude Code", { enabled: false }),
    agent("opencode", "OpenCode"),
    {
      ...agent("custom:00000000-0000-4000-8000-000000000001", "Aider"),
      custom: true,
    },
  ]);
  assert.equal(switches(body).length, 1);
  assert.match(switches(body)[0], /aria-checked="false"/);
  assert.match(switches(body)[0], /aria-describedby="declared-state-claude"/);
  // The explanation says what changes, what does not, and that it is a report.
  assert.match(body, /Adds hooks to Claude Code's process at its next Start/);
  assert.match(body, /Claude Code's own settings files are not changed/);
  assert.match(body, /reported by the agent and may be stale/);
});

test("the switch reflects the saved setting", () => {
  const body = view([agent("claude", "Claude Code", { enabled: true })]);
  assert.match(switches(body)[0], /aria-checked="true"/);
});
