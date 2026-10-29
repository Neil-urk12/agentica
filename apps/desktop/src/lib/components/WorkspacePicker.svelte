<script lang="ts">
  import { LIMITS } from "@agentica/protocol";
  import { tick, type Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  interface WorkspaceInfo {
    id: string;
    name: string | null;
    canvases: number | null;
  }

  interface Props {
    workspaces: WorkspaceInfo[];
    connected: boolean;
    connection: Snippet;
    onReconnect: () => void;
    busy: boolean;
    error: string;
    onRefresh: () => void;
    onCreate: (name: string) => void;
    onOpen: (id: string) => void;
    onDelete: (id: string) => void;
    /** Desktop only: native dialogs choose the backup file. */
    backups: boolean;
    onBackup: (id: string) => Promise<boolean>;
    onRestore: () => void;
    onOpenSettings: () => void;
  }

  let {
    workspaces,
    connected,
    connection,
    onReconnect,
    busy,
    error,
    onRefresh,
    onCreate,
    onOpen,
    onDelete,
    backups,
    onBackup,
    onRestore,
    onOpenSettings,
  }: Props = $props();

  let name = $state("");
  // Deleting storage is destructive, so the tile asks for confirmation first.
  let confirming = $state("");
  const locked = $derived(busy || !connected);
  // Announced once a backup file is written; cleared by the next action.
  let backedUp = $state("");

  function countLabel(canvases: number) {
    if (canvases === 0) return "No canvases";
    return canvases === 1 ? "1 canvas" : `${canvases} canvases`;
  }

  async function backup(id: string, label: string) {
    backedUp = "";
    if (await onBackup(id)) backedUp = `Backed up “${label}”.`;
  }

  // The confirmation hands focus to its safe choice and returns it to the
  // delete button when it is dismissed.
  let keepButton = $state<HTMLButtonElement | null>(null);
  // The list heading is the anchor for focus once a deleted tile takes the
  // focused button with it.
  let listHeading = $state<HTMLHeadingElement | null>(null);
  const deleteButtons = new Map<string, HTMLButtonElement>();

  function trackDelete(node: HTMLButtonElement, id: string) {
    deleteButtons.set(id, node);
    return {
      destroy() {
        deleteButtons.delete(id);
      },
    };
  }

  async function askDelete(id: string) {
    confirming = id;
    await tick();
    keepButton?.focus();
  }

  async function cancelDelete(id: string) {
    confirming = "";
    await tick();
    deleteButtons.get(id)?.focus();
  }

  async function confirmDelete(id: string) {
    confirming = "";
    onDelete(id);
    await tick();
    // The confirmation and its button leave with the workspace, so focus goes
    // to the list heading rather than back to the top of the page.
    listHeading?.focus();
  }

  function onConfirmKeydown(event: KeyboardEvent, id: string) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    void cancelDelete(id);
  }
</script>

