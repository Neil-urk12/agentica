<script lang="ts">
  import { onMount } from "svelte";
  import type { AgentCapability, CustomAgent } from "@agentica/protocol";
  import { callRuntime, RuntimeCallError } from "../runtime";
  import type { SessionManager } from "../sessions";
  import Icon from "./Icon.svelte";

  interface Props {
    connectionKey: string;
    connected: boolean;
    sessions: SessionManager;
  }

  let { connectionKey, connected, sessions }: Props = $props();

  type Draft = {
    id?: string;
    label: string;
    executable: string;
    /** One argument per line, so nothing needs shell quoting. */
    argv: string;
  };

  let builtins = $state<AgentCapability[]>([]);
  let custom = $state<CustomAgent[]>([]);
  let loading = $state(false);
  let error = $state("");
  let busy = $state<string[]>([]);
  let draft = $state<Draft | null>(null);
  let confirmRemove = $state("");

  function fail(cause: unknown) {
    error =
      cause instanceof RuntimeCallError || cause instanceof Error
        ? cause.message
        : "Something went wrong. Try again.";
  }

  async function load() {
    if (!connected) return;
    loading = true;
    error = "";
    try {
      if (sessions.connected) await sessions.refreshCapabilities();
      else await sessions.connect();
      builtins = sessions.agents.filter((agent) => !agent.custom);
      custom = (
        await callRuntime(connectionKey.trim(), false, "agents.custom.list", {})
      ).agents;
    } catch (cause) {
      fail(cause);
    } finally {
      loading = false;
    }
  }

  onMount(() => void load());

  async function run(id: string, work: () => Promise<unknown>) {
    busy = [...busy, id];
    error = "";
    try {
      await work();
      return true;
    } catch (cause) {
      fail(cause);
      return false;
    } finally {
      busy = busy.filter((entry) => entry !== id);
    }
  }

  async function save() {
    if (!draft) return;
    const current = draft;
    const definition = {
      label: current.label.trim(),
      executable: current.executable.trim(),
      argv: current.argv.split("\n").filter((line) => line.length > 0),
    };
    const saved = await run("form", () =>
      current.id
        ? callRuntime(connectionKey.trim(), false, "agents.custom.update", {
            agentId: current.id,
            ...definition,
          })
        : callRuntime(
            connectionKey.trim(),
            false,
            "agents.custom.create",
            definition,
          ),
    );
    if (!saved) return;
    // Another Edit may have replaced the draft while this one was saving.
    if (draft === current) draft = null;
    await load();
  }

  async function remove(agent: CustomAgent) {
    if (confirmRemove !== agent.id) {
      confirmRemove = agent.id;
      return;
    }
    confirmRemove = "";
    if (
      await run(agent.id, () =>
        callRuntime(connectionKey.trim(), false, "agents.custom.remove", {
          agentId: agent.id,
        }),
      )
    )
      await load();
  }

  const available = (id: string) =>
    sessions.agents.find((agent) => agent.id === `custom:${id}`);
</script>

