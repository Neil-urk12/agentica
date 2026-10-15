<script lang="ts">
  import { Handle, NodeResizer, Position } from "@xyflow/svelte";
  import { LIMITS } from "@agentica/protocol";

  interface Props {
    selected?: boolean;
    data: {
      text: string;
      purpose?: string;
      role?: string;
      status?: string;
      error?: string;
      preview?: boolean;
      connectable?: boolean;
      editable?: boolean;
      changes?: number;
      onEdit?: (text: string) => void;
      onResize?: (width: number, height: number) => void;
      onResolve?: (action: "apply" | "discard") => void;
      onRetry?: () => void;
    };
  }
  let { data, selected = false }: Props = $props();
  let editing = $state(false);
  let textarea = $state<HTMLTextAreaElement>();
  function edit() {
    if (!data.editable || data.preview) return;
    editing = true;
    requestAnimationFrame(() => textarea?.focus());
  }
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
  class="canvas-text"
  class:preview={data.preview}
  class:handles-hidden={!data.connectable}
>
  <Handle type="target" position={Position.Top} />
  {#if data.preview}<span class="caption">Proposed</span>
  {:else if data.role || data.purpose === "instruction"}<span class="caption"
      >{data.role || "Instruction"}</span
    >{/if}
  {#if editing && !data.preview}
    <textarea
      bind:this={textarea}
      class="nodrag nowheel"
      aria-label="Edit canvas text"
      value={data.text}
      maxlength={LIMITS.text}
      oninput={(event) => data.onEdit?.(event.currentTarget.value)}
      onblur={() => (editing = false)}
      onkeydown={(event) => {
        event.stopPropagation();
        if (
          event.key === "Escape" ||
          (event.key === "Enter" && (event.ctrlKey || event.metaKey))
        )
          editing = false;
      }}></textarea>
  {:else if data.preview}
    <div class="body">{data.text}</div>
  {:else}
    <div
      class="body"
      role="button"
      tabindex="0"
      title="Double-click or press Enter to edit canvas text."
      aria-disabled={!data.editable}
      ondblclick={edit}
      onkeydown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          edit();
        }
      }}
    >
      {data.text || "Double-click to write…"}
    </div>
  {/if}
  {#if data.status === "pending" && !data.preview}
    <div class="review nodrag nowheel" aria-label="Review canvas changes">
      <span>{data.changes} proposed changes</span>
      <button
        type="button"
        class="btn btn--primary"
        disabled={!data.editable}
        onkeydown={(event) => event.stopPropagation()}
        onclick={() => data.onResolve?.("apply")}>Apply</button
      >
      <button
        type="button"
        class="btn btn--soft"
        disabled={!data.editable}
        onkeydown={(event) => event.stopPropagation()}
        onclick={() => data.onResolve?.("discard")}>Discard</button
      >
    </div>
  {:else if data.status && data.status !== "complete" && !data.preview}
    <div class="caption" role="status">
      {data.status === "generating" ? "Generating…" : data.status}{data.error
        ? `: ${data.error}`
        : ""}
    </div>
    {#if data.role === "You" && ["failed", "cancelled", "interrupted"].includes(data.status)}
      <button
        type="button"
        class="btn btn--soft nodrag"
        disabled={!data.editable}
        onkeydown={(event) => event.stopPropagation()}
        onclick={data.onRetry}>Retry request</button
      >
    {/if}
  {/if}
  <Handle type="source" position={Position.Bottom} />
</div>

<style>
  .canvas-text {
    width: 100%;
    height: 100%;
    position: relative;
    color: var(--ink);
    text-align: left;
    padding: 8px;
    display: flex;
    flex-direction: column;
  }
  .body,
  textarea {
    font: inherit;
    font-size: 16px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    flex: 1;
    min-height: 0;
    overflow: auto;
    width: 100%;
  }
  .body {
    cursor: text;
    outline-offset: 4px;
    user-select: text;
  }
  textarea {
    resize: none;
    border: 1px solid var(--accent);
    border-radius: 4px;
    background: var(--surface);
    color: inherit;
    padding: 0;
  }
  .caption {
    font-size: 12px;
    line-height: 1.5;
    color: var(--ink-soft);
  }
  .preview {
    outline: 2px dashed var(--accent);
    background: var(--surface);
    opacity: 0.95;
    pointer-events: none;
  }
  .review {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding-top: 8px;
    font-size: 12px;
  }
  .review button {
    min-height: 36px;
  }
  .handles-hidden :global(.svelte-flow__handle) {
    opacity: 0;
    pointer-events: none;
  }
</style>
