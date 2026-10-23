<script lang="ts">
  import { onMount } from "svelte";
  import type { McpServer } from "@agentica/protocol";
  import { BUILTIN_TOOLS, mcpToolName } from "../agent-tools";
  import { callRuntime, RuntimeCallError } from "../runtime";
  import Icon from "./Icon.svelte";

  interface Props {
    connectionKey: string;
    connected: boolean;
    /** MCP servers are saved with a workspace; none is open on the start screens. */
    workspaceId?: string;
  }

  let { connectionKey, connected, workspaceId }: Props = $props();

  type Draft = {
    id?: string;
    name: string;
    command: string;
    /** One argument per line, so nothing needs shell quoting. */
    args: string;
    /** KEY=value per line. Saved values are never shown back. */
    env: string;
    envKeys: string[];
    /** Remove every saved variable; an empty box otherwise keeps them. */
    clearEnv: boolean;
  };

  let servers = $state<McpServer[]>([]);
  let loading = $state(false);
  let error = $state("");
  /** Operations in flight, by server, tool (`server/tool`), or `form`. */
  let busy = $state<string[]>([]);
  let draft = $state<Draft | null>(null);
  let confirmRemove = $state("");

  const ready = $derived(connected && !!workspaceId);

  function fail(cause: unknown) {
    error =
      cause instanceof RuntimeCallError || cause instanceof Error
        ? cause.message
        : "Something went wrong. Try again.";
  }

  async function run<T>(id: string, work: () => Promise<T>) {
    busy = [...busy, id];
    error = "";
    try {
      return await work();
    } catch (cause) {
      fail(cause);
    } finally {
      busy = busy.filter((entry) => entry !== id);
    }
  }

  function replace(server: McpServer) {
    servers = servers.map((entry) => (entry.id === server.id ? server : entry));
  }

  async function load() {
    if (!ready || !workspaceId) return;
    loading = true;
    error = "";
    try {
      servers = (
        await callRuntime(connectionKey.trim(), false, "mcp.server.list", {
          workspaceId,
        })
      ).servers;
    } catch (cause) {
      fail(cause);
    } finally {
      loading = false;
    }
  }

  onMount(() => void load());

  async function setServer(server: McpServer, enabled: boolean) {
    if (!workspaceId) return;
    const result = await run(server.id, () =>
      callRuntime(connectionKey.trim(), false, "mcp.server.set_enabled", {
        workspaceId,
        serverId: server.id,
        enabled,
      }),
    );
    if (result) replace(result.server);
  }

  async function refresh(server: McpServer) {
    if (!workspaceId) return;
    const result = await run(server.id, () =>
      callRuntime(connectionKey.trim(), false, "mcp.tools.refresh", {
        workspaceId,
        serverId: server.id,
      }),
    );
    if (result) replace(result.server);
  }

  async function setTool(server: McpServer, tool: string, enabled: boolean) {
    if (!workspaceId) return;
    const result = await run(`${server.id}/${tool}`, () =>
      callRuntime(connectionKey.trim(), false, "mcp.tool.set_enabled", {
        workspaceId,
        serverId: server.id,
        tool,
        enabled,
      }),
    );
    if (result) replace(result.server);
  }

  async function remove(server: McpServer) {
    if (!workspaceId) return;
    if (confirmRemove !== server.id) {
      confirmRemove = server.id;
      return;
    }
    confirmRemove = "";
    const done = await run(server.id, () =>
      callRuntime(connectionKey.trim(), false, "mcp.server.delete", {
        workspaceId,
        serverId: server.id,
      }),
    );
    if (done) servers = servers.filter((entry) => entry.id !== server.id);
  }

  function startAdd() {
    error = "";
    draft = {
      name: "",
      command: "",
      args: "",
      env: "",
      envKeys: [],
      clearEnv: false,
    };
  }

  function startEdit(server: McpServer) {
    error = "";
    draft = {
      id: server.id,
      name: server.name,
      command: server.command,
      args: server.args.join("\n"),
      env: "",
      envKeys: server.envKeys,
      clearEnv: false,
    };
  }

  function parseEnv(text: string) {
    const env: Record<string, string> = {};
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const at = line.indexOf("=");
      if (at < 1)
        throw new Error(`"${line.trim()}" needs the form NAME=value.`);
      env[line.slice(0, at).trim()] = line.slice(at + 1);
    }
    return env;
  }

  async function save() {
    if (!draft || !workspaceId) return;
    const current = draft;
    let env: Record<string, string> | undefined;
    try {
      env = current.env.trim()
        ? parseEnv(current.env)
        : current.clearEnv
          ? {}
          : undefined;
    } catch (cause) {
      return fail(cause);
    }
    const args = current.args.split("\n").filter((line) => line.length > 0);
    const base = {
      workspaceId,
      name: current.name.trim(),
      command: current.command.trim(),
      args,
    };
    const result = await run("form", () =>
      current.id
        ? callRuntime(connectionKey.trim(), false, "mcp.server.update", {
            ...base,
            serverId: current.id,
            ...(env ? { env } : {}),
          })
        : callRuntime(connectionKey.trim(), false, "mcp.server.create", {
            ...base,
            env: env ?? {},
          }),
    );
    if (!result) return;
    draft = null;
    await load();
  }

  const statusText = (server: McpServer) =>
    ({
      stopped: "Off",
      idle: "On, starts when used",
      running: "Running",
      error: "Couldn't start",
    })[server.status];
