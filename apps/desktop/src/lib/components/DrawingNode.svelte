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
      onRead?: () => void;
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
  // A single rectangle or ellipse scales with its node. Its geometry is drawn
  // in node pixels rather than through a stretched viewBox, so labels keep
  // their proportions and wrap within the current bounds.
  const scaled = $derived.by(() => {
    if (!box) return undefined;
    const sx = w / Math.max(box.x + box.width, 1);
    const sy = h / Math.max(box.y + box.height, 1);
    return {
      kind: box.kind,
      color: box.color,
      label: box.label,
      x: box.x * sx,
      y: box.y * sy,
      width: box.width * sx,
      height: box.height * sy,
    };
  });

  let drawingEl = $state<HTMLElement>();
  let overflowing = $state(false);

  $effect(() => {
    const elements = Array.from(
      drawingEl?.querySelectorAll<HTMLElement>(".shape-label") ?? [],
    );
    void data.drawing;
    void scaled;
    if (!elements.length) {
      overflowing = false;
      return;
    }
    const check = () => {
      overflowing = elements.some(
        (element) =>
          element.scrollHeight > element.clientHeight + 1 ||
          element.scrollWidth > element.clientWidth + 1,
      );
    };
    const frame = requestAnimationFrame(check);
    const observer = new ResizeObserver(check);
    for (const element of elements) observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  });
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
  bind:this={drawingEl}
>
  {#if data.preview}<span class="chip chip--proposal drawing__chip"
      >Proposed</span
    >{/if}
  <!-- Custom nodes must render their own handles or edges cannot attach. -->
  <Handle type="target" position={Position.Top} />

  <svg
    class="drawing-node"
    width={w}
    height={h}
    viewBox={`0 0 ${w} ${h}`}
    aria-hidden="true"
  >
    {#if scaled}
      {#if scaled.kind === "rectangle"}
        <rect
          x={scaled.x + 1}
          y={scaled.y + 1}
          width={Math.max(scaled.width - 2, 1)}
          height={Math.max(scaled.height - 2, 1)}
          rx="4"
          fill="none"
          stroke={scaled.color}
          stroke-width="2"
        />
      {:else}
        <ellipse
          cx={scaled.x + scaled.width / 2}
          cy={scaled.y + scaled.height / 2}
          rx={Math.max(scaled.width / 2 - 1, 1)}
          ry={Math.max(scaled.height / 2 - 1, 1)}
          fill="none"
          stroke={scaled.color}
          stroke-width="2"
        />
      {/if}
    {:else}
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
    {/if}
  </svg>
  {#if scaled?.label}
    <div
      class="shape-label"
      style:left={`${scaled.x}px`}
      style:top={`${scaled.y}px`}
      style:width={`${scaled.width}px`}
      style:height={`${scaled.height}px`}
    >
      <span>{scaled.label}</span>
    </div>
  {:else}
    {#each data.drawing.shapes as shape}
      {#if shape.kind !== "path" && shape.label && !scaled}
        <div
          class="shape-label"
          style:left={`${shape.x}px`}
          style:top={`${shape.y}px`}
          style:width={`${shape.width}px`}
          style:height={`${shape.height}px`}
        >
          <span>{shape.label}</span>
        </div>
      {/if}
    {/each}
  {/if}
  {#if overflowing}
    {#if data.preview}
      <span class="card-more drawing__more">More · see Proposed text</span>
    {:else if data.onRead}
      <button
        class="card-more drawing__more nodrag"
        type="button"
        onkeydown={(event) => event.stopPropagation()}
        onclick={data.onRead}>Read label</button
      >
    {/if}
  {/if}
  <Handle type="source" position={Position.Bottom} />
</div>
