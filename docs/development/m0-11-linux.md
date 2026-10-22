# M0-11: Linux detached delivery and native package prototype

**Result: detached delivery passed; RPM prefix install/run passed on Fedora 44
x86_64, 12 October 2026.** Normal system installation and clean dependency
provisioning remain unvalidated. Windows execution/installer validation belongs
to Windows members. This report does not complete M0-11, M0-GATE, or M6.

## Distribution and trust boundaries

`pnpm build:backend` builds the existing frontend with Node/pnpm/Vite, then
compiles `agentica-backend` with Cargo feature `bundled-frontend`. A standard
library build script embeds `index.html` and the current Vite JS/CSS assets in
the Rust executable. End users copy that executable and open its printed
`http://127.0.0.1:1421` URL. No Node, Cargo, Vite, source checkout, asset directory,
or static-server process is needed at runtime. Plain Cargo builds without the
feature remain RPC-only development builds; they print the port-1420 Vite URL.
The feature fails the build visibly if the built frontend is missing.

The public routes are `/`, `/index.html`, and exact embedded `/assets/*` names,
with GET/HEAD and explicit HTML/JavaScript/CSS content types. Unknown files,
source maps, source paths, traversal, and query variants return 404; there is no
filesystem lookup or catch-all HTML fallback. The build rejects symlinked asset
files/directories. The current allowlist supports this UI's HTML/JS/CSS only;
extend it deliberately if the UI later needs other asset types. Responses use
`no-store`, `nosniff`, `no-referrer`, and a CSP restricting scripts/network to
self, forbidding framing/base changes/form navigation, and allowing the existing
inline styles. No dependency was added.

Only the shell/assets are public. Runtime credentials are generated after process
startup and never interpolated into assets. Workspace data remains behind `/rpc`.
The backend binds IPv4 loopback only. Every request requires the single exact Host
`127.0.0.1:1421`; RPC additionally requires a single exact Origin
`http://127.0.0.1:1421` or the explicitly retained development origin
`http://127.0.0.1:1420`, plus the current Bearer key. Same-origin RPC still requires
Origin/authentication. Missing, duplicate, empty, foreign, or `null` RPC origins
are rejected; `localhost` is rejected. Public navigation may omit Origin; an
Origin supplied to an asset request must pass the same exact checks. CORS echoes
only an accepted origin after Host validation. Existing constant-time credential
comparison, protocol validation, 16 KiB frame limit, request/header deadlines,
serialized runtime admission, visible failures, and explicit reconnect/key
rotation remain in place. Keys stay in UI memory; new tabs start with no key.

## Environment and isolation

- Fedora Linux 44 x86_64; niri Wayland desktop, native interaction through GTK
  X11/XWayland on `DISPLAY=:0`. GTK 3.24.52, WebKitGTK 2.52.5, glibc 2.43.
- Build tools: Node 24.16.0, pnpm 11.6.0, Rust 1.96.0, Vite 8.3.4,
  Tauri CLI 2.12.2; RPM 6.0.2. Browser: headed Chrome for Testing 153.0.8010.12,
  driven by agent-browser 0.27.1 with an isolated profile.
- Base revision `02953e3`, with existing modified changelog/development guide and
  untracked project documents, CI, evidence, and architecture files. Those changes
  were preserved; this work adds focused implementation/docs changes. No files
  were staged or committed; ClickUp and backlog task/gate statuses were unchanged.
- Owned resources used `/tmp/agentica-m011.cPjWMV`: separate native/browser data,
  copied detached binary, RPM install prefix/database, browser profile, and private
  key-bearing logs. The copied binary ran with this directory as cwd, away from
  the checkout, and `PATH=''`; `/proc/<owned-pid>/environ` verified empty PATH.
- Existing Vite delivery was unnecessary: browser resource observations showed
  HTML, JS, CSS, and RPC from port 1421. No unrelated server/window was stopped.
  AT-SPI actions and XTest keyboard input targeted verified native process IDs
  and their visible X11 window, not the browser page or a source-tree executable.

## Reproducible detached build and execution

From the repository root, with installed build dependencies:

```sh
pnpm build:backend
```

Equivalent explicit commands:

```sh
pnpm --filter @agentica/protocol build
pnpm --filter @agentica/desktop build
cargo build --locked --release -p agentica-runtime --bin agentica-backend --features bundled-frontend
```

Create a fresh test directory; never use real workspaces for fault tests. Ensure
1421 is free without stopping another user's/agent's server:

```sh
test_root=$(mktemp -d /tmp/agentica-m011.XXXXXX)
mkdir -p "$test_root/detached"
cp target/release/agentica-backend "$test_root/detached/agentica-backend"
cd "$test_root/detached"
AGENTICA_DATA_DIR="$test_root/browser-data" PATH='' ./agentica-backend
```

Open `http://127.0.0.1:1421` in a local browser and use the current terminal key.
Do not put keys in URLs, screenshots, or reports. The executable is the detached
distribution; its Linux runtime dependencies observed by `ldd` are `libgcc_s.so.1`,
`libm.so.6`, `libc.so.6`, and the ELF loader. SQLite is already bundled by the
existing Rust dependency. GTK/WebKitGTK are needed for native mode, not detached.
Node used by test/build tooling is separate from the empty-PATH application process.

