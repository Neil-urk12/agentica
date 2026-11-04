import assert from "node:assert/strict";
import { render } from "svelte/server";
import { test } from "vitest";
import Markdown from "../apps/desktop/src/lib/components/Markdown.svelte";

for (const parent of ["1. Parent", "- Parent"]) {
  test(`nested checklists retain their checked state under ${parent}`, () => {
    const source = `${parent}\n  - [ ] Pending\n  - [x] Completed\n  1. [x] Literal ordered marker`;
    const { body } = render(Markdown, { props: { source } });
    const items = [...body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)];
    assert.equal(items.length, 4);
    assert.match(items[1][1], /class="md-check"/);
    assert.match(items[1][1], /role="img" aria-label="unchecked"/);
    assert.match(items[2][1], /class="md-check md-checked"/);
    assert.match(items[2][1], /role="img" aria-label="checked"/);
    assert.match(items[3][1], /\[x\] Literal ordered marker/);
    assert.equal((body.match(/role="img"/g) ?? []).length, 2);
    assert.doesNotMatch(body, /<input\b/);
  });
}
