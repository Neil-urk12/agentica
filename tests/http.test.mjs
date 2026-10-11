import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { request } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  MAX_FRAME_BYTES,
  ResultSchemas,
  RuntimeRequestSchema,
  RuntimeResponseSchema,
} from "@agentica/protocol";

const FRONTEND_ORIGIN = "http://127.0.0.1:1420";
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
        headers: {
          Origin: FRONTEND_ORIGIN,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
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

test("the shared workspace fixture round-trips over authenticated HTTP", async () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("./fixtures/workspace-roundtrip.json", import.meta.url),
      "utf8",
    ),
  );
  let backend = await startBackend();
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
  let release;
  try {
    const rpc = (id, method, params) =>
      send(port, {
        body: JSON.stringify({ protocolVersion: 1, id, method, params }),
        timeout: 10000,
      });
    const created = await rpc("setup", "workspace.create", {
      name: "Deadlines",
    });
    const workspaceId = JSON.parse(created.text).result.workspace.id;
    database = new DatabaseSync(
      join(dataDir, "workspaces", workspaceId, "workspace.sqlite3"),
    );
    database.exec("BEGIN EXCLUSIVE");
    // Two SQLite waits take four seconds; the third call starts before the
    // deadline and finishes after it, while the fourth must expire in the queue.
    release = setTimeout(() => database.exec("ROLLBACK"), 5350);
    const results = await Promise.all(
      Array.from({ length: 4 }, async (_, index) => {
        const title = `queued-${index}`;
        const started = performance.now();
        const response = await rpc(title, "canvas.create", {
          workspaceId,
          title,
        });
        return { ...response, title, elapsed: performance.now() - started };
      }),
    );
    const expired = results.filter((result) => result.status === 408);
    assert.equal(expired.length, 1);
    assert.match(expired[0].text, /before execution\. Nothing was saved/);
    const completed = results.filter((result) => result.status === 200);
    const saved = completed.filter((result) => JSON.parse(result.text).result);
    assert.equal(saved.length, 1);
    assert.ok(saved[0].elapsed > 5000);
    for (const failed of completed.filter(
      (result) => JSON.parse(result.text).error,
    ))
      assert.equal(JSON.parse(failed.text).error.code, "STORAGE_ERROR");
    const reopened = await rpc("inspect", "workspace.open", { workspaceId });
    const canvases = JSON.parse(reopened.text).result.canvases;
    assert.deepEqual(
      canvases.map((canvas) => canvas.title),
      [saved[0].title],
    );
  } finally {
    clearTimeout(release);
    database?.close();
    await stopBackend(backend.child);
  }
});
