import type { CanvasDocument } from "./editor";

export interface MarkdownExport {
  markdown: string;
  filename: string;
}

function literal(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_{}[\]()#+.!|~-]/g, "\\$&");
}

function fileName(title: string): string {
  let stem = Array.from(title.replace(/\.md$/i, ""))
    .slice(0, 40)
    .join("")
    .replace(/[<>:"/\\|?*]|\p{Cc}/gu, "")
    .trim()
    .replace(/^\.+|[. ]+$/g, "");
  if (!stem) stem = "canvas";
  if (
    /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])\s*(?:\.|$)/i.test(
      stem,
    )
  )
    stem = `_${stem}`;
  return `${stem}.md`;
}

/** Only placed canvas content is shared, never chat or runtime metadata. */
export function canvasMarkdown(document: CanvasDocument): MarkdownExport {
  const artifacts = new Map(document.artifacts.map((item) => [item.id, item]));
  const nodes = [...document.nodes].sort(
    (a, b) =>
      a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const numbers = new Map(nodes.map((node, index) => [node.id, index + 1]));
  const sections = [`# ${literal(document.canvas.title) || "Canvas"}`];
  if (!nodes.length) sections.push("This canvas is empty.");
  for (const node of nodes) {
    const artifact = artifacts.get(node.artifactId)!;
    const heading = `## Item ${numbers.get(node.id)} — `;
    switch (artifact.type) {
      case "text":
        sections.push(
          heading + (node.task ? "Task" : "Note"),
          ...(node.task ? [`- [${node.task.done ? "x" : " "}] Completed`] : []),
          artifact.text,
        );
        break;
      case "drawing": {
        const labels = artifact.drawing.shapes.flatMap((shape) =>
          shape.kind !== "path" && shape.label?.trim()
            ? [`- ${literal(shape.label)}`]
            : [],
        );
        sections.push(heading + "Drawing", "Visual content is not rendered.");
        if (labels.length) sections.push(labels.join("\n"));
        break;
      }
      case "file":
        sections.push(
          heading + "Attachment",
          `${literal(artifact.name.split(/[\\/]/).pop() || "Attachment")} — File contents are not included.`,
        );
        break;
      case "web-preview":
        sections.push(
          heading + "Live preview",
          "Live preview content and its URL are not included.",
        );
        break;
    }
  }
  if (document.projectGroups.length || document.sessionTiles.length)
    sections.push(
      "Project frames and session tiles are not rendered. Local paths, commands, and terminal output are not included.",
    );
  const connections = document.edges
    .map((edge) => ({
      source: numbers.get(edge.sourceNodeId)!,
      target: numbers.get(edge.targetNodeId)!,
    }))
    .sort((a, b) => a.source - b.source || a.target - b.target);
  if (connections.length)
    sections.push(
      "## Connections",
      connections
        .map(({ source, target }) => `- Item ${source} → Item ${target}`)
        .join("\n"),
    );
  return {
    markdown: sections.join("\n\n") + "\n",
    filename: fileName(document.canvas.title),
  };
}

export function downloadMarkdown(file: MarkdownExport): void {
  const link = document.createElement("a");
  const url = URL.createObjectURL(
    new Blob([file.markdown], { type: "text/markdown;charset=utf-8" }),
  );
  try {
    link.href = url;
    link.download = file.filename;
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Let the browser consume the click before releasing the file.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
