import type { T3Project, T3Thread, T3Projection, T3ImageAttachment } from "./types";

type Json = Record<string, any>;
type Pending = {
  next?: (value: Json) => void;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
};
export function parsePairing(value: string, fallback: string) {
  if (!value.includes("://"))
    return { origin: localOrigin(fallback), credential: value.trim() };
  const url = new URL(value);
  const credential =
    new URLSearchParams(url.hash.slice(1)).get("token") ||
    url.searchParams.get("token");
  if (!credential) throw new Error("The pairing link has no token.");
  return {
    origin: localOrigin(url.searchParams.get("host") || url.origin),
    credential,
  };
}
function localOrigin(value: string) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("Use a T3 server on this machine.");
  return url.origin;
}
function protocolError(value: unknown): Error {
  const message = (value: unknown): string | undefined => {
    if (typeof value === "string") return value || undefined;
    if (!value || typeof value !== "object") return;
    const item = value as Json;
    if (typeof item.message === "string") return item.message;
    for (const key of ["error", "defect", "cause", "reason"]) {
      const found = message(item[key]);
      if (found) return found;
    }
    if (Array.isArray(value)) {
      for (const entry of value) { const found = message(entry); if (found) return found; }
    }
  };
  return new Error(message(value) || "T3 rejected this request without an error description.");
}

function normalizeThread(thread: Json): T3Thread {
  if (!("latestTurn" in thread)) return thread as T3Thread;
  return {
    ...thread,
    activeRunId: thread.session?.activeTurnId || (thread.latestTurn?.state === "running" ? thread.latestTurn.turnId : null),
    status: thread.session?.status || thread.latestTurn?.state || "idle",
  } as T3Thread;
}

