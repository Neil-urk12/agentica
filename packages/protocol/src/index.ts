import { z } from "zod";

export const MAX_FRAME_BYTES = 16 * 1024;

// Limits shared with packages/agent-runtime/src/commands.rs.
export const LIMITS = {
  label: 120,
  text: 10_000,
  // A design is prompt data plus a proposal operation, so it must stay well
  // inside one 16 KiB frame together with the turn's reply.
  html: 8_000,
  coordinate: 1_000_000,
  minSize: 40,
  maxSize: 4_000,
  minZoom: 0.1,
  maxZoom: 4,
} as const;

const RequestId = z.string().min(1).max(128);
// Lowercase UUID identities; only explicit project operations accept paths.
export const IdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const Label = z
  .string()
  .max(LIMITS.label)
  .refine((value) => value.trim().length > 0, "Must not be blank");
const Text = z.string().max(LIMITS.text);
const Revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const Coordinate = z.number().min(-LIMITS.coordinate).max(LIMITS.coordinate);
const Size = z.number().min(LIMITS.minSize).max(LIMITS.maxSize);
const Geometry = { x: Coordinate, y: Coordinate, width: Size, height: Size };
const WorkspaceRef = { workspaceId: IdSchema };
const CanvasRef = { ...WorkspaceRef, canvasId: IdSchema };

export const PROJECT_HEADER = 96;
export const PROJECT_PADDING = 16;
const ProjectGeometry = {
  ...Geometry,
  width: Size.min(320),
  height: Size.min(240),
};
const TileGeometry = {
  x: z.number().min(16).max(4000),
  y: z.number().min(96).max(4000),
  width: Size.min(240),
  height: Size.min(160),
};
const ProjectPath = z
  .string()
  .min(1)
  .refine(
    (path) =>
      new TextEncoder().encode(path).length <= 4096 &&
      !path.includes("\0") &&
      (path.startsWith("/") ||
        /^[a-zA-Z]:[\\/]/.test(path) ||
        path.startsWith("\\\\")),
    "Use an absolute backend directory path",
  );
export const ProjectGroupSchema = z.strictObject({
  id: IdSchema,
  canvasId: IdSchema,
  root: ProjectPath,
  label: Label,
  ...ProjectGeometry,
  collapsed: z.boolean(),
  revision: Revision,
  available: z.boolean(),
});
export const SessionTileSchema = z
  .strictObject({
    id: IdSchema,
    canvasId: IdSchema,
    projectId: IdSchema,
    ...TileGeometry,
    revision: Revision,
    kind: z.enum(["shell", "cli-agent"]),
    preset: z.enum(["codex"]).nullable(),
  })
  .refine(
    (tile) =>
      tile.kind === "shell" ? tile.preset === null : tile.preset === "codex",
    "Invalid launch preset",
  );
export type ProjectGroup = z.infer<typeof ProjectGroupSchema>;
export type SessionTile = z.infer<typeof SessionTileSchema>;
const GroupLayout = z.strictObject({
  id: IdSchema,
  expectedRevision: Revision,
  ...ProjectGeometry,
  collapsed: z.boolean(),
});
const TileLayout = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  expectedRevision: Revision,
  ...TileGeometry,
});

