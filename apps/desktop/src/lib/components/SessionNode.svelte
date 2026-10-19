<script lang="ts">
  import { NodeResizeControl } from "@xyflow/svelte";
  import type {
    ProjectGroup,
    SessionOwner,
    SessionTile,
  } from "@agentica/protocol";
  import type { SessionManager } from "../sessions";
  import Icon from "./Icon.svelte";
  import { attentionLabel, waitedLabel } from "../session-attention";
  import { clock } from "../clock.svelte";
  interface Props {
    data: {
      kind: "session";
      tile: SessionTile;
      group: ProjectGroup;
      owner: SessionOwner;
      manager: SessionManager;
      revision: number;
      editable: boolean;
      onRemove: () => void;
      onRefresh: () => void;
      onResize: (width: number, height: number) => void;
    };
    selected?: boolean;
  }
  let { data, selected = false }: Props = $props();
  let header: HTMLElement;
  const view = $derived.by(() => {
    void data.revision;
    return data.manager.view(data.owner);
  });
  const phase = $derived(view.status?.state ?? "stopped");
  const live = $derived(["starting", "running", "stopping"].includes(phase));
  const title = $derived(data.tile.kind === "cli-agent" ? "Codex" : "Terminal");
  const available = $derived.by(() => {
    void data.revision;
    const capabilities = data.manager.capabilities?.capabilities;
    if (!capabilities) return "Connect to check native session availability.";
    const executable =
      data.tile.kind === "cli-agent" ? capabilities.codex : capabilities.shell;
    if (!capabilities.supported || !executable.path)
      return executable.reason ?? "Native sessions are unavailable.";
    if (!data.group.available)
      return "Locate the project folder before starting.";
    return "";
  });
  const attention = $derived(
    view.status?.attention.raised ? view.status : null,
  );
  const failed = $derived(attention?.attention.kind === "failed");
  const exitedAttention = $derived(attention?.attention.kind === "exited");
  const waiting = $derived(!!attention);
  // Waited time ticks only while attention is raised on this tile.
  $effect(() => {
    if (waiting) return clock.hold();
  });
  const maxWidth = $derived(data.group.width - data.tile.x - 16);
  const maxHeight = $derived(data.group.height - data.tile.y - 16);
  function terminal(element: HTMLDivElement) {
    return {
      destroy: data.manager.mount(data.owner, element, () => header.focus()),
    };
  }
  function resizeKey(event: KeyboardEvent) {
    const step = event.shiftKey ? 64 : 16;
    let { width, height } = data.tile;
    if (event.key === "ArrowRight") width += step;
    else if (event.key === "ArrowLeft") width -= step;
    else if (event.key === "ArrowDown") height += step;
    else if (event.key === "ArrowUp") height -= step;
    else return;
    event.preventDefault();
    event.stopPropagation();
    data.onResize(
      Math.max(Math.min(500, maxWidth), width),
      Math.max(Math.min(400, maxHeight), height),
    );
  }
</script>

<section
  class="session"
  class:attention={!!attention}
  class:failed
  aria-label={`${title} in ${data.group.label}`}
