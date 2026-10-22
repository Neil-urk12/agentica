/**
 * A bounded Markdown subset for reading canvas text. The output is a token
 * tree rendered through escaped Svelte interpolation; no HTML is produced or
 * trusted, and images are never turned into resource requests.
 *
 * Supported: paragraphs, ATX headings, ordered and unordered lists, strong
 * and emphasis, inline code, fenced code blocks, and links. Anything else
 * (HTML, images, tables, quotes) stays visible as literal text.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  /** `href` is null when the destination is not plain HTTP(S). */
  | { t: "link"; href: string | null; c: Inline[] };

export type ListItem = { depth: number; c: Inline[] };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: "code"; lang: string; v: string }
  | { t: "list"; ordered: boolean; start: number; items: ListItem[] };

/** Inline nesting deeper than this is shown as literal text. */
const MAX_DEPTH = 4;
/** Nested list indentation is capped so deep outlines remain readable. */
const MAX_LIST_DEPTH = 3;

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const BULLET = /^(\s*)[-*+][ \t]+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)][ \t]+(.*)$/;

/** Only explicit HTTP(S) destinations are actionable. */
export function safeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function indentDepth(indent: string) {
  const width = indent.replace(/\t/g, "  ").length;
  return Math.min(MAX_LIST_DEPTH, Math.floor(width / 2));
}

function listMarker(line: string) {
  const ordered = ORDERED.exec(line);
  if (ordered)
    return {
      ordered: true,
      depth: indentDepth(ordered[1]!),
      start: Number(ordered[2]),
      text: ordered[3]!,
    };
  const bullet = BULLET.exec(line);
  if (bullet)
    return {
      ordered: false,
      depth: indentDepth(bullet[1]!),
      start: 1,
      text: bullet[2]!,
    };
  return null;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length)
      blocks.push({ t: "p", c: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.trim()) {
      flush();
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const marker = fence[1]!;
      const body: string[] = [];
      index++;
      while (index < lines.length) {
        const next = lines[index]!;
        const close = next.trim();
        if (
          close.length >= marker.length &&
          [...close].every((c) => c === marker[0])
        )
          break;
        body.push(next);
        index++;
      }
      blocks.push({ t: "code", lang: fence[2] ?? "", v: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({
        t: "h",
        level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
        c: parseInline(heading[2] ?? ""),
      });
      continue;
    }
    const marker = listMarker(line);
    if (marker) {
      flush();
      const list: Block & { t: "list" } = {
        t: "list",
        ordered: marker.ordered,
        start: marker.start,
        items: [],
      };
      const texts: { depth: number; lines: string[] }[] = [];
      while (index < lines.length) {
        const current = lines[index]!;
        const item = listMarker(current);
        if (item) {
          // A different top-level marker type starts a new list.
          if (item.depth === 0 && item.ordered !== list.ordered && texts.length)
            break;
          texts.push({ depth: item.depth, lines: [item.text] });
        } else if (current.trim() && /^\s+/.test(current) && texts.length) {
          texts.at(-1)!.lines.push(current.trim());
        } else break;
        index++;
      }
      index--;
      list.items = texts.map((item) => ({
        depth: item.depth,
        c: parseInline(item.lines.join("\n")),
      }));
      blocks.push(list);
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

function pushText(out: Inline[], value: string) {
  if (!value) return;
  const last = out.at(-1);
  if (last?.t === "text") last.v += value;
  else out.push({ t: "text", v: value });
}

/** Find the closing delimiter for emphasis, skipping code spans. */
function closing(text: string, from: number, delimiter: string) {
  for (let index = from; index < text.length; index++) {
    if (text[index] === "\\") {
      index++;
      continue;
    }
    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1);
      if (end > 0) index = end;
      continue;
    }
    if (
      text.startsWith(delimiter, index) &&
      !/\s/.test(text[index - 1] ?? " ") &&
      // A single `*` must not close at the start of `**`.
      (delimiter.length === 2 || text[index + 1] !== delimiter[0])
    )
      return index;
  }
  return -1;
}

/** Match `[text](destination)` starting at a `[`; returns indices or null. */
function matchLink(text: string, start: number) {
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (char === "\\") index++;
    else if (char === "[") depth++;
    else if (char === "]" && --depth === 0) {
      if (text[index + 1] !== "(") return null;
      // Destinations may contain balanced parentheses, as in `f(1)`.
      let parens = 0;
      let end = -1;
      for (let at = index + 2; at < text.length; at++) {
        if (text[at] === "\\") at++;
        else if (text[at] === "(") parens++;
        else if (text[at] === ")" && parens-- === 0) {
          end = at;
          break;
        }
      }
      if (end < 0) return null;
      const destination = text
        .slice(index + 2, end)
        .trim()
        .split(/\s+/)[0]!
        .replace(/^<(.*)>$/, "$1");
      return { labelEnd: index, end, destination };
    }
  }
  return null;
}

export function parseInline(text: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  if (depth > MAX_DEPTH) {
    pushText(out, text);
    return out;
  }
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "\\" && /[\\`*_[\]()#+\-.!>~]/.test(text[index + 1] ?? "")) {
      pushText(out, text[index + 1]!);
      index += 2;
      continue;
    }
    if (char === "`") {
      const run = /^`+/.exec(text.slice(index))![0];
      const end = text.indexOf(run, index + run.length);
      if (end > 0) {
        out.push({ t: "code", v: text.slice(index + run.length, end).trim() });
        index = end + run.length;
        continue;
      }
      pushText(out, run);
      index += run.length;
      continue;
    }
    if (char === "!" && text[index + 1] === "[") {
      // Images stay literal so no embedded resource is ever requested.
      const image = matchLink(text, index + 1);
      if (image) {
        pushText(out, text.slice(index, image.end + 1));
        index = image.end + 1;
        continue;
      }
    }
    if (char === "[") {
      const link = matchLink(text, index);
      if (link) {
        out.push({
          t: "link",
          href: safeHref(link.destination),
          c: parseInline(text.slice(index + 1, link.labelEnd), depth + 1),
        });
        index = link.end + 1;
        continue;
      }
    }
    if (char === "*" || char === "_") {
      const double = text[index + 1] === char;
      const delimiter = double ? char + char : char;
      const open = index + delimiter.length;
      // Intraword underscores (snake_case) are literal.
      const intraword =
        char === "_" && /[\p{L}\p{N}]/u.test(text[index - 1] ?? "");
      if (!intraword && text[open] && !/\s/.test(text[open]!)) {
        const end = closing(text, open, delimiter);
        if (end > open) {
          out.push({
            t: double ? "strong" : "em",
            c: parseInline(text.slice(open, end), depth + 1),
          });
          index = end + delimiter.length;
          continue;
        }
      }
      pushText(out, delimiter);
      index += delimiter.length;
      continue;
    }
    pushText(out, char);
    index++;
  }
  return out;
}
