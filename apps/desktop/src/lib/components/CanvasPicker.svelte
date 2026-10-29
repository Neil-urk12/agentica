<script lang="ts">
  import { LIMITS } from "@agentica/protocol";
  import { tick, type Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  interface CanvasInfo {
    id: string;
    title: string;
  }

  interface Props {
    workspaceName: string;
    canvases: CanvasInfo[];
    connection: Snippet;
    busy: boolean;
    error: string;
    onCreate: (title: string) => void;
    onOpen: (id: string) => void;
    onDelete: (id: string) => void;
    onBack: () => void;
    onOpenSettings: () => void;
  }

  let {
    workspaceName,
    canvases,
    connection,
    busy,
    error,
    onCreate,
    onOpen,
    onDelete,
    onBack,
    onOpenSettings,
  }: Props = $props();

  let title = $state("");
  // Deleting storage is destructive, so the tile asks for confirmation first.
  let confirming = $state("");

  // `autofocus` is unreliable after a client-side stage switch.
  function focusOnMount(node: HTMLElement) {
    node.focus();
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
    <nav class="home__crumbs" aria-label="Breadcrumb">
      <button
        class="home__brand"
        type="button"
        aria-label="Back to workspaces"
        disabled={busy}
        onclick={onBack}
      >
        <span class="home__logo"><Icon name="blur_on" size={18} /></span>
        Agentica
      </button>
      <span class="home__sep" aria-hidden="true">/</span>
      <span class="home__crumb" title={workspaceName} aria-current="page"
        >{workspaceName}</span
      >
    </nav>
    <span class="home__tools">
      <button class="btn btn--ghost" type="button" onclick={onOpenSettings}>
        <Icon name="settings" size={18} />
        Settings
      </button>
    </span>
  </header>

  <div class="home__conn">
    {@render connection()}
  </div>

  <main class="home__main">
    <section class="home__start">
      <h1 class="home__step">{workspaceName}</h1>
      <form
        class="home__form"
        onsubmit={(event) => {
          event.preventDefault();
          onCreate(title.trim());
        }}
      >
        <label class="sr-only" for="canvas-title">Canvas title</label>
        <input
          id="canvas-title"
          bind:value={title}
          use:focusOnMount
          required
          maxlength={LIMITS.label}
          placeholder="Name a new canvas, like Launch plan"
          autocomplete="off"
        />
        <button
          class="btn btn--primary"
          type="submit"
          disabled={busy || !title.trim()}
        >
          {#if busy}<span class="spinner"></span>{/if}
          Create canvas
        </button>
      </form>
      <p class="home__hint">
        A canvas is an open board for notes, AI sessions, files, web previews
        and drawings. Arrange them however you like.
      </p>
    </section>

    <section class="home__recent">
      <header class="home__recent-head">
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <h2 bind:this={listHeading} tabindex="-1">Canvases</h2>
      </header>

      {#if canvases.length === 0}
        <div class="home__empty">
          <span class="home__note" aria-hidden="true"></span>
          <p>No canvases yet. Name your first one above to start.</p>
        </div>
      {:else}
        <ul class="tiles">
          {#each canvases as canvas (canvas.id)}
            <li class="tile">
              <button
                class="tile__open"
                type="button"
                disabled={busy || confirming === canvas.id}
                title={canvas.title}
                onclick={() => onOpen(canvas.id)}
              >
                <span class="tile__name">{canvas.title}</span>
              </button>
              <span class="tile__tools">
                <button
                  class="icon-btn icon-btn--danger"
                  type="button"
                  title="Delete canvas"
                  aria-label={`Delete ${canvas.title}`}
                  disabled={busy}
                  use:trackDelete={canvas.id}
                  onclick={() => void askDelete(canvas.id)}
                >
                  <Icon name="delete_outline" size={18} />
                </button>
              </span>
              {#if confirming === canvas.id}
                <div
                  class="tile__confirm"
                  role="group"
                  aria-label="Confirm delete"
                >
                  <span
                    ><strong>Delete “{canvas.title}”?</strong> Its content and saved
                    review feedback are removed from this device.</span
                  >
                  <span class="tile__actions">
                    <button
                      class="btn btn--danger"
                      type="button"
                      disabled={busy}
                      onkeydown={(event) => onConfirmKeydown(event, canvas.id)}
                      onclick={() => void confirmDelete(canvas.id)}
                    >
                      <Icon name="delete_forever" size={18} />
                      Delete
                    </button>
                    <button
                      class="btn btn--ghost"
                      type="button"
                      bind:this={keepButton}
                      onkeydown={(event) => onConfirmKeydown(event, canvas.id)}
                      onclick={() => void cancelDelete(canvas.id)}
                    >
                      Cancel
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
