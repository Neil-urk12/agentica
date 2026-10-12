<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { LIMITS } from "@agentica/protocol";
  import { callRuntime, desktopMode, pingRuntime } from "./lib/runtime";
  import { Editor } from "./lib/editor";
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
  let workspaceName = $state("");
  let canvasTitle = $state("");
  let workspaceId = $state("");
  let canvasId = $state("");
  let recoveryCopy = $state("");
  let closeNotice = $state("");
  let alive = true;
  const locked = $derived(
    editorState.busy ||
      editorState.saving ||
      editorState.dirty ||
      status !== "connected",
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

  function beforeUnload(event: BeforeUnloadEvent) {
    if (!editorState.dirty && !editorState.saving) return;
    event.preventDefault();
    event.returnValue = "";
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

<svelte:window onbeforeunload={beforeUnload} />

<div class="app-shell">
  <header>
    <strong class="brand">agentica</strong>
    <h1>{editorState.document?.canvas.title ?? "Canvas workspace"}</h1>
    <form
      class="connection"
      onsubmit={(event) => {
        event.preventDefault();
        void checkConnection(true);
      }}
    >
      <span>{desktopMode ? "Desktop" : "Browser"} mode</span>
      {#if !desktopMode}
        <label class="sr-only" for="connection-key"
          >Backend connection key</label
        >
        <input
          id="connection-key"
          type="password"
          bind:value={connectionKey}
          maxlength="64"
          placeholder="Backend connection key"
          autocomplete="off"
          spellcheck="false"
        />
      {/if}
      <button
        type="submit"
        disabled={busy ||
          editorState.busy ||
          editorState.saving ||
          (!desktopMode && !connectionKey.trim())}
      >
        {status === "connecting"
          ? "Connecting…"
          : status === "disconnected"
            ? "Connect"
            : "Reconnect"}
      </button>
    </form>
  </header>
  <div
    role="status"
    aria-live="polite"
    class="notice"
    class:error={status === "failed"}
  >
    {message}
  </div>
  <div class="workspace-controls">
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void editor.createWorkspace(workspaceName);
      }}
    >
      <label for="workspace-name">New workspace</label>
      <input
        id="workspace-name"
        bind:value={workspaceName}
        required
        maxlength={LIMITS.label}
      />
      <button disabled={locked || !workspaceName.trim()}
        >Create workspace</button
      >
    </form>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void editor.openWorkspace(workspaceId);
      }}
    >
      <label for="workspace-list">Saved workspace</label>
      <select id="workspace-list" bind:value={workspaceId} disabled={locked}>
        <option value="">Choose a workspace</option>
        {#each editorState.workspaces as workspace}
          <option value={workspace.id}
            >{workspace.name ??
              `Unreadable workspace (${workspace.id})`}</option
          >
        {/each}
      </select>
      <button disabled={locked || !workspaceId}>Open workspace</button>
      <button
        type="button"
        disabled={locked}
        onclick={() => void editor.listWorkspaces()}>Refresh list</button
      >
    </form>
    {#if editorState.workspace}
      <span
        >Workspace: <strong>{editorState.workspace.workspace.name}</strong
        ></span
      >
      <button disabled={locked} onclick={() => void editor.closeWorkspace()}
        >Close workspace</button
      >
      <form
        onsubmit={(event) => {
          event.preventDefault();
          void editor.createCanvas(canvasTitle);
        }}
      >
        <label for="canvas-title">New canvas</label>
        <input
          id="canvas-title"
          bind:value={canvasTitle}
          required
          maxlength={LIMITS.label}
        />
        <button disabled={locked || !canvasTitle.trim()}>Create canvas</button>
      </form>
      <form
        onsubmit={(event) => {
          event.preventDefault();
          void editor.openCanvas(canvasId);
        }}
      >
        <label for="canvas-list">Saved canvas</label>
        <select id="canvas-list" bind:value={canvasId} disabled={locked}>
          <option value="">Choose a canvas</option>
          {#each editorState.workspace.canvases as canvas}
            <option value={canvas.id}>{canvas.title}</option>
          {/each}
        </select>
        <button disabled={locked || !canvasId}>Open canvas</button>
      </form>
    {/if}
  </div>
  <div class="save-controls">
    <span role="status" aria-live="polite">
      {editorState.saving
        ? "Saving…"
        : editorState.error && editorState.dirty
          ? "Unsaved changes — save failed"
          : editorState.dirty
            ? "Unsaved changes"
            : editorState.error
              ? "Operation failed — check the error below"
              : editorState.document
                ? "Saved"
                : "Open or create a workspace and canvas to begin."}
    </span>
    {#if editorState.document}
      <button disabled={locked} onclick={() => void editor.addText()}
        >Add text</button
      >
      <button
        disabled={editorState.busy ||
          editorState.saving ||
          !editorState.dirty ||
          !!editorState.error ||
          status !== "connected"}
        onclick={() => void editor.save()}>Save now</button
      >
      {#if editorState.error}
        <button
          disabled={editorState.busy ||
            editorState.saving ||
            status !== "connected"}
          onclick={() => void editor.retrySave()}>Retry save</button
        >
      {/if}
      <button
        onclick={() => {
          recoveryCopy = editor.recovery();
        }}>Copy unsaved edits</button
      >
    {/if}
  </div>
  {#if editorState.error}<p role="alert" class="notice error">
      {editorState.error}
      {editorState.dirty
        ? "Your edits remain here; retry saving or copy them for recovery."
        : ""}
    </p>{/if}
  {#if closeNotice}<p role="alert" class="notice error">{closeNotice}</p>{/if}
  {#if recoveryCopy}
    <div class="recovery">
      <label for="recovery-copy"
        >Recovery copy (select all and copy to a local file)</label
      >
      <textarea
        id="recovery-copy"
        readonly
        value={recoveryCopy}
        rows="4"
        onfocus={(event) => event.currentTarget.select()}></textarea>
      <button
        onclick={() => {
          recoveryCopy = "";
        }}>Hide recovery copy</button
      >
    </div>
  {/if}
  <main aria-label="Canvas workspace">
    <div class="canvas">
      {#if editorState.document}
        {#key editorState.document.canvas.id}
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
            <Background patternColor="#cbd5e1" gap={24} />
            <Controls showLock={false} />
          </SvelteFlow>
        {/key}
      {:else}
        <div class="empty">
          <p>Room to think.</p>
          <span>Create or open a canvas to start editing.</span>
        </div>
      {/if}
    </div>
    {#if editorState.document}
      <aside aria-label="Text and canvas editor">
        <label for="text-node">Text node</label>
        <select id="text-node" bind:value={selectedId}>
          {#each editorState.document.nodes as node, index}<option
              value={node.id}>Text {index + 1}</option
            >{/each}
        </select>
        {#if selected && artifact}
          <label for="text-content">Text content</label>
          <textarea
            id="text-content"
            value={artifact.text}
            maxlength={LIMITS.text}
            disabled={editorState.busy}
            rows="8"
            oninput={(event) =>
              editor.editText(artifact.id, event.currentTarget.value)}
          ></textarea>
          <fieldset disabled={editorState.busy}>
            <legend>Placement and size</legend>
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
        <fieldset disabled={editorState.busy}>
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
        <p class="hint">
          Changes autosave. Drag nodes or use the placement fields; use the view
          fields to pan and zoom with the keyboard. Save before switching
          canvases or closing.
        </p>
      </aside>
    {/if}
  </main>
</div>
