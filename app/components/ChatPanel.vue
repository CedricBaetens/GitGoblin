<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick, useId } from "vue";
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
  FolderGit2,
} from "lucide-vue-next";
import { conversationTurns } from '~/lib/conversation-turns';
import { imageMimeTypes, uploadChatImage, validateChatImages } from '~/lib/chat-images';
import { insertSkill, searchSkills, skillTrigger } from '~/lib/chat-skills';
import { pendingQuestions } from '~/lib/chat-questions';
import { conversationDefaults, conversationPresets, conversationPrompt, conversationTitle, matchingTicket, ticketReference, newConversationWorktree } from '~/lib/conversation-presets';
import type { ConversationTicket } from '~/lib/conversation-presets';
import { isThreadRunning, repositoryThreads } from "~/lib/threads";
import { chatActivity } from "~/lib/chat-tabs";
import { T3Client, parsePairing } from "~/lib/t3";
import { invoke, desktop, git } from "~/lib/native";
import type { T3Thread, T3Project, T3Projection, T3ImageAttachment, T3Skill } from "~/lib/types";
const props = defineProps<{
  context: string;
  example: boolean;
  repo: string;
  visible: boolean;
  selectedThreadId: string;
  openThreadIds: string[];
}>();
const emit = defineEmits<{
  clearContext: [];
  selectWorktree: [path: string, threadId: string];
  threads: [threads: T3Thread[], projects: T3Project[], connected: boolean];
  selection: [threadId: string];
  attention: [needed: boolean];
  activity: [states: Record<string, { attention: boolean; response: string }>];
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
const settlingId = ref("");
const newConversationDialog = ref<HTMLElement>();
const newConversationButton = ref<HTMLButtonElement>();
const newPreset = ref<(typeof conversationPresets)[number]>(conversationPresets[0]);
const newTicket = ref("");
const selectedTicket = ref<ConversationTicket>();
function selectTicket(ticket: ConversationTicket) {
  newTicket.value = ticket.url;
  selectedTicket.value = ticket;
}
const needsTicket = computed(() => 'ticket' in newPreset.value);
const useNewWorktree = ref(true);
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
type DraftImage = { id: string; file: File; preview: string; uploaded?: T3ImageAttachment };
const imageDrafts = ref<Record<string, DraftImage[]>>({});
const images = computed(() => imageDrafts.value[selectedId.value] || []);
function pasteImages(event: ClipboardEvent) {
  if (!connected.value || !thread.value || props.example || sending.value) return;
  const files = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'));
  if (!files.length) return;
  event.preventDefault();
  try {
    validateChatImages([...images.value.map(image => image.file), ...files]);
    imageDrafts.value[selectedId.value] = [...images.value, ...files.map(file => ({ id: crypto.randomUUID(), file, preview: URL.createObjectURL(file) }))];
    const text = event.clipboardData?.getData('text/plain');
    if (text) {
      const input = composer.value;
      const start = input?.selectionStart ?? prompt.value.length;
      const end = input?.selectionEnd ?? start;
      prompt.value = prompt.value.slice(0, start) + text + prompt.value.slice(end);
      void nextTick(() => input?.setSelectionRange(start + text.length, start + text.length));
    }
    error.value = '';
  } catch (e) { error.value = String(e); }
}
function removeImage(id: string, threadId = selectedId.value) {
  const draft = imageDrafts.value[threadId] || [];
  const removed = draft.find(image => image.id === id);
  if (removed) URL.revokeObjectURL(removed.preview);
  imageDrafts.value[threadId] = draft.filter(image => image.id !== id);
}
async function loadImage(attachment: T3ImageAttachment) {
  if (!imageMimeTypes.includes(attachment.mimeType)) throw new Error('Unsupported image.');
  const { relativeUrl } = await client.call('assets.createUrl', { resource: { _tag: 'attachment', attachmentId: attachment.id } });
  const bytes = await invoke<number[]>('t3_image_load', { relativeUrl });
  return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: attachment.mimeType }));
}
const composer = ref<HTMLTextAreaElement>();
const skillMenuId = useId();
const skillCursor = ref(0), skillIndex = ref(0), skills = ref<T3Skill[]>([]);
const skillsLoading = ref(false), skillsError = ref(''), skillsDismissed = ref(false);
const skillMenu = ref<HTMLElement>();
const trigger = computed(() => skillTrigger(prompt.value, skillCursor.value));
const skillMenuOpen = computed(() => connected.value && !!thread.value && !props.example && !!trigger.value && !skillsDismissed.value);
const skillMatches = computed(() => searchSkills(skills.value, trigger.value?.query || ''));
const skillScope = computed(() => thread.value ? { instanceId: thread.value.modelSelection.instanceId,
  cwd: thread.value.worktreePath || projects.value.find(project => project.id === thread.value?.projectId)?.workspaceRoot || props.repo } : null);
