import { z } from "zod";

export const MAX_FRAME_BYTES = 16 * 1024;

// Limits shared with packages/agent-runtime/src/commands.rs.
export const LIMITS = {
  label: 120,
  text: 10_000,
  coordinate: 1_000_000,
  minSize: 40,
  maxSize: 4_000,
  minZoom: 0.1,
  maxZoom: 4,
} as const;

const RequestId = z.string().min(1).max(128);
// Lowercase UUID identities; clients never send paths.
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
});
export const DrawingSchema = z.strictObject({
  shapes: z
    .array(z.union([PathShapeSchema, BoxShapeSchema]))
    .min(1)
    .max(1_000),
});
export type Drawing = z.infer<typeof DrawingSchema>;
const ParamSchemas = {
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
  "canvas.save": z.strictObject({
    ...CanvasRef,
    expectedRevision: Revision,
    viewport: ViewportSchema,
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
  "canvas.open": z.strictObject({
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
