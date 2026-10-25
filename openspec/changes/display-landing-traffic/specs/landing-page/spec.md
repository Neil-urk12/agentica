## ADDED Requirements

### Requirement: Public traffic and download statistics

The landing page SHALL display visits for the last 30 days and downloads across all public GitHub releases near its download action. Each count SHALL have an explicit label and reporting period. Visits SHALL use Cloudflare Web Analytics' visits metric for the configured production site and SHALL be described as estimates covering available tracked history. The page SHALL NOT present visits as unique visitors or downloads as unique users or installations. Section hash navigation SHALL NOT create additional custom tracking events.

#### Scenario: Both counts are available

- **WHEN** the statistics endpoint returns valid visits and download counts
- **THEN** the page displays both values with their respective periods
- **AND** the explanation identifies estimated visits and file downloads rather than people or installations

#### Scenario: Tracking was recently enabled

- **WHEN** less than 30 days of tracked history exists
- **THEN** the visits value reflects available observations within the last 30 days
- **AND** the page does not claim lifetime coverage or invent earlier visits

### Requirement: Complete source aggregation

The statistics service SHALL query visits for the configured production site over a rolling 30-day UTC interval, using the visits metric rather than page views or HTTP request totals. It SHALL sum the complete response across all required query windows and groups. Downloads SHALL sum the GitHub `download_count` of each asset once across every public, non-draft release in `Neil-urk12/agentica`, including prereleases and backend binaries. It SHALL follow all release and asset pagination and SHALL exclude generated source archives. Invalid, incomplete, timed-out, or rejected upstream responses SHALL make only the affected metric unavailable.

#### Scenario: Multiple pages and releases

- **WHEN** published releases and their assets span multiple API pages
- **THEN** downloads include all assets from every page exactly once, including older versions and prereleases
- **AND** drafts and generated source archives do not contribute

#### Scenario: A later page fails

- **WHEN** an upstream pagination or interval request fails after earlier requests succeeded
- **THEN** that metric is unavailable rather than showing a partial total

#### Scenario: Visits are grouped or sampled

- **WHEN** Cloudflare returns valid estimated visits across multiple groups or query windows
- **THEN** the service aggregates visits for the complete requested site interval and rounds the final total once if necessary
- **AND** it does not substitute page views, unique visitors, other sites, or raw response row counts

### Requirement: Protected and cached statistics endpoint

The site SHALL expose a read-only, same-origin `GET /api/stats` Pages Function. Upstream credentials SHALL stay server-side. The endpoint SHALL return only independently nullable visits/download counts and their reporting and snapshot timestamps. Counts SHALL be nonnegative safe integers when available. The server SHALL fix the upstream site, repository, and reporting interval; caller parameters SHALL NOT broaden or change these queries. Only the statistics route SHALL invoke the function. Complete snapshots SHALL use a real edge cache for 15 minutes and unavailable or partial snapshots for one minute, under a canonical key unaffected by caller query parameters. A cache hit SHALL preserve the original snapshot timestamps.

#### Scenario: Repeated requests

- **WHEN** the same edge cache receives requests for a still-fresh snapshot, including requests with extra query parameters
- **THEN** the endpoint returns that snapshot without new upstream calls
- **AND** its original timestamps remain unchanged

#### Scenario: Secrets and query selection

- **WHEN** a visitor requests statistics or supplies another hostname, repository, or period in query parameters
- **THEN** the response contains only the fixed site's public counts and timestamps
- **AND** no credentials, account metadata, visitor identifiers, or upstream error bodies are exposed

#### Scenario: Unsupported method or static asset

- **WHEN** a caller posts to the statistics endpoint
- **THEN** the endpoint responds with method not allowed and does not call upstream APIs
- **AND** ordinary static asset requests remain outside function routing

### Requirement: Statistics fail independently and preserve page usability

The page SHALL fetch statistics once without blocking existing initialization. It SHALL distinguish loading, unavailable, and confirmed zero values; failure SHALL NOT display a fabricated zero. One failed source SHALL NOT hide the other valid count. Statistics SHALL remain accessible as text in both themes, narrow and reduced-motion layouts, and the canvas tour. Navigation and release download links SHALL remain usable when scripts, configuration, or the endpoint are unavailable. No new analytics collection or desktop telemetry SHALL be introduced.

#### Scenario: Only visits are unavailable

- **WHEN** Cloudflare fails or analytics configuration is missing but GitHub succeeds
- **THEN** visits show an unavailable state while the download count remains visible
- **AND** navigation and download links continue to work

#### Scenario: Endpoint fails or JavaScript is disabled

- **WHEN** the endpoint fails or the browser cannot execute the statistics initialization
- **THEN** the page shows no invented statistic and preserves accessible labels and working download links

#### Scenario: Confirmed zero

- **WHEN** a source successfully reports a complete, valid total of zero
- **THEN** the page displays zero for that metric rather than an unavailable state
