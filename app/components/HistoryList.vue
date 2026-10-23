<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from "vue";
import { historyRefs } from "~/lib/history-refs";
import { commitGraph } from "~/lib/graph";
import type { Commit } from "~/lib/types";
const props = defineProps<{
  commits: Commit[];
  selected?: string;
  loading: boolean;
  hasMore: boolean;
}>();
const emit = defineEmits<{
  select: [commit: Commit];
  loadMore: [];
  context: [event: MouseEvent | KeyboardEvent, commit: Commit];
}>();
const list = ref<HTMLElement>();
const scroll = ref(0),
  height = ref(400);
const rowHeight = 22,
  headerHeight = 24;
const graph = computed(() => commitGraph(props.commits));
const graphWidth = computed(() =>
  graph.value.reduce((width, row) => Math.max(width, row.width * 12 + 10), 24),
);
const start = computed(() =>
  Math.max(0, Math.floor((scroll.value - headerHeight) / rowHeight) - 15),
);
const end = computed(() =>
  Math.min(
    props.commits.length,
    start.value + Math.ceil(height.value / rowHeight) + 30,
  ),
);
const visible = computed(() =>
  props.commits.slice(start.value, end.value).map((commit) => ({
    ...commit,
    refs: historyRefs(commit.refs),
  })),
);
let observer: ResizeObserver | undefined;
function onScroll() {
  if (!list.value) return;
  scroll.value = list.value.scrollTop;
  if (
    props.hasMore &&
    !props.loading &&
    list.value.scrollHeight - scroll.value - height.value < 180
  )
    emit("loadMore");
}
onMounted(() => {
  observer = new ResizeObserver(() => {
    height.value = list.value?.clientHeight || 400;
  });
  if (list.value) observer.observe(list.value);
});
onUnmounted(() => observer?.disconnect());
watch(
  () => props.commits[0]?.id,
  () => {
    if (list.value) list.value.scrollTop = 0;
    scroll.value = 0;
  },
);
function navigate(event: KeyboardEvent) {
  if (
    !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
    !props.commits.length
  )
    return;
  event.preventDefault();
  const current = props.commits.findIndex(
    (commit) => commit.id === props.selected,
  );
  const index =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? props.commits.length - 1
        : Math.max(
            0,
            Math.min(
              props.commits.length - 1,
              current + (event.key === "ArrowDown" ? 1 : -1),
            ),
          );
  emit("select", props.commits[index]!);
  const el = list.value;
  if (el) {
    const top = index * rowHeight;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + rowHeight > el.scrollTop + el.clientHeight - headerHeight)
      el.scrollTop = top + rowHeight - el.clientHeight + headerHeight;
    el.focus({ preventScroll: true });
  }
}
</script>

<template>
  <div
    ref="list"
    class="history-list overflow-auto flex-1 min-h-[140px] [overflow-anchor:none] [&_.history-graph]:block"
    tabindex="0"
    aria-label="Commit history"
    :aria-busy="loading"
    :style="{ '--graph-width': `${graphWidth}px` }"
    @scroll="onScroll"
    @keydown="navigate"
  >
    <div
      class="history-columns grid grid-cols-[var(--graph-width)_minmax(120px,_1fr)_140px_65px_130px] items-center w-full gap-[8px] py-0 px-[8px] text-left rounded-none text-[8px] tracking-[1px] text-[#66748e] border-t-[1px] border-solid border-t-[var(--line)] border-b-[1px] border-b-[var(--line)] sticky top-0 bg-[#191c23] z-[1] min-w-[620px] h-[24px] box-border"
    >
      <span>GRAPH</span><span>COMMIT</span><span>AUTHOR</span><span>HASH</span
      ><span>DATE</span>
    </div>
    <div :style="{ height: `${start * rowHeight}px` }" aria-hidden="true" />
    <AppButton
      v-for="(commit, i) in visible"
      :key="commit.id"
      class="commit-row [.segmented_button&.active]:bg-[#292d38] [.segmented_button&.active]:text-[#d1d8ed] [.segmented_button&.active]:shadow-[0_1px_3px_#0004] grid grid-cols-[var(--graph-width)_minmax(120px,_1fr)_140px_65px_130px] items-center w-full gap-[8px] py-0 px-[8px] text-left rounded-none h-[22px] text-[11px] border-b-[1px] border-solid border-b-[#202632] [&.active]:bg-[#252e43] [&.active]:text-[#ccd9ff] [&_code]:text-[10px] [&_code]:text-[#7c8db2] min-w-[620px] min-h-[22px] border-0"
      :class="[{ active: selected === commit.id }]"
      :aria-current="selected === commit.id ? 'true' : undefined"
      aria-haspopup="menu"
      @contextmenu="emit('context', $event, commit)"
      @keydown.shift.f10.prevent="emit('context', $event, commit)"
      @keydown.context-menu.prevent="emit('context', $event, commit)"
      @click="emit('select', commit)"
    >
      <HistoryGraph :row="graph[start + i]!" />
      <span
        class="commit-subject overflow-hidden text-ellipsis whitespace-nowrap flex items-center gap-[6px]"
        :title="`${commit.refs ? commit.refs + '\n' : ''}${commit.subject}`"
        ><span
          v-if="commit.refs"
          class="ref-label inline-block ml-[9px] py-0 px-[4px] border-[1px] border-solid border-[#3d4a64] bg-[#493b24] text-[9px] text-[#e4c385] rounded-[3px] shrink-0 max-w-[42%] overflow-hidden text-ellipsis m-0 leading-[15px] [border-color:#7b633b]"
          >{{ commit.refs }}</span
        >{{ commit.subject }}</span
      >
      <span
        class="commit-author text-[10px] text-[#7c89a5] overflow-hidden text-ellipsis flex items-center gap-[5px] whitespace-nowrap"
        :title="commit.author"
        ><span
          class="commit-avatar shrink-0 grid place-items-center h-[14px] w-[14px] rounded-[3px] bg-[#475675] text-[#e2e7f2] text-[7px]"
          >{{
            commit.author
              .split(" ")
              .map((part) => part[0])
              .slice(0, 2)
              .join("")
          }}</span
        >{{ commit.author }}</span
      >
      <code
        class="[:where(&)]:font-['Cascadia_Code',_'JetBrains_Mono',_Consolas,_monospace]"
        :title="commit.id"
        >{{ commit.id.slice(0, 7) }}</code
      ><time
        class="commit-date text-[#7c89a5] text-[10px] whitespace-nowrap"
        :title="commit.date"
        >{{ commit.date.slice(0, 16).replace("T", " ") }}</time
      >
    </AppButton>
    <div
      :style="{ height: `${Math.max(0, commits.length - end) * rowHeight}px` }"
      aria-hidden="true"
    />
    <div
      class="history-footer flex justify-between items-center py-[6px] px-[12px] min-h-[30px] text-[10px] text-[#8a96ad]"
    >
      <span>{{ commits.length }} commits loaded</span
      ><AppButton
        v-if="hasMore"
        class="small text-[11px] py-[4px] px-[7px] [border-color:#30343f] rounded-[4px]"
        :disabled="loading"
        @click="emit('loadMore')"
      >
        {{ loading ? "Loading…" : "Load older commits" }}</AppButton
      ><span v-else>{{
        loading
          ? "Loading…"
          : commits.length
            ? "End of history"
            : "No matching commits"
      }}</span>
    </div>
  </div>
</template>
