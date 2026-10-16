<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from "vue";
import {
  Bot,
  ArrowUp,
  Square,
  Plus,
  X,
  Link2,
  Unplug,
  MessageSquare,
  ShieldCheck,
  ChevronRight,
} from "lucide-vue-next";
import { T3Client, parsePairing } from "~/lib/t3";
import { invoke, desktop } from "~/lib/native";
import type { T3Thread, T3Project, T3Projection } from "~/lib/types";
const props = defineProps<{
  context: string;
  example: boolean;
  repo: string;
}>();
const emit = defineEmits<{
  clearContext: [];
  selectWorktree: [path: string, threadId: string];
  threads: [threads: T3Thread[], projects: T3Project[], connected: boolean];
}>();
const client = new T3Client(() => invoke<string>("t3_ticket"));
const state = ref("disconnected"),
  error = ref(""),
  threads = ref<T3Thread[]>([]),
  projects = ref<T3Project[]>([]),
  projection = ref<T3Projection>(),
  selectedId = ref("");
const pairing = ref(""),
  origin = ref("http://127.0.0.1:3773"),
  prompt = ref(""),
  sending = ref(false),
  showPairing = ref(false),
  showNew = ref(false);
const newProject = ref(""),
  newTitle = ref(""),
  newModel = ref("");
const modelOptions = computed(() => {
  const options = new Map<string, { instanceId: string; model: string }>();
  for (const selection of [
    ...projects.value.map((p) => p.defaultModelSelection),
    ...threads.value.map((t) => t.modelSelection),
  ]) {
    if (selection) options.set(JSON.stringify(selection), selection);
  }
  return [...options].map(([value, selection]) => ({
    value,
    label: `${selection.instanceId} · ${selection.model}`,
  }));
});
const drafts = new Map<string, string>();
const thread = computed(() =>
  threads.value.find((t) => t.id === selectedId.value),
);
const messages = computed(() =>
  [...(projection.value?.messages || [])].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  ),
);
const requests = computed(
  () =>
    projection.value?.runtimeRequests.filter((r) => r.status === "pending") ||
    [],
);
const connected = computed(() => state.value === "connected");
const matchingThreads = computed(() =>
  threads.value.filter(
    (t) =>
      normalize(
        t.worktreePath ||
          projects.value.find((p) => p.id === t.projectId)?.workspaceRoot ||
          "",
      ) === normalize(props.repo),
  ),
);
const normalize = (s: string) =>
  s.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
