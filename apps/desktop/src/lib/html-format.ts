/**
 * Read-only pretty printing and syntax highlighting for design HTML. The
 * output is tokens rendered as text, never markup, so a design's source can
 * be shown without being interpreted by the app.
 */
export type TokenKind =
  | "punct"
  | "tag"
  | "attr"
  | "value"
  | "text"
  | "comment"
  | "doctype"
  | "selector"
  | "atrule"
  | "property"
  | "cssvalue";

export interface Token {
  kind: TokenKind;
  text: string;
}

export interface CodeLine {
  indent: number;
  tokens: Token[];
}

const VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "source",
  "track",
  "wbr",
]);
const RAW = new Set(["style", "script"]);
/** Short `<tag>text</tag>` runs stay on one line up to this many characters. */
const INLINE_LIMIT = 100;

type Node =
  | { type: "open"; name: string; tokens: Token[]; selfClosing: boolean }
  | { type: "close"; name: string; tokens: Token[] }
  | { type: "text"; text: string }
  | { type: "comment"; text: string }
  | { type: "doctype"; text: string }
  | { type: "raw"; name: string; text: string };

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

function readTag(source: string, start: number) {
  // Find the closing `>` outside quoted attribute values.
  let quote = "";
  let index = start + 1;
  for (; index < source.length; index++) {
    const character = source[index]!;
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ">") break;
  }
  return { body: source.slice(start + 1, index), end: index + 1 };
}

function tagTokens(
  body: string,
  closing: boolean,
): {
  name: string;
  tokens: Token[];
  selfClosing: boolean;
} {
  let rest = closing ? body.slice(1) : body;
  const selfClosing = !closing && /\/\s*$/.test(rest);
  if (selfClosing) rest = rest.replace(/\/\s*$/, "");
  const name = /^[^\s/>]+/.exec(rest)?.[0] ?? "";
  const tokens: Token[] = [
    { kind: "punct", text: closing ? "</" : "<" },
    { kind: "tag", text: name.toLowerCase() },
  ];
  const attributes = /([^\s=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"']+))?/g;
  for (const match of rest.slice(name.length).matchAll(attributes)) {
    tokens.push({ kind: "text", text: " " });
    tokens.push({ kind: "attr", text: match[1]! });
    if (match[2] !== undefined) {
      tokens.push({ kind: "punct", text: "=" });
      tokens.push({ kind: "value", text: match[2] });
    }
  }
  tokens.push({ kind: "punct", text: selfClosing ? " />" : ">" });
  return { name: name.toLowerCase(), tokens, selfClosing };
}

function parse(source: string): Node[] {
  const nodes: Node[] = [];
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      const stop = end < 0 ? source.length : end + 3;
      nodes.push({ type: "comment", text: source.slice(index, stop) });
      index = stop;
    } else if (
      source.startsWith("<!", index) ||
      source.startsWith("<?", index)
    ) {
      const end = source.indexOf(">", index);
      const stop = end < 0 ? source.length : end + 1;
      nodes.push({
        type: "doctype",
        text: collapse(source.slice(index, stop)),
      });
      index = stop;
    } else if (/^<\/?[a-zA-Z]/.test(source.slice(index, index + 3))) {
      const { body, end } = readTag(source, index);
      const closing = body.startsWith("/");
      const tag = tagTokens(body, closing);
      nodes.push(
        closing
          ? { type: "close", name: tag.name, tokens: tag.tokens }
          : { type: "open", ...tag },
      );
      index = end;
      if (!closing && RAW.has(tag.name)) {
        const lower = source.toLowerCase();
        const close = lower.indexOf(`</${tag.name}`, index);
        const stop = close < 0 ? source.length : close;
        nodes.push({
          type: "raw",
          name: tag.name,
          text: source.slice(index, stop),
        });
        index = stop;
      }
    } else {
      const next = source.indexOf("<", index + 1);
      const stop = next < 0 ? source.length : next;
      const text = collapse(source.slice(index, stop));
      if (text) nodes.push({ type: "text", text });
      index = stop;
    }
  }
  return nodes;
}

const width = (tokens: Token[]) =>
  tokens.reduce((sum, token) => sum + token.text.length, 0);

