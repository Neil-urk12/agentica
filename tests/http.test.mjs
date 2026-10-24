import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer, request } from "node:http";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Editor } from "../apps/desktop/src/lib/editor.ts";
import {
  MAX_FRAME_BYTES,
  ResultSchemas,
  RuntimeRequestSchema,
  RuntimeResponseSchema,
} from "@agentica/protocol";
import {
  boxByText,
  boxOf,
  clickAt,
  countOf,
  dragBetween,
  evaluate,
  launchBrowser,
  waitFor,
} from "./support/chrome.mjs";
import { zipStore } from "./support/zip.mjs";

async function openCard(browser, label) {
  const item = ".tiles .tile__open, .cards .card";
  const card = `[...document.querySelectorAll(${JSON.stringify(item)})].find((entry) => entry.textContent.includes(${JSON.stringify(label)}))`;
  await waitFor(browser, `${card} && !(${card}).disabled`, `the ${label} card`);
  // Later tests add workspaces: scroll the target into view so its measured
  // center is inside the clickable area.
  await evaluate(
    browser,
    `(${card}).focus(); (${card}).scrollIntoView({ block: 'center' })`,
  );
  await clickAt(browser, await boxByText(browser, item, label));
}

const FRONTEND_ORIGIN = "http://127.0.0.1:1420";
// The same Vite server answers on either loopback spelling, so a browser there
// sends whichever one it was opened with as the Origin header.
const LOCALHOST_FRONTEND_ORIGIN = "http://localhost:1420";
const port = 1421;
const binary = resolve(
  process.env.CARGO_TARGET_DIR ??
    fileURLToPath(new URL("../target", import.meta.url)),
  "debug",
  process.platform === "win32" ? "agentica-backend.exe" : "agentica-backend",
);
let key;
// Never touch the user's real workspaces.
const dataDir = mkdtempSync(join(tmpdir(), "agentica-http-"));
const env = { ...process.env, PATH: "", AGENTICA_DATA_DIR: dataDir };
process.on("exit", () => rmSync(dataDir, { recursive: true, force: true }));
const ping = {
  protocolVersion: 1,
  id: "browser-health",
  method: "runtime.ping",
};

async function startBackend(childEnv = env) {
  // An empty PATH proves the compiled backend does not launch Node or Cargo.
  const child = spawn(binary, {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let diagnostics = "";
  child.stderr.setEncoding("utf8").on("data", (text) => {
    diagnostics += text;
  });
  try {
    const connectionKey = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Backend startup timed out")),
        5000,
      );
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error(diagnostics || "Backend exited before listening"));
      });
      child.stdout.setEncoding("utf8").on("data", (text) => {
        output += text;
        const match = output.match(/Connection key: ([a-f0-9]{64})/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]);
        }
      });
    });
    return { child, connectionKey };
  } catch (error) {
    child.kill();
    throw error;
  }
}

async function stopBackend(child) {
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    const [code] = await exited;
    if (process.platform !== "win32") assert.equal(code, 0);
  } finally {
    clearTimeout(timeout);
  }
}

async function slowRequest(raw) {
  const socket = connect(port, "127.0.0.1");
  let response = "";
  socket.setEncoding("utf8").on("data", (text) => {
    response += text;
  });
  const closed = once(socket, "close");
  socket.setTimeout(6500, () =>
    socket.destroy(new Error("Request deadline was not enforced")),
  );
  await once(socket, "connect");
  socket.write(raw);
  await closed;
  return response;
}

function send(
  port,
  {
    method = "POST",
    path = "/rpc",
    headers = {},
    body = JSON.stringify(ping),
    timeout = 3000,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const client = request(
      {
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers: Object.fromEntries(
          Object.entries({
            Origin: FRONTEND_ORIGIN,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            ...headers,
          }).filter(([, value]) => value !== null),
        ),
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
        });
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text,
          }),
        );
      },
    );
    client.on("error", reject);
    client.setTimeout(timeout, () =>
      client.destroy(new Error("HTTP test timed out")),
    );
    client.end(body);
  });
}

test("browser RPC enforces localhost, authentication, CORS, limits, and the shared protocol", async () => {
  const backend = await startBackend();
  key = backend.connectionKey;
  try {
    const result = await send(port);
    assert.equal(result.status, 200);
    assert.equal(
      result.headers["access-control-allow-origin"],
      FRONTEND_ORIGIN,
    );
    assert.equal(result.headers["cache-control"], "no-store");
    assert.deepEqual(RuntimeResponseSchema.parse(JSON.parse(result.text)), {
      protocolVersion: 1,
      id: ping.id,
      result: { status: "ok" },
    });

    const bundledOrigin = `http://127.0.0.1:${port}`;
    assert.equal(
      (await send(port, { headers: { Origin: bundledOrigin } })).status,
      200,
    );
    assert.equal((await send(port, { headers: { Origin: null } })).status, 403);
    assert.equal(
      (
        await send(port, {
          headers: { Origin: [bundledOrigin, bundledOrigin] },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await send(port, {
          headers: { Origin: bundledOrigin, Authorization: "Bearer wrongkey" },
        })
      ).status,
      401,
    );

    const publicRequest = {
      method: "GET",
      body: "",
      headers: { Origin: null, Authorization: null },
    };
    const frontend = await send(port, { ...publicRequest, path: "/" });
    assert.equal(frontend.status, 200);
    assert.match(frontend.headers["content-type"], /^text\/html/);
    assert.match(
      frontend.headers["content-security-policy"],
      /connect-src 'self'/,
    );
    assert.match(
      frontend.headers["content-security-policy"],
      /frame-ancestors 'none'/,
    );
    assert.equal(frontend.headers["x-content-type-options"], "nosniff");
    assert.equal(frontend.headers["referrer-policy"], "no-referrer");
    assert.equal(frontend.headers["cache-control"], "no-store");
    assert.equal(frontend.headers["access-control-allow-origin"], undefined);
    assert.equal(
      frontend.text,
      readFileSync(
        new URL("../apps/desktop/dist/index.html", import.meta.url),
        "utf8",
      ),
    );
    assert.ok(!frontend.text.includes(key));
    const assets = [
      ...frontend.text.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g),
    ].map((match) => match[1]);
    assert.ok(assets.some((path) => path.endsWith(".js")));
    assert.ok(assets.some((path) => path.endsWith(".css")));
    for (const path of assets) {
      const asset = await send(port, { ...publicRequest, path });
      assert.equal(asset.status, 200);
      assert.equal(
        asset.text,
        readFileSync(
          new URL(`../apps/desktop/dist${path}`, import.meta.url),
          "utf8",
        ),
      );
      assert.match(
        asset.headers["content-type"],
        path.endsWith(".js") ? /^text\/javascript/ : /^text\/css/,
      );
      assert.ok(!asset.text.includes(key));
      const head = await send(port, { ...publicRequest, method: "HEAD", path });
      assert.equal(head.status, 200);
      assert.equal(head.text, "");
      assert.equal(
        Number(head.headers["content-length"]),
        Buffer.byteLength(asset.text),
      );
    }
    const cssPath = assets.find((path) => path.endsWith(".css"));
    const css = readFileSync(
      new URL(`../apps/desktop/dist${cssPath}`, import.meta.url),
      "utf8",
    );
    const fonts = new Set(css.match(/\/assets\/[^)"'\s]+\.woff2?/g));
    assert.ok(
      fonts.size > 0,
      "production CSS must reference its bundled fonts",
    );
    for (const path of fonts) {
      const response = await fetch(`${bundledOrigin}${path}`);
      assert.equal(response.status, 200, path);
      assert.equal(
        response.headers.get("content-type"),
        path.endsWith(".woff2") ? "font/woff2" : "font/woff",
      );
      assert.deepEqual(
        Buffer.from(await response.arrayBuffer()),
        readFileSync(new URL(`../apps/desktop/dist${path}`, import.meta.url)),
      );
    }

    for (const path of [
      "/rpc?extra=true",
      "/../Cargo.toml",
      "/%2e%2e/Cargo.toml",
      "/assets/missing.js",
      `${assets[0]}.map`,
      "/.env",
      "/src/main.ts",
      "/?key=wrongkey",
    ]) {
      assert.equal(
        (
          await send(port, {
            ...publicRequest,
            path,
            headers: { Origin: bundledOrigin },
          })
        ).status,
        404,
      );
    }
    for (const headers of [
      { Host: "localhost:1421" },
      { Origin: "https://untrusted.example" },
      { Origin: "null" },
      { Origin: "" },
      { Origin: [bundledOrigin, bundledOrigin] },
    ]) {
      assert.equal(
        (
          await send(port, {
            ...publicRequest,
            path: "/",
            headers: { ...publicRequest.headers, ...headers },
          })
        ).status,
        403,
      );
    }
    assert.equal(
      (await send(port, { path: "/", headers: { Origin: bundledOrigin } }))
        .status,
      405,
    );

    for (const body of [
      "{",
      "null",
      '[1,"browser-health","runtime.ping"]',
      JSON.stringify({ ...ping, method: "files.write" }),
      JSON.stringify({ ...ping, protocolVersion: 2 }),
      JSON.stringify({ ...ping, extra: true }),
      JSON.stringify({ ...ping, id: "" }),
      JSON.stringify({ ...ping, id: "x".repeat(129) }),
      JSON.stringify({ ...ping, id: "😀".repeat(65) }),
      JSON.stringify({ ...ping, id: 1 }),
    ]) {
      const invalid = await send(port, { body });
      assert.equal(invalid.status, 200);
      const response = RuntimeResponseSchema.parse(JSON.parse(invalid.text));
      assert.equal(response.id, null);
      assert.equal(
        response.error.code,
        body === "{" ? "INVALID_JSON" : "INVALID_REQUEST",
      );
    }
    for (const headers of [
      { Authorization: "" },
      { Authorization: "Bearer wrongkey" },
      { Authorization: `Bearer ${"x".repeat(key.length)}` },
    ]) {
      assert.equal((await send(port, { headers })).status, 401);
    }
    for (const headers of [
      { Origin: "https://untrusted.example" },
      { Origin: "" },
      { Origin: `http://localhost:${port}` },
      { Host: `untrusted.example:${port}` },
      { Host: `127.0.0.1:${port + 1}` },
    ]) {
      const denied = await send(port, { headers });
      assert.equal(denied.status, 403);
      assert.equal(denied.headers["access-control-allow-origin"], undefined);
    }
    const preflight = await send(port, {
      method: "OPTIONS",
      body: "",
      headers: {
        Authorization: "",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers["access-control-allow-methods"], "POST");
    assert.equal(
      preflight.headers["access-control-allow-headers"],
      "Authorization, Content-Type",
    );

    // A frontend opened at the localhost spelling must clear preflight with the
    // method and headers it requests, or the browser blocks the RPC call.
    const localhostPreflight = await send(port, {
      method: "OPTIONS",
      body: "",
      headers: {
        Origin: LOCALHOST_FRONTEND_ORIGIN,
        Authorization: "",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization, content-type",
      },
    });
    assert.equal(localhostPreflight.status, 204);
    assert.equal(
      localhostPreflight.headers["access-control-allow-origin"],
      LOCALHOST_FRONTEND_ORIGIN,
    );
    assert.equal(
      localhostPreflight.headers["access-control-allow-methods"],
      "POST",
    );
    assert.equal(
      localhostPreflight.headers["access-control-allow-headers"],
      "Authorization, Content-Type",
    );
    assert.match(localhostPreflight.headers.vary, /Origin/);
    const localhostPing = await send(port, {
      headers: { Origin: LOCALHOST_FRONTEND_ORIGIN },
    });
    assert.equal(localhostPing.status, 200);
    assert.equal(
      localhostPing.headers["access-control-allow-origin"],
      LOCALHOST_FRONTEND_ORIGIN,
    );

    assert.equal(
      (
        await send(port, {
          method: "OPTIONS",
          headers: { "Access-Control-Request-Method": "DELETE" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await send(port, {
          method: "OPTIONS",
          headers: {
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-admin",
          },
        })
      ).status,
      403,
    );
    assert.equal((await send(port, { method: "GET", body: "" })).status, 405);
    assert.equal((await send(port, { path: "/files" })).status, 404);
    assert.equal(
      (await send(port, { headers: { "Content-Type": "text/plain" } })).status,
      415,
    );
    assert.equal(
      (await send(port, { body: "x".repeat(MAX_FRAME_BYTES + 1) })).status,
      413,
    );
    assert.equal(
      (await send(port, { body: "あ".repeat(MAX_FRAME_BYTES / 2) })).status,
      413,
    );
    assert.equal((await send(port)).status, 200);

    const atLimit = JSON.stringify(ping).padEnd(MAX_FRAME_BYTES, " ");
    assert.equal((await send(port, { body: atLimit })).status, 200);
    assert.equal((await send(port, { path: "/rpc?extra=true" })).status, 404);
    assert.equal(
      (
        await send(port, {
          headers: { Authorization: [`Bearer ${key}`, `Bearer ${key}`] },
        })
      ).status,
      401,
    );

    const second = spawnSync(binary, {
      env,
      encoding: "utf8",
      timeout: 5000,
    });
    assert.ifError(second.error);
    assert.equal(second.status, 1);
    assert.match(second.stderr, /Cannot start detached backend/);

    assert.match(
      await slowRequest(
        `POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: ${FRONTEND_ORIGIN}\r\nAuthorization: Bearer ${key}\r\nContent-Type: application/json\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{`,
      ),
      /408 Request Timeout/,
    );
    const headerTimeout = await slowRequest(
      `POST /rpc HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n`,
    );
    // Hyper may close incomplete headers without emitting an HTTP response.
    assert.ok(
      headerTimeout === "" ||
        headerTimeout.startsWith("HTTP/1.1 408 Request Timeout"),
    );
    assert.equal((await send(port)).status, 200);
  } finally {
    await stopBackend(backend.child);
  }
  await assert.rejects(send(port), (error) =>
    ["ECONNREFUSED", "ECONNRESET"].includes(error.code),
  );
  const restarted = await startBackend();
  try {
    assert.notEqual(restarted.connectionKey, key);
    assert.equal((await send(port)).status, 401);
    assert.equal(
      (
        await send(port, {
          headers: { Authorization: `Bearer ${restarted.connectionKey}` },
        })
      ).status,
      200,
    );
  } finally {
    await stopBackend(restarted.child);
  }
});

function substitute(value, saved) {
  if (typeof value === "string" && value.startsWith("$")) {
    assert.ok(value.slice(1) in saved, `fixture value ${value} was not saved`);
    return saved[value.slice(1)];
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, saved));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        substitute(item, saved),
      ]),
    );
  return value;
}

// Objects match a subset of keys; arrays and scalars match exactly.
function assertMatches(expected, actual, label) {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), label);
    assert.equal(actual.length, expected.length, label);
    expected.forEach((item, index) =>
      assertMatches(item, actual[index], `${label}[${index}]`),
    );
  } else if (expected && typeof expected === "object") {
    assert.ok(actual && typeof actual === "object", label);
    for (const [name, item] of Object.entries(expected))
      assertMatches(item, actual[name], `${label}.${name}`);
  } else {
    assert.equal(actual, expected, label);
  }
}

test("the shared workspace and conversation fixtures round-trip over authenticated HTTP", async () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/workspace-roundtrip.json", import.meta.url),
      "utf8",
    ),
  );
  let backend = await startBackend();
  fixture.steps.push(
    ...JSON.parse(
      readFileSync(
        new URL("./fixtures/conversation-roundtrip.json", import.meta.url),
        "utf8",
      ),
    ).steps,
  );
  key = backend.connectionKey;
  const saved = {};
  try {
    for (const [index, step] of fixture.steps.entries()) {
      if (step.restart) {
        // A normal exit releases the writer lock; the new key is required.
        await stopBackend(backend.child);
        backend = await startBackend();
        assert.notEqual(backend.connectionKey, key);
        key = backend.connectionKey;
        continue;
      }
      const label = `step ${index} ${step.method}`;
      const input = substitute(
        step.request ?? {
          protocolVersion: 1,
          id: `step-${index}`,
          method: step.method,
          params: step.params,
        },
        saved,
      );
      const body = typeof input === "string" ? input : JSON.stringify(input);
      const request = JSON.parse(body);
      // The frontend schema rejects exactly what the runtime calls invalid.
      assert.equal(
        RuntimeRequestSchema.safeParse(request).success,
        !["INVALID_REQUEST", "INVALID_PARAMS"].includes(step.error),
        label,
      );
      const reply = await send(port, { body });
      assert.equal(reply.status, 200, label);
      const response = RuntimeResponseSchema.parse(JSON.parse(reply.text));
      assert.equal(
        response.id,
        step.error === "INVALID_REQUEST" ? null : request.id,
        label,
      );
      if (step.error) {
        assert.equal(response.error?.code, step.error, label);
        assert.ok(response.error.message.length > 10, label);
        continue;
      }
      const result = ResultSchemas[step.method].parse(response.result);
      for (const [name, pointer] of Object.entries(step.save ?? {})) {
        saved[name] = pointer
          .split("/")
          .slice(1)
          .reduce((value, part) => value[part], result);
        assert.ok(saved[name] !== undefined, label);
      }
      assertMatches(substitute(step.expect, saved), result, label);
    }
  } finally {
    await stopBackend(backend.child);
  }
});

