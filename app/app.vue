<script setup lang="ts">
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
import { commitGraph } from "~/lib/graph";
import { desktop, invoke } from "~/lib/native";
import type { Commit, T3Thread, T3Project, GitRequest } from "~/lib/types";
const w = useWorkbench();
const {
  repo,
  recent,
  snapshot,
  commits,
  selected,
  diff,
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
const chatVisible = ref(true),
  context = ref(""),
  chat = ref<{ select: (id: string) => void; stopAll: () => Promise<void> }>(),
  commitMessage = ref(""),
  amend = ref(false),
  menu = ref(false);
const threads = ref<T3Thread[]>([]),
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
const activeAgents = computed(() =>
  repoThreads.value.filter((t) => t.activeRunId),
);
const additions = computed(
  () =>
    diff.value.text
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++")).length,
);
const graph = computed(() => commitGraph(commits.value));
const graphWidth = computed(() =>
  Math.max(55, ...graph.value.map((row) => row.width * 12 + 15)),
);
const deletions = computed(
  () =>
    diff.value.text
      .split("\n")
      .filter((l) => l.startsWith("-") && !l.startsWith("---")).length,
);
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
  <div class="app-shell" :class="{ 'chat-hidden': !chatVisible }">
    <header class="titlebar">
      <div class="brand">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M4 7l7 3 5-5 5 5 7-3-2 15-10 6L6 22z" fill="currentColor" />
          <path
            d="M10 15l4 2-4 2m12-4l-4 2 4 2"
            fill="none"
            stroke="#101114"
            stroke-width="2"
          /></svg
        ><span>gitgoblin</span><span class="alpha">ALPHA</span>
      </div>
      <div class="titlebar-center">
        <GitBranch :size="13" /><span>{{
          snapshot
            ? `${repoName} / ${snapshot.branch}`
            : "Your code. Your history. Your agents."
        }}</span>
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
              <History :size="16" />Commit history</button
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
              ><button
                v-for="branch in localBranches"
                :key="branch.name"
                class="tree-row"
                :class="{ current: branch.current }"
                :title="branch.name"
                @click="
                  !branch.current &&
                  ask('switch', {
                    target: branch.name.replace('refs/heads/', ''),
                  })
                "
              >
                <GitBranch :size="14" /><span>{{
                  branch.name.replace("refs/heads/", "")
                }}</span
                ><span v-if="branch.current" class="status-dot live" /></button
              ><button class="tree-row subdued" @click="ask('branch-create')">
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
                example ? 2 : repoThreads.length
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
                v-for="thread in repoThreads"
                :key="thread.id"
                class="tree-row"
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
              <p v-if="!example && !repoThreads.length" class="nav-hint">
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
              ><button
                v-for="branch in remoteBranches"
                :key="branch.name"
                class="tree-row"
                @click="ask('merge', { target: branch.name })"
              >
                <GitBranch :size="13" /><span>{{
                  branch.name.replace("refs/remotes/", "")
                }}</span></button
              ><button class="tree-row subdued" @click="ask('remote-add')">
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
          ><span class="version">v0.1.0</span>
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
        <div class="workspace-toolbar">
          <div class="breadcrumb">
            <FolderGit2 :size="15" /><strong>{{ repoName }}</strong
            ><ChevronRight :size="13" /><span>{{
              view === "changes"
                ? "Local changes"
                : view === "history"
                  ? "Commit history"
                  : "Reflog"
            }}</span>
          </div>
          <div class="toolbar-actions">
            <button
              title="Fetch remote changes"
              :disabled="busy || example"
              @click="ask('fetch')"
            >
              <ArrowDownToLine :size="15" /><span>Fetch</span></button
            ><button :disabled="busy || example" @click="ask('pull')">
              <ArrowDownToLine :size="15" /><span>Pull</span></button
            ><button :disabled="busy || example" @click="ask('push')">
              <ArrowUpFromLine :size="15" /><span>Push</span></button
            ><span class="toolbar-divider" /><button
              title="Stash changes"
              :disabled="busy || example"
              @click="ask('stash-save')"
            >
              <Archive :size="15" /></button
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
        </div>
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
              <div class="segmented">
                <button
                  :class="{ active: mode === 'working' }"
                  @click="mode = 'working'"
                >
                  Changes <span>{{ working.length }}</span></button
                ><button
                  :class="{ active: mode === 'staged' }"
                  @click="mode = 'staged'"
                >
                  Staged <span>{{ staged.length }}</span></button
                ><button
                  :class="{ active: mode === 'branch' }"
                  @click="mode = 'branch'"
                >
                  Branch
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
              <div class="file-list">
                <div class="file-list-label">
                  {{
                    mode === "staged"
                      ? "READY TO COMMIT"
                      : mode === "branch"
                        ? "BRANCH CHANGES"
                        : "WORKING DIRECTORY"
                  }}<span>{{ currentFiles.length }}</span>
                </div>
                <button
                  v-for="file in currentFiles"
                  :key="file.path"
                  class="file-row"
                  :class="{ active: selected === file.path }"
                  :title="file.path"
                  @click="selected = file.path"
                >
                  <FileCode2 :size="15" />
                  <div>
                    <span>{{ file.path.split("/").at(-1) }}</span
                    ><small>{{
                      file.path.includes("/")
                        ? file.path.slice(0, file.path.lastIndexOf("/"))
                        : "Repository root"
                    }}</small>
                  </div>
                  <span
                    class="file-status"
                    :class="{
                      added: file.worktree === '?' || file.index === 'A',
                      conflicted: file.conflict,
                    }"
                    >{{
                      file.conflict
                        ? "!"
                        : file.worktree === "?"
                          ? "U"
                          : mode === "staged"
                            ? file.index
                            : file.worktree === " "
                              ? "M"
                              : file.worktree
                    }}</span
                  >
                </button>
                <div v-if="!currentFiles.length" class="small-empty">
                  <Check :size="23" />
                  <p>
                    {{
                      mode === "staged"
                        ? "No staged changes"
                        : "Nothing to review here"
                    }}
                  </p>
                </div>
              </div>
              <div class="commit-box">
                <div class="commit-box-heading">
                  <GitCommitHorizontal :size="16" /><strong>{{
                    amend ? "Amend commit" : "Commit changes"
                  }}</strong
                  ><span>{{ staged.length }} staged</span>
                </div>
                <textarea
                  v-model="commitMessage"
                  aria-label="Commit message"
                  placeholder="A short, meaningful commit message"
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
                  ><kbd>Ctrl ↵</kbd>
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
                    amend ? "Amend commit" : "Commit staged changes"
                  }}
                </button>
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
                    :disabled="busy || example || !diff.fingerprint"
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
                  <span>Unified diff</span>
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
                  :mode="mode"
                  :editable="
                    !busy &&
                    !example &&
                    mode !== 'branch' &&
                    !selectedFile?.conflict
                  "
                  @patch="patch"
                  @context="addContext"
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
              <h1>Commit history</h1>
              <p>The story behind your code</p>
            </div>
            <form class="search-field" @submit.prevent="w.searchHistory()">
              <Search :size="15" /><input
                v-model="search"
                placeholder="Search commit messages…"
                aria-label="Search commits"
              />
            </form>
          </div>
          <div
            class="history-list"
            :style="{ '--graph-width': `${graphWidth}px` }"
          >
            <div class="history-columns">
              <span>GRAPH</span><span>COMMIT</span><span>AUTHOR</span
              ><span>HASH</span>
            </div>
            <button
              v-for="(commit, i) in commits"
              :key="commit.id"
              class="commit-row"
              :class="{ active: selectedCommit?.id === commit.id }"
              @click="w.selectCommit(commit)"
            >
              <HistoryGraph v-if="graph[i]" :row="graph[i]!" /><span
                class="commit-subject"
                >{{ commit.subject
                }}<span v-if="commit.refs" class="ref-label">{{
                  commit.refs
                }}</span></span
              ><span class="commit-author">{{ commit.author }}</span
              ><code>{{ commit.id.slice(0, 7) }}</code>
            </button>
            <p v-if="!commits.length" class="small-empty">
              No matching commits.
            </p>
            <p class="history-limit">
              Showing up to 150 commits. Search to narrow the history.
            </p>
          </div>
          <div v-if="selectedCommit" class="commit-detail">
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
            <DiffViewer
              :text="historyDiff"
              mode="history"
              @context="addContext"
            /></div
        ></template>
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
    <ChatPanel
      v-show="chatVisible"
      ref="chat"
      :context="context"
      :example="example"
      :repo="repo"
      @clear-context="context = ''"
      @select-worktree="openThreadWorktree"
      @threads="receiveThreads"
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