The final checked release executable SHA-256 is
`a07b4e5631917bea9dc701d080773a683c38a62fa6254a9581f19b5149069a9e`.
Hashes identify these local artifacts, not reproducible-build or signed-release
claims. Browser lifecycle checks initially used the first build; the final build
was copied out and exercised again after the CORS header cleanup and making
connection-failure text independent of development tools. The final RPM was also
rebuilt, installed, and reopened against the saved native data.

## Executed detached checks

| Check                               | Observed result                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production frontend delivery        | **Pass.** Copied release executable, empty PATH/cwd outside checkout, actual headed browser at port 1421. HTML/JS/CSS loaded from that backend; browser console/page errors were empty.                                                                                                                                                               |
| Authentication                      | **Pass.** Wrong key visibly reported **Invalid connection key** and disabled workspace operations; current key plus explicit Connect/Reconnect reported **Backend connected**.                                                                                                                                                                        |
| Actual edit/save/reopen             | **Pass.** Created **M0-11 production browser** / **Embedded frontend**, added text, edited two lines, set node x=180 and zoom=1.25, waited for Saved, then closed/opened workspace/canvas. UI and independent SQLite rows matched text, placement, and zoom.                                                                                          |
| Saved application-tab close         | **Pass.** Opened a blank companion tab, closed the application tab, and authenticated HTTP ping still returned 200. A fresh application tab had an empty key; explicit Connect and workspace/canvas reopen restored content.                                                                                                                          |
| Backend termination                 | **Pass.** SIGKILL of the verified copied backend exited 137. The retained application tab showed **Backend unavailable**; editing kept the draft and showed **save failed**.                                                                                                                                                                          |
| Key rotation and explicit reconnect | **Pass.** Restart on the same data produced a different key; HTTP old-key/new-key statuses were 401/200. After six seconds the UI remained failed. Explicit Reconnect with the old key was rejected; entering the new key and waiting six seconds still did not reconnect. Explicit Reconnect then Retry save saved **retained draft after restart**. |
| Recovery/reopen                     | **Pass.** Workspace/canvas close/open restored the recovered draft. SQLite `integrity_check` returned `ok` for the owned databases. localStorage/sessionStorage remained empty.                                                                                                                                                                       |
| Server shutdown                     | **Pass.** SIGTERM stopped the owned restarted backend with status 0 and released port 1421. Closing the isolated browser also left the final backend answering authenticated ping before terminal shutdown.                                                                                                                                           |

Screenshots were visually inspected:
[detached saved canvas](evidence/m0-11-linux/detached-saved.png),
[visible failure and retained draft](evidence/m0-11-linux/detached-failure.png), and
[explicit reconnect/recovery](evidence/m0-11-linux/detached-reconnected.png).
These contain only test data and masked keys. Assertions on UI fields, database
rows, process exit codes, and authenticated responses supplement the images.

To repeat manually, follow the table in order; send signals only after verifying
the test PID's executable and data path. After a saved tab close or browser exit,
confirm the backend terminal remains alive; reopen the URL and explicitly connect.
After backend termination, retain the tab/draft while restarting the same data
directory. Merely entering the rotated key must leave the failed state unchanged.

## RPM prototype: build, installation, and actual native execution

