import { expect, it } from "vitest";
import { visibleThreads } from "../app/lib/threads";
import type { T3Thread } from "../app/lib/types";

const thread = (id: string, extra: Partial<T3Thread> = {}): T3Thread => ({
  id, title: id, projectId: "project", branch: null, worktreePath: null,
  status: "idle", activeRunId: null, modelSelection: { instanceId: "test", model: "test" },
  runtimeMode: "approval-required", interactionMode: "default",
  createdAt: "2026-10-10T00:00:00Z", ...extra,
});

it("hides settled, archived and deleted conversations, including settlement updates", () => {
  const items = [thread("idle"), thread("settled", { settledOverride: "settled" }),
    thread("archived", { archivedAt: "2026-10-11" }), thread("deleted", { deletedAt: "2026-10-11" })];
  expect(visibleThreads(items).map((t) => t.id)).toEqual(["idle"]);
  items[0] = { ...items[0]!, settledOverride: "settled" };
  expect(visibleThreads(items)).toEqual([]);
  items[1] = { ...items[1]!, settledOverride: "active" };
  expect(visibleThreads(items).map((t) => t.id)).toEqual(["settled"]);
});

it("matches pinned and active ordering regardless of update arrival order", () => {
  const items = [
    thread("active-z", { activeOrderKey: "z" }),
    thread("pin-z", { pinnedAt: "2026-10-11", pinOrderKey: "z" }),
    thread("active-b", { activeOrderKey: "b" }),
    thread("old"),
    thread("returned", { unsettledAt: "2026-10-16" }),
    thread("pin-b", { pinnedAt: "2026-10-11", pinOrderKey: "b" }),
  ];
  const expected = ["pin-b", "pin-z", "returned", "old", "active-b", "active-z"];
  expect(visibleThreads(items).map((t) => t.id)).toEqual(expected);
  expect(visibleThreads([...items].reverse()).map((t) => t.id)).toEqual(expected);
  expect(items[0]!.id).toBe("active-z");
});
