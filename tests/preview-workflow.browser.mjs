import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  evaluate,
  launchBrowser,
  waitFor,
  clickAt,
  boxOf,
  boxByText,
  dragBetween,
} from "./support/chrome.mjs";

test(
  "detached browser restores a local preview and keeps it independent",
  { timeout: 120000 },
  async () => {
    const data = mkdtempSync(join(tmpdir(), "agentica-preview-"));
    let requests = 0;
    const fixture = createServer((req, res) => {
      requests++;
      if (req.url === "/stall") return;
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: "http://127.0.0.1:1420/" });
        res.end();
        return;
      }
      res.end(
        "<!doctype html><title>Fixture</title><input aria-label='Fixture input'><div style='height:2000px'></div><script>localStorage.setItem('fixture','ok')</script>",
      );
    });
    await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    const target = `http://127.0.0.1:${fixture.address().port}/`;
    let backend, vite, page;
    try {
      for (const port of [1420, 1421]) {
        const probe = createServer();
        await new Promise((resolve, reject) => {
          probe.once("error", reject);
          probe.listen(port, "127.0.0.1", resolve);
        });
        await new Promise((resolve) => probe.close(resolve));
      }
      const protocol = spawnSync(
        "pnpm",
        ["--filter", "@agentica/protocol", "build"],
        { stdio: "pipe" },
      );
      if (protocol.status !== 0) throw new Error("Protocol build failed");
      const frontend = spawnSync(
        "pnpm",
        ["--filter", "@agentica/desktop", "build"],
        { stdio: "pipe" },
      );
      if (frontend.status !== 0) throw new Error("Frontend build failed");
      const build = spawnSync(
        "cargo",
        [
          "build",
          "--locked",
          "-p",
          "agentica-runtime",
          "--features",
          "bundled-frontend",
        ],
        { stdio: "pipe" },
      );
      if (build.status !== 0) throw new Error("Backend build failed");
      backend = spawn(resolve("target/debug/agentica-backend"), [], {
        env: { ...process.env, AGENTICA_DATA_DIR: data },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const key = await new Promise((resolveKey, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Backend did not start")),
          15000,
        );
        backend.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("Backend exited"));
        });
        backend.stdout.on("data", (chunk) => {
          const match = chunk
            .toString()
            .match(/Connection key: ([a-f0-9]{64})/);
          if (match) {
            clearTimeout(timer);
            resolveKey(match[1]);
          }
        });
      });
      const rpc = async (method, params) => {
        const response = await fetch("http://127.0.0.1:1421/rpc", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
            Origin: "http://127.0.0.1:1420",
          },
          body: JSON.stringify({
            protocolVersion: 1,
            id: "preview-test",
            method,
            params,
          }),
        });
        const body = await response.json();
        if (body.error) throw new Error(`${method}: ${body.error.code}`);
        return body.result;
      };
      const workspace = (
        await rpc("workspace.create", { name: "Preview test" })
      ).workspace.id;
      const canvas = (
        await rpc("canvas.create", {
          workspaceId: workspace,
          title: "Preview canvas",
        })
      ).canvas.id;
      await rpc("node.createWebPreview", {
        workspaceId: workspace,
        canvasId: canvas,
        expectedRevision: 1,
        x: 10,
        y: 10,
        width: 640,
        height: 480,
        url: target,
      });
      await rpc("workspace.close", { workspaceId: workspace });
      vite = spawn("pnpm", ["--filter", "@agentica/desktop", "dev"], {
        stdio: "ignore",
        detached: process.platform !== "win32",
      });
      for (let attempts = 0; ; attempts++) {
        try {
          if ((await fetch("http://127.0.0.1:1420/")).ok) break;
        } catch {}
        if (attempts > 100 || vite.exitCode !== null)
          throw new Error("Development frontend did not start");
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      page = await launchBrowser();
      await page.send(
        "Page.addScriptToEvaluateOnNewDocument",
        {
          source: `(() => {
          const fetch = window.fetch.bind(window);
          let restoreIPv6 = true;
          window.fetch = async (...args) => {
            const body = args[1]?.body;
            const request = typeof body === "string" ? JSON.parse(body) : null;
            if (request?.method === "artifact.saveWebPreview" && window.previewFault) {
              const fault = window.previewFault;
              window.previewFault = null;
              if (fault === "after") await fetch(...args);
              throw new TypeError("Simulated preview connection loss");
            }
            const response = await fetch(...args);
            if (request?.method === "canvas.open" && restoreIPv6) {
              restoreIPv6 = false;
              const payload = await response.json();
              payload.result.artifacts[0].url = "http://[::1]:5173/restored";
              return new Response(JSON.stringify(payload), {status: 200, headers: response.headers});
            }
            return response;
          };
        })();`,
        },
        page.sessionId,
      );
      await page.send(
        "Page.navigate",
        { url: "http://127.0.0.1:1420/" },
        page.sessionId,
      );
      await waitFor(
        page,
        "!!document.querySelector('#connection-key')",
        "connection form",
      );
      await evaluate(
        page,
        `(() => { const input = document.querySelector('#connection-key'); input.value = ${JSON.stringify(key)}; input.dispatchEvent(new Event('input', {bubbles:true})); })()`,
      );
      await clickAt(page, await boxOf(page, ".connbar button[type='submit']"));
      await waitFor(
        page,
        "!!document.querySelector('.connbar--ok')",
        "connection",
      );
      for (const label of ["Preview test", "Preview canvas"]) {
        const selector = `.tiles .tile__open, .cards .card`;
        const expression = `[...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent.includes(${JSON.stringify(label)}))`;
        try {
          await waitFor(
            page,
            `${expression} && !(${expression}).disabled`,
            label,
          );
        } catch (error) {
          const text = await evaluate(page, "document.body.innerText");
          throw new Error(`${error.message}: ${text}`);
        }
        await evaluate(
          page,
          `(${expression}).focus(); (${expression}).scrollIntoView({block:'center'})`,
        );
        await clickAt(page, await boxByText(page, selector, label));
      }
      await waitFor(
        page,
        "document.querySelector('.web-preview [role=alert]')?.textContent.includes('IPv6')",
        "restored IPv6 preview explanation",
      );
      assert.equal(
        await evaluate(
          page,
          "document.querySelectorAll('.web-preview iframe').length",
        ),
        0,
      );
      assert.equal(
        await evaluate(
          page,
          "document.querySelector('.web-preview__url input').value",
        ),
        "http://[::1]:5173/restored",
      );
      await evaluate(
        page,
        `(() => {
        const input = document.querySelector('.web-preview__url input');
        input.value = ${JSON.stringify(target)};
        input.dispatchEvent(new Event('input', {bubbles:true}));
        input.closest('form').requestSubmit();
      })()`,
      );
      await waitFor(
        page,
        "!!document.querySelector('.web-preview iframe')",
        "corrected preview frame",
      );
      let child;
      for (let attempt = 0; attempt < 50 && !child; attempt++) {
        const tree = await page.send("Page.getFrameTree", {}, page.sessionId);
        child = tree.frameTree.childFrames?.find(
          (frame) => frame.frame.url === target,
        );
        if (!child) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(child, "the fixture is loaded in a separate frame");
      const world = await page.send(
        "Page.createIsolatedWorld",
        { frameId: child.frame.id, worldName: "preview-test" },
        page.sessionId,
      );
      await page.send(
        "Runtime.evaluate",
        {
          contextId: world.executionContextId,
          expression: "document.querySelector('input').focus()",
        },
        page.sessionId,
      );
      await page.send("Input.insertText", { text: "typed" }, page.sessionId);
      const interaction = await page.send(
        "Runtime.evaluate",
        {
          contextId: world.executionContextId,
          expression:
            "[document.querySelector('input').value, localStorage.getItem('fixture')]",
          returnByValue: true,
        },
        page.sessionId,
      );
      assert.deepEqual(interaction.result.value, ["typed", "ok"]);
      const canvasTransform = await evaluate(
        page,
        "document.querySelector('.svelte-flow__viewport').style.transform",
      );
      const frameBox = await boxOf(page, ".web-preview iframe");
      await page.send(
        "Input.dispatchMouseEvent",
        {
          type: "mouseWheel",
          x: frameBox.x,
          y: frameBox.y,
          deltaX: 0,
          deltaY: 180,
        },
        page.sessionId,
      );
      let scroll = 0;
      for (let attempt = 0; attempt < 30 && !scroll; attempt++) {
        scroll = (
          await page.send(
            "Runtime.evaluate",
            {
              contextId: world.executionContextId,
              expression: "scrollY",
              returnByValue: true,
            },
            page.sessionId,
          )
        ).result.value;
        if (!scroll) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(scroll > 0);
      assert.equal(
        await evaluate(
          page,
          "document.querySelector('.svelte-flow__viewport').style.transform",
        ),
        canvasTransform,
      );
      const viewport = async () =>
        (
          await page.send(
            "Runtime.evaluate",
            {
              contextId: world.executionContextId,
              expression: "innerWidth",
              returnByValue: true,
            },
            page.sessionId,
          )
        ).result.value;
      const initialWidth = await viewport();
      await clickAt(page, await boxOf(page, ".web-preview__head span"));
      const header = await boxOf(page, ".web-preview__head span");
      const positionBeforeDrag = await evaluate(
        page,
        "document.querySelector('.web-preview').closest('.svelte-flow__node').style.transform",
      );
      await dragBetween(page, header, { x: header.x + 45, y: header.y + 30 });
      assert.notEqual(
        await evaluate(
          page,
          "document.querySelector('.web-preview').closest('.svelte-flow__node').style.transform",
        ),
        positionBeforeDrag,
      );
      await waitFor(
        page,
        "!!document.querySelector('.svelte-flow__resize-control.handle.bottom.right')",
        "preview resize handle",
      );
      const handle = await boxOf(
        page,
        ".svelte-flow__resize-control.handle.bottom.right",
      );
      await dragBetween(page, handle, { x: handle.x + 70, y: handle.y + 40 });
      await waitFor(
        page,
        `document.querySelector('.web-preview iframe').clientWidth > ${initialWidth}`,
        "resized viewport",
      );
      const resizedWidth = await viewport();
      assert.ok(resizedWidth > initialWidth);
      await clickAt(page, await boxOf(page, "button[aria-label='Zoom in']"));
      assert.equal(await viewport(), resizedWidth);
      await page.send(
        "Runtime.evaluate",
        {
          contextId: world.executionContextId,
          expression: `location.href = ${JSON.stringify(target + "redirect")}`,
        },
        page.sessionId,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
      assert.equal(
        await evaluate(
          page,
          "(() => { try { return !!document.querySelector('.web-preview iframe').contentDocument?.querySelector('#connection-key'); } catch { return false; } })()",
        ),
        false,
      );
      assert.equal(
        await evaluate(
          page,
          "document.querySelectorAll('.web-preview iframe').length",
        ),
        1,
      );
      assert.equal(
        await evaluate(
          page,
          "document.querySelector('.web-preview iframe').getAttribute('sandbox')",
        ),
        "allow-scripts allow-same-origin allow-forms",
      );
      assert.equal(
        await evaluate(
          page,
          "document.querySelector('.web-preview iframe').getAttribute('src')",
        ),
        target,
      );
      await evaluate(
        page,
        "[...document.querySelectorAll('.web-preview button')].find(b => b.textContent.trim() === 'Reload').click()",
      );
      assert.equal(
        await evaluate(
          page,
          "document.querySelectorAll('.web-preview iframe').length",
        ),
        1,
      );
      await clickAt(
        page,
        await boxOf(page, "button[aria-label='Canvas tools']"),
      );
      await waitFor(
        page,
        "!!document.querySelector(\"button[aria-label='Add local web preview']\")",
        "preview tool",
      );
      await clickAt(
        page,
        await boxOf(page, "button[aria-label='Add local web preview']"),
      );
      await waitFor(
        page,
        "!!document.querySelector('#new-preview-url')",
        "preview creation form",
      );
      await evaluate(
        page,
        `(() => {
        const input = document.querySelector('#new-preview-url');
        input.value = 'http://[::1]:5173/new';
        input.dispatchEvent(new Event('input', {bubbles:true}));
        input.closest('form').requestSubmit();
      })()`,
      );
      await waitFor(
        page,
        "document.querySelector('#new-preview-url').closest('form').textContent.includes('IPv6')",
        "IPv6 creation rejected",
      );
      assert.equal(
        await evaluate(
          page,
          "document.querySelectorAll('.web-preview').length",
        ),
        1,
      );
      await evaluate(
        page,
        `(() => { const input = document.querySelector('#new-preview-url'); input.value = ${JSON.stringify(target + "second")}; input.dispatchEvent(new Event('input', {bubbles:true})); })()`,
      );
      await evaluate(
        page,
        "document.querySelector('#new-preview-url').closest('form').requestSubmit()",
      );
      await waitFor(
        page,
        "document.querySelectorAll('.web-preview iframe').length === 2",
        "second preview",
      );
      await evaluate(
        page,
        `(() => { const form = document.querySelectorAll('.web-preview__url')[1]; const input = form.querySelector('input'); input.value = 'https://example.com/'; input.dispatchEvent(new Event('input', {bubbles:true})); form.requestSubmit(); })()`,
      );
      await waitFor(
        page,
        "!!document.querySelectorAll('.web-preview')[1].querySelector('[role=alert]')",
        "invalid URL feedback",
      );
      assert.equal(
        await evaluate(
          page,
          "document.querySelectorAll('.web-preview__url input')[1].value",
        ),
        "https://example.com/",
      );
      assert.equal(
        await evaluate(
          page,
          "document.querySelectorAll('.web-preview iframe')[1].getAttribute('src')",
        ),
        target + "second",
      );
      let newUrl = target + "updated";
      await evaluate(
        page,
        `(() => { const form = document.querySelectorAll('.web-preview__url')[1]; const input = form.querySelector('input'); input.value = ${JSON.stringify(newUrl)}; input.dispatchEvent(new Event('input', {bubbles:true})); form.requestSubmit(); })()`,
      );
      await waitFor(
        page,
        `document.querySelectorAll('.web-preview iframe')[1]?.getAttribute('src') === ${JSON.stringify(newUrl)}`,
        "saved URL",
      );
      assert.equal(
        await evaluate(
          page,
          "document.querySelectorAll('.web-preview iframe')[0].getAttribute('src')",
        ),
        target,
      );
      for (const fault of ["before", "after"]) {
        const retryUrl = newUrl + "-retry";
        await evaluate(
          page,
          `(() => {
          window.previewFault = ${JSON.stringify(fault)};
          const form = document.querySelectorAll('.web-preview__url')[1];
          const input = form.querySelector('input');
          input.value = ${JSON.stringify(retryUrl)};
          input.dispatchEvent(new Event('input', {bubbles:true}));
          form.requestSubmit();
        })()`,
        );
        await waitFor(
          page,
          "document.querySelectorAll('.web-preview')[1].querySelector('[role=alert]')?.textContent.includes('draft')",
          "failed URL draft retained",
        );
        assert.equal(
          await evaluate(
            page,
            "document.querySelectorAll('.web-preview iframe')[1].getAttribute('src')",
          ),
          newUrl,
        );
        assert.equal(
          await evaluate(
            page,
            "document.querySelectorAll('.web-preview__url input')[1].value",
          ),
          retryUrl,
        );
        await evaluate(
          page,
          "[...document.querySelectorAll('.banner--error button')].find(b => b.textContent.trim() === 'Retry save').click()",
        );
        await waitFor(
          page,
          `document.querySelectorAll('.web-preview iframe')[1].getAttribute('src') === ${JSON.stringify(retryUrl)}`,
          "retried URL acknowledged",
        );
        await waitFor(
          page,
          "!document.querySelectorAll('.web-preview')[1].querySelector('[role=alert]') && !document.querySelector('.banner--error')",
          "retry errors cleared",
        );
        newUrl = retryUrl;
      }
      await clickAt(page, await boxOf(page, "button[aria-label='Fit canvas']"));
      await waitFor(
        page,
        `(() => { const r = document.querySelector(".web-preview button[aria-label='Expand preview']")?.getBoundingClientRect(); return r && r.x >= 0 && r.y >= 0 && r.right < innerWidth && r.bottom < innerHeight; })()`,
        "visible expand control",
      );
      const before = await rpc("canvas.open", {
        workspaceId: workspace,
        canvasId: canvas,
      });
      await clickAt(
        page,
        await boxOf(page, ".web-preview button[aria-label='Expand preview']"),
      );
      await waitFor(page, "!!document.fullscreenElement", "expanded preview");
      assert.equal(
        await evaluate(
          page,
          "document.querySelectorAll('.web-preview iframe').length",
        ),
        2,
      );
      await waitFor(
        page,
        "!!document.querySelector(\".web-preview:fullscreen button[aria-label='Return to canvas']\")",
        "return control",
      );
      await clickAt(
        page,
        await boxOf(
          page,
          ".web-preview:fullscreen button[aria-label='Return to canvas']",
        ),
      );
      await waitFor(page, "!document.fullscreenElement", "return to canvas");
      await waitFor(
        page,
        "document.activeElement?.getAttribute('aria-label') === 'Expand preview'",
        "return focus",
      );
      const after = await rpc("canvas.open", {
        workspaceId: workspace,
        canvasId: canvas,
      });
      assert.deepEqual(
        after.nodes.map(({ id, x, y, width, height }) => ({
          id,
          x,
          y,
          width,
          height,
        })),
        before.nodes.map(({ id, x, y, width, height }) => ({
          id,
          x,
          y,
          width,
          height,
        })),
      );
      await clickAt(
        page,
        await boxOf(page, "button[aria-label='Canvas gallery']"),
      );
      const canvasCard = ".cards .card";
      await waitFor(
        page,
        `[...document.querySelectorAll(${JSON.stringify(canvasCard)})].some(el => el.textContent.includes('Preview canvas'))`,
        "canvas gallery",
      );
      await clickAt(page, await boxByText(page, canvasCard, "Preview canvas"));
      await waitFor(
        page,
        "document.querySelectorAll('.web-preview iframe').length === 2",
        "reopened previews",
      );
      assert.equal(
        await evaluate(
          page,
          "document.querySelectorAll('.web-preview iframe')[1].getAttribute('src')",
        ),
        newUrl,
      );
      await evaluate(
        page,
        "document.querySelectorAll(\".web-preview button[aria-label='Remove preview']\")[1].click()",
      );
      await waitFor(
        page,
        "document.querySelectorAll('.web-preview iframe').length === 1",
        "preview removal",
      );
      assert.equal((await fetch(target)).ok, true);
      const port = fixture.address().port;
      fixture.closeAllConnections();
      await new Promise((resolve) => fixture.close(resolve));
      await evaluate(
        page,
        "document.querySelector('.web-preview button[aria-label=\"Reload preview\"]').click()",
      );
      assert.equal(
        await evaluate(
          page,
          "!!document.querySelector('.web-preview__url input')",
        ),
        true,
      );
      await new Promise((resolve) =>
        fixture.listen(port, "127.0.0.1", resolve),
      );
      const beforeRetry = requests;
      await evaluate(
        page,
        "document.querySelector('.web-preview button[aria-label=\"Reload preview\"]').click()",
      );
      for (let attempt = 0; attempt < 50 && requests === beforeRetry; attempt++)
        await new Promise((resolve) => setTimeout(resolve, 100));
      assert.ok(
        requests > beforeRetry,
        "Reload retries after the external server restarts",
      );
      await page.send(
        "Emulation.setDeviceMetricsOverride",
        { width: 680, height: 800, deviceScaleFactor: 1, mobile: false },
        page.sessionId,
      );
      await clickAt(page, await boxOf(page, "button[aria-label='Fit canvas']"));
      for (const theme of ["light", "dark"]) {
        await evaluate(
          page,
          `document.documentElement.dataset.theme = ${JSON.stringify(theme)}; document.querySelector(".web-preview button[aria-label='Reload preview']").focus()`,
        );
        for (const label of ["Expand preview", "Remove preview"]) {
          await page.send(
            "Input.dispatchKeyEvent",
            {
              type: "keyDown",
              key: "Tab",
              code: "Tab",
              windowsVirtualKeyCode: 9,
            },
            page.sessionId,
          );
          await page.send(
            "Input.dispatchKeyEvent",
            {
              type: "keyUp",
              key: "Tab",
              code: "Tab",
              windowsVirtualKeyCode: 9,
            },
            page.sessionId,
          );
          assert.equal(
            await evaluate(
              page,
              "document.activeElement?.getAttribute('aria-label')",
            ),
            label,
          );
        }
        await page.send(
          "Input.dispatchKeyEvent",
          {
            type: "keyDown",
            key: "Tab",
            code: "Tab",
            windowsVirtualKeyCode: 9,
          },
          page.sessionId,
        );
        await page.send(
          "Input.dispatchKeyEvent",
          { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
          page.sessionId,
        );
        assert.equal(
          await evaluate(page, "document.activeElement?.tagName"),
          "INPUT",
        );
        assert.equal(
          await evaluate(
            page,
            "getComputedStyle(document.activeElement).outlineStyle !== 'none'",
          ),
          true,
        );
        await page.send(
          "Input.dispatchKeyEvent",
          {
            type: "keyDown",
            key: "Tab",
            code: "Tab",
            windowsVirtualKeyCode: 9,
          },
          page.sessionId,
        );
        await page.send(
          "Input.dispatchKeyEvent",
          { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
          page.sessionId,
        );
        assert.equal(
          await evaluate(page, "document.activeElement?.textContent.trim()"),
          "Save",
        );
        await page.send(
          "Input.dispatchKeyEvent",
          {
            type: "keyDown",
            key: "Tab",
            code: "Tab",
            windowsVirtualKeyCode: 9,
          },
          page.sessionId,
        );
        await page.send(
          "Input.dispatchKeyEvent",
          { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
          page.sessionId,
        );
        assert.equal(
          await evaluate(page, "document.activeElement?.tagName"),
          "IFRAME",
        );
        await page.send(
          "Input.dispatchKeyEvent",
          {
            type: "keyDown",
            key: "Tab",
            code: "Tab",
            windowsVirtualKeyCode: 9,
          },
          page.sessionId,
        );
        await page.send(
          "Input.dispatchKeyEvent",
          { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
          page.sessionId,
        );
        assert.notEqual(
          await evaluate(page, "document.activeElement?.tagName"),
          "IFRAME",
        );
      }
      await evaluate(
        page,
        `(() => { const form = document.querySelector('.web-preview__url'); const input = form.querySelector('input'); input.value = ${JSON.stringify(target + "stall")}; input.dispatchEvent(new Event('input', {bubbles:true})); form.requestSubmit(); })()`,
      );
      await waitFor(
        page,
        `document.querySelector('.web-preview iframe')?.getAttribute('src') === ${JSON.stringify(target + "stall")}`,
        "stalled URL saved",
      );
      await waitFor(
        page,
        "document.querySelector('.web-preview')?.textContent.includes('Loading')",
        "loading indication",
      );
      await waitFor(
        page,
        "document.querySelector('.web-preview')?.textContent.includes('may be unavailable')",
        "bounded recovery guidance",
        22000,
      );
      assert.equal(
        await evaluate(
          page,
          "!!document.querySelector('.web-preview button[aria-label=\"Reload preview\"]') && !!document.querySelector('.web-preview__url input')",
        ),
        true,
      );
      const stalled = await rpc("canvas.open", {
        workspaceId: workspace,
        canvasId: canvas,
      });
      const geometry = ({ id, x, y, width, height }) => ({
        id,
        x,
        y,
        width,
        height,
      });
      assert.deepEqual(geometry(stalled.nodes[0]), geometry(before.nodes[0]));
      await rpc("artifact.saveWebPreview", {
        workspaceId: workspace,
        artifactId: stalled.artifacts[0].id,
        expectedRevision: stalled.artifacts[0].revision,
        url: target + "remote",
      });
      await evaluate(
        page,
        `(() => { const form = document.querySelector('.web-preview__url'); const input = form.querySelector('input'); input.value = ${JSON.stringify(target + "draft")}; input.dispatchEvent(new Event('input', {bubbles:true})); form.requestSubmit(); })()`,
      );
      await waitFor(
        page,
        "document.querySelector('.web-preview [role=alert]')?.textContent.includes('draft')",
        "conflict feedback",
      );
      assert.equal(
        await evaluate(
          page,
          "document.querySelector('.web-preview__url input').value",
        ),
        target + "draft",
      );
      assert.equal(
        await evaluate(
          page,
          "document.querySelector('.web-preview iframe').getAttribute('src')",
        ),
        target + "stall",
      );
    } finally {
      await page?.close();
      if (vite) {
        try {
          if (process.platform !== "win32") process.kill(-vite.pid, "SIGTERM");
          else vite.kill("SIGTERM");
        } catch {}
      }
      backend?.kill("SIGTERM");
      fixture.closeAllConnections();
      await new Promise((resolve) => fixture.close(resolve));
      try {
        rmSync(data, { recursive: true, force: true });
      } catch {}
    }
  },
);
