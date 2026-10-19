import type { T3Project, T3Thread } from "./types";

export const repositoryThreadKey = (path: string) => path.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
export function repositoryThreads(threads: T3Thread[], projects: T3Project[], repo: string) {
  if (!repo) return [];
  return threads.filter(thread => repositoryThreadKey(thread.worktreePath || projects.find(project => project.id === thread.projectId)?.workspaceRoot || '') === repositoryThreadKey(repo));
}
export function repositoryThreadSelection(threads: T3Thread[], remembered?: string) {
  const available = visibleThreads(threads);
  return available.find(thread => thread.id === remembered)?.id || available[0]?.id || '';
}
export const isThreadRunning = (thread: T3Thread) => !!thread.activeRunId || ['starting', 'running', 'busy'].includes(thread.status);

const timestamp = (value?: string | null) => Date.parse(value || "") || 0;

// Match T3's pinned and active sidebar ordering, independent of stream arrival.
export function visibleThreads(threads: T3Thread[]): T3Thread[] {
  return threads.filter((thread) =>
    thread.settledOverride !== "settled" && !thread.archivedAt && !thread.deletedAt,
  ).sort((a, b) => {
    const pinned = !!a.pinnedAt;
    if (pinned !== !!b.pinnedAt) return pinned ? -1 : 1;
    const aKey = pinned ? a.pinOrderKey : a.activeOrderKey;
    const bKey = pinned ? b.pinOrderKey : b.activeOrderKey;
    if (aKey != null && bKey == null) return pinned ? -1 : 1;
    if (aKey == null && bKey != null) return pinned ? 1 : -1;
    if (aKey != null && bKey != null)
      return (aKey < bKey ? -1 : aKey > bKey ? 1 : 0) || a.id.localeCompare(b.id);
    const anchor = (thread: T3Thread) => Math.max(
      timestamp(thread.createdAt), pinned ? 0 : timestamp(thread.unsettledAt),
    );
    return anchor(b) - anchor(a) || a.id.localeCompare(b.id);
  });
}
