<script lang="ts">
  import { LIMITS } from "@agentica/protocol";
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";

  interface WorkspaceInfo {
    id: string;
    name: string | null;
  }

  interface Props {
    workspaces: WorkspaceInfo[];
    connected: boolean;
    connection: Snippet;
    busy: boolean;
    error: string;
    onRefresh: () => void;
    onCreate: (name: string) => void;
    onOpen: (id: string) => void;
    onDelete: (id: string) => void;
    onOpenSettings: () => void;
  }

  let {
    workspaces,
    connected,
    connection,
    busy,
    error,
    onRefresh,
    onCreate,
    onOpen,
    onDelete,
    onOpenSettings,
  }: Props = $props();

  let name = $state("");
  // Deleting storage is destructive, so the row asks for confirmation first.
  let confirming = $state("");
  const locked = $derived(busy || !connected);
</script>

{#snippet actions()}
  <button
    class="icon-btn"
    type="button"
    title="Settings"
    aria-label="Settings"
    onclick={onOpenSettings}
  >
    <Icon name="settings" size={20} />
  </button>
{/snippet}

<Modal
  wide
  icon="hub"
  title="Choose a workspace"
  subtitle="Start a fresh workspace or continue from a saved one."
  {actions}
>
  {@render connection()}

  <div class="split">
    <section class="panel">
      <header class="panel__head">
        <span class="panel__badge"><Icon name="add" size={18} /></span>
        <h2>New workspace</h2>
      </header>
      <p class="panel__hint">
        A workspace groups your canvases. Give it a name to begin.
      </p>
      <form
        class="stack"
        onsubmit={(event) => {
          event.preventDefault();
          onCreate(name.trim());
        }}
      >
        <label class="sr-only" for="workspace-name">Workspace name</label>
        <input
          id="workspace-name"
          bind:value={name}
          required
          maxlength={LIMITS.label}
          placeholder="e.g. Product research"
          autocomplete="off"
        />
        <button
          class="btn btn--primary btn--block"
          type="submit"
          disabled={locked || !name.trim()}
        >
          {#if busy}<span class="spinner"></span>{:else}<Icon
              name="rocket_launch"
              size={18}
            />{/if}
          Create &amp; continue
        </button>
      </form>
    </section>

    <section class="panel panel--list">
      <header class="panel__head">
        <span class="panel__badge"><Icon name="inventory_2" size={18} /></span>
        <h2>Saved workspaces</h2>
        <span class="count">{workspaces.length}</span>
        <button
          class="icon-btn panel__action"
          type="button"
          title="Refresh list"
          aria-label="Refresh workspace list"
          disabled={busy || !connected}
          onclick={onRefresh}
        >
          <Icon name="refresh" size={18} />
        </button>
      </header>

      {#if workspaces.length === 0}
        <div class="empty">
          <Icon name="folder_off" size={30} />
          <p>No saved workspaces yet</p>
          <small>Create one on the left and it will appear here.</small>
        </div>
      {:else}
        <ul class="cards">
          {#each workspaces as workspace (workspace.id)}
            {@const label = workspace.name ?? "Unreadable workspace"}
            <li>
              {#if confirming === workspace.id}
                <div class="card card--confirm">
                  <span class="card__body">
                    <strong>Delete “{label}”?</strong>
                    <small
                      >Its canvases and text are removed from this device.</small
                    >
                  </span>
                  <button
                    class="btn btn--danger"
                    type="button"
                    disabled={busy}
                    onclick={() => {
                      confirming = "";
                      onDelete(workspace.id);
                    }}
                  >
                    <Icon name="delete_forever" size={18} />
                    Delete
                  </button>
                  <button
                    class="btn btn--ghost"
                    type="button"
                    onclick={() => (confirming = "")}
                  >
                    Cancel
                  </button>
                </div>
              {:else}
                <div class="card-row">
                  <button
                    class="card"
                    type="button"
                    disabled={locked}
                    onclick={() => onOpen(workspace.id)}
                  >
                    <span class="card__icon"
                      ><Icon name="workspaces" size={20} /></span
                    >
                    <span class="card__body">
                      <strong>{label}</strong>
                      <small
                        >{workspace.name
                          ? workspace.id
                          : `ID ${workspace.id}`}</small
                      >
                    </span>
                    <Icon name="arrow_forward" size={18} />
                  </button>
                  <button
                    class="icon-btn icon-btn--danger"
                    type="button"
                    title="Delete workspace"
                    aria-label={`Delete ${label}`}
                    disabled={locked}
                    onclick={() => (confirming = workspace.id)}
                  >
                    <Icon name="delete_outline" size={18} />
                  </button>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>

  {#if error}
    <p class="alert" role="alert">{error}</p>
  {/if}
</Modal>
