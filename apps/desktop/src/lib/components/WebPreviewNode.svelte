<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { NodeResizer } from "@xyflow/svelte";
  import { LIMITS } from "@agentica/protocol";
  import { PREVIEW_URL_ERROR, previewUrlAllowed } from "../preview-url";
  import Icon from "./Icon.svelte";

  interface Props {
    selected?: boolean;
    data: {
      url: string;
      nodeId: string;
      endpoints: string[];
      editable: boolean;
      onSave: (url: string) => Promise<boolean>;
      onRemove: () => void;
      onResize: (width: number, height: number) => void;
    };
  }
  let { data, selected = false }: Props = $props();
  let draft = $state(untrack(() => data.url));
  let error = $state("");
  let saving = $state(false);
  let attempt = $state(0);
  let loading = $state(false);
  let guidance = $state(false);
  let expanded = $state(false);
  let container: HTMLElement;
  let expandButton: HTMLButtonElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const allowed = $derived(previewUrlAllowed(data.url, data.endpoints));
  // Primitive derived: canvas rebuilds pass a new `data` object without reloading the frame.
  const url = $derived(data.url);
  const dirty = $derived(draft !== data.url);

  function beginLoad() {
    clearTimeout(timer);
    loading = true;
    guidance = false;
    timer = setTimeout(() => {
      loading = false;
      guidance = true;
    }, 15_000);
  }
  function load() {
    attempt++;
    beginLoad();
  }
  $effect(() => {
    void url;
    error = "";
    if (allowed) untrack(beginLoad);
    return () => clearTimeout(timer);
  });
  async function save() {
    if (!previewUrlAllowed(draft, data.endpoints)) {
      error = PREVIEW_URL_ERROR;
      return;
    }
    saving = true;
    error = "";
    try {
      if (!(await data.onSave(draft)))
        error = "Could not save this URL. Your draft is still here.";
    } catch {
      error = "Could not save this URL. Your draft is still here.";
    } finally {
      saving = false;
    }
  }
  async function toggleExpand() {
    try {
      if (expanded) await document.exitFullscreen();
      else await container.requestFullscreen();
    } catch {
      error = "Expansion is unavailable in this window.";
    }
  }
  function fullscreenChanged() {
    const wasExpanded = expanded;
    expanded = document.fullscreenElement === container;
    if (wasExpanded && !expanded) expandButton?.focus();
  }
  onDestroy(() => clearTimeout(timer));
</script>

<svelte:document onfullscreenchange={fullscreenChanged} />
<NodeResizer
  isVisible={selected && !expanded && data.editable}
  minWidth={LIMITS.minSize}
  minHeight={LIMITS.minSize}
  maxWidth={LIMITS.maxSize}
  maxHeight={LIMITS.maxSize}
  onResizeEnd={(_, p) => data.onResize(p.width, p.height)}
