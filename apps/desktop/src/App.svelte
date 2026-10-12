<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { LIMITS } from "@agentica/protocol";
  import { callRuntime, desktopMode, pingRuntime } from "./lib/runtime";
  import { Editor } from "./lib/editor";
  import { applyTheme, readTheme, type Theme } from "./lib/theme";
  import Composer from "./lib/components/Composer.svelte";
  import Icon from "./lib/components/Icon.svelte";
  import Settings from "./lib/components/Settings.svelte";
  import WorkspacePicker from "./lib/components/WorkspacePicker.svelte";
  import CanvasPicker from "./lib/components/CanvasPicker.svelte";
  import {
    Background,
    Controls,
    SvelteFlow,
    type Edge,
    type Node,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";

  const editor = new Editor(
    callRuntime,
    () => connectionKey.trim(),
    (next) => {
      editorState = next;
    },
  );
  let editorState = $state.raw(editor.state);
  let nodes = $state.raw<Node[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let viewport = $state.raw({ x: 0, y: 0, zoom: 1 });
  let selectedId = $state("");
  let connectionKey = $state("");
  let status = $state<"disconnected" | "connecting" | "connected" | "failed">(
    "disconnected",
  );
  let message = $state(
    desktopMode
      ? "Starting backend…"
      : "Start the backend and paste its connection key.",
  );
  let busy = $state(false);
  let inspectorOpen = $state(true);
  let settingsOpen = $state(false);
  let theme = $state<Theme>(readTheme());
  let recoveryCopy = $state("");
  let closeNotice = $state("");
  let alive = true;

  const stage = $derived(
    !editorState.workspace
      ? "workspace"
      : !editorState.document
        ? "canvas"
        : "editor",
  );
  const dark = $derived(theme === "dark");
  const connected = $derived(status === "connected");
  const working = $derived(editorState.busy || editorState.saving || busy);
  const canEdit = $derived(connected && !working);
  const canSave = $derived(
    connected && !working && editorState.dirty && !editorState.error,
  );
  const saveLabel = $derived(
    editorState.saving
      ? "Saving…"
      : editorState.error && editorState.dirty
        ? "Save failed"
        : editorState.dirty
          ? "Unsaved changes"
          : editorState.error
            ? "Operation failed"
            : "All changes saved",
  );
  const selected = $derived(
    editorState.document?.nodes.find((node) => node.id === selectedId),
  );
  const artifact = $derived(
    editorState.document?.artifacts.find(
      (item) => item.id === selected?.artifactId,
    ),
  );

  $effect(() => {
    const document = editorState.document;
    untrack(() => {
      nodes =
        document?.nodes.map((node, index) => ({
          ...nodes.find((item) => item.id === node.id),
          id: node.id,
          position: { x: node.x, y: node.y },
          width: node.width,
          height: node.height,
          data: {
            label:
              document.artifacts.find((item) => item.id === node.artifactId)
                ?.text || `Text ${index + 1}`,
          },
        })) ?? [];
      edges =
        document?.edges.map((edge) => ({
          id: edge.id,
          source: edge.sourceNodeId,
          target: edge.targetNodeId,
        })) ?? [];
      viewport = document?.canvas.viewport ?? { x: 0, y: 0, zoom: 1 };
      if (!document?.nodes.some((node) => node.id === selectedId))
        selectedId = document?.nodes[0]?.id ?? "";
    });
  });

  $effect(() => {
    const placements = nodes.map(({ id, position }) => ({ id, position }));
    untrack(() => {
      for (const { id, position } of placements) editor.placeNode(id, position);
    });
  });

  $effect(() => {
    applyTheme(theme);
  });

  async function checkConnection(connect = false) {
    if (busy) return;
    busy = true;
    if (connect) {
      status = "connecting";
      message = "Connecting to backend…";
    }
    try {
      await pingRuntime(connectionKey.trim(), connect);
      if (alive) {
        status = "connected";
        message = "Backend connected";
        if (connect) await editor.listWorkspaces();
      }
    } catch (error) {
      if (alive) {
        status = "failed";
        message =
          error instanceof TypeError
            ? "Backend unavailable. Start the backend, then reconnect."
            : typeof error === "string"
              ? error
              : error instanceof Error
                ? error.message
                : "Backend unavailable. Restart it, then reconnect.";
      }
    } finally {
      busy = false;
    }
  }

  /** Persist pending edits before navigation; false means they are still unsaved. */
  async function settle() {
    if (editorState.dirty && !editorState.error) await editor.save();
    return !editorState.dirty;
  }

  async function backToCanvases() {
    if (!(await settle())) return;
    await editor.closeCanvas();
  }

  async function backToWorkspaces() {
    if (editorState.document) {
      if (!(await settle())) return;
      await editor.closeCanvas();
    }
    if (editorState.workspace) await editor.closeWorkspace();
  }

  function beforeUnload(event: BeforeUnloadEvent) {
    if (!editorState.dirty && !editorState.saving) return;
    event.preventDefault();
    event.returnValue = "";
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    if (stage === "canvas") void backToWorkspaces();
  }

  onMount(() => {
    let unlisten: (() => void) | undefined;
    if (desktopMode) {
      void checkConnection(true);
      void getCurrentWindow()
        .onCloseRequested((event) => {
          if (editorState.dirty || editorState.saving) {
            event.preventDefault();
            closeNotice =
              "Keep this window open until changes are saved. Copy unsaved edits for recovery if saving fails.";
          }
        })
        .then((cleanup) => {
          if (alive) unlisten = cleanup;
          else cleanup();
        })
        .catch(() => {
          closeNotice =
            "Close protection is unavailable. Save or copy unsaved edits before closing this window.";
        });
    }
    const heartbeat = setInterval(() => {
      if (status === "connected") void checkConnection();
    }, 5000);
    return () => {
      alive = false;
      clearInterval(heartbeat);
      unlisten?.();
      editor.dispose();
    };
  });
</script>

<svelte:window onbeforeunload={beforeUnload} onkeydown={onKeydown} />

<div class="shell">
  {#if stage === "workspace"}
    <WorkspacePicker
      workspaces={editorState.workspaces}
      {status}
      {message}
      {desktopMode}
      bind:connectionKey
      {busy}
      error={editorState.error}
      onConnect={() => void checkConnection(true)}
      onRefresh={() => void editor.listWorkspaces()}
      onCreate={(name) => void editor.createWorkspace(name)}
      onOpen={(id) => void editor.openWorkspace(id)}
      onDelete={(id) => void editor.deleteWorkspace(id)}
      onOpenSettings={() => (settingsOpen = true)}
    />
  {:else if stage === "canvas"}
    <CanvasPicker
      workspaceName={editorState.workspace?.workspace.name ??
        "Unnamed workspace"}
      canvases={editorState.workspace?.canvases ?? []}
      busy={working}
      error={editorState.error}
      onCreate={(title) => void editor.createCanvas(title)}
      onOpen={(id) => void editor.openCanvas(id)}
      onDelete={(id) => void editor.deleteCanvas(id)}
      onBack={() => void backToWorkspaces()}
      onOpenSettings={() => (settingsOpen = true)}
    />
  {:else}
    <header class="topbar">
      <div class="topbar__lead">
        <span class="brand">
          <span class="brand__mark"><Icon name="blur_on" size={20} /></span>
          Agentica
        </span>
        <nav class="crumbs" aria-label="Breadcrumb">
          <button
            class="crumb"
            type="button"
            title="Switch workspace"
            disabled={working}
            onclick={() => void backToWorkspaces()}
          >
            <Icon name="workspaces" size={16} />
            {editorState.workspace?.workspace.name ?? "Workspace"}
          </button>
          <span class="crumbs__sep"
            ><Icon name="chevron_right" size={16} /></span
          >
          <span class="crumb crumb--current">
            {editorState.document?.canvas.title ?? "Canvas"}
          </span>
        </nav>
      </div>

      <div class="topbar__actions">
        <span
          class="pill"
          class:pill--ok={!editorState.dirty && !editorState.error}
          class:pill--warn={editorState.dirty && !editorState.error}
          class:pill--bad={!!editorState.error}
        >
          <span class="pill__dot"></span>{saveLabel}
        </span>
        <span class="topbar__divider"></span>
        <button
          class="icon-btn"
          type="button"
          title="Canvas gallery"
          aria-label="Canvas gallery"
          disabled={working}
          onclick={() => void backToCanvases()}
        >
          <Icon name="grid_view" size={20} />
        </button>
        <button
          class="icon-btn"
          class:icon-btn--active={inspectorOpen}
          type="button"
          title="Toggle inspector"
          aria-label="Toggle inspector"
          onclick={() => (inspectorOpen = !inspectorOpen)}
        >
          <Icon name="tune" size={20} />
        </button>
        <button
          class="icon-btn"
          type="button"
          title="Settings"
          aria-label="Settings"
          onclick={() => (settingsOpen = true)}
        >
          <Icon name="settings" size={20} />
        </button>
        <button
          class="btn btn--soft"
          type="button"
          disabled={!canEdit}
          onclick={() => void editor.addText()}
        >
          <Icon name="add_box" size={18} />
          Add text
        </button>
        <button
          class="btn btn--primary"
          type="button"
          disabled={!canSave}
          onclick={() => void editor.save()}
        >
          <Icon name="save" size={18} />
          Save
        </button>
      </div>
    </header>

    {#if editorState.error}
      <div class="banner banner--error" role="alert">
        <Icon name="error" size={18} />
        <span>
          {editorState.error}
          {editorState.dirty
            ? "Your edits are safe here — retry saving or copy them for recovery."
            : ""}
        </span>
        {#if editorState.document}
          <button
            class="btn btn--soft"
            type="button"
            disabled={!connected || working}
            onclick={() => void editor.retrySave()}
          >
            Retry save
          </button>
          <button
            class="btn btn--ghost"
            type="button"
            onclick={() => {
              recoveryCopy = editor.recovery();
            }}
          >
            Copy edits
          </button>
        {/if}
      </div>
    {/if}
    {#if closeNotice}
      <div class="banner banner--error" role="alert">
        <Icon name="warning" size={18} />
        <span>{closeNotice}</span>
      </div>
    {/if}

    <div class="stage">
      <main class="canvas" aria-label="Canvas workspace">
        {#key editorState.document?.canvas.id}
          <SvelteFlow
            bind:nodes
            bind:edges
            bind:viewport
            minZoom={LIMITS.minZoom}
            maxZoom={LIMITS.maxZoom}
            deleteKey={null}
            nodesConnectable={false}
            nodesDraggable={!editorState.busy}
            panOnDrag={!editorState.busy}
            zoomOnScroll={!editorState.busy}
            onnodeclick={({ node }) => {
              selectedId = node.id;
            }}
            onmove={(_, next) => editor.setViewport(next)}
          >
            <Background patternColor={dark ? "#2a2f52" : "#d7d9ec"} gap={24} />
            <Controls showLock={false} />
          </SvelteFlow>
        {/key}
        {#if editorState.document && editorState.document.nodes.length === 0}
          <div class="canvas__empty">
            <Icon name="note_add" size={34} />
            <p>This canvas is empty</p>
            <button
              class="btn btn--primary"
              type="button"
              disabled={!canEdit}
              onclick={() => void editor.addText()}
            >
              <Icon name="add_box" size={18} />
              Add your first text node
            </button>
          </div>
        {/if}

        <Composer />
      </main>

      {#if inspectorOpen && editorState.document}
        <aside class="inspector" aria-label="Inspector">
          <div class="inspector__head">
            <h2><Icon name="tune" size={18} />Inspector</h2>
            <button
              class="icon-btn"
              type="button"
              title="Hide inspector"
              aria-label="Hide inspector"
              onclick={() => (inspectorOpen = false)}
            >
              <Icon name="close" size={18} />
            </button>
          </div>

          <div class="field">
            <label for="text-node">Selected node</label>
            {#if editorState.document.nodes.length > 0}
              <select id="text-node" bind:value={selectedId}>
                {#each editorState.document.nodes as node, index (node.id)}
                  <option value={node.id}>Text {index + 1}</option>
                {/each}
              </select>
            {:else}
              <p class="muted">No nodes yet — use “Add text”.</p>
            {/if}
          </div>

          {#if selected && artifact}
            <div class="field">
              <label for="text-content">Text content</label>
              <textarea
                id="text-content"
                value={artifact.text}
                maxlength={LIMITS.text}
                disabled={editorState.busy}
                rows="7"
                placeholder="Write something…"
                oninput={(event) =>
                  editor.editText(artifact.id, event.currentTarget.value)}
              ></textarea>
            </div>
            <fieldset class="grid" disabled={editorState.busy}>
              <legend>Placement &amp; size</legend>
              {#each ["x", "y", "width", "height"] as field}
                {@const property = field as "x" | "y" | "width" | "height"}
                <label for={`node-${field}`}>{field}</label>
                <input
                  id={`node-${field}`}
                  type="number"
                  step="any"
                  min={field === "width" || field === "height"
                    ? LIMITS.minSize
                    : -LIMITS.coordinate}
                  max={field === "width" || field === "height"
                    ? LIMITS.maxSize
                    : LIMITS.coordinate}
                  value={selected[property]}
                  oninput={(event) => {
                    if (
                      event.currentTarget.validity.valid &&
                      event.currentTarget.value !== ""
                    )
                      editor.placeNode(selected.id, {
                        [property]: event.currentTarget.valueAsNumber,
                      });
                  }}
                />
              {/each}
            </fieldset>
          {/if}

          <!--
          <fieldset class="grid" disabled={editorState.busy}>
            <legend>Canvas view</legend>
            {#each ["x", "y", "zoom"] as field}
              {@const property = field as "x" | "y" | "zoom"}
              <label for={`view-${field}`}>View {field}</label>
              <input
                id={`view-${field}`}
                type="number"
                step="any"
                min={field === "zoom" ? LIMITS.minZoom : -LIMITS.coordinate}
                max={field === "zoom" ? LIMITS.maxZoom : LIMITS.coordinate}
                value={editorState.document.canvas.viewport[property]}
                oninput={(event) => {
                  if (
                    event.currentTarget.validity.valid &&
                    event.currentTarget.value !== ""
                  )
                    editor.setViewport({
                      ...editorState.document!.canvas.viewport,
                      [property]: event.currentTarget.valueAsNumber,
                    });
                }}
              />
            {/each}
          </fieldset>
          -->
        </aside>
      {/if}
    </div>

    {#if recoveryCopy}
      <div class="recovery">
        <label for="recovery-copy"
          >Recovery copy — select all and copy to a local file</label
        >
        <textarea
          id="recovery-copy"
          readonly
          value={recoveryCopy}
          rows="4"
          onfocus={(event) => event.currentTarget.select()}></textarea>
        <button
          class="btn btn--ghost"
          type="button"
          onclick={() => {
            recoveryCopy = "";
          }}
        >
          <Icon name="close" size={18} />Hide
        </button>
      </div>
    {/if}
  {/if}

  {#if settingsOpen}
    <Settings
      {theme}
      onChange={(next) => (theme = next)}
      onClose={() => (settingsOpen = false)}
    />
  {/if}
</div>
