<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from "vue";
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
  LoaderCircle,
  Check,
  CircleAlert,
  Wrench,
} from "lucide-vue-next";
import { conversationTurns } from '~/lib/conversation-turns';
import { isThreadRunning, repositoryThreadKey, repositoryThreads, repositoryThreadSelection } from "~/lib/threads";
import { T3Client, parsePairing } from "~/lib/t3";
import { invoke, desktop } from "~/lib/native";
import type { T3Thread, T3Project, T3Projection } from "~/lib/types";
const props = defineProps<{
  context: string;
  example: boolean;
  repo: string;
  visible: boolean;
}>();
const emit = defineEmits<{
  clearContext: [];
  selectWorktree: [path: string, threadId: string];
  threads: [threads: T3Thread[], projects: T3Project[], connected: boolean];
  selection: [threadId: string];
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
const composer = ref<HTMLTextAreaElement>();
const conversationBody = ref<HTMLElement>();
let followMessages = true;
async function scrollToLatest() {
  await nextTick();
  if (props.visible && followMessages && conversationBody.value)
    conversationBody.value.scrollTop = conversationBody.value.scrollHeight;
}
function trackConversationScroll() {
  const el = conversationBody.value;
  if (el) followMessages = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}
watch(() => props.visible, (visible) => { if (visible) { followMessages = true; void scrollToLatest(); } });
const rememberedThreads = ref<Record<string, string>>({});
const thread = computed(() =>
  threads.value.find((t) => t.id === selectedId.value),
);
watch(selectedId, (id) => emit('selection', id));
const messages = computed(() =>
  [...(projection.value?.messages || [])].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  ),
);
watch(messages, () => void scrollToLatest(), { flush: 'post', deep: true });
const requests = computed(
  () =>
    projection.value?.runtimeRequests.filter((r) => r.status === "pending") ||
    [],
);
const connected = computed(() => state.value === "connected");
const streaming = computed(() => messages.value.some(message => message.role === 'assistant' && message.streaming));
const busy = computed(() => !!thread.value?.activeRunId || ['starting', 'running', 'busy'].includes(thread.value?.status || '') || streaming.value);
const turns = computed(() => conversationTurns(projection.value, busy.value ? thread.value?.activeRunId || 'active' : null));
const activityStatus = computed(() => sending.value ? 'Sending instruction…' : requests.value.length ? 'Waiting for approval'
  : streaming.value ? 'Responding…' : busy.value ? 'Working…'
  : thread.value?.status === 'error' ? 'Task failed' : 'Ready');