test("MCP tools run over HTTP without blocking other requests and never expose env values", async () => {
  const backend = await startBackend();
  key = backend.connectionKey;
  try {
    const rpc = async (method, params) =>
      JSON.parse(
        (
          await send(port, {
            body: JSON.stringify({
              protocolVersion: 1,
              id: "mcp",
              method,
              params,
            }),
            timeout: 15000,
          })
        ).text,
      );
    const ok = async (method, params) => {
      const reply = await rpc(method, params);
      assert.equal(
        reply.error,
        undefined,
        `${method}: ${JSON.stringify(reply)}`,
      );
      // The strict protocol schemas are what the browser applies to every reply.
      return ResultSchemas[method].parse(reply.result);
    };
    const workspaceId = (await ok("workspace.create", { name: "Tools" }))
      .workspace.id;
    const canvasId = (await ok("canvas.create", { workspaceId, title: "C" }))
      .canvas.id;
    const turnId = "30000000-0000-4000-8000-000000000001";
    await ok("conversation.start", {
      workspaceId,
      canvasId,
      turnId,
      prompt: "Help",
      model: "m",
      nodeIds: [],
      anchor: { x: 0, y: 0 },
    });

    const created = await ok("mcp.server.create", {
      workspaceId,
      name: "fake",
      command: process.execPath,
      args: [fileURLToPath(new URL("./support/fake-mcp.mjs", import.meta.url))],
      env: { SECRET_TOKEN: "do-not-leak-me" },
    });
    const serverId = created.server.id;
    assert.equal(created.server.status, "stopped");
    const enabled = await ok("mcp.server.set_enabled", {
      workspaceId,
      serverId,
      enabled: true,
    });
    assert.equal(enabled.server.status, "running");
    for (const tool of ["echo", "slow"])
      await ok("mcp.tool.set_enabled", {
        workspaceId,
        serverId,
        tool,
        enabled: true,
      });
    const listed = JSON.stringify(await ok("mcp.server.list", { workspaceId }));
    assert.ok(listed.includes("SECRET_TOKEN"));
    assert.ok(!listed.includes("do-not-leak-me"));

    const call = (tool) =>
      ok("mcp.call", {
        workspaceId,
        canvasId,
        turnId,
        server: "fake",
        tool,
        arguments: { text: "hi" },
      });
    assert.deepEqual(await call("echo"), { status: "ok", text: "echo:hi" });

    // A tool call that waits on the child must not hold up the rest of the backend.
    const started = Date.now();
    const slow = call("slow");
    await delay(150);
    await ok("canvas.create", { workspaceId, title: "During the call" });
    assert.ok(
      Date.now() - started < 1200,
      "other requests waited for the tool",
    );
    assert.deepEqual(await slow, { status: "ok", text: "slow:hi" });

    const rows = new DatabaseSync(
      join(dataDir, "workspaces", workspaceId, "workspace.sqlite3"),
    )
      .prepare("SELECT tool_name, status FROM mcp_call ORDER BY sequence")
      .all();
    assert.deepEqual(
      rows.map((row) => [row.tool_name, row.status]),
      [
        ["echo", "ok"],
        ["slow", "ok"],
      ],
    );

    // Turning the server off stops the child and closes its tools.
    await ok("mcp.server.set_enabled", {
      workspaceId,
      serverId,
      enabled: false,
    });
    const refused = await rpc("mcp.call", {
      workspaceId,
      canvasId,
      turnId,
      server: "fake",
      tool: "echo",
      arguments: {},
    });
    assert.equal(refused.error.code, "SCOPE_DENIED");
  } finally {
    await stopBackend(backend.child);
  }
});

test("stopping the backend stops running MCP servers", async () => {
  const backend = await startBackend();
  key = backend.connectionKey;
  let stopped = false;
  const pidFile = join(dataDir, "fake-mcp.pid");
  rmSync(pidFile, { force: true });
  try {
    const ok = async (method, params) => {
      const reply = JSON.parse(
        (
          await send(port, {
            body: JSON.stringify({
              protocolVersion: 1,
              id: "s",
              method,
              params,
            }),
            timeout: 15000,
          })
        ).text,
      );
      assert.equal(
        reply.error,
        undefined,
        `${method}: ${JSON.stringify(reply)}`,
      );
      return reply.result;
    };
    const workspaceId = (await ok("workspace.create", { name: "Exit" }))
      .workspace.id;
    const serverId = (
      await ok("mcp.server.create", {
        workspaceId,
        name: "fake",
        command: process.execPath,
        args: [
          fileURLToPath(new URL("./support/fake-mcp.mjs", import.meta.url)),
        ],
        env: { FAKE_MCP_PID_FILE: pidFile, FAKE_MCP_LINGER: "1" },
      })
    ).server.id;
    await ok("mcp.server.set_enabled", {
      workspaceId,
      serverId,
      enabled: true,
    });
    const pid = Number(readFileSync(pidFile, "utf8"));
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    assert.ok(alive(), "the fake server should be running");
    stopped = true;
    await stopBackend(backend.child);
    // The fake ignores its closed stdin, so only the backend's stop can end it.
    const started = Date.now();
    while (alive() && Date.now() - started < 3000) await delay(50);
    assert.ok(!alive(), `MCP server ${pid} outlived the backend`);
  } finally {
    if (!stopped) await stopBackend(backend.child);
  }
});

test("deleting a workspace during queued MCP calls does not hang the backend", async () => {
  const backend = await startBackend();
  key = backend.connectionKey;
  try {
    const rpc = async (method, params) =>
      JSON.parse(
        (
          await send(port, {
            body: JSON.stringify({
              protocolVersion: 1,
              id: "d",
              method,
              params,
            }),
            timeout: 15000,
          })
        ).text,
      );
    const ok = async (method, params) => {
      const reply = await rpc(method, params);
      assert.equal(
        reply.error,
        undefined,
        `${method}: ${JSON.stringify(reply)}`,
      );
      return reply.result;
    };
    const workspaceId = (await ok("workspace.create", { name: "Gone" }))
      .workspace.id;
    const canvasId = (await ok("canvas.create", { workspaceId, title: "C" }))
      .canvas.id;
    const turnId = "30000000-0000-4000-8000-000000000002";
    await ok("conversation.start", {
      workspaceId,
      canvasId,
      turnId,
      prompt: "Help",
      model: "m",
      nodeIds: [],
      anchor: { x: 0, y: 0 },
    });
    const serverId = (
      await ok("mcp.server.create", {
        workspaceId,
        name: "fake",
        command: process.execPath,
        args: [
          fileURLToPath(new URL("./support/fake-mcp.mjs", import.meta.url)),
        ],
        env: {},
      })
    ).server.id;
    await ok("mcp.server.set_enabled", {
      workspaceId,
      serverId,
      enabled: true,
    });
    for (const tool of ["echo", "slow"])
      await ok("mcp.tool.set_enabled", {
        workspaceId,
        serverId,
        tool,
        enabled: true,
      });
    const call = (tool) =>
      rpc("mcp.call", {
        workspaceId,
        canvasId,
        turnId,
        server: "fake",
        tool,
        arguments: {},
      });
    // The slow call holds the server; the echo call waits behind it for the client lock.
    const slow = call("slow");
    await delay(150);
    const queued = call("echo");
    await delay(150);
    const settled = Promise.all([
      slow,
      queued,
      rpc("workspace.delete", { workspaceId }),
    ]);
    const outcome = await Promise.race([
      settled.then(() => "settled"),
      delay(8000).then(() => "hung"),
    ]);
    assert.equal(outcome, "settled");
    const [, , deleted] = await settled;
    assert.equal(deleted.error, undefined, JSON.stringify(deleted));
    // The backend still answers afterwards.
    await ok("workspace.list", {});
  } finally {
    await stopBackend(backend.child);
  }
});

test("queued persistence calls expire without writes and started calls return their outcome", async () => {
  const backend = await startBackend();
  key = backend.connectionKey;
  let database;
  try {
    const rpc = (id, method, params) =>
      send(port, {
        body: JSON.stringify({ protocolVersion: 1, id, method, params }),
        timeout: 15000,
      });
    const created = await rpc("setup", "workspace.create", {
      name: "Deadlines",
    });
    const workspaceId = JSON.parse(created.text).result.workspace.id;
    database = new DatabaseSync(
      join(dataDir, "workspaces", workspaceId, "workspace.sqlite3"),
    );

    // A call admitted before the deadline returns its own committed outcome.
    // It is admitted at once (the runtime is idle), then waits on the exclusive
    // lock; releasing the lock during that wait commits the write. Rolling back
    // well inside the two-second SQLite busy timeout commits the call no matter
    // how scheduling interleaves the send and the release.
    database.exec("BEGIN EXCLUSIVE");
    const committed = rpc("committed", "canvas.create", {
      workspaceId,
      title: "committed",
    });
    await delay(300);
    database.exec("ROLLBACK");
    const committedResponse = await committed;
    assert.equal(committedResponse.status, 200);
    assert.equal(
      JSON.parse(committedResponse.text).result.canvas.title,
      "committed",
    );

    // Calls that cannot be admitted within the five-second deadline expire with
    // 408 and never write. The held lock serializes every call, and each
    // admitted call spends its full two-second SQLite busy timeout, so a call
    // several places back cannot reach the runtime before its deadline. How
    // many expire depends on scheduling, so assert the invariants that hold at
    // any speed instead of a knife-edge split.
    database.exec("BEGIN EXCLUSIVE");
    const results = await Promise.all(
      Array.from({ length: 6 }, async (_, index) => {
        const title = `queued-${index}`;
        const response = await rpc(title, "canvas.create", {
          workspaceId,
          title,
        });
        return { ...response, title };
      }),
    );
    database.exec("ROLLBACK");

    const expired = results.filter((result) => result.status === 408);
    assert.ok(
      expired.length >= 1,
      "a call that waits past the deadline must expire in the queue",
    );
    for (const result of expired)
      assert.match(result.text, /before execution\. Nothing was saved/);
    // Calls admitted before the deadline still return their own outcome: with
    // the lock held that is a storage failure, never an admission timeout. At
    // least the first call is admitted, so this path must also be exercised.
    const completed = results.filter((result) => result.status === 200);
    assert.ok(
      completed.length >= 1,
      "a call admitted before the deadline must answer",
    );
    for (const result of completed)
      assert.equal(JSON.parse(result.text).error?.code, "STORAGE_ERROR");

    // Only the committed call reached storage; the expired and failed calls
    // wrote nothing.
    const reopened = await rpc("inspect", "workspace.open", { workspaceId });
    const canvases = JSON.parse(reopened.text).result.canvases;
    assert.deepEqual(
      canvases.map((canvas) => canvas.title),
      ["committed"],
    );
  } finally {
    database?.close();
    await stopBackend(backend.child);
  }
});

