<script lang="ts">
  import { tick } from "svelte";
  import type {
    ProjectGroup,
    SessionOwner,
    SessionStatus,
    SessionTile,
  } from "@agentica/protocol";
  import Icon from "./Icon.svelte";
  import {
    attentionLabel,
    isApplePlatform,
    queueAriaShortcut,
    queueShortcutLabel,
    sortWaiting,
    waitedLabel,
  } from "../session-attention";
  import { clock } from "../clock.svelte";

  type Entry = {
    owner: SessionOwner;
    tile: SessionTile;
    status: SessionStatus;
  };
  interface Props {
    entries: Entry[];
    projects: ProjectGroup[];
    open?: boolean;
    onJump: (tileId: string) => void;
    onMarkSeen: (owner: SessionOwner) => void;
  }
  let {
    entries,
    projects,
    open = $bindable(false),
    onJump,
    onMarkSeen,
  }: Props = $props();

  const apple = isApplePlatform();
  const panelId = "waiting-queue";
  const headingId = "waiting-queue-title";
  const sorted = $derived(sortWaiting(entries));
  const count = $derived(entries.length);
  const sentence = $derived(
    count
      ? `${count} ${count === 1 ? "session" : "sessions"} waiting for you`
      : "Nothing waiting",
  );
  let wrapper: HTMLElement;
  let trigger: HTMLButtonElement;
  let closeButton = $state<HTMLButtonElement>();
  let list = $state<HTMLUListElement>();
  let activeId = $state("");
  let wasOpen = false;
  let restoreOnClose = true;

  const nameOf = (entry: Entry) =>
    entry.tile.kind === "cli-agent" ? "Codex" : "Terminal";
  const projectOf = (entry: Entry) =>
    projects.find((project) => project.id === entry.tile.projectId)?.label ??
    "Project";
  const tabStop = $derived(
    sorted.some((entry) => entry.tile.id === activeId)
      ? activeId
      : (sorted[0]?.tile.id ?? ""),
  );

  const rows = () => [
    ...(list?.querySelectorAll<HTMLLIElement>(":scope > li") ?? []),
  ];

  function focusRow(id: string) {
    activeId = id;
    const row = rows().find((item) => item.dataset.tile === id);
    if (row) row.focus();
    else closeButton?.focus();
  }

  function close(restore = true) {
    restoreOnClose = restore;
    open = false;
  }

  // Focus follows the open state, including toggles from the shortcut.
  $effect(() => {
    if (open && !wasOpen) {
      wasOpen = true;
      activeId = sorted[0]?.tile.id ?? "";
      void tick().then(() => {
        if (activeId) focusRow(activeId);
        else closeButton?.focus();
      });
    } else if (!open && wasOpen) {
      wasOpen = false;
      if (restoreOnClose) trigger.focus();
      restoreOnClose = true;
    }
  });

  $effect(() => {
    if (!open) return;
    const release = clock.hold();
    const outside = (event: PointerEvent) => {
      if (!wrapper.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => {
      release();
      document.removeEventListener("pointerdown", outside, true);
    };
  });

  function jump(entry: Entry) {
    onJump(entry.tile.id);
    close();
  }

  function markSeen(index: number) {
    const entry = sorted[index];
    if (!entry) return;
    const next = sorted[index + 1] ?? sorted[index - 1];
    onMarkSeen(entry.owner);
    if (next) focusRow(next.tile.id);
    else {
      activeId = "";
      closeButton?.focus();
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  function listKey(event: KeyboardEvent) {
    const items = rows();
    const row = (event.target as HTMLElement).closest("li");
    const index = row ? items.indexOf(row as HTMLLIElement) : -1;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!items.length) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = Math.min(items.length - 1, Math.max(0, index + step));
      focusRow(items[next]?.dataset.tile ?? "");
    } else if (event.key === "Enter" && row && event.target === row) {
      event.preventDefault();
      const entry = sorted.find((item) => item.tile.id === row.dataset.tile);
      if (entry) jump(entry);
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span class="waiting" bind:this={wrapper} onkeydown={onKeydown}>
  <button
    bind:this={trigger}
    class="btn btn--soft waiting__trigger"
    class:waiting__trigger--active={count > 0}
    type="button"
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls={panelId}
    aria-keyshortcuts={queueAriaShortcut(apple)}
    aria-label={sentence}
    title={`Waiting for you (${queueShortcutLabel(apple)})`}
    onclick={() => (open ? close() : (open = true))}
  >
    {#if count}<span class="dot" aria-hidden="true"></span>{count} waiting{:else}Nothing
      waiting{/if}
  </button>
  <span class="sr-only" role="status" aria-live="polite" aria-atomic="true"
    >{sentence}</span
  >
  {#if open}
    <div
      id={panelId}
      class="waiting__panel"
      role="dialog"
      aria-labelledby={headingId}
    >
      <header>
        <h2 id={headingId}>Waiting for you</h2>
        <button
          bind:this={closeButton}
          class="icon-btn"
          type="button"
          aria-label="Close"
          title="Close"
          onclick={() => close()}><Icon name="close" size={18} /></button
        >
      </header>
      {#if !sorted.length}
        <p class="queue-empty">
          Nothing is waiting. Sessions that ask a question or stop will show up
          here.
        </p>
      {:else}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <ul bind:this={list} aria-labelledby={headingId} onkeydown={listKey}>
          {#each sorted as entry, index (entry.tile.id)}
            {@const name = nameOf(entry)}
            {@const project = projectOf(entry)}
            {@const reason = attentionLabel(entry.status)}
            {@const waited = waitedLabel(entry.status.attention.at, clock.now)}
            <!-- Rows are roving focus stops: Up/Down move, Enter jumps. -->
            <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
            <li
              class="row"
              data-tile={entry.tile.id}
              tabindex={entry.tile.id === tabStop ? 0 : -1}
              aria-label={`${name} in ${project}: ${reason}${waited ? `, ${waited}` : ""}`}
              onfocus={() => (activeId = entry.tile.id)}
            >
              <span
                class="dot"
                class:dot--bad={entry.status.attention.kind === "failed"}
                aria-hidden="true"
              ></span>
              <div class="who">
                <strong>{name}</strong><span class="project">{project}</span>
              </div>
              {#if waited && entry.status.attention.at !== null}<time
                  datetime={new Date(entry.status.attention.at).toISOString()}
                  >{waited}</time
                >{/if}
              <p class="reason">{reason}</p>
              <div class="row-actions">
                <button
                  class="btn btn--soft"
                  type="button"
                  aria-label={`Jump to ${name} in ${project}`}
                  onclick={() => jump(entry)}>Jump to</button
                >
                <button
                  class="btn btn--ghost"
                  type="button"
                  aria-label={`Mark ${name} in ${project} as seen`}
                  onclick={() => markSeen(index)}>Mark seen</button
                >
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</span>

<style>
  .waiting {
    position: relative;
    display: inline-flex;
  }
  .waiting__trigger {
    gap: 8px;
    min-height: 2.2rem;
    padding: 0 0.85rem;
    font-weight: 500;
    color: var(--ink-soft);
    background: transparent;
    border-color: var(--line);
    white-space: nowrap;
  }
  .waiting__trigger--active {
    font-weight: 600;
    color: var(--ink);
    background: var(--warn-soft);
    border-color: var(--warn-line);
  }
  .waiting__trigger:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
    background: var(--warn);
  }
  .dot--bad {
    background: var(--bad);
  }
  .waiting__panel {
    position: absolute;
    z-index: 1;
    top: calc(100% + 8px);
    left: 0;
    width: min(380px, calc(100vw - 2rem));
    max-height: min(480px, 70vh);
    overflow: auto;
    box-sizing: border-box;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-sm);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 8px 8px 14px;
    border-bottom: 1px solid var(--line);
  }
  h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }
  .icon-btn {
    width: 28px;
    height: 28px;
  }
  .icon-btn:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }
  .queue-empty {
    margin: 0;
    padding: 16px 14px 18px;
    font-size: 13px;
    line-height: 19px;
    color: var(--ink-soft);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 4px;
  }
  .row {
    display: grid;
    grid-template-columns: 7px minmax(0, 1fr) auto;
    column-gap: 10px;
    row-gap: 4px;
    align-items: baseline;
    padding: 10px;
    border-radius: 8px;
    font-size: 13px;
  }
  .row + .row {
    margin-top: 2px;
  }
  /* Rows take focus programmatically (open, arrows), so :focus-visible
     would not always match; the roving row always shows its ring. */
  .row:focus {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  .row:hover,
  .row:focus-within {
    background: var(--surface-soft);
  }
  .row > .dot {
    align-self: center;
  }
  .who {
    display: flex;
    gap: 8px;
    align-items: baseline;
    min-width: 0;
  }
  .who strong {
    font-weight: 600;
    flex: none;
  }
  .project {
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  time {
    font-size: 12px;
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .reason {
    grid-column: 2 / -1;
    margin: 0;
    line-height: 18px;
    overflow-wrap: anywhere;
  }
  .row-actions {
    grid-column: 2 / -1;
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }
  .row-actions .btn {
    font-size: 12px;
    padding: 0 10px;
    min-height: 28px;
  }
  .row-actions .btn:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 1px;
  }
</style>
