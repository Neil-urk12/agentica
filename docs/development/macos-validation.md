# macOS handoff: Apple Silicon desktop, sessions, and packaging

**Status: instructions only; nothing here has been run on a Mac yet.**
Use a real Apple Silicon Mac (M1 or later) on macOS 11 or newer, signed in to a
normal user account. A green `macos-latest` CI run proves compilation and the
Rust session tests only; it does not establish GUI, Gatekeeper, microphone, or
installer behavior.

## Setup and evidence

Install Git, Node.js 24, pnpm 11.6.0, stable Rust, and the Xcode Command Line
Tools (`xcode-select --install`). Record the macOS version, chip, shell, and
exact Git revision. Use a fresh test data directory:

```sh
git rev-parse HEAD
git status --short
sw_vers
uname -m                     # expect arm64
echo "$SHELL" && "$SHELL" --version
node --version && pnpm --version && rustc -Vv

export AGENTICA_DATA_DIR="$(mktemp -d)/data"

pnpm install --frozen-lockfile
pnpm check:rust
pnpm test:rust
pnpm build:desktop
pnpm build:backend
```

Run each command separately and record its exit code (`echo $?`); do not continue
past a failed build as though it passed. Never use real workspaces for these tests.

## Installer and Gatekeeper

Download `agentica-vX.Y.Z-macos-arm64.dmg` from a release (or build one with
`pnpm package:desktop --bundles app,dmg`; output in `target/release/bundle/dmg/`).
Record its SHA-256 (`shasum -a 256 <file>`).

1. Open the disk image and drag **Agentica** to **Applications**.
2. Open it from Finder. Record the exact Gatekeeper message and buttons.
3. Follow [Installing on macOS](../running.md#installing-on-macos). Confirm the
   app opens and later launches from the Dock open without a prompt.
4. Confirm the workspace home appears, then create a workspace and canvas, add
   text, wait for **Saved**, quit with ⌘Q, relaunch, and reopen it. Confirm the
   data lives in `~/Library/Application Support/agentica` when
   `AGENTICA_DATA_DIR` is not set (Finder launches do not see it).

## Agent detection from Finder

1. Install one agent outside the default system `PATH`, for example
   `brew install codex` (`/opt/homebrew/bin`) or `npm i -g @anthropic-ai/claude-code`.
2. Quit Agentica completely, then open it from Finder or the Dock, not a terminal.
3. **Settings → Advanced → Coding agents** must list the agent as found, with its
   resolved path.
4. Optional fault check: temporarily add `sleep 10` to the end of `~/.zshrc`, open
   the app from Finder, and confirm it still opens (after about 5 seconds) with
   agents outside launchd's `PATH` reported as **Not found**. Remove the line.

## Native sessions

1. Open a project folder and choose **Add terminal**, then **Start**. The tile
   must report a running login shell (zsh by default). Type commands, resize the
   tile, and interrupt `sleep 100` with Ctrl+C.
2. Run `sleep 300 &` in the terminal and note the job PID it prints. Choose
   **Stop**. Once the tile reports the session exited, `pgrep -x sleep` in
   Terminal.app must not list that PID.
3. Start again, run `trap '' HUP TERM; sleep 300`, and choose **Restart**. The
   replacement must start only after the old process is gone (forced cleanup).
4. Choose **Add agent** with the agent from the previous section and **Start**
   it. Confirm it runs, then stop it.

## Dictation and the microphone

1. In the canvas conversation composer, click the microphone button for the first
   time. macOS must ask whether Agentica may use the microphone, using the
   app's description text. Allow it, dictate a sentence, and confirm the
   transcript appears.
2. Turn the permission off in **System Settings → Privacy & Security →
   Microphone**, relaunch, and try again. Dictation must explain that the
   microphone is unavailable while the rest of the app keeps working.

## Browser mode with the downloaded backend

```sh
xattr -d com.apple.quarantine agentica-backend-vX.Y.Z-macos-arm64
chmod +x agentica-backend-vX.Y.Z-macos-arm64
AGENTICA_DATA_DIR="$AGENTICA_DATA_DIR" ./agentica-backend-vX.Y.Z-macos-arm64
```

Open `http://127.0.0.1:1421`, connect with the printed key (keep keys out of
screenshots), and repeat the native session checks above. Closing the tab must
leave sessions running; stopping the backend with Ctrl+C must stop them. With
the desktop app holding the same workspace, opening it here must fail with
`WORKSPACE_LOCKED`.

## Return evidence

Submit a report at `docs/development/macos.md`, with screenshots under
`docs/development/evidence/`, containing:

- Git revision, macOS version, chip, shell, toolchain versions, and package hash.
- Exact commands and exit codes.
- A table of checks marked **pass**, **fail**, **blocked**, or **not tested**,
  with observed results and reproducible failure steps.
- The Gatekeeper messages seen and any step that differed from the docs.

Then update the README status and the session **Status** line in the user guide
to name what was actually validated.
