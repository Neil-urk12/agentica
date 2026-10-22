# User guide

How to use each Agentica feature. To install and start the app, see
[Running Agentica](running.md).

- [Canvas basics](#canvas-basics)
- [Canvas files](#canvas-files)
- [Canvas conversation](#canvas-conversation)
- [Tools from MCP servers](#tools-from-mcp-servers)
- [Projects and native sessions](#projects-and-native-sessions)
- [Session attention](#session-attention)
- [Changes review](#changes-review)
- [Canvas tasks](#canvas-tasks)

## Canvas basics

A workspace holds canvases. Create or reopen them from the start screen. On a
canvas you can add text and shapes, move and resize them, and pan and zoom. All
changes save automatically. If a save fails, the canvas says so and offers
**Retry save** without discarding your edits.

Text is editable in place: double-click it, or focus it and press Enter. Escape
or Ctrl/Cmd+Enter stops editing. Nothing on this page except the conversation
needs an AI account.

## Canvas files

Use **Add a file** in the canvas toolbar, the composer, or the empty-canvas
prompt, or drag files onto the canvas, to place an image (PNG, JPEG, WebP, GIF,
SVG), PDF, Word document (DOCX or legacy DOC), or text-like file (TXT, Markdown,
CSV) on the canvas. Dropped files land where the pointer is; picked files land
near the middle of the view. Files up to 8 MB are copied into the open
workspace, so they survive the original moving or being deleted. The import
streams in ordered chunks to keep every runtime request inside the 16 KiB frame;
abandoned imports expire after an hour.

Images render inline, PDFs page through with a page count, DOCX files show a
converted preview, and text files show their content. Legacy DOC files have no
in-app preview and no extractable text, but can still be opened. Word and PDF
preview frames are inert: scripts never run. **Open** launches the copied file
with the system application on desktop; in browser mode it downloads a copy.

Imported text is capped at 10,000 characters per file and is shared with the
agent when the file node is selected, exactly like note text. File bytes are
never included in canvas context or a provider prompt; select the node to attach
its extracted text to the next request. Images and scanned PDFs without a text
layer contribute no text. The canvas agent cannot create or upload files itself.

## Canvas conversation

### Choose a provider

Open **Settings** and pick OpenRouter, a named hosted provider, or a custom
OpenAI-compatible provider.

- **OpenRouter** checks its model catalog automatically.
- **Named providers** (NVIDIA NIM, Groq, Together AI, Mistral AI, or DeepSeek,
  under **Advanced > Where the AI runs**) fill in their endpoint and keep a
  separate API key, model, and tools flag, so switching providers never sends
  one provider's key to another.
- **Custom provider**: enter a base URL (for example `https://api.example.com/v1`
  or `http://localhost:1234/v1`), an API key, and a model ID. Leave the key blank
  for endpoints without authentication. URLs must be HTTPS, or HTTP on
  `localhost`/`127.0.0.1`. Agentica appends `/chat/completions`; pasting the full
  URL also works.

**Check** sends one small message and reports a bad key, an unreachable server,
the provider's own error (for example a retired model, with any key redacted),
or no answer within 30 seconds.

Each provider keeps its own settings and key on this machine. The desktop app
sends requests through its native HTTP client, so providers need no CORS
support. Browser mode sends them from the page, so the provider must allow the
app's origin.

Turn **canvas tools** on only for models that support function calling. Without
them a model can reply but cannot propose changes.

### Ask and review

Select objects to focus a request, or clear the selection to use the whole
canvas. The composer shows what will be sent: object text and geometry, plus up
to eight recent exchanges. Prompts and replies are placed on the canvas as
editable text.

A tool-capable model can propose text, labeled rectangles and ellipses,
placement, and connectors. Proposed changes have dashed outlines and a
**Proposed** label. **Apply** commits the whole proposal; **Discard** keeps the
reply and changes nothing.

- Pending proposals survive reopening the canvas.
- If you edited a target after the proposal was made, applying it reports a
  conflict instead of overwriting your edit.
- One generation or unresolved proposal can be active per canvas.
- **Cancel** stops generation. An interrupted request needs an explicit retry.
- Requests that exceed size limits fail visibly; nothing is silently truncated.
- If saving a reply fails, keep the canvas open to retry, or copy the reply.

Built-in tools cannot generate images or run code.

## Tools from MCP servers

**Settings › Tools** lists the built-in canvas tools and lets you add local
programs that provide more tools over the
[Model Context Protocol](https://modelcontextprotocol.io) (stdio only).

A server is a command, one argument per line, and optional `NAME=value`
variables. It is saved with the open workspace, started without a shell, and runs
with your user permissions. **Add only programs you trust.**

- A server starts when you turn it on; its tools are listed then. Every tool
  starts off.
- Only tools the server marks read-only (`readOnlyHint`) can be turned on. That
  mark is the server's own claim; your per-tool switch is the real gate and is
  checked on every call.
- Enabled tools reach the model as `server__tool`. Each call has a 30 s limit and
  a 32 KiB result cap. Results are treated as untrusted data. **Cancel** ends the
  turn without waiting for a pending call.
- Variable values are stored in plain text in the workspace database. They are
  never shown again, never sent to the model, and redacted from errors in
  Settings. The model only sees a generic failure.
- Turning a server off, deleting it or its workspace, or stopping the app stops
  the server and every process it started.

**Status:** validated with test servers in browser mode on Linux. The desktop app
uses the same code but has not been tested against a real server. Remote (HTTP)
servers, tools that change data, and per-project servers are planned.

## Projects and native sessions

**Open project** places an existing folder on the canvas as a project group. The
desktop app shows a folder picker; browser mode asks for an absolute path on the
backend's machine. Opening a folder creates nothing and runs nothing.

Groups start collapsed; the chevron expands one. The group header has:

- **Add terminal**: your login shell (or `/bin/sh`, labeled as a fallback).
- **Add agent**: a menu of the coding agents found on this machine, plus any
  custom agents you added (see below). Built-in agents are Codex, Claude Code,
  OpenCode, Crush, pi, Gemini CLI, GitHub Copilot CLI, Cursor Agent, Amp, Qwen
  Code, Droid, and Kimi Code; each is listed only when its program is on the
  `PATH` of the desktop app or backend. Each agent keeps its own sign-in,
  prompts, and approvals. Agentica never passes approval-bypass flags and never
  answers an agent's prompts.

### Coding agents

**Settings → Advanced → Coding agents** shows whether each built-in agent was
found and where. Agentica only looks for it on the `PATH`; nothing runs until you
press **Start** on a tile. A match is by program name only, so an unrelated
program called `pi` is listed as pi; check the path before starting.

The `PATH` searched is the one the desktop app or backend was started with. A
desktop app opened from an application launcher may not see programs your shell
adds to `PATH` (for example in `~/.zshrc`). If an agent you installed shows
**Not found**, start Agentica from that shell, or add it as a custom agent with
its absolute path.

**Add a custom agent** registers any other terminal coding agent (for example
Aider):

- **Name**: the label shown in the **Add agent** menu.
- **Program path**: the absolute path to the program, starting with `/`.
- **Arguments**: one per line, passed exactly as written and never through a
  shell, so no quoting is needed. Empty lines are skipped.

Custom agents are saved only on this machine, never in a workspace, so a shared
workspace can't choose what an agent tile runs. They run with your user account,
so add only programs you trust. Edits apply the next time a tile starts. An
agent whose program is missing or not executable is marked **Not executable**.

Tiles belong to their group and move with it. A session starts only when you
press **Start**. It runs with your permissions in the project folder, which is
the working directory, not a sandbox.

### Using a terminal tile

- **Focus terminal** sends keys, including Ctrl+C, Tab, and Escape, to the
  program. **Ctrl+Shift+Escape** returns focus to the tile controls;
  **Ctrl+Shift+C** copies the selection.
- Paste needs an explicit paste action. Multi-line pastes ask first.
- In browser mode, links open only with Ctrl/Cmd+click.

### What keeps a session alive

- Moving, resizing, collapsing, switching canvases, or refreshing the browser
  does not stop a session. Returning reattaches without replaying input. If
  output was dropped meanwhile, the tile says so. **Redraw** asks the program to
  repaint; it does not recover lost history.
- Closing the desktop window stops its sessions. In browser mode the backend owns
  them: closing a tab only detaches, and stopping the backend stops them. After a
  restart, tiles reappear stopped. Daemonized processes and backend crashes are
  outside this cleanup.
- Removing a tile, group, canvas, or workspace with live sessions asks you to
  **Stop and remove** or **Cancel**. Project files are never deleted.
- If a project folder moves, **Start** is disabled until **Locate folder**
  rebinds the group (with its sessions stopped).

Project paths, session settings, and terminal output are never added to
conversation context.

**Status:** Linux only, validated with zsh 5.9 and `codex-cli 0.163.0` in both
launch modes. Other built-in agents and custom agents are implemented but not
yet validated. On other systems project groups are visible and **Start**
explains why it is unavailable.

## Session attention

A tile asks for attention on a terminal bell (BEL), a program notification
(OSC 9), or an unseen exit or launch failure. It gets an amber ring (red for a
failed launch) and a strip with the reason, how long it has waited, and **Mark
seen**. Project groups show counts such as "1 running" and "2 waiting for you",
even when collapsed.

The top bar shows how many sessions on the canvas are waiting. Click it, or press
**Ctrl+J** (**⌘J** on macOS) outside text fields and terminals, to open the queue:
waiting sessions, oldest first. Up/Down move, Enter jumps to the tile, Escape
closes. **Jump to** moves the view without expanding a collapsed project or
clearing attention. Focusing the terminal or **Mark seen** clears it.

Labels describe only the signal received:

| Signal             | Label                                                      |
| ------------------ | ---------------------------------------------------------- |
| Terminal bell      | **Waiting for you**                                        |
| OSC 9 notification | The notification text, or **Sent a notification** if empty |
| Process exit       | **Stopped**, with exit code or signal                      |
| Launch failure     | **Failed**, with the error, or **Failed to start**         |

They do not claim the agent needs approval, is thinking, or finished a task.
Title, directory, and progress escape sequences are ignored.

Attention survives canvas switches and browser refreshes, and resets when the
session restarts or the backend stops. Signals while the terminal is focused, and
exits you caused (Stop, Restart, removal), do not raise attention. Notification
text is never saved to the canvas or sent to a model.

### Codex notifications

Codex tiles show setup instructions. To opt in, add this to your Codex
configuration (normally `~/.codex/config.toml`):

```toml
[tui]
notifications = true
notification_method = "osc9"
notification_condition = "always"
```

This is a global Codex setting and also affects Codex in other terminals. `osc9`
avoids depending on terminal detection; `always` lets Agentica decide when the
terminal is focused. Agentica never reads or changes Codex configuration. Bell
and exit attention work without it.

Codex is the only agent with a verified notification setup. Other agents raise
attention when they ring the terminal bell, send OSC 9, or exit; whether and when
they do depends on the agent and its settings.

## Changes review

A project group's **Changes** button opens a read-only Changes tile (one per
project). It lists staged, unstaged, and untracked files and shows a unified
diff. **Expand**, or double-clicking the header, opens a full-screen review.

- Add feedback to a file or a hunk. Feedback is saved per tile and survives
  reloads and backend restarts.
- Feedback whose hunk changed is marked **Outdated**, keeping its original range.
- **Preview & paste** writes all feedback as one numbered message into a running
  agent session you choose, without pressing Enter, and focuses that tile.
  Feedback is then marked **Sent** (pasted, not run).
- Removing a tile or project with unsent feedback asks first.

Git runs only when the tile is created or first shown, on **Refresh**, and when an
agent session in the project raises attention. It never writes the repository.

**Status:** validated in browser mode on Linux. Desktop restart behavior is not
yet validated.

## Canvas tasks

Select a plain text note and choose **Make task**. A task has a **Done** checkbox
that only you change. You can assign it to one agent tile on the same canvas; a
dashed line connects them (to the project header while collapsed). Assigning
never starts, stops, or writes to a session. Removing the tile or project clears
the assignment and keeps the task.

**Send** shows the exact text and its size, then pastes it into the running agent
tile without pressing Enter and focuses the terminal, so you submit it. It never
starts a stopped tile. If the tile is asking for attention, the paste is refused
and you are asked to check the tile first.

Task status shows only facts: when the text was last sent, **Edited since sent**
if the note changed after, and the tile's current attention label. Agentica never
infers progress, completion, or failure from session output. The canvas agent
cannot see or change tasks.
