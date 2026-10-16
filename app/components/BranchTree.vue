<script setup lang="ts">
import { ChevronRight, Folder, GitBranch, Check } from "lucide-vue-next";
import type { BranchNode } from "~/lib/branches";
import type { GitRef } from "~/lib/types";
defineProps<{ nodes: BranchNode[] }>();
defineEmits<{ select: [branch: GitRef]; context: [event: MouseEvent | KeyboardEvent, branch: GitRef] }>();
</script>

<template>
  <ul class="branch-tree">
    <li v-for="node in nodes" :key="node.path">
      <details v-if="node.children.length" open>
        <summary class="tree-row" :title="node.path">
          <ChevronRight class="folder-chevron" :size="12" /><Folder :size="14" /><span>{{ node.name }}</span>
        </summary>
        <BranchTree :nodes="node.children" @select="$emit('select', $event)" @context="(event, branch) => $emit('context', event, branch)" />
      </details>
      <button v-else-if="node.branch" class="tree-row" :class="{ current: node.branch.current }"
        :title="node.path" :aria-current="node.branch.current ? 'true' : undefined"
        aria-haspopup="menu" @contextmenu="$emit('context', $event, node.branch)" @keydown.shift.f10.prevent="$emit('context', $event, node.branch)"
        @click="$emit('select', node.branch)">
        <Check v-if="node.branch.current" :size="14" /><GitBranch v-else :size="14" />
        <span>{{ node.name }}</span>
      </button>
    </li>
  </ul>
</template>

<style scoped>
.branch-tree { list-style: none; padding: 0; margin: 0; min-width: 0; }
details > .branch-tree { padding-left: 15px; }
summary { cursor: pointer; list-style: none; border-radius: 6px; }
summary::-webkit-details-marker { display: none; }
summary:hover { background: #252831; color: #f0f1f7; }
summary:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }
details[open] > summary > .folder-chevron { transform: rotate(90deg); }
.tree-row { padding-top: 5px; padding-bottom: 5px; min-height: 28px; }
button.tree-row { padding-left: 32px; }
</style>
