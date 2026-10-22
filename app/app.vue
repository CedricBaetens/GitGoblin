<script setup lang="ts">
import { version as appVersion } from '../package.json';
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import {
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  History,
  FolderOpen,
  FolderGit2,
  Star,
  Pencil,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  Search,
  Settings2,
  X,
  Check,
  ArrowUpRight,
  FileCode2,
  Layers,
  List,
  ListTree,
  Tag,
  Archive,
  Globe,
  MoreHorizontal,
  Circle,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  ExternalLink,
  Command,
  MessageSquare,
  LoaderCircle,
} from "lucide-vue-next";
import { useWorkbench } from "~/composables/useWorkbench";
import { branchTree } from "~/lib/branches";
import { chatHistory, closeChatTab, moveChatTab, openChatTab, restoreChatTabs } from "~/lib/chat-tabs";
import { isThreadRunning, visibleThreads } from "~/lib/threads";
import { desktop, invoke } from "~/lib/native";
import { clampSidebarWidth, defaultSidebarWidth, maxSidebarWidth, minSidebarWidth, sidebarKeyboardWidth } from '~/lib/sidebar';
import type { Commit, T3Thread, T3Project, GitRequest, GitRef } from "~/lib/types";
const w = useWorkbench();
const {
  repo,
  recent,
  favorites,
  snapshot,
  commits,
  selected,
  diff,
  diffLoading,
  wholeFile,
  mode,
  base,
  view,
  search,
  busy,
  error,
  notice,
  example,
  working,
  staged,
  currentFiles,
  selectedFile,
  selectedCommit,
  historyDiff,
  reflog,
} = w;
const filesAsTree = ref(true);
const preferredSidebarWidth = ref(defaultSidebarWidth);
const sidebarViewport = ref(1280);
const preferredFilesWidth = ref<number>();
const preferredDetailsHeight = ref<number>();
const workspace = ref<HTMLElement>();
const workspaceSize = ref({ width: 800, height: 700 });
let workspaceObserver: ResizeObserver | undefined;
const maxFilesWidth = computed(() => Math.max(180, Math.min(520, workspaceSize.value.width - 280)));
const filesWidth = computed(() => preferredFilesWidth.value === undefined ? undefined : Math.max(180, Math.min(maxFilesWidth.value, preferredFilesWidth.value)));
const maxDetailsHeight = computed(() => Math.max(170, workspaceSize.value.height - 250));
const detailsHeight = computed(() => preferredDetailsHeight.value === undefined ? undefined : Math.max(170, Math.min(maxDetailsHeight.value, preferredDetailsHeight.value)));
const resizingSidebar = ref(false);
const sidebarRoom = sidebarViewport;
const sidebarWidth = computed(() => clampSidebarWidth(preferredSidebarWidth.value, sidebarRoom.value));
let sidebarPointer: number | undefined, sidebarStartX = 0, sidebarStartWidth = 0;
function updateSidebarViewport() {
  sidebarViewport.value = window.innerWidth;
}
function saveSidebarWidth() {
  try { localStorage.setItem('gitgoblin.sidebarWidth', String(preferredSidebarWidth.value)); } catch { /* Resizing remains available without storage. */ }
}
function startSidebarResize(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  sidebarPointer = event.pointerId;
  sidebarStartX = event.clientX;
  sidebarStartWidth = sidebarWidth.value;
  resizingSidebar.value = true;
  const handle = event.currentTarget as HTMLElement;
  handle.focus({ preventScroll: true });
  handle.setPointerCapture(event.pointerId);
}
function moveSidebarResize(event: PointerEvent) {
  if (event.pointerId === sidebarPointer)
    preferredSidebarWidth.value = clampSidebarWidth(sidebarStartWidth + event.clientX - sidebarStartX, sidebarRoom.value);
}
function stopSidebarResize(event: PointerEvent) {
  if (event.pointerId !== sidebarPointer) return;
  sidebarPointer = undefined;
  resizingSidebar.value = false;
  saveSidebarWidth();
  const handle = event.currentTarget as HTMLElement;
  if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
}
function sidebarResizeKey(event: KeyboardEvent) {
  const width = sidebarKeyboardWidth(event.key, sidebarWidth.value, sidebarRoom.value, event.shiftKey);
  if (width === undefined) return;
  event.preventDefault();
  event.stopPropagation();
  preferredSidebarWidth.value = width;
  saveSidebarWidth();
}
function resetSidebarWidth() {
  preferredSidebarWidth.value = defaultSidebarWidth;
  saveSidebarWidth();
}
const repositoryMenu = ref<HTMLDivElement>();
const fileMenu = ref<HTMLDivElement>();
const renamePath = ref(''), renameName = ref('');
const renameInput = ref<HTMLInputElement>();
async function startRepositoryRename(path: string) {
  repositoryMenu.value?.hidePopover();
  renamePath.value = path;
  renameName.value = w.repositoryAlias(path);
  await nextTick();
  renameInput.value?.focus();
  renameInput.value?.select();
}
async function saveRepositoryName() {
  if (await w.renameRepository(renamePath.value, renameName.value)) renamePath.value = '';
}
import type { ContextMenuHandle, ContextMenuItem as SidebarItem } from '~/lib/context-menu';
const sidebarMenu = ref<ContextMenuHandle>();
const copyItem = (label: string, text: string): SidebarItem => ({ label, run: () => navigator.clipboard.writeText(text) });
function actionItem(label: string, action: string, preset: Record<string, string> = {}, disabled = false): SidebarItem {
  return { label, disabled: disabled || busy.value || example.value, run: () => ask(action, preset) };
}
async function switchBranch(branch: GitRef) {
  if (branch.current || busy.value || example.value) return;
  try {
    await w.mutate('switch', { target: branch.name.replace('refs/heads/', '') });
  } catch { /* The workbench displays Git's error, including local-change protection. */ }
}
function branchMenu(event: MouseEvent | KeyboardEvent, branch: GitRef) {
  const local = branch.name.startsWith('refs/heads/');
  const target = local ? branch.name.replace('refs/heads/', '') : branch.name;
  const items = [
    { label: 'Switch to branch', disabled: branch.current || busy.value || example.value, run: () => switchBranch(branch) },
    ...(local ? [{
      label: 'Compare with working tree', disabled: busy.value || example.value,
      run: () => { base.value = target; mode.value = 'branch'; view.value = 'changes'; },
    }] : []),
    { ...actionItem('Merge into current branch…', 'merge', { target }, branch.current), separatorBefore: true },
    actionItem('Rebase current branch onto this…', 'rebase-onto', { target }, branch.current),
    { ...actionItem('Create branch here…', 'branch-create', { target }), separatorBefore: true },
    ...(local ? [{ ...actionItem('Delete branch…', 'branch-delete', { target }, branch.current), danger: true }] : []),
    { ...copyItem('Copy branch name', branch.name.replace(/^refs\/(heads|remotes)\//, '')), separatorBefore: true },
    copyItem('Copy commit hash', branch.id),
  ];
  sidebarMenu.value?.open(event, items);
}
function worktreeMenu(event: MouseEvent | KeyboardEvent, path: string) {
  const main = normalized(path) === normalized(snapshot.value?.repositoryRoot || snapshot.value?.worktrees[0]?.path || '');
  const current = normalized(path) === normalized(repo.value);
  const active = threads.value.some(thread => thread.activeRunId && normalized(thread.worktreePath || projects.value.find(project => project.id === thread.projectId)?.workspaceRoot || '') === normalized(path));
  const reason = main ? 'The main worktree cannot be removed.' : current ? 'Switch to another worktree first.' : active ? 'Stop the agent using this worktree first.' : undefined;
  sidebarMenu.value?.open(event, [
    { label: 'Open worktree', disabled: busy.value || example.value || current, run: () => w.openRepo(path) },
    { label: 'Reveal in Explorer', disabled: !desktop() || example.value, run: () => fileLocation('reveal_path', '', path) },
    { ...actionItem('New worktree…', 'worktree-add'), separatorBefore: true },
    { ...actionItem('Remove worktree…', 'worktree-remove', { path }, !!reason), danger: true, disabledReason: reason },
    { ...copyItem('Copy worktree path', path), separatorBefore: true },
  ]);
}

function tagMenu(event: MouseEvent | KeyboardEvent, tag: GitRef) {
  const name = tag.name.replace('refs/tags/', '');
  sidebarMenu.value?.open(event, [
    actionItem('Create branch here…', 'branch-create', { target: tag.name }),
    { ...actionItem('Delete tag…', 'tag-delete', { target: name }), separatorBefore: true, danger: true },
    { ...copyItem('Copy tag name', name), separatorBefore: true },
    copyItem('Copy commit hash', tag.id),
  ]);
}
function stashMenu(event: MouseEvent | KeyboardEvent, stash: string) {
  const target = stash.split('\t')[0]!;
  sidebarMenu.value?.open(event, [
    actionItem('Apply stash…', 'stash-apply', { target }),
    { ...actionItem('Drop stash…', 'stash-drop', { target }), separatorBefore: true, danger: true },
    { ...copyItem('Copy stash reference', target), separatorBefore: true },
  ]);
}
function commitMenu(event: MouseEvent | KeyboardEvent, commit: Commit) {
  sidebarMenu.value?.open(event, [
    { label: 'View commit', run: () => { view.value = 'history'; historyTab.value = 'commit'; return w.selectCommit(commit); } },
    { ...actionItem('Create branch here…', 'branch-create', { target: commit.id }), separatorBefore: true },
    actionItem('Cherry-pick commit…', 'cherry-pick', { target: commit.id }),
    actionItem('Revert commit…', 'revert', { target: commit.id }),
    { ...actionItem('Reset current branch to here…', 'reset', { target: commit.id }), separatorBefore: true, danger: true },
    { ...copyItem('Copy commit hash', commit.id), separatorBefore: true },
    { label: 'Copy commit message', run: async () => navigator.clipboard.writeText(example.value ? commit.subject : await w.read<string>('commit-message', { target: commit.id })) },
  ]);
}
function repositoryContext(event: MouseEvent | KeyboardEvent, path: string) {
  sidebarMenu.value?.open(event, [
    { label: 'Open repository', disabled: busy.value, run: () => chooseRepository(path) },
    { label: 'Rename repository…', separatorBefore: true, disabled: w.nameSaving.value, run: () => startRepositoryRename(path) },
    { label: w.isFavorite(path) ? 'Unfavorite repository' : 'Favorite repository', disabled: w.favoriteSaving.value, run: () => w.toggleFavorite(path) },
    { label: 'Reveal in Explorer', separatorBefore: true, disabled: !desktop(), run: () => fileLocation('reveal_path', '', path) },
    { ...copyItem('Copy repository path', path), separatorBefore: true },
    { label: 'Remove from GitGoblin', separatorBefore: true, disabled: busy.value || w.favoriteSaving.value, run: () => w.removeRepository(path) },
  ]);
}
async function fileLocation(action: 'open_editor' | 'reveal_path' | 'full_path', path: string, root = repo.value) {
  try {
    const result = await invoke<string>(action, { repo: root, path });
    if (action === 'full_path') await navigator.clipboard.writeText(result);
  } catch (e) { error.value = String(e); }
}
watch([repo, busy, example], () => sidebarMenu.value?.close());
const workspaceMode = ref<'git' | 'chat'>('git');
const chatVisible = computed({
  get: () => workspaceMode.value === 'chat',
  set: (visible: boolean) => { workspaceMode.value = visible ? 'chat' : 'git'; },
});
const sidebarScroll = ref<HTMLElement>();
const sidebarPositions = { git: 0, chat: 0 };
watch(workspaceMode, (mode) => {
  menu.value = false;
  sidebarMenu.value?.close();
  repositoryMenu.value?.hidePopover();
  try { localStorage.setItem('gitgoblin.workspaceMode', mode); } catch { /* Modes work without storage. */ }
});
watch(workspaceMode, async (mode, previous) => {
  if (sidebarScroll.value) sidebarPositions[previous] = sidebarScroll.value.scrollTop;
  await nextTick();
  if (sidebarScroll.value) sidebarScroll.value.scrollTop = sidebarPositions[mode];
});
const chatNeedsAttention = ref(false);
const context = ref(""),
  chat = ref<{ settle: (id: string) => Promise<void>; newConversation: (trigger?: HTMLButtonElement) => void; stopAll: () => Promise<void>; focusComposer: () => void }>(),
  menu = ref(false);
const commitMessages = ref<Record<string, string>>({});
const commitMessage = computed({
  get: () => commitMessages.value[normalized(repo.value)] || '',
  set: (message: string) => { commitMessages.value[normalized(repo.value)] = message; },
});
const canCommit = computed(() => !busy.value && !example.value && !!staged.value.length
  && !!commitMessage.value.trim() && !snapshot.value?.files.some(file => file.conflict));
async function openNewConversation(event: MouseEvent) {
  const trigger = event.currentTarget as HTMLButtonElement;
  chatVisible.value = true;
  await nextTick();
  chat.value?.newConversation(trigger);
}
function toggleTopMenu(element: HTMLDivElement | undefined, event: MouseEvent) {
  if (!element) return;
  if (element.matches(':popover-open')) { element.hidePopover(); return; }
  element.showPopover();
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  element.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - element.offsetWidth - 8))}px`;
  element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}
const threads = ref<T3Thread[]>([]),
  projects = ref<T3Project[]>([]),
  t3Connected = ref(false);
const chatTabs = ref(restoreChatTabs(null));
const selectedThreadId = computed(() => chatTabs.value.selected);
const selectedChatWorktree = computed(() => {
  const thread = threads.value.find(thread => thread.id === selectedThreadId.value);
  return thread?.worktreePath || projects.value.find(project => project.id === thread?.projectId)?.workspaceRoot || '';
});
const chatNavigation = ref<{ openAll: (openOnly?: boolean) => void; closePicker: () => void }>();
const chatActivityStates = ref<Record<string, { attention: boolean; response: string }>>({});
const seenResponses = ref<Record<string, string>>({});
let tabsInitialized = false;
let hadSavedTabs = false;
const chatIndicators = computed(() => Object.fromEntries(Object.entries(chatActivityStates.value).map(([id, activity]) =>
  [id, { attention: activity.attention, unread: !!activity.response && seenResponses.value[id] !== activity.response, completed: !!activity.response }])));
function persistChatTabs() {
  try {
    localStorage.setItem('gitgoblin.chatTabs', JSON.stringify(chatTabs.value));
    localStorage.setItem('gitgoblin.seenChatResponses', JSON.stringify(seenResponses.value));
  } catch { /* Tabs remain usable without storage. */ }
}
watch(chatTabs, persistChatTabs, { deep: true });
watch(selectedThreadId, () => { context.value = ''; });
watch([selectedThreadId, chatVisible, chatActivityStates], () => {
  const id = selectedThreadId.value, activity = chatActivityStates.value[id];
  if (chatVisible.value && activity?.response && seenResponses.value[id] !== activity.response) { seenResponses.value[id] = activity.response; persistChatTabs(); }
});
function selectChat(id: string) {
  if (busy.value && !w.repositoryLoading.value) return;
  chatNavigation.value?.closePicker();
  chatVisible.value = true;
  if (selectedThreadId.value === id) {
    const thread = threads.value.find(thread => thread.id === id);
    const path = thread?.worktreePath || projects.value.find(project => project.id === thread?.projectId)?.workspaceRoot;
    if (path && normalized(path) !== normalized(repo.value)) void openThreadWorktree(path, id);
  }
  chatTabs.value = openChatTab(chatTabs.value, id);
}
function receiveChatSelection(id: string) {
  if (id) chatTabs.value = openChatTab(chatTabs.value, id);
}
const closingChat = ref<T3Thread>();
function closeChat(id: string) {
  if (busy.value || closingChat.value || !chatTabs.value.ids.includes(id)) return;
  chatNavigation.value?.closePicker();
  closingChat.value = threads.value.find(thread => thread.id === id);
}
async function confirmCloseChat(settle: boolean) {
  const thread = closingChat.value;
  if (!thread) return;
  if (settle) {
    if (!t3Connected.value || !chat.value) throw new Error('Reconnect T3 Code to settle this conversation, or turn off settling to close only the tab.');
    await chat.value.settle(thread.id);
  }
  chatTabs.value = closeChatTab(chatTabs.value, thread.id);
}
function chatActions(thread: T3Thread): SidebarItem[] {
  return [
    { label: 'Open conversation', disabled: busy.value || example.value, run: () => selectChat(thread.id) },
    { label: 'Close tab', disabled: busy.value || !chatTabs.value.ids.includes(thread.id), run: () => closeChat(thread.id) },
    { label: 'Settle conversation', separatorBefore: true, disabled: !t3Connected.value || example.value || thread.settledOverride === 'settled' || !!thread.archivedAt,
      run: () => chat.value?.settle(thread.id) },
    { ...copyItem('Copy conversation title', thread.title), separatorBefore: true },
    copyItem('Copy conversation ID', thread.id),
  ];
}
const normalized = (value: string) =>
  value.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
const repoName = computed(
  () => w.repositoryName(snapshot.value?.repositoryRoot || repo.value),
);
const localBranches = computed(
  () =>
    snapshot.value?.refs.filter((r) => r.name.startsWith("refs/heads/")) || [],
);
const remoteBranches = computed(
  () =>
    snapshot.value?.refs.filter((r) => r.name.startsWith("refs/remotes/")) ||
    [],
);
const localBranchTree = computed(() => branchTree(localBranches.value, "refs/heads/"));
const remoteBranchTree = computed(() => branchTree(remoteBranches.value, "refs/remotes/"));
const tags = computed(
  () =>
    snapshot.value?.refs.filter((r) => r.name.startsWith("refs/tags/")) || [],
);
const repoThreads = computed(() =>
  threads.value.filter(
    (t) =>
      normalized(
        t.worktreePath ||
          projects.value.find((p) => p.id === t.projectId)?.workspaceRoot ||
          "",
      ) === normalized(repo.value),
  ),
);
const activeAgents = computed(() => repoThreads.value.filter(isThreadRunning));
const allActiveAgents = computed(() => threads.value.filter(thread => !thread.deletedAt && isThreadRunning(thread)));
const additions = computed(
  () =>
    diff.value.text
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
);
const deletions = computed(
  () =>
    diff.value.text
      .split("\n")
      .filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
);
const historyTab = ref("commit");
const fileGroups = computed(() => mode.value === "branch"
  ? [{ mode: "branch", label: "Branch changes", files: currentFiles.value }]
  : [
      { mode: "working", label: "Unstaged", files: working.value },
      { mode: "staged", label: "Staged", files: staged.value },
    ]);
function selectFile(path: string, group: string) {
  mode.value = group;
  selected.value = path;
}
const sections = ref<Record<string, boolean>>({
  branches: true,
  worktrees: true,
  remotes: false,
  tags: false,
  stashes: false,
});
const dialog = ref(""),
  dialogTitle = ref(""),
  dialogDescription = ref(""),
  dialogError = ref(""),
  values = ref<Record<string, string>>({}),
  fields = ref<{ key: string; label: string; options?: string[] }[]>([]);
const output = ref(""),
  outputTitle = ref(""),
  rebaseCommits = ref<(Commit & { action: string })[]>([]);
const discardFiles = ref<NonNullable<GitRequest['files']>>([]);
const discardRepo = ref('');
async function confirmDiscard(paths: string[]) {
  if (busy.value || example.value || !paths.length) return;
  const root = repo.value;
  try {
    const files = await w.read<NonNullable<GitRequest['files']>>('discard-plan', { files: paths.map(path => ({ path })) });
    if (root !== repo.value) return;
    discardFiles.value = files;
    discardRepo.value = root;
    ask('discard-files');
    dialogDescription.value = `Permanently discard unstaged changes in ${files.length} file${files.length === 1 ? '' : 's'}? Staged changes are kept. New untracked files are deleted. This cannot be undone.`;
  } catch (e) { error.value = String(e); }
}
const conflictOpen = ref(false);
const conflictInitial = ref('');
const conflictGitOutput = ref('');
const definitions: Record<
  string,
  {
    title: string;
    description: string;
    fields?: { key: string; label: string; options?: string[] }[];
    defaults?: Record<string, string>;
  }
> = {
  'discard-files': { title: 'Discard changes', description: '' },
  "branch-create": {
    title: "Create branch",
    description: "Create a branch at the selected commit and switch to it.",
    fields: [
      { key: "text", label: "Branch name" },
      { key: "target", label: "Starting commit or branch" },
    ],
    defaults: { target: "HEAD" },
  },
  "branch-delete": {
    title: "Delete branch",
    description:
      "Deletes a local branch. Enable force deletion to delete an unmerged branch. Commits unique to it may be lost. Remote branches are unchanged.",
    fields: [{ key: "target", label: "Branch" }],
  },
  "tag-create": {
    title: "Create tag",
    description: "Create a lightweight tag.",
    fields: [
      { key: "text", label: "Tag name" },
      { key: "target", label: "Commit" },
    ],
    defaults: { target: "HEAD" },
  },
  "tag-delete": {
    title: "Delete tag",
    description: "Deletes the local tag. Remote tags are unchanged.",
    fields: [{ key: "target", label: "Tag name" }],
  },
  merge: {
    title: "Merge branch",
    description:
      "Merge into your current branch. Conflicts can be resolved in GitGoblin.",
    fields: [{ key: "target", label: "Branch to merge" }],
  },
  "rebase-onto": {
    title: "Rebase current branch",
    description: "Replay your current branch’s commits onto the selected branch. Commit or stash local changes first. This rewrites commit IDs; conflicts can be resolved in GitGoblin.",
    fields: [{ key: "target", label: "Branch to rebase onto" }],
  },
  "cherry-pick": {
    title: "Cherry-pick commit",
    description: "Apply this commit to your current branch.",
    fields: [{ key: "target", label: "Commit" }],
  },
  revert: {
    title: "Revert commit",
    description: "Create a new commit that reverses this commit.",
    fields: [{ key: "target", label: "Commit" }],
  },
  reset: {
    title: "Reset current branch",
    description:
      "Soft keeps changes staged. Mixed unstages them. Hard permanently discards tracked changes; reflog cannot recover uncommitted content.",
    fields: [
      { key: "target", label: "Commit" },
      { key: "mode", label: "Reset mode", options: ["soft", "mixed", "hard"] },
    ],
    defaults: { mode: "mixed" },
  },
  "stash-save": {
    title: "Stash changes",
    description: "Save tracked and untracked changes and clean the worktree.",
    fields: [{ key: "text", label: "Stash message" }],
    defaults: { text: "Work in progress" },
  },
  "stash-apply": {
    title: "Apply stash",
    description: "Restore changes from this stash. The stash is kept.",
    fields: [{ key: "target", label: "Stash reference" }],
  },
  "stash-drop": {
    title: "Drop stash",
    description: "Permanently remove this stash entry.",
    fields: [{ key: "target", label: "Stash reference" }],
  },
  "remote-add": {
    title: "Add remote",
    description: "Register a Git remote.",
    fields: [
      { key: "target", label: "Remote name" },
      { key: "text", label: "Remote URL" },
    ],
  },
  "remote-remove": {
    title: "Remove remote",
    description: "Remove the remote and its tracking references.",
    fields: [{ key: "target", label: "Remote name" }],
  },
  "worktree-add": {
    title: "Create worktree",
    description: "Create a new branch in a separate folder for isolated work.",
    fields: [
      { key: "text", label: "New branch name" },
      { key: "path", label: "New absolute folder path" },
      { key: "target", label: "Starting commit" },
    ],
    defaults: { target: "HEAD" },
  },
  "worktree-remove": {
    title: "Remove worktree",
    description: "Remove this worktree folder and its Git registration. The branch and its commits are kept. Git refuses dirty or locked worktrees. Ignored files inside the folder will also be deleted.",
    fields: [{ key: "path", label: "Worktree folder to remove" }],
  },
  rebase: {
    title: "Interactive rebase",
    description:
      "Rewrite commits after a base. Use Edit / reword to pause, amend the message, then continue. Squash combines messages. Rewriting published commits affects collaborators.",
    fields: [{ key: "target", label: "Base commit or branch" }],
    defaults: { target: "main" },
  },
  fetch: {
    title: "Fetch all remotes",
    description:
      "Download remote references and prune deleted tracking branches.",
  },
  pull: {
    title: "Pull changes",
    description:
      "Fast-forward the current branch from its upstream. Diverged branches require an explicit merge or rebase.",
  },
  push: {
    title: "Push branch",
    description:
      "Publish commits to the configured upstream.",
  },
  continue: {
    title: "Continue operation",
    description:
      "Continue after resolving conflicts or amending the paused commit.",
  },
  abort: {
    title: "Abort operation",
    description:
      "Return to the state before the current merge, rebase, cherry-pick, or revert.",
  },
  commit: {
    title: "Commit staged changes",
    description: "Create a commit from the index.",
    fields: [{ key: "text", label: "Commit message" }],
  },
  amend: {
    title: "Amend last commit",
    description:
      "Replace the most recent commit with the staged content and message. This changes its commit ID.",
    fields: [{ key: "text", label: "Commit message" }],
  },
};
function ask(action: string, preset: Record<string, string> = {}) {
  menu.value = false;
  const definition = definitions[action];
  if (!definition) return;
  dialog.value = action;
  dialogTitle.value = definition.title;
  dialogDescription.value = definition.description;
  fields.value = definition.fields || [];
  values.value = { ...definition.defaults, ...preset };
  dialogError.value = "";
  rebaseCommits.value = [];
}
async function executeDialog() {
  if (!dialog.value) return;
  dialogError.value = "";
  try {
    if (dialog.value === 'worktree-remove' && threads.value.some(thread => thread.activeRunId && normalized(thread.worktreePath || projects.value.find(project => project.id === thread.projectId)?.workspaceRoot || '') === normalized(values.value.path || ''))) {
      throw new Error('Stop the agent using this worktree before removing it.');
    }
    if (dialog.value === "rebase" && !rebaseCommits.value.length) {
      rebaseCommits.value = (
        await w.read<Commit[]>("rebase-plan", { target: values.value.target })
      ).map((c) => ({ ...c, action: "pick" }));
      if (!rebaseCommits.value.length)
        throw new Error("No commits after that base.");
      return;
    }
    const params: Partial<GitRequest> = { ...values.value };
    if (dialog.value === 'discard-files') {
      if (repo.value !== discardRepo.value) throw new Error('The repository changed. Close this dialog and try again.');
      params.files = discardFiles.value;
    }
    if (dialog.value === "rebase")
      params.text = rebaseCommits.value
        .map((c) => `${c.action} ${c.id}`)
        .join("\n");
    const action = dialog.value;
    const root = normalized(repo.value);
    await w.mutate(action, params);
    if (action === 'commit') commitMessages.value[root] = '';
    dialog.value = "";
  } catch (e) {
    if (snapshot.value?.files.some(file => file.conflict)) {
      dialog.value = '';
      error.value = '';
      conflictInitial.value = '';
      conflictGitOutput.value = String(e);
      conflictOpen.value = true;
    } else dialogError.value = String(e);
  }
}
async function stopAgents() {
  try {
    await chat.value?.stopAll();
    notice.value =
      "Stop requested. Wait until the tasks stop before continuing.";
  } catch (e) {
    dialogError.value = String(e);
  }
}
async function stage() {
  if (!selected.value) return;
  try {
    await w.mutate(mode.value === "staged" ? "unstage" : "stage", {
      path: selected.value,
      fingerprint: diff.value.fingerprint,
    });
  } catch {}
}
async function toggleFileStage(path: string | null, group: string, folder = false) {
  if (busy.value || example.value || !['working', 'staged'].includes(group)) return;
  const files = (group === 'staged' ? staged.value : working.value)
    .filter((file) => path === null || (folder ? file.path.startsWith(`${path}/`) : file.path === path));
  if (files.some((file) => file.conflict)) {
    error.value = 'Resolve conflicting files before staging these changes.';
    return;
  }
  try {
    await w.stageFiles(files.map((file) => file.path), group);
  } catch (e) {
    error.value = String(e);
  }
}
async function toggleSelectedFiles(paths: string[], group: string) {
  if (busy.value || example.value || !['working', 'staged'].includes(group)) return;
  const files = (group === 'staged' ? staged.value : working.value).filter(file => paths.includes(file.path));
  if (files.some(file => file.conflict)) { error.value = 'Resolve conflicting files before staging these changes.'; return; }
  try { await w.stageFiles(files.map(file => file.path), group); } catch (e) { error.value = String(e); }
}
async function patch(text: string) {
  try {
    await w.mutate("patch", {
      path: selected.value,
      fingerprint: diff.value.fingerprint,
      text,
      mode: mode.value,
    });
  } catch {}
}
async function commit() {
  if (!canCommit.value) return;
  if (activeAgents.value.length) { ask('commit', { text: commitMessage.value }); return; }
  const root = normalized(repo.value);
  const text = commitMessage.value;
  try {
    await w.mutate('commit', { text });
    if (commitMessages.value[root] === text) commitMessages.value[root] = '';
  } catch { /* Keep the message for retry; the workbench displays Git's error. */ }
}
async function amendCommit() {
  if (busy.value || example.value || !snapshot.value?.head) return;
  const root = repo.value;
  try {
    const text = await w.read<string>('commit-message', { target: 'HEAD' });
    if (root === repo.value) ask('amend', { text });
  } catch (e) { error.value = String(e); }
}
function addContext(text: string) {
  context.value = `File: ${selected.value || selectedCommit.value?.id || repo.value}\n\n${text}`;
  chatVisible.value = true;
}
async function editContext(text: string) {
  context.value = `Repository: ${repo.value}\n\n${text}`;
  chatVisible.value = true;
  await nextTick();
  chat.value?.focusComposer();
}
function receiveThreads(ts: T3Thread[], ps: T3Project[], connected: boolean) {
  const previous = threads.value;
  threads.value = ts;
  projects.value = ps;
  t3Connected.value = connected;
  if (!connected) return;
  const restoring = !tabsInitialized;
  if (restoring) {
    tabsInitialized = true;
    if (!hadSavedTabs) {
      const first = visibleThreads(repoThreads.value)[0] || chatHistory(ts)[0];
      if (first) chatTabs.value = openChatTab(chatTabs.value, first.id);
    }
  }
  for (const id of [...chatTabs.value.ids]) {
    const thread = ts.find(thread => thread.id === id);
    if (thread?.deletedAt || (!thread && (restoring || previous.some(thread => thread.id === id)))) chatTabs.value = closeChatTab(chatTabs.value, id);
  }
}
let currentChat = "";
const chatViews = new Map<
  string,
  { selected: string; mode: string; view: string; base: string; scroll: number }
>();
async function openThreadWorktree(path: string, threadId: string) {
  if (currentChat)
    chatViews.set(currentChat, {
      selected: selected.value,
      mode: mode.value,
      view: view.value,
      base: base.value,
      scroll:
        document.querySelector(".review-panel .diff-scroll")?.scrollTop || 0,
    });
  if (normalized(path) !== normalized(repo.value) || w.repositoryLoading.value) await w.openRepo(path);
  if (normalized(path) !== normalized(repo.value) || selectedThreadId.value !== threadId) return;
  currentChat = threadId;
  const saved = chatViews.get(threadId);
  if (saved) {
    mode.value = saved.mode;
    view.value = saved.view;
    base.value = saved.base;
    await nextTick();
    if (selectedThreadId.value !== threadId) return;
    selected.value = saved.selected;
    await w.loadDiff();
    await nextTick();
    if (selectedThreadId.value !== threadId) return;
    const scroller = document.querySelector(".review-panel .diff-scroll");
    if (scroller) scroller.scrollTop = saved.scroll;
  }
}
async function showFileInfo(action: "blame" | "history") {
  if (!selected.value) return;
  try {
    outputTitle.value =
      action === "blame"
        ? `Blame · ${selected.value}`
        : `File history · ${selected.value}`;
    if (example.value) {
      output.value =
        "Example workspace. Open a repository to inspect its file history.";
      return;
    }
    const result = await w.read<string | Commit[]>(action, {
      path: selected.value,
    });
    output.value =
      typeof result === "string"
        ? result
        : result
            .map((c) => `${c.id.slice(0, 8)}  ${c.author}  ${c.subject}`)
            .join("\n");
  } catch (e) {
    error.value = String(e);
  }
}
async function openConflict() {
  conflictInitial.value = selected.value;
  conflictGitOutput.value = "";
  conflictOpen.value = true;
}
async function openEditor() {
  await fileLocation('open_editor', selected.value);
}

async function chooseRepository(path?: string) {
  fileMenu.value?.hidePopover();
  repositoryMenu.value?.hidePopover();
  workspaceMode.value = 'git';
  if (path && snapshot.value && normalized(path) === normalized(repo.value)) return;
  try {
    await w.openRepo(path);
  } catch (e) {
    error.value = String(e);
  }
}
function reorder(index: number, delta: number) {
  const destination = index + delta;
  if (destination < 0 || destination >= rebaseCommits.value.length) return;
  const list = [...rebaseCommits.value];
  [list[index], list[destination]] = [list[destination]!, list[index]!];
  rebaseCommits.value = list;
}
function keydown(event: KeyboardEvent) {
  if (event.ctrlKey && event.key === "o") {
    event.preventDefault();
    void chooseRepository();
  }
  if (event.ctrlKey && event.key === "r") {
    event.preventDefault();
    void w.refresh(true);
  }
  if (event.key === "Escape") {
    dialog.value = "";
    output.value = "";
    menu.value = false;
  }
}
const preventBrowserMenu = (event: Event) => event.preventDefault();
onMounted(() => {
  try {
    const savedTabs = localStorage.getItem('gitgoblin.chatTabs');
    hadSavedTabs = savedTabs !== null;
    chatTabs.value = restoreChatTabs(JSON.parse(savedTabs || 'null'));
    const saved = JSON.parse(localStorage.getItem('gitgoblin.seenChatResponses') || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved))
      seenResponses.value = Object.fromEntries(Object.entries(saved).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  } catch { /* Invalid saved tabs do not prevent startup. */ }

  window.addEventListener("keydown", keydown);
  document.addEventListener('contextmenu', preventBrowserMenu, true);
  window.addEventListener('resize', updateSidebarViewport);
  updateSidebarViewport();
  workspaceObserver = new ResizeObserver(([entry]) => {
    if (entry) workspaceSize.value = { width: entry.contentRect.width, height: entry.contentRect.height };
  });
  if (workspace.value) workspaceObserver.observe(workspace.value);
  try {
    workspaceMode.value = localStorage.getItem('gitgoblin.workspaceMode') === 'chat' ? 'chat' : 'git';
    const saved = localStorage.getItem('gitgoblin.sidebarWidth');
    if (saved !== null) preferredSidebarWidth.value = clampSidebarWidth(Number(saved), Number.POSITIVE_INFINITY);
  } catch { /* Use the default width when storage is unavailable. */ }
});
onUnmounted(() => {
  window.removeEventListener("keydown", keydown);
  document.removeEventListener('contextmenu', preventBrowserMenu, true);
  window.removeEventListener('resize', updateSidebarViewport);
  workspaceObserver?.disconnect();
});
</script>
<template>
  <div class="app-shell" :class="{ 'resizing-sidebar': resizingSidebar }" :style="{ '--sidebar': `${sidebarWidth}px`, '--files-width': filesWidth === undefined ? undefined : `${filesWidth}px`, '--details-height': detailsHeight === undefined ? undefined : `${detailsHeight}px` }">
    <header class="titlebar" data-tauri-drag-region="deep">
      <div class="brand">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M4 7l7 3 5-5 5 5 7-3-2 15-10 6L6 22z" fill="currentColor" />
          <path
            d="M10 15l4 2-4 2m12-4l-4 2 4 2"
            fill="none"
            stroke="#101114"
            stroke-width="2"
          /></svg
        ><span>gitgoblin</span>
        <nav class="workspace-modes" aria-label="Workspace mode">
          <button :aria-pressed="!chatVisible" @click="workspaceMode = 'git'"><GitBranch :size="16" />Git</button>
          <button :aria-pressed="chatVisible" @click="workspaceMode = 'chat'">
            <MessageSquare :size="16" />Chat
            <span v-if="!chatVisible && (chatNeedsAttention || Object.values(chatIndicators).some(state => state.attention || state.unread))" class="mode-attention" role="status" aria-label="Chat needs your attention" title="Chat needs your attention"><AlertTriangle :size="13" /></span>
            <span v-else-if="!chatVisible && allActiveAgents.length" class="mode-running" role="status" :aria-label="`${allActiveAgents.length} agent tasks running`" :title="`${allActiveAgents.length} agent tasks running`"><LoaderCircle :size="13" class="spin" /></span>
          </button>
        </nav>
        <nav class="application-menu" aria-label="Application menu">
          <button aria-haspopup="true" @click="toggleTopMenu(fileMenu, $event)">File<ChevronDown :size="11" /></button>
        </nav>
      </div>
      <div id="file-menu" ref="fileMenu" popover class="file-menu" data-tauri-drag-region="false" aria-label="File actions">
        <button :disabled="busy" @click="chooseRepository()"><FolderOpen :size="15" />Open repository…<kbd>Ctrl O</kbd></button>
        <button v-if="!desktop()" @click="fileMenu?.hidePopover(); w.showExample()"><Layers :size="15" />Explore example workspace</button>
      </div>
      <nav v-if="!chatVisible && favorites.length" class="favorite-tabs" aria-label="Favorite repositories">
        <button v-for="path in favorites" :key="path" aria-haspopup="menu" @contextmenu="repositoryContext($event, path)" @keydown.shift.f10.prevent="repositoryContext($event, path)" @keydown.context-menu.prevent="repositoryContext($event, path)" :disabled="busy" :title="path" :aria-current="normalized(path) === normalized(snapshot?.repositoryRoot || repo) ? 'page' : undefined" @click="chooseRepository(path)">
          <Star :size="12" fill="currentColor" /><span>{{ w.repositoryName(path) }}</span>
        </button>
      </nav>
      <div v-show="!chatVisible" class="titlebar-context">
        <template v-if="!chatVisible">
        <button class="repository-switch" popovertarget="repository-menu" aria-label="Switch repository" :disabled="busy" :title="repo || 'Switch repository'">
          <FolderGit2 :size="15" /><strong>{{ snapshot ? repoName : 'Repositories' }}</strong><ChevronDown :size="12" />
        </button>
        <template v-if="snapshot"><span class="context-divider">/</span><GitBranch :size="13" /><span :title="snapshot.branch">{{ snapshot.branch }}</span></template>
        </template>
      </div>
      <ChatTabs v-show="chatVisible" ref="chatNavigation" :ids="chatTabs.ids" :selected="selectedThreadId" :threads="threads" :projects="projects"
        :activity="chatIndicators" :repository-name="w.repositoryName" :actions="chatActions" :disabled="(busy && !w.repositoryLoading.value) || example"
        @error="error = $event"
        @select="selectChat" @close="closeChat" @move="(id, target) => chatTabs = moveChatTab(chatTabs, id, target)" @new="openNewConversation" />
      <div id="repository-menu" ref="repositoryMenu" popover class="repository-menu" data-tauri-drag-region="false" aria-label="Repositories">
        <div class="repository-menu-heading">Recent repositories</div>
        <div v-for="path in [...new Set([...favorites, ...recent])]" :key="path" class="repository-menu-row" @contextmenu="repositoryContext($event, path)">
          <button aria-haspopup="menu" @keydown.shift.f10.prevent="repositoryContext($event, path)" @keydown.context-menu.prevent="repositoryContext($event, path)" :disabled="busy" :title="path" :aria-current="normalized(path) === normalized(snapshot?.repositoryRoot || repo) ? 'true' : undefined" @click="chooseRepository(path)">
            <FolderGit2 :size="16" /><span><strong>{{ w.repositoryName(path) }}</strong><small>{{ path }}</small></span><Check v-if="normalized(path) === normalized(snapshot?.repositoryRoot || repo)" :size="14" />
          </button>
          <button class="icon-button" :aria-label="`Rename ${w.repositoryName(path)}`" title="Rename repository" @click="startRepositoryRename(path)"><Pencil :size="14" /></button>
          <button class="favorite-toggle icon-button" :class="{ favorited: w.isFavorite(path) }" :disabled="w.favoriteSaving.value" :aria-label="`${w.isFavorite(path) ? 'Unfavorite' : 'Favorite'} ${path}`" :aria-pressed="w.isFavorite(path)" @click="w.toggleFavorite(path)"><Star :size="15" :fill="w.isFavorite(path) ? 'currentColor' : 'none'" /></button>
          <button class="icon-button" :disabled="busy || w.favoriteSaving.value" :aria-label="`Remove ${w.repositoryName(path)} from GitGoblin`" title="Remove from GitGoblin (keeps folder on disk)" @click="w.removeRepository(path)"><X :size="14" /></button>
        </div>
        <p v-if="!recent.length && !favorites.length" class="nav-hint">Opened repositories will appear here.</p>
      </div>
          <div v-if="snapshot && !chatVisible" class="toolbar-actions" aria-label="Git actions">
            <button
              title="Fetch remote changes"
              :disabled="busy || example"
              @click="ask('fetch')"
            >
              <ArrowDownToLine :size="15" /><span>Fetch</span></button
            ><button title="Pull changes" :disabled="busy || example" @click="ask('pull')">
              <ArrowDownToLine :size="15" /><span>Pull</span></button
            ><button title="Push branch" :disabled="busy || example" @click="ask('push')">
              <ArrowUpFromLine :size="15" /><span>Push</span></button
            ><span class="toolbar-divider" /><button
              title="Stash changes"
              :disabled="busy || example"
              @click="ask('stash-save')"
            >
              <Archive :size="15" /><span>Stash</span></button
            ><button
              title="Refresh (Ctrl R)"
              :disabled="busy"
              @click="w.refresh(true)"
            >
              <RefreshCw :size="15" :class="{ spin: busy }" />
            </button>
            <div class="menu-anchor">
              <button title="More Git operations" @click="menu = !menu">
                <MoreHorizontal :size="18" />
              </button>
              <div v-if="menu" class="dropdown">
                <button
                  v-for="action in [
                    'branch-create',
                    'branch-delete',
                    'merge',
                    'rebase',
                    'cherry-pick',
                    'revert',
                    'reset',
                    'tag-create',
                    'tag-delete',
                    'stash-save',
                    'stash-drop',
                    'remote-add',
                    'remote-remove',
                  ]"
                  :key="action"
                  :disabled="example"
                  @click="
                    ask(
                      action,
                      selectedCommit ? { target: selectedCommit.id } : {},
                    )
                  "
                >
                  {{ definitions[action]!.title }}
                </button>
              </div>
            </div>
          </div>
      <WindowControls v-if="desktop()" @error="error = $event" />
    </header>
    <div class="workspace-banners">
      <div v-if="example" class="example-banner">
        <span>EXAMPLE WORKSPACE</span>Preview data · Git actions are
        disabled<button
          @click="
            repo = '';
            snapshot = undefined;
            example = false;
          "
        >
          Exit preview<X :size="12" />
        </button>
      </div>
      <div v-if="snapshot?.operation" class="operation-banner">
        <GitMerge :size="16" /><strong
          >{{ snapshot.operation }} in progress</strong
        ><span>Resolve conflicts or amend, then continue.</span
        ><button
          class="small"
          @click="ask('abort', { mode: snapshot.operation })"
        >
          Abort</button
        ><button
          class="primary small"
          @click="conflictOpen = true"
        >
          {{ snapshot.files.some(file => file.conflict) ? 'Resolve conflicts' : 'Continue' }}
        </button>
      </div>
      <div v-if="error" class="error-banner" role="alert">
        <AlertTriangle :size="15" /><span>{{ error }}</span
        ><button
          class="icon-button"
          aria-label="Dismiss error"
          @click="error = ''"
        >
          <X :size="14" />
        </button>
      </div>
    </div>
    <aside id="repository-sidebar" class="sidebar" :class="{ 'chat-mode': chatVisible }">
      <div class="sidebar-resize" role="separator" tabindex="0" aria-label="Resize sidebar" aria-orientation="vertical" aria-controls="repository-sidebar"
        :aria-valuenow="sidebarWidth" :aria-valuemin="minSidebarWidth" :aria-valuemax="maxSidebarWidth(sidebarRoom)"
        title="Drag to resize; double-click to reset. Arrow keys also resize."
        @pointerdown="startSidebarResize" @pointermove="moveSidebarResize" @pointerup="stopSidebarResize" @pointercancel="stopSidebarResize" @lostpointercapture="stopSidebarResize" @keydown="sidebarResizeKey" @dblclick="resetSidebarWidth" />
      <div v-if="chatVisible && selectedChatWorktree" class="sidebar-heading">
        <div class="chat-worktree-label" :title="selectedChatWorktree">
          <FolderGit2 :size="12" />
          <span>Worktree · {{ selectedChatWorktree.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) }}</span>
        </div>
      </div>
      <div v-show="!chatVisible" class="repository-picker">
        <FolderGit2 :size="19" />
        <div>
          <strong>{{ snapshot ? repoName : "Your repositories" }}</strong
          ><span>{{
            snapshot ? "Local repository" : "Choose a workspace"
          }}</span>
        </div>
      </div>
      <div v-show="!chatVisible" ref="sidebarScroll" class="sidebar-scroll">
        <template v-if="snapshot">
          <nav v-show="!chatVisible" class="main-nav">
            <button
              :class="{ active: view === 'changes' }"
              :aria-current="view === 'changes' ? 'page' : undefined"
              @click="view = 'changes'; mode = 'working'"
            >
              <Layers :size="16" />Local changes<span class="count">{{
                snapshot.files.length
              }}</span></button
            ><button
              :class="{ active: view === 'history' }"
              :aria-current="view === 'history' ? 'page' : undefined"
              @click="view = 'history'"
            >
              <History :size="16" />All commits</button
            ><button
              :class="{ active: view === 'reflog' }"
              :aria-current="view === 'reflog' ? 'page' : undefined"
              @click="view = 'reflog'"
            >
              <GitCommitHorizontal :size="16" />Reflog & recovery
            </button>
          </nav>
          <div v-show="!chatVisible" class="nav-section">
            <button
              class="section-heading"
              @click="sections.branches = !sections.branches"
            >
              <ChevronDown v-if="sections.branches" :size="12" /><ChevronRight
                v-else
                :size="12"
              />BRANCHES<span>{{ localBranches.length }}</span></button
            ><template v-if="sections.branches"
              ><BranchTree :key="repo" :nodes="localBranchTree" @context="branchMenu" @select="switchBranch" />
              <button class="tree-row subdued" @click="ask('branch-create')">
                <Plus :size="13" />New branch
              </button></template
            >
          </div>
          <div v-show="!chatVisible" class="nav-section">
            <button
              class="section-heading"
              @click="sections.worktrees = !sections.worktrees"
            >
              <ChevronDown v-if="sections.worktrees" :size="12" /><ChevronRight
                v-else
                :size="12"
              />WORKTREES<span>{{ snapshot.worktrees.length }}</span></button
            ><template v-if="sections.worktrees"
              ><button
                v-for="tree in snapshot.worktrees"
                :key="tree.path"
                class="tree-row worktree-row"
                :title="tree.path"
                :class="{ 'current-worktree': normalized(tree.path) === normalized(repo) }"
                :aria-current="normalized(tree.path) === normalized(repo) ? 'true' : undefined"
                aria-haspopup="menu" @contextmenu="worktreeMenu($event, tree.path)" @keydown.shift.f10.prevent="worktreeMenu($event, tree.path)"
                @click="!example && normalized(tree.path) !== normalized(repo) && w.openRepo(tree.path)"
              >
                <FolderGit2 :size="14" /><span class="worktree-name"><strong>{{ tree.path.replaceAll('\\', '/').split('/').filter(Boolean).at(-1) }}</strong><small>{{ normalized(tree.path) === normalized(snapshot.repositoryRoot || snapshot.worktrees[0]?.path || '') ? 'Main · ' : '' }}{{ tree.branch || 'Detached HEAD' }}</small></span><span
                  v-if="normalized(tree.path) === normalized(repo)"
                  class="tiny-label"
                  >Current</span
                ></button
              ><button v-show="!chatVisible" class="tree-row subdued" @click="ask('worktree-add')">
                <Plus :size="13" />New worktree
              </button></template
            >
          </div>
          <div v-show="!chatVisible" class="nav-section compact">
            <button
              class="section-heading"
              @click="sections.remotes = !sections.remotes"
            >
              <ChevronRight v-if="!sections.remotes" :size="12" /><ChevronDown
                v-else
                :size="12"
              /><Globe :size="13" />REMOTES</button
            ><template v-if="sections.remotes"
              ><BranchTree :key="repo" :nodes="remoteBranchTree" @context="branchMenu" @select="switchBranch" />
              <button class="tree-row subdued" @click="ask('remote-add')">
                <Plus :size="13" />Add remote
              </button></template
            ><button
              class="section-heading"
              @click="sections.tags = !sections.tags"
            >
              <ChevronRight v-if="!sections.tags" :size="12" /><ChevronDown
                v-else
                :size="12"
              /><Tag :size="13" />TAGS<span>{{ tags.length }}</span></button
            ><template v-if="sections.tags"
              ><button
                v-for="tag in tags"
                :key="tag.name"
                aria-haspopup="menu" @contextmenu="tagMenu($event, tag)" @keydown.shift.f10.prevent="tagMenu($event, tag)"
                class="tree-row"
                @click="
                  ask('tag-delete', {
                    target: tag.name.replace('refs/tags/', ''),
                  })
                "
              >
                <Tag :size="13" /><span>{{
                  tag.name.replace("refs/tags/", "")
                }}</span></button
              ><button class="tree-row subdued" @click="ask('tag-create')">
                <Plus :size="13" />New tag
              </button></template
            ><button
              class="section-heading"
              @click="sections.stashes = !sections.stashes"
            >
              <ChevronRight v-if="!sections.stashes" :size="12" /><ChevronDown
                v-else
                :size="12"
              /><Archive :size="13" />STASHES</button
            ><template v-if="sections.stashes"
              ><button
                v-for="stash in snapshot.stashes
                  .trim()
                  .split('\n')
                  .filter(Boolean)"
                :key="stash"
                aria-haspopup="menu" @contextmenu="stashMenu($event, stash)" @keydown.shift.f10.prevent="stashMenu($event, stash)"
                class="tree-row"
                @click="ask('stash-apply', { target: stash.split('\t')[0]! })"
              >
                <Archive :size="13" /><span>{{
                  stash.split("\t")[1] || stash
                }}</span>
              </button></template
            >
          </div>
        </template>
        <template v-else-if="!chatVisible"
          ><p class="section-heading">RECENT REPOSITORIES</p>
          <button
            v-for="path in recent"
            :key="path"
            class="tree-row"
            :title="path" aria-haspopup="menu" @contextmenu="repositoryContext($event, path)" @keydown.shift.f10.prevent="repositoryContext($event, path)" @keydown.context-menu.prevent="repositoryContext($event, path)"
            @click="w.openRepo(path)"
          >
            <FolderGit2 :size="15" /><span>{{
              w.repositoryName(path)
            }}</span>
          </button>
          <p v-if="!recent.length" class="nav-hint">
            Your repositories will appear here.
          </p></template
        >
      </div>
      <ChatPanel
        :visible="chatVisible"
        v-show="chatVisible"
        ref="chat"
        :context="context"
        :example="example"
        :repo="repo"
        :selected-thread-id="selectedThreadId"
        :open-thread-ids="chatTabs.ids"
        :worktrees="snapshot?.worktrees || []"
        @activity="chatActivityStates = $event"
        @clear-context="context = ''"
        @select-worktree="openThreadWorktree"
        @threads="receiveThreads"
        @selection="receiveChatSelection"
        @attention="chatNeedsAttention = $event"
      />
      <div v-show="!chatVisible" class="sidebar-footer">
        <div>
          <span class="status-dot" :class="{ live: t3Connected }" /><span>{{
            t3Connected ? "T3 Code connected" : "Local workspace"
          }}</span
          ><span class="version">v{{ appVersion }}</span>
        </div>
      </div>
    </aside>
    <main ref="workspace" class="workspace" aria-label="Git workspace">
      <template v-if="snapshot">
        <template v-if="view === 'changes'">
          <div v-if="!chatVisible" class="changes-title">
            <div>
              <h1>Local changes</h1>
              <p>
                {{
                  snapshot.files.length
                    ? `${snapshot.files.length} files changed in your working directory`
                    : "Your working directory is clean"
                }}
              </p>
            </div>
            <span class="branch-pill"
              ><GitBranch :size="13" />{{ snapshot.branch }}</span
            >
          </div>
          <div class="review-grid">
            <section id="changed-files" class="files-panel">
              <ResizeHandle v-model="preferredFilesWidth" label="Resize changed files" controls="changed-files" storage-key="gitgoblin.filesWidth" :min="180" :max="maxFilesWidth" />
              <div class="files-toolbar">
                <span class="subtle">Changed files</span>
                <button class="icon-button file-view-toggle" :aria-label="filesAsTree ? 'Show files as a list' : 'Show files as a tree'" :title="filesAsTree ? 'Show files as a list' : 'Show files as a tree'" :aria-pressed="filesAsTree" @click="filesAsTree = !filesAsTree">
                  <ListTree v-if="filesAsTree" :size="16" /><List v-else :size="16" />
                </button>
              </div>
              <div v-if="mode === 'branch'" class="base-picker">
                <span>Compare to</span
                ><select v-model="base" aria-label="Base branch">
                  <option
                    v-for="branch in localBranches"
                    :key="branch.name"
                    :value="branch.name.replace('refs/heads/', '')"
                  >
                    {{ branch.name.replace("refs/heads/", "") }}
                  </option>
                </select>
              </div>
              <div v-for="group in fileGroups" :key="group.mode" class="file-group">
                <div class="file-list-label">{{ group.label }}<span>{{ group.files.length }}</span><button v-if="group.mode !== 'branch'" class="stage-all" :disabled="busy || example || !group.files.length || group.files.some(file => file.conflict)" :title="group.files.some(file => file.conflict) ? 'Resolve conflicting files first' : undefined" @click="toggleFileStage(null, group.mode)">{{ group.mode === 'staged' ? 'Unstage all' : 'Stage all' }}</button></div>
                <div class="file-list">
                <FileList :key="repo" :files="group.files" :tree="filesAsTree" :selected="mode === group.mode ? selected : ''" :mode="group.mode" :editable="!busy && !example && group.mode !== 'branch'" :native-actions="desktop() && !example" @open-editor="fileLocation('open_editor', $event)" @reveal="fileLocation('reveal_path', $event)" @copy-full-path="fileLocation('full_path', $event)" @error="error = $event" @select="selectFile($event, group.mode)" @discard="confirmDiscard" @toggle-selection="toggleSelectedFiles($event, group.mode)" @toggle-stage="toggleFileStage($event, group.mode)" @toggle-folder="toggleFileStage($event, group.mode, true)" />
                <div v-if="!group.files.length" class="small-empty">
                  <Check :size="23" />
                  <p>
                    {{
                      group.mode === "staged"
                        ? "No staged changes"
                        : "Nothing to review here"
                    }}
                  </p>
                </div>
              </div>
              </div>
              <form v-show="!chatVisible && mode !== 'branch'" class="commit-form" aria-label="Commit staged changes" @submit.prevent="commit">
                <label for="commit-message">Commit message</label>
                <textarea id="commit-message" v-model="commitMessage" :disabled="busy || example" rows="4" placeholder="Summary&#10;&#10;Description (optional)" @keydown.ctrl.enter.prevent="commit" @keydown.meta.enter.prevent="commit" />
                <div class="commit-form-actions">
                  <button type="button" class="text-button" :disabled="busy || example || !snapshot.head" @click="amendCommit">Amend last commit…</button>
                  <button type="submit" class="primary" :disabled="!canCommit" title="Commit staged changes (Ctrl+Enter)"><GitCommitHorizontal :size="14" />Commit staged</button>
                </div>
              </form>
            </section>
            <section class="review-panel" :aria-busy="w.repositoryLoading.value || diffLoading">
              <div v-if="w.repositoryLoading.value" class="panel-empty" role="status"><LoaderCircle :size="24" class="spin" /><p>Loading worktree changes...</p></div>
              <template v-else-if="selected"
                ><div class="file-heading">
                  <FileCode2 :size="15" /><span :title="selected">{{
                    selected
                  }}</span
                  ><span class="diff-stat green">+{{ additions }}</span
                  ><span class="diff-stat red">−{{ deletions }}</span
                  ><button
                    v-if="mode !== 'branch' && !selectedFile?.conflict"
                    class="secondary small"
                    :disabled="busy || diffLoading || example || !diff.fingerprint"
                    @click="stage"
                  >
                    {{
                      mode === "staged" ? "Unstage file" : "Stage file"
                    }}</button
                  ><button
                    v-if="selectedFile?.conflict"
                    class="primary small"
                    @click="openConflict"
                  >
                    Resolve conflict
                  </button>
                </div>
                <div class="file-tools">
                  <span>File changes</span>
                  <div>
                    <button
                      class="text-button"
                      @click="showFileInfo('history')"
                    >
                      File history</button
                    ><button class="text-button" @click="showFileInfo('blame')">
                      Blame</button
                    ><button
                      class="icon-button"
                      title="Open in VS Code"
                      :disabled="example"
                      @click="openEditor"
                    >
                      <ExternalLink :size="13" />
                    </button>
                  </div>
                </div>
                <DiffViewer
                  :text="diff.text"
                  :path="selected"
                  :loading="diffLoading"
                  :disabled="busy"
                  v-model:whole-file="wholeFile"
                  :mode="mode"
                  :editable="
                    !example &&
                    mode !== 'branch' &&
                    !selectedFile?.conflict
                  "
                  @patch="patch"
                  @context="addContext"
                  @edit-context="editContext"
              /></template>
              <div v-else class="panel-empty clean-state">
                <div class="empty-orbit"><Check :size="25" /></div>
                <h3>
                  {{
                    mode === "staged"
                      ? "Build your next commit"
                      : "All caught up"
                  }}
                </h3>
                <p>
                  {{
                    mode === "staged"
                      ? "Select changes and stage the parts that belong together."
                      : "Changes appear here as you and your agents work."
                  }}
                </p>
              </div>
            </section>
          </div>
        </template>
        <template v-else-if="view === 'history'"
          ><div class="changes-title">
            <div>
              <h1>All commits</h1>
            </div>
            <form class="search-field" @submit.prevent="w.searchHistory()">
              <Search :size="15" /><input
                v-model="search"
                placeholder="Search commit messages…"
                aria-label="Search commits"
              />
            </form>
          </div>
          <HistoryList :commits="commits" :selected="selectedCommit?.id" :loading="w.historyLoading.value" :has-more="w.historyHasMore.value" @select="w.selectCommit" @context="commitMenu" @load-more="w.loadHistory()" />
          <div id="commit-details" class="commit-detail">
            <ResizeHandle v-model="preferredDetailsHeight" label="Resize commit details" controls="commit-details" storage-key="gitgoblin.detailsHeight" :min="170" :max="maxDetailsHeight" horizontal reverse />
            <div class="detail-tabs" role="tablist" aria-label="Commit details">
              <button v-for="tab in ['commit', 'changes']" :key="tab" role="tab" :aria-selected="historyTab === tab" :class="{ active: historyTab === tab }" @click="historyTab = tab">{{ tab === 'commit' ? 'Commit' : 'Changes' }}</button>
            </div>
            <template v-if="selectedCommit">
            <div class="panel-heading">
              <span
                ><GitCommitHorizontal :size="15" />{{
                  selectedCommit.subject
                }}</span
              >
              <div class="button-row">
                <button
                  class="small"
                  :disabled="example"
                  @click="ask('cherry-pick', { target: selectedCommit.id })"
                >
                  Cherry-pick</button
                ><button
                  class="small"
                  :disabled="example"
                  @click="ask('revert', { target: selectedCommit.id })"
                >
                  Revert</button
                ><button
                  class="small"
                  :disabled="example"
                  @click="ask('reset', { target: selectedCommit.id })"
                >
                  Reset to here
                </button>
              </div>
            </div>
            <div v-if="historyTab === 'commit'" class="commit-metadata">
              <div class="commit-identity"><span class="author-avatar">{{ selectedCommit.author.slice(0, 2).toUpperCase() }}</span><div><small>AUTHOR</small><strong>{{ selectedCommit.author }}</strong><span>{{ selectedCommit.date }}</span></div></div>
              <dl><dt>SHA</dt><dd><code>{{ selectedCommit.id }}</code></dd><dt>Parents</dt><dd><code>{{ selectedCommit.parents || 'Initial commit' }}</code></dd><dt v-if="selectedCommit.refs">Refs</dt><dd v-if="selectedCommit.refs">{{ selectedCommit.refs }}</dd></dl>
              <p>{{ selectedCommit.subject }}</p>
            </div>
            <DiffViewer
              v-else
              :text="historyDiff"
              mode="history"
              @context="addContext"
              @edit-context="editContext"
            />
            </template>
            <div v-else class="panel-empty"><GitCommitHorizontal :size="24" /><p>Select a commit to inspect its details and changes.</p></div>
          </div></template>
        <template v-else
          ><div class="changes-title">
            <div>
              <h1>Reflog & recovery</h1>
              <p>
                Recover a previous state by creating a branch at its commit.
              </p>
            </div>
          </div>
          <div class="reflog-list">
            <button
              v-for="line in reflog.trim().split('\n').filter(Boolean)"
              :key="line"
              @click="ask('branch-create', { target: line.split('\t')[0]! })"
            >
              <GitCommitHorizontal :size="16" /><code>{{
                line.split("\t")[0]?.slice(0, 8)
              }}</code
              ><span>{{ line.split("\t").slice(1).join(" · ") }}</span
              ><span class="text-button"
                >Recover branch<ArrowUpRight :size="13"
              /></span>
            </button></div
        ></template>
      </template>
      <div v-else class="welcome">
        <div class="welcome-mark"><GitBranch :size="38" /></div>
        <span class="eyebrow">A CLEARER VIEW OF YOUR WORK</span>
        <h1>Make yourself at home.</h1>
        <p>
          Your branches, changes, and agent conversations.<br />One focused
          workspace, built around your code.
        </p>
        <p>Choose <strong>File → Open repository</strong> to get started.<br /><kbd>Ctrl O</kbd></p>
        <div class="welcome-features">
          <span><GitCommitHorizontal :size="16" />Thoughtful commits</span
          ><span><Layers :size="16" />Parallel worktrees</span
          ><span><MessageSquare :size="16" />Shared conversations</span>
        </div>
      </div>
      <div v-if="busy || notice" class="workspace-status" role="status">
        <LoaderCircle v-if="busy" :size="14" class="spin" />
        <Check v-else :size="14" />
        <span>{{ notice || 'Working…' }}</span>
        <button v-if="notice && !busy" class="icon-button" aria-label="Dismiss status message" @click="notice = ''"><X :size="14" /></button>
      </div>
    </main>
    <ContextMenu ref="sidebarMenu" @error="error = $event" />
    <Teleport to="body">
      <CloseChatDialog v-if="closingChat" :thread="closingChat" :connected="t3Connected && !example" :confirm="confirmCloseChat" @close="closingChat = undefined" />
      <div v-if="renamePath" class="modal-backdrop" @click.self="!w.nameSaving.value && (renamePath = '')" @keydown.esc="!w.nameSaving.value && (renamePath = '')">
        <form class="modal" role="dialog" aria-modal="true" aria-labelledby="rename-repository-title" @submit.prevent="saveRepositoryName">
          <div class="modal-heading"><h2 id="rename-repository-title">Rename repository</h2><button type="button" class="icon-button" aria-label="Close rename dialog" :disabled="w.nameSaving.value" @click="renamePath = ''"><X :size="18" /></button></div>
          <p>{{ renamePath }}</p>
          <label>Display name<input ref="renameInput" v-model="renameName" :disabled="w.nameSaving.value" :placeholder="renamePath.replaceAll('\\', '/').split('/').at(-1)" /></label>
          <p>Leave empty to use the folder name.</p>
          <div class="modal-footer"><button type="button" :disabled="w.nameSaving.value" @click="renamePath = ''">Cancel</button><button type="submit" class="primary" :disabled="w.nameSaving.value">Save</button></div>
        </form>
      </div>
      <div
        v-if="dialog"
        class="modal-backdrop"
        @click.self="!busy && (dialog = '')"
      >
        <section
          class="modal"
          :class="{ 'modal-wide': rebaseCommits.length }"
          role="dialog"
          aria-modal="true"
          aria-labelledby="action-title"
        >
          <div class="modal-heading">
            <h2 id="action-title">{{ dialogTitle }}</h2>
            <button
              class="icon-button"
              aria-label="Close"
              :disabled="busy"
              @click="dialog = ''"
            >
              <X :size="18" />
            </button>
          </div>
          <p>{{ dialogDescription }}</p>
          <div v-if="activeAgents.length" class="agent-warning">
            <AlertTriangle :size="17" />
            <div>
              <strong
                >{{ activeAgents.length }} agent task(s) may be editing this
                worktree.</strong
              >
              <p>{{ activeAgents.map((t) => t.title).join(", ") }}</p>
              <button class="small" @click="stopAgents">
                Stop tasks first
              </button>
            </div>
          </div>
          <form @submit.prevent="executeDialog">
            <label v-for="field in fields" :key="field.key"
              >{{ field.label
              }}<select v-if="field.options" v-model="values[field.key]">
                <option v-for="option in field.options" :key="option">
                  {{ option }}
                </option></select
              ><textarea v-else-if="(dialog === 'commit' || dialog === 'amend') && field.key === 'text'" v-model="values[field.key]" rows="5" required aria-label="Commit message" />
              <input
                v-else
                v-model="values[field.key]"
                :disabled="!!rebaseCommits.length"
                required
            /></label>
            <label v-if="dialog === 'branch-delete'" class="force-option">
              <input v-model="values.mode" type="checkbox" true-value="force" false-value="" :disabled="busy" />
              Force delete even if the branch is not merged
            </label>
            <label v-if="dialog === 'push'" class="force-option">
              <input v-model="values.mode" type="checkbox" true-value="force" false-value="" :disabled="busy" />
              Force push (with lease)
            </label>
            <p v-if="dialog === 'push' && values.mode === 'force'" class="nav-hint">
              Replaces remote history. Refused if the remote branch changed since your last fetch.
            </p>
            <div v-if="rebaseCommits.length" class="rebase-list">
              <div v-for="(commit, i) in rebaseCommits" :key="commit.id">
                <select
                  v-model="commit.action"
                  :aria-label="`Action for ${commit.subject}`"
                >
                  <option value="pick">Pick</option>
                  <option value="edit">Edit / reword</option>
                  <option value="squash" :disabled="i === 0">Squash</option>
                  <option value="fixup" :disabled="i === 0">Fixup</option>
                  <option value="drop">Drop</option></select
                ><code>{{ commit.id.slice(0, 7) }}</code
                ><span>{{ commit.subject }}</span
                ><button
                  type="button"
                  class="icon-button"
                  aria-label="Move earlier"
                  :disabled="i === 0"
                  @click="reorder(i, -1)"
                >
                  <ArrowUp :size="14" /></button
                ><button
                  type="button"
                  class="icon-button"
                  aria-label="Move later"
                  :disabled="i === rebaseCommits.length - 1"
                  @click="reorder(i, 1)"
                >
                  <ArrowDown :size="14" />
                </button>
              </div>
            </div>
            <div v-if="dialogError" class="inline-error">{{ dialogError }}</div>
            <div class="modal-footer">
              <button type="button" :disabled="busy" @click="dialog = ''">
                Cancel</button
              ><button
                type="submit"
                class="primary"
                :class="{
                  danger: dialog === 'discard-files' || dialog === 'branch-delete' || dialog === 'push' && values.mode === 'force' || dialog === 'reset' && values.mode === 'hard',
                }"
                :disabled="busy || example"
              >
                {{
                  busy
                    ? "Working…"
                    : dialog === "rebase" && !rebaseCommits.length
                      ? "Load commits"
                      : activeAgents.length
                        ? "Proceed while agents are active"
                        : dialog === 'push' && values.mode === 'force' ? 'Force push' : dialogTitle
                }}
              </button>
            </div>
          </form>
        </section>
      </div>
      <div v-if="output" class="modal-backdrop" @click.self="output = ''">
        <section
          class="modal modal-wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="output-title"
        >
          <div class="modal-heading">
            <h2 id="output-title">{{ outputTitle }}</h2>
            <button class="icon-button" aria-label="Close" @click="output = ''">
              <X :size="18" />
            </button>
          </div>
          <pre class="output-content">{{ output }}</pre>
        </section>
      </div>
      <ConflictResolver v-if="conflictOpen && snapshot" :key="repo" :snapshot="snapshot" :initial-path="conflictInitial" :git-output="conflictGitOutput" :read="w.read" :mutate="w.mutate" @close="conflictOpen = false" />
    </Teleport>
  </div>
</template>
