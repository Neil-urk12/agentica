<script lang="ts">
  import { NodeResizeControl } from "@xyflow/svelte";
  import type { ProjectGroup } from "@agentica/protocol";
  import Icon from "./Icon.svelte";
  interface Props {
    data: {
      kind: "project";
      group: ProjectGroup;
      editable: boolean;
      locatable: boolean;
      summary: string;
      minWidth: number;
      minHeight: number;
      onCollapse: () => void;
      onAddAgent: () => void;
      onAddTerminal: () => void;
      onLocate: () => void;
      onRemove: () => void;
      onResize: (width: number, height: number) => void;
    };
    selected?: boolean;
  }
  let { data, selected = false }: Props = $props();
  function resizeKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 64 : 16;
    let { width, height } = data.group;
    if (event.key === "ArrowRight") width += step;
    else if (event.key === "ArrowLeft") width -= step;
    else if (event.key === "ArrowDown") height += step;
    else if (event.key === "ArrowUp") height -= step;
    else return;
    event.preventDefault();
    event.stopPropagation();
    data.onResize(width, height);
  }
</script>

<section
  class="project"
  class:collapsed={data.group.collapsed}
  aria-label={`Project ${data.group.label}`}
>
  <header class="project-drag">
    <div class="project-heading">
      <Icon name="folder_open" size={25} />
      <div class="identity">
        <strong>{data.group.label}</strong><span title={data.group.root}
          >{data.group.root}</span
        >
      </div>
      <button
        class="icon-btn nodrag"
        type="button"
        aria-label={data.group.collapsed
          ? "Expand project"
          : "Collapse project"}
        aria-expanded={!data.group.collapsed}
        onclick={data.onCollapse}
        ><Icon
          name={data.group.collapsed ? "expand_more" : "expand_less"}
        /></button
      >
      <button
        class="icon-btn nodrag"
        type="button"
        aria-label={`Remove project ${data.group.label}`}
        onclick={data.onRemove}
        disabled={!data.editable}><Icon name="delete_outline" /></button
      >
    </div>
    <div class="project-actions nodrag">
      <button
        class="btn btn--soft"
        type="button"
        onclick={data.onAddAgent}
        disabled={!data.editable || !data.group.available}
        ><Icon name="smart_toy" size={17} />Add agent</button
      >
      <button
        class="btn btn--soft"
        type="button"
        onclick={data.onAddTerminal}
        disabled={!data.editable || !data.group.available}
        ><Icon name="terminal" size={17} />Add terminal</button
      >
      <span class="summary" role="status">{data.summary}</span>
      {#if !data.group.available}<button
          class="btn btn--soft"
          type="button"
          disabled={!data.editable || !data.locatable}
          onclick={data.onLocate}>Locate folder</button
        >{/if}
    </div>
  </header>
  {#if !data.group.collapsed}
    <p class="project-hint">
      {data.group.available
        ? "Start a saved tile explicitly. Commands run with your user permissions."
        : "Folder unavailable. Stop its sessions before locating a replacement."}
    </p>
  {/if}
  {#if selected && !data.group.collapsed && data.editable}
    <NodeResizeControl
      position="bottom-right"
      minWidth={data.minWidth}
      minHeight={data.minHeight}
      maxWidth={4000}
      maxHeight={4000}
      onResizeEnd={(_, dimensions) =>
        data.onResize(dimensions.width, dimensions.height)}
    >
      <button
        class="resize-grip nodrag"
        type="button"
        aria-label="Resize project; arrow keys adjust size"
        title="Resize project. Minimum size preserves all member tiles. Arrow keys also adjust size."
        onkeydown={resizeKey}>↘</button
      >
    </NodeResizeControl>
  {/if}
</section>

<style>
  .project {
    width: 100%;
    height: 100%;
    border: 1px solid var(--line-strong);
    border-top: 3px solid var(--accent-ink);
    border-radius: 12px;
    background: color-mix(in srgb, var(--surface-soft) 94%, transparent);
    color: var(--ink);
    overflow: visible;
  }
  .project-drag {
    height: 93px;
    padding: 9px 12px;
    border-bottom: 1px solid var(--line-strong);
    cursor: grab;
    background: var(--surface);
    border-radius: 9px 9px 0 0;
    box-sizing: border-box;
  }
  .project-heading {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .identity {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  strong {
    font-size: 16px;
    line-height: 20px;
  }
  .identity span {
    font:
      12px/17px ui-monospace,
      monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ink-soft);
  }
  .project-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 7px;
  }
  .btn {
    font-size: 12px;
    padding: 4px 9px;
    min-height: 28px;
  }
  .summary {
    font-size: 12px;
    color: var(--ink-soft);
    margin-left: auto;
  }
  .project-hint {
    position: absolute;
    bottom: 6px;
    left: 16px;
    right: 40px;
    font-size: 11px;
    line-height: 15px;
    color: var(--ink-soft);
    margin: 0;
    pointer-events: none;
  }
  .collapsed .project-drag {
    border-bottom: 0;
  }
  .resize-grip {
    background: var(--surface);
    border: 1px solid var(--line-strong);
    color: var(--ink);
    width: 24px;
    height: 24px;
    border-radius: 4px;
    cursor: nwse-resize;
  }
</style>
