<script lang="ts">
  import { tick } from "svelte";
  import { Handle, NodeResizeControl, Position } from "@xyflow/svelte";
  import type { ProjectGroup } from "@agentica/protocol";
  import Icon from "./Icon.svelte";
  import { projectStatusItems, type ProjectCounts } from "../canvas-view";
  interface Props {
    data: {
      kind: "project";
      group: ProjectGroup;
      editable: boolean;
      locatable: boolean;
      status: ProjectCounts;
      minWidth: number;
      minHeight: number;
      onCollapse: () => void;
      onAddAgent: () => void;
      onAddTerminal: () => void;
      /** Create the project's Changes tile, or reveal the existing one. */
      onChanges: () => void;
      hasChanges: boolean;
      onLocate: () => void;
      onRemove: () => void;
      onResize: (width: number, height: number) => void;
    };
    selected?: boolean;
  }
  let { data, selected = false }: Props = $props();
  const items = $derived(projectStatusItems(data.status));
  const menuId = $derived(`project-menu-${data.group.id}`);
  const addDisabled = $derived(!data.editable || !data.group.available);
  let menuOpen = $state(false);
  let trigger: HTMLButtonElement;
  let menu = $state<HTMLDivElement>();

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

  const menuItems = () =>
    [
      ...(menu?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []),
    ].filter((item) => !item.disabled);

  async function toggleMenu() {
    menuOpen = !menuOpen;
    if (!menuOpen) return;
    await tick();
    menuItems()[0]?.focus();
  }

  function closeMenu(restoreFocus = true) {
    menuOpen = false;
    if (restoreFocus) trigger.focus();
  }

  function choose(action: () => void) {
    closeMenu();
    action();
  }

  function menuKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (event.key === "Tab") {
      closeMenu(false);
      return;
    }
    const list = menuItems();
    if (!list.length) return;
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === "ArrowDown") next = (index + 1) % list.length;
    else if (event.key === "ArrowUp")
      next = (index - 1 + list.length) % list.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = list.length - 1;
    else return;
    // Keep xyflow from moving the selected group on arrow keys.
    event.preventDefault();
    event.stopPropagation();
    list[next]?.focus();
  }

  function triggerKey(event: KeyboardEvent) {
    if (event.key === "Escape" && menuOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    }
  }

  $effect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (menu?.contains(target) || trigger.contains(target)))
        return;
      closeMenu(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  });
</script>

