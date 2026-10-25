import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { onRequest } from "../apps/landing/functions/api/stats.ts";
import { loadStats } from "../apps/landing/src/stats.ts";

const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
});

const env = {
  CF_ANALYTICS_API_TOKEN: "private-cf-token",
  CF_ACCOUNT_ID: "account",
  CF_WEB_ANALYTICS_SITE_TAG: "site",
  CF_WEB_ANALYTICS_HOSTNAME: "production.example",
  GITHUB_TOKEN: "private-gh-token",
};
const gql = (values = [0]) => ({
  data: {
    viewer: {
      accounts: [
        {
          rumPageloadEventsAdaptiveGroups: values.map((visits) => ({
            sum: { visits },
          })),
        },
      ],
    },
  },
  errors: null,
});
const json = (body, headers = {}) => Response.json(body, { headers });
const next = (path, page = 2) => ({
  Link: `<https://api.github.com/repos/Neil-urk12/agentica${path}?per_page=100&page=${page}>; rel="next"`,
});
const release = (id, extra = {}) => ({
  id,
  draft: false,
  prerelease: false,
  ...extra,
});
const asset = (id, download_count) => ({ id, download_count });

function setup(handler = () => json([])) {
  const calls = [];
  const stored = new Map();
  const pending = [];
  let now = 0;
  globalThis.caches = {
    default: {
      async match(key) {
        const hit = stored.get(key.url);
        return hit && hit.expires > now ? hit.response.clone() : undefined;
      },
      async put(key, response) {
        const ttl = Number(
          response.headers.get("Cache-Control").match(/max-age=(\d+)/)[1],
        );
        stored.set(key.url, { response, expires: now + ttl * 1000 });
      },
    },
  };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return handler(String(url), options);
  };
  return {
    calls,
    stored,
    advance: (ms) => {
      now += ms;
    },
    async request(path = "/api/stats", settings = env, method = "GET") {
      const response = await onRequest({
        request: new Request(`https://landing.example${path}`, { method }),
        env: settings,
        waitUntil: (promise) => pending.push(promise),
      });
      await Promise.all(pending);
      return response;
    },
  };
}

test("visits sum date groups, round once, fix the rolling UTC interval, and expose only public fields", async () => {
  const s = setup((url) =>
    url.endsWith("/graphql") ? json(gql([0.4, 0.4])) : json([]),
  );
  const response = await s.request("/api/stats?hostname=evil&repo=evil&days=1");
  const body = await response.json();
  assert.equal(body.visits, 1);
  assert.equal(body.downloads, 0);
  assert.deepEqual(Object.keys(body).sort(), [
    "downloads",
    "updatedAt",
    "visits",
    "visitsFrom",
    "visitsTo",
  ]);
  assert.equal(
    Date.parse(body.visitsTo) - Date.parse(body.visitsFrom),
    30 * 86400000,
  );
  assert.equal(body.updatedAt, body.visitsTo);
  assert.match(body.updatedAt, /Z$/);
  const query = JSON.parse(
    s.calls.find((c) => c.url.endsWith("/graphql")).options.body,
  );
  assert.deepEqual(query.variables, {
    account: "account",
    filter: {
      siteTag: "site",
      requestHost: "production.example",
      datetime_geq: body.visitsFrom,
      datetime_lt: body.visitsTo,
    },
  });
  assert.match(query.query, /sum\s*\{\s*visits\s*\}/);
  assert.match(query.query, /dimensions\s*\{\s*date\s*\}/);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=900");
  assert.ok(!JSON.stringify(body).includes("private"));
  for (const { options } of s.calls) {
    assert.ok(!("Cookie" in options.headers));
    assert.ok(!("Referer" in options.headers));
  }
});

test("downloads follow release/asset pages, include prereleases, skip drafts and duplicate IDs", async () => {
  const s = setup((url) => {
    if (url.endsWith("/graphql")) return json(gql([]));
    const { pathname, searchParams } = new URL(url);
    const page = searchParams.get("page");
    if (pathname.endsWith("/releases"))
      return page === "1"
        ? json([release(1), release(99, { draft: true })], next("/releases"))
        : json([release(1), release(2, { prerelease: true })]);
    if (pathname.endsWith("/1/assets"))
      return page === "1"
        ? json([asset(11, 3)], next("/releases/1/assets"))
        : json([asset(11, 3), asset(12, 4)]);
    if (pathname.endsWith("/2/assets")) return json([asset(21, 5)]);
    throw new Error("Unexpected URL");
  });
  assert.equal((await (await s.request()).json()).downloads, 12);
  assert.equal(s.calls.length, 6);
});

test("full pages without Link are probed until completion", async () => {
  const s = setup((url) => {
    if (url.endsWith("/graphql")) return json(gql());
    if (new URL(url).pathname.endsWith("/releases")) return json([release(1)]);
    return json(
      new URL(url).searchParams.get("page") === "1"
        ? Array.from({ length: 100 }, (_, i) => asset(i, 1))
        : [asset(100, 2)],
    );
  });
  assert.equal((await (await s.request()).json()).downloads, 102);
});

for (const [name, response] of [
  [
    "GraphQL errors",
    () => json({ ...gql([3]), errors: [{ message: "private error" }] }),
  ],
  ["missing account", () => json({ data: { viewer: { accounts: [] } } })],
  ["missing groups", () => json({ data: { viewer: { accounts: [{}] } } })],
  ["null envelope", () => json(null)],
  ["group limit", () => json(gql(Array(10000).fill(1)))],
  ["negative visits", () => json(gql([-1]))],
  ["string visits", () => json(gql(["1"]))],
  ["unsafe visits", () => json(gql([Number.MAX_SAFE_INTEGER + 1]))],
  [
    "HTTP rejection",
    () => new Response("private upstream body", { status: 403 }),
  ],
  ["invalid JSON", () => new Response("not json")],
]) {
  test(`${name} makes only visits unavailable`, async () => {
    const s = setup((url) =>
      url.endsWith("/graphql") ? response() : json([]),
    );
    const r = await s.request();
    const body = await r.json();
    assert.equal(body.visits, null);
    assert.equal(body.downloads, 0);
    assert.equal(r.headers.get("Cache-Control"), "public, max-age=60");
    assert.ok(!JSON.stringify(body).includes("private"));
  });
}

