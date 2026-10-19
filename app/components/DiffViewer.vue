<script setup lang="ts">
import { computed, ref, shallowRef, watch, onMounted, onUnmounted, nextTick } from "vue";
import { Check, MessageSquarePlus, LoaderCircle } from "lucide-vue-next";
import { parseDiffFiles, splitDiffLines, selectedPatch } from "~/lib/diff";
import { diffWindow, diffRowHeight, type DiffChange } from '~/lib/diff-window';
import type { DiffSyntax } from "~/lib/syntax";
const props = defineProps<{ text: string; mode: string; path?: string; editable?: boolean; loading?: boolean; disabled?: boolean; wholeFile?: boolean }>();
const syntax = shallowRef<DiffSyntax>({});
const scroller = ref<HTMLElement>();
let worker: Worker | undefined;
let syntaxRequest = 0;
function highlight() {
  syntax.value = {};
  const id = ++syntaxRequest;
  worker?.postMessage({ id, text: props.text, path: props.path || '' });
}
onMounted(() => {
  try {
    worker = new Worker(new URL('../lib/syntax.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { if (data.id === syntaxRequest) syntax.value = data.tokens; };
    highlight();
  } catch { /* Plain text remains usable when workers are unavailable. */ }
});
onUnmounted(() => worker?.terminate());
watch(() => [props.text, props.path], highlight);
const emit = defineEmits<{ patch: [text: string]; context: [text: string]; editContext: [text: string]; "update:wholeFile": [value: boolean] }>();
const selectionMenu = ref<HTMLDivElement>();
let editSelection = '';
async function openSelectionMenu(event: MouseEvent) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed || !scroller.value) return;
  const selectedRange = selection.getRangeAt(0);
  if (!scroller.value.contains(selectedRange.startContainer) || !scroller.value.contains(selectedRange.endContainer)) return;
  const snippets: string[] = [];
  let location = '';
  for (const code of scroller.value.querySelectorAll('.diff-line code')) {
    if (!selectedRange.intersectsNode(code)) continue;
    const range = document.createRange();
    range.selectNodeContents(code);
    if (selectedRange.compareBoundaryPoints(Range.START_TO_START, range) > 0)
      range.setStart(selectedRange.startContainer, selectedRange.startOffset);
    if (selectedRange.compareBoundaryPoints(Range.END_TO_END, range) < 0)
      range.setEnd(selectedRange.endContainer, selectedRange.endOffset);
    const text = range.toString();
    if (!text) continue;
    const row = code.closest('.diff-line')!;
    const source = row.classList.contains('delete') || (row.classList.contains('split-cell') && row === row.parentElement?.firstElementChild) ? 'Original' : 'Modified';
    const file = code.closest('.hunk')?.getAttribute('data-file') || props.path || '';
    const next = `${file} (${source}, ${props.mode} diff)`;
    if (next !== location) { snippets.push(`\n${next}:`); location = next; }
    snippets.push(text);
  }
  if (!snippets.length) return;
  event.preventDefault();
  editSelection = `Selected code for the requested edit. Original/deleted lines may no longer exist in the current file.\n${snippets.join('\n')}`;
  await nextTick();
  const menu = selectionMenu.value;
  if (!menu) return;
  menu.showPopover();
  menu.style.left = `${Math.max(4, Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 4))}px`;
  menu.querySelector('button')?.focus();
}
function editInChat() {
  selectionMenu.value?.hidePopover();
  emit('editContext', editSelection);
}
const scroll = ref(0), viewportHeight = ref(600);
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
const wrapLines = ref(false);
const layout = ref('split');
const horizontalScroll = ref({ left: 0, right: 0 });
const horizontalWidth = ref({ left: 0, right: 0 });
function scrollSide(side: 'left' | 'right', event: Event) {
  horizontalScroll.value[side] = (event.currentTarget as HTMLElement).scrollLeft;
}
let horizontalResize: ResizeObserver | undefined;
watch(() => [props.text, layout.value, wrapLines.value], async () => {
  await nextTick();
  horizontalResize?.disconnect();
  horizontalResize = new ResizeObserver(() => {
    for (const side of ['left', 'right'] as const) {
      const bar = scroller.value?.parentElement?.querySelector<HTMLElement>(`[data-scroll-side="${side}"]`);
      horizontalWidth.value[side] = bar?.scrollWidth || 0;
    }
  });
  for (const content of scroller.value?.parentElement?.querySelectorAll('.side-scrollbar code') || []) horizontalResize.observe(content);
}, { immediate: true, flush: 'post' });
onUnmounted(() => horizontalResize?.disconnect());
// Wrapped rows have variable heights, so render them without fixed-height windowing.
const large = computed(() => !wrapLines.value && parsed.value.reduce((n, f) => n + f.hunks.reduce((n, h) => n + h.lines.length, 0), 0) > 500);
const geometry = computed(() => {
  let offset = 0, width = 0;
  const longest = { left: '', right: '' };
  const changes: DiffChange[] = [];
  const files = parsed.value.map(file => {
    if (parsed.value.length > 1) offset += 32;
    if (layout.value === 'split' && file.hunks.length) offset += 29;
    const plainHeight = (file.header || 'No text changes to display.').split('\n').length * 20 + 24;
    if (!file.hunks.length) offset += plainHeight;
    const hunks = file.hunks.map(hunk => {
      offset += 50;
      const top = offset;
      const rows = layout.value === 'split' ? splitDiffLines(hunk.lines) : [];
      for (const row of rows) for (const side of ['left', 'right'] as const) {
        const line = row[side];
        const text = (line?.kind === 'meta' ? line.text : line?.text.slice(1) || '').replace(/\t/g, '  ');
        if (text.length > longest[side].length) longest[side] = text;
      }
      const lines = layout.value === 'split' ? rows.map(row => [row.left, row.right]) : hunk.lines.map(line => [line]);
      lines.forEach((pair, i) => pair.forEach(line => {
        if (!line) return;
        width = Math.max(width, line.text.replace(/\t/g, '  ').length);
        if (line.kind === 'add' || line.kind === 'delete') changes.push({ offset: top + i * diffRowHeight, height: diffRowHeight, kind: line.kind, line: String(line.next || line.old) });
      }));
      offset += lines.length * diffRowHeight;
      return { ...hunk, rows, top, count: lines.length };
    });
    return { ...file, hunks, plainHeight };
  });
  return { files, changes, longest, width: width * 6.7 + 125 };
});
const files = computed(() => geometry.value.files.map(file => ({ ...file, hunks: file.hunks.map(hunk => {
  const window = large.value ? diffWindow(hunk.count, hunk.top, scroll.value, viewportHeight.value) : { start: 0, end: hunk.count, before: 0, after: 0 };
  return { ...hunk, window, visibleLines: hunk.lines.slice(window.start, window.end), visibleRows: hunk.rows.slice(window.start, window.end) };
}) })));
let jumpToChangePending = false;
watch(
  () => [props.path, props.mode, props.wholeFile, props.text, props.loading] as const,
  async (current, previous) => {
    if (!previous || current.slice(0, 3).some((value, i) => value !== previous[i]))
      jumpToChangePending = !!props.wholeFile;
    if (!jumpToChangePending || props.loading || !props.text) return;
    await nextTick();
    const el = scroller.value;
    if (!jumpToChangePending || !props.wholeFile || props.loading || !el) return;
    jumpToChangePending = false;
    // Virtualized changes may be outside the DOM; wrapped rows need measured positions.
    const row = el.querySelector<HTMLElement>('.diff-line.add, .diff-line.delete');
    const offset = large.value ? geometry.value.changes[0]?.offset
      : row ? row.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop : undefined;
    if (offset === undefined) return;
    el.scrollTop = Math.max(0, offset - el.clientHeight / 3);
    onScroll();
  },
  { immediate: true, flush: 'post' },
);
const selected = ref(new Set<number>());
const error = ref("");
watch(
  () => props.text,
  () => {
    selectionMenu.value?.hidePopover();
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
      : props.text,
  );
}
</script>
<template>
  <div class="diff-view" :class="{ 'side-by-side': layout === 'split', 'large-diff': large, 'wrap-lines': wrapLines }">
    <div class="diff-actions">
      <div class="diff-layout" role="group" aria-label="Diff layout">
        <button :aria-pressed="layout === 'unified'" @click="layout = 'unified'">Unified</button>
        <button :aria-pressed="layout === 'split'" @click="layout = 'split'">Side by side</button>
      </div>
      <button class="small wrap-toggle" :aria-pressed="wrapLines" @click="wrapLines = !wrapLines">Wrap lines</button>
      <button v-if="wholeFile !== undefined" class="small" :aria-pressed="wholeFile" @click="emit('update:wholeFile', !wholeFile)">Whole file</button>
      <LoaderCircle class="spin diff-loading" :class="{ visible: loading }" :size="13" :aria-hidden="!loading" aria-label="Refreshing diff" />
      <span>{{
        selected.size
          ? `${selected.size} lines selected`
          : "Select changed lines to stage or discuss"
      }}</span
      ><button v-if="editable && selected.size" class="small" :disabled="disabled || loading" @click="stage()">
        <Check :size="13" />{{
          mode === "staged" ? "Unstage" : "Stage"
        }}
        selection</button
      ><button class="small" @click="context">
        <MessageSquarePlus :size="14" />Add to chat
      </button>
    </div>
    <div v-if="error" class="inline-error">{{ error }}</div>
    <div class="diff-body">
    <div class="diff-main">
    <div ref="scroller" class="diff-scroll" @contextmenu="openSelectionMenu" @scroll="onScroll">
      <div class="diff-content" :style="large && layout !== 'split' ? { minWidth: `${geometry.width}px` } : undefined">
      <template v-for="(file, fileIndex) in files" :key="fileIndex">
        <div v-if="files.length > 1" class="diff-file-label">{{ file.header.split('\n')[0] }}</div>
        <div v-if="layout === 'split' && file.hunks.length" class="split-labels"><span>Original</span><span>Modified</span></div>
        <section v-for="hunk in file.hunks" :key="hunk.start" class="hunk" :data-file="props.path || file.header.split('\n')[0]">
          <div class="hunk-header">
            <code>{{ hunk.header }}</code
            ><button
              v-if="editable"
              class="small"
              :disabled="disabled || loading"
              @click="
                stage(
                  hunk.lines
                    .filter((l) => l.kind === 'add' || l.kind === 'delete')
                    .map((l) => l.index),
                )
              "
            >
              {{ mode === "staged" ? "Unstage" : "Stage" }} hunk
            </button>
          </div>
          <div v-if="hunk.window.before" :style="{ height: `${hunk.window.before}px` }" aria-hidden="true" />
          <div v-if="layout === 'split'" class="split-lines">
            <div v-for="(row, rowIndex) in hunk.visibleRows" :key="rowIndex + hunk.window.start" class="split-row">
              <div v-for="side in (['left', 'right'] as const)" :key="side" class="diff-line split-cell" :class="[row[side]?.kind, { selected: row[side] && selected.has(row[side]!.index), 'empty-cell': !row[side] }]"
                :scrollLeft="wrapLines ? 0 : horizontalScroll[side]" @scroll="scrollSide(side, $event)">
                <div class="split-line-content" :style="!wrapLines ? { minWidth: `${horizontalWidth[side]}px` } : undefined">
                <template v-if="row[side]">
                  <button v-if="row[side]!.kind === 'add' || row[side]!.kind === 'delete'" class="line-select"
                    :aria-label="`Select ${side === 'left' ? 'old' : 'new'} line ${row[side]!.old || row[side]!.next}`"
                    :aria-pressed="selected.has(row[side]!.index)" @click="toggle(row[side]!.index)">
                    <Check v-if="selected.has(row[side]!.index)" :size="11" /><span v-else>&middot;</span>
                  </button><span v-else class="line-select" />
                  <span class="line-number">{{ side === 'left' ? row[side]!.old : row[side]!.next }}</span>
                  <span class="line-sign">{{ row[side]!.kind === 'add' ? '+' : row[side]!.kind === 'delete' ? '\u2212' : '' }}</span>
                  <code><template v-if="syntax[row[side]!.index]?.[side === 'left' ? 'old' : 'next']"><span v-for="(token, i) in syntax[row[side]!.index]![side === 'left' ? 'old' : 'next']" :key="i" :class="token.classes">{{ token.text }}</span></template><template v-else>{{ row[side]!.kind === 'meta' ? row[side]!.text : row[side]!.text.slice(1) }}</template></code>
                </template>
                </div>
              </div>
            </div>
          </div>
          <template v-else>
          <div
            v-for="line in hunk.visibleLines"
            :key="line.index"
            class="diff-line"
            :class="[line.kind, { selected: selected.has(line.index) }]"
          >
            <button
              v-if="line.kind === 'add' || line.kind === 'delete'"
              class="line-select"
              :aria-label="`Select changed line ${line.next || line.old}`"
              :aria-pressed="selected.has(line.index)"
              @click="toggle(line.index)"
            >
              <Check v-if="selected.has(line.index)" :size="11" /><span v-else
                >·</span
              ></button
            ><span v-else class="line-select" />
            <span class="line-number">{{ line.old }}</span
            ><span class="line-number">{{ line.next }}</span
            ><span class="line-sign">{{
              line.kind === "add" ? "+" : line.kind === "delete" ? "−" : ""
            }}</span
            ><code><template v-if="syntax[line.index]?.[line.kind === 'delete' ? 'old' : 'next']"><span v-for="(token, i) in syntax[line.index]![line.kind === 'delete' ? 'old' : 'next']" :key="i" :class="token.classes">{{ token.text }}</span></template><template v-else>{{
              line.kind === "meta" ? line.text : line.text.slice(1)
            }}</template></code>
          </div>
          </template>
          <div v-if="hunk.window.after" :style="{ height: `${hunk.window.after}px` }" aria-hidden="true" />
        </section>
        <pre v-if="!file.hunks.length" class="plain-output" :style="large ? { height: `${file.plainHeight}px` } : undefined">{{ file.header || (loading ? "Loading changes..." : "No text changes to display.") }}</pre>
      </template>
      </div>
    </div>
    <div v-if="layout === 'split' && !wrapLines" class="split-scrollbars">
      <div v-for="side in (['left', 'right'] as const)" :key="side" class="side-scrollbar" tabindex="0" role="region"
        :data-scroll-side="side"
        :aria-label="`Scroll ${side === 'left' ? 'original' : 'modified'} horizontally`"
        :scrollLeft="horizontalScroll[side]" @scroll="scrollSide(side, $event)">
        <code aria-hidden="true">{{ geometry.longest[side] }}</code>
      </div>
    </div>
    </div>
    <DiffOverview v-if="wholeFile" :scroller="scroller" :revision="[text, layout, wrapLines]" :changes="large ? geometry.changes : undefined" />
    </div>
    <div ref="selectionMenu" popover="auto" role="menu" aria-label="Selected code actions" class="selection-menu" @contextmenu.prevent>
      <button role="menuitem" @click="editInChat"><MessageSquarePlus :size="14" />Ask T3 to edit selection</button>
    </div>
  </div>
