<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { LIMITS } from "@agentica/protocol";
  import { callRuntime, desktopMode, pingRuntime } from "./lib/runtime";
  import { Editor } from "./lib/editor";
  import { applyTheme, readTheme, type Theme } from "./lib/theme";
  import Composer from "./lib/components/Composer.svelte";
  import CanvasToolbar from "./lib/components/CanvasToolbar.svelte";
  import DrawingNode from "./lib/components/DrawingNode.svelte";
  import Icon from "./lib/components/Icon.svelte";
  import Settings from "./lib/components/Settings.svelte";
  import WorkspacePicker from "./lib/components/WorkspacePicker.svelte";
  import CanvasPicker from "./lib/components/CanvasPicker.svelte";
  import NodeDrawer from "./lib/components/NodeDrawer.svelte";
  import {
    DEFAULT_STROKE_COLOR,
    DEFAULT_STROKE_WIDTH,
    TOOL_KEYS,
    type Tool,
  } from "./lib/tools";
  import {
    Background,
    Controls,
    SvelteFlow,
    type Edge,
    type Node,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";

  const nodeTypes = { drawing: DrawingNode };

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
  let drawerOpen = $state(true);
  const DRAWER_MIN_WIDTH = 180;
  const DRAWER_MAX_WIDTH = 480;
  let drawerWidth = $state(readDrawerWidth());
  let settingsOpen = $state(false);
  let theme = $state<Theme>(readTheme());
  let recoveryCopy = $state("");
  let closeNotice = $state("");
  let tool = $state<Tool>("select");
  let toolbarOpen = $state(false);
  let canvasEl = $state<HTMLElement>();
  let drawSurface = $state<HTMLDivElement>();
  let gesture = $state.raw<Gesture | null>(null);
  let strokeColor = $state(DEFAULT_STROKE_COLOR);
  let strokeWidth = $state(DEFAULT_STROKE_WIDTH);
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
  const canEdit = $derived(connected && !working && !editorState.dirty);
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
  const textArtifact = $derived(
    artifact?.type === "text" ? artifact : undefined,
  );
  const isDrawingTool = $derived(
    tool === "draw" || tool === "rectangle" || tool === "ellipse",
  );
  const nodeItems = $derived.by(() => {
    const document = editorState.document;
    if (!document) return [];
    return document.nodes.map((node, index) => {
      const artifact = document.artifacts.find(
        (item) => item.id === node.artifactId,
      );
      const kind =
        artifact?.type === "drawing"
          ? (artifact.drawing.shapes[0]?.kind ?? "path")
          : "text";
      const name =
        kind === "text"
          ? "Text"
          : kind === "rectangle"
            ? "Rectangle"
            : kind === "ellipse"
              ? "Ellipse"
              : "Drawing";
      return { id: node.id, kind, label: `${name} ${index + 1}` };
    });
  });
  // Drawings may start while autosave is pending: the commit waits for it.
  const canDraw = $derived(connected && !editorState.busy);

  type Point = { x: number; y: number };
  type Gesture = { kind: "path" | "rectangle" | "ellipse"; points: Point[] };

  const PAD = 6;

  const round = (value: number) => Math.round(value * 100) / 100;

  /** Stored drawer width first, then the default. */
  function readDrawerWidth(): number {
    try {
      const stored = Number(localStorage.getItem("agentica.drawerWidth"));
      if (Number.isFinite(stored) && stored > 0)
        return Math.min(
          DRAWER_MAX_WIDTH,
          Math.max(DRAWER_MIN_WIDTH, Math.round(stored)),
        );
    } catch {
      // Storage can be unavailable; fall back to the default width.
    }
    return 240;
  }

  /** Clamp the drawer width and remember it for the next launch. */
  function resizeDrawer(next: number) {
    drawerWidth = Math.min(
      DRAWER_MAX_WIDTH,
      Math.max(DRAWER_MIN_WIDTH, Math.round(next)),
    );
    try {
      localStorage.setItem("agentica.drawerWidth", String(drawerWidth));
    } catch {
      // Storage can be unavailable; the width still applies for this session.
    }
  }

  function bounds(points: Point[]) {
    return points.reduce(
      (box, point) => ({
        minX: Math.min(box.minX, point.x),
        minY: Math.min(box.minY, point.y),
        maxX: Math.max(box.maxX, point.x),
        maxY: Math.max(box.maxY, point.y),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
  }

  /** Grow an axis to the minimum node size, or clamp it to the maximum. */
  function fit(origin: number, size: number) {
    if (size < LIMITS.minSize)
      return {
        origin: origin - (LIMITS.minSize - size) / 2,
        size: LIMITS.minSize,
      };
    return { origin, size: Math.min(size, LIMITS.maxSize) };
  }

  function toFlow(point: Point, rect: DOMRect): Point {
    return {
      x: (point.x - rect.left - viewport.x) / viewport.zoom,
      y: (point.y - rect.top - viewport.y) / viewport.zoom,
    };
  }

  /** Gesture points are screen coordinates; the preview draws relative to it. */
  function surfacePoint(point: Point): Point {
    const rect = drawSurface?.getBoundingClientRect();
    return rect ? { x: point.x - rect.left, y: point.y - rect.top } : point;
  }

  function startDraw(event: PointerEvent) {
    if (!canDraw || !drawSurface) return;
    const kind = tool === "draw" ? "path" : tool;
    if (kind !== "path" && kind !== "rectangle" && kind !== "ellipse") return;
    drawSurface.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    gesture = { kind, points: [point, point] };
  }

  function moveDraw(event: PointerEvent) {
    if (!gesture) return;
    const point = { x: event.clientX, y: event.clientY };
    gesture =
      gesture.kind === "path"
        ? { ...gesture, points: [...gesture.points, point] }
        : { ...gesture, points: [gesture.points[0]!, point] };
  }

  function endDraw(event: PointerEvent) {
    if (!gesture || !drawSurface) return;
    const finished = gesture;
    gesture = null;
    if (drawSurface.hasPointerCapture(event.pointerId))
      drawSurface.releasePointerCapture(event.pointerId);
    void commit(finished, drawSurface.getBoundingClientRect());
  }

  /** Split a long stroke so each committed node stays within the size limit. */
  function splitPath(points: Point[]): Point[][] {
    const groups: Point[][] = [];
    let current = [points[0]!];
    for (let index = 1; index < points.length; index += 1) {
      const next = [...current, points[index]!];
      const box = bounds(next);
      if (
        Math.max(box.maxX - box.minX, box.maxY - box.minY) + PAD * 2 >
          LIMITS.maxSize &&
        current.length > 1
      ) {
        groups.push(current);
        current = [points[index - 1]!, points[index]!];
      } else {
        current = next;
      }
    }
    groups.push(current);
    return groups;
  }

  async function commit(finished: Gesture, rect: DOMRect) {
    const points = finished.points.map((point) => toFlow(point, rect));
    if (finished.kind === "path") {
      for (const group of splitPath(points)) {
        const box = bounds(group);
        const x = fit(box.minX - PAD, box.maxX - box.minX + PAD * 2);
        const y = fit(box.minY - PAD, box.maxY - box.minY + PAD * 2);
        await editor.addDrawing(
          { x: x.origin, y: y.origin, width: x.size, height: y.size },
          {
            shapes: [
              {
                kind: "path",
                points: group.map((point) => [
                  round(point.x - x.origin),
                  round(point.y - y.origin),
                ]),
                color: strokeColor,
                width: strokeWidth,
              },
            ],
          },
        );
      }
      return;
    }
    const box = bounds(points);
    const width = Math.max(1, box.maxX - box.minX);
    const height = Math.max(1, box.maxY - box.minY);
    const x = fit(box.minX, width);
    const y = fit(box.minY, height);
    await editor.addDrawing(
      { x: x.origin, y: y.origin, width: x.size, height: y.size },
      {
        shapes: [
          {
            kind: finished.kind,
            x: round(box.minX - x.origin),
            y: round(box.minY - y.origin),
            width: round(width),
            height: round(height),
            color: strokeColor,
          },
        ],
      },
    );
  }

  function selectTool(next: Tool) {
    tool = next;
    gesture = null;
  }

  $effect(() => {
    const document = editorState.document;
    untrack(() => {
      nodes =
        document?.nodes.map((node, index) => {
          const artifact = document.artifacts.find(
            (item) => item.id === node.artifactId,
          );
          const drawing = artifact?.type === "drawing";
          return {
            ...nodes.find((item) => item.id === node.id),
            id: node.id,
            type: drawing ? "drawing" : undefined,
            position: { x: node.x, y: node.y },
            width: node.width,
            height: node.height,
            data: drawing
              ? { drawing: artifact.drawing }
              : {
                  label:
                    artifact?.type === "text" && artifact.text
                      ? artifact.text
                      : `Text ${index + 1}`,
                },
          };
        }) ?? [];
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

  const TYPING_TAGS = ["INPUT", "TEXTAREA", "SELECT"];

  function onKeydown(event: KeyboardEvent) {
    if (settingsOpen) return;
    if (event.key === "Escape") {
      if (stage === "canvas") void backToWorkspaces();
      return;
    }
    if (stage !== "editor" || event.metaKey || event.ctrlKey || event.altKey)
      return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.isContentEditable || TYPING_TAGS.includes(target.tagName))
    )
      return;
    const next = TOOL_KEYS[event.key.toLowerCase()];
    if (!next) return;
    event.preventDefault();
    selectTool(next);
    toolbarOpen = true;
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

{#snippet connectionControls()}
  {#if stage === "workspace" || !connected}
    <div
      class="connbar"
      class:connbar--ok={connected}
      class:connbar--bad={status === "failed"}
      role="status"
      aria-live="polite"
    >
      <span class="connbar__dot"></span>
      <span class="connbar__text">{message}</span>
      <form
        class="connbar__form"
        onsubmit={(event) => {
          event.preventDefault();
          void checkConnection(true);
        }}
      >
        {#if !desktopMode}
          <label class="sr-only" for="connection-key"
            >Backend connection key</label
          >
          <input
            id="connection-key"
            type="password"
            bind:value={connectionKey}
            maxlength="64"
            placeholder="Connection key"
            autocomplete="off"
            spellcheck="false"
          />
        {/if}
        <button
          class="btn btn--soft"
          type="submit"
          disabled={busy || (!desktopMode && !connectionKey.trim())}
        >
          <Icon name={connected ? "sync" : "bolt"} size={18} />
          {status === "connecting"
            ? "Connecting…"
            : status === "disconnected"
              ? "Connect"
              : "Reconnect"}
        </button>
      </form>
    </div>
  {/if}
{/snippet}

<div class="shell">
  {#if stage === "workspace"}
    <WorkspacePicker
      workspaces={editorState.workspaces}
      {connected}
      connection={connectionControls}
      {busy}
      error={editorState.error}
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
      connection={connectionControls}
      busy={working}
      error={editorState.error}
      onCreate={(title) => void editor.createCanvas(title)}
      onOpen={(id) => void editor.openCanvas(id)}
      onDelete={(id) => void editor.deleteCanvas(id)}
      onBack={() => void backToWorkspaces()}
      onOpenSettings={() => (settingsOpen = true)}
    />
  {:else}
    {@render connectionControls()}
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
        <!-- <button
          class="btn btn--soft"
          type="button"
          disabled={!canEdit}
          onclick={() => void editor.addText()}
        >
          <Icon name="add_box" size={18} />
          Add text
        </button> -->
        <button
          class="btn btn--primary"
          type="button"
          disabled={!canSave}
          onclick={() => void editor.save()}
        >
          <Icon name="save" size={18} />
          <!-- Save -->
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
      {#if drawerOpen && editorState.document}
        <NodeDrawer
          items={nodeItems}
          {selectedId}
          busy={working}
          width={drawerWidth}
          onSelect={(id) => (selectedId = id)}
          onClose={() => (drawerOpen = false)}
          onResize={resizeDrawer}
        />
      {/if}

      <main
        class="canvas"
        class:canvas--pan={tool === "pan"}
        aria-label="Canvas workspace"
        bind:this={canvasEl}
      >
        {#key editorState.document?.canvas.id}
          <SvelteFlow
            bind:nodes
            bind:edges
            bind:viewport
            {nodeTypes}
            minZoom={LIMITS.minZoom}
            maxZoom={LIMITS.maxZoom}
            deleteKey={null}
            nodesConnectable={tool === "arrow" && canEdit}
            elementsSelectable={tool === "select" || tool === "eraser"}
            nodesDraggable={canEdit && tool === "select"}
            panOnDrag={!isDrawingTool && !editorState.busy}
            zoomOnScroll={!editorState.busy}
            connectionLineStyle="stroke: var(--accent); stroke-width: 2"
            onnodeclick={({ node }) => {
              if (tool === "eraser") {
                void editor.deleteNode(node.id);
                return;
              }
              selectedId = node.id;
            }}
            onpaneclick={({ event }) => {
              if (tool !== "text" || !canEdit || !canvasEl) return;
              const rect = canvasEl.getBoundingClientRect();
              void editor.addText({
                x:
                  (event.clientX - rect.left - viewport.x) / viewport.zoom -
                  120,
                y: (event.clientY - rect.top - viewport.y) / viewport.zoom - 80,
              });
            }}
            onconnect={({ source, target }) => {
              if (tool === "arrow") void editor.createEdge(source, target);
            }}
            onmove={(_, next) => editor.setViewport(next)}
          >
            <Background patternColor={dark ? "#2a2f52" : "#d7d9ec"} gap={24} />
            <Controls showLock={false} />
          </SvelteFlow>
        {/key}

        {#if editorState.document}
          <button
            class="icon-btn canvas__nodes"
            class:icon-btn--active={drawerOpen}
            type="button"
            title="Toggle nodes"
            aria-label="Toggle nodes"
            onclick={() => (drawerOpen = !drawerOpen)}
          >
            <Icon name="toc" size={20} />
          </button>
        {/if}

        {#if isDrawingTool}
          <div
            class="drawlayer"
            class:drawlayer--blocked={!canDraw}
            role="application"
            aria-label="Drawing surface"
            bind:this={drawSurface}
            onpointerdown={startDraw}
            onpointermove={moveDraw}
            onpointerup={endDraw}
            onpointercancel={endDraw}
          >
            {#if gesture}
              <svg class="drawlayer__preview" aria-hidden="true">
                {#if gesture.kind === "path"}
                  <polyline
                    points={gesture.points
                      .map((point) => {
                        const shown = surfacePoint(point);
                        return `${shown.x},${shown.y}`;
                      })
                      .join(" ")}
                    fill="none"
                    stroke={strokeColor}
                    stroke-width={strokeWidth}
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                {:else}
                  {@const start = surfacePoint(gesture.points[0]!)}
                  {@const end = surfacePoint(gesture.points[1]!)}
                  {#if gesture.kind === "rectangle"}
                    <rect
                      x={Math.min(start.x, end.x)}
                      y={Math.min(start.y, end.y)}
                      width={Math.abs(end.x - start.x)}
                      height={Math.abs(end.y - start.y)}
                      rx="4"
                      fill="none"
                      stroke={strokeColor}
                      stroke-width="2"
                    />
                  {:else}
                    <ellipse
                      cx={(start.x + end.x) / 2}
                      cy={(start.y + end.y) / 2}
                      rx={Math.abs(end.x - start.x) / 2}
                      ry={Math.abs(end.y - start.y) / 2}
                      fill="none"
                      stroke={strokeColor}
                      stroke-width="2"
                    />
                  {/if}
                {/if}
              </svg>
            {/if}
          </div>
        {/if}
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

        {#if toolbarOpen}
          <CanvasToolbar
            {tool}
            color={strokeColor}
            width={strokeWidth}
            onSelect={selectTool}
            onColor={(value) => (strokeColor = value)}
            onWidth={(value) => (strokeWidth = value)}
          />
        {/if}

        <Composer
          {toolbarOpen}
          onToggleToolbar={() => (toolbarOpen = !toolbarOpen)}
        />
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
            {#if textArtifact}
              <div class="field">
                <label for="text-content">Text content</label>
                <textarea
                  id="text-content"
                  value={textArtifact.text}
                  maxlength={LIMITS.text}
                  disabled={editorState.busy}
                  rows="7"
                  placeholder="Write something…"
                  oninput={(event) =>
                    editor.editText(textArtifact.id, event.currentTarget.value)}
                ></textarea>
              </div>
            {/if}
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
