import type { T3Thread } from "./types";

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