export const TextPurposeSchema = z.enum(["note", "instruction"]);
const ArtifactRef = { artifactId: IdSchema, expectedRevision: Revision };
export const ArtifactOperationSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("text.replace"), ...ArtifactRef, text: Text }),
  z.strictObject({
    op: z.literal("mindmap.addTopic"),
    ...ArtifactRef,
    topicId: IdSchema,
    parentId: IdSchema.nullable(),
    title: Label,
  }),
  z.strictObject({
    op: z.literal("mindmap.renameTopic"),
    ...ArtifactRef,
    topicId: IdSchema,
    title: Label,
  }),
  z.strictObject({
    op: z.literal("mindmap.moveTopic"),
    ...ArtifactRef,
    topicId: IdSchema,
    parentId: IdSchema.nullable(),
  }),
  z.strictObject({
    op: z.literal("mindmap.removeTopic"),
    ...ArtifactRef,
    topicId: IdSchema,
  }),
]);
export const ArtifactBatchSchema = z
  .strictObject({
    ...CanvasRef,
    operations: z.array(ArtifactOperationSchema).min(1).max(32),
  })
  .superRefine(({ operations }, ctx) => {
    // shortcut: one operation per artifact, group topic edits when mind-map storage is added.
    const seen = new Set<string>();
    for (const [index, operation] of operations.entries()) {
      if (seen.has(operation.artifactId))
        ctx.addIssue({
          code: "custom",
          path: ["operations", index],
          message: "Use one operation per artifact in a batch",
        });
      seen.add(operation.artifactId);
      if ("parentId" in operation && operation.parentId === operation.topicId)
        ctx.addIssue({
          code: "custom",
          path: ["operations", index],
          message: "A topic cannot parent itself",
        });
    }
  });
export type ArtifactBatch = z.infer<typeof ArtifactBatchSchema>;

const UniqueIds = z
  .array(IdSchema)
  .max(128)
  .refine((ids) => new Set(ids).size === ids.length, "IDs must be unique");
export const AgentStartSchema = z
  .strictObject({
    ...CanvasRef,
    instructionArtifactId: IdSchema,
    readArtifactIds: UniqueIds,
    writeArtifactIds: UniqueIds,
  })
  .refine(
    (scope) =>
      scope.readArtifactIds.includes(scope.instructionArtifactId) &&
      scope.writeArtifactIds.every((id) => scope.readArtifactIds.includes(id)),
    "Instructions and writable artifacts must be in the read scope",
  );

export const CodexCapabilitiesSchema = z.strictObject({
  provider: z.literal("codex"),
  status: z.literal("unsupported"),
  executionEnabled: z.literal(false),
  osIsolationVerified: z.literal(false),
  reason: z.string().min(1),
});

export const ViewportSchema = z.strictObject({
  x: Coordinate,
  y: Coordinate,
  zoom: z.number().min(LIMITS.minZoom).max(LIMITS.maxZoom),
});

// Freehand and geometric shapes stored inside a drawing artifact. Coordinates
// are local to the node origin, so moving the node moves the whole drawing.
const DrawingColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const StrokeWidth = z.number().min(1).max(64);
const PathShapeSchema = z.strictObject({
  kind: z.literal("path"),
  points: z
    .array(z.tuple([Coordinate, Coordinate]))
    .min(1)
    .max(10_000),
  color: DrawingColor,
  width: StrokeWidth,
});
const BoxShapeSchema = z.strictObject({
  kind: z.union([z.literal("rectangle"), z.literal("ellipse")]),
  x: Coordinate,
  y: Coordinate,
  width: z.number().positive().max(LIMITS.coordinate),
  height: z.number().positive().max(LIMITS.coordinate),
  color: DrawingColor,
  label: z.string().max(LIMITS.label).optional(),
});
export const DrawingSchema = z.strictObject({
  shapes: z
    .array(z.union([PathShapeSchema, BoxShapeSchema]))
    .min(1)
    .max(1_000),
});
export type Drawing = z.infer<typeof DrawingSchema>;

