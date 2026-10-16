import { expect, it } from "vitest";
import { branchTree, comparisonBase } from "../app/lib/branches";
import { demoSnapshot } from "../app/lib/demo";

it("uses an existing comparison branch across repositories", () => {
  const snapshot = {
    ...demoSnapshot,
    branch: "master",
    refs: ["master", "feature"].map((name) => ({
      name: `refs/heads/${name}`, id: "abc", current: name === "master", upstream: "",
    })),
  };
  expect(comparisonBase(snapshot, "main")).toBe("master");
  expect(comparisonBase(snapshot, "feature")).toBe("feature");
  expect(comparisonBase({ ...snapshot, refs: [] }, "main")).toBe("");
});

it("groups nested branches and remotes without losing full refs or current state", () => {
  const refs = ["master", "feature/ui/buttons", "feature/auth", "fix/login"].map((name) => ({
    name: `refs/heads/${name}`, id: name, current: name === "feature/ui/buttons", upstream: "",
  }));
  const tree = branchTree(refs, "refs/heads/");
  expect(tree.map((node) => node.name)).toEqual(["feature", "fix", "master"]);
  expect(tree[0]!.children.map((node) => node.name)).toEqual(["ui", "auth"]);
  expect(tree[0]!.children[0]!.children[0]!.branch).toBe(refs[1]);
  expect(branchTree([{ ...refs[0]!, name: "refs/remotes/origin/feature/ui" }], "refs/remotes/")[0]!.children[0]!.children[0]!.path).toBe("origin/feature/ui");
  expect(branchTree([], "refs/heads/")).toEqual([]);
});
