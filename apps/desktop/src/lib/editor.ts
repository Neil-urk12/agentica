import {
  MAX_FRAME_BYTES,
  type Drawing,
  type RuntimeResult,
  type RuntimeParams,
  type ConversationTurn,
  PROJECT_HEADER,
  PROJECT_PADDING,
  type AgentPreset,
  type ProjectGroup,
  type SessionTile,
  type Task,
} from "@agentica/protocol";
import type { callRuntime } from "./runtime";

export type CanvasDocument = RuntimeResult<"canvas.open">;
type Placement = CanvasDocument["nodes"][number];
type Viewport = CanvasDocument["canvas"]["viewport"];
type Artifact = CanvasDocument["artifacts"][number];
type LayoutNode = Pick<Placement, "id" | "x" | "y" | "width" | "height">;
type LayoutGroup = Pick<
  ProjectGroup,
  "id" | "x" | "y" | "width" | "height" | "collapsed"
>;
type LayoutTile = Pick<
  SessionTile,
  "id" | "projectId" | "x" | "y" | "width" | "height"
>;
interface CanvasLayout {
  viewport: Viewport;
  nodes: LayoutNode[];
  projectGroups?: LayoutGroup[];
  sessionTiles?: LayoutTile[];
}
interface CanvasLayoutBatch {
  nodes: LayoutNode[];
  projectGroups: LayoutGroup[];
  sessionTiles: LayoutTile[];
}
interface CanvasLayoutChanges extends CanvasLayoutBatch {
  viewport: boolean;
}
const emptyLayoutBatch = (): CanvasLayoutBatch => ({
  nodes: [],
  projectGroups: [],
  sessionTiles: [],
});
const layoutHasItems = (batch: CanvasLayoutBatch) =>
  batch.nodes.length > 0 ||
  batch.projectGroups.length > 0 ||
  batch.sessionTiles.length > 0;

/** One drawing to persist: where its node sits and what it contains. */
export interface DrawingSegment {
  geometry: { x: number; y: number; width: number; height: number };
  drawing: Drawing;
}

/** Comparable content, so unsaved work is detected for text and drawings alike. */
function content(artifact: Artifact): string {
  return artifact.type === "text"
    ? artifact.text
    : JSON.stringify(artifact.drawing);
}

export interface EditorState {
  workspaces: RuntimeResult<"workspace.list">["workspaces"];
  workspace: RuntimeResult<"workspace.open"> | null;
  document: CanvasDocument | null;
  busy: boolean;
  saving: boolean;
  dirty: boolean;
  error: string;
  turns: ConversationTurn[];
}

// One buffer and save queue for either transport; acknowledgements never replace drafts.
export class Editor {
  state: EditorState = {
    workspaces: [],
    workspace: null,
    document: null,
    busy: false,
    saving: false,
    dirty: false,
    error: "",
    turns: [],
  };
  private call: typeof callRuntime;
  private key: () => string;
  private changed: (state: EditorState) => void;
  private savedArtifacts = new Map<string, string>();
  private attemptedArtifacts = new Map<string, string>();
  private attemptedDrawing: {
    node: Placement;
    artifact: Artifact;
    revision: number;
  } | null = null;
  private nodeIds = new Map<string, string>();
  /** The `sentAt` each node's latest send attempt started from. */
  private sendAttempts = new Map<string, string | null>();
  private savedLayout = "";
  private attemptedLayout = "";
  private savedProjectMetadata = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private mutations: Promise<void> = Promise.resolve();
  private savingTask: Promise<void> | null = null;
  private disposed = false;

  constructor(
    call: typeof callRuntime,
    key: () => string,
    changed: (state: EditorState) => void,
  ) {
    this.call = call;
    this.key = key;
    this.changed = changed;
  }

