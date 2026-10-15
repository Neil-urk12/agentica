<script lang="ts">
  import type { Drawing } from "@agentica/protocol";
  import { Handle, NodeResizer, Position } from "@xyflow/svelte";
  import { LIMITS } from "@agentica/protocol";

  interface Props {
    data: {
      drawing: Drawing;
      preview?: boolean;
      connectable?: boolean;
      editable?: boolean;
      onResize?: (width: number, height: number) => void;
    };
    selected?: boolean;
    width?: number;
    height?: number;
  }

  // SvelteFlow passes the node's measured box; shapes are stored relative to it.
  let { data, width = 0, height = 0, selected = false }: Props = $props();

  const w = $derived(width || 1);
  const h = $derived(height || 1);
  const box = $derived(
    data.drawing.shapes.length === 1 && data.drawing.shapes[0]?.kind !== "path"
      ? data.drawing.shapes[0]
      : undefined,
  );
</script>

<NodeResizer
  isVisible={selected && !data.preview && !!data.editable && !!box}
  minWidth={LIMITS.minSize}
  minHeight={LIMITS.minSize}
  maxWidth={LIMITS.maxSize}
  maxHeight={LIMITS.maxSize}
  onResizeEnd={(_, params) => data.onResize?.(params.width, params.height)}
/>
<div
  class="drawing"
  class:preview={data.preview}
  class:handles-hidden={!data.connectable}
>
  {#if data.preview}<span class="caption">Proposed</span>{/if}
  <!-- Custom nodes must render their own handles or edges cannot attach. -->
  <Handle type="target" position={Position.Top} />

  <svg
    class="drawing-node"
    width={w}
    height={h}
    viewBox={`0 0 ${box ? box.x + box.width : w} ${box ? box.y + box.height : h}`}
    preserveAspectRatio="none"
    aria-hidden="true"
  >
    {#each data.drawing.shapes as shape}
      {#if shape.kind === "path"}
        <polyline
          points={shape.points.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke={shape.color}
          stroke-width={shape.width}
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      {:else if shape.kind === "rectangle"}
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rx="4"
          fill="none"
          stroke={shape.color}
          stroke-width="2"
        />
      {:else}
        <ellipse
          cx={shape.x + shape.width / 2}
          cy={shape.y + shape.height / 2}
          rx={shape.width / 2}
          ry={shape.height / 2}
          fill="none"
          stroke={shape.color}
          stroke-width="2"
        />
      {/if}
      {#if shape.kind !== "path" && shape.label}
        <foreignObject
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
        >
          <div class="shape-label">{shape.label}</div>
        </foreignObject>
      {/if}
    {/each}
  </svg>
  <Handle type="source" position={Position.Bottom} />
</div>

<style>
  .drawing {
    width: 100%;
    height: 100%;
  }
  .preview {
    outline: 2px dashed var(--accent);
    background: var(--surface);
    opacity: 0.95;
    pointer-events: none;
  }
  .caption {
    position: absolute;
    top: -20px;
    color: var(--ink-soft);
    font-size: 12px;
  }
  .shape-label {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 12px;
    color: var(--ink);
    font-size: 16px;
    text-align: center;
    overflow-wrap: anywhere;
  }
  .handles-hidden :global(.svelte-flow__handle) {
    opacity: 0;
    pointer-events: none;
  }
  .drawing-node {
    display: block;
    overflow: visible;
    pointer-events: none;
  }
</style>
