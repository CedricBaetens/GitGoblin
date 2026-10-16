import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { open } from "@tauri-apps/plugin-dialog";
import { git, desktop } from "~/lib/native";
import { demoSnapshot, demoCommits, demoDiff } from "~/lib/demo";
import type {
  Snapshot,
  Commit,
  Diff,
  FileStatus,
  GitRequest,
} from "~/lib/types";

export function useWorkbench() {
  const repo = ref(""),
    recent = ref<string[]>([]),
    snapshot = ref<Snapshot>(),
    commits = ref<Commit[]>([]);
  const selected = ref(""),
    diff = ref<Diff>({ text: "", fingerprint: "" }),
    mode = ref("working"),
    base = ref("main");
  const view = ref("changes"),
    search = ref(""),
    busy = ref(false),
    error = ref(""),
    notice = ref(""),
    example = ref(false);
  const branchFiles = ref<string[]>([]),
    selectedCommit = ref<Commit>(),
    historyDiff = ref(""),
    reflog = ref("");
  let timer: ReturnType<typeof setInterval> | undefined,
    generation = 0,
    diffGeneration = 0,
    polling = false;
  const working = computed(
    () =>
      snapshot.value?.files.filter((f) => f.worktree !== " " || f.conflict) ||
      [],
  );
  const staged = computed(
    () =>
      snapshot.value?.files.filter(
        (f) => f.index !== " " && f.index !== "?" && !f.conflict,
      ) || [],
  );
  const currentFiles = computed<FileStatus[]>(() =>
    mode.value === "branch"
      ? branchFiles.value.map((path) => ({
          path,
          index: " ",
          worktree: "M",
          conflict: false,
        }))
      : mode.value === "staged"
        ? staged.value
        : working.value,
  );
  const selectedFile = computed(() =>
    snapshot.value?.files.find((f) => f.path === selected.value),
  );
  async function read<T>(action: string, extra: Partial<GitRequest> = {}) {
    return git<T>({ repo: repo.value, action, ...extra });
  }
  async function loadDiff() {
    const request = ++diffGeneration;
    const file = selected.value;
    if (!file) {
      diff.value = { text: "", fingerprint: "" };
      return;
    }
    if (example.value) {
      diff.value = demoDiff;
      return;
    }
    try {
      const next = await read<Diff>("diff", {
        path: file,
        mode: mode.value,
        target: base.value,
      });
      if (request === diffGeneration) diff.value = next;
    } catch (e) {
      if (request === diffGeneration) {
        diff.value = { text: "", fingerprint: "" };
        error.value = String(e);
      }
    }
  }
  async function refresh(full = false) {
    if (!repo.value || example.value || polling || busy.value) return;
    const request = generation;
    polling = true;
    try {
      const next = await read<Snapshot>("snapshot");
      if (request !== generation) return;
      const changed = next.head !== snapshot.value?.head;
      snapshot.value = next;
      if (mode.value === "branch") {
        const files = await read<string[]>("branch-files", {
          target: base.value,
        });
        if (request !== generation) return;
        branchFiles.value = files;
      }
      if (!currentFiles.value.some((f) => f.path === selected.value))
        selected.value = currentFiles.value[0]?.path || "";
      await loadDiff();
      if (full || changed) {
        const history = await read<Commit[]>("history", { text: search.value });
        if (request === generation) commits.value = history;
      }
    } catch (e) {
      if (request === generation) error.value = String(e);
    } finally {
      polling = false;
    }
  }
  async function openRepo(path?: string) {
    if (busy.value) {
      error.value =
        "Wait for the current Git operation before switching repositories.";
      return;
    }
    if (!desktop()) {
      error.value = "Local repositories require the GitGoblin desktop app.";
      return;
    }
    const result =
      path ||
      (await open({
        directory: true,
        multiple: false,
        title: "Open a Git repository",
      }));
    if (typeof result !== "string") return;
    generation++;
    repo.value = result;
    example.value = false;
    snapshot.value = undefined;
    commits.value = [];
    selected.value = "";
    diff.value = { text: "", fingerprint: "" };
    error.value = "";
    view.value = "changes";
    mode.value = "working";
    // Wait for an older poll to finish before starting a new repository read.
    while (polling) await new Promise((resolve) => setTimeout(resolve, 30));
    await refresh(true);
    const loaded = snapshot.value as Snapshot | undefined;
    if (loaded) {
      repo.value = loaded.root;
      recent.value = [
        repo.value,
        ...recent.value.filter((p) => p !== repo.value),
      ].slice(0, 12);
      localStorage.setItem(
        "gitgoblin.repositories",
        JSON.stringify(recent.value),
      );
    }
  }
  function showExample() {
    generation++;
    example.value = true;
    repo.value = demoSnapshot.root;
    snapshot.value = structuredClone(demoSnapshot);
    commits.value = demoCommits;
    mode.value = "working";
    selected.value = demoSnapshot.files[0]!.path;
    diff.value = demoDiff;
    view.value = "changes";
    error.value = "";
  }
  async function mutate(action: string, extra: Partial<GitRequest> = {}) {
    if (example.value)
      throw new Error(
        "This is an example workspace. Open a real repository in the desktop app to make changes.",
      );
    if (busy.value)
      throw new Error("Wait for the current Git operation to finish.");
    busy.value = true;
    error.value = "";
    notice.value = "";
    try {
      const out = await read<string>(action, extra);
      notice.value = out?.trim() || "Done";
      return out;
    } catch (e) {
      error.value = String(e);
      throw e;
    } finally {
      busy.value = false;
      await refresh(true);
    }
  }
  async function selectCommit(commit: Commit) {
    selectedCommit.value = commit;
    historyDiff.value = "";
    if (example.value) {
      historyDiff.value = demoDiff.text;
      return;
    }
    try {
      const result = await read<string>("commit-diff", { target: commit.id });
      if (selectedCommit.value?.id === commit.id) historyDiff.value = result;
    } catch (e) {
      error.value = String(e);
    }
  }
  async function searchHistory() {
    if (example.value) {
      commits.value = demoCommits.filter((c) =>
        c.subject.toLowerCase().includes(search.value.toLowerCase()),
      );
      return;
    }
    try {
      commits.value = await read<Commit[]>("history", { text: search.value });
    } catch (e) {
      error.value = String(e);
    }
  }
  watch([selected, mode, base], () => void loadDiff());
  watch(mode, async () => {
    if (mode.value === "branch" && !example.value) {
      try {
        branchFiles.value = await read<string[]>("branch-files", {
          target: base.value,
        });
      } catch (e) {
        error.value = String(e);
      }
    }
    selected.value = currentFiles.value[0]?.path || "";
  });
  watch(view, async () => {
    if (view.value === "reflog") {
      if (example.value) {
        reflog.value =
          "f37a21d\tHEAD@{0}\tcommit: Keep conversations and worktrees in sync";
        return;
      }
      try {
        reflog.value = await read<string>("reflog");
      } catch (e) {
        error.value = String(e);
      }
    }
  });
  onMounted(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem("gitgoblin.repositories") || "[]",
      );
      if (Array.isArray(stored))
        recent.value = stored.filter((v) => typeof v === "string");
    } catch {}
    timer = setInterval(() => void refresh(), 2500);
  });
  onUnmounted(() => {
    generation++;
    clearInterval(timer);
  });
  return {
    repo,
    recent,
    snapshot,
    commits,
    selected,
    diff,
    mode,
    base,
    view,
    search,
    busy,
    error,
    notice,
    example,
    working,
    staged,
    currentFiles,
    selectedFile,
    selectedCommit,
    historyDiff,
    reflog,
    openRepo,
    showExample,
    refresh,
    loadDiff,
    read,
    mutate,
    selectCommit,
    searchHistory,
  };
}
