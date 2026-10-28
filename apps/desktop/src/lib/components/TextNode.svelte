<script lang="ts">
  import { Handle, NodeResizer, Position } from "@xyflow/svelte";
  import { LIMITS, type Task } from "@agentica/protocol";
  import { turnStatus } from "../canvas-view";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";

  interface Props {
    selected?: boolean;
    data: {
      text: string;
      purpose?: string;
      role?: "You" | "Agent";
      status?: string;
      error?: string;
      preview?: boolean;
      connectable?: boolean;
      editable?: boolean;
      onEdit?: (text: string) => void;
      onResize?: (width: number, height: number) => void;
      onRetry?: () => void;
      onRead?: () => void;
      /** Present on plain text nodes that can be tasks; all labels are factual. */
      task?: {
        task: Task | null;
        assignees: { id: string; label: string }[];
        sent: string;
        edited: boolean;
        contextChanged: boolean;
        context: { id: string; label: string }[];
        contextOptions: { id: string; label: string }[];
        onAddContext: (nodeId: string) => void;
        onRemoveContext: (nodeId: string) => void;
        attention: string;
        blocker: string;
        busy: boolean;
        error: string;
        onMark: (enabled: boolean) => void;
        onDone: (done: boolean) => void;
        onAssign: (tileId: string | null) => void;
        onSend: () => void;
        onRetry?: () => void;
      };
    };
  }
  let { data, selected = false }: Props = $props();
  let editing = $state(false);
  let textarea = $state<HTMLTextAreaElement>();
  let body = $state<HTMLElement>();
  let overflowing = $state(false);

  const kind = $derived(
    data.role === "You"
      ? "prompt"
      : data.role === "Agent"
        ? "reply"
        : data.purpose === "instruction"
          ? "instruction"
          : "text",
  );
  const label = $derived(
    kind === "prompt"
      ? "You"
      : kind === "reply"
        ? "Agent"
        : kind === "instruction"
          ? "Instruction note"
          : "Text",
  );
  const turnState = $derived(data.role && turnStatus(data.status, data.role));
  const framed = $derived(kind !== "text" || !!data.preview);

  function edit() {
    if (!data.editable || data.preview) return;
    editing = true;
    requestAnimationFrame(() => textarea?.focus());
  }

  // Overflow is measured from layout boxes, which canvas zoom does not
  // change; detection never alters the node's saved or proposed geometry.
  $effect(() => {
    const element = body;
    void data.text;
    if (!element) return;
    const check = () => {
      overflowing = element.scrollHeight > element.clientHeight + 1;
    };
    const frame = requestAnimationFrame(check);
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  });
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
  class={`canvas-text canvas-text--${kind}`}
  class:canvas-text--framed={framed}
  class:preview={data.preview}
  class:handles-hidden={!data.connectable}