test("the UI save buffer recovers a real SQLite write failure and reopens after restart", async () => {
  let backend = await startBackend();
  key = backend.connectionKey;
  let database;
  const call = async (_key, _connect, method, params) => {
    const input = RuntimeRequestSchema.parse({
      protocolVersion: 1,
      id: crypto.randomUUID(),
      method,
      params,
    });
    const reply = await send(port, {
      body: JSON.stringify(input),
      timeout: 10000,
    });
    assert.equal(reply.status, 200);
    const response = RuntimeResponseSchema.parse(JSON.parse(reply.text));
    if (response.error)
      throw new Error(`${response.error.code}: ${response.error.message}`);
    return ResultSchemas[method].parse(response.result);
  };
  const editor = new Editor(
    call,
    () => key,
    () => {},
  );
  try {
    await editor.createWorkspace("UI round trip");
    const workspaceId = editor.state.workspace.workspace.id;
    await editor.createCanvas("Manual notes");
    const canvasId = editor.state.document.canvas.id;
    await editor.addText();
    const { id: nodeId, artifactId } = editor.state.document.nodes[0];
    database = new DatabaseSync(
      join(dataDir, "workspaces", workspaceId, "workspace.sqlite3"),
    );
    database.exec("BEGIN EXCLUSIVE");
    editor.editText(artifactId, "Unsaved through a disk failure ✓");
    editor.placeNode(nodeId, { x: 320, y: -40, width: 300, height: 200 });
    editor.setViewport({ x: -120, y: 42, zoom: 1.25 });
    await editor.save();
    assert.equal(editor.state.dirty, true);
    assert.match(editor.state.error, /STORAGE_ERROR/);
    assert.equal(editor.state.document.artifacts[0].revision, 1);
    assert.match(editor.recovery(), /Unsaved through a disk failure/);
    database.exec("ROLLBACK");
    database.close();
    database = undefined;
    editor.editText(artifactId, "Recovered and saved ✓\nSecond line");
    await editor.retrySave();
    assert.equal(editor.state.error, "");
    assert.equal(editor.state.dirty, false);
    await stopBackend(backend.child);
    editor.editText(artifactId, "Recovered after backend restart ✓");
    await editor.save();
    assert.equal(editor.state.dirty, true);
    assert.ok(editor.state.error);
    backend = await startBackend();
    key = backend.connectionKey;
    await editor.retrySave();
    assert.equal(editor.state.error, "");
    assert.equal(editor.state.dirty, false);
    const expected = structuredClone(editor.state.document);
    await editor.closeWorkspace();
    await stopBackend(backend.child);
    backend = await startBackend();
    key = backend.connectionKey;
    await editor.openWorkspace(workspaceId);
    await editor.openCanvas(canvasId);
    assert.equal(editor.state.error, "");
    assert.deepEqual(editor.state.document, expected);
  } finally {
    editor.dispose();
    database?.close();
    await stopBackend(backend.child);
  }
});

test("drawing labels, connections and inspector text edits reopen without Codex", async () => {
  const backend = await startBackend();
  key = backend.connectionKey;
  let browser;
  // Calls from the seeding editor talk to the same runtime the app uses.
  const call = async (_key, _connect, method, params) => {
    const input = RuntimeRequestSchema.parse({
      protocolVersion: 1,
      id: crypto.randomUUID(),
      method,
      params,
    });
    const reply = await send(port, {
      body: JSON.stringify(input),
      timeout: 15000,
    });
    assert.equal(reply.status, 200);
    const response = RuntimeResponseSchema.parse(JSON.parse(reply.text));
    if (response.error)
      throw new Error(`${response.error.code}: ${response.error.message}`);
    return ResultSchemas[method].parse(response.result);
  };
  const editor = new Editor(
    call,
    () => key,
    () => {},
  );
  let textNodeId;
  const drawingIds = {};
  try {
    await editor.createWorkspace("Handle coverage");
    await editor.createCanvas("Handle canvas");
    await editor.addText();
    textNodeId = editor.state.document.nodes.at(-1).id;
    for (const [kind, geometry, shape] of [
      [
        "path",
        { x: 520, y: 60, width: 200, height: 120 },
        {
          kind: "path",
          points: [
            [8, 8],
            [70, 80],
            [130, 20],
            [190, 95],
          ],
          color: "#7b7bf0",
          width: 4,
        },
      ],
      [
        "rectangle",
        { x: 100, y: 340, width: 200, height: 120 },
        {
          kind: "rectangle",
          x: 6,
          y: 6,
          width: 188,
          height: 108,
          color: "#ef4444",
        },
      ],
      [
        "ellipse",
        { x: 520, y: 340, width: 200, height: 120 },
        {
          kind: "ellipse",
          x: 6,
          y: 6,
          width: 188,
          height: 108,
          color: "#22c55e",
        },
      ],
    ]) {
      await editor.addDrawing(geometry, { shapes: [shape] });
      drawingIds[kind] = editor.state.document.nodes.at(-1).id;
    }
    const labels = [
      "Start",
      "Composite label content that must remain readable. ".repeat(2),
    ];
    await editor.addDrawing(
      { x: 100, y: 520, width: 420, height: 100 },
      {
        shapes: labels.map((label, index) => ({
          kind: index === 0 ? "rectangle" : "ellipse",
          x: index * 220,
          y: 0,
          width: 200,
          height: 60,
          color: "#7b7bf0",
          label,
        })),
      },
    );
    const compositeId = editor.state.document.nodes.at(-1).id;
    editor.placeNode(textNodeId, { x: 100, y: 60, width: 240, height: 160 });
    await editor.save();
    assert.equal(editor.state.error, "");
    assert.equal(editor.state.dirty, false);
    // Release the workspace so the app in the browser can open it.
    await editor.closeWorkspace();

    browser = await launchBrowser();
    await browser.send(
      "Page.navigate",
      { url: `http://127.0.0.1:${port}/` },
      browser.sessionId,
    );
    await waitFor(
      browser,
      `!!document.querySelector("#connection-key")`,
      "the connection form",
    );
    await evaluate(
      browser,
      `(() => {
        const input = document.querySelector("#connection-key");
        input.value = ${JSON.stringify(key)};
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      })()`,
    );
    await clickAt(
      browser,
      await boxOf(browser, ".connbar button[type='submit']"),
    );
    await waitFor(
      browser,
      `!!document.querySelector(".connbar--ok")`,
      "the connected status",
    );

    for (const [picker, label] of [
      ["workspace", "Handle coverage"],
      ["canvas", "Handle canvas"],
    ]) {
      // Workspaces are tiles on the start screen; canvases are picker cards.
      const item = ".tiles .tile__open, .cards .card";
      await waitFor(
        browser,
        `[...document.querySelectorAll(${JSON.stringify(item)})].some((card) => card.textContent.includes(${JSON.stringify(label)}))`,
        `the seeded ${picker} card`,
      );
      await clickAt(browser, await boxByText(browser, item, label));
    }
    await waitFor(
      browser,
      `!!document.querySelector(".svelte-flow")`,
      "the canvas",
    );
    await waitFor(
      browser,
      `[...document.querySelectorAll(".svelte-flow__node")].length === 5 && [...document.querySelectorAll(".svelte-flow__node")].every((node) => node.getBoundingClientRect().height > 0)`,
      "all five nodes to be measured",
    );
    assert.equal(
      await evaluate(browser, `!!document.querySelector(".inspector")`),
      false,
      "the inspector starts closed",
    );
    await clickAt(
      browser,
      await boxOf(browser, '[aria-label="Toggle inspector"]'),
    );
    await waitFor(
      browser,
      `!!document.querySelector(".inspector")`,
      "the inspector to open from its canvas control",
    );
    const composite = `[data-id="${compositeId}"]`;
    assert.equal(
      await evaluate(
        browser,
        `(() => {
        const labels = document.querySelectorAll('${composite} .shape-label');
        return labels.length === 2 && labels[0].scrollHeight <= labels[0].clientHeight + 1 && labels[1].scrollHeight > labels[1].clientHeight + 1;
      })()`,
      ),
      true,
      "only the second composite label is clipped",
    );
    await waitFor(
      browser,
      `document.querySelector('${composite} .drawing__more')?.textContent === 'Read label'`,
      "reader access for a clipped composite label",
    );
    await clickAt(browser, await boxOf(browser, `${composite} .drawing__more`));
    await waitFor(
      browser,
      `!!document.querySelector('dialog[open] .reader__plain')`,
      "the label reader",
    );
    assert.equal(
      await evaluate(
        browser,
        `document.querySelector('.reader__plain').textContent`,
      ),
      labels.join("\n\n"),
      "the reader includes every label, including the clipped second label",
    );
    assert.equal(
      await evaluate(
        browser,
        `[...document.querySelectorAll('dialog[open] button')].some(button => button.textContent.includes('Edit source'))`,
      ),
      false,
      "drawing labels are read-only",
    );
    await clickAt(
      browser,
      await boxByText(browser, "dialog[open] button", "Close"),
    );
    // Change the measured box to exercise the observer independently of rerenders.
    await evaluate(
      browser,
      `document.querySelectorAll('${composite} .shape-label')[1].style.height = '400px'`,
    );
    await waitFor(
      browser,
      `!document.querySelector('${composite} .drawing__more')`,
      "the overflow action to clear when every label fits",
    );
    await clickAt(browser, await boxOf(browser, `${composite} rect`));
    await waitFor(
      browser,
      `[...document.querySelectorAll('.inspector button')].some(button => button.textContent.includes('Read full content'))`,
      "inspector reader access for a composite drawing",
    );
    await clickAt(
      browser,
      await boxByText(browser, ".inspector button", "Read full content"),
    );
    await waitFor(
      browser,
      `!!document.querySelector('dialog[open] .reader__plain')`,
      "the inspector label reader",
    );
    assert.equal(
      await evaluate(
        browser,
        `document.querySelector('.reader__plain').textContent`,
      ),
      labels.join("\n\n"),
    );
    await clickAt(
      browser,
      await boxByText(browser, "dialog[open] button", "Close"),
    );
    await evaluate(
      browser,
      `document.querySelectorAll('${composite} .shape-label')[1].style.height = '60px'`,
    );
    await waitFor(
      browser,
      `!!document.querySelector('${composite} .drawing__more')`,
      "the overflow action to return after shrinking a label",
    );
    // Every drawing kind must render its own connection handles.
    for (const [kind, id] of Object.entries(drawingIds)) {
      await waitFor(
        browser,
        `!!document.querySelector('[data-id="${id}"]')`,
        `the ${kind} drawing node`,
      );
      const handles = await evaluate(
        browser,
        `(() => {
          const node = document.querySelector('[data-id="${id}"]');
          return {
            target: node.querySelectorAll(".svelte-flow__handle.target").length,
            source: node.querySelectorAll(".svelte-flow__handle.source").length,
          };
        })()`,
      );
      assert.equal(
        handles.target,
        1,
        `the ${kind} drawing exposes a target handle`,
      );
      assert.equal(
        handles.source,
        1,
        `the ${kind} drawing exposes a source handle`,
      );
    }

    // Drag from each drawing's handle to the text node, as a user would.
    const press = async (key, code, modifiers = 0) => {
      const windowsVirtualKeyCode = { Enter: 13, Tab: 9, KeyA: 65 }[code];
      for (const type of ["keyDown", "keyUp"])
        await browser.send(
          "Input.dispatchKeyEvent",
          {
            type,
            key,
            code,
            modifiers,
            windowsVirtualKeyCode,
            ...(type === "keyDown" && key === "Enter"
              ? { text: "\r", unmodifiedText: "\r" }
              : {}),
          },
          browser.sessionId,
        );
    };
    await evaluate(browser, `document.activeElement?.blur()`);
    await press("a", "KeyA");
    await waitFor(
      browser,
      `!!document.querySelector('[aria-label="Arrow"]')`,
      "the canvas toolbar",
    );
    await clickAt(browser, await boxOf(browser, '[aria-label="Arrow"]'));
    for (const [kind, id] of Object.entries(drawingIds)) {
      const before = await countOf(browser, ".svelte-flow__edge");
      const source = await boxOf(
        browser,
        `[data-id="${id}"] .svelte-flow__handle.source`,
      );
      const target = await boxOf(
        browser,
        `[data-id="${textNodeId}"] .svelte-flow__handle.target`,
      );
      assert.ok(source, `the ${kind} drawing handle is laid out`);
      assert.ok(target, "the text node handle is laid out");
      await dragBetween(browser, source, target);
      await waitFor(
        browser,
        `document.querySelectorAll(".svelte-flow__edge").length === ${before + 1}`,
        `the ${kind} drawing to connect`,
      );
    }
    assert.equal(
      await countOf(browser, ".svelte-flow__edge"),
      3,
      "each drawing connected to the text node",
    );
    await waitFor(
      browser,
      `document.querySelector(".pill")?.textContent.includes("All changes saved")`,
      "the save indicator to settle",
    );

    // Select the seeded text note and edit it through the inspector. The
    // backend has an empty PATH (no Codex).
    await clickAt(browser, await boxOf(browser, `[data-id="${textNodeId}"]`));
    await waitFor(
      browser,
      `document.querySelector("#text-node")?.value === ${JSON.stringify(textNodeId)} && !!document.querySelector("#text-content")`,
      "the selected note in the inspector",
    );
    await evaluate(browser, `document.querySelector("#text-content").focus()`);
    await browser.send(
      "Input.insertText",
      { text: "Draft a release plan from these notes." },
      browser.sessionId,
    );
    await evaluate(browser, `document.querySelector("#node-x").focus()`);
    await press("a", "KeyA", 2);
    await browser.send("Input.insertText", { text: "180" }, browser.sessionId);
    await press("Tab", "Tab");
    await waitFor(
      browser,
      `document.querySelector(".pill")?.textContent.includes("All changes saved") && document.querySelector("#node-x")?.value === "180"`,
      "text content and placement to save",
    );
    assert.equal(
      await evaluate(
        browser,
        `document.querySelector("label[for='text-content']").textContent`,
      ),
      "Text content",
    );

    // Closing and reopening the canvas must bring the connections back.
    await clickAt(
      browser,
      await boxOf(browser, '[aria-label="Canvas gallery"]'),
    );
    await waitFor(
      browser,
      `[...document.querySelectorAll(".cards .card")].some((card) => card.textContent.includes("Handle canvas"))`,
      "the canvas picker",
    );
    await clickAt(
      browser,
      await boxByText(browser, ".cards .card", "Handle canvas"),
    );
    await waitFor(
      browser,
      `!!document.querySelector(".svelte-flow")`,
      "the reopened canvas",
    );
    await waitFor(
      browser,
      `document.querySelectorAll(".svelte-flow__edge").length === 3`,
      "the reopened connections to render",
    );
    assert.equal(
      await evaluate(browser, `!!document.querySelector(".inspector")`),
      false,
      "the inspector closes again when the canvas reopens",
    );
    await clickAt(
      browser,
      await boxOf(browser, '[aria-label="Toggle inspector"]'),
    );
    await waitFor(
      browser,
      `document.querySelector("#text-node")?.value === ${JSON.stringify(textNodeId)} && document.querySelector("#text-content")?.value === "Draft a release plan from these notes."`,
      "the selected note to reopen in the inspector",
    );
    assert.equal(
      await evaluate(browser, `document.querySelector("#node-x").value`),
      "180",
    );

    await evaluate(
      browser,
      `document.querySelector('[aria-label="Settings"]').click()`,
    );
    // Advanced lists every built-in agent with its detection result.
    await waitFor(
      browser,
      `["Codex", "Claude Code", "OpenCode"].every((label) => document.querySelector("[aria-labelledby='coding-agents-label']")?.textContent.includes(label))`,
      "the coding agents list",
    );
  } finally {
    editor.dispose();
    await browser?.close();
    await stopBackend(backend.child);
  }
});

