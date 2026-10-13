<script lang="ts">
  import { LIMITS } from "@agentica/protocol";
  import Icon from "./Icon.svelte";

  interface Props {
    placeholder?: string;
    toolbarOpen: boolean;
    onToggleToolbar: () => void;
  }

  let {
    placeholder = "Ask anything, or describe what you want to add…",
    toolbarOpen,
    onToggleToolbar,
  }: Props = $props();
</script>

<!--
  The prompt field is still a visual placeholder, but the leading button opens
  the canvas toolbar. The mic and send buttons stay decorative until the prompt
  flow is wired up.
-->
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
    maxlength={LIMITS.text}
    {placeholder}></textarea>

  <div class="composer__tools" aria-hidden="true">
    <button class="icon-btn" type="button" tabindex="-1">
      <Icon name="mic" size={20} />
    </button>
    <button class="composer__send" type="button" tabindex="-1">
      <Icon name="arrow_upward" size={20} />
    </button>
  </div>
</div>
