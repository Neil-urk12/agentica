<script lang="ts">
  import { Handle, NodeResizer, Position } from "@xyflow/svelte";
  import { LIMITS, type Task, type TextStyle } from "@agentica/protocol";
  import { fitTextField, turnStatus } from "../canvas-view";
  import Icon from "./Icon.svelte";
  import Markdown from "./Markdown.svelte";
  import Select from "./Select.svelte";

  // Body sizes; `m` matches the default --type-body, Markdown headings scale in em.
  const SIZE_PX = { s: "12px", m: "14px", l: "18px", xl: "24px" } as const;

  interface Props {
    selected?: boolean;
    data: {
      text: string;
      purpose?: string;
      style?: TextStyle;
      role?: "You" | "Agent";
      status?: string;
      error?: string;
      preview?: boolean;
      connectable?: boolean;
      /** An arrow or task context wire ends at this node. */
      linked?: boolean;
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
        /** Live assignee output age; "" when hidden. Not a task state. */
        outputAge: string;
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
  const turnState = $derived(data.role && turnStatus(data.status, data.role));
  // A tracked task carries controls, so it gets a card instead of floating text.
  const todo = $derived(data.preview ? null : (data.task?.task ?? null));
  // One name for the head, screen reader labels and the edit box.
  const label = $derived(
    kind === "prompt"
      ? "You"
      : kind === "reply"
        ? "Agent"
        : kind === "instruction"
          ? "Instruction note"
          : todo
            ? todo.done
              ? "Done task"
              : "Task"
            : "Text",
  );
  const framed = $derived(kind !== "text" || !!data.preview || !!todo);
  // Only plain notes take a style; cards keep their role treatment.
  const look = $derived(kind === "text" && !todo ? data.style : undefined);
  // Plain text shows its box unless it is a lone heading (a canvas title);
  // a wired title is outlined too, so its wires end on a visible edge.
  const title = $derived(/^ {0,3}#{1,6}[ \t]+\S.*$/.test(data.text.trim()));
  const outlined = $derived(!framed && (!title || !!data.linked));
  const stop = (event: KeyboardEvent) => event.stopPropagation();

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
  class:canvas-text--task={!!todo}
  class:canvas-text--outlined={outlined}
  class:is-done={todo?.done}
  class:preview={data.preview}
  class:handles-hidden={!data.connectable}
  style:color={look?.color && look.color !== "default"
    ? `var(--text-${look.color})`
    : undefined}
  style:--type-body={look?.size ? SIZE_PX[look.size] : undefined}
  style:font-weight={look?.weight === "bold" ? "700" : undefined}
  style:text-align={look?.align && look.align !== "start"
    ? look.align
    : undefined}
>
  <Handle type="target" position={Position.Top} />
  {#if framed}
    <div class="card-head">
      {#if data.preview}<span class="chip chip--proposal">Proposed</span>{/if}
      {#if todo && data.task}
        <input
          class="task-check nodrag"
          type="checkbox"
          aria-label="Done"
          title={todo.done ? "Mark not done" : "Mark done"}
          checked={todo.done}
          disabled={data.task.busy || !data.editable}
          onkeydown={stop}
          onchange={(event) => data.task?.onDone(event.currentTarget.checked)}
        />
      {/if}
      <span class="card-role">
        {#if kind === "instruction"}<Icon name="sticky_note_2" size={14} />{/if}
        {todo ? (todo.done ? "Done" : "Task") : label}
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
      {#if todo && data.task}
        <button
          class="card-action nodrag"
          type="button"
          title="Stop tracking as a task (keeps the text)"
          aria-label="Remove task"
          disabled={data.task.busy || !data.editable}
          onkeydown={stop}
          onclick={() => data.task?.onMark(false)}
          ><Icon name="close" size={16} /></button
        >
      {/if}
    </div>
  {/if}
  <!-- "Read more" overlays the faded bottom instead of taking its own row. -->
  <div class="card-clip">
    {#if editing && !data.preview}
      <textarea
        bind:this={textarea}
        class="card-body nodrag nowheel"
        aria-label={`Edit ${label.toLowerCase()} text`}
        value={data.text}
        maxlength={LIMITS.text}
        readonly={!data.editable}
        oninput={(event) => data.onEdit?.(fitTextField(event.currentTarget))}
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
      <div class="card-body" class:clipped={overflowing} bind:this={body}>
        <Markdown source={data.text} />
      </div>
    {:else}
      <div
        bind:this={body}
        class="card-body"
        class:clipped={overflowing}
        class:nodrag={framed && !todo}
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
          onkeydown={stop}
          onclick={data.onRead}>Read more</button
        >
      {/if}
    {/if}
  </div>
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
        onkeydown={stop}
      >
        <Select
          class="task-assignee"
          label="Assigned agent tile"
          value={t.assignees.some((a) => a.id === t.task?.assignedTileId)
            ? (t.task.assignedTileId ?? "")
            : ""}
          options={[
            { value: "", label: "Unassigned" },
            ...t.assignees.map((a) => ({ value: a.id, label: a.label })),
          ]}
          disabled={t.busy || !data.editable}
          onchange={(value) => t.onAssign(value || null)}
        />
        <button
          class="btn btn--soft task-send"
          type="button"
          disabled={!!t.blocker || t.busy || !data.editable}
          title={t.blocker ||
            "Preview the text, then paste it without pressing Enter"}
          onclick={t.onSend}><Icon name="send" size={14} /> Send</button
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
        <Select
          class="task-context-add"
          label="Add context"
          placeholder="Add context"
          value=""
          options={t.contextOptions.map((o) => ({
            value: o.id,
            label: o.label,
          }))}
          disabled={t.busy ||
            !data.editable ||
            t.context.length >= LIMITS.taskContext ||
            t.contextOptions.length === 0}
          title={t.context.length >= LIMITS.taskContext
            ? `A task can have at most ${LIMITS.taskContext} context items.`
            : "Paste a note or file text after the task text when sending"}
          onchange={(id) => t.onAddContext(id)}
        />
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
      {:else if t.outputAge}
        <p class="task-status">{t.outputAge}</p>
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