<section class="setting setting--stacked" aria-labelledby="coding-agents-label">
  <span class="setting__icon"><Icon name="terminal" size={20} /></span>
  <div class="setting__text agents">
    <h3 id="coding-agents-label">Coding agents</h3>
    <p>
      Agent tiles can start the coding agents found on this machine. Agentica
      looks for each one on the background service's PATH and never runs it
      until you choose Start.
    </p>
    {#if !connected}
      <p class="setting__hint" role="status">
        Connect to Agentica's background service to see which coding agents are
        installed. Chatting and editing by hand work without it.
      </p>
    {:else}
      {#if error}
        <p class="agents__error" role="alert">
          <Icon name="error_outline" size={16} />{error}
        </p>
      {/if}
      {#if loading && !builtins.length}
        <p class="setting__hint" role="status">Looking for coding agents…</p>
      {/if}
      <ul class="agents__list">
        {#each builtins as agent (agent.id)}
          <li>
            <strong>{agent.label}</strong>
            {#if agent.path}
              <span class="chip chip--ok">Found</span>
              <code>{agent.path}</code>
            {:else}
              <span class="chip">Not found</span>
              <span class="setting__hint">{agent.reason}</span>
            {/if}
          </li>
        {/each}
      </ul>

      <h3>Custom agents</h3>
      <p class="setting__hint">
        Saved only on this machine, never in a workspace, so a shared workspace
        can't choose what an agent tile runs. They run with your user account;
        add only programs you trust.
      </p>
      <ul class="agents__list">
        {#each custom as agent (agent.id)}
          {@const capability = available(agent.id)}
          {@const working = busy.includes(agent.id)}
          <li>
            <strong>{agent.label}</strong>
            {#if capability?.path}
              <span class="chip chip--ok">Found</span>
            {:else}
              <span class="chip chip--bad">Not executable</span>
            {/if}
            <code>{[agent.executable, ...agent.argv].join(" ")}</code>
            <span class="agents__actions">
              <button
                class="btn btn--ghost"
                type="button"
                disabled={working}
                onclick={() =>
                  (draft = {
                    id: agent.id,
                    label: agent.label,
                    executable: agent.executable,
                    argv: agent.argv.join("\n"),
                  })}>Edit</button
              >
              <button
                class="btn btn--danger"
                type="button"
                disabled={working}
                onclick={() => void remove(agent)}
                >{confirmRemove === agent.id
                  ? "Confirm remove"
                  : "Remove"}</button
              >
            </span>
          </li>
        {:else}
          {#if !loading}<li class="setting__hint">
              No custom agents yet.
            </li>{/if}
        {/each}
      </ul>

      {#if draft}
        <form
          class="agents__form"
          onsubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <h3>{draft.id ? "Edit custom agent" : "Add a custom agent"}</h3>
          <!-- Locked while saving so edits can't be lost when the save closes the form. -->
          <fieldset class="agents__fields" disabled={busy.includes("form")}>
            <label class="agents__field">
              <span>Name</span>
              <input
                bind:value={draft.label}
                placeholder="Aider"
                autocomplete="off"
                required
                maxlength="120"
              />
            </label>
            <label class="agents__field">
              <span>Program path</span>
              <input
                bind:value={draft.executable}
                placeholder="/usr/local/bin/aider"
                autocomplete="off"
                spellcheck="false"
                required
              />
              <small>The full path to the program, starting with /.</small>
            </label>
            <label class="agents__field">
              <span>Arguments, one per line</span>
              <textarea bind:value={draft.argv} rows="3" spellcheck="false"
              ></textarea>
              <small
                >Passed exactly as written, never through a shell, so spaces at
                the start or end of a line are kept. Empty lines are skipped.
                Changes apply the next time a tile starts.</small
              >
            </label>
          </fieldset>
          <div class="agents__actions">
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
        </form>
      {:else}
        <div class="agents__actions">
          <button
            class="btn btn--soft"
            type="button"
            onclick={() => {
              error = "";
              draft = { label: "", executable: "", argv: "" };
            }}><Icon name="add" size={18} />Add a custom agent</button
          >
        </div>
      {/if}
    {/if}
  </div>
</section>

<style>
  .agents h3 {
    margin: 0.75rem 0 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .agents h3:first-child {
    margin-top: 0;
  }

  .setting__hint {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.4;
    color: var(--muted);
  }

  .agents__list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin: 0.5rem 0 0;
    padding: 0;
    list-style: none;
  }

  .agents__list li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.88rem;
  }

  code {
    overflow-wrap: anywhere;
    font-size: 0.8rem;
  }

  .agents__error {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.5rem 0 0;
    color: var(--bad);
    font-size: 0.9rem;
  }

  .agents__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .agents__list .agents__actions {
    margin: 0 0 0 auto;
  }

  .agents__fields {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }

  .agents__field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-top: 0.75rem;
    font-size: 0.88rem;
  }

  .agents__field small {
    color: var(--muted);
  }
</style>