const skillCache = new Map<string, T3Skill[]>();
let skillRequest = 0;
async function loadSkills(reload = false) {
  const scope = skillScope.value;
  const request = ++skillRequest;
  skills.value = []; skillsError.value = ''; skillsLoading.value = false;
  if (!scope || !skillMenuOpen.value) return;
  const key = JSON.stringify(scope);
  if (!reload && skillCache.has(key)) { skills.value = skillCache.get(key)!; return; }
  skillsLoading.value = true;
  try {
    const result = await client.listSkills(scope.instanceId, scope.cwd);
    if (request !== skillRequest) return;
    skillCache.set(key, result); skills.value = result;
  } catch (e) { if (request === skillRequest) skillsError.value = String(e); }
  finally { if (request === skillRequest) skillsLoading.value = false; }
}
watch([prompt, skillCursor], () => { skillIndex.value = 0; });
function updateSkillCursor() {
  skillCursor.value = composer.value?.selectionStart || 0;
  skillsDismissed.value = false;
}
async function chooseSkill(skill: T3Skill) {
  if (!trigger.value) return;
  const result = insertSkill(prompt.value, trigger.value, skill.name);
  prompt.value = result.text; skillCursor.value = result.cursor; skillsDismissed.value = true;
  await nextTick(); composer.value?.focus(); composer.value?.setSelectionRange(result.cursor, result.cursor);
}
function composerKeydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (skillMenuOpen.value) {
    if (event.key === 'Escape') { event.preventDefault(); skillsDismissed.value = true; return; }
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && skillMatches.value.length) {
      event.preventDefault();
      skillIndex.value = (skillIndex.value + (event.key === 'ArrowDown' ? 1 : -1) + skillMatches.value.length) % skillMatches.value.length;
      void nextTick(() => skillMenu.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }));
      return;
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey && skillMatches.value[skillIndex.value]) {
      event.preventDefault(); void chooseSkill(skillMatches.value[skillIndex.value]!); return;
    }
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault(); void send();
  }
}
const conversationBody = ref<HTMLElement>();
let followMessages = true;
let conversationScroll: number | undefined;
async function scrollToLatest() {
  await nextTick();
  if (props.visible && followMessages && conversationBody.value)
    conversationBody.value.scrollTop = conversationBody.value.scrollHeight;
}
function trackConversationScroll() {
  const el = conversationBody.value;
  if (props.visible && el) {
    conversationScroll = el.scrollTop;
    followMessages = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }
}
watch(() => props.visible, async (visible) => {
  if (!visible) {
    if (conversationBody.value) conversationScroll = conversationBody.value.scrollTop;
    return;
  }
  await nextTick();
  if (conversationBody.value && conversationScroll !== undefined)
    conversationBody.value.scrollTop = conversationScroll;
  else void scrollToLatest();
});
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
    projection.value?.runtimeRequests.filter((r) => r.status === "pending" && r.kind !== 'user_input') ||
    [],
);
const questions = computed(() => pendingQuestions(projection.value));
watch([requests, questions], () => emit('attention', !!(requests.value.length || questions.value.length)), { immediate: true });
watch(questions, () => void scrollToLatest(), { flush: 'post' });
const connected = computed(() => state.value === "connected");
watch([skillMenuOpen, () => JSON.stringify(skillScope.value)], () => void loadSkills());
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
  if (connected.value) client.watchThreads(threads.value.filter(thread => !thread.deletedAt && (!thread.archivedAt || props.openThreadIds.includes(thread.id))).map(thread => thread.id));
  emit('activity', Object.fromEntries([...client.projections].map(([id, projection]) => [id, chatActivity(projection)])));
};
function select(id: string) {
  followMessages = true;
  conversationScroll = undefined;
  if (selectedId.value) drafts.set(selectedId.value, prompt.value);
  prompt.value = drafts.get(id) || "";
  selectedId.value = id;
  client.selectThread(id);
  void scrollToLatest();
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
  if (!thread.value || (!prompt.value.trim() && !images.value.length) || sending.value || settlingId.value) return;
  sending.value = true;
  error.value = "";
  const submittedThread = thread.value;
  const submittedText = prompt.value;
  const submittedImages = [...images.value];
  try {
    for (const image of submittedImages) {
      image.uploaded ||= await uploadChatImage(image.file, (tag, payload) => client.call(tag, payload),
        (relativeUrl, mimeType, bytes) => invoke<void>('t3_image_upload', { relativeUrl, mimeType, bytes }));
    }
    await client.sendMessage(
      submittedThread,
      submittedText +
        (props.context
          ? `\n\nSelected Git context:\n\n${props.context}`
          : ""),
      submittedImages.map(image => image.uploaded!),
    );
    for (const image of submittedImages) removeImage(image.id, submittedThread.id);
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
async function settle(id: string) {
  if (!connected.value || props.example) throw new Error('Connect T3 Code to settle this conversation.');
  if (sending.value || settlingId.value) throw new Error('Wait for the current conversation action to finish, then try again.');
  settlingId.value = id;
  error.value = "";
  try {
    await client.settle(id);
  } finally {
    settlingId.value = "";
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
async function openCreatedConversation(id: string, text: string) {
  select(id);
  prompt.value = text;
  drafts.set(id, text);
  await nextTick();
  composer.value?.focus();
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
    let ticket = matchingTicket(newTicket.value, selectedTicket.value ? [selectedTicket.value] : []);
    const reference = ticketReference(newTicket.value);
    if ('ticket' in preset && !ticket && reference && desktop()) {
      try {
        const result = await invoke<{ tickets: ConversationTicket[] }>('devops_tickets', { repo: worktreePath, query: String(reference.id) });
        ticket = matchingTicket(newTicket.value, result.tickets);
      } catch { /* Keep ticket conversations usable when Azure DevOps lookup is unavailable. */ }
    }
    const title = conversationTitle(preset, newTicket.value, ticket);
    const result = await client.createThread(
      projectId,
      title,
      modelSelection,
      worktreePath,
    );
    showNew.value = false;
    await openCreatedConversation(result.threadId, instruction);
    if (instruction.trim()) {
      sending.value = true;
      try {
        await client.sendMessage({ id: result.threadId, projectId, title, modelSelection,
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
  selectedTicket.value = undefined;
  useNewWorktree.value = true;
  newChatError.value = "";
  showNew.value = true;
  void nextTick(() => newConversationDialog.value?.querySelector<HTMLButtonElement>('.conversation-preset')?.focus());
}
function changeNewProject(id: string) {
  if (newProject.value === id) return;
  newProject.value = id;
  newTicket.value = "";
  selectedTicket.value = undefined;
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
let followedWorktree = '';
watch([selectedId, connected, () => thread.value?.worktreePath, projects], () => {
  const path = thread.value?.worktreePath || projects.value.find(project => project.id === thread.value?.projectId)?.workspaceRoot;
  const key = path && selectedId.value ? `${selectedId.value}:${path}` : '';
  if (connected.value && key && key !== followedWorktree) {
    followedWorktree = key;
    emit('selectWorktree', path!, selectedId.value);
  }
  if (!selectedId.value) followedWorktree = '';
});
watch(() => props.selectedThreadId, id => {
  if (id !== selectedId.value) select(id);
}, { immediate: true });
onUnmounted(() => {
  for (const draft of Object.values(imageDrafts.value)) for (const image of draft) URL.revokeObjectURL(image.preview);
  client.disconnect();
});
defineExpose({
  settle,
  newConversation: newChat,
  focusComposer: () => composer.value?.focus(),
  stopAll: async () => {
    for (const t of matchingThreads.value.filter((t) => t.activeRunId))
      await client.stop(t);
  },
});
</script>
<template>
  <section id="conversation-panel" class="chat-panel" aria-label="Chat">
    <div v-if="!example && state === 'connecting'" class="chat-connection" role="status">Connecting to T3 Code…</div>
    <template v-if="example">
      <div ref="conversationBody" class="conversation-body" @scroll="trackConversationScroll">
        <div class="message user">
          <span class="message-role">YOU <small>10:42</small></span>
          <p>
            Keep my place when I switch between Git and Chat. Switching chats
            should take me to the right worktree.
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
            Review the diff and select lines to add to your
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
          <p>Open a chat from All chats, or start a new conversation.</p>
        </div>
        <template v-for="turn in turns" :key="turn.id">
          <div v-for="message in turn.users" :key="message.id" class="message user">
            <template v-for="attachment in message.attachments || []" :key="attachment.id">
              <ChatImage v-if="attachment.type === 'image'" :attachment="attachment" :load="loadImage" />
            </template>
            <ChatMarkdown :text="message.text" />
          </div>
          <details v-if="turn.work.length || turn.activities.length" class="work-details">
            <summary>{{ turn.summary === 'Working…' ? 'Activity' : turn.summary }}<ChevronRight :size="13" /></summary>
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
        <ChatQuestions v-for="question in questions" :key="`${selectedId}:${question.id}`" :request="question"
          :disabled="!connected" :respond="answers => client.answerQuestions(selectedId, question.id, answers)" />
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
      <div v-if="images.length" class="pasted-images" aria-label="Attached images">
        <figure v-for="image in images" :key="image.id">
          <img :src="image.preview" :alt="image.file.name || 'Pasted image'" />
          <button type="button" class="icon-button" :aria-label="`Remove ${image.file.name || 'pasted image'}`" :disabled="sending" @click="removeImage(image.id)"><X :size="13" /></button>
        </figure>
      </div>
      <div v-if="connected && thread && !example && (busy || sending || requests.length || questions.length || thread.status === 'error')" class="agent-status" role="status" aria-live="polite">
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
      <div v-if="skillMenuOpen" :id="skillMenuId" ref="skillMenu" class="skill-menu" role="listbox" aria-label="Skills">
        <div class="skill-menu-heading"><span>Skills</span><button type="button" :disabled="skillsLoading" aria-label="Refresh skills" @mousedown.prevent @click="loadSkills(true)">Refresh</button></div>
        <p v-if="skillsLoading" role="status">Loading skills…</p>
        <p v-else-if="skillsError" role="status">{{ skillsError }}</p>
        <p v-else-if="!skillMatches.length" role="status">No matching skills.</p>
        <button v-for="(skill, index) in skillMatches" :id="`${skillMenuId}-${index}`" :key="skill.name" :title="skill.name" type="button" role="option" tabindex="-1"
          :aria-selected="index === skillIndex" @mousedown.prevent @click="chooseSkill(skill)">
          <span class="skill-menu-label"><strong>/{{ skill.displayName || skill.name.split(':').at(-1) }}</strong><span v-if="skill.name.includes(':') && skill.name.split(':')[0] !== skill.name.split(':').at(-1)" class="skill-source">{{ skill.name.split(':').slice(0, -1).join(':') }}</span></span>
          <small>{{ skill.shortDescription || skill.description || 'Run skill' }}</small>
        </button>
      </div>
      <textarea
        ref="composer"
        v-model="prompt"
        :disabled="!connected || !thread || example"
        placeholder="Give an instruction…"
        title="Enter to send; Shift+Enter for a new line"
        aria-label="Agent instruction"
        role="combobox" aria-autocomplete="list" :aria-expanded="skillMenuOpen" :aria-controls="skillMenuOpen ? skillMenuId : undefined"
        :aria-activedescendant="skillMenuOpen && skillMatches.length ? `${skillMenuId}-${skillIndex}` : undefined"
        @input="updateSkillCursor" @click="updateSkillCursor" @focus="updateSkillCursor"
        @blur="skillsDismissed = true"
        @keyup="!['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes($event.key) && updateSkillCursor()"
        @keydown="composerKeydown"
        @paste="pasteImages"
      />
      <div class="composer-footer">
        <span
          :title="thread?.modelSelection.model">{{ thread?.modelSelection.model }}</span
        ><button
          v-if="connected && thread && !example"
          type="button"
          :disabled="sending || !!settlingId"
          title="Mark this conversation as settled and remove it from the active list"
          @click="settle(thread.id).catch(e => error = String(e))"
        >
          <LoaderCircle v-if="settlingId === thread.id" :size="13" class="spin" />
          <Check v-else :size="13" /> Settle conversation
        </button><button
          v-if="thread?.activeRunId"
          class="icon-button stop"
          title="Stop current task"
          @click="stop"
        >
          <Square :size="13" /></button
        ><button
          class="send-button"
          aria-label="Send instruction"
          :title="thread?.activeRunId ? 'Queue instruction after the current task (Enter)' : 'Send instruction (Enter) · Shift+Enter for a new line'"
          :disabled="
            !connected || !thread || (!prompt.trim() && !images.length) || sending || !!settlingId || example
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
          <p id="new-conversation-description">Choose a project and a starting action for your conversation.</p>
          <div class="conversation-setup">
          <section class="conversation-section" aria-labelledby="conversation-project-heading">
            <h3 id="conversation-project-heading">Project <span>Where you’ll work</span></h3>
            <div class="conversation-projects" role="group" aria-label="Project">
              <button v-for="project in projects" :key="project.id" type="button" class="conversation-preset project-choice"
                :aria-pressed="newProject === project.id" :disabled="creating"
                @click="changeNewProject(project.id)">
                <FolderGit2 :size="19" />
                <span><strong>{{ project.title || project.name || project.workspaceRoot.replaceAll('\\', '/').split('/').filter(Boolean).pop() || project.workspaceRoot }}</strong><small>{{ project.workspaceRoot }}</small></span>
                <Check v-if="newProject === project.id" :size="15" class="preset-check" />
              </button>
            </div>
            <p v-if="!projects.length" class="conversation-hint">Add a project in T3 Code to get started.</p>
          </section>
          <section class="conversation-section" aria-labelledby="conversation-action-heading">
            <h3 id="conversation-action-heading">Starting action <span>What you’ll do</span></h3>
          <div class="conversation-actions" role="group" aria-label="Conversation action">
            <button v-for="(preset, index) in conversationPresets" :key="preset.label" type="button" class="conversation-preset"
              :aria-label="preset.label" :aria-pressed="newPreset.label === preset.label" :disabled="creating" @click="newPreset = preset">
              <component :is="presetIcons[index]" :size="19" />
              <span><strong>{{ preset.label }}</strong><small>{{ preset.description }}</small></span>
              <Check v-if="newPreset.label === preset.label" :size="15" class="preset-check" />
            </button>
          </div>
          </section>
          <template v-if="needsTicket">
            <DevopsTickets :repo="newWorktree" :selected="newTicket" :disabled="creating" @select="selectTicket" />
            <label>Ticket URL, number, or description<textarea v-model="newTicket" :disabled="creating" rows="2" required placeholder="Select a ticket above, or enter a URL, #123, or description" /></label>
          </template>
          <section class="conversation-section" aria-labelledby="conversation-workspace-heading">
            <h3 id="conversation-workspace-heading">Workspace</h3>
            <label class="worktree-toggle" :class="{ enabled: useNewWorktree }">
              <GitBranch :size="19" />
              <span class="worktree-toggle-copy"><strong>Use new worktree</strong><small id="new-worktree-description">{{ useNewWorktree ? 'Create a separate branch and worktree for this conversation.' : 'Work directly in the existing path below. Changes are shared.' }}</small></span>
              <input v-model="useNewWorktree" type="checkbox" role="switch" aria-label="Use new worktree" aria-describedby="new-worktree-description" :disabled="creating" />
              <span class="worktree-switch" aria-hidden="true" />
            </label>
            <label>{{ useNewWorktree ? 'Create from' : 'Existing worktree' }}<input v-model="newWorktree" :disabled="creating" placeholder="Worktree path" required /></label>
            <p class="conversation-hint">{{ useNewWorktree ? 'A new worktree will be created from HEAD at this path.' : 'This conversation will use this path without creating a worktree.' }}</p>
          </section>
          <label>Model<select v-model="newModel" :disabled="creating">
              <option v-for="option in modelOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select></label>
          <p v-if="!modelOptions.length">Configure a model in T3 Code first.</p>
          <p v-if="!connected">Reconnect T3 Code to create a conversation.</p>
          <div v-if="newChatError" class="inline-error" role="alert">{{ newChatError }}</div>
          </div>
          <div class="modal-footer">
            <button type="button" :disabled="creating" @click="dismissNewDialog">Cancel</button>
            <button type="submit" class="primary" :disabled="!canCreate"><LoaderCircle v-if="creating" :size="14" class="spin" />{{ creating ? 'Creating…' : 'Create conversation' }}</button>
          </div>
        </form>
      </div>
      </Teleport
    >
  </section>
</template>

<style scoped>
.composer { position: relative; }
.skill-menu { position: absolute; z-index: 20; bottom: calc(100% + 6px); left: 0; right: 0; max-height: 260px; overflow-y: auto; padding: 5px; background: #191b21; border: 1px solid #30333e; border-radius: 8px; box-shadow: 0 8px 24px #0005; scrollbar-width: thin; }
.skill-menu-heading { display: flex; align-items: center; justify-content: space-between; padding: 2px 7px 5px; margin-bottom: 3px; border-bottom: 1px solid #ffffff08; color: #858b99; font-size: 10px; }
.skill-menu-heading button { padding: 3px 5px; font-size: 10px; color: #858b99; }
.skill-menu > button { display: flex; flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 3px; width: 100%; text-align: left; padding: 8px 9px; border-radius: 5px; white-space: normal; }
.skill-menu > button[aria-selected="true"] { background: #ffffff08; box-shadow: inset 2px 0 #a7b6ff; }
.skill-menu > button:hover { background: #ffffff0c; }
.skill-menu-label { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.skill-menu strong { flex: 1; min-width: 0; font-size: 12px; font-weight: 500; font-family: inherit; color: #d9dce5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skill-source { max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; color: #747b8b; }
.skill-menu small, .skill-menu > p { font-size: 11px; color: #8f96a6; line-height: 1.4; }
.skill-menu small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.skill-menu > p { padding: 8px; margin: 0; }
.pasted-images { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.pasted-images figure { position: relative; margin: 0; }
.pasted-images img { display: block; width: 72px; height: 64px; object-fit: cover; border: 1px solid var(--line); border-radius: 6px; }
.pasted-images button { position: absolute; top: 2px; right: 2px; padding: 2px; background: #101114dd; }
.chat-panel { font-family: "Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
.conversation-body .message p { font-size: 13px; line-height: 1.7; color: #d4d7df; }
.composer textarea { font-size: 13px; line-height: 1.6; }

.new-conversation-dialog { width: 680px; display: flex; flex-direction: column; overflow: hidden; }
.new-conversation-dialog > .modal-heading, .new-conversation-dialog > p, .new-conversation-dialog > .modal-footer { flex-shrink: 0; }
.conversation-setup { min-height: 0; overflow-y: auto; padding: 3px 4px; margin: -3px -4px; scrollbar-width: thin; }
.new-conversation-dialog textarea { width: 100%; font-size: 12px; }
.conversation-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.conversation-section { margin-top: 20px; }
.conversation-section:first-child { margin-top: 0; }
.conversation-section h3 { display: flex; align-items: baseline; gap: 10px; margin: 0 0 10px; font-size: 12px; font-weight: 600; }
.conversation-section h3 > span { color: #8998b4; font-size: 11px; font-weight: 400; }
.conversation-projects { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; max-height: 190px; overflow-y: auto; }
.conversation-preset { min-width: 0; min-height: 70px; display: flex; align-items: flex-start; gap: 11px; padding: 12px; text-align: left; white-space: normal; border: 1px solid #35405a; background: #171c26; border-radius: 8px; }
.conversation-preset:hover:not(:disabled) { border-color: #64789f; background: #222b3c; }
.conversation-preset:focus-visible, .worktree-toggle:has(input:focus-visible) { outline: 2px solid #a7b6ff; outline-offset: 3px; }
.conversation-preset[aria-pressed="true"] { border-color: #8ca5e7; background: #27334b; }
.conversation-preset > svg { flex-shrink: 0; margin-top: 2px; color: #a8bbeb; }
.conversation-preset span { display: grid; gap: 5px; flex: 1; min-width: 0; overflow-wrap: anywhere; }
.conversation-preset strong { font-size: 13px; font-weight: 600; }
.conversation-preset small { color: #9eadc8; font-size: 11px; line-height: 1.5; }
.project-choice small { font-family: Consolas, monospace; font-size: 10px; }
.modal .worktree-toggle { position: relative; display: flex; flex-direction: row; align-items: center; gap: 12px; padding: 14px; margin: 0; border: 1px solid #35405a; border-radius: 8px; background: #171c26; cursor: pointer; }
.worktree-toggle.enabled { border-color: #647db3; background: #222d43; }
.worktree-toggle > svg { flex-shrink: 0; color: #a8bbeb; }
.worktree-toggle-copy { display: grid; gap: 5px; flex: 1; min-width: 0; }
.worktree-toggle-copy strong { color: #d9dce5; font-size: 13px; font-weight: 600; }
.worktree-toggle-copy small { font-size: 11px; line-height: 1.5; }
.modal .worktree-toggle input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.worktree-switch { width: 34px; height: 20px; padding: 3px; flex-shrink: 0; border-radius: 12px; background: #4a5367; }
.worktree-switch::after { content: ''; display: block; width: 14px; height: 14px; border-radius: 50%; background: #fff; }
.worktree-toggle input:checked + .worktree-switch { background: #a7b6ff; }
.worktree-toggle input:checked + .worktree-switch::after { transform: translateX(14px); background: #1b2340; }
.worktree-toggle:has(input:disabled) { opacity: .5; cursor: default; }
.conversation-hint { margin: 7px 0 0; font-size: 11px; line-height: 1.5; color: #8998b4; }
.conversation-section > label:has(+ .conversation-hint) { margin-bottom: 0; }
@media (max-width: 540px) { .conversation-actions, .conversation-projects { grid-template-columns: 1fr; } }
.agent-status { display: flex; align-items: center; gap: 7px; min-height: 26px; margin-bottom: 5px; color: #9baed4; font-size: 11px; }
.work-details { margin: 8px 0 12px; color: #8e9bb4; }
.work-details summary { display: flex; align-items: center; gap: 5px; width: fit-content; padding: 8px 0; cursor: pointer; font-size: 12px; list-style: none; }
.work-details summary::-webkit-details-marker { display: none; }
.work-details[open] summary svg { transform: rotate(90deg); }
.work-details summary:hover { color: #c1c9dc; }
.work-content { border-left: 1px solid var(--line); padding-left: 12px; margin: 4px 0 12px; }
.final-message { padding-top: 4px; }
.chat-activity { display: flex; align-items: center; gap: 7px; min-height: 25px; font-size: 11px; color: #8e9bb4; }
.chat-activity svg { flex-shrink: 0; }
.chat-activity span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.activity-done { color: #81bda2; }
.activity-error { color: #e48791; }
.streaming-label { display: inline-flex; align-items: center; gap: 5px; margin-left: 8px; color: #9baed4; }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style>