/** One CSS rule or declaration per line, nested by braces. */
export function formatCss(source: string, indent = 0): CodeLine[] {
  const lines: CodeLine[] = [];
  let depth = 0;
  let buffer = "";
  let quote = "";
  const declaration = (text: string) => {
    const colon = text.indexOf(":");
    if (colon < 0 || text.startsWith("@")) {
      lines.push({
        indent: indent + depth,
        tokens: [
          { kind: text.startsWith("@") ? "atrule" : "cssvalue", text },
          { kind: "punct", text: ";" },
        ],
      });
      return;
    }
    lines.push({
      indent: indent + depth,
      tokens: [
        { kind: "property", text: text.slice(0, colon).trim() },
        { kind: "punct", text: ": " },
        { kind: "cssvalue", text: text.slice(colon + 1).trim() },
        { kind: "punct", text: ";" },
      ],
    });
  };
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (quote) {
      buffer += character;
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      buffer += character;
    } else if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      const stop = end < 0 ? source.length : end + 2;
      lines.push({
        indent: indent + depth,
        tokens: [{ kind: "comment", text: source.slice(index, stop) }],
      });
      index = stop - 1;
    } else if (character === "{") {
      const selector = collapse(buffer);
      lines.push({
        indent: indent + depth,
        tokens: [
          {
            kind: selector.startsWith("@") ? "atrule" : "selector",
            text: selector,
          },
          { kind: "punct", text: " {" },
        ],
      });
      depth += 1;
      buffer = "";
    } else if (character === "}") {
      const pending = collapse(buffer);
      if (pending) declaration(pending);
      depth = Math.max(0, depth - 1);
      lines.push({
        indent: indent + depth,
        tokens: [{ kind: "punct", text: "}" }],
      });
      buffer = "";
    } else if (character === ";") {
      const pending = collapse(buffer);
      if (pending) declaration(pending);
      buffer = "";
    } else buffer += character;
  }
  const rest = collapse(buffer);
  if (rest)
    lines.push({
      indent: indent + depth,
      tokens: [{ kind: "cssvalue", text: rest }],
    });
  return lines;
}

/** Indented, tokenized lines for an HTML document. */
export function formatHtml(source: string): CodeLine[] {
  const nodes = parse(source);
  const lines: CodeLine[] = [];
  let depth = 0;
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    if (node.type === "open") {
      const text = nodes[index + 1];
      const close = nodes[index + 2];
      // `<h1>Title</h1>` reads best on one line when it is short.
      if (
        text?.type === "text" &&
        close?.type === "close" &&
        close.name === node.name &&
        width(node.tokens) + text.text.length + width(close.tokens) <=
          INLINE_LIMIT
      ) {
        lines.push({
          indent: depth,
          tokens: [
            ...node.tokens,
            { kind: "text", text: text.text },
            ...close.tokens,
          ],
        });
        index += 2;
        continue;
      }
      if (
        close?.type === "close" &&
        text?.type === "raw" &&
        !text.text.trim()
      ) {
        lines.push({
          indent: depth,
          tokens: [...node.tokens, ...close.tokens],
        });
        index += 2;
        continue;
      }
      if (text?.type === "close" && text.name === node.name) {
        lines.push({ indent: depth, tokens: [...node.tokens, ...text.tokens] });
        index += 1;
        continue;
      }
      lines.push({ indent: depth, tokens: node.tokens });
      if (!node.selfClosing && !VOID.has(node.name)) depth += 1;
    } else if (node.type === "close") {
      depth = Math.max(0, depth - 1);
      lines.push({ indent: depth, tokens: node.tokens });
    } else if (node.type === "raw") {
      if (node.name === "style") lines.push(...formatCss(node.text, depth));
      else
        for (const line of node.text.split(/\r?\n/))
          if (line.trim())
            lines.push({
              indent: depth,
              tokens: [{ kind: "text", text: line.trim() }],
            });
    } else {
      lines.push({
        indent: depth,
        tokens: [
          { kind: node.type === "text" ? "text" : node.type, text: node.text },
        ],
      });
    }
  }
  return lines;
}

/** The formatted source as plain text, for copying. */
export function linesToText(lines: CodeLine[]): string {
  return lines
    .map(
      (line) =>
        "  ".repeat(line.indent) +
        line.tokens.map((token) => token.text).join(""),
    )
    .join("\n");
}
