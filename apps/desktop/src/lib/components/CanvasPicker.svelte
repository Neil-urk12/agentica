<script lang="ts">
  import { LIMITS } from "@agentica/protocol";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";

  interface CanvasInfo {
    id: string;
    title: string;
  }

  interface Props {
    workspaceName: string;
    canvases: CanvasInfo[];
    busy: boolean;
    error: string;
    onCreate: (title: string) => void;
    onOpen: (id: string) => void;
    onBack: () => void;
  }

  let {
    workspaceName,
    canvases,
    busy,
    error,
    onCreate,
    onOpen,
    onBack,
  }: Props = $props();

  let title = $state("");
</script>

<Modal
  wide
  icon="dashboard_customize"
  title="Choose a canvas"
  subtitle={`Inside “${workspaceName}” — start a new canvas or open a saved one.`}
>
  <div class="split">
    <section class="panel">
      <header class="panel__head">
        <span class="panel__badge"><Icon name="add" size={18} /></span>
        <h2>New canvas</h2>
      </header>
      <p class="panel__hint">
        An infinite canvas of text nodes. You can add and arrange them freely.
      </p>
      <form
        class="stack"
        onsubmit={(event) => {
          event.preventDefault();
          onCreate(title.trim());
        }}
      >
        <label class="sr-only" for="canvas-title">Canvas title</label>
        <input
          id="canvas-title"
          bind:value={title}
          required
          maxlength={LIMITS.label}
          placeholder="e.g. Launch plan"
          autocomplete="off"
        />
        <button
          class="btn btn--primary btn--block"
          type="submit"
          disabled={busy || !title.trim()}
        >
          {#if busy}<span class="spinner"></span>{:else}<Icon
              name="add_circle"
              size={18}
            />{/if}
          Create &amp; open
        </button>
      </form>
    </section>

    <section class="panel panel--list">
      <header class="panel__head">
        <span class="panel__badge"><Icon name="layers" size={18} /></span>
        <h2>Saved canvases</h2>
        <span class="count">{canvases.length}</span>
      </header>

      {#if canvases.length === 0}
        <div class="empty">
          <Icon name="map" size={30} />
          <p>No saved canvases yet</p>
          <small>Create one on the left and it will appear here.</small>
        </div>
      {:else}
        <ul class="cards">
          {#each canvases as canvas (canvas.id)}
            <li>
              <button
                class="card"
                type="button"
                disabled={busy}
                onclick={() => onOpen(canvas.id)}
              >
                <span class="card__icon"
                  ><Icon name="description" size={20} /></span
                >
                <span class="card__body">
                  <strong>{canvas.title}</strong>
                  <small>Open canvas</small>
                </span>
                <Icon name="arrow_forward" size={18} />
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>

  {#if error}
    <p class="alert" role="alert">{error}</p>
  {/if}

  <footer class="modal__footer">
    <button
      class="btn btn--ghost"
      type="button"
      onclick={onBack}
      disabled={busy}
    >
      <Icon name="arrow_back" size={18} />
      Switch workspace
    </button>
  </footer>
</Modal>
