import { expect, it } from "vitest";
import { commitInstruction } from "../app/lib/commit-instruction";

it("gives the commit agent an exact staged snapshot and preserves unstaged work", () => {
  const context = { head: null, staged: ":100644 100644 old new M\tfile.ts\n" };
  const prompt = commitInstruction("D:/my repo", context);
  expect(prompt).toContain('repository "D:/my repo"');
  expect(prompt).toContain(JSON.stringify(context, null, 2));
  expect(prompt).toContain("Do not stage or unstage anything");
  expect(prompt).toContain("immediately before committing");
  expect(prompt).toContain("Preserve unstaged and untracked changes");
});