// Narrow implementation of the Effect 4 JSON RPC envelope. Kept separate from UI
// because T3's internal wire protocol can change independently of GitGoblin.
export class T3Client {
  private socket?: WebSocket;
  private pending = new Map<string, Pending>();
  private nextId = 0;
  private heartbeat?: ReturnType<typeof setInterval>;
  private reconnect?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private failures = 0;
  private generation = 0;
  private lastReceived = 0;
  private readyTimeout?: ReturnType<typeof setTimeout>;
  private threadId = "";
  private legacyProtocol = false;
  private untitledThreads = new Set<string>();
  private cancelThread?: () => void;
  projects: T3Project[] = [];
  threads: T3Thread[] = [];
  projection?: T3Projection;
  status = "disconnected";
  error = "";
  onChange: () => void = () => {};
  constructor(private ticket: () => Promise<string>) {}
  private send(value: Json) {
    if (this.socket?.readyState !== WebSocket.OPEN)
      throw new Error("T3 is disconnected. Reconnect before sending.");
    this.socket.send(JSON.stringify(value));
  }
  private request(
    tag: string,
    payload: unknown,
    next?: (value: Json) => void,
  ): { promise: Promise<any>; cancel: () => void } {
    const id = String(++this.nextId);
    const promise = new Promise((resolve, reject) => {
      const timeout = next
        ? undefined
        : setTimeout(() => {
            this.pending.delete(id);
            reject(
              new Error(
                "T3 did not respond. Check the conversation before retrying; the action may have been received.",
              ),
            );
          }, 30000);
      this.pending.set(id, { resolve, reject, next, timeout });
      try {
        this.send({ _tag: "Request", id, tag, payload, headers: [] });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
    return {
      promise,
      cancel: () => {
        const item = this.pending.get(id);
        if (!item) return;
        clearTimeout(item.timeout);
        this.pending.delete(id);
        item.resolve(undefined);
        if (this.socket?.readyState === WebSocket.OPEN)
          this.send({ _tag: "Interrupt", requestId: id });
      },
    };
  }
  call(tag: string, payload: unknown) {
    return this.request(tag, payload).promise;
  }
  private receive(raw: string) {
    this.lastReceived = Date.now();
    const value = JSON.parse(raw);
    const frames = Array.isArray(value) ? value : [value];
    for (const frame of frames) {
      if (frame._tag === "Pong") continue;
      if (frame._tag === "Defect" || frame._tag === "ClientProtocolError")
        throw protocolError(frame);
      const id = String(frame.requestId);
      const item = this.pending.get(id);
      if (!item) continue;
      if (frame._tag === "Chunk") {
        if (!Array.isArray(frame.values))
          throw new Error("Unsupported T3 stream response.");
        for (const value of frame.values) item.next?.(value);
        this.send({ _tag: "Ack", requestId: id });
      } else if (frame._tag === "Exit") {
        clearTimeout(item.timeout);
        this.pending.delete(id);
        if (frame.exit?._tag === "Success") item.resolve(frame.exit.value);
        else item.reject(protocolError(frame.exit?.cause));
      }
    }
  }
  async connect() {
    this.stopped = false;
    clearTimeout(this.reconnect);
    this.status = "connecting";
    this.error = "";
    this.onChange();
    const generation = ++this.generation;
    clearInterval(this.heartbeat);
    clearTimeout(this.readyTimeout);
    this.socket?.close();
    for(const pending of this.pending.values()){clearTimeout(pending.timeout);pending.reject(new Error('Connection replaced. Check T3 before retrying an action.'));}
    this.pending.clear();
    try {
      const url = await this.ticket();
      if (generation !== this.generation || this.stopped) return;
      const socket = new WebSocket(url);
      this.socket = socket;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.close();
          reject(new Error("T3 connection timed out."));
        }, 15000);
        socket.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };
        socket.onerror = () => {
          clearTimeout(timeout);
          reject(
            new Error(
              "T3 connection failed. Check the pairing and server version.",
            ),
          );
        };
      });
      this.lastReceived = Date.now();
      socket.onmessage = (event) => {
        if(generation!==this.generation)return;
        try {
          this.receive(String(event.data));
        } catch (error) {
          this.error = String(error);
          socket.close();
        }
      };
      socket.onclose = () => this.lost(generation);
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastReceived > 20000) socket.close();
        else if (socket.readyState === WebSocket.OPEN)
          this.send({ _tag: "Ping" });
      }, 5000);
      // A snapshot proves data access; a socket opening alone does not.
      const stream = this.request(
        "orchestration.subscribeShell",
        {},
        (item) => {
          if (item.kind === "snapshot") {
            if (
              !Array.isArray(item.snapshot?.threads) ||
              !Array.isArray(item.snapshot?.projects)
            )
              throw new Error("Unsupported T3 shell snapshot.");
            clearTimeout(this.readyTimeout);
            this.projects = item.snapshot.projects;
            this.legacyProtocol = "snapshotSequence" in item.snapshot && !("schemaVersion" in item.snapshot);
            this.threads = item.snapshot.threads.map(normalizeThread);
            this.status = "connected";
            this.failures = 0;
          } else if ((item.kind === "thread.updated" || item.kind === "thread-upserted")) {
            this.threads = this.threads.filter((t) => t.id !== item.thread.id);
            if (item.location !== "archive") this.threads.push(normalizeThread(item.thread));
          } else if ((item.kind === "thread.removed" || item.kind === "thread-removed"))
            this.threads = this.threads.filter((t) => t.id !== item.threadId);
          else if ((item.kind === "project.updated" || item.kind === "project-upserted"))
            this.projects = [
              ...this.projects.filter((p) => p.id !== item.project.id),
              item.project,
            ];
          else if ((item.kind === "project.removed" || item.kind === "project-removed"))
            this.projects = this.projects.filter(
              (p) => p.id !== item.projectId,
            );
          this.onChange();
        },
      );
      this.readyTimeout = setTimeout(() => {
        if (this.status === "connecting") {
          this.error =
            "T3 did not provide a conversation snapshot. Check server compatibility.";
          socket.close();
        }
      }, 20000);
      stream.promise.catch((error) => {
        if (
          socket.readyState !== WebSocket.OPEN ||
          generation !== this.generation
        )
          return;
        this.error = error.message;
        this.status = "incompatible";
        this.stopped = true;
        socket.close();
        this.onChange();
      });
      stream.promise.then(()=>{if(generation===this.generation&&!this.stopped&&socket.readyState===WebSocket.OPEN){this.error='The T3 conversation stream ended. Reconnecting.';socket.close();}},()=>{});
      if (this.threadId) this.selectThread(this.threadId);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.lost(generation);
    }
  }
  private lost(generation: number) {
    if (generation !== this.generation) return;
    clearInterval(this.heartbeat);
    clearTimeout(this.readyTimeout);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(
        new Error(
          "Connection interrupted. Check T3 before retrying an action.",
        ),
      );
    }
    this.pending.clear();
    this.cancelThread = undefined;
    if (this.stopped) {
      this.onChange();
      return;
    }
    this.status = "disconnected";
    this.onChange();
    // Only reconnect transport and read subscriptions. Never replay mutations.
    if (++this.failures <= 5)
      this.reconnect = setTimeout(
        () => void this.connect(),
        Math.min(30000, 1000 * 2 ** this.failures) + Math.random() * 500,
      );
  }
  selectThread(id: string) {
    this.cancelThread?.();
    this.threadId = id;
    this.projection = undefined;
    this.onChange();
    if (!id || this.socket?.readyState !== WebSocket.OPEN) return;
    const generation = this.generation;
    const stream = this.request(
      "orchestration.subscribeThread",
      { threadId: id },
      (item) => {
        if (id !== this.threadId || generation !== this.generation) return;
        if (item.kind === "snapshot") {
          this.projection = item.projection || (item.snapshot?.thread ? {
            thread: normalizeThread(item.snapshot.thread),
            messages: item.snapshot.thread.messages || [],
            runtimeRequests: [],
            turnItems: [],
            activities: item.snapshot.thread.activities || [],
          } : undefined);
          this.onChange();
        } else if (item.kind === "event") {
          const event = item.event;
          const p = this.projection;
          if (!p) return;
          if (event.type === "thread.message-sent" && event.payload?.messageId) {
            const incoming = { ...event.payload, id: event.payload.messageId };
            const old = p.messages.find((message) => message.id === incoming.id);
            const message = old ? { ...old, ...incoming,
              text: incoming.streaming ? old.text + incoming.text : incoming.text || old.text,
            } : incoming;
            p.messages = old ? p.messages.map(value => value.id === message.id ? message : value) : [...p.messages, message];
          }
          if (event.type === "thread.activity-appended" && event.payload?.activity?.id) {
            const activity = event.payload.activity;
            p.activities = [...(p.activities || []).filter(value => value.id !== activity.id), activity];
          }
          const fields: Record<string, string> = {
            "message.created": "messages",
            "message.updated": "messages",
            "runtime-request.created": "runtimeRequests",
            "runtime-request.updated": "runtimeRequests",
            "turn-item.created": "turnItems",
            "turn-item.updated": "turnItems",
          };
          const field = fields[event.type];
          if (field && event.payload?.id) {
            const list = (p as any)[field] as Json[];
            (p as any)[field] = [
              ...list.filter((v) => v.id !== event.payload.id),
              event.payload,
            ];
          }
          if (event.type === "thread.updated") {
            p.thread = normalizeThread(event.payload);
            this.threads = this.threads.map(thread => thread.id === p.thread.id ? p.thread : thread);
          }
          this.onChange();
        }
      },
    );
    this.cancelThread = stream.cancel;
    stream.promise.catch((error) => {
      if (
        id === this.threadId &&
        generation === this.generation &&
        this.status === "connected"
      ) {
        this.error = error.message;
        this.onChange();
      }
    });
  }
  dispatch(command: Json) {
    return this.call("orchestration.dispatchCommand", command);
  }
  sendMessage(thread: T3Thread, text: string, attachments: T3ImageAttachment[] = []) {
    const titleSeed = text.trim() && (thread.title === "New conversation" || thread.title === "New thread") && (this.untitledThreads.has(thread.id) || (
      this.projection?.thread.id === thread.id &&
      !this.projection.messages.some(message => message.role === "user")
    )) ? { titleSeed: text.trim() } : {};
    const sent = this.legacyProtocol ? this.dispatch({
      type: "thread.turn.start",
      commandId: crypto.randomUUID(),
      threadId: thread.id,
      message: { messageId: crypto.randomUUID(), role: "user", text, attachments },
      modelSelection: thread.modelSelection,
      ...titleSeed,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      createdAt: new Date().toISOString(),
    }) : this.dispatch({
      type: "message.dispatch",
      commandId: crypto.randomUUID(),
      threadId: thread.id,
      messageId: crypto.randomUUID(),
      createdBy: "user",
      creationSource: "web",
      text,
      ...titleSeed,
      attachments,
      dispatchMode: {
        type: thread.activeRunId ? "queue_after_active" : "start_immediately",
      },
    });
    return sent.then(result => {
      this.untitledThreads.delete(thread.id);
      return result;
    });
  }
  stop(thread: T3Thread) {
    if (!thread.activeRunId) return Promise.resolve();
    if (this.legacyProtocol) return this.dispatch({
      type: "thread.turn.interrupt", commandId: crypto.randomUUID(),
      threadId: thread.id, turnId: thread.activeRunId, createdAt: new Date().toISOString(),
    });
    return this.dispatch({
      type: "run.interrupt",
      commandId: crypto.randomUUID(),
      threadId: thread.id,
      runId: thread.activeRunId,
      holdQueue: true,
    });
  }
  approve(threadId: string, requestId: string, decision: "accept" | "decline") {
    if (this.legacyProtocol) return this.dispatch({
      type: "thread.approval.respond", commandId: crypto.randomUUID(),
      threadId, requestId, decision, createdAt: new Date().toISOString(),
    });
    return this.dispatch({
      type: "runtime-request.respond",
      commandId: crypto.randomUUID(),
      threadId,
      requestId,
      decision,
    });
  }
  createThread(
    projectId: string,
    title: string,
    modelSelection: T3Thread["modelSelection"],
    worktreePath?: string,
  ) {
    if (this.legacyProtocol) {
      const threadId = crypto.randomUUID();
      return this.dispatch({
        type: "thread.create", commandId: crypto.randomUUID(), threadId, projectId,
        // The legacy server only generates titles for its own placeholder.
        title: title === "New conversation" ? "New thread" : title, modelSelection, runtimeMode: "full-access", interactionMode: "default",
        branch: null, worktreePath: worktreePath || null, createdAt: new Date().toISOString(),
      }).then(() => {
        if (title === "New conversation") this.untitledThreads.add(threadId);
        return { threadId };
      });
    }
    return this.call("orchestration.launchThread", {
      commandId: crypto.randomUUID(),
      creationSource: "web",
      projectId,
      title,
      modelSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      workspaceStrategy: worktreePath
        ? { type: "existing_worktree", worktreePath }
        : { type: "root" },
    }).then(result => {
      if (title === "New conversation") this.untitledThreads.add(result.threadId);
      return result;
    });
  }
  disconnect() {
    this.stopped = true;
    this.generation++;
    clearTimeout(this.reconnect);
    clearTimeout(this.readyTimeout);
    clearInterval(this.heartbeat);
    this.socket?.close();
    for (const item of this.pending.values()) {
      clearTimeout(item.timeout);
      item.reject(new Error("Disconnected."));
    }
    this.pending.clear();
    this.status = "disconnected";
    this.onChange();
  }
}
