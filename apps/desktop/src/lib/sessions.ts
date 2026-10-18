import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  SESSION_LIMITS,
  type SessionEvent,
  type SessionOwner,
  type SessionResult,
  type SessionStatus,
  type SessionTile,
} from "@agentica/protocol";
import {
  createSessionClient,
  type SessionAttachment,
  type SessionClient,
} from "./session-client";
import { desktopMode } from "./runtime";
import type { CanvasDocument } from "./editor";

const live = (status: SessionStatus | null) =>
  !!status && ["starting", "running", "stopping"].includes(status.state);
const key = (owner: SessionOwner) =>
  `${owner.workspaceId}/${owner.canvasId}/${owner.tileId}`;
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
interface Entry {
  owner: SessionOwner;
  tile: SessionTile;
  status: SessionStatus | null;
  attachment?: SessionAttachment;
  attaching?: Promise<void>;
  terminal?: Terminal;
  fit?: FitAddon;
  element?: HTMLDivElement;
  opened: boolean;
  host?: HTMLElement;
  leave?: () => void;
  width: number;
  height: number;
  cursor: number;
  generation: number;
  connected: boolean;
  busy: boolean;
  error: string;
  historyGap: boolean;
  render: Promise<void>;
  input: Promise<void>;
  pendingInput: number;
}
export class SessionManager {
  capabilities: SessionResult<"capabilities"> | null = null;
  connected = false;
  private entries = new Map<string, Entry>();
  private client: SessionClient;
  private signature = "";
  private disposed = false;
  private reconciling?: Promise<void>;
  constructor(
    key: () => string,
    private changed: () => void,
  ) {
    this.client = createSessionClient(key);
  }

  view(owner: SessionOwner) {
    const entry = this.entries.get(key(owner));
    return {
      status: entry?.status ?? null,
      connected: entry?.connected ?? false,
      busy: entry?.busy ?? false,
      error: entry?.error ?? "",
      historyGap: entry?.historyGap ?? false,
    };
  }
  summary(workspaceId: string, canvasId: string, projectId: string) {
    return [...this.entries.values()]
      .filter(
        (entry) =>
          entry.owner.workspaceId === workspaceId &&
          entry.owner.canvasId === canvasId &&
          entry.tile.projectId === projectId &&
          live(entry.status),
      )
      .map((entry) => entry.status!);
  }
  async connect() {
    this.capabilities = await this.client.request({ op: "capabilities" });
    this.connected = true;
    this.changed();
  }

  async reconcile(
    workspaceId: string,
    document: CanvasDocument,
    force = false,
  ) {
    for (const tile of document.sessionTiles ?? []) {
      const owner = {
        workspaceId,
        canvasId: document.canvas.id,
        tileId: tile.id,
      };
      const id = key(owner);
      const existing = this.entries.get(id);
      if (existing) existing.tile = tile;
      else
        this.entries.set(id, {
          owner,
          tile,
          status: null,
          opened: false,
          width: 0,
          height: 0,
          cursor: 0,
          generation: 0,
          connected: false,
          busy: false,
          error: "",
          historyGap: false,
          render: Promise.resolve(),
          input: Promise.resolve(),
          pendingInput: 0,
        });
    }
    const signature = `${workspaceId}/${document.canvas.id}/${document.sessionTiles?.map((tile) => tile.id).join(",")}`;
    if (!force && this.signature === signature && this.connected) return;
    if (this.reconciling) await this.reconciling;
    this.signature = signature;
    this.reconciling = (async () => {
      try {
        await this.connect();
        if (!this.capabilities?.capabilities.supported) return;
        const { sessions } = await this.client.request({
          op: "list",
          workspaceId,
          canvasId: document.canvas.id,
        });
        for (const entry of this.entries.values()) {
          if (
            entry.owner.workspaceId !== workspaceId ||
            entry.owner.canvasId !== document.canvas.id
          )
            continue;
          this.acceptStatus(
            entry,
            sessions.find(
              (status) => status.owner.tileId === entry.owner.tileId,
            ) ?? null,
          );
          if (entry.status && entry.status.state !== "failed")
            await this.attach(entry);
        }
        // Inactive stopped renderers can be recreated from bounded backend replay.
        for (const [id, entry] of this.entries)
          if (
            !entry.host &&
            !live(entry.status) &&
            (entry.owner.workspaceId !== workspaceId ||
              entry.owner.canvasId !== document.canvas.id ||
              !document.sessionTiles.some(
                (tile) => tile.id === entry.owner.tileId,
              ))
          ) {
            void entry.attachment?.detach().catch(() => {});
            entry.generation++;
            entry.terminal?.dispose();
            this.entries.delete(id);
          }
      } catch (error) {
        this.connected = false;
        for (const entry of this.entries.values())
          if (
            entry.owner.workspaceId === workspaceId &&
            entry.owner.canvasId === document.canvas.id
          )
            entry.error = message(error);
      } finally {
        this.changed();
      }
    })();
    try {
      await this.reconciling;
    } finally {
      this.reconciling = undefined;
    }
  }

