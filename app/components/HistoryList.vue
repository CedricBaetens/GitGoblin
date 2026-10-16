<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';
import { commitGraph } from '~/lib/graph';
import type { Commit } from '~/lib/types';
const props = defineProps<{ commits: Commit[]; selected?: string; loading: boolean; hasMore: boolean }>();
const emit = defineEmits<{ select: [commit: Commit]; loadMore: [] }>();
const list = ref<HTMLElement>();
const scroll = ref(0), height = ref(400);
const rowHeight = 22, headerHeight = 24;
const graph = computed(() => commitGraph(props.commits));
const graphWidth = computed(() => graph.value.reduce((width, row) => Math.max(width, row.width * 12 + 10), 24));
const start = computed(() => Math.max(0, Math.floor((scroll.value - headerHeight) / rowHeight) - 15));
const end = computed(() => Math.min(props.commits.length, start.value + Math.ceil(height.value / rowHeight) + 30));
const visible = computed(() => props.commits.slice(start.value, end.value));
let observer: ResizeObserver | undefined;
function onScroll() {
  if (!list.value) return;
  scroll.value = list.value.scrollTop;
  if (props.hasMore && !props.loading && list.value.scrollHeight - scroll.value - height.value < 180) emit('loadMore');
}
onMounted(() => {
  observer = new ResizeObserver(() => { height.value = list.value?.clientHeight || 400; });
  if (list.value) observer.observe(list.value);
});
onUnmounted(() => observer?.disconnect());
watch(() => props.commits[0]?.id, () => { if (list.value) list.value.scrollTop = 0; scroll.value = 0; });
function navigate(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !props.commits.length) return;
  event.preventDefault();
  const current = props.commits.findIndex((commit) => commit.id === props.selected);
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? props.commits.length - 1
    : Math.max(0, Math.min(props.commits.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
  emit('select', props.commits[index]!);
  const el = list.value;
  if (el) {
    const top = index * rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowHeight > el.scrollTop + el.clientHeight - headerHeight) el.scrollTop = top + rowHeight - el.clientHeight + headerHeight;
    el.focus({ preventScroll: true });
  }
}
</script>

<template>
  <div ref="list" class="history-list" tabindex="0" aria-label="Commit history" :aria-busy="loading"
    :style="{ '--graph-width': `${graphWidth}px` }" @scroll="onScroll" @keydown="navigate">
    <div class="history-columns"><span>GRAPH</span><span>COMMIT</span><span>AUTHOR</span><span>HASH</span><span>DATE</span></div>
    <div :style="{ height: `${start * rowHeight}px` }" aria-hidden="true" />
    <button v-for="(commit, i) in visible" :key="commit.id" class="commit-row" :class="{ active: selected === commit.id }"
      :aria-current="selected === commit.id ? 'true' : undefined" @click="emit('select', commit)">
      <HistoryGraph :row="graph[start + i]!" />
      <span class="commit-subject" :title="`${commit.refs ? commit.refs + '\n' : ''}${commit.subject}`"><span v-if="commit.refs" class="ref-label">{{ commit.refs }}</span>{{ commit.subject }}</span>
      <span class="commit-author" :title="commit.author"><span class="commit-avatar">{{ commit.author.split(' ').map(part => part[0]).slice(0, 2).join('') }}</span>{{ commit.author }}</span>
      <code :title="commit.id">{{ commit.id.slice(0, 7) }}</code><time class="commit-date" :title="commit.date">{{ commit.date.slice(0, 16).replace('T', ' ') }}</time>
    </button>
    <div :style="{ height: `${Math.max(0, commits.length - end) * rowHeight}px` }" aria-hidden="true" />
    <div class="history-footer"><span>{{ commits.length }} commits loaded</span><button v-if="hasMore" class="small" :disabled="loading" @click="emit('loadMore')">{{ loading ? 'Loading…' : 'Load older commits' }}</button><span v-else>{{ loading ? 'Loading…' : commits.length ? 'End of history' : 'No matching commits' }}</span></div>
  </div>
</template>

<style scoped>
.history-list { overflow-anchor: none; }
.history-columns, .commit-row { grid-template-columns: var(--graph-width) minmax(120px, 1fr) 140px 65px 130px; gap: 8px; padding: 0 8px; min-width: 620px; }
.history-columns { height: 24px; box-sizing: border-box; }
.commit-row { height: 22px; min-height: 22px; border: 0; font-size: 11px; }
.history-graph { display: block; }
.commit-subject { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
.ref-label { flex-shrink: 0; max-width: 42%; overflow: hidden; text-overflow: ellipsis; margin: 0; padding: 0 4px; line-height: 15px; font-size: 9px; border-color: #7b633b; background: #493b24; color: #e4c385; }
.commit-author { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
.commit-avatar { flex-shrink: 0; display: grid; place-items: center; height: 14px; width: 14px; border-radius: 3px; background: #475675; color: #e2e7f2; font-size: 7px; }
.commit-date { white-space: nowrap; }
.history-footer { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; min-height: 30px; font-size: 10px; color: #8a96ad; }
</style>
