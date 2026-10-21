<script lang="ts">
  import { NodeResizeControl } from "@xyflow/svelte";
  import { onMount } from "svelte";
  import type {
    ProjectGroup,
    SessionOwner,
    SessionTile,
  } from "@agentica/protocol";
  import type { ChangesState } from "../changes-manager.svelte";
  import ChangesView from "./ChangesView.svelte";
  import Icon from "./Icon.svelte";
  interface Props {
    data: {
      kind: "changes";
      tile: SessionTile;
      group: ProjectGroup;
      state: ChangesState;
      targets: { owner: SessionOwner; label: string }[];
      pasting: boolean;
      editable: boolean;
      onExpand: () => void;
      onPaste: () => void;
      onRemove: () => void;
      onResize: (width: number, height: number) => void;
    };
    selected?: boolean;
  }
  let { data, selected = false }: Props = $props();
  const branch = $derived(
    data.state.status?.state === "ready" ? data.state.status.branch : null,
  );
  const maxWidth = $derived(data.group.width - data.tile.x - 16);
  const maxHeight = $derived(data.group.height - data.tile.y - 16);
  // Load on first show; later reads are manual or follow Codex attention.
  onMount(() => {
    if (!data.state.status && !data.state.loading) void data.state.refresh();
  });
  function resizeKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 64 : 16;
    let { width, height } = data.tile;
    if (event.key === "ArrowRight") width += step;
    else if (event.key === "ArrowLeft") width -= step;
    else if (event.key === "ArrowDown") height += step;
    else if (event.key === "ArrowUp") height -= step;
    else return;
    event.preventDefault();
    event.stopPropagation();
    data.onResize(
      Math.max(Math.min(360, maxWidth), width),
      Math.max(Math.min(260, maxHeight), height),
    );
  }
</script>

<section class="changes-tile" aria-label={`Changes in ${data.group.label}`}>
  <!-- Double-click is a pointer shortcut; the Expand button is the keyboard path. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header class="changes-drag" ondblclick={data.onExpand}>
    <div class="title">
      <Icon name="difference" size={18} /><strong>Changes</strong
      >{#if branch}<span class="branch" title={branch}>· {branch}</span>{/if}
    </div>
    <div class="controls nodrag">
      <button
        class="icon-btn"
        type="button"
        aria-label="Refresh changes"
        title="Refresh changes"
        disabled={data.state.loading}
        onclick={() => void data.state.refresh()}
        ><Icon name="sync" size={17} /></button
      >
      <button
        class="icon-btn"
        id={`changes-expand-${data.tile.id}`}
        type="button"
        aria-label="Expand to review mode"
        title="Expand to review mode"
        onclick={data.onExpand}><Icon name="open_in_full" size={17} /></button
      >
      <button
        class="icon-btn"
        type="button"
        aria-label="Remove Changes tile"
        title="Remove Changes tile"
        disabled={!data.editable}
        onclick={data.onRemove}><Icon name="delete_outline" size={17} /></button
      >
    </div>
  </header>
  <div class="body nodrag nopan nowheel">
    <ChangesView
      uid={data.tile.id}
      state={data.state}
      layout="tile"
      targets={data.targets}
      pasting={data.pasting}
      onPaste={data.onPaste}
    />
  </div>
  {#if selected && data.editable}
    <NodeResizeControl
      position="bottom-right"
      minWidth={Math.min(360, maxWidth)}
      minHeight={Math.min(260, maxHeight)}
      {maxWidth}
      {maxHeight}
      onResizeEnd={(_, dimensions) =>
        data.onResize(dimensions.width, dimensions.height)}
    >
      <button
        class="resize-grip nodrag"
        type="button"
        aria-label="Resize Changes tile; arrow keys adjust size"
        title="Resize Changes tile; arrow keys adjust size"
        onkeydown={resizeKey}>↘</button
      >
    </NodeResizeControl>
  {/if}
</section>

<style>
  .changes-tile {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    overflow: hidden;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-sm);
  }
  .changes-drag {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    cursor: grab;
    border-bottom: 1px solid var(--line-strong);
    flex: none;
  }
  .title {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
    font-size: 13px;
  }
  .branch {
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .controls {
    display: flex;
    gap: 4px;
    cursor: default;
  }
  .icon-btn {
    width: 28px;
    height: 28px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    cursor: default;
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
