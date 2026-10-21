<script lang="ts">
  import { Handle, NodeResizer, Position } from "@xyflow/svelte";
  import { LIMITS } from "@agentica/protocol";
  import Icon from "./Icon.svelte";

  interface Props {
    selected?: boolean;
    data: {
      html: string;
      preview?: boolean;
      connectable?: boolean;
      editable?: boolean;
      onResize?: (width: number, height: number) => void;
      onRead?: () => void;
    };
  }
  let { data, selected = false }: Props = $props();
</script>

<NodeResizer
  isVisible={selected && !data.preview && !!data.editable}
  minWidth={LIMITS.minSize}
  minHeight={LIMITS.minSize}
  maxWidth={LIMITS.maxSize}
  maxHeight={LIMITS.maxSize}
  onResizeEnd={(_, params) => data.onResize?.(params.width, params.height)}
/>
<div
  class="design"
  class:preview={data.preview}
  class:handles-hidden={!data.connectable}
>
  <Handle type="target" position={Position.Top} />
  <div class="card-head design__head">
    {#if data.preview}<span class="chip chip--proposal">Proposed</span>{/if}
    <span class="card-role"><Icon name="web" size={14} /> Design</span>
    {#if data.onRead && !data.preview}
      <button
        class="card-action nodrag"
        type="button"
        title="Read the design's HTML"
        aria-label="Read the design's HTML source"
        onkeydown={(event) => event.stopPropagation()}
        onclick={data.onRead}
      >
        <Icon name="code" size={16} />
      </button>
    {/if}
  </div>
  <!--
    Scripts stay blocked (no allow-scripts), and the app's CSP blocks remote
    images, fonts, forms, and navigation. The frame needs same-origin access
    because Chrome's `frame-src 'self'` rejects an opaque srcdoc frame.
    Pointer events stay off so the canvas can move and resize the node.
  -->
  <iframe
    class="design__frame"
    title="Design preview"
    sandbox="allow-same-origin"
    srcdoc={data.html}
    referrerpolicy="no-referrer"
    tabindex="-1"
  ></iframe>
  <Handle type="source" position={Position.Bottom} />
</div>
