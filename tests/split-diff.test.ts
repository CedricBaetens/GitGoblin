import { expect, it } from "vitest";
import { parseDiff, parseDiffFiles, splitDiffLines, selectedPatch } from "../app/lib/diff";

const patch = "diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1,3 +1,4 @@\n same\n-old\n+new\n+extra\n end\n";

it("aligns replacements, pads insertions and retains original selection indices", () => {
  const lines = parseDiff(patch).hunks[0]!.lines;
  const rows = splitDiffLines(lines);
  expect(rows.map((row) => [row.left?.text, row.right?.text])).toEqual([
    [" same", " same"], ["-old", "+new"], [undefined, "+extra"], [" end", " end"],
  ]);
  expect(rows[1]!.left).toBe(lines[1]);
  expect(rows[1]!.right).toBe(lines[2]);
  const selected = new Set([rows[1]!.left!.index, rows[1]!.right!.index]);
  expect(selectedPatch(patch, selected)).toContain("-old\n+new\n end");
  expect(selectedPatch(patch, selected)).not.toContain("+extra");
});

it("retains missing-newline markers on the correct side", () => {
  const text = "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n";
  const rows = splitDiffLines(parseDiff(text).hunks[0]!.lines);
  expect(rows[0]!.left?.text).toBe("-old");
  expect(rows[0]!.right?.text).toBe("+new");
  expect(rows[1]!.left?.kind).toBe("meta");
  expect(rows[1]!.right?.kind).toBe("meta");
});

it("keeps history files separate and maps selection to the complete diff", () => {
  const text = patch + patch.replaceAll("file", "second");
  const files = parseDiffFiles(text);
  expect(files).toHaveLength(2);
  expect(files[1]!.header).toContain("a/second");
  const added = files[1]!.hunks[0]!.lines.find((line) => line.kind === "add")!;
  expect(text.split("\n")[added.index]).toBe("+new");
  expect(added.index).toBeGreaterThan(files[0]!.hunks[0]!.lines.at(-1)!.index);
  expect(parseDiffFiles("Binary files a/image and b/image differ\n")[0]!.hunks).toEqual([]);
});

it("pads deletions and never pairs changes across context lines", () => {
  const lines = parseDiff("@@ -1,4 +1,2 @@\n-old\n-extra\n same\n+new\n").hunks[0]!.lines;
  expect(splitDiffLines(lines).map((row) => [row.left?.text, row.right?.text])).toEqual([
    ["-old", undefined], ["-extra", undefined], [" same", " same"], [undefined, "+new"],
  ]);
});
