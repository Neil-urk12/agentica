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
// Runtime-generated lowercase UUIDs; clients never send paths.
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
]);

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
