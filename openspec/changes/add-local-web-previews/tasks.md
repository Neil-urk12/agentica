## 1. Preview contracts and persistence

- [x] 1.1 Add the versioned preview artifact and bounded create/update contracts in TypeScript and Rust; verify shared fixtures accept the same preview payloads and reject malformed, oversized, and unknown fields.
- [x] 1.2 Implement matching URL validation and current-host endpoint exclusions; verify IPv4/localhost support, IPv6 mutation/render rejection with existing-record compatibility, routes/query/fragments, omitted/default/invalid ports, credentials, numeric-host normalization, remote/LAN addresses, and Agentica endpoint aliases.
- [x] 1.3 Add the next schema migration and preview content storage using the established artifact pattern; verify an existing text/drawing/file workspace upgrades with stable identities, content, geometry, and valid foreign keys.
- [x] 1.4 Implement preview create/read/update/delete with revision checks and ordinary node placement; verify a persistence round trip, independent previews, stale-write rejection, and content cleanup after deletion.
- [x] 1.5 Extend workspace backup/restore validation for preview artifacts; verify a mixed-content backup round trip preserves URLs and layout and restored previews are revalidated under current host restrictions.
- [x] 1.6 Exclude preview configuration and content from canvas-agent outlines, reads, and mutations; verify mixed and preview-only selections cannot disclose URLs or page state, create/edit previews through tools, or silently broaden context.

## 2. Host embedding and isolation

- [x] 2.1 Add production/development frame policies and anti-framing protections for Agentica documents in desktop and browser delivery, retaining existing capability scopes; verify allowed loopback embedding, rejection of Agentica document framing, and continued operation of existing file previews.
- [x] 2.2 Implement the sandboxed preview frame with no credential forwarding, native HTTP proxy, privileged bridge, top navigation, or popup grants; verify an interactive local app can run scripts, submit forms, use its own origin storage, and receive development-server updates in each tested mode.
- [x] 2.3 Exercise a hostile local fixture that reads the parent, attempts native invocation and authenticated RPC, posts command messages, navigates the top window, opens popups, and redirects to Agentica endpoints; verify none grants application access in the supported browser and desktop webview before exposing creation controls.

## 3. Standalone canvas experience

- [x] 3.1 Add standalone preview creation and node rendering without project membership; verify multiple tiles can be added on an otherwise empty canvas and independently moved, resized, selected, and removed.
- [x] 3.2 Wire URL drafts and explicit submission into revision-checked editor saves; verify invalid input and save conflicts retain recoverable drafts and successful saves load the saved URL without changing other tiles.
- [x] 3.3 Implement automatic loading on canvas reopen, Reload to the configured URL, bounded loading feedback, and qualified recovery guidance; verify stopped-server, restarted-server, blocked-embedding, and stalled-load cases preserve controls and layout.
- [x] 3.4 Separate page input and scrolling from canvas dragging, panning, and shortcuts; verify form interaction and header dragging work independently, resizing changes logical viewport dimensions, and zoom alone does not.
- [x] 3.5 Add expansion with a single active page instance and return-focus behavior; verify expansion does not save new node bounds or create a concurrent second frame, and closing returns to the original tile layout.
- [x] 3.6 Complete keyboard navigation, labeled controls, visible focus, and responsive presentation; verify users can enter and leave page content and reach all tile controls in both themes, including a 680 by 800 CSS pixel viewport.
- [x] 3.7 Dispose frame resources and loading timers on node removal or canvas close; verify those actions leave externally started servers running and reopening the canvas loads saved previews automatically without a process-control request.

## 4. Integration checks and documentation

- [x] 4.1 Run relevant protocol, runtime, migration, and frontend checks using the repository's existing commands; verify preview integration introduces no failures and existing canvas text, drawings, files, tasks, and project session behavior remain usable.
- [x] 4.2 Exercise the full create, edit, navigate, reload, resize, expand, save, reopen, backup/restore, and unavailable-server workflow in desktop and detached local-browser modes; record the actual host/browser/webview versions and any unsupported cases with their recovery behavior.
- [x] 4.3 Document the user-managed server workflow, loopback URL scope, automatic loading, embedding limits, and verified support; add concise implementation rationale to CHANGELOG.md and verify documentation makes no server-sandbox or universal app-compatibility claims.
