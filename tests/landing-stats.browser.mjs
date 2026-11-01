import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve } from "node:path";
import { test } from "node:test";
import { evaluate, launchBrowser, waitFor } from "./support/chrome.mjs";

test(
  "landing statistics render without disrupting themes, layouts, hash navigation or downloads",
  { timeout: 90000 },
  async () => {
    execFileSync("pnpm", ["build:landing"], { stdio: "pipe" });
    const root = resolve("apps/landing/dist");
    let snapshot = { visits: 0, downloads: 1234 };
    let calls = 0;
    const server = createServer(async (req, res) => {
      if (req.url === "/api/stats") {
        calls++;
        res.writeHead(snapshot ? 200 : 503, {
          "Content-Type": "application/json",
        });
        res.end(JSON.stringify(snapshot));
        return;
      }
      const path = resolve(
        root,
        "." +
          new URL(req.url, "http://localhost").pathname.replace(
            /\/$/,
            "/index.html",
          ),
      );
      if (!path.startsWith(root + "/")) {
        res.writeHead(404).end();
        return;
      }
      try {
        const body = await readFile(path);
        const type = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".svg": "image/svg+xml",
          ".woff2": "font/woff2",
        }[extname(path)];
        res.writeHead(200, {
          "Content-Type": type ?? "application/octet-stream",
        });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let page;
    try {
      page = await launchBrowser();
      for (const scenario of [
        {
          width: 1280,
          theme: "light",
          reduced: false,
          data: { visits: 0, downloads: 1234 },
          expected: ["0", "1,234"],
        },
        {
          width: 375,
          theme: "dark",
          reduced: true,
          data: { visits: null, downloads: 8 },
          expected: ["Unavailable", "8"],
        },
        {
          width: 1280,
          theme: "dark",
          reduced: true,
          data: null,
          expected: ["Unavailable", "Unavailable"],
        },
        {
          width: 375,
          theme: "light",
          reduced: true,
          data: { visits: 12, downloads: null },
          expected: ["12", "Unavailable"],
        },
      ]) {
        snapshot = scenario.data;
        calls = 0;
        await page.send(
          "Emulation.setDeviceMetricsOverride",
          {
            width: scenario.width,
            height: 900,
            deviceScaleFactor: 1,
            mobile: scenario.width < 761,
          },
          page.sessionId,
        );
        await page.send(
          "Emulation.setEmulatedMedia",
          {
            features: [
              { name: "prefers-color-scheme", value: scenario.theme },
              {
                name: "prefers-reduced-motion",
                value: scenario.reduced ? "reduce" : "no-preference",
              },
            ],
          },
          page.sessionId,
        );
        await page.send("Page.navigate", { url: origin }, page.sessionId);
        await waitFor(
          page,
          `document.querySelector('[data-stat="visits"]')?.textContent === ${JSON.stringify(scenario.expected[0])} && document.querySelector('[data-stat="downloads"]')?.textContent === ${JSON.stringify(scenario.expected[1])} && document.querySelector('[data-download-link]').href.includes('/download/v')`,
          "statistics and downloads",
        );
        assert.equal(calls, 1);
        assert.equal(
          await evaluate(page, "document.documentElement.dataset.theme"),
          scenario.theme,
        );
        const placement = await evaluate(
          page,
          `({
          hero: !!document.querySelector('#hero .ctas + .stats'),
          inDownload: !!document.querySelector('#download .stats'),
          expanded: document.querySelector('.stats__about').open
        })`,
        );
        assert.deepEqual(placement, {
          hero: true,
          inDownload: false,
          expanded: false,
        });
        await evaluate(
          page,
          "document.querySelector('.stats__about summary').click()",
        );
        assert.equal(
          await evaluate(page, "document.querySelector('.stats__about').open"),
          true,
        );
        await evaluate(
          page,
          "document.querySelector('.stats__about summary').click()",
        );
        const before = await evaluate(
          page,
          `({ height: document.querySelector('.stats').getBoundingClientRect().height, href: document.querySelector('[data-download-link]').href })`,
        );
        await evaluate(
          page,
          "document.querySelector('a[href=\"#download\"]').click()",
        );
        await waitFor(page, "location.hash === '#download'", "hash navigation");
        await waitFor(
          page,
          "document.querySelector('#download').getBoundingClientRect().bottom > 0 && document.querySelector('#download').getBoundingClientRect().top < innerHeight",
          "download camera/scroll transition",
        );
        const after = await evaluate(
          page,
          `({
        labels: [...document.querySelectorAll('.stats dt')].map(e => e.textContent),
        live: document.querySelector('.stats__counts').getAttribute('aria-live'),
        overflow: document.documentElement.scrollWidth > innerWidth,
        height: document.querySelector('.stats').getBoundingClientRect().height,
        href: document.querySelector('[data-download-link]').href,
        visible: document.querySelector('#download').getBoundingClientRect().bottom > 0 && document.querySelector('#download').getBoundingClientRect().top < innerHeight
      })`,
        );
        assert.deepEqual(after.labels, [
          "Visits · last 30 days",
          "Downloads · all releases",
        ]);
        assert.equal(after.live, "polite");
        assert.equal(after.overflow, false);
        assert.equal(after.visible, true);
        assert.equal(after.href, before.href);
        assert.match(
          after.href,
          /https:\/\/github.com\/Neil-urk12\/agentica\/releases\/download\/v[\d.]+\/agentica-v[\d.]+-linux-amd64.deb/,
        );
        assert.equal(calls, 1);
        // Values occupy the same reserved space as the fallback and loading dash.
        const heights = await evaluate(
          page,
          `['—', 'Unavailable', '0', '1,234'].map(value => {
        for (const el of document.querySelectorAll('[data-stat]')) el.textContent = value;
        return document.querySelector('.stats').offsetHeight;
      })`,
        );
        assert.equal(new Set(heights).size, 1);
      }
      await page.send(
        "Emulation.setScriptExecutionDisabled",
        { value: true },
        page.sessionId,
      );
      calls = 0;
      await page.send(
        "Page.navigate",
        { url: origin + "/?no-js=1#download" },
        page.sessionId,
      );
      await waitFor(
        page,
        "location.search === '?no-js=1' && document.readyState === 'complete'",
        "static page",
      );
      const fallback = await evaluate(
        page,
        `({
      counts: [...document.querySelectorAll('[data-stat]')].map(e => e.textContent),
      href: document.querySelector('[data-download-link]').href,
      hash: location.hash, camera: document.documentElement.classList.contains('camera')
    })`,
      );
      assert.deepEqual(fallback.counts, ["Unavailable", "Unavailable"]);
      assert.equal(
        fallback.href,
        "https://github.com/Neil-urk12/agentica/releases/latest",
      );
      assert.equal(fallback.hash, "#download");
      assert.equal(fallback.camera, false);
      assert.equal(calls, 0);
    } finally {
      if (page) await page.close();
      await new Promise((done) => server.close(done));
    }
  },
);