  /**
   * Comparable layout for persistence. A node whose drawing has not been
   * created on the server yet is a draft: `canvas.save` only updates existing
   * nodes, so a pending node is left out until `node.createDrawing` returns.
   */
  private layout(document: CanvasDocument): CanvasLayout {
    const pending = new Set(
      document.artifacts
        .filter((artifact) => !this.savedArtifacts.has(artifact.id))
        .map((artifact) => artifact.id),
    );
    return {
      viewport: document.canvas.viewport,
      nodes: document.nodes
        .filter((node) => !pending.has(node.artifactId))
        .map(({ id, x, y, width, height }) => ({
          id,
          x,
          y,
          width,
          height,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      ...((document.projectGroups ?? []).length
        ? {
            projectGroups: document.projectGroups
              .map(({ id, x, y, width, height, collapsed }) => ({
                id,
                x,
                y,
                width,
                height,
                collapsed,
              }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          }
        : {}),
      ...((document.sessionTiles ?? []).length
        ? {
            sessionTiles: document.sessionTiles
              .map(({ id, projectId, x, y, width, height }) => ({
                id,
                projectId,
                x,
                y,
                width,
                height,
              }))
              .sort((a, b) => a.id.localeCompare(b.id)),
          }
        : {}),
    };
  }

  /** Objects whose geometry or viewport differs from the last saved layout. */
  private layoutChanges(snapshot: CanvasLayout): CanvasLayoutChanges {
    const saved = JSON.parse(this.savedLayout) as CanvasLayout;
    const nodes = new Map(saved.nodes.map((node) => [node.id, node]));
    const groups = new Map(
      (saved.projectGroups ?? []).map((group) => [group.id, group]),
    );
    const tiles = new Map(
      (saved.sessionTiles ?? []).map((tile) => [tile.id, tile]),
    );
    return {
      viewport:
        JSON.stringify(snapshot.viewport) !== JSON.stringify(saved.viewport),
      nodes: snapshot.nodes.filter(
        (node) => JSON.stringify(nodes.get(node.id)) !== JSON.stringify(node),
      ),
      projectGroups: (snapshot.projectGroups ?? []).filter(
        (group) =>
          JSON.stringify(groups.get(group.id)) !== JSON.stringify(group),
      ),
      sessionTiles: (snapshot.sessionTiles ?? []).filter(
        (tile) => JSON.stringify(tiles.get(tile.id)) !== JSON.stringify(tile),
      ),
    };
  }

  /** One `canvas.save` request for a batch, with each object's revision. */
  private canvasSaveRequest(
    workspaceId: string,
    canvasId: string,
    viewport: Viewport,
    batch: CanvasLayoutBatch,
    canvasRevision: number,
    groupRevision: (id: string) => number,
    tileRevision: (id: string) => number,
  ) {
    return {
      workspaceId,
      canvasId,
      expectedRevision: canvasRevision,
      viewport,
      nodes: batch.nodes,
      ...(batch.projectGroups.length
        ? {
            projectGroups: batch.projectGroups.map((group) => ({
              ...group,
              expectedRevision: groupRevision(group.id),
            })),
          }
        : {}),
      ...(batch.sessionTiles.length
        ? {
            sessionTiles: batch.sessionTiles.map((tile) => ({
              ...tile,
              expectedRevision: tileRevision(tile.id),
            })),
          }
        : {}),
    };
  }

  /** Upper bound on the serialized size of one `canvas.save` request. */
  private canvasSaveBytes(
    workspaceId: string,
    canvasId: string,
    viewport: Viewport,
    batch: CanvasLayoutBatch,
  ): number {
    return new TextEncoder().encode(
      JSON.stringify({
        protocolVersion: 1,
        id: "00000000-0000-4000-8000-000000000000",
        method: "canvas.save",
        params: this.canvasSaveRequest(
          workspaceId,
          canvasId,
          viewport,
          batch,
          Number.MAX_SAFE_INTEGER,
          () => Number.MAX_SAFE_INTEGER,
          () => Number.MAX_SAFE_INTEGER,
        ),
      }),
    ).length;
  }

  /** Split changed objects so every `canvas.save` request fits one frame. */
  private layoutBatches(
    workspaceId: string,
    canvasId: string,
    snapshot: CanvasLayout,
    changes: CanvasLayoutChanges,
  ): CanvasLayoutBatch[] {
    const batches: CanvasLayoutBatch[] = [];
    let batch = emptyLayoutBatch();
    const encoder = new TextEncoder();
    const itemBytes = (value: unknown) =>
      encoder.encode(JSON.stringify(value)).length;
    const baseBytes = this.canvasSaveBytes(
      workspaceId,
      canvasId,
      snapshot.viewport,
      emptyLayoutBatch(),
    );
    const projectGroupsKeyBytes = ',"projectGroups":[]'.length;
    const sessionTilesKeyBytes = ',"sessionTiles":[]'.length;
    let counts = { nodes: 0, projectGroups: 0, sessionTiles: 0 };
    let bytes = baseBytes;
    // Size a unit against the objects already in the batch without
    // re-serializing the batch itself: array commas and the first occurrence
    // of an optional key are the only differences from the sum of the items.
    const unitBytes = (unit: CanvasLayoutBatch) => {
      let size = 0;
      let nodes = counts.nodes;
      let groups = counts.projectGroups;
      let tiles = counts.sessionTiles;
      for (const node of unit.nodes)
        size += (nodes++ > 0 ? 1 : 0) + itemBytes(node);
      for (const group of unit.projectGroups)
        size +=
          (groups++ > 0 ? 1 : projectGroupsKeyBytes) +
          itemBytes({ ...group, expectedRevision: Number.MAX_SAFE_INTEGER });
      for (const tile of unit.sessionTiles)
        size +=
          (tiles++ > 0 ? 1 : sessionTilesKeyBytes) +
          itemBytes({ ...tile, expectedRevision: Number.MAX_SAFE_INTEGER });
      return size;
    };
    const grouped = new Set(changes.projectGroups.map((group) => group.id));
    // The runtime checks after each request that every tile fits its project,
    // so a project travels with its changed tiles: a shrink and the tile moves
    // that make room for it must commit together.
    const units: CanvasLayoutBatch[] = [
      ...changes.nodes.map((node) => ({
        ...emptyLayoutBatch(),
        nodes: [node],
      })),
      ...changes.projectGroups.map((group) => ({
        ...emptyLayoutBatch(),
        projectGroups: [group],
        sessionTiles: changes.sessionTiles.filter(
          (tile) => tile.projectId === group.id,
        ),
      })),
      ...changes.sessionTiles
        .filter((tile) => !grouped.has(tile.projectId))
        .map((tile) => ({ ...emptyLayoutBatch(), sessionTiles: [tile] })),
    ];
    for (const unit of units) {
      let size = unitBytes(unit);
      if (layoutHasItems(batch) && bytes + size > MAX_FRAME_BYTES) {
        batches.push(batch);
        batch = emptyLayoutBatch();
        counts = { nodes: 0, projectGroups: 0, sessionTiles: 0 };
        bytes = baseBytes;
        size = unitBytes(unit);
      }
      if (size > MAX_FRAME_BYTES)
        throw new Error(
          `A project and its ${unit.sessionTiles.length} moved tiles need ${size} bytes, but one save request holds ${MAX_FRAME_BYTES}. Move fewer tiles at once, then save again.`,
        );
      bytes += size;
      counts = {
        nodes: counts.nodes + unit.nodes.length,
        projectGroups: counts.projectGroups + unit.projectGroups.length,
        sessionTiles: counts.sessionTiles + unit.sessionTiles.length,
      };
      batch = {
        nodes: [...batch.nodes, ...unit.nodes],
        projectGroups: [...batch.projectGroups, ...unit.projectGroups],
        sessionTiles: [...batch.sessionTiles, ...unit.sessionTiles],
      };
    }
    if (layoutHasItems(batch)) batches.push(batch);
    else if (changes.viewport) batches.push(emptyLayoutBatch());
    return batches;
  }

  /** Apply one committed batch to the comparable saved layout. */
  private applyLayoutBatch(
    saved: CanvasLayout,
    viewport: Viewport,
    batch: CanvasLayoutBatch,
  ): CanvasLayout {
    const nodes = new Map(saved.nodes.map((node) => [node.id, node]));
    for (const node of batch.nodes) nodes.set(node.id, node);
    const groups = new Map(
      (saved.projectGroups ?? []).map((group) => [group.id, group]),
    );
    for (const group of batch.projectGroups) groups.set(group.id, group);
    const tiles = new Map(
      (saved.sessionTiles ?? []).map((tile) => [tile.id, tile]),
    );
    for (const tile of batch.sessionTiles) tiles.set(tile.id, tile);
    // The saved layout is already sorted by id, and Map#set keeps that order,
    // so a retry can compare layouts byte for byte.
    return {
      viewport,
      nodes: [...nodes.values()],
      ...(groups.size ? { projectGroups: [...groups.values()] } : {}),
      ...(tiles.size ? { sessionTiles: [...tiles.values()] } : {}),
    };
  }

  /**
   * Persist only changed objects, in frame-sized requests. Each request commits
   * one batch, so a failure keeps the confirmed batches and retries the rest.
   */
  private async saveLayout(
    workspaceId: string,
    current: CanvasDocument,
    snapshot: CanvasLayout,
  ) {
    const batches = this.layoutBatches(
      workspaceId,
      current.canvas.id,
      snapshot,
      this.layoutChanges(snapshot),
    );
    if (!batches.length) {
      this.savedLayout = JSON.stringify(snapshot);
      this.attemptedLayout = "";
      return;
    }
    let progress = JSON.parse(this.savedLayout) as CanvasLayout;
    let revision = current.canvas.revision;
    for (const batch of batches) {
      // Revisions come from the save-start document: each object appears in one
      // batch, so earlier batches cannot have changed its revision.
      const groupRevisions = new Map(
        batch.projectGroups.map((group) => [
          group.id,
          current.projectGroups.find((item) => item.id === group.id)!.revision,
        ]),
      );
      const tileRevisions = new Map(
        batch.sessionTiles.map((tile) => [
          tile.id,
          current.sessionTiles.find((item) => item.id === tile.id)!.revision,
        ]),
      );
      progress = this.applyLayoutBatch(progress, snapshot.viewport, batch);
      // A lost reply may have committed exactly this batch.
      this.attemptedLayout = JSON.stringify(progress);
      const result = await this.call(
        this.key(),
        false,
        "canvas.save",
        this.canvasSaveRequest(
          workspaceId,
          current.canvas.id,
          snapshot.viewport,
          batch,
          revision,
          (id) => groupRevisions.get(id)!,
          (id) => tileRevisions.get(id)!,
        ),
      );
      this.savedLayout = JSON.stringify(progress);
      this.attemptedLayout = "";
      revision = result.revision;
      const latest = this.state.document!;
      this.publish({
        document: {
          ...latest,
          canvas: { ...latest.canvas, revision: result.revision },
          ...(batch.projectGroups.length
            ? {
                projectGroups: latest.projectGroups.map((group) =>
                  groupRevisions.has(group.id)
                    ? {
                        ...group,
                        revision: groupRevisions.get(group.id)! + 1,
                      }
                    : group,
                ),
              }
            : {}),
          ...(batch.sessionTiles.length
            ? {
                sessionTiles: latest.sessionTiles.map((tile) =>
                  tileRevisions.has(tile.id)
                    ? {
                        ...tile,
                        revision: tileRevisions.get(tile.id)! + 1,
                      }
                    : tile,
                ),
              }
            : {}),
        },
      });
    }
    // Every batch committed: the snapshot is now the saved baseline.
    this.savedLayout = JSON.stringify(snapshot);
    this.attemptedLayout = "";
  }

  private publish(update: Partial<EditorState> = {}) {
    this.state = { ...this.state, ...update };
    const document = this.state.document;
    this.state.dirty =
      !!document &&
      (this.attemptedArtifacts.size > 0 ||
        !!this.attemptedLayout ||
        JSON.stringify(this.layout(document)) !== this.savedLayout ||
        document.artifacts.some(
          (artifact) =>
            content(artifact) !== this.savedArtifacts.get(artifact.id),
        ));
    if (!this.disposed) this.changed(this.state);
  }

  private fail(error: unknown) {
    this.publish({
      error:
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "The operation failed. Try again.",
    });
  }

  private load(document: CanvasDocument, turns?: ConversationTurn[]) {
    if (document.canvas.id !== this.state.document?.canvas.id) {
      this.nodeIds.clear();
      this.state = { ...this.state, turns: [] };
    }
    this.savedArtifacts = new Map(
      document.artifacts.map((artifact) => [artifact.id, content(artifact)]),
    );
    this.attemptedArtifacts.clear();
    this.attemptedDrawing = null;
    this.savedLayout = JSON.stringify(this.layout(document));
    this.savedProjectMetadata = this.projectMetadata(document);
    this.attemptedLayout = "";
    this.publish({ document, ...(turns ? { turns } : {}) });
  }

  private projectMetadata(document: CanvasDocument) {
    return JSON.stringify({
      groups: (document.projectGroups ?? [])
        .map(({ id, root, label }) => ({ id, root, label }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      tiles: (document.sessionTiles ?? [])
        .map(({ id, projectId, kind, preset }) => ({
          id,
          projectId,
          kind,
          preset,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    });
  }

  private async projectMutation<T>(
    run: (reference: {
      workspaceId: string;
      canvasId: string;
      expectedRevision: number;
    }) => Promise<T>,
  ): Promise<T | undefined> {
    let result: T | undefined;
    await this.enqueue(async () => {
      await this.settleSave();
      const document = this.state.document;
      const workspaceId = this.state.workspace?.workspace.id;
      // A failed save must be recovered first; an earlier rejected mutation
      // (for example an invalid folder path) must not block a corrected retry.
      if (
        !document ||
        !workspaceId ||
        (this.state.dirty && this.state.error) ||
        this.disposed
      )
        return;
      await this.mutation(async () => {
        result = await run({
          workspaceId,
          canvasId: document.canvas.id,
          expectedRevision: document.canvas.revision,
        });
        this.load(
          await this.call(this.key(), false, "canvas.open", {
            workspaceId,
            canvasId: document.canvas.id,
          }),
        );
      });
    });
    return result;
  }

  async openProject(path: string, position?: { x: number; y: number }) {
    const document = this.state.document;
    if (!document) return;
    const view = document.canvas.viewport;
    let x = position?.x ?? (40 - view.x) / view.zoom;
    const y = position?.y ?? (40 - view.y) / view.zoom;
    for (let attempt = 0; attempt <= document.projectGroups.length; attempt++) {
      const overlap = document.projectGroups.find(
        (group) =>
          group.x < x + 680 + 32 &&
          group.x + group.width + 32 > x &&
          group.y < y + 600 + 32 &&
          group.y + (group.collapsed ? PROJECT_HEADER : group.height) + 32 > y,
      );
      if (!overlap) break;
      x = overlap.x + overlap.width + 48;
    }
    return this.projectMutation((reference) =>
      this.call(this.key(), false, "project.open", {
        ...reference,
        path,
        x,
        y,
        width: 680,
        height: 600,
      }),
    );
  }

  async deleteProject(projectId: string) {
    return this.projectMutation((reference) =>
      this.call(this.key(), false, "project.delete", {
        ...reference,
        projectId,
      }),
    );
  }
  async deleteSessionTile(tileId: string) {
    return this.projectMutation((reference) =>
      this.call(this.key(), false, "project.deleteTile", {
        ...reference,
        tileId,
      }),
    );
  }

  async locateProject(projectId: string, path: string) {
    return this.projectMutation((reference) =>
      this.call(this.key(), false, "project.locate", {
        ...reference,
        projectId,
        path,
      }),
    );
  }

  /** `preset` names the agent for a CLI-agent tile and is ignored otherwise. */
  async addSessionTile(
    projectId: string,
    kind: "shell" | "cli-agent" | "changes",
    preset?: AgentPreset,
  ) {
    const document = this.state.document;
    if (!document) return;
    const tiles = (document.sessionTiles ?? []).filter(
      (tile) => tile.projectId === projectId,
    );
    const y = Math.max(
      PROJECT_HEADER,
      ...tiles.map((tile) => tile.y + tile.height + PROJECT_PADDING),
    );
    return this.projectMutation((reference) =>
      this.call(this.key(), false, "project.createTile", {
        ...reference,
        projectId,
        kind,
        ...(kind === "cli-agent" ? { preset } : {}),
        x: PROJECT_PADDING,
        y,
        width: 576,
        height: 440,
        growProject: true,
      }),
    );
  }

  placeProject(
    id: string,
    geometry: Partial<
      Pick<ProjectGroup, "x" | "y" | "width" | "height" | "collapsed">
    >,
  ) {
    const document = this.state.document;
    const group = document?.projectGroups?.find((group) => group.id === id);
    if (!document || !group || this.state.busy) return;
    const tiles = document.sessionTiles.filter((tile) => tile.projectId === id);
    const minimumWidth = Math.max(
      320,
      ...tiles.map((tile) => tile.x + tile.width + PROJECT_PADDING),
    );
    const minimumHeight = Math.max(
      240,
      ...tiles.map((tile) => tile.y + tile.height + PROJECT_PADDING),
    );
    const next = {
      ...group,
      ...geometry,
      width: Math.max(
        minimumWidth,
        Math.min(4000, geometry.width ?? group.width),
      ),
      height: Math.max(
        minimumHeight,
        Math.min(4000, geometry.height ?? group.height),
      ),
    };
    if (JSON.stringify(next) === JSON.stringify(group)) return;
    this.edit({
      ...document,
      projectGroups: document.projectGroups.map((group) =>
        group.id === id ? next : group,
      ),
    });
  }

  placeSessionTile(
    id: string,
    geometry: Partial<Pick<SessionTile, "x" | "y" | "width" | "height">>,
  ) {
    const document = this.state.document;
    const tile = document?.sessionTiles?.find((tile) => tile.id === id);
    const group = document?.projectGroups?.find(
      (group) => group.id === tile?.projectId,
    );
    if (!document || !tile || !group || this.state.busy) return;
    const width = Math.max(
      240,
      Math.min(group.width - 2 * PROJECT_PADDING, geometry.width ?? tile.width),
    );
    const height = Math.max(
      160,
      Math.min(
        group.height - PROJECT_HEADER - PROJECT_PADDING,
        geometry.height ?? tile.height,
      ),
    );
    const next = {
      ...tile,
      ...geometry,
      width,
      height,
      x: Math.max(
        PROJECT_PADDING,
        Math.min(group.width - width - PROJECT_PADDING, geometry.x ?? tile.x),
      ),
      y: Math.max(
        PROJECT_HEADER,
        Math.min(group.height - height - PROJECT_PADDING, geometry.y ?? tile.y),
      ),
    };
    if (JSON.stringify(next) === JSON.stringify(tile)) return;
    this.edit({
      ...document,
      sessionTiles: document.sessionTiles.map((tile) =>
        tile.id === id ? next : tile,
      ),
    });
  }

  private async operation(run: () => Promise<void>) {
    if (
      this.state.busy ||
      this.state.saving ||
      this.state.dirty ||
      this.disposed
    )
      return;
    this.publish({ busy: true, error: "" });
    try {
      await run();
    } catch (error) {
      this.fail(error);
    } finally {
      this.publish({ busy: false });
    }
  }

  async listWorkspaces() {
    await this.operation(async () => {
      const { workspaces } = await this.call(
        this.key(),
        false,
        "workspace.list",
        {},
      );
      this.publish({ workspaces });
    });
  }

  async openWorkspace(workspaceId: string) {
    await this.operation(async () => {
      const workspace = await this.call(this.key(), false, "workspace.open", {
        workspaceId,
      });
      this.publish({ workspace, document: null });
    });
  }

  async createWorkspace(name: string) {
    await this.operation(async () => {
      const workspace = await this.call(this.key(), false, "workspace.create", {
        name,
      });
      this.publish({
        workspace,
        document: null,
        workspaces: [...this.state.workspaces, workspace.workspace],
      });
    });
  }

  async closeWorkspace() {
    await this.operation(async () => {
      const workspaceId = this.state.workspace?.workspace.id;
      if (!workspaceId) return;
      await this.call(this.key(), false, "workspace.close", { workspaceId });
      this.publish({ workspace: null, document: null });
    });
  }

  /** Remove a saved workspace from this device; the picker lists what is left. */
  async deleteWorkspace(workspaceId: string) {
    let deleted = false;
    await this.operation(async () => {
      const { workspaces } = await this.call(
        this.key(),
        false,
        "workspace.delete",
        { workspaceId },
      );
      this.publish({ workspaces });
      deleted = true;
    });
    return deleted;
  }

  /** Remove a saved canvas from the open workspace; the picker lists what is left. */
  async deleteCanvas(canvasId: string) {
    let deleted = false;
    await this.operation(async () => {
      const workspace = this.state.workspace!;
      const { canvases } = await this.call(this.key(), false, "canvas.delete", {
        workspaceId: workspace.workspace.id,
        canvasId,
      });
      this.publish({ workspace: { ...workspace, canvases } });
      deleted = true;
    });
    return deleted;
  }

  /** Persist one drawing; a stroke larger than one frame is split for you. */
  async addDrawing(
    geometry: Pick<Placement, "x" | "y" | "width" | "height">,
    drawing: Drawing,
  ) {
    await this.addDrawings([{ geometry, drawing }]);
  }

  /**
   * Persist several drawings in order. Creations queue behind pending saves and
   * every segment becomes a draft before any request, so a failure midway keeps
   * the rest recoverable and a retry creates only the missing segments.
   */
  async addDrawings(segments: DrawingSegment[]) {
    await this.enqueue(async () => {
      await this.settleSave();
      if (this.state.error || this.disposed) return;
      const document = this.state.document!;
      const workspaceId = this.state.workspace!.workspace.id;
      const additions = segments
        .flatMap((segment) =>
          this.splitSegment(workspaceId, document.canvas.id, segment),
        )
        .map((segment): { node: Placement; artifact: Artifact } => {
          const nodeId = crypto.randomUUID();
          const artifactId = crypto.randomUUID();
          return {
            node: { id: nodeId, artifactId, ...segment.geometry },
            artifact: {
              id: artifactId,
              type: "drawing",
              schemaVersion: 1,
              revision: 1,
              drawing: segment.drawing,
            },
          };
        });
      // Show every stroke at once. If creating one fails, the draft stays in the
      // document as a recoverable edit and `save` retries only the missing ones.
      this.publish({
        document: {
          ...document,
          // canvas.open always reports `task`; match it so reloads compare equal.
          nodes: [
            ...document.nodes,
            ...additions.map((item) => ({ ...item.node, task: null })),
          ],
          artifacts: [
            ...document.artifacts,
            ...additions.map((item) => item.artifact),
          ],
        },
      });
      await this.save();
    });
  }

  /**
   * Keep one request inside the frame limit. A single freehand path that is too
   * large becomes several nodes; consecutive segments share their boundary point
   * so the drawn line stays continuous.
   */
  private splitSegment(
    workspaceId: string,
    canvasId: string,
    segment: DrawingSegment,
  ): DrawingSegment[] {
    if (this.frameBytes(workspaceId, canvasId, segment) <= MAX_FRAME_BYTES)
      return [segment];
    const shape = segment.drawing.shapes[0];
    if (segment.drawing.shapes.length !== 1 || !shape || shape.kind !== "path")
      return [segment];
    const segments: DrawingSegment[] = [];
    let chunk: [number, number][] = [];
    for (const point of shape.points) {
      const candidate = [...chunk, point];
      const size = this.frameBytes(workspaceId, canvasId, {
        geometry: segment.geometry,
        drawing: { shapes: [{ ...shape, points: candidate }] },
      });
      if (chunk.length > 0 && size > MAX_FRAME_BYTES) {
        segments.push({
          geometry: segment.geometry,
          drawing: { shapes: [{ ...shape, points: chunk }] },
        });
        chunk = [chunk[chunk.length - 1]!, point];
      } else {
        chunk = candidate;
      }
    }
    segments.push({
      geometry: segment.geometry,
      drawing: { shapes: [{ ...shape, points: chunk }] },
    });
    return segments;
  }

  /** Upper bound on the serialized size of a `node.createDrawing` request. */
  private frameBytes(
    workspaceId: string,
    canvasId: string,
    segment: DrawingSegment,
  ): number {
    return new TextEncoder().encode(
      JSON.stringify({
        protocolVersion: 1,
        id: "00000000-0000-4000-8000-000000000000",
        method: "node.createDrawing",
        params: {
          workspaceId,
          canvasId,
          expectedRevision: Number.MAX_SAFE_INTEGER,
          ...segment.geometry,
          drawing: segment.drawing,
        },
      }),
    ).length;
  }

  /** Remove one node (and its artifact when unreferenced); used by the eraser. */
  async deleteNode(nodeId: string) {
    await this.enqueue(async () => {
      await this.settleSave();
      if (this.state.error || this.disposed) return;
      nodeId = this.nodeIds.get(nodeId) ?? nodeId;
      await this.mutation(async () => {
        const document = this.state.document!;
        const result = await this.call(this.key(), false, "node.delete", {
          workspaceId: this.state.workspace!.workspace.id,
          canvasId: document.canvas.id,
          expectedRevision: document.canvas.revision,
          nodeId,
        });
        const nodes = document.nodes.filter((node) => node.id !== nodeId);
        const retained = new Set(nodes.map((node) => node.artifactId));
        this.load({
          ...document,
          canvas: { ...document.canvas, revision: result.revision },
          nodes,
          edges: document.edges.filter(
            (edge) =>
              edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId,
          ),
          artifacts: document.artifacts.filter((artifact) =>
            retained.has(artifact.id),
          ),
        });
      });
    });
  } /** Link two nodes already on the canvas; used by the arrow tool. */
  async createEdge(sourceNodeId: string, targetNodeId: string) {
    if (sourceNodeId === targetNodeId) return;
    await this.enqueue(async () => {
      await this.settleSave();
      if (this.state.error || this.disposed) return;
      await this.mutation(async () => {
        const document = this.state.document!;
        const result = await this.call(this.key(), false, "edge.create", {
          workspaceId: this.state.workspace!.workspace.id,
          canvasId: document.canvas.id,
          expectedRevision: document.canvas.revision,
          kind: "relationship",
          sourceNodeId,
          targetNodeId,
        });
        this.load({
          ...document,
          canvas: { ...document.canvas, revision: result.revision },
          edges: [...document.edges, result.edge],
        });
      });
    });
  }

  /** The saved text and revision a task send will paste, after flushing edits. */
  async settledText(nodeId: string) {
    await this.enqueue(() => this.settleSave());
    const document = this.state.document;
    const id = this.nodeIds.get(nodeId) ?? nodeId;
    const node = document?.nodes.find((item) => item.id === id);
    const artifact = document?.artifacts.find((a) => a.id === node?.artifactId);
    if (
      artifact?.type !== "text" ||
      content(artifact) !== this.savedArtifacts.get(artifact.id)
    )
      throw new Error(
        "The text has unsaved changes. Wait for it to save, then retry.",
      );
    return { text: artifact.text, revision: artifact.revision };
  }

  /** Mark or unmark a text node as a task. Task calls throw so callers report them in place. */
  async setTask(nodeId: string, enabled: boolean) {
    await this.taskCall(
      nodeId,
      async (scope) =>
        (await this.call(this.key(), false, "task.set", { ...scope, enabled }))
          .task,
    );
  }

  async updateTask(
    nodeId: string,
    change: { done?: boolean; assignedTileId?: string | null },
  ) {
    await this.taskCall(nodeId, async (scope, task) => {
      if (!task) throw new Error("This note is no longer a task.");
      return (
        await this.call(this.key(), false, "task.update", {
          ...scope,
          expectedRevision: task.revision,
          ...change,
        })
      ).task;
    });
  }

  async recordSent(
    nodeId: string,
    tileId: string,
    textRevision: number,
    retry = false,
  ) {
    // Reconcile the persisted task before every attempt: the baseline the
    // adoption check compares against must be the truth at write time, or an
    // attempt that starts behind the recorded send could let a retry adopt
    // the previous send as if it were this one.
    await this.taskCall(nodeId, async (scope) => {
      const document = await this.call(this.key(), false, "canvas.open", {
        workspaceId: scope.workspaceId,
        canvasId: scope.canvasId,
      });
      const node = document.nodes.find((item) => item.id === scope.nodeId);
      if (!node) throw new Error("The note is no longer on this canvas.");
      // Refresh only task metadata; a retry must preserve unsaved text/layout.
      return node.task ?? null;
    });
    await this.taskCall(nodeId, async (scope, task) => {
      if (!task) throw new Error("This note is no longer a task.");
      // The write may have committed even though its acknowledgement was lost;
      // only a stamp newer than the attempt's baseline proves it was this send.
      if (
        retry &&
        this.sendAttempts.has(nodeId) &&
        task.sentAt !== this.sendAttempts.get(nodeId) &&
        task.assignedTileId === tileId &&
        task.sentAt !== null &&
        task.sentRevision === textRevision
      )
        return task;
      this.sendAttempts.set(nodeId, task.sentAt);
      return (
        await this.call(this.key(), false, "task.recordSent", {
          ...scope,
          expectedRevision: task.revision,
          tileId,
          textRevision,
        })
      ).task;
    });
  }

  // Task state has its own revision, so it skips the canvas save path and only
  // patches node task fields; unsaved text stays unsaved.
  private async taskCall(
    nodeId: string,
    run: (
      scope: { workspaceId: string; canvasId: string; nodeId: string },
      task: Task | null,
    ) => Promise<Task | null>,
  ) {
    await this.enqueue(async () => {
      const document = this.state.document;
      const workspace = this.state.workspace;
      if (!document || !workspace || this.disposed) return;
      const id = this.nodeIds.get(nodeId) ?? nodeId;
      const node = document.nodes.find((item) => item.id === id);
      if (!node) throw new Error("The note is no longer on this canvas.");
      const task = await run(
        {
          workspaceId: workspace.workspace.id,
          canvasId: document.canvas.id,
          nodeId: id,
        },
        node.task ?? null,
      );
      const current = this.state.document;
      if (current?.canvas.id !== document.canvas.id) return;
      // Every node showing the artifact shares its task.
      this.publish({
        document: {
          ...current,
          nodes: current.nodes.map((item) =>
            item.artifactId === node.artifactId ? { ...item, task } : item,
          ),
        },
      });
    });
  }

  /** Flush debounced edits, including an in-flight save, before mutating. */
  private async settleSave() {
    if (this.savingTask) await this.savingTask;
    if (this.state.dirty && !this.state.error && !this.disposed)
      await this.save();
  }

  /** Run mutations one at a time, in the order they were requested. */
  private enqueue(run: () => Promise<void>): Promise<void> {
    const next = this.mutations.then(run, run);
    this.mutations = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async mutation(run: () => Promise<void>) {
    if (this.state.busy || this.state.saving || this.disposed) return;
    this.publish({ busy: true, error: "" });
    try {
      await run();
    } catch (error) {
      this.fail(error);
    } finally {
      this.publish({ busy: false });
    }
  }

  /** Leave the open canvas but keep its workspace, returning to canvas selection. */
  async closeCanvas() {
    await this.operation(async () => {
      if (this.state.document) this.publish({ document: null });
    });
  }

  async openCanvas(canvasId: string) {
    await this.operation(async () => {
      const workspaceId = this.state.workspace!.workspace.id;
      this.load(
        await this.call(this.key(), false, "canvas.open", {
          workspaceId,
          canvasId,
        }),
      );
      await this.refreshConversation();
    });
  }

  async createCanvas(title: string) {
    await this.operation(async () => {
      const workspace = this.state.workspace!;
      const workspaceId = workspace.workspace.id;
      const { canvas } = await this.call(this.key(), false, "canvas.create", {
        workspaceId,
        title,
      });
      this.publish({
        workspace: { ...workspace, canvases: [...workspace.canvases, canvas] },
      });
      this.load(
        await this.call(this.key(), false, "canvas.open", {
          workspaceId,
          canvasId: canvas.id,
        }),
      );
      await this.refreshConversation();
    });
  }

  async refreshConversation() {
    const canvasId = this.state.document?.canvas.id;
    const workspaceId = this.state.workspace?.workspace.id;
    if (!canvasId || !workspaceId) return;
    const result = await this.call(this.key(), false, "conversation.list", {
      workspaceId,
      canvasId,
      before: 0,
    });
    if (
      this.state.document?.canvas.id === canvasId &&
      this.state.workspace?.workspace.id === workspaceId
    )
      this.publish({ turns: result.turns });
  }

  private async reloadConversationCanvas() {
    const workspaceId = this.state.workspace!.workspace.id;
    const canvasId = this.state.document!.canvas.id;
    const document = await this.call(this.key(), false, "canvas.open", {
      workspaceId,
      canvasId,
    });
    const { turns } = await this.call(this.key(), false, "conversation.list", {
      workspaceId,
      canvasId,
      before: 0,
    });
    // Applied objects must never be rendered with an older pending proposal.
    this.load(document, turns);
  }

  async reloadConversation() {
    await this.enqueue(async () => {
      if (this.state.dirty || !this.state.document || this.disposed) return;
      await this.mutation(() => this.reloadConversationCanvas());
    });
  }

  /** Agent reads leave the canvas revision alone, so they skip the save queue and reload. */
  readConversation(params: RuntimeParams<"conversation.read">) {
    return this.call(this.key(), false, "conversation.read", params);
  }

  /** MCP calls never touch the canvas, so like reads they skip the save queue. */
  listMcpTools(workspaceId: string) {
    return this.call(this.key(), false, "mcp.tools.list", { workspaceId });
  }

  callMcp(params: RuntimeParams<"mcp.call">) {
    return this.call(this.key(), false, "mcp.call", params);
  }

  async startConversation(params: RuntimeParams<"conversation.start">) {
    let result: RuntimeResult<"conversation.start"> | undefined;
    await this.enqueue(async () => {
      await this.settleSave();
      if (this.state.dirty || this.disposed) return;
      await this.mutation(async () => {
        result = await this.call(
          this.key(),
          false,
          "conversation.start",
          params,
        );
        await this.reloadConversationCanvas();
      });
    });
    return result;
  }

  async finishConversation(params: RuntimeParams<"conversation.finish">) {
    let result: RuntimeResult<"conversation.finish"> | undefined;
    await this.enqueue(async () => {
      await this.settleSave();
      if (this.state.dirty || this.disposed) return;
      await this.mutation(async () => {
        result = await this.call(
          this.key(),
          false,
          "conversation.finish",
          params,
        );
        await this.reloadConversationCanvas();
      });
    });
    return result;
  }

  /**
   * Reload the canvas and return the turn if the runtime already finished it.
   * A finish whose acknowledgement was lost is committed, so its buffered reply
   * must be adopted rather than resent or altered.
   */
  async finishedTurn(turnId: string) {
    let finished: ConversationTurn | undefined;
    await this.enqueue(async () => {
      await this.settleSave();
      if (this.state.dirty || !this.state.document || this.disposed) return;
      await this.mutation(async () => {
        await this.reloadConversationCanvas();
        finished = this.state.turns.find(
          (turn) => turn.id === turnId && turn.status !== "generating",
        );
      });
    });
    return finished;
  }

  async resolveConversation(turnId: string, action: "apply" | "discard") {
    await this.enqueue(async () => {
      await this.settleSave();
      if (this.state.dirty || this.disposed) return;
      await this.mutation(async () => {
        await this.call(this.key(), false, "conversation.resolve", {
          workspaceId: this.state.workspace!.workspace.id,
          canvasId: this.state.document!.canvas.id,
          turnId,
          action,
        });
        await this.reloadConversationCanvas();
      });
    });
  }

  async addText(
    position?: { x: number; y: number },
    text = "",
    size?: { width: number; height: number },
    origin?: { workspaceId: string; canvasId: string },
    purpose?: RuntimeParams<"node.createText">["purpose"],
  ): Promise<RuntimeResult<"node.createText"> | undefined> {
    let created: RuntimeResult<"node.createText"> | undefined;
    await this.enqueue(async () => {
      await this.settleSave();
      if (this.state.error || this.disposed) return;
      await this.mutation(async () => {
        const document = this.state.document;
        const workspaceId = this.state.workspace?.workspace.id;

        if (
          !document ||
          !workspaceId ||
          (origin &&
            (origin.workspaceId !== workspaceId ||
              origin.canvasId !== document.canvas.id))
        )
          return;
        const { x, y, zoom } = document.canvas.viewport;
        const params = {
          workspaceId,
          canvasId: document.canvas.id,
          expectedRevision: document.canvas.revision,
          x: position ? position.x : (40 - x) / zoom,
          y: position ? position.y : (40 - y) / zoom,
          width: size?.width ?? 240,
          height: size?.height ?? 160,
          text,
          ...(purpose ? { purpose } : {}),
        };

        const result = await this.call(
          this.key(),
          false,
          "node.createText",
          params,
        );
        created = result;
        this.load({
          ...document,
          canvas: { ...document.canvas, revision: result.revision },
          nodes: [...document.nodes, { ...result.node, task: null }],
          artifacts: [...document.artifacts, result.artifact],
        });
      });
    });
    return created;
  }

  editText(artifactId: string, text: string) {
    const document = this.state.document;
    if (!document || this.state.busy) return;
    this.edit({
      ...document,
      artifacts: document.artifacts.map((artifact) =>
        artifact.id === artifactId ? { ...artifact, text } : artifact,
      ),
    });
  }

  placeNode(
    id: string,
    geometry: Partial<Pick<Placement, "x" | "y" | "width" | "height">>,
  ) {
    const document = this.state.document;
    if (!document || this.state.busy) return;
    const node = document.nodes.find((item) => item.id === id);
    if (
      !node ||
      Object.entries(geometry).every(
        ([key, value]) => node[key as keyof Placement] === value,
      )
    )
      return;
    this.edit({
      ...document,
      nodes: document.nodes.map((node) =>
        node.id === id ? { ...node, ...geometry } : node,
      ),
    });
  }

  setViewport(viewport: Viewport) {
    const document = this.state.document;
    if (!document || this.state.busy) return;
    if (JSON.stringify(viewport) === JSON.stringify(document.canvas.viewport))
      return;
    this.edit({ ...document, canvas: { ...document.canvas, viewport } });
  }

  private edit(document: CanvasDocument) {
    this.publish({ document });
    clearTimeout(this.timer);
    if (this.state.dirty && !this.state.error && !this.disposed)
      this.timer = setTimeout(() => void this.save(), 400);
  }

  /** One save runs at a time; concurrent callers await the same attempt. */
  async save() {
    if (this.savingTask) return this.savingTask;
    this.savingTask = this.runSave();
    try {
      await this.savingTask;
    } finally {
      this.savingTask = null;
    }
  }

  /** Adopt server identities while keeping geometry edited during the request. */
  private acknowledgeDrawing(
    node: Placement,
    result: RuntimeResult<"node.createDrawing">,
  ) {
    this.savedArtifacts.set(result.artifact.id, content(result.artifact));
    const saved = JSON.parse(this.savedLayout) as CanvasLayout;
    saved.nodes = [
      ...saved.nodes,
      {
        id: result.node.id,
        x: result.node.x,
        y: result.node.y,
        width: result.node.width,
        height: result.node.height,
      },
    ].sort((left, right) => left.id.localeCompare(right.id));
    this.savedLayout = JSON.stringify(saved);
    this.nodeIds.set(node.id, result.node.id);
    this.attemptedDrawing = null;
    const latest = this.state.document!;
    this.publish({
      document: {
        ...latest,
        canvas: { ...latest.canvas, revision: result.revision },
        nodes: latest.nodes.map((item) =>
          item.id === node.id
            ? { ...item, id: result.node.id, artifactId: result.artifact.id }
            : item,
        ),
        artifacts: latest.artifacts.map((item) =>
          item.id === node.artifactId ? result.artifact : item,
        ),
      },
    });
  }

  private async runSave() {
    clearTimeout(this.timer);
    if (
      this.state.busy ||
      this.state.saving ||
      this.state.error ||
      this.disposed
    )
      return;
    this.publish({ saving: true });
    try {
      while (this.state.dirty && !this.disposed) {
        const workspaceId = this.state.workspace!.workspace.id;
        // A drawing whose creation failed is still a draft; create it now so a
        // retry persists each stroke exactly once.
        for (;;) {
          const draft = this.state.document!;
          const pending = draft.artifacts.find(
            (artifact): artifact is Extract<Artifact, { type: "drawing" }> =>
              artifact.type === "drawing" &&
              !this.savedArtifacts.has(artifact.id),
          );
          if (!pending) break;
          const node = draft.nodes.find(
            (item) => item.artifactId === pending.id,
          )!;
          this.attemptedDrawing = {
            node,
            artifact: pending,
            revision: draft.canvas.revision,
          };
          const result = await this.call(
            this.key(),
            false,
            "node.createDrawing",
            {
              workspaceId,
              canvasId: draft.canvas.id,
              expectedRevision: draft.canvas.revision,
              x: node.x,
              y: node.y,
              width: node.width,
              height: node.height,
              drawing: pending.drawing,
            },
          );
          this.acknowledgeDrawing(node, result);
        }
        const document = this.state.document!;
        for (const artifact of document.artifacts) {
          if (content(artifact) === this.savedArtifacts.get(artifact.id))
            continue;
          // Drawings are immutable once created; only text content is edited.
          if (artifact.type !== "text") continue;
          this.attemptedArtifacts.set(artifact.id, artifact.text);
          const result = await this.call(
            this.key(),
            false,
            "artifact.saveText",
            {
              workspaceId,
              artifactId: artifact.id,
              expectedRevision: artifact.revision,
              text: artifact.text,
            },
          );
          this.savedArtifacts.set(artifact.id, artifact.text);
          this.attemptedArtifacts.delete(artifact.id);
          const current = this.state.document!;
          this.publish({
            document: {
              ...current,
              artifacts: current.artifacts.map((draft) =>
                draft.id === artifact.id
                  ? { ...draft, revision: result.artifact.revision }
                  : draft,
              ),
            },
          });
        }
        const current = this.state.document!;
        const snapshot = this.layout(current);
        if (JSON.stringify(snapshot) !== this.savedLayout)
          await this.saveLayout(workspaceId, current, snapshot);
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.publish({ saving: false });
    }
  }

  async retrySave() {
    if (
      this.state.busy ||
      this.state.saving ||
      !this.state.document ||
      this.disposed
    )
      return;
    this.publish({ busy: true });
    try {
      let document = this.state.document;
      const workspaceId = this.state.workspace!.workspace.id;
      await this.call(this.key(), false, "workspace.open", { workspaceId });
      const remote = await this.call(this.key(), false, "canvas.open", {
        workspaceId,
        canvasId: document.canvas.id,
      });
      if (this.projectMetadata(remote) !== this.savedProjectMetadata)
        throw new Error(
          "Saved project associations changed elsewhere. Copy your unsaved edits before reloading.",
        );
      // One lost creation reply can account for exactly one new drawing and revision.
      const attempted = this.attemptedDrawing;
      const unknown = remote.artifacts.filter(
        (artifact) => !this.savedArtifacts.has(artifact.id),
      );
      const artifact = unknown.length === 1 ? unknown[0] : undefined;
      const placements = remote.nodes.filter(
        (node) => node.artifactId === artifact?.id,
      );
      const node = placements.length === 1 ? placements[0] : undefined;
      const created =
        attempted &&
        artifact?.type === "drawing" &&
        artifact.revision === 1 &&
        content(artifact) === content(attempted.artifact) &&
        node &&
        !document.nodes.some((item) => item.id === node.id) &&
        node.x === attempted.node.x &&
        node.y === attempted.node.y &&
        node.width === attempted.node.width &&
        node.height === attempted.node.height &&
        remote.canvas.revision === attempted.revision + 1
          ? { node, artifact, revision: remote.canvas.revision }
          : undefined;
      const pending = new Set(
        document.artifacts
          .filter((artifact) => !this.savedArtifacts.has(artifact.id))
          .map((artifact) => artifact.id),
      );
      // A lost reply may have committed. Accept only known content before retrying.
      const remoteLayout = JSON.stringify(this.layout(remote));
      if (
        remoteLayout !== this.savedLayout &&
        remoteLayout !== this.attemptedLayout
      )
        throw new Error(
          "Saved placement or view changed elsewhere. Copy your unsaved edits for recovery.",
        );
      const existing = remote.artifacts.filter(
        (artifact) => artifact.id !== created?.artifact.id,
      );
      for (const artifact of existing) {
        const known = content(artifact);
        if (
          known !== this.savedArtifacts.get(artifact.id) &&
          known !== this.attemptedArtifacts.get(artifact.id)
        )
          throw new Error(
            "Saved text changed elsewhere. Copy your unsaved edits for recovery.",
          );
      }
      const committed = document.artifacts.filter(
        (artifact) => !pending.has(artifact.id),
      );
      if (existing.length !== committed.length)
        throw new Error(
          "Saved artifacts changed elsewhere. Copy your unsaved edits for recovery.",
        );
      if (created && attempted) {
        this.acknowledgeDrawing(attempted.node, created);
        document = this.state.document!;
        pending.delete(attempted.artifact.id);
      }
      this.attemptedDrawing = null;
      this.savedLayout = JSON.stringify(this.layout(remote));
      this.savedArtifacts = new Map(
        remote.artifacts.map((artifact) => [artifact.id, content(artifact)]),
      );
      this.attemptedArtifacts.clear();
      this.attemptedLayout = "";
      this.publish({
        error: "",
        document: {
          ...document,
          canvas: { ...document.canvas, revision: remote.canvas.revision },
          ...((document.projectGroups ?? []).length
            ? {
                projectGroups: document.projectGroups.map((group) => ({
                  ...group,
                  revision: remote.projectGroups.find(
                    (item) => item.id === group.id,
                  )!.revision,
                  available: remote.projectGroups.find(
                    (item) => item.id === group.id,
                  )!.available,
                })),
              }
            : {}),
          ...((document.sessionTiles ?? []).length
            ? {
                sessionTiles: document.sessionTiles.map((tile) => ({
                  ...tile,
                  revision: remote.sessionTiles.find(
                    (item) => item.id === tile.id,
                  )!.revision,
                })),
              }
            : {}),
          artifacts: document.artifacts.map((draft) =>
            pending.has(draft.id)
              ? draft
              : {
                  ...draft,
                  revision: remote.artifacts.find(
                    (artifact) => artifact.id === draft.id,
                  )!.revision,
                },
          ),
        },
      });
    } catch (error) {
      this.fail(error);
    } finally {
      this.publish({ busy: false });
    }
    if (!this.state.error) await this.save();
  }

  recovery() {
    return JSON.stringify(
      { workspace: this.state.workspace?.workspace, ...this.state.document },
      null,
      2,
    );
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
