import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { evaluate, launchBrowser, waitFor } from "./support/chrome.mjs";

test(
  "frame policy keeps file srcdoc and isolates a loopback frame in Chromium",
  { timeout: 60000 },
  async () => {
    const config = JSON.parse(
      readFileSync(
        new URL("../apps/desktop/src-tauri/tauri.conf.json", import.meta.url),
      ),
    );
    const fixture = createServer((req, res) =>
      res.end(`<script>
    let parentReadable = false;
    try { void parent.document.body; parentReadable = true; } catch {}
    let popup = null;
    try { popup = window.open('about:blank'); } catch {}
    localStorage.setItem('fixture', 'ok');
    parent.postMessage({ fixtureResult: true, parentReadable, popup: !!popup, storage: localStorage.getItem('fixture') }, '*');
  </script>`),
    );
    await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    const fixturePort = fixture.address().port;
    const host = createServer((req, res) => {
      if (req.url === "/protected") {
        res.writeHead(200, {
          "Content-Type": "text/html",
          "Content-Security-Policy": "frame-ancestors 'none'",
        });
        res.end("<script>parent.postMessage({forbidden:true}, '*')</script>");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Content-Security-Policy": config.app.security.csp,
      });
      res.end(
        `<iframe id="file" sandbox="allow-same-origin" srcdoc="<p>file preview</p>"></iframe><iframe id="app" sandbox="allow-scripts allow-same-origin allow-forms" referrerpolicy="no-referrer" src="http://127.0.0.1:${fixturePort}/"></iframe>`,
      );
    });
    await new Promise((resolve) => host.listen(0, "127.0.0.1", resolve));
    let page;
    try {
      page = await launchBrowser();
      await page.send(
        "Page.addScriptToEvaluateOnNewDocument",
        {
          source:
            "window.addEventListener('message', event => { if (event.data.fixtureResult) window.fixtureResult = event.data; if (event.data.forbidden) window.forbidden = true; });",
        },
        page.sessionId,
      );
      await page.send(
        "Page.navigate",
        { url: `http://127.0.0.1:${host.address().port}/` },
        page.sessionId,
      );
      await waitFor(page, "window.fixtureResult", "fixture report");
      assert.deepEqual(await evaluate(page, "window.fixtureResult"), {
        fixtureResult: true,
        parentReadable: false,
        popup: false,
        storage: "ok",
      });
      assert.equal(
        await evaluate(
          page,
          "document.querySelector('#file').contentDocument.body.textContent",
        ),
        "file preview",
      );
      await evaluate(
        page,
        `new Promise(resolve => { const frame = document.querySelector('#app'); frame.onload = resolve; frame.src = '/protected'; })`,
      );
      assert.equal(await evaluate(page, "window.forbidden === true"), false);
    } finally {
      await page?.close();
      await Promise.all([
        new Promise((resolve) => host.close(resolve)),
        new Promise((resolve) => fixture.close(resolve)),
      ]);
    }
  },
);
