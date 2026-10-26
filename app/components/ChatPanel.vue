<script setup lang="ts">
import {
  computed,
  ref,
  onMounted,
  onUnmounted,
  watch,
  nextTick,
  useId,
} from "vue";
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
import { conversationTurns } from "~/lib/conversation-turns";
import {
  imageMimeTypes,
  uploadChatImage,
  validateChatImages,
} from "~/lib/chat-images";
import { insertSkill, searchSkills, skillTrigger } from "~/lib/chat-skills";
import { pendingQuestions } from "~/lib/chat-questions";
import {
  conversationDefaults,
  conversationPresets,
  conversationPrompt,
  conversationTitle,
  matchingTicket,
  ticketReference,
  newConversationWorktree,
} from "~/lib/conversation-presets";
import type { ConversationTicket } from "~/lib/conversation-presets";
import {
  isThreadRunning,
  repositoryThreads,
  repositoryThreadKey,
} from "~/lib/threads";
import { chatActivity } from "~/lib/chat-tabs";
import { chatWorktreeOptions } from "~/lib/chat-worktrees";
import {
  chatModelChoices,
  preferredChatModel,
  modelSettingDefaults,
  chatModelSelection,
  defaultConversationModel,
} from "~/lib/chat-models";
import { T3Client, parsePairing } from "~/lib/t3";
import { invoke, desktop, git } from "~/lib/native";
import type {
  T3Thread,
  T3Project,
  T3Projection,
  T3ImageAttachment,
  T3Skill,
  T3ModelProvider,
} from "~/lib/types";
const props = defineProps<{
  context: string;
  example: boolean;
  repo: string;
  visible: boolean;
  selectedThreadId: string;
  openThreadIds: string[];
  worktrees: { path: string; branch: string }[];
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
const projectPickerOpen = ref(false),
  projectSearch = ref("");
const projectPickerButton = ref<HTMLButtonElement>();
const selectedProject = computed(() =>
  projects.value.find((project) => project.id === newProject.value),
);
const matchingProjects = computed(() => {
  const query = projectSearch.value.trim().toLowerCase();
  return projects.value.filter((project) =>
    `${project.title || project.name || ""} ${project.workspaceRoot}`
      .toLowerCase()
      .includes(query),
  );
});
function projectLabel(project: T3Project) {
  return (
    project.title ||
    project.name ||
    project.workspaceRoot
      .replaceAll("\\", "/")
      .split("/")
      .filter(Boolean)
      .pop() ||
    project.workspaceRoot
  );
}
const settlingId = ref("");
const newConversationDialog = ref<HTMLElement>();
const newConversationButton = ref<HTMLButtonElement>();
const newPreset = ref<(typeof conversationPresets)[number]>(
  conversationPresets[0],
);
const newTicket = ref("");
const selectedTicket = ref<ConversationTicket>();
function selectTicket(ticket: ConversationTicket) {
  newTicket.value = ticket.url;
  selectedTicket.value = ticket;
}
const needsTicket = computed(() => "ticket" in newPreset.value);
const useNewWorktree = ref(true);
const newChatError = ref("");
const canCreate = computed(
  () =>
    connected.value &&
    !creating.value &&
    !modelsLoading.value &&
    !!newProject.value &&
    !!selectedModel.value &&
    !!newWorktree.value.trim() &&
    (!needsTicket.value || !!newTicket.value.trim()),
);
const presetIcons = [MessageSquare, Search, Code2, Bug, ShieldCheck];
const modelProviders = ref<T3ModelProvider[]>([]);
const modelsLoading = ref(false),
  modelCatalogError = ref("");
const modelSettings = ref<Record<string, string | boolean>>({});
const modelOptions = computed(() =>
  chatModelChoices(modelProviders.value, [
    ...projects.value.map((project) => project.defaultModelSelection),
    ...threads.value.map((thread) => thread.modelSelection),
  ]),
);
const modelSelectOptions = computed(() =>
  modelOptions.value.map((option) => ({
    value: option.value,
    label:
      option.label +
      (option.selection.model === defaultConversationModel ? " · Default" : ""),
  })),
);
const selectedModel = computed(() =>
  modelOptions.value.find((option) => option.value === newModel.value),
);
const hasPreferredModel = computed(() =>
  modelOptions.value.some(
    (option) => option.selection.model === defaultConversationModel,
  ),
);
watch(
  () => JSON.stringify([newModel.value, selectedModel.value?.settings]),
  () => {
    modelSettings.value = modelSettingDefaults(
      selectedModel.value?.settings || [],
    );
  },
);
let modelRequest = 0;
async function loadModels() {
  const request = ++modelRequest;
  modelsLoading.value = true;
  modelCatalogError.value = "";
  try {
    const providers = await client.listModels();
    if (request !== modelRequest) return;
    modelProviders.value = providers;
    newModel.value = preferredChatModel(
      modelOptions.value,
      projects.value.find((project) => project.id === newProject.value)
        ?.defaultModelSelection || undefined,
    );
  } catch (e) {
    if (request === modelRequest)
      modelCatalogError.value = `Could not load model options. ${String(e)}`;
  } finally {
    if (request === modelRequest) modelsLoading.value = false;
  }
}
const switchingWorktree = ref(false);
const currentWorktree = computed(
  () =>
    thread.value?.worktreePath ||
    projects.value.find((project) => project.id === thread.value?.projectId)
      ?.workspaceRoot ||
    "",
);
const chatWorktrees = computed(() =>
  repositoryThreadKey(props.repo) === repositoryThreadKey(currentWorktree.value)
    ? props.worktrees
    : [],
);
const worktreeOptions = computed(() =>
  chatWorktreeOptions(
    chatWorktrees.value,
    currentWorktree.value,
    thread.value?.branch,
  ),
);
const worktreeHint = computed(() =>
  switchingWorktree.value
    ? "Switching working folder…"
    : busy.value
      ? "The agent is working here. Stop the task to switch folders."
      : "The agent edits files here. Switching uses another checkout; it does not move your changes.",
);
async function switchWorktree(path: string) {
  const target = chatWorktrees.value.find(
    (tree) => repositoryThreadKey(tree.path) === repositoryThreadKey(path),
  );
  if (
    !thread.value ||
    !target ||
    busy.value ||
    sending.value ||
    switchingWorktree.value
  )
    return;
  switchingWorktree.value = true;
  error.value = "";
  try {
    await client.switchWorktree(
      thread.value,
      target.path,
      target.branch || null,
    );
  } catch (e) {
    error.value = String(e);
  } finally {
    switchingWorktree.value = false;
  }
}
const drafts = new Map<string, string>();
type DraftImage = {
  id: string;
  file: File;
  preview: string;
  uploaded?: T3ImageAttachment;
};
const imageDrafts = ref<Record<string, DraftImage[]>>({});
const images = computed(() => imageDrafts.value[selectedId.value] || []);
function pasteImages(event: ClipboardEvent) {
  if (!connected.value || !thread.value || props.example || sending.value)
    return;
  const files = Array.from(event.clipboardData?.files || []).filter((file) =>
    file.type.startsWith("image/"),
  );
  if (!files.length) return;
  event.preventDefault();
  try {
    validateChatImages([...images.value.map((image) => image.file), ...files]);
    imageDrafts.value[selectedId.value] = [
      ...images.value,
      ...files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        preview: URL.createObjectURL(file),
      })),
    ];
    const text = event.clipboardData?.getData("text/plain");
    if (text) {
      const input = composer.value;
      const start = input?.selectionStart ?? prompt.value.length;
      const end = input?.selectionEnd ?? start;
      prompt.value =
        prompt.value.slice(0, start) + text + prompt.value.slice(end);
      void nextTick(() =>
        input?.setSelectionRange(start + text.length, start + text.length),
      );
    }
    error.value = "";
  } catch (e) {
    error.value = String(e);
  }
}
function removeImage(id: string, threadId = selectedId.value) {
  const draft = imageDrafts.value[threadId] || [];
  const removed = draft.find((image) => image.id === id);
  if (removed) URL.revokeObjectURL(removed.preview);
  imageDrafts.value[threadId] = draft.filter((image) => image.id !== id);
}
async function loadImage(attachment: T3ImageAttachment) {
  if (!imageMimeTypes.includes(attachment.mimeType))
    throw new Error("Unsupported image.");
  const { relativeUrl } = await client.call("assets.createUrl", {
    resource: { _tag: "attachment", attachmentId: attachment.id },
  });
  const bytes = await invoke<number[]>("t3_image_load", { relativeUrl });
  return URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: attachment.mimeType }),
  );
}
const composer = ref<HTMLTextAreaElement>();
const skillMenuId = useId();
const skillCursor = ref(0),
  skillIndex = ref(0),
  skills = ref<T3Skill[]>([]);
