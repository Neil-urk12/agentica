<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { NodeResizer } from "@xyflow/svelte";
  import { LIMITS } from "@agentica/protocol";
  import { PREVIEW_URL_ERROR, previewUrlAllowed } from "../preview-url";

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
<div class="web-preview" bind:this={container}>
  <div class="web-preview__head">
    <span>Local preview</span>
    <button
      class="nodrag"
      type="button"
      onclick={load}
      disabled={!allowed}
      aria-label="Reload preview">Reload</button
    >
    <button
      class="nodrag"
      type="button"
      bind:this={expandButton}
      onclick={() => void toggleExpand()}
      aria-label={expanded ? "Return to canvas" : "Expand preview"}
      >{expanded ? "Return" : "Expand"}</button
    >
    <button
      class="nodrag"
      type="button"
      onclick={data.onRemove}
      disabled={!data.editable}
      aria-label="Remove preview">Remove</button
    >
  </div>
  <form
    class="web-preview__url nodrag"
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
  >
    <label for={`preview-url-${data.nodeId}`}>Local app URL</label>
    <input
      id={`preview-url-${data.nodeId}`}
      bind:value={draft}
      disabled={!data.editable}
      maxlength="2048"
      spellcheck="false"
    />
    <button type="submit" disabled={saving || !data.editable}>Save</button>
  </form>
  {#if error}<p role="alert">{error}</p>{/if}
  {#if !allowed}
    <p role="alert">
      This URL is not available here. {PREVIEW_URL_ERROR}
    </p>
  {:else}
    {#if loading}<p role="status">Loading…</p>{/if}
    {#if guidance}<p role="status">
        The page may be unavailable or may block embedding. Check the app, then
        Reload.
      </p>{/if}
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

<style>
  .web-preview {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
  }
  .web-preview:fullscreen {
    border-radius: 0;
    width: 100vw;
    height: 100vh;
  }
  .web-preview__head,
  .web-preview__url {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 6px;
  }
  .web-preview__head span {
    flex: 1;
  }
  .web-preview__url input {
    flex: 1;
    min-width: 8rem;
  }
  .web-preview button:focus-visible,
  .web-preview input:focus-visible,
  .web-preview iframe:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .web-preview__url label {
    font-size: 11px;
  }
  .web-preview button,
  .web-preview input {
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 4px 6px;
    font: inherit;
  }
  .web-preview button:disabled {
    opacity: 0.5;
  }
  .web-preview p {
    padding: 4px 8px;
    margin: 0;
    font-size: 12px;
  }
  .web-preview__frame {
    flex: 1;
    width: 100%;
    min-height: 0;
    border: 0;
    background: white;
  }
</style>
