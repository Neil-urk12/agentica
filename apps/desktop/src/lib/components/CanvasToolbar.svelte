<script lang="ts">
  import Icon from "./Icon.svelte";
  import {
    ACTION_TOOLS,
    PRIMARY_TOOLS,
    STROKE_COLORS,
    STROKE_WIDTHS,
    type Tool,
  } from "../tools";

  interface Props {
    tool: Tool;
    color: string;
    width: number;
    onSelect: (tool: Tool) => void;
    onColor: (color: string) => void;
    onWidth: (width: number) => void;
  }

  let { tool, color, width, onSelect, onColor, onWidth }: Props = $props();
</script>

<div class="toolbar" role="toolbar" aria-label="Canvas tools">

  <div class="toolbar__card" role="group" aria-label="Action tools">
    {#each PRIMARY_TOOLS as item (item.tool)}
      <button
        class="toolbar__btn"
        class:toolbar__btn--active={tool === item.tool}
        type="button"
        title={`${item.label} (${item.key}) — ${item.hint}`}
        aria-label={item.label}
        aria-pressed={tool === item.tool}
        onclick={() => onSelect(item.tool)}
      >
        <Icon name={item.icon} size={20} />
      </button>
    {/each}
    {#each ACTION_TOOLS as item (item.tool)}
      <button
        class="toolbar__btn"
        class:toolbar__btn--active={tool === item.tool}
        type="button"
        title={`${item.label} (${item.key}) — ${item.hint}`}
        aria-label={item.label}
        aria-pressed={tool === item.tool}
        onclick={() => onSelect(item.tool)}
      >
        <Icon name={item.icon} size={20} />
      </button>
    {/each}
  </div>

  {#if tool === "draw"}
    <div class="toolbar__card toolbar__card--options">
      <div class="toolbar__option">
        <span class="toolbar__label">Color</span>
        <div class="toolbar__group" role="group" aria-label="Stroke color">
          {#each STROKE_COLORS as swatch (swatch)}
            <button
              class="toolbar__swatch"
              class:toolbar__swatch--active={color === swatch}
              type="button"
              title={`Stroke color ${swatch}`}
              aria-label={`Stroke color ${swatch}`}
              aria-pressed={color === swatch}
              style:background={swatch}
              onclick={() => onColor(swatch)}
            ></button>
          {/each}
        </div>
      </div>

      <div class="toolbar__option">
        <span class="toolbar__label">Size</span>
        <div class="toolbar__group" role="group" aria-label="Stroke width">
          {#each STROKE_WIDTHS as option (option)}
            <button
              class="toolbar__width"
              class:toolbar__width--active={width === option}
              type="button"
              title={`Stroke width ${option}px`}
              aria-label={`Stroke width ${option}px`}
              aria-pressed={width === option}
              onclick={() => onWidth(option)}
            >
              <span
                class="toolbar__dot"
                style:width={`${option}px`}
                style:height={`${option}px`}
              ></span>
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>
