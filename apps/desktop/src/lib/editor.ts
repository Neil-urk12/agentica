import type { RuntimeResult } from "@agentica/protocol";
import type { callRuntime } from "./runtime";

export type CanvasDocument = RuntimeResult<"canvas.open">;
type Placement = CanvasDocument["nodes"][number];
type Viewport = CanvasDocument["canvas"]["viewport"];

export interface EditorState {
  workspaces: RuntimeResult<"workspace.list">["workspaces"];
  workspace: RuntimeResult<"workspace.open"> | null;
  document: CanvasDocument | null;
  busy: boolean;
  saving: boolean;
  dirty: boolean;
  error: string;
}

function layout(document: CanvasDocument) {
  return {
    viewport: document.canvas.viewport,
    nodes: document.nodes
      .map(({ id, x, y, width, height }) => ({
        id,
        x,
        y,
        width,
        height,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
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
  };
  private call: typeof callRuntime;
  private key: () => string;
  private changed: (state: EditorState) => void;
  private savedText = new Map<string, string>();
  private attemptedText = new Map<string, string>();
  private savedLayout = "";
  private attemptedLayout = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
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

  private publish(update: Partial<EditorState> = {}) {
    this.state = { ...this.state, ...update };
    const document = this.state.document;
    this.state.dirty =
      !!document &&
      (this.attemptedText.size > 0 ||
        !!this.attemptedLayout ||
        JSON.stringify(layout(document)) !== this.savedLayout ||
        document.artifacts.some(
          (artifact) => artifact.text !== this.savedText.get(artifact.id),
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

  private load(document: CanvasDocument) {
    this.savedText = new Map(
      document.artifacts.map(({ id, text }) => [id, text]),
    );
    this.attemptedText.clear();
    this.savedLayout = JSON.stringify(layout(document));
    this.attemptedLayout = "";
    this.publish({ document });
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
    });
  }

  async addText() {
    await this.operation(async () => {
      const document = this.state.document!;
      const { x, y, zoom } = document.canvas.viewport;
      const result = await this.call(this.key(), false, "node.createText", {
        workspaceId: this.state.workspace!.workspace.id,
        canvasId: document.canvas.id,
        expectedRevision: document.canvas.revision,
        x: (40 - x) / zoom,
        y: (40 - y) / zoom,
        width: 240,
        height: 160,
        text: "",
      });
      this.load({
        ...document,
        canvas: { ...document.canvas, revision: result.revision },
        nodes: [...document.nodes, result.node],
        artifacts: [...document.artifacts, result.artifact],
      });
    });
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

  async save() {
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
        const document = this.state.document!;
        const workspaceId = this.state.workspace!.workspace.id;
        for (const artifact of document.artifacts) {
          if (artifact.text === this.savedText.get(artifact.id)) continue;
          this.attemptedText.set(artifact.id, artifact.text);
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
          this.savedText.set(artifact.id, artifact.text);
          this.attemptedText.delete(artifact.id);
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
        const snapshot = layout(current);
        const serialized = JSON.stringify(snapshot);
        if (serialized !== this.savedLayout) {
          this.attemptedLayout = serialized;
          const result = await this.call(this.key(), false, "canvas.save", {
            workspaceId,
            canvasId: current.canvas.id,
            expectedRevision: current.canvas.revision,
            ...snapshot,
          });
          this.savedLayout = serialized;
          this.attemptedLayout = "";
          const latest = this.state.document!;
          this.publish({
            document: {
              ...latest,
              canvas: { ...latest.canvas, revision: result.revision },
            },
          });
        }
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
      const document = this.state.document;
      const workspaceId = this.state.workspace!.workspace.id;
      await this.call(this.key(), false, "workspace.open", { workspaceId });
      const remote = await this.call(this.key(), false, "canvas.open", {
        workspaceId,
        canvasId: document.canvas.id,
      });
      // A lost reply may have committed. Accept only known content before retrying.
      const remoteLayout = JSON.stringify(layout(remote));
      if (
        remoteLayout !== this.savedLayout &&
        remoteLayout !== this.attemptedLayout
      )
        throw new Error(
          "Saved placement or view changed elsewhere. Copy your unsaved edits for recovery.",
        );
      for (const artifact of remote.artifacts) {
        if (
          artifact.text !== this.savedText.get(artifact.id) &&
          artifact.text !== this.attemptedText.get(artifact.id)
        )
          throw new Error(
            "Saved text changed elsewhere. Copy your unsaved edits for recovery.",
          );
      }
      if (remote.artifacts.length !== document.artifacts.length)
        throw new Error(
          "Saved artifacts changed elsewhere. Copy your unsaved edits for recovery.",
        );
      this.savedLayout = remoteLayout;
      this.savedText = new Map(
        remote.artifacts.map(({ id, text }) => [id, text]),
      );
      this.attemptedText.clear();
      this.attemptedLayout = "";
      this.publish({
        error: "",
        document: {
          ...document,
          canvas: { ...document.canvas, revision: remote.canvas.revision },
          artifacts: document.artifacts.map((draft) => ({
            ...draft,
            revision: remote.artifacts.find(
              (artifact) => artifact.id === draft.id,
            )!.revision,
          })),
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
