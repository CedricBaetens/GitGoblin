<script setup lang="ts">
import {
  ChevronRight,
  Folder,
  GitBranch,
  Check,
  ArrowDown,
  ArrowUp,
  Unplug,
  Search,
  Filter,
} from "lucide-vue-next";
import type { BranchNode } from "~/lib/branches";
import type { GitRef } from "~/lib/types";
defineProps<{
  nodes: BranchNode[];
  filtersDisabled?: boolean;
  activeFilter?: { name: string; mode: "only" | "exclude" };
}>();
defineEmits<{
  select: [branch: GitRef];
  filter: [branch: GitRef, mode: "only" | "exclude"];
  context: [event: MouseEvent | KeyboardEvent, branch: GitRef];
}>();
function branchTitle(branch: GitRef) {
  if (!branch.name.startsWith("refs/heads/"))
    return branch.name.replace("refs/remotes/", "");
  const tracking = !branch.upstream
    ? "No upstream branch configured"
    : branch.upstreamGone
      ? `Upstream ${branch.upstream} is missing (fetch with prune to refresh)`
      : `${branch.upstream}: ${branch.behind || 0} incoming, ${branch.ahead || 0} outgoing commits (as of last fetch)`;
  return `${branch.name.slice("refs/heads/".length)}\n${tracking}`;
}
</script>

<template>
  <ul class="branch-tree list-none p-0 m-0 min-w-0 [details>&]:pl-[15px]">
    <li v-for="node in nodes" :key="node.path">
      <details v-if="node.children.length" open>
        <AppTreeRow
          as="summary"
          class="tree-row min-h-[28px] [&.current]:text-[#d6f4e1] [&.current]:bg-[#20372e] [&.current]:shadow-[inset_2px_0_#8bcca6] cursor-pointer list-none rounded-[6px] [&::-webkit-details-marker]:hidden hover:bg-[#252831] hover:text-[#f0f1f7] focus-visible:[outline:2px_solid_var(--blue)] focus-visible:outline-offset-[-2px] pt-[5px] pb-[5px] [&.current]:font-semibold [&.current>svg]:text-[#a0dfb9] [summary&]:text-[#aab8ce] [button&]:pl-[32px] [&>.branch-tracking]:flex [&>.branch-tracking]:flex-[0_0_auto] [&>.branch-tracking]:gap-[6px] [&>.branch-tracking]:ml-auto [&>.branch-tracking]:overflow-visible [&>.branch-tracking]:text-[10px] [&>.branch-tracking]:tabular-nums"
          :title="node.path"
        >
          <ChevronRight
            class="folder-chevron [details[open]>summary>&]:rotate-90"
            :size="12"
          /><Folder :size="14" /><span>{{ node.name }}</span>
        </AppTreeRow>
        <BranchTree
          :nodes="node.children"
          :filters-disabled="filtersDisabled"
          :active-filter="activeFilter"
          @filter="(branch, mode) => $emit('filter', branch, mode)"
          @select="$emit('select', $event)"
          @context="(event, branch) => $emit('context', event, branch)"
        />
      </details>
      <div v-else-if="node.branch" class="flex items-center min-w-0">
        <AppTreeRow
          class="min-w-0 flex-1 tree-row min-h-[28px] [&.current]:text-[#d6f4e1] [&.current]:bg-[#20372e] [&.current]:shadow-[inset_2px_0_#8bcca6] pt-[5px] pb-[5px] [&.current]:font-semibold [&.current>svg]:text-[#a0dfb9] [summary&]:text-[#aab8ce] [button&]:pl-[32px] [&>.branch-tracking]:flex [&>.branch-tracking]:flex-[0_0_auto] [&>.branch-tracking]:gap-[6px] [&>.branch-tracking]:ml-auto [&>.branch-tracking]:overflow-visible [&>.branch-tracking]:text-[10px] [&>.branch-tracking]:tabular-nums"
          :class="[[{ current: node.branch.current }]]"
          :title="branchTitle(node.branch)"
          :aria-current="node.branch.current ? 'true' : undefined"
          aria-haspopup="menu"
          @contextmenu="$emit('context', $event, node.branch)"
          @keydown.shift.f10.prevent="$emit('context', $event, node.branch)"
          @click="$emit('select', node.branch)"
        >
          <Check v-if="node.branch.current" :size="14" /><GitBranch
            v-else
            :size="14"
          />
          <span>{{ node.name }}</span>
          <span
            v-if="node.branch.name.startsWith('refs/heads/')"
            class="branch-tracking [&>span]:inline-flex [&>span]:items-center [&>span]:gap-[2px]"
          >
            <span
              v-if="!node.branch.upstream || node.branch.upstreamGone"
              class="upstream-warning text-[#d5af73] text-[9px]"
            >
              <Unplug :size="11" />{{
                node.branch.upstreamGone ? "Upstream gone" : "No upstream"
              }}
            </span>
            <template v-else>
              <span
                v-if="node.branch.behind"
                class="incoming text-[#8fc5ec]"
                :title="`${node.branch.behind} commits to pull from ${node.branch.upstream}`"
                ><ArrowDown :size="12" />{{ node.branch.behind }}</span
              >
              <span
                v-if="node.branch.ahead"
                class="outgoing text-[#a6c8a0]"
                :title="`${node.branch.ahead} commits ahead of ${node.branch.upstream}`"
                ><ArrowUp :size="12" />{{ node.branch.ahead }}</span
              >
            </template>
          </span>
        </AppTreeRow>
        <div class="flex shrink-0 items-center gap-[2px] pr-[4px]">
          <AppButton
            size="icon"
            class="!w-[22px] !h-[22px] !p-[3px] aria-pressed:bg-[#334568] aria-pressed:text-[#c4d3ff] aria-pressed:border-[#7e9ce0] aria-pressed:hover:bg-[#405780]"
            :disabled="filtersDisabled"
            :title="`Only view ${node.name}`"
            :aria-label="`Only view ${node.name}`"
            :aria-pressed="activeFilter?.name === node.branch.name && activeFilter.mode === 'only'"
            @click="$emit('filter', node.branch, 'only')"
            ><Search :size="13"
          /></AppButton>
          <AppButton
            size="icon"
            class="!w-[22px] !h-[22px] !p-[3px] aria-pressed:bg-[#334568] aria-pressed:text-[#c4d3ff] aria-pressed:border-[#7e9ce0] aria-pressed:hover:bg-[#405780]"
            :disabled="filtersDisabled"
            :title="`Exclude ${node.name} from history`"
            :aria-label="`Exclude ${node.name} from history`"
            :aria-pressed="activeFilter?.name === node.branch.name && activeFilter.mode === 'exclude'"
            @click="$emit('filter', node.branch, 'exclude')"
            ><Filter :size="13"
          /></AppButton>
        </div>
      </div>
    </li>
  </ul>
</template>
