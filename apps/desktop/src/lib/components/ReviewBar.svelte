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
    onApply: () => void;
    onDiscard: () => void;
    onRead: (item: ProposedContent) => void;
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
  }: Props = $props();
  let listOpen = $state(false);
</script>

<section class="review-bar" aria-label="Pending proposal review">
  <div class="review-bar__row">
    <span class="review-bar__summary">
      <span class="chip chip--pending">Pending review</span>
      {count} proposed {count === 1 ? "change" : "changes"}
    </span>
    <div class="review-bar__actions">
      <button class="btn btn--soft" type="button" onclick={onShow}>
        <Icon name="center_focus_strong" size={16} />Show changes
      </button>
      {#if content.length}
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
      <Icon name="error" size={16} />{error} The proposal is still pending; retry
      Apply or Discard.
    </p>
  {/if}
</section>
