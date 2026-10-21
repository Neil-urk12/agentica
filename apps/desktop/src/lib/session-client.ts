import { Channel, invoke } from "@tauri-apps/api/core";
import {
  SESSION_LIMITS,
  SessionRequestSchema,
  SessionReplySchema,
  SessionResultSchemas,
  SessionEventSchema,
  type SessionCommand,
  type SessionEvent,
  type SessionOwner,
  type SessionResult,
} from "@agentica/protocol";
import { desktopMode } from "./runtime";

export interface SessionAttachment {
  id: string;
  input(bytes: Uint8Array): Promise<void>;
  /** Bracketed paste; the backend never appends Enter. */
  paste(text: string): Promise<void>;
  resize(rows: number, cols: number, redraw?: boolean): Promise<void>;
  acknowledge(sequence: number): Promise<void>;
  detach(): Promise<void>;
}
export interface SessionClient {
  request<C extends SessionCommand>(
    command: C,
  ): Promise<SessionResult<C["op"]>>;
  subscribe(
    owner: SessionOwner,
    sessionId: string,
    after: number,
    event: (event: SessionEvent) => void,
    error: (error: Error) => void,
  ): Promise<SessionAttachment>;
  close(): Promise<void>;
}

type Listener = {
  event: (event: SessionEvent) => void;
  error: (error: Error) => void;
};
class Client implements SessionClient {
  private socket?: WebSocket;
  private ready?: Promise<void>;
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private listeners = new Map<string, Listener>();
  private attachments = new Set<SessionAttachment>();
  constructor(private key: () => string) {}

  private connect(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const socket = (this.socket = new WebSocket(
        "ws://127.0.0.1:1421/sessions",
      ));
      const deadline = setTimeout(() => {
        reject(new Error("Session connection timed out."));
        socket.close();
      }, 5000);
      socket.onopen = () =>
        socket.send(JSON.stringify({ op: "auth", key: this.key() }));
      socket.onmessage = (message) => {
        if (
          typeof message.data !== "string" ||
          new TextEncoder().encode(message.data).length >
            SESSION_LIMITS.wireBytes
        ) {
          socket.close();
          return;
        }
        let value: unknown;
        try {
          value = JSON.parse(message.data);
        } catch {
          socket.close();
          return;
        }
        if (
          typeof value === "object" &&
          value !== null &&
          "event" in value &&
          value.event === "ready"
        ) {
          clearTimeout(deadline);
          resolve();
          return;
        }
        const event = SessionEventSchema.safeParse(value);
        if (event.success) {
          this.listeners.get(event.data.attachmentId)?.event(event.data);
          return;
        }
        const response = SessionReplySchema.safeParse(value);
        if (!response.success) {
          socket.close();
          return;
        }
        const pending = this.pending.get(response.data.id);
        if (pending) {
          this.pending.delete(response.data.id);
          if ("error" in response.data)
            pending.reject(new Error(response.data.error.message));
          else pending.resolve(response.data.result);
        }
      };
      socket.onerror = () => {
        clearTimeout(deadline);
        reject(new Error("Cannot connect to native sessions."));
      };
      socket.onclose = () => {
        clearTimeout(deadline);
        const error = new Error(
          "Session transport disconnected. Reconnect to reconcile process status; input was not replayed.",
        );
        reject(error);
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        for (const listener of this.listeners.values()) listener.error(error);
        this.listeners.clear();
        this.attachments.clear();
        this.ready = undefined;
        this.socket = undefined;
      };
    });
    return this.ready;
  }

  async request<C extends SessionCommand>(
    command: C,
  ): Promise<SessionResult<C["op"]>> {
    const request = { id: crypto.randomUUID(), command };
    if (!SessionRequestSchema.safeParse(request).success)
      throw new Error("Invalid session request; nothing was sent.");
    const body = JSON.stringify(request);
    if (new TextEncoder().encode(body).length > SESSION_LIMITS.wireBytes)
      throw new Error("The session payload is too large.");
    let value: unknown;
    if (desktopMode) value = await invoke("session_request", { request });
    else {
      await this.connect();
      if (this.pending.size >= 32)
        throw new Error(
          "Too many pending terminal controls. Wait before retrying.",
        );
      value = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pending.delete(request.id);
          reject(
            new Error(
              "Session reply timed out. Query status before retrying a launch; do not replay input.",
            ),
          );
        }, 15000);
        this.pending.set(request.id, {
          resolve: (value) => {
            clearTimeout(timeout);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
        try {
          this.socket!.send(body);
        } catch (error) {
          this.pending.get(request.id)?.reject(error as Error);
          this.pending.delete(request.id);
        }
      });
    }
    const parsed = SessionResultSchemas[command.op].safeParse(value);
    if (!parsed.success)
      throw new Error("The backend returned an invalid session response.");
    return parsed.data as SessionResult<C["op"]>;
  }

  async subscribe(
    owner: SessionOwner,
    sessionId: string,
    after: number,
    event: Listener["event"],
    error: Listener["error"],
  ): Promise<SessionAttachment> {
    let id: string;
    if (desktopMode) {
      const channel = new Channel<unknown>();
      channel.onmessage = (value) => {
        const parsed = SessionEventSchema.safeParse(value);
        if (parsed.success) event(parsed.data);
        else error(new Error("Invalid native terminal event."));
      };
      const reply = await invoke("session_subscribe", {
        request: {
          id: crypto.randomUUID(),
          command: { op: "subscribe", owner, sessionId, after },
        },
        onEvent: channel,
      });
      id = SessionResultSchemas.subscribe.parse(reply).attachmentId;
    } else {
      id = (await this.request({ op: "subscribe", owner, sessionId, after }))
        .attachmentId;
      this.listeners.set(id, { event, error });
    }
    const reference = { owner, sessionId, attachmentId: id };
    const attachment: SessionAttachment = {
      id,
      input: async (bytes) => {
        await this.request({
          op: "input",
          ...reference,
          bytes: Array.from(bytes),
        });
      },
      paste: async (text) => {
        await this.request({ op: "paste", ...reference, text });
      },
      resize: async (rows, cols, redraw = false) => {
        await this.request({ op: "resize", ...reference, rows, cols, redraw });
      },
      acknowledge: async (sequence) => {
        await this.request({ op: "acknowledge", ...reference, sequence });
      },
      detach: async () => {
        this.listeners.delete(id);
        this.attachments.delete(attachment);
        await this.request({ op: "detach", ...reference });
      },
    };
    this.attachments.add(attachment);
    return attachment;
  }

  async close(): Promise<void> {
    await Promise.allSettled(
      [...this.attachments].map((attachment) => attachment.detach()),
    );
    this.socket?.close();
  }
}

export function createSessionClient(key: () => string): SessionClient {
  return new Client(key);
}
