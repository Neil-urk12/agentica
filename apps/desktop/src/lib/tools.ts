export type Tool =
  | "select"
  | "pan"
  | "draw"
  | "rectangle"
  | "ellipse"
  | "eraser"
  | "text";

export interface ToolSpec {
  tool: Tool;
  icon: string;
  label: string;
  hint: string;
}

/** Toolbar order mirrors tldraw: pointer, hand, then creation tools. */
export const TOOLS: ToolSpec[] = [
  {
    tool: "select",
    icon: "near_me",
    label: "Select",
    hint: "Select and move items",
  },
  { tool: "pan", icon: "pan_tool", label: "Hand", hint: "Pan the canvas" },
  { tool: "draw", icon: "edit", label: "Draw", hint: "Draw freehand" },
  {
    tool: "rectangle",
    icon: "crop_square",
    label: "Rectangle",
    hint: "Draw a rectangle",
  },
  {
    tool: "ellipse",
    icon: "circle",
    label: "Ellipse",
    hint: "Draw an ellipse",
  },
  {
    tool: "eraser",
    icon: "auto_fix_normal",
    label: "Eraser",
    hint: "Erase a drawing",
  },
  { tool: "text", icon: "text_fields", label: "Text", hint: "Add text" },
];

export const DRAWING_TOOLS: Tool[] = ["draw", "rectangle", "ellipse"];
