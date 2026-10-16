import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseDiff, selectedPatch } from "../app/lib/diff";
const dirs: string[] = [];
function fixture(content: string) {
  const dir = mkdtempSync(join(tmpdir(), "gitgoblin-patch-"));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  git("init");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(dir, "a file [1].txt"), content);
  git("add", ".");
  git("commit", "-m", "initial");
  return {
    dir,
    git,
    write: (text: string) => writeFileSync(join(dir, "a file [1].txt"), text),
    apply: (patch: string, reverse = false) =>
      execFileSync(
        "git",
        ["apply", "--cached", "--recount", ...(reverse ? ["--reverse"] : [])],
        {
          cwd: dir,
          input: patch,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      ),
  };
}
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
describe("partial staging against real Git indexes", () => {
  it("partially stages a new file", () => {
    const f = fixture("base\n");
    f.write("base\n");
    writeFileSync(join(f.dir, "new.txt"), "one\ntwo\n");
    f.git("add", "-N", "new.txt");
    const diff = f.git("diff", "--", "new.txt");
    const lines = parseDiff(diff).hunks.flatMap((h) => h.lines);
    f.apply(
      selectedPatch(
        diff,
        new Set(lines.filter((l) => l.text === "+two").map((l) => l.index)),
      ),
    );
    expect(f.git("show", ":new.txt")).toBe("two\n");
  });
  it("partially stages a deletion while preserving unselected lines", () => {
    const f = fixture("one\ntwo\nthree\n");
    rmSync(join(f.dir, "a file [1].txt"));
    const diff = f.git("diff");
    const selected = new Set(
      parseDiff(diff)
        .hunks.flatMap((h) => h.lines)
        .filter((l) => l.text === "-two")
        .map((l) => l.index),
    );
    f.apply(selectedPatch(diff, selected));
    expect(f.git("show", ":a file [1].txt")).toBe("one\nthree\n");
  });
  it("partially unstages a new file", () => {
    const f = fixture("base\n");
    writeFileSync(join(f.dir, "new.txt"), "one\ntwo\n");
    f.git("add", "new.txt");
    const diff = f.git("diff", "--cached");
    const selected = new Set(
      parseDiff(diff)
        .hunks.flatMap((h) => h.lines)
        .filter((l) => l.text === "+two")
        .map((l) => l.index),
    );
    f.apply(selectedPatch(diff, selected, true), true);
    expect(f.git("show", ":new.txt")).toBe("one\n");
  });
  it("partially restores a staged deletion", () => {
    const f = fixture("one\ntwo\nthree\n");
    f.git("rm", "--", "a file [1].txt");
    const diff = f.git("diff", "--cached");
    const selected = new Set(
      parseDiff(diff)
        .hunks.flatMap((h) => h.lines)
        .filter((l) => l.text === "-two")
        .map((l) => l.index),
    );
    f.apply(selectedPatch(diff, selected, true), true);
    expect(f.git("show", ":a file [1].txt")).toBe("two\n");
  });
  it("stages one replacement while leaving another in the worktree", () => {
    const f = fixture("one\ntwo\nthree\nfour\n");
    f.write("ONE\ntwo\nTHREE\nfour\n");
    const diff = f.git("diff", "--no-ext-diff");
    const lines = parseDiff(diff).hunks.flatMap((h) => h.lines);
    const selected = new Set(
      lines
        .filter((l) => ["-one", "+ONE"].includes(l.text))
        .map((l) => l.index),
    );
    f.apply(selectedPatch(diff, selected));
    expect(f.git("show", ":a file [1].txt")).toBe("ONE\ntwo\nthree\nfour\n");
    expect(f.git("diff")).toContain("+THREE");
  });
  it("can stage only an added line of a replacement", () => {
    const f = fixture("one\ntwo\n");
    f.write("ONE\ntwo\n");
    const diff = f.git("diff");
    const selected = new Set(
      parseDiff(diff)
        .hunks.flatMap((h) => h.lines)
        .filter((l) => l.text === "+ONE")
        .map((l) => l.index),
    );
    f.apply(selectedPatch(diff, selected));
    expect(f.git("show", ":a file [1].txt")).toBe("one\nONE\ntwo\n");
  });
  it("handles separated hunks after unselected insertions", () => {
    const original =
      Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n") + "\n";
    const f = fixture(original);
    f.write("new line\n" + original.replace("line 24\n", "changed 24\n"));
    const diff = f.git("diff");
    const hunk = parseDiff(diff).hunks.at(-1)!;
    f.apply(
      selectedPatch(
        diff,
        new Set(
          hunk.lines
            .filter((l) => l.kind === "add" || l.kind === "delete")
            .map((l) => l.index),
        ),
      ),
    );
    expect(f.git("show", ":a file [1].txt")).toBe(
      original.replace("line 24\n", "changed 24\n"),
    );
  });
  it("unstages selected changes without removing other staged changes", () => {
    const f = fixture("one\ntwo\nthree\nfour\n");
    f.write("ONE\ntwo\nTHREE\nfour\n");
    f.git("add", ".");
    const diff = f.git("diff", "--cached");
    const selected = new Set(
      parseDiff(diff)
        .hunks.flatMap((h) => h.lines)
        .filter((l) => ["-one", "+ONE"].includes(l.text))
        .map((l) => l.index),
    );
    f.apply(selectedPatch(diff, selected, true), true);
    expect(f.git("show", ":a file [1].txt")).toBe("one\ntwo\nTHREE\nfour\n");
  });
  it("preserves missing final newline", () => {
    const f = fixture("one\ntwo");
    f.write("one\nTWO");
    const diff = f.git("diff");
    const selected = new Set(
      parseDiff(diff)
        .hunks.flatMap((h) => h.lines)
        .filter((l) => l.kind === "add" || l.kind === "delete")
        .map((l) => l.index),
    );
    f.apply(selectedPatch(diff, selected));
    expect(f.git("show", ":a file [1].txt")).toBe("one\nTWO");
  });
  it("rejects an empty selection", () =>
    expect(() =>
      selectedPatch("diff --git a/a b/a\n@@ -1 +1 @@\n-a\n+b\n", new Set()),
    ).toThrow("Select"));
});