test("Settings Tools lists built-in tools and manages MCP servers in the rendered app", async () => {
  const backend = await startBackend();
  key = backend.connectionKey;
  let browser;
  const rpc = async (method, params) => {
    const reply = await send(port, {
      body: JSON.stringify({
        protocolVersion: 1,
        id: crypto.randomUUID(),
        method,
        params,
      }),
    });
    const response = RuntimeResponseSchema.parse(JSON.parse(reply.text));
    assert.equal(response.error, undefined, JSON.stringify(response));
    return ResultSchemas[method].parse(response.result);
  };
  try {
    const { workspace } = await rpc("workspace.create", { name: "Tools UI" });
    const workspaceId = workspace.id;
    await rpc("canvas.create", { workspaceId, title: "Tools canvas" });
    browser = await launchBrowser();
    await browser.send(
      "Page.navigate",
      { url: `http://127.0.0.1:${port}/` },
      browser.sessionId,
    );
    await waitFor(
      browser,
      `!!document.querySelector('#connection-key')`,
      "the connection form",
    );
    await evaluate(
      browser,
      `(async () => { const input = document.querySelector('#connection-key'); input.value = ${JSON.stringify(key)}; input.dispatchEvent(new Event('input', {bubbles:true})); await new Promise(requestAnimationFrame); document.querySelector('.connbar button[type=submit]').click(); })()`,
    );
    await waitFor(
      browser,
      `!!document.querySelector('.connbar--ok')`,
      "connection",
    );
    const open = async (label) => {
      const expression = `[...document.querySelectorAll('.tiles .tile__open, .cards .card')].find(c => c.querySelector('.tile__name, strong')?.textContent === ${JSON.stringify(label)})`;
      await waitFor(
        browser,
        `${expression} && !(${expression}).disabled`,
        label,
      );
      await evaluate(
        browser,
        `(${expression}).focus(); (${expression}).scrollIntoView({block:'center'})`,
      );
      await clickAt(
        browser,
        await boxByText(browser, ".tiles .tile__open, .cards .card", label),
      );
    };
    await open("Tools UI");
    await open("Tools canvas");
    await waitFor(
      browser,
      `!!document.querySelector('.svelte-flow')`,
      "the canvas",
    );
    await evaluate(
      browser,
      `document.querySelector('[aria-label="Settings"]').click()`,
    );
    await waitFor(
      browser,
      `!!document.querySelector('.settings__tab')`,
      "settings",
    );
    await evaluate(
      browser,
      `[...document.querySelectorAll('.settings__tab')].find((tab) => tab.textContent.includes('Tools')).click()`,
    );
    await waitFor(
      browser,
      `document.body.innerText.includes('canvas_read') && document.body.innerText.includes('canvas_edit')`,
      "built-in tools",
    );
    const setValue = (selector, value) =>
      evaluate(
        browser,
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', {bubbles:true})); })()`,
      );
    await waitFor(
      browser,
      `[...document.querySelectorAll('button')].some((b) => b.textContent.includes('Add a tool server'))`,
      "the add button",
    );
    await evaluate(
      browser,
      `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Add a tool server')).click()`,
    );
    await waitFor(
      browser,
      `!!document.querySelector('.tools__form input')`,
      "the server form",
    );
    await setValue(".tools__form input:nth-of-type(1)", "fake");
    await evaluate(
      browser,
      `(() => { const [name, command] = document.querySelectorAll('.tools__form input'); for (const [el, value] of [[name, 'fake'], [command, ${JSON.stringify(process.execPath)}]]) { el.value = value; el.dispatchEvent(new Event('input', {bubbles:true})); } const [args, env] = document.querySelectorAll('.tools__form textarea'); args.value = ${JSON.stringify(fileURLToPath(new URL("./support/fake-mcp.mjs", import.meta.url)))}; args.dispatchEvent(new Event('input', {bubbles:true})); env.value = 'SECRET_TOKEN=do-not-show'; env.dispatchEvent(new Event('input', {bubbles:true})); document.querySelector('.tools__form button[type=submit]').click(); })()`,
    );
    await waitFor(
      browser,
      `!!document.querySelector('section[aria-label="fake"]')`,
      "the saved server",
    );
    const text = () => evaluate(browser, `document.body.innerText`);
    assert.ok((await text()).includes("Off"), "new servers start off");
    assert.ok((await text()).includes("SECRET_TOKEN"));
    assert.ok(!(await text()).includes("do-not-show"));
    assert.deepEqual((await rpc("mcp.tools.list", { workspaceId })).tools, []);

    await evaluate(
      browser,
      `document.querySelector('button[aria-label="fake on"]').click()`,
    );
    await waitFor(
      browser,
      `document.body.innerText.includes('Running') && document.body.innerText.includes('Echoes text.')`,
      "the running server and its tools",
    );
    await evaluate(
      browser,
      `document.querySelector('button[aria-label="echo on"]').click()`,
    );
    await waitFor(
      browser,
      `document.querySelector('button[aria-label="echo on"]')?.getAttribute('aria-checked') === 'true'`,
      "the enabled tool",
    );
    assert.deepEqual(
      (await rpc("mcp.tools.list", { workspaceId })).tools.map(
        (tool) => `${tool.server}__${tool.name}`,
      ),
      ["fake__echo"],
    );
    // Editing needs the server off.
    assert.equal(
      await evaluate(
        browser,
        `[...document.querySelectorAll('section[aria-label="fake"] button')].find((b) => b.textContent.trim() === 'Edit').disabled`,
      ),
      true,
    );
  } finally {
    await browser?.close();
    await stopBackend(backend.child);
  }
});