for (const [name, assetResponse] of [
  [
    "later page fails",
    (page) =>
      page === "1"
        ? json([asset(1, 4)], next("/releases/1/assets"))
        : new Response(null, { status: 503 }),
  ],
  [
    "cross-origin next",
    () =>
      json([asset(1, 4)], {
        Link: '<https://evil.example/?page=2>; rel="next"',
      }),
  ],
  ["repeated next", () => json([asset(1, 4)], next("/releases/1/assets", 1))],
  ["malformed Link", () => json([asset(1, 4)], { Link: "broken" })],
  ["invalid count", () => json([asset(1, -1)])],
  ["fractional count", () => json([asset(1, 0.5)])],
  ["overflow", () => json([asset(1, Number.MAX_SAFE_INTEGER), asset(2, 1)])],
  ["missing ID", () => json([{ download_count: 1 }])],
  ["invalid envelope", () => json({ message: "private" })],
]) {
  test(`${name} discards the incomplete downloads total`, async () => {
    const s = setup((url) => {
      if (url.endsWith("/graphql")) return json(gql([2]));
      if (new URL(url).pathname.endsWith("/releases"))
        return json([release(1)]);
      return assetResponse(new URL(url).searchParams.get("page"));
    });
    const body = await (await s.request()).json();
    assert.equal(body.visits, 2);
    assert.equal(body.downloads, null);
    assert.ok(s.calls.every((c) => !c.url.includes("evil.example")));
  });
}

test("missing analytics configuration preserves GitHub; both failures are nullable", async () => {
  const s = setup(() => json([]));
  assert.equal((await (await s.request("/api/stats", {})).json()).visits, null);
  assert.ok(s.calls.every((c) => !c.url.endsWith("/graphql")));
  s.advance(60000);
  globalThis.fetch = async () => {
    throw new Error("private");
  };
  const body = await (await s.request()).json();
  assert.equal(body.visits, null);
  assert.equal(body.downloads, null);
});

test("POST and HEAD reject before cache or upstream work", async () => {
  const s = setup();
  for (const method of ["POST", "HEAD"]) {
    const r = await s.request("/api/stats", env, method);
    assert.equal(r.status, 405);
    assert.equal(r.headers.get("Allow"), "GET");
  }
  assert.equal(s.calls.length, 0);
  assert.equal(s.stored.size, 0);
});

for (const complete of [true, false]) {
  test(`${complete ? "complete" : "partial"} canonical cache hit preserves timestamps until expiry`, async () => {
    const s = setup((url) =>
      url.endsWith("/graphql") ? json(gql()) : json([]),
    );
    const settings = complete ? env : {};
    const first = await (
      await s.request("/api/stats?site=evil", settings)
    ).text();
    const calls = s.calls.length;
    s.advance((complete ? 900 : 60) * 1000 - 1);
    assert.equal(
      await (await s.request("/api/stats?days=999", settings)).text(),
      first,
    );
    assert.equal(s.calls.length, calls);
    assert.deepEqual(
      [...s.stored.keys()],
      ["https://landing.example/api/stats"],
    );
    s.advance(1);
    await s.request("/api/stats", settings);
    assert.ok(s.calls.length > calls);
  });
}

test("five-second source deadline aborts a hanging source without losing the other count", async (t) => {
  const s = setup((url) =>
    url.endsWith("/graphql") ? new Promise(() => {}) : json([]),
  );
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const result = s.request();
  await new Promise(setImmediate);
  t.mock.timers.tick(5000);
  const body = await (await result).json();
  assert.equal(body.visits, null);
  assert.equal(body.downloads, 0);
  const cf = s.calls.find((c) => c.url.endsWith("/graphql"));
  const gh = s.calls.find((c) => !c.url.endsWith("/graphql"));
  assert.equal(cf.options.signal.aborted, true);
  assert.notEqual(cf.options.signal, gh.options.signal);
});

test("render loading, zero, formatted, partial, total failure and malformed values with one fetch", async () => {
  for (const [body, expected] of [
    [
      { visits: 0, downloads: 1234 },
      ["0", new Intl.NumberFormat().format(1234)],
    ],
    [{ visits: null, downloads: 4 }, ["Unavailable", "4"]],
    [{ visits: null, downloads: null }, ["Unavailable", "Unavailable"]],
    [{ visits: -1, downloads: "4" }, ["Unavailable", "Unavailable"]],
    [null, ["Unavailable", "Unavailable"]],
    ["network-error", ["Unavailable", "Unavailable"]],
  ]) {
    const elements = [
      { textContent: "Unavailable" },
      { textContent: "Unavailable" },
    ];
    const root = {
      querySelector: (selector) =>
        elements[selector.includes("visits") ? 0 : 1],
    };
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls++;
      assert.equal(url, "/api/stats");
      if (body === "network-error") throw new Error("offline");
      return json(body);
    };
    const result = loadStats(root);
    assert.deepEqual(
      elements.map((e) => e.textContent),
      ["—", "—"],
    );
    await result;
    assert.deepEqual(
      elements.map((e) => e.textContent),
      expected,
    );
    assert.equal(calls, 1);
  }
});
