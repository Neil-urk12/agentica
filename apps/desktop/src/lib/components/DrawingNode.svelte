<script lang="ts">
  import type { Drawing } from "@agentica/protocol";
  import { Handle, Position } from "@xyflow/svelte";

  interface Props {
    data: { drawing: Drawing };
    width?: number;
    height?: number;
  }

  // SvelteFlow passes the node's measured box; shapes are stored relative to it.
  let { data, width = 0, height = 0 }: Props = $props();

  const w = $derived(width || 1);
  const h = $derived(height || 1);
</script>

<!-- Custom nodes must render their own handles or edges cannot attach. -->
<Handle type="target" position={Position.Top} />

<svg
  class="drawing-node"
  width={w}
  height={h}
  viewBox={`0 0 ${w} ${h}`}
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
  {/each}
</svg>
<Handle type="source" position={Position.Bottom} />

<style>
  .drawing-node {
    display: block;
    overflow: visible;
    pointer-events: none;
  }
</style>
