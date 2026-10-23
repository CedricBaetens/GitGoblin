<script setup lang="ts">
import {
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from "reka-ui";
import { version as appVersion } from "../package.json";
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
import {
  chatHistory,
  closeChatTab,
  moveChatTab,
  openChatTab,
  restoreChatTabs,
} from "~/lib/chat-tabs";
import { isThreadRunning, visibleThreads } from "~/lib/threads";
import { desktop, invoke } from "~/lib/native";
import {
  clampSidebarWidth,
  defaultSidebarWidth,
  maxSidebarWidth,
  minSidebarWidth,
  sidebarKeyboardWidth,
} from "~/lib/sidebar";
import type {
  Commit,
  T3Thread,
  T3Project,
  GitRequest,
  GitRef,
} from "~/lib/types";
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
const maxFilesWidth = computed(() =>
  Math.max(180, Math.min(520, workspaceSize.value.width - 280)),
);
const filesWidth = computed(() =>
  preferredFilesWidth.value === undefined
    ? undefined
    : Math.max(180, Math.min(maxFilesWidth.value, preferredFilesWidth.value)),
);
const maxDetailsHeight = computed(() =>
  Math.max(170, workspaceSize.value.height - 250),
);
const detailsHeight = computed(() =>
  preferredDetailsHeight.value === undefined
    ? undefined
    : Math.max(
        170,
        Math.min(maxDetailsHeight.value, preferredDetailsHeight.value),
      ),
);
const resizingSidebar = ref(false);
const sidebarRoom = sidebarViewport;
const sidebarWidth = computed(() =>
  clampSidebarWidth(preferredSidebarWidth.value, sidebarRoom.value),
);
let sidebarPointer: number | undefined,
  sidebarStartX = 0,
  sidebarStartWidth = 0;
function updateSidebarViewport() {
  sidebarViewport.value = window.innerWidth;
}
function saveSidebarWidth() {
  try {
    localStorage.setItem(
      "gitgoblin.sidebarWidth",
      String(preferredSidebarWidth.value),
    );
  } catch {
    /* Resizing remains available without storage. */
  }
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
    preferredSidebarWidth.value = clampSidebarWidth(
      sidebarStartWidth + event.clientX - sidebarStartX,
      sidebarRoom.value,
    );
}
function stopSidebarResize(event: PointerEvent) {
  if (event.pointerId !== sidebarPointer) return;
  sidebarPointer = undefined;
  resizingSidebar.value = false;
  saveSidebarWidth();
  const handle = event.currentTarget as HTMLElement;
  if (handle.hasPointerCapture(event.pointerId))
    handle.releasePointerCapture(event.pointerId);
}
function sidebarResizeKey(event: KeyboardEvent) {
  const width = sidebarKeyboardWidth(
    event.key,
    sidebarWidth.value,
    sidebarRoom.value,
    event.shiftKey,
  );
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
const repositoryMenuOpen = ref(false);
const renamePath = ref(""),
  renameName = ref("");
const renameInput = ref<HTMLInputElement>();
async function startRepositoryRename(path: string) {
  repositoryMenuOpen.value = false;
  renamePath.value = path;
  renameName.value = w.repositoryAlias(path);
  await nextTick();
  renameInput.value?.focus();
  renameInput.value?.select();
}
async function saveRepositoryName() {
  if (await w.renameRepository(renamePath.value, renameName.value))
    renamePath.value = "";
}
import type {
  ContextMenuHandle,
  ContextMenuItem as SidebarItem,
} from "~/lib/context-menu";
const sidebarMenu = ref<ContextMenuHandle>();
const copyItem = (label: string, text: string): SidebarItem => ({
  label,
  run: () => navigator.clipboard.writeText(text),
});
function actionItem(
  label: string,
  action: string,
  preset: Record<string, string> = {},
  disabled = false,
): SidebarItem {
  return {
    label,
    disabled: disabled || busy.value || example.value,
    run: () => ask(action, preset),
  };
}
async function switchBranch(branch: GitRef) {
  if (branch.current || busy.value || example.value) return;
  try {
    await w.mutate("switch", {
      target: branch.name.replace("refs/heads/", ""),
    });
  } catch {
    /* The workbench displays Git's error, including local-change protection. */
  }
}
function filterBranch(branch: GitRef, filter: "only" | "exclude") {
  view.value = "history";
  const active = w.historyBranch.value;
  w.filterHistory(
    active?.name === branch.name && active.mode === filter ? undefined : branch.name,
    filter,
  );
}
function branchMenu(event: MouseEvent | KeyboardEvent, branch: GitRef) {
  const local = branch.name.startsWith("refs/heads/");
  const target = local ? branch.name.replace("refs/heads/", "") : branch.name;
  const items = [
    {
      label: "Switch to branch",
      disabled: branch.current || busy.value || example.value,
      run: () => switchBranch(branch),
    },
    ...(local
      ? [
          {
            label: "Compare with working tree",
            disabled: busy.value || example.value,
            run: () => {
              base.value = target;
              mode.value = "branch";
              view.value = "changes";
            },
          },
        ]
      : []),
    {
      ...actionItem(
        "Merge into current branch…",
        "merge",
        { target },
        branch.current,
      ),
      separatorBefore: true,
    },
    actionItem(
      "Rebase current branch onto this…",
      "rebase-onto",
      { target },
      branch.current,
    ),
    {
      ...actionItem("Create branch here…", "branch-create", { target }),
      separatorBefore: true,
    },
    ...(local
      ? [
          {
            ...actionItem(
              "Delete branch…",
              "branch-delete",
              { target },
              branch.current,
            ),
            danger: true,
          },
        ]
      : []),
    {
      ...copyItem(
        "Copy branch name",
        branch.name.replace(/^refs\/(heads|remotes)\//, ""),
      ),
      separatorBefore: true,
    },
    copyItem("Copy commit hash", branch.id),
  ];
  sidebarMenu.value?.open(event, items);
}
function worktreeMenu(event: MouseEvent | KeyboardEvent, path: string) {
  const main =
    normalized(path) ===
    normalized(
      snapshot.value?.repositoryRoot ||
        snapshot.value?.worktrees[0]?.path ||
        "",
    );
  const current = normalized(path) === normalized(repo.value);
  const active = threads.value.some(
    (thread) =>
      thread.activeRunId &&
      normalized(
        thread.worktreePath ||
          projects.value.find((project) => project.id === thread.projectId)
            ?.workspaceRoot ||
          "",
      ) === normalized(path),
  );
  const reason = main
    ? "The main worktree cannot be removed."
    : current
      ? "Switch to another worktree first."
      : active
        ? "Stop the agent using this worktree first."
        : undefined;
  sidebarMenu.value?.open(event, [
    {
      label: "Open worktree",
      disabled: busy.value || example.value || current,
      run: () => w.openRepo(path),
    },
    {
      label: "Reveal in Explorer",
      disabled: !desktop() || example.value,
      run: () => fileLocation("reveal_path", "", path),
    },
    { ...actionItem("New worktree…", "worktree-add"), separatorBefore: true },
    {
      ...actionItem("Remove worktree…", "worktree-remove", { path }, !!reason),
      danger: true,
      disabledReason: reason,
    },
    { ...copyItem("Copy worktree path", path), separatorBefore: true },
  ]);
}

function tagMenu(event: MouseEvent | KeyboardEvent, tag: GitRef) {
  const name = tag.name.replace("refs/tags/", "");
  sidebarMenu.value?.open(event, [
    actionItem("Create branch here…", "branch-create", { target: tag.name }),
    {
      ...actionItem("Delete tag…", "tag-delete", { target: name }),
      separatorBefore: true,
      danger: true,
    },
    { ...copyItem("Copy tag name", name), separatorBefore: true },
    copyItem("Copy commit hash", tag.id),
  ]);
}
function stashMenu(event: MouseEvent | KeyboardEvent, stash: string) {
  const target = stash.split("\t")[0]!;
  sidebarMenu.value?.open(event, [
    actionItem("Apply stash…", "stash-apply", { target }),
    {
      ...actionItem("Drop stash…", "stash-drop", { target }),
      separatorBefore: true,
      danger: true,
    },
    { ...copyItem("Copy stash reference", target), separatorBefore: true },
  ]);
}
function commitMenu(event: MouseEvent | KeyboardEvent, commit: Commit) {
  sidebarMenu.value?.open(event, [
    {
      label: "View commit",
      run: () => {
        view.value = "history";
        historyTab.value = "commit";
        return w.selectCommit(commit);
      },
    },
    {
      ...actionItem("Create branch here…", "branch-create", {
        target: commit.id,
      }),
      separatorBefore: true,
    },
    actionItem("Cherry-pick commit…", "cherry-pick", { target: commit.id }),
    actionItem("Revert commit…", "revert", { target: commit.id }),
    {
      ...actionItem("Reset current branch to here…", "reset", {
        target: commit.id,
      }),
      separatorBefore: true,
      danger: true,
    },
    { ...copyItem("Copy commit hash", commit.id), separatorBefore: true },
    {
      label: "Copy commit message",
      run: async () =>
        navigator.clipboard.writeText(
          example.value
            ? commit.subject
            : await w.read<string>("commit-message", { target: commit.id }),
        ),
    },
  ]);
}
function repositoryContext(event: MouseEvent | KeyboardEvent, path: string) {
  sidebarMenu.value?.open(event, [
    {
      label: "Open repository",
      disabled: busy.value,
      run: () => chooseRepository(path),
    },
    {
      label: "Rename repository…",
      separatorBefore: true,
      disabled: w.nameSaving.value,
      run: () => startRepositoryRename(path),
    },
    {
      label: w.isFavorite(path)
        ? "Unfavorite repository"
        : "Favorite repository",
      disabled: w.favoriteSaving.value,
      run: () => w.toggleFavorite(path),
    },
    {
      label: "Reveal in Explorer",
      separatorBefore: true,
      disabled: !desktop(),
      run: () => fileLocation("reveal_path", "", path),
    },
    { ...copyItem("Copy repository path", path), separatorBefore: true },
    {
      label: "Remove from GitGoblin",
      separatorBefore: true,
      disabled: busy.value || w.favoriteSaving.value,
      run: () => w.removeRepository(path),
    },
  ]);
}
async function fileLocation(
  action: "open_editor" | "reveal_path" | "full_path",
  path: string,
  root = repo.value,
) {
  try {
    const result = await invoke<string>(action, { repo: root, path });
    if (action === "full_path") await navigator.clipboard.writeText(result);
  } catch (e) {
    error.value = String(e);
  }
}
watch([repo, busy, example], () => sidebarMenu.value?.close());
const workspaceMode = ref<"git" | "chat">("git");
const chatVisible = computed({
  get: () => workspaceMode.value === "chat",
  set: (visible: boolean) => {
    workspaceMode.value = visible ? "chat" : "git";
  },
});
const sidebarScroll = ref<HTMLElement>();
const sidebarPositions = { git: 0, chat: 0 };
watch(workspaceMode, (mode) => {
  menu.value = false;
  sidebarMenu.value?.close();
  repositoryMenuOpen.value = false;
  try {
    localStorage.setItem("gitgoblin.workspaceMode", mode);
  } catch {
    /* Modes work without storage. */
  }
});
watch(workspaceMode, async (mode, previous) => {
  if (sidebarScroll.value)
    sidebarPositions[previous] = sidebarScroll.value.scrollTop;
  await nextTick();
  if (sidebarScroll.value)
    sidebarScroll.value.scrollTop = sidebarPositions[mode];
});
const chatNeedsAttention = ref(false);
const context = ref(""),
  chat = ref<{
    settle: (id: string) => Promise<void>;
    newConversation: (trigger?: HTMLButtonElement) => void;
    stopAll: () => Promise<void>;
    focusComposer: () => void;
  }>(),
  menu = ref(false);
const commitMessages = ref<Record<string, string>>({});
const commitMessage = computed({
  get: () => commitMessages.value[normalized(repo.value)] || "",
  set: (message: string) => {
    commitMessages.value[normalized(repo.value)] = message;
  },
});
const canCommit = computed(
  () =>
    !busy.value &&
    !example.value &&
    !!staged.value.length &&
    !!commitMessage.value.trim() &&
    !snapshot.value?.files.some((file) => file.conflict),
);
async function openNewConversation(event: MouseEvent) {
  const trigger = event.currentTarget as HTMLButtonElement;
  chatVisible.value = true;
  await nextTick();
  chat.value?.newConversation(trigger);
}
const threads = ref<T3Thread[]>([]),
  projects = ref<T3Project[]>([]),
  t3Connected = ref(false);
const chatTabs = ref(restoreChatTabs(null));
const selectedThreadId = computed(() => chatTabs.value.selected);
const chatNavigation = ref<{
  openAll: (openOnly?: boolean) => void;
  closePicker: () => void;
}>();
const chatActivityStates = ref<
  Record<string, { attention: boolean; response: string }>
>({});
const seenResponses = ref<Record<string, string>>({});
let tabsInitialized = false;
let hadSavedTabs = false;
const chatIndicators = computed(() =>
  Object.fromEntries(
    Object.entries(chatActivityStates.value).map(([id, activity]) => [
      id,
      {
        attention: activity.attention,
        unread:
          !!activity.response && seenResponses.value[id] !== activity.response,
        completed: !!activity.response,
      },
    ]),
  ),
);
function persistChatTabs() {
  try {
    localStorage.setItem("gitgoblin.chatTabs", JSON.stringify(chatTabs.value));
    localStorage.setItem(
      "gitgoblin.seenChatResponses",
      JSON.stringify(seenResponses.value),
    );
  } catch {
    /* Tabs remain usable without storage. */
  }
}
watch(chatTabs, persistChatTabs, { deep: true });
watch(selectedThreadId, () => {
  context.value = "";
});
watch([selectedThreadId, chatVisible, chatActivityStates], () => {
  const id = selectedThreadId.value,
    activity = chatActivityStates.value[id];
  if (
    chatVisible.value &&
    activity?.response &&
    seenResponses.value[id] !== activity.response
  ) {
    seenResponses.value[id] = activity.response;
    persistChatTabs();
  }
});
function selectChat(id: string) {
  if (busy.value && !w.repositoryLoading.value) return;
  chatNavigation.value?.closePicker();
  chatVisible.value = true;
  if (selectedThreadId.value === id) {
    const thread = threads.value.find((thread) => thread.id === id);
    const path =
      thread?.worktreePath ||
      projects.value.find((project) => project.id === thread?.projectId)
        ?.workspaceRoot;
    if (path && normalized(path) !== normalized(repo.value))
      void openThreadWorktree(path, id);
  }
  chatTabs.value = openChatTab(chatTabs.value, id);
}
function receiveChatSelection(id: string) {
  if (id) chatTabs.value = openChatTab(chatTabs.value, id);
}
const closingChat = ref<T3Thread>();
function closeChat(id: string) {
  if (busy.value || closingChat.value || !chatTabs.value.ids.includes(id))
    return;
  chatNavigation.value?.closePicker();
  closingChat.value = threads.value.find((thread) => thread.id === id);
}
async function confirmCloseChat(settle: boolean) {
  const thread = closingChat.value;
  if (!thread) return;
  if (settle) {
    if (!t3Connected.value || !chat.value)
      throw new Error(
        "Reconnect T3 Code to settle this conversation, or turn off settling to close only the tab.",
      );
    await chat.value.settle(thread.id);
  }
  chatTabs.value = closeChatTab(chatTabs.value, thread.id);
}
function chatActions(thread: T3Thread): SidebarItem[] {
  return [
    {
      label: "Open conversation",
      disabled: busy.value || example.value,
      run: () => selectChat(thread.id),
    },
    {
      label: "Close tab",
      disabled: busy.value || !chatTabs.value.ids.includes(thread.id),
      run: () => closeChat(thread.id),
    },
    {
      label: "Settle conversation",
      separatorBefore: true,
      disabled:
        !t3Connected.value ||
        example.value ||
        thread.settledOverride === "settled" ||
        !!thread.archivedAt,
      run: () => chat.value?.settle(thread.id),
    },
    {
      ...copyItem("Copy conversation title", thread.title),
      separatorBefore: true,
    },
    copyItem("Copy conversation ID", thread.id),
  ];
}
const normalized = (value: string) =>
  value.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
const repoName = computed(() =>
  w.repositoryName(snapshot.value?.repositoryRoot || repo.value),
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
const localBranchTree = computed(() =>
  branchTree(localBranches.value, "refs/heads/"),
);
const remoteBranchTree = computed(() =>
  branchTree(remoteBranches.value, "refs/remotes/"),
);
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
const allActiveAgents = computed(() =>
  threads.value.filter(
    (thread) => !thread.deletedAt && isThreadRunning(thread),
  ),
);
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
const fileGroups = computed(() =>
  mode.value === "branch"
    ? [{ mode: "branch", label: "Branch changes", files: currentFiles.value }]
    : [
        { mode: "working", label: "Unstaged", files: working.value },
        { mode: "staged", label: "Staged", files: staged.value },
      ],
);
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
const discardFiles = ref<NonNullable<GitRequest["files"]>>([]);
const discardRepo = ref("");
async function confirmDiscard(paths: string[]) {
  if (busy.value || example.value || !paths.length) return;
  const root = repo.value;
  try {
    const files = await w.read<NonNullable<GitRequest["files"]>>(
      "discard-plan",
      { files: paths.map((path) => ({ path })) },
    );
    if (root !== repo.value) return;
    discardFiles.value = files;
    discardRepo.value = root;
    ask("discard-files");
    dialogDescription.value = `Permanently discard unstaged changes in ${files.length} file${files.length === 1 ? "" : "s"}? Staged changes are kept. New untracked files are deleted. This cannot be undone.`;
  } catch (e) {
    error.value = String(e);
  }
}
const conflictOpen = ref(false);
const conflictInitial = ref("");
const conflictGitOutput = ref("");
const definitions: Record<
  string,
  {
    title: string;
    description: string;
    fields?: { key: string; label: string; options?: string[] }[];
    defaults?: Record<string, string>;
  }
> = {
  "discard-files": { title: "Discard changes", description: "" },
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
    description:
      "Replay your current branch’s commits onto the selected branch. Commit or stash local changes first. This rewrites commit IDs; conflicts can be resolved in GitGoblin.",
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
    description:
      "Remove this worktree folder and its Git registration. The branch and its commits are kept. Git refuses dirty or locked worktrees. Ignored files inside the folder will also be deleted.",
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
    description: "Publish commits to the configured upstream.",
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
    if (
      dialog.value === "worktree-remove" &&
      threads.value.some(
        (thread) =>
          thread.activeRunId &&
          normalized(
            thread.worktreePath ||
              projects.value.find((project) => project.id === thread.projectId)
                ?.workspaceRoot ||
              "",
          ) === normalized(values.value.path || ""),
      )
    ) {
      throw new Error("Stop the agent using this worktree before removing it.");
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
    if (dialog.value === "discard-files") {
      if (repo.value !== discardRepo.value)
        throw new Error(
          "The repository changed. Close this dialog and try again.",
        );
      params.files = discardFiles.value;
    }
    if (dialog.value === "rebase")
      params.text = rebaseCommits.value
        .map((c) => `${c.action} ${c.id}`)
        .join("\n");
    const action = dialog.value;
    const root = normalized(repo.value);
    await w.mutate(action, params);
    if (action === "commit") commitMessages.value[root] = "";
    dialog.value = "";
  } catch (e) {
    if (snapshot.value?.files.some((file) => file.conflict)) {
      dialog.value = "";
      error.value = "";
      conflictInitial.value = "";
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
async function toggleFileStage(
  path: string | null,
  group: string,
  folder = false,
) {
  if (busy.value || example.value || !["working", "staged"].includes(group))
    return;
  const files = (group === "staged" ? staged.value : working.value).filter(
    (file) =>
      path === null ||
      (folder ? file.path.startsWith(`${path}/`) : file.path === path),
  );
  if (files.some((file) => file.conflict)) {
    error.value = "Resolve conflicting files before staging these changes.";
    return;
  }
  try {
    await w.stageFiles(
      files.map((file) => file.path),
      group,
    );
  } catch (e) {
    error.value = String(e);
  }
}
async function toggleSelectedFiles(paths: string[], group: string) {
  if (busy.value || example.value || !["working", "staged"].includes(group))
    return;
  const files = (group === "staged" ? staged.value : working.value).filter(
    (file) => paths.includes(file.path),
  );
  if (files.some((file) => file.conflict)) {
    error.value = "Resolve conflicting files before staging these changes.";
    return;
  }
  try {
    await w.stageFiles(
      files.map((file) => file.path),
      group,
    );
  } catch (e) {
    error.value = String(e);
  }
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
  if (activeAgents.value.length) {
    ask("commit", { text: commitMessage.value });
    return;
  }
  const root = normalized(repo.value);
  const text = commitMessage.value;
  try {
    await w.mutate("commit", { text });
    if (commitMessages.value[root] === text) commitMessages.value[root] = "";
  } catch {
    /* Keep the message for retry; the workbench displays Git's error. */
  }
}
async function amendCommit() {
  if (busy.value || example.value || !snapshot.value?.head) return;
  const root = repo.value;
  try {
    const text = await w.read<string>("commit-message", { target: "HEAD" });
    if (root === repo.value) ask("amend", { text });
  } catch (e) {
    error.value = String(e);
  }
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
    const thread = ts.find((thread) => thread.id === id);
    if (
      thread?.deletedAt ||
      (!thread && (restoring || previous.some((thread) => thread.id === id)))
    )
      chatTabs.value = closeChatTab(chatTabs.value, id);
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
  if (normalized(path) !== normalized(repo.value) || w.repositoryLoading.value)
    await w.openRepo(path);
  if (
    normalized(path) !== normalized(repo.value) ||
    selectedThreadId.value !== threadId
  )
    return;
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
  await fileLocation("open_editor", selected.value);
}

async function chooseRepository(path?: string) {
  repositoryMenuOpen.value = false;
  workspaceMode.value = "git";
  if (path && snapshot.value && normalized(path) === normalized(repo.value))
    return;
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
    const savedTabs = localStorage.getItem("gitgoblin.chatTabs");
    hadSavedTabs = savedTabs !== null;
    chatTabs.value = restoreChatTabs(JSON.parse(savedTabs || "null"));
    const saved = JSON.parse(
      localStorage.getItem("gitgoblin.seenChatResponses") || "{}",
    );
    if (saved && typeof saved === "object" && !Array.isArray(saved))
      seenResponses.value = Object.fromEntries(
        Object.entries(saved).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
  } catch {
    /* Invalid saved tabs do not prevent startup. */
  }

  window.addEventListener("keydown", keydown);
  document.addEventListener("contextmenu", preventBrowserMenu, true);
  window.addEventListener("resize", updateSidebarViewport);
  updateSidebarViewport();
  workspaceObserver = new ResizeObserver(([entry]) => {
    if (entry)
      workspaceSize.value = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
  });
  if (workspace.value) workspaceObserver.observe(workspace.value);
  try {
    workspaceMode.value =
      localStorage.getItem("gitgoblin.workspaceMode") === "chat"
        ? "chat"
        : "git";
    const saved = localStorage.getItem("gitgoblin.sidebarWidth");
    if (saved !== null)
      preferredSidebarWidth.value = clampSidebarWidth(
        Number(saved),
        Number.POSITIVE_INFINITY,
      );
  } catch {
    /* Use the default width when storage is unavailable. */
  }
});
onUnmounted(() => {
  window.removeEventListener("keydown", keydown);
  document.removeEventListener("contextmenu", preventBrowserMenu, true);
  window.removeEventListener("resize", updateSidebarViewport);
  workspaceObserver?.disconnect();
});
</script>
<template>
  <div
    class="app-shell grid grid-cols-[var(--sidebar)_minmax(0,_1fr)] grid-rows-[var(--titlebar-height)_auto_minmax(0,_1fr)] h-[100dvh] overflow-hidden [&_.badge]:text-[9px] [&_.badge]:bg-[#242831] [&_.badge]:text-[#a1a8ba] [&_.badge]:py-[3px] [&_.badge]:px-[5px] [&_.badge]:rounded-[4px] [&_.graph-line.last]:bottom-[50%] [--pane-heading-height:68px] [&.resizing-sidebar]:cursor-col-resize! [&.resizing-sidebar]:select-none! [&.resizing-sidebar_*]:cursor-col-resize! [&.resizing-sidebar_*]:select-none!"
    :class="[{ 'resizing-sidebar': resizingSidebar }]"
    :style="{
      '--sidebar': `${sidebarWidth}px`,
      '--files-width': filesWidth === undefined ? undefined : `${filesWidth}px`,
      '--details-height':
        detailsHeight === undefined ? undefined : `${detailsHeight}px`,
    }"
  >
    <PopoverRoot v-model:open="repositoryMenuOpen"
      ><header
        class="titlebar col-span-full flex items-center gap-0 p-0 border-b-[1px] border-solid border-b-[var(--line)] bg-[#14161b] select-none min-w-0 [&>.toolbar-actions]:shrink-0 [&>.toolbar-actions]:pr-[8px] [&_.toolbar-actions>button]:h-[32px] [&_.toolbar-actions>.menu-anchor>button]:h-[32px] [&>.icon-button]:shrink-0 [&>.icon-button]:mr-[8px]"
        data-tauri-drag-region="deep"
      >
        <div
          class="brand flex items-center gap-[9px] w-auto min-w-[var(--sidebar)] h-full pt-0 pr-[12px] pb-0 pl-[16px] border-r-[1px] border-solid border-r-[var(--line)] shrink-0 text-[13px] tracking-[-0.3px] font-[650] [&>svg]:w-[21px] [&>svg]:h-[21px] [&>svg]:text-[#b1bef7] [&_.workspace-modes]:mt-0 [&_.workspace-modes]:mr-0 [&_.workspace-modes]:mb-0 [&_.workspace-modes]:ml-[8px] [&_.workspace-modes]:tracking-[normal] [&_.workspace-modes]:font-normal"
        >
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path
              d="M4 7l7 3 5-5 5 5 7-3-2 15-10 6L6 22z"
              fill="currentColor"
            />
            <path
              d="M10 15l4 2-4 2m12-4l-4 2 4 2"
              fill="none"
              stroke="#101114"
              stroke-width="2"
            /></svg
          ><span>gitgoblin</span>
          <nav
            class="workspace-modes flex gap-[4px] h-[36px] flex-[0_0_164px] mt-0 mr-0 mb-0 ml-[12px] p-[3px] bg-[#101218] border-[1px] border-solid border-[var(--line)] rounded-[9px] [&>button]:flex-1 [&>button]:justify-center [&>button]:gap-[7px] [&>button]:py-0 [&>button]:px-[7px] [&>button]:text-[#96a3ba] [&>button]:rounded-[6px] [&>button]:text-[12px] [&>button[aria-pressed='true']]:text-[#e3e9ff] [&>button[aria-pressed='true']]:bg-[#2a3348] [&>button[aria-pressed='true']]:shadow-[inset_0_0_0_1px_#465579] [&_.mode-attention]:text-[#e9bc75] [&_.mode-attention]:flex [&_.mode-running]:text-[#a2d5b5] [&_.mode-running]:flex"
            aria-label="Workspace mode"
          >
            <AppButton
              :aria-pressed="!chatVisible"
              @click="workspaceMode = 'git'"
            >
              <GitBranch :size="16" />Git
            </AppButton>
            <AppButton
              :aria-pressed="chatVisible"
              @click="workspaceMode = 'chat'"
            >
              <MessageSquare :size="16" />Chat
              <span
                v-if="
                  !chatVisible &&
                  (chatNeedsAttention ||
                    Object.values(chatIndicators).some(
                      (state) => state.attention || state.unread,
                    ))
                "
                class="mode-attention"
                role="status"
                aria-label="Chat needs your attention"
                title="Chat needs your attention"
                ><AlertTriangle :size="13"
              /></span>
              <span
                v-else-if="!chatVisible && allActiveAgents.length"
                class="mode-running"
                role="status"
                :aria-label="`${allActiveAgents.length} agent tasks running`"
                :title="`${allActiveAgents.length} agent tasks running`"
                ><LoaderCircle :size="13" class="spin animate-spin"
              /></span>
            </AppButton>
          </nav>
        </div>
        <nav
          v-if="!chatVisible && favorites.length"
          class="favorite-tabs flex items-center gap-[4px] min-w-0 max-w-[35%] ml-[12px] overflow-x-auto [scrollbar-width:thin] [&_button]:shrink-0 [&_button]:h-[32px] [&_button]:max-w-[160px] [&_button]:py-0 [&_button]:px-[10px] [&_button]:rounded-[5px] [&_button]:text-[11px] [&_button]:text-[#9ba5bb] [&_button_span]:overflow-hidden [&_button_span]:text-ellipsis [&_button_span]:whitespace-nowrap [&_button_svg]:shrink-0 [&_button_svg]:text-[#d6be80] [&_button[aria-current]]:text-[#e0e6f4] [&_button[aria-current]]:bg-[#252a37] [&_button[aria-current]]:[border-color:#465579]"
          aria-label="Favorite repositories"
        >
          <AppButton
            v-for="path in favorites"
            :key="path"
            aria-haspopup="menu"
            @contextmenu="repositoryContext($event, path)"
            @keydown.shift.f10.prevent="repositoryContext($event, path)"
            @keydown.context-menu.prevent="repositoryContext($event, path)"
            :disabled="busy"
            :title="path"
            :aria-current="
              normalized(path) === normalized(snapshot?.repositoryRoot || repo)
                ? 'page'
                : undefined
            "
            @click="chooseRepository(path)"
          >
            <Star :size="12" fill="currentColor" /><span>{{
              w.repositoryName(path)
            }}</span>
          </AppButton>
        </nav>
        <div
          v-show="!chatVisible"
          class="titlebar-context flex items-center gap-[8px] flex-1 min-w-0 h-full py-0 px-[12px] text-[11px] text-[#81899b] whitespace-nowrap [&_strong]:text-[#c5cbd8] [&_strong]:font-medium [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&>span:last-child]:overflow-hidden [&>span:last-child]:text-ellipsis"
        >
          <template v-if="!chatVisible">
            <PopoverTrigger as-child
              ><AppButton
                class="repository-switch min-w-0 max-w-[55%] h-[32px] py-0 px-[8px] text-[#c5cbd8] [&>strong]:text-[11px]"
                aria-label="Switch repository"
                :disabled="busy"
                :title="repo || 'Switch repository'"
              >
                <FolderGit2 :size="15" /><strong>{{
                  snapshot ? repoName : "Repositories"
                }}</strong
                ><ChevronDown :size="12" /></AppButton
            ></PopoverTrigger>
            <template v-if="snapshot"
              ><span class="context-divider text-[#484e5c]">/</span
              ><GitBranch :size="13" /><span :title="snapshot.branch">{{
                snapshot.branch
              }}</span></template
            >
          </template>
        </div>
        <ChatTabs
          v-show="chatVisible"
          ref="chatNavigation"
          :ids="chatTabs.ids"
          :selected="selectedThreadId"
          :threads="threads"
          :projects="projects"
          :activity="chatIndicators"
          :repository-name="w.repositoryName"
          :actions="chatActions"
          :disabled="(busy && !w.repositoryLoading.value) || example"
          @error="error = $event"
          @select="selectChat"
          @close="closeChat"
          @move="(id, target) => (chatTabs = moveChatTab(chatTabs, id, target))"
          @new="openNewConversation"
        />
        <PopoverPortal
          ><PopoverContent
            id="repository-menu"
            class="repository-menu z-[120] w-[360px] max-w-[calc(100vw-16px)] max-h-[min(500px,var(--reka-popover-content-available-height))] overflow-auto rounded-[8px] border border-ui-border bg-ui-menu p-[6px] text-ui-muted shadow-xl [&_strong]:text-[12px] [&_strong]:font-medium [&_strong]:text-ui-text [&_small]:text-[10px] [&_small]:text-ui-muted [&_strong]:truncate [&_small]:truncate [&_kbd]:ml-auto [&_>button]:flex [&_>button]:w-full [&_>button]:justify-start [&_>button]:gap-[8px] [&_>button]:px-[10px] [&_>button]:py-[9px]"
            data-tauri-drag-region="false"
            aria-label="Repositories"
            align="start"
            :side-offset="6"
            :collision-padding="8"
            :aria-describedby="undefined"
          >
            <AppButton :disabled="busy" @click="chooseRepository()">
              <FolderOpen :size="15" /><span>Open repository&#8230;</span
              ><kbd
                class="[:where(&)]:font-['Cascadia_Code',_'JetBrains_Mono',_Consolas,_monospace] [:where(&)]:text-[10px] [:where(&)]:text-[#777d8a] [:where(&)]:font-normal [:where(&)]:whitespace-nowrap"
                >Ctrl O</kbd
              >
            </AppButton>
            <AppButton
              v-if="!desktop()"
              @click="
                repositoryMenuOpen = false;
                w.showExample();
              "
            >
              <Layers :size="15" />Explore example workspace
            </AppButton>
            <div
              class="repository-menu-heading py-[9px] px-[10px] text-[10px] text-[#7e8ba4]"
            >
              Recent repositories
            </div>
            <div
              v-for="path in [...new Set([...favorites, ...recent])]"
              :key="path"
              class="repository-menu-row [&>button:first-child]:w-full [&>button:first-child]:justify-start [&>button:first-child]:text-left [&>button:first-child]:py-[9px] [&>button:first-child]:px-[10px] [&>button:first-child>span]:flex-1 [&>button:first-child>span]:min-w-0 [&>button:first-child>span]:flex [&>button:first-child>span]:flex-col [&>button:first-child>span]:gap-[4px] [&>button[aria-current]]:bg-[#262e40] flex items-center gap-[4px] [&>button:first-child]:flex-1 [&>button:first-child]:min-w-0"
              @contextmenu="repositoryContext($event, path)"
            >
              <AppButton
                aria-haspopup="menu"
                @keydown.shift.f10.prevent="repositoryContext($event, path)"
                @keydown.context-menu.prevent="repositoryContext($event, path)"
                :disabled="busy"
                :title="path"
                :aria-current="
                  normalized(path) ===
                  normalized(snapshot?.repositoryRoot || repo)
                    ? 'true'
                    : undefined
                "
                @click="chooseRepository(path)"
              >
                <FolderGit2 :size="16" /><span
                  ><strong>{{ w.repositoryName(path) }}</strong
                  ><small class="[:where(&)]:text-[11px]">{{
                    path
                  }}</small></span
                ><Check
                  v-if="
                    normalized(path) ===
                    normalized(snapshot?.repositoryRoot || repo)
                  "
                  :size="14"
                />
              </AppButton>
              <AppButton
                size="icon"
                class="icon-button"
                :aria-label="`Rename ${w.repositoryName(path)}`"
                title="Rename repository"
                @click="startRepositoryRename(path)"
              >
                <Pencil :size="14" />
              </AppButton>
              <AppButton
                size="icon"
                class="favorite-toggle icon-button shrink-0 [&.favorited]:text-[#e7ce8d]"
                :class="[[{ favorited: w.isFavorite(path) }]]"
                :disabled="w.favoriteSaving.value"
                :aria-label="`${w.isFavorite(path) ? 'Unfavorite' : 'Favorite'} ${path}`"
                :aria-pressed="w.isFavorite(path)"
                @click="w.toggleFavorite(path)"
              >
                <Star
                  :size="15"
                  :fill="w.isFavorite(path) ? 'currentColor' : 'none'"
                />
              </AppButton>
              <AppButton
                size="icon"
                class="icon-button"
                :disabled="busy || w.favoriteSaving.value"
                :aria-label="`Remove ${w.repositoryName(path)} from GitGoblin`"
                title="Remove from GitGoblin (keeps folder on disk)"
                @click="w.removeRepository(path)"
              >
                <X :size="14" />
              </AppButton>
            </div>
            <AppHint
              v-if="!recent.length && !favorites.length"
              class="nav-hint"
            >
              Opened repositories will appear here.
            </AppHint>
          </PopoverContent></PopoverPortal
        >
        <div
          v-if="snapshot && !chatVisible"
          class="toolbar-actions flex items-center gap-[3px] [&>button]:text-[11px] [&>button]:text-[#9aa3b7] [&>button]:py-[5px] [&>button]:px-[8px] [@media(max-width:1400px)]:[&>button>span]:hidden"
          aria-label="Git actions"
        >
          <AppButton
            title="Fetch remote changes"
            :disabled="busy || example"
            @click="ask('fetch')"
          >
            <ArrowDownToLine :size="15" /><span>Fetch</span></AppButton
          ><AppButton
            title="Pull changes"
            :disabled="busy || example"
            @click="ask('pull')"
          >
            <ArrowDownToLine :size="15" /><span>Pull</span></AppButton
          ><AppButton
            title="Push branch"
            :disabled="busy || example"
            @click="ask('push')"
          >
            <ArrowUpFromLine :size="15" /><span>Push</span></AppButton
          ><span
            class="toolbar-divider h-[17px] w-[1px] bg-[var(--line)] my-0 mx-[5px]"
          /><AppButton
            title="Stash changes"
            :disabled="busy || example"
            @click="ask('stash-save')"
          >
            <Archive :size="15" /><span>Stash</span></AppButton
          ><AppButton
            title="Refresh (Ctrl R)"
            :disabled="busy"
            @click="w.refresh(true)"
          >
            <RefreshCw :size="15" :class="[{ spin: busy }]" />
          </AppButton>
          <div class="menu-anchor relative">
            <AppButton title="More Git operations" @click="menu = !menu">
              <MoreHorizontal :size="18" />
            </AppButton>
            <div
              v-if="menu"
              class="dropdown absolute z-[20] right-0 top-[35px] w-[200px] max-h-[70vh] overflow-auto bg-[#20242d] border-[1px] border-solid border-[#3b4456] shadow-[0_12px_40px_#0008] rounded-[7px] p-[5px] [&_button]:flex [&_button]:w-full [&_button]:justify-start [&_button]:text-[11px] [&_button]:py-[8px] [&_button]:px-[10px]"
            >
              <AppButton
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
              </AppButton>
            </div>
          </div>
        </div>
        <WindowControls v-if="desktop()" @error="error = $event" /></header
    ></PopoverRoot>
    <div class="workspace-banners col-span-full min-w-0">
      <div
        v-if="example"
        class="example-banner flex items-center gap-[10px] py-[7px] px-[16px] text-[9px] bg-[#242436] text-[#9d9ab7] border-b-[1px] border-solid border-b-[#35334a] [&>span]:text-[8px] [&>span]:tracking-[1px] [&>span]:text-[#b9b2d6] [&_button]:ml-auto [&_button]:text-[9px] [&_button]:py-[2px] [&_button]:px-[4px]"
      >
        <span>EXAMPLE WORKSPACE</span>Preview data · Git actions are
        disabled<AppButton
          @click="
            repo = '';
            snapshot = undefined;
            example = false;
          "
        >
          Exit preview<X :size="12" />
        </AppButton>
      </div>
      <div
        v-if="snapshot?.operation"
        class="operation-banner flex items-center gap-[9px] py-[10px] px-[15px] text-[11px] leading-[1.7] bg-[#2c2a20] text-[#cbb68b] border-b-[1px] border-solid border-b-[#45412c] [&>span]:flex-1 [&>span]:text-[10px]"
      >
        <GitMerge :size="16" /><strong
          >{{ snapshot.operation }} in progress</strong
        ><span>Resolve conflicts or amend, then continue.</span
        ><AppButton
          class="small text-[11px] py-[4px] px-[7px] [border-color:#30343f] rounded-[4px]"
          @click="ask('abort', { mode: snapshot.operation })"
        >
          Abort</AppButton
        ><AppButton
          variant="primary"
          class="primary small [border-color:#30343f] text-[11px] py-[4px] px-[7px] rounded-[4px]"
          @click="conflictOpen = true"
        >
          {{
            snapshot.files.some((file) => file.conflict)
              ? "Resolve conflicts"
              : "Continue"
          }}
        </AppButton>
      </div>
      <div
        v-if="error"
        class="error-banner flex items-center gap-[9px] py-[10px] px-[15px] text-[11px] leading-[1.7] bg-[#38242b] text-[#e9abb4] border-b-[1px] border-solid border-b-[#61323e] [&>span]:flex-1 [&>span]:whitespace-pre-wrap"
        role="alert"
      >
        <AlertTriangle :size="15" /><span>{{ error }}</span
        ><AppButton
          size="icon"
          class="icon-button"
          aria-label="Dismiss error"
          @click="error = ''"
        >
          <X :size="14" />
        </AppButton>
      </div>
    </div>
    <aside
      id="repository-sidebar"
      class="sidebar relative min-w-0 bg-[#14171e] border-r-[1px] border-solid border-r-[var(--line)] flex flex-col min-h-0 [&.chat-mode>.sidebar-scroll]:flex-[0_1_auto] [&.chat-mode>.sidebar-scroll]:max-h-[170px] [&.chat-mode>.sidebar-scroll]:pb-[8px] [&.chat-mode_.nav-section]:my-[4px] [&.chat-mode_.nav-section]:mx-0 [&.chat-mode_.nav-section]:pt-0 [&.chat-mode_.nav-section]:[border-top:0] [&>.chat-panel]:flex-1 [&>.chat-panel]:[border-left:0] [&>.chat-panel]:[border-top:0] [&_.tree-row.current-worktree]:text-[#d8e4ff] [&_.tree-row.current-worktree]:bg-[#202c3f] [&_.current-worktree_.tiny-label]:text-[#c3d2ff] [&_.current-worktree_.tiny-label]:bg-[#354665] [&_.current-worktree_.tiny-label]:py-[2px] [&_.current-worktree_.tiny-label]:px-[5px] [&_.current-worktree_.tiny-label]:rounded-[4px] [&_.worktree-row]:pt-[8px] [&_.worktree-row]:pb-[8px] [&_.worktree-name]:flex [&_.worktree-name]:flex-col [&_.worktree-name]:items-start [&_.worktree-name]:flex-1 [&_.worktree-name]:min-w-0 [&_.worktree-name]:gap-[4px] [&_.worktree-name_strong]:text-[11px] [&_.worktree-name_strong]:font-semibold [&_.worktree-name_strong]:max-w-full [&_.worktree-name_strong]:overflow-hidden [&_.worktree-name_strong]:text-ellipsis [&_.worktree-name_small]:text-[10px] [&_.worktree-name_small]:text-[#96a7c3] [&_.worktree-name_small]:max-w-full [&_.worktree-name_small]:flex-none [&_.worktree-row_.tiny-label]:shrink-0 [&_.nav-section>.section-heading:not(:first-child)]:border-t-[1px] [&_.nav-section>.section-heading:not(:first-child)]:border-solid [&_.nav-section>.section-heading:not(:first-child)]:border-t-[#2c3341] [&_.nav-section>.section-heading:not(:first-child)]:mt-[12px] [&_.nav-section>.section-heading:not(:first-child)]:pt-[12px] [&_.nav-section>.section-heading:not(:first-child)]:rounded-none [&_button:focus-visible]:[outline:2px_solid_#a7b6ff] [&_button:focus-visible]:outline-offset-[-2px] [&_summary:focus-visible]:[outline:2px_solid_#a7b6ff] [&_summary:focus-visible]:outline-offset-[-2px]"
      :class="{ 'chat-mode': chatVisible }"
    >
      <div
        class="sidebar-resize absolute top-0 bottom-0 right-[-4px] w-[8px] z-[30] cursor-col-resize touch-none outline-none [&::after]:[content:''] [&::after]:absolute [&::after]:top-0 [&::after]:bottom-0 [&::after]:left-[3px] [&::after]:w-[2px] [&::after]:bg-[transparent] [&::after]:[transition:background_.12s] [&:hover::after]:bg-[#9baef2] [&:focus-visible::after]:bg-[#9baef2] [.resizing-sidebar_&::after]:bg-[#9baef2]"
        role="separator"
        tabindex="0"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-controls="repository-sidebar"
        :aria-valuenow="sidebarWidth"
        :aria-valuemin="minSidebarWidth"
        :aria-valuemax="maxSidebarWidth(sidebarRoom)"
        title="Drag to resize; double-click to reset. Arrow keys also resize."
        @pointerdown="startSidebarResize"
        @pointermove="moveSidebarResize"
        @pointerup="stopSidebarResize"
        @pointercancel="stopSidebarResize"
        @lostpointercapture="stopSidebarResize"
        @keydown="sidebarResizeKey"
        @dblclick="resetSidebarWidth"
      />
      <div
        v-show="!chatVisible"
        class="repository-picker flex items-center gap-[10px] py-[10px] px-[16px] mb-0 bg-[#1a1f2a] border-b-[1px] border-solid border-b-[var(--line)] text-[#a7b3d6] [&>div]:flex [&>div]:flex-col [&>div]:gap-[4px] [&>div]:flex-1 [&>div]:min-w-0 [&_strong]:text-[#e3e5ed] [&_strong]:text-[14px] [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_span]:text-[#93a0b6] [&_span]:text-[10px] h-[var(--pane-heading-height)] min-h-[var(--pane-heading-height)] shrink-0 [&_strong]:whitespace-nowrap"
      >
        <FolderGit2 :size="19" />
        <div>
          <strong>{{ snapshot ? repoName : "Your repositories" }}</strong
          ><span>{{
            snapshot ? "Local repository" : "Choose a workspace"
          }}</span>
        </div>
      </div>
      <div
        v-show="!chatVisible"
        ref="sidebarScroll"
        class="sidebar-scroll overflow-y-auto flex-1 pt-0 px-[9px] pb-[20px] pt-[8px] [overflow-anchor:none]"
      >
        <template v-if="snapshot">
          <nav
            v-show="!chatVisible"
            class="main-nav flex flex-col gap-[3px] mb-[16px] [&_button]:justify-start [&_button]:py-[9px] [&_button]:px-[10px] [&_button]:text-[#aab5c9] [&_button]:rounded-[5px] [&_button]:text-[12px] [&_button.active]:bg-[#2c3753] [&_button.active]:text-[#eef1ff] [&_button.active]:shadow-[inset_3px_0_#a9baff] [&_button.active]:font-semibold [&_svg]:text-[#7e8597] [&_.active_svg]:text-[#a3b6ff]"
          >
            <AppButton
              class="[.segmented_button&.active]:bg-[#292d38] [.segmented_button&.active]:text-[#d1d8ed] [.segmented_button&.active]:shadow-[0_1px_3px_#0004]"
              :class="[{ active: view === 'changes' }]"
              :aria-current="view === 'changes' ? 'page' : undefined"
              @click="
                view = 'changes';
                mode = 'working';
              "
            >
              <Layers :size="16" />Local changes<span
                class="count ml-auto text-[10px] text-[#afbce7] bg-[#343c53] rounded-[4px] min-w-[19px] py-[2px] px-[5px] text-center"
                >{{ snapshot.files.length }}</span
              ></AppButton
            ><AppButton
              class="[.segmented_button&.active]:bg-[#292d38] [.segmented_button&.active]:text-[#d1d8ed] [.segmented_button&.active]:shadow-[0_1px_3px_#0004]"
              :class="[{ active: view === 'history' }]"
              :aria-current="view === 'history' ? 'page' : undefined"
              @click="view = 'history'"
            >
              <History :size="16" />All commits</AppButton
            ><AppButton
              class="[.segmented_button&.active]:bg-[#292d38] [.segmented_button&.active]:text-[#d1d8ed] [.segmented_button&.active]:shadow-[0_1px_3px_#0004]"
              :class="[{ active: view === 'reflog' }]"
              :aria-current="view === 'reflog' ? 'page' : undefined"
              @click="view = 'reflog'"
            >
              <GitCommitHorizontal :size="16" />Reflog & recovery
            </AppButton>
          </nav>
          <div
            v-show="!chatVisible"
            class="nav-section my-[14px] mx-0 pt-[10px] border-t-[1px] border-solid border-t-[#2c3341]"
          >
            <AppSectionHeading
              class="section-heading"
              @click="sections.branches = !sections.branches"
            >
              <ChevronDown v-if="sections.branches" :size="12" /><ChevronRight
                v-else
                :size="12"
              />BRANCHES<span>{{
                localBranches.length
              }}</span></AppSectionHeading
            ><template v-if="sections.branches"
              ><BranchTree
                :key="repo"
                :nodes="localBranchTree"
                @context="branchMenu"
                :filters-disabled="example"
                :active-filter="w.historyBranch.value"
                @filter="filterBranch"
                @select="switchBranch"
              />
              <AppTreeRow
                class="tree-row subdued min-h-[32px] [&.current]:text-[#e4eaff] [&.current]:bg-[#27334a] [&.current]:shadow-[inset_2px_0_#9eafea]"
                @click="ask('branch-create')"
              >
                <Plus :size="13" />New branch
              </AppTreeRow></template
            >
          </div>
          <div
            v-show="!chatVisible"
            class="nav-section my-[14px] mx-0 pt-[10px] border-t-[1px] border-solid border-t-[#2c3341]"
          >
            <AppSectionHeading
              class="section-heading"
              @click="sections.worktrees = !sections.worktrees"
            >
              <ChevronDown v-if="sections.worktrees" :size="12" /><ChevronRight
                v-else
                :size="12"
              />WORKTREES<span>{{
                snapshot.worktrees.length
              }}</span></AppSectionHeading
            ><template v-if="sections.worktrees"
              ><AppTreeRow
                v-for="tree in snapshot.worktrees"
                :key="tree.path"
                class="tree-row worktree-row min-h-[32px] [&.current]:text-[#e4eaff] [&.current]:bg-[#27334a] [&.current]:shadow-[inset_2px_0_#9eafea]"
                :title="tree.path"
                :class="[
                  [
                    {
                      'current-worktree':
                        normalized(tree.path) === normalized(repo),
                    },
                  ],
                ]"
                :aria-current="
                  normalized(tree.path) === normalized(repo)
                    ? 'true'
                    : undefined
                "
                aria-haspopup="menu"
                @contextmenu="worktreeMenu($event, tree.path)"
                @keydown.shift.f10.prevent="worktreeMenu($event, tree.path)"
                @click="
                  !example &&
                  normalized(tree.path) !== normalized(repo) &&
                  w.openRepo(tree.path)
                "
              >
                <FolderGit2 :size="14" /><span class="worktree-name"
                  ><strong>{{
                    tree.path
                      .replaceAll("\\", "/")
                      .split("/")
                      .filter(Boolean)
                      .at(-1)
                  }}</strong
                  ><small class="[:where(&)]:text-[11px]"
                    >{{
                      normalized(tree.path) ===
                      normalized(
                        snapshot.repositoryRoot ||
                          snapshot.worktrees[0]?.path ||
                          "",
                      )
                        ? "Main · "
                        : ""
                    }}{{ tree.branch || "Detached HEAD" }}</small
                  ></span
                ><span
                  v-if="normalized(tree.path) === normalized(repo)"
                  class="tiny-label ml-auto text-[9px] text-[#6f7890]"
                  >Current</span
                ></AppTreeRow
              ><AppTreeRow
                v-show="!chatVisible"
                class="tree-row subdued min-h-[32px] [&.current]:text-[#e4eaff] [&.current]:bg-[#27334a] [&.current]:shadow-[inset_2px_0_#9eafea]"
                @click="ask('worktree-add')"
              >
                <Plus :size="13" />New worktree
              </AppTreeRow></template
            >
          </div>
          <div
            v-show="!chatVisible"
            class="nav-section compact my-[14px] mx-0 pt-[10px] border-t-[1px] border-solid border-t-[#2c3341] [&_.section-heading]:pt-[13px]"
          >
            <AppSectionHeading
              class="section-heading"
              @click="sections.remotes = !sections.remotes"
            >
              <ChevronRight v-if="!sections.remotes" :size="12" /><ChevronDown
                v-else
                :size="12"
              /><Globe :size="13" />REMOTES</AppSectionHeading
            ><template v-if="sections.remotes"
              ><BranchTree
                :key="repo"
                :nodes="remoteBranchTree"
                @context="branchMenu"
                :filters-disabled="example"
                :active-filter="w.historyBranch.value"
                @filter="filterBranch"
                @select="switchBranch"
              />
              <AppTreeRow
                class="tree-row subdued min-h-[32px] [&.current]:text-[#e4eaff] [&.current]:bg-[#27334a] [&.current]:shadow-[inset_2px_0_#9eafea]"
                @click="ask('remote-add')"
              >
                <Plus :size="13" />Add remote
              </AppTreeRow></template
            ><AppSectionHeading
              class="section-heading"
              @click="sections.tags = !sections.tags"
            >
              <ChevronRight v-if="!sections.tags" :size="12" /><ChevronDown
                v-else
                :size="12"
              /><Tag :size="13" />TAGS<span>{{
                tags.length
              }}</span></AppSectionHeading
            ><template v-if="sections.tags"
              ><AppTreeRow
                v-for="tag in tags"
                :key="tag.name"
                aria-haspopup="menu"
                @contextmenu="tagMenu($event, tag)"
                @keydown.shift.f10.prevent="tagMenu($event, tag)"
                class="tree-row min-h-[32px] [&.current]:text-[#e4eaff] [&.current]:bg-[#27334a] [&.current]:shadow-[inset_2px_0_#9eafea]"
                @click="
                  ask('tag-delete', {
                    target: tag.name.replace('refs/tags/', ''),
                  })
                "
              >
                <Tag :size="13" /><span>{{
                  tag.name.replace("refs/tags/", "")
                }}</span></AppTreeRow
              ><AppTreeRow
                class="tree-row subdued min-h-[32px] [&.current]:text-[#e4eaff] [&.current]:bg-[#27334a] [&.current]:shadow-[inset_2px_0_#9eafea]"
                @click="ask('tag-create')"
              >
                <Plus :size="13" />New tag
              </AppTreeRow></template
            ><AppSectionHeading
              class="section-heading"
              @click="sections.stashes = !sections.stashes"
            >
              <ChevronRight v-if="!sections.stashes" :size="12" /><ChevronDown
                v-else
                :size="12"
              /><Archive :size="13" />STASHES</AppSectionHeading
            ><template v-if="sections.stashes"
              ><AppTreeRow
                v-for="stash in snapshot.stashes
                  .trim()
                  .split('\n')
                  .filter(Boolean)"
                :key="stash"
                aria-haspopup="menu"
                @contextmenu="stashMenu($event, stash)"
                @keydown.shift.f10.prevent="stashMenu($event, stash)"
                class="tree-row min-h-[32px] [&.current]:text-[#e4eaff] [&.current]:bg-[#27334a] [&.current]:shadow-[inset_2px_0_#9eafea]"
                @click="ask('stash-apply', { target: stash.split('\t')[0]! })"
              >
                <Archive :size="13" /><span>{{
                  stash.split("\t")[1] || stash
                }}</span>
              </AppTreeRow></template
            >
          </div>
        </template>
        <template v-else-if="!chatVisible"
          ><AppSectionHeading as="p" class="section-heading">
            RECENT REPOSITORIES
          </AppSectionHeading>
          <AppTreeRow
            v-for="path in recent"
            :key="path"
            class="tree-row min-h-[32px] [&.current]:text-[#e4eaff] [&.current]:bg-[#27334a] [&.current]:shadow-[inset_2px_0_#9eafea]"
            :title="path"
            aria-haspopup="menu"
            @contextmenu="repositoryContext($event, path)"
            @keydown.shift.f10.prevent="repositoryContext($event, path)"
            @keydown.context-menu.prevent="repositoryContext($event, path)"
            @click="w.openRepo(path)"
          >
            <FolderGit2 :size="15" /><span>{{ w.repositoryName(path) }}</span>
          </AppTreeRow>
          <AppHint v-if="!recent.length" class="nav-hint">
            Your repositories will appear here.
          </AppHint></template
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
      <div
        v-show="!chatVisible"
        class="sidebar-footer border-t-[1px] border-solid border-t-[var(--line)] py-[10px] px-[12px] bg-[#141519] [&>div]:flex [&>div]:items-center [&>div]:gap-[8px] [&>div]:text-[#656d7d] [&>div]:text-[10px] [&>div]:pt-[12px] [&>div]:px-[3px] [&>div]:pb-[3px]"
      >
        <div>
          <span
            class="status-dot inline-block w-[6px] h-[6px] rounded-full bg-[#626877] shrink-0 [&.live]:bg-[#8bbca5] [&.live]:shadow-[0_0_0_3px_#8bbca508]"
            :class="{ live: t3Connected }"
          /><span>{{
            t3Connected ? "T3 Code connected" : "Local workspace"
          }}</span
          ><span class="version ml-auto text-[#545c6a]">v{{ appVersion }}</span>
        </div>
      </div>
    </aside>
    <main
      ref="workspace"
      class="workspace flex flex-col min-h-0 min-w-0 bg-[#111216] relative"
      aria-label="Git workspace"
    >
      <template v-if="snapshot">
        <template v-if="view === 'changes'">
          <div
            v-if="!chatVisible"
            class="changes-title flex items-center justify-between py-[10px] px-[16px] gap-[12px] [&_p]:text-[10px] [&_p]:text-[#747b8b] [&_p]:mt-[3px] [@media(min-width:1650px)]:py-[10px] [@media(min-width:1650px)]:px-[16px] [@media(max-width:1250px)]:py-[10px] [@media(max-width:1250px)]:px-[16px] [&_h1]:text-[13px] [&_h1]:tracking-normal h-[var(--pane-heading-height)] min-h-[var(--pane-heading-height)] shrink-0 border-b-[1px] border-solid border-b-[var(--line)]"
          >
            <div>
              <h1
                class="[:where(&)]:m-0 [:where(&)]:text-[22px] [:where(&)]:tracking-[-0.6px] [:where(&)]:font-semibold"
              >
                Local changes
              </h1>
              <p>
                {{
                  snapshot.files.length
                    ? `${snapshot.files.length} files changed in your working directory`
                    : "Your working directory is clean"
                }}
              </p>
            </div>
            <span
              class="branch-pill flex items-center gap-[6px] text-[10px] text-[#9ba6c2] bg-[#1a1e28] border-[1px] border-solid border-[#2c3343] rounded-[5px] py-[5px] px-[8px] max-w-[40%] overflow-hidden text-ellipsis whitespace-nowrap [@media(max-width:1250px)]:max-w-[42%] [@media(max-width:1250px)]:text-[9px]"
              ><GitBranch :size="13" />{{ snapshot.branch }}</span
            >
          </div>
          <div
            class="review-grid grid grid-cols-[var(--files-width,_clamp(240px,_23vw,_340px))_minmax(0,_1fr)] flex-1 min-h-0 [border-top:0] grid-rows-[minmax(0,_1fr)]"
          >
            <section
              id="changed-files"
              class="files-panel border-r-[1px] border-solid border-r-[var(--line)] flex flex-col min-h-0 bg-[#141519] [grid-row:1_/_-1] min-w-0 relative"
            >
              <ResizeHandle
                v-model="preferredFilesWidth"
                label="Resize changed files"
                controls="changed-files"
                storage-key="gitgoblin.filesWidth"
                :min="180"
                :max="maxFilesWidth"
              />
              <div
                class="files-toolbar flex items-center gap-[4px] h-[var(--review-heading-height)] min-h-[var(--review-heading-height)] p-[6px] shrink-0 [&>.subtle]:flex-1 [&>.subtle]:pl-[6px] [&>.subtle]:text-[11px]"
              >
                <span class="subtle text-[var(--muted)]">Changed files</span>
                <AppButton
                  size="icon"
                  class="icon-button file-view-toggle shrink-0"
                  :aria-label="
                    filesAsTree
                      ? 'Show files as a list'
                      : 'Show files as a tree'
                  "
                  :title="
                    filesAsTree
                      ? 'Show files as a list'
                      : 'Show files as a tree'
                  "
                  :aria-pressed="filesAsTree"
                  @click="filesAsTree = !filesAsTree"
                >
                  <ListTree v-if="filesAsTree" :size="16" /><List
                    v-else
                    :size="16"
                  />
                </AppButton>
              </div>
              <div
                v-if="mode === 'branch'"
                class="base-picker flex items-center gap-[8px] pt-[5px] px-[12px] pb-[10px] text-[10px] text-[#818b9d] [&_[role=combobox]]:w-[120px] [&_[role=combobox]]:p-[4px] [&_[role=combobox]]:text-[10px]"
              >
                <span>Compare to</span
                ><AppSelect
                  v-model="base"
                  aria-label="Base branch"
                  :options="
                    localBranches.map((branch) => ({
                      value: branch.name.replace('refs/heads/', ''),
                      label: branch.name.replace('refs/heads/', ''),
                    }))
                  "
                />
              </div>
              <div
                v-for="group in fileGroups"
                :key="group.mode"
                class="file-group flex flex-col flex-1 min-h-0 [&_+_.file-group]:border-t-[1px] [&_+_.file-group]:border-solid [&_+_.file-group]:border-t-[#39404f] [&_.file-list-label]:bg-[#1b1e25] [&_.file-list-label]:border-b-[1px] [&_.file-list-label]:border-solid [&_.file-list-label]:border-b-[var(--line)] [&_.file-list-label]:text-[11px] [&_.file-list-label]:tracking-normal [&_.file-list-label]:text-[#b7bfd1] [&_.file-list-label]:py-[9px] [&_.file-list-label]:px-[12px] [&_.file-list]:p-[5px]"
              >
                <div
                  class="file-list-label flex justify-between text-[8px] tracking-[0.9px] text-[#666f81] font-semibold pt-[12px] px-[8px] pb-[9px] [&_.stage-all]:py-[2px] [&_.stage-all]:px-[6px] [&_.stage-all]:text-[10px] [&_.stage-all]:shrink-0"
                >
                  {{ group.label }}<span>{{ group.files.length }}</span
                  ><AppButton
                    v-if="group.mode !== 'branch'"
                    class="stage-all"
                    :disabled="
                      busy ||
                      example ||
                      !group.files.length ||
                      group.files.some((file) => file.conflict)
                    "
                    :title="
                      group.files.some((file) => file.conflict)
                        ? 'Resolve conflicting files first'
                        : undefined
                    "
                    @click="toggleFileStage(null, group.mode)"
                  >
                    {{ group.mode === "staged" ? "Unstage all" : "Stage all" }}
                  </AppButton>
                </div>
                <div
                  class="file-list flex-1 overflow-auto py-0 px-[7px] [overflow-anchor:none]"
                >
                  <FileList
                    :key="repo"
                    :files="group.files"
                    :tree="filesAsTree"
                    :selected="mode === group.mode ? selected : ''"
                    :mode="group.mode"
                    :editable="!busy && !example && group.mode !== 'branch'"
                    :native-actions="desktop() && !example"
                    @open-editor="fileLocation('open_editor', $event)"
                    @reveal="fileLocation('reveal_path', $event)"
                    @copy-full-path="fileLocation('full_path', $event)"
                    @error="error = $event"
                    @select="selectFile($event, group.mode)"
                    @discard="confirmDiscard"
                    @toggle-selection="toggleSelectedFiles($event, group.mode)"
                    @toggle-stage="toggleFileStage($event, group.mode)"
                    @toggle-folder="toggleFileStage($event, group.mode, true)"
                  />
                  <div
                    v-if="!group.files.length"
                    class="small-empty py-[35px] px-[10px] text-[#65728b] text-center text-[11px] [&>svg]:mb-[10px]"
                  >
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
              <form
                v-show="!chatVisible && mode !== 'branch'"
                class="commit-form flex flex-col gap-[9px] shrink-0 py-[14px] px-[12px] border-t-[1px] border-solid border-t-[var(--line)] [&>label]:text-[12px] [&>label]:text-[#c5cfe0] [&_textarea]:w-full [&_textarea]:min-h-[100px] [&_textarea]:max-h-[240px] [&_textarea]:resize-y [&_textarea]:text-[12px] [&_textarea]:leading-[1.6]"
                aria-label="Commit staged changes"
                @submit.prevent="commit"
              >
                <label for="commit-message">Commit message</label>
                <AppTextarea
                  id="commit-message"
                  v-model="commitMessage"
                  :disabled="busy || example"
                  rows="4"
                  placeholder="Summary&#10;&#10;Description (optional)"
                  @keydown.ctrl.enter.prevent="commit"
                  @keydown.meta.enter.prevent="commit"
                />
                <div
                  class="commit-form-actions flex flex-wrap items-center justify-between gap-[8px] [&_button]:text-[11px]"
                >
                  <AppButton
                    type="button"
                    class="text-button py-[3px] px-[5px] text-[11px] text-[#989fad]"
                    :disabled="busy || example || !snapshot.head"
                    @click="amendCommit"
                  >
                    Amend last commit…
                  </AppButton>
                  <AppButton
                    variant="primary"
                    type="submit"
                    class="primary [border-color:#adbbff]"
                    :disabled="!canCommit"
                    title="Commit staged changes (Ctrl+Enter)"
                  >
                    <GitCommitHorizontal :size="14" />Commit staged
                  </AppButton>
                </div>
              </form>
            </section>
            <section
              class="review-panel min-h-0 min-w-0 flex flex-col bg-[#121318]"
              :aria-busy="w.repositoryLoading.value || diffLoading"
            >
              <div
                v-if="w.repositoryLoading.value"
                class="panel-empty flex flex-col items-center justify-center text-center gap-[16px] py-[35px] px-[24px] text-[#7c879d] flex-1 [&_p]:text-[12px] [&_p]:leading-[1.8] [&_p]:max-w-[300px] [&_h3]:text-[#c1c9dc]"
                role="status"
              >
                <LoaderCircle :size="24" class="spin animate-spin" />
                <p>Loading worktree changes...</p>
              </div>
              <template v-else-if="selected"
                ><div
                  class="file-heading flex items-center gap-[9px] py-[8px] px-[12px] border-b-[1px] border-solid border-b-[var(--line)] min-h-[var(--review-heading-height)] [&>svg]:text-[#8694b4] [&>span:first-of-type]:font-[Consolas,_monospace] [&>span:first-of-type]:text-[11px] [&>span:first-of-type]:flex-1 [&>span:first-of-type]:overflow-hidden [&>span:first-of-type]:text-ellipsis [&>span:first-of-type]:whitespace-nowrap [@media(max-width:1250px)]:gap-[6px] [@media(max-width:1250px)]:[&>span:first-of-type]:text-[10px] h-[var(--review-heading-height)]"
                >
                  <FileCode2 :size="15" /><span :title="selected">{{
                    selected
                  }}</span
                  ><span
                    class="diff-stat green text-[var(--green)] text-[10px] font-[Consolas,_monospace]"
                    >+{{ additions }}</span
                  ><span
                    class="diff-stat red text-[var(--red)] text-[10px] font-[Consolas,_monospace]"
                    >−{{ deletions }}</span
                  ><AppButton
                    v-if="mode !== 'branch' && !selectedFile?.conflict"
                    class="secondary small bg-[#22252e] [border-color:#30343f] text-[#c9d0e3] text-[11px] py-[4px] px-[7px] rounded-[4px]"
                    :disabled="
                      busy || diffLoading || example || !diff.fingerprint
                    "
                    @click="stage"
                  >
                    {{
                      mode === "staged" ? "Unstage file" : "Stage file"
                    }}</AppButton
                  ><AppButton
                    variant="primary"
                    v-if="selectedFile?.conflict"
                    class="primary small [border-color:#30343f] text-[11px] py-[4px] px-[7px] rounded-[4px]"
                    @click="openConflict"
                  >
                    Resolve conflict
                  </AppButton>
                </div>
                <div
                  class="file-tools flex justify-between items-center py-[5px] px-[12px] text-[#6e788b] text-[10px] bg-[#15171d] border-b-[1px] border-solid border-b-[#232630] [&>div]:flex [&>div]:items-center [&>div]:gap-[6px] [&_.text-button]:text-[10px]"
                >
                  <span>File changes</span>
                  <div>
                    <AppButton
                      class="text-button py-[3px] px-[5px] text-[11px] text-[#989fad]"
                      @click="showFileInfo('history')"
                    >
                      File history</AppButton
                    ><AppButton
                      class="text-button py-[3px] px-[5px] text-[11px] text-[#989fad]"
                      @click="showFileInfo('blame')"
                    >
                      Blame</AppButton
                    ><AppButton
                      size="icon"
                      class="icon-button"
                      title="Open in VS Code"
                      :disabled="example"
                      @click="openEditor"
                    >
                      <ExternalLink :size="13" />
                    </AppButton>
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
                    !example && mode !== 'branch' && !selectedFile?.conflict
                  "
                  @patch="patch"
                  @context="addContext"
                  @edit-context="editContext"
              /></template>
              <div
                v-else
                class="panel-empty clean-state flex flex-col items-center justify-center text-center gap-[16px] py-[35px] px-[24px] text-[#7c879d] flex-1 [&_p]:text-[12px] [&_p]:leading-[1.8] [&_p]:max-w-[300px] [&_h3]:text-[#c1c9dc]"
              >
                <div
                  class="empty-orbit flex items-center justify-center w-[64px] h-[64px] rounded-[17px] border-[1px] border-solid border-[#303747] [background:linear-gradient(135deg,_#242a38,_#181c26)] text-[#a4b5e1] shadow-[0_5px_20px_#0002]"
                >
                  <Check :size="25" />
                </div>
                <h3
                  class="[:where(&)]:m-0 [:where(&)]:text-[16px] [:where(&)]:[font-weight:550]"
                >
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
          ><div
            class="changes-title flex items-center justify-between py-[10px] px-[16px] gap-[12px] [&_p]:text-[10px] [&_p]:text-[#747b8b] [&_p]:mt-[3px] [@media(min-width:1650px)]:py-[10px] [@media(min-width:1650px)]:px-[16px] [@media(max-width:1250px)]:py-[10px] [@media(max-width:1250px)]:px-[16px] [&_h1]:text-[13px] [&_h1]:tracking-normal h-[var(--pane-heading-height)] min-h-[var(--pane-heading-height)] shrink-0 border-b-[1px] border-solid border-b-[var(--line)]"
          >
            <div>
              <h1
                class="[:where(&)]:m-0 [:where(&)]:text-[22px] [:where(&)]:tracking-[-0.6px] [:where(&)]:font-semibold"
              >
                {{ w.historyBranch.value ? (w.historyBranch.value.mode === 'only' ? 'Only: ' : 'Excluding: ') + w.historyBranch.value.name.replace(/^refs\/(heads|remotes)\//, '') : 'All commits' }}
              </h1>
            </div>
            <AppButton v-if="w.historyBranch.value" @click="w.filterHistory()">Clear branch filter</AppButton>
            <form
              class="search-field flex items-center gap-[7px] border-[1px] border-solid border-[#2d3544] rounded-[6px] py-0 px-[8px] text-[#6f7c95] [&_input]:border-0 [&_input]:bg-transparent [&_input]:text-[11px] [&_input]:py-[7px] [&_input]:px-0 [&_input]:w-[185px] [&_input]:shadow-[none]"
              @submit.prevent="w.searchHistory()"
            >
              <Search :size="15" /><AppInput
                v-model="search"
                placeholder="Search commit messages…"
                aria-label="Search commits"
              />
            </form>
          </div>
          <HistoryList
            :commits="commits"
            :selected="selectedCommit?.id"
            :loading="w.historyLoading.value"
            :has-more="w.historyHasMore.value"
            @select="w.selectCommit"
            @context="commitMenu"
            @load-more="w.loadHistory()"
          />
          <div
            id="commit-details"
            class="commit-detail flex flex-col [height:var(--details-height,_44%)] min-h-[170px] border-t-[1px] border-solid border-t-[#34405a] [&_.panel-heading]:min-h-[45px] [&_.panel-heading]:py-[8px] [&_.panel-heading]:px-[15px] relative shrink-0 bg-[#15171d]"
          >
            <ResizeHandle
              v-model="preferredDetailsHeight"
              label="Resize commit details"
              controls="commit-details"
              storage-key="gitgoblin.detailsHeight"
              :min="170"
              :max="maxDetailsHeight"
              horizontal
              reverse
            />
            <div
              class="detail-tabs flex border-b-[1px] border-solid border-b-[var(--line)] min-h-[35px] [&_button]:rounded-none [&_button]:py-[8px] [&_button]:px-[20px] [&_button]:text-[11px] [&_button]:text-[#8993a8] [&_button.active]:text-[#b5c5ff] [&_button.active]:border-b-[2px] [&_button.active]:border-solid [&_button.active]:border-b-[#95a9ef] [&_button.active]:bg-[#222836]"
              role="tablist"
              aria-label="Commit details"
            >
              <AppButton
                class="[.segmented_button&.active]:bg-[#292d38] [.segmented_button&.active]:text-[#d1d8ed] [.segmented_button&.active]:shadow-[0_1px_3px_#0004]"
                v-for="tab in ['commit', 'changes']"
                :key="tab"
                role="tab"
                :aria-selected="historyTab === tab"
                :class="[{ active: historyTab === tab }]"
                @click="historyTab = tab"
              >
                {{ tab === "commit" ? "Commit" : "Changes" }}
              </AppButton>
            </div>
            <template v-if="selectedCommit">
              <div
                class="panel-heading flex items-center justify-between gap-[10px] border-b-[1px] border-solid border-b-[var(--line)] py-[12px] px-[15px] min-h-[54px] text-[11px] [&>span]:flex [&>span]:items-center [&>span]:gap-[8px] [&>span]:min-w-0 [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap [&>span]:text-[#c2cadd] [&_svg]:text-[#8c98b1]"
              >
                <span
                  ><GitCommitHorizontal :size="15" />{{
                    selectedCommit.subject
                  }}</span
                >
                <div class="button-row flex items-center gap-[5px]">
                  <AppButton
                    class="small text-[11px] py-[4px] px-[7px] [border-color:#30343f] rounded-[4px]"
                    :disabled="example"
                    @click="ask('cherry-pick', { target: selectedCommit.id })"
                  >
                    Cherry-pick</AppButton
                  ><AppButton
                    class="small text-[11px] py-[4px] px-[7px] [border-color:#30343f] rounded-[4px]"
                    :disabled="example"
                    @click="ask('revert', { target: selectedCommit.id })"
                  >
                    Revert</AppButton
                  ><AppButton
                    class="small text-[11px] py-[4px] px-[7px] [border-color:#30343f] rounded-[4px]"
                    :disabled="example"
                    @click="ask('reset', { target: selectedCommit.id })"
                  >
                    Reset to here
                  </AppButton>
                </div>
              </div>
              <div
                v-if="historyTab === 'commit'"
                class="commit-metadata overflow-auto py-[18px] px-[24px] text-[12px] [&_dl]:grid [&_dl]:grid-cols-[60px_minmax(0,_1fr)] [&_dl]:gap-[8px] [&_dl]:my-[18px] [&_dl]:mx-0 [&_dl]:text-[11px] [&_dt]:text-[#818da5] [&_dd]:m-0 [&_dd]:[overflow-wrap:anywhere] [&_p]:border-t-[1px] [&_p]:border-solid [&_p]:border-t-[var(--line)] [&_p]:pt-[15px]"
              >
                <div
                  class="commit-identity flex items-center gap-[12px] [&>div]:flex [&>div]:flex-col [&>div]:gap-[4px] [&_small]:text-[9px] [&_small]:text-[#818da5] [&_strong]:font-medium [&_div>span]:text-[#818da5] [&_div>span]:text-[10px]"
                >
                  <span
                    class="author-avatar grid place-items-center w-[38px] h-[38px] rounded-[8px] bg-[#344263] text-[#c4d1fc]"
                    >{{ selectedCommit.author.slice(0, 2).toUpperCase() }}</span
                  >
                  <div>
                    <small class="[:where(&)]:text-[11px]">AUTHOR</small
                    ><strong>{{ selectedCommit.author }}</strong
                    ><span>{{ selectedCommit.date }}</span>
                  </div>
                </div>
                <dl>
                  <dt>SHA</dt>
                  <dd>
                    <code
                      class="[:where(&)]:font-['Cascadia_Code',_'JetBrains_Mono',_Consolas,_monospace]"
                      >{{ selectedCommit.id }}</code
                    >
                  </dd>
                  <dt>Parents</dt>
                  <dd>
                    <code
                      class="[:where(&)]:font-['Cascadia_Code',_'JetBrains_Mono',_Consolas,_monospace]"
                      >{{ selectedCommit.parents || "Initial commit" }}</code
                    >
                  </dd>
                  <dt v-if="selectedCommit.refs">Refs</dt>
                  <dd v-if="selectedCommit.refs">{{ selectedCommit.refs }}</dd>
                </dl>
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
            <div
              v-else
              class="panel-empty flex flex-col items-center justify-center text-center gap-[16px] py-[35px] px-[24px] text-[#7c879d] flex-1 [&_p]:text-[12px] [&_p]:leading-[1.8] [&_p]:max-w-[300px] [&_h3]:text-[#c1c9dc]"
            >
              <GitCommitHorizontal :size="24" />
              <p>Select a commit to inspect its details and changes.</p>
            </div>
          </div></template
        >
        <template v-else
          ><div
            class="changes-title flex items-center justify-between py-[10px] px-[16px] gap-[12px] [&_p]:text-[10px] [&_p]:text-[#747b8b] [&_p]:mt-[3px] [@media(min-width:1650px)]:py-[10px] [@media(min-width:1650px)]:px-[16px] [@media(max-width:1250px)]:py-[10px] [@media(max-width:1250px)]:px-[16px] [&_h1]:text-[13px] [&_h1]:tracking-normal h-[var(--pane-heading-height)] min-h-[var(--pane-heading-height)] shrink-0 border-b-[1px] border-solid border-b-[var(--line)]"
          >
            <div>
              <h1
                class="[:where(&)]:m-0 [:where(&)]:text-[22px] [:where(&)]:tracking-[-0.6px] [:where(&)]:font-semibold"
              >
                Reflog & recovery
              </h1>
              <p>
                Recover a previous state by creating a branch at its commit.
              </p>
            </div>
          </div>
          <div
            class="reflog-list flex-1 overflow-auto py-0 px-[15px] [&>button]:flex [&>button]:w-full [&>button]:justify-start [&>button]:text-left [&>button]:border-b-[1px] [&>button]:border-solid [&>button]:border-b-[#293042] [&>button]:rounded-none [&>button]:py-[13px] [&>button]:px-[7px] [&>button]:gap-[12px] [&>button]:text-[11px] [&>button>code]:text-[#9bacd3] [&>button>span:first-of-type]:flex-1 [&>button>span:first-of-type]:whitespace-normal [&>button>.text-button]:flex [&>button>.text-button]:items-center [&>button>.text-button]:gap-[6px] [&>button>.text-button]:text-[#768cbb]"
          >
            <AppButton
              v-for="line in reflog.trim().split('\n').filter(Boolean)"
              :key="line"
              @click="ask('branch-create', { target: line.split('\t')[0]! })"
            >
              <GitCommitHorizontal :size="16" /><code
                class="[:where(&)]:font-['Cascadia_Code',_'JetBrains_Mono',_Consolas,_monospace]"
                >{{ line.split("\t")[0]?.slice(0, 8) }}</code
              ><span>{{ line.split("\t").slice(1).join(" · ") }}</span
              ><span
                class="text-button py-[3px] px-[5px] text-[11px] text-[#989fad]"
                >Recover branch<ArrowUpRight :size="13"
              /></span>
            </AppButton></div
        ></template>
      </template>
      <div
        v-else
        class="welcome flex flex-col items-center justify-center flex-1 p-[40px] text-center [background:radial-gradient(ellipse_at_50%_38%,_#1b213455,_transparent_65%)] [&_h1]:text-[30px] [&_h1]:tracking-[-1.2px] [&_h1]:text-[#d9e3fb] [&_h1]:[font-weight:550] [&_p]:text-[12px] [&_p]:leading-[1.9] [&_p]:text-[#788aaa] [&_p]:mt-[17px] [&_p]:mx-0 [&_p]:mb-[27px] [@media(max-width:1250px)]:[&_h1]:text-[26px]"
      >
        <div
          class="welcome-mark h-[85px] w-[85px] flex items-center justify-center border-[1px] border-solid border-[#3b4663] rounded-[23px] text-[#acbdf9] [background:linear-gradient(145deg,_#2b3450,_#171d2c)] shadow-[0_10px_45px_#0003] mb-[32px]"
        >
          <GitBranch :size="38" />
        </div>
        <span class="eyebrow text-[9px] tracking-[2px] text-[#687fa9] mb-[15px]"
          >A CLEARER VIEW OF YOUR WORK</span
        >
        <h1
          class="[:where(&)]:m-0 [:where(&)]:text-[22px] [:where(&)]:tracking-[-0.6px] [:where(&)]:font-semibold"
        >
          Make yourself at home.
        </h1>
        <p>
          Your branches, changes, and agent conversations.<br />One focused
          workspace, built around your code.
        </p>
        <p>
          Choose <strong>Repositories → Open repository</strong> to get
          started.<br /><kbd
            class="[:where(&)]:font-['Cascadia_Code',_'JetBrains_Mono',_Consolas,_monospace] [:where(&)]:text-[10px] [:where(&)]:text-[#777d8a] [:where(&)]:font-normal [:where(&)]:whitespace-nowrap"
            >Ctrl O</kbd
          >
        </p>
        <div
          class="welcome-features flex gap-[25px] border-t-[1px] border-solid border-t-[#293248] py-[23px] px-[10px] text-[#60759d] text-[10px] [&>span]:flex [&>span]:items-center [&>span]:gap-[7px] [@media(max-width:1250px)]:gap-[12px] [@media(max-width:1250px)]:flex-wrap [@media(max-width:1250px)]:justify-center"
        >
          <span><GitCommitHorizontal :size="16" />Thoughtful commits</span
          ><span><Layers :size="16" />Parallel worktrees</span
          ><span><MessageSquare :size="16" />Shared conversations</span>
        </div>
      </div>
      <div
        v-if="busy || notice"
        class="workspace-status flex items-center gap-[8px] py-[5px] px-[12px] min-h-[34px] shrink-0 border-t-[1px] border-solid border-t-[var(--line)] text-[#a3aec3] text-[11px] bg-[#12151c] mt-auto [&>span]:flex-1 [&>span]:min-w-0 [&>span]:[overflow-wrap:anywhere] [&>span]:whitespace-pre-wrap [&>span]:max-h-[80px] [&>span]:overflow-auto [&>span]:leading-[1.5]"
        role="status"
      >
        <LoaderCircle v-if="busy" :size="14" class="spin animate-spin" />
        <Check v-else :size="14" />
        <span>{{ notice || "Working…" }}</span>
        <AppButton
          size="icon"
          v-if="notice && !busy"
          class="icon-button"
          aria-label="Dismiss status message"
          @click="notice = ''"
        >
          <X :size="14" />
        </AppButton>
      </div>
    </main>
    <ContextMenu ref="sidebarMenu" @error="error = $event" />
    <Teleport to="body">
      <CloseChatDialog
        v-if="closingChat"
        :thread="closingChat"
        :connected="t3Connected && !example"
        :confirm="confirmCloseChat"
        @close="closingChat = undefined"
      />
      <AppDialog
        v-if="renamePath"
        title="Rename repository"
        :dismissible="!w.nameSaving.value"
        @close="renamePath = ''"
      >
        <AppDialogPanel
          as="form"
          class="modal w-[470px] max-w-full max-h-[90vh] overflow-auto p-[22px]"
          aria-labelledby="rename-repository-title"
          @submit.prevent="saveRepositoryName"
        >
          <AppDialogHeader class="modal-heading">
            <h2
              class="[:where(&)]:m-0 [:where(&)]:text-[18px] [:where(&)]:font-semibold"
              id="rename-repository-title"
            >
              Rename repository
            </h2>
            <AppButton
              size="icon"
              type="button"
              class="icon-button"
              aria-label="Close rename dialog"
              :disabled="w.nameSaving.value"
              @click="renamePath = ''"
            >
              <X :size="18" />
            </AppButton>
          </AppDialogHeader>
          <p>{{ renamePath }}</p>
          <label
            >Display name<AppInput
              ref="renameInput"
              v-model="renameName"
              :disabled="w.nameSaving.value"
              :placeholder="renamePath.replaceAll('\\', '/').split('/').at(-1)"
          /></label>
          <p>Leave empty to use the folder name.</p>
          <AppDialogFooter class="modal-footer">
            <AppButton
              type="button"
              :disabled="w.nameSaving.value"
              @click="renamePath = ''"
            >
              Cancel</AppButton
            ><AppButton
              variant="primary"
              type="submit"
              class="primary [border-color:#adbbff]"
              :disabled="w.nameSaving.value"
            >
              Save
            </AppButton>
          </AppDialogFooter>
        </AppDialogPanel>
      </AppDialog>
      <AppDialog
        v-if="dialog"
        :title="dialogTitle"
        :dismissible="!busy"
        @close="dialog = ''"
      >
        <AppDialogPanel
          class="modal w-[470px] max-w-full max-h-[90vh] overflow-auto p-[22px]"
          :class="[{ 'modal-wide': rebaseCommits.length }]"
          aria-labelledby="action-title"
        >
          <AppDialogHeader class="modal-heading">
            <h2
              class="[:where(&)]:m-0 [:where(&)]:text-[18px] [:where(&)]:font-semibold"
              id="action-title"
            >
              {{ dialogTitle }}
            </h2>
            <AppButton
              size="icon"
              class="icon-button"
              aria-label="Close"
              :disabled="busy"
              @click="dialog = ''"
            >
              <X :size="18" />
            </AppButton>
          </AppDialogHeader>
          <p>{{ dialogDescription }}</p>
          <div
            v-if="activeAgents.length"
            class="agent-warning flex items-start gap-[10px] border-[1px] border-solid border-[#675638] bg-[#302b22] p-[12px] rounded-[6px] text-[#d1b784] text-[11px] [&_p]:text-[10px] [&_p]:leading-[1.7] [&_p]:my-[7px] [&_p]:mx-0"
          >
            <AlertTriangle :size="17" />
            <div>
              <strong
                >{{ activeAgents.length }} agent task(s) may be editing this
                worktree.</strong
              >
              <p>
                {{ activeAgents.map((t) => t.title).join(", ") }}
              </p>
              <AppButton
                class="small text-[11px] py-[4px] px-[7px] [border-color:#30343f] rounded-[4px]"
                @click="stopAgents"
              >
                Stop tasks first
              </AppButton>
            </div>
          </div>
          <form @submit.prevent="executeDialog">
            <label v-for="field in fields" :key="field.key"
              >{{ field.label
              }}<AppSelect
                v-if="field.options"
                v-model="values[field.key]"
                :options="
                  field.options.map((option) => ({
                    value: option,
                    label: option,
                  }))
                " /><AppTextarea
                v-else-if="
                  (dialog === 'commit' || dialog === 'amend') &&
                  field.key === 'text'
                "
                v-model="values[field.key]"
                rows="5"
                required
                aria-label="Commit message" />
              <AppInput
                v-else
                v-model="values[field.key]"
                :disabled="!!rebaseCommits.length"
                required
            /></label>
            <label v-if="dialog === 'branch-delete'" class="force-option">
              <AppInput
                v-model="values.mode"
                type="checkbox"
                true-value="force"
                false-value=""
                :disabled="busy"
              />
              Force delete even if the branch is not merged
            </label>
            <label v-if="dialog === 'push'" class="force-option">
              <AppInput
                v-model="values.mode"
                type="checkbox"
                true-value="force"
                false-value=""
                :disabled="busy"
              />
              Force push (with lease)
            </label>
            <AppHint
              v-if="dialog === 'push' && values.mode === 'force'"
              class="nav-hint"
            >
              Replaces remote history. Refused if the remote branch changed
              since your last fetch.
            </AppHint>
            <div
              v-if="rebaseCommits.length"
              class="rebase-list mt-[20px] [&>div]:flex [&>div]:gap-[8px] [&>div]:items-center [&>div]:border-b-[1px] [&>div]:border-solid [&>div]:border-b-[#30394a] [&>div]:py-[8px] [&>div]:px-0 [&>div]:text-[11px] [&_[role=combobox]]:w-[125px] [&_[role=combobox]]:text-[11px] [&_[role=combobox]]:p-[6px] [&_code]:text-[10px] [&_code]:text-[#7388b5] [&_span]:flex-1 [&_span]:overflow-hidden [&_span]:text-ellipsis [&_span]:whitespace-nowrap"
            >
              <div v-for="(commit, i) in rebaseCommits" :key="commit.id">
                <AppSelect
                  v-model="commit.action"
                  :aria-label="`Action for ${commit.subject}`"
                  :options="[
                    { value: 'pick', label: 'Pick' },
                    { value: 'edit', label: 'Edit / reword' },
                    { value: 'squash', label: 'Squash', disabled: i === 0 },
                    { value: 'fixup', label: 'Fixup', disabled: i === 0 },
                    { value: 'drop', label: 'Drop' },
                  ]"
                /><code
                  class="[:where(&)]:font-['Cascadia_Code',_'JetBrains_Mono',_Consolas,_monospace]"
                  >{{ commit.id.slice(0, 7) }}</code
                ><span>{{ commit.subject }}</span
                ><AppButton
                  size="icon"
                  type="button"
                  class="icon-button"
                  aria-label="Move earlier"
                  :disabled="i === 0"
                  @click="reorder(i, -1)"
                >
                  <ArrowUp :size="14" /></AppButton
                ><AppButton
                  size="icon"
                  type="button"
                  class="icon-button"
                  aria-label="Move later"
                  :disabled="i === rebaseCommits.length - 1"
                  @click="reorder(i, 1)"
                >
                  <ArrowDown :size="14" />
                </AppButton>
              </div>
            </div>
            <div
              v-if="dialogError"
              class="inline-error text-[#e4a6b0] bg-[#472b343f] py-[10px] px-[12px] text-[11px] leading-[1.7] whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              {{ dialogError }}
            </div>
            <AppDialogFooter class="modal-footer">
              <AppButton type="button" :disabled="busy" @click="dialog = ''">
                Cancel</AppButton
              ><AppButton
                variant="primary"
                type="submit"
                class="primary [border-color:#adbbff] [&.danger]:bg-[#d78793] [&.danger]:[border-color:#e2a1aa]"
                :class="[
                  [
                    {
                      danger:
                        dialog === 'discard-files' ||
                        dialog === 'branch-delete' ||
                        (dialog === 'push' && values.mode === 'force') ||
                        (dialog === 'reset' && values.mode === 'hard'),
                    },
                  ],
                ]"
                :disabled="busy || example"
              >
                {{
                  busy
                    ? "Working…"
                    : dialog === "rebase" && !rebaseCommits.length
                      ? "Load commits"
                      : activeAgents.length
                        ? "Proceed while agents are active"
                        : dialog === "push" && values.mode === "force"
                          ? "Force push"
                          : dialogTitle
                }}
              </AppButton>
            </AppDialogFooter>
          </form>
        </AppDialogPanel>
      </AppDialog>
      <AppDialog
        v-if="output"
        title="Git output"
        :dismissible="!false"
        @close="output = ''"
      >
        <AppDialogPanel
          class="modal modal-wide w-[850px] max-w-full max-h-[90vh] overflow-auto p-[22px]"
          aria-labelledby="output-title"
        >
          <AppDialogHeader class="modal-heading">
            <h2
              class="[:where(&)]:m-0 [:where(&)]:text-[18px] [:where(&)]:font-semibold"
              id="output-title"
            >
              {{ outputTitle }}
            </h2>
            <AppButton
              size="icon"
              class="icon-button"
              aria-label="Close"
              @click="output = ''"
            >
              <X :size="18" />
            </AppButton>
          </AppDialogHeader>
          <pre
            class="output-content text-[11px] max-h-[65vh] overflow-auto text-[#afbdd8] [:where(&)]:font-['Cascadia_Code',_'JetBrains_Mono',_Consolas,_monospace] [:where(&)]:whitespace-pre-wrap [:where(&)]:[word-break:break-word] [:where(&)]:leading-[1.7]"
            >{{ output }}</pre>
        </AppDialogPanel>
      </AppDialog>
      <ConflictResolver
        v-if="conflictOpen && snapshot"
        :key="repo"
        :snapshot="snapshot"
        :initial-path="conflictInitial"
        :git-output="conflictGitOutput"
        :read="w.read"
        :mutate="w.mutate"
        @close="conflictOpen = false"
      />
    </Teleport>
  </div>
</template>
