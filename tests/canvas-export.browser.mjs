import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";
import { evaluate, launchBrowser, waitFor } from "./support/chrome.mjs";

const root = resolve("apps/desktop");
const require = createRequire(join(root, "package.json"));
const { createServer, loadConfigFromFile } = await import(
  pathToFileURL(require.resolve("vite")).href
);
const title = "Research café 図";
const note =
  "# Staged note\n\ncafé — 日本語 🧭\n\n" +
  "Full unclipped source\n".repeat(20);
const document = {
  canvas: {
    id: "canvas-id",
    title,
    revision: 1,
    viewport: { x: 0, y: 0, zoom: 1 },
  },
  artifacts: [
    { id: "note-id", type: "text", schemaVersion: 1, revision: 1, text: note },
  ],
  nodes: [
    {
      id: "node-id",
      artifactId: "note-id",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      task: { done: true },
    },
  ],
  edges: [],
  projectGroups: [],
  sessionTiles: [],
};
const expected = `# ${title}\n\n## Item 1 — Task\n\n- [x] Completed\n\n${note}\n`;
const button = 'button[aria-label="Export Markdown"]';

// The only stub is the native IPC boundary. This is not a native dialog/write test.
const harness = `<!doctype html><html><body>
<script type="module">
  import { mount } from "svelte";
  import CanvasExport from "/src/lib/components/CanvasExport.svelte";
  window.canvas = ${JSON.stringify(document)};
  if (new URL(location.href).searchParams.has("desktop")) {
    window.isTauri = true;
    window.bridge = { calls: [] };
    window.__TAURI_INTERNALS__ = {
      invoke(command, args) {
        window.bridge.calls.push({ command, args });
        return new Promise((resolve, reject) => {
          window.bridge.resolve = resolve;
          window.bridge.reject = reject;
        });
      },
    };
  }
  mount(CanvasExport, { target: document.body, props: { canvas: window.canvas } });
</script></body></html>`;

async function press(page, key, code, keyCode) {
  for (const type of ["keyDown", "keyUp"])
    await page.send(
      "Input.dispatchKeyEvent",
      {
        type,
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        ...(type === "keyDown" && key === "Enter" ? { text: "\r" } : {}),
      },
      page.sessionId,
    );
}

async function open(page, url) {
  await page.send("Page.navigate", { url }, page.sessionId);
  await waitFor(
    page,
    `!!document.querySelector(${JSON.stringify(button)})`,
    "export component",
  );
  await press(page, "Tab", "Tab", 9);
  assert.equal(
    await evaluate(page, "document.activeElement?.getAttribute('aria-label')"),
    "Export Markdown",
  );
}

async function idle(page) {
  await waitFor(
    page,
    `document.querySelector(${JSON.stringify(button)})?.getAttribute('aria-busy') === 'false'`,
    "export settled",
  );
  assert.equal(
    await evaluate(
      page,
      `document.querySelector(${JSON.stringify(button)}).disabled`,
    ),
    false,
  );
}

async function downloaded(path) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      return await readFile(path);
    } catch (error) {
      if (error.code !== "ENOENT" || Date.now() > deadline) throw error;
      await sleep(100);
    }
  }
}

