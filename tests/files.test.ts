import { expect, it } from "vitest";
import { fileTree } from "../app/lib/files";

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
