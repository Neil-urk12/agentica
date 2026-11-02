## Why

People working on local web apps need to inspect and use those apps beside their canvas notes and development work. A persistent standalone preview keeps that view on the canvas while leaving server startup and shutdown in the user's existing workflow.

## What Changes

- Add standalone web-preview nodes with an editable loopback HTTP(S) URL, saved placement and dimensions, and interactive page content.
- Automatically load saved previews when reopening a canvas; retain the configured URL and provide Reload when a server is unavailable or embedding fails.
- Provide an expanded view without changing the saved tile geometry, and separate page interaction from canvas dragging and shortcuts.
- Isolate executable preview content from Agentica's UI, credentials, runtime commands, and native capabilities in both desktop and detached browser modes.
- Keep server execution user-managed. This slice does not start, stop, discover, or adopt development servers, attach previews to project groups, or expose preview contents to agents.

## Capabilities

### New Capabilities

- `local-web-previews`: Persistent standalone canvas previews for user-started local web apps, including URL editing, automatic loading, interaction, recovery, and isolation.

### Modified Capabilities

None. Project membership and terminal lifecycle requirements remain unchanged.

## Impact

- Extend the TypeScript protocol, mirrored Rust validation, and SQLite artifact storage for preview configuration, with migration and revision-checked mutations.
- Extend the canvas editor and Svelte node rendering with preview creation, controls, expansion, and focus behavior.
- Adjust embedding policies in the desktop host and browser delivery path without granting preview origins privileged access.
- Review workspace backup/restore and agent-context filtering for the new artifact type. Add focused persistence, URL-policy, isolation, and launch-mode checks; record completed implementation rationale in the changelog when implemented.
- Reuse native frame rendering; no new dependency is proposed.
