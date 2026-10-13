export type Tool =
  | "select"
  | "pan"
  | "draw"
  | "arrow"
  | "rectangle"
  | "ellipse"
  | "eraser"
  | "text";

export interface ToolSpec {
  tool: Tool;
  icon: string;
  label: string;
  hint: string;
  key: string;
}

/** Toolbar order mirrors tldraw: pointer, hand, then creation tools. */
export const TOOLS: ToolSpec[] = [
  {
    tool: "select",
    icon: "near_me",
    label: "Select",
    hint: "Select and move items",
    key: "V",
  },
  {
    tool: "pan",
    icon: "pan_tool",
    label: "Hand",
    hint: "Pan the canvas",
    key: "P",
  },
  {
    tool: "draw",
    icon: "edit",
    label: "Draw",
    hint: "Draw freehand",
    key: "D",
  },
  {
    tool: "arrow",
    icon: "call_made",
    label: "Arrow",
    hint: "Drag from one item to another to connect them",
    key: "A",
  },
  {
    tool: "rectangle",
    icon: "crop_square",
    label: "Rectangle",
    hint: "Draw a rectangle",
    key: "R",
  },
  {
    tool: "ellipse",
    icon: "circle",
    label: "Ellipse",
    hint: "Draw an ellipse",
    key: "O",
  },
  {
    tool: "eraser",
    icon: "auto_fix_normal",
    label: "Eraser",
    hint: "Erase a drawing",
    key: "E",
  },
  {
    tool: "text",
    icon: "text_fields",
    label: "Text",
    hint: "Add text",
    key: "T",
  },
];

/** Pointer tool, shown in its own card apart from the action tools. */
export const PRIMARY_TOOLS = TOOLS.filter((item) => item.tool === "select");

/** Everything from pan to text: the creation/action tools, shown together. */
export const ACTION_TOOLS = TOOLS.filter((item) => item.tool !== "select");

export const DRAWING_TOOLS: Tool[] = ["draw", "rectangle", "ellipse"];

/** Single-key shortcuts, matching tldraw where the tools overlap. */
export const TOOL_KEYS: Record<string, Tool> = Object.fromEntries(
  TOOLS.map((item) => [item.key.toLowerCase(), item.tool]),
);

/** Mid-tone swatches that stay legible on both light and dark canvases. */
export const STROKE_COLORS = [
  "#7b7bf0",
  "#ef4444",
  "#22c55e",
  "#f59e0b",
  "#38bdf8",
  "#64748b",
];

export const STROKE_WIDTHS = [2, 4, 8];

export const DEFAULT_STROKE_COLOR = "#7b7bf0";
export const DEFAULT_STROKE_WIDTH = 4;
