<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ChevronRight, ChevronDown, Folder, FileCode2 } from "lucide-vue-next";
import { fileChange, fileTree, type FileNode } from "~/lib/files";
import type { FileStatus } from "~/lib/types";
import { selectFiles } from "~/lib/file-selection";
import type { ContextMenuHandle, ContextMenuItem } from "~/lib/context-menu";

const props = defineProps<{
  files: FileStatus[];
  tree: boolean;
  selected: string;
  mode: string;
  editable?: boolean;
  nativeActions?: boolean;
}>();
const emit = defineEmits<{
  select: [path: string];
  toggleStage: [path: string];
  toggleFolder: [path: string];
  toggleSelection: [paths: string[]];
  discard: [paths: string[]];
  openEditor: [path: string];
  reveal: [path: string];
  copyFullPath: [path: string];
  error: [message: string];
}>();
const picked = ref(new Set<string>(props.selected ? [props.selected] : []));
let anchor = "";
const selectedPaths = computed(() =>
  props.files
    .filter((file) => picked.value.has(file.path))
    .map((file) => file.path),
);
const canStageSelection = computed(
  () =>
    props.editable &&
    !props.files.some((file) => picked.value.has(file.path) && file.conflict),
);
function selectFile(event: MouseEvent, path: string) {
  const next = selectFiles(
    rows.value.filter((row) => row.file).map((row) => row.path),
    picked.value,
    anchor,
    path,
    event,
  );
  picked.value = next.paths;
  anchor = next.anchor;
  emit("select", path);
}
watch(
  () => props.files,
  (files) => {
    const valid = new Set(files.map((file) => file.path));
    picked.value = new Set([...picked.value].filter((path) => valid.has(path)));
  },
);
watch(
  () => props.selected,
  (path) => {
    if (!path) {
      picked.value = new Set();
      anchor = "";
    }
  },
);
const menu = ref<ContextMenuHandle>();
function openMenu(
  event: MouseEvent | KeyboardEvent,
  row: { path: string; file?: FileStatus },
) {
  if (row.file && !picked.value.has(row.path)) {
    picked.value = new Set([row.path]);
    anchor = row.path;
  }
  const canStage =
    props.editable &&
    !props.files.some(
      (file) =>
        file.conflict &&
        (row.file
          ? picked.value.has(file.path)
          : file.path.startsWith(`${row.path}/`)),
    );
  const items: ContextMenuItem[] = [];
  if (props.mode !== "branch")
    items.push({
      label: `${props.mode === "staged" ? "Unstage" : "Stage"} ${row.file ? (picked.value.size > 1 ? `${picked.value.size} selected files` : "file") : "folder"}`,
      disabled: !canStage,
      run: () =>
        row.file
          ? emit("toggleSelection", selectedPaths.value)
          : emit("toggleFolder", row.path),
    });
  items.push(
    row.file
      ? { label: "View changes", run: () => emit("select", row.path) }
      : {
          label: `${collapsed.value.has(row.path) ? "Expand" : "Collapse"} folder`,
          run: () => toggle(row.path),
        },
  );
  if (props.mode === "working")
    items.push({
      label:
        row.file && picked.value.size > 1
          ? "Discard selected changes…"
          : row.file
            ? "Discard changes…"
            : "Discard folder changes…",
      separatorBefore: true,
      danger: true,
      disabled: !canStage,
      run: () =>
        emit(
          "discard",
          row.file
            ? selectedPaths.value
            : props.files
                .filter((file) => file.path.startsWith(`${row.path}/`))
                .map((file) => file.path),
        ),
    });
  items.push(
    {
      label: row.file ? "Open in editor" : "Open folder in editor",
      separatorBefore: true,
      disabled:
        !props.nativeActions ||
        (!!row.file && fileChange(row.file, props.mode).kind === "removed"),
      run: () => emit("openEditor", row.path),
    },
    {
      label: "Reveal in Explorer",
      disabled: !props.nativeActions,
      run: () => emit("reveal", row.path),
    },
    {
      label: "Copy relative path",
      separatorBefore: true,
      run: () => navigator.clipboard.writeText(row.path),
    },
    {
      label: "Copy full path",
      disabled: !props.nativeActions,
      run: () => emit("copyFullPath", row.path),
    },
  );
  void menu.value?.open(event, items);
}
watch(
  () => [props.files, props.tree, props.mode],
  () => menu.value?.close(),
);
const collapsed = ref(new Set<string>());
const rows = computed(() => {
  if (!props.tree)
    return props.files.map((file) => ({
      name: file.path.split("/").at(-1)!,
      path: file.path,
      file,
      depth: 0,
    }));
  const result: {
    name: string;
    path: string;
    file?: FileStatus;
    depth: number;
  }[] = [];
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
  <div
    v-if="picked.size > 1"
    class="selection-actions sticky top-0 z-[1] flex items-center justify-between py-[3px] px-[5px] text-[10px] bg-[#1b202b] text-[#b7c5df] [&_button]:text-[10px] [&_button]:py-[3px] [&_button]:px-[6px]"
  >
    <span>{{ picked.size }} selected</span
    ><AppButton
      v-if="mode !== 'branch'"
      :disabled="!canStageSelection"
      @click="$emit('toggleSelection', selectedPaths)"
    >
      {{ mode === "staged" ? "Unstage selected" : "Stage selected" }}
    </AppButton>
  </div>
  <ul class="compact-files select-none list-none m-0 p-0">
    <li
      v-for="row in rows"
      :key="row.path"
      class="file-entry flex items-center"
      @contextmenu="openMenu($event, row)"
    >
      <AppButton
        class="compact-file-row transition-none [.segmented_button&.active]:bg-[#292d38] [.segmented_button&.active]:text-[#d1d8ed] [.segmented_button&.active]:shadow-[0_1px_3px_#0004] flex-1 min-w-0 flex w-full min-h-[25px] h-[25px] py-[3px] px-[8px] gap-[6px] text-left justify-start rounded-[4px] text-[11px] [&.active]:bg-[#252a39] [&.active]:text-[#d3dffa] [&>svg]:text-[#7c8bb0] [&.folder]:text-[#a5aebf]"
        :class="[
          { active: row.file && picked.has(row.path), folder: !row.file },
        ]"
        :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
        :title="row.path"
        :aria-expanded="row.file ? undefined : !collapsed.has(row.path)"
        :aria-current="row.file && selected === row.path ? 'true' : undefined"
        :aria-pressed="row.file ? picked.has(row.path) : undefined"
        aria-haspopup="menu"
        @keydown.shift.f10.prevent="openMenu($event, row)"
        @keydown.context-menu.prevent="openMenu($event, row)"
        @click="row.file ? selectFile($event, row.path) : toggle(row.path)"
        @dblclick="
          editable &&
          (row.file
            ? $emit('toggleStage', row.path)
            : $emit('toggleFolder', row.path))
        "
      >
        <template v-if="!row.file">
          <ChevronRight v-if="collapsed.has(row.path)" :size="11" /><ChevronDown
            v-else
            :size="11"
          /><Folder :size="13" />
        </template>
        <template v-else
          ><span
            v-if="tree"
            class="tree-chevron-space w-[11px] shrink-0"
            aria-hidden="true" /><FileCode2 :size="13"
        /></template>
        <span
          class="compact-file-name overflow-hidden text-ellipsis whitespace-nowrap"
          >{{ row.name }}</span
        >
        <small
          class="flex-1 min-w-0 overflow-hidden text-ellipsis text-[9px] text-[#717b91] [:where(&)]:text-[11px]"
          v-if="!tree && row.path.includes('/')"
          >{{ row.path.slice(0, row.path.lastIndexOf("/")) }}</small
        >
        <span
          v-if="row.file"
          class="file-status font-[inherit] text-[9px] text-[#c1a778] [&.added]:text-[#a0e7ba] [&.conflicted]:text-[#ffafb8] ml-auto shrink-0 py-[2px] px-[5px] rounded-[4px] font-semibold leading-[14px] [&.added]:bg-[#23834b35] [&.removed]:text-[#ffafb8] [&.removed]:bg-[#c7435135] [&.modified]:text-[#edcc8e] [&.modified]:bg-[#b4862530] [&.renamed]:text-[#b5c8ff] [&.renamed]:bg-[#6a85ce30] [&.conflicted]:bg-[#c7435145]"
          :class="fileChange(row.file, mode).kind"
          >{{ fileChange(row.file, mode).label }}</span
        >
      </AppButton>
      <AppButton
        v-if="!row.file && mode !== 'branch'"
        class="folder-stage shrink-0 py-[2px] px-[5px] text-[9px] text-[#93a4c9] mr-[3px]"
        :disabled="!editable"
        :aria-label="`${mode === 'staged' ? 'Unstage' : 'Stage'} folder ${row.path}`"
        @click="$emit('toggleFolder', row.path)"
      >
        {{ mode === "staged" ? "Unstage" : "Stage" }}
      </AppButton>
    </li>
  </ul>
  <ContextMenu ref="menu" @error="emit('error', $event)" />
</template>
