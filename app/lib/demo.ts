import type { Snapshot, Commit, Diff } from "./types";
export const demoSnapshot: Snapshot = {
  root: "D:/projects/gitgoblin",
  branch: "feat/agent-workspace",
  head: "f37a21d",
  operation: "",
  files: [
    {
      path: "app/components/ChatPanel.vue",
      index: " ",
      worktree: "M",
      conflict: false,
    },
    { path: "app/lib/t3.ts", index: " ", worktree: "M", conflict: false },
    { path: "app/assets/main.css", index: "M", worktree: " ", conflict: false },
    {
      path: "app/lib/worktrees.ts",
      index: "?",
      worktree: "?",
      conflict: false,
    },
  ],
  refs: [
    {
      name: "refs/heads/feat/agent-workspace",
      id: "f37a21d",
      current: true,
      upstream: "origin/feat/agent-workspace",
    },
    {
      name: "refs/heads/main",
      id: "c8f091a",
      current: false,
      upstream: "origin/main",
    },
    {
      name: "refs/heads/fix/diff-scroll",
      id: "940e42f",
      current: false,
      upstream: "",
    },
    {
      name: "refs/remotes/origin/main",
      id: "c8f091a",
      current: false,
      upstream: "",
    },
    { name: "refs/tags/v0.1.0", id: "c8f091a", current: false, upstream: "" },
  ],
  worktrees: [
    { path: "D:/projects/gitgoblin", branch: "feat/agent-workspace" },
    { path: "D:/projects/gitgoblin-scroll", branch: "fix/diff-scroll" },
  ],
  stashes: "stash@{0}\tOn main: work in progress",
  remotes: "origin\thttps://github.com/example/gitgoblin.git (fetch)",
};
export const demoCommits: Commit[] = [
  {
    id: "f37a21d86d72b791",
    parents: "2a9c40e",
    author: "You",
    date: "2026-10-16T10:42:00Z",
    refs: "HEAD -> feat/agent-workspace",
    subject: "Keep conversations and worktrees in sync",
  },
  {
    id: "2a9c40e42b6fe90d",
    parents: "c8f091a",
    author: "You",
    date: "2026-10-16T09:18:00Z",
    refs: "",
    subject: "Preserve diff position when files change",
  },
  {
    id: "c8f091a5264dfa88",
    parents: "940e42f",
    author: "You",
    date: "2026-10-15T16:30:00Z",
    refs: "origin/main, main",
    subject: "Add a quieter, more focused workspace",
  },
  {
    id: "940e42f5ae903712",
    parents: "2dd0199",
    author: "You",
    date: "2026-10-15T14:22:00Z",
    refs: "",
    subject: "Stage individual changes from the diff",
  },
  {
    id: "2dd01995c93b1249",
    parents: "",
    author: "You",
    date: "2026-10-14T11:00:00Z",
    refs: "",
    subject: "Create the GitGoblin desktop shell",
  },
];
export const demoDiff: Diff = {
  fingerprint: "example",
  text: "diff --git a/app/components/ChatPanel.vue b/app/components/ChatPanel.vue\nindex 20bd345..71a342e 100644\n--- a/app/components/ChatPanel.vue\n+++ b/app/components/ChatPanel.vue\n@@ -1,9 +1,15 @@\n <script setup lang=\"ts\">\n import { computed } from 'vue'\n-import { useChat } from '~/composables/useChat'\n+import { useConversation } from '~/composables/useConversation'\n \n-const { messages } = useChat()\n+const { messages, activeThread, connection } = useConversation()\n+const isWorking = computed(() => activeThread.value?.status === 'running')\n+\n+function focusWorktree() {\n+  emit('select-worktree', activeThread.value?.worktreePath)\n+}\n </script>\n \n <template>\n-  <section class=\"chat\">\n+  <section class=\"conversation\" :aria-busy=\"isWorking\">\n+    <ConnectionStatus :status=\"connection\" />\n",
};