test(
  "CanvasExport rendered platform delivery",
  { timeout: 90_000 },
  async (t) => {
    const downloads = await mkdtemp(join(tmpdir(), "agentica-markdown-"));
    let server, page;
    try {
      const loaded = await loadConfigFromFile(
        { command: "serve", mode: "test" },
        join(root, "vite.config.ts"),
        root,
      );
      assert.ok(loaded, "load the desktop Vite config");
      server = await createServer({
        ...loaded.config,
        configFile: false,
        root,
        logLevel: "error",
        // No application entry, backend, or heavyweight voice dependency is needed.
        optimizeDeps: {
          entries: [],
          include: [
            "svelte",
            "svelte/internal/client",
            "svelte/internal/disclose-version",
            "svelte/internal/flags/legacy",
            "@tauri-apps/api/core",
          ],
          noDiscovery: true,
        },
        server: {
          ...loaded.config.server,
          port: 0,
          strictPort: false,
          hmr: false,
        },
        plugins: [
          ...loaded.config.plugins,
          {
            name: "canvas-export-test-page",
            configureServer(vite) {
              vite.middlewares.use(async (req, res, next) => {
                if (req.url?.split("?")[0] !== "/__canvas-export-test")
                  return next();
                try {
                  const html = await vite.transformIndexHtml(req.url, harness);
                  res.setHeader("Content-Type", "text/html; charset=utf-8");
                  res.end(html);
                } catch (error) {
                  next(error);
                }
              });
            },
          },
        ],
      });
      await server.listen();
      const url = `http://127.0.0.1:${server.httpServer.address().port}/__canvas-export-test`;
      page = await launchBrowser();

      await t.test(
        "keyboard action exposes help and downloads real UTF-8 Markdown without claiming a saved file",
        async () => {
          await page.send("Browser.setDownloadBehavior", {
            behavior: "allow",
            downloadPath: downloads,
          });
          await open(page, url);
          const tree = await page.send(
            "Accessibility.getFullAXTree",
            {},
            page.sessionId,
          );
          const action = tree.nodes.find(
            (node) =>
              node.role?.value === "button" &&
              node.name?.value === "Export Markdown",
          );
          assert.ok(
            action,
            "a named button is exposed to assistive technology",
          );
          assert.match(
            action.description?.value ?? "",
            /full canvas notes as Markdown/i,
          );
          assert.match(
            action.description.value,
            /visual and live content is not included/i,
          );
          assert.match(
            action.description.value,
            /as written, including any sensitive text/i,
          );
          await press(page, "Enter", "Enter", 13);
          await waitFor(
            page,
            "document.querySelector('[role=status]')?.textContent === 'Markdown download requested.'",
            "download-requested status",
          );
          await idle(page);
          assert.equal(
            await evaluate(page, "!!document.querySelector('[role=alert]')"),
            false,
          );
          const status = await evaluate(
            page,
            "document.querySelector('[role=status]').textContent",
          );
          assert.doesNotMatch(status, /saved|exported|written|complete/i);
          const bytes = await downloaded(join(downloads, `${title}.md`));
          assert.equal(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
            expected,
          );
          assert.deepEqual(await evaluate(page, "window.canvas"), document);
        },
      );

      await t.test(
        "native bridge pending state blocks duplicates and preserves the captured snapshot",
        async () => {
          await open(page, `${url}?desktop`);
          await press(page, " ", "Space", 32);
          await waitFor(
            page,
            "window.bridge.calls.length === 1",
            "native invocation",
          );
          assert.deepEqual(await evaluate(page, "window.bridge.calls[0]"), {
            command: "export_markdown",
            args: { markdown: expected, suggestedName: `${title}.md` },
          });
          assert.equal(
            await evaluate(
              page,
              `document.querySelector(${JSON.stringify(button)}).disabled`,
            ),
            true,
          );
          assert.equal(
            await evaluate(
              page,
              `document.querySelector(${JSON.stringify(button)}).getAttribute('aria-busy')`,
            ),
            "true",
          );
          assert.match(
            await evaluate(
              page,
              `document.querySelector(${JSON.stringify(button)}).textContent`,
            ),
            /Exporting/,
          );
          assert.deepEqual(await evaluate(page, "window.canvas"), document);
          // A late staged edit changes the next export, never the in-flight IPC args.
          await evaluate(
            page,
            "window.canvas.artifacts[0].text = 'Later staged edit'",
          );
          await press(page, "Enter", "Enter", 13);
          await press(page, " ", "Space", 32);
          assert.equal(await evaluate(page, "window.bridge.calls.length"), 1);
          assert.equal(
            await evaluate(page, "window.bridge.calls[0].args.markdown"),
            expected,
          );
          assert.equal(
            await evaluate(
              page,
              "document.querySelector('[role=status]').textContent",
            ),
            "",
          );
          await evaluate(page, "window.bridge.resolve(true)");
          await idle(page);
          assert.equal(
            await evaluate(
              page,
              "document.querySelector('[role=status]').textContent",
            ),
            "Markdown exported.",
          );
          assert.equal(
            await evaluate(page, "window.canvas.artifacts[0].text"),
            "Later staged edit",
          );
        },
      );

      await t.test(
        "native cancellation is quiet; rejection gives an actionable error and retry succeeds",
        async () => {
          await open(page, `${url}?desktop`);
          await press(page, "Enter", "Enter", 13);
          await waitFor(
            page,
            "window.bridge.calls.length === 1",
            "cancel invocation",
          );
          await evaluate(page, "window.bridge.resolve(false)");
          await idle(page);
          assert.equal(
            await evaluate(
              page,
              "document.querySelector('[role=status]').textContent",
            ),
            "",
          );
          assert.equal(
            await evaluate(page, "!!document.querySelector('[role=alert]')"),
            false,
          );

          await evaluate(
            page,
            `document.querySelector(${JSON.stringify(button)}).focus()`,
          );
          await press(page, "Enter", "Enter", 13);
          await waitFor(
            page,
            "window.bridge.calls.length === 2",
            "failed invocation",
          );
          await evaluate(
            page,
            "window.bridge.reject('Destination is unwritable')",
          );
          await idle(page);
          assert.match(
            await evaluate(
              page,
              "document.querySelector('[role=alert]')?.textContent",
            ),
            /Export failed:.*Destination is unwritable.*Retry Export Markdown/,
          );
          assert.equal(
            await evaluate(
              page,
              "document.querySelector('[role=status]').textContent",
            ),
            "",
          );
          assert.deepEqual(await evaluate(page, "window.canvas"), document);

          // Retry on the same mounted component, without a reload or lost edits.
          await evaluate(
            page,
            `document.querySelector(${JSON.stringify(button)}).focus()`,
          );
          await press(page, "Enter", "Enter", 13);
          await waitFor(
            page,
            "window.bridge.calls.length === 3",
            "retry invocation",
          );
          assert.equal(
            await evaluate(page, "!!document.querySelector('[role=alert]')"),
            false,
          );
          await evaluate(page, "window.bridge.resolve(true)");
          await idle(page);
          assert.equal(
            await evaluate(
              page,
              "document.querySelector('[role=status]').textContent",
            ),
            "Markdown exported.",
          );
          assert.equal(
            await evaluate(page, "!!document.querySelector('[role=alert]')"),
            false,
          );
          assert.deepEqual(
            await evaluate(page, "window.bridge.calls.map(call => call.args)"),
            Array(3).fill({ markdown: expected, suggestedName: `${title}.md` }),
          );
          assert.deepEqual(await evaluate(page, "window.canvas"), document);
        },
      );
    } finally {
      await page?.close();
      await server?.close();
      await rm(downloads, { recursive: true, force: true });
    }
  },
);
