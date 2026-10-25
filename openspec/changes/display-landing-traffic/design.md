## Context

`apps/landing` is a static Vite/TypeScript page hosted on Cloudflare Pages. Web Analytics is already enabled. The page links to assets in `Neil-urk12/agentica` GitHub Releases; the hero Download action only navigates to the download section. There is no existing statistics endpoint, server-side configuration, or analytics dependency.

## Goals / Non-Goals

**Goals:** Show two honest, accessible public statistics without exposing analytics credentials or disrupting the page when upstream services fail.

**Non-Goals:** New tracking events, click tracking, unique-user or installation counts, desktop telemetry, a dashboard, historical storage, or realtime updates.

## Decisions

### 1. Use explicit periods and existing source definitions

Display **Visits · last 30 days** using Cloudflare Web Analytics' visits metric for the configured production site over the rolling interval `[updatedAt - 30 days, updatedAt)`, in UTC. Do not substitute HTTP requests, page views, or unique visitors. Sum all returned groups and split the interval into supported API query windows if needed; reject incomplete results rather than silently undercounting. Analytics is only available since tracking began and can be sampled, so explain that visits are estimates.

Display **Downloads · all releases** by summing `download_count` for all assets of every public, non-draft release, including prereleases. Follow release and asset pagination to completion. Count each asset once by ID. Include backend binaries as well as installers; exclude GitHub's generated source archives, which are not release assets. Do not filter by the visitor's OS or the current package version. Failed pagination makes this metric unavailable, not a partial total. Explain that downloads are files downloaded across all releases, not people or installations; deleted releases/assets cannot contribute.

Lifetime visits would require historical persistence beyond Cloudflare's retention; that is unnecessary for this slice. Counting landing clicks would miss downloads from GitHub and command-line installs.

Sources: [Cloudflare metric definitions](https://developers.cloudflare.com/web-analytics/data-metrics/high-level-metrics/), [sampling and retention](https://developers.cloudflare.com/web-analytics/faq/), [GitHub release assets](https://docs.github.com/en/rest/releases/assets).

### 2. One same-origin Pages Function

Add `GET /api/stats` under `apps/landing/functions` and use platform `fetch` with independent five-second source timeouts. Restrict function routing to this endpoint via `_routes.json` in the landing build output so static files continue to use Pages' static serving. The verified Pages root is the repository root, with `pnpm run build:landing` and output `apps/landing/dist`; a thin `functions/api/stats.ts` re-export makes the landing implementation discoverable without changing deployment settings (user-approved).

Keep a scoped Cloudflare analytics read token in a Pages secret (`CF_ANALYTICS_API_TOKEN`), with server-side `CF_ACCOUNT_ID`, `CF_WEB_ANALYTICS_SITE_TAG`, and `CF_WEB_ANALYTICS_HOSTNAME`. Verify the deployed account's GraphQL schema, dataset access, site filter, visits aggregation, supported interval, and pagination before building the adapter. The server controls the site, repository, and date range; request parameters cannot change upstream queries. Use the public GitHub REST API without a credential initially; a server-only `GITHUB_TOKEN` can be supplied if its rate limit requires it. No credential uses Vite's public environment prefix.

Return only `{ visits, downloads, visitsFrom, visitsTo, updatedAt }`, with UTC ISO timestamps and independently nullable counts. Validate upstream envelopes (including GraphQL errors), pagination completeness, and nonnegative numeric counts; return safe integer counts, rounding the final estimated visits total once if necessary. Do not forward visitor identifiers or return upstream response bodies, account metadata, secrets, or errors. Reject non-GET methods with 405. Browser-direct API calls would expose credentials; a separate service or database adds no value here.

### 3. Cache at the edge, fetch once in the browser

Use the Pages/Workers Cache API with a canonical cache key for this deployment's `/api/stats`, ignoring query parameters. Cache complete successful snapshots for 15 minutes; cache partial or wholly unavailable snapshots for one minute to avoid retry storms. Preserve the snapshot's timestamps on a cache hit. Response headers alone are not the caching implementation. Edge caches are local to a data center, so this reduces calls rather than establishing a global quota. No KV, cron job, or stale snapshot store.

Fetch once after the page initializes. Render labelled text near the download action using existing type, spacing, and theme tokens. Reserve space, format numbers with `Intl.NumberFormat`, and keep it readable in mobile, reduced-motion, and camera layouts. Use `—` for loading and `Unavailable` for failed values; zero is reserved for a confirmed zero. A short explanation states the periods and metric limitations. Keep this setup independent of camera initialization so endpoint failure cannot prevent navigation or downloads. No animation or polling.

## Risks / Trade-offs

- Cloudflare token scope, schema access, or query limits differ by account → Verify one authenticated production-site query first; never fall back to a different metric. Missing access remains a deployment blocker for visits.
- Sampling, blocked beacons, delayed ingestion, and newly enabled tracking → Label visits as estimates for the last 30 days, covering available tracked history only.
- GitHub rate limits or deleted assets → Cache results, support a server-only token, and explain that the number reflects currently published assets.
- Cache expiry during an outage → Show independent unavailable states. Durable last-known totals are intentionally out of scope.
- A public function adds invocation/upstream costs → Restrict routing and use actual edge caching; inspect production usage after rollout.

## Migration Plan

1. Verify the production-site GraphQL query and existing GitHub release counts, then configure Pages secrets and server-side identifiers without committing values.
2. Deploy the function and static page together, with an explicitly scoped function route. Preview deployment without production analytics configuration shows unavailable values.
3. Compare the public values to the same Cloudflare time interval and a complete GitHub API aggregation; confirm cache hits, timestamps, safe responses, and normal download/navigation behavior.
4. Roll back the page/function deployment if needed. There is no data migration; existing Web Analytics collection remains independent.

## Open Questions

- Deployment inputs: Cloudflare account, production hostname, Web Analytics site tag, token scope, and Pages project root/build settings must be checked during implementation. No account access has been verified during proposal creation.