/>
<div class="web-preview" class:expanded bind:this={container}>
  <div class="card-head web-preview__head">
    <span
      class="web-preview__dot"
      class:loading
      class:blocked={!allowed}
      aria-hidden="true"
    ></span>
    <span class="web-preview__title">Preview</span>
    <form
      class="web-preview__url nodrag"
      onsubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label class="sr-only" for={`preview-url-${data.nodeId}`}
        >Local app URL</label
      >
      <input
        id={`preview-url-${data.nodeId}`}
        bind:value={draft}
        disabled={!data.editable}
        maxlength="2048"
        spellcheck="false"
        placeholder="http://localhost:5173"
        onkeydown={(event) => event.stopPropagation()}
      />
      {#if dirty && data.editable}
        <button type="submit" disabled={saving}>Save</button>
      {/if}
    </form>
    <button
      class="card-action nodrag"
      type="button"
      onclick={load}
      disabled={!allowed}
      title="Reload"
      aria-label="Reload preview"><Icon name="refresh" size={16} /></button
    >
    <button
      class="card-action nodrag"
      type="button"
      bind:this={expandButton}
      onclick={() => void toggleExpand()}
      title={expanded ? "Return to canvas" : "Expand"}
      aria-label={expanded ? "Return to canvas" : "Expand preview"}
      ><Icon
        name={expanded ? "close_fullscreen" : "open_in_full"}
        size={16}
      /></button
    >
    {#if data.editable}
      <button
        class="card-action nodrag"
        type="button"
        onclick={data.onRemove}
        title="Remove"
        aria-label="Remove preview"><Icon name="close" size={16} /></button
      >
    {/if}
  </div>
  <div class="web-preview__body">
    {#if !allowed}
      <p class="web-preview__empty" role="alert">
        <Icon name="link_off" size={20} />
        This URL is not available here. {PREVIEW_URL_ERROR}
      </p>
    {:else}
      {#key attempt}
        <iframe
          class="web-preview__frame nodrag nopan nowheel"
          title="Local app preview"
          src={data.url}
          sandbox="allow-scripts allow-same-origin allow-forms"
          referrerpolicy="no-referrer"
          onload={() => {
            clearTimeout(timer);
            loading = false;
            guidance = true;
          }}
        ></iframe>
      {/key}
    {/if}
  </div>
  {#if error}
    <p class="web-preview__note web-preview__note--bad" role="alert">
      <Icon name="error_outline" size={14} />{error}
    </p>
  {:else if allowed && loading}
    <p class="web-preview__note" role="status">Loading…</p>
  {:else if allowed && guidance}
    <p class="web-preview__note" role="status">
      <Icon name="info_outline" size={14} />
      <span>
        Blank? The page may be unavailable or may block embedding. Check the
        app, then Reload.
      </span>
    </p>
  {/if}
</div>

<style>
  .web-preview {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }
  .web-preview.expanded {
    border: 0;
    border-radius: 0;
    width: 100vw;
    height: 100vh;
  }
  .web-preview__head {
    gap: 2px;
    padding: 6px 6px 6px 12px;
    border-bottom: 1px solid var(--line);
    background: var(--surface-soft);
  }
  .web-preview__head .card-action {
    margin-left: 0;
  }
  .web-preview__head .card-action:disabled {
    opacity: 0.4;
    cursor: default;
  }
  /* Load state lives in the address bar, the way a browser tab shows it. */
  .web-preview__dot {
    flex: none;
    width: 8px;
    height: 8px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--muted);
  }
  .web-preview__dot.loading {
    background: var(--accent);
    animation: web-preview-pulse 1s ease-in-out infinite alternate;
  }
  .web-preview__dot.blocked {
    background: var(--bad);
  }
  @keyframes web-preview-pulse {
    to {
      opacity: 0.3;
    }
  }
  /* The rest of the head is nodrag controls; this label is the grab target. */
  .web-preview__title {
    flex: none;
    margin-right: 8px;
    font-weight: 600;
    cursor: grab;
  }
  .web-preview__url {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    margin-right: 4px;
  }
  .web-preview__url input {
    flex: 1;
    min-width: 6rem;
    height: 28px;
    padding: 0 10px;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 999px;
    font:
      12px/1 ui-monospace,
      "SFMono-Regular",
      Menlo,
      Consolas,
      monospace;
    text-overflow: ellipsis;
  }
  .web-preview__url input:hover:not(:disabled) {
    border-color: var(--line-strong);
  }
  .web-preview__url input:disabled {
    color: var(--ink-soft);
    background: transparent;
  }
  .web-preview__url button {
    flex: none;
    height: 28px;
    padding: 0 12px;
    color: var(--on-primary);
    background: var(--primary-from);
    border: 0;
    border-radius: 999px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .web-preview__url button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .web-preview button:focus-visible,
  .web-preview input:focus-visible,
  .web-preview iframe:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
  .web-preview__body {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    background: color-mix(in srgb, var(--surface) 82%, var(--bg));
  }
  .web-preview__frame {
    flex: 1;
    width: 100%;
    min-height: 0;
    border: 0;
    background: white;
  }
  .web-preview__empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin: auto;
    max-width: 32ch;
    padding: 16px;
    color: var(--muted);
    font-size: var(--type-meta);
    line-height: 1.5;
    text-align: center;
  }
  .web-preview__note {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    margin: 0;
    padding: 5px 12px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    background: var(--surface-soft);
    font-size: 11px;
    line-height: 1.4;
  }
  .web-preview__note--bad {
    color: var(--bad);
    background: var(--bad-soft);
    border-top-color: var(--bad-line);
  }
</style>
