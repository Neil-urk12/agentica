<script lang="ts">
  import { LIMITS } from "@agentica/protocol";
  import Icon from "./Icon.svelte";
  import type {
    ProjectGroup,
    SessionStatus,
    SessionTile,
  } from "@agentica/protocol";
  import { attentionLabel } from "../session-attention";

  interface Props {
    zoom: number;
    canFocus: boolean;
    disabled?: boolean;
    onZoom: (factor: number) => void;
    onReset: () => void;
    onFit: () => void;
    onFocus: () => void;
    attention: { tile: SessionTile; status: SessionStatus }[];
    projects: ProjectGroup[];
    onGo: (id: string) => void;
  }
  let {
    zoom,
    canFocus,
    disabled = false,
    onZoom,
    onReset,
    onFit,
    onFocus,
    attention,
    projects,
    onGo,
  }: Props = $props();
  const percent = $derived(Math.round(zoom * 100));
  const entries = $derived(attention);
  let open = $state(false);
  let attentionButton: HTMLButtonElement;
</script>

<div
  class="canvas-nav"
  role="toolbar"
  aria-label="Canvas navigation"
  aria-orientation="vertical"
>
  <button
    bind:this={attentionButton}
    class="canvas-nav__btn"
    type="button"
    title="Session attention"
    aria-label={`Session attention: ${entries.length} ${entries.length === 1 ? "tile" : "tiles"}`}
    aria-expanded={open}
    aria-controls="session-attention-list"
    onclick={() => (open = !open)}>●{entries.length}</button
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
<span class="sr-only" role="status" aria-live="polite" aria-atomic="true"
  >{entries.length} session {entries.length === 1 ? "tile needs" : "tiles need"} attention</span
>
{#if open}
  <section
    id="session-attention-list"
    class="attention-list"
    aria-label="Session attention"
  >
    <header>
      <strong>Session attention</strong><button
        class="btn btn--soft"
        type="button"
        onclick={() => {
          open = false;
          attentionButton.focus();
        }}>Close</button
      >
    </header>
    {#if !entries.length}<p>No sessions need attention.</p>{/if}
    <ul>
      {#each entries as entry (entry.tile.id)}
        <li>
          <strong
            >{entry.tile.kind === "cli-agent" ? "Codex" : "Terminal"} · {projects.find(
              (project) => project.id === entry.tile.projectId,
            )?.label ?? "Project"}</strong
          >
          <span>{attentionLabel(entry.status)}</span>
          <button
            class="btn btn--soft"
            type="button"
            aria-label={`Go to ${entry.tile.kind === "cli-agent" ? "Codex" : "Terminal"} in ${projects.find((project) => project.id === entry.tile.projectId)?.label ?? "Project"}`}
            onclick={() => {
              onGo(entry.tile.id);
              open = false;
              attentionButton.focus();
            }}>Go</button
          >
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .attention-list {
    position: absolute;
    z-index: 7;
    left: 3.7rem;
    bottom: 1.25rem;
    width: min(340px, calc(100% - 4.5rem));
    max-height: min(420px, 65%);
    overflow: auto;
    padding: 12px;
    box-sizing: border-box;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-sm);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
  }
  li {
    display: grid;
    gap: 8px;
    padding: 10px 0;
    border-top: 1px solid var(--line);
    font-size: 13px;
    overflow-wrap: anywhere;
  }
  li button {
    justify-self: start;
  }
</style>
