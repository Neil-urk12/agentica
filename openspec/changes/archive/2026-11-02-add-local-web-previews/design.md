## Context

See `proposal.md` for motivation and `specs/local-web-previews/spec.md` for the behavior contract. The confirmed choices are user-managed servers, standalone canvas tiles, and automatic loading when reopening the canvas.

The shared Svelte UI runs inside Tauri or a local browser. Ordinary canvas nodes reference typed artifacts and hold their own geometry; project session tiles follow a different ownership path. The current artifact union contains text, drawing, and file, and SQLite constrains the stored artifact type. Reads and mutations validate through mirrored TypeScript and Rust contracts, with revision-checked saves.

The desktop CSP currently falls back to `default-src 'self'` for frames. The main desktop capability includes runtime/session operations and provider HTTP access. Executable preview content must not inherit that context. Existing document previews use a non-scripted iframe and are not sufficient for an interactive web app.

This change warrants a design because it crosses persistence, protocol, rendering, and both hosts' trust boundaries.

## Goals / Non-Goals

**Goals:**

- Reuse ordinary artifact/node ownership, revision checks, selection, placement, and deletion.
- Keep persisted preview configuration independent of ephemeral browser page state and external process state.
- Render ordinary local frontend apps without a privileged fetch proxy or runtime-owned server lifecycle.
- Make isolation and loading limitations testable across both launch modes.

**Non-Goals:**

- A browser with tabs, history controls, developer tools, arbitrary remote browsing, or an authentication-popup workflow.
- Server discovery, URL extraction from terminal output, dependency installation, process supervision, or project membership.
- Persisting cookies, DOM, live navigation history, or application health state in the workspace.
- Agent browsing, screenshots, DOM extraction, or model-created preview nodes.
- Sandboxing the server process or restricting all outgoing requests made by its page.

## Decisions

### 1. Persist a preview artifact and an ordinary canvas node

Introduce a versioned `web-preview` artifact whose content is the configured `url`. Reuse node geometry and optional ordinary canvas grouping; do not add a project ID or a session record. Add bounded create/update operations that use existing canvas/artifact revision conventions. Propose a 2,048-character URL limit, shared by TypeScript and Rust validation.

Add a content table keyed using the established artifact content-store pattern, extend the artifact type constraint through a versioned migration, and update serialization and content deletion. Review every exhaustive type branch, including backup/restore and agent reads. Preview artifacts must be explicitly excluded from agent context and tools rather than accidentally falling through to text handling. A preview-only selection must not broaden context to unrelated nodes.

Alternative: a new session tile kind would require a project association and inherit lifecycle concepts that do not apply. Keeping the URL only in frontend state would lose it on reopen and bypass workspace ownership.

### 2. Validate configuration without fetching it through the runtime

Parse absolute URLs and accept new or edited HTTP(S) URLs with the literal host spellings `localhost` and `127.0.0.1`. Chromium rejects IPv6 literals in CSP host sources, so reject `[::1]` mutations and rendering with an explicit unsupported message. Keep the storage schema and backup validator able to read existing IPv6 records, allowing users to edit or remove them without losing the canvas. Validate both the supplied authority and parsed destination so parser normalization does not expand the accepted input to alternate numeric addresses or confusing host spellings. Reject user information, control characters, empty explicitly supplied ports or invalid ports, and other schemes or hosts. Omitted ports use HTTP(S) defaults. Preserve the accepted hostname and route, query, and fragment; do not turn `localhost` into `127.0.0.1` or vice versa.

Rust validation is authoritative for persisted input, and equivalent frontend checks provide immediate feedback. At render time, additionally exclude the current frontend origin and Agentica's configured UI/runtime listening endpoints across the accepted loopback aliases. Derive those exclusions from the active host configuration rather than only hard-coding the default ports. Recheck restored data, including backups opened under a different host configuration.

Do not probe app URLs from the Rust runtime, use the provider HTTP plugin, attach the connection key, or proxy responses. The browser/webview requests the app directly. In detached mode, loopback therefore means the frontend machine; this change targets local-browser use, not remote backend forwarding.

Alternative: a runtime proxy could inspect status codes but would add privileged network access, rewrite origin behavior, and complicate assets, cookies, and HMR.

### 3. Use a sandboxed cross-origin frame with no application bridge

Use a native iframe with `sandbox="allow-scripts allow-same-origin allow-forms"` and `referrerpolicy="no-referrer"`. Script execution and the app's own origin support typical frontend routing, storage, assets, and development-server behavior. This combination is only acceptable because Agentica's own origins are excluded and cannot become an embedded privileged document. Do not allow top navigation, popups, downloads, or a preview-specific native/message bridge. Grant no device permissions through the frame.

Update production and development frame policies to permit the supported loopback sources while retaining the existing script restrictions on Agentica. Keep preview URLs out of Tauri remote capability grants. Protect Agentica documents against framing at every delivery surface, including Vite development delivery and bundled browser delivery, so redirects to an app endpoint cannot bypass initial URL validation. Where `frame-ancestors 'none'` is used, deliver it as an HTTP response header; a meta tag is insufficient. Keep application custom schemes outside allowed preview frame destinations.

