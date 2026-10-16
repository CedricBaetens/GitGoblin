<script setup lang="ts">
import { version as appVersion } from '../package.json';
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from "vue";
import {
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  History,
  FolderOpen,
  FolderGit2,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  Search,
  Settings2,
  PanelRightClose,
  PanelRightOpen,
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
import { visibleThreads } from "~/lib/threads";
import { desktop, invoke } from "~/lib/native";
import type { Commit, T3Thread, T3Project, GitRequest, GitRef } from "~/lib/types";
const w = useWorkbench();
const {
  repo,
  recent,
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
const repositoryMenu = ref<HTMLDivElement>();
type SidebarItem = { label: string; disabled?: boolean; run: () => unknown };
const sidebarMenu = ref<{ open: (event: MouseEvent | KeyboardEvent, items: SidebarItem[]) => void; close: () => void }>();
const copyItem = (label: string, text: string): SidebarItem => ({ label, run: () => navigator.clipboard.writeText(text) });
function actionItem(label: string, action: string, preset: Record<string, string> = {}, disabled = false): SidebarItem {
  return { label, disabled: disabled || busy.value || example.value, run: () => ask(action, preset) };
}
function branchMenu(event: MouseEvent | KeyboardEvent, branch: GitRef) {
  const local = branch.name.startsWith('refs/heads/');
  const target = local ? branch.name.replace('refs/heads/', '') : branch.name;
  const items = [
    ...(local ? [actionItem('Switch to branch', 'switch', { target }, branch.current), {
      label: 'Compare with working tree', disabled: busy.value || example.value,
      run: () => { base.value = target; mode.value = 'branch'; view.value = 'changes'; },
    }] : []),
    actionItem('Create branch here…', 'branch-create', { target }),
    actionItem('Merge into current branch…', 'merge', { target }, branch.current),
    ...(local ? [actionItem('Delete branch…', 'branch-delete', { target }, branch.current)] : []),
    copyItem('Copy branch name', branch.name.replace(/^refs\/(heads|remotes)\//, '')),
    copyItem('Copy commit hash', branch.id),
  ];
  sidebarMenu.value?.open(event, items);
}
function worktreeMenu(event: MouseEvent | KeyboardEvent, path: string) {
  const main = normalized(path) === normalized(snapshot.value?.repositoryRoot || snapshot.value?.worktrees[0]?.path || '');
  const current = normalized(path) === normalized(repo.value);
  const active = threads.value.some(thread => thread.activeRunId && normalized(thread.worktreePath || projects.value.find(project => project.id === thread.projectId)?.workspaceRoot || '') === normalized(path));
  sidebarMenu.value?.open(event, [
    { label: 'Open worktree', disabled: busy.value || example.value, run: () => w.openRepo(path) },
    actionItem('New worktree…', 'worktree-add'),
    actionItem(main ? 'Remove worktree (main worktree)' : current ? 'Remove worktree (currently open)' : active ? 'Remove worktree (agent running)' : 'Remove worktree…', 'worktree-remove', { path }, main || current || active),
    copyItem('Copy worktree path', path),
  ]);
}
function conversationMenu(event: MouseEvent | KeyboardEvent, thread: T3Thread) {
  sidebarMenu.value?.open(event, [
    { label: 'Open conversation', disabled: busy.value, run: () => { chatVisible.value = true; chat.value?.select(thread.id); } },
    copyItem('Copy conversation title', thread.title), copyItem('Copy conversation ID', thread.id),
  ]);
}
function tagMenu(event: MouseEvent | KeyboardEvent, tag: GitRef) {
  const name = tag.name.replace('refs/tags/', '');
  sidebarMenu.value?.open(event, [actionItem('Create branch here…', 'branch-create', { target: tag.name }), actionItem('Delete tag…', 'tag-delete', { target: name }), copyItem('Copy tag name', name)]);
}
function stashMenu(event: MouseEvent | KeyboardEvent, stash: string) {
  const target = stash.split('\t')[0]!;
  sidebarMenu.value?.open(event, [actionItem('Apply stash…', 'stash-apply', { target }), actionItem('Drop stash…', 'stash-drop', { target }), copyItem('Copy stash reference', target)]);
}
watch([repo, busy, example], () => sidebarMenu.value?.close());
const chatVisible = ref(false),
  context = ref(""),
  chat = ref<{ select: (id: string) => void; stopAll: () => Promise<void>; focusComposer: () => void }>(),
  commitMessage = ref(""),
  amend = ref(false),
  menu = ref(false);
const threads = ref<T3Thread[]>([]),
  selectedThreadId = ref(''),
  projects = ref<T3Project[]>([]),
  t3Connected = ref(false);
const normalized = (value: string) =>
  value.replaceAll("\\", "/").replace(/\/$/, "").toLowerCase();
const repoName = computed(
  () => repo.value.replaceAll("\\", "/").split("/").at(-1) || "GitGoblin",
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
const visibleRepoThreads = computed(() => visibleThreads(repoThreads.value));
const activeAgents = computed(() =>
  repoThreads.value.filter((t) => t.activeRunId),
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
  chats: true,
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
const conflict = ref<{
    base: string;
    ours: string;
    theirs: string;
    result: string;
    fingerprint: string;
  }>(),
  conflictTab = ref("ours");
const definitions: Record<
  string,
  {
    title: string;
    description: string;
    fields?: { key: string; label: string; options?: string[] }[];
    defaults?: Record<string, string>;
  }
> = {
  "branch-create": {
    title: "Create branch",
    description: "Create a branch at the selected commit.",
    fields: [
      { key: "text", label: "Branch name" },
      { key: "target", label: "Starting commit or branch" },
    ],
    defaults: { target: "HEAD" },
  },
  switch: {
    title: "Switch branch",
    description:
      "Changes the current checkout. Git will refuse if local changes would be overwritten.",
    fields: [{ key: "target", label: "Branch" }],
  },
  "branch-delete": {
    title: "Delete branch",
    description:
      "Deletes a merged local branch. Unmerged branches are protected.",
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
      "Publish commits to the configured upstream. This never force-pushes.",
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
  },
  amend: {
    title: "Amend last commit",
    description:
      "Replace the most recent commit with the staged content and message. This changes its commit ID.",
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
    if (dialog.value === "rebase")
      params.text = rebaseCommits.value
        .map((c) => `${c.action} ${c.id}`)
        .join("\n");
    await w.mutate(dialog.value, params);
    if (dialog.value === "commit" || dialog.value === "amend") {
      commitMessage.value = "";
      amend.value = false;
    }
    dialog.value = "";
  } catch (e) {
    dialogError.value = String(e);
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
  if (!commitMessage.value.trim()) return;
  if (activeAgents.value.length || amend.value) {
    ask(amend.value ? "amend" : "commit", { text: commitMessage.value });
    return;
  }
  try {
    await w.mutate("commit", { text: commitMessage.value });
    commitMessage.value = "";
  } catch {}
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
  threads.value = ts;
  projects.value = ps;
  t3Connected.value = connected;
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
  if (normalized(path) !== normalized(repo.value)) await w.openRepo(path);
  currentChat = threadId;
  const saved = chatViews.get(threadId);
  if (saved) {
    mode.value = saved.mode;
    view.value = saved.view;
    base.value = saved.base;
    await nextTick();
    selected.value = saved.selected;
    await w.loadDiff();
    await nextTick();
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
  try {
    conflict.value = await w.read("conflict", { path: selected.value });
  } catch (e) {
    error.value = String(e);
  }
}
async function resolveConflict() {
  if (!conflict.value) return;
  try {
    await w.mutate("resolve", {
      path: selected.value,
      text: conflict.value.result,
      fingerprint: conflict.value.fingerprint,
    });
    conflict.value = undefined;
  } catch (e) {
    error.value = String(e);
  }
}
async function openEditor() {
  try {
    await invoke("open_editor", { repo: repo.value, path: selected.value });
  } catch (e) {
    error.value = String(e);
  }
}
async function chooseRepository(path?: string) {
  repositoryMenu.value?.hidePopover();
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
    void w.openRepo();
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
onMounted(() => window.addEventListener("keydown", keydown));
onUnmounted(() => window.removeEventListener("keydown", keydown));
watch(amend, async (value) => {
  if (value && !commitMessage.value && snapshot.value?.head) {
    try {
      commitMessage.value = await w.read<string>("commit-message", {
        target: "HEAD",
      });
    } catch (e) {
      error.value = String(e);
    }
  }
});
</script>
<template>
  <div class="app-shell" :class="{ 'chat-hidden': !chatVisible, 'has-repository': !!snapshot }">
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
      </div>
      <div class="titlebar-context">
        <button class="repository-switch" popovertarget="repository-menu" aria-label="Switch repository" :disabled="busy" :title="repo || 'Switch repository'">
          <FolderGit2 :size="15" /><strong>{{ snapshot ? repoName : 'Open repository' }}</strong><ChevronDown :size="12" />
        </button>
        <template v-if="snapshot"><span class="context-divider">/</span><GitBranch :size="13" /><span :title="snapshot.branch">{{ snapshot.branch }}</span></template>
      </div>
      <div id="repository-menu" ref="repositoryMenu" popover class="repository-menu" data-tauri-drag-region="false" aria-label="Repositories">
        <div class="repository-menu-heading">Recent repositories</div>
        <button v-for="path in recent" :key="path" :disabled="busy" :title="path" :aria-current="normalized(path) === normalized(snapshot?.repositoryRoot || repo) ? 'true' : undefined" @click="chooseRepository(path)">
          <FolderGit2 :size="16" /><span><strong>{{ path.replaceAll('\\', '/').split('/').at(-1) }}</strong><small>{{ path }}</small></span><Check v-if="normalized(path) === normalized(snapshot?.repositoryRoot || repo)" :size="14" />
        </button>
        <p v-if="!recent.length" class="nav-hint">Opened repositories will appear here.</p>
        <button class="repository-menu-open" :disabled="busy" @click="chooseRepository()"><Plus :size="16" />Open repository...<kbd>Ctrl O</kbd></button>
      </div>
          <div v-if="snapshot" class="toolbar-actions" aria-label="Git actions">
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
      <button
        class="icon-button"
        :title="chatVisible ? 'Hide conversations' : 'Show conversations'"
        @click="chatVisible = !chatVisible"
      >
        <PanelRightClose v-if="chatVisible" :size="17" /><PanelRightOpen
          v-else
          :size="17"
        />
      </button>
      <WindowControls v-if="desktop()" @error="error = $event" />
    </header>
    <aside class="sidebar">
      <div class="repository-picker">
        <FolderGit2 :size="19" />
        <div>
          <strong>{{ snapshot ? repoName : "Your repositories" }}</strong
          ><span>{{
            snapshot ? "Local repository" : "Choose a workspace"
          }}</span>
        </div>
        <button
          class="icon-button"
          title="Open repository"
          @click="w.openRepo()"
        >
          <Plus :size="16" />
        </button>
      </div>
      <div class="sidebar-scroll">
        <template v-if="snapshot">
          <nav class="main-nav">
            <button
              :class="{ active: view === 'changes' }"
              @click="view = 'changes'"
            >
              <Layers :size="16" />Local changes<span class="count">{{
                snapshot.files.length
              }}</span></button
            ><button
              :class="{ active: view === 'history' }"
              @click="view = 'history'"
            >
              <History :size="16" />All commits</button
            ><button
              :class="{ active: view === 'reflog' }"
              @click="view = 'reflog'"
            >
              <GitCommitHorizontal :size="16" />Reflog & recovery
            </button>
          </nav>
          <div class="nav-section">
            <button
              class="section-heading"
              @click="sections.branches = !sections.branches"
            >
              <ChevronDown v-if="sections.branches" :size="12" /><ChevronRight
                v-else
                :size="12"
              />BRANCHES<span>{{ localBranches.length }}</span></button
            ><template v-if="sections.branches"
              ><BranchTree :key="repo" :nodes="localBranchTree" @context="branchMenu" @select="branch => !branch.current && ask('switch', { target: branch.name.replace('refs/heads/', '') })" />
              <button class="tree-row subdued" @click="ask('branch-create')">
                <Plus :size="13" />New branch
              </button></template
            >
          </div>
          <div class="nav-section">
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
                class="tree-row"
                :title="tree.path"
                aria-haspopup="menu" @contextmenu="worktreeMenu($event, tree.path)" @keydown.shift.f10.prevent="worktreeMenu($event, tree.path)"
                @click="!example && w.openRepo(tree.path)"
              >
                <FolderGit2 :size="14" /><span>{{ tree.branch }}</span
                ><span
                  v-if="normalized(tree.path) === normalized(repo)"
                  class="tiny-label"
                  >here</span
                ></button
              ><button class="tree-row subdued" @click="ask('worktree-add')">
                <Plus :size="13" />New worktree
              </button></template
            >
          </div>
          <div class="nav-section">
            <button
              class="section-heading"
              @click="sections.chats = !sections.chats"
            >
              <ChevronDown v-if="sections.chats" :size="12" /><ChevronRight
                v-else
                :size="12"
              />CONVERSATIONS<span>{{
                example ? 2 : visibleRepoThreads.length
              }}</span></button
            ><template v-if="sections.chats"
              ><template v-if="example"
                ><button class="tree-row current" @click="chatVisible = true">
                  <span class="status-dot live" /><span
                    >Build the agent workspace</span
                  ></button
                ><button class="tree-row" @click="chatVisible = true">
                  <MessageSquare :size="13" /><span
                    >Refine the diff viewer</span
                  >
                </button></template
              ><button
                v-for="thread in visibleRepoThreads"
                :key="thread.id"
                aria-haspopup="menu" @contextmenu="conversationMenu($event, thread)" @keydown.shift.f10.prevent="conversationMenu($event, thread)"
                class="tree-row"
                :class="{ current: selectedThreadId === thread.id }"
                :aria-current="selectedThreadId === thread.id ? 'true' : undefined"
                @click="
                  chatVisible = true;
                  chat?.select(thread.id);
                "
              >
                <span
                  class="status-dot"
                  :class="{ live: !!thread.activeRunId }"
                /><span>{{ thread.title }}</span>
              </button>
              <p v-if="!example && !visibleRepoThreads.length" class="nav-hint">
                {{
                  t3Connected
                    ? "No chats in this worktree"
                    : "Connect T3 Code to see chats"
                }}
              </p></template
            >
          </div>
          <div class="nav-section compact">
            <button
              class="section-heading"
              @click="sections.remotes = !sections.remotes"
            >
              <ChevronRight v-if="!sections.remotes" :size="12" /><ChevronDown
                v-else
                :size="12"
              /><Globe :size="13" />REMOTES</button
            ><template v-if="sections.remotes"
              ><BranchTree :key="repo" :nodes="remoteBranchTree" @context="branchMenu" @select="branch => ask('merge', { target: branch.name })" />
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
        <template v-else
          ><p class="section-heading">RECENT REPOSITORIES</p>
          <button
            v-for="path in recent"
            :key="path"
            class="tree-row"
            :title="path"
            @click="w.openRepo(path)"
          >
            <FolderGit2 :size="15" /><span>{{
              path.replaceAll("\\", "/").split("/").at(-1)
            }}</span>
          </button>
          <p v-if="!recent.length" class="nav-hint">
            Your repositories will appear here.
          </p></template
        >
      </div>
      <div class="sidebar-footer">
        <button @click="w.openRepo()">
          <FolderOpen :size="15" />Open repository<kbd>Ctrl O</kbd></button
        ><button v-if="!desktop() && !example" @click="w.showExample()">
          <Layers :size="15" />Explore example workspace
        </button>
        <div>
          <span class="status-dot" :class="{ live: t3Connected }" /><span>{{
            t3Connected ? "T3 Code connected" : "Local workspace"
          }}</span
          ><span class="version">v{{ appVersion }}</span>
        </div>
      </div>
    </aside>
    <main class="workspace">
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
      <template v-if="snapshot">
        <div v-if="snapshot.operation" class="operation-banner">
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
            @click="ask('continue', { mode: snapshot.operation })"
          >
            Continue
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
        <template v-if="view === 'changes'">
          <div class="changes-title">
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
            <section class="files-panel">
              <div class="files-toolbar">
              <div class="segmented">
                <button :class="{ active: mode !== 'branch' }" @click="mode = 'working'">Local changes</button>
                <button :class="{ active: mode === 'branch' }" :disabled="!base" @click="mode = 'branch'">Compare branch</button>
              </div>
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
                <FileList :key="repo" :files="group.files" :tree="filesAsTree" :selected="mode === group.mode ? selected : ''" :mode="group.mode" :editable="!busy && !example && group.mode !== 'branch'" @select="selectFile($event, group.mode)" @toggle-selection="toggleSelectedFiles($event, group.mode)" @toggle-stage="toggleFileStage($event, group.mode)" @toggle-folder="toggleFileStage($event, group.mode, true)" />
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
            </section>
            <section class="review-panel">
              <template v-if="selected"
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
              <div class="commit-box">
                <textarea
                  v-model="commitMessage"
                  aria-label="Commit message"
                  placeholder="Commit message"
                  :disabled="example"
                  @keydown.ctrl.enter.prevent="commit"
                />
                <div class="commit-options">
                  <label
                    ><input
                      v-model="amend"
                      type="checkbox"
                      :disabled="example || !snapshot.head"
                    />Amend last commit</label
                  ><kbd>Ctrl ↵</kbd><span class="staged-count">{{ staged.length }} staged</span>
                </div>
                <button
                  class="primary commit-button"
                  :disabled="
                    busy ||
                    example ||
                    !commitMessage.trim() ||
                    (!staged.length && !amend)
                  "
                  @click="commit"
                >
                  <Check :size="15" />{{
                    amend ? "Amend" : "Commit"
                  }}
                </button>
              </div>
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
          <HistoryList :commits="commits" :selected="selectedCommit?.id" :loading="w.historyLoading.value" :has-more="w.historyHasMore.value" @select="w.selectCommit" @load-more="w.loadHistory()" />
          <div class="commit-detail">
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
        <button class="primary" @click="w.openRepo()">
          <FolderOpen :size="17" />Open a repository<kbd>Ctrl O</kbd></button
        ><button class="text-button" @click="w.showExample()">
          Explore the example workspace<ArrowUpRight :size="14" />
        </button>
        <div class="welcome-features">
          <span><GitCommitHorizontal :size="16" />Thoughtful commits</span
          ><span><Layers :size="16" />Parallel worktrees</span
          ><span><MessageSquare :size="16" />Shared conversations</span>
        </div>
        <div v-if="error" class="inline-error">{{ error }}</div>
      </div>
      <footer class="statusbar">
        <span
          ><span class="status-dot" :class="{ live: !!snapshot }" />{{
            busy
              ? "Working…"
              : example
                ? "Example data"
                : snapshot
                  ? "Watching for changes"
                  : "Ready"
          }}</span
        ><span v-if="notice" :title="notice" class="status-notice">{{
          notice
        }}</span
        ><span v-else-if="snapshot" class="status-notice">{{
          activeAgents.length
            ? `${activeAgents.length} active agent task(s)`
            : "All Git operations stay on your machine"
        }}</span
        ><span>UTF-8</span
        ><span>{{ desktop() ? "Desktop" : "Browser preview" }}</span>
      </footer>
    </main>
    <ContextMenu ref="sidebarMenu" @error="error = $event" />
    <ChatPanel
      :visible="chatVisible"
      v-show="chatVisible"
      ref="chat"
      :context="context"
      :example="example"
      :repo="repo"
      @clear-context="context = ''"
      @select-worktree="openThreadWorktree"
      @threads="receiveThreads"
      @selection="selectedThreadId = $event"
    />
    <Teleport to="body">
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
              ><input
                v-else
                v-model="values[field.key]"
                :disabled="!!rebaseCommits.length"
                required
            /></label>
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
                  danger: dialog === 'reset' && values.mode === 'hard',
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
                        : dialogTitle
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
      <div v-if="conflict" class="modal-backdrop">
        <section
          class="modal conflict-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="conflict-title"
        >
          <div class="modal-heading">
            <h2 id="conflict-title">Resolve conflict · {{ selected }}</h2>
            <button
              class="icon-button"
              aria-label="Close conflict editor"
              @click="conflict = undefined"
            >
              <X :size="18" />
            </button>
          </div>
          <div class="conflict-grid">
            <div>
              <div class="segmented">
                <button
                  v-for="tab in ['base', 'ours', 'theirs']"
                  :key="tab"
                  :class="{ active: conflictTab === tab }"
                  @click="conflictTab = tab"
                >
                  {{ tab }}
                </button>
              </div>
              <pre>{{
                conflict[conflictTab as "base" | "ours" | "theirs"]
              }}</pre>
              <div class="button-row">
                <button class="small" @click="conflict.result = conflict.ours">
                  Use ours</button
                ><button
                  class="small"
                  @click="conflict.result = conflict.theirs"
                >
                  Use theirs
                </button>
              </div>
            </div>
            <label
              >Resolved result<textarea
                v-model="conflict.result"
                spellcheck="false"
              />
            </label>
          </div>
          <div class="modal-footer">
            <span>Edit the result, then mark it resolved and stage it.</span
            ><button @click="conflict = undefined">Cancel</button
            ><button
              class="primary"
              :disabled="
                busy || /^(<<<<<<<|=======|>>>>>>>)/m.test(conflict.result)
              "
              @click="resolveConflict"
            >
              Mark resolved & stage
            </button>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>
