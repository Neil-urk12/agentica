<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { TaskView } from "../agent-task.ts";

  interface Props {
    data: { task: TaskView; onDismiss?: () => void };
  }
  let { data }: Props = $props();
  const task = $derived(data.task);
  const icon: Record<TaskView["state"], string> = {
    working: "autorenew",
    review: "rate_review",
    applied: "task_alt",
    discarded: "block",
    replied: "chat",
    failed: "error",
    cancelled: "cancel",
    interrupted: "pause_circle",
  };
  const stepIcon = { edit: "check_small", rejected: "close", note: "notes" };
</script>

<section
  class={`task task--${task.state}`}
  aria-label={`Agent task: ${task.goal}`}
  aria-busy={task.state === "working"}
>
  <header class="task__head">
    <span class="card-role"><Icon name="checklist" size={14} /> Task</span>
    {#if data.onDismiss}
      <button
        class="card-action nodrag"
        type="button"
        title="Hide this task"
        aria-label="Hide this task"
        onkeydown={(event) => event.stopPropagation()}
        onclick={data.onDismiss}><Icon name="close" size={16} /></button
      >
    {/if}
  </header>
  <p class="task__goal" title={task.goal}>{task.goal}</p>
  <p class="task__status" role="status" aria-live="polite">
    <span class="task__status-icon" class:task__spin={task.state === "working"}
      ><Icon name={icon[task.state]} size={16} /></span
    >
    <span>{task.headline}</span>
  </p>
  {#if task.steps.length}
    <ol class="task__steps nowheel">
      {#each task.steps as step, index (index)}
        <li class={`task__step task__step--${step.kind}`}>
          <span class="task__step-icon" aria-hidden="true"
            ><Icon name={stepIcon[step.kind]} size={14} /></span
          >
          <span class="sr-only"
            >{step.kind === "edit"
              ? "Staged:"
              : step.kind === "rejected"
                ? "Rejected:"
                : "Agent note:"}</span
          >
          <span class="task__step-text">{step.text}</span>
        </li>
      {/each}
    </ol>
  {:else if task.state === "working"}
    <p class="task__empty">No canvas edits yet.</p>
  {/if}
  {#if !task.live && task.state !== "working" && task.steps.length}
    <p class="task__footnote">Rebuilt from the saved proposal.</p>
  {/if}
</section>
