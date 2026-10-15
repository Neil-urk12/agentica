import {
  CanvasOperationSchema,
  LIMITS,
  type CanvasOperation,
} from "@agentica/protocol";
import type { CanvasDocument } from "./editor.ts";
import { EXCHANGE_RESERVE, type Box } from "./canvas-view.ts";

type Context = Pick<CanvasDocument, "nodes" | "edges" | "artifacts">;

export function exchangePosition(
  nodes: (Box & { id: string })[],
  selectedIds: string[],
  center: { x: number; y: number },
) {
  const selected = nodes.filter((node) => selectedIds.includes(node.id));
  let x = selected.length
    ? Math.max(...selected.map((n) => n.x + n.width)) + 64
    : center.x;
  const y = selected.length ? Math.min(...selected.map((n) => n.y)) : center.y;
  // Reserve room for the compact prompt and reply cards plus a nearby
  // diagram without moving user work; the runtime caps card heights to match.
  for (let attempts = 0; attempts <= nodes.length; attempts++) {
    const overlap = nodes.find(
      (n) =>
        n.x < x + EXCHANGE_RESERVE.width &&
        n.x + n.width > x - 32 &&
        n.y < y + EXCHANGE_RESERVE.height &&
        n.y + n.height > y - 32,
    );
    if (!overlap) return { x, y };
    x = overlap.x + overlap.width + 64;
  }
  throw new Error(
    "There is no room for this exchange. Pan to an open area and retry.",
  );
}

/** The model and preview use the same staged objects; the saved canvas stays untouched. */
export function stageOperations(
  context: Context,
  operations: CanvasOperation[],
): Context {
  if (operations.length > 32)
    throw new Error("A turn supports at most 32 canvas changes.");
  const staged = structuredClone(context);
  for (const input of operations) {
    const operation = CanvasOperationSchema.parse(input);
    if (operation.op === "createText" || operation.op === "createShape") {
      if (
        staged.nodes.some((n) => n.id === operation.nodeId) ||
        staged.artifacts.some((a) => a.id === operation.artifactId)
      )
        throw new Error("Duplicate proposed object identity.");
      const { x, y, width, height, nodeId, artifactId } = operation;
      staged.nodes.push({ id: nodeId, artifactId, x, y, width, height });
      staged.artifacts.push(
        operation.op === "createText"
          ? {
              id: artifactId,
              type: "text",
              schemaVersion: 1,
              revision: 1,
              text: operation.text,
            }
          : {
              id: artifactId,
              type: "drawing",
              schemaVersion: 1,
              revision: 1,
              drawing: {
                shapes: [
                  {
                    kind: operation.kind,
                    x: 0,
                    y: 0,
                    width,
                    height,
                    color: operation.color,
                    label: operation.label,
                  },
                ],
              },
            },
      );
      continue;
    }
    if (operation.op === "connect") {
      if (
        operation.sourceNodeId === operation.targetNodeId ||
        ![operation.sourceNodeId, operation.targetNodeId].every((id) =>
          staged.nodes.some((n) => n.id === id),
        )
      )
        throw new Error(
          "Connect two different objects in the current context.",
        );
      if (
        staged.edges.some(
          (e) =>
            e.id === operation.edgeId ||
            (e.sourceNodeId === operation.sourceNodeId &&
              e.targetNodeId === operation.targetNodeId),
        )
      )
        throw new Error("These objects are already connected.");
      staged.edges.push({
        id: operation.edgeId,
        kind: "relationship",
        sourceNodeId: operation.sourceNodeId,
        targetNodeId: operation.targetNodeId,
      });
      continue;
    }
    const node = staged.nodes.find((n) => n.id === operation.nodeId);
    if (!node) throw new Error("The target is outside this turn's context.");
    const artifact = staged.artifacts.find((a) => a.id === node.artifactId)!;
    if (operation.op === "place") {
      if (
        artifact.type === "drawing" &&
        (artifact.drawing.shapes.length !== 1 ||
          artifact.drawing.shapes[0]?.kind === "path") &&
        (operation.width !== node.width || operation.height !== node.height)
      )
        throw new Error("Freehand and composite drawings support moving only.");
      Object.assign(node, {
        x: operation.x,
        y: operation.y,
        width: operation.width,
        height: operation.height,
      });
    } else if (operation.op === "updateText") {
      if (artifact.type !== "text") throw new Error("The target is not text.");
      artifact.text = operation.text;
    } else {
      if (
        artifact.type !== "drawing" ||
        artifact.drawing.shapes.length !== 1 ||
        artifact.drawing.shapes[0]?.kind === "path"
      )
        throw new Error(
          "Only single rectangles and ellipses support shape edits.",
        );
      artifact.drawing.shapes = [
        {
          kind: operation.kind,
          x: 0,
          y: 0,
          width: node.width,
          height: node.height,
          color: operation.color,
          label: operation.label,
        },
      ];
    }
  }
  return staged;
}

export function checkedToolOperation(args: unknown): CanvasOperation {
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw new Error("Canvas tool arguments must be an object.");
  const value = { ...args } as Record<string, unknown>;
  if (value.op === "createText" || value.op === "createShape") {
    value.nodeId = crypto.randomUUID();
    value.artifactId = crypto.randomUUID();
  } else if (value.op === "connect") value.edgeId = crypto.randomUUID();
  const parsed = CanvasOperationSchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 3)
      .map(
        (issue) => `${issue.path.join(".") || "operation"}: ${issue.message}`,
      )
      .join("; ")
      .slice(0, 500);
    throw new Error(
      `Invalid canvas operation: ${details}. Correct the fields and retry canvas_edit.`,
    );
  }
  return parsed.data;
}

export function textHeight(text: string, width = 340) {
  const columns = Math.max(1, Math.floor(width / 9));
  const lines = text
    .split("\n")
    .reduce(
      (sum, line) => sum + Math.max(1, Math.ceil(line.length / columns)),
      0,
    );
  return Math.min(LIMITS.maxSize, Math.max(160, lines * 24 + 32));
}
