# Windows handoff: M0-10 and the Windows portion of M0-11

**Status: instructions only; Windows execution has not been verified here.**
Use a real Windows x86_64 desktop or interactive Windows VM. WSL and a successful
CI build do not establish Windows GUI or installer acceptance. M0-11 also has a
Linux portion, which can proceed independently.

## Setup and evidence

Use PowerShell in a checkout containing the completed M0-08 work. Install Git,
Node.js 24, pnpm 11.6.0, stable Rust with the MSVC host toolchain, rustfmt, and
Clippy. Native development also needs Microsoft C++ Build Tools with the
**Desktop development with C++** workload and Microsoft Edge WebView2. Follow
the [official Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

Record the Windows edition/build, architecture, browser/WebView2 versions,
toolchain versions, and exact Git revision. Use a fresh test data directory:

```powershell
git rev-parse HEAD
git status --short
node --version
pnpm --version
rustc -Vv
cargo --version
rustup component add rustfmt clippy

$testRoot = Join-Path $env:TEMP ("agentica-windows-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $testRoot
$env:AGENTICA_DATA_DIR = Join-Path $testRoot "data"

pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
pnpm check:rust
pnpm test:rust
pnpm build:desktop
pnpm build:backend
```

Run each command separately and record its exit code (`$LASTEXITCODE`); do not
continue past a failed build as though it passed. Tests use port 1421: stop only
your own test backend before running them. Preserve unrelated checkout changes.
Use this same absolute `AGENTICA_DATA_DIR` in every application terminal for
reopen and writer-contention checks. Never use real workspaces for fault tests.

## M0-10: native desktop

```powershell
& .\target\release\agentica-desktop.exe
```

1. Verify an actual application window opens and shows **Backend connected**.
2. Create a workspace and canvas, add text, edit it with the keyboard, change
   node position/dimensions and pan/zoom, and wait for **Saved**. Check visible
   keyboard focus and save/error notices.
3. Close/reopen the workspace, then close/relaunch the window and reopen it.
   Verify text, placement, and viewport survived; closing the app ends its
   linked runtime, which is not a separate backend process.
4. Verify **Reconnect** works. Exercise a reproducible save failure if possible:
   with an available SQLite tool, hold `BEGIN EXCLUSIVE` on this test workspace's
   `workspace.sqlite3`, then edit text. Confirm the error is visible, the draft
   remains available through **Copy unsaved edits**, and a normal close is
   guarded. Release the transaction with `ROLLBACK`, then **Retry save**.
   If this failure cannot be exercised, record it as untested.
5. After a confirmed save, terminate only the test application using Task
   Manager. Relaunch and verify the committed content reopens and the writer
   lock is released. This does not prove unsaved keystrokes survive forced exit.

## M0-10: detached browser lifecycle

In terminal A, set the shared test data directory and start the compiled backend:

```powershell
$env:AGENTICA_DATA_DIR = "<absolute test data directory from setup>"
& .\target\release\agentica-backend.exe
```

In terminal B, from the repository root:

```powershell
pnpm dev:web
```

Open `http://127.0.0.1:1420` or its `http://localhost:1420` equivalent. The backend
listens at `127.0.0.1:1421` and prints a new connection key on every restart.
Do not include keys in screenshots, reports, or committed logs.

1. A wrong key must fail visibly; the correct key plus **Connect** must succeed.
2. Repeat native create/edit/save/reopen checks in the browser. With the native
   app holding the same workspace, opening it in detached mode must fail with
   `WORKSPACE_LOCKED`; close it in the first mode and retry. Repeat in reverse.
3. Close the saved application tab. Confirm the backend still runs; open a new
   application tab, explicitly connect, and reopen saved data.
4. Terminate only the test backend while leaving the browser open. Health must
   show a failure, and subsequent edits must remain unsaved and recoverable.
5. Restart the backend using the same data directory. Confirm the new key differs
   and the old key fails. Merely entering the new key must not reconnect; use
   **Reconnect**, then **Retry save**, and verify the retained draft is saved.
6. Stop the backend with Ctrl+C and verify process exit and port release. Restart
   and reopen the recovered content. Report any Windows shutdown failure.
7. Prove the compiled backend runs without Node/Cargo on PATH. In a separate
   PowerShell terminal, use absolute executable/data paths and temporarily set
   PATH to the Windows system directories; restore PATH afterward:

```powershell
$backendExe = (Resolve-Path .\target\release\agentica-backend.exe).Path
$originalPath = $env:PATH
try {
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
    & $backendExe
} finally {
    $env:PATH = $originalPath
}
```

Ensure port 1421 is free first. Stop this backend with Ctrl+C and verify PATH
restoration. This proves backend independence for the development-origin flow
above; repeat the M0-11 production-origin checks below to prove frontend delivery.

## M0-11: Windows installer prototype

The repository currently disables bundling, and `pnpm build:desktop` uses
`--no-bundle`. Build an unsigned NSIS prototype with a temporary configuration
override rather than changing the shared default. Tauri documents NSIS and MSI
in its [Windows installer guide](https://v2.tauri.app/distribute/windows-installer/).

```powershell
$bundleConfig = Join-Path $testRoot "tauri-windows-prototype.json"
[System.IO.File]::WriteAllText($bundleConfig, '{"bundle":{"active":true}}')
pnpm --filter @agentica/protocol build
pnpm --filter @agentica/desktop tauri build --config $bundleConfig --bundles nsis
```

Record build errors rather than silently changing toolchains or package formats.
Find the generated installer under `target\release\bundle\nsis`, record its
filename and SHA-256 (`Get-FileHash <installer> -Algorithm SHA256`), and transfer
it to a clean Windows x86_64 test environment without Node, Rust, or this checkout.

- Install, launch, edit/save, close, relaunch, and reopen test content. Do not
  accept running the build-directory executable as proof of installer behavior.
- Record WebView2 availability and how the installer provisions it. State whether
  an internet connection was needed and whether offline installation was tested.
- Record any missing runtime dependencies and unsigned-installer warnings. Test
  uninstall behavior using disposable data; record whether data is retained.
- This is an early packaging prototype, not public-release or M6 acceptance.

## M0-11: detached frontend delivery (implemented; Windows execution pending)

`pnpm build:backend` now builds the UI at build time and embeds it in the release
executable using `--features bundled-frontend`. Plain Cargo builds without that
feature remain RPC-only development builds. The [Linux report](m0-11-linux.md)
records executed production checks; it does not establish Windows compatibility.

Copy the production executable out of the checkout and start it with only Windows
system directories on PATH. No Vite, Node static server, or external asset directory
is needed. Ensure port 1421 is free first; stop only your own test backend.

```powershell
pnpm build:backend
if ($LASTEXITCODE -ne 0) { throw "Detached distribution build failed" }
$distDir = Join-Path $testRoot "detached"
New-Item -ItemType Directory -Path $distDir
Copy-Item .\target\release\agentica-backend.exe $distDir
$backendExe = Join-Path $distDir "agentica-backend.exe"
Get-FileHash $backendExe -Algorithm SHA256
$originalPath = $env:PATH
$originalDirectory = Get-Location
try {
    Set-Location $distDir
    $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot"
    & $backendExe
} finally {
    $env:PATH = $originalPath
    Set-Location $originalDirectory
}
```

Open **`http://127.0.0.1:1421`**, not the development origin on port 1420.
The same-origin RPC still requires the terminal's current key. Keys stay in memory;
public embedded assets contain no runtime credentials or workspace data. Exact
Host and Origin checks reject foreign origins and missing RPC Origin; `localhost`
is rejected as a Host, while the development origin `http://127.0.0.1:1420` and its
`http://localhost:1420` equivalent remain accepted explicitly.

Repeat wrong-key rejection, actual browser connect/edit/save/reopen, saved tab close
with the server still running, backend termination and visible failure, restart/key
rotation, rejection of the old key, and explicit Reconnect/Retry save. Merely entering
the new key must not reconnect. Check browser storage stays empty and the last saved
content survives a fresh application tab. Stop with Ctrl+C and verify exit, port
release, and PATH restoration. Repeat on a clean Windows machine without Node/Rust
or the checkout and record executable/runtime dependencies. Installer success alone
does not complete M0-11; both installer and detached evidence remain Windows work.

## Return evidence

Submit a Windows report at `docs/development/m0-10-windows.md` and a Windows
packaging report at `docs/development/m0-11-windows.md`, with relevant screenshots
under `docs/development/evidence/`. Each report should contain:

- Git revision, OS/architecture, toolchain and runtime versions, and isolation.
- Exact commands and exit codes, executable/installer paths, and package hash.
- A table of checks marked **pass**, **fail**, **blocked**, or **not tested**, with
  observed results and reproducible failure steps.
- Screenshots of native/browser save and failure/recovery, without secrets.
- Remaining dependencies, platform gaps, and owned-process cleanup.

Link the reports from the development verification record. M0-GATE requires
executed Windows and Linux evidence; CI compilation and these instructions alone
do not close M0-10 or M0-11. Remove only your disposable test data after preserving
the selected evidence and closing your test processes.