>
  <Handle type="target" position={Position.Top} />
  {#if framed}
    <div class="card-head">
      {#if data.preview}<span class="chip chip--proposal">Proposed</span>{/if}
      <span class="card-role">
        {#if kind === "instruction"}<Icon name="sticky_note_2" size={14} />{/if}
        {label}
      </span>
      {#if turnState}
        <span class={`chip chip--${turnState.tone}`} role="status"
          >{turnState.label}</span
        >
      {/if}
      {#if data.onRead && !data.preview}
        <button
          class="card-action nodrag"
          type="button"
          title="Read full content"
          aria-label={`Read full ${label.toLowerCase()} content`}
          onkeydown={(event) => event.stopPropagation()}
          onclick={data.onRead}
        >
          <Icon name="open_in_full" size={16} />
        </button>
      {/if}
    </div>
  {/if}
  {#if editing && !data.preview}
    <textarea
      bind:this={textarea}
      class="card-body nodrag nowheel"
      aria-label={`Edit ${label.toLowerCase()} text`}
      value={data.text}
      maxlength={LIMITS.text}
      readonly={!data.editable}
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
    <div class="card-body" bind:this={body}>
      <Markdown source={data.text} />
    </div>
  {:else}
    <div
      bind:this={body}
      class="card-body"
      class:nodrag={framed}
      role="button"
      tabindex="0"
      title="Double-click or press Enter to edit the source text."
      aria-label={`${label}: ${data.text.slice(0, 160) || "empty"}`}
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
      {#if data.text}
        <Markdown source={data.text} />
      {:else}
        <span class="card-placeholder">Double-click to write…</span>
      {/if}
    </div>
  {/if}
  {#if overflowing && !editing}
    {#if data.preview}
      <span class="card-more">More · see Proposed text</span>
    {:else if data.onRead}
      <button
        class="card-more nodrag"
        type="button"
        onkeydown={(event) => event.stopPropagation()}
        onclick={data.onRead}>Read more</button
      >
    {/if}
  {/if}
  {#if data.role === "You" && data.status && ["failed", "cancelled", "interrupted"].includes(data.status) && !data.preview}
    {#if data.error}<p class="card-error">{data.error}</p>{/if}
    <button
      type="button"
      class="btn btn--soft nodrag card-retry"
      disabled={!data.editable}
      onkeydown={(event) => event.stopPropagation()}
      onclick={data.onRetry}>Retry request</button
    >
  {/if}
  {#if data.task && !data.preview}
    {@const t = data.task}
    {#if t.task}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="task-bar nodrag"
        role="group"
        aria-label="Task"
        onkeydown={(event) => event.stopPropagation()}
      >
        <label class="task-done">
          <input
            type="checkbox"
            checked={t.task.done}
            disabled={t.busy || !data.editable}
            onchange={(event) => t.onDone(event.currentTarget.checked)}
          />
          Done
        </label>
        <select
          class="task-assignee"
          aria-label="Assigned agent tile"
          value={t.task.assignedTileId ?? ""}
          disabled={t.busy || !data.editable}
          onchange={(event) => t.onAssign(event.currentTarget.value || null)}
        >
          <option value="">Unassigned</option>
          {#each t.assignees as assignee (assignee.id)}
            <option value={assignee.id}>{assignee.label}</option>
          {/each}
        </select>
        <button
          class="btn btn--soft task-send"
          type="button"
          disabled={!!t.blocker || t.busy || !data.editable}
          title={t.blocker ||
            "Preview the text, then paste it without pressing Enter"}
          onclick={t.onSend}><Icon name="send" size={14} /> Send</button
        >
        <button
          class="card-action"
          type="button"
          title="Stop tracking as a task (keeps the text)"
          aria-label="Remove task"
          disabled={t.busy || !data.editable}
          onclick={() => t.onMark(false)}
          ><Icon name="close" size={14} /></button
        >
      </div>
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="task-context nodrag"
        role="group"
        aria-label="Task context"
        onkeydown={(event) => event.stopPropagation()}
      >
        {#each t.context as item (item.id)}
          <span class="task-context-chip">
            <span class="task-context-label" title={item.label}
              >{item.label}</span
            >
            <button
              class="card-action"
              type="button"
              title="Remove from context"
              aria-label={`Remove ${item.label} from context`}
              disabled={t.busy || !data.editable}
              onclick={() => t.onRemoveContext(item.id)}
              ><Icon name="close" size={12} /></button
            >
          </span>
        {/each}
        <select
          class="task-context-add"
          aria-label="Add context"
          value=""
          disabled={t.busy ||
            !data.editable ||
            t.context.length >= LIMITS.taskContext ||
            t.contextOptions.length === 0}
          title={t.context.length >= LIMITS.taskContext
            ? `A task can have at most ${LIMITS.taskContext} context items.`
            : "Paste a note or file text after the task text when sending"}
          onchange={(event) => {
            const id = event.currentTarget.value;
            event.currentTarget.value = "";
            if (id) t.onAddContext(id);
          }}
        >
          <option value="">Add context</option>
          {#each t.contextOptions as option (option.id)}
            <option value={option.id}>{option.label}</option>
          {/each}
        </select>
      </div>
      {#if t.sent || t.edited || t.contextChanged || (t.blocker && t.task.assignedTileId)}
        <p class="task-status" role="status">
          {[
            t.sent,
            t.edited ? "Edited since sent" : "",
            t.contextChanged ? "Context changed since sent" : "",
            t.task.assignedTileId ? t.blocker : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      {/if}
      {#if t.attention}
        <p class="task-attention" role="status">
          <Icon name="notifications" size={14} />{t.attention}
        </p>
      {/if}
    {:else if selected && data.editable}
      <button
        class="btn btn--soft task-mark nodrag"
        type="button"
        disabled={t.busy}
        onkeydown={(event) => event.stopPropagation()}
        onclick={() => t.onMark(true)}
        ><Icon name="task_alt" size={14} /> Make task</button
      >
    {/if}
    {#if t.error}
      <p class="card-error" role="alert">
        {t.error}
        {#if t.onRetry}
          <button
            class="btn btn--soft nodrag"
            type="button"
            disabled={t.busy}
            onkeydown={(event) => event.stopPropagation()}
            onclick={t.onRetry}>Retry recording</button
          >
        {/if}
      </p>
    {/if}
  {/if}
  <Handle type="source" position={Position.Bottom} />
</div>