export const CanvasOperationSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("createText"),
    nodeId: IdSchema,
    artifactId: IdSchema,
    ...Geometry,
    text: Text,
  }),
  z.strictObject({
    op: z.literal("createShape"),
    nodeId: IdSchema,
    artifactId: IdSchema,
    ...Geometry,
    kind: z.enum(["rectangle", "ellipse"]),
    color: DrawingColor,
    label: z.string().max(LIMITS.label).optional(),
  }),
  z.strictObject({
    op: z.literal("createHtml"),
    nodeId: IdSchema,
    artifactId: IdSchema,
    ...Geometry,
    html: z.string().min(1).max(LIMITS.html),
  }),
  z.strictObject({ op: z.literal("updateText"), nodeId: IdSchema, text: Text }),
  z.strictObject({
    op: z.literal("updateShape"),
    nodeId: IdSchema,
    kind: z.enum(["rectangle", "ellipse"]),
    color: DrawingColor,
    label: z.string().max(LIMITS.label).optional(),
  }),
  z.strictObject({ op: z.literal("place"), nodeId: IdSchema, ...Geometry }),
  z.strictObject({
    op: z.literal("connect"),
    edgeId: IdSchema,
    sourceNodeId: IdSchema,
    targetNodeId: IdSchema,
  }),
]);
export type CanvasOperation = z.infer<typeof CanvasOperationSchema>;
export const CanvasOperationJsonSchema = z.toJSONSchema(CanvasOperationSchema);
const Operations = z.array(CanvasOperationSchema).max(32);
const Anchor = z.strictObject({ x: Coordinate, y: Coordinate });
const TurnRef = { ...CanvasRef, turnId: IdSchema };
const ConversationStatus = z.enum([
  "generating",
  "pending",
  "complete",
  "applied",
  "discarded",
  "failed",
  "cancelled",
  "interrupted",
]);
export const ConversationTurnSchema = z.strictObject({
  id: IdSchema,
  sequence: z.number().int().positive(),
  model: Label,
  prompt: Text,
  reply: Text,
  promptNodeId: IdSchema,
  replyNodeId: IdSchema.nullable(),
  anchor: Anchor,
  status: ConversationStatus,
  operations: Operations,
  error: Text,
});
export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;
const ParamSchemas = {
  "conversation.start": z.strictObject({
    ...TurnRef,
    prompt: Text.refine((s) => s.trim().length > 0),
    model: Label,
    nodeIds: UniqueIds,
    contextMode: z.enum(["canvas", "selection"]).optional(),
    anchor: Anchor,
  }),
  "conversation.finish": z.strictObject({
    ...TurnRef,
    reply: Text,
    operations: Operations,
    status: z.enum(["complete", "failed", "cancelled", "interrupted"]),
    error: Text,
  }),
  "conversation.resolve": z.strictObject({
    ...TurnRef,
    action: z.enum(["apply", "discard"]),
  }),
  "conversation.list": z.strictObject({
    ...CanvasRef,
    before: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }),
  "artifact.applyBatch": ArtifactBatchSchema,
  "agent.capabilities": z.strictObject({}),
  "agent.start": AgentStartSchema,
  "agent.cancel": z.strictObject({ ...WorkspaceRef, runId: IdSchema }),
  "agent.events": z.strictObject({
    ...WorkspaceRef,
    runId: IdSchema,
    after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }),
  "workspace.list": z.strictObject({}),
  "workspace.create": z.strictObject({ name: Label }),
  "workspace.open": z.strictObject(WorkspaceRef),
  "workspace.close": z.strictObject(WorkspaceRef),
  "workspace.delete": z.strictObject(WorkspaceRef),
  "canvas.create": z.strictObject({ ...WorkspaceRef, title: Label }),
  "canvas.open": z.strictObject(CanvasRef),
  "canvas.delete": z.strictObject(CanvasRef),
  "project.delete": z.strictObject({
    ...CanvasRef,
    expectedRevision: Revision,
    projectId: IdSchema,
  }),
  "project.deleteTile": z.strictObject({
    ...CanvasRef,
    expectedRevision: Revision,
    tileId: IdSchema,
  }),
  "project.open": z.strictObject({
    ...CanvasRef,
    expectedRevision: Revision,
    path: ProjectPath,
    ...ProjectGeometry,
  }),
  "project.locate": z.strictObject({
    ...CanvasRef,
    expectedRevision: Revision,
    projectId: IdSchema,
    path: ProjectPath,
  }),
  "project.createTile": z
    .strictObject({
      ...CanvasRef,
      expectedRevision: Revision,
      projectId: IdSchema,
      ...TileGeometry,
      kind: z.enum(["shell", "cli-agent"]),
      preset: z.literal("codex").nullable().optional(),
      growProject: z.boolean().optional(),
    })
    .refine(
      (tile) =>
        tile.kind === "shell" ? tile.preset == null : tile.preset === "codex",
      "Invalid launch preset",
    ),
  "canvas.save": z.strictObject({
    ...CanvasRef,
    expectedRevision: Revision,
    viewport: ViewportSchema,
    projectGroups: z
      .array(GroupLayout)
      .refine(
        (groups) =>
          new Set(groups.map((group) => group.id)).size === groups.length,
        "Project IDs must be unique",
      )
      .optional(),
    sessionTiles: z
      .array(TileLayout)
      .refine(
        (tiles) => new Set(tiles.map((tile) => tile.id)).size === tiles.length,
        "Tile IDs must be unique",
      )
      .optional(),
    nodes: z
      .array(z.strictObject({ id: IdSchema, ...Geometry }))
      .refine(
        (nodes) => new Set(nodes.map((node) => node.id)).size === nodes.length,
        "Node IDs must be unique",
      ),
  }),
  "node.createText": z.strictObject({
    ...CanvasRef,
    expectedRevision: Revision,
    ...Geometry,
    text: Text,
    purpose: TextPurposeSchema.optional(),
  }),
  "edge.create": z
    .strictObject({
      ...CanvasRef,
      expectedRevision: Revision,
      kind: z.literal("relationship"),
      sourceNodeId: IdSchema,
      targetNodeId: IdSchema,
    })
    .refine(
      (edge) => edge.sourceNodeId !== edge.targetNodeId,
      "A link must connect two different nodes",
    ),
  "artifact.saveText": z.strictObject({
    ...WorkspaceRef,
    artifactId: IdSchema,
    expectedRevision: Revision,
    text: Text,
  }),
  "node.createDrawing": z.strictObject({
    ...CanvasRef,
    expectedRevision: Revision,
    ...Geometry,
    drawing: DrawingSchema,
  }),
  "node.delete": z.strictObject({
    ...CanvasRef,
    expectedRevision: Revision,
    nodeId: IdSchema,
  }),
} as const;

