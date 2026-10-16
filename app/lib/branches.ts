import type { GitRef, Snapshot } from "./types";

export interface BranchNode {
  name: string;
  path: string;
  branch?: GitRef;
  children: BranchNode[];
}

export function branchTree(refs: GitRef[], prefix: string): BranchNode[] {
  const root: BranchNode[] = [];
  for (const branch of refs) {
    let children = root;
    const parts = branch.name.slice(prefix.length).split("/");
    let path = "";
    for (const [index, name] of parts.entries()) {
      path = path ? `${path}/${name}` : name;
      let node = children.find((node) => node.name === name);
      if (!node) {
        node = { name, path, children: [] };
        children.push(node);
      }
      if (index === parts.length - 1) node.branch = branch;
      children = node.children;
    }
  }
  const sort = (nodes: BranchNode[]): BranchNode[] => nodes.sort((a, b) =>
    Number(!!b.children.length) - Number(!!a.children.length) || a.name.localeCompare(b.name),
  ).map((node) => ({ ...node, children: sort(node.children) }));
  return sort(root);
}

export function comparisonBase(snapshot: Snapshot, preferred: string): string {
  const branches = snapshot.refs
    .filter((ref) => ref.name.startsWith("refs/heads/"))
    .map((ref) => ref.name.slice("refs/heads/".length));
  return [preferred, "main", "master", snapshot.branch].find((name) =>
    branches.includes(name),
  ) || branches[0] || "";
}