>
  <header
    class="session-drag"
    data-terminal-controls
    tabindex="-1"
    bind:this={header}
    aria-label={`${title} controls`}
  >
    <div class="session-title">
      <Icon
        name={data.tile.kind === "cli-agent" ? "smart_toy" : "terminal"}
        size={18}
      /><strong>{title}</strong><span class="project-name"
        >{data.group.label}</span
      ><span class="state" role="status">{phase}</span>
    </div>
    <div
      class="session-controls nodrag"
      role="group"
      aria-label="Process controls"
    >
      {#if !live}<button
          class="btn btn--soft"
          type="button"
          disabled={!!available || view.busy || !data.manager.connected}
          title={available || `Start ${title}`}
          onclick={() => void data.manager.start(data.owner)}>Start</button
        >{/if}
      {#if live}<button
          class="btn btn--soft"
          type="button"
          disabled={!data.manager.connected}
          onclick={() => void data.manager.stop(data.owner)}>Stop</button
        >{/if}
      <button
        class="btn btn--soft"
        type="button"
        disabled={!!available ||
          view.busy ||
          !view.status ||
          !data.manager.connected}
        onclick={() => void data.manager.start(data.owner, true)}
        >Restart</button
      >
      <button
        class="btn btn--soft"
        type="button"
        disabled={!view.connected || phase !== "running"}
        onclick={() => data.manager.focus(data.owner)}>Focus terminal</button
      >
      <button
        class="btn btn--soft"
        type="button"
        disabled={!view.connected || phase !== "running"}
        title="Ask the program to repaint its current screen. Lost output history is not restored."
        onclick={() => void data.manager.redraw(data.owner)}>Redraw</button
      >
      <button
        class="icon-btn"
        type="button"
        aria-label="Refresh session status"
        onclick={data.onRefresh}><Icon name="sync" size={17} /></button
      >
      <button
        class="icon-btn"
        type="button"
        aria-label={`Remove ${title} tile`}
        disabled={!data.editable}
        onclick={data.onRemove}><Icon name="delete_outline" size={17} /></button
      >
    </div>
  </header>
  {#if data.tile.kind === "cli-agent"}
    <details class="session-notice nodrag nopan nowheel">
      <summary>Codex notification setup</summary>
      <p>
        Add these settings to your Codex configuration (normally <code
          >~/.codex/config.toml</code
        >):
      </p>
      <pre><code
          >{`[tui]
notifications = true
notification_method = "osc9"
notification_condition = "always"`}</code
        ></pre>
      <p>
        These global settings also affect Codex in other terminals, including
        notifications while focused there. Agentica suppresses attention while
        its terminal is focused.
      </p>
    </details>
  {/if}
  {#if available && !live}<p class="session-notice" role="status">
      {available}
    </p>{/if}
  {#if view.error || view.status?.error}<p class="session-notice" role="alert">
      {view.error || view.status?.error}
    </p>{/if}
  {#if view.historyGap}<p class="session-notice">
      Earlier output is unavailable. Redraw refreshes the current screen, not
      lost history.
    </p>{/if}
  {#if phase === "exited" && !exitedAttention}<p class="session-notice">
      Stopped{view.status?.exitSignal
        ? ` (signal ${view.status.exitSignal})`
        : view.status?.exitCode != null
          ? ` (exit code ${view.status.exitCode})`
          : ""}.
    </p>{/if}
  {#if view.status?.shellFallback}<p class="session-notice">
      Using the /bin/sh fallback.
    </p>{/if}
  <div
    class="terminal-body nodrag nopan nowheel"
    data-terminal
    role="application"
    aria-label={`${title} terminal; Ctrl Shift Escape returns to controls`}
    use:terminal
  ></div>
  {#if attention}
    {@const reason = attentionLabel(attention)}
    {@const waited = waitedLabel(attention.attention.at, clock.now)}
    <div class="attention-strip nodrag" data-terminal-controls>
      <span class="dot" aria-hidden="true"></span>
      <span class="reason" title={reason}>{reason}</span>
      {#if waited && attention.attention.at !== null}<time
          datetime={new Date(attention.attention.at).toISOString()}
          >{waited}</time
        >{/if}
      <button
        class="btn btn--soft"
        type="button"
        aria-label={`Mark ${title} in ${data.group.label} as seen`}
        onclick={() => void data.manager.dismiss(data.owner)}>Mark seen</button
      >
    </div>
  {/if}
  <footer>
    Ctrl+Shift+Esc returns to controls · Ctrl+Shift+C copies selection
  </footer>
  {#if selected && data.editable}
    <NodeResizeControl
      position="bottom-right"
      minWidth={Math.min(500, maxWidth)}
      minHeight={Math.min(400, maxHeight)}
      {maxWidth}
      {maxHeight}
      onResizeEnd={(_, dimensions) =>
        data.onResize(dimensions.width, dimensions.height)}
    >
      <button
        class="resize-grip nodrag"
        type="button"
        aria-label="Resize session tile; arrow keys adjust size"
        title="Resize session tile; arrow keys adjust size"
        onkeydown={resizeKey}>↘</button
      >
    </NodeResizeControl>
  {/if}
</section>

<style>
  .session {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    overflow: hidden;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-sm);
  }
  .session-drag {
    padding: 8px 10px;
    cursor: grab;
    background: var(--surface);
    border-bottom: 1px solid var(--line-strong);
    flex: none;
  }
  .session-title {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
    font-size: 13px;
  }
  .project-name {
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }
  .state {
    font-size: 12px;
    text-transform: capitalize;
    color: var(--ink-soft);
  }
  .session-controls {
    display: flex;
    gap: 5px;
    align-items: center;
    margin-top: 6px;
    flex-wrap: wrap;
    cursor: default;
  }
  .btn {
    padding: 3px 7px;
    font-size: 12px;
    min-height: 28px;
  }
  .icon-btn {
    width: 28px;
    height: 28px;
  }
  .terminal-body {
    flex: 1;
    min-height: 0;
    padding: 8px;
    background: #0d1117;
    overflow: hidden;
  }
  .terminal-body:focus-within {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  .session-notice {
    margin: 0;
    padding: 5px 10px;
    background: var(--surface-soft);
    color: var(--ink-soft);
    font-size: 12px;
    line-height: 17px;
    flex: none;
  }
  details.session-notice {
    max-height: 180px;
    overflow: auto;
  }
  summary {
    cursor: pointer;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    user-select: text;
  }
  /* Attention: amber ring plus a strip under the terminal. The strip sits
     outside .terminal-body, so the body's ResizeObserver refits xterm. */
  .session.attention {
    border-color: var(--warn);
    box-shadow:
      0 0 0 2px var(--warn),
      var(--shadow-sm);
    animation: attention-pulse 900ms ease-out 1;
  }
  .session.attention.failed {
    border-color: var(--bad);
    box-shadow:
      0 0 0 2px var(--bad),
      var(--shadow-sm);
    animation-name: attention-pulse-bad;
  }
  @keyframes attention-pulse {
    30% {
      box-shadow:
        0 0 0 6px color-mix(in srgb, var(--warn) 30%, transparent),
        var(--shadow-sm);
    }
  }
  @keyframes attention-pulse-bad {
    30% {
      box-shadow:
        0 0 0 6px color-mix(in srgb, var(--bad) 30%, transparent),
        var(--shadow-sm);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .session.attention,
    .session.attention.failed {
      animation: none;
    }
  }
  .attention-strip {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 2px 6px 2px 10px;
    box-sizing: border-box;
    background: var(--warn-soft);
    border-top: 1px solid var(--warn-line);
    cursor: default;
  }
  .failed .attention-strip {
    background: var(--bad-soft);
    border-top-color: var(--bad-line);
  }
  .attention-strip .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: none;
    background: var(--warn);
  }
  .failed .attention-strip .dot {
    background: var(--bad);
  }
  .attention-strip .reason {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .attention-strip time {
    flex: none;
    font-size: 12px;
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .attention-strip .btn {
    flex: none;
    background: var(--surface);
  }
  footer {
    padding: 4px 10px;
    font-size: 11px;
    line-height: 16px;
    color: var(--ink-soft);
    background: var(--surface);
    flex: none;
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