export type RuntimeMethod = "runtime.ping" | keyof typeof ParamSchemas;
export type RuntimeParams<M extends keyof typeof ParamSchemas> = z.infer<
  (typeof ParamSchemas)[M]
>;

export const RuntimeRequestSchema = z.union([
  z.strictObject({
    protocolVersion: z.literal(1),
    id: RequestId,
    method: z.literal("runtime.ping"),
  }),
  ...Object.entries(ParamSchemas).map(([method, params]) =>
    z.strictObject({
      protocolVersion: z.literal(1),
      id: RequestId,
      method: z.literal(method as keyof typeof ParamSchemas),
      params,
    }),
  ),
]);

const Workspace = z.strictObject({ id: IdSchema, name: z.string() });
// `name` is null when this build cannot read the workspace.
const WorkspaceSummaries = z.array(
  z.strictObject({ id: IdSchema, name: z.string().nullable() }),
);
const CanvasSummary = z.strictObject({ id: IdSchema, title: z.string() });
// A self-contained HTML/CSS design rendered in a sandboxed frame. Scripts are
// never executed; the sandbox blocks them and remote resources by CSP.
export const HtmlArtifactSchema = z.strictObject({
  id: IdSchema,
  type: z.literal("html"),
  schemaVersion: z.literal(1),
  revision: Revision,
  html: z.string().min(1).max(LIMITS.html),
});
export const TextArtifactSchema = z.strictObject({
  id: IdSchema,
  type: z.literal("text"),
  schemaVersion: z.literal(1),
  revision: Revision,
  text: z.string(),
  purpose: TextPurposeSchema.optional(),
});
export const DrawingArtifactSchema = z.strictObject({
  id: IdSchema,
  type: z.literal("drawing"),
  schemaVersion: z.literal(1),
  revision: Revision,
  drawing: DrawingSchema,
});
export const ArtifactSchema = z.discriminatedUnion("type", [
  TextArtifactSchema,
  DrawingArtifactSchema,
  HtmlArtifactSchema,
]);
export type Artifact = z.infer<typeof ArtifactSchema>;
export const NodeSchema = z.strictObject({
  id: IdSchema,
  artifactId: IdSchema,
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export const EdgeSchema = z.strictObject({
  id: IdSchema,
  kind: z.literal("relationship"),
  sourceNodeId: IdSchema,
  targetNodeId: IdSchema,
});
const WorkspaceState = z.strictObject({
  workspace: Workspace,
  canvases: z.array(CanvasSummary),
});

export const ResultSchemas = {
  "conversation.start": z.strictObject({
    turn: ConversationTurnSchema,
    context: z.strictObject({
      nodes: z.array(NodeSchema),
      edges: z.array(EdgeSchema),
      artifacts: z.array(ArtifactSchema),
    }),
    history: z
      .array(
        z.strictObject({
          prompt: Text,
          reply: Text,
          status: ConversationStatus,
        }),
      )
      .max(8),
  }),
  "conversation.finish": z.strictObject({ turn: ConversationTurnSchema }),
  "conversation.resolve": z.strictObject({ turn: ConversationTurnSchema }),
  "conversation.list": z.strictObject({
    turns: z.array(ConversationTurnSchema).max(8),
    nextBefore: z.number().int().nonnegative(),
  }),
  "artifact.applyBatch": z.strictObject({
    artifacts: z.array(TextArtifactSchema).min(1).max(32),
  }),
  "agent.capabilities": CodexCapabilitiesSchema,
  // Contracts for the supervisor; current runtime returns unsupported errors.
  "agent.start": z.strictObject({ runId: IdSchema }),
  "agent.cancel": z.strictObject({
    runId: IdSchema,
    status: z.enum(["cancelling", "terminal"]),
  }),
  "agent.events": z.lazy(() => RunEventPageSchema),
  "runtime.ping": z.strictObject({ status: z.literal("ok") }),
  "workspace.list": z.strictObject({ workspaces: WorkspaceSummaries }),
  "workspace.create": WorkspaceState,
  "workspace.open": WorkspaceState,
  "workspace.close": z.strictObject({}),
  "workspace.delete": z.strictObject({ workspaces: WorkspaceSummaries }),
  "canvas.create": z.strictObject({ canvas: CanvasSummary }),
  "project.delete": z.strictObject({ revision: Revision }),
  "project.deleteTile": z.strictObject({ revision: Revision }),
  "project.open": z.strictObject({ revision: Revision, projectId: IdSchema }),
  "project.locate": z.strictObject({ revision: Revision }),
  "project.createTile": z.strictObject({
    revision: Revision,
    tileId: IdSchema,
  }),
  "canvas.open": z
    .strictObject({
      canvas: z.strictObject({
        id: IdSchema,
        title: z.string(),
        revision: Revision,
        viewport: z.strictObject({
          x: z.number(),
          y: z.number(),
          zoom: z.number(),
        }),
      }),
      nodes: z.array(NodeSchema),
      edges: z.array(EdgeSchema),
      artifacts: z.array(ArtifactSchema),
      projectGroups: z.array(ProjectGroupSchema).default([]),
      sessionTiles: z.array(SessionTileSchema).default([]),
    })
    .superRefine((document, ctx) => {
      const groups = new Map(
        document.projectGroups.map((group) => [group.id, group]),
      );
      const ids = [
        ...document.nodes,
        ...document.projectGroups,
        ...document.sessionTiles,
      ].map((item) => item.id);
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({
          code: "custom",
          message: "Canvas object IDs must be unique",
        });
      for (const group of document.projectGroups)
        if (group.canvasId !== document.canvas.id)
          ctx.addIssue({
            code: "custom",
            message: "Project belongs to another canvas",
          });
      for (const tile of document.sessionTiles) {
        const group = groups.get(tile.projectId);
        if (
          !group ||
          tile.canvasId !== document.canvas.id ||
          tile.x + tile.width > group.width - PROJECT_PADDING ||
          tile.y + tile.height > group.height - PROJECT_PADDING
        )
          ctx.addIssue({
            code: "custom",
            message: "Tile is outside its saved project",
          });
      }
    }),
  "canvas.delete": z.strictObject({ canvases: z.array(CanvasSummary) }),
  "canvas.save": z.strictObject({ revision: Revision }),
  "node.createText": z.strictObject({
    revision: Revision,
    node: NodeSchema,
    artifact: TextArtifactSchema,
  }),
  "edge.create": z.strictObject({ revision: Revision, edge: EdgeSchema }),
  "artifact.saveText": z.strictObject({ artifact: TextArtifactSchema }),
  "node.createDrawing": z.strictObject({
    revision: Revision,
    node: NodeSchema,
    artifact: DrawingArtifactSchema,
  }),
  "node.delete": z.strictObject({ revision: Revision }),
} as const satisfies Record<RuntimeMethod, z.ZodType>;

export type RuntimeResult<M extends RuntimeMethod> = z.infer<
  (typeof ResultSchemas)[M]
>;

export const ErrorCodeSchema = z.enum([
  "INVALID_JSON",
  "INVALID_REQUEST",
  "FRAME_TOO_LARGE",
  "INVALID_PARAMS",
  "WORKSPACE_LOCKED",
  "WORKSPACE_NOT_OPEN",
  "NOT_FOUND",
  "CONFLICT",
  "UNSUPPORTED_STORAGE",
  "STORAGE_ERROR",
  "UNSUPPORTED_CAPABILITY",
  "SCOPE_DENIED",
  "BACKPRESSURE",
  "INVALID_EVENT_ORDER",
]);

export const SESSION_LIMITS = {
  liveSessions: 8,
  frameBytes: 16 * 1024,
  unacknowledgedBytes: 256 * 1024,
  retainedBytes: 1024 * 1024,
  scrollback: 2000,
  wireBytes: 96 * 1024,
} as const;
export const SessionOwnerSchema = z.strictObject({
  ...CanvasRef,
  tileId: IdSchema,
});
export type SessionOwner = z.infer<typeof SessionOwnerSchema>;
const SessionRef = { owner: SessionOwnerSchema, sessionId: IdSchema };
const AttachmentRef = { ...SessionRef, attachmentId: IdSchema };
const TerminalDimensions = {
  rows: z.number().int().min(2).max(200),
  cols: z.number().int().min(2).max(400),
};
const Sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const TerminalBytes = z
  .array(z.number().int().min(0).max(255))
  .max(SESSION_LIMITS.frameBytes);
export const SessionCommandSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("capabilities") }),
  z.strictObject({
    op: z.literal("list"),
    ...WorkspaceRef,
    canvasId: IdSchema.optional(),
  }),
  z.strictObject({ op: z.literal("status"), owner: SessionOwnerSchema }),
  z.strictObject({
    op: z.literal("start"),
    owner: SessionOwnerSchema,
    requestId: RequestId,
    ...TerminalDimensions,
  }),
  z.strictObject({
    op: z.literal("subscribe"),
    ...SessionRef,
    after: Sequence,
  }),
  z.strictObject({
    op: z.literal("input"),
    ...AttachmentRef,
    bytes: TerminalBytes.min(1),
  }),
  z.strictObject({
    op: z.literal("resize"),
    ...AttachmentRef,
    ...TerminalDimensions,
    redraw: z.boolean().optional(),
  }),
  z.strictObject({
    op: z.literal("acknowledge"),
    ...AttachmentRef,
    sequence: Sequence,
  }),
  z.strictObject({ op: z.literal("detach"), ...AttachmentRef }),
  z.strictObject({
    op: z.literal("focus"),
    ...AttachmentRef,
    focused: z.boolean(),
  }),
  z.strictObject({
    op: z.literal("clearAttention"),
    ...SessionRef,
    sequence: Sequence,
  }),
  z.strictObject({ op: z.literal("stop"), ...SessionRef }),
  z.strictObject({
    op: z.literal("restart"),
    ...SessionRef,
    requestId: RequestId,
    ...TerminalDimensions,
  }),
]);
export type SessionCommand = z.infer<typeof SessionCommandSchema>;
export const SessionRequestSchema = z.strictObject({
  id: RequestId,
  command: SessionCommandSchema,
});
export const SessionAttentionSchema = z
  .strictObject({
    raised: z.boolean(),
    count: z.number().int().min(0).max(0xffffffff),
    sequence: Sequence,
    kind: z.enum(["bell", "notification", "exited", "failed"]).nullable(),
    at: Sequence.nullable(),
    message: z
      .string()
      .refine((text) => [...text].length <= 256 && !/[\p{Cc}]/u.test(text))
      .nullable(),
  })
  .refine((value) =>
    value.raised
      ? value.count > 0 &&
        value.sequence > 0 &&
        value.kind !== null &&
        value.at !== null &&
        (value.kind === "notification"
          ? value.message !== null
          : value.message === null)
      : value.count === 0 &&
        value.kind === null &&
        value.at === null &&
        value.message === null,
  );
