<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { invoke } from "@tauri-apps/api/core";
  import { open as pickDirectory } from "@tauri-apps/plugin-dialog";
  import { SessionManager } from "./lib/sessions";
  import ProjectNode from "./lib/components/ProjectNode.svelte";
  import SessionNode from "./lib/components/SessionNode.svelte";
  import ChangesNode from "./lib/components/ChangesNode.svelte";
  import ChangesOverlay from "./lib/components/ChangesOverlay.svelte";
  import { ChangesManager } from "./lib/changes-manager.svelte";
  import { feedbackMessage } from "./lib/changes";
  import Modal from "./lib/components/Modal.svelte";
  import SelectionBar from "./lib/components/SelectionBar.svelte";
  import {
    expandToGroups,
    followGroups,
    groupBoxes,
    groupMembers,
  } from "./lib/node-groups";
  import "@xterm/xterm/css/xterm.css";
  import {
    FILE_LIMITS,
    LIMITS,
    PROJECT_HEADER,
    PROJECT_PADDING,
    type AgentPreset,
    type RuntimeParams,
    type SessionStatus,
    type CanvasOperation,
  } from "@agentica/protocol";
  import {
    callRuntime,
    desktopMode,
    pingRuntime,
    RuntimeCallError,
  } from "./lib/runtime";
  import {
    MAX_TASK_BYTES,
    editedSinceSent,
    sendBlocker,
    taskPayload,
  } from "./lib/tasks";
  import { clock } from "./lib/clock.svelte";
  import { Editor, type DrawingSegment } from "./lib/editor";
  import { applyTheme, readTheme, type Theme } from "./lib/theme";
  import Composer from "./lib/components/Composer.svelte";
  import Reader from "./lib/components/Reader.svelte";
  import ReviewBar from "./lib/components/ReviewBar.svelte";
  import CanvasNavigation from "./lib/components/CanvasNavigation.svelte";
  import AttentionQueue from "./lib/components/AttentionQueue.svelte";
  import {
    attentionLabel,
    isApplePlatform,
    isQueueShortcut,
    waitedLabel,
  } from "./lib/session-attention";
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
    getZoomShortcutFactor,
    isZoomResetShortcut,
    type Box,
    type ProposedContent,
    type Viewport,
  } from "./lib/canvas-view";
  import CanvasToolbar from "./lib/components/CanvasToolbar.svelte";
  import DrawingNode from "./lib/components/DrawingNode.svelte";
  import FileNode from "./lib/components/FileNode.svelte";
  import TextNode from "./lib/components/TextNode.svelte";
  import {
    FILE_ACCEPT,
    extractFileText,
    fileKindLabel,
    fileMime,
    formatFileSize,
    openCanvasFile,
    readCanvasFile,
  } from "./lib/files";
  import {
    exchangePosition,
    stageOperations,
    textHeight,
  } from "./lib/canvas-agent";
  import Icon from "./lib/components/Icon.svelte";
  import Settings, {
    type SettingsSection,
  } from "./lib/components/Settings.svelte";
  import { runCanvasAgent, canvasToolSupport } from "./lib/openrouter";
  import {
    getActivePreset,
    getProviderConfig,
    validateProvider,
  } from "./lib/provider";
  import { transcribeSpeech } from "./lib/speech";
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
    SelectionMode,
    SvelteFlow,
    ViewportPortal,
    type Edge,
    type Node,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";

  const nodeTypes = {
    drawing: DrawingNode,
    file: FileNode,
    text: TextNode,
    project: ProjectNode,
    session: SessionNode,
    changes: ChangesNode,
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
  // Git review state per Changes tile; feedback autosaves to workspace storage.
  const changes = new ChangesManager(
    (method, params) =>
      callRuntime(
        connectionKey.trim(),
        false,
        method as "changes.status",
        params as RuntimeParams<"changes.status">,
      ) as never,
  );
  /** The Changes tile shown in full-screen review mode, if any. */
  let reviewTile = $state<string | null>(null);
  let pasting = $state(false);
  // Task send preview: exactly what will be pasted, and the text revision recorded.
  let taskSend = $state.raw<
    | ({
        nodeId: string;
        tileId: string;
        label: string;
        text: string;
        revision: number;
      } & ReturnType<typeof taskPayload>)
    | null
  >(null);
  let taskBusy = $state("");
  let taskErrors = $state.raw<Record<string, string>>({});
  // Pastes that succeeded but whose sent record failed; kept for retry.
  let unrecorded = $state.raw<
    Record<string, { tileId: string; label: string; revision: number }>
  >({});
  const hasSentTask = $derived(
    !!editorState.document?.nodes.some((node) => node.task?.sentAt),
  );
  $effect(() => {
    if (hasSentTask) return clock.hold();
  });
  const reviewTargets = $derived.by(() => {
    void sessionRevision;
    const document = editorState.document;
    const workspaceId = editorState.workspace?.workspace.id;
    const tile = document?.sessionTiles.find((t) => t.id === reviewTile);
    return document && workspaceId && tile
      ? sessions.pasteTargets(workspaceId, document.canvas.id, tile.projectId)
      : [];
  });
  $effect(() => {
    const document = editorState.document;
    if (!document) return;
    const ids = document.sessionTiles.map((t) => t.id);
    untrack(() => {
      changes.prune(document.canvas.id, ids);
      if (reviewTile && !ids.includes(reviewTile)) reviewTile = null;
    });
  });
  // An agent session raising attention usually just changed files.
  const seenAttention = new Set<string>();
  $effect(() => {
    const entries = attentionEntries;
    untrack(() => {
      const document = editorState.document;
      for (const entry of entries) {
        if (entry.tile.kind !== "cli-agent") continue;
        const key = `${entry.status.sessionId}:${entry.status.attention.sequence}`;
        if (seenAttention.has(key)) continue;
        seenAttention.add(key);
        const tile = document?.sessionTiles.find(
          (t) => t.kind === "changes" && t.projectId === entry.tile.projectId,
        );
        const state = tile && changes.peek(tile.id);
        if (state?.status && !state.loading) void state.refresh();
      }
    });
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
  // The Nodes drawer starts collapsed; opening a canvas also forces it closed
  // (see the canvas-open reset below) so each canvas opens with a clean stage.
  let drawerOpen = $state(false);
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
  // true opens settings without a section (narrow windows show the category list).
  let settingsOpen = $state<boolean | SettingsSection>(false);
  let theme = $state<Theme>(readTheme());
  let recoveryCopy = $state("");
  let closeNotice = $state("");
  let tool = $state<Tool>("select");
  let toolbarOpen = $state(false);
  let generating = $state(false);
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
  let fileInput = $state<HTMLInputElement>();
  let dropActive = $state(false);
  let importing = $state(false);
  let importProgress = $state(0);
  let importName = $state("");
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
          n.type !== "session" &&
          n.type !== "changes",
      )
      .map((n) => n.id),
  );
  /** Canvas objects (not projects or terminals) in the current selection. */
  const selectedIds = $derived(contextIds);
  const nodeGroupBoxes = $derived(
    groupBoxes(editorState.document?.nodes ?? []),
  );
  const selectionGrouped = $derived.by(() => {
    const members = groupMembers(editorState.document?.nodes ?? []);
    return (editorState.document?.nodes ?? []).some(
      (node) =>
        selectedIds.includes(node.id) &&
        !!node.groupId &&
        members.has(node.groupId),
    );
  });
  let deleteConfirm = $state.raw<string[] | null>(null);
  let lastSelectionKey = "";
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
  const fileArtifact = $derived(
    artifact?.type === "file" ? artifact : undefined,
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
          : artifact?.type === "file"
            ? "file"
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
          : kind === "file" && artifact?.type === "file"
            ? artifact.name
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
        label: `${t.kind === "shell" ? "Terminal" : t.kind === "changes" ? "Changes" : sessions.name(t)} · ${document.projectGroups.find((g) => g.id === t.projectId)?.label ?? "Project"}`,
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
      // Optional tools: a backend that cannot list them still runs the canvas agent.
      const mcpTools = tools
        ? (
            await editor
              .listMcpTools(origin.workspaceId)
              .catch(() => ({ tools: [] }))
          ).tools
        : [];
      controller.signal.throwIfAborted();
      const { reply, operations } = await runCanvasAgent(start, {
        signal: controller.signal,
        tools,
        provider,
        read: (nodeIds) =>
          editor.readConversation({
            ...origin,
            turnId: start.turn.id,
            nodeIds,
          }),
        mcp: mcpTools.length
          ? {
              tools: mcpTools,
              call: (server, tool, args) =>
                editor.callMcp({
                  ...origin,
                  turnId: start.turn.id,
                  server,
                  tool,
                  arguments: args,
                }),
            }
          : undefined,
      });
      controller.signal.throwIfAborted();
      pendingReply = {
        ...origin,
        turnId,
        reply,
        operations,
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
    if (source.type === "file") {
      reader = {
        title: source.name,
        subtitle: `${fileKindLabel(source.mime)} · ${formatFileSize(source.size)} · read-only`,
        text:
          source.text ||
          "No text could be extracted from this file. Open it with the system app to read it.",
        markdown: false,
      };
      return;
    }
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

  /** A drag carries files rather than in-app text or canvas objects. */
  function carriesFiles(event: DragEvent) {
    // `types` is an array in Chromium but a DOMStringList in Firefox.
    return Array.from(event.dataTransfer?.types ?? []).includes("Files");
  }

  /**
   * A file dropped outside the canvas must not replace the app with the file.
   * The canvas handles its own drop before this window listener runs.
   */
  function blockFileDrop(event: DragEvent) {
    if (carriesFiles(event)) event.preventDefault();
  }

  /** Only the canvas takes file drops; everywhere else ignores them. */
  function dragFilesOver(event: DragEvent) {
    if (!canEdit || !carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    dropActive = true;
  }

  function leaveFileDrag(event: DragEvent) {
    // Moving over a child also fires dragleave; stay active inside the canvas.
    if (
      event.relatedTarget instanceof Node &&
      canvasEl?.contains(event.relatedTarget)
    )
      return;
    dropActive = false;
  }

  function dropFiles(event: DragEvent) {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dropActive = false;
    if (!canEdit || !canvasEl) return;
    const flow = toFlow(
      { x: event.clientX, y: event.clientY },
      canvasEl.getBoundingClientRect(),
    );
    void importFiles(event.dataTransfer?.files ?? null, flow);
  }

  /**
   * Copy picked or dropped files into the workspace and place them near the
   * viewport centre or at the drop point. Text is extracted before upload so
   * the agent can read it.
   */
  async function importFiles(files: FileList | null, at?: Point) {
    const picked = files ? [...files] : [];
    // One import at a time keeps progress and uploads in a single order.
    if (!picked.length || importing || !editorState.document || !canEdit)
      return;
    const area = usable();
    const centre = area
      ? areaCentre(viewport, area)
      : {
          x: (340 - viewport.x) / viewport.zoom,
          y: (300 - viewport.y) / viewport.zoom,
        };
    const anchor = at ?? centre;
    importing = true;
    promptError = "";
    try {
      let index = 0;
      for (const file of picked) {
        const mime = fileMime(file);
        if (!mime) {
          promptError = `${file.name} is not a supported file type. Use an image, PDF, Word document, or text file.`;
          continue;
        }
        if (file.size > FILE_LIMITS.maxBytes) {
          promptError = `${file.name} is larger than 8 MB.`;
          continue;
        }
        importName = file.name;
        importProgress = 0;
        const text = await extractFileText(file, mime);
        const bytes = new Uint8Array(await file.arrayBuffer());
        await editor.addFile(
          { name: file.name, mime, size: file.size, text, bytes },
          {
            x: anchor.x - 190 + index * 32,
            y: anchor.y - 150 + index * 32,
          },
          (fraction) => (importProgress = fraction),
        );
        index += 1;
      }
    } catch (error) {
      promptError =
        error instanceof Error ? error.message : "The file could not be added.";
    } finally {
      importing = false;
      importProgress = 0;
      importName = "";
      if (fileInput) fileInput.value = "";
    }
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
    const pastingNow = pasting;
    // Tracked so collapsing or expanding a group rerenders these nodes.
    const groupView = expandedGroups;
    // Task controls rerender on busy, error, retry and "sent N min ago" changes.
    const taskView = { busy: taskBusy, errors: taskErrors, unrecorded };
    void clock.now;
    untrack(() => {
      const renderedById = new Map(
        nodes.map((node) => [node.id, node] as const),
      );
      const artifactsById = new Map(
        (document?.artifacts ?? []).map(
          (artifact) => [artifact.id, artifact] as const,
        ),
      );
      const turnsByNodeId = new Map<string, (typeof turns)[number]>();
      for (const turn of turns) {
        if (!turnsByNodeId.has(turn.promptNodeId))
          turnsByNodeId.set(turn.promptNodeId, turn);
        if (turn.replyNodeId && !turnsByNodeId.has(turn.replyNodeId))
          turnsByNodeId.set(turn.replyNodeId, turn);
      }
      const groupsById = new Map(
        (document?.projectGroups ?? []).map(
          (group) => [group.id, group] as const,
        ),
      );
      const tilesByProject = new Map<
        string,
        NonNullable<typeof document>["sessionTiles"]
      >();
      for (const tile of document?.sessionTiles ?? []) {
        const projectTiles = tilesByProject.get(tile.projectId);
        if (projectTiles) projectTiles.push(tile);
        else tilesByProject.set(tile.projectId, [tile]);
      }
      const assignable = agentTiles();
      const taskData = (
        node: NonNullable<typeof document>["nodes"][number],
        revision: number,
      ) => {
        const task = node.task ?? null;
        const target = assignable.find((t) => t.id === task?.assignedTileId);
        const view = target ? sessions.view(agentOwner(target.id)) : null;
        const status = view?.status ?? null;
        const sentAt = task?.sentAt ? Date.parse(task.sentAt) : null;
        const retry = taskView.unrecorded[node.id];
        return {
          task,
          assignees: assignable,
          sent:
            sentAt === null
              ? ""
              : `Sent ${waitedLabel(sentAt, clock.now)}${task?.assignedTileId ? "" : " to a removed agent"}`,
          edited: editedSinceSent(task, revision),
          // Live hint only; never stored and never changes done.
          attention:
            target && status?.attention.raised
              ? `${target.label}: ${attentionLabel(status)}`
              : "",
          blocker: sendBlocker(
            task,
            target && view
              ? { label: target.label, connected: view.connected, status }
              : null,
          ),
          busy: taskView.busy !== "",
          error: taskView.errors[node.id] ?? "",
          onMark: (enabled: boolean) =>
            void taskAction(node.id, () => editor.setTask(node.id, enabled)),
          onDone: (done: boolean) =>
            void taskAction(node.id, () =>
              editor.updateTask(node.id, { done }),
            ),
          onAssign: (assignedTileId: string | null) =>
            void taskAction(node.id, () =>
              editor.updateTask(node.id, { assignedTileId }),
            ),
          onSend: () => previewTask(node.id),
          onRetry: retry
            ? () =>
                void taskAction(node.id, () =>
                  recordTaskSend(node.id, retry, true),
                )
            : undefined,
        };
      };
      const asNode = (
        node: NonNullable<typeof document>["nodes"][number],
        artifacts: Map<
          string,
          NonNullable<typeof document>["artifacts"][number]
        >,
        preview = false,
      ): Node => {
        const artifact = artifacts.get(node.artifactId)!;
        const turn = turnsByNodeId.get(node.id);
        return {
          ...renderedById.get(node.id),
          id: preview ? `preview-${node.id}` : node.id,
          type:
            artifact.type === "drawing"
              ? "drawing"
              : artifact.type === "file"
                ? "file"
                : "text",
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
              : artifact.type === "file"
                ? {
                    name: artifact.name,
                    mime: artifact.mime,
                    size: artifact.size,
                    text: artifact.text,
                    load: () =>
                      readCanvasFile(
                        connectionKey.trim(),
                        editorState.workspace!.workspace.id,
                        artifact.id,
                      ),
                    onOpen: () =>
                      void openCanvasFile(
                        connectionKey.trim(),
                        editorState.workspace!.workspace.id,
                        artifact.id,
                      ).catch((error: unknown) => {
                        promptError =
                          error instanceof Error
                            ? error.message
                            : "The file could not be opened.";
                      }),
                  }
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
            onRead: preview
              ? undefined
              : artifact.type === "file"
                ? artifact.text
                  ? () => openNodeReader(node.id)
                  : undefined
                : () => openNodeReader(node.id),
            // Conversation cards are not tasks.
            task:
              preview || turn || artifact.type !== "text"
                ? undefined
                : taskData(node, artifact.revision),
          },
        };
      };
      const rendered: Node[] = [];
      if (document && editorState.workspace) {
        if (groupViewCanvasId !== document.canvas.id) {
          groupViewCanvasId = document.canvas.id;
          expandedGroups = {};
          inspectorOpen = false;
          drawerOpen = false;
        }
        const workspaceId = editorState.workspace.workspace.id;
        for (const group of document.projectGroups) {
          const collapsed = groupView[group.id] !== true;
          const tiles = tilesByProject.get(group.id) ?? [];
          const changesTile = tiles.find((t) => t.kind === "changes");
          const processTiles = tiles.filter((t) => t.kind !== "changes");
          const running = sessions.summary(
            workspaceId,
            document.canvas.id,
            group.id,
          );
          rendered.push({
            ...renderedById.get(group.id),
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
                stopped: processTiles.length - running.length,
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
              agents: sessions.capabilities
                ? sessions.agents
                    .filter((agent) => agent.path)
                    .map(({ id, label }) => ({ id, label }))
                : null,
              onAddAgent: (preset: AgentPreset) => {
                expandedGroups = { ...expandedGroups, [group.id]: true };
                void editor.addSessionTile(group.id, "cli-agent", preset);
              },
              onAddTerminal: () => {
                expandedGroups = { ...expandedGroups, [group.id]: true };
                void editor.addSessionTile(group.id, "shell");
              },
              hasChanges: !!changesTile,
              // One Changes tile per project: reveal it instead of adding another.
              onChanges: () => {
                expandedGroups = { ...expandedGroups, [group.id]: true };
                if (changesTile)
                  void tick().then(() => {
                    focusObject(changesTile.id);
                    selectedId = changesTile.id;
                  });
                else void editor.addSessionTile(group.id, "changes");
              },
              onLocate: () => void openProject(group.id),
              onRemove: () => void removeObject(group.id),
              onResize: (width: number, height: number) =>
                editor.placeProject(group.id, { width, height }),
            },
          });
        }
        for (const tile of document.sessionTiles) {
          const group = groupsById.get(tile.projectId)!;
          const owner = {
            workspaceId,
            canvasId: document.canvas.id,
            tileId: tile.id,
          };
          if (tile.kind === "changes") {
            rendered.push({
              ...renderedById.get(tile.id),
              id: tile.id,
              type: "changes",
              parentId: group.id,
              position: { x: tile.x, y: tile.y },
              width: tile.width,
              height: tile.height,
              hidden: groupView[group.id] !== true,
              dragHandle: ".changes-drag",
              extent: [
                [PROJECT_PADDING, PROJECT_HEADER],
                [group.width - PROJECT_PADDING, group.height - PROJECT_PADDING],
              ],
              connectable: false,
              data: {
                kind: "changes",
                tile,
                group,
                state: changes.get(tile.id, {
                  workspaceId,
                  canvasId: document.canvas.id,
                  projectId: group.id,
                }),
                targets: sessions.pasteTargets(
                  workspaceId,
                  document.canvas.id,
                  group.id,
                ),
                pasting: pastingNow,
                editable,
                onExpand: () => (reviewTile = tile.id),
                onPaste: () => void pasteFeedback(tile.id),
                onRemove: () => void removeObject(tile.id),
                onResize: (width: number, height: number) =>
                  editor.placeSessionTile(tile.id, { width, height }),
              },
            });
            continue;
          }
          rendered.push({
            ...renderedById.get(tile.id),
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
        ...(document?.nodes.map((node) => asNode(node, artifactsById)) ?? []),
      );
      edges =
        document?.edges.map((edge) => ({
          id: edge.id,
          source: edge.sourceNodeId,
          target: edge.targetNodeId,
          markerEnd: { type: MarkerType.ArrowClosed },
        })) ?? [];
      // Derived task wires: not canvas edges, and they end at the project
      // header while the project is collapsed.
      edges = [
        ...edges,
        ...(document?.nodes ?? []).flatMap((node) => {
          const target = assignable.find(
            (t) => t.id === node.task?.assignedTileId,
          );
          return target
            ? [
                {
                  id: `task-wire-${node.id}`,
                  source: node.id,
                  target:
                    groupView[target.projectId] === true
                      ? target.id
                      : target.projectId,
                  class: "task-wire",
                  selectable: false,
                  focusable: false,
                  deletable: false,
                },
              ]
            : [];
        }),
      ];
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
          const stagedArtifacts = new Map(
            staged.artifacts.map(
              (artifact) => [artifact.id, artifact] as const,
            ),
          );
          rendered.push(
            ...staged.nodes
              .filter((n) => touched.has(n.id))
              .map((n) => asNode(n, stagedArtifacts, true)),
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
    const document = editorState.document;
    const placements = nodes.map(({ id, position, type }) => ({
      id,
      position,
      type,
    }));
    untrack(() => {
      if (!document) return;
      const nodeById = new Map(
        document.nodes.map((node) => [node.id, node] as const),
      );
      const groupById = new Map(
        document.projectGroups.map((group) => [group.id, group] as const),
      );
      const tileById = new Map(
        document.sessionTiles.map((tile) => [tile.id, tile] as const),
      );
      // A member dragged on its own brings the rest of its group along.
      const positions = followGroups(
        new Map(
          placements
            .filter(({ type }) => type !== "project" && type !== "session")
            .map(({ id, position }) => [id, position]),
        ),
        document.nodes,
      );
      for (const { id, position, type } of placements) {
        if (type === "project") {
          const group = groupById.get(id);
          if (group && (group.x !== position.x || group.y !== position.y))
            editor.placeProject(id, position);
        } else if (type === "session" || type === "changes") {
          const tile = tileById.get(id);
          if (tile && (tile.x !== position.x || tile.y !== position.y))
            editor.placeSessionTile(id, position);
        } else {
          const node = nodeById.get(id);
          const next = positions.get(id) ?? position;
          if (node && (node.x !== next.x || node.y !== next.y))
            editor.placeNode(id, next);
        }
      }
    });
  });

  // Selecting any member of a group selects the whole group.
  $effect(() => {
    const selected = nodes
      .filter((node) => node.selected && !node.id.startsWith("preview-"))
      .map((node) => node.id);
    untrack(() => {
      const expanded = new Set(
        expandToGroups(selected, editorState.document?.nodes ?? []),
      );
      if (expanded.size === selected.length) return;
      nodes = nodes.map((node) =>
        expanded.has(node.id) && !node.selected
          ? { ...node, selected: true }
          : node,
      );
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
        // "Ready" is what the workspace screen shows, so the live region and
        // the visible badge never disagree.
        message = "Ready";
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
    const document = editorState.document;
    const workspaceId = editorState.workspace?.workspace.id;
    if (!(await changes.flush())) {
      if (
        !window.confirm(
          "Feedback could not be saved. Discard unsaved feedback edits and leave this canvas?",
        )
      ) {
        closeNotice =
          "Feedback could not be saved. Keep this canvas open and retry or copy your feedback.";
        return false;
      }
      // Reopening reloads the last saved feedback from storage.
      if (document && workspaceId)
        changes.forgetScope(workspaceId, document.canvas.id);
    }
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
    if (
      !editorState.dirty &&
      !editorState.saving &&
      !pendingReply &&
      !changes.unsaved()
    )
      return;
    event.preventDefault();
    event.returnValue = "";
  }

  const TYPING_TAGS = ["INPUT", "TEXTAREA", "SELECT"];
  const isTyping = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    (target.isContentEditable || TYPING_TAGS.includes(target.tagName));
  /** Focusable controls whose keystrokes never delete canvas objects. */
  const CONTROL_SELECTOR =
    'button, a[href], summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="option"], [role="checkbox"], [role="switch"], [role="slider"]';

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
  async function deleteScope(workspaceId: string, canvasId?: string) {
    const deleted =
      canvasId === undefined
        ? await editor.deleteWorkspace(workspaceId)
        : await editor.deleteCanvas(canvasId);
    if (deleted) changes.forgetScope(workspaceId, canvasId);
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
  function groupSelection() {
    if (!connected || selectedIds.length < 2) return;
    editor.groupNodes(selectedIds);
  }

  function ungroupSelection() {
    if (!connected || !selectionGrouped) return;
    editor.ungroupNodes(selectedIds);
  }

  function clearSelection() {
    selectedId = "";
    if (nodes.some((node) => node.selected))
      nodes = nodes.map((node) =>
        node.selected ? { ...node, selected: false } : node,
      );
  }

  /** Deleting can't be undone, so even one object asks first. */
  function deleteSelection() {
    if (!connected || editorState.busy || !selectedIds.length) return;
    deleteConfirm = [...selectedIds];
  }

  async function deleteObjects(ids: string[]) {
    deleteConfirm = null;
    // One request: a failure leaves every object, still selected, in place.
    await editor.deleteNodes(ids);
    if (!editorState.error) clearSelection();
  }

  async function removeObject(id: string) {
    const document = editorState.document;
    const workspaceId = editorState.workspace?.workspace.id;
    if (!document || !workspaceId) return;
    const group = document.projectGroups.find((g) => g.id === id);
    const tile = document.sessionTiles.find((t) => t.id === id);
    // Hydrate even hidden tiles before counting feedback lost by removal.
    const reviewIds = document.sessionTiles
      .filter(
        (t) => t.kind === "changes" && (t.id === id || t.projectId === id),
      )
      .map((t) => t.id);
    let unchecked = false;
    for (const tileId of reviewIds) {
      const review = document.sessionTiles.find((t) => t.id === tileId)!;
      const state = changes.get(tileId, {
        workspaceId,
        canvasId: document.canvas.id,
        projectId: review.projectId,
      });
      await state.hydrate();
      unchecked ||= !state.hydrated;
    }
    const unsent = changes.pending(reviewIds);
    if (
      unchecked &&
      !window.confirm(
        "Saved feedback in the Changes tile could not be checked and will be deleted with it. Remove anyway?",
      )
    )
      return;
    if (
      !unchecked &&
      unsent &&
      !window.confirm(
        `Discard ${unsent} unsent feedback item${unsent === 1 ? "" : "s"} in the Changes tile?`,
      )
    )
      return;
    if (tile?.kind === "changes") {
      await editor.deleteSessionTile(id);
      return;
    }
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
        sessions.name(tile),
        () => editor.deleteSessionTile(id),
        (s) => s.owner.tileId === id,
      );
    else await editor.deleteNode(id);
  }

  function closeReview() {
    const id = reviewTile;
    reviewTile = null;
    void tick().then(() =>
      window.document.getElementById(`changes-expand-${id}`)?.focus(),
    );
  }

  /** Paste unsent drafts into the chosen agent PTY; the user presses Enter there. */
  async function pasteFeedback(tileId: string) {
    const document = editorState.document;
    const workspaceId = editorState.workspace?.workspace.id;
    const tile = document?.sessionTiles.find((t) => t.id === tileId);
    const state = changes.peek(tileId);
    if (
      !document ||
      !workspaceId ||
      !tile ||
      !state ||
      pasting ||
      !state.hydrated ||
      state.loading
    )
      return;
    const targets = sessions.pasteTargets(
      workspaceId,
      document.canvas.id,
      tile.projectId,
    );
    const target =
      targets.find((t) => t.owner.tileId === state.target) ?? targets[0];
    state.notice = "";
    if (!target) {
      state.error = "Start an agent tile in this project, then retry.";
      return;
    }
    pasting = true;
    state.error = "";
    try {
      const drafts = state.drafts.filter((draft) => !draft.sent);
      const ids = drafts.map((draft) => draft.id);
      await sessions.paste(target.owner, feedbackMessage(drafts));
      state.markSent(ids);
      state.notice = `Pasted — press Enter in ${target.label} to send.`;
      reviewTile = null;
      expandedGroups = { ...expandedGroups, [tile.projectId]: true };
      await tick();
      focusObject(target.owner.tileId);
      selectedId = target.owner.tileId;
      sessions.focus(target.owner);
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      pasting = false;
    }
  }

  /** "Project · <agent> n" for each CLI-agent tile on the open canvas, in tile order. */
  function agentTiles() {
    const document = editorState.document;
    if (!document) return [];
    const labels = sessions.agentLabels(document.sessionTiles);
    return document.projectGroups.flatMap((group) =>
      document.sessionTiles
        .filter((t) => t.projectId === group.id && t.kind === "cli-agent")
        .map((tile) => ({
          id: tile.id,
          projectId: group.id,
          label: `${group.label} · ${labels.get(tile.id)!}`,
        })),
    );
  }

  function agentOwner(tileId: string) {
    return {
      workspaceId: editorState.workspace!.workspace.id,
      canvasId: editorState.document!.canvas.id,
      tileId,
    };
  }

  function setTaskError(nodeId: string, error: unknown) {
    taskErrors = {
      ...taskErrors,
      [nodeId]:
        error instanceof Error ? error.message : error ? String(error) : "",
    };
  }

  async function taskAction(nodeId: string, run: () => Promise<void>) {
    if (taskBusy) return;
    taskBusy = nodeId;
    setTaskError(nodeId, "");
    try {
      await run();
    } catch (error) {
      setTaskError(nodeId, error);
      // A stale task revision means another client changed it; show theirs.
      if (error instanceof RuntimeCallError && error.code === "CONFLICT")
        void editor.reloadConversation();
    } finally {
      taskBusy = "";
    }
  }

  /** Open the send preview with the saved text the backend will paste. */
  function previewTask(nodeId: string) {
    void taskAction(nodeId, async () => {
      const node = editorState.document?.nodes.find((n) => n.id === nodeId);
      const target = agentTiles().find(
        (t) => t.id === node?.task?.assignedTileId,
      );
      if (!target) throw new Error("Assign an agent tile to send this task.");
      const { text, revision } = await editor.settledText(nodeId);
      taskSend = {
        nodeId,
        tileId: target.id,
        label: target.label,
        text,
        revision,
        ...taskPayload(text),
      };
    });
  }

  async function focusTile(tileId: string, projectId: string) {
    expandedGroups = { ...expandedGroups, [projectId]: true };
    await tick();
    focusObject(tileId);
    selectedId = tileId;
    sessions.focus(agentOwner(tileId));
  }

  async function recordTaskSend(
    nodeId: string,
    sent: { tileId: string; label: string; revision: number },
    retry = false,
  ) {
    try {
      await editor.recordSent(nodeId, sent.tileId, sent.revision, retry);
      const { [nodeId]: _, ...rest } = unrecorded;
      unrecorded = rest;
    } catch (error) {
      unrecorded = { ...unrecorded, [nodeId]: sent };
      setTaskError(
        nodeId,
        `Pasted into ${sent.label}, but the send was not recorded: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Guarded paste, then record, then hand focus to the terminal. Never presses Enter. */
  async function confirmTaskSend() {
    const send = taskSend;
    if (!send || taskBusy || !send.fits || send.empty) return;
    taskBusy = send.nodeId;
    setTaskError(send.nodeId, "");
    try {
      try {
        await sessions.paste(agentOwner(send.tileId), send.payload, {
          refuseIfAttention: true,
        });
      } catch (error) {
        setTaskError(
          send.nodeId,
          error instanceof RuntimeCallError && error.code === "ATTENTION_RAISED"
            ? `${send.label} needs attention. Check it first; nothing was pasted.`
            : error,
        );
        return;
      } finally {
        taskSend = null;
      }
      await recordTaskSend(send.nodeId, send);
      const tile = agentTiles().find((t) => t.id === send.tileId);
      if (tile) await focusTile(tile.id, tile.projectId);
    } finally {
      taskBusy = "";
    }
  }

  // The preview is only valid for the text and assignee it showed.
  $effect(() => {
    const send = taskSend;
    const document = editorState.document;
    if (!send) return;
    const node = document?.nodes.find((n) => n.id === send.nodeId);
    const artifact = document?.artifacts.find((a) => a.id === node?.artifactId);
    if (
      artifact?.type !== "text" ||
      artifact.revision !== send.revision ||
      artifact.text !== send.text ||
      node?.task?.assignedTileId !== send.tileId
    ) {
      taskSend = null;
      untrack(() =>
        setTaskError(
          send.nodeId,
          "The task changed while the preview was open. Review it again before sending.",
        ),
      );
    }
  });

  function onKeydown(event: KeyboardEvent) {
    const dialogOpen =
      settingsOpen ||
      reader ||
      projectDialog ||
      removal ||
      reviewTile ||
      taskSend ||
      deleteConfirm;
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
      else if (stage === "editor" && !isTyping(event.target)) clearSelection();
      return;
    }
    // Ctrl/Cmd+Z undoes canvas edits; text fields keep their own undo.
    if (
      stage === "editor" &&
      (apple ? event.metaKey : event.ctrlKey) &&
      !event.altKey &&
      !isTyping(event.target)
    ) {
      const key = event.key.toLowerCase();
      const redo = (key === "z" && event.shiftKey) || (key === "y" && !apple);
      if (key === "z" || redo) {
        event.preventDefault();
        if (!connected) return;
        if (redo) editor.redo();
        else editor.undo();
        return;
      }
    }
    if (
      stage === "editor" &&
      editorState.document &&
      !editorState.busy &&
      !isTyping(event.target)
    ) {
      const zoomFactor = getZoomShortcutFactor(event);
      if (zoomFactor !== null) {
        event.preventDefault();
        zoomBy(zoomFactor);
        return;
      }
      if (isZoomResetShortcut(event)) {
        event.preventDefault();
        zoomBy(1 / viewport.zoom);
        return;
      }
    }
    if (stage === "editor" && !isTyping(event.target)) {
      const mod = apple ? event.metaKey : event.ctrlKey;
      // Ctrl/Cmd+G groups, Ctrl/Cmd+Shift+G ungroups the selection.
      if (mod && !event.altKey && event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (event.shiftKey) ungroupSelection();
        else groupSelection();
        return;
      }
      // A focused button or link keeps the key: deletion only follows
      // keystrokes on the canvas itself, never on a control.
      if (
        !mod &&
        !event.altKey &&
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedIds.length &&
        !target?.closest(CONTROL_SELECTOR)
      ) {
        event.preventDefault();
        deleteSelection();
        return;
      }
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
          const savedFeedback = await changes.flush();
          if (
            !savedFeedback &&
            !window.confirm(
              "Feedback could not be saved. Discard unsaved feedback edits and close this window?",
            )
          )
            return;
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

{#if taskSend}
  {@const send = taskSend}
  <Modal
    title={`Send task to ${send.label}?`}
    subtitle="This exact text is pasted as one block without Enter. You submit it in the terminal."
    icon="send"
    onClose={() => {
      if (!taskBusy) taskSend = null;
    }}
  >
    <pre class="task-preview" aria-label="Text to paste">{send.payload}</pre>
    <p class:card-error={!send.fits} role={send.fits ? undefined : "alert"}>
      {send.bytes.toLocaleString()} of {MAX_TASK_BYTES.toLocaleString()} bytes{send.fits
        ? ""
        : " — too large to paste. Shorten the text, then retry."}
    </p>
    {#if send.empty}<p role="alert">There is no text to send.</p>{/if}
    <div class="project-dialog-actions">
      <button
        class="btn btn--soft"
        type="button"
        disabled={!!taskBusy}
        onclick={() => (taskSend = null)}>Cancel</button
      >{#if send.fits && !send.empty}<button
          class="btn btn--primary"
          type="button"
          disabled={!!taskBusy}
          onclick={() => void confirmTaskSend()}
          >{taskBusy ? "Pasting…" : `Paste into ${send.label}`}</button
        >{/if}
    </div>
  </Modal>
{/if}

{#if reviewTile && editorState.document && editorState.workspace}
  {@const tile = editorState.document.sessionTiles.find(
    (t) => t.id === reviewTile,
  )}
  {#if tile}
    <ChangesOverlay
      tileId={tile.id}
      label={editorState.document.projectGroups.find(
        (g) => g.id === tile.projectId,
      )?.label ?? "Project"}
      state={changes.get(tile.id, {
        workspaceId: editorState.workspace.workspace.id,
        canvasId: editorState.document.canvas.id,
        projectId: tile.projectId,
      })}
      targets={reviewTargets}
      {pasting}
      onPaste={() => void pasteFeedback(tile.id)}
      onClose={closeReview}
    />
  {/if}
{/if}

<svelte:window
  onbeforeunload={beforeUnload}
  onkeydown={onKeydown}
  ondragover={blockFileDrop}
  ondrop={blockFileDrop}
/>

<!-- One live region per screen context. The workspace and editor screens
     share this one; the canvas screen renders its own inside its modal
     dialog, because a modal makes the rest of the page inert. -->
{#if stage !== "canvas"}
  <p class="sr-only" role="status" aria-live="polite">{message}</p>
{/if}

{#snippet connectionControls()}
  <!-- The workspace screen shows the controls on demand, so the bar stays
       rendered there even while connected. -->
  {#if stage === "workspace" || !connected}
    <div
      class="connbar"
      class:connbar--ok={connected}
      class:connbar--bad={status === "failed"}
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
          () => deleteScope(id),
        )}
      onOpenSettings={() => (settingsOpen = true)}
    />
  {:else if stage === "canvas"}
    <CanvasPicker
      workspaceName={editorState.workspace?.workspace.name ??
        "Unnamed workspace"}
      canvases={editorState.workspace?.canvases ?? []}
      connection={connectionControls}
      connectionMessage={message}
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
          () => deleteScope(editorState.workspace!.workspace.id, id),
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
            name={(tile) => sessions.name(tile)}
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
    {#if importing}
      <div class="banner" role="status">
        <Icon name="upload_file" size={18} />
        <span>
          Importing {importName || "file"}… {Math.round(importProgress * 100)}%
        </span>
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
              settingsOpen = "ai";
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
        ondragover={dragFilesOver}
        ondragleave={leaveFileDrag}
        ondrop={dropFiles}
      >
        <input
          hidden
          type="file"
          multiple
          accept={FILE_ACCEPT}
          bind:this={fileInput}
          onchange={(event) => void importFiles(event.currentTarget.files)}
        />
        {#if canEdit && dropActive}
          <div class="canvas__drop" aria-hidden="true">
            <Icon name="upload_file" size={28} />
            <span>Drop files to copy them onto the canvas</span>
          </div>
        {/if}
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
            selectionOnDrag={tool === "select" && !editorState.busy}
            selectionMode={SelectionMode.Full}
            panOnDrag={editorState.busy
              ? false
              : tool === "select"
                ? [1, 2]
                : !isDrawingTool}
            panOnScroll={!isDrawingTool && !editorState.busy}
            zoomOnScroll={false}
            zoomActivationKey={["Control", "Meta"]}
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
            onnodedragstart={() => editor.checkpoint(true)}
            onnodedragstop={() => editor.release()}
            onselectionchange={({ nodes: chosen }) => {
              const ids = chosen
                .map((node) => node.id)
                .filter((id) => !id.startsWith("preview-"));
              // The inspector follows a new box selection; re-renders that
              // keep the same selection never override an explicit choice.
              const key = [...ids].sort().join(",");
              if (key === lastSelectionKey) return;
              lastSelectionKey = key;
              if (ids.length && !ids.includes(selectedId)) selectedId = ids[0]!;
            }}
            onmove={(_, next) => editor.setViewport(next)}
          >
            <Background patternColor={dark ? "#2c2c30" : "#d9dbe4"} gap={24} />
            <ViewportPortal target="back">
              {#each nodeGroupBoxes as box (box.groupId)}
                <div
                  class="node-group"
                  class:node-group--selected={box.memberIds.some((id) =>
                    selectedIds.includes(id),
                  )}
                  data-group={box.groupId}
                  style:transform={`translate(${box.x}px, ${box.y}px)`}
                  style:width={`${box.width}px`}
                  style:height={`${box.height}px`}
                  aria-hidden="true"
                >
                  <span class="node-group__label"
                    ><Icon name="workspaces" size={12} /> Group · {box.memberIds
                      .length}</span
                  >
                </div>
              {/each}
            </ViewportPortal>
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
            <button
              class="btn btn--soft"
              type="button"
              disabled={!canEdit || importing}
              onclick={() => fileInput?.click()}
            >
              <Icon name="upload_file" size={18} />
              Add a file
            </button>
          </div>
        {/if}

        {#if editorState.document}
          <CanvasNavigation
            zoom={viewport.zoom}
            canFocus={!!selectedId}
            disabled={editorState.busy}
            canUndo={connected && editorState.canUndo}
            canRedo={connected && editorState.canRedo}
            {apple}
            onUndo={() => editor.undo()}
            onRedo={() => editor.redo()}
            onZoom={zoomBy}
            onReset={() => zoomBy(1 / viewport.zoom)}
            onFit={fitCanvas}
            onFocus={focusSelection}
          />
        {/if}

        <!-- One measured stack: tools, recovery, review, and composer never overlap. -->
        <div class="canvas-dock">
          {#if editorState.document && (selectedIds.length >= 2 || selectionGrouped)}
            <SelectionBar
              count={selectedIds.length}
              grouped={selectionGrouped}
              disabled={!connected || editorState.busy}
              {apple}
              onGroup={groupSelection}
              onUngroup={ungroupSelection}
              onDelete={deleteSelection}
            />
          {/if}
          {#if toolbarOpen}
            <CanvasToolbar
              {tool}
              color={strokeColor}
              width={strokeWidth}
              fileDisabled={!canEdit || importing}
              onSelect={selectTool}
              onColor={(value) => (strokeColor = value)}
              onWidth={(value) => (strokeWidth = value)}
              onFile={() => fileInput?.click()}
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
                  ? `The ${contextIds.length} selected ${contextIds.length === 1 ? "object" : "objects"}: position, size, text, extracted file text, and connections between them.`
                  : "No selected notes or drawings. Native sessions are excluded."
                : "Canvas notes, drawings, files, and conversation cards: position, size, text, extracted file text, and connections.",
              "Up to 8 earlier prompts and replies from this canvas, with their outcomes.",
              "Select objects before sending to limit what is shared.",
            ]}
            notice={toolsNotice}
            onCancel={() => conversationAbort?.abort()}
            onToggleToolbar={() => (toolbarOpen = !toolbarOpen)}
            onAddFile={() => fileInput?.click()}
            addFileDisabled={!canEdit || importing}
            onSubmit={handlePromptSubmit}
            onTranscribe={(audio, _format, signal, onStage) =>
              transcribeSpeech(audio, signal, (progress) => {
                if (progress.stage === "decoding")
                  onStage?.({ label: "Preparing audio…" });
                else if (progress.stage === "downloading")
                  onStage?.({
                    label:
                      progress.percent !== undefined
                        ? `Downloading speech model… ${progress.percent}% (first use only)`
                        : "Preparing speech model… (first use only)",
                  });
                else onStage?.({ label: "Transcribing your voice…" });
              })}
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
            {#if fileArtifact}
              <div class="field">
                <span class="field__label">File</span>
                <p class="muted">
                  {fileArtifact.name} · {fileKindLabel(fileArtifact.mime)} · {formatFileSize(
                    fileArtifact.size,
                  )}
                </p>
                <p class="muted">
                  Copied into this workspace. Selected file text is included in
                  the next prompt for the agent.
                </p>
                <div class="inspector__actions">
                  <button
                    class="btn btn--soft"
                    type="button"
                    onclick={() => {
                      if (!editorState.document) return;
                      void openCanvasFile(
                        connectionKey.trim(),
                        editorState.workspace!.workspace.id,
                        fileArtifact.id,
                      ).catch((error: unknown) => {
                        promptError =
                          error instanceof Error
                            ? error.message
                            : "The file could not be opened.";
                      });
                    }}
                  >
                    <Icon name="open_in_new" size={16} />{desktopMode
                      ? "Open with system app"
                      : "Download a copy"}
                  </button>
                  {#if fileArtifact.text}
                    <button
                      class="btn btn--soft"
                      type="button"
                      onclick={() => openNodeReader(selected.id)}
                    >
                      <Icon name="open_in_full" size={16} />Read extracted text
                    </button>
                  {/if}
                </div>
                {#if !fileArtifact.text}
                  <p class="muted">
                    No text could be extracted; images and legacy Word files are
                    preview-only.
                  </p>
                {/if}
              </div>
            {/if}
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

  {#if deleteConfirm}
    {@const ids = deleteConfirm}
    <Modal
      title={`Delete ${ids.length} ${ids.length === 1 ? "object" : "objects"}?`}
      subtitle="Connections are removed too. Deleting can't be undone."
      icon="delete"
      onClose={() => (deleteConfirm = null)}
    >
      <div class="confirm-actions">
        <button
          class="btn btn--ghost"
          type="button"
          onclick={() => (deleteConfirm = null)}>Cancel</button
        >
        <button
          class="btn btn--danger"
          type="button"
          disabled={editorState.busy}
          onclick={() => void deleteObjects(ids)}>Delete {ids.length}</button
        >
      </div>
    </Modal>
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
      workspaceId={editorState.workspace?.workspace.id}
      {sessions}
      section={settingsOpen === true ? undefined : settingsOpen}
      onChange={(next) => (theme = next)}
      onClose={() => (settingsOpen = false)}
    />
  {/if}
</div>