test("box selection groups, moves, ungroups, and deletes canvas objects", async () => {
  const backend = await startBackend();
  key = backend.connectionKey;
  let browser;
  const rpc = async (method, params) => {
    const reply = await send(port, {
      body: JSON.stringify({
        protocolVersion: 1,
        id: crypto.randomUUID(),
        method,
        params,
      }),
    });
    assert.equal(reply.status, 200);
    const response = RuntimeResponseSchema.parse(JSON.parse(reply.text));
    assert.equal(response.error, undefined, JSON.stringify(response));
    return ResultSchemas[method].parse(response.result);
  };
  try {
    const { workspace } = await rpc("workspace.create", {
      name: "Box selection",
    });
    const { canvas } = await rpc("canvas.create", {
      workspaceId: workspace.id,
      title: "Grouping canvas",
    });
    const reference = { workspaceId: workspace.id, canvasId: canvas.id };
    let revision = 1;
    const ids = [];
    for (const [x, y, text] of [
      [500, 250, "First"],
      [850, 250, "Second"],
      [500, 580, "Outside"],
    ]) {
      const created = await rpc("node.createText", {
        ...reference,
        expectedRevision: revision,
        x,
        y,
        width: 240,
        height: 160,
        text,
      });
      revision = created.revision;
      ids.push(created.node.id);
    }
    const [first, second, outside] = ids;
    const stored = async () =>
      new Map(
        (await rpc("canvas.open", reference)).nodes.map((node) => [
          node.id,
          node,
        ]),
      );
    const eventually = async (check, label) => {
      const deadline = Date.now() + 5000;
      for (;;) {
        const nodes = await stored();
        if (check(nodes)) return nodes;
        if (Date.now() > deadline)
          throw new Error(
            `Timed out waiting for ${label}: ${JSON.stringify([...nodes.values()])}`,
          );
        await delay(50);
      }
    };
    const press = async (key, code, keyCode, modifiers = 0) => {
      await evaluate(browser, `document.activeElement?.blur()`);
      for (const type of ["keyDown", "keyUp"])
        await browser.send(
          "Input.dispatchKeyEvent",
          { type, key, code, windowsVirtualKeyCode: keyCode, modifiers },
          browser.sessionId,
        );
    };

    browser = await launchBrowser();
    await browser.send(
      "Page.navigate",
      { url: `http://127.0.0.1:${port}/` },
      browser.sessionId,
    );
    await waitFor(
      browser,
      `!!document.querySelector('#connection-key')`,
      "the connection form",
    );
    await evaluate(
      browser,
      `(() => { const input = document.querySelector('#connection-key'); input.value = ${JSON.stringify(key)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
    await clickAt(
      browser,
      await boxOf(browser, ".connbar button[type='submit']"),
    );
    await waitFor(
      browser,
      `!!document.querySelector('.connbar--ok')`,
      "the connected status",
    );
    // Workspaces are tiles on the start screen; canvases are picker cards.
    const selectCard = async (label) => {
      const expression = `[...document.querySelectorAll('.tiles .tile__open, .cards .card')].find(c => c.querySelector('.tile__name, strong')?.textContent === ${JSON.stringify(label)})`;
      await waitFor(
        browser,
        `${expression} && !(${expression}).disabled`,
        label,
      );
      await evaluate(
        browser,
        `(${expression}).focus(); (${expression}).scrollIntoView({block:'center'})`,
      );
      await clickAt(
        browser,
        await boxByText(browser, ".tiles .tile__open, .cards .card", label),
      );
    };
    for (const label of ["Box selection", "Grouping canvas"])
      await selectCard(label);
    await waitFor(
      browser,
      `[...document.querySelectorAll('.svelte-flow__node')].filter((node) => node.classList.contains('draggable')).length === 3`,
      "three draggable notes",
    );
    const pane = await evaluate(
      browser,
      `(() => { const r = document.querySelector('.svelte-flow__pane').getBoundingClientRect(); return { left: r.left, top: r.top }; })()`,
    );
    const at = (x, y) => ({ x: pane.left + x, y: pane.top + y });
    const selected = `[...document.querySelectorAll('.svelte-flow__node.selected')].map((node) => node.dataset.id).sort().join(',')`;
    const pair = [first, second].sort().join(",");

    // Dragging over empty canvas selects only objects fully inside the box.
    await dragBetween(browser, at(450, 200), at(1150, 470));
    await waitFor(
      browser,
      `${selected} === ${JSON.stringify(pair)}`,
      "the boxed pair",
    );
    assert.match(
      await evaluate(
        browser,
        `document.querySelector('.selection-bar')?.textContent`,
      ),
      /2 objects selected/,
    );

    await press("g", "KeyG", 71, 2);
    await waitFor(
      browser,
      `document.querySelectorAll('.node-group').length === 1`,
      "the group outline",
    );
    const grouped = await eventually(
      (nodes) =>
        nodes.get(first).groupId &&
        nodes.get(first).groupId === nodes.get(second).groupId,
      "the saved group",
    );
    assert.equal(grouped.get(outside).groupId, undefined);

    // Clicking empty canvas clears the selection; dragging one member moves both.
    await clickAt(browser, at(450, 200));
    await waitFor(browser, `${selected} === ''`, "a cleared selection");
    const start = await boxOf(
      browser,
      `.svelte-flow__node[data-id="${first}"]`,
    );
    await dragBetween(browser, start, { x: start.x + 120, y: start.y + 60 });
    const moved = await eventually(
      (nodes) => nodes.get(first).x !== 500,
      "the dragged group to save",
    );
    const dx = moved.get(first).x - 500;
    const dy = moved.get(first).y - 250;
    assert.ok(dx > 50 && dy > 20, JSON.stringify({ dx, dy }));
    assert.deepEqual(
      [moved.get(second).x, moved.get(second).y],
      [850 + dx, 250 + dy],
      "the other member followed",
    );
    assert.deepEqual([moved.get(outside).x, moved.get(outside).y], [500, 580]);
    await waitFor(
      browser,
      `${selected} === ${JSON.stringify(pair)}`,
      "the whole group selected",
    );

    await press("G", "KeyG", 71, 2 | 8);
    await waitFor(
      browser,
      `!document.querySelector('.node-group')`,
      "the group to dissolve",
    );
    await eventually(
      (nodes) => !nodes.get(first).groupId && !nodes.get(second).groupId,
      "the saved ungroup",
    );

    // A key pressed on a focused button never deletes the selection.
    await evaluate(
      browser,
      `document.querySelector('.canvas-dock button:not([disabled])').focus()`,
    );
    await press("Backspace", "Backspace", 8);
    await delay(200);
    assert.equal(
      await evaluate(browser, `!!document.querySelector('dialog[open]')`),
      false,
      "Backspace on a button opened the delete confirmation",
    );
    assert.equal((await stored()).size, 3);
    await evaluate(browser, `document.activeElement?.blur()`);

    // Delete removes the selection after confirmation.
    await press("Delete", "Delete", 46);
    await waitFor(
      browser,
      `!!document.querySelector('dialog[open]') && document.querySelector('dialog[open]').textContent.includes('Delete 2 objects?')`,
      "the delete confirmation",
    );
    // Let the dialog finish its entrance transition before clicking.
    await delay(400);
    await clickAt(
      browser,
      await boxByText(browser, "dialog[open] button", "Delete 2"),
    );
    await waitFor(
      browser,
      `document.querySelectorAll('.svelte-flow__node').length === 1`,
      "the deleted pair",
    );
    const remaining = await stored();
    assert.deepEqual([...remaining.keys()], [outside]);
  } catch (error) {
    if (browser)
      error.message += `\nRendered state: ${await evaluate(browser, "JSON.stringify({text:document.body.innerText.slice(-800),selected:[...document.querySelectorAll('.svelte-flow__node.selected')].length})")}`;
    throw error;
  } finally {
    await browser?.close();
    await stopBackend(backend.child);
  }
});

test("canvas conversation previews, keyboard edits, review and cancellation work in the rendered app", async () => {
  const backend = await startBackend();
  key = backend.connectionKey;
  let browser;
  let customServer;
  const rpc = async (method, params) => {
    const reply = await send(port, {
      body: JSON.stringify({
        protocolVersion: 1,
        id: crypto.randomUUID(),
        method,
        params,
      }),
    });
    const response = RuntimeResponseSchema.parse(JSON.parse(reply.text));
    assert.equal(response.error, undefined, JSON.stringify(response));
    return ResultSchemas[method].parse(response.result);
  };
  try {
    const workspace = await rpc("workspace.create", {
      name: "Canvas conversation UI",
    });
    const workspaceId = workspace.workspace.id;
    const { canvas } = await rpc("canvas.create", {
      workspaceId,
      title: "Conversation UI",
    });
    const ref = { workspaceId, canvasId: canvas.id };
    browser = await launchBrowser();
    await browser.send(
      "Page.addScriptToEvaluateOnNewDocument",
      {
        source: `
      localStorage.setItem('agentica.openrouterApiKey', 'test-only');
      localStorage.setItem('agentica.openrouterModel', 'openrouter/free');
      window.__providerRequests = [];
      window.__runtimeRequests = [];
      const realFetch = window.fetch.bind(window);
      window.fetch = async (url, options) => {
        if (!String(url).startsWith('https://openrouter.ai/')) {
          const method = options?.body ? JSON.parse(options.body).method : undefined;
          if (method) window.__runtimeRequests.push(method);
          if (method === 'canvas.open' && window.__failOpen) {
            window.__failOpen -= 1;
            throw new TypeError('Canvas reload lost');
          }
          const response = await realFetch(url, options);
          if (method === 'conversation.finish' && window.__loseFinish) {
            window.__loseFinish = false;
            window.__failOpen = 1;
            throw new TypeError('Finish acknowledgement lost');
          }
          return response;
        }
        const body = JSON.parse(options.body);
        window.__providerRequests.push(body);
        if (window.__slow) return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), {once: true});
        });
        if (body.messages.at(-1).role === 'user') {
          const content = body.messages.at(-1).content;
          const input = JSON.parse(content.slice(content.indexOf('<canvas-data>') + 14, content.lastIndexOf('</canvas-data>')));
          const operation = content.slice(0, content.indexOf('<canvas-data>')).includes('Change')
            ? {op:'updateText',nodeId:input.writeScope.nodes[0].id,text:'Proposed replacement'}
            : {op:'createShape',kind:'rectangle',color:'#123456',label:'Idea',...input.proposalAnchor,width:200,height:100};
          return new Response(JSON.stringify({choices:[{message:{content:null,tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name:'canvas_edit',arguments:JSON.stringify(operation)}}]}}]}), {headers:{'Content-Type':'application/json'}});
        }
        return new Response(JSON.stringify({choices:[{message:{content:'A diagram you can edit.'},finish_reason:'stop'}]}), {headers:{'Content-Type':'application/json'}});
      };
    `,
      },
      browser.sessionId,
    );
    await browser.send(
      "Page.navigate",
      { url: `http://127.0.0.1:${port}/` },
      browser.sessionId,
    );
    await waitFor(
      browser,
      `!!document.querySelector('#connection-key')`,
      "the connection form",
    );
    await evaluate(
      browser,
      `(async () => { const input = document.querySelector('#connection-key'); input.value = ${JSON.stringify(key)}; input.dispatchEvent(new Event('input', {bubbles:true})); await new Promise(requestAnimationFrame); document.querySelector('.connbar button[type=submit]').click(); })()`,
    );
    await waitFor(
      browser,
      `!!document.querySelector('.connbar--ok')`,
      "connection",
    );
    // Workspaces are tiles on the start screen; canvases are picker cards.
    const selectCard = async (label) => {
      const expression = `[...document.querySelectorAll('.tiles .tile__open, .cards .card')].find(c => c.querySelector('.tile__name, strong')?.textContent === ${JSON.stringify(label)})`;
      await waitFor(
        browser,
        `${expression} && !(${expression}).disabled`,
        label,
      );
      await evaluate(
        browser,
        `(${expression}).focus(); (${expression}).scrollIntoView({block:'center'})`,
      );
      await clickAt(
        browser,
        await boxByText(browser, ".tiles .tile__open, .cards .card", label),
      );
    };
    for (const label of ["Canvas conversation UI", "Conversation UI"])
      await selectCard(label);
    await waitFor(
      browser,
      `!!document.querySelector('#canvas-prompt') && !document.querySelector('dialog[open]')`,
      "the composer",
    );
    const submit = async (prompt) => {
      await evaluate(
        browser,
        `(async () => { const input = document.querySelector('#canvas-prompt'); input.value = ${JSON.stringify(prompt)}; input.dispatchEvent(new Event('input', {bubbles:true})); await new Promise(requestAnimationFrame); document.querySelector('.composer__send').click(); })()`,
      );
    };
    await submit("Draw an idea");
    await waitFor(
      browser,
      `document.querySelectorAll('.drawing.preview').length === 1 && !!document.querySelector('.review-bar')`,
      "the diagram preview and review controls",
    );
    assert.equal(
      await countOf(browser, ".svelte-flow__node-default"),
      0,
      "text is rendered directly, without default node cards",
    );
    const before = await rpc("canvas.open", ref);
    assert.equal(
      before.nodes.length,
      2,
      "only prompt and reply are saved before approval",
    );
    assert.deepEqual(
      before.artifacts.map((a) => a.text),
      ["Draw an idea", "A diagram you can edit."],
    );
    assert.equal(
      await evaluate(browser, `window.__providerRequests.length`),
      2,
    );

    const reopen = async () => {
      await clickAt(
        browser,
        await boxOf(browser, '[aria-label="Canvas gallery"]'),
      );
      await waitFor(
        browser,
        `[...document.querySelectorAll('.cards .card')].some(c => c.textContent.includes('Conversation UI'))`,
        "the canvas gallery",
      );
      await selectCard("Conversation UI");
      await waitFor(
        browser,
        `!!document.querySelector('.svelte-flow') && !document.querySelector('dialog[open]')`,
        "the reopened canvas",
      );
    };
    await reopen();
    await waitFor(
      browser,
      `document.querySelectorAll('.drawing.preview').length === 1`,
      "the restored pending proposal",
    );
    const review = async (action) => {
      const expression = `[...document.querySelectorAll('.review-bar button')].find(b => b.textContent.trim() === ${JSON.stringify(action)})`;
      await waitFor(
        browser,
        `${expression} && !(${expression}).disabled`,
        `the enabled ${action} control`,
      );
      await evaluate(browser, `(${expression}).focus()`);
      assert.equal(
        await evaluate(browser, `document.activeElement?.textContent.trim()`),
        action,
        "the review button keeps keyboard focus",
      );
      for (const type of ["keyDown", "keyUp"])
        await browser.send(
          "Input.dispatchKeyEvent",
          {
            type,
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13,
            ...(type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}),
          },
          browser.sessionId,
        );
    };
    await review("Apply");
    await waitFor(
      browser,
      `document.querySelectorAll('.preview').length === 0 && document.querySelectorAll('.drawing').length === 1`,
      "the applied shape",
    );
    const applied = await rpc("canvas.open", ref);
    assert.equal(applied.nodes.length, 3);
    assert.equal(applied.artifacts.at(-1).drawing.shapes[0].label, "Idea");
    assert.equal(
      await evaluate(
        browser,
        `document.body.innerText.includes('The proposal preview is stale')`,
      ),
      false,
      "successful approval must not leave a stale-preview warning",
    );
    const replyNode = applied.nodes[1];
    assert.ok(replyNode.height <= 220, "new reply cards stay bounded");
    await waitFor(
      browser,
      `document.querySelector('[data-id="${replyNode.id}"] .card-head')?.textContent.includes('Changes applied')`,
      "the applied status in the reply header",
    );
    assert.match(
      await evaluate(
        browser,
        `document.querySelector('[data-id="${replyNode.id}"] .card-body').textContent`,
      ),
      /A diagram you can edit\./,
      "status presentation leaves reply prose unchanged",
    );
    const readButton = `[data-id="${replyNode.id}"] .card-action`;
    await evaluate(
      browser,
      `(() => { const b = document.querySelector(${JSON.stringify(readButton)}); b.focus(); b.click(); })()`,
    );
    await waitFor(
      browser,
      `document.querySelector('dialog[open] .reader__content')?.textContent.includes('A diagram you can edit.')`,
      "the full-content reader",
    );
    for (const type of ["keyDown", "keyUp"])
      await browser.send(
        "Input.dispatchKeyEvent",
        { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
        browser.sessionId,
      );
    await waitFor(
      browser,
      `!document.querySelector('dialog[open]') && document.activeElement === document.querySelector(${JSON.stringify(readButton)})`,
      "the closed reader restoring focus",
    );
    const selector = `[data-id="${replyNode.id}"] .card-body`;
    await evaluate(
      browser,
      `document.querySelector(${JSON.stringify(selector)}).focus()`,
    );
    await browser.send(
      "Input.dispatchKeyEvent",
      {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
      },
      browser.sessionId,
    );
    await waitFor(
      browser,
      `document.activeElement === document.querySelector('textarea.card-body') && !!document.activeElement`,
      "keyboard inline editing",
    );
    await evaluate(
      browser,
      `(() => { const input = document.querySelector('textarea.card-body'); input.value = 'Human revision'; input.dispatchEvent(new Event('input', {bubbles:true})); input.blur(); })()`,
    );
    await waitFor(
      browser,
      `document.body.textContent.includes('All changes saved')`,
      "the manual text save",
    );
    const edited = await rpc("canvas.open", ref);
    assert.equal(
      edited.artifacts.find((a) => a.id === replyNode.artifactId).text,
      "Human revision",
    );
    await clickAt(browser, await boxOf(browser, selector));
    await waitFor(
      browser,
      `document.querySelector('.composer__scope').textContent.includes('1 selected object')`,
      "selected-object context",
    );
    await submit("Change this text");
    await waitFor(
      browser,
      `document.querySelectorAll('.canvas-text.preview').length === 1 && !!document.querySelector('.review-bar')`,
      "a targeted text preview",
    );
    assert.equal(
      (await rpc("canvas.open", ref)).artifacts.find(
        (a) => a.id === replyNode.artifactId,
      ).text,
      "Human revision",
    );
    await review("Discard");
    await waitFor(
      browser,
      `document.querySelectorAll('.preview').length === 0 && !document.querySelector('#canvas-prompt').disabled`,
      "discarded proposal",
    );
    const discarded = await rpc("canvas.open", ref);
    assert.equal(
      discarded.artifacts.find((a) => a.id === replyNode.artifactId).text,
      "Human revision",
    );
    await evaluate(browser, `window.__slow = true`);
    await submit("Wait for cancellation");
    await waitFor(
      browser,
      `window.__providerRequests.some(r => r.messages.at(-1).role === 'user' && r.messages.at(-1).content.includes('Wait for cancellation'))`,
      "the in-flight provider request",
    );
    await evaluate(
      browser,
      `document.querySelector(${JSON.stringify(selector)}).focus()`,
    );
    await browser.send(
      "Input.dispatchKeyEvent",
      {
        type: "keyDown",
        key: "Enter",
        code: "Enter",
        windowsVirtualKeyCode: 13,
      },
      browser.sessionId,
    );
    await waitFor(
      browser,
      `document.activeElement === document.querySelector('textarea.card-body') && !!document.activeElement`,
      "editing during generation",
    );
    await evaluate(
      browser,
      `(() => { const input = document.querySelector('textarea.card-body'); input.value = 'Human edit while generating'; input.dispatchEvent(new Event('input', {bubbles:true})); input.blur(); })()`,
    );
    await evaluate(
      browser,
      `[...document.querySelectorAll('.composer button')].find(b => b.textContent === 'Cancel').click()`,
    );
    await waitFor(
      browser,
      `!document.querySelector('#canvas-prompt').disabled`,
      "cancelled generation",
    );
    const turns = await rpc("conversation.list", { ...ref, before: 0 });
    assert.equal(turns.turns[0].status, "cancelled");
    assert.equal(turns.turns[1].status, "discarded");
    assert.equal(turns.turns[2].status, "applied");
    assert.equal(
      (await rpc("canvas.open", ref)).artifacts.find(
        (a) => a.id === replyNode.artifactId,
      ).text,
      "Human edit while generating",
    );
    await evaluate(browser, `window.__slow = false`);
    for (const action of ["Apply", "Discard"]) {
      await submit(
        `Draw an idea before deleting the reply and choosing ${action}`,
      );
      await waitFor(
        browser,
        `document.querySelectorAll('.drawing.preview').length === 1 && !!document.querySelector('.review-bar')`,
        `the pending proposal for ${action}`,
      );
      const {
        turns: [pending],
      } = await rpc("conversation.list", {
        ...ref,
        before: 0,
      });
      const deletedIds =
        action === "Apply"
          ? [pending.replyNodeId]
          : [pending.replyNodeId, pending.promptNodeId];
      for (const nodeId of deletedIds) {
        const document = await rpc("canvas.open", ref);
        const index = document.nodes.findIndex((node) => node.id === nodeId);
        assert.notEqual(index, -1);
        const deletion = `.drawer__row:nth-child(${index + 1}) .drawer__delete`;
        await waitFor(
          browser,
          `document.querySelector(${JSON.stringify(deletion)})?.disabled === false`,
          "the enabled node delete button",
        );
        await evaluate(
          browser,
          `document.querySelector(${JSON.stringify(deletion)}).click()`,
        );
        await waitFor(
          browser,
          `!document.querySelector('[data-id="${nodeId}"]')`,
          "the deleted conversation node",
        );
      }
      await waitFor(
        browser,
        `!!document.querySelector('.review-bar')`,
        "proposal controls after deleting the reply",
      );
      await reopen();
      await waitFor(
        browser,
        `!!document.querySelector('.review-bar') && document.querySelector('#canvas-prompt').disabled`,
        "proposal controls restored without the conversation nodes",
      );
      assert.equal(
        (await rpc("conversation.list", { ...ref, before: 0 })).turns[0].status,
        "pending",
      );
      await review(action);
      await waitFor(
        browser,
        `document.querySelectorAll('.preview').length === 0 && !document.querySelector('#canvas-prompt').disabled && !document.querySelector('.review-bar')`,
        `${action} clears the proposal and restores the composer`,
      );
      assert.equal(
        (await rpc("conversation.list", { ...ref, before: 0 })).turns[0].status,
        action === "Apply" ? "applied" : "discarded",
      );
      assert.equal(
        (await rpc("canvas.open", ref)).nodes.some(
          (node) => node.id === pending.operations[0].nodeId,
        ),
        action === "Apply",
      );
    }
    // The runtime saves the proposal, but its acknowledgement and the follow-up
    // reload are lost, so the reply stays buffered until it is reconciled.
    await evaluate(browser, `window.__loseFinish = true`);
    await submit("Draw an idea whose save acknowledgement is lost");
    const textOnly = `[...document.querySelectorAll('.conversation-recovery button')].find(b => b.textContent.trim() === 'Save text only')`;
    await waitFor(
      browser,
      `!!(${textOnly}) && document.querySelector('#canvas-prompt').disabled`,
      "the buffered reply after a lost acknowledgement",
    );
    const {
      turns: [saved],
    } = await rpc("conversation.list", { ...ref, before: 0 });
    assert.equal(saved.status, "pending");
    assert.equal(saved.operations.length, 1);
    await evaluate(browser, `(${textOnly}).click()`);
    await waitFor(
      browser,
      `!document.body.innerText.includes('Response waiting to save') && document.querySelectorAll('.drawing.preview').length === 1 && !!document.querySelector('.review-bar')`,
      "the saved proposal adopted for review",
    );
    assert.deepEqual(
      (await rpc("conversation.list", { ...ref, before: 0 })).turns[0],
      saved,
      "reconciliation leaves the saved proposal unchanged",
    );
    await review("Discard");
    await waitFor(
      browser,
      `document.querySelectorAll('.preview').length === 0 && !document.querySelector('#canvas-prompt').disabled && !document.querySelector('.conversation-recovery')`,
      "the composer after discarding the recovered proposal",
    );
    assert.equal(
      (await rpc("conversation.list", { ...ref, before: 0 })).turns[0].status,
      "discarded",
    );
    await reopen();
    const customRequests = [];
    customServer = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "authorization, content-type",
      );
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      if (req.method === "OPTIONS") {
        res.writeHead(204).end();
        return;
      }
      let body = "";
      for await (const chunk of req) body += chunk;
      customRequests.push({
        path: req.url,
        headers: req.headers,
        body: JSON.parse(body),
      });
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "Reply from custom provider." } }],
        }),
      );
    });
    customServer.listen(0, "127.0.0.1");
    await once(customServer, "listening");
    const customBaseUrl = `http://127.0.0.1:${customServer.address().port}/v1/`;
    await evaluate(
      browser,
      `window.__canvasRoot = document.querySelector('.svelte-flow'); document.querySelector('[aria-label="Settings"]').click()`,
    );
    await waitFor(
      browser,
      `!!document.querySelector('#ai-provider')`,
      "provider settings",
    );
    await evaluate(
      browser,
      `[...document.querySelectorAll('.settings__tab')].find((tab) => tab.textContent.includes('Advanced')).click()`,
    );
    await waitFor(
      browser,
      `!!document.querySelector('#ai-provider')?.checkVisibility()`,
      "advanced settings",
    );
    await evaluate(
      browser,
      `(async () => {
      const provider = document.querySelector('#ai-provider');
      provider.value = 'custom'; provider.dispatchEvent(new Event('change', {bubbles:true}));
      await new Promise(requestAnimationFrame);
      for (const [selector, value] of [['#provider-base-url', ${JSON.stringify(customBaseUrl)}], ['#openrouter-api-key', 'custom-test-only'], ['#openrouter-model', 'local-model']]) {
        const input = document.querySelector(selector); input.value = value; input.dispatchEvent(new Event('input', {bubbles:true}));
      }
      document.querySelector('#provider-tools').click();
      document.querySelector('[aria-label="Back, close settings"]').click();
    })()`,
    );
    await waitFor(
      browser,
      `!document.querySelector('dialog[open]')`,
      "closed provider settings",
    );
    assert.equal(
      await evaluate(
        browser,
        `!!window.__canvasRoot && document.querySelector('.svelte-flow') === window.__canvasRoot`,
      ),
      true,
      "the canvas stays mounted under the settings page",
    );
    await submit("Use the custom endpoint");
    await waitFor(
      browser,
      `document.body.innerText.includes('Reply from custom provider.') && !document.querySelector('#canvas-prompt').disabled`,
      "custom provider reply through browser CORS and CSP",
    );
    assert.equal(customRequests.length, 1);
    assert.equal(customRequests[0].path, "/v1/chat/completions");
    assert.equal(
      customRequests[0].headers.authorization,
      "Bearer custom-test-only",
    );
    assert.equal(customRequests[0].headers["http-referer"], undefined);
    assert.equal(customRequests[0].body.model, "local-model");
    assert.equal(customRequests[0].body.tools, undefined);
    assert.equal(customRequests[0].body.provider, undefined);
    await evaluate(
      browser,
      `document.querySelector('[aria-label="Settings"]').click()`,
    );
    await waitFor(
      browser,
      `document.querySelector('#ai-provider')?.value === 'custom'`,
      "persisted custom selection",
    );
    assert.equal(
      await evaluate(
        browser,
        `document.querySelector('#provider-base-url').value`,
      ),
      customBaseUrl,
    );
    await evaluate(
      browser,
      `(() => { const provider = document.querySelector('#ai-provider'); provider.value = 'openrouter'; provider.dispatchEvent(new Event('change', {bubbles:true})); })()`,
    );
    await waitFor(
      browser,
      `document.querySelector('#openrouter-api-key')?.value === 'test-only'`,
      "preserved OpenRouter credentials",
    );
  } catch (error) {
    if (browser)
      error.message += `\nRendered state: ${await evaluate(browser, "JSON.stringify({text:document.body.innerText.slice(-2000),focus:document.activeElement?.tagName,review:document.querySelector('.review-bar')?.outerHTML,requests:window.__runtimeRequests})")}`;
    throw error;
  } finally {
    await browser?.close();
    if (customServer)
      await new Promise((resolve) => customServer.close(resolve));
    await stopBackend(backend.child);
  }
});