  private acceptStatus(entry: Entry, status: SessionStatus | null) {
    if (
      entry.status?.sessionId !== status?.sessionId ||
      entry.status?.backendId !== status?.backendId
    ) {
      entry.generation++;
      void entry.attachment?.detach().catch(() => {});
      entry.attachment = undefined;
      entry.connected = false;
      entry.cursor = 0;
      entry.historyGap = false;
      entry.error = "";
      entry.terminal?.reset();
    }
    entry.status = status;
    if (entry.terminal)
      entry.terminal.options.disableStdin =
        status?.state !== "running" || !entry.connected;
  }

  private terminal(entry: Entry) {
    if (entry.terminal) return entry.terminal;
    const terminal = (entry.terminal = new Terminal({
      scrollback: SESSION_LIMITS.scrollback,
      fontSize: 14,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      cursorBlink: true,
      disableStdin: true,
      allowProposedApi: true,
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#f5c46b",
        selectionBackground: "#365a82",
      },
      linkHandler: {
        activate: (event, uri) => {
          try {
            const url = new URL(uri);
            if (
              !["https:", "http:"].includes(url.protocol) ||
              url.username ||
              url.password
            )
              throw new Error(
                "Only HTTP(S) links without embedded credentials can be opened.",
              );
            if (desktopMode)
              throw new Error(
                "Select and copy this link to open it in your browser.",
              );
            if (!event.ctrlKey && !event.metaKey)
              throw new Error(
                "Hold Ctrl or Command and click to open a web link.",
              );
            window.open(url.href, "_blank", "noopener,noreferrer");
          } catch (error) {
            entry.error = message(error);
            this.changed();
          }
        },
      },
    }));
    entry.fit = new FitAddon();
    terminal.loadAddon(entry.fit);
    terminal.parser.registerOscHandler(52, () => true);
    terminal.onData((data) =>
      this.sendInput(entry, new TextEncoder().encode(data)),
    );
    terminal.onBinary((data) =>
      this.sendInput(
        entry,
        Uint8Array.from(data, (character) => character.charCodeAt(0)),
      ),
    );
    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown" &&
        event.ctrlKey &&
        event.shiftKey &&
        event.key === "Escape"
      ) {
        event.preventDefault();
        event.stopPropagation();
        entry.leave?.();
        return false;
      }
      if (
        event.type === "keydown" &&
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "c"
      ) {
        event.preventDefault();
        void navigator.clipboard
          .writeText(terminal.getSelection())
          .catch((error) => {
            entry.error = message(error);
            this.changed();
          });
        return false;
      }
      return true;
    });
    return terminal;
  }

  mount(owner: SessionOwner, host: HTMLElement, leave: () => void) {
    const entry = this.entries.get(key(owner));
    if (!entry) return () => {};
    const terminal = this.terminal(entry);
    entry.host = host;
    entry.leave = leave;
    entry.element ??= document.createElement("div");
    entry.element.style.cssText = "width:100%;height:100%;overflow:hidden";
    host.append(entry.element);
    if (!entry.opened) {
      terminal.open(entry.element);
      entry.opened = true;
      if (terminal.textarea) terminal.textarea.tabIndex = -1;
    }
    const stop = (event: Event) => event.stopPropagation();
    const paste = (event: ClipboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const text = event.clipboardData?.getData("text/plain");
      if (text == null || !entry.connected || entry.status?.state !== "running")
        return;
      if (
        new TextEncoder().encode(text).length >
        SESSION_LIMITS.unacknowledgedBytes
      ) {
        entry.error =
          "Paste is larger than 256 KiB. Paste a smaller selection.";
        this.changed();
        return;
      }
      if (
        /[\r\n]/.test(text) &&
        !window.confirm(
          "Paste multiple lines into this terminal? They may run commands.",
        )
      )
        return;
      terminal.paste(text);
    };
    for (const event of [
      "pointerdown",
      "pointerup",
      "click",
      "dblclick",
      "wheel",
      "keydown",
    ])
      host.addEventListener(event, stop);
    host.addEventListener("paste", paste, true);
    const observer = new ResizeObserver(() => this.fit(entry));
    observer.observe(host);
    const frame = requestAnimationFrame(() => this.fit(entry));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      for (const event of [
        "pointerdown",
        "pointerup",
        "click",
        "dblclick",
        "wheel",
        "keydown",
      ])
        host.removeEventListener(event, stop);
      host.removeEventListener("paste", paste, true);
      entry.element?.remove();
      entry.host = undefined;
      entry.leave = undefined;
    };
  }

  private fit(entry: Entry) {
    const host = entry.host;
    if (
      !host?.clientWidth ||
      !host.clientHeight ||
      (entry.width === host.clientWidth && entry.height === host.clientHeight)
    )
      return;
    const dimensions = entry.fit?.proposeDimensions();
    if (!dimensions || !entry.terminal) return;
    entry.width = host.clientWidth;
    entry.height = host.clientHeight;
    entry.terminal.resize(
      Math.max(2, Math.min(400, dimensions.cols)),
      Math.max(2, Math.min(200, dimensions.rows)),
    );
    if (
      entry.terminal &&
      entry.connected &&
      entry.status?.state === "running"
    ) {
      const { rows, cols } = entry.terminal;
      void entry.attachment
        ?.resize(
          Math.max(2, Math.min(200, rows)),
          Math.max(2, Math.min(400, cols)),
        )
        .catch((error) => {
          entry.error = message(error);
          this.changed();
        });
    }
  }
  focus(owner: SessionOwner) {
    const entry = this.entries.get(key(owner));
    if (entry?.connected) entry.terminal?.focus();
  }

  private sendInput(entry: Entry, bytes: Uint8Array) {
    const attachment = entry.attachment;
    if (!attachment || !entry.connected || entry.status?.state !== "running")
      return;
    if (
      entry.pendingInput + bytes.length >
      SESSION_LIMITS.unacknowledgedBytes
    ) {
      entry.error = "Terminal input is backpressured. Input was not queued.";
      this.changed();
      return;
    }
    entry.pendingInput += bytes.length;
    const generation = entry.generation;
    entry.input = entry.input
      .then(async () => {
        if (
          entry.generation !== generation ||
          entry.attachment?.id !== attachment.id ||
          !entry.connected
        )
          return;
        for (
          let offset = 0;
          offset < bytes.length;
          offset += SESSION_LIMITS.frameBytes
        )
          await attachment.input(
            bytes.slice(offset, offset + SESSION_LIMITS.frameBytes),
          );
      })
      .catch((error) => {
        if (entry.generation === generation) {
          entry.generation++;
          entry.connected = false;
          entry.attachment = undefined;
          if (entry.terminal) entry.terminal.options.disableStdin = true;
          void attachment.detach().catch(() => {});
        }
        entry.error = message(error);
        this.changed();
      })
      .finally(() => {
        entry.pendingInput -= bytes.length;
      });
  }

  private async attach(entry: Entry) {
    if (entry.attaching) return entry.attaching;
    if (entry.attachment || !entry.status) return;
    const identity = entry.status.sessionId;
    const generation = entry.generation;
    entry.attaching = (async () => {
      try {
        const attachment = await this.client.subscribe(
          entry.owner,
          identity,
          entry.cursor,
          (event) => this.event(entry, event, generation),
          (error) => {
            if (entry.generation !== generation || this.disposed) return;
            entry.connected = false;
            entry.attachment = undefined;
            entry.generation++;
            if (entry.terminal) entry.terminal.options.disableStdin = true;
            entry.error = error.message;
            this.connected = false;
            this.changed();
          },
        );
        if (entry.generation !== generation || this.disposed) {
          void attachment.detach().catch(() => {});
          return;
        }
        entry.attachment = attachment;
        entry.connected = true;
        entry.error = "";
        this.terminal(entry).options.disableStdin =
          entry.status?.state !== "running";
        entry.width = 0;
        this.fit(entry);
        this.changed();
      } catch (error) {
        entry.error = message(error);
        entry.connected = false;
        this.changed();
      }
    })();
    try {
      await entry.attaching;
    } finally {
      entry.attaching = undefined;
    }
  }

  private event(entry: Entry, event: SessionEvent, generation: number) {
    if (entry.generation !== generation || this.disposed) return;
    if (JSON.stringify(entry.status) !== JSON.stringify(event.status)) {
      entry.status = event.status;
      this.changed();
    }
    entry.render = entry.render
      .then(async () => {
        if (entry.generation !== generation || this.disposed) return;
        const terminal = this.terminal(entry);
        if (event.output.historyGap) {
          terminal.reset();
          entry.historyGap = true;
          this.changed();
        }
        terminal.options.disableStdin =
          event.status.state !== "running" || !entry.connected;
        // A hidden renderer consumes bytes at the backend's last actual size.
        if (!entry.host) terminal.resize(event.status.cols, event.status.rows);
        const frames = event.output.frames;
        if (!frames.length && !event.output.historyGap) return;
        const bytes = new Uint8Array(
          frames.reduce((total, frame) => total + frame.bytes.length, 0),
        );
        let offset = 0;
        for (const frame of frames) {
          bytes.set(frame.bytes, offset);
          offset += frame.bytes.length;
        }
        if (bytes.length)
          await new Promise<void>((resolve) => terminal.write(bytes, resolve));
        if (entry.generation !== generation) return;
        entry.cursor = event.output.nextSequence;
        await this.client.request({
          op: "acknowledge",
          owner: entry.owner,
          sessionId: event.sessionId,
          attachmentId: event.attachmentId,
          sequence: entry.cursor,
        });
      })
      .catch((error) => {
        if (entry.generation === generation) {
          entry.error = message(error);
          this.changed();
        }
      });
  }

  async start(owner: SessionOwner, restart = false) {
    const entry = this.entries.get(key(owner));
    if (!entry || entry.busy) return;
    entry.busy = true;
    entry.error = "";
    this.changed();
    try {
      const current = (await this.client.request({ op: "status", owner }))
        .status;
      if (!restart && live(current)) {
        this.acceptStatus(entry, current);
        await this.attach(entry);
        return;
      }
      const terminal = this.terminal(entry);
      const dimensions = {
        rows: Math.max(2, Math.min(200, terminal.rows)),
        cols: Math.max(2, Math.min(400, terminal.cols)),
      };
      const result =
        restart && current
          ? await this.client.request({
              op: "restart",
              owner,
              sessionId: current.sessionId,
              requestId: crypto.randomUUID(),
              ...dimensions,
            })
          : await this.client.request({
              op: "start",
              owner,
              requestId: crypto.randomUUID(),
              ...dimensions,
            });
      this.acceptStatus(entry, result.status);
      await this.attach(entry);
    } catch (error) {
      entry.error = message(error);
    } finally {
      entry.busy = false;
      this.changed();
    }
  }
  async stop(owner: SessionOwner) {
    const entry = this.entries.get(key(owner));
    if (!entry?.status) return;
    try {
      this.acceptStatus(
        entry,
        (
          await this.client.request({
            op: "stop",
            owner,
            sessionId: entry.status.sessionId,
          })
        ).status,
      );
    } catch (error) {
      entry.error = message(error);
    } finally {
      this.changed();
    }
  }
  async redraw(owner: SessionOwner) {
    const entry = this.entries.get(key(owner));
    if (!entry?.attachment || !entry.terminal) return;
    try {
      await entry.render;
      entry.terminal.reset();
      await entry.attachment.resize(
        entry.terminal.rows,
        entry.terminal.cols,
        true,
      );
    } catch (error) {
      entry.error = message(error);
      this.changed();
    }
  }
  async list(workspaceId: string, canvasId?: string) {
    const { sessions } = await this.client.request({
      op: "list",
      workspaceId,
      ...(canvasId ? { canvasId } : {}),
    });
    return sessions.filter((status) => live(status));
  }
  async stopSessions(sessions: SessionStatus[]) {
    for (const status of sessions) {
      const result = await this.client.request({
        op: "stop",
        owner: status.owner,
        sessionId: status.sessionId,
      });
      const entry = this.entries.get(key(status.owner));
      if (entry) this.acceptStatus(entry, result.status);
    }
    const deadline = Date.now() + 6000;
    for (;;) {
      let remaining = false;
      for (const confirmed of sessions) {
        const { status } = await this.client.request({
          op: "status",
          owner: confirmed.owner,
        });
        const entry = this.entries.get(key(confirmed.owner));
        if (entry) this.acceptStatus(entry, status);
        if (status && status.sessionId !== confirmed.sessionId && live(status))
          throw new Error(
            "A replacement session started. Review removal again.",
          );
        remaining ||= live(status);
      }
      this.changed();
      if (!remaining) return;
      if (Date.now() > deadline)
        throw new Error(
          "Cleanup is still pending. Records and controls were retained.",
        );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  async dispose() {
    this.disposed = true;
    await this.client.close();
    for (const entry of this.entries.values()) entry.terminal?.dispose();
    this.entries.clear();
  }
}
