import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { visibleThreads } from "../app/lib/threads";
import { parsePairing, T3Client } from "../app/lib/t3";
class FakeSocket {
  static OPEN = 1;
  static latest: FakeSocket;
  readyState = 0;
  sent: any[] = [];
  onopen?: () => void;
  onerror?: () => void;
  onclose?: () => void;
  onmessage?: (event: { data: string }) => void;
  constructor(public url: string) {
    FakeSocket.latest = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  send(value: string) {
    this.sent.push(JSON.parse(value));
  }
  receive(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
const clients: T3Client[] = [];
beforeEach(() => vi.stubGlobal("WebSocket", FakeSocket));
afterEach(() => {
  clients.forEach((c) => c.disconnect());
  clients.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("T3 client contract", () => {
  it("reconnects read subscriptions without replaying a possibly received mutation", async () => {
    vi.useFakeTimers();
    const client = new T3Client(async () => "ws://127.0.0.1/ws");
    clients.push(client);
    await client.connect();
    const first = FakeSocket.latest;
    first.receive({
      _tag: "Chunk",
      requestId: first.sent[0].id,
      values: [{ kind: "snapshot", snapshot: { projects: [], threads: [] } }],
    });
    const mutation = client.dispatch({
      type: "message.dispatch",
      commandId: "only-once",
    });
    const rejection = expect(mutation).rejects.toThrow("Check T3");
    first.close();
    await rejection;
    await vi.advanceTimersByTimeAsync(3000);
    const second = FakeSocket.latest;
    expect(second).not.toBe(first);
    expect(second.sent.map((v) => v.tag)).toEqual([
      "orchestration.subscribeShell",
    ]);
  });
  it("keeps conversation order through updates and removes settled conversations", async () => {
    const client = new T3Client(async () => "ws://127.0.0.1/ws");
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    const requestId = socket.sent[0].id;
    const first = { id: "first", createdAt: "2026-10-16", activeOrderKey: "b" };
    const second = { id: "second", createdAt: "2026-10-15", activeOrderKey: "z" };
    const receive = (item: unknown) => socket.receive({ _tag: "Chunk", requestId, values: [item] });
    receive({ kind: "snapshot", snapshot: { projects: [], threads: [second, first] } });
    receive({ kind: "thread.updated", thread: { ...first, title: "Updated" } });
    expect(visibleThreads(client.threads).map((t) => t.id)).toEqual(["first", "second"]);
    receive({ kind: "thread.updated", thread: { ...first, settledOverride: "settled" } });
    expect(visibleThreads(client.threads).map((t) => t.id)).toEqual(["second"]);
    client.selectThread("second");
    const subscriptions = socket.sent.filter((frame) => frame.tag === "orchestration.subscribeThread").length;
    client.selectThread("");
    expect(socket.sent.filter((frame) => frame.tag === "orchestration.subscribeThread")).toHaveLength(subscriptions);
    expect(client.projection).toBeUndefined();
  });
  it("extracts pairing links without accepting remote servers", () => {
    expect(parsePairing("http://127.0.0.1:3773/#token=test", "")).toEqual({
      origin: "http://127.0.0.1:3773",
      credential: "test",
    });
    expect(() => parsePairing("https://example.com/#token=test", "")).toThrow(
      "machine",
    );
    expect(() => parsePairing("abc", "http://localhost.example.com")).toThrow(
      "machine",
    );
  });
  it("waits for a shell snapshot before reporting connected and acknowledges streams", async () => {
    const client = new T3Client(async () => "ws://127.0.0.1/ws");
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    expect(client.status).toBe("connecting");
    const request = socket.sent[0];
    expect(request.tag).toBe("orchestration.subscribeShell");
    socket.receive({
      _tag: "Chunk",
      requestId: request.id,
      values: [{ kind: "snapshot", snapshot: { projects: [], threads: [] } }],
    });
    expect(client.status).toBe("connected");
    expect(socket.sent.at(-1)).toEqual({ _tag: "Ack", requestId: request.id });
  });
  it("correlates command responses and propagates domain failures", async () => {
    const client = new T3Client(async () => "ws://127.0.0.1/ws");
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    const result = client.dispatch({
      type: "runtime-request.respond",
      requestId: "r",
      decision: "accept",
    });
    const request = socket.sent.at(-1);
    expect(request.payload.decision).toBe("accept");
    socket.receive({
      _tag: "Exit",
      requestId: request.id,
      exit: { _tag: "Success", value: { sequence: 42 } },
    });
    await expect(result).resolves.toEqual({ sequence: 42 });
    const denied = client.call("example", {});
    socket.receive({
      _tag: "Exit",
      requestId: socket.sent.at(-1).id,
      exit: {
        _tag: "Failure",
        cause: [{ _tag: "Fail", error: { message: "Permission denied" } }],
      },
    });
    await expect(denied).rejects.toThrow("Permission denied");
  });
  it("uses the installed T3 turn protocol and displays streamed messages", async () => {
    const client = new T3Client(async () => "ws://127.0.0.1/ws");
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    const thread = { id: "one", projectId: "project", title: "Test", latestTurn: null,
      session: null, modelSelection: { instanceId: "codex", model: "test" },
      runtimeMode: "full-access", interactionMode: "default" };
    socket.receive({ _tag: "Chunk", requestId: socket.sent[0].id,
      values: [{ kind: "snapshot", snapshot: { snapshotSequence: 1, projects: [], threads: [thread] } }] });
    const sent = client.sendMessage(client.threads[0]!, "hello");
    const command = socket.sent.at(-1);
    expect(command.payload).toMatchObject({ type: "thread.turn.start", threadId: "one",
      message: { role: "user", text: "hello", attachments: [] }, runtimeMode: "full-access" });
    expect(command.payload.createdAt).toBeTruthy();
    socket.receive({ _tag: "Exit", requestId: command.id, exit: { _tag: "Success", value: { sequence: 2 } } });
    await sent;
    client.selectThread("one");
    const subscription = socket.sent.at(-1).id;
    const receive = (item: unknown) => socket.receive({ _tag: "Chunk", requestId: subscription, values: [item] });
    receive({ kind: "snapshot", snapshot: { thread: { ...thread, messages: [] } } });
    for (const [text, streaming] of [["Hel", true], ["lo", true], ["", false]]) {
      receive({ kind: "event", event: { type: "thread.message-sent", payload: {
        messageId: "reply", role: "assistant", text, streaming, createdAt: "2026-10-16" } } });
    }
    expect(client.projection?.messages).toMatchObject([{ id: "reply", text: "Hello", streaming: false }]);
    socket.receive({ _tag: "Chunk", requestId: socket.sent[0].id, values: [{ kind: "thread-upserted", thread: {
      ...thread, latestTurn: { state: "running", turnId: "turn" } } }] });
    expect(client.threads[0]?.activeRunId).toBe("turn");
  });
  it("keeps the newer message protocol and surfaces string defects", async () => {
    const client = new T3Client(async () => "ws://127.0.0.1/ws");
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    socket.receive({ _tag: "Chunk", requestId: socket.sent[0].id, values: [{ kind: "snapshot",
      snapshot: { schemaVersion: 2, snapshotSequence: 1, projects: [], threads: [] } }] });
    const thread = { id: "one", activeRunId: "running" } as any;
    const sent = client.sendMessage(thread, "hello");
    const command = socket.sent.at(-1);
    expect(command.payload).toMatchObject({ type: "message.dispatch", text: "hello", dispatchMode: { type: "queue_after_active" } });
    const rejected = expect(sent).rejects.toThrow("Unsupported command");
    socket.receive({ _tag: "Exit", requestId: command.id,
      exit: { _tag: "Failure", cause: [{ _tag: "Die", defect: "Unsupported command" }] } });
    await rejected;
    expect(socket.sent.filter((frame) => frame.tag === "orchestration.dispatchCommand")).toHaveLength(1);
  });
  it("drops old thread subscriptions on selection", async () => {
    const client = new T3Client(async () => "ws://127.0.0.1/ws");
    clients.push(client);
    await client.connect();
    client.selectThread("one");
    const first = FakeSocket.latest.sent.at(-1);
    client.selectThread("two");
    expect(FakeSocket.latest.sent).toContainEqual({
      _tag: "Interrupt",
      requestId: first.id,
    });
    FakeSocket.latest.receive({
      _tag: "Chunk",
      requestId: first.id,
      values: [{ kind: "snapshot", projection: { thread: { id: "one" } } }],
    });
    expect(client.projection).toBeUndefined();
  });
});