test("review feedback survives browser reload and backend restart with original anchors", async () => {
  const repo = mkdtempSync(join(tmpdir(), "agentica-review-"));
  const git = (...args) =>
    assert.equal(spawnSync("git", args, { cwd: repo }).status, 0, args[0]);
  writeFileSync(join(repo, "a.txt"), "one\ntwo\nthree\n");
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
  writeFileSync(join(repo, "a.txt"), "one\nTWO\nthree\n");
  // Changes needs Git on the backend PATH.
  const gitPath = spawnSync("sh", ["-c", "command -v git"]).stdout.toString();
  const gitEnv = { ...env, PATH: dirname(gitPath.trim()) };
  let backend = await startBackend(gitEnv);
  key = backend.connectionKey;
  let browser;
  const call = async (_key, _connect, method, params) => {
    const reply = await send(port, {
      body: JSON.stringify(
        RuntimeRequestSchema.parse({
          protocolVersion: 1,
          id: crypto.randomUUID(),
          method,
          params,
        }),
      ),
      timeout: 15000,
    });
    const response = RuntimeResponseSchema.parse(JSON.parse(reply.text));
    if (response.error)
      throw new Error(`${response.error.code}: ${response.error.message}`);
    return ResultSchemas[method].parse(response.result);
  };
  const editor = new Editor(
    call,
    () => key,
    () => {},
  );
  const tile = ".changes--tile";
  const saved = (root) =>
    `!!document.querySelector('${root} .notices [role=status]')?.textContent.includes('Feedback: Saved') && !!document.querySelector('.pill')?.textContent.includes('All changes saved')`;
  const run = (script) => evaluate(browser, script);
  const click = (selector) =>
    run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const type = (selector, text) =>
    run(`(() => {
      const field = document.querySelector(${JSON.stringify(selector)});
      field.value = ${JSON.stringify(text)};
      field.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
  const drafts = (root) =>
    run(
      `JSON.stringify([...document.querySelectorAll('${root} .draft')].map((d) => [d.querySelector('p'), ...d.querySelectorAll('.badge')].map((e) => e.textContent.trim()).join(' ')))`,
    ).then(JSON.parse);
  const openApp = async () => {
    await browser.send(
      "Page.navigate",
      { url: `http://127.0.0.1:${port}/` },
      browser.sessionId,
    );
    await waitFor(
      browser,
      `!!document.querySelector("#connection-key")`,
      "the connection form",
    );
    await run(`(() => {
      const input = document.querySelector("#connection-key");
      input.value = ${JSON.stringify(key)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await clickAt(
      browser,
      await boxOf(browser, ".connbar button[type='submit']"),
    );
    await waitFor(
      browser,
      `!!document.querySelector(".connbar--ok")`,
      "the connected status",
    );
    for (const label of ["Review restore", "Review canvas"]) {
      const item = ".tiles .tile__open, .cards .card";
      await waitFor(
        browser,
        `[...document.querySelectorAll(${JSON.stringify(item)})].some((card) => card.textContent.includes(${JSON.stringify(label)}))`,
        `the ${label} card`,
      );
      await clickAt(browser, await boxByText(browser, item, label));
    }
    await waitFor(
      browser,
      `!!document.querySelector('[aria-label="Show Changes"]')`,
      "the project's Changes control",
    );
    await click('[aria-label="Show Changes"]');
    await waitFor(
      browser,
      `${saved(tile)} && !!document.querySelector('${tile} .hunk')`,
      "the review to load",
    );
  };
  try {
    await editor.createWorkspace("Review restore");
    const workspaceId = editor.state.workspace.workspace.id;
    await editor.createCanvas("Review canvas");
    const canvasId = editor.state.document.canvas.id;
    await editor.openProject(repo);
    const projectId = editor.state.document.projectGroups.at(-1).id;
    await editor.addSessionTile(projectId, "changes");
    const tileId = editor.state.document.sessionTiles.at(-1).id;
    assert.equal(editor.state.error, "");
    await editor.closeWorkspace();

    browser = await launchBrowser();
    await openApp();
    const composer = `#comment-tile-${tileId}`;
    const add = `${tile} .composer .btn--primary`;
    await click(`${tile} .hunk-head button`);
    await type(composer, "Hunk note");
    await click(add);
    await click(`${tile} .file-bar button`);
    await type(composer, "File note");
    await click(add);
    await click(`${tile} .file-bar button`);
    await type(composer, "  unfinished\n ");
    await waitFor(
      browser,
      `${saved(tile)} && document.querySelectorAll('${tile} .draft').length === 2`,
      "comments and composer text to save",
    );

    // Browser reload restores from storage, not page memory.
    await openApp();
    assert.deepEqual((await drafts(tile)).sort(), ["File note", "Hunk note"]);
    assert.equal(
      await run(`document.querySelector('${composer}').value`),
      "  unfinished\n ",
    );

    // Restart with a changed hunk; Sent stands in for a Codex paste.
    await stopBackend(backend.child);
    writeFileSync(join(repo, "a.txt"), "one\nTwo\nthree\n");
    backend = await startBackend(gitEnv);
    key = backend.connectionKey;
    await editor.openWorkspace(workspaceId);
    const scope = { workspaceId, canvasId, projectId, tileId };
    const records = [];
    let page = await call(0, 0, "changes.review.load", scope);
    const revision = page.revision;
    while (page.record) {
      records.push(page.record);
      if (!page.next) break;
      page = await call(0, 0, "changes.review.load", {
        ...scope,
        after: page.next,
        expectedRevision: revision,
      });
    }
    assert.equal(records.length, 3);
    const hunkRecord = records.find((r) => r.comment === "Hunk note");
    assert.match(hunkRecord.hunk.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(hunkRecord.hunk.range, "@@ -1,3 +1,3 @@");
    await call(0, 0, "changes.review.save", {
      ...scope,
      expectedRevision: revision,
      record: { ...records.find((r) => r.comment === "File note"), sent: true },
    });
    await editor.closeWorkspace();

    await openApp();
    await waitFor(
      browser,
      `[...document.querySelectorAll('${tile} .draft')].some((d) => d.textContent.includes('Hunk note') && d.textContent.includes('Outdated'))`,
      "the changed hunk comment to be Outdated",
    );
    assert.deepEqual((await drafts(tile)).sort(), [
      "File note Sent",
      "Hunk note Outdated",
    ]);
    assert.equal(
      await run(`document.querySelector('${composer}').value`),
      "  unfinished\n ",
    );
    await click(`${tile} .foot .btn--primary`);
    const preview = await run(
      `document.querySelector('${tile} .preview pre').textContent`,
    );
    assert.match(
      preview,
      /\[Outdated anchor\]\n {3}@@ -1,3 \+1,3 @@\n {3}Hunk note/,
    );
    assert.doesNotMatch(preview, /File note|unfinished/);

    // The expanded layout shares the same restored state and announcement.
    await click(`#changes-expand-${tileId}`);
    await waitFor(
      browser,
      `${saved(".changes--overlay")} && document.querySelector('#comment-overlay-${tileId}')?.value === '  unfinished\\n '`,
      "the expanded review",
    );
    assert.deepEqual((await drafts(".changes--overlay .panel")).sort(), [
      "File note Sent",
      "Hunk note Outdated",
    ]);
  } catch (error) {
    if (browser)
      error.message += `\nRendered state: ${await evaluate(browser, "document.querySelector('.changes')?.innerText ?? document.body.innerText.slice(-2000)")}`;
    throw error;
  } finally {
    editor.dispose();
    await browser?.close();
    await stopBackend(backend.child);
    rmSync(repo, { recursive: true, force: true });
  }
});

test("tasks send to a running Codex tile, refuse a pending notification, and survive restart and tile removal", async () => {
  const root = mkdtempSync(join(tmpdir(), "agentica-tasks-"));
  const project = join(root, "project");
  const bin = join(root, "bin");
  const received = join(root, "received");
  const trigger = join(root, "notify");
  for (const directory of [project, bin]) mkdirSync(directory);
  // Stand-in for Codex: records raw PTY input and emits an OSC 9 notification
  // once the test creates the trigger file. No real agent runs.
  writeFileSync(
    join(bin, "codex"),
    String.raw`#!/bin/sh
PATH=/usr/bin:/bin
stty raw -echo
cat > '${received}' <&0 &
printf 'fake codex ready\r\n'
while [ ! -e '${trigger}' ]; do sleep 0.05; done
printf '\033]9;Approval requested\007'
wait
`,
  );
  chmodSync(join(bin, "codex"), 0o755);
  const codexEnv = { ...env, PATH: bin };
  let backend = await startBackend(codexEnv);
  key = backend.connectionKey;
  let browser;
  const call = async (_key, _connect, method, params) => {
    const reply = await send(port, {
      body: JSON.stringify(
        RuntimeRequestSchema.parse({
          protocolVersion: 1,
          id: crypto.randomUUID(),
          method,
          params,
        }),
      ),
      timeout: 15000,
    });
    const response = RuntimeResponseSchema.parse(JSON.parse(reply.text));
    if (response.error)
      throw new Error(`${response.error.code}: ${response.error.message}`);
    return ResultSchemas[method].parse(response.result);
  };
  const editor = new Editor(
    call,
    () => key,
    () => {},
  );
  const run = (script) => evaluate(browser, script);
  const openApp = async () => {
    await browser.send(
      "Page.navigate",
      { url: `http://127.0.0.1:${port}/` },
      browser.sessionId,
    );
    await waitFor(
      browser,
      `!!document.querySelector("#connection-key")`,
      "the connection form",
    );
    await run(`(() => {
      const input = document.querySelector("#connection-key");
      input.value = ${JSON.stringify(key)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await clickAt(
      browser,
      await boxOf(browser, ".connbar button[type='submit']"),
    );
    await waitFor(
      browser,
      `!!document.querySelector(".connbar--ok")`,
      "the connected status",
    );
    for (const label of ["Task dispatch", "Task canvas"]) {
      const item = ".tiles .tile__open, .cards .card";
      await waitFor(
        browser,
        `[...document.querySelectorAll(${JSON.stringify(item)})].some((card) => card.textContent.includes(${JSON.stringify(label)}))`,
        `the ${label} card`,
      );
      await clickAt(browser, await boxByText(browser, item, label));
    }
  };
  const text = "Fix the flaky http test";
  const pasted = `\x1b[200~${text}\x1b[201~`;
  const receivedText = () =>
    existsSync(received) ? readFileSync(received, "latin1") : "";
  try {
    await editor.createWorkspace("Task dispatch");
    const workspaceId = editor.state.workspace.workspace.id;
    await editor.createCanvas("Task canvas");
    const canvasId = editor.state.document.canvas.id;
    await editor.openProject(project);
    const projectId = editor.state.document.projectGroups.at(-1).id;
    await editor.addSessionTile(projectId, "cli-agent", "codex");
    const tileId = editor.state.document.sessionTiles.at(-1).id;
    const nodeId = (await editor.addText({ x: -400, y: 0 }, text)).node.id;
    await editor.setTask(nodeId, true);
    assert.equal(editor.state.error, "");
    await editor.closeWorkspace();

    const node = `[data-id="${nodeId}"]`;
    const tile = `[data-id="${tileId}"]`;
    const sendButton = `${node} .task-send`;
    const status = `(document.querySelector('${node} .task-status')?.textContent ?? '')`;
    browser = await launchBrowser();
    await openApp();
    await waitFor(
      browser,
      `!!document.querySelector('${node} .task-bar')`,
      "the task controls",
    );

    // Assigning draws a wire but never starts the tile.
    await run(`(() => {
      const select = document.querySelector('${node} .task-assignee');
      select.value = ${JSON.stringify(tileId)};
      select.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await waitFor(
      browser,
      `!!document.querySelector('.task-wire') && ${status}.includes('not running')`,
      "the assignment wire and not-running blocker",
    );
    assert.equal(
      await run(`document.querySelector('${sendButton}').disabled`),
      true,
    );

    await run(
      `document.querySelector('[data-id="${projectId}"] [aria-label="Expand project"]').click()`,
    );
    await waitFor(
      browser,
      `[...document.querySelectorAll('${tile} .session-controls button')].some((b) => b.textContent.trim() === 'Start')`,
      "the stopped Codex tile",
    );
    await run(
      `[...document.querySelectorAll('${tile} .session-controls button')].find((b) => b.textContent.trim() === 'Start').click()`,
    );
    await waitFor(
      browser,
      `!document.querySelector('${sendButton}').disabled`,
      "Send to become available once Codex runs",
    );

    // Preview shows the exact text; confirming pastes it once without Enter.
    await run(`document.querySelector('${sendButton}').click()`);
    await waitFor(
      browser,
      `document.querySelector('dialog[open] .task-preview')?.textContent === ${JSON.stringify(text)}`,
      "the send preview",
    );
    const confirm = `[...document.querySelectorAll('dialog[open] .btn--primary')].find((b) => b.textContent.startsWith('Paste into')).click()`;
    await run(confirm);
    await waitFor(
      browser,
      `${status}.includes('Sent') && !!document.activeElement?.closest('${tile} [data-terminal]')`,
      "the sent record and terminal focus",
    );
    for (let i = 0; i < 100 && receivedText() !== pasted; i++) await delay(50);
    assert.equal(receivedText(), pasted, "one bracketed paste, no Enter");

    // A notification raised while the preview is open makes the backend refuse.
    await run(`document.querySelector('${sendButton}').focus()`);
    await run(`document.querySelector('${sendButton}').click()`);
    await waitFor(
      browser,
      `!!document.querySelector('dialog[open] .task-preview')`,
      "the second preview",
    );
    // Let the unfocused terminal state reach the backend before the signal.
    await delay(500);
    writeFileSync(trigger, "");
    await waitFor(
      browser,
      `document.querySelector('${node} .task-attention')?.textContent.includes('Approval requested')`,
      "the mirrored attention hint",
    );
    await run(confirm);
    await waitFor(
      browser,
      `document.querySelector('${node} .card-error')?.textContent.includes('needs attention')`,
      "the attention refusal",
    );
    await delay(300);
    assert.equal(receivedText(), pasted, "the refused send wrote nothing");
    assert.doesNotMatch(
      await run(`document.querySelector('${node} .task-status').textContent`),
      /Edited/,
    );

    // Backend restart restores the task, assignment and sent record, stopped.
    await stopBackend(backend.child);
    backend = await startBackend(codexEnv);
    key = backend.connectionKey;
    await openApp();
    await waitFor(
      browser,
      `${status}.includes('Sent') && ${status}.includes('not running') && document.querySelector('${node} .task-assignee')?.value === ${JSON.stringify(tileId)} && !!document.querySelector('.task-wire')`,
      "the restored task",
    );

    // Removing the tile keeps the task but clears its assignee and wire.
    await editor.openWorkspace(workspaceId);
    await editor.openCanvas(canvasId);
    await editor.deleteSessionTile(tileId);
    assert.equal(editor.state.error, "");
    await editor.closeWorkspace();
    await openApp();
    await waitFor(
      browser,
      `${status}.includes('to a removed agent') && document.querySelector('${node} .task-assignee')?.value === '' && !document.querySelector('.task-wire')`,
      "the task without its removed agent",
    );
    assert.match(
      await run(`document.querySelector('${node} .card-body').textContent`),
      /Fix the flaky http test/,
    );
  } catch (error) {
    if (browser)
      error.message += `\nRendered state: ${await evaluate(browser, "JSON.stringify({ task: [...document.querySelectorAll('.task-status, .task-attention, .card-error')].map((e) => e.textContent.trim()), focus: document.activeElement?.outerHTML.slice(0, 200), dialog: !!document.querySelector('dialog[open]') })")}\nReceived: ${JSON.stringify(receivedText())}`;
    throw error;
  } finally {
    editor.dispose();
    await browser?.close();
    await stopBackend(backend.child);
    rmSync(root, { recursive: true, force: true });
  }
});

test("dragging a reopened canvas pans from its saved viewport", async () => {
  const backend = await startBackend();
  key = backend.connectionKey;
  let browser;
  const rpc = async (method, params) => {
    const reply = await send(port, {
      body: JSON.stringify({
        protocolVersion: 1,
        id: crypto.randomUUID(),
        method,
        params,
      }),
    });
    assert.equal(reply.status, 200);
    const response = RuntimeResponseSchema.parse(JSON.parse(reply.text));
    assert.equal(response.error, undefined, JSON.stringify(response));
    return ResultSchemas[method].parse(response.result);
  };
  try {
    const { workspace } = await rpc("workspace.create", {
      name: "Saved view",
    });
    const { canvas } = await rpc("canvas.create", {
      workspaceId: workspace.id,
      title: "Panned canvas",
    });
    const reference = { workspaceId: workspace.id, canvasId: canvas.id };
    // A far-away note keeps the empty-canvas prompt off the pane.
    const created = await rpc("node.createText", {
      ...reference,
      expectedRevision: 1,
      x: 4000,
      y: 4000,
      width: 240,
      height: 160,
      text: "Far away",
    });
    const saved = { x: -310, y: 205, zoom: 1.5 };
    await rpc("canvas.save", {
      ...reference,
      expectedRevision: created.revision,
      viewport: saved,
      nodes: [
        { id: created.node.id, x: 4000, y: 4000, width: 240, height: 160 },
      ],
    });

    browser = await launchBrowser();
    await browser.send(
      "Page.navigate",
      { url: `http://127.0.0.1:${port}/` },
      browser.sessionId,
    );
    await waitFor(
      browser,
      `!!document.querySelector('#connection-key')`,
      "the connection form",
    );
    await evaluate(
      browser,
      `(() => { const input = document.querySelector('#connection-key'); input.value = ${JSON.stringify(key)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
    await clickAt(
      browser,
      await boxOf(browser, ".connbar button[type='submit']"),
    );
    await waitFor(
      browser,
      `!!document.querySelector('.connbar--ok')`,
      "the connected status",
    );
    for (const label of ["Saved view", "Panned canvas"]) {
      const card = `[...document.querySelectorAll('.cards .card')].find((item) => item.textContent.includes(${JSON.stringify(label)}))`;
      await waitFor(
        browser,
        `${card} && !(${card}).disabled`,
        `the ${label} card`,
      );
      await evaluate(
        browser,
        `(${card}).focus(); (${card}).scrollIntoView({ block: 'center' })`,
      );
      await clickAt(browser, await boxByText(browser, ".cards .card", label));
    }
    const transform = `(() => {
      const match = /translate\\(([-\\d.]+)px, ([-\\d.]+)px\\) scale\\(([-\\d.]+)\\)/.exec(document.querySelector('.svelte-flow__viewport')?.style.transform ?? '');
      return match ? { x: Number(match[1]), y: Number(match[2]), zoom: Number(match[3]) } : null;
    })()`;
    await waitFor(
      browser,
      `JSON.stringify(${transform}) === ${JSON.stringify(JSON.stringify(saved))}`,
      "the saved viewport to render",
    );
    const pane = await boxOf(browser, ".svelte-flow__pane");
    await dragBetween(browser, pane, { x: pane.x + 80, y: pane.y + 40 });
    const moved = await evaluate(browser, transform);
    assert.deepEqual(
      moved,
      { x: saved.x + 80, y: saved.y + 40, zoom: saved.zoom },
      "the first drag continues from the saved view instead of the origin",
    );
    // Zoom buttons write the viewport directly too; the next drag must
    // continue from the zoomed view.
    await clickAt(browser, await boxOf(browser, '[aria-label="Zoom in"]'));
    await waitFor(
      browser,
      `(${transform})?.zoom !== ${saved.zoom}`,
      "the zoom button to change the view",
    );
    const zoomed = await evaluate(browser, transform);
    await dragBetween(browser, pane, { x: pane.x - 60, y: pane.y + 30 });
    const after = await evaluate(browser, transform);
    assert.ok(
      Math.abs(after.x - (zoomed.x - 60)) < 0.01 &&
        Math.abs(after.y - (zoomed.y + 30)) < 0.01 &&
        after.zoom === zoomed.zoom,
      `the drag after zooming continues from ${JSON.stringify(zoomed)}, got ${JSON.stringify(after)}`,
    );
  } catch (error) {
    if (browser)
      error.message += `\nRendered state: ${await evaluate(browser, "JSON.stringify({text:document.body.innerText.slice(-1000),transform:document.querySelector('.svelte-flow__viewport')?.style.transform})")}`;
    throw error;
  } finally {
    await browser?.close();
    await stopBackend(backend.child);
  }
});

test("picked files are copied, previewed, and shared with the next prompt", async () => {
  const backend = await startBackend();
  key = backend.connectionKey;
  let browser;
  const rpc = async (method, params) => {
    const reply = await send(port, {
      body: JSON.stringify({
        protocolVersion: 1,
        id: crypto.randomUUID(),
        method,
        params,
      }),
    });
    assert.equal(reply.status, 200);
    const response = RuntimeResponseSchema.parse(JSON.parse(reply.text));
    assert.equal(response.error, undefined, JSON.stringify(response));
    return ResultSchemas[method].parse(response.result);
  };
  try {
    const workspace = await rpc("workspace.create", { name: "Files UI" });
    const workspaceId = workspace.workspace.id;
    const { canvas } = await rpc("canvas.create", {
      workspaceId,
      title: "Brief",
    });
    const reference = { workspaceId, canvasId: canvas.id };

    browser = await launchBrowser();
    await browser.send(
      "Page.navigate",
      { url: `http://127.0.0.1:${port}/` },
      browser.sessionId,
    );
    await waitFor(
      browser,
      `!!document.querySelector('#connection-key')`,
      "the connection form",
    );
    await evaluate(
      browser,
      `(() => { const input = document.querySelector('#connection-key'); input.value = ${JSON.stringify(key)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
    await clickAt(
      browser,
      await boxOf(browser, ".connbar button[type='submit']"),
    );
    await waitFor(
      browser,
      `!!document.querySelector('.connbar--ok')`,
      "the connected status",
    );
    const selectCard = (label) => openCard(browser, label);
    for (const label of ["Files UI", "Brief"]) {
      await selectCard(label);
      await delay(250);
    }
    await waitFor(
      browser,
      `!!document.querySelector('input[type=file]')`,
      "the open canvas",
      10_000,
    );

    // A real FileList through the picker input drives the same import path.
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3Q6wAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    // A one-page PDF with one line of text exercises the real PDF.js worker.
    const stream = "BT /F1 12 Tf 20 100 Td (Hello PDF) Tj ET\n";
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ];
    let pdfSource = "%PDF-1.4\n";
    const offsets = [];
    for (const [index, object] of objects.entries()) {
      offsets.push(pdfSource.length);
      pdfSource += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = pdfSource.length;
    pdfSource += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets)
      pdfSource += `${String(offset).padStart(10, "0")} 00000 n \n`;
    pdfSource += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const pdf = new Uint8Array(Buffer.from(pdfSource, "latin1"));
    const docx = zipStore({
      "[Content_Types].xml":
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      "_rels/.rels":
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      "word/document.xml":
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello Word</w:t></w:r></w:p><w:sectPr/></w:body></w:document>',
    });
    await evaluate(
      browser,
      `(() => {
        const input = document.querySelector('input[type=file]');
        const transfer = new DataTransfer();
        transfer.items.add(new File(["hello from a copied file"], "notes.txt", { type: "text/plain" }));
        transfer.items.add(new File([new Uint8Array(${JSON.stringify([...png])})], "dot.png", { type: "image/png" }));
        transfer.items.add(new File([new Uint8Array(${JSON.stringify([...pdf])})], "sheet.pdf", { type: "application/pdf" }));
        transfer.items.add(new File([new Uint8Array(${JSON.stringify([...docx])})], "memo.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      })()`,
    );
    await waitFor(
      browser,
      `document.querySelectorAll('.file').length === 4`,
      "all imported file nodes",
    );
    await waitFor(
      browser,
      `[...document.querySelectorAll('.file__name')].some((node) => node.textContent.includes('notes.txt'))`,
      "the text file label",
    );
    await waitFor(
      browser,
      `document.querySelector('.file__text')?.textContent.includes('hello from a copied file')`,
      "the text preview",
    );
    await waitFor(
      browser,
      `document.querySelector('.file__image')?.naturalWidth === 1`,
      "the image preview",
    );
    await waitFor(
      browser,
      `[...document.querySelectorAll('.file__page')].some((page) => page.width > 0 && page.height > 0)`,
      "the PDF page preview",
    );
    await waitFor(
      browser,
      `[...document.querySelectorAll('.file__pager')].some((node) => node.textContent.includes('1 / 1'))`,
      "the PDF page count",
    );
    await waitFor(
      browser,
      `[...document.querySelectorAll('.file__docx')].some((frame) => frame.contentDocument?.body?.innerText.includes('Hello Word'))`,
      "the Word preview",
    );
    assert.equal(
      await evaluate(
        browser,
        `[...document.querySelectorAll('.file__size')].some((node) => node.textContent.includes('B'))`,
      ),
      true,
      "file sizes are shown",
    );

    // The canvas stores metadata only, and reading returns the copied bytes.
    let stored;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      stored = await rpc("canvas.open", reference);
      if (stored.artifacts.filter((item) => item.type === "file").length === 4)
        break;
      await delay(100);
    }
    const artifacts = stored.artifacts.filter((item) => item.type === "file");
    assert.equal(artifacts.length, 4, JSON.stringify(stored.artifacts));
    const notes = artifacts.find((item) => item.name === "notes.txt");
    assert.equal(notes.text, "hello from a copied file");
    assert.equal(notes.mime, "text/plain");
    assert.equal(notes.size, 24);
    const sheet = artifacts.find((item) => item.name === "sheet.pdf");
    assert.match(sheet.text, /Hello PDF/);
    const memo = artifacts.find((item) => item.name === "memo.docx");
    assert.match(memo.text, /Hello Word/);
    assert.equal(
      artifacts.some((item) => item.data),
      false,
    );
    const bytes = await rpc("file.read", {
      workspaceId,
      artifactId: notes.id,
    });
    assert.equal(
      Buffer.from(bytes.data, "base64").toString("utf8"),
      "hello from a copied file",
    );

    // Dropping a file copies it like the picker, but at the pointer position.
    const dropOffset = await evaluate(
      browser,
      `(() => {
        const target = document.querySelector('.canvas');
        const rect = target.getBoundingClientRect();
        const point = {
          x: Math.round(rect.width * 0.25),
          y: Math.round(rect.height * 0.3),
        };
        const transfer = new DataTransfer();
        transfer.items.add(new File(["dropped note"], "dropped.md", { type: "text/markdown" }));
        target.dispatchEvent(new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + point.x,
          clientY: rect.top + point.y,
          dataTransfer: transfer,
        }));
        return point;
      })()`,
    );
    await waitFor(
      browser,
      `!!document.querySelector('.canvas__drop')`,
      "the drop hint",
    );
    await evaluate(
      browser,
      `(() => {
        const target = document.querySelector('.canvas');
        const rect = target.getBoundingClientRect();
        const transfer = new DataTransfer();
        transfer.items.add(new File(["dropped note"], "dropped.md", { type: "text/markdown" }));
        target.dispatchEvent(new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + ${dropOffset.x},
          clientY: rect.top + ${dropOffset.y},
          dataTransfer: transfer,
        }));
      })()`,
    );
    await waitFor(
      browser,
      `document.querySelector('.canvas__drop') === null`,
      "the drop hint to clear",
    );
    // Dragging text or a canvas object is not a file import.
    await evaluate(
      browser,
      `(() => {
        const transfer = new DataTransfer();
        transfer.setData("text/plain", "not a file");
        document.querySelector('.canvas').dispatchEvent(new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }));
      })()`,
    );
    await delay(150);
    assert.equal(
      await evaluate(browser, `!!document.querySelector('.canvas__drop')`),
      false,
      "text drags never show the file hint",
    );
    await waitFor(
      browser,
      `[...document.querySelectorAll('.file')].some((card) => card.querySelector('.file__name')?.textContent.includes('dropped.md'))`,
      "the dropped file node",
    );
    await waitFor(
      browser,
      `[...document.querySelectorAll('.file')].some((card) => card.querySelector('.file__name')?.textContent.includes('dropped.md') && card.querySelector('.file__text')?.textContent.includes('dropped note'))`,
      "the dropped file preview",
    );
    let dropped;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      dropped = await rpc("canvas.open", reference);
      if (dropped.artifacts.some((item) => item.name === "dropped.md")) break;
      await delay(100);
    }
    const droppedArtifact = dropped.artifacts.find(
      (item) => item.name === "dropped.md",
    );
    const droppedNode = dropped.nodes.find(
      (node) => node.artifactId === droppedArtifact.id,
    );
    const { viewport } = dropped.canvas;
    // The card centres on the pointer: half of its 380x300 default size.
    const expected = {
      x: (dropOffset.x - viewport.x) / viewport.zoom - 190,
      y: (dropOffset.y - viewport.y) / viewport.zoom - 150,
    };
    assert.ok(
      Math.abs(droppedNode.x - expected.x) <= 2 &&
        Math.abs(droppedNode.y - expected.y) <= 2,
      `the dropped file lands at the pointer: ${JSON.stringify({ node: { x: droppedNode.x, y: droppedNode.y }, expected })}`,
    );
    assert.equal(
      Buffer.from(
        (
          await rpc("file.read", {
            workspaceId,
            artifactId: droppedArtifact.id,
          })
        ).data,
        "base64",
      ).toString("utf8"),
      "dropped note",
    );

    // Selecting the file nodes sends their extracted text with the prompt.
    const final = await rpc("canvas.open", reference);
    const finalArtifacts = final.artifacts.filter(
      (item) => item.type === "file",
    );
    const nodes = final.nodes.filter((node) =>
      finalArtifacts.some((artifact) => artifact.id === node.artifactId),
    );
    const started = await rpc("conversation.start", {
      ...reference,
      turnId: crypto.randomUUID(),
      prompt: "Summarize the attached notes.",
      model: "test",
      anchor: { x: 0, y: 0 },
      nodeIds: nodes.map((node) => node.id),
    });
    assert.equal(
      started.context.artifacts.some(
        (artifact) =>
          artifact.type === "file" &&
          artifact.text === "hello from a copied file",
      ),
      true,
    );
    assert.equal(
      started.context.artifacts.some(
        (artifact) =>
          artifact.type === "file" && artifact.text === "dropped note",
      ),
      true,
      "dropped text reaches the prompt context",
    );
  } catch (error) {
    if (browser)
      error.message += `\nRendered state: ${await evaluate(browser, "JSON.stringify({text:document.body.innerText.slice(-2000),files:document.querySelectorAll('.file').length})")}`;
    throw error;
  } finally {
    await browser?.close();
    await stopBackend(backend.child);
  }
});

test("Ctrl+Z undoes an accidental drag in the rendered app and saves it", async () => {
  const backend = await startBackend();
  key = backend.connectionKey;
  let browser;
  const rpc = async (method, params) => {
    const reply = await send(port, {
      body: JSON.stringify({
        protocolVersion: 1,
        id: crypto.randomUUID(),
        method,
        params,
      }),
    });
    assert.equal(reply.status, 200);
    const response = RuntimeResponseSchema.parse(JSON.parse(reply.text));
    assert.equal(response.error, undefined, JSON.stringify(response));
    return ResultSchemas[method].parse(response.result);
  };
  try {
    const { workspace } = await rpc("workspace.create", {
      name: "Undo history",
    });
    const { canvas } = await rpc("canvas.create", {
      workspaceId: workspace.id,
      title: "Undo canvas",
    });
    const reference = { workspaceId: workspace.id, canvasId: canvas.id };
    const { node } = await rpc("node.createText", {
      ...reference,
      expectedRevision: 1,
      x: 120,
      y: 120,
      width: 240,
      height: 160,
      text: "Move me",
    });
    const savedX = async () =>
      (await rpc("canvas.open", reference)).nodes.find(
        (item) => item.id === node.id,
      ).x;

    browser = await launchBrowser();
    await browser.send(
      "Page.navigate",
      { url: `http://127.0.0.1:${port}/` },
      browser.sessionId,
    );
    await waitFor(
      browser,
      `!!document.querySelector('#connection-key')`,
      "the connection form",
    );
    await evaluate(
      browser,
      `(() => { const input = document.querySelector('#connection-key'); input.value = ${JSON.stringify(key)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`,
    );
    await clickAt(
      browser,
      await boxOf(browser, ".connbar button[type='submit']"),
    );
    await waitFor(
      browser,
      `!!document.querySelector('.connbar--ok')`,
      "the connected status",
    );
    for (const label of ["Undo history", "Undo canvas"]) {
      const card = `[...document.querySelectorAll('.tiles .tile__open, .cards .card')].find((item) => item.querySelector('.tile__name, strong')?.textContent === ${JSON.stringify(label)})`;
      await waitFor(
        browser,
        `${card} && !(${card}).disabled`,
        `the ${label} card`,
      );
      await evaluate(
        browser,
        `(${card}).focus(); (${card}).scrollIntoView({ block: 'center' })`,
      );
      await clickAt(
        browser,
        await boxByText(browser, ".tiles .tile__open, .cards .card", label),
      );
    }
    const nodeSelector = `.svelte-flow__node[data-id="${node.id}"]`;
    await waitFor(
      browser,
      `document.querySelector(${JSON.stringify(nodeSelector)})?.getBoundingClientRect().height > 0 && document.querySelector(${JSON.stringify(nodeSelector)}).classList.contains('draggable')`,
      "the note to render and become draggable",
    );
    assert.equal(
      await evaluate(
        browser,
        `document.querySelector('[aria-label="Undo"]').disabled`,
      ),
      true,
      "nothing to undo yet",
    );
    const start = await boxOf(browser, nodeSelector);
    await dragBetween(browser, start, { x: start.x + 150, y: start.y + 60 });
    const moved = await boxOf(browser, nodeSelector);
    // The first pointer step only crosses the drag threshold.
    assert.ok(moved.x - start.x > 100, JSON.stringify({ start, moved }));
    const movedX = Math.round(120 + moved.x - start.x);
    const deadline = Date.now() + 5000;
    while ((await savedX()) === 120 && Date.now() < deadline) await delay(50);
    assert.ok(Math.abs((await savedX()) - movedX) < 2, "the drag autosaves");

    // Focus the canvas, not a text field, then press Ctrl+Z.
    await evaluate(browser, `document.activeElement?.blur()`);
    for (const type of ["keyDown", "keyUp"])
      await browser.send(
        "Input.dispatchKeyEvent",
        {
          type,
          key: "z",
          code: "KeyZ",
          windowsVirtualKeyCode: 90,
          modifiers: 2,
        },
        browser.sessionId,
      );
    await waitFor(
      browser,
      `(() => { const rect = document.querySelector(${JSON.stringify(nodeSelector)}).getBoundingClientRect(); return Math.abs(rect.left + rect.width / 2 - ${start.x}) < 2; })()`,
      "the note to return to its original place",
    );
    const undoDeadline = Date.now() + 5000;
    while ((await savedX()) !== 120 && Date.now() < undoDeadline)
      await delay(50);
    assert.equal(await savedX(), 120, "the undo is saved");

    // The Redo button moves it back.
    await clickAt(browser, await boxOf(browser, '[aria-label="Redo"]'));
    await waitFor(
      browser,
      `(() => { const rect = document.querySelector(${JSON.stringify(nodeSelector)}).getBoundingClientRect(); return Math.abs(rect.left + rect.width / 2 - ${moved.x}) < 2; })()`,
      "the note to move again on redo",
    );
  } catch (error) {
    if (browser)
      error.message += `\nRendered state: ${await evaluate(browser, "JSON.stringify({text:document.body.innerText.slice(-1000)})")}`;
    throw error;
  } finally {
    await browser?.close();
    await stopBackend(backend.child);
  }
});
