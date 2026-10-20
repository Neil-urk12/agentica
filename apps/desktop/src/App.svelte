<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { invoke } from "@tauri-apps/api/core";
  import { open as pickDirectory } from "@tauri-apps/plugin-dialog";
  import { SessionManager } from "./lib/sessions";
  import ProjectNode from "./lib/components/ProjectNode.svelte";
  import SessionNode from "./lib/components/SessionNode.svelte";
  import Modal from "./lib/components/Modal.svelte";
  import "@xterm/xterm/css/xterm.css";
  import {
    LIMITS,
    PROJECT_HEADER,
    PROJECT_PADDING,
    type RuntimeParams,
    type SessionStatus,
    type CanvasOperation,
  } from "@agentica/protocol";
  import { callRuntime, desktopMode, pingRuntime } from "./lib/runtime";
  import { Editor, type DrawingSegment } from "./lib/editor";
  import { applyTheme, readTheme, type Theme } from "./lib/theme";
  import Composer from "./lib/components/Composer.svelte";
  import Reader from "./lib/components/Reader.svelte";
  import ReviewBar from "./lib/components/ReviewBar.svelte";
  import CanvasNavigation from "./lib/components/CanvasNavigation.svelte";
  import AttentionQueue from "./lib/components/AttentionQueue.svelte";
  import { isApplePlatform, isQueueShortcut } from "./lib/session-attention";
  import {
    CARD,
    EXCHANGE_RESERVE,
    areaCentre,
    compactSize,
    fitTextHeight,
    fitViewport,
    overlayInsets,
    proposedContent,
    unionBox,
    usableArea,
    zoomAbout,
    type Box,
    type ProposedContent,
    type Viewport,
  } from "./lib/canvas-view";
  import CanvasToolbar from "./lib/components/CanvasToolbar.svelte";
  import DrawingNode from "./lib/components/DrawingNode.svelte";
  import TextNode from "./lib/components/TextNode.svelte";
  import {
    exchangePosition,
    stageOperations,
    textHeight,
  } from "./lib/canvas-agent";
  import Icon from "./lib/components/Icon.svelte";
  import Settings from "./lib/components/Settings.svelte";
  import { runCanvasAgent, canvasToolSupport } from "./lib/openrouter";
  import {
    agentProgressLabel,
    type CanvasAgentProgress,
  } from "./lib/canvas-harness";
  import {
    getActivePreset,
    getProviderConfig,
    validateProvider,
  } from "./lib/provider";
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
    MarkerType,
    SvelteFlow,
    type Edge,
    type Node,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";

  const nodeTypes = {
    drawing: DrawingNode,
    text: TextNode,
    project: ProjectNode,
    session: SessionNode,
  };

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
  let selectionCanvasId = "";
  let connectionKey = $state("");
  let sessionRevision = $state(0);
  const sessions = new SessionManager(
    () => connectionKey.trim(),
    () => {
      sessionRevision++;
    },
  );
  const attentionEntries = $derived.by(() => {
    void sessionRevision;
    const workspace = editorState.workspace;
    const document = editorState.document;
    return workspace && document
      ? sessions.attention(workspace.workspace.id, document.canvas.id)
      : [];
  });
  let projectDialog = $state<{ projectId?: string } | null>(null);
  let projectPath = $state("");
  let projectError = $state("");
  let pickingProject = $state(false);
  let removal = $state.raw<{
    label: string;
    sessions: SessionStatus[];
    remove: () => Promise<unknown>;
  } | null>(null);
  let removalBusy = $state(false);
  let removalError = $state("");
  let closing = false;
  let status = $state<"disconnected" | "connecting" | "connected" | "failed">(
    "disconnected",
  );
  let message = $state(
    desktopMode
      ? "Starting backend…"
      : "Start the backend and paste its connection key.",
  );
  let busy = $state(false);
  let inspectorOpen = $state(false);
  let drawerOpen = $state(true);
  // Groups start collapsed whenever a canvas opens. Expanding is a view-only
  // choice until the control persists it, so reopening never leaks a previous
  // expanded layout.
  let expandedGroups = $state.raw<Record<string, boolean>>({});
  let groupViewCanvasId = "";
  /** Height of a collapsed project group's bordered status strip. */
  const COLLAPSED_PROJECT_HEIGHT = 48;
  const DRAWER_MIN_WIDTH = 180;
  const DRAWER_MAX_WIDTH = 480;
  let drawerWidth = $state(readDrawerWidth());
  let settingsOpen = $state(false);
  let theme = $state<Theme>(readTheme());
  let recoveryCopy = $state("");
  let closeNotice = $state("");
  let tool = $state<Tool>("select");
  let toolbarOpen = $state(false);
  let generating = $state(false);
  let agentProgress = $state<CanvasAgentProgress | null>(null);
  let promptError = $state("");
  let toolsNotice = $state("");
  let conversationAbort: AbortController | undefined;
  let generationTask: Promise<boolean> | undefined;
  let pendingReply = $state.raw<RuntimeParams<"conversation.finish"> | null>(
    null,
  );
  type ReaderState = {
    title: string;
    subtitle?: string;
    /** Live, editable source; absent for labels and proposed content. */
    artifactId?: string;
    text: string;
    markdown: boolean;
    startEditing?: boolean;
  };
  let reader = $state.raw<ReaderState | null>(null);
  let reviewError = $state("");
  let resolving = $state(false);
  let fitNotice = $state("");
  const hasSelection = $derived(
    nodes.some((n) => n.selected && !n.id.startsWith("preview-")),
  );
  const contextIds = $derived(
    nodes
      .filter(
        (n) =>
          n.selected &&
          !n.id.startsWith("preview-") &&
          n.type !== "project" &&
          n.type !== "session",
      )
      .map((n) => n.id),
  );
  const activeTurn = $derived(
    editorState.turns.find(
      (t) => t.status === "pending" || t.status === "generating",
    ),
  );
  // Review is derived from the turn record, not from the reply node, so it
  // stays available when the reply is offscreen or missing.
  const pendingTurn = $derived(
    editorState.turns.find((t) => t.status === "pending"),
  );
  const pendingContent = $derived(
    pendingTurn ? proposedContent(pendingTurn.operations) : [],
  );
  const readerText = $derived.by(() => {
    if (!reader) return "";
    const source = reader.artifactId
      ? editorState.document?.artifacts.find((a) => a.id === reader?.artifactId)
      : undefined;
    return source?.type === "text" ? source.text : reader.text;
  });
  const providerLabel = $derived.by(() => {
    void settingsOpen;
    const config = getProviderConfig();
    let host = config.baseUrl;
    try {
      host = new URL(config.baseUrl).host;
    } catch {
      /* Shown as entered; validation reports it on submit. */
    }
    const name =
      config.kind === "custom"
        ? `${getActivePreset()?.name ?? "Custom provider"} (${host})`
        : "OpenRouter";
    return `${name} · ${config.model || "no model selected"}`;
  });
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
  /** Top-bar waiting queue; Ctrl+J (Cmd+J on Apple) toggles it. */
  let queueOpen = $state(false);
  const apple = isApplePlatform();
  const queueCanvas = $derived(
    stage === "editor" ? (editorState.document?.canvas.id ?? "") : "",
  );
  // The queue belongs to one open canvas; leaving it closes the panel.
  $effect(() => {
    void queueCanvas;
    queueOpen = false;
  });
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
    const items = document.nodes.map((node, index) => {
      const artifact = document.artifacts.find(
        (item) => item.id === node.artifactId,
      );
      const kind =
        artifact?.type === "drawing"
          ? (artifact.drawing.shapes[0]?.kind ?? "path")
          : artifact?.purpose === "instruction"
            ? "instruction"
            : "text";
      const turn = editorState.turns.find(
        (t) => t.promptNodeId === node.id || t.replyNodeId === node.id,
      );
      const name = turn
        ? turn.promptNodeId === node.id
          ? "Your prompt"
          : "Agent reply"
        : kind === "instruction"
          ? "Instruction note"
          : kind === "text"
            ? "Text"
            : kind === "rectangle"
              ? "Rectangle"
              : kind === "ellipse"
                ? "Ellipse"
                : "Drawing";
      return { id: node.id, kind, label: `${name} ${index + 1}` };
    });
    return [
      ...items,
      ...document.projectGroups.map((g) => ({
        id: g.id,
        kind: "project",
        label: g.label,
      })),
      ...document.sessionTiles.map((t) => ({
        id: t.id,
        kind: t.kind,
        label: `${t.kind === "shell" ? "Terminal" : "Codex"} · ${document.projectGroups.find((g) => g.id === t.projectId)?.label ?? "Project"}`,
      })),
    ];
  });
  // Drawings may start while autosave is pending: the commit waits for it.
  const canDraw = $derived(connected && !editorState.busy);
  const selectedTurn = $derived(
    editorState.turns.find(
      (t) => t.promptNodeId === selectedId || t.replyNodeId === selectedId,
    ),
  );
  const selectedBox = $derived.by(() => {
    if (artifact?.type !== "drawing") return undefined;
    const shapes = artifact.drawing.shapes;
    const shape = shapes.length === 1 ? shapes[0] : undefined;
    return shape && shape.kind !== "path" ? shape : undefined;
  });
  const canFit = $derived(
    (!!textArtifact && !selectedTurn) || !!selectedBox?.label,
  );

  type Point = { x: number; y: number };
  type Gesture = { kind: "path" | "rectangle" | "ellipse"; points: Point[] };

  const PAD = 6;

  const round = (value: number) => Math.round(value * 100) / 100;

  /** Class applied to the canvas node that matches `selectedId`. */
  const SELECTED_CLASS = "node--selected";

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

  /**
   * The drawing overlay is a sibling of the xyflow root, so wheel and pinch
   * events land on it and never reach xyflow's zoom listener. Forward them.
   */
  function forwardWheel(event: WheelEvent) {
    const flow = canvasEl?.querySelector(".svelte-flow");
    if (!flow) return;
    event.preventDefault();
    flow.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        button: event.button,
        buttons: event.buttons,
        detail: event.detail,
      }),
    );
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
    const segments: DrawingSegment[] = [];
    if (finished.kind === "path") {
      // Each group already fits the node size limit; the editor splits any group
      // that would still exceed a single request frame.
      for (const group of splitPath(points)) {
        const box = bounds(group);
        const x = fit(box.minX - PAD, box.maxX - box.minX + PAD * 2);
        const y = fit(box.minY - PAD, box.maxY - box.minY + PAD * 2);
        segments.push({
          geometry: { x: x.origin, y: y.origin, width: x.size, height: y.size },
          drawing: {
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
        });
      }
    } else {
      const box = bounds(points);
      const width = Math.max(1, box.maxX - box.minX);
      const height = Math.max(1, box.maxY - box.minY);
      const x = fit(box.minX, width);
      const y = fit(box.minY, height);
      segments.push({
        geometry: { x: x.origin, y: y.origin, width: x.size, height: y.size },
        drawing: {
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
      });
    }
    await editor.addDrawings(segments);
  }

  function selectTool(next: Tool) {
    tool = next;
    gesture = null;
  }

  function handlePromptSubmit(prompt: string) {
    generationTask = generateReply(prompt);
    return generationTask;
  }

  /**
   * Drop the buffered reply once the runtime has finished its turn, such as
   * after a lost acknowledgement. Returns false while the turn still needs it.
   */
  async function adoptFinishedTurn() {
    const reply = pendingReply;
    if (!reply) return true;
    const turn = await editor.finishedTurn(reply.turnId);
    if (!turn || pendingReply !== reply) return false;
    pendingReply = null;
    promptError = "";
    // Another tab may have finished the turn differently; keep this reply copyable.
    if (
      turn.reply !== reply.reply ||
      JSON.stringify(turn.operations) !== JSON.stringify(reply.operations)
    )
      recoveryCopy = JSON.stringify(reply, null, 2);
    return true;
  }

  async function saveReply(textOnly = false) {
    if (!pendingReply) return;
    if (textOnly) {
      // Reconcile first: a saved proposal resent without operations always conflicts.
      if (await adoptFinishedTurn()) return;
      if (!pendingReply) return;
      if (editorState.error) {
        promptError = editorState.error;
        return;
      }
      pendingReply = { ...pendingReply, operations: [] };
    }
    const saved = await editor.finishConversation(pendingReply);
    if (saved && !editorState.error) {
      pendingReply = null;
      return;
    }
    const error = editorState.error;
    if (await adoptFinishedTurn()) return;
    promptError =
      error ||
      editorState.error ||
      "The reply could not be saved. Keep this canvas open and retry saving the response.";
  }

  async function generateReply(prompt: string) {
    if (
      generating ||
      activeTurn ||
      pendingReply ||
      !editorState.document ||
      !editorState.workspace
    )
      return false;
    const origin = {
      workspaceId: editorState.workspace.workspace.id,
      canvasId: editorState.document.canvas.id,
    };
    const nodeIds = [...contextIds];
    const contextMode = hasSelection
      ? ("selection" as const)
      : ("canvas" as const);
    let turnId: string | undefined;
    promptError = "";
    agentProgress = null;
    generating = true;
    const controller = new AbortController();
    conversationAbort = controller;
    try {
      const provider = validateProvider(getProviderConfig());
      const model = provider.model;
      const tools =
        provider.kind === "custom"
          ? provider.tools
          : await canvasToolSupport(model, controller.signal);
      toolsNotice = tools
        ? "Canvas edits will appear as proposals for review."
        : "This model supports text replies only. Choose a tool-capable model in Settings to propose canvas edits.";
      controller.signal.throwIfAborted();
      const area = usable();
      const centre = area
        ? areaCentre(viewport, area)
        : {
            x: (340 - viewport.x) / viewport.zoom,
            y: (300 - viewport.y) / viewport.zoom,
          };
      const anchor = exchangePosition(editorState.document.nodes, nodeIds, {
        x: centre.x - CARD.width / 2,
        y: centre.y - EXCHANGE_RESERVE.height / 2,
      });
      const requestedId = crypto.randomUUID();
      const start = await editor.startConversation({
        ...origin,
        turnId: requestedId,
        prompt,
        model,
        nodeIds,
        contextMode,
        anchor,
      });
      if (!start)
        throw new Error(
          editorState.error ||
            "The prompt could not be saved. Retry after saving your edits.",
        );
      turnId = start.turn.id;
      controller.signal.throwIfAborted();
      const response = await runCanvasAgent(start, {
        signal: controller.signal,
        tools,
        provider,
        onProgress: (progress) => (agentProgress = progress),
      });
      controller.signal.throwIfAborted();
      pendingReply = {
        ...origin,
        turnId,
        ...response,
        status: "complete",
        error: "",
      };
      await saveReply();
      return true;
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const message = cancelled
        ? "Generation cancelled. No proposed object changes were applied."
        : error instanceof Error
          ? error.message
          : "Failed to generate a response.";
      promptError = message;
      if (turnId && !pendingReply) {
        pendingReply = {
          ...origin,
          turnId,
          reply: "",
          operations: [],
          status: cancelled ? "cancelled" : "failed",
          error: message,
        };
        await saveReply();
      }
      return !!turnId;
    } finally {
      generating = false;
      agentProgress = null;
      if (conversationAbort === controller) conversationAbort = undefined;
    }
  }

  async function interruptTurn() {
    if (generating) {
      conversationAbort?.abort();
      return;
    }
    if (!activeTurn || !editorState.workspace || !editorState.document) return;
    pendingReply = {
      workspaceId: editorState.workspace.workspace.id,
      canvasId: editorState.document.canvas.id,
      turnId: activeTurn.id,
      reply: "",
      operations: [],
      status: "interrupted",
      error: "Generation was interrupted. Retry explicitly.",
    };
    await saveReply();
  }

  function selectObject(id: string) {
    selectedId = id;
    nodes = nodes.map((node) => ({ ...node, selected: node.id === id }));
  }

  /** Open the full-content reader for a saved node's text or label. */
  function openNodeReader(nodeId: string, startEditing = false) {
    const document = editorState.document;
    const node = document?.nodes.find((item) => item.id === nodeId);
    const source = document?.artifacts.find((a) => a.id === node?.artifactId);
    if (!node || !source) return;
    if (source.type === "drawing") {
      const labels = source.drawing.shapes
        .filter((shape) => shape.kind !== "path")
        .filter((shape) => shape.label);
      if (!labels.length) return;
      reader = {
        title:
          source.drawing.shapes.length > 1
            ? "Drawing labels"
            : `${labels[0]?.kind === "ellipse" ? "Ellipse" : "Rectangle"} label`,
        subtitle: "Read-only label",
        text: labels.map((shape) => shape.label).join("\n\n"),
        markdown: false,
      };
      return;
    }
    const turn = editorState.turns.find(
      (t) => t.promptNodeId === nodeId || t.replyNodeId === nodeId,
    );
    reader = {
      title: turn
        ? turn.promptNodeId === nodeId
          ? "Your prompt"
          : "Agent reply"
        : source.purpose === "instruction"
          ? "Instruction note"
          : "Text",
      subtitle: "Reading view · editing changes the saved source",
      artifactId: source.id,
      text: source.text,
      markdown: true,
      startEditing,
    };
  }

  /**
   * The unobscured canvas region in canvas-element pixels, measured from the
   * overlays actually rendered now (composer, review, tools, navigation, and
   * any panel drawn over the canvas).
   */
  function usable(): Box | undefined {
    if (!canvasEl) return undefined;
    const rect = canvasEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return undefined;
    const obstacles = [
      ...canvasEl.querySelectorAll<HTMLElement>(
        ".canvas-dock > *, .canvas-nav, .canvas__nodes, .canvas__inspector",
      ),
      ...document.querySelectorAll<HTMLElement>(".drawer, .inspector"),
    ].map((element) => element.getBoundingClientRect());
    return usableArea(
      { width: rect.width, height: rect.height },
      overlayInsets(rect, obstacles),
    );
  }

  /** Navigation changes only the viewport; object geometry is never written. */
  function setView(next: Viewport) {
    if (!editorState.document) return;
    viewport = next;
    editor.setViewport(next);
  }

  function zoomBy(factor: number) {
    const area = usable();
    if (area) setView(zoomAbout(viewport, area, factor));
  }

  function fitCanvas() {
    const area = usable();
    const target = unionBox(
      nodes
        .filter((node) => !node.parentId && !node.hidden)
        .map((node) => ({
          x: node.position.x,
          y: node.position.y,
          width: node.width ?? CARD.width,
          height: node.height ?? CARD.minHeight,
        })),
    );
    if (!area) return;
    setView(
      target
        ? fitViewport(target, area)
        : { x: area.x + area.width / 2, y: area.y + area.height / 2, zoom: 1 },
    );
  }

  function focusSelection() {
    if (selectedId) focusObject(selectedId);
  }

  function focusObject(id: string) {
    const area = usable();
    const node = nodes.find((n) => n.id === id);
    if (!area || !node) return;
    const parent = node.parentId
      ? nodes.find((n) => n.id === node.parentId)
      : undefined;
    const target = node.hidden && parent ? parent : node;
    setView(
      fitViewport(
        {
          x:
            target.position.x +
            (target === node ? (parent?.position.x ?? 0) : 0),
          y:
            target.position.y +
            (target === node ? (parent?.position.y ?? 0) : 0),
          width: target.width ?? CARD.width,
          height: target.height ?? CARD.minHeight,
        },
        area,
        Math.max(1, viewport.zoom),
      ),
    );
  }

  function showChanges() {
    const area = usable();
    const target = unionBox(
      nodes
        .filter((node) => node.id.startsWith("preview-"))
        .map((node) => ({
          x: node.position.x,
          y: node.position.y,
          width: node.width ?? CARD.width,
          height: node.height ?? CARD.minHeight,
        })),
    );
    if (area && target) setView(fitViewport(target, area));
  }

  function readProposed(item: ProposedContent) {
    reader = {
      title: item.title,
      subtitle: "Proposed content · read-only until applied",
      text: item.text,
      markdown: item.title.endsWith("text"),
    };
  }

  async function resolvePending(action: "apply" | "discard") {
    const turn = pendingTurn;
    if (!turn || resolving) return;
    resolving = true;
    reviewError = "";
    try {
      await editor.resolveConversation(turn.id, action);
    } finally {
      resolving = false;
    }
    // The runtime keeps the proposal pending when resolution fails.
    if (
      editorState.turns.some((t) => t.id === turn.id && t.status === "pending")
    )
      reviewError =
        editorState.error ||
        `The proposal could not be ${action === "apply" ? "applied" : "discarded"}.`;
  }

  function compactSelected() {
    if (!selected || !selectedTurn) return;
    editor.placeNode(selected.id, compactSize(selected));
    fitNotice = "Conversation compacted. Use Read to view the full text.";
  }

  /** Grow the selected text or single labeled shape to its measured content. */
  function fitSelected() {
    const document = editorState.document;
    if (!document || !selected || !canvasEl) return;
    const element = canvasEl.querySelector<HTMLElement>(
      `.svelte-flow__node[data-id="${CSS.escape(selected.id)}"]`,
    );
    const content = element?.querySelector<HTMLElement>(
      textArtifact ? ".card-body" : ".shape-label",
    );
    if (!content || !content.clientHeight) {
      fitNotice = "This object's text could not be measured. Try again.";
      return;
    }
    const extra = content.scrollHeight - content.clientHeight;
    // Layout pixels match canvas units; the label area may be inset within
    // the node, so its growth scales by the area-to-node ratio.
    const ratio = textArtifact ? 1 : content.clientHeight / selected.height;
    // Overflow is measured with the "Read more" indicator shown; growing by
    // the full overflow keeps the result stable once the indicator hides.
    const result = fitTextHeight(
      selected,
      selected.height + Math.max(0, extra / ratio),
      document.nodes,
    );
    if (!result.ok) {
      fitNotice = result.reason;
      return;
    }
    editor.placeNode(selected.id, { height: result.height });
    fitNotice = "Resized to fit the text.";
  }

  $effect(() => {
    const document = editorState.document;
    const currentTool = tool;
    const editable = connected && !editorState.busy;
    const turns = editorState.turns;
    const revision = sessionRevision;
    // Tracked so collapsing or expanding a group rerenders these nodes.
    const groupView = expandedGroups;
    untrack(() => {
      const asNode = (
        node: NonNullable<typeof document>["nodes"][number],
        artifacts: NonNullable<typeof document>["artifacts"],
        preview = false,
      ): Node => {
        const artifact = artifacts.find((a) => a.id === node.artifactId)!;
        const turn = turns.find(
          (t) => t.promptNodeId === node.id || t.replyNodeId === node.id,
        );
        return {
          ...nodes.find((item) => item.id === node.id),
          id: preview ? `preview-${node.id}` : node.id,
          type: artifact.type === "drawing" ? "drawing" : "text",
          position: { x: node.x, y: node.y },
          width: node.width,
          height: node.height,
          ...(preview
            ? {
                selectable: false,
                draggable: false,
                connectable: false,
                focusable: false,
                selected: false,
                zIndex: 1000,
              }
            : {}),
          data: {
            ...(artifact.type === "drawing"
              ? { drawing: artifact.drawing }
              : { text: artifact.text, purpose: artifact.purpose }),
            preview,
            editable: editable && !preview,
            connectable: currentTool === "arrow" && !preview,
            role: turn
              ? turn.promptNodeId === node.id
                ? "You"
                : "Agent"
              : undefined,
            // Cards present the persisted turn status; reply prose is untouched.
            status: turn?.status,
            error: turn?.error,
            onEdit: (text: string) => {
              editor.editText(node.artifactId, text);
              // Conversation cards stay bounded; long source is read in full.
              if (!turn)
                editor.placeNode(node.id, {
                  height: textHeight(text, node.width),
                });
            },
            onResize: (width: number, height: number) =>
              editor.placeNode(node.id, { width, height }),
            onRetry: () => turn && void handlePromptSubmit(turn.prompt),
            onRead: preview ? undefined : () => openNodeReader(node.id),
          },
        };
      };
      const rendered: Node[] = [];
      if (document && editorState.workspace) {
        if (groupViewCanvasId !== document.canvas.id) {
          groupViewCanvasId = document.canvas.id;
          expandedGroups = {};
          inspectorOpen = false;
        }
        const workspaceId = editorState.workspace.workspace.id;
        for (const group of document.projectGroups) {
          const collapsed = groupView[group.id] !== true;
          const tiles = document.sessionTiles.filter(
            (t) => t.projectId === group.id,
          );
          const running = sessions.summary(
            workspaceId,
            document.canvas.id,
            group.id,
          );
          rendered.push({
            ...nodes.find((n) => n.id === group.id),
            id: group.id,
            type: "project",
            position: { x: group.x, y: group.y },
            width: group.width,
            height: collapsed ? COLLAPSED_PROJECT_HEIGHT : group.height,
            dragHandle: ".project-drag",
            connectable: false,
            data: {
              kind: "project",
              group: { ...group, collapsed },
              editable,
              locatable: !running.length,
              status: {
                running: running.filter((s) => s.state === "running").length,
                starting: running.filter((s) => s.state === "starting").length,
                stopping: running.filter((s) => s.state === "stopping").length,
                stopped: tiles.length - running.length,
                waiting: sessions
                  .attention(workspaceId, document.canvas.id)
                  .filter((entry) => entry.tile.projectId === group.id).length,
              },
              minWidth: Math.max(320, ...tiles.map((t) => t.x + t.width + 16)),
              minHeight: Math.max(
                240,
                ...tiles.map((t) => t.y + t.height + 16),
              ),
              onCollapse: () => {
                expandedGroups = {
                  ...expandedGroups,
                  [group.id]: collapsed,
                };
                editor.placeProject(group.id, { collapsed: !collapsed });
              },
              onAddAgent: () => {
                expandedGroups = { ...expandedGroups, [group.id]: true };
                void editor.addSessionTile(group.id, "cli-agent");
              },
              onAddTerminal: () => {
                expandedGroups = { ...expandedGroups, [group.id]: true };
                void editor.addSessionTile(group.id, "shell");
              },
              onLocate: () => void openProject(group.id),
              onRemove: () => void removeObject(group.id),
              onResize: (width: number, height: number) =>
                editor.placeProject(group.id, { width, height }),
            },
          });
        }
        for (const tile of document.sessionTiles) {
          const group = document.projectGroups.find(
            (g) => g.id === tile.projectId,
          )!;
          const owner = {
            workspaceId,
            canvasId: document.canvas.id,
            tileId: tile.id,
          };
          rendered.push({
            ...nodes.find((n) => n.id === tile.id),
            id: tile.id,
            type: "session",
            parentId: group.id,
            position: { x: tile.x, y: tile.y },
            width: tile.width,
            height: tile.height,
            hidden: groupView[group.id] !== true,
            dragHandle: ".session-drag",
            extent: [
              [PROJECT_PADDING, PROJECT_HEADER],
              [group.width - PROJECT_PADDING, group.height - PROJECT_PADDING],
            ],
            connectable: false,
            data: {
              kind: "session",
              tile,
              group,
              owner,
              manager: sessions,
              revision,
              editable,
              onRemove: () => void removeObject(tile.id),
              onRefresh: () =>
                void sessions.reconcile(workspaceId, document, true),
              onResize: (width: number, height: number) =>
                editor.placeSessionTile(tile.id, { width, height }),
            },
          });
        }
      }
      rendered.push(
        ...(document?.nodes.map((node) => asNode(node, document.artifacts)) ??
          []),
      );
      edges =
        document?.edges.map((edge) => ({
          id: edge.id,
          source: edge.sourceNodeId,
          target: edge.targetNodeId,
          markerEnd: { type: MarkerType.ArrowClosed },
        })) ?? [];
      const pending = turns.find((t) => t.status === "pending");
      if (document && pending) {
        try {
          const staged = stageOperations(document, pending.operations);
          const touched = new Set(
            pending.operations.flatMap((op: CanvasOperation) =>
              op.op === "connect"
                ? [op.sourceNodeId, op.targetNodeId]
                : [op.nodeId],
            ),
          );
          rendered.push(
            ...staged.nodes
              .filter((n) => touched.has(n.id))
              .map((n) => asNode(n, staged.artifacts, true)),
          );
          edges.push(
            ...staged.edges
              .filter((e) =>
                pending.operations.some(
                  (op) => op.op === "connect" && op.edgeId === e.id,
                ),
              )
              .map((e) => ({
                id: `preview-${e.id}`,
                source: `preview-${e.sourceNodeId}`,
                target: `preview-${e.targetNodeId}`,
                selectable: false,
                focusable: false,
                style: "stroke-dasharray: 6 4",
                markerEnd: { type: MarkerType.ArrowClosed },
              })),
          );
        } catch {
          promptError =
            "The proposal preview is stale. Discard it and regenerate from current content.";
        }
      }
      nodes = rendered;
      if (document && selectionCanvasId !== document.canvas.id) {
        selectionCanvasId = document.canvas.id;
        try {
          selectedId =
            localStorage.getItem(`agentica.selection.${document.canvas.id}`) ??
            "";
        } catch {
          selectedId = "";
        }
      }
      if (!rendered.some((node) => node.id === selectedId)) selectedId = "";
      if (!document) {
        selectionCanvasId = "";
        groupViewCanvasId = "";
        // This effect tracks `expandedGroups`; assigning a fresh object every
        // run would retrigger it forever and freeze the UI.
        if (Object.keys(expandedGroups).length) expandedGroups = {};
      }
    });
  });

  $effect(() => {
    const document = editorState.document;
    if (
      !document ||
      ![
        ...document.nodes,
        ...document.projectGroups,
        ...document.sessionTiles,
      ].some((node) => node.id === selectedId)
    )
      return;
    try {
      localStorage.setItem(
        `agentica.selection.${document.canvas.id}`,
        selectedId,
      );
    } catch {
      /* Selection still works when browser storage is unavailable. */
    }
  });

  $effect(() => {
    viewport = editorState.document?.canvas.viewport ?? { x: 0, y: 0, zoom: 1 };
  });
  $effect(() => {
    const document = editorState.document;
    const workspaceId = editorState.workspace?.workspace.id;
    if (connected && document && workspaceId)
      void sessions.reconcile(workspaceId, document);
  });
  $effect(() => {
    const placements = nodes.map(({ id, position, type }) => ({
      id,
      position,
      type,
    }));
    untrack(() => {
      for (const { id, position, type } of placements) {
        if (type === "project") editor.placeProject(id, position);
        else if (type === "session") editor.placeSessionTile(id, position);
        else editor.placeNode(id, position);
      }
    });
  });

  // The canvas highlight follows the app's selection, wherever it changed:
  // drawer list, inspector dropdown, or a click on the canvas itself.
  $effect(() => {
    const id = selectedId;
    const next = nodes.map((node) => {
      if (node.id === id)
        return node.class === SELECTED_CLASS
          ? node
          : { ...node, class: SELECTED_CLASS };
      return node.class ? { ...node, class: "" } : node;
    });
    if (next.some((node, index) => node !== nodes[index])) nodes = next;
  });

  $effect(() => {
    applyTheme(theme);
  });

  $effect(() => {
    void selectedId;
    fitNotice = "";
  });

  $effect(() => {
    if (!pendingTurn) reviewError = "";
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
        if (!sessions.connected) {
          try {
            await sessions.connect();
            if (editorState.workspace && editorState.document)
              await sessions.reconcile(
                editorState.workspace.workspace.id,
                editorState.document,
                true,
              );
          } catch {
            /* Manual canvas editing remains available. */
          }
        }
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
    if (generating) {
      conversationAbort?.abort();
      await generationTask;
    }
    if (pendingReply) {
      promptError = "Save or copy the response before leaving this canvas.";
      return false;
    }
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
    if (!editorState.dirty && !editorState.saving && !pendingReply) return;
    event.preventDefault();
    event.returnValue = "";
  }

  const TYPING_TAGS = ["INPUT", "TEXTAREA", "SELECT"];
  const isTyping = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    (target.isContentEditable || TYPING_TAGS.includes(target.tagName));

  async function openProject(projectId?: string) {
    projectError = "";
    projectPath = "";
    if (!desktopMode) {
      projectDialog = { projectId };
      return;
    }
    pickingProject = true;
    try {
      const path = await pickDirectory({
        directory: true,
        multiple: false,
        title: projectId ? "Locate project folder" : "Open project",
      });
      if (typeof path === "string") {
        if (projectId) await editor.locateProject(projectId, path);
        else await editor.openProject(path);
      }
    } catch (error) {
      projectError = String(error);
      projectDialog = { projectId };
    } finally {
      pickingProject = false;
    }
  }
  async function submitProject() {
    if (!projectDialog || !projectPath.trim()) return;
    const path = projectPath.trim();
    if (!/^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(path)) {
      projectError =
        "Enter an absolute folder path on the backend computer, such as /home/you/project.";
      return;
    }
    projectError = "";
    pickingProject = true;
    try {
      const result = projectDialog.projectId
        ? await editor.locateProject(
            projectDialog.projectId,
            projectPath.trim(),
          )
        : await editor.openProject(projectPath.trim());
      if (result) projectDialog = null;
      else
        projectError = editorState.error || "The project could not be opened.";
    } finally {
      pickingProject = false;
    }
  }
  async function requestRemoval(
    workspaceId: string,
    canvasId: string | undefined,
    label: string,
    remove: () => Promise<unknown>,
    match: (status: SessionStatus) => boolean = () => true,
  ) {
    removalError = "";
    try {
      if (!sessions.capabilities) await sessions.connect();
      const affected = sessions.capabilities?.capabilities.supported
        ? (await sessions.list(workspaceId, canvasId)).filter(match)
        : [];
      const removeAfterDrain = async () => {
        // Stream reads and acknowledgements require the saved ownership metadata.
        await sessions.drainScope(workspaceId, canvasId, match);
        return remove();
      };
      if (!affected.length) {
        await removeAfterDrain();
        return;
      }
      removal = { label, sessions: affected, remove: removeAfterDrain };
    } catch (error) {
      closeNotice = `Removal failed: ${String(error)}. Records were retained.`;
    }
  }
  async function confirmRemoval() {
    if (!removal || removalBusy) return;
    removalBusy = true;
    try {
      await sessions.stopSessions(removal.sessions);
      await removal.remove();
      if (editorState.error) throw new Error(editorState.error);
      removal = null;
    } catch (error) {
      removalError = String(error);
    } finally {
      removalBusy = false;
    }
  }
  async function removeObject(id: string) {
    const document = editorState.document;
    const workspaceId = editorState.workspace?.workspace.id;
    if (!document || !workspaceId) return;
    const group = document.projectGroups.find((g) => g.id === id);
    const tile = document.sessionTiles.find((t) => t.id === id);
    if (group)
      await requestRemoval(
        workspaceId,
        document.canvas.id,
        group.label,
        () => editor.deleteProject(id),
        (s) => s.projectId === id,
      );
    else if (tile)
      await requestRemoval(
        workspaceId,
        document.canvas.id,
        tile.kind === "shell" ? "Terminal" : "Codex",
        () => editor.deleteSessionTile(id),
        (s) => s.owner.tileId === id,
      );
    else await editor.deleteNode(id);
  }

  function onKeydown(event: KeyboardEvent) {
    const dialogOpen = settingsOpen || reader || projectDialog || removal;
    const target = event.target as HTMLElement | null;
    // The queue shortcut also works from tile controls (header buttons,
    // Mark seen); only the terminal itself and text fields keep Ctrl+J.
    if (
      !dialogOpen &&
      stage === "editor" &&
      editorState.document &&
      isQueueShortcut(event, apple)
    ) {
      if (target?.closest("[data-terminal]") || isTyping(event.target)) return;
      event.preventDefault();
      queueOpen = !queueOpen;
      return;
    }
    if (
      dialogOpen ||
      target?.closest("[data-terminal],[data-terminal-controls]")
    )
      return;
    if (event.key === "Escape") {
      if (stage === "canvas") void backToWorkspaces();
      return;
    }
    if (stage !== "editor" || event.metaKey || event.ctrlKey || event.altKey)
      return;
    if (isTyping(event.target)) return;
    const next = TOOL_KEYS[event.key.toLowerCase()];
    if (!next) return;
    event.preventDefault();
    selectTool(next);
    toolbarOpen = true;
  }

  onMount(() => {
    let unlisten: (() => void) | undefined;
    const compact = window.matchMedia("(max-width: 820px)");
    const hidePanels = () => {
      if (compact.matches) {
        drawerOpen = false;
        inspectorOpen = false;
      }
    };
    hidePanels();
    compact.addEventListener("change", hidePanels);
    if (desktopMode) {
      void checkConnection(true);
      void getCurrentWindow()
        .onCloseRequested(async (event) => {
          event.preventDefault();
          if (closing) return;
          if (editorState.dirty || editorState.saving || pendingReply) {
            event.preventDefault();
            closeNotice =
              "Keep this window open until changes are saved. Copy unsaved edits for recovery if saving fails.";
            return;
          }
          closing = true;
          try {
            await invoke("session_shutdown");
            await getCurrentWindow().destroy();
          } catch (error) {
            closeNotice = `Session cleanup failed: ${String(error)}. Controls were retained; retry closing after Stop.`;
            closing = false;
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
      conversationAbort?.abort();
      clearInterval(heartbeat);
      unlisten?.();
      editor.dispose();
      void sessions.dispose();
      compact.removeEventListener("change", hidePanels);
    };
  });
</script>

{#if projectDialog}
  <Modal
    title={projectDialog.projectId ? "Locate folder" : "Open project"}
    icon="folder_open"
    subtitle="Enter an absolute directory path on the backend computer."
    onClose={() => {
      if (!pickingProject) projectDialog = null;
    }}
  >
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void submitProject();
      }}
    >
      <label for="project-path">Backend directory</label>
      <input
        id="project-path"
        class="field"
        bind:value={projectPath}
        placeholder="/home/you/project"
        required
        disabled={pickingProject}
      />
      {#if projectError}<p role="alert">{projectError}</p>{/if}
      <div class="project-dialog-actions">
        <button
          class="btn btn--soft"
          type="button"
          disabled={pickingProject}
          onclick={() => (projectDialog = null)}>Cancel</button
        ><button
          class="btn btn--primary"
          type="submit"
          disabled={pickingProject || !projectPath.trim()}>Open folder</button
        >
      </div>
    </form>
  </Modal>
{/if}
{#if removal}
  <Modal
    title={`Remove ${removal.label}?`}
    subtitle="These native processes must stop before their saved tiles can be removed."
    icon="warning"
    onClose={() => {
      if (!removalBusy) removal = null;
    }}
  >
    <ul>
      {#each removal.sessions as session}<li>
          {session.executable ?? "Native session"} · {session.state}
        </li>{/each}
    </ul>
    {#if removalError}<p role="alert">{removalError}</p>{/if}
    <div class="project-dialog-actions">
      <button
        class="btn btn--soft"
        type="button"
        disabled={removalBusy}
        onclick={() => (removal = null)}>Cancel</button
      ><button
        class="btn btn--primary"
        type="button"
        disabled={removalBusy}
        onclick={() => void confirmRemoval()}
        >{removalBusy ? "Stopping…" : "Stop and remove"}</button
      >
    </div>
  </Modal>
{/if}

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
      onDelete={(id) =>
        void requestRemoval(
          id,
          undefined,
          editorState.workspaces.find((w) => w.id === id)?.name ?? "Workspace",
          () => editor.deleteWorkspace(id),
        )}
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
      onDelete={(id) =>
        void requestRemoval(
          editorState.workspace!.workspace.id,
          id,
          editorState.workspace?.canvases.find((c) => c.id === id)?.title ??
            "Canvas",
          () => editor.deleteCanvas(id),
        )}
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
        {#if editorState.document}
          <AttentionQueue
            bind:open={queueOpen}
            entries={attentionEntries}
            projects={editorState.document.projectGroups}
            onJump={focusObject}
            onMarkSeen={(owner) => void sessions.dismiss(owner)}
          />
        {/if}
        <button
          class="btn btn--soft"
          type="button"
          disabled={!canEdit || pickingProject}
          onclick={() => void openProject()}
          ><Icon name="folder_open" size={18} />Open project</button
        >
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
          type="button"
          title="Settings"
          aria-label="Settings"
          onclick={() => (settingsOpen = true)}
        >
          <Icon name="settings" size={20} />
        </button>
        <button
          class="btn btn--primary"
          type="button"
          aria-label="Save"
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
          {#if !editorState.dirty}
            <button
              class="btn btn--soft"
              type="button"
              disabled={!connected || working}
              onclick={() => void editor.reloadConversation()}
              >Reload canvas</button
            >
          {/if}
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
    {#if promptError}
      <div class="banner banner--error" role="alert">
        <Icon name="error" size={18} />
        <span>{promptError}</span>
        {#if promptError.toLowerCase().includes("settings")}
          <button
            class="btn btn--soft"
            type="button"
            onclick={() => {
              settingsOpen = true;
            }}
          >
            <Icon name="settings" size={16} />
            Open settings
          </button>
        {/if}
        <button
          class="icon-btn"
          type="button"
          title="Dismiss"
          aria-label="Dismiss error"
          onclick={() => {
            promptError = "";
          }}
        >
          <Icon name="close" size={18} />
        </button>
      </div>
    {/if}

    <div class="stage">
      {#if drawerOpen && editorState.document}
        <NodeDrawer
          items={nodeItems}
          {selectedId}
          busy={working}
          width={drawerWidth}
          onSelect={selectObject}
          onClose={() => (drawerOpen = false)}
          onResize={resizeDrawer}
          onDelete={(id) => void removeObject(id)}
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
              if (node.id.startsWith("preview-")) return;
              if (tool === "eraser") {
                void removeObject(node.id);
                return;
              }
              selectedId = node.id;
            }}
            onpaneclick={({ event }) => {
              if (tool === "select") selectedId = "";
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
            <Background patternColor={dark ? "#2c2c30" : "#d9dbe4"} gap={24} />
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
          <button
            class="icon-btn canvas__inspector"
            class:icon-btn--active={inspectorOpen}
            type="button"
            title="Toggle inspector"
            aria-label="Toggle inspector"
            onclick={() => (inspectorOpen = !inspectorOpen)}
          >
            <Icon name="tune" size={20} />
          </button>
        {/if}

        {#if isDrawingTool}
          <div
            class="drawlayer"
            class:drawlayer--blocked={!canDraw}
            role="application"
            aria-label="Drawing surface"
            bind:this={drawSurface}
            onwheel={forwardWheel}
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
        {#if editorState.document && editorState.document.nodes.length === 0 && editorState.document.projectGroups.length === 0}
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
              Write on the canvas
            </button>
          </div>
        {/if}

        {#if editorState.document}
          <CanvasNavigation
            zoom={viewport.zoom}
            canFocus={!!selectedId}
            disabled={editorState.busy}
            onZoom={zoomBy}
            onReset={() => zoomBy(1 / viewport.zoom)}
            onFit={fitCanvas}
            onFocus={focusSelection}
          />
        {/if}

        <!-- One measured stack: tools, recovery, review, and composer never overlap. -->
        <div class="canvas-dock">
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
          {#if pendingReply || (activeTurn?.status === "generating" && !generating)}
            <div class="conversation-recovery" role="status">
              {#if pendingReply}
                <span>Response waiting to save</span>
                <button
                  type="button"
                  class="btn btn--soft"
                  onclick={() => void saveReply()}>Retry response save</button
                >
                <button
                  type="button"
                  class="btn btn--soft"
                  onclick={() =>
                    (recoveryCopy = JSON.stringify(pendingReply, null, 2))}
                  >Copy response</button
                >
                {#if pendingReply.operations.length}
                  <button
                    type="button"
                    class="btn btn--soft"
                    onclick={() => void saveReply(true)}>Save text only</button
                  >
                {/if}
              {:else}
                <span
                  >This turn was interrupted or is running in another tab.</span
                >
                <button
                  type="button"
                  class="btn btn--soft"
                  onclick={() => void interruptTurn()}>Mark interrupted</button
                >
              {/if}
            </div>
          {/if}
          {#if editorState.document && pendingTurn}
            <ReviewBar
              count={pendingTurn.operations.length}
              content={pendingContent}
              disabled={!canEdit}
              {resolving}
              error={reviewError}
              onShow={showChanges}
              onApply={() => void resolvePending("apply")}
              onDiscard={() => void resolvePending("discard")}
              onRead={readProposed}
            />
          {/if}
          <Composer
            {toolbarOpen}
            loading={generating}
            progress={generating && agentProgress
              ? agentProgressLabel(agentProgress)
              : ""}
            disabled={!connected ||
              !editorState.document ||
              !!activeTurn ||
              !!pendingReply}
            scope={hasSelection
              ? contextIds.length
                ? `${contextIds.length} selected ${contextIds.length === 1 ? "object" : "objects"} · recent conversation`
                : "No canvas content selected · recent conversation"
              : "Current canvas · recent conversation"}
            provider={providerLabel}
            details={[
              "Your prompt. Project folders, session tiles and terminal output are excluded.",
              hasSelection
                ? contextIds.length
                  ? `The ${contextIds.length} selected ${contextIds.length === 1 ? "object" : "objects"}: position, size, text or drawing, and connections between them.`
                  : "No selected notes or drawings. Native sessions are excluded."
                : "Canvas notes, drawings and conversation cards: position, size, text or drawing, and connections.",
              "Up to 8 earlier prompts and replies from this canvas, with their outcomes.",
              "Select objects before sending to limit what is shared.",
            ]}
            notice={toolsNotice}
            onCancel={() => conversationAbort?.abort()}
            onToggleToolbar={() => (toolbarOpen = !toolbarOpen)}
            onSubmit={handlePromptSubmit}
          />
        </div>
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
                {#each nodeItems as node (node.id)}
                  <option value={node.id}>{node.label}</option>
                {/each}
              </select>
            {:else}
              <p class="muted">No nodes yet — use “Add text”.</p>
            {/if}
          </div>

          {#if selected && artifact}
            {#if textArtifact}
              <div class="field">
                <label for="text-content"
                  >{textArtifact.purpose === "instruction"
                    ? "Agent instructions"
                    : "Text content"}</label
                >
                <textarea
                  id="text-content"
                  value={textArtifact.text}
                  maxlength={LIMITS.text}
                  disabled={editorState.busy}
                  rows="7"
                  placeholder={textArtifact.purpose === "instruction"
                    ? "Describe the task and the result you want…"
                    : "Write something…"}
                  oninput={(event) =>
                    editor.editText(textArtifact.id, event.currentTarget.value)}
                ></textarea>
              </div>
              {#if textArtifact.purpose === "instruction"}
                <div class="field">
                  <label for="instruction-reference"
                    >Instruction reference</label
                  >
                  <input
                    id="instruction-reference"
                    readonly
                    value={textArtifact.id}
                  />
                  <p class="muted">
                    Saved as a note. Editing instructions does not start an
                    agent.
                  </p>
                </div>
              {/if}
            {/if}
            {#if textArtifact || (artifact.type === "drawing" && artifact.drawing.shapes.some((shape) => shape.kind !== "path" && shape.label))}
              <div class="field">
                <span class="field__label">Content</span>
                <div class="inspector__actions">
                  <button
                    class="btn btn--soft"
                    type="button"
                    onclick={() => openNodeReader(selected.id)}
                  >
                    <Icon name="open_in_full" size={16} />Read full content
                  </button>
                  {#if selectedTurn}
                    {@const compact = compactSize(selected)}
                    <button
                      class="btn btn--soft"
                      type="button"
                      disabled={!canDraw ||
                        (compact.width === selected.width &&
                          compact.height === selected.height)}
                      onclick={compactSelected}
                    >
                      <Icon name="compress" size={16} />Compact conversation
                    </button>
                  {/if}
                  {#if canFit}
                    <button
                      class="btn btn--soft"
                      type="button"
                      disabled={!canDraw}
                      onclick={fitSelected}
                    >
                      <Icon name="height" size={16} />Fit text
                    </button>
                  {/if}
                </div>
                {#if fitNotice}<p class="muted" role="status">
                    {fitNotice}
                  </p>{/if}
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

  {#if reader}
    <Reader
      title={reader.title}
      subtitle={reader.subtitle}
      text={readerText}
      markdown={reader.markdown}
      startEditing={reader.startEditing}
      editDisabled={editorState.busy}
      onEdit={reader.artifactId
        ? (text) =>
            reader?.artifactId && editor.editText(reader.artifactId, text)
        : undefined}
      onClose={() => (reader = null)}
    />
  {/if}

  {#if settingsOpen}
    <Settings
      {theme}
      {connectionKey}
      {connected}
      onChange={(next) => (theme = next)}
      onClose={() => (settingsOpen = false)}
    />
  {/if}
</div>
