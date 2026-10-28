# Local web preview validation

Repeat these checks when changing frame policies, the preview sandbox, or the
supported hosts. Use a disposable workspace and do not enter a real secret into
the fixture.

From the repository root, start the fixture in one terminal:

```sh
python3 -m http.server 19873 --bind 127.0.0.1 --directory tests/fixtures
```

For the desktop check, start the development app in another terminal:

```sh
pnpm dev
```

For the detached browser check, run `pnpm dev:backend` in another terminal and
start the frontend with `pnpm dev:web`. Open the
printed frontend URL and connect with the backend's key.

Open Canvas tools, choose **Add local web preview**, and create a preview for
`http://127.0.0.1:19873/web-preview-hostile.html`. Record the OS, browser or
webview version, and results for each launch mode:

- The fixture reports that the parent document is inaccessible, the native bridge
  is absent, the popup is blocked, and the unauthenticated RPC fails. Agentica
  remains open after the top-navigation and command-message attempts.
- Its form, local storage, internal link, scrolling, Reload, resizing, keyboard
  focus, and expansion work; expansion maintains one page instance and restores
  focus to its control. Canvas shortcuts do not fire while typing in the page.
- Redirecting the frame to the frontend does not display Agentica inside it.
  Test the backend endpoint as well in detached mode. Existing Word-file
  previews still render.
- Save the canvas, close and reopen it, stop and restart the fixture server, and
  retry with Reload. Confirm the tile and controls remain available. Verify a
  backup and restore and repeat with the restored preview.
- Reject `[::1]` URLs when creating or editing a preview. Existing IPv6 records
  must remain readable with an unsupported message and no iframe; changing to a
  supported URL must load the preview. Do not rewrite the hostname automatically.
- Fail a URL save before commit and lose a response after commit. Both the tile's
  Save and the banner's Retry save must recover the submitted draft; the frame
  must retain its last acknowledged URL until recovery succeeds. A conflicting
  remote URL must remain unchanged, with the local draft available in Copy edits.

A frame load event does not establish that the app is healthy; some local apps
forbid embedding or need unsupported browser features. The preview does not
manage or sandbox the external server.

Checks run so far, all on Fedora Linux 44 (WSL):

- Desktop development app (`pnpm dev`), WebKitGTK 2.54.1, checked manually:
  every fixture line passed, including no native bridge; Agentica stayed open
  after the top-navigation and command-message attempts; redirecting to the
  frontend left the frame blank; form, storage, Reload, resizing, expansion,
  save, reopen, server restart, and backup/restore worked. The production
  bundle (`tauri://` origin) was not checked separately.
- Detached development frontend, headless Chromium 155.0.8059.84, automated:
  frame isolation, file `srcdoc`, redirect protection, creation, invalid and
  valid URL editing, Reload, save-conflict drafts, expansion, saved geometry,
  canvas reopen, removal, server restart, stalled loads, and Vite hot updates.
  Follow-up regression checks cover URL-save retry before/after commit, IPv6
  creation rejection, and display/correction of an existing IPv6 record using
  an injected canvas-open response. Rust tests cover IPv6 backup/restore.
  A headed browser and Windows/macOS hosts have not been checked.

Run the automated detached-browser workflow separately with
`pnpm test:preview:browser`; it uses ports 1420 and 1421, so stop any existing
Agentica development servers first.
