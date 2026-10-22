import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatCss,
  formatHtml,
  linesToText,
} from "../apps/desktop/src/lib/html-format.ts";

test("minified design HTML is indented one element per line", () => {
  const source = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:system-ui}h1{color:#fff}</style></head><body><main class="hero" id=top><h1>Launch faster</h1><p>Ship <b>today</b> with the team.</p><br><img src="" alt='Logo'/></main></body></html>`;
  assert.equal(
    linesToText(formatHtml(source)),
    [
      "<!doctype html>",
      "<html>",
      "  <head>",
      '    <meta charset="utf-8">',
      "    <style>",
      "      body {",
      "        margin: 0;",
      "        font-family: system-ui;",
      "      }",
      "      h1 {",
      "        color: #fff;",
      "      }",
      "    </style>",
      "  </head>",
      "  <body>",
      '    <main class="hero" id=top>',
      "      <h1>Launch faster</h1>",
      "      <p>",
      "        Ship",
      "        <b>today</b>",
      "        with the team.",
      "      </p>",
      "      <br>",
      `      <img src="" alt='Logo' />`,
      "    </main>",
      "  </body>",
      "</html>",
    ].join("\n"),
  );
});

test("tokens classify tags, attributes, values, comments, and CSS", () => {
  const [line] = formatHtml(`<a href="#x" data-on>Go</a>`);
  assert.deepEqual(
    line.tokens.map((token) => [token.kind, token.text]),
    [
      ["punct", "<"],
      ["tag", "a"],
      ["text", " "],
      ["attr", "href"],
      ["punct", "="],
      ["value", '"#x"'],
      ["text", " "],
      ["attr", "data-on"],
      ["punct", ">"],
      ["text", "Go"],
      ["punct", "</"],
      ["tag", "a"],
      ["punct", ">"],
    ],
  );
  assert.equal(formatHtml("<!-- note -->")[0].tokens[0].kind, "comment");
  const css = formatCss(`@media (max-width:600px){.a{content:"x;y"}}/* c */`);
  assert.deepEqual(
    css.map((line) => [line.indent, line.tokens.map((t) => t.text).join("")]),
    [
      [0, "@media (max-width:600px) {"],
      [1, ".a {"],
      [2, 'content: "x;y";'],
      [1, "}"],
      [0, "}"],
      [0, "/* c */"],
    ],
  );
  assert.equal(css[0].tokens[0].kind, "atrule");
  assert.equal(css[2].tokens[0].kind, "property");
});

test("malformed or hostile input is shown, not interpreted or dropped", () => {
  const lines = formatHtml(
    `<div title="a > b"><script>alert(1)</script><p>unclosed`,
  );
  const text = linesToText(lines);
  assert.match(text, /<div title="a > b">/);
  assert.match(text, /alert\(1\)/);
  assert.match(text, /unclosed/);
  assert.deepEqual(formatHtml(""), []);
  assert.equal(linesToText(formatHtml("<style></style>")), "<style></style>");
});
