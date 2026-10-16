import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const binary = resolve(
  "src-tauri/target/debug",
  process.platform === "win32" ? "gitgoblin.exe" : "gitgoblin",
);
assert(
  existsSync(binary),
  "Build the debug desktop binary before running the native smoke test.",
);
const temporary = mkdtempSync(join(tmpdir(), "gitgoblin-native-"));
const repo = join(temporary, "repo");
execFileSync("git", ["init", "-b", "main", repo], { stdio: "pipe" });
const git = (...args) =>
  execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
const call = (action, extra = {}) => {
  const result = spawnSync(binary, ["--git-request"], {
    input: JSON.stringify({ repo, action, ...extra }),
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `${action}: ${result.stdout || result.stderr}`,
  );
  return JSON.parse(result.stdout).ok;
};
const commit = (content, message) => {
  writeFileSync(join(repo, "file.txt"), content);
  const diff = call("diff", { path: "file.txt", mode: "working" });
  call("stage", { path: "file.txt", fingerprint: diff.fingerprint });
  call("commit", { text: message });
  return git("rev-parse", "HEAD");
};
try {
  git("config", "user.name", "GitGoblin Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  git("config", "core.hooksPath", ".git/no-test-hooks");
  const first = commit("one\n", "Initial");
  const second = commit("two\n", "Second");
  assert.equal(call("history").length, 2);
  call("revert", { target: second });
  assert.equal(readFileSync(join(repo, "file.txt"), "utf8"), "one\n");
  call("reset", { target: second, mode: "hard" });
  assert.equal(readFileSync(join(repo, "file.txt"), "utf8"), "two\n");
  writeFileSync(join(repo, "file.txt"), "uncommitted\n");
  call("stash-save", { text: "Saved work" });
  assert.equal(readFileSync(join(repo, "file.txt"), "utf8"), "two\n");
  call("stash-apply", { target: "stash@{0}" });
  assert.equal(readFileSync(join(repo, "file.txt"), "utf8"), "uncommitted\n");
  call("reset", { target: second, mode: "hard" });
  call("branch-create", { text: "feature", target: first });
  call("switch", { target: "feature" });
  call("cherry-pick", { target: second });
  assert.equal(readFileSync(join(repo, "file.txt"), "utf8"), "two\n");
  commit("three\n", "Third");
  const plan = call("rebase-plan", { target: first });
  assert.equal(plan.length, 2);
  call("rebase", {
    target: first,
    text: `pick ${plan[0].id}\nfixup ${plan[1].id}\n`,
  });
  assert.equal(git("rev-list", "--count", `${first}..HEAD`), "1");
  assert.equal(readFileSync(join(repo, "file.txt"), "utf8"), "three\n");
  call("tag-create", { text: "test-tag", target: "HEAD" });
  assert(
    call("snapshot").refs.some((ref) => ref.name === "refs/tags/test-tag"),
  );
  call("worktree-add", {
    path: join(temporary, "worktree"),
    text: "parallel",
    target: "HEAD",
  });
  assert.equal(call("snapshot").worktrees.length, 2);
  assert(call("reflog").includes("Initial"));
  console.log(
    "Native smoke test passed: staging, commits, history, revert, reset, stash, branches, cherry-pick, interactive rebase, tags, worktrees, and reflog.",
  );
} finally {
  // Only the unique directory created above is removed; no user repository is touched.
  rmSync(temporary, { recursive: true, force: true });
}