export const SessionStatusSchema = z.strictObject({
  backendId: IdSchema,
  sessionId: IdSchema,
  owner: SessionOwnerSchema,
  state: z.enum([
    "stopped",
    "starting",
    "running",
    "stopping",
    "exited",
    "failed",
  ]),
  exitCode: z.number().int().nonnegative().nullable(),
  exitSignal: z.string().nullable(),
  error: z.string().nullable(),
  executable: z.string().nullable(),
  shellFallback: z.boolean(),
  projectId: IdSchema.nullable(),
  attention: SessionAttentionSchema,
  ...TerminalDimensions,
});
export type SessionStatus = z.infer<typeof SessionStatusSchema>;
const ExecutableCapability = z.strictObject({
  path: z.string().nullable(),
  reason: z.string().nullable(),
  fallback: z.boolean(),
});
const StatusResult = z.strictObject({ status: SessionStatusSchema });
const EmptySessionResult = z.strictObject({});
export const SessionResultSchemas = {
  capabilities: z.strictObject({
    capabilities: z.strictObject({
      platform: z.string(),
      supported: z.boolean(),
      shell: ExecutableCapability,
      codex: ExecutableCapability,
    }),
    limits: z.strictObject({
      liveSessions: z.literal(8),
      frameBytes: z.literal(16384),
      unacknowledgedBytes: z.literal(262144),
      retainedBytes: z.literal(1048576),
      scrollback: z.literal(2000),
    }),
  }),
  list: z.strictObject({ sessions: z.array(SessionStatusSchema) }),
  status: z.strictObject({ status: SessionStatusSchema.nullable() }),
  start: StatusResult,
  restart: StatusResult,
  stop: StatusResult,
  subscribe: z.strictObject({ attachmentId: IdSchema }),
  input: EmptySessionResult,
  resize: EmptySessionResult,
  acknowledge: EmptySessionResult,
  detach: EmptySessionResult,
  focus: EmptySessionResult,
  clearAttention: EmptySessionResult,
} as const;
export type SessionResult<C extends SessionCommand["op"]> = z.infer<
  (typeof SessionResultSchemas)[C]
