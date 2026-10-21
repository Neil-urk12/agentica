import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer, request } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
