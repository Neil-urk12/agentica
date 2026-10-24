<script lang="ts">
  import { LIMITS } from "@agentica/protocol";
  import { tick, type Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import PaperDoodle from "./PaperDoodle.svelte";

  /**
   * A tile item in the picker grid. The `kind` field drives the empty-state
   * copy and content-based preview; `meta` shows a small subtitle line.
   */
  export interface PickerItem {
    id: string;
    label: string;
    /** "workspace" or "canvas" — controls preview icon and empty state. */
    kind: "workspace" | "canvas";
    /** Optional subtitle, e.g. "3 canvases" or "5 objects". */
    meta?: string;
    /** Sort key for "recent" ordering; higher = more recent. */
    lastModified: number;
  }

  type SortMode = "recent" | "name-asc" | "name-desc" | "created";

  interface Props {
    /** Items to show in the tile grid. */
    items: PickerItem[];
    /** Screen heading, e.g. "What are you working on?". */
    heading: string;
    /** Create-form label text, e.g. "Start workspace". */
    createLabel: string;
    /** Create-form input placeholder. */
    createPlaceholder: string;
    /** Create-form input id, for the associated label. */
    createInputId: string;
    /** sr-only label for the create input. */
    createInputLabel: string;
    /** Hint paragraph below the create form. */
    hint: string;
    /** Refresh button label, e.g. "Refresh workspace list". */
    refreshLabel: string;
    /** Delete confirmation message template; {label} is interpolated. */
    deleteConfirm: (label: string) => string;
    /** Delete button title, e.g. "Delete workspace". */
    deleteLabel: string;
    /** Show the "switch workspace" back button in the header. */
    showBack?: boolean;
    /** Breadcrumb label for the parent context, e.g. workspace name. */
    breadcrumb?: string;
    connected: boolean;
    connection: Snippet;
    busy: boolean;
    error: string;
    onCreate: (name: string) => void;
    onOpen: (id: string) => void;
    onDelete: (id: string) => void;
    onRefresh: () => void;
    onBack?: () => void;
    onOpenSettings: () => void;
  }

  let {
    items,
    heading,
    createLabel,
    createPlaceholder,
    createInputId,
    createInputLabel,
    hint,
    refreshLabel,
    deleteConfirm,
    deleteLabel,
    showBack = false,
    breadcrumb,
    connected,
    connection,
    busy,
    error,
    onCreate,
    onOpen,
    onDelete,
    onRefresh,
    onBack,
    onOpenSettings,
  }: Props = $props();

  let name = $state("");
  let query = $state("");
  let sortMode = $state<SortMode>(readSortMode());
  let confirming = $state("");
  let showConnection = $state(false);
  const locked = $derived(busy || !connected);

  // Focus management for delete confirmation.
  let keepButton = $state<HTMLButtonElement | null>(null);
  let listHeading = $state<HTMLHeadingElement | null>(null);
  let tileGrid = $state<HTMLUListElement | null>(null);
  const deleteButtons = new Map<string, HTMLButtonElement>();

  function readSortMode(): SortMode {
    try {
      const stored = localStorage.getItem("agentica.pickerSort");
      if (
        stored === "recent" ||
        stored === "name-asc" ||
        stored === "name-desc" ||
        stored === "created"
      )
        return stored;
    } catch {
      /* storage unavailable */
    }
    return "created";
  }

  function writeSortMode(mode: SortMode) {
    sortMode = mode;
    try {
      localStorage.setItem("agentica.pickerSort", mode);
    } catch {
      /* ignore */
    }
  }

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? items.filter((item) => item.label.toLowerCase().includes(q))
      : [...items];
    switch (sortMode) {
      case "recent":
        list.sort((a, b) => b.lastModified - a.lastModified);
        break;
      case "name-asc":
        list.sort((a, b) => a.label.localeCompare(b.label));
        break;
      case "name-desc":
        list.sort((a, b) => b.label.localeCompare(a.label));
        break;
      case "created":
        // Stable: keep original order (rowid/insertion order from the backend).
        break;
    }
    return list;
  });

  const showEmpty = $derived(items.length === 0);
  const showNoResults = $derived(items.length > 0 && filtered.length === 0);

  const isWorkspace = $derived(items.every((i) => i.kind === "workspace"));

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

  /** Move focus between tiles with arrow keys. */
  function onTileKeydown(event: KeyboardEvent, index: number) {
    if (!tileGrid) return;
    const buttons = [
      ...tileGrid.querySelectorAll<HTMLButtonElement>(
        ".tile__open:not(:disabled)",
      ),
    ];
    if (buttons.length <= 1) return;
    const cols = Math.max(1, Math.round(tileGrid.clientWidth / 208));
    const rows = Math.ceil(buttons.length / cols);
    let next = index;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % buttons.length;
        break;
      case "ArrowLeft":
        next = (index - 1 + buttons.length) % buttons.length;
        break;
      case "ArrowDown":
        next = index + cols;
        if (next >= buttons.length) next = next % cols;
        break;
      case "ArrowUp":
        next = index - cols;
        if (next < 0) {
          next = rows * cols + next;
          if (next >= buttons.length) next = buttons.length - 1;
        }
        break;
      default:
        return;
    }
    event.preventDefault();
    buttons[next]?.focus();
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
      {#if showBack}
        <button
          class="btn btn--ghost"
          type="button"
          title="Switch workspace"
          aria-label="Switch workspace"
          disabled={busy}
          onclick={onBack}
        >
          <Icon name="arrow_back" size={18} />
          <span class="btn__label">Workspace</span>
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

  {#if breadcrumb}
    <nav class="home__crumbs" aria-label="Breadcrumb">
      <span class="home__crumb">{breadcrumb}</span>
      <span class="home__crumbs-sep"
        ><Icon name="chevron_right" size={14} /></span
      >
      <span class="home__crumb home__crumb--current">{heading}</span>
    </nav>
  {/if}

  <main class="home__main">
    <section class="home__start">
      <h1>{heading}</h1>
      <form
        class="home__form"
        onsubmit={(event) => {
          event.preventDefault();
          onCreate(name.trim());
        }}
      >
        <label class="sr-only" for={createInputId}>{createInputLabel}</label>
        <input
          id={createInputId}
          bind:value={name}
          required
          maxlength={LIMITS.label}
          placeholder={createPlaceholder}
          autocomplete="off"
        />
        <button
          class="btn btn--primary"
          type="submit"
          disabled={locked || !name.trim()}
        >
          {#if busy}<span class="spinner"></span>{/if}
          {createLabel}
        </button>
      </form>
      <p class="home__hint">{hint}</p>
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
          aria-label={refreshLabel}
          disabled={locked}
          onclick={onRefresh}
        >
          <Icon name="refresh" size={18} />
        </button>
      </header>

      {#if showEmpty}
        <div class="home__empty">
          <PaperDoodle />
          {#if isWorkspace}
            <div>
              <p>
                Nothing here yet. Name your first workspace above and it'll be
                waiting for you next time.
              </p>
              <p class="home__empty-hint">
                A workspace holds canvases, notes, files, and AI conversations —
                everything for one project in one place.
              </p>
            </div>
          {:else}
            <div>
              <p>
                Nothing here yet. Name your first canvas above and it'll be
                waiting for you next time.
              </p>
              <p class="home__empty-hint">
                A canvas is an infinite board for notes, files, and AI
                conversations. {#if breadcrumb}It's saved in "{breadcrumb}".{/if}
              </p>
            </div>
          {/if}
        </div>
      {:else}
        <!-- Search and sort controls -->
        <div class="home__controls">
          <div class="home__search">
            <Icon name="search" size={16} />
            <label class="sr-only" for="picker-search">Search</label>
            <input
              id="picker-search"
              type="search"
              bind:value={query}
              placeholder="Search…"
              autocomplete="off"
            />
          </div>
          <div class="home__sort" role="group" aria-label="Sort">
            {#each [{ mode: "recent", label: "Recent", icon: "schedule" }, { mode: "name-asc", label: "A–Z", icon: "sort_by_alpha" }, { mode: "name-desc", label: "Z–A", icon: "sort_by_alpha" }, { mode: "created", label: "Oldest", icon: "access_time" }] as option}
              <button
                type="button"
                class="home__sort-btn"
                class:home__sort-btn--active={sortMode === option.mode}
                aria-pressed={sortMode === option.mode}
                title={option.label}
                onclick={() => writeSortMode(option.mode as SortMode)}
              >
                <Icon name={option.icon} size={16} />
                <span class="btn__label">{option.label}</span>
              </button>
            {/each}
          </div>
        </div>

        {#if showNoResults}
          <div class="home__empty">
            <Icon name="search_off" size={40} />
            <p>No matches for "{query}".</p>
          </div>
        {:else}
          <ul class="tiles" bind:this={tileGrid}>
            {#each filtered as item, index (item.id)}
              <li class="tile">
                <button
                  class="tile__open"
                  type="button"
                  disabled={locked || confirming === item.id}
                  title={item.label}
                  onclick={() => onOpen(item.id)}
                  onkeydown={(e) => onTileKeydown(e, index)}
                >
                  <span class="tile__paper" aria-hidden="true">
                    {#if item.kind === "workspace"}
                      <span class="tile__note"></span>
                      <span class="tile__line"></span>
                      <span class="tile__ring"></span>
                    {:else}
                      <span class="tile__preview">
                        {#if item.meta && parseInt(item.meta) > 0}
                          {#each Array.from( { length: Math.min(8, Math.max(1, Math.ceil(parseInt(item.meta) / 2))) } ) as _, i}
                            <span
                              class="tile__preview-dot"
                              style:left={`${10 + (i % 4) * 22}px`}
                              style:top={`${12 + Math.floor(i / 4) * 20}px`}
                            ></span>
                          {/each}
                        {:else}
                          <span class="tile__note"></span>
                          <span class="tile__line"></span>
                          <span class="tile__ring"></span>
                        {/if}
                      </span>
                    {/if}
                  </span>
                  <span class="tile__name">{item.label}</span>
                  {#if item.meta}
                    <small class="tile__meta">{item.meta}</small>
                  {/if}
                </button>
                <button
                  class="icon-btn icon-btn--danger tile__delete"
                  type="button"
                  title={deleteLabel}
                  aria-label={`${deleteLabel}: ${item.label}`}
                  disabled={locked}
                  use:trackDelete={item.id}
                  onclick={() => void askDelete(item.id)}
                >
                  <Icon name="delete_outline" size={18} />
                </button>
                {#if confirming === item.id}
                  <div
                    class="tile__confirm"
                    role="group"
                    aria-label="Confirm delete"
                  >
                    <span>{deleteConfirm(item.label)}</span>
                    <span class="tile__actions">
                      <button
                        class="btn btn--danger"
                        type="button"
                        disabled={busy}
                        onkeydown={(event) => onConfirmKeydown(event, item.id)}
                        onclick={() => void confirmDelete(item.id)}
                      >
                        Delete
                      </button>
                      <button
                        class="btn btn--ghost"
                        type="button"
                        bind:this={keepButton}
                        onkeydown={(event) => onConfirmKeydown(event, item.id)}
                        onclick={() => void cancelDelete(item.id)}
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
      {/if}
    </section>

    {#if error}
      <p class="alert" role="alert">{error}</p>
    {/if}
  </main>
</div>