<div class="home">
  <header class="home__bar">
    <span class="home__brand">
      <span class="home__logo"><Icon name="blur_on" size={18} /></span>
      Agentica
    </span>
    <span class="home__tools">
      {#if connected}
        <span class="home__ready">
          <span class="home__dot"></span>Ready
          <button
            class="home__reconnect"
            type="button"
            title="Reconnect to the backend"
            aria-label="Reconnect to the backend"
            disabled={busy}
            onclick={onReconnect}
          >
            <Icon name="sync" size={18} />
          </button>
        </span>
      {/if}
      <button class="btn btn--ghost" type="button" onclick={onOpenSettings}>
        <Icon name="settings" size={18} />
        Settings
      </button>
    </span>
  </header>

  <!-- Without a backend there is no Ready button, so the controls sit in the
       page where they can't be missed. -->
  {#if !connected}
    <div class="home__conn">
      {@render connection()}
    </div>
  {/if}

  <main class="home__main">
    <section class="home__start">
      <h1>What are you working on?</h1>
      <form
        class="home__form"
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
          placeholder="Give it a name, like Kitchen remodel"
          autocomplete="off"
        />
        <button
          class="btn btn--primary"
          type="submit"
          disabled={locked || !name.trim()}
        >
          {#if busy}<span class="spinner"></span>{/if}
          Start workspace
        </button>
      </form>
      <p class="home__hint">
        A workspace keeps your boards, notes and AI conversations together. It’s
        saved on this computer.
      </p>
      <div class="home__backup">
        <button
          class="btn btn--ghost"
          type="button"
          disabled={locked || !backups}
          aria-describedby="backup-hint"
          onclick={() => {
            backedUp = "";
            onRestore();
          }}
        >
          <Icon name="settings_backup_restore" size={18} />
          Restore from backup
        </button>
        <p class="home__hint" id="backup-hint">
          {#if backups}
            A backup is a full copy of a workspace, including MCP server
            settings that may hold credentials. Keep backup files private.
            Restoring adds a new workspace and never starts its tools.
          {:else}
            Backing up and restoring workspaces needs the desktop app.
          {/if}
        </p>
      </div>
    </section>

    <section class="home__recent">
      <header class="home__recent-head">
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <h2 bind:this={listHeading} tabindex="-1">
          Pick up where you left off
        </h2>
        <button
          class="icon-btn"
          type="button"
          title="Refresh list"
          aria-label="Refresh workspace list"
          disabled={locked}
          onclick={onRefresh}
        >
          <Icon name="refresh" size={18} />
        </button>
      </header>

      {#if workspaces.length === 0}
        <div class="home__empty">
          <span class="home__note" aria-hidden="true"></span>
          <p>
            Nothing here yet. Name your first workspace above and it’ll be
            waiting for you next time.
          </p>
        </div>
      {:else}
        <ul class="tiles">
          {#each workspaces as workspace (workspace.id)}
            {@const label = workspace.name ?? "Can’t read this workspace"}
            <li class="tile">
              <button
                class="tile__open"
                type="button"
                disabled={locked || confirming === workspace.id}
                title={label}
                onclick={() => onOpen(workspace.id)}
              >
                <span class="tile__name">{label}</span>
                <small class="tile__meta"
                  >{workspace.name === null || workspace.canvases === null
                    ? `ID ${workspace.id}`
                    : countLabel(workspace.canvases)}</small
                >
              </button>
              <span class="tile__tools">
                <button
                  class="icon-btn"
                  type="button"
                  title="Back up workspace"
                  aria-label={`Back up ${label}`}
                  aria-describedby="backup-hint"
                  disabled={locked || !backups || !workspace.name}
                  onclick={() => void backup(workspace.id, label)}
                >
                  <Icon name="save_alt" size={18} />
                </button>
                <button
                  class="icon-btn icon-btn--danger"
                  type="button"
                  title="Delete workspace"
                  aria-label={`Delete ${label}`}
                  disabled={locked}
                  use:trackDelete={workspace.id}
                  onclick={() => void askDelete(workspace.id)}
                >
                  <Icon name="delete_outline" size={18} />
                </button>
              </span>
              {#if confirming === workspace.id}
                <div
                  class="tile__confirm"
                  role="group"
                  aria-label="Confirm delete"
                >
                  <span
                    >Delete “{label}” and everything in it, including saved
                    review feedback, from this computer?</span
                  >
                  <span class="tile__actions">
                    <button
                      class="btn btn--danger"
                      type="button"
                      disabled={busy}
                      onkeydown={(event) =>
                        onConfirmKeydown(event, workspace.id)}
                      onclick={() => void confirmDelete(workspace.id)}
                    >
                      Delete
                    </button>
                    <button
                      class="btn btn--ghost"
                      type="button"
                      bind:this={keepButton}
                      onkeydown={(event) =>
                        onConfirmKeydown(event, workspace.id)}
                      onclick={() => void cancelDelete(workspace.id)}
                    >
                      Keep it
                    </button>
                  </span>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <p class="sr-only" role="status">{backedUp}</p>
    {#if backedUp && !error}
      <p class="home__hint" aria-hidden="true">{backedUp}</p>
    {/if}
    {#if error}
      <p class="alert" role="alert">{error}</p>
    {/if}
  </main>
</div>
