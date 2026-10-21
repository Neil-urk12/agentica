<script lang="ts">
  import { onMount } from "svelte";
  import type { SessionOwner } from "@agentica/protocol";
  import type { ChangesState } from "../changes-manager.svelte";
  import ChangesView from "./ChangesView.svelte";
  import Icon from "./Icon.svelte";
  interface Props {
    tileId: string;
    label: string;
    state: ChangesState;
    targets: { owner: SessionOwner; label: string }[];
    pasting: boolean;
    onPaste: () => void;
    onClose: () => void;
  }
  let { tileId, label, state, targets, pasting, onPaste, onClose }: Props =
    $props();
  let dialog: HTMLDialogElement;
  const branch = $derived(
    state.status?.state === "ready" ? state.status.branch : null,
  );
  onMount(() => {
    dialog.showModal();
    return () => dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  class="review"
  aria-modal="true"
  aria-labelledby={`review-title-${tileId}`}
  oncancel={(event) => {
    // Esc closes review mode; an open comment editor handles Esc first.
    event.preventDefault();
    onClose();
  }}
>
  <header>
    <h2 id={`review-title-${tileId}`}>
      <Icon name="difference" size={20} />Changes{#if branch}<span class="muted"
          >· {branch}</span
        >{/if}<span class="muted">· {label}</span>
    </h2>
    <div class="controls">
      <button
        class="btn btn--soft"
        type="button"
        disabled={state.loading}
        onclick={() => void state.refresh()}
        ><Icon name="sync" size={16} />Refresh</button
      >
      <button
        class="icon-btn"
        type="button"
        aria-label="Collapse to tile"
        title="Collapse to tile (Esc)"
        onclick={onClose}><Icon name="close_fullscreen" size={18} /></button
      >
    </div>
  </header>
  <ChangesView
    uid={tileId}
    {state}
    layout="overlay"
    {targets}
    {pasting}
    {onPaste}
  />
</dialog>

<style>
  .review {
    position: fixed;
    inset: 16px;
    width: auto;
    height: auto;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line-strong);
    border-radius: 12px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }
  .review::backdrop {
    background: var(--scrim);
  }
  header {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--line-strong);
  }
  h2 {
    margin: 0;
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 15px;
  }
  .muted {
    color: var(--ink-soft);
    font-weight: normal;
  }
  .controls {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .btn {
    padding: 3px 8px;
    font-size: 12px;
    min-height: 28px;
  }
  .icon-btn {
    width: 30px;
    height: 30px;
  }
</style>
