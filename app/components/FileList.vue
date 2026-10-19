<script setup lang="ts">
import { computed, ref, nextTick, watch } from "vue";
import { ChevronRight, ChevronDown, Folder, FileCode2 } from "lucide-vue-next";
import { fileChange, fileTree, type FileNode } from "~/lib/files";
import type { FileStatus } from "~/lib/types";
import { selectFiles } from '~/lib/file-selection';

const props = defineProps<{ files: FileStatus[]; tree: boolean; selected: string; mode: string; editable?: boolean }>();
const emit = defineEmits<{ select: [path: string]; toggleStage: [path: string]; toggleFolder: [path: string]; toggleSelection: [paths: string[]] }>();
const picked = ref(new Set<string>(props.selected ? [props.selected] : []));
let anchor = '';
const selectedPaths = computed(() => props.files.filter(file => picked.value.has(file.path)).map(file => file.path));
const canStageSelection = computed(() => props.editable && !props.files.some(file => picked.value.has(file.path) && file.conflict));
function selectFile(event: MouseEvent, path: string) {
  const next = selectFiles(rows.value.filter(row => row.file).map(row => row.path), picked.value, anchor, path, event);
  picked.value = next.paths;
  anchor = next.anchor;
  emit('select', path);
}
watch(() => props.files, files => {
  const valid = new Set(files.map(file => file.path));
  picked.value = new Set([...picked.value].filter(path => valid.has(path)));
});
watch(() => props.selected, path => { if (!path) { picked.value = new Set(); anchor = ''; } });
const menu = ref<HTMLDivElement>();
const menuRow = ref<{ path: string; file?: FileStatus }>();
const menuError = ref("");
let menuTrigger: HTMLElement | undefined;
const canStage = computed(() => props.editable && menuRow.value && !props.files.some((file) =>
  file.conflict && (menuRow.value!.file ? picked.value.has(file.path) : file.path.startsWith(`${menuRow.value!.path}/`)),
));
async function openMenu(event: MouseEvent | KeyboardEvent, row: { path: string; file?: FileStatus }) {
  event.preventDefault();
  if (row.file && !picked.value.has(row.path)) { picked.value = new Set([row.path]); anchor = row.path; }
  menuTrigger = event.currentTarget as HTMLElement;
  menuRow.value = row;
  menuError.value = "";
  await nextTick();
  if (!menu.value) return;
  const bounds = menuTrigger.getBoundingClientRect();
  const mouse = event instanceof MouseEvent && (event.clientX !== 0 || event.clientY !== 0);
  const x = mouse ? event.clientX : bounds.left;
  const y = mouse ? event.clientY : bounds.bottom;
  menu.value.showPopover();
  menu.value.style.left = `${Math.max(4, Math.min(x, window.innerWidth - menu.value.offsetWidth - 4))}px`;
  menu.value.style.top = `${Math.max(4, Math.min(y, window.innerHeight - menu.value.offsetHeight - 4))}px`;
  menu.value.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}
function closeMenu() {
  menu.value?.hidePopover();
  if (menuTrigger?.isConnected) menuTrigger.focus({ preventScroll: true });
}
async function menuAction(action: 'view' | 'stage' | 'toggle' | 'copy') {
  const row = menuRow.value;
  if (!row) return;
  if (action === 'copy') {
    try { await navigator.clipboard.writeText(row.path); }
    catch { menuError.value = "Could not copy the path. Try again."; return; }
  } else if (action === 'view') emit('select', row.path);
  else if (action === 'toggle') toggle(row.path);
  else if (canStage.value) {
    if (row.file) emit('toggleSelection', selectedPaths.value);
    else emit('toggleFolder', row.path);
  }
  closeMenu();
}
function menuKey(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Tab') { closeMenu(); event.preventDefault(); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const items = [...(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[index]?.focus();
}
watch(() => [props.files, props.tree, props.mode], () => menu.value?.hidePopover());
const collapsed = ref(new Set<string>());
const rows = computed(() => {
  if (!props.tree) return props.files.map((file) => ({
    name: file.path.split("/").at(-1)!, path: file.path, file, depth: 0,
  }));
  const result: { name: string; path: string; file?: FileStatus; depth: number }[] = [];
  const visit = (nodes: FileNode[], depth: number) => {
    for (const node of nodes) {
      result.push({ ...node, depth });
      if (!collapsed.value.has(node.path)) visit(node.children, depth + 1);
    }
  };
  visit(fileTree(props.files), 0);
  return result;
});
function toggle(path: string) {
  if (collapsed.value.has(path)) collapsed.value.delete(path);
  else collapsed.value.add(path);
}
</script>

