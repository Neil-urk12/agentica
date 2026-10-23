# M0-09: Linux interactive desktop and launch lifecycle

**Result: passed on the named Linux development desktop, 12 October 2026.**
An actual Tauri release window and a headed browser were launched and exercised.
These observations supplement the automated tests; compilation and headless
checks alone were not used to claim interactive acceptance. No application
failure requiring a code fix was found, so no duplicate regression tests were
added. M0-10, M0-11, ClickUp, and release acceptance are outside this record.

## Environment and isolation

- Fedora Linux 44 x86_64, kernel `7.1.8-200.fc44.x86_64`, niri 26.04 Wayland
  desktop. Direct Wayland launch used `wayland-1`; full keyboard interaction
  used GTK's X11 backend through XWayland on display `:0`.
- GTK 3.24.52, WebKitGTK 2.52.5; Node.js 24.16.0, pnpm 11.6.0, Rust 1.96.0.
  Installed agent-browser 0.27.1 drove headed Chrome for Testing 153.0.8010.12
  with an isolated profile. Native controls were exercised through AT-SPI
  actions/focus and XTest keyboard input; native screenshots came from the
  specific X11 window, not a browser rendering of the same page.
- Starting tracked revision: `02953e3`. Git had no staged or unstaged tracked
  diffs; existing untracked project documents, another Agentica window, and
  an existing Vite process were preserved. No staging or commits were performed.
- All application data lived under the newly created
  `/tmp/agentica-m009.i0MlSG/{native-data,browser-data}`. Backend keys stayed in
  temporary logs and browser memory, with test output redacted. Evidence images
  show only test data and masked password fields.
- Port 1420 already belonged to Vite in this project's `apps/desktop` directory;
  browser checks reused it without stopping or reconfiguring it. Port 1421 was
  free before backend tests. Ordinary sandbox escalation provided desktop,
  accessibility-bus, process inspection, and loopback access.

## Commands and reproduction

Run from the repository root with the existing dependencies. Display/session
variables were recovered by read-only inspection of process ancestry; a shell
without them is not proof that this host lacks a desktop.

```sh
pnpm build:desktop
pnpm check
pnpm run lint
pnpm check:rust
pnpm test
pnpm test:rust
```

The native executable tested was `target/release/agentica-desktop`, with its
embedded frontend and linked runtime. Its launch commands were:

```sh
AGENTICA_DATA_DIR=/tmp/agentica-m009.i0MlSG/native-data \
  DISPLAY=:0 WAYLAND_DISPLAY=wayland-1 XDG_RUNTIME_DIR=/run/user/1000 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  ./target/release/agentica-desktop

AGENTICA_DATA_DIR=/tmp/agentica-m009.i0MlSG/native-data \
  DISPLAY=:0 GDK_BACKEND=x11 XDG_RUNTIME_DIR=/run/user/1000 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  ./target/release/agentica-desktop
```

Detached checks used the freshly built debug executable:

```sh
AGENTICA_DATA_DIR=/tmp/agentica-m009.i0MlSG/browser-data \
  ./target/debug/agentica-backend

DISPLAY=:0 XDG_RUNTIME_DIR=/run/user/1000 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  agent-browser --session agentica-m009-i0MlSG --headed \
  --executable-path /home/imisenak/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
  --profile /tmp/agentica-m009.i0MlSG/chromium-profile \
  open http://127.0.0.1:1420

AGENTICA_DATA_DIR=/tmp/agentica-m009.i0MlSG/browser-data PATH='' \
  /home/imisenak/Documents/projects/oss/agentica/target/debug/agentica-backend
```

For a new run, create a fresh directory with `mktemp -d`, use its paths instead,
set the local display/session variables, and start `pnpm dev:web` if port 1420
is free. Never stop an unrelated server to free the ports. The checks below can
also be repeated manually using the named UI controls. The temporary automation
helpers were verification aids, not new application launch scripts.

## Observed interactive behavior

