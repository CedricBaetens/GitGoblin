<script setup lang="ts">
import {
  X,
  ChevronLeft,
  ChevronRight,
  Check,
  FileCode2,
  AlertTriangle,
  ArrowDown,
  GitMerge,
} from "lucide-vue-next";
import type { Snapshot, GitRequest } from "~/lib/types";
import {
  conflictBlocks,
  acceptConflict,
  acceptConflictLines,
  hasConflictMarkers,
  conflictSidePreview,
} from "~/lib/conflicts";
interface Conflict {
  base: string;
  ours: string;
  theirs: string;
  result: string;
  fingerprint: string;
  binary: boolean;
  oursExists: boolean;
  theirsExists: boolean;
}
const props = defineProps<{
  snapshot: Snapshot;
  initialPath: string;
  gitOutput?: string;
  read: <T>(action: string, params?: Partial<GitRequest>) => Promise<T>;
  mutate: (action: string, params?: Partial<GitRequest>) => Promise<unknown>;
}>();
const emit = defineEmits<{ close: [] }>();
const path = ref(""),
  current = ref<Conflict>(),
  loading = ref(false),
  error = ref(""),
  details = ref(props.gitOutput || ""),
  discard = ref(false),
  abort = ref(false);
const drafts = reactive(new Map<string, Conflict>()),
  originals = new Map<string, string>();
const files = computed(() =>
  props.snapshot.files.filter((file) => file.conflict),
);
const operation = computed(() => props.snapshot.operation);
const oursLabel = computed(() =>
  operation.value === "rebase" ? "Target branch" : "Current branch",
);
const theirsLabel = computed(() =>
  operation.value === "rebase" ? "Commit being replayed" : "Incoming changes",
);
const blocks = computed(() => conflictBlocks(current.value?.result || ""));
const activeIndex = ref(0),
  selectedOurs = ref<number[]>([]),
  selectedTheirs = ref<number[]>([]);
const resultEditor = ref<{ reveal: (offset: number, end: number) => void }>();
const sourceEditors = ref<{ reveal: (start: number, end: number) => void }[]>(
  [],
);
const previews = computed(() => ({
  ours: conflictSidePreview(
    current.value?.result || "",
    "ours",
    activeIndex.value,
  ),
  theirs: conflictSidePreview(
    current.value?.result || "",
    "theirs",
    activeIndex.value,
  ),
}));
function revealConflict() {
  if (!activeBlock.value) return;
  resultEditor.value?.reveal(activeBlock.value.start, activeBlock.value.end);
  sourceEditors.value.forEach((editor, index) => {
    const preview = index === 0 ? previews.value.ours : previews.value.theirs;
    editor.reveal(preview.start, preview.end);
  });
}
const activeBlock = computed(() => blocks.value[activeIndex.value]);
const resultRange = computed(() =>
  activeBlock.value
    ? {
        start:
          current.value!.result.slice(0, activeBlock.value.start).split("\n")
            .length - 1,
        end:
          current.value!.result.slice(0, activeBlock.value.end).split("\n")
            .length - 2,
      }
    : undefined,
);
const canSave = computed(
  () =>
    !!current.value &&
    !current.value.binary &&
    !hasConflictMarkers(current.value.result),
);
const filename = (file: string) => file.split("/").at(-1) || file;
const directory = (file: string) =>
  file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