</script>

<div class="tools-root">
  <section class="setting setting--stacked" aria-labelledby="builtin-tools">
    <span class="setting__icon"><Icon name="smart_toy" size={20} /></span>
    <div class="setting__text">
      <h3 id="builtin-tools">Built in</h3>
      <p>Always on. Edits are only proposals until you accept them.</p>
      <ul class="tools">
        {#each BUILTIN_TOOLS as tool (tool.name)}
          <li class="tool">
            <div>
              <code>{tool.name}</code>
              <p>{tool.description}</p>
            </div>
            <span class="chip chip--ok"
              ><Icon name="lock" size={12} />Always on</span
            >
          </li>
        {/each}
      </ul>
    </div>
  </section>

  {#if !connected}
    <p class="setting__hint" role="status">
      Connect to Agentica's background service to add tools from other programs.
    </p>
  {:else if !workspaceId}
    <p class="setting__hint" role="status">
      Open a workspace to add tools from other programs. They're saved with your
      workspace.
    </p>
  {:else}
    {#if error}
      <p class="tools__error" role="alert">
        <Icon name="error_outline" size={16} />{error}
      </p>
    {/if}

    {#each servers as server (server.id)}
      {@const working = busy.includes(server.id)}
      <section class="setting setting--stacked" aria-label={server.name}>
        <span class="setting__icon"><Icon name="extension" size={20} /></span>
        <div class="setting__text">
          <div class="tool__head">
            <h3>{server.name}</h3>
            <span
              class="chip"
              class:chip--ok={server.status === "running"}
              class:chip--bad={server.status === "error"}
              >{statusText(server)}</span
            >
            <button
              class="switch"
              type="button"
              role="switch"
              aria-checked={server.enabled}
              aria-label={`${server.name} on`}
              disabled={working}
              onclick={() => void setServer(server, !server.enabled)}
            >
              <span class="switch__track"
                ><span class="switch__thumb"></span></span
              >
              <span class="switch__label">{server.enabled ? "On" : "Off"}</span>
            </button>
          </div>
          <p class="tools__command">
            <code>{[server.command, ...server.args].join(" ")}</code>
          </p>
          {#if server.envKeys.length}
            <p class="setting__hint">
              Variables: {server.envKeys.join(", ")} (values stay hidden)
            </p>
          {/if}
          {#if server.error}
            <pre class="tools__stderr" role="status">{server.error}</pre>
          {/if}

          {#if server.tools.length}
            <ul class="tools">
              {#each server.tools as tool (tool.name)}
                {@const offered = !!mcpToolName(server.name, tool.name)}
                {@const locked = !tool.readOnly || !offered}
                <li class="tool">
                  <div>
                    <code>{tool.name}</code>
                    <span
                      class="chip"
                      class:chip--ok={tool.readOnly}
                      class:chip--bad={!tool.readOnly}
                      >{tool.readOnly
                        ? "Only reads"
                        : "Can change things"}</span
                    >
                    {#if tool.description}<p>{tool.description}</p>{/if}
                    {#if !tool.readOnly}
                      <p class="setting__hint">
                        Only tools that just read can be turned on.
                      </p>
                    {:else if !offered}
                      <p class="setting__hint">
                        This name is too long or has characters AI models don't
                        accept, so it can't be offered.
                      </p>
                    {/if}
                  </div>
                  <button
                    class="switch"
                    type="button"
                    role="switch"
                    aria-checked={tool.enabled}
                    aria-label={`${tool.name} on`}
                    disabled={locked ||
                      busy.includes(`${server.id}/${tool.name}`)}
                    onclick={() =>
                      void setTool(server, tool.name, !tool.enabled)}
                  >
                    <span class="switch__track"
                      ><span class="switch__thumb"></span></span
                    >
                    <span class="switch__label"
                      >{tool.enabled ? "On" : "Off"}</span
                    >
                  </button>
                </li>
              {/each}
            </ul>
          {:else if server.enabled && server.status === "running"}
            <p class="setting__hint">This program didn't list any tools.</p>
          {:else if !server.enabled}
            <p class="setting__hint">Turn it on to see its tools.</p>
          {/if}

          <div class="tools__actions">
            <button
              class="btn btn--soft"
              type="button"
              disabled={!server.enabled || working}
              onclick={() => void refresh(server)}>Refresh tools</button
            >
            <button
              class="btn btn--ghost"
              type="button"
              disabled={server.enabled || working}
              title={server.enabled ? "Turn it off to edit" : undefined}
              onclick={() => startEdit(server)}>Edit</button
            >
            <button
              class="btn btn--danger"
              type="button"
              disabled={working}
              onclick={() => void remove(server)}
              >{confirmRemove === server.id
                ? "Confirm remove"
                : "Remove"}</button
            >
          </div>
        </div>
      </section>
    {:else}
      {#if !loading}
        <p class="setting__hint">No tools from other programs yet.</p>
      {/if}
    {/each}

    {#if draft}
      <form
        class="setting setting--stacked tools__form"
        onsubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <span class="setting__icon"><Icon name="add" size={20} /></span>
        <div class="setting__text">
          <h3>{draft.id ? "Edit tool server" : "Add a tool server"}</h3>
          <p>
            A tool server is a program on this computer that offers tools over
            MCP. It runs with your user account whenever you turn it on, so add
            only programs you trust.
          </p>
          <label class="tools__field">
            <span>Name</span>
            <input
              bind:value={draft.name}
              placeholder="docs"
              autocomplete="off"
              spellcheck="false"
              required
              maxlength="32"
            />
            <small>Lowercase letters, digits and hyphens.</small>
          </label>
          <label class="tools__field">
            <span>Command</span>
            <input
              bind:value={draft.command}
              placeholder="npx"
              autocomplete="off"
              spellcheck="false"
              required
            />
          </label>
          <label class="tools__field">
            <span>Arguments, one per line</span>
            <textarea
              bind:value={draft.args}
              rows="3"
              placeholder={"-y\n@example/docs-server"}
              spellcheck="false"></textarea>
          </label>
          <label class="tools__field">
            <span>Variables, NAME=value per line</span>
            <textarea
              bind:value={draft.env}
              rows="2"
              placeholder="API_TOKEN=…"
              autocomplete="off"
              spellcheck="false"></textarea>
            {#if draft.envKeys.length}
              <small>
                Saved: {draft.envKeys.join(", ")}. Leave empty to keep them;
                typing here replaces all of them.
              </small>
            {/if}
          </label>
          {#if draft.envKeys.length}
            <label class="tools__check">
              <input
                type="checkbox"
                bind:checked={draft.clearEnv}
                disabled={!!draft.env.trim()}
              />
              <span>Remove all saved variables</span>
            </label>
          {/if}
          <div class="tools__actions">
            <button
              class="btn btn--primary"
              type="submit"
              disabled={busy.includes("form")}
              >{draft.id ? "Save" : "Add"}</button
            >
            <button
              class="btn btn--ghost"
              type="button"
              onclick={() => (draft = null)}>Cancel</button
            >
          </div>
        </div>
      </form>
    {:else}
      <div class="tools__actions">
        <button class="btn btn--soft" type="button" onclick={startAdd}>
          <Icon name="add" size={18} />Add a tool server
        </button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .tools-root {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
  }

  .setting--stacked {
    align-items: flex-start;
  }

  .setting__text h3 {
    margin: 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .setting__hint {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.4;
    color: var(--muted);
  }

  .tools {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin: 0.5rem 0 0;
    padding: 0;
    list-style: none;
  }

  .tool {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  .tool p {
    margin: 0.25rem 0 0;
    font-size: 0.85rem;
    color: var(--muted);
  }

  .tool__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
  }

  .tool__head h3 {
    margin-right: auto;
  }

  .tools__command,
  code {
    overflow-wrap: anywhere;
  }

  .tools__stderr {
    margin: 0.5rem 0 0;
    padding: 0.5rem 0.65rem;
    max-height: 9rem;
    overflow: auto;
    border: 1px solid var(--bad-line);
    border-radius: var(--radius);
    background: var(--bad-soft);
    color: var(--bad);
    font-size: 0.8rem;
    white-space: pre-wrap;
  }

  .tools__error {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0;
    color: var(--bad);
    font-size: 0.9rem;
  }

  .tools__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .tools__field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-top: 0.75rem;
    font-size: 0.88rem;
  }

  .tools__field small {
    color: var(--muted);
  }

  .tools__check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.5rem;
    font-size: 0.88rem;
  }
</style>
