import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer, request } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

async function startBackend() {
  // An empty PATH proves the compiled backend does not launch Node or Cargo.
  const child = spawn(binary, {
    env,
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
      await waitFor(
        browser,
        `[...document.querySelectorAll(".cards .card")].some((card) => card.textContent.includes(${JSON.stringify(label)}))`,
        `the seeded ${picker} card`,
      );
      await clickAt(browser, await boxByText(browser, ".cards .card", label));
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
    await waitFor(
      browser,
      `document.querySelector("[aria-labelledby='codex-status-label']")?.textContent.includes("Codex execution is unsupported")`,
      "the explicit unsupported Codex state",
    );
  } finally {
    editor.dispose();
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
          const input = JSON.parse(body.messages.at(-1).content);
          const operation = input.prompt.includes('Change')
            ? {op:'updateText',nodeId:input.canvasContext.nodes[0].id,text:'Proposed replacement'}
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
    const selectCard = async (label) => {
      const expression = `[...document.querySelectorAll('.cards .card')].find(c => c.querySelector('strong')?.textContent === ${JSON.stringify(label)})`;
      await waitFor(
        browser,
        `${expression} && !(${expression}).disabled`,
        label,
      );
      await evaluate(
        browser,
        `(${expression}).focus(); (${expression}).scrollIntoView({block:'center'})`,
      );
      await clickAt(browser, await boxByText(browser, ".cards .card", label));
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
      `document.querySelector('[aria-label="Settings"]').click()`,
    );
    await waitFor(
      browser,
      `!!document.querySelector('#ai-provider')`,
      "provider settings",
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
      document.querySelector('[aria-label="Close settings"]').click();
    })()`,
    );
    await waitFor(
      browser,
      `!document.querySelector('dialog[open]')`,
      "closed provider settings",
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

test("an applied HTML design renders in an inert frame on the canvas", async () => {
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
    const workspace = await rpc("workspace.create", { name: "Design UI" });
    const workspaceId = workspace.workspace.id;
    const { canvas } = await rpc("canvas.create", {
      workspaceId,
      title: "Login design",
    });
    const reference = { workspaceId, canvasId: canvas.id };
    const turnId = crypto.randomUUID();
    const start = await rpc("conversation.start", {
      ...reference,
      turnId,
      prompt: "Design a login page",
      model: "test",
      anchor: { x: 0, y: 0 },
      nodeIds: [],
    });
    const source = `<!doctype html><style>body{background:#101828;color:#f8fafc;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0}main{width:320px}input,button{width:100%;padding:10px;margin:6px 0}</style><main><h1>Sign in</h1><input type="email" placeholder="you@example.com"><input type="password" placeholder="Password"><button>Continue</button></main><script>parent.document.title='owned';document.title='owned'</script>`;
    const finished = await rpc("conversation.finish", {
      ...reference,
      turnId,
      reply: "Here is a login page design.",
      operations: [
        {
          op: "createHtml",
          nodeId: crypto.randomUUID(),
          artifactId: crypto.randomUUID(),
          x: 400,
          y: 0,
          width: 960,
          height: 640,
          html: source,
        },
      ],
      status: "complete",
      error: "",
    });
    assert.equal(finished.turn.status, "pending");
    assert.equal(
      (
        await rpc("conversation.resolve", {
          ...reference,
          turnId,
          action: "apply",
        })
      ).turn.status,
      "applied",
    );
    assert.equal(start.context.nodes.length, 0);

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
    const selectCard = async (label) => {
      const card = `[...document.querySelectorAll('.cards .card')].find((item) => item.textContent.includes(${JSON.stringify(label)}))`;
      await waitFor(
        browser,
        `${card} && !(${card}).disabled`,
        `the ${label} card`,
      );
      // Later tests add workspaces: scroll the target card into the list view
      // so its measured center is inside the clickable area.
      await evaluate(
        browser,
        `(${card}).focus(); (${card}).scrollIntoView({ block: 'center' })`,
      );
      await clickAt(browser, await boxByText(browser, ".cards .card", label));
    };
    for (const label of ["Design UI", "Login design"]) await selectCard(label);
    await waitFor(
      browser,
      `!!document.querySelector('.design iframe')`,
      "the design preview",
    );
    const frame = await evaluate(
      browser,
      `(() => {
        const iframe = document.querySelector('.design iframe');
        const box = iframe.getBoundingClientRect();
        return {
          sandbox: iframe.getAttribute('sandbox'),
          source: iframe.getAttribute('srcdoc'),
          width: box.width,
          height: box.height,
        };
      })()`,
    );
    assert.equal(frame.sandbox, "allow-same-origin", "scripts stay disabled");
    assert.match(frame.source, /Sign in/);
    assert.ok(frame.width > 0 && frame.height > 0, JSON.stringify(frame));
    await waitFor(
      browser,
      `document.querySelector('.design iframe').contentDocument?.body?.innerText.includes('Sign in')`,
      "the rendered login design",
    );
    assert.equal(
      await evaluate(
        browser,
        `getComputedStyle(document.querySelector('.design iframe').contentDocument.body).backgroundColor`,
      ),
      "rgb(16, 24, 40)",
      "the design's own CSS applies",
    );
    assert.notEqual(
      await evaluate(browser, "document.title"),
      "owned",
      "design scripts never run",
    );
    // The design survives a reopen and is not stored as prose.
    await clickAt(
      browser,
      await boxOf(browser, '[aria-label="Canvas gallery"]'),
    );
    await selectCard("Login design");
    await waitFor(
      browser,
      `!!document.querySelector('.design iframe')`,
      "the reopened design",
    );
    const stored = await rpc("canvas.open", reference);
    const design = stored.artifacts.find(
      (artifact) => artifact.type === "html",
    );
    assert.equal(design.html, source);
    assert.equal(
      stored.artifacts.some(
        (artifact) =>
          artifact.type === "text" && artifact.text.includes("Sign in"),
      ),
      false,
      "the design is not duplicated as a text card",
    );
  } catch (error) {
    if (browser)
      error.message += `\nRendered state: ${await evaluate(browser, "JSON.stringify({text:document.body.innerText.slice(-2000),frames:document.querySelectorAll('iframe').length})")}`;
    throw error;
  } finally {
    await browser?.close();
    await stopBackend(backend.child);
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
      `Math.abs(document.querySelector(${JSON.stringify(nodeSelector)}).getBoundingClientRect().left + document.querySelector(${JSON.stringify(nodeSelector)}).getBoundingClientRect().width / 2 - ${start.x}) < 2`,
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
      `Math.abs(document.querySelector(${JSON.stringify(nodeSelector)}).getBoundingClientRect().left + document.querySelector(${JSON.stringify(nodeSelector)}).getBoundingClientRect().width / 2 - ${moved.x}) < 2`,
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

test("annotating a design proposes a revised copy beside the original", async () => {
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
      name: "Design review",
    });
    const { canvas } = await rpc("canvas.create", {
      workspaceId: workspace.id,
      title: "Landing review",
    });
    const reference = { workspaceId: workspace.id, canvasId: canvas.id };
    const turnId = crypto.randomUUID();
    await rpc("conversation.start", {
      ...reference,
      turnId,
      prompt: "Design a landing page",
      model: "test",
      anchor: { x: 0, y: 0 },
      nodeIds: [],
    });
    const original = `<!doctype html><style>body{margin:0;font-family:system-ui}header{height:200px;background:#1e3a8a;color:#fff;display:grid;place-items:center}h1{margin:0;font-size:48px}section{height:440px;background:#f1f5f9}</style><header><h1 class="hero">Launch faster</h1></header><section></section>`;
    const designId = crypto.randomUUID();
    await rpc("conversation.finish", {
      ...reference,
      turnId,
      reply: "Here is a landing page.",
      operations: [
        {
          op: "createHtml",
          nodeId: designId,
          artifactId: crypto.randomUUID(),
          x: 400,
          y: 0,
          width: 960,
          height: 640,
          html: original,
        },
      ],
      status: "complete",
      error: "",
    });
    await rpc("conversation.resolve", {
      ...reference,
      turnId,
      action: "apply",
    });

    browser = await launchBrowser();
    await browser.send(
      "Page.addScriptToEvaluateOnNewDocument",
      {
        source: `
      localStorage.setItem('agentica.openrouterApiKey', 'test-only');
      localStorage.setItem('agentica.openrouterModel', 'openrouter/free');
      window.__providerRequests = [];
      const realFetch = window.fetch.bind(window);
      window.fetch = async (url, options) => {
        if (!String(url).startsWith('https://openrouter.ai/')) return realFetch(url, options);
        const body = JSON.parse(options.body);
        window.__providerRequests.push(body);
        if (body.messages.at(-1).role === 'user') {
          const input = JSON.parse(body.messages.at(-1).content);
          const operation = {op:'createHtml',...input.proposalAnchor,width:960,height:640,html:'<!doctype html><h1>Launch faster, today</h1>'};
          return new Response(JSON.stringify({choices:[{message:{content:null,tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name:'canvas_edit',arguments:JSON.stringify(operation)}}]}}]}), {headers:{'Content-Type':'application/json'}});
        }
        return new Response(JSON.stringify({choices:[{message:{content:'Made the headline bolder.'},finish_reason:'stop'}]}), {headers:{'Content-Type':'application/json'}});
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
    for (const label of ["Design review", "Landing review"]) {
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
    const annotate = `[data-id="${designId}"] [aria-label^="Annotate design"]`;
    await waitFor(
      browser,
      `!!document.querySelector(${JSON.stringify(annotate)}) && !document.querySelector(${JSON.stringify(annotate)}).disabled`,
      "the annotate control",
    );
    await clickAt(browser, await boxOf(browser, annotate));
    await waitFor(
      browser,
      `document.querySelector('.review__frame')?.contentDocument?.querySelector('h1')`,
      "the design inside the annotation dialog",
    );
    // Pin a comment on the headline: 50% across, 15% down is inside it.
    const stage = await boxOf(browser, ".review__overlay");
    await clickAt(browser, {
      x: stage.x,
      y: stage.y - stage.height / 2 + stage.height * 0.15,
    });
    await waitFor(
      browser,
      `document.querySelectorAll('.review__item').length === 1 && document.activeElement?.matches('.review__item textarea')`,
      "a focused pinned comment",
    );
    assert.match(
      await evaluate(
        browser,
        `document.querySelector('.review__field label').textContent`,
      ),
      /Pinned on .*h1\.hero "Launch faster"/,
      "the pin names the element under it",
    );
    const type = (index, text) =>
      evaluate(
        browser,
        `(() => { const field = document.querySelectorAll('.review__item textarea')[${index}]; field.value = ${JSON.stringify(text)}; field.dispatchEvent(new Event('input', { bubbles: true })); })()`,
      );
    await type(0, "Make the headline bolder");
    // Drafts survive closing the dialog and show as a badge on the node.
    await clickAt(
      browser,
      await boxByText(browser, ".review button", "Keep for later"),
    );
    await waitFor(
      browser,
      `document.querySelector('[data-id="${designId}"] .design__badge')?.textContent === '1'`,
      "the unsent comment badge",
    );
    await clickAt(browser, await boxOf(browser, annotate));
    await waitFor(
      browser,
      `document.querySelector('.review__item textarea')?.value === 'Make the headline bolder'`,
      "the restored draft",
    );
    await clickAt(
      browser,
      await boxByText(browser, ".review button", "General comment"),
    );
    await waitFor(
      browser,
      `document.querySelectorAll('.review__item').length === 2`,
      "a general comment",
    );
    await type(1, "Use a warmer palette");
    await clickAt(
      browser,
      await boxByText(browser, ".review button", "Generate revision"),
    );
    await waitFor(
      browser,
      `!document.querySelector('.review') && !!document.querySelector('.design.preview')`,
      "the proposed revision",
    );
    const request = JSON.parse(
      await evaluate(
        browser,
        `JSON.stringify(window.__providerRequests[0].messages.at(-1).content)`,
      ),
    );
    const input = JSON.parse(request);
    assert.match(input.prompt, new RegExp(`^Revise design ${designId} `));
    assert.match(
      input.prompt,
      /1\. \[At 50% across, 1\d% down, on header > h1\.hero "Launch faster"\] Make the headline bolder/,
    );
    assert.match(input.prompt, /2\. \[Whole design\] Use a warmer palette/);
    assert.deepEqual(
      input.canvasContext.nodes.map((node) => node.id),
      [designId],
      "only the reviewed design is sent as context",
    );
    assert.equal(input.canvasContext.artifacts[0].html, original);

    await clickAt(
      browser,
      await boxByText(browser, ".review-bar button", "Apply"),
    );
    await waitFor(
      browser,
      `document.querySelectorAll('.design:not(.preview)').length === 2 && !document.querySelector('.design__badge')`,
      "the applied revision and a cleared draft",
    );
    const stored = await rpc("canvas.open", reference);
    const designs = stored.artifacts.filter(
      (artifact) => artifact.type === "html",
    );
    assert.equal(designs.length, 2);
    assert.ok(designs.some((artifact) => artifact.html === original));
    const revised = stored.nodes.find(
      (node) =>
        node.id !== designId &&
        designs.some(
          (artifact) =>
            artifact.id === node.artifactId && artifact.html !== original,
        ),
    );
    const source = stored.nodes.find((node) => node.id === designId);
    assert.deepEqual(
      [source.x, source.y, source.width, source.height],
      [400, 0, 960, 640],
      "the original design is unchanged",
    );
    assert.ok(
      revised.x >= source.x + source.width,
      "the revision sits beside it",
    );
  } catch (error) {
    if (browser)
      error.message += `\nRendered state: ${await evaluate(browser, "JSON.stringify({text:document.body.innerText.slice(-1500)})")}`;
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
    const selectCard = async (label) => {
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
    };
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
