import assert from "node:assert/strict";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";

const componentUrl = new URL(
  "../apps/desktop/src/lib/components/Markdown.svelte",
  import.meta.url,
);
const runtimeUrl = new URL(
  "../apps/desktop/src/lib/runtime.ts",
  import.meta.url,
);

// Render the real component without a browser or generated files.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL === componentUrl.href &&
      (specifier === "../runtime" || specifier === "../markdown")
    )
      specifier += ".ts";
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const result = nextLoad(
      url,
      url === componentUrl.href ? { ...context, format: "module" } : context,
    );
    if (url === componentUrl.href)
      return {
        ...result,
        format: "module",
        source: compile(result.source.toString(), {
          filename: componentUrl.pathname,
          generate: "server",
        }).js.code,
      };
    if (url === runtimeUrl.href)
      return {
        ...result,
        format: "module",
        source: stripTypeScriptTypes(result.source.toString(), {
          mode: "transform",
        }),
      };
    return result;
  },
});
const { default: Markdown } = await import(componentUrl.href);
hooks.deregister();

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
