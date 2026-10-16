import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
