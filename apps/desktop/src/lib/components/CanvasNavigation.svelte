<script lang="ts">
  import { LIMITS } from "@agentica/protocol";
  import Icon from "./Icon.svelte";

  interface Props {
    zoom: number;
    canFocus: boolean;
    disabled?: boolean;
    canUndo: boolean;
    canRedo: boolean;
    apple: boolean;
    onUndo: () => void;
    onRedo: () => void;
    onZoom: (factor: number) => void;
    onReset: () => void;
    onFit: () => void;
    onFocus: () => void;
  }
  let {
    zoom,
    canFocus,
    disabled = false,
    canUndo,
    canRedo,
    apple,
    onUndo,
    onRedo,
    onZoom,
    onReset,
    onFit,
    onFocus,
  }: Props = $props();
  const percent = $derived(Math.round(zoom * 100));
  const undoKeys = $derived(apple ? "⌘Z" : "Ctrl+Z");
  const redoKeys = $derived(apple ? "⇧⌘Z" : "Ctrl+Y");
</script>

<div
  class="canvas-nav"
  role="toolbar"
  aria-label="Canvas navigation"
  aria-orientation="vertical"
>
  <button
    class="canvas-nav__btn"
    type="button"
    title={`Undo (${undoKeys})`}
    aria-label="Undo"
    aria-keyshortcuts={apple ? "Meta+Z" : "Control+Z"}
    disabled={disabled || !canUndo}
    onclick={onUndo}><Icon name="undo" size={18} /></button
  >
  <button
    class="canvas-nav__btn canvas-nav__btn--group-end"
    type="button"
    title={`Redo (${redoKeys})`}
    aria-label="Redo"
    aria-keyshortcuts={apple ? "Shift+Meta+Z" : "Control+Y Control+Shift+Z"}
    disabled={disabled || !canRedo}
    onclick={onRedo}><Icon name="redo" size={18} /></button
  >
  <button
    class="canvas-nav__btn"
    type="button"
    title="Zoom in"
    aria-label="Zoom in"
    disabled={disabled || zoom >= LIMITS.maxZoom}
    onclick={() => onZoom(1.25)}><Icon name="add" size={18} /></button
  >
  <button
    class="canvas-nav__btn canvas-nav__zoom"
    type="button"
    title="Reset zoom to 100%"
    aria-label={`Zoom ${percent}%. Reset to 100%`}
    {disabled}
    onclick={onReset}>{percent}%</button
  >
  <button
    class="canvas-nav__btn"
    type="button"
    title="Zoom out"
    aria-label="Zoom out"
    disabled={disabled || zoom <= LIMITS.minZoom}
    onclick={() => onZoom(0.8)}><Icon name="remove" size={18} /></button
  >
  <button
    class="canvas-nav__btn"
    type="button"
    title="Fit canvas"
    aria-label="Fit canvas"
    {disabled}
    onclick={onFit}><Icon name="fit_screen" size={18} /></button
  >
  <button
    class="canvas-nav__btn"
    type="button"
    title={canFocus ? "Focus selection" : "Select an object to focus it"}
    aria-label="Focus selection"
    disabled={disabled || !canFocus}
    onclick={onFocus}><Icon name="center_focus_strong" size={18} /></button
  >
</div>
