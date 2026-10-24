<script lang="ts">
  import { LIMITS } from "@agentica/protocol";
  import { tick, type Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import PaperDoodle from "./PaperDoodle.svelte";

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
  // Deleting storage is destructive, so the tile asks for confirmation first.
  let confirming = $state("");
  // "Ready" reveals the connection controls, so the key can be changed and the
  // backend reconnected without leaving this screen.
  let showConnection = $state(false);
  const locked = $derived(busy || !connected);

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
        <button
          class="home__ready"
          type="button"
          aria-expanded={showConnection}
          aria-controls="home-connection"
          title={showConnection
            ? "Hide connection settings"
            : "Show connection settings"}
          aria-label={showConnection
            ? "Hide connection settings"
            : "Show connection settings"}
          onclick={() => (showConnection = !showConnection)}
        >
          <span class="home__dot"></span><span class="btn__label">Ready</span>
        </button>
      {/if}
      <button
        class="btn btn--ghost"
        type="button"
        title="Settings"
        aria-label="Settings"
        onclick={onOpenSettings}
      >
        <Icon name="settings" size={18} />
        <span class="btn__label">Settings</span>
      </button>
    </span>
  </header>

  <!-- The panel stays mounted so the disclosure keeps pointing at it; the
       live region in App announces connection changes. -->
  <div
    class="home__conn"
    id="home-connection"
    hidden={connected && !showConnection}
  >
    {@render connection()}
  </div>

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
          <PaperDoodle />
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
                <span class="tile__paper" aria-hidden="true">
                  <span class="tile__note"></span>
                  <span class="tile__line"></span>
                  <span class="tile__ring"></span>
                </span>
                <span class="tile__name">{label}</span>
                {#if !workspace.name}
                  <small class="tile__meta">ID {workspace.id}</small>
                {/if}
              </button>
              <button
                class="icon-btn icon-btn--danger tile__delete"
                type="button"
                title="Delete workspace"
                aria-label={`Delete ${label}`}
                disabled={locked}
                use:trackDelete={workspace.id}
                onclick={() => void askDelete(workspace.id)}
              >
                <Icon name="delete_outline" size={18} />
              </button>
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

    {#if error}
      <p class="alert" role="alert">{error}</p>
    {/if}
  </main>
</div>
