import type { Commit } from "./types";
export interface GraphRow {
  lane: number;
  edges: { from: number; to: number; color: number }[];
  above: { lane: number; color: number }[];
  width: number;
}
export function commitGraph(commits: Commit[]): GraphRow[] {
  let lanes: string[] = [];
  return commits.map((commit) => {
    const incoming = [...lanes];
    if (!lanes.includes(commit.id)) lanes.push(commit.id);
    const before = [...lanes];
    const lane = lanes.indexOf(commit.id);
    const parents = commit.parents.split(" ").filter(Boolean);
    lanes.splice(lane, 1);
    parents.forEach((parent, index) => {
      if (!lanes.includes(parent))
        lanes.splice(Math.min(lane + index, lanes.length), 0, parent);
    });
    const edges = before.flatMap((id, index) =>
      id === commit.id
        ? parents.map((parent) => ({
            from: lane,
            to: lanes.indexOf(parent),
            color: lane,
          }))
        : [{ from: index, to: lanes.indexOf(id), color: index }],
    );
    return {
      lane,
      edges,
      above: incoming.map((_, lane) => ({ lane, color: lane })),
      width: Math.max(before.length, lanes.length, 1),
    };
  });
}
