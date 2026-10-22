<script lang="ts">
  import { LIMITS, type AgentMode } from "@agentica/protocol";
  import Icon from "./Icon.svelte";

  interface Props {
    placeholder?: string;
    toolbarOpen: boolean;
    loading?: boolean;
    disabled?: boolean;
    onToggleToolbar: () => void;
    onSubmit?: (prompt: string) => boolean | Promise<boolean>;
    /** Short scope line, such as "2 selected objects · recent conversation". */
    scope?: string;
    /** Provider name and model shown in the disclosure. */
    provider?: string;
    /** What the next request actually transmits. */
    details?: string[];
    notice?: string;
    onCancel?: () => void;
    mode?: AgentMode;
    modeDisabled?: boolean;
    onModeChange?: (mode: AgentMode) => void;
    /** Shown while the chosen mode puts existing work at risk. */
    warning?: string;
  }

  let {
    placeholder = "Ask anything, or describe what you want to add…",
    toolbarOpen,
    loading = false,
    disabled = false,
    onToggleToolbar,
    onSubmit,
    scope = "",
    provider = "",
    details = [],
    notice = "",
    onCancel,
    mode = "create",
    modeDisabled = false,
    onModeChange,
    warning = "",
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
    <label class="sr-only" for="agent-mode">Agent mode</label>
    <select
      id="agent-mode"
      class="composer__mode"
      title="What the agent may change"
      value={mode}
      disabled={modeDisabled}
      onchange={(event) =>
        onModeChange?.(event.currentTarget.value as AgentMode)}
    >
      <option value="create">Create only</option>
      <option value="ask">Ask first</option>
      <option value="yolo">YOLO (auto-accept)</option>
    </select>
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
  {#if warning}
    <p class="composer__warning" role="status">
      <Icon name="warning" size={16} />{warning}
    </p>
  {/if}
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
