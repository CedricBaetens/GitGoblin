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
  it.each([false, true])('switches an idle chat worktree through T3 (legacy=%s)', async legacy => {
    const client = new T3Client(async () => 'ws://127.0.0.1/ws');
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    socket.receive({ _tag: 'Chunk', requestId: socket.sent[0].id, values: [{ kind: 'snapshot', snapshot: {
      ...(legacy ? { snapshotSequence: 1 } : { schemaVersion: 2 }), projects: [], threads: [],
    } }] });
    const thread = { id: 'one', status: 'idle', activeRunId: null } as Parameters<T3Client['switchWorktree']>[0];
    const switching = client.switchWorktree(thread, 'D:/feature', 'feature');
    const command = socket.sent.at(-1);
    expect(command).toMatchObject({ tag: 'orchestration.dispatchCommand', payload: {
      type: 'thread.meta.update', threadId: 'one', worktreePath: 'D:/feature', branch: 'feature',
    } });
    socket.receive({ _tag: 'Exit', requestId: command.id, exit: { _tag: 'Success', value: {} } });
    await switching;
    const sent = socket.sent.length;
    await expect(client.switchWorktree({ ...thread, activeRunId: 'run' }, 'D:/other', null)).rejects.toThrow('Stop the agent');
    await expect(client.switchWorktree({ ...thread, status: 'starting' }, 'D:/other', null)).rejects.toThrow('Stop the agent');
    await expect(client.switchWorktree(thread, ' ', null)).rejects.toThrow('Choose a worktree');
    expect(socket.sent).toHaveLength(sent);
  });

  it('reads model capabilities from the server catalog', async () => {
    const client = new T3Client(async () => 'ws://127.0.0.1/ws');
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    const loading = client.listModels();
    const command = socket.sent.at(-1);
    expect(command).toMatchObject({ tag: 'server.getConfig', payload: {} });
    const providers = [{ instanceId: 'codex', models: [{ slug: 'gpt-6.1-sol', name: 'GPT-6.1 Sol',
      capabilities: { optionDescriptors: [{ id: 'serviceTier', type: 'select', options: [{ id: 'fast', label: 'Fast' }] }] } }] }];
    socket.receive({ _tag: 'Exit', requestId: command.id, exit: { _tag: 'Success', value: { providers } } });
    expect(await loading).toEqual(providers);
  });
  it('keeps background chat subscriptions and activity separate when switching or closing tabs', async () => {
    const client = new T3Client(async () => 'ws://127.0.0.1/ws');
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    client.watchThreads(['repo-a', 'repo-b']);
    client.selectThread('repo-a');
    const subscriptions = socket.sent.filter(frame => frame.tag === 'orchestration.subscribeThread');
    expect(subscriptions.map(frame => frame.payload.threadId)).toEqual(['repo-a', 'repo-b']);
    for (const subscription of subscriptions) {
      socket.receive({ _tag: 'Chunk', requestId: subscription.id, values: [{ kind: 'snapshot', projection: {
        thread: { id: subscription.payload.threadId }, messages: [], runtimeRequests: [], turnItems: [],
      } }] });
    }
    client.selectThread('repo-b');
    const background = subscriptions[0];
    socket.receive({ _tag: 'Chunk', requestId: background.id, values: [{ kind: 'event', event: {
      type: 'runtime-request.created', payload: { id: 'approval', kind: 'approval', status: 'pending' },
    } }] });
    expect(client.projection?.thread.id).toBe('repo-b');
    expect(client.projection?.runtimeRequests).toEqual([]);
    expect(client.projections.get('repo-a')?.runtimeRequests[0]?.id).toBe('approval');
    client.selectThread('');
    expect(client.projection).toBeUndefined();
    expect(client.projections.get('repo-a')?.runtimeRequests).toHaveLength(1);
    expect(socket.sent.filter(frame => frame._tag === 'Interrupt')).toEqual([]);
    expect(socket.sent.filter(frame => frame.tag === 'orchestration.dispatchCommand')).toEqual([]);
    client.watchThreads(['repo-a']);
    expect(socket.sent.filter(frame => frame._tag === 'Interrupt')).toEqual([{ _tag: 'Interrupt', requestId: subscriptions[1].id }]);
  });
  it('retains archived shell updates for history and removes deleted conversations', async () => {
    const client = new T3Client(async () => 'ws://127.0.0.1/ws');
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    const receive = (item: unknown) => socket.receive({ _tag: 'Chunk', requestId: socket.sent[0].id, values: [item] });
    receive({ kind: 'snapshot', snapshot: { schemaVersion: 2, projects: [], threads: [{ id: 'one' }] } });
    receive({ kind: 'thread.updated', location: 'archive', thread: { id: 'one', title: 'Archived' } });
    expect(client.threads[0]).toMatchObject({ id: 'one', title: 'Archived', archivedAt: expect.any(String) });
    receive({ kind: 'thread.removed', threadId: 'one' });
    expect(client.threads).toEqual([]);
  });
  it.each([false, true])('settles conversations through T3 and waits for authoritative updates (legacy=%s)', async legacy => {
    const client = new T3Client(async () => 'ws://127.0.0.1/ws');
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    const requestId = socket.sent[0].id;
    const thread = { id: 'one', title: 'Finished work' };
    const receive = (item: unknown) => socket.receive({ _tag: 'Chunk', requestId, values: [item] });
    receive({ kind: 'snapshot', snapshot: {
      ...(legacy ? { snapshotSequence: 1 } : { schemaVersion: 2 }), projects: [], threads: [thread],
    } });
    const rejected = client.settle('one');
    const failedCommand = socket.sent.at(-1);
    socket.receive({ _tag: 'Exit', requestId: failedCommand.id, exit: { _tag: 'Failure', cause: { message: 'Cannot settle' } } });
    await expect(rejected).rejects.toThrow('Cannot settle');
    expect(visibleThreads(client.threads).map(thread => thread.id)).toEqual(['one']);

    const settling = client.settle('one');
    const command = socket.sent.at(-1);
    expect(command).toMatchObject({ tag: 'orchestration.dispatchCommand', payload: {
      type: 'thread.settle', commandId: expect.any(String), threadId: 'one',
    } });
    expect(command.payload.commandId).not.toBe(failedCommand.payload.commandId);
    socket.receive({ _tag: 'Exit', requestId: command.id, exit: { _tag: 'Success', value: {} } });
    await settling;
    expect(visibleThreads(client.threads)).toHaveLength(1);
    receive({ kind: legacy ? 'thread-upserted' : 'thread.updated', thread: { ...thread, settledOverride: 'settled' } });
    expect(visibleThreads(client.threads)).toEqual([]);
  });
  it('loads skills for the exact provider and worktree', async () => {
    const client = new T3Client(async () => 'ws://127.0.0.1/ws');
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    const loading = client.listSkills('codex', 'D:/feature');
    const command = socket.sent.at(-1);
    expect(command).toMatchObject({ tag: 'server.refreshProviders', payload: { instanceId: 'codex', cwd: 'D:/feature' } });
    socket.receive({ _tag: 'Exit', requestId: command.id, exit: { _tag: 'Success', value: { providers: [{ instanceId: 'codex',
      skills: [{ name: 'global', enabled: true }], workspaceSnapshots: [{ cwd: 'D:/feature', skills: [{ name: 'triage', enabled: true, userInvocationOnly: true }] }],
    }] } } });
    expect((await loading).map(skill => skill.name)).toEqual(['triage']);
  });
  it.each([false, true])('responds to questions with native answer values (legacy=%s)', async legacy => {
    const client = new T3Client(async () => 'ws://127.0.0.1/ws');
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    socket.receive({ _tag: 'Chunk', requestId: socket.sent[0].id, values: [{ kind: 'snapshot', snapshot: {
      ...(legacy ? { snapshotSequence: 1 } : { schemaVersion: 2 }), projects: [], threads: [],
    } }] });
    const answers = { scope: ['web', 'server'], detail: 'Keep current behavior' };
    const responding = client.answerQuestions('one', 'input', answers);
    const command = socket.sent.at(-1);
    expect(command.payload).toMatchObject({ type: legacy ? 'thread.user-input.respond' : 'runtime-request.respond', threadId: 'one', requestId: 'input', answers });
    expect(command.payload.decision).toBeUndefined();
    socket.receive({ _tag: 'Exit', requestId: command.id, exit: { _tag: 'Success', value: {} } });
    await responding;
  });
  it.each([false, true])('sends uploaded image attachments without requiring text (legacy=%s)', async legacy => {
    const client = new T3Client(async () => 'ws://127.0.0.1/ws');
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    socket.receive({ _tag: 'Chunk', requestId: socket.sent[0].id, values: [{ kind: 'snapshot', snapshot: {
      ...(legacy ? { snapshotSequence: 1 } : { schemaVersion: 2 }), projects: [], threads: [],
    } }] });
    const attachment = { type: 'image' as const, id: 'uploaded-image', name: 'screenshot.png', mimeType: 'image/png', sizeBytes: 4 };
    const sending = client.sendMessage({ id: 'one', modelSelection: { instanceId: 'codex', model: 'test' } } as any, '', [attachment]);
    const command = socket.sent.at(-1);
    expect(legacy ? command.payload.message : command.payload).toMatchObject({ text: '', attachments: [attachment] });
    socket.receive({ _tag: 'Exit', requestId: command.id, exit: { _tag: 'Success', value: {} } });
    await sending;
  });
  it("creates a placeholder the legacy server allows an automatic title to replace", async () => {
    const client = new T3Client(async () => "ws://127.0.0.1/ws");
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    socket.receive({ _tag: "Chunk", requestId: socket.sent[0].id, values: [{ kind: "snapshot", snapshot: {
      snapshotSequence: 1, projects: [], threads: [],
    } }] });
    const creating = client.createThread("project", "New conversation", { instanceId: "codex", model: "test" });
    const createdTitle = socket.sent.at(-1).payload.title;
    socket.receive({ _tag: "Exit", requestId: socket.sent.at(-1).id, exit: { _tag: "Success", value: {} } });
    const { threadId } = await creating;
    const sending = client.sendMessage({ id: threadId, title: createdTitle } as any, "Investigate ticket 42");
    const seed = socket.sent.at(-1).payload.titleSeed;
    socket.receive({ _tag: "Exit", requestId: socket.sent.at(-1).id, exit: { _tag: "Success", value: {} } });
    await sending;
    // T3 0.0.45 ProviderCommandReactor's canReplaceThreadTitle contract:
    // only its default placeholder or a title matching the seed can be replaced.
    const canReplace = createdTitle.trim() === "New thread" || (!!seed?.trim() && createdTitle.trim() === seed.trim());
    expect(canReplace).toBe(true);
    expect(seed).toBe("Investigate ticket 42");
  });

  it.each([false, true])("creates an empty conversation in its worktree and seeds only its first message title (legacy=%s)", async legacy => {
    const client = new T3Client(async () => "ws://127.0.0.1/ws");
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    socket.receive({ _tag: "Chunk", requestId: socket.sent[0].id, values: [{ kind: "snapshot", snapshot: {
      ...(legacy ? { snapshotSequence: 1 } : { schemaVersion: 2 }), projects: [], threads: [],
    } }] });
    const acknowledge = (value: unknown) => socket.receive({ _tag: "Exit", requestId: socket.sent.at(-1).id,
      exit: { _tag: "Success", value } });
    const modelSelection = { instanceId: "codex", model: "gpt-6.1-sol", options: [
      { id: 'reasoningEffort', value: 'high' }, { id: 'serviceTier', value: 'fast' },
    ] };
    const creating = client.createThread("project", "New conversation", modelSelection, "D:/feature");
    const creation = socket.sent.at(-1);
    expect(creation.payload).toMatchObject({ title: legacy ? "New thread" : "New conversation", projectId: "project", modelSelection, runtimeMode: "full-access" });
    expect(creation.payload.initialMessage).toBeUndefined();
    if (legacy) expect(creation.payload.worktreePath).toBe("D:/feature");
    else expect(creation.payload.workspaceStrategy).toEqual({ type: "existing_worktree", worktreePath: "D:/feature" });
    acknowledge({ threadId: "new" });
    const { threadId } = await creating;
    const thread = { id: threadId, title: creation.payload.title, modelSelection, runtimeMode: "full-access", interactionMode: "default" } as any;
    expect(socket.sent.filter(frame => frame.payload?.type === "message.dispatch" || frame.payload?.type === "thread.turn.start")).toHaveLength(0);
    const sending = client.sendMessage(thread, "/triage #42");
    expect(socket.sent.at(-1).payload).toMatchObject({ titleSeed: "/triage #42", threadId });
    if (legacy) expect(socket.sent.at(-1).payload.runtimeMode).toBe("full-access");
    acknowledge({});
    await sending;
    const followup = client.sendMessage(thread, "Continue");
    expect(socket.sent.at(-1).payload.titleSeed).toBeUndefined();
    acknowledge({});
    await followup;
  });

  it.each([false, true])("preserves an explicit ticket title without requesting title generation (legacy=%s)", async legacy => {
    const client = new T3Client(async () => "ws://127.0.0.1/ws");
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    socket.receive({ _tag: "Chunk", requestId: socket.sent[0].id, values: [{ kind: "snapshot", snapshot: {
      ...(legacy ? { snapshotSequence: 1 } : { schemaVersion: 2 }), projects: [], threads: [],
    } }] });
    const title = '#42 · Fix login · Triage';
    const modelSelection = { instanceId: 'codex', model: 'test' };
    const creating = client.createThread('project', title, modelSelection);
    expect(socket.sent.at(-1).payload.title).toBe(title);
    socket.receive({ _tag: 'Exit', requestId: socket.sent.at(-1).id, exit: { _tag: 'Success', value: { threadId: 'new' } } });
    const { threadId } = await creating;
    const sending = client.sendMessage({ id: threadId, title, modelSelection } as any, '/triage #42');
    expect(socket.sent.at(-1).payload.titleSeed).toBeUndefined();
    socket.receive({ _tag: 'Exit', requestId: socket.sent.at(-1).id, exit: { _tag: 'Success', value: {} } });
    await sending;
  });

  it.each(["New conversation", "New thread"])("seeds a restored empty %s but preserves an existing conversation title", async title => {
    const client = new T3Client(async () => "ws://127.0.0.1/ws");
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    const thread = { id: "empty", title } as any;
    client.selectThread(thread.id);
    const subscription = socket.sent.findLast(frame => frame.tag === 'orchestration.subscribeThread');
    socket.receive({ _tag: 'Chunk', requestId: subscription.id, values: [{ kind: 'snapshot', projection: { thread, messages: [], runtimeRequests: [], turnItems: [] } }] });
    const first = client.sendMessage(thread, "Investigate issue");
    expect(socket.sent.at(-1).payload.titleSeed).toBe("Investigate issue");
    socket.receive({ _tag: "Exit", requestId: socket.sent.at(-1).id, exit: { _tag: "Success", value: {} } });
    await first;
    client.projection!.messages.push({ role: "user" } as any);
    const second = client.sendMessage(thread, "Follow up");
    expect(socket.sent.at(-1).payload.titleSeed).toBeUndefined();
    socket.receive({ _tag: "Exit", requestId: socket.sent.at(-1).id, exit: { _tag: "Success", value: {} } });
    await second;
  });

  it("retains title generation after a rejected first message and respects a manual rename", async () => {
    const client = new T3Client(async () => "ws://127.0.0.1/ws");
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    const creating = client.createThread("project", "New conversation", { instanceId: "codex", model: "test" });
    socket.receive({ _tag: "Exit", requestId: socket.sent.at(-1).id, exit: { _tag: "Success", value: { threadId: "new" } } });
    await creating;
    const thread = { id: "new", title: "New conversation" } as any;
    const first = client.sendMessage(thread, "Investigate issue");
    const rejected = expect(first).rejects.toThrow("Rejected");
    socket.receive({ _tag: "Exit", requestId: socket.sent.at(-1).id,
      exit: { _tag: "Failure", cause: [{ _tag: "Die", defect: "Rejected" }] } });
    await rejected;
    const retry = client.sendMessage(thread, "Revised instruction");
    expect(socket.sent.at(-1).payload.titleSeed).toBe("Revised instruction");
    socket.receive({ _tag: "Exit", requestId: socket.sent.at(-1).id,
      exit: { _tag: "Failure", cause: [{ _tag: "Die", defect: "Rejected" }] } });
    await expect(retry).rejects.toThrow("Rejected");
    thread.title = "My title";
    const renamed = client.sendMessage(thread, "Continue");
    expect(socket.sent.at(-1).payload.titleSeed).toBeUndefined();
    socket.receive({ _tag: "Exit", requestId: socket.sent.at(-1).id, exit: { _tag: "Success", value: {} } });
    await renamed;
  });
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
      const previous = client.projection?.messages[0];
      receive({ kind: "event", event: { type: "thread.message-sent", payload: {
        messageId: "reply", role: "assistant", text, streaming, createdAt: "2026-10-16" } } });
      expect(client.projection?.messages[0]).not.toBe(previous);
      expect(client.projection?.messages[0]?.streaming).toBe(streaming);
    }
    expect(client.projection?.messages).toMatchObject([{ id: "reply", text: "Hello", streaming: false }]);
    socket.receive({ _tag: "Chunk", requestId: socket.sent[0].id, values: [{ kind: "thread-upserted", thread: {
      ...thread, latestTurn: { state: "running", turnId: "turn" } } }] });
    expect(client.threads[0]?.activeRunId).toBe("turn");
    receive({ kind: "event", event: { type: "thread.activity-appended", payload: { activity: {
      id: 'activity', turnId: 'turn', tone: 'tool', kind: 'tool.started', summary: 'Reading file', createdAt: '2026-10-16',
    } } } });
    expect(client.projection?.activities).toMatchObject([{ summary: 'Reading file' }]);
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
  it("applies modern streamed text, activity and run completion without waiting for a new snapshot", async () => {
    const client = new T3Client(async () => "ws://127.0.0.1/ws");
    clients.push(client);
    await client.connect();
    const socket = FakeSocket.latest;
    const thread = { id: 'one', activeRunId: 'run', status: 'running' };
    socket.receive({ _tag: 'Chunk', requestId: socket.sent[0].id, values: [{ kind: 'snapshot', snapshot: { schemaVersion: 2, projects: [], threads: [thread] } }] });
    client.selectThread('one');
    const id = socket.sent.at(-1).id;
    const receive = (value: unknown) => socket.receive({ _tag: 'Chunk', requestId: id, values: [value] });
    receive({ kind: 'snapshot', projection: { thread, messages: [], turnItems: [], runtimeRequests: [] } });
    for (const text of ['Hel', 'Hello']) {
      receive({ kind: 'event', event: { type: 'message.updated', payload: { id: 'reply', role: 'assistant', text, streaming: true, createdAt: '2026-10-16' } } });
      expect(client.projection?.messages[0]?.text).toBe(text);
    }
    receive({ kind: 'event', event: { type: 'turn-item.updated', payload: { id: 'tool', type: 'command_execution', runId: 'run', title: 'Run tests', status: 'running' } } });
    expect(client.projection?.turnItems).toMatchObject([{ title: 'Run tests', status: 'running' }]);
    receive({ kind: 'event', event: { type: 'thread.updated', payload: { ...thread, activeRunId: null, status: 'idle' } } });
    expect(client.threads[0]?.activeRunId).toBeNull();
  });
});
