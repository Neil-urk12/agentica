interface Env {
  CF_ANALYTICS_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  CF_WEB_ANALYTICS_SITE_TAG?: string;
  CF_WEB_ANALYTICS_HOSTNAME?: string;
  GITHUB_TOKEN?: string;
}

interface Context {
  request: Request;
  env: Env;
  waitUntil(promise: Promise<unknown>): void;
}

const REPO = "https://api.github.com/repos/Neil-urk12/agentica";
const DAY = 86_400_000;

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Invalid count");
  }
  return value;
}

function integer(value: unknown): number {
  const result = count(value);
  if (!Number.isSafeInteger(result)) throw new Error("Invalid integer");
  return result;
}

async function visits(env: Env, from: string, to: string, signal: AbortSignal) {
  const {
    CF_ANALYTICS_API_TOKEN: token,
    CF_ACCOUNT_ID: account,
    CF_WEB_ANALYTICS_SITE_TAG: site,
    CF_WEB_ANALYTICS_HOSTNAME: host,
  } = env;
  if (!token || !account || !site || !host)
    throw new Error("Missing analytics configuration");
  // No path/visitor dimensions: at most 31 UTC date groups cover the verified 93-day query limit.
  const query = `query Visits($account: string!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!) {
    viewer { accounts(filter: {accountTag: $account}) {
      rumPageloadEventsAdaptiveGroups(limit: 10000, filter: $filter) {
        sum { visits } dimensions { date }
      }
    } }
  }`;
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    signal,
    redirect: "error",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: {
        account,
        filter: {
          siteTag: site,
          requestHost: host,
          datetime_geq: from,
          datetime_lt: to,
        },
      },
    }),
  });
  if (!response.ok) throw new Error("Analytics rejected");
  const body = (await response.json()) as {
    errors?: unknown;
    data?: {
      viewer?: {
        accounts?: {
          rumPageloadEventsAdaptiveGroups?: { sum?: { visits?: unknown } }[];
        }[];
      };
    };
  };
  if (
    body.errors != null &&
    (!Array.isArray(body.errors) || body.errors.length)
  ) {
    throw new Error("Analytics errors");
  }
  const accounts = body.data?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1)
    throw new Error("Invalid account response");
  const groups = accounts[0]?.rumPageloadEventsAdaptiveGroups;
  if (!Array.isArray(groups) || groups.length >= 10000)
    throw new Error("Incomplete analytics");
  return integer(
    Math.round(
      groups.reduce((sum, group) => sum + count(group.sum?.visits), 0),
    ),
  );
}

async function* pages(
  path: string,
  env: Env,
  signal: AbortSignal,
): AsyncGenerator<unknown[]> {
  let page = 1;
  while (true) {
    signal.throwIfAborted();
    const url = `${REPO}${path}?per_page=100&page=${page}`;
    const response = await fetch(url, {
      signal,
      redirect: "error",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "Agentica-landing-stats",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${env.GITHUB_TOKEN}` }
          : {}),
      },
    });
    if (!response.ok) throw new Error("GitHub rejected");
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length > 100)
      throw new Error("Invalid GitHub page");
    let next = false;
    const links = response.headers.get("Link");
    if (links) {
      for (const link of links.split(",")) {
        const match = link.trim().match(/^<([^>]+)>;\s*rel="([^"]+)"$/);
        if (!match) throw new Error("Invalid pagination");
        if (match[2] !== "next") continue;
        const target = new URL(match[1]!);
        // Never send a server credential to a URL supplied by an upstream response.
        if (
          target.origin !== "https://api.github.com" ||
          target.pathname !== new URL(url).pathname ||
          target.username ||
          target.password ||
          target.hash ||
          target.searchParams.size !== 2 ||
          target.searchParams.get("per_page") !== "100" ||
          target.searchParams.get("page") !== String(page + 1)
        ) {
          throw new Error("Invalid next page");
        }
        next = true;
      }
    }
    yield rows;
    if (!next && rows.length < 100) return;
    page++;
  }
}

async function downloads(env: Env, signal: AbortSignal) {
  const releases = new Set<number>();
  const assets = new Set<number>();
  let total = 0;
  for await (const rows of pages("/releases", env, signal)) {
    for (const row of rows) {
      const release = row as { id?: unknown; draft?: unknown } | null;
      if (!release || typeof release.draft !== "boolean")
        throw new Error("Invalid release");
      const id = integer(release.id);
      if (release.draft || releases.has(id)) continue;
      releases.add(id);
      for await (const rows of pages(`/releases/${id}/assets`, env, signal)) {
        for (const row of rows) {
          const asset = row as {
            id?: unknown;
            download_count?: unknown;
          } | null;
          if (!asset) throw new Error("Invalid asset");
          const assetId = integer(asset.id);
          const value = integer(asset.download_count);
          if (assets.has(assetId)) continue;
          assets.add(assetId);
          total = integer(total + value);
        }
      }
    }
  }
  return total;
}

async function source(
  read: (signal: AbortSignal) => Promise<number>,
): Promise<number | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      read(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Source timeout"));
        }, 5000);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer!);
  }
}

export async function onRequest(context: Context): Promise<Response> {
  if (context.request.method !== "GET") {
    return new Response(null, { status: 405, headers: { Allow: "GET" } });
  }
  const url = new URL(context.request.url);
  const key = new Request(`${url.origin}/api/stats`);
  const cache = (caches as CacheStorage & { default: Cache }).default;
  const cached = await cache.match(key);
  if (cached) return cached;
  const now = new Date();
  const updatedAt = now.toISOString();
  const visitsFrom = new Date(now.getTime() - 30 * DAY).toISOString();
  const [visitCount, downloadCount] = await Promise.all([
    source((signal) => visits(context.env, visitsFrom, updatedAt, signal)),
    source((signal) => downloads(context.env, signal)),
  ]);
  const ttl = visitCount !== null && downloadCount !== null ? 900 : 60;
  const response = Response.json(
    {
      visits: visitCount,
      downloads: downloadCount,
      visitsFrom,
      visitsTo: updatedAt,
      updatedAt,
    },
    { headers: { "Cache-Control": `public, max-age=${ttl}` } },
  );
  context.waitUntil(cache.put(key, response.clone()));
  return response;
}