</template>

<style scoped>
/* Fixed row geometry keeps large files stable as offscreen rows are recycled. */
.large-diff .diff-line { height: 23px; min-height: 23px; }
.large-diff .split-cell code { white-space: pre; overflow-wrap: normal; }
.large-diff .hunk-header { height: 42px; }
.large-diff .diff-file-label { height: 32px; white-space: nowrap; }
.large-diff .split-labels { height: 29px; }
.large-diff .plain-output { margin: 0; padding: 12px; line-height: 20px; white-space: pre; }

.selection-menu { position: fixed; inset: auto; margin: 0; padding: 4px; background: #1b202b; color: #d3dffa; border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 8px 28px #0008; }
.selection-menu button { padding: 8px 10px; gap: 8px; font-size: 11px; }
.diff-body { display: flex; min-height: 0; flex: 1; }
.diff-main { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.diff-body .diff-scroll { min-width: 0; }
.hljs-comment, .hljs-quote { color: #8c98aa; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal { color: #c5a5ef; }
.hljs-string, .hljs-regexp, .hljs-addition { color: #add5a2; }
.hljs-number, .hljs-symbol, .hljs-bullet { color: #e4b58b; }
.hljs-title, .hljs-section { color: #e7ce8d; }
.hljs-type, .hljs-built_in, .hljs-name { color: #81cbd1; }
.hljs-attr, .hljs-attribute, .hljs-variable, .hljs-selector-class { color: #9bc8ef; }
.hljs-meta, .hljs-doctag { color: #a8b6ec; }
.diff-line.delete .diff-inline-change { color: #fff0f2; background: #b83e53; border-radius: 2px; box-shadow: inset 0 -1px #ff8c9d; }
.diff-line.add .diff-inline-change { color: #ecfff1; background: #237443; border-radius: 2px; box-shadow: inset 0 -1px #79dfa0; }
.diff-loading { visibility: hidden; flex-shrink: 0; }
.diff-loading.visible { visibility: visible; }
.diff-layout { display: flex; flex-shrink: 0; border: 1px solid var(--line); border-radius: 5px; padding: 2px; }
.diff-layout button { padding: 3px 7px; font-size: 10px; border-radius: 3px; }
.diff-layout button[aria-pressed="true"] { background: #2a3244; color: #c1cfff; }
.side-by-side .diff-scroll { overflow-x: hidden; }
.side-by-side .hunk { width: 100%; min-width: 0; }
.split-row, .split-labels { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.split-labels { background: #171c26; border-bottom: 1px solid var(--line); color: #8998b4; font-size: 10px; }
.split-labels span { padding: 7px 15px; }
.split-cell { display: block; min-width: 0; width: 100%; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.split-cell::-webkit-scrollbar { display: none; }
.split-line-content { display: flex; min-height: 23px; min-width: 100%; width: max-content; }
.split-scrollbars { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); flex-shrink: 0; }
.side-scrollbar { overflow-x: scroll; overflow-y: hidden; min-width: 0; height: 16px; }
.side-scrollbar:first-child { border-right: 1px solid #353d4d; }
.side-scrollbar code { display: block; box-sizing: content-box; width: max-content; min-width: calc(100% - 86px); padding-left: 74px; padding-right: 12px; height: 1px; font-size: 11px; white-space: pre; visibility: hidden; }
@media (min-width: 1650px) { .side-scrollbar code { font-size: 12px; } }
.split-cell:first-child, .split-labels span:first-child { border-right: 1px solid #353d4d; }
.split-cell code { min-width: 0; flex: 1; white-space: pre; padding-right: 12px; }
.wrap-toggle[aria-pressed="true"] { background: #2a3244; color: #c1cfff; }
.wrap-lines .hunk, .wrap-lines .diff-line { width: 100%; min-width: 0; }
.wrap-lines .split-labels { min-width: 0; }
.wrap-lines .split-line-content { width: 100%; min-width: 0; }
.wrap-lines .diff-line code { min-width: 0; flex: 1; white-space: pre-wrap; overflow-wrap: anywhere; }
.empty-cell { background: #ffffff03; }
.diff-file-label { padding: 9px 12px; color: #bac7e0; font-size: 11px; background: #1b2030; overflow-wrap: anywhere; }
@media (max-width: 1100px) { .diff-actions { flex-wrap: wrap; } }
</style>