>;
export const SessionEventSchema = z
  .strictObject({
    event: z.literal("session"),
    ...AttachmentRef,
    status: SessionStatusSchema,
    output: z
      .strictObject({
        historyGap: z.boolean(),
        nextSequence: Sequence,
        lastSequence: Sequence,
        frames: z
          .array(
            z.strictObject({
              sequence: Sequence.min(1),
              bytes: TerminalBytes.min(1),
            }),
          )
          .max(64),
      })
      .refine(
        (page) => page.nextSequence <= page.lastSequence,
        "Output cursor cannot exceed the final sequence",
      ),
  })
  .refine(
    (event) =>
      event.sessionId === event.status.sessionId &&
      event.owner.tileId === event.status.owner.tileId &&
      event.owner.canvasId === event.status.owner.canvasId &&
      event.owner.workspaceId === event.status.owner.workspaceId,
    "Event and process ownership must match",
  );
export type SessionEvent = z.infer<typeof SessionEventSchema>;
export const SessionReplySchema = z.union([
  z.strictObject({ id: RequestId, result: z.unknown() }),
  z.strictObject({
    id: RequestId,
    error: z.strictObject({ code: ErrorCodeSchema, message: z.string() }),
  }),
]);

export const RunEventSchema = z.strictObject({
  protocolVersion: z.literal(1),
  requestId: RequestId,
  runId: IdSchema,
  sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  event: z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("started") }),
    z.strictObject({
      type: z.literal("batchApplied"),
      revisions: z
        .array(z.strictObject({ artifactId: IdSchema, revision: Revision }))
        .min(1)
        .max(32)
        .refine(
          (items) =>
            new Set(items.map((item) => item.artifactId)).size === items.length,
          "Committed artifact IDs must be unique",
        ),
    }),
    z.strictObject({
      type: z.literal("textDelta"),
      text: z.string().min(1).max(2_000),
    }),
    z.strictObject({ type: z.literal("cancelRequested") }),
    z.strictObject({ type: z.literal("completed") }),
    z.strictObject({ type: z.literal("cancelled") }),
    z.strictObject({
      type: z.literal("failed"),
      code: ErrorCodeSchema,
      message: z.string().min(1).max(1_000),
    }),
  ]),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

