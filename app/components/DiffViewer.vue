<script setup lang="ts">
import type { ContextMenuHandle } from "~/lib/context-menu";
import {
  computed,
  ref,
  shallowRef,
  watch,
  onMounted,
  onUnmounted,
  nextTick,
} from "vue";
import { Check, MessageSquarePlus, LoaderCircle } from "lucide-vue-next";
import { parseDiffFiles, splitDiffLines, selectedPatch } from "~/lib/diff";
import { diffWindow, type DiffChange } from "~/lib/diff-window";
import { diffFileStatus } from "~/lib/diff-files";
import type { DiffSyntax } from "~/lib/syntax";
const props = defineProps<{
  text: string;
  mode: string;
  path?: string;
  editable?: boolean;
  loading?: boolean;
  disabled?: boolean;
  wholeFile?: boolean;
}>();
const syntax = shallowRef<DiffSyntax>({});
const scroller = ref<HTMLElement>();
let worker: Worker | undefined;
let syntaxRequest = 0;
function highlight() {
  syntax.value = {};
  const id = ++syntaxRequest;
  worker?.postMessage({ id, text: props.text, path: props.path || "" });
}
onMounted(() => {
  try {
    worker = new Worker(new URL("../lib/syntax.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = ({ data }) => {
      if (data.id === syntaxRequest) syntax.value = data.tokens;
    };
    highlight();
  } catch {
    /* Plain text remains usable when workers are unavailable. */
  }
});
onUnmounted(() => worker?.terminate());
watch(() => [props.text, props.path], highlight);
const emit = defineEmits<{
  patch: [text: string];
  context: [text: string];
  editContext: [text: string];
  "update:wholeFile": [value: boolean];
}>();
const selectionMenu = ref<ContextMenuHandle>();
let editSelection = "";
async function openSelectionMenu(event: MouseEvent) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed || !scroller.value)
    return;
  const selectedRange = selection.getRangeAt(0);
  if (
    !scroller.value.contains(selectedRange.startContainer) ||
    !scroller.value.contains(selectedRange.endContainer)
  )
    return;
  const snippets: string[] = [];
  let location = "";
  for (const code of scroller.value.querySelectorAll(".diff-line code")) {
    if (!selectedRange.intersectsNode(code)) continue;
    const range = document.createRange();
    range.selectNodeContents(code);
    if (selectedRange.compareBoundaryPoints(Range.START_TO_START, range) > 0)
      range.setStart(selectedRange.startContainer, selectedRange.startOffset);
    if (selectedRange.compareBoundaryPoints(Range.END_TO_END, range) < 0)
      range.setEnd(selectedRange.endContainer, selectedRange.endOffset);
    const text = range.toString();
    if (!text) continue;
    const row = code.closest(".diff-line")!;
    const source =
      row.classList.contains("delete") ||
      (row.classList.contains("split-cell") &&
        row === row.parentElement?.firstElementChild)
        ? "Original"
        : "Modified";
    const file =
      code.closest(".hunk")?.getAttribute("data-file") || props.path || "";
    const next = `${file} (${source}, ${props.mode} diff)`;
    if (next !== location) {
      snippets.push(`\n${next}:`);
      location = next;
    }
    snippets.push(text);
  }
  if (!snippets.length) return;
  event.preventDefault();
  editSelection = `Selected code for the requested edit. Original/deleted lines may no longer exist in the current file.\n${snippets.join("\n")}`;
  selectionMenu.value?.open(event, [
    { label: "Ask T3 to edit selection", run: editInChat },
  ]);
}
function editInChat() {
  selectionMenu.value?.close();
  emit("editContext", editSelection);
}
const scroll = ref(0),
  viewportHeight = ref(600);
function onScroll() {
  if (scroller.value) {
    scroll.value = scroller.value.scrollTop;
    viewportHeight.value = scroller.value.clientHeight;
  }
}
let resize: ResizeObserver | undefined;
onMounted(() => {
  resize = new ResizeObserver(onScroll);
  if (scroller.value) resize.observe(scroller.value);
});
onUnmounted(() => resize?.disconnect());
const parsed = computed(() => parseDiffFiles(props.text));
const selectedFile = ref("");
const navigationFiles = computed(() => parsed.value.flatMap(file => {
  const status = diffFileStatus(file.header);
  return status ? [status] : [];
}));
const displayed = computed(() => selectedFile.value
  ? parsed.value.filter(file => diffFileStatus(file.header)?.path === selectedFile.value)
  : parsed.value);
