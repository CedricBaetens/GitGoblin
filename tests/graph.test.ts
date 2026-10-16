import { expect, it } from "vitest";
import { commitGraph } from "../app/lib/graph";
import type { Commit } from "../app/lib/types";
it("splits merge parents and rejoins shared ancestry without inventing a line above a tip", () => {
  const graph = commitGraph([
    { id: "a", parents: "b c" },
    { id: "b", parents: "d" },
    { id: "c", parents: "d" },
    { id: "d", parents: "" },
  ] as Commit[]);
  expect(graph[0]!.above).toEqual([]);
  expect(graph[0]!.edges).toEqual([
    { from: 0, to: 0, color: 0 },
    { from: 0, to: 1, color: 0 },
  ]);
  expect(graph[2]!.lane).toBe(1);
  expect(graph[2]!.edges).toContainEqual({ from: 1, to: 0, color: 1 });
  expect(graph[3]!.edges).toEqual([]);
});
