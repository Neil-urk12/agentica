<script lang="ts">
  import { untrack } from "svelte";
  import { LIMITS } from "@agentica/protocol";
  import { fitTextField } from "../canvas-view";
  import Modal from "./Modal.svelte";
  import Markdown from "./Markdown.svelte";
  import Icon from "./Icon.svelte";

  interface Props {
    title: string;
    subtitle?: string;
    /** Current source; editing reports every change through `onEdit`. */
    text: string;
    /** Labels render as plain text; text artifacts use the Markdown subset. */
    markdown?: boolean;
    /** Read-only caveat about the text, such as partial file extraction. */
    notice?: string;
    /** Present only for editable text; labels and proposals are read-only. */
    onEdit?: (text: string) => void;
    editDisabled?: boolean;
    startEditing?: boolean;
    onClose: () => void;
  }
  let {
    title,
    subtitle,
    text,
    markdown = true,
    notice = "",
    onEdit,
    editDisabled = false,
    startEditing = false,
    onClose,
  }: Props = $props();

  // Opening mode is chosen once; later busy states only disable the editor.
  let editing = $state(untrack(() => startEditing && !!onEdit));
  let content = $state<HTMLElement>();
  let textarea = $state<HTMLTextAreaElement>();

  // The dialog's own autofocus lands on the first control; move it to what
  // is being read or edited. Focusing the content instead of Close keeps a
  // focus ring off the buttons on open; Tab still reaches them and Escape
  // still closes.
  $effect(() => {
    const target = editing ? textarea : content;
    requestAnimationFrame(() => target?.focus());
  });
</script>

<Modal {title} {subtitle} icon="article" wide {onClose}>
  {#snippet actions()}
    {#if onEdit}
      <button
        class="btn btn--soft"
        type="button"
        aria-pressed={editing}
        disabled={editDisabled && !editing}
        onclick={() => (editing = !editing)}
        >{editing ? "Done editing" : "Edit source"}</button
      >
    {/if}
    <button
      class="icon-btn"
      type="button"
      title="Close (Esc)"
      aria-label="Close"
      onclick={onClose}><Icon name="close" /></button
    >
  {/snippet}
  {#if editing && onEdit}
    <label class="sr-only" for="reader-source">Source text</label>
    <textarea
      id="reader-source"
      bind:this={textarea}
      class="reader__source"
      value={text}
      maxlength={LIMITS.text}
      disabled={editDisabled}
      oninput={(event) => onEdit?.(fitTextField(event.currentTarget))}
    ></textarea>
  {:else}
    <div class="reader__content" tabindex="-1" bind:this={content}>
      {#if notice}
        <p class="reader__notice" role="note">{notice}</p>
      {/if}
      {#if !text.trim()}
        <p class="reader__empty">
          {onEdit
            ? "Nothing written yet. Choose Edit source to add text."
            : "This object has no text yet."}
        </p>
      {:else if markdown}
        <Markdown source={text} links />
      {:else}
        <p class="reader__plain">{text}</p>
      {/if}
    </div>
  {/if}
</Modal>
