## Why

Cloudflare Web Analytics is enabled, but visitors cannot see the site's traffic or Agentica's release download activity. Show two clearly labelled public counts using the existing analytics and GitHub Releases rather than collecting new events.

## What Changes

- Display visits for the last 30 days and lifetime release asset downloads on the landing page, with explicit periods and a short explanation of what each measures.
- Add a cached, same-origin Cloudflare Pages Function that reads the configured site's Web Analytics and the repository's GitHub release assets; credentials stay server-side.
- Show unavailable metrics honestly and keep navigation and downloads usable when statistics fail.
- Document deployment configuration and verify source aggregation, caching, failure handling, and accessible rendering.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `landing-page`: Add public visit and release-download statistics with defined periods, protected upstream access, caching, and graceful failure behavior.

## Impact

- Landing markup, styles, and client initialization in `apps/landing`; a Pages Function and explicit static-route configuration for its deployment.
- Cloudflare Web Analytics GraphQL access, server-side site/account configuration and read-only token; GitHub Releases REST pagination for `Neil-urk12/agentica`.
- Focused tests, deployment documentation, and implementation rationale in `CHANGELOG.md` when implemented. No new runtime dependency or desktop telemetry.