watch(turns, () => void scrollToLatest(), { flush: 'post' });
const matchingThreads = computed(() =>
  repositoryThreads(threads.value, projects.value, props.repo),
);
const activeMatchingThreads = computed(() => matchingThreads.value.filter(isThreadRunning));
client.onChange = () => {
  state.value = client.status;
  error.value = client.error;
  threads.value = [...client.threads];
  projects.value = [...client.projects];
  projection.value = client.projection ? { ...client.projection } : undefined;
  emit("threads", threads.value, projects.value, connected.value);
};
function select(id: string, followWorktree = true) {
  const t = threads.value.find((thread) => thread.id === id);
  const path = t?.worktreePath || projects.value.find((project) => project.id === t?.projectId)?.workspaceRoot;
  if (id && path && repositoryThreadKey(path) === repositoryThreadKey(props.repo)) {
    rememberedThreads.value[repositoryThreadKey(path)] = id;
    try { localStorage.setItem('gitgoblin.selectedConversations', JSON.stringify(rememberedThreads.value)); } catch { /* Keep the selection in memory if storage is unavailable. */ }
  }
  followMessages = true;
  if (selectedId.value) drafts.set(selectedId.value, prompt.value);
  prompt.value = drafts.get(id) || "";
  selectedId.value = id;
  client.selectThread(id);
  void scrollToLatest();
  if (followWorktree && path) emit("selectWorktree", path, id);
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
  try {
    await invoke("t3_disconnect");
    client.disconnect();
    projection.value = undefined;
    threads.value = [];
    projects.value = [];
    emit("threads", [], [], false);
  } catch (e) {
    error.value = String(e);
  }
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
          ? `\n\nSelected Git context:\n\n${props.context}`
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
  try {
    const saved = JSON.parse(localStorage.getItem('gitgoblin.selectedConversations') || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved))
      rememberedThreads.value = Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch { /* Invalid preferences do not prevent connecting. */ }
  if (desktop()) {
    try {
      const saved = await invoke<string | null>("t3_restore");
      if (saved) {
        origin.value = saved;
        await client.connect();
      } else {
        const found = await invoke<string | null>("t3_discover");
        if (found) origin.value = found;
      }
    } catch (e) {
      error.value = String(e);
    }
  }
});
watch([() => props.repo, connected, matchingThreads], () => {
  if (props.example) return;
  const next = connected.value ? repositoryThreadSelection(matchingThreads.value, rememberedThreads.value[repositoryThreadKey(props.repo)]) : '';
  if (next !== selectedId.value) select(next, false);
}, { immediate: true });
onUnmounted(() => client.disconnect());
defineExpose({
  select,
  focusComposer: () => composer.value?.focus(),
  stopAll: async () => {
    for (const t of matchingThreads.value.filter((t) => t.activeRunId))
      await client.stop(t);
  },
});
</script>
<template>
  <aside class="chat-panel">
    <div class="panel-heading">
      <span class="active-conversation" :title="thread?.title || 'Conversations'"><MessageSquare :size="15" /><span>{{ thread?.title || 'Conversations' }}</span></span>
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
      <div ref="conversationBody" class="conversation-body" @scroll="trackConversationScroll">
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
      <div v-if="activeMatchingThreads.length > 1" class="shared-note">
        {{ activeMatchingThreads.length }} agents are working in this worktree.
      </div>
      <div ref="conversationBody" class="conversation-body" @scroll="trackConversationScroll">
        <div v-if="!thread" class="panel-empty">
          <MessageSquare :size="26" />
          <p>Select a conversation in the left sidebar to review its work.</p>
        </div>
        <template v-for="turn in turns" :key="turn.id">
          <div v-for="message in turn.users" :key="message.id" class="message user">
            <p class="message-text">{{ message.text }}</p>
          </div>
          <details v-if="turn.work.length || turn.activities.length" class="work-details">
            <summary>{{ turn.summary }}<ChevronRight :size="13" /></summary>
            <div class="work-content">
              <div v-for="message in turn.work" :key="message.id" class="message">
                <p class="message-text">{{ message.text }}<span v-if="message.streaming" class="streaming-cursor" aria-hidden="true" /></p>
              </div>
              <div v-for="activity in turn.activities" :key="activity.id" class="chat-activity" :title="activity.title">
                <CircleAlert v-if="activity.status === 'failed' || activity.status === 'error'" :size="13" class="activity-error" />
                <Check v-else-if="activity.status === 'completed'" :size="13" class="activity-done" />
                <LoaderCircle v-else-if="busy && ['running', 'pending', 'inProgress', 'in_progress'].includes(activity.status)" :size="13" class="spin" />
                <Wrench v-else :size="13" />
                <span>{{ activity.title }}</span>
              </div>
            </div>
          </details>
          <div v-if="turn.final" class="message final-message">
            <p class="message-text">{{ turn.final.text }}<span v-if="turn.final.streaming" class="streaming-cursor" aria-hidden="true" /></p>
          </div>
        </template>
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
      <div v-if="connected && thread && !example" class="agent-status" role="status" aria-live="polite">
        <LoaderCircle v-if="(busy || sending) && !requests.length" class="spin" :size="13" />
        <ShieldCheck v-else-if="requests.length" :size="13" />
        <CircleAlert v-else-if="thread.status === 'error'" :size="13" />
        <Check v-else :size="13" />
        <span>{{ activityStatus }}</span>
      </div>
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
        ref="composer"
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

<style scoped>
.agent-status { display: flex; align-items: center; gap: 7px; min-height: 26px; margin-bottom: 5px; color: #9baed4; font-size: 11px; }
.work-details { margin: 8px 0 12px; color: #8e9bb4; }
.work-details summary { display: flex; align-items: center; gap: 5px; width: fit-content; padding: 8px 0; cursor: pointer; font-size: 12px; list-style: none; }
.work-details summary::-webkit-details-marker { display: none; }
.work-details[open] summary svg { transform: rotate(90deg); }
.work-details summary:hover { color: #c1c9dc; }
.work-content { border-left: 1px solid var(--line); padding-left: 12px; margin: 4px 0 12px; }
.final-message { border-top: 1px solid var(--line); padding-top: 12px; }
.chat-activity { display: flex; align-items: center; gap: 7px; min-height: 25px; font-size: 11px; color: #8e9bb4; }
.chat-activity svg { flex-shrink: 0; }
.chat-activity span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.activity-done { color: #81bda2; }
.activity-error { color: #e48791; }
.streaming-label { display: inline-flex; align-items: center; gap: 5px; margin-left: 8px; color: #9baed4; }
.streaming-cursor { display: inline-block; width: 2px; height: 1em; margin-left: 3px; vertical-align: -2px; background: #a8b6ec; animation: cursor-pulse 1s ease-in-out infinite alternate; }
@keyframes cursor-pulse { to { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { .streaming-cursor, .spin { animation: none; } }
</style>
