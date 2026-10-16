import type { FileStatus } from "./types";

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
