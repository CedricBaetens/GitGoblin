import type { FileStatus } from "./types";

export function fileChange(file: FileStatus, mode: string) {
  if (file.conflict) return { label: 'Conflict', kind: 'conflicted' };
  const status = mode === 'staged' ? file.index : file.worktree;
  switch (status) {
    case '?':
    case 'A': return { label: 'Added', kind: 'added' };
    case 'D': return { label: 'Removed', kind: 'removed' };
    case 'R': return { label: 'Renamed', kind: 'renamed' };
    case 'C': return { label: 'Copied', kind: 'added' };
    case 'T': return { label: 'Type changed', kind: 'modified' };
    default: return { label: 'Modified', kind: 'modified' };
  }
}

export interface FileNode {
  name: string;
  path: string;
  file?: FileStatus;
  children: FileNode[];
}

export function fileTree(files: FileStatus[]): FileNode[] {
  const root: FileNode[] = [];
  for (const file of files) {
    const parts = file.path.split("/");
    let children = root;
    let path = "";
    for (const [index, name] of parts.entries()) {
      path = path ? `${path}/${name}` : name;
      let node = children.find((node) => node.path === path);
      if (!node) {
        node = { name, path, children: [] };
        children.push(node);
      }
      if (index === parts.length - 1) node.file = file;
      children = node.children;
    }
  }
  const sort = (nodes: FileNode[]) => {
    nodes.sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name));
    nodes.forEach((node) => sort(node.children));
  };
  sort(root);
  return root;
}
