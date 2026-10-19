<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from "vue";
import {
  Bot,
  ArrowUp,
  Square,
  X,
  Link2,
  MessageSquare,
  ShieldCheck,
  ChevronRight,
  LoaderCircle,
  Check,
  CircleAlert,
  Wrench,
  Search,
  Code2,
  Bug,
  GitBranch,
} from "lucide-vue-next";
import { conversationTurns } from '~/lib/conversation-turns';
import { conversationDefaults, conversationPresets, conversationPrompt, newConversationWorktree } from '~/lib/conversation-presets';
import { isThreadRunning, repositoryThreadKey, repositoryThreads, repositoryThreadSelection } from "~/lib/threads";
import { T3Client, parsePairing } from "~/lib/t3";
import { invoke, desktop, git } from "~/lib/native";
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
  newWorktree = ref(""),
  newModel = ref("");
const creating = ref(false);
const newConversationDialog = ref<HTMLElement>();
const newConversationButton = ref<HTMLButtonElement>();
const newPreset = ref<(typeof conversationPresets)[number]>(conversationPresets[0]);
const newTicket = ref("");
const needsTicket = computed(() => 'ticket' in newPreset.value);
const useNewWorktree = ref(false);
const newChatError = ref("");
const canCreate = computed(() => connected.value && !creating.value && !!newProject.value && !!newModel.value && !!newWorktree.value.trim() && (!needsTicket.value || !!newTicket.value.trim()));
const presetIcons = [MessageSquare, Search, Code2, Bug, ShieldCheck];
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
async function openCreatedConversation(id: string, text: string, path: string) {
  rememberedThreads.value[repositoryThreadKey(path)] = id;
  select(id, false);
  prompt.value = text;
  drafts.set(id, text);
  emit("selectWorktree", path, id);
  await nextTick();
  composer.value?.focus();
}
async function runInstruction(repo: string, instruction: string) {
  if (!connected.value) throw new Error("Connect T3 Code to run this action.");
  let target = repositoryThreads(thread.value ? [thread.value] : [], projects.value, repo)[0];
  const existing = !!target;
  if (!target) {
    const defaults = conversationDefaults(repo, projects.value, thread.value);
    const modelSelection = defaults.modelSelection || (modelOptions.value[0] ? JSON.parse(modelOptions.value[0].value) : undefined);
    if (!defaults.projectId || !modelSelection) throw new Error("Configure a T3 conversation for this worktree before running this action.");
    const { threadId } = await client.createThread(defaults.projectId, "New conversation", modelSelection, repo);
    await openCreatedConversation(threadId, instruction, repo);
    target = { id: threadId, projectId: defaults.projectId, title: "New conversation", modelSelection,
      worktreePath: repo, branch: null, status: "idle", activeRunId: null, runtimeMode: "full-access", interactionMode: "default" };
  }
  sending.value = true;
  try {
    await client.sendMessage(target, instruction);
    if (!existing) {
      drafts.delete(target.id);
      if (selectedId.value === target.id && prompt.value === instruction) prompt.value = "";
    }
  } finally {
    sending.value = false;
  }
}
async function create(preset: (typeof conversationPresets)[number]) {
  if (!canCreate.value) return;
  creating.value = true;
  newChatError.value = "";
  error.value = "";
  let createdWorktree = false;
  try {
    if (useNewWorktree.value) {
      const worktree = newConversationWorktree(newWorktree.value.trim(), crypto.randomUUID().slice(0, 8));
      await git({ repo: newWorktree.value.trim(), action: "worktree-add", path: worktree.path, text: worktree.branch, target: "HEAD" });
      // Keep the created worktree for retry if T3 conversation creation fails.
      newWorktree.value = worktree.path;
      useNewWorktree.value = false;
      createdWorktree = true;
    }
    const projectId = newProject.value;
    const modelSelection = JSON.parse(newModel.value);
    const worktreePath = newWorktree.value.trim();
    const instruction = conversationPrompt(preset, newTicket.value);
    const result = await client.createThread(
      projectId,
      "New conversation",
      modelSelection,
      worktreePath,
    );
    showNew.value = false;
    await openCreatedConversation(result.threadId, instruction, worktreePath);
    if (instruction.trim()) {
      sending.value = true;
      try {
        await client.sendMessage({ id: result.threadId, projectId, title: "New conversation", modelSelection,
          worktreePath, branch: null, status: "idle", activeRunId: null, runtimeMode: "full-access", interactionMode: "default" }, instruction);
        drafts.delete(result.threadId);
        if (selectedId.value === result.threadId && prompt.value === instruction) prompt.value = "";
      } finally {
        sending.value = false;
      }
    }
  } catch (e) {
    if (!showNew.value) error.value = `Conversation created, but the message could not be sent. ${String(e)}`;
    else newChatError.value = createdWorktree
      ? `Worktree created at ${newWorktree.value}. Conversation creation failed: ${String(e)} Retry to use this worktree.`
      : String(e);
  } finally {
    creating.value = false;
  }
}
function newChat(trigger?: HTMLButtonElement) {
  if (creating.value) return;
  newConversationButton.value = trigger;
  if (!connected.value) { showPairing.value = true; return; }
  const defaults = conversationDefaults(props.repo, projects.value, thread.value);
  newProject.value = defaults.projectId;
  newWorktree.value = defaults.worktreePath;
  newModel.value = defaults.modelSelection ? JSON.stringify(defaults.modelSelection) : modelOptions.value[0]?.value || "";
  newPreset.value = conversationPresets[0];
  newTicket.value = "";
  useNewWorktree.value = false;
  newChatError.value = "";
  showNew.value = true;
  void nextTick(() => newConversationDialog.value?.querySelector<HTMLButtonElement>('.conversation-preset')?.focus());
}
function changeNewProject() {
  newTicket.value = "";
  const project = projects.value.find(project => project.id === newProject.value);
  newWorktree.value = project?.workspaceRoot || "";
  if (project?.defaultModelSelection) newModel.value = JSON.stringify(project.defaultModelSelection);
}
function dismissNewDialog() {
  if (creating.value) return;
  showNew.value = false;
  newConversationButton.value?.focus();
}
function trapNewDialog(event: KeyboardEvent) {
  if (event.key !== 'Tab') return;
  const elements = [...(newConversationDialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') || [])];
  const first = elements[0], last = elements.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
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
onUnmounted(() => {
  client.disconnect();
});
defineExpose({
  select,
  newConversation: newChat,
  runInstruction,
  focusComposer: () => composer.value?.focus(),
  stopAll: async () => {
    for (const t of matchingThreads.value.filter((t) => t.activeRunId))
      await client.stop(t);
  },
});
</script>
<template>
  <aside id="conversation-panel" class="chat-panel">
    <slot />
    <div class="panel-heading">
      <span class="active-conversation" :title="thread?.title || 'Conversations'"><MessageSquare :size="15" /><span>{{ thread?.title || 'Conversations' }}</span></span>
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
            <ChatMarkdown :text="message.text" />
          </div>
          <details v-if="turn.work.length || turn.activities.length" class="work-details">
            <summary>{{ turn.summary }}<ChevronRight :size="13" /></summary>
            <div class="work-content">
              <div v-for="message in turn.work" :key="message.id" class="message">
                <ChatMarkdown :text="message.text" :streaming="message.streaming" />
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
            <ChatMarkdown :text="turn.final.text" :streaming="turn.final.streaming" />
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
      <div v-if="showNew" class="modal-backdrop" @click.self="dismissNewDialog" @keydown.esc.stop.prevent="dismissNewDialog">
        <form ref="newConversationDialog" class="modal new-conversation-dialog" role="dialog" aria-modal="true"
          aria-labelledby="new-conversation-title" aria-describedby="new-conversation-description"
          @submit.prevent="create(newPreset)" @keydown="trapNewDialog">
          <div class="modal-heading">
            <h2 id="new-conversation-title">New conversation</h2>
            <button type="button" class="icon-button" aria-label="Close new conversation" :disabled="creating" @click="dismissNewDialog"><X :size="18" /></button>
          </div>
          <p id="new-conversation-description">Choose an action to start when you create the conversation. Blank opens an empty chat.</p>
          <div class="conversation-actions" role="group" aria-label="Conversation action">
            <button v-for="(preset, index) in conversationPresets" :key="preset.label" type="button" class="conversation-preset"
              :aria-label="preset.label" :aria-pressed="newPreset.label === preset.label" :disabled="creating" @click="newPreset = preset">
              <component :is="presetIcons[index]" :size="19" />
              <span><strong>{{ preset.label }}</strong><small>{{ preset.description }}</small></span>
              <Check v-if="newPreset.label === preset.label" :size="15" class="preset-check" />
            </button>
          </div>
          <template v-if="needsTicket">
            <DevopsTickets :repo="newWorktree" :selected="newTicket" :disabled="creating" @select="newTicket = $event" />
            <label>Ticket URL, number, or description<textarea v-model="newTicket" :disabled="creating" rows="2" required placeholder="Select a ticket above, or enter a URL, #123, or description" /></label>
          </template>
          <div class="conversation-options">
            <label>Project<select v-model="newProject" :disabled="creating" @change="changeNewProject">
              <option disabled value="">Choose a project</option>
              <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.title || p.workspaceRoot }}</option>
            </select></label>
            <label>Model<select v-model="newModel" :disabled="creating">
              <option v-for="option in modelOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select></label>
          </div>
          <p v-if="!modelOptions.length">Configure a model in T3 Code first.</p>
          <p v-if="!connected">Reconnect T3 Code to create a conversation.</p>
          <label>Worktree<input v-model="newWorktree" :disabled="creating" placeholder="Worktree path" /></label>
          <label class="force-option new-worktree-option"><input v-model="useNewWorktree" type="checkbox" :disabled="creating" /><GitBranch :size="15" />Use new worktree</label>
          <div v-if="newChatError" class="inline-error" role="alert">{{ newChatError }}</div>
          <div class="modal-footer">
            <button type="button" :disabled="creating" @click="dismissNewDialog">Cancel</button>
            <button type="submit" class="primary" :disabled="!canCreate"><LoaderCircle v-if="creating" :size="14" class="spin" />{{ creating ? 'Creating…' : 'Create conversation' }}</button>
          </div>
        </form>
      </div>
      </Teleport
    >
  </aside>
</template>

<style scoped>
.new-conversation-dialog { width: 680px; }
.new-conversation-dialog textarea { width: 100%; font-size: 12px; }
.conversation-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.conversation-preset { min-height: 76px; display: flex; align-items: flex-start; gap: 11px; padding: 15px; text-align: left; border: 1px solid #35405a; background: #171c26; }
.conversation-preset[aria-pressed="true"] { border-color: #8ca5e7; background: #27334b; }
.conversation-preset > svg { flex-shrink: 0; margin-top: 2px; color: #a8bbeb; }
.conversation-preset span { display: grid; gap: 6px; flex: 1; }
.conversation-preset strong { font-size: 13px; font-weight: 600; }
.conversation-preset small { color: #9eadc8; font-size: 11px; line-height: 1.5; }
.conversation-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.conversation-options select, .conversation-options input { min-width: 0; }
.modal .new-worktree-option { gap: 8px; }
@media (max-width: 540px) { .conversation-actions, .conversation-options { grid-template-columns: 1fr; } }
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
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
