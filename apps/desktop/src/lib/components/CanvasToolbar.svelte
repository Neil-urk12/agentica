<script lang="ts">
  import Icon from "./Icon.svelte";
  import { TOOLS, type Tool } from "../tools";

  interface Props {
    tool: Tool;
    disabled?: boolean;
    onSelect: (tool: Tool) => void;
  }

  let { tool, disabled = false, onSelect }: Props = $props();
</script>

<div class="toolbar" role="toolbar" aria-label="Canvas tools">
  {#each TOOLS as item (item.tool)}
    <button
      class="toolbar__btn"
      class:toolbar__btn--active={tool === item.tool}
      type="button"
      title={`${item.label} — ${item.hint}`}
      aria-label={item.label}
      aria-pressed={tool === item.tool}
      {disabled}
      onclick={() => onSelect(item.tool)}
    >
      <Icon name={item.icon} size={20} />
    </button>
  {/each}
</div>
