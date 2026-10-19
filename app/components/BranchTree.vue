<script setup lang="ts">
import { ChevronRight, Folder, GitBranch, Check, ArrowDown, ArrowUp, Unplug } from "lucide-vue-next";
import type { BranchNode } from "~/lib/branches";
import type { GitRef } from "~/lib/types";
defineProps<{ nodes: BranchNode[] }>();
defineEmits<{ select: [branch: GitRef]; context: [event: MouseEvent | KeyboardEvent, branch: GitRef] }>();
function branchTitle(branch: GitRef) {
  if (!branch.name.startsWith('refs/heads/')) return branch.name.replace('refs/remotes/', '');
  const tracking = !branch.upstream ? 'No upstream branch configured'
    : branch.upstreamGone ? `Upstream ${branch.upstream} is missing (fetch with prune to refresh)`
    : `${branch.upstream}: ${branch.behind || 0} incoming, ${branch.ahead || 0} outgoing commits (as of last fetch)`;
  return `${branch.name.slice('refs/heads/'.length)}\n${tracking}`;
}
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
        :title="branchTitle(node.branch)" :aria-current="node.branch.current ? 'true' : undefined"
        aria-haspopup="menu" @contextmenu="$emit('context', $event, node.branch)" @keydown.shift.f10.prevent="$emit('context', $event, node.branch)"
        @click="$emit('select', node.branch)">
        <Check v-if="node.branch.current" :size="14" /><GitBranch v-else :size="14" />
        <span>{{ node.name }}</span>
        <span v-if="node.branch.name.startsWith('refs/heads/')" class="branch-tracking">
          <span v-if="!node.branch.upstream || node.branch.upstreamGone" class="upstream-warning">
            <Unplug :size="11" />{{ node.branch.upstreamGone ? 'Upstream gone' : 'No upstream' }}
          </span>
          <template v-else>
            <span v-if="node.branch.behind" class="incoming" :title="`${node.branch.behind} commits to pull from ${node.branch.upstream}`"><ArrowDown :size="12" />{{ node.branch.behind }}</span>
            <span v-if="node.branch.ahead" class="outgoing" :title="`${node.branch.ahead} commits ahead of ${node.branch.upstream}`"><ArrowUp :size="12" />{{ node.branch.ahead }}</span>
          </template>
        </span>
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
.tree-row.current { color: #d6f4e1; background: #20372e; box-shadow: inset 2px 0 #8bcca6; font-weight: 600; }
.tree-row.current > svg { color: #a0dfb9; }
summary.tree-row { color: #aab8ce; }
button.tree-row { padding-left: 32px; }
.tree-row > .branch-tracking { display: flex; flex: 0 0 auto; gap: 6px; margin-left: auto; overflow: visible; font-size: 10px; font-variant-numeric: tabular-nums; }
.branch-tracking > span { display: inline-flex; align-items: center; gap: 2px; }
.incoming { color: #8fc5ec; }
.outgoing { color: #a6c8a0; }
.upstream-warning { color: #d5af73; font-size: 9px; }
</style>
