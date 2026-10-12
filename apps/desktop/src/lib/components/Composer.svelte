<script lang="ts">
  import { LIMITS } from "@agentica/protocol";
  import Icon from "./Icon.svelte";

  interface Props {
    placeholder?: string;
  }

  let {
    placeholder = "Ask anything, or describe what you want to add…",
  }: Props = $props();
</script>

<!--
  Visual placeholder only: the field accepts text, but nothing reads or submits
  it yet, and the icon buttons are decorative (no handlers, kept out of the tab
  order) until the prompt flow is wired up.
-->
<div class="composer" role="group" aria-label="Canvas prompt">
  <button class="composer__lead" type="button" tabindex="-1" aria-hidden="true">
    <Icon name="auto_awesome" size={20} />
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
