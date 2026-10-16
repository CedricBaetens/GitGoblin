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
it("keeps graph lanes continuous when another history page is appended", () => {
  const commits = Array.from({ length: 600 }, (_, i) => ({ id: String(i), parents: i === 599 ? '' : String(i + 1) })) as Commit[];
  const firstPage = commitGraph(commits.slice(0, 500));
  const full = commitGraph(commits);
  expect(full.slice(0, 500)).toEqual(firstPage);
  expect(full[500]!.above).toEqual([{ lane: 0, color: 0 }]);
  expect(full[499]!.edges).toEqual([{ from: 0, to: 0, color: 0 }]);
});