Check actual behavior on the supported desktop webview and browser. In particular, test redirects, frame ancestry, parent-document access, native invocation, and command-shaped messages. If a host cannot enforce separation, retain an unavailable-preview state with recovery controls rather than weakening capabilities. A localhost app can use its own network access and credentials; loopback validation describes the configured destination, not a network sandbox for its scripts.

Alternative: an opaque-origin frame without `allow-same-origin` offers stronger default separation but breaks common origin-dependent app behavior. An unsandboxed iframe or privileged native webview would expand permissions unnecessarily. No new dependency is proposed.

### 4. Keep frame activity separate from workspace saves

Auto-load after a saved preview passes validation when its canvas opens. Track per-node transient state such as loading attempt, observation of the frame load event, uncertain failure guidance, and a reload generation. Dispose frames when their canvas is closed or a node is removed, without sending any external process-control operation.

Editing a URL uses a local draft and an explicit submit action. Submission places the URL in the editor's dirty document, using the existing attempted-content tracking and revision reconciliation for retries and recovery copies. The frame reads the last acknowledged URL separately, so neither failure nor an in-flight save navigates it. The tile's Save and the banner's Retry save can retry a failed write or adopt a committed write whose response was lost; unrelated remote changes remain conflicts. Reload returns to the acknowledged URL even if the embedded app previously navigated elsewhere. Ordinary in-page navigation does not mutate the artifact; the host cannot reliably inspect a cross-origin page's location.

Treat a frame load event only as the end of an observed load attempt, not a health check. Use a bounded 15-second loading indicator followed by neutral guidance such as "The page may be unavailable or may block embedding. Check the app, then Reload." Keep controls available throughout. Handle host-observable policy errors when available, but do not rely on iframe `error` events to diagnose network or framing failures. Clear old timers when the URL changes, the frame reloads, or the node is disposed.

Alternative: server probes and DOM inspection would violate the separation above; an indefinite spinner would leave unavailable apps without a usable recovery path.

### 5. Separate page interaction from tile movement and expansion

The header owns dragging and URL/Reload/expand/remove controls. The frame body owns pointer, scroll, and keyboard interaction; use the existing canvas gesture-exclusion conventions around it. Node dimensions define the frame's logical viewport, while the canvas transform supplies visual zoom.

Provide keyboard navigation through labeled controls into and out of the embedded document without depending on intercepting cross-origin page keystrokes. Expansion uses a single active frame and restores focus to its invoking control when closed. Prefer retaining the frame DOM instance while changing its presentation; if a host requires remounting, dispose the prior instance before mounting its replacement. Workspace persistence does not promise preservation of transient in-page state across remounts. Expansion geometry is transient and does not overwrite the saved node bounds.

Alternative: mounting a second iframe for expansion would duplicate requests, timers, and side effects. Dragging through the frame body would interfere with the app's normal controls.

## Risks / Trade-offs

- [Some apps forbid framing, require popups, or depend on unavailable webview features] -> Preserve the URL and recovery controls, explain embedding limits, and do not weaken the sandbox to claim compatibility.
- [Cross-origin frames obscure exact load failures] -> Use bounded loading feedback with qualified guidance and manual Reload; do not advertise an unverified app-health state.
- [Allowing the app's own origin supports storage but increases reliance on ancestry and capability controls] -> Verify redirect-to-Agentica and native-access attempts in both modes before claiming support; leave remote capability grants absent.
- [Automatic loading runs page JavaScript and contacts an already-running app] -> This is the agreed reopen behavior. Never translate it into server startup, and do not claim that preview pages have no side effects.
- [Multiple live previews consume memory and continue their own work while mounted] -> Keep one frame per open tile, never duplicate for expansion, and dispose on canvas close or removal. Avoid background server supervision or health polling.
- [New artifact types affect migrations, export, and agent filtering] -> Add targeted migration, round-trip, deletion, and mixed-context checks before shipping.

## Migration Plan

1. Follow the next available schema migration version at implementation time. Rebuild the constrained artifact table using the established migration pattern, preserve IDs and foreign keys, and add preview content storage.
2. Update both contract implementations, persistence reads/writes/deletion, backup validation, and agent filtering together. Exercise upgrades from existing text/drawing/file workspaces before exposing preview creation.
3. Add host embedding protections and verify separation with a minimal interactive app and an adversarial redirect/script fixture in both launch modes.
4. Expose canvas creation and controls, then check persistence, automatic loading, expansion, gestures, recovery, themes, and narrow viewports.
5. Record only the launch-mode/platform checks actually performed and the implementation rationale in the changelog.

Rollback must preserve user data: a previous application version may reject a workspace containing the new artifact type. Use a pre-upgrade workspace backup with a compatible older binary rather than silently stripping preview records or attempting an unsupported schema downgrade.
