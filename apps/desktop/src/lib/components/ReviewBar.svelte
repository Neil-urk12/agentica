<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { ProposedContent } from "../canvas-view";

  interface Props {
    count: number;
    content: ProposedContent[];
    disabled: boolean;
    resolving: boolean;
    error?: string;
    onShow: () => void;
    onApply?: () => void;
    onDiscard?: () => void;
    onRead: (item: ProposedContent) => void;
    /** Changes a YOLO turn applied without review; offers Revert instead of Apply. */
    applied?: boolean;
    onRevert?: () => void;
    onDismiss?: () => void;
  }
  let {
    count,
    content,
    disabled,
    resolving,
    error = "",
    onShow,
    onApply,
    onDiscard,
    onRead,
    applied = false,
    onRevert,
    onDismiss,
  }: Props = $props();
  let listOpen = $state(false);
</script>

<section
  class="review-bar"
  aria-label={applied ? "Applied changes" : "Pending proposal review"}
>
  <div class="review-bar__row">
    {#if applied}
      <span class="review-bar__summary" role="status">
        <span class="chip chip--ok">Applied</span>
        {count}
        {count === 1 ? "change" : "changes"} applied without review
      </span>
    {:else}
      <span class="review-bar__summary">
        <span class="chip chip--pending">Pending review</span>
        {count} proposed {count === 1 ? "change" : "changes"}
      </span>
    {/if}
    <div class="review-bar__actions">
      <button class="btn btn--soft" type="button" onclick={onShow}>
        <Icon name="center_focus_strong" size={16} />Show changes
      </button>
      {#if applied}
        <button
          class="btn btn--soft"
          type="button"
          disabled={disabled || resolving}
          onclick={onRevert}
          ><Icon name="undo" size={16} />{resolving
            ? "Working…"
            : "Revert"}</button
        >
        <button
          class="icon-btn"
          type="button"
          title="Dismiss"
          aria-label="Dismiss applied changes notice"
          onclick={onDismiss}
        >
          <Icon name="close" size={16} />
        </button>
      {:else if content.length}
        <button
          class="btn btn--soft"
          type="button"
          aria-expanded={listOpen}
          aria-controls="review-content"
          onclick={() => (listOpen = !listOpen)}
        >
          <Icon name="article" size={16} />Proposed text
        </button>
      {/if}
      {#if !applied}
        <button
          class="btn btn--primary"
          type="button"
          disabled={disabled || resolving}
          onclick={onApply}>{resolving ? "Working…" : "Apply"}</button
        >
        <button
          class="btn btn--soft"
          type="button"
          disabled={disabled || resolving}
          onclick={onDiscard}>Discard</button
        >
      {/if}
    </div>
  </div>
  {#if listOpen && content.length}
    <ul id="review-content" class="review-bar__list">
      {#each content as item}
        <li>
          <span class="review-bar__item">
            <strong>{item.title}</strong>
            <span>{item.text.slice(0, 120)}</span>
          </span>
          <button
            class="btn btn--ghost"
            type="button"
            onclick={() => onRead(item)}>Read</button
          >
        </li>
      {/each}
    </ul>
  {/if}
  {#if error}
    <p class="review-bar__error" role="alert">
      <Icon name="error" size={16} />{error}
      {applied
        ? "The changes are still applied."
        : "The proposal is still pending; retry Apply or Discard."}
    </p>
  {/if}
</section>