RPM was chosen for the available Fedora host. The shared Tauri configuration
continues to disable bundling and `pnpm build:desktop` still uses `--no-bundle`.
This prototype used a temporary override, following [Tauri's RPM guide](https://v2.tauri.app/distribute/rpm/):

```sh
printf '%s\n' '{"bundle":{"active":true}}' > "$test_root/tauri-rpm-prototype.json"
pnpm --filter @agentica/protocol build
pnpm --filter @agentica/desktop tauri build --config "$test_root/tauri-rpm-prototype.json" --bundles rpm
rpm -qp --requires target/release/bundle/rpm/Agentica-0.0.0-1.x86_64.rpm
rpm -qp --scripts target/release/bundle/rpm/Agentica-0.0.0-1.x86_64.rpm
rpm -qpl target/release/bundle/rpm/Agentica-0.0.0-1.x86_64.rpm
sha256sum target/release/bundle/rpm/Agentica-0.0.0-1.x86_64.rpm
```

Run package commands from the repository root (return there after the detached
example). Build exited 0 and produced the unsigned 4.24 MiB
`target/release/bundle/rpm/Agentica-0.0.0-1.x86_64.rpm`, SHA-256
`dcf93c1ce4d3eded160d7b5649c857a18345d8ee96123f6b6858a4a92e164f3a`.
The internal RPM name is lowercase `agentica`, not its product filename.
Its payload contains `/usr/bin/agentica-desktop`, desktop entry, and icon;
there are no RPM scriptlets.

Normal system installation was checked read-only:

```sh
rpm -q agentica
sudo -n rpm --test --install target/release/bundle/rpm/Agentica-0.0.0-1.x86_64.rpm
```

The host had no installed Agentica package; sudo returned **a password is
required**. No system package was installed. Instead, an actual RPM install/remove
transaction used a private database and relocated prefix:

```sh
rpm -q --whatprovides 'libwebkit2gtk-4.1.so.0()(64bit)' 'libgtk-3.so.0()(64bit)'
mkdir -p "$test_root/rpmdb"
rpm --dbpath "$test_root/rpmdb" --initdb
rpm --dbpath "$test_root/rpmdb" --install --nodeps --badreloc \
  --relocate "/usr=$test_root/installed/usr" \
  target/release/bundle/rpm/Agentica-0.0.0-1.x86_64.rpm
rpm --dbpath "$test_root/rpmdb" -q agentica
ldd "$test_root/installed/usr/bin/agentica-desktop"
AGENTICA_DATA_DIR="$test_root/native-data" DISPLAY=:0 GDK_BACKEND=x11 \
  XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  "$test_root/installed/usr/bin/agentica-desktop"
```

Use your own display/session values when reproducing. The install exited 0;
RPM recorded `agentica-0.0.0-1.x86_64`. `--nodeps` was necessary because the private
database does not contain host library packages; host RPM queries independently
resolved both declared library requirements, and `ldd` showed no missing libraries.
`--badreloc` allows an isolated-prefix prototype of this nonrelocatable package.
This is an executed package-manager installation, not merely RPM extraction or
running `target/release/agentica-desktop`. It does **not** prove dependency
installation, normal `/usr` integration, desktop-menu launching, root-owned file
permissions, or clean-machine support. RPM verification reported host dependencies
absent from the private database and user/group differences from the root-owned
package metadata; payload content matched. Initial package queries incorrectly
used uppercase `Agentica`; querying its actual lowercase name confirmed installation.

The installed executable opened a real native window and showed **Backend
connected**. Through AT-SPI/XTest, it created **m011 rpm native** / **rpm installed
canvas**, added text, and saved **rpm package installed and saved**. Workspace/canvas
close/open restored it. A normal window close exited 0; relaunching the installed
path and selecting the saved workspace/canvas restored the exact text, asserted
through the accessibility text interface. A second normal window close exited 0.
See [the installed native saved window](evidence/m0-11-linux/rpm-native-saved.png).

After closing only the owned app:

```sh
rpm --dbpath "$test_root/rpmdb" -e agentica
rpm --dbpath "$test_root/rpmdb" -qa
test ! -e "$test_root/installed/usr/bin/agentica-desktop"
```

Removal exited 0, removed the installed executable, and emptied the private
database. The separate native workspace database remained and passed SQLite
integrity checks. RPM's sandboxed D-Bus/systemd plugin warnings did not prevent
the prefix install/remove transactions.

## Checks, cleanup, and remaining limitations

- `pnpm build:backend`: passed with production frontend embedding.
- Tauri RPM build and prefix install/run/remove: passed as described above.
- `pnpm check`, `rtk proxy pnpm run lint`, and `pnpm check:rust`: passed. RTK's
  lint rewrite initially selected absent ESLint; the proxy ran the actual Oxlint script.
- `pnpm test`: passed 17 Rust unit tests, 2 Rust contract tests, and 13 Node tests.
  Extended real HTTP checks verify exact asset bytes/content types, GET/HEAD,
  security headers, public navigation, authenticated same-origin RPC, missing/
  duplicate/foreign Origin rejection, wrong Host/key, forbidden paths/query
  variants, existing preflight/protocol/frame limits/deadlines, and restart rotation.
  A later rerun initially collided with the still-running owned backend; after
  stopping it, the complete suite passed. No unrelated server was stopped.
- `pnpm test:rust`: passed the workspace suite (17 unit / 2 contract tests),
  including plain Cargo builds without embedded assets.
- Changed source/docs passed Oxfmt, rustfmt, and `git diff --check`.
- Only owned test native windows, browser/profile/controller, backend processes,
  private RPM installation, temporary data/helpers, and key-bearing logs were
  removed. Selected screenshots remain under `evidence/m0-11-linux`; locally
  built artifacts remain under ignored `target/release` for review.

Native RPM runtime requirements include GTK 3, WebKitGTK 4.1 (with its JavaScriptCore/
libsoup/GStreamer and other system dependencies), compatible glibc/libgcc/libm,
graphics/display/session services, and the ELF loader. The emitted RPM declares
GTK/WebKit shared-library requirements but does not capture every ELF ABI floor:
the native executable references GLIBC_2.39. This Fedora build is not evidence for
older distributions. [Tauri recommends building on the oldest intended baseline](https://v2.tauri.app/distribute/appimage/).
Choose and test release baselines, dependency metadata/provisioning, normal system
install/menu/uninstall, signing, distribution notice inventories, and clean/offline
machines in M6. DEB/AppImage/Flatpak and direct Wayland package interaction were
not tested; RPM is a host-specific early prototype, not a universal Linux package.
Windows binaries/WebView2/NSIS remain [Windows handoff work](windows-validation.md).
Managed agent/PTY/preview subprocesses are outside this slice. Unsaved drafts
remain in memory and can be lost by forced browser/host exit; committed data and
explicit reconnect recovery are what these checks establish.
