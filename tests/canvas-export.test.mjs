import assert from "node:assert/strict";
import { test } from "node:test";
import { canvasMarkdown } from "../apps/desktop/src/lib/canvas-export.ts";

function canvas() {
  return {
    canvas: {
      id: "canvas-id",
      title: "Research board",
      revision: 1,
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    nodes: [],
    artifacts: [],
    edges: [],
    projectGroups: [],
    sessionTiles: [],
  };
}

function note(doc, id, text, x = 0, y = 0, task = null) {
  const node = {
    id,
    artifactId: `artifact-${id}`,
    x,
    y,
    width: 100,
    height: 40,
    task,
  };
  doc.nodes.push(node);
  doc.artifacts.push({
    id: node.artifactId,
    type: "text",
    schemaVersion: 1,
    revision: 1,
    text,
  });
  return node;
}

test("Markdown includes full note source and both task completion states", () => {
  const doc = canvas();
  const source =
    "# Original heading\n\n" +
    "Long clipped content\n".repeat(80) +
    "\n```js\nconst x = 1;\n```\n";
  note(doc, "plain", source);
  note(doc, "done", "Shipped", 0, 100, { done: true });
  note(doc, "todo", "Next step", 0, 200, { done: false });
  const { markdown, filename } = canvasMarkdown(doc);
  assert.equal(filename, "Research board.md");
  assert.ok(markdown.startsWith("# Research board\n\n"));
  assert.ok(markdown.includes(source));
  assert.match(markdown, /## Item 2 — Task\n\n- \[x\] Completed\n\nShipped/);
  assert.match(markdown, /## Item 3 — Task\n\n- \[ \] Completed\n\nNext step/);
});

test("ordering is spatial with stable ID ties, independent of viewport and input order", () => {
  const doc = canvas();
  note(doc, "bottom", "Bottom", -50, 200);
  note(doc, "b", "Tie B", 30, 0);
  note(doc, "a", "Tie A", 30, 0);
  note(doc, "left", "Left", -10, 0);
  const before = structuredClone(doc);
  const { markdown } = canvasMarkdown(doc);
  assert.match(markdown, /Item 1 — Note\n\nLeft/);
  assert.match(markdown, /Item 2 — Note\n\nTie A/);
  assert.match(markdown, /Item 3 — Note\n\nTie B/);
  assert.match(markdown, /Item 4 — Note\n\nBottom/);
  assert.deepEqual(doc, before, "serialization must not mutate the document");
  doc.nodes.reverse();
  doc.canvas.viewport = { x: 999, y: -100, zoom: 0.25 };
  assert.equal(canvasMarkdown(doc).markdown, markdown);
});

test("each placement appears but unplaced artifacts do not; connections use item numbers", () => {
  const doc = canvas();
  const first = note(doc, "a", "Same text", 0, 0);
  doc.nodes.push({ ...first, id: "b", y: 100 });
  doc.artifacts.push({
    id: "unplaced",
    type: "text",
    text: "UNPLACED_PRIVATE",
  });
  doc.edges = [
    {
      id: "edge-2",
      kind: "relationship",
      sourceNodeId: "b",
      targetNodeId: "a",
    },
    {
      id: "edge-1",
      kind: "relationship",
      sourceNodeId: "a",
      targetNodeId: "b",
    },
  ];
  const { markdown } = canvasMarkdown(doc);
  assert.equal(markdown.match(/Same text/g).length, 2);
  assert.ok(!markdown.includes("UNPLACED_PRIVATE"));
  assert.ok(
    markdown.endsWith(
      "## Connections\n\n- Item 1 → Item 2\n- Item 2 → Item 1\n",
    ),
  );
  assert.ok(!markdown.includes("artifact-a"));
  assert.ok(!markdown.includes("edge-1"));
});

test("an empty canvas is a useful Markdown document", () => {
  assert.deepEqual(canvasMarkdown(canvas()), {
    filename: "Research board.md",
    markdown: "# Research board\n\nThis canvas is empty.\n",
  });
});

test("non-text nodes describe losses without reading file bytes or extracted text", () => {
  const doc = canvas();
  for (const [id, artifact] of [
    [
      "shape",
      {
        type: "drawing",
        drawing: {
          shapes: [{ kind: "rectangle", label: "**Label** <img>\nnext" }],
        },
      },
    ],
    [
      "stroke",
      {
        type: "drawing",
        drawing: {
          shapes: [
            {
              kind: "path",
              points: [
                [0, 0],
                [20, 20],
              ],
            },
          ],
        },
      },
    ],
    [
      "file",
      {
        type: "file",
        name: "C:\\private\\notes[1].pdf",
        get text() {
          throw new Error("Do not extract text");
        },
        get data() {
          throw new Error("Do not read bytes");
        },
      },
    ],
    ["preview", { type: "web-preview", url: "http://localhost/private-token" }],
  ]) {
    doc.nodes.push({ id, artifactId: id, x: 0, y: doc.nodes.length * 100 });
    artifact.id = id;
    doc.artifacts.push(artifact);
  }
  const { markdown } = canvasMarkdown(doc);
  assert.equal(markdown.match(/Visual content is not rendered\./g).length, 2);
  assert.ok(markdown.includes("\\*\\*Label\\*\\* &lt;img&gt; next"));
  assert.ok(
    markdown.includes("notes\\[1\\]\\.pdf — File contents are not included."),
  );
  assert.ok(
    markdown.includes("Live preview content and its URL are not included."),
  );
  assert.ok(!markdown.includes("private"));
});

test("metadata is literal but Markdown note source is shared unchanged", () => {
  const doc = canvas();
  doc.canvas.title = "# Title\n<script>& [link](https://example.com)";
  const source =
    "# User heading\n\n**Bold** & <custom-tag>\n\n```\n# code\n```\n";
  note(doc, "a", source);
  const { markdown } = canvasMarkdown(doc);
  assert.ok(
    markdown.startsWith(
      "# \\# Title &lt;script&gt;&amp; \\[link\\]\\(https://example\\.com\\)\n\n",
    ),
  );
  assert.ok(markdown.includes(source));
});

test("private state stays out, while user-authored paths and legacy cards stay in", () => {
  const doc = canvas();
  note(doc, "legacy", "LEGACY_CARD_TEXT");
  note(doc, "secret-note", "User wrote /home/private and NOTE_SECRET", 0, 100, {
    done: false,
    assignedTileId: "PRIVATE_ASSIGNMENT",
    context: [{ nodeId: "PRIVATE_CONTEXT" }],
  });
  doc.projectGroups.push({
    rootPath: "PRIVATE_PROJECT",
    label: "PRIVATE_GROUP",
  });
  doc.sessionTiles.push({
    command: "PRIVATE_COMMAND",
    env: "PRIVATE_ENV",
    output: "PRIVATE_TERMINAL",
  });
  doc.turns = [{ text: "PRIVATE_CHAT" }];
  doc.proposals = [{ text: "PRIVATE_PROPOSAL" }];
  doc.settings = { apiKey: "PRIVATE_CREDENTIAL" };
  const { markdown } = canvasMarkdown(doc);
  assert.ok(!markdown.includes("PRIVATE_"));
  assert.ok(markdown.includes("LEGACY_CARD_TEXT"));
  assert.ok(markdown.includes("User wrote /home/private and NOTE_SECRET"));
  assert.ok(
    markdown.includes("Project frames and session tiles are not rendered."),
  );
});

for (const [title, expected] of [
  ["", "canvas.md"],
  ["...", "canvas.md"],
  ['/\\:*?"<>|\u0000\u001f\u007f', "canvas.md"],
  ["../../notes", "notes.md"],
  ["CON", "_CON.md"],
  ["LPT1.notes", "_LPT1.notes.md"],
  ["COM¹", "_COM¹.md"],
  ["CONIN$", "_CONIN$.md"],
  ["CON .txt", "_CON .txt.md"],
  ["board.md", "board.md"],
  ["board. ", "board.md"],
  ["研究", "研究.md"],
]) {
  test(`suggested filename is safe for ${JSON.stringify(title)}`, () => {
    const doc = canvas();
    doc.canvas.title = title;
    assert.equal(canvasMarkdown(doc).filename, expected);
  });
}

test("long Unicode titles fit a filesystem component without breaking characters", () => {
  const doc = canvas();
  doc.canvas.title = "😀".repeat(300);
  const { filename } = canvasMarkdown(doc);
  assert.ok(Buffer.byteLength(filename) < 255);
  assert.ok(!filename.includes("\ufffd"));
});
