import type { Diff } from "./types";

export function createDiffCache() {
  const entries = new Map<string, Diff>();
  const pending = new Map<string, Promise<Diff>>();
  let generation = 0;
  return {
    get: (key: string) => entries.get(key),
    clear() { generation++; entries.clear(); pending.clear(); },
    load(key: string, read: () => Promise<Diff>): Promise<Diff> {
      const existing = pending.get(key);
      if (existing) return existing;
      const current = generation;
      const request = read().then((diff) => {
        if (current === generation && diff.text.length <= 512_000) {
          entries.delete(key);
          entries.set(key, diff);
          if (entries.size > 24) entries.delete(entries.keys().next().value!);
        }
        return diff;
      }).finally(() => {
        if (pending.get(key) === request) pending.delete(key);
      });
      pending.set(key, request);
      return request;
    },
  };
}
