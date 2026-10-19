import { expect, it } from "vitest";
import { fileChange, fileTree } from "../app/lib/files";

it('labels changes using the status of the displayed list, with conflicts taking priority', () => {
  const file = { path: 'file.ts', index: 'A', worktree: 'D', conflict: false };
  expect(fileChange(file, 'working')).toEqual({ label: 'Removed', kind: 'removed' });
  expect(fileChange(file, 'staged')).toEqual({ label: 'Added', kind: 'added' });
  expect(fileChange({ ...file, worktree: '?' }, 'working').label).toBe('Added');
  expect(fileChange({ ...file, worktree: 'M' }, 'working').label).toBe('Modified');
  expect(fileChange({ ...file, index: 'R' }, 'staged').label).toBe('Renamed');
  expect(fileChange({ ...file, conflict: true }, 'staged').label).toBe('Conflict');
});

it("groups changed files by directory, preserves status, and distinguishes equal filenames", () => {
  const files = ["README.md", "src/ui/index.ts", "tests/index.ts", "src/app.ts"].map((path) => ({
    path, index: "M", worktree: " ", conflict: false,
  }));
  const tree = fileTree(files);
  expect(tree.map((node) => node.name)).toEqual(["src", "tests", "README.md"]);
  expect(tree[0]!.children.map((node) => node.name)).toEqual(["ui", "app.ts"]);
  expect(tree[0]!.children[0]!.children[0]!.file).toBe(files[1]);
  expect(tree[1]!.children[0]!.file).toBe(files[2]);
  expect(fileTree([])).toEqual([]);
});