<template>
  <div v-if="picked.size > 1" class="selection-actions"><span>{{ picked.size }} selected</span><button v-if="mode !== 'branch'" :disabled="!canStageSelection" @click="$emit('toggleSelection', selectedPaths)">{{ mode === 'staged' ? 'Unstage selected' : 'Stage selected' }}</button></div>
  <ul class="compact-files">
    <li v-for="row in rows" :key="row.path" class="file-entry" @contextmenu="openMenu($event, row)">
      <button class="compact-file-row" :class="{ active: row.file && picked.has(row.path), folder: !row.file }"
        :style="{ paddingLeft: `${8 + row.depth * 14}px` }" :title="row.path"
        :aria-expanded="row.file ? undefined : !collapsed.has(row.path)"
        :aria-current="row.file && selected === row.path ? 'true' : undefined"
        :aria-pressed="row.file ? picked.has(row.path) : undefined"
        aria-haspopup="menu"
        @keydown.shift.f10.prevent="openMenu($event, row)"
        @keydown.context-menu.prevent="openMenu($event, row)"
        @click="row.file ? selectFile($event, row.path) : toggle(row.path)"
        @dblclick="editable && (row.file ? $emit('toggleStage', row.path) : $emit('toggleFolder', row.path))">
        <template v-if="!row.file">
          <ChevronRight v-if="collapsed.has(row.path)" :size="11" /><ChevronDown v-else :size="11" /><Folder :size="13" />
        </template>
        <template v-else><span v-if="tree" class="tree-chevron-space" aria-hidden="true" /><FileCode2 :size="13" /></template>
        <span class="compact-file-name">{{ row.name }}</span>
        <small v-if="!tree && row.path.includes('/')">{{ row.path.slice(0, row.path.lastIndexOf('/')) }}</small>
        <span v-if="row.file" class="file-status" :class="fileChange(row.file, mode).kind">{{ fileChange(row.file, mode).label }}</span>
      </button>
      <button v-if="!row.file && mode !== 'branch'" class="folder-stage" :disabled="!editable" :aria-label="`${mode === 'staged' ? 'Unstage' : 'Stage'} folder ${row.path}`" @click="$emit('toggleFolder', row.path)">{{ mode === 'staged' ? 'Unstage' : 'Stage' }}</button>
    </li>
  </ul>
  <div ref="menu" popover="auto" role="menu" :aria-label="`Actions for ${menuRow?.path || 'file'}`" class="file-context-menu" @keydown="menuKey" @contextmenu.prevent>
    <template v-if="menuRow">
      <button v-if="mode !== 'branch'" role="menuitem" :disabled="!canStage" @click="menuAction('stage')">{{ mode === 'staged' ? 'Unstage' : 'Stage' }} {{ menuRow.file ? picked.size > 1 ? `${picked.size} selected files` : 'file' : 'folder' }}</button>
      <button v-if="menuRow.file" role="menuitem" @click="menuAction('view')">View changes</button>
      <button v-if="!menuRow.file" role="menuitem" @click="menuAction('toggle')">{{ collapsed.has(menuRow.path) ? 'Expand' : 'Collapse' }} folder</button>
      <button role="menuitem" @click="menuAction('copy')">Copy relative path</button>
      <span v-if="menuError" role="alert">{{ menuError }}</span>
    </template>
  </div>
</template>

<style scoped>
.selection-actions { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between; padding: 3px 5px; font-size: 10px; background: #1b202b; color: #b7c5df; }
.selection-actions button { font-size: 10px; padding: 3px 6px; }
.compact-files { user-select: none; }
.file-context-menu { position: fixed; inset: auto; margin: 0; padding: 4px; min-width: 180px; max-width: calc(100vw - 8px); max-height: calc(100vh - 8px); overflow: auto; background: #1b202b; color: #d3dffa; border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 8px 28px #0008; }
.file-context-menu button { display: flex; width: 100%; justify-content: flex-start; padding: 7px 10px; font-size: 11px; border-radius: 3px; }
.file-context-menu button:focus-visible { outline: 1px solid #8ca5e7; outline-offset: -1px; background: #2a3244; }
.file-context-menu span { display: block; max-width: 220px; padding: 6px 10px; color: #ee9c9c; font-size: 11px; }
.file-entry { display: flex; align-items: center; }
.tree-chevron-space { width: 11px; flex-shrink: 0; }
.folder-stage { flex-shrink: 0; padding: 2px 5px; font-size: 9px; color: #93a4c9; margin-right: 3px; }
.compact-file-row { flex: 1; min-width: 0; }
.compact-files { list-style: none; margin: 0; padding: 0; }
.compact-file-row { display: flex; width: 100%; min-height: 25px; height: 25px; padding: 3px 8px; gap: 6px; text-align: left; justify-content: flex-start; border-radius: 4px; font-size: 11px; }
.compact-file-row.active { background: #252a39; color: #d3dffa; }
.compact-file-row > svg { color: #7c8bb0; }
.compact-file-row.folder { color: #a5aebf; }
.compact-file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
small { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 9px; color: #717b91; }
.file-status { margin-left: auto; flex-shrink: 0; padding: 2px 5px; border-radius: 4px; font-family: inherit; font-size: 9px; font-weight: 600; line-height: 14px; }
.file-status.added { color: #a0e7ba; background: #23834b35; }
.file-status.removed { color: #ffafb8; background: #c7435135; }
.file-status.modified { color: #edcc8e; background: #b4862530; }
.file-status.renamed { color: #b5c8ff; background: #6a85ce30; }
.file-status.conflicted { color: #ffafb8; background: #c7435145; }
</style>
