import { expect, it, vi } from "vitest";
import { createDiffCache } from "../app/lib/diff-cache";

it("shares in-flight reads and makes previously viewed diffs immediately available", async () => {
  const cache = createDiffCache();
  let resolve!: (value: { text: string; fingerprint: string }) => void;
  const read = vi.fn(() => new Promise<{ text: string; fingerprint: string }>((done) => { resolve = done; }));
  const first = cache.load("repo/working/file", read);
  expect(cache.load("repo/working/file", read)).toBe(first);
  expect(read).toHaveBeenCalledTimes(1);
  const diff = { text: "+one", fingerprint: "first" };
  resolve(diff);
  await first;
  expect(cache.get("repo/working/file")).toBe(diff);
  expect(cache.get("repo/staged/file")).toBeUndefined();
});

it("does not restore invalidated entries from requests finishing after a mutation", async () => {
  const cache = createDiffCache();
  let resolve!: (value: { text: string; fingerprint: string }) => void;
  const request = cache.load("file", () => new Promise((done) => { resolve = done; }));
  cache.clear();
  resolve({ text: "old", fingerprint: "old" });
  await request;
  expect(cache.get("file")).toBeUndefined();
  await cache.load("file", async () => ({ text: "new", fingerprint: "new" }));
  expect(cache.get("file")?.text).toBe("new");
});

it("retries failed reads and bounds cached memory", async () => {
  const cache = createDiffCache();
  await expect(cache.load("file", async () => { throw Error("changed"); })).rejects.toThrow("changed");
  for (let i = 0; i < 25; i++) await cache.load(String(i), async () => ({ text: "diff", fingerprint: String(i) }));
  expect(cache.get("0")).toBeUndefined();
  expect(cache.get("24")?.fingerprint).toBe("24");
  await cache.load("large", async () => ({ text: "x".repeat(512_001), fingerprint: "large" }));
  expect(cache.get("large")).toBeUndefined();
});
