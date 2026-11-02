<script lang="ts">
  import { TEXT_COLORS, TEXT_SIZES, type TextStyle } from "@agentica/protocol";
  import Icon from "./Icon.svelte";

  interface Props {
    style: TextStyle;
    /** A field patch; undefined restores that field's default. */
    onChange: (patch: TextStyle) => void;
  }

  let { style, onChange }: Props = $props();

  const WEIGHTS = ["regular", "bold"] as const;
  const ALIGNS = [
    { value: "start", icon: "format_align_left", label: "Align left" },
    { value: "center", icon: "format_align_center", label: "Align center" },
    { value: "end", icon: "format_align_right", label: "Align right" },
  ] as const;

  /** Send only this field so pending edits cannot overwrite one another. */
  function set<K extends keyof TextStyle>(
    key: K,
    value: NonNullable<TextStyle[K]>,
    fallback: NonNullable<TextStyle[K]>,
  ) {
    onChange({ [key]: value === fallback ? undefined : value });
  }
</script>

<div class="toolbar__option">
  <span class="toolbar__label">Color</span>
  <div class="toolbar__group" role="group" aria-label="Text color">
    {#each TEXT_COLORS as color (color)}
      {@const active = (style.color ?? "default") === color}
      <button
        class="toolbar__swatch"
        class:toolbar__swatch--active={active}
        type="button"
        title={`Color ${color}`}
        aria-label={`Color ${color}`}
        aria-pressed={active}
        style:background={color === "default"
          ? "var(--ink)"
          : `var(--text-${color})`}
        onclick={() => set("color", color, "default")}
      ></button>
    {/each}
  </div>
</div>
<div class="toolbar__option">
  <span class="toolbar__label">Size</span>
  <div class="toolbar__group" role="group" aria-label="Text size">
    {#each TEXT_SIZES as size (size)}
      {@const active = (style.size ?? "m") === size}
      <button
        class="toolbar__width toolbar__text"
        class:toolbar__width--active={active}
        type="button"
        title={`Size ${size.toUpperCase()}`}
        aria-pressed={active}
        onclick={() => set("size", size, "m")}>{size.toUpperCase()}</button
      >
    {/each}
  </div>
</div>
<div class="toolbar__option">
  <div class="toolbar__group" role="group" aria-label="Text weight">
    {#each WEIGHTS as weight (weight)}
      {@const active = (style.weight ?? "regular") === weight}
      <button
        class="toolbar__width toolbar__text"
        class:toolbar__width--active={active}
        type="button"
        title={weight === "bold" ? "Bold" : "Regular"}
        aria-label={weight === "bold" ? "Bold" : "Regular"}
        aria-pressed={active}
        style:font-weight={weight === "bold" ? 700 : 400}
        onclick={() => set("weight", weight, "regular")}
        >{weight === "bold" ? "B" : "R"}</button
      >
    {/each}
  </div>
  <div class="toolbar__group" role="group" aria-label="Text alignment">
    {#each ALIGNS as align (align.value)}
      {@const active = (style.align ?? "start") === align.value}
      <button
        class="toolbar__width toolbar__text"
        class:toolbar__width--active={active}
        type="button"
        title={align.label}
        aria-label={align.label}
        aria-pressed={active}
        onclick={() => set("align", align.value, "start")}
        ><Icon name={align.icon} size={18} /></button
      >
    {/each}
  </div>
</div>
