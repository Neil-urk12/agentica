<script lang="ts">
  import { LIMITS } from "@agentica/protocol";
  import Icon from "./Icon.svelte";

  interface Props {
    placeholder?: string;
    toolbarOpen: boolean;
    loading?: boolean;
    disabled?: boolean;
    onToggleToolbar: () => void;
    onAddFile?: () => void;
    addFileDisabled?: boolean;
    onSubmit?: (prompt: string) => boolean | Promise<boolean>;
    /** Short scope line, such as "2 selected objects · recent conversation". */
    scope?: string;
    /** Provider name and model shown in the disclosure. */
    provider?: string;
    /** What the next request actually transmits. */
    details?: string[];
    notice?: string;
    /** Live generation counters, such as "Request 2 of 8 · 1 edit staged". */
    progress?: string;
    onCancel?: () => void;
  }

  let {
    placeholder = "Ask anything, or describe what you want to add…",
    toolbarOpen,
    loading = false,
    disabled = false,
    onToggleToolbar,
    onAddFile,
    addFileDisabled = false,
    onSubmit,
    scope = "",
    provider = "",
    details = [],
    notice = "",
    progress = "",
    onCancel,
  }: Props = $props();

  let promptText = $state("");
  let detailsOpen = $state(false);

  async function submit() {
    const submittedText = promptText;
    const trimmed = promptText.trim();
    if (!trimmed || loading || disabled) return;
    if ((await onSubmit?.(trimmed)) && promptText === submittedText) {
      promptText = "";
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submit();
    }
  }
</script>

<div class="composer" role="group" aria-label="Canvas prompt">
  <div class="composer__context">
    <span class="composer__scope" aria-live="polite">
      <span class="sr-only">Context:</span>{scope}
    </span>
    <button
      class="composer__disclose"
      type="button"
      aria-expanded={detailsOpen}
      aria-controls="composer-details"
      onclick={() => (detailsOpen = !detailsOpen)}
    >
      <Icon name={detailsOpen ? "expand_more" : "info"} size={16} />
      Context details
    </button>
  </div>
  {#if detailsOpen}
    <div id="composer-details" class="composer__details">
      <p>
        <strong>Provider:</strong>
        {provider || "Not configured — choose one in Settings"}
      </p>
      <ul>
        {#each details as line}<li>{line}</li>{/each}
      </ul>
      {#if notice}<p>{notice}</p>{/if}
    </div>
  {/if}
  {#if loading && progress}
    <p class="composer__progress" aria-live="polite">{progress}</p>
  {/if}
  <div class="composer__row">
    <button
      class="composer__lead"
      class:composer__lead--active={toolbarOpen}
      type="button"
      title="Canvas tools"
      aria-label="Canvas tools"
      aria-expanded={toolbarOpen}
      onclick={onToggleToolbar}
    >
      <Icon name="build" size={20} />
    </button>
    {#if onAddFile}
      <button
        class="composer__lead"
        type="button"
        title="Add a file — images, PDF, Word, and text files are copied onto the canvas"
        aria-label="Add a file"
        disabled={addFileDisabled}
        onclick={onAddFile}
      >
        <Icon name="attach_file" size={20} />
      </button>
    {/if}

    <label class="sr-only" for="canvas-prompt">Prompt</label>
    <textarea
      id="canvas-prompt"
      class="composer__input"
      rows="1"
      bind:value={promptText}
      onkeydown={onKeydown}
      {disabled}
      maxlength={LIMITS.text}
      {placeholder}></textarea>

    <div class="composer__tools">
      {#if loading}<button
          type="button"
          class="btn btn--soft"
          onclick={onCancel}>Cancel</button
        >{/if}
      <button
        class="composer__send"
        type="button"
        title={loading ? "Generating response…" : "Send prompt (Enter)"}
        aria-label="Send prompt"
        disabled={disabled || loading || !promptText.trim()}
        onclick={submit}
      >
        {#if loading}
          <span class="spinner" aria-hidden="true"></span>
        {:else}
          <Icon name="arrow_upward" size={20} />
        {/if}
      </button>
    </div>
  </div>
</div>

<style>
  .composer__lead:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .composer__send:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    border-color: var(--line);
    color: var(--muted);
  }

  .composer__send .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--line-strong);
    border-top-color: var(--accent);
  }
</style>
