import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadMarkdown } from "../apps/desktop/src/lib/canvas-export.ts";

for (const fail of [false, true]) {
  test(`browser Markdown download ${fail ? "failure cleans up and can retry" : "uses a UTF-8 file and cleans up"}`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let blob;
    let removed = 0;
    let clicked = 0;
    let shouldFail = fail;
    const anchor = {
      click() {
        clicked++;
        if (shouldFail) throw new Error("Download blocked");
      },
      remove() {
        removed++;
      },
    };
    const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement(tag) {
          assert.equal(tag, "a");
          return anchor;
        },
        body: {
          append(element) {
            assert.equal(element, anchor);
          },
        },
      },
    });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, "document", previous);
      else delete globalThis.document;
    });
    t.mock.method(URL, "createObjectURL", (value) => {
      blob = value;
      return "blob:test-export";
    });
    const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
    const file = { markdown: "# 研究\n\nFull text 😀\n", filename: "研究.md" };
    if (fail) {
      assert.throws(() => downloadMarkdown(file), /Download blocked/);
      assert.equal(removed, 1);
      shouldFail = false;
    }
    downloadMarkdown(file);
    assert.equal(anchor.download, "研究.md");
    assert.equal(anchor.href, "blob:test-export");
    assert.equal(blob.type, "text/markdown;charset=utf-8");
    assert.equal(await blob.text(), file.markdown);
    assert.equal(clicked, fail ? 2 : 1);
    assert.equal(removed, clicked);
    assert.equal(
      revoke.mock.callCount(),
      0,
      "keep URL alive until the browser consumes the click",
    );
    t.mock.timers.tick(1000);
    assert.equal(revoke.mock.callCount(), clicked);
    assert.equal(revoke.mock.calls[0].arguments[0], "blob:test-export");
  });
}
