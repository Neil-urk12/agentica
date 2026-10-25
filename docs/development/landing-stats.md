# Landing activity statistics

The counts sit below the hero actions, outside the installation card; a native
"About these counts" disclosure contains their full explanation.
The landing page fetches `/api/stats` once, independently of camera setup. Visits
are Cloudflare Web Analytics estimates over the rolling UTC interval
`[visitsFrom, visitsTo)`, exactly 30 days ending at `updatedAt`. They cover available
tracked history, subject to sampling, blocked beacons and ingestion delays.
Downloads sum file downloads across all currently published GitHub release assets
in `Neil-urk12/agentica`, including prereleases and backend binaries. They are not
people or installations. Generated source archives and deleted assets do not count.
There is no new tracking, polling, database or desktop telemetry.

## Pages deployment

The production project is `aagentica` (`aagentica.pages.dev`). Keep its existing
repository root, build command `pnpm run build:landing`, and output directory
`apps/landing/dist`. Pages discovers `functions/api/stats.ts` at the repository
root; it re-exports `apps/landing/functions/api/stats.ts`. Vite copies
`apps/landing/public/_routes.json` into `dist`, restricting function invocation
to `/api/stats`. Static assets and other routes remain static.

Configure these **server-side** Pages bindings for the production environment:

| Binding                     | Value / purpose                                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CF_ANALYTICS_API_TOKEN`    | Secret: an API token with account **Account Analytics: Read** permission scoped to the production account. Verify dataset access before rollout. Do not deploy the local Wrangler OAuth token. |
| `CF_ACCOUNT_ID`             | `46d4dc27915004623364d5865e5bbe65`                                                                                                                                                             |
| `CF_WEB_ANALYTICS_SITE_TAG` | `c5b854ecbdd947b1aa146df290ed83ea` (site tag, not the public beacon token)                                                                                                                     |
| `CF_WEB_ANALYTICS_HOSTNAME` | `aagentica.pages.dev`                                                                                                                                                                          |
| `GITHUB_TOKEN`              | Optional secret for higher GitHub API limits; fine-grained Contents: Read access to this public repository is sufficient.                                                                      |

Do not prefix these with `VITE_` or put credentials in source, build artifacts,
URLs or browser code. Identifiers above are non-secret. Configure preview bindings
separately; leaving analytics unconfigured intentionally returns `visits: null`.
GitHub remains independent. Do not silently point previews at another metric/site.

`pnpm dev:landing` and Vite preview serve static files without Pages Functions;
statistics show Unavailable. To exercise Functions locally, build the landing app,
then run `wrangler pages dev apps/landing/dist` **from the repository root**.
Use ignored `.dev.vars` for local server credentials. The browser tests instead
serve the production build with a stub endpoint, without any credentials.

## Aggregation and caching

Cloudflare is queried with fixed account, site and hostname filters using
`rumPageloadEventsAdaptiveGroups.sum.visits`, grouped by UTC date. A single 30-day
query fits the verified limits (93-day maximum interval, 184-day retention,
10,000 groups). There are at most 31 UTC date groups; responses reaching the group
limit are rejected. Sum all groups and round the final estimate once. No page-view,
HTTP request or unique-visitor fallback is used. GraphQL errors, invalid envelopes,
invalid counts and source timeouts make only visits unavailable.

GitHub release and asset endpoints are paginated independently using `per_page=100`.
Follow validated next-page links; probe another page if a full page lacks a link.
Never trust embedded release assets as a complete list. Skip drafts, deduplicate
release/asset IDs, include prereleases, validate safe integer counts and discard
the entire downloads result if any page fails. Requests use fixed GitHub URLs;
pagination cannot send the optional credential to another host.

Each source has its own five-second deadline, including all of its pages. The
response contains only `visits`, `downloads`, `visitsFrom`, `visitsTo`, `updatedAt`.
Unavailable counts are null; confirmed zero is zero. Non-GET methods return 405.
Caller query parameters and visitor headers never select or reach upstream queries.

The actual Cache API key is the deployment origin plus `/api/stats`, with no query
parameters. Complete snapshots cache for 900 seconds; partial or unavailable ones
for 60 seconds. Hits preserve the original timestamps. Cache storage is local to
each Cloudflare data center, not a global request quota. Browser responses have
the same public max-age. There is no durable last-known snapshot.

## Verification and rollout

On 2026-10-27, authenticated read-only introspection confirmed `sum_visits`, date
groups, the site/hostname filters and the limits above. A production-site query and
the implemented adapter both returned zero visits. A full public GitHub aggregation
returned 8 downloads across 12 assets: v0.1.1 had six assets / zero downloads;
v0.1.0 had six assets / eight downloads. There were no current prereleases;
multi-page, duplicate and prerelease behavior is covered with fixtures in tests.
The live adapter snapshot used the interval
`2026-09-27T12:24:42.628Z` through `2026-10-27T12:24:42.628Z`.

Run:

```sh
node --test tests/landing-stats.test.mjs tests/landing-camera.test.mjs
node --test tests/landing-stats-browser.test.mjs
pnpm --filter @agentica/landing check
pnpm build:landing
```

The focused tests also run in `pnpm test:unit` and its coverage command. The browser
test runs in the full `node --test` suite, builds the landing app itself, and uses
the repository's Chrome/Edge helper (`CHROME_PATH` can select a binary).

Production deployment and real Cloudflare edge cache hits have **not** been
verified. After deploying, compare `/api/stats` to a direct query using its exact
`visitsFrom`/`visitsTo` and a complete fresh GitHub aggregation. Repeated requests
from the same data center, including extra query parameters, should preserve the
snapshot timestamps and avoid new upstream requests until expiry. Confirm this
with Pages invocation/upstream request observations; a Cache-Control header alone
does not prove a cache hit. Check both normal and failed stats responses alongside
hash navigation and actual release links. Do not treat today's live totals as
permanent expectations.

Rollback by restoring the previous Pages deployment. No data migration is needed;
existing Web Analytics collection is independent of this display.

References: [Cloudflare dataset limits](https://developers.cloudflare.com/analytics/graphql-api/features/discovery/settings/),
[API token configuration](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/),
[Pages Functions discovery](https://developers.cloudflare.com/pages/functions/get-started/),
[routing](https://developers.cloudflare.com/pages/functions/routing/),
[GitHub releases](https://docs.github.com/en/rest/releases/releases#list-releases),
[release assets](https://docs.github.com/en/rest/releases/assets#list-release-assets).
