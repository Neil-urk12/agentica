<script lang="ts">
  import { useStore } from "@xyflow/svelte";

  // Svelte Flow seeds d3-zoom from the viewport only once, when the pane
  // mounts. Later writes to the bound viewport (restoring a saved view, zoom
  // buttons, fit, jump-to) move the rendered canvas but not d3-zoom's
  // transform, so the next drag would start from the stale transform and snap
  // back. Keep d3-zoom in step with the bound viewport. During user panning
  // they already match, and syncViewport is a no-op.
  const store = useStore();

  $effect(() => {
    const { x, y, zoom } = store.viewport;
    store.panZoom?.syncViewport({ x, y, zoom });
  });
</script>
