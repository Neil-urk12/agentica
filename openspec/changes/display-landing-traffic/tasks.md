## 1. Verify sources and deployment

- [x] 1.1 Verify an authenticated Web Analytics GraphQL query for the production site: visits field, account/site/hostname filters, rolling UTC interval, query limits, and complete aggregation. Record required token permissions and identifiers without secrets; do not substitute another metric if access is unavailable.
- [x] 1.2 Confirm GitHub release and asset pagination and compare a full download-count aggregation including prereleases to published release assets. Confirm the Pages project root and Vite build output support `apps/landing/functions`.

## 2. Implement the cached statistics endpoint

- [x] 2.1 Add `GET /api/stats` with independent five-second upstream timeouts, validated source responses, complete aggregation, nullable counts, explicit visit-window/snapshot timestamps, and server-only credentials. Reject non-GET methods and ignore caller query selectors.
- [x] 2.2 Add canonical edge caching for 15-minute complete and one-minute partial/unavailable snapshots. Restrict Pages function invocation to `/api/stats` using build-output `_routes.json`.
- [x] 2.3 Add focused tests for multi-page releases/assets, prereleases, duplicate assets, zero values, visit windows/groups, source errors (including GraphQL errors and incomplete pagination), missing configuration, method rejection, canonical cache hits/expiry, preserved timestamps, independent failures, and absence of private data. Include these tests in the existing test command.

## 3. Display public counts

- [x] 3.1 Add labelled visits/downloads text near the download action, with explicit periods and concise explanations of estimated visits and file downloads. Fetch once independently of camera initialization; render loading, unavailable, zero, and successful states without layout shifts.
- [x] 3.2 Verify rendering with a stubbed endpoint for both-success, partial-failure, and total-failure responses; check narrow/reduced-motion and both themes, accessible labels, no JavaScript, hash navigation, and unchanged release-download targets.

## 4. Document and validate

- [x] 4.1 Document Pages root/build/function routing, server-side variables/secrets, local and preview behavior, metric periods and limitations, cache behavior, and rollback. Record implementation rationale in `CHANGELOG.md`.
- [x] 4.2 Run the focused endpoint/rendering tests, existing landing camera tests, landing TypeScript check, and production landing build; inspect the output for the route configuration and accidental credentials.
- [ ] 4.3 After deployment, compare counts to the same Cloudflare interval and complete GitHub aggregation; confirm actual edge cache hits and working navigation/downloads. Record any unavailable production verification explicitly.

## Verification notes

Live source access and the implemented adapter were verified on 2026-10-27: 0 visits and 8 downloads. The focused/unit/browser tests, landing TypeScript check, Vite build, and Wrangler Functions compilation pass. Production deployment and actual edge cache hits remain unverified; task 4.3 is pending deployment. See `docs/development/landing-stats.md` for configuration, evidence, and rollout checks.