| Check                                   | Executed behavior and result                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native launch and health                | Direct Wayland launch created a compositor window and showed **Backend connected** automatically. Closing that specific window exited with status 0. Full interaction then used the same release app through XWayland.                                                                                                                                                                             |
| Native canvas/text and autosave         | Created **M0-09 Native Linux** / **Linux lifecycle**, added a text node, typed two lines, edited x/y/width/height to 180/130/300/190, changed pan and zoom, and pressed **Zoom In**. The UI showed **Saved**; independent reads of the test database confirmed text, geometry, and viewport. Fractional zoom `1.25` and x `-50.5` also accepted real keyboard input.                               |
| Native reopen                           | **Close workspace**, select saved workspace/canvas, and open restored the text. Normal window close exited with status 0; relaunch and UI reopen restored committed text and geometry/view fields.                                                                                                                                                                                                 |
| Native visible save failure             | A separate SQLite connection held `BEGIN EXCLUSIVE` on the test database. Typing triggered autosave failure: **Unsaved changes — save failed**, with the actionable database-lock error. Draft text remained in the editor and **Copy unsaved edits** recovery output.                                                                                                                             |
| Native close protection and recovery    | A real `WM_DELETE_WINDOW` close request while dirty kept the window alive and displayed **Keep this window open until changes are saved**. Releasing the SQLite lock and selecting **Retry save** saved the retained text. A subsequent normal close exited with status 0.                                                                                                                         |
| Native reconnect and abrupt exit        | **Reconnect** succeeded through Tauri IPC. After a confirmed save, `SIGKILL` terminated only the test host (status 137). Relaunch acquired the writer lock and reopened the last committed text; `PRAGMA integrity_check` returned `ok`. There is no independent desktop backend to kill while retaining this linked-runtime window.                                                               |
| Detached authentication                 | A wrong key produced **Invalid connection key** and disabled workspace operations. The current key plus explicit **Reconnect** showed **Backend connected**. The password field masked the key; localStorage and sessionStorage were empty.                                                                                                                                                        |
| Browser editing and persisted reopen    | Created **M0-09 Browser Linux** / **Detached lifecycle**, typed two lines, changed geometry and viewport, and dragged the node with pointer input. The node moved from x/y 120/80 to 160/100. **Saved**, workspace close/open, and canvas reopen restored text, dragged position, and zoom `1.25`.                                                                                                 |
| Application tab closure                 | With edits saved, opened a blank companion tab and closed the actual application tab. An authenticated HTTP ping still returned `status: ok`. A new application tab had an empty key field, required **Connect**, and reopened saved content. Tab closure did not imply server shutdown.                                                                                                           |
| Backend termination and fault isolation | `SIGKILL` of the owned detached backend returned status 137. The heartbeat visibly reported **Backend unavailable**. Typing retained a draft and showed save failure; **Zoom In** still worked, and recovery output contained the unsaved text.                                                                                                                                                    |
| Key rotation and explicit reconnect     | Restarting on the same data produced a different key. Failure remained after six seconds with the backend running; **Reconnect** with the old key was rejected. Replacing the key alone still did not reconnect after another six seconds. Explicit **Reconnect** with the new key, then **Retry save**, saved the retained draft. Browser storage remained empty and database integrity was `ok`. |
| Detached shutdown and reopen            | `SIGTERM` stopped the owned backend with status 0. Restart with an empty PATH bound the same port, generated another key, and UI reopen restored the recovered text. Closing the entire isolated browser still left the server answering authenticated ping. `SIGINT` (the Ctrl+C signal) then stopped it with status 0 and released port 1421.                                                    |

Screenshots were visually inspected:
[native saved canvas](evidence/m0-09-linux/native-saved.png),
[native failure and close protection](evidence/m0-09-linux/native-failure.png),
[browser failure with retained draft](evidence/m0-09-linux/browser-failure.png),
[browser reopen after restart](evidence/m0-09-linux/browser-reconnected.png).
Assertions on control values, persisted rows, process exits, and authenticated
HTTP responses established the behavior beyond these screenshots.

## Automated verification and cleanup

- `pnpm build:desktop`: passed; release binary and embedded frontend built,
  followed by the executed native checks above. No installer was built.
- `pnpm check` and `pnpm run lint`: passed. The RTK command rewrite initially
  selected absent ESLint for lint; `rtk proxy pnpm run lint` ran the project's
  actual Oxlint script successfully.
- `pnpm check:rust`: passed rustfmt and Clippy with warnings denied.
- `pnpm test`: passed 17 Rust unit tests, 2 Rust contract tests, and 13 Node
  tests, including real HTTP lifecycle/key rotation, save failure/recovery,
  workspace contention, and persistence round-trips.
- `pnpm test:rust`: passed the workspace suite (17 unit / 2 contract tests).
  An initial sandbox attempt could not bind loopback; a retry collided with
  the still-running owned test backend. After identifying and stopping that
  backend, the escalated run passed. Neither was an application defect.
- Changed verification documents passed Oxfmt; `git diff --check` passed.
- Only owned test windows/processes were closed or signaled. Test data, browser
  profile, helpers, and key-bearing logs were removed after copying the selected
  screenshots into this evidence directory. The pre-existing desktop window
  and Vite process were left running, with port 1421 free.

## Remaining gaps

This validates M0-09 on this Fedora desktop, not Linux distributions generally
or public release acceptance. Full text/placement interaction was through
XWayland; direct Wayland was checked for launch, health, and normal closure.
Windows execution (M0-10), installers/native dependency delivery and detached
frontend packaging (M0-11), and provider/PTY/preview process supervision were
not exercised. Detached frontend assets still come from Vite. Unsaved drafts
remain in memory: a forced host/browser exit can lose them; this check proves
recovery of committed data and protected normal close, not durability of every
keystroke. No M0 milestone gate, product requirement, or ClickUp status was changed.