watch(() => [props.path, props.mode], () => { selectedFile.value = ""; });
watch(navigationFiles, (files) => {
  if (!files.some(file => file.path === selectedFile.value)) selectedFile.value = "";
});
watch(selectedFile, async () => {
  selected.value = new Set();
  await nextTick();
  if (scroller.value) scroller.value.scrollTop = 0;
  onScroll();
});
const wrapLines = ref(false);
const fontSize = ref(11);
const rowHeight = computed(() => fontSize.value + 12);
onMounted(() => {
  try {
    const saved = Number(localStorage.getItem("gitgoblin.diffFontSize"));
    if (Number.isInteger(saved) && saved >= 9 && saved <= 20)
      fontSize.value = saved;
  } catch {
    /* Keep the default when storage is unavailable. */
  }
});
watch(fontSize, async (size) => {
  try {
    localStorage.setItem("gitgoblin.diffFontSize", String(size));
  } catch {
    /* Keep the size in memory. */
  }
  await nextTick();
  onScroll();
});
const layout = ref("split");
const horizontalScroll = ref({ left: 0, right: 0 });
const horizontalWidth = ref({ left: 0, right: 0 });
function scrollSide(side: "left" | "right", event: Event) {
  horizontalScroll.value[side] = (
    event.currentTarget as HTMLElement
  ).scrollLeft;
}
let horizontalResize: ResizeObserver | undefined;
watch(
  () => [props.text, selectedFile.value, layout.value, wrapLines.value, fontSize.value],
  async () => {
    await nextTick();
    horizontalResize?.disconnect();
    horizontalResize = new ResizeObserver(() => {
      for (const side of ["left", "right"] as const) {
        const bar = scroller.value?.parentElement?.querySelector<HTMLElement>(
          `[data-scroll-side="${side}"]`,
        );
        horizontalWidth.value[side] = bar?.scrollWidth || 0;
      }
    });
    for (const content of scroller.value?.parentElement?.querySelectorAll(
      ".side-scrollbar code",
    ) || [])
      horizontalResize.observe(content);
  },
  { immediate: true, flush: "post" },
);
onUnmounted(() => horizontalResize?.disconnect());
// Wrapped rows have variable heights, so render them without fixed-height windowing.
const large = computed(
  () =>
    !wrapLines.value &&
    displayed.value.reduce(
      (n, f) => n + f.hunks.reduce((n, h) => n + h.lines.length, 0),
      0,
    ) > 500,
);
const geometry = computed(() => {
  let offset = 0,
    width = 0;
  const longest = { left: "", right: "" };
  const changes: DiffChange[] = [];
  const files = displayed.value.map((file) => {
    if (displayed.value.length > 1) offset += 32;
    if (layout.value === "split" && file.hunks.length) offset += 29;
    const plainHeight =
      (file.header || "No text changes to display.").split("\n").length * 20 +
      24;
    if (!file.hunks.length) offset += plainHeight;
    const hunks = file.hunks.map((hunk) => {
      offset += 50;
      const top = offset;
      const rows = layout.value === "split" ? splitDiffLines(hunk.lines) : [];
      for (const row of rows)
        for (const side of ["left", "right"] as const) {
          const line = row[side];
          const text = (
            line?.kind === "meta" ? line.text : line?.text.slice(1) || ""
          ).replace(/\t/g, "  ");
          if (text.length > longest[side].length) longest[side] = text;
        }
      const lines =
        layout.value === "split"
          ? rows.map((row) => [row.left, row.right])
          : hunk.lines.map((line) => [line]);
      lines.forEach((pair, i) =>
        pair.forEach((line) => {
          if (!line) return;
          width = Math.max(width, line.text.replace(/\t/g, "  ").length);
          if (line.kind === "add" || line.kind === "delete")
            changes.push({
              offset: top + i * rowHeight.value,
              height: rowHeight.value,
              kind: line.kind,
              line: String(line.next || line.old),
            });
        }),
      );
      offset += lines.length * rowHeight.value;
      return { ...hunk, rows, top, count: lines.length };
    });
    return { ...file, hunks, plainHeight };
  });
  return {
    files,
    changes,
    longest,
    width: width * fontSize.value * 0.61 + 125,
  };
});
const files = computed(() =>
  geometry.value.files.map((file) => ({
    ...file,
    hunks: file.hunks.map((hunk) => {
      const window = large.value
        ? diffWindow(
            hunk.count,
            hunk.top,
            scroll.value,
            viewportHeight.value,
            rowHeight.value,
          )
        : { start: 0, end: hunk.count, before: 0, after: 0 };
      return {
        ...hunk,
        window,
        visibleLines: hunk.lines.slice(window.start, window.end),
        visibleRows: hunk.rows.slice(window.start, window.end),
      };
    }),
  })),
);
let jumpToChangePending = false;
watch(
  () =>
    [
      props.path,
      props.mode,
      props.wholeFile,
      props.text,
      props.loading,
    ] as const,
  async (current, previous) => {
    if (
      !previous ||
      current.slice(0, 3).some((value, i) => value !== previous[i])
    )
      jumpToChangePending = !!props.wholeFile;
    if (!jumpToChangePending || props.loading || !props.text) return;
    await nextTick();
    const el = scroller.value;
    if (!jumpToChangePending || !props.wholeFile || props.loading || !el)
      return;
    jumpToChangePending = false;
    // Virtualized changes may be outside the DOM; wrapped rows need measured positions.
    const row = el.querySelector<HTMLElement>(
      ".diff-line.add, .diff-line.delete",
    );
    const offset = large.value
      ? geometry.value.changes[0]?.offset
      : row
        ? row.getBoundingClientRect().top -
          el.getBoundingClientRect().top +
          el.scrollTop
        : undefined;
    if (offset === undefined) return;
    el.scrollTop = Math.max(0, offset - el.clientHeight / 3);
    onScroll();
  },
  { immediate: true, flush: "post" },
);
const selected = ref(new Set<number>());
const error = ref("");
watch(
  () => props.text,
  () => {
    selectionMenu.value?.close();
    selected.value = new Set();
    error.value = "";
    horizontalScroll.value = { left: 0, right: 0 };
  },
);
function toggle(index: number) {
  const next = new Set(selected.value);
  next.has(index) ? next.delete(index) : next.add(index);
  selected.value = next;
}
function stage(indices?: number[]) {
  try {
    emit(
      "patch",
      selectedPatch(
        props.text,
        indices ? new Set(indices) : selected.value,
        props.mode === "staged",
      ),
    );
    error.value = "";
  } catch (e) {
    error.value = String(e);
  }
}
function context() {
  const lines = props.text.split("\n");
  emit(
    "context",
    selected.value.size
      ? [...selected.value]
          .sort((a, b) => a - b)
          .map((i) => lines[i])
          .join("\n")
      : selectedFile.value
        ? props.text.split(/(?=^diff --git )/m).find(part => diffFileStatus(part)?.path === selectedFile.value) || props.text
        : props.text,
  );
}
</script>
<template>
  <AppCodeSurface
    class="diff-view flex flex-col min-h-0 flex-1"
    :style="{
      '--diff-font-size': `${fontSize}px`,
      '--diff-row-height': `${rowHeight}px`,
    }"
    :class="{
      'side-by-side': layout === 'split',
      'large-diff': large,
      'wrap-lines': wrapLines,
    }"
  >
    <div
      class="diff-actions min-h-[35px] flex items-center gap-[8px] py-[6px] px-[12px] text-[#616b7e] text-[9px] [&>span]:flex-1 [&_.small]:text-[9px] [&_.small]:[border-color:transparent] [&_.small]:text-[#8e9ab2] [@media(max-width:1250px)]:[&>span]:hidden [@media(max-width:1100px)]:flex-wrap"
    >
      <div
        class="diff-layout flex shrink-0 border-[1px] border-solid border-[var(--line)] rounded-[5px] p-[2px] [&_button]:py-[3px] [&_button]:px-[7px] [&_button]:text-[10px] [&_button]:rounded-[3px] [&_button[aria-pressed='true']]:bg-[#2a3244] [&_button[aria-pressed='true']]:text-[#c1cfff]"
        role="group"
        aria-label="Diff layout"
      >
        <AppButton
          :aria-pressed="layout === 'unified'"
          @click="layout = 'unified'"
        >
          Unified
        </AppButton>
        <AppButton :aria-pressed="layout === 'split'" @click="layout = 'split'">
          Side by side
        </AppButton>
      </div>
      <AppButton
        class="small wrap-toggle text-[11px] py-[4px] px-[7px] [border-color:#30343f] rounded-[4px] [&[aria-pressed='true']]:bg-[#2a3244] [&[aria-pressed='true']]:text-[#c1cfff]"
        :aria-pressed="wrapLines"
        @click="wrapLines = !wrapLines"
      >
        Wrap lines
      </AppButton>
      <AppButton
        v-if="wholeFile !== undefined"
        class="small text-[11px] py-[4px] px-[7px] [border-color:#30343f] rounded-[4px]"
        :aria-pressed="wholeFile"
        @click="emit('update:wholeFile', !wholeFile)"
      >
        Whole file
      </AppButton>
      <div
        class="diff-font-controls flex items-center shrink-0 gap-[3px] [&_output]:min-w-[28px] [&_output]:text-center [&_output]:text-[10px]"
        role="group"
        aria-label="Diff font size"
      >
        <AppButton
          class="small text-[11px] py-[4px] px-[7px] [border-color:#30343f] rounded-[4px]"
          aria-label="Decrease diff font size"
          title="Decrease diff font size"
          :disabled="fontSize <= 9"
          @click="fontSize--"
        >
          A−
        </AppButton>
        <output aria-label="Diff font size" aria-live="polite"
          >{{ fontSize }}px</output
        >
        <AppButton
          class="small text-[11px] py-[4px] px-[7px] [border-color:#30343f] rounded-[4px]"
          aria-label="Increase diff font size"
          title="Increase diff font size"
          :disabled="fontSize >= 20"
          @click="fontSize++"
        >
          A+
        </AppButton>
      </div>
      <LoaderCircle
        class="spin diff-loading animate-spin [visibility:hidden] shrink-0 [&.visible]:[visibility:visible]"
        :class="{ visible: loading }"
        :size="13"
        :aria-hidden="!loading"
        aria-label="Refreshing diff"
      />
      <span>{{
        selected.size
          ? `${selected.size} lines selected`
          : "Select changed lines to stage or discuss"
      }}</span
      ><AppButton
        v-if="editable && selected.size"
        class="small text-[11px] py-[4px] px-[7px] [border-color:#30343f] rounded-[4px]"
        :disabled="disabled || loading"
        @click="stage()"
      >
        <Check :size="13" />{{
          mode === "staged" ? "Unstage" : "Stage"
        }}
        selection</AppButton
      ><AppButton
        class="small text-[11px] py-[4px] px-[7px] [border-color:#30343f] rounded-[4px]"
        @click="context"
      >
        <MessageSquarePlus :size="14" />Add to chat
      </AppButton>
    </div>
    <div
      v-if="error"
      class="inline-error text-[#e4a6b0] bg-[#472b343f] py-[10px] px-[12px] text-[11px] leading-[1.7] whitespace-pre-wrap [overflow-wrap:anywhere]"
    >
      {{ error }}
    </div>
    <div class="diff-body flex min-h-0 flex-1 [&_.diff-scroll]:min-w-0">
      <DiffFileNavigator v-if="navigationFiles.length > 1" :files="navigationFiles" :selected="selectedFile" @select="selectedFile = $event" />
      <div class="diff-main flex flex-col flex-1 min-w-0 min-h-0 relative">
        <div
          v-if="loading && !text"
          class="diff-pending absolute inset-0 z-[1] flex flex-col items-center justify-center gap-[10px] bg-[#171c26] text-[#96a3ba] pointer-events-none"
          role="status"
        >
          <LoaderCircle :size="22" class="spin animate-spin" /><span
            >Loading changes...</span
          >
        </div>
        <div
          ref="scroller"
          class="diff-scroll overflow-auto flex-1 min-h-0 pb-[30px] [overflow-anchor:none] [.side-by-side_&]:overflow-x-hidden"
          @contextmenu="openSelectionMenu"
          @scroll="onScroll"
        >
          <div
            class="diff-content"
            :style="
              large && layout !== 'split'
                ? { minWidth: `${geometry.width}px` }
                : undefined
            "
          >
            <template v-for="(file, fileIndex) in files" :key="fileIndex">
              <div
                v-if="files.length > 1"
                class="diff-file-label [.large-diff_&]:h-[32px] [.large-diff_&]:whitespace-nowrap py-[9px] px-[12px] text-[#bac7e0] text-[11px] bg-[#1b2030] [overflow-wrap:anywhere]"
              >
                {{ diffFileStatus(file.header)?.path || file.header.split("\n")[0] }}
              </div>
              <div
                v-if="layout === 'split' && file.hunks.length"
                class="split-labels [.large-diff_&]:h-[29px] grid grid-cols-[minmax(0,_1fr)_minmax(0,_1fr)] bg-[#171c26] border-b-[1px] border-solid border-b-[var(--line)] text-[#8998b4] text-[10px] [&_span]:py-[7px] [&_span]:px-[15px] [&_span:first-child]:border-r-[1px] [&_span:first-child]:border-solid [&_span:first-child]:border-r-[#353d4d] [.wrap-lines_&]:min-w-0"
              >
                <span>Original</span><span>Modified</span>
              </div>
              <section
                v-for="hunk in file.hunks"
                :key="hunk.start"
                class="hunk min-w-full w-max [.side-by-side_&]:w-full [.side-by-side_&]:min-w-0 [.wrap-lines_&]:w-full [.wrap-lines_&]:min-w-0"
                :data-file="props.path || diffFileStatus(file.header)?.path || file.header.split('\n')[0]"
              >
                <div
                  class="hunk-header min-h-[42px] flex items-center justify-between gap-[15px] py-[7px] px-[12px] bg-[#202736] text-[#8093bc] text-[10px] border-t-[1px] border-solid border-t-[#2a3346] border-b-[1px] border-b-[#2a3346] mt-[8px] mx-0 mb-0 [&_button]:text-[9px] [&_button]:bg-[#293348] [&_button]:text-[#a1b4dd] [&_button]:[border-color:#34425b] [.large-diff_&]:h-[42px]"
                >
                  <code
                    class="[:where(&)]:font-['Cascadia_Code',_'JetBrains_Mono',_Consolas,_monospace]"
                    >{{ hunk.header }}</code
                  ><AppButton
                    v-if="editable"
                    class="small text-[11px] py-[4px] px-[7px] [border-color:#30343f] rounded-[4px]"
                    :disabled="disabled || loading"
                    @click="
                      stage(
                        hunk.lines
                          .filter(
                            (l) => l.kind === 'add' || l.kind === 'delete',
                          )
                          .map((l) => l.index),
                      )
                    "
                  >
                    {{ mode === "staged" ? "Unstage" : "Stage" }} hunk
                  </AppButton>
                </div>
                <div
                  v-if="hunk.window.before"
                  :style="{ height: `${hunk.window.before}px` }"
                  aria-hidden="true"
                />
                <div v-if="layout === 'split'" class="split-lines">
                  <div
                    v-for="(row, rowIndex) in hunk.visibleRows"
                    :key="rowIndex + hunk.window.start"
                    class="split-row grid grid-cols-[minmax(0,_1fr)_minmax(0,_1fr)]"
                  >
                    <div
                      v-for="side in ['left', 'right'] as const"
                      :key="side"
                      class="diff-line split-cell block items-stretch min-h-[var(--diff-row-height)] text-[length:var(--diff-font-size)] leading-[var(--diff-row-height)] whitespace-pre min-w-0 w-full [&_code]:pr-[12px] [&_code]:text-[#b5bdce] [&_code]:[tab-size:2] [&.add]:bg-[#23834b40] [&.add_code]:text-[#c0f0ce] [&.add_.line-sign]:text-[#87e5a6] [&.add_.line-number]:bg-[#23834b50] [&.add_.line-number]:text-[#9cdbaf] [&.delete]:bg-[#c7435140] [&.delete_code]:text-[#ffd0d5] [&.delete_.line-sign]:text-[#ff98a3] [&.delete_.line-number]:bg-[#c7435150] [&.delete_.line-number]:text-[#f1a6af] [&.selected]:bg-[#364c7655] [&.selected]:shadow-[inset_2px_0_#8ea6e6] [&.meta]:text-[#6b7283] [.large-diff_&]:h-[var(--diff-row-height)] [.large-diff_&]:min-h-[var(--diff-row-height)] [.large-diff_&_code]:whitespace-pre [.large-diff_&_code]:[overflow-wrap:normal] [&.delete_.diff-inline-change]:text-[#fff0f2] [&.delete_.diff-inline-change]:bg-[#b83e53] [&.delete_.diff-inline-change]:rounded-[2px] [&.delete_.diff-inline-change]:shadow-[inset_0_-1px_#ff8c9d] [&.add_.diff-inline-change]:text-[#ecfff1] [&.add_.diff-inline-change]:bg-[#237443] [&.add_.diff-inline-change]:rounded-[2px] [&.add_.diff-inline-change]:shadow-[inset_0_-1px_#79dfa0] overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&:first-child]:border-r-[1px] [&:first-child]:border-solid [&:first-child]:border-r-[#353d4d] [&_code]:min-w-0 [&_code]:flex-1 [&_code]:whitespace-pre [.wrap-lines_&]:w-full [.wrap-lines_&]:min-w-0 [.wrap-lines_&_code]:min-w-0 [.wrap-lines_&_code]:flex-1 [.wrap-lines_&_code]:whitespace-pre-wrap [.wrap-lines_&_code]:[overflow-wrap:anywhere] [&.empty-cell]:bg-[#ffffff03]"
                      :class="[
                        row[side]?.kind,
                        {
                          selected: row[side] && selected.has(row[side]!.index),
                          'empty-cell': !row[side],
                        },
                      ]"
                      :scrollLeft="wrapLines ? 0 : horizontalScroll[side]"
                      @scroll="scrollSide(side, $event)"
                    >
                      <div
                        class="split-line-content flex min-h-[var(--diff-row-height)] min-w-full w-max [.wrap-lines_&]:w-full [.wrap-lines_&]:min-w-0"
                        :style="
                          !wrapLines
                            ? { minWidth: `${horizontalWidth[side]}px` }
                            : undefined
                        "
                      >
                        <template v-if="row[side]">
                          <AppButton
                            v-if="
                              row[side]!.kind === 'add' ||
                              row[side]!.kind === 'delete'
                            "
                            class="line-select flex justify-center items-center w-[20px] min-w-[20px] max-w-[20px] min-h-[var(--diff-row-height)] rounded-none p-0 text-[15px] opacity-[0.5] text-[#8998b6] leading-[1] hover:opacity-[1]"
                            :aria-label="`Select ${side === 'left' ? 'old' : 'new'} line ${row[side]!.old || row[side]!.next}`"
                            :aria-pressed="selected.has(row[side]!.index)"
                            @click="toggle(row[side]!.index)"
                          >
                            <Check
                              v-if="selected.has(row[side]!.index)"
                              :size="11"
                            /><span v-else>&middot;</span></AppButton
                          ><span
                            v-else
                            class="line-select flex justify-center items-center w-[20px] min-w-[20px] max-w-[20px] min-h-[var(--diff-row-height)] rounded-none p-0 text-[15px] opacity-[0.5] text-[#8998b6] leading-[1] hover:opacity-[1]"
                          />
                          <span
                            class="line-number w-[34px] shrink-0 text-right pr-[8px] text-[#4f596a] select-none text-[10px]"
                            >{{
                              side === "left" ? row[side]!.old : row[side]!.next
                            }}</span
                          >
                          <span
                            class="line-sign w-[20px] shrink-0 text-center text-[#6f7d91] select-none"
                            >{{
                              row[side]!.kind === "add"
                                ? "+"
                                : row[side]!.kind === "delete"
                                  ? "\u2212"
                                  : ""
                            }}</span
                          >
                          <code
                            class="[:where(&)]:font-['Cascadia_Code',_'JetBrains_Mono',_Consolas,_monospace]"
                            ><template
                              v-if="
                                syntax[row[side]!.index]?.[
                                  side === 'left' ? 'old' : 'next'
                                ]
                              "
                              ><span
                                v-for="(token, i) in syntax[row[side]!.index]![
                                  side === 'left' ? 'old' : 'next'
                                ]"
                                :key="i"
                                :class="token.classes"
                                >{{ token.text }}</span
                              ></template
                            ><template v-else>{{
                              row[side]!.kind === "meta"
                                ? row[side]!.text
                                : row[side]!.text.slice(1)
                            }}</template></code
                          >
                        </template>
                      </div>
                    </div>
                  </div>
                </div>
                <template v-else>
                  <div
                    v-for="line in hunk.visibleLines"
                    :key="line.index"
                    class="diff-line flex items-stretch min-h-[var(--diff-row-height)] text-[length:var(--diff-font-size)] leading-[var(--diff-row-height)] whitespace-pre min-w-full w-max [&_code]:pr-[25px] [&_code]:text-[#b5bdce] [&_code]:[tab-size:2] [&.add]:bg-[#23834b40] [&.add_code]:text-[#c0f0ce] [&.add_.line-sign]:text-[#87e5a6] [&.add_.line-number]:bg-[#23834b50] [&.add_.line-number]:text-[#9cdbaf] [&.delete]:bg-[#c7435140] [&.delete_code]:text-[#ffd0d5] [&.delete_.line-sign]:text-[#ff98a3] [&.delete_.line-number]:bg-[#c7435150] [&.delete_.line-number]:text-[#f1a6af] [&.selected]:bg-[#364c7655] [&.selected]:shadow-[inset_2px_0_#8ea6e6] [&.meta]:text-[#6b7283] [.large-diff_&]:h-[var(--diff-row-height)] [.large-diff_&]:min-h-[var(--diff-row-height)] [&.delete_.diff-inline-change]:text-[#fff0f2] [&.delete_.diff-inline-change]:bg-[#b83e53] [&.delete_.diff-inline-change]:rounded-[2px] [&.delete_.diff-inline-change]:shadow-[inset_0_-1px_#ff8c9d] [&.add_.diff-inline-change]:text-[#ecfff1] [&.add_.diff-inline-change]:bg-[#237443] [&.add_.diff-inline-change]:rounded-[2px] [&.add_.diff-inline-change]:shadow-[inset_0_-1px_#79dfa0] [.wrap-lines_&]:w-full [.wrap-lines_&]:min-w-0 [.wrap-lines_&_code]:min-w-0 [.wrap-lines_&_code]:flex-1 [.wrap-lines_&_code]:whitespace-pre-wrap [.wrap-lines_&_code]:[overflow-wrap:anywhere]"
                    :class="[line.kind, { selected: selected.has(line.index) }]"
                  >
                    <AppButton
                      v-if="line.kind === 'add' || line.kind === 'delete'"
                      class="line-select flex justify-center items-center w-[20px] min-w-[20px] max-w-[20px] min-h-[var(--diff-row-height)] rounded-none p-0 text-[15px] opacity-[0.5] text-[#8998b6] leading-[1] hover:opacity-[1]"
                      :aria-label="`Select changed line ${line.next || line.old}`"
                      :aria-pressed="selected.has(line.index)"
                      @click="toggle(line.index)"
                    >
                      <Check v-if="selected.has(line.index)" :size="11" /><span
                        v-else
                        >·</span
                      ></AppButton
                    ><span
                      v-else
                      class="line-select flex justify-center items-center w-[20px] min-w-[20px] max-w-[20px] min-h-[var(--diff-row-height)] rounded-none p-0 text-[15px] opacity-[0.5] text-[#8998b6] leading-[1] hover:opacity-[1]"
                    />
                    <span
                      class="line-number w-[34px] shrink-0 text-right pr-[8px] text-[#4f596a] select-none text-[10px]"
                      >{{ line.old }}</span
                    ><span
                      class="line-number w-[34px] shrink-0 text-right pr-[8px] text-[#4f596a] select-none text-[10px]"
                      >{{ line.next }}</span
                    ><span
                      class="line-sign w-[20px] shrink-0 text-center text-[#6f7d91] select-none"
                      >{{
                        line.kind === "add"
                          ? "+"
                          : line.kind === "delete"
                            ? "−"
                            : ""
                      }}</span
                    ><code
                      class="[:where(&)]:font-['Cascadia_Code',_'JetBrains_Mono',_Consolas,_monospace]"
                      ><template
                        v-if="
                          syntax[line.index]?.[
                            line.kind === 'delete' ? 'old' : 'next'
                          ]
                        "
                        ><span
                          v-for="(token, i) in syntax[line.index]![
                            line.kind === 'delete' ? 'old' : 'next'
                          ]"
                          :key="i"
                          :class="token.classes"
                          >{{ token.text }}</span
                        ></template
                      ><template v-else>{{
                        line.kind === "meta" ? line.text : line.text.slice(1)
                      }}</template></code
                    >
                  </div>
                </template>
                <div
                  v-if="hunk.window.after"
                  :style="{ height: `${hunk.window.after}px` }"
                  aria-hidden="true"
                />
              </section>
              <pre
                v-if="!file.hunks.length"
                class="plain-output text-[11px] py-[15px] px-[18px] text-[#9ba5bb] [.large-diff_&]:m-0 [.large-diff_&]:p-[12px] [.large-diff_&]:leading-[20px] [.large-diff_&]:whitespace-pre [:where(&)]:font-['Cascadia_Code',_'JetBrains_Mono',_Consolas,_monospace] [:where(&)]:whitespace-pre-wrap [:where(&)]:[word-break:break-word] [:where(&)]:leading-[1.7]"
                :style="large ? { height: `${file.plainHeight}px` } : undefined"
                >{{
                  file.header ||
                  (loading
                    ? "Loading changes..."
                    : "No text changes to display.")
                }}</pre>
            </template>
          </div>
        </div>
        <div
          v-if="layout === 'split' && !wrapLines"
          class="split-scrollbars grid grid-cols-[minmax(0,_1fr)_minmax(0,_1fr)] shrink-0"
        >
          <div
            v-for="side in ['left', 'right'] as const"
            :key="side"
            class="side-scrollbar [overflow-x:scroll] overflow-y-hidden min-w-0 h-[16px] [&:first-child]:border-r-[1px] [&:first-child]:border-solid [&:first-child]:border-r-[#353d4d] [&_code]:block [&_code]:[box-sizing:content-box] [&_code]:w-max [&_code]:[min-width:calc(100%_-_86px)] [&_code]:pl-[74px] [&_code]:pr-[12px] [&_code]:h-[1px] [&_code]:text-[length:var(--diff-font-size)] [&_code]:whitespace-pre [&_code]:[visibility:hidden]"
            tabindex="0"
            role="region"
            :data-scroll-side="side"
            :aria-label="`Scroll ${side === 'left' ? 'original' : 'modified'} horizontally`"
            :scrollLeft="horizontalScroll[side]"
            @scroll="scrollSide(side, $event)"
          >
            <code
              class="[:where(&)]:font-['Cascadia_Code',_'JetBrains_Mono',_Consolas,_monospace]"
              aria-hidden="true"
              >{{ geometry.longest[side] }}</code
            >
          </div>
        </div>
      </div>
      <DiffOverview
        v-if="wholeFile"
        :scroller="scroller"
        :revision="[text, layout, wrapLines, fontSize]"
        :changes="large ? geometry.changes : undefined"
      />
    </div>
    <ContextMenu ref="selectionMenu" />
  </AppCodeSurface>
</template>