client.onChange = () => {
  state.value = client.status;
  error.value = client.error;
  threads.value = [...client.threads];
  projects.value = [...client.projects];
  projection.value = client.projection ? { ...client.projection } : undefined;
  emit("threads", threads.value, projects.value, connected.value);
};
function select(id: string) {
  if (selectedId.value) drafts.set(selectedId.value, prompt.value);
  prompt.value = drafts.get(id) || "";
  selectedId.value = id;
  client.selectThread(id);
  const t = threads.value.find((t) => t.id === id);
  const path =
    t?.worktreePath ||
    projects.value.find((p) => p.id === t?.projectId)?.workspaceRoot;
  if (path) emit("selectWorktree", path, id);
}
async function pair() {
  try {
    if (!desktop()) throw new Error("Pairing is available in the desktop app.");
    const input = parsePairing(pairing.value, origin.value);
    await invoke("t3_pair", input);
    pairing.value = "";
    showPairing.value = false;
    await client.connect();
  } catch (e) {
    error.value = String(e);
  }
}
async function disconnect() {
  client.disconnect();
  await invoke("t3_disconnect");
  projection.value = undefined;
  threads.value = [];
  projects.value = [];
  emit("threads", [], [], false);
}
async function send() {
  if (!thread.value || !prompt.value.trim() || sending.value) return;
  sending.value = true;
  error.value = "";
  const submittedThread = thread.value;
  const submittedText = prompt.value;
  try {
    await client.sendMessage(
      submittedThread,
      submittedText +
        (props.context
          ? `\n\nSelected Git context (for review):\n\n${props.context}`
          : ""),
    );
    drafts.delete(submittedThread.id);
    if (
      selectedId.value === submittedThread.id &&
      prompt.value === submittedText
    ) {
      prompt.value = "";
      emit("clearContext");
    }
  } catch (e) {
    error.value = String(e);
  } finally {
    sending.value = false;
  }
}
async function stop() {
  if (!thread.value) return;
  try {
    await client.stop(thread.value);
  } catch (e) {
    error.value = String(e);
  }
}
async function respond(id: string, decision: "accept" | "decline") {
  if (!thread.value) return;
  try {
    await client.approve(thread.value.id, id, decision);
  } catch (e) {
    error.value = String(e);
  }
}
async function create() {
  try {
    const result = await client.createThread(
      newProject.value,
      newTitle.value,
      JSON.parse(newModel.value),
    );
    showNew.value = false;
    select(result.threadId);
  } catch (e) {
    error.value = String(e);
  }
}
function newChat() {
  showNew.value = true;
  newProject.value = thread.value?.projectId || projects.value[0]?.id || "";
  newModel.value = thread.value
    ? JSON.stringify(thread.value.modelSelection)
    : modelOptions.value[0]?.value || "";
}
function approvalContext(id: string) {
  const items = projection.value?.turnItems || [];
  const item = items.find(
    (item) => item.type === "approval_request" && item.requestId === id,
  );
  return typeof item?.prompt === "string" ? item.prompt : "";
}
onMounted(async () => {
  if (desktop()) {
    const found = await invoke<string | null>("t3_discover");
    if (found) origin.value = found;
  }
});
onUnmounted(() => client.disconnect());
defineExpose({
  select,
  stopAll: async () => {
    for (const t of matchingThreads.value.filter((t) => t.activeRunId))
      await client.stop(t);
  },
});
</script>
<template>
  <aside class="chat-panel">
    <div class="panel-heading">
      <span><MessageSquare :size="15" />Conversations</span>
      <div class="button-row">
        <button
          class="icon-button"
          title="New conversation"
          :disabled="!connected"
          @click="newChat"
        >
          <Plus :size="16" /></button
        ><button
          class="icon-button"
          :title="connected ? 'Disconnect T3 Code' : 'Connect T3 Code'"
          @click="connected ? disconnect() : (showPairing = true)"
        >
          <Link2 :size="15" />
        </button>
      </div>
    </div>
    <div class="chat-connection">
      <span class="status-dot" :class="{ live: connected }" />{{
        example
          ? "Example conversation"
          : connected
            ? "Connected to T3 Code"
            : state === "connecting"
              ? "Connecting…"
              : "T3 Code disconnected"
      }}<span v-if="connected" class="subtle">Shared session</span>
    </div>
    <template v-if="example">
      <div class="chat-thread-title">
        <span class="status-dot live" /><strong
          >Build the agent workspace</strong
        ><span class="badge">Example</span>
      </div>
      <div class="conversation-body">
        <div class="message user">
          <span class="message-role">YOU <small>10:42</small></span>
          <p>
            Keep the conversation visible while I review the changes. Switching
            chats should take me to the right worktree.
          </p>
        </div>
        <div class="message">
          <span class="message-role"><Bot :size="15" /> ASSISTANT</span>
          <p>
            I’ve connected the conversation panel to the selected worktree. Your
            file selection and scroll position stay in place as changes arrive.
          </p>
          <div class="activity">
            <span class="activity-line" /><span
              >Updated <code>ChatPanel.vue</code></span
            ><span class="green">+12 −4</span>
          </div>
          <p>
            You can review the diff on the left and select lines to add to your
            next instruction.
          </p>
        </div>
        <div class="example-note">
          Example content for interface preview.<br />No agent is running.
        </div>
      </div>
    </template>
    <template v-else-if="connected">
      <select
        class="thread-picker"
        aria-label="Conversation"
        :value="selectedId"
        @change="select(($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>Select a conversation</option>
        <option v-for="t in threads" :key="t.id" :value="t.id">
          {{ t.title }} · {{ t.status }}
        </option>
      </select>
      <div v-if="matchingThreads.length > 1" class="shared-note">
        {{ matchingThreads.length }} chats share this worktree and its changes.
      </div>
      <div class="conversation-body">
        <div v-if="!thread" class="panel-empty">
          <MessageSquare :size="26" />
          <p>Select a conversation to review its work.</p>
        </div>
        <div
          v-for="message in messages"
          :key="message.id"
          class="message"
          :class="{ user: message.role === 'user' }"
        >
          <span class="message-role"
            >{{ message.role
            }}<span v-if="message.streaming" class="status-dot live"
          /></span>
          <p class="message-text">{{ message.text }}</p>
        </div>
        <div v-for="request in requests" :key="request.id" class="approval">
          <strong><ShieldCheck :size="15" />{{ request.kind }}</strong>
          <pre>{{
            approvalContext(request.id) ||
            "Request details are unavailable. Review this request in T3 Code."
          }}</pre>
          <div
            v-if="
              approvalContext(request.id) &&
              [
                'command',
                'file-read',
                'file-change',
                'permission',
                'mcp-elicitation',
              ].includes(request.kind) &&
              request.responseCapability.type !== 'not_resumable'
            "
            class="button-row"
          >
            <button class="small" @click="respond(request.id, 'decline')">
              Decline</button
            ><button
              class="primary small"
              @click="respond(request.id, 'accept')"
            >
              Approve once
            </button>
          </div>
          <p v-else>Respond to this request in T3 Code.</p>
        </div>
      </div>
    </template>
    <div v-else class="panel-empty chat-empty">
      <div class="empty-orbit"><Bot :size="26" /></div>
      <h3>Your agents, beside your code.</h3>
      <p>
        Connect T3 Code to follow conversations, give instructions, and review
        changes in one place.
      </p>
      <button class="secondary" @click="showPairing = true">
        <Link2 :size="14" />Connect T3 Code</button
      ><small>Your Git workspace works independently.</small>
    </div>
    <div v-if="error" class="inline-error">
      {{ error
      }}<button
        v-if="!connected && desktop()"
        class="small"
        @click="client.connect()"
      >
        Retry connection
      </button>
    </div>
    <div class="composer">
      <div v-if="context" class="context-chip">
        <span>Selected diff attached</span
        ><button
          class="icon-button"
          aria-label="Remove attached context"
          @click="emit('clearContext')"
        >
          <X :size="12" />
        </button>
      </div>
      <textarea
        v-model="prompt"
        :disabled="!connected || !thread || example"
        placeholder="Give an instruction…"
        aria-label="Agent instruction"
        @keydown.ctrl.enter.prevent="send"
      />
      <div class="composer-footer">
        <span
          >{{ thread?.modelSelection.model || "T3 Code"
          }}<span v-if="thread?.activeRunId">
            · Queues after current task</span
          ></span
        ><button
          v-if="thread?.activeRunId"
          class="icon-button stop"
          title="Stop current task"
          @click="stop"
        >
          <Square :size="13" /></button
        ><button
          class="send-button"
          aria-label="Send instruction"
          :disabled="
            !connected || !thread || !prompt.trim() || sending || example
          "
          @click="send"
        >
          <ArrowUp :size="17" />
        </button>
      </div>
    </div>
    <Teleport to="body"
      ><div
        v-if="showPairing"
        class="modal-backdrop"
        @click.self="showPairing = false"
      >
        <section
          class="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pair-title"
        >
          <div class="modal-heading">
            <h2 id="pair-title">Connect T3 Code</h2>
            <button
              class="icon-button"
              aria-label="Close"
              @click="showPairing = false"
            >
              <X :size="18" />
            </button>
          </div>
          <p>
            Create a pairing link in T3 Code’s connection settings, then paste
            it here. The session stays in memory until you close GitGoblin.
          </p>
          <label
            >Local server<input
              v-model="origin"
              placeholder="http://127.0.0.1:3773" /></label
          ><label
            >Pairing link or code<input
              v-model="pairing"
              type="password"
              autocomplete="off"
              placeholder="Paste pairing link"
              @keydown.enter="pair"
          /></label>
          <div v-if="error" class="inline-error">{{ error }}</div>
          <div class="modal-footer">
            <button @click="showPairing = false">Cancel</button
            ><button class="primary" :disabled="!pairing.trim()" @click="pair">
              Pair with T3 Code
            </button>
          </div>
        </section>
      </div>
      <div v-if="showNew" class="modal-backdrop" @click.self="showNew = false">
        <section
          class="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-chat-title"
        >
          <div class="modal-heading">
            <h2 id="new-chat-title">New conversation</h2>
            <button
              class="icon-button"
              aria-label="Close"
              @click="showNew = false"
            >
              <X :size="18" />
            </button>
          </div>
          <label
            >Project<select v-model="newProject">
              <option v-for="p in projects" :key="p.id" :value="p.id">
                {{ p.title || p.workspaceRoot }}
              </option>
            </select></label
          ><label>Title<input v-model="newTitle" /></label
          ><label
            >Model<select v-model="newModel">
              <option
                v-for="option in modelOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select></label
          >
          <p v-if="!modelOptions.length">Configure a model in T3 Code first.</p>
          <p>Uses the project’s root worktree with approvals required.</p>
          <div class="modal-footer">
            <button @click="showNew = false">Cancel</button
            ><button
              class="primary"
              :disabled="!newProject || !newTitle || !newModel"
              @click="create"
            >
              Create conversation
            </button>
          </div>
        </section>
      </div></Teleport
    >
  </aside>
</template>
