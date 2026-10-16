<script lang="ts">
  import { LIMITS } from "@agentica/protocol";
  import Icon from "./Icon.svelte";

  interface Props {
    placeholder?: string;
    toolbarOpen: boolean;
    loading?: boolean;
    disabled?: boolean;
    onToggleToolbar: () => void;
    onSubmit?: (prompt: string) => boolean | Promise<boolean>;
  }

  let {
    placeholder = "Ask anything, or describe what you want to add…",
    toolbarOpen,
    loading = false,
    disabled = false,
    onToggleToolbar,
    onSubmit,
  }: Props = $props();

  let promptText = $state("");

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

<style>
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
