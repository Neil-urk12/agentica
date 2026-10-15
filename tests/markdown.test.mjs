import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseInline,
  parseMarkdown,
  plainText,
  safeHref,
} from "../apps/desktop/src/lib/markdown.ts";

/** Every text value in the token tree, in order. */
const texts = (blocks) =>
  blocks
    .map((block) =>
      block.t === "code"
        ? block.v
        : block.t === "list"
          ? block.items.map((item) => plainText(item.c)).join("\n")
          : plainText(block.c),
    )
    .join("\n");

test("reading structure replaces formatting markers without changing the source", () => {
  const source =
    "## **Release plan**\n\n- Draft notes\n- Review *copy*\n- Ship `v1`";
  const before = source;
  const blocks = parseMarkdown(source);
  assert.equal(source, before);
  assert.deepEqual(
    blocks.map((block) => block.t),
    ["h", "list"],
  );
  assert.equal(blocks[0].level, 2);
  assert.equal(blocks[0].c[0].t, "strong");
  assert.equal(plainText(blocks[0].c), "Release plan");
  assert.equal(blocks[1].ordered, false);
  assert.equal(blocks[1].items.length, 3);
  assert.equal(blocks[1].items[1].c[1].t, "em");
  assert.deepEqual(blocks[1].items[2].c.at(-1), { t: "code", v: "v1" });
  assert.doesNotMatch(texts(blocks), /\*\*|##|^- /m);
});

test("ordered lists, paragraphs, and fenced code keep their content", () => {
  const blocks = parseMarkdown(
    "Intro line\nsecond line\n\n3. three\n4. four\n   continued\n\n```js\nconst a = '<b>';\n```",
  );
  assert.deepEqual(
    blocks.map((block) => block.t),
    ["p", "list", "code"],
  );
  assert.equal(plainText(blocks[0].c), "Intro line\nsecond line");
  assert.equal(blocks[1].ordered, true);
  assert.equal(blocks[1].start, 3);
  assert.equal(plainText(blocks[1].items[1].c), "four\ncontinued");
  assert.deepEqual(blocks[2], { t: "code", lang: "js", v: "const a = '<b>';" });
});

test("unsupported formatting stays readable as literal text", () => {
  const source =
    "> quoted\n| a | b |\n<div>html</div>\nsnake_case_name and 2 * 3";
  const blocks = parseMarkdown(source);
  assert.equal(texts(blocks), source);
  // An unterminated fence keeps everything after it.
  assert.equal(parseMarkdown("```\nopen code").at(-1).v, "open code");
});

test("executable markup, embedded images, and unsafe links stay inert", () => {
  const blocks = parseMarkdown(
    "<script>alert(1)</script>\n\n![tracker](https://example.com/p.png)\n\n[run](javascript:alert(1)) [data](data:text/html,x) [ok](https://example.com/a?b=1)",
  );
  const all = JSON.stringify(blocks);
  // Script markup is plain text, never an element token.
  assert.equal(plainText(blocks[0].c), "<script>alert(1)</script>");
  // Images are literal source text: no image token exists to fetch.
  assert.deepEqual(blocks[1].c, [
    { t: "text", v: "![tracker](https://example.com/p.png)" },
  ]);
  const links = blocks[2].c.filter((node) => node.t === "link");
  assert.deepEqual(
    links.map((link) => link.href),
    [null, null, "https://example.com/a?b=1"],
  );
  assert.equal(plainText(blocks[2].c), "run data ok");
  assert.doesNotMatch(all, /"href":"(javascript|data):/);
});

test("only explicit HTTP(S) destinations are actionable", () => {
  assert.equal(safeHref("https://example.com"), "https://example.com/");
  assert.equal(safeHref("http://localhost:3000/x"), "http://localhost:3000/x");
  for (const unsafe of [
    "javascript:alert(1)",
    " JAVASCRIPT:alert(1)",
    "vbscript:x",
    "file:///etc/passwd",
    "//example.com",
    "/relative",
    "mailto:a@example.com",
  ])
    assert.equal(safeHref(unsafe), null, unsafe);
});

test("deep nesting and long tokens are bounded", () => {
  const deep = "*".repeat(40) + "x" + "*".repeat(40);
  assert.equal(plainText(parseInline(deep)).includes("x"), true);
  const long = "a".repeat(10_000);
  assert.equal(plainText(parseMarkdown(long)[0].c), long);
  assert.equal(plainText(parseInline("\\*not emphasis\\*")), "*not emphasis*");
});
