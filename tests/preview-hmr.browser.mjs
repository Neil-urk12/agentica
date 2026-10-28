import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { launchBrowser, waitFor } from "./support/chrome.mjs";

test(
  "a sandboxed local preview receives Vite hot updates",
  { timeout: 60000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "agentica-hmr-"));
    writeFileSync(
      join(root, "index.html"),
      '<p id="state"></p><script type="module" src="/main.js"></script>',
    );
    const writeVersion = (value) =>
      writeFileSync(
        join(root, "main.js"),
        `document.querySelector('#state').textContent = '${value}'; if (import.meta.hot) import.meta.hot.accept();`,
      );
    writeVersion("first");
    const portProbe = createServer();
    await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
    const port = portProbe.address().port;
    await new Promise((resolve) => portProbe.close(resolve));
    const server = spawn(
      "pnpm",
      [
        "--filter",
        "@agentica/desktop",
        "exec",
        "vite",
        root,
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
      ],
      { stdio: "ignore", detached: process.platform !== "win32" },
    );
    const host = createServer((req, res) =>
      res.end(
        `<iframe sandbox="allow-scripts allow-same-origin allow-forms" src="http://127.0.0.1:${port}/"></iframe>`,
      ),
    );
    let page;
    try {
      await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
      for (let attempt = 0; ; attempt++) {
        try {
          if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break;
        } catch {}
        if (attempt > 100 || server.exitCode !== null)
          throw new Error("Vite fixture did not start");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      page = await launchBrowser();
      await page.send(
        "Page.navigate",
        { url: `http://127.0.0.1:${host.address().port}/` },
        page.sessionId,
      );
      await waitFor(
        page,
        "!!document.querySelector('iframe')",
        "fixture frame",
      );
      let frame;
      for (let attempt = 0; attempt < 50 && !frame; attempt++) {
        const tree = await page.send("Page.getFrameTree", {}, page.sessionId);
        frame = tree.frameTree.childFrames?.find((entry) =>
          entry.frame.url.includes(`:${port}/`),
        );
        if (!frame) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(frame);
      const world = await page.send(
        "Page.createIsolatedWorld",
        { frameId: frame.frame.id, worldName: "hmr-test" },
        page.sessionId,
      );
      const content = async () =>
        (
          await page.send(
            "Runtime.evaluate",
            {
              contextId: world.executionContextId,
              expression: "document.querySelector('#state')?.textContent",
              returnByValue: true,
            },
            page.sessionId,
          )
        ).result.value;
      for (
        let attempt = 0;
        attempt < 50 && (await content()) !== "first";
        attempt++
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(await content(), "first");
      await new Promise((resolve) => setTimeout(resolve, 500));
      writeVersion("second");
      for (
        let attempt = 0;
        attempt < 100 && (await content()) !== "second";
        attempt++
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(await content(), "second");
    } finally {
      await page?.close();
      try {
        if (process.platform !== "win32") process.kill(-server.pid, "SIGTERM");
        else server.kill("SIGTERM");
      } catch {}
      await new Promise((resolve) => host.close(resolve));
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {}
    }
  },
);