// Leave room for the versioned response envelope and its correlated request ID.
export const MAX_EVENT_PAGE_BYTES = 14 * 1024;
export const RunEventPageSchema = z
  .strictObject({
    events: z.array(RunEventSchema).max(16),
    nextSequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  })
  .superRefine((page, ctx) => {
    if (
      new TextEncoder().encode(JSON.stringify(page)).length >
      MAX_EVENT_PAGE_BYTES
    )
      ctx.addIssue({
        code: "custom",
        message: "Drain a smaller event page; the response exceeds 14 KiB",
      });
    const first = page.events[0];
    if (
      first &&
      (page.nextSequence !== page.events.at(-1)?.sequence ||
        page.events.some(
          (event, index) =>
            event.sequence !== first.sequence + index ||
            event.runId !== first.runId ||
            event.requestId !== first.requestId,
        ))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Event pages must have contiguous, correlated sequences and the last sequence as cursor",
      });
  });

/** Validate a complete run history, including cancellation and terminal ordering. */
export const RunHistorySchema = z
  .array(RunEventSchema)
  .max(128)
  .superRefine((events, ctx) => {
    let cancelling = false;
    let terminal = false;
    for (const [index, event] of events.entries()) {
      const type = event.event.type;
      if (
        event.sequence !== index + 1 ||
        event.runId !== events[0]?.runId ||
        event.requestId !== events[0]?.requestId ||
        terminal ||
        (index === 0 ? type !== "started" : type === "started") ||
        (cancelling && type !== "cancelled" && type !== "failed") ||
        (type === "cancelled" && !cancelling)
      )
        ctx.addIssue({
          code: "custom",
          path: [index],
          message: "Invalid run event order or correlation",
        });
      cancelling ||= type === "cancelRequested";
      terminal =
        type === "completed" || type === "cancelled" || type === "failed";
    }
  });

/** Envelope; validate `result` with `ResultSchemas[method]`. */
export const RuntimeResponseSchema = z.union([
  z.strictObject({
    protocolVersion: z.literal(1),
    id: RequestId,
    result: z.unknown(),
  }),
  z.strictObject({
    protocolVersion: z.literal(1),
    // Null when the envelope itself could not be validated.
    id: RequestId.nullable(),
    error: z.strictObject({ code: ErrorCodeSchema, message: z.string() }),
  }),
]);

/** Each method paired with its own params. */
export type RuntimeRequest =
  | { protocolVersion: 1; id: string; method: "runtime.ping" }
  | {
      [M in keyof typeof ParamSchemas]: {
        protocolVersion: 1;
        id: string;
        method: M;
        params: RuntimeParams<M>;
      };
    }[keyof typeof ParamSchemas];
export type RuntimeResponse = z.infer<typeof RuntimeResponseSchema>;
export type RuntimeErrorCode = z.infer<typeof ErrorCodeSchema>;