watch(
  () => [path.value, loading.value],
  async () => {
    await nextTick();
    if (!loading.value) revealConflict();
  },
);
const dirty = computed(() =>
  [...drafts.values()].some(
    (item) => item.result !== originals.get(item.fingerprint),
  ),
);
watch(
  () => [
    path.value,
    activeBlock.value?.start,
    activeBlock.value?.ours,
    activeBlock.value?.theirs,
  ],
  () => {
    selectedOurs.value = [];
    selectedTheirs.value = [];
  },
);
watch(
  () => blocks.value.length,
  (length) => {
    activeIndex.value = Math.max(0, Math.min(activeIndex.value, length - 1));
  },
);
function toggleLine(side: "ours" | "theirs", line: number) {
  const selection = side === "ours" ? selectedOurs : selectedTheirs;
  selection.value = selection.value.includes(line)
    ? selection.value.filter((index) => index !== line)
    : [...selection.value, line];
}
async function navigate(direction: number) {
  activeIndex.value = Math.max(
    0,
    Math.min(blocks.value.length - 1, activeIndex.value + direction),
  );
  await nextTick();
  revealConflict();
}
function accept(side: "ours" | "theirs" | "both" | "lines") {
  if (!current.value || !activeBlock.value) return;
  current.value.result =
    side === "lines"
      ? acceptConflictLines(
          current.value.result,
          activeBlock.value,
          selectedOurs.value,
          selectedTheirs.value,
        )
      : acceptConflict(current.value.result, activeBlock.value, side);
  void navigate(0);
}
let request = 0;
async function select(file: string) {
  const id = ++request;
  activeIndex.value = 0;
  path.value = file;
  current.value = undefined;
  error.value = "";
  loading.value = true;
  try {
    let item = drafts.get(file);
    if (!item) {
      item = await props.read<Conflict>("conflict", { path: file });
      drafts.set(file, item);
      originals.set(item.fingerprint, item.result);
    }
    if (id === request) current.value = item;
  } catch (e) {
    if (id === request) error.value = String(e);
  } finally {
    if (id === request) loading.value = false;
  }
}
async function resolve(mode = "") {
  if (!current.value || loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    await props.mutate("resolve", {
      path: path.value,
      text: current.value.result,
      fingerprint: current.value.fingerprint,
      mode,
    });
    drafts.delete(path.value);
    current.value = undefined;
    if (files.value[0]) await select(files.value[0].path);
  } catch (e) {
    error.value = String(e);
  } finally {
    loading.value = false;
  }
}
async function run(action: "continue" | "abort") {
  loading.value = true;
  error.value = "";
  abort.value = false;
  try {
    await props.mutate(action, { mode: operation.value });
  } catch (e) {
    if (files.value.length) details.value = String(e);
    else error.value = String(e);
  } finally {
    loading.value = false;
  }
  if (!props.snapshot.operation) emit("close");
  else if (files.value.length) {
    drafts.clear();
    await select(files.value[0]!.path);
  }
}
function close() {
  if (dirty.value) discard.value = true;
  else emit("close");
}
watch(
  () => props.snapshot.root,
  () => emit("close"),
);
onMounted(() => {
  const first =
    files.value.find((file) => file.path === props.initialPath) ||
    files.value[0];
  if (first) void select(first.path);
});
</script>

