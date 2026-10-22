<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { ChevronRight, ChevronDown, Folder, FileCode2 } from 'lucide-vue-next';
import { fileTree, fileChange, type FileNode } from '~/lib/files';
import type { FileStatus } from '~/lib/types';
const props = defineProps<{ files: FileStatus[]; selected: string }>();
const emit = defineEmits<{ select: [path: string] }>();
const navigatorId = useId();
const width = ref<number>();
const tree = ref(true);
const filter = ref('');
const collapsed = ref(new Set<string>());
const rows = computed(() => {
  const filtered = props.files.filter(file => file.path.toLowerCase().includes(filter.value.toLowerCase()));
  if (!tree.value) return filtered.map(file => ({ name: file.path, path: file.path, file, depth: 0 }));
  const result: { name: string; path: string; file?: FileStatus; depth: number }[] = [];
  function visit(nodes: FileNode[], depth: number) {
    for (const node of nodes) {
      result.push({ ...node, depth });
      if (filter.value || !collapsed.value.has(node.path)) visit(node.children, depth + 1);
    }
  }
  visit(fileTree(filtered), 0);
  return result;
});
function toggle(path: string) {
  if (collapsed.value.has(path)) collapsed.value.delete(path);
  else collapsed.value.add(path);
}
</script>
<template>
  <nav :id="navigatorId" aria-label="Changed files" :style="{ width: `${Math.max(160, Math.min(600, width ?? 250))}px` }" class="relative w-[250px] max-w-[40%] shrink-0 flex flex-col min-h-0 border-r border-[var(--line)] bg-[#141820] text-[11px]">
    <div class="flex items-center justify-between p-2 gap-2">
      <strong>Files ({{ files.length }})</strong>
      <div class="flex gap-1">
        <AppButton :aria-pressed="tree" @click="tree = true">Tree</AppButton>
        <AppButton :aria-pressed="!tree" @click="tree = false">List</AppButton>
      </div>
    </div>
    <AppInput v-model="filter" aria-label="Filter changed files" placeholder="Filter files…" class="mx-2 mb-2 min-w-0" />
    <AppButton :aria-pressed="!selected" class="justify-start text-left px-3 py-2" @click="emit('select', '')">All files</AppButton>
    <div class="overflow-auto min-h-0 flex-1 p-1">
      <AppButton v-for="row in rows" :key="row.path" :title="row.path"
        :aria-current="row.file && selected === row.path ? 'true' : undefined"
        :aria-expanded="row.file ? undefined : !collapsed.has(row.path)"
        class="flex items-center justify-start w-full gap-1.5 py-1 text-left text-[11px] [&[aria-current=true]]:bg-[#29344c] [&[aria-current=true]]:text-[#d3dffa]"
        :style="{ paddingLeft: `${6 + row.depth * 14}px` }"
        @click="row.file ? emit('select', row.path) : toggle(row.path)">
        <template v-if="!row.file"><ChevronRight v-if="collapsed.has(row.path) && !filter" :size="12" class="shrink-0" /><ChevronDown v-else :size="12" class="shrink-0" /><Folder :size="13" class="shrink-0" /></template>
        <template v-else><span v-if="tree" class="w-[12px] shrink-0" aria-hidden="true" /><FileCode2 :size="13" class="shrink-0" /></template>
        <span class="truncate">{{ row.name }}</span>
        <span v-if="row.file" class="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] [&.added]:bg-[#23834b35] [&.added]:text-[#a0e7ba] [&.removed]:bg-[#c7435135] [&.removed]:text-[#ffafb8] [&.modified]:bg-[#b4862530] [&.modified]:text-[#edcc8e] [&.renamed]:bg-[#6a85ce30] [&.renamed]:text-[#b5c8ff]" :class="fileChange(row.file, 'staged').kind" :title="fileChange(row.file, 'staged').label">{{ fileChange(row.file, 'staged').label }}</span>
      </AppButton>
      <p v-if="!rows.length" class="p-2 text-[#8998b4]">No matching files</p>
    </div>
    <ResizeHandle
      v-model="width"
      label="Resize changed files"
      :controls="navigatorId"
      storage-key="gitgoblin.diffFilesWidth"
      :min="160"
      :max="600"
    />
  </nav>
</template>