const skillsLoading = ref(false),
  skillsError = ref(""),
  skillsDismissed = ref(false);
const skillMenu = ref<HTMLElement>();
const trigger = computed(() => skillTrigger(prompt.value, skillCursor.value));
const skillMenuOpen = computed(
  () =>
    connected.value &&
    !!thread.value &&
    !props.example &&
    !!trigger.value &&
    !skillsDismissed.value,
);
const skillMatches = computed(() =>
  searchSkills(skills.value, trigger.value?.query || ""),
);
const skillScope = computed(() =>
  thread.value
    ? {
        instanceId: thread.value.modelSelection.instanceId,
        cwd:
          thread.value.worktreePath ||
          projects.value.find(
            (project) => project.id === thread.value?.projectId,
          )?.workspaceRoot ||
          props.repo,
      }
    : null,
);
const skillCache = new Map<string, T3Skill[]>();
let skillRequest = 0;
async function loadSkills(reload = false) {
  const scope = skillScope.value;
  const request = ++skillRequest;
  skills.value = [];
  skillsError.value = "";
  skillsLoading.value = false;
  if (!scope || !skillMenuOpen.value) return;
  const key = JSON.stringify(scope);
  if (!reload && skillCache.has(key)) {
    skills.value = skillCache.get(key)!;
    return;
  }
  skillsLoading.value = true;
  try {
    const result = await client.listSkills(scope.instanceId, scope.cwd);
    if (request !== skillRequest) return;
    skillCache.set(key, result);
    skills.value = result;
  } catch (e) {
    if (request === skillRequest) skillsError.value = String(e);
  } finally {
    if (request === skillRequest) skillsLoading.value = false;
  }
}
watch([prompt, skillCursor], () => {
  skillIndex.value = 0;
});
function updateSkillCursor() {
  skillCursor.value = composer.value?.selectionStart || 0;
  skillsDismissed.value = false;
}
async function chooseSkill(skill: T3Skill) {
  if (!trigger.value) return;
  const result = insertSkill(prompt.value, trigger.value, skill.name);
  prompt.value = result.text;
  skillCursor.value = result.cursor;
  skillsDismissed.value = true;
  await nextTick();
  composer.value?.focus();
  composer.value?.setSelectionRange(result.cursor, result.cursor);
}
function composerKeydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (skillMenuOpen.value) {
    if (event.key === "Escape") {
      event.preventDefault();
      skillsDismissed.value = true;
      return;
    }
    if (
      ["ArrowDown", "ArrowUp"].includes(event.key) &&
      skillMatches.value.length
    ) {
      event.preventDefault();
      skillIndex.value =
        (skillIndex.value +
          (event.key === "ArrowDown" ? 1 : -1) +
          skillMatches.value.length) %
        skillMatches.value.length;
      void nextTick(() =>
        skillMenu.value
          ?.querySelector('[aria-selected="true"]')
          ?.scrollIntoView({ block: "nearest" }),
      );
      return;
    }
    if (
      (event.key === "Enter" || event.key === "Tab") &&
      !event.shiftKey &&
      skillMatches.value[skillIndex.value]
    ) {
      event.preventDefault();
      void chooseSkill(skillMatches.value[skillIndex.value]!);
      return;
    }
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void send();
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
watch(
  () => props.visible,
  async (visible) => {
    if (!visible) {
      if (conversationBody.value)
        conversationScroll = conversationBody.value.scrollTop;
      return;
    }
    await nextTick();
    if (conversationBody.value && conversationScroll !== undefined)
      conversationBody.value.scrollTop = conversationScroll;
    else void scrollToLatest();
  },
);
const thread = computed(() =>
  threads.value.find((t) => t.id === selectedId.value),
);
watch(selectedId, (id) => emit("selection", id));
const messages = computed(() =>
  [...(projection.value?.messages || [])].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  ),
);
watch(messages, () => void scrollToLatest(), { flush: "post", deep: true });
const requests = computed(
  () =>
    projection.value?.runtimeRequests.filter(
      (r) => r.status === "pending" && r.kind !== "user_input",
    ) || [],
);
const questions = computed(() => pendingQuestions(projection.value));
watch(
  [requests, questions],
  () => emit("attention", !!(requests.value.length || questions.value.length)),
  { immediate: true },
);
watch(questions, () => void scrollToLatest(), { flush: "post" });
const connected = computed(() => state.value === "connected");
watch(
  [skillMenuOpen, () => JSON.stringify(skillScope.value)],
  () => void loadSkills(),
);
const streaming = computed(() =>
  messages.value.some(
    (message) => message.role === "assistant" && message.streaming,
  ),
);
const busy = computed(
  () =>
    !!thread.value?.activeRunId ||
    ["starting", "running", "busy"].includes(thread.value?.status || "") ||
    streaming.value,
);
const turns = computed(() =>
  conversationTurns(
    projection.value,
    busy.value ? thread.value?.activeRunId || "active" : null,
  ),
);
const activityStatus = computed(() =>
  sending.value
    ? "Sending instruction…"
    : requests.value.length
      ? "Waiting for approval"
      : streaming.value
        ? "Responding…"
        : busy.value
          ? "Working…"
          : thread.value?.status === "error"
            ? "Task failed"
            : "Ready",
);
watch(turns, () => void scrollToLatest(), { flush: "post" });
const matchingThreads = computed(() =>
  repositoryThreads(threads.value, projects.value, props.repo),
);
const activeMatchingThreads = computed(() =>
  matchingThreads.value.filter(isThreadRunning),
);
client.onChange = () => {
  state.value = client.status;
  error.value = client.error;
  threads.value = [...client.threads];
  projects.value = [...client.projects];
  projection.value = client.projection ? { ...client.projection } : undefined;
  emit("threads", threads.value, projects.value, connected.value);
  if (connected.value)
    client.watchThreads(
      threads.value
        .filter(
          (thread) =>
            !thread.deletedAt &&
            (!thread.archivedAt || props.openThreadIds.includes(thread.id)),
        )
        .map((thread) => thread.id),
    );
  emit(
    "activity",
    Object.fromEntries(
      [...client.projections].map(([id, projection]) => [
        id,
        chatActivity(projection),
      ]),
    ),
  );
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
  if (switchingWorktree.value) return;
  if (
    !thread.value ||
    (!prompt.value.trim() && !images.value.length) ||
    sending.value ||
    settlingId.value
  )
    return;
  sending.value = true;
  error.value = "";
  const submittedThread = thread.value;
  const submittedText = prompt.value;
  const submittedImages = [...images.value];
  try {
    for (const image of submittedImages) {
      image.uploaded ||= await uploadChatImage(
        image.file,
        (tag, payload) => client.call(tag, payload),
        (relativeUrl, mimeType, bytes) =>
          invoke<void>("t3_image_upload", { relativeUrl, mimeType, bytes }),
      );
    }
    await client.sendMessage(
      submittedThread,
      submittedText +
        (props.context ? `\n\nSelected Git context:\n\n${props.context}` : ""),
      submittedImages.map((image) => image.uploaded!),
    );
    for (const image of submittedImages)
      removeImage(image.id, submittedThread.id);
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
  if (!connected.value || props.example)
    throw new Error("Connect T3 Code to settle this conversation.");
  if (sending.value || settlingId.value)
    throw new Error(
      "Wait for the current conversation action to finish, then try again.",
    );
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
      const worktree = newConversationWorktree(
        newWorktree.value.trim(),
        crypto.randomUUID().slice(0, 8),
      );
      await git({
        repo: newWorktree.value.trim(),
        action: "worktree-add",
        path: worktree.path,
        text: worktree.branch,
        target: "HEAD",
      });
      // Keep the created worktree for retry if T3 conversation creation fails.
      newWorktree.value = worktree.path;
      useNewWorktree.value = false;
      createdWorktree = true;
    }
    const projectId = newProject.value;
    const modelSelection = chatModelSelection(
      selectedModel.value!,
      modelSettings.value,
    );
    const worktreePath = newWorktree.value.trim();
    const instruction = conversationPrompt(preset, newTicket.value);
    let ticket = matchingTicket(
      newTicket.value,
      selectedTicket.value ? [selectedTicket.value] : [],
    );
    const reference = ticketReference(newTicket.value);
    if ("ticket" in preset && !ticket && reference && desktop()) {
      try {
        const result = await invoke<{ tickets: ConversationTicket[] }>(
          "devops_tickets",
          { repo: worktreePath, query: String(reference.id) },
        );
        ticket = matchingTicket(newTicket.value, result.tickets);
      } catch {
        /* Keep ticket conversations usable when Azure DevOps lookup is unavailable. */
      }
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
        await client.sendMessage(
          {
            id: result.threadId,
            projectId,
            title,
            modelSelection,
            worktreePath,
            branch: null,
            status: "idle",
            activeRunId: null,
            runtimeMode: "full-access",
            interactionMode: "default",
          },
          instruction,
        );
        drafts.delete(result.threadId);
        if (
          selectedId.value === result.threadId &&
          prompt.value === instruction
        )
          prompt.value = "";
      } finally {
        sending.value = false;
      }
    }
  } catch (e) {
    if (!showNew.value)
      error.value = `Conversation created, but the message could not be sent. ${String(e)}`;
    else
      newChatError.value = createdWorktree
        ? `Worktree created at ${newWorktree.value}. Conversation creation failed: ${String(e)} Retry to use this worktree.`
        : String(e);
  } finally {
    creating.value = false;
  }
}
function newChat(trigger?: HTMLButtonElement) {
  if (creating.value) return;
  newConversationButton.value = trigger;
  if (!connected.value) {
    showPairing.value = true;
    return;
  }
  const defaults = conversationDefaults(
    props.repo,
    projects.value,
    thread.value,
  );
  newProject.value = defaults.projectId;
  projectPickerOpen.value = !defaults.projectId;
  projectSearch.value = "";
  newWorktree.value = defaults.worktreePath;
  newModel.value = preferredChatModel(
    modelOptions.value,
    defaults.modelSelection,
  );
  modelSettings.value = modelSettingDefaults(
    selectedModel.value?.settings || [],
  );
  newPreset.value = conversationPresets[0];
  newTicket.value = "";
  selectedTicket.value = undefined;
  useNewWorktree.value = true;
  newChatError.value = "";
  showNew.value = true;
  void loadModels();
  void nextTick(() =>
    newConversationDialog.value
      ?.querySelector<HTMLButtonElement>(".conversation-preset")
      ?.focus(),
  );
}
function changeNewProject(id: string) {
  projectPickerOpen.value = false;
  projectSearch.value = "";
  void nextTick(() => projectPickerButton.value?.focus());
  if (newProject.value === id) return;
  newProject.value = id;
  newTicket.value = "";
  selectedTicket.value = undefined;
  const project = projects.value.find(
    (project) => project.id === newProject.value,
  );
  newWorktree.value = project?.workspaceRoot || "";
  newModel.value = preferredChatModel(
    modelOptions.value,
    project?.defaultModelSelection || undefined,
  );
}
function dismissNewDialog() {
  if (creating.value) return;
  showNew.value = false;
  newConversationButton.value?.focus();
}
function trapNewDialog(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  const elements = [
    ...(newConversationDialog.value?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
    ) || []),
  ];
  const first = elements[0],
    last = elements.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
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
let followedWorktree = "";
watch(
  [selectedId, connected, () => thread.value?.worktreePath, projects],
  () => {
    const path =
      thread.value?.worktreePath ||
      projects.value.find((project) => project.id === thread.value?.projectId)
        ?.workspaceRoot;
    const key = path && selectedId.value ? `${selectedId.value}:${path}` : "";
    if (connected.value && key && key !== followedWorktree) {
      followedWorktree = key;
      emit("selectWorktree", path!, selectedId.value);
    }
    if (!selectedId.value) followedWorktree = "";
  },
);
watch(
  () => props.selectedThreadId,
  (id) => {
    if (id !== selectedId.value) select(id);
  },
  { immediate: true },
);
onUnmounted(() => {
  for (const draft of Object.values(imageDrafts.value))
    for (const image of draft) URL.revokeObjectURL(image.preview);
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
  <section
    id="conversation-panel"
    class="chat-panel border-l-[1px] border-solid border-l-[var(--line)] flex flex-col min-h-0 bg-[#15161b] min-w-0 relative font-['Segoe_UI_Variable_Text',_'Segoe_UI',_-apple-system,_BlinkMacSystemFont,_system-ui,_sans-serif] [&_.streaming-label]:inline-flex [&_.streaming-label]:items-center [&_.streaming-label]:gap-[5px] [&_.streaming-label]:ml-[8px] [&_.streaming-label]:text-[#9baed4]"
    aria-label="Chat"
  >
    <div
      v-if="!example && state === 'connecting'"
      class="chat-connection flex items-center gap-[7px] text-[9px] text-[#768198] py-[13px] px-[16px] border-b-[1px] border-solid border-b-[#22252e]"
      role="status"
    >
      Connecting to T3 Code…
    </div>
    <template v-if="example">
      <div
        ref="conversationBody"
        class="conversation-body flex-1 overflow-auto py-[20px] px-[16px] [@media(max-width:1250px)]:py-[16px] [@media(max-width:1250px)]:px-[13px] [&_.message_p]:text-[13px] [&_.message_p]:leading-[1.7] [&_.message_p]:text-[#d4d7df]"
        @scroll="trackConversationScroll"
      >
        <div
          class="message user pb-[20px] [&_p]:text-[12px] [&_p]:leading-[1.9] [&_p]:text-[#b5bfd3] [&.user]:p-[14px] [&.user]:border-0 [&.user]:bg-[#20242e] [&.user]:rounded-[8px] [&.user]:mb-[22px] [&.user_.message-role]:text-[#7f8fab] [@media(min-width:1650px)]:[&_p]:text-[13px]"
        >
          <span
            class="message-role flex items-center gap-[7px] text-[#8fa0c2] text-[9px] tracking-[1px] mb-[11px] [text-transform:uppercase] [&_small]:ml-auto [&_small]:text-[#56647f] [&_small]:tracking-normal [&_small]:text-[9px]"
            >YOU <small class="[:where(&)]:text-[11px]">10:42</small></span
          >
          <p>
            Keep my place when I switch between Git and Chat. Switching chats
            should take me to the right worktree.
          </p>
        </div>
        <div
          class="message pb-[20px] [&_p]:text-[12px] [&_p]:leading-[1.9] [&_p]:text-[#b5bfd3] [&.user]:p-[14px] [&.user]:border-0 [&.user]:bg-[#20242e] [&.user]:rounded-[8px] [&.user]:mb-[22px] [&.user_.message-role]:text-[#7f8fab] [@media(min-width:1650px)]:[&_p]:text-[13px]"
        >
          <span
            class="message-role flex items-center gap-[7px] text-[#8fa0c2] text-[9px] tracking-[1px] mb-[11px] [text-transform:uppercase] [&_small]:ml-auto [&_small]:text-[#56647f] [&_small]:tracking-normal [&_small]:text-[9px]"
            ><Bot :size="15" /> ASSISTANT</span
          >
          <p>
            I’ve connected the conversation panel to the selected worktree. Your
            file selection and scroll position stay in place as changes arrive.
          </p>
          <div
            class="activity flex items-center gap-[8px] my-[15px] mx-0 py-[10px] px-0 border-t-[1px] border-solid border-t-[#282e3b] border-b-[1px] border-b-[#282e3b] text-[10px] text-[#7a88a3] [&_.green]:ml-auto [&_.green]:text-[9px]"
          >
            <span
              class="activity-line w-[5px] h-[5px] rounded-full bg-[#829bc3]"
            /><span
              >Updated
              <code
                class="[:where(&)]:font-['Cascadia_Code',_'JetBrains_Mono',_Consolas,_monospace]"
                >ChatPanel.vue</code
              ></span
            ><span class="green text-[var(--green)]">+12 −4</span>
          </div>
          <p>
            Review the diff and select lines to add to your next instruction.
          </p>
        </div>
        <div
          class="example-note text-[10px] text-[#5a6780] text-center leading-[1.9] my-[15px] mx-0"
        >
          Example content for interface preview.<br />No agent is running.
        </div>
      </div>
    </template>
    <template v-else-if="connected">
      <WorkingFolderPicker
        v-if="thread"
        :options="worktreeOptions"
        :value="currentWorktree"
        :disabled="busy || sending || switchingWorktree"
        :hint="worktreeHint"
        @select="switchWorktree"
      />
      <div
        v-if="activeMatchingThreads.length > 1"
        class="shared-note text-[10px] leading-[1.6] pt-0 px-[16px] pb-[10px] text-[#a89873]"
      >
        {{ activeMatchingThreads.length }} agents are working in this worktree.
      </div>
      <div
        ref="conversationBody"
        class="conversation-body flex-1 overflow-auto py-[20px] px-[16px] [@media(max-width:1250px)]:py-[16px] [@media(max-width:1250px)]:px-[13px] [&_.message_p]:text-[13px] [&_.message_p]:leading-[1.7] [&_.message_p]:text-[#d4d7df]"
        @scroll="trackConversationScroll"
      >
        <div
          v-if="!thread"
          class="panel-empty flex flex-col items-center justify-center text-center gap-[16px] py-[35px] px-[24px] text-[#7c879d] flex-1 [&_p]:text-[12px] [&_p]:leading-[1.8] [&_p]:max-w-[300px] [&_h3]:text-[#c1c9dc]"
        >
          <MessageSquare :size="26" />
          <p>Open a chat from All chats, or start a new conversation.</p>
        </div>
        <template v-for="turn in turns" :key="turn.id">
          <div
            v-for="message in turn.users"
            :key="message.id"
            class="message user pb-[20px] [&_p]:text-[12px] [&_p]:leading-[1.9] [&_p]:text-[#b5bfd3] [&.user]:p-[14px] [&.user]:border-0 [&.user]:bg-[#20242e] [&.user]:rounded-[8px] [&.user]:mb-[22px] [&.user_.message-role]:text-[#7f8fab] [@media(min-width:1650px)]:[&_p]:text-[13px]"
          >
            <template
              v-for="attachment in message.attachments || []"
              :key="attachment.id"
            >
              <ChatImage
                v-if="attachment.type === 'image'"
                :attachment="attachment"
                :load="loadImage"
              />
            </template>
            <ChatMarkdown :text="message.text" />
          </div>
          <ChatSubagents :agents="turn.subagents" />
          <details
            v-if="turn.work.length || turn.activities.length"
            class="work-details mt-[8px] mx-0 mb-[12px] text-[#8e9bb4] [&_summary]:flex [&_summary]:items-center [&_summary]:gap-[5px] [&_summary]:w-[fit-content] [&_summary]:py-[8px] [&_summary]:px-0 [&_summary]:cursor-pointer [&_summary]:text-[12px] [&_summary]:list-none [&_summary::-webkit-details-marker]:hidden [&[open]_summary_svg]:rotate-90 [&_summary:hover]:text-[#c1c9dc]"
          >
            <summary>
              {{ turn.summary === "Working…" ? "Activity" : turn.summary
              }}<ChevronRight :size="13" />
            </summary>
            <div
              class="work-content border-l-[1px] border-solid border-l-[var(--line)] pl-[12px] mt-[4px] mx-0 mb-[12px]"
            >
              <div
                v-for="message in turn.work"
                :key="message.id"
                class="message pb-[20px] [&_p]:text-[12px] [&_p]:leading-[1.9] [&_p]:text-[#b5bfd3] [&.user]:p-[14px] [&.user]:border-0 [&.user]:bg-[#20242e] [&.user]:rounded-[8px] [&.user]:mb-[22px] [&.user_.message-role]:text-[#7f8fab] [@media(min-width:1650px)]:[&_p]:text-[13px]"
              >
                <ChatMarkdown
                  :text="message.text"
                  :streaming="message.streaming"
                />
              </div>
              <div
                v-for="activity in turn.activities"
                :key="activity.id"
                class="chat-activity flex items-center gap-[7px] min-h-[25px] text-[11px] text-[#8e9bb4] [&_svg]:shrink-0 [&_span]:overflow-hidden [&_span]:whitespace-nowrap [&_span]:text-ellipsis"
                :title="activity.title"
              >
                <CircleAlert
                  v-if="
                    activity.status === 'failed' || activity.status === 'error'
                  "
                  :size="13"
                  class="activity-error text-[#e48791]"
                />
                <Check
                  v-else-if="activity.status === 'completed'"
                  :size="13"
                  class="activity-done text-[#81bda2]"
                />
                <LoaderCircle
                  v-else-if="
                    busy &&
                    [
                      'running',
                      'pending',
                      'inProgress',
                      'in_progress',
                    ].includes(activity.status)
                  "
                  :size="13"
                  class="spin animate-spin [@media(prefers-reduced-motion:reduce)]:animate-none"
                />
                <Wrench v-else :size="13" />
                <span>{{ activity.title }}</span>
              </div>
            </div>
          </details>
          <div
            v-if="turn.final"
            class="message final-message pb-[20px] [&_p]:text-[12px] [&_p]:leading-[1.9] [&_p]:text-[#b5bfd3] [&.user]:p-[14px] [&.user]:border-0 [&.user]:bg-[#20242e] [&.user]:rounded-[8px] [&.user]:mb-[22px] [&.user_.message-role]:text-[#7f8fab] [@media(min-width:1650px)]:[&_p]:text-[13px] pt-[4px]"
          >
            <ChatMarkdown
              :text="turn.final.text"
              :streaming="turn.final.streaming"
            />
          </div>
        </template>
        <ChatQuestions
          v-for="question in questions"
          :key="`${selectedId}:${question.id}`"
          :request="question"
          :disabled="!connected"
          :respond="
            (answers) =>
              client.answerQuestions(selectedId, question.id, answers)
          "
        />
        <div
          v-for="request in requests"
          :key="request.id"
          class="approval p-[12px] border-[1px] border-solid border-[#735e3b] bg-[#30291e] rounded-[6px] my-[10px] mx-0 [&_strong]:flex [&_strong]:items-center [&_strong]:gap-[8px] [&_strong]:text-[11px] [&_strong]:text-[#d5bb8c] [&_pre]:text-[10px] [&_pre]:max-h-[200px] [&_pre]:overflow-auto [&_pre]:my-[10px] [&_pre]:mx-0 [&_p]:text-[11px] [&_p]:mt-[10px]"
        >
          <strong><ShieldCheck :size="15" />{{ request.kind }}</strong>
          <pre
            class="[:where(&)]:font-['Cascadia_Code',_'JetBrains_Mono',_Consolas,_monospace] [:where(&)]:whitespace-pre-wrap [:where(&)]:[word-break:break-word] [:where(&)]:leading-[1.7]"
            >{{
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
            class="button-row flex items-center gap-[5px]"
          >
            <AppButton
              class="small text-[11px] py-[4px] px-[7px] [border-color:#30343f] rounded-[4px]"
              @click="respond(request.id, 'decline')"
            >
              Decline</AppButton
            ><AppButton
              variant="primary"
              class="primary small [border-color:#30343f] text-[11px] py-[4px] px-[7px] rounded-[4px]"
              @click="respond(request.id, 'accept')"
            >
              Approve once
            </AppButton>
          </div>
          <p v-else>Respond to this request in T3 Code.</p>
        </div>
      </div>
    </template>
    <div
      v-else
      class="panel-empty chat-empty flex flex-col items-center justify-center text-center gap-[18px] py-[35px] px-[24px] text-[#7c879d] flex-1 [&_p]:text-[12px] [&_p]:leading-[1.8] [&_p]:max-w-[300px] [&_h3]:text-[#c1c9dc] [&>small]:text-[9px] [&>small]:text-[#586780]"
    >
      <div
        class="empty-orbit flex items-center justify-center w-[64px] h-[64px] rounded-[17px] border-[1px] border-solid border-[#303747] [background:linear-gradient(135deg,_#242a38,_#181c26)] text-[#a4b5e1] shadow-[0_5px_20px_#0002]"
      >
        <Bot :size="26" />
      </div>
      <h3
        class="[:where(&)]:m-0 [:where(&)]:text-[16px] [:where(&)]:[font-weight:550]"
      >
        Your agents, beside your code.
      </h3>
      <p>
        Connect T3 Code to follow conversations, give instructions, and review
        changes in one place.
      </p>
      <AppButton
        class="secondary bg-[#22252e] [border-color:#373c49] text-[#c9d0e3]"
        @click="showPairing = true"
      >
        <Link2 :size="14" />Connect T3 Code</AppButton
      ><small class="[:where(&)]:text-[11px]"
        >Your Git workspace works independently.</small
      >
    </div>
    <div
      v-if="error"
      class="inline-error text-[#e4a6b0] bg-[#472b343f] py-[10px] px-[12px] text-[11px] leading-[1.7] whitespace-pre-wrap [overflow-wrap:anywhere]"
    >
      {{ error
      }}<AppButton
        v-if="!connected && desktop()"
        class="small text-[11px] py-[4px] px-[7px] [border-color:#30343f] rounded-[4px]"
        @click="client.connect()"
      >
        Retry connection
      </AppButton>
    </div>
    <ChatQueue v-if="projection && !example" :projection="projection" :disabled="!connected || sending || !!settlingId" :dispatch="command => client.dispatch(command)" @error="error = $event" />
    <div
      class="composer p-[11px] m-[10px] border-[1px] border-solid border-[#353d4d] rounded-[9px] bg-[#1b1f29] shadow-[0_4px_15px_#0001] [&_textarea]:w-full [&_textarea]:border-0 [&_textarea]:bg-[transparent] [&_textarea]:shadow-[none] [&_textarea]:pt-[3px] [&_textarea]:px-[3px] [&_textarea]:pb-[9px] [&_textarea]:text-[13px] [&_textarea]:min-h-[75px] [&_textarea]:max-h-[220px] [&_textarea]:resize-y relative [&_textarea]:leading-[1.6]"
    >
      <div
        v-if="images.length"
        class="pasted-images flex flex-wrap gap-[8px] mb-[8px] [&_figure]:relative [&_figure]:m-0 [&_img]:block [&_img]:w-[72px] [&_img]:h-[64px] [&_img]:[object-fit:cover] [&_img]:border-[1px] [&_img]:border-solid [&_img]:border-[var(--line)] [&_img]:rounded-[6px] [&_button]:absolute [&_button]:top-[2px] [&_button]:right-[2px] [&_button]:p-[2px] [&_button]:bg-[#101114dd]"
        aria-label="Attached images"
      >
        <figure v-for="image in images" :key="image.id">
          <img :src="image.preview" :alt="image.file.name || 'Pasted image'" />
          <AppButton
            size="icon"
            type="button"
            class="icon-button"
            :aria-label="`Remove ${image.file.name || 'pasted image'}`"
            :disabled="sending"
            @click="removeImage(image.id)"
          >
            <X :size="13" />
          </AppButton>
        </figure>
      </div>
      <div
        v-if="
          connected &&
          thread &&
          !example &&
          (busy ||
            sending ||
            requests.length ||
            questions.length ||
            thread.status === 'error')
        "
        class="agent-status flex items-center gap-[7px] min-h-[26px] mb-[5px] text-[#9baed4] text-[11px]"
        role="status"
        aria-live="polite"
      >
        <LoaderCircle
          v-if="(busy || sending) && !requests.length"
          class="spin animate-spin [@media(prefers-reduced-motion:reduce)]:animate-none"
          :size="13"
        />
        <ShieldCheck v-else-if="requests.length" :size="13" />
        <CircleAlert v-else-if="thread.status === 'error'" :size="13" />
        <Check v-else :size="13" />
        <span>{{ activityStatus }}</span>
      </div>
      <div
        v-if="context"
        class="context-chip flex items-center text-[10px] py-[4px] px-[7px] bg-[#2a3348] rounded-[4px] text-[#acbbdc] mb-[8px] [&>span]:flex-1 [&_button]:w-[20px] [&_button]:h-[20px]"
      >
        <span>Selected diff attached</span
        ><AppButton
          size="icon"
          class="icon-button"
          aria-label="Remove attached context"
          @click="emit('clearContext')"
        >
          <X :size="12" />
        </AppButton>
      </div>
      <div
        v-if="skillMenuOpen"
        :id="skillMenuId"
        ref="skillMenu"
        class="skill-menu absolute z-[20] [bottom:calc(100%_+_6px)] left-0 right-0 max-h-[260px] overflow-y-auto p-[5px] bg-[#191b21] border-[1px] border-solid border-[#30333e] rounded-[8px] shadow-[0_8px_24px_#0005] [scrollbar-width:thin] [&>button]:flex [&>button]:flex-col [&>button]:items-stretch [&>button]:justify-start [&>button]:gap-[3px] [&>button]:w-full [&>button]:text-left [&>button]:py-[8px] [&>button]:px-[9px] [&>button]:rounded-[5px] [&>button]:whitespace-normal [&>button[aria-selected='true']]:bg-[#ffffff08] [&>button[aria-selected='true']]:shadow-[inset_2px_0_#a7b6ff] [&>button:hover]:bg-[#ffffff0c] [&_strong]:flex-1 [&_strong]:min-w-0 [&_strong]:text-[12px] [&_strong]:font-medium [&_strong]:font-[inherit] [&_strong]:text-[#d9dce5] [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_small]:text-[11px] [&_small]:text-[#8f96a6] [&_small]:leading-[1.4] [&>p]:text-[11px] [&>p]:text-[#8f96a6] [&>p]:leading-[1.4] [&_small]:block [&_small]:overflow-hidden [&_small]:text-ellipsis [&_small]:whitespace-nowrap [&>p]:p-[8px] [&>p]:m-0"
        role="listbox"
        aria-label="Skills"
      >
        <div
          class="skill-menu-heading flex items-center justify-between pt-[2px] px-[7px] pb-[5px] mb-[3px] border-b-[1px] border-solid border-b-[#ffffff08] text-[#858b99] text-[10px] [&_button]:py-[3px] [&_button]:px-[5px] [&_button]:text-[10px] [&_button]:text-[#858b99]"
        >
          <span>Skills</span
          ><AppButton
            type="button"
            :disabled="skillsLoading"
            aria-label="Refresh skills"
            @mousedown.prevent
            @click="loadSkills(true)"
          >
            Refresh
          </AppButton>
        </div>
        <p v-if="skillsLoading" role="status">Loading skills…</p>
        <p v-else-if="skillsError" role="status">
          {{ skillsError }}
        </p>
        <p v-else-if="!skillMatches.length" role="status">
          No matching skills.
        </p>
        <AppButton
          v-for="(skill, index) in skillMatches"
          :id="`${skillMenuId}-${index}`"
          :key="skill.name"
          :title="skill.name"
          type="button"
          role="option"
          tabindex="-1"
          :aria-selected="index === skillIndex"
          @mousedown.prevent
          @click="chooseSkill(skill)"
        >
          <span
            class="skill-menu-label flex [align-items:baseline] gap-[8px] min-w-0"
            ><strong
              >/{{ skill.displayName || skill.name.split(":").at(-1) }}</strong
            ><span
              v-if="
                skill.name.includes(':') &&
                skill.name.split(':')[0] !== skill.name.split(':').at(-1)
              "
              class="skill-source max-w-[45%] overflow-hidden text-ellipsis whitespace-nowrap text-[9px] text-[#747b8b]"
              >{{ skill.name.split(":").slice(0, -1).join(":") }}</span
            ></span
          >
          <small class="[:where(&)]:text-[11px]">{{
            skill.shortDescription || skill.description || "Run skill"
          }}</small>
        </AppButton>
      </div>
      <AppTextarea
        ref="composer"
        v-model="prompt"
        :disabled="!connected || !thread || example"
        placeholder="Give an instruction…"
        title="Enter to send; Shift+Enter for a new line"
        aria-label="Agent instruction"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="skillMenuOpen"
        :aria-controls="skillMenuOpen ? skillMenuId : undefined"
        :aria-activedescendant="
          skillMenuOpen && skillMatches.length
            ? `${skillMenuId}-${skillIndex}`
            : undefined
        "
        @input="updateSkillCursor"
        @click="updateSkillCursor"
        @focus="updateSkillCursor"
        @blur="skillsDismissed = true"
        @keyup="
          !['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(
            $event.key,
          ) && updateSkillCursor()
        "
        @keydown="composerKeydown"
        @paste="pasteImages"
      />
      <div
        class="composer-footer flex items-center gap-[8px] [&>span]:flex-1 [&>span]:text-[9px] [&>span]:text-[#7d8ca9] [&>span]:overflow-hidden [&>span]:text-ellipsis [&>button]:inline-flex [&>button]:items-center [&>button]:justify-center [&>button]:flex-[0_0_auto] [&>button]:gap-[6px] [&>button]:h-[32px] [&>button]:py-0 [&>button]:px-[10px] [&>button]:rounded-[8px] [&>button]:text-[12px] [&>button]:leading-[1] [&>button>svg]:block [&>.stop:hover:not(:disabled)]:bg-[#38252d] [&>.stop:hover:not(:disabled)]:text-[#f0b1b6] [&>.stop:hover:not(:disabled)]:[border-color:#b47780]"
      >
        <span :title="thread?.modelSelection.model">{{
          thread?.modelSelection.model
        }}</span
        ><AppButton
          v-if="thread?.activeRunId"
          class="stop border-[1px] border-solid border-[#765056] text-[#d89c9e]"
          aria-label="Stop current task"
          title="Stop current task"
          @click="stop"
        >
          <Square :size="14" /><span>Stop</span></AppButton
        ><AppButton
          class="send-button bg-[#8e9ec9] text-[#17213a] [&:hover:not(:disabled)]:bg-[#a7b6ed] [&:hover:not(:disabled)]:text-[#17213a]"
          :aria-label="
            busy ? 'Queue instruction' : 'Send instruction'
          "
          :title="
            busy
              ? 'Queue instruction after the current task (Enter)'
              : 'Send instruction (Enter) · Shift+Enter for a new line'
          "
          :disabled="
            !connected ||
            !thread ||
            (!prompt.trim() && !images.length) ||
            sending ||
            !!settlingId ||
            example
          "
          @click="send"
        >
          <ArrowUp :size="16" /><span>{{
            busy ? "Queue" : "Send"
          }}</span>
        </AppButton>
      </div>
    </div>
    <Teleport to="body"
      ><AppDialog
        v-if="showPairing"
        title="Connect T3 Code"
        :dismissible="!false"
        @close="showPairing = false"
      >
        <AppDialogPanel
          class="modal w-[470px] max-w-full max-h-[90vh] overflow-auto p-[22px] [&_.worktree-toggle]:relative [&_.worktree-toggle]:flex [&_.worktree-toggle]:flex-row [&_.worktree-toggle]:items-center [&_.worktree-toggle]:gap-[12px] [&_.worktree-toggle]:p-[14px] [&_.worktree-toggle]:m-0 [&_.worktree-toggle]:border-[1px] [&_.worktree-toggle]:border-solid [&_.worktree-toggle]:border-[#35405a] [&_.worktree-toggle]:rounded-[8px] [&_.worktree-toggle]:bg-[#171c26] [&_.worktree-toggle]:cursor-pointer [&_.worktree-toggle_input]:absolute [&_.worktree-toggle_input]:w-[1px] [&_.worktree-toggle_input]:h-[1px] [&_.worktree-toggle_input]:opacity-0"
          aria-labelledby="pair-title"
        >
          <AppDialogHeader class="modal-heading">
            <h2
              class="[:where(&)]:m-0 [:where(&)]:text-[18px] [:where(&)]:font-semibold"
              id="pair-title"
            >
              Connect T3 Code
            </h2>
            <AppButton
              size="icon"
              class="icon-button"
              aria-label="Close"
              @click="showPairing = false"
            >
              <X :size="18" />
            </AppButton>
          </AppDialogHeader>
          <p>
            Create a pairing link in T3 Code’s connection settings, then paste
            it here. The session stays in memory until you close GitGoblin.
          </p>
          <label
            >Local server<AppInput
              v-model="origin"
              placeholder="http://127.0.0.1:3773" /></label
          ><label
            >Pairing link or code<AppInput
              v-model="pairing"
              type="password"
              autocomplete="off"
              placeholder="Paste pairing link"
              @keydown.enter="pair"
          /></label>
          <div
            v-if="error"
            class="inline-error text-[#e4a6b0] bg-[#472b343f] py-[10px] px-[12px] text-[11px] leading-[1.7] whitespace-pre-wrap [overflow-wrap:anywhere]"
          >
            {{ error }}
          </div>
          <AppDialogFooter class="modal-footer">
            <AppButton @click="showPairing = false"> Cancel</AppButton
            ><AppButton
              variant="primary"
              class="primary [border-color:#adbbff]"
              :disabled="!pairing.trim()"
              @click="pair"
            >
              Pair with T3 Code
            </AppButton>
          </AppDialogFooter>
        </AppDialogPanel>
      </AppDialog>
      <AppDialog
        v-if="showNew"
        title="New conversation"
        :dismissible="!creating"
        @close="dismissNewDialog"
      >
        <AppDialogPanel
          as="form"
          ref="newConversationDialog"
          class="modal new-conversation-dialog w-[680px] max-w-full max-h-[90vh] overflow-hidden p-[22px] flex flex-col [&>.modal-heading]:shrink-0 [&>p]:shrink-0 [&>.modal-footer]:shrink-0 [&_textarea]:w-full [&_textarea]:text-[12px] [&_.worktree-toggle]:relative [&_.worktree-toggle]:flex [&_.worktree-toggle]:flex-row [&_.worktree-toggle]:items-center [&_.worktree-toggle]:gap-[12px] [&_.worktree-toggle]:p-[14px] [&_.worktree-toggle]:m-0 [&_.worktree-toggle]:border-[1px] [&_.worktree-toggle]:border-solid [&_.worktree-toggle]:border-[#35405a] [&_.worktree-toggle]:rounded-[8px] [&_.worktree-toggle]:bg-[#171c26] [&_.worktree-toggle]:cursor-pointer [&_.worktree-toggle_input]:absolute [&_.worktree-toggle_input]:w-[1px] [&_.worktree-toggle_input]:h-[1px] [&_.worktree-toggle_input]:opacity-0"
          aria-labelledby="new-conversation-title"
          aria-describedby="new-conversation-description"
          @submit.prevent="create(newPreset)"
          @keydown="trapNewDialog"
        >
          <AppDialogHeader class="modal-heading">
            <h2
              class="[:where(&)]:m-0 [:where(&)]:text-[18px] [:where(&)]:font-semibold"
              id="new-conversation-title"
            >
              New conversation
            </h2>
            <AppButton
              size="icon"
              type="button"
              class="icon-button"
              aria-label="Close new conversation"
              :disabled="creating"
              @click="dismissNewDialog"
            >
              <X :size="18" />
            </AppButton>
          </AppDialogHeader>
          <p id="new-conversation-description">
            Choose a project and a starting action for your conversation.
          </p>
          <div
            class="conversation-setup min-h-0 overflow-y-auto py-[3px] px-[4px] my-[-3px] mx-[-4px] [scrollbar-width:thin]"
          >
            <section
              class="conversation-section mt-[20px] [&:first-child]:mt-0 [&_h3]:flex [&_h3]:[align-items:baseline] [&_h3]:gap-[10px] [&_h3]:mt-0 [&_h3]:mx-0 [&_h3]:mb-[10px] [&_h3]:text-[12px] [&_h3]:font-semibold [&_h3>span]:text-[#8998b4] [&_h3>span]:text-[11px] [&_h3>span]:font-normal [&>label:has(+_.conversation-hint)]:mb-0"
              aria-labelledby="conversation-project-heading"
            >
              <h3
                class="[:where(&)]:m-0 [:where(&)]:text-[16px] [:where(&)]:[font-weight:550]"
                id="conversation-project-heading"
              >
                Project <span>Where you’ll work</span>
              </h3>
              <AppButton
                ref="projectPickerButton"
                type="button"
                class="conversation-preset project-choice project-current w-full items-start [border-color:#647db3] [&>svg:last-child]:[transition:transform_.15s] min-w-0 flex gap-[11px] p-[12px] text-left whitespace-normal border-[1px] border-solid border-[#35405a] bg-[#171c26] rounded-[8px] [&:hover:not(:disabled)]:[border-color:#64789f] [&:hover:not(:disabled)]:bg-[#222b3c] focus-visible:[outline:2px_solid_#a7b6ff] focus-visible:outline-offset-[3px] [&[aria-pressed='true']]:[border-color:#8ca5e7] [&[aria-pressed='true']]:bg-[#27334b] [&>svg]:shrink-0 [&>svg]:mt-[2px] [&>svg]:text-[#a8bbeb] [&_span]:grid [&_span]:gap-[5px] [&_span]:flex-1 [&_span]:min-w-0 [&_span]:[overflow-wrap:anywhere] [&_strong]:text-[13px] [&_strong]:font-semibold [&_small]:text-[#9eadc8] [&_small]:text-[10px] [&_small]:leading-[1.5] [&_small]:font-[Consolas,_monospace]"
                :disabled="creating"
                :aria-expanded="projectPickerOpen"
                aria-controls="conversation-project-picker"
                @click="projectPickerOpen = !projectPickerOpen"
              >
                <FolderGit2 :size="19" />
                <span
                  ><strong>{{
                    selectedProject
                      ? projectLabel(selectedProject)
                      : "Choose a project"
                  }}</strong
                  ><small class="[:where(&)]:text-[11px]">{{
                    selectedProject?.workspaceRoot ||
                    `${projects.length} projects available`
                  }}</small></span
                >
                <ChevronRight
                  class="[&.project-expanded]:rotate-90"
                  :size="16"
                  :class="[{ 'project-expanded': projectPickerOpen }]"
                />
              </AppButton>
              <div
                v-if="projectPickerOpen"
                id="conversation-project-picker"
                class="project-picker mt-[8px] p-[8px] border-[1px] border-solid border-[#35405a] rounded-[8px] bg-[#141923] [&_input]:w-full [&_input]:mb-[8px] [&_.project-choice]:py-[9px] [&_.project-choice]:px-[10px]"
              >
                <AppInput
                  v-model="projectSearch"
                  type="search"
                  aria-label="Search projects"
                  placeholder="Search projects by name or path…"
                  :disabled="creating"
                />
                <div
                  class="conversation-projects grid gap-[5px] max-h-[220px] overflow-y-auto p-[3px] [scrollbar-width:thin] [@media(max-width:540px)]:grid-cols-[1fr]"
                  role="group"
                  aria-label="Available projects"
                >
                  <AppButton
                    v-for="project in matchingProjects"
                    :key="project.id"
                    type="button"
                    class="conversation-preset project-choice min-w-0 flex items-start gap-[11px] p-[12px] text-left whitespace-normal border-[1px] border-solid border-[#35405a] bg-[#171c26] rounded-[8px] [&:hover:not(:disabled)]:[border-color:#64789f] [&:hover:not(:disabled)]:bg-[#222b3c] focus-visible:[outline:2px_solid_#a7b6ff] focus-visible:outline-offset-[3px] [&[aria-pressed='true']]:[border-color:#8ca5e7] [&[aria-pressed='true']]:bg-[#27334b] [&>svg]:shrink-0 [&>svg]:mt-[2px] [&>svg]:text-[#a8bbeb] [&_span]:grid [&_span]:gap-[5px] [&_span]:flex-1 [&_span]:min-w-0 [&_span]:[overflow-wrap:anywhere] [&_strong]:text-[13px] [&_strong]:font-semibold [&_small]:text-[#9eadc8] [&_small]:text-[10px] [&_small]:leading-[1.5] [&_small]:font-[Consolas,_monospace]"
                    :aria-pressed="newProject === project.id"
                    :disabled="creating"
                    @click="changeNewProject(project.id)"
                  >
                    <FolderGit2 :size="19" />
                    <span
                      ><strong>{{ projectLabel(project) }}</strong
                      ><small class="[:where(&)]:text-[11px]">{{
                        project.workspaceRoot
                      }}</small></span
                    >
                    <Check
                      v-if="newProject === project.id"
                      :size="15"
                      class="preset-check"
                    />
                  </AppButton>
                </div>
                <AppHint
                  kind="conversation"
                  v-if="projects.length && !matchingProjects.length"
                  class="conversation-hint"
                >
                  No projects match “{{ projectSearch }}”.
                </AppHint>
              </div>
              <AppHint
                kind="conversation"
                v-if="!projects.length"
                class="conversation-hint"
              >
                Add a project in T3 Code to get started.
              </AppHint>
            </section>
            <section
              class="conversation-section mt-[20px] [&:first-child]:mt-0 [&_h3]:flex [&_h3]:[align-items:baseline] [&_h3]:gap-[10px] [&_h3]:mt-0 [&_h3]:mx-0 [&_h3]:mb-[10px] [&_h3]:text-[12px] [&_h3]:font-semibold [&_h3>span]:text-[#8998b4] [&_h3>span]:text-[11px] [&_h3>span]:font-normal [&>label:has(+_.conversation-hint)]:mb-0"
              aria-labelledby="conversation-action-heading"
            >
              <h3
                class="[:where(&)]:m-0 [:where(&)]:text-[16px] [:where(&)]:[font-weight:550]"
                id="conversation-action-heading"
              >
                Starting action <span>What you’ll do</span>
              </h3>
              <div
                class="conversation-actions grid grid-cols-[repeat(2,_minmax(0,_1fr))] gap-[9px] [@media(max-width:540px)]:grid-cols-[1fr]"
                role="group"
                aria-label="Conversation action"
              >
                <AppButton
                  v-for="(preset, index) in conversationPresets"
                  :key="preset.label"
                  type="button"
                  class="conversation-preset min-w-0 flex items-start gap-[11px] p-[12px] text-left whitespace-normal border-[1px] border-solid border-[#35405a] bg-[#171c26] rounded-[8px] [&:hover:not(:disabled)]:[border-color:#64789f] [&:hover:not(:disabled)]:bg-[#222b3c] focus-visible:[outline:2px_solid_#a7b6ff] focus-visible:outline-offset-[3px] [&[aria-pressed='true']]:[border-color:#8ca5e7] [&[aria-pressed='true']]:bg-[#27334b] [&>svg]:shrink-0 [&>svg]:mt-[2px] [&>svg]:text-[#a8bbeb] [&_span]:grid [&_span]:gap-[5px] [&_span]:flex-1 [&_span]:min-w-0 [&_span]:[overflow-wrap:anywhere] [&_strong]:text-[13px] [&_strong]:font-semibold [&_small]:text-[#9eadc8] [&_small]:text-[11px] [&_small]:leading-[1.5]"
                  :aria-label="preset.label"
                  :aria-pressed="newPreset.label === preset.label"
                  :disabled="creating"
                  @click="newPreset = preset"
                >
                  <component :is="presetIcons[index]" :size="19" />
                  <span
                    ><strong>{{ preset.label }}</strong
                    ><small class="[:where(&)]:text-[11px]">{{
                      preset.description
                    }}</small></span
                  >
                  <Check
                    v-if="newPreset.label === preset.label"
                    :size="15"
                    class="preset-check"
                  />
                </AppButton>
              </div>
            </section>
            <template v-if="needsTicket">
              <DevopsTickets
                :repo="newWorktree"
                :selected="newTicket"
                :disabled="creating"
                @select="selectTicket"
              />
              <label
                >Ticket URL, number, or description<AppTextarea
                  v-model="newTicket"
                  :disabled="creating"
                  rows="2"
                  required
                  placeholder="Select a ticket above, or enter a URL, #123, or description"
                />
              </label>
            </template>
            <section
              class="conversation-section mt-[20px] [&:first-child]:mt-0 [&_h3]:flex [&_h3]:[align-items:baseline] [&_h3]:gap-[10px] [&_h3]:mt-0 [&_h3]:mx-0 [&_h3]:mb-[10px] [&_h3]:text-[12px] [&_h3]:font-semibold [&_h3>span]:text-[#8998b4] [&_h3>span]:text-[11px] [&_h3>span]:font-normal [&>label:has(+_.conversation-hint)]:mb-0"
              aria-labelledby="conversation-workspace-heading"
            >
              <h3
                class="[:where(&)]:m-0 [:where(&)]:text-[16px] [:where(&)]:[font-weight:550]"
                id="conversation-workspace-heading"
              >
                Workspace
              </h3>
              <label
                class="worktree-toggle [&:has(input:focus-visible)]:[outline:2px_solid_#a7b6ff] [&:has(input:focus-visible)]:outline-offset-[3px] [&.enabled]:[border-color:#647db3] [&.enabled]:bg-[#222d43] [&>svg]:shrink-0 [&>svg]:text-[#a8bbeb] [&_input:checked_+_.worktree-switch]:bg-[#a7b6ff] [&_input:checked_+_.worktree-switch::after]:[transform:translateX(14px)] [&_input:checked_+_.worktree-switch::after]:bg-[#1b2340] [&:has(input:disabled)]:opacity-[.5] [&:has(input:disabled)]:cursor-default"
                :class="{ enabled: useNewWorktree }"
              >
                <GitBranch :size="19" />
                <span
                  class="worktree-toggle-copy grid gap-[5px] flex-1 min-w-0 [&_strong]:text-[#d9dce5] [&_strong]:text-[13px] [&_strong]:font-semibold [&_small]:text-[11px] [&_small]:leading-[1.5]"
                  ><strong>Use new worktree</strong
                  ><small
                    class="[:where(&)]:text-[11px]"
                    id="new-worktree-description"
                    >{{
                      useNewWorktree
                        ? "Create a separate branch and worktree for this conversation."
                        : "Work directly in the existing path below. Changes are shared."
                    }}</small
                  ></span
                >
                <AppInput
                  v-model="useNewWorktree"
                  type="checkbox"
                  role="switch"
                  aria-label="Use new worktree"
                  aria-describedby="new-worktree-description"
                  :disabled="creating"
                />
                <span
                  class="worktree-switch w-[34px] h-[20px] p-[3px] shrink-0 rounded-[12px] bg-[#4a5367] [&::after]:[content:''] [&::after]:block [&::after]:w-[14px] [&::after]:h-[14px] [&::after]:rounded-full [&::after]:bg-[#fff]"
                  aria-hidden="true"
                />
              </label>
              <label
                >{{ useNewWorktree ? "Create from" : "Existing worktree"
                }}<AppInput
                  v-model="newWorktree"
                  :disabled="creating"
                  placeholder="Worktree path"
                  required
              /></label>
              <AppHint kind="conversation" class="conversation-hint">
                {{
                  useNewWorktree
                    ? "A new worktree will be created from HEAD at this path."
                    : "This conversation will use this path without creating a worktree."
                }}
              </AppHint>
            </section>
            <section
              class="conversation-section model-settings mt-[20px] [&:first-child]:mt-0 pt-[18px] border-t-[1px] border-solid border-t-[#30394d] [&_h3]:flex [&_h3]:[align-items:baseline] [&_h3]:gap-[10px] [&_h3]:mt-0 [&_h3]:mx-0 [&_h3]:mb-[10px] [&_h3]:text-[12px] [&_h3]:font-semibold [&_h3>span]:text-[#8998b4] [&_h3>span]:text-[11px] [&_h3>span]:font-normal [&>label:has(+_.conversation-hint)]:mb-0"
              aria-labelledby="conversation-model-heading"
            >
              <h3
                class="[:where(&)]:m-0 [:where(&)]:text-[16px] [:where(&)]:[font-weight:550]"
                id="conversation-model-heading"
              >
                Model &amp; performance
                <span>Default: {{ defaultConversationModel }}</span>
              </h3>
              <label
                >Model<AppSelect
                  v-model="newModel"
                  :disabled="creating || modelsLoading"
                  :options="modelSelectOptions"
                  :placeholder="
                    modelsLoading ? 'Loading models…' : 'Choose a model'
                  "
              /></label>
              <AppHint
                kind="conversation"
                v-if="modelsLoading"
                class="conversation-hint"
                role="status"
              >
                Loading available models and performance options…
              </AppHint>
              <AppHint
                kind="conversation"
                v-if="modelCatalogError"
                class="conversation-hint"
                role="status"
              >
                {{ modelCatalogError }}
                <AppButton
                  type="button"
                  class="text-button py-[3px] px-[5px] text-[11px] text-[#989fad]"
                  :disabled="creating || modelsLoading"
                  @click="loadModels"
                >
                  Retry
                </AppButton>
              </AppHint>
              <AppHint
                kind="conversation"
                v-if="!modelsLoading && !modelOptions.length"
                class="conversation-hint"
              >
                Configure a model in T3 Code first.
              </AppHint>
              <AppHint
                kind="conversation"
                v-else-if="!modelsLoading && !hasPreferredModel"
                class="conversation-hint"
              >
                {{ defaultConversationModel }} is not available from your
                configured providers.
              </AppHint>
              <div
                v-for="setting in selectedModel?.settings || []"
                :key="setting.id"
                class="model-setting mt-[14px]"
              >
                <template
                  v-if="
                    setting.type === 'select' &&
                    ['reasoningEffort', 'effort'].includes(setting.id)
                  "
                >
                  <span
                    class="model-setting-label block mb-[8px] text-[11px] text-[#9eadc8]"
                    >{{ setting.label }}</span
                  >
                  <div
                    class="model-reasoning flex flex-wrap gap-[5px] [&_button]:py-[7px] [&_button]:px-[10px] [&_button]:border-[1px] [&_button]:border-solid [&_button]:border-[#35405a] [&_button]:bg-[#171c26] [&_button]:text-[11px] [&_button[aria-pressed='true']]:text-[#e3e9ff] [&_button[aria-pressed='true']]:[border-color:#8ca5e7] [&_button[aria-pressed='true']]:bg-[#27334b]"
                    role="group"
                    :aria-label="setting.label"
                  >
                    <AppButton
                      v-if="
                        !setting.currentValue &&
                        !setting.options.some((option) => option.isDefault)
                      "
                      type="button"
                      :disabled="creating"
                      :aria-pressed="modelSettings[setting.id] === ''"
                      @click="modelSettings[setting.id] = ''"
                    >
                      Provider default
                    </AppButton>
                    <AppButton
                      v-for="option in setting.options"
                      :key="option.id"
                      type="button"
                      :disabled="creating"
                      :aria-pressed="modelSettings[setting.id] === option.id"
                      :title="option.description"
                      @click="modelSettings[setting.id] = option.id"
                    >
                      {{ option.label }}
                    </AppButton>
                  </div>
                </template>
                <label v-else-if="setting.type === 'select'"
                  >{{ setting.label
                  }}<AppSelect
                    v-model="modelSettings[setting.id]"
                    :disabled="creating"
                    :options="[
                      ...(!setting.currentValue &&
                      !setting.options.some((option) => option.isDefault)
                        ? [{ value: '', label: 'Provider default' }]
                        : []),
                      ...setting.options.map((option) => ({
                        value: option.id,
                        label: option.label,
                      })),
                    ]"
                /></label>
                <label v-else class="force-option"
                  ><AppInput
                    v-model="modelSettings[setting.id]"
                    type="checkbox"
                    :disabled="creating"
                  />{{ setting.label }}</label
                >
                <AppHint
                  kind="conversation"
                  v-if="setting.description"
                  class="conversation-hint"
                >
                  {{ setting.description }}
                </AppHint>
              </div>
            </section>
            <p v-if="!connected">Reconnect T3 Code to create a conversation.</p>
            <div
              v-if="newChatError"
              class="inline-error text-[#e4a6b0] bg-[#472b343f] py-[10px] px-[12px] text-[11px] leading-[1.7] whitespace-pre-wrap [overflow-wrap:anywhere]"
              role="alert"
            >
              {{ newChatError }}
            </div>
          </div>
          <AppDialogFooter class="modal-footer">
            <AppButton
              type="button"
              :disabled="creating"
              @click="dismissNewDialog"
            >
              Cancel
            </AppButton>
            <AppButton
              variant="primary"
              type="submit"
              class="primary [border-color:#adbbff]"
              :disabled="!canCreate"
            >
              <LoaderCircle
                v-if="creating"
                :size="14"
                class="spin animate-spin [@media(prefers-reduced-motion:reduce)]:animate-none"
              />{{ creating ? "Creating…" : "Create conversation" }}
            </AppButton>
          </AppDialogFooter>
        </AppDialogPanel>
      </AppDialog>
    </Teleport>
  </section>
</template>