<template>
  <AppDialog
    title="Resolve conflicts"
    :dismissible="!loading"
    @close="close"
    class="[&_.ours_.active-conflict]:bg-[#8ca4ec24] [&_.ours_.active-conflict]:shadow-[inset_3px_0_#8ca4ec] [&_.theirs_.active-conflict]:bg-[#7bbe9b24] [&_.theirs_.active-conflict]:shadow-[inset_3px_0_#7bbe9b] [&_.empty-block]:[height:clamp(130px,_21vh,_210px)] [&_.empty-block]:flex [&_.empty-block]:flex-col [&_.empty-block]:items-center [&_.empty-block]:justify-center [&_.empty-block]:bg-[#111824] [&_.empty-block]:gap-[7px] [&_.empty-block]:text-center [&_.empty-block>span]:text-[23px] [&_.empty-block>span]:text-[#6c7d98] [&_.empty-block_strong]:text-[12px] [&_.empty-block_strong]:text-[#a6b4cd] [&_.empty-block_p]:text-[11px] [&_.empty-block_p]:text-[#7e8da6]"
  >
    <AppDialogPanel
      class="modal resolver-modal w-[98vw] max-w-[98vw] max-h-[97vh] overflow-hidden p-0 h-[97vh] flex flex-col"
      aria-labelledby="resolver-title"
    >
      <header
        class="resolver-heading flex items-center gap-[14px] pt-[14px] px-[20px] pb-[12px] shrink-0 [&_p]:mt-[5px] [&_p]:text-[#98a5bb] [&_p]:text-[12px] [@media(max-width:750px)]:[&_p]:hidden"
      >
        <div
          class="resolver-heading-icon grid place-items-center w-[44px] h-[44px] bg-[#a6b3ff13] text-[#b1beff] border-[1px] border-solid border-[#a6b3ff28] rounded-[12px]"
        >
          <GitMerge :size="22" />
        </div>
        <div>
          <h2
            class="m-0 text-[18px] [:where(&)]:m-0 [:where(&)]:text-[18px] [:where(&)]:font-semibold"
            id="resolver-title"
          >
            Resolve {{ operation || "Git" }} conflicts
          </h2>
          <p class="m-0">
            Compare both versions above. Build and save your resolved file
            below.
          </p>
        </div>
        <AppButton
          class="resolver-close ml-auto p-[7px]"
          aria-label="Close conflict resolver"
          :disabled="loading"
          @click="close"
        >
          <X :size="18" />
        </AppButton>
      </header>
      <div
        class="resolver-progress flex items-center gap-[18px] pt-0 px-[20px] pb-[12px] border-b-[1px] border-solid border-b-[#303746] shrink-0 [&>span:not(.progress-line)]:flex [&>span:not(.progress-line)]:items-center [&>span:not(.progress-line)]:gap-[8px] [&>span:not(.progress-line)]:text-[12px] [&>span:not(.progress-line)]:text-[#aab6cd] [&_b]:grid [&_b]:place-items-center [&_b]:w-[22px] [&_b]:h-[22px] [&_b]:rounded-full [&_b]:bg-[#35405c] [&_b]:text-[#ccd6ff] [&_b]:text-[11px] [&_em]:[font-style:normal] [&_em]:text-[#8f9bb1] [&_em]:text-[11px] [&_.complete_b]:bg-[#28553e] [&_.complete_b]:text-[#a9e8c3] [&_.ready_b]:bg-[#28553e] [&_.ready_b]:text-[#a9e8c3] [@media(max-width:750px)]:[&_em]:hidden"
      >
        <span :class="{ complete: !files.length }"
          ><b>1</b> Resolve files <em>{{ files.length }} remaining</em></span
        ><span class="progress-line w-[42px] h-[1px] bg-[#394154]" /><span
          :class="{ ready: !files.length }"
          ><b>2</b> Continue {{ operation || "working" }}</span
        >
      </div>
      <div
        v-if="discard"
        class="resolver-alert py-[12px] px-[20px] text-[#ebbbc1] bg-[#b34d581a] text-[12px]"
        role="alert"
      >
        Discard unsaved edits and close?
        <AppButton @click="discard = false">Keep editing</AppButton
        ><AppButton @click="emit('close')"> Discard edits </AppButton>
      </div>
      <div
        v-if="error"
        class="resolver-alert py-[12px] px-[20px] text-[#ebbbc1] bg-[#b34d581a] text-[12px]"
        role="alert"
      >
        {{ error }}
      </div>
      <div
        v-if="files.length"
        class="resolver-layout grid grid-cols-[210px_minmax(0,_1fr)] flex-1 min-h-0 overflow-hidden [&.single-file]:grid-cols-[minmax(0,_1fr)] [@media(max-width:1050px)]:grid-cols-[185px_minmax(0,_1fr)] [@media(max-width:750px)]:grid-cols-[1fr] [@media(max-width:750px)]:overflow-auto"
        :class="{ 'single-file': files.length === 1 }"
      >
        <nav
          aria-label="Conflicted files"
          class="resolver-files border-r-[1px] border-solid border-r-[#303746] bg-[#151a2480] py-[18px] px-[12px] overflow-auto [&_button]:flex [&_button]:items-start [&_button]:gap-[9px] [&_button]:w-full [&_button]:py-[12px] [&_button]:px-[9px] [&_button]:text-left [&_button]:whitespace-normal [&_button]:mb-[6px] [&_button]:border-[1px] [&_button]:border-solid [&_button]:border-[transparent] [&_button>svg]:shrink-0 [&_button>svg]:mt-[2px] [&_button>svg]:text-[#9bacca] [&_button>span:first-of-type]:min-w-0 [&_button>span:first-of-type]:flex-1 [&_strong]:block [&_small]:block [&_em]:block [&_strong]:text-[12px] [&_strong]:[overflow-wrap:anywhere] [&_small]:text-[10px] [&_small]:text-[#8c9ab2] [&_small]:leading-[1.5] [&_small]:mt-[4px] [&_small]:[overflow-wrap:anywhere] [&_em]:text-[#c8b277] [&_em]:text-[10px] [&_em]:mt-[5px] [&_em]:[font-style:normal] [&_.active]:bg-[#a5b3ff13] [&_.active]:[border-color:#a5b3ff38] [.single-file_&]:hidden [@media(max-width:750px)]:max-h-[130px] [@media(max-width:750px)]:[border-right:0]"
        >
          <div
            class="files-heading flex justify-between pt-0 px-[8px] pb-[14px] text-[#8593ab] text-[10px] tracking-[1px] font-semibold [&_span]:tracking-normal"
          >
            FILES TO RESOLVE <span>{{ files.length }}</span>
          </div>
          <AppButton
            class="[.segmented_button&.active]:bg-[#292d38] [.segmented_button&.active]:text-[#d1d8ed] [.segmented_button&.active]:shadow-[0_1px_3px_#0004]"
            v-for="file in files"
            :key="file.path"
            :class="[{ active: path === file.path }]"
            :aria-current="path === file.path ? 'true' : undefined"
            :title="file.path"
            :disabled="loading"
            @click="select(file.path)"
          >
            <FileCode2 :size="16" /><span
              ><strong>{{ filename(file.path) }}</strong
              ><small class="[:where(&)]:text-[11px]">{{
                directory(file.path) || "Repository root"
              }}</small
              ><em
                v-if="
                  drafts.get(file.path)?.result !== undefined &&
                  drafts.get(file.path)?.result !==
                    originals.get(drafts.get(file.path)!.fingerprint)
                "
                >Unsaved changes</em
              ></span
            ><span
              class="file-dot w-[6px] h-[6px] rounded-full bg-[#d5ad66] shrink-0 mt-[6px]"
            />
          </AppButton>
        </nav>
        <main
          class="resolver-editor min-w-0 min-h-0 overflow-auto py-[12px] px-[18px] flex flex-col [&>.syntax-code.editable]:h-auto [&>.syntax-code.editable]:flex-1 [&>.syntax-code.editable]:min-h-[180px] [&>.syntax-code.editable]:[border-color:#46516c] [@media(max-width:750px)]:overflow-visible [@media(max-width:750px)]:p-[14px]"
          :aria-busy="loading"
        >
          <div
            class="file-heading flex [align-items:baseline] gap-[12px] py-[8px] px-[12px] border-b-[1px] border-solid border-b-[var(--line)] min-h-[var(--review-heading-height)] [&>svg]:text-[#8694b4] [&>span:first-of-type]:font-[Consolas,_monospace] [&>span:first-of-type]:text-[11px] [&>span:first-of-type]:flex-1 [&>span:first-of-type]:overflow-hidden [&>span:first-of-type]:text-ellipsis [&>span:first-of-type]:whitespace-nowrap [@media(max-width:1250px)]:p-[10px] [@media(max-width:1250px)]:gap-[6px] [@media(max-width:1250px)]:[&>span:first-of-type]:text-[10px] h-[var(--review-heading-height)] shrink-0 mb-[10px] [&>span]:text-[#7e8ca5] [&>span]:text-[11px] [&>span]:overflow-hidden [&>span]:whitespace-nowrap [&>span]:text-ellipsis [&_h3]:shrink-0 [@media(max-width:750px)]:flex-wrap"
          >
            <h3
              class="m-0 text-[14px] [:where(&)]:m-0 [:where(&)]:text-[16px] [:where(&)]:[font-weight:550]"
            >
              {{ filename(path) }}
            </h3>
            <span :title="path">{{ directory(path) }}</span>
          </div>
          <p v-if="loading" class="loading-message m-0 text-[#8b9bb4]">
            Loading file…
          </p>
          <template v-else-if="current">
            <div
              v-if="current.binary"
              class="resolver-alert py-[12px] px-[20px] text-[#ebbbc1] bg-[#b34d581a] text-[12px]"
            >
              Binary file. Keep one version, or edit externally and reload
              before saving.
            </div>
            <div
              v-else
              class="conflict-navigation shrink-0 flex items-center gap-[12px] mb-[14px]"
            >
              <span
                class="conflict-status flex items-center gap-[6px] text-[#e5c27b] bg-[#d5ad6612] border-[1px] border-solid border-[#d5ad6628] rounded-[5px] py-[5px] px-[8px] text-[11px] whitespace-nowrap [&.resolved]:text-[#8fd1ab]"
                :class="{ resolved: !blocks.length }"
                ><AlertTriangle v-if="blocks.length" :size="14" /><Check
                  v-else
                  :size="14"
                />{{
                  blocks.length
                    ? `Conflict ${activeIndex + 1} of ${blocks.length}`
                    : "Ready to save"
                }}</span
              >
              <span
                class="conflict-help text-[#8f9db5] text-[11px] [@media(max-width:1050px)]:hidden"
                >{{
                  blocks.length
                    ? "Choose a version for this block, or select individual lines."
                    : "Review the result below, then save this file."
                }}</span
              >
              <div
                class="conflict-nav-buttons flex ml-auto gap-[4px] [&_button]:flex [&_button]:items-center [&_button]:gap-[3px] [&_button]:py-[5px] [&_button]:px-[7px] [&_button]:text-[11px]"
              >
                <AppButton
                  aria-label="Previous conflict"
                  :disabled="activeIndex === 0 || !blocks.length"
                  @click="navigate(-1)"
                >
                  <ChevronLeft :size="14" />Previous</AppButton
                ><AppButton
                  aria-label="Next conflict"
                  :disabled="activeIndex >= blocks.length - 1"
                  @click="navigate(1)"
                >
                  Next<ChevronRight :size="14" />
                </AppButton>
              </div>
            </div>
            <div
              class="resolver-sides flex-1 min-h-[180px] grid grid-cols-[repeat(2,_minmax(0,_1fr))] gap-[12px] [@media(max-width:750px)]:grid-cols-[1fr]"
            >
              <section
                v-for="side in ['ours', 'theirs'] as const"
                :key="side"
                class="source-card relative flex flex-col min-w-0 min-h-0 border-[1px] border-solid border-[#354156] rounded-[8px] overflow-hidden bg-[#141b29] [&.ours]:border-t-[2px] [&.ours]:border-solid [&.ours]:border-t-[#899fdf] [&.theirs]:border-t-[2px] [&.theirs]:border-solid [&.theirs]:border-t-[#79bb9d] [&_header]:shrink-0 [&_header]:flex [&_header]:items-center [&_header]:justify-between [&_header]:gap-[8px] [&_header]:py-[11px] [&_header]:px-[12px] [&_header]:bg-[#ffffff03] [&_.syntax-code]:h-full [&_.syntax-code]:min-h-[120px] [&_.syntax-code]:border-0 [&_.syntax-code]:rounded-none"
                :class="side"
              >
                <header>
                  <div>
                    <span
                      class="side-eyebrow block text-[#8290a9] text-[9px] font-semibold tracking-[1.2px] mb-[4px] [.ours_&]:text-[#9caee7] [.theirs_&]:text-[#8bc5a8]"
                      >{{ side === "ours" ? "CURRENT" : "INCOMING" }}</span
                    >
                    <h4 class="m-0 text-[13px]">
                      {{ side === "ours" ? oursLabel : theirsLabel }}
                    </h4>
                  </div>
                  <AppButton
                    v-if="!current.binary"
                    class="accept-block flex items-center gap-[5px] py-[6px] px-[9px] text-[11px] bg-[#a6b3ff12] border-[1px] border-solid border-[#a6b3ff33] whitespace-nowrap"
                    @click="accept(side)"
                  >
                    <Check :size="14" />{{
                      activeBlock && !activeBlock[side]
                        ? "Keep empty block"
                        : "Accept block"
                    }}
                  </AppButton>
                </header>
                <div
                  v-if="activeBlock && !activeBlock[side]"
                  class="empty-block-note absolute left-0 right-0 top-[58px] z-[1] pointer-events-none text-[10px] text-[#96aac4] bg-[#739ac215] py-[5px] px-[12px] shrink-0"
                >
                  No lines on this side of the conflict · accepting keeps this
                  block empty
                </div>
                <SyntaxCode
                  v-if="!current.binary"
                  ref="sourceEditors"
                  :text="activeBlock ? previews[side].text : current[side]"
                  :path="path"
                  :label="side === 'ours' ? oursLabel : theirsLabel"
                  :selectable="!!activeBlock && !!activeBlock[side]"
                  :selectable-range="previews[side].range"
                  :active-range="activeBlock ? previews[side].range : undefined"
                  :selected="
                    (side === 'ours' ? selectedOurs : selectedTheirs).map(
                      (line) => line + previews[side].range.start,
                    )
                  "
                  @toggle="
                    toggleLine(side, $event - previews[side].range.start)
                  "
                />
                <p
                  v-if="
                    !(side === 'ours'
                      ? current.oursExists
                      : current.theirsExists)
                  "
                  class="deleted-message m-0 p-[12px] text-[#d5b383] text-[11px]"
                >
                  File deleted in this version
                </p>
                <AppButton
                  v-if="current.binary"
                  :disabled="
                    !(side === 'ours'
                      ? current.oursExists
                      : current.theirsExists)
                  "
                  @click="resolve(side)"
                >
                  Keep this version & stage
                </AppButton>
              </section>
            </div>
            <template v-if="!current.binary">
              <div
                v-if="activeBlock"
                class="block-actions shrink-0 flex items-center gap-[10px] pt-[11px] px-0 pb-[15px] flex-wrap [&>span]:flex [&>span]:gap-[5px] [&>span]:items-center [&>span]:text-[#7f8da5] [&>span]:text-[10px] [&_button]:text-[11px] [&_button]:border-[1px] [&_button]:border-solid [&_button]:border-[#374158] [&_button]:py-[5px] [&_button]:px-[9px] [&_small]:ml-auto [&_small]:text-[10px] [&_small]:text-[#8797b2] [@media(max-width:750px)]:[&_small]:w-full [@media(max-width:750px)]:[&_small]:m-0"
              >
                <span><ArrowDown :size="14" />Apply to result</span
                ><AppButton @click="accept('both')">
                  Accept both blocks</AppButton
                ><AppButton
                  variant="primary"
                  v-if="selectedOurs.length + selectedTheirs.length"
                  class="primary [border-color:#adbbff]"
                  @click="accept('lines')"
                >
                  Accept
                  {{ selectedOurs.length + selectedTheirs.length }} selected
                  {{
                    selectedOurs.length + selectedTheirs.length === 1
                      ? "line"
                      : "lines"
                  }}</AppButton
                ><small class="[:where(&)]:text-[11px]" v-else
                  >Use + beside a line to select it.</small
                >
              </div>
              <div
                class="result-heading shrink-0 flex items-center justify-between mt-[2px] mx-0 mb-[10px]"
              >
                <div>
                  <span
                    class="side-eyebrow block text-[#8290a9] text-[9px] font-semibold tracking-[1.2px] mb-[4px] [.ours_&]:text-[#9caee7] [.theirs_&]:text-[#8bc5a8]"
                    >RESULT</span
                  >
                  <h4 class="m-0 text-[13px]">Changes to save</h4>
                </div>
                <span
                  class="result-status text-[#c5ab77] text-[10px] [&.resolved]:text-[#8fd1ab]"
                  :class="{ resolved: canSave }"
                  >{{
                    canSave
                      ? "All conflicts resolved"
                      : `${blocks.length || "Some"} unresolved · highlighted below`
                  }}</span
                >
              </div>
              <SyntaxCode
                ref="resultEditor"
                v-model:text="current.result"
                :path="path"
                editable
                label="Resolved result"
                :active-range="resultRange"
              />
              <div
                class="result-tools shrink-0 flex items-start justify-between gap-[10px] pt-[9px] text-[10px] text-[#8797b2] [&>details]:text-right"
              >
                <span>You can edit the result directly.</span>
                <details>
                  <summary>More options · whole file / ancestor</summary>
                  <div
                    class="advanced-actions flex flex-col gap-[7px] py-[10px] px-0 text-left [&_button]:text-[11px]"
                  >
                    <AppButton
                      :disabled="!current.oursExists"
                      @click="current.result = current.ours"
                    >
                      Use entire {{ oursLabel.toLowerCase() }} file</AppButton
                    ><AppButton
                      :disabled="!current.theirsExists"
                      @click="current.result = current.theirs"
                    >
                      Use entire {{ theirsLabel.toLowerCase() }} file
                    </AppButton>
                    <details>
                      <summary>View common ancestor</summary>
                      <SyntaxCode
                        :text="current.base"
                        :path="path"
                        label="Common ancestor"
                      />
                    </details>
                  </div>
                </details>
              </div>
            </template>
            <div
              v-if="
                current.binary || !current.oursExists || !current.theirsExists
              "
              class="special-actions flex gap-[8px] mt-[12px]"
            >
              <AppButton
                v-if="!current.oursExists || !current.theirsExists"
                @click="resolve('delete')"
              >
                Delete file & stage</AppButton
              ><AppButton
                v-if="current.binary"
                @click="
                  drafts.delete(path);
                  select(path);
                "
              >
                Reload external edits</AppButton
              ><AppButton v-if="current.binary" @click="resolve('external')">
                Stage external result
              </AppButton>
            </div>
          </template>
        </main>
      </div>
      <div
        v-else
        class="resolution-complete flex-1 flex flex-col items-center justify-center gap-[14px] text-[#93d2ae] [&_p]:text-[#95a4bb] [&_p]:text-[13px]"
      >
        <Check :size="32" />
        <h3
          class="m-0 text-[14px] [:where(&)]:m-0 [:where(&)]:text-[16px] [:where(&)]:[font-weight:550]"
        >
          All files resolved
        </h3>
        <p class="m-0">
          Your resolutions are saved and staged. Continue
          {{ operation || "working" }} when you’re ready.
        </p>
      </div>
      <details
        v-if="details"
        class="git-output shrink-0 py-[8px] px-[24px] text-[11px] [&_pre]:max-h-[100px] [&_pre]:overflow-auto"
      >
        <summary>Git output</summary>
        <pre
          class="[:where(&)]:font-['Cascadia_Code',_'JetBrains_Mono',_Consolas,_monospace] [:where(&)]:whitespace-pre-wrap [:where(&)]:[word-break:break-word] [:where(&)]:leading-[1.7]"
          >{{ details }}</pre>
      </details>
      <footer
        class="resolver-footer flex items-center gap-[10px] py-[12px] px-[20px] border-t-[1px] border-solid border-t-[#303746] shrink-0 bg-[#1b202b] [&_button]:flex [&_button]:items-center [&_button]:gap-[7px] [@media(max-width:1050px)]:[&>.abort-action]:mr-auto [@media(max-width:750px)]:p-[12px]"
      >
        <template v-if="abort"
          ><span>Abort {{ operation }} and discard resolutions?</span
          ><AppButton @click="abort = false"> Keep resolving</AppButton
          ><AppButton :disabled="loading" @click="run('abort')">
            Confirm abort
          </AppButton></template
        ><template v-else
          ><AppButton
            v-if="operation"
            class="abort-action text-[11px] text-[#a7a1a8]"
            :disabled="loading"
            @click="abort = true"
          >
            Abort {{ operation }}</AppButton
          ><span
            class="footer-hint mr-auto text-[11px] text-[#8c9bb4] [@media(max-width:1050px)]:hidden"
            >{{
              files.length
                ? canSave
                  ? "This file is ready. Saving also stages your changes."
                  : "Resolve this file’s conflicts to save and continue."
                : "All resolutions are staged."
            }}</span
          ><AppButton :disabled="loading" @click="close"> Close</AppButton
          ><AppButton
            variant="primary"
            v-if="files.length && current && !current.binary"
            class="primary save-resolution [border-color:#adbbff] min-w-[148px] justify-center"
            :disabled="loading || !canSave"
            @click="resolve()"
          >
            <Check :size="15" />{{
              files.length > 1 ? "Save & next file" : "Save resolution"
            }}</AppButton
          ><AppButton
            variant="primary"
            v-else-if="operation && !files.length"
            class="primary [border-color:#adbbff]"
            :disabled="loading"
            @click="run('continue')"
          >
            Continue {{ operation }}<ChevronRight :size="15" /></AppButton
        ></template>
      </footer>
    </AppDialogPanel>
  </AppDialog>
</template>