{#snippet status()}
  <div class="status" role="status">
    {#each items as item (item.label)}
      <span class="item"
        ><span class="dot tone-{item.tone}"></span>{item.label}</span
      >
    {/each}
  </div>
{/snippet}

<section
  class="project"
  class:collapsed={data.group.collapsed}
  aria-label={`Project ${data.group.label}`}
>
  <!-- Task wires end here while the project is collapsed. -->
  <Handle
    type="target"
    position={Position.Left}
    isConnectable={false}
    class="task-anchor"
  />
  <div class="project-frame"></div>
  <header class="project-drag">
    <div class="legend">
      <strong>{data.group.label}</strong><span
        class="path"
        title={data.group.root}>{data.group.root}</span
      >
    </div>
    {#if data.group.collapsed}{@render status()}{/if}
    <div class="actions nodrag">
      <button
        class="btn btn--soft add"
        type="button"
        aria-label="Add agent"
        title="Add agent"
        onclick={data.onAddAgent}
        disabled={addDisabled}
        ><Icon name="smart_toy" size={16} /><span class="label">Add agent</span
        ></button
      >
      <button
        class="btn btn--soft add"
        type="button"
        aria-label="Add terminal"
        title="Add terminal"
        onclick={data.onAddTerminal}
        disabled={addDisabled}
        ><Icon name="terminal" size={16} /><span class="label"
          >Add terminal</span
        ></button
      >
      <button
        class="btn btn--soft add"
        type="button"
        aria-label={data.hasChanges ? "Show Changes" : "Add Changes"}
        title={data.hasChanges
          ? "Show Changes"
          : "Add a read-only Git Changes tile"}
        onclick={data.onChanges}
        disabled={data.hasChanges ? false : addDisabled}
        ><Icon name="difference" size={16} /><span class="label">Changes</span
        ></button
      >
      <button
        class="icon-btn"
        type="button"
        aria-label={data.group.collapsed
          ? "Expand project"
          : "Collapse project"}
        title={data.group.collapsed ? "Expand project" : "Collapse project"}
        aria-expanded={!data.group.collapsed}
        onclick={data.onCollapse}
        ><Icon
          name={data.group.collapsed ? "expand_more" : "expand_less"}
          size={18}
        /></button
      >
      <button
        bind:this={trigger}
        class="icon-btn"
        type="button"
        aria-label={`More actions for ${data.group.label}`}
        title="More actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuId}
        onclick={() => void toggleMenu()}
        onkeydown={triggerKey}><Icon name="more_horiz" size={18} /></button
      >
    </div>
  </header>
  {#if menuOpen}
    <div
      bind:this={menu}
      id={menuId}
      class="menu nodrag nopan nokey"
      role="menu"
      tabindex="-1"
      aria-label={`Actions for ${data.group.label}`}
      onkeydown={menuKey}
    >
      <button
        type="button"
        role="menuitem"
        disabled={!data.editable}
        onclick={() => choose(data.onRemove)}
        ><Icon name="delete_outline" size={16} />Remove project</button
      >
      {#if !data.group.available}<button
          type="button"
          role="menuitem"
          disabled={!data.editable || !data.locatable}
          onclick={() => choose(data.onLocate)}
          ><Icon name="folder_open" size={16} />Locate folder</button
        >{/if}
    </div>
  {/if}
  {#if !data.group.collapsed}
    {@render status()}
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
  /* The label strip is 28px tall and the frame's top border runs through
     its middle, like a fieldset legend. Pieces sitting on the line paint the
     frame colour below it only, so the line breaks without boxing them. */
  .project {
    --strip: 28px;
    --break: linear-gradient(
      to bottom,
      transparent calc(var(--strip) / 2),
      var(--surface-soft) calc(var(--strip) / 2)
    );
    position: relative;
    width: 100%;
    height: 100%;
    color: var(--ink);
    overflow: visible;
    container-type: inline-size;
  }
  .project-frame {
    position: absolute;
    inset: calc(var(--strip) / 2) 0 0 0;
    border: 1px solid var(--line-strong);
    border-radius: 12px;
    background: color-mix(in srgb, var(--surface-soft) 94%, transparent);
    pointer-events: none;
  }
  .project-drag {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: var(--strip);
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: grab;
  }
  .legend {
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin-left: 14px;
    padding: 0 8px;
    overflow: hidden;
    background: var(--break);
    line-height: var(--strip);
  }
  /* The path gives way first; the name truncates only when very long. */
  strong {
    flex: none;
    max-width: 60%;
    font-size: 15px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .path {
    flex: 0 1 auto;
    min-width: 0;
    font:
      12px ui-monospace,
      monospace;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions {
    flex: none;
    align-self: stretch;
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 4px;
    margin-right: 10px;
    padding: 0 6px;
    background: var(--break);
    cursor: default;
  }
  .add {
    gap: 5px;
    font-size: 12px;
    padding: 0 9px;
    min-height: 26px;
    background: var(--surface);
  }
  .icon-btn {
    width: 26px;
    height: 26px;
  }
  .status {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 12px;
    line-height: 16px;
    color: var(--ink-soft);
  }
  .project > .status {
    position: absolute;
    top: 36px;
    left: 22px;
    right: 22px;
  }
  .item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
    background: var(--ink-soft);
  }
  .tone-ok {
    background: var(--ok);
  }
  .tone-busy {
    background: var(--accent-ink);
  }
  .tone-pending {
    background: var(--warn);
  }
  .tone-bad {
    background: var(--bad);
  }
  .menu {
    position: absolute;
    z-index: 2;
    top: 30px;
    right: 10px;
    min-width: 168px;
    padding: 3px;
    display: grid;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    padding: 0 10px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
  }
  .menu button:hover:not(:disabled),
  .menu button:focus-visible {
    background: var(--surface-soft);
  }
  .menu button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  .menu button:disabled {
    color: var(--ink-soft);
    opacity: 0.6;
    cursor: not-allowed;
  }
  /* Fits in the 16px bottom padding below member tiles. */
  .project-hint {
    position: absolute;
    bottom: 1px;
    left: 16px;
    right: 40px;
    font-size: 11px;
    line-height: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--ink-soft);
    margin: 0;
    pointer-events: none;
  }
  /* Collapsed: a compact bordered strip with the status inline. */
  .collapsed .project-frame {
    inset: 0;
    border-radius: 24px;
  }
  .collapsed .project-drag {
    height: 100%;
  }
  .collapsed .legend,
  .collapsed .actions {
    background: none;
  }
  /* Collapsed status stays readable: the legend (path first) shrinks
     before the status items do. */
  .collapsed .legend {
    flex: 0 1000 auto;
    min-width: 9ch;
    margin-left: 10px;
  }
  .collapsed .status {
    flex: 0 1 auto;
    min-width: 0;
    flex-wrap: nowrap;
    overflow: hidden;
  }
  .collapsed .menu {
    top: calc(100% + 4px);
  }
  .collapsed .add .label {
    display: none;
  }
  .collapsed .add {
    padding: 0;
    width: 26px;
    justify-content: center;
  }
  @container (max-width: 560px) {
    .add .label {
      display: none;
    }
    .add {
      padding: 0;
      width: 26px;
      justify-content: center;
    }
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
