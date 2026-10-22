<script setup lang="ts">
import { TabsList, TabsRoot, TabsTrigger } from "reka-ui";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { ChevronDown, MessageSquare, Plus, Search, X } from "lucide-vue-next";
import type { T3Project, T3Thread } from "~/lib/types";
import { chatHistory } from "~/lib/chat-tabs";
import { isThreadRunning, repositoryThreadKey } from "~/lib/threads";
import type { ContextMenuHandle, ContextMenuItem } from "~/lib/context-menu";
const props = defineProps<{
  ids: string[];
  selected: string;
  threads: T3Thread[];
  projects: T3Project[];
  activity: Record<
    string,
    { attention: boolean; unread: boolean; completed: boolean }
  >;
  repositoryName: (path: string) => string;
  actions: (thread: T3Thread) => ContextMenuItem[];
  disabled: boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  close: [id: string];
  move: [id: string, target: string];
  new: [event: MouseEvent];
  error: [message: string];
}>();
const strip = ref<HTMLElement>(),
  pickerOpen = ref(false),
  searchInput = ref<HTMLInputElement>();
const search = ref(""),
  archived = ref(false),
  openOnly = ref(false);
const dragged = ref("");
const overflowing = ref(false);
let tabResize: ResizeObserver;
function measureTabs() {
  overflowing.value =
    !!strip.value && strip.value.scrollWidth > strip.value.clientWidth + 1;
}
onMounted(() => {
  tabResize = new ResizeObserver(measureTabs);
  if (strip.value) tabResize.observe(strip.value);
});
onUnmounted(() => tabResize?.disconnect());
const tabMenu = ref<ContextMenuHandle>(),
  pickerMenu = ref<ContextMenuHandle>();
function chatMenu(event: MouseEvent | KeyboardEvent, thread: T3Thread) {
  (pickerOpen.value ? pickerMenu.value : tabMenu.value)?.open(
    event,
    props.actions(thread),
  );
}
const tabs = computed(() =>
  props.ids
    .map((id) => props.threads.find((thread) => thread.id === id))
    .filter((thread): thread is T3Thread => !!thread && !thread.deletedAt),
);
watch(tabs, () => void nextTick(measureTabs), { deep: true });
function root(thread: T3Thread) {
  return (
    props.projects.find((project) => project.id === thread.projectId)
      ?.workspaceRoot ||
    thread.worktreePath ||
    ""
  );
}
function name(thread: T3Thread) {
  return (
    props.repositoryName(root(thread)) ||
    props.projects.find((project) => project.id === thread.projectId)?.title ||
    "Unknown repository"
  );
}
function worktree(thread: T3Thread) {
  return (
    thread.branch ||
    (thread.worktreePath &&
    repositoryThreadKey(thread.worktreePath) !==
      repositoryThreadKey(root(thread))
      ? thread.worktreePath.replaceAll("\\", "/").split("/").at(-1)
      : "")
  );
}
const groups = computed(() => {
  const items = openOnly.value
    ? tabs.value
    : archived.value
      ? props.threads.filter((thread) => !thread.deletedAt)
      : chatHistory(props.threads);
  const grouped = new Map<
    string,
    { key: string; name: string; path: string; threads: T3Thread[] }
  >();
  for (const thread of items) {
    const path = root(thread),
      key = repositoryThreadKey(path) || thread.projectId;
    if (
      !`${name(thread)} ${path} ${thread.title} ${thread.branch || ""} ${thread.worktreePath || ""}`
        .toLowerCase()
        .includes(search.value.toLowerCase().trim())
    )
      continue;
    if (!grouped.has(key))
      grouped.set(key, { key, name: name(thread), path, threads: [] });
    grouped.get(key)!.threads.push(thread);
  }
  return [...grouped.values()].sort(
    (a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path),
  );
});
async function revealSelected(focus = false) {
  await nextTick();
  const tab = strip.value?.querySelector<HTMLButtonElement>(
    '[aria-selected="true"]',
  );
  tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (focus) tab?.focus({ preventScroll: true });
}
watch(
  () => [props.selected, props.ids.join("|")],
  () => void revealSelected(),
  { flush: "post" },
);
async function openAll(onlyOpen = false) {
  openOnly.value = onlyOpen;
  search.value = "";
  archived.value = false;
  pickerOpen.value = true;
  await nextTick();
  searchInput.value?.focus();
}
function choose(id: string) {
  emit("select", id);
  pickerOpen.value = false;
}
function tabKey(event: KeyboardEvent, id: string) {
  const index = props.ids.indexOf(id);
  let target: string | undefined;
  if (event.altKey && event.key === "ArrowRight")
    target = props.ids[(index + 1) % props.ids.length];
  else if (event.altKey && event.key === "ArrowLeft")
    target = props.ids[(index - 1 + props.ids.length) % props.ids.length];
  else if (event.key === "Delete") {
    event.preventDefault();
    emit("close", id);
    return;
  }
  if (!target) return;
  event.preventDefault();
  emit("move", id, target);
  void revealSelected(true);
}
function startDrag(event: DragEvent, id: string) {
  dragged.value = id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }
}
function drop(target: string) {
  if (dragged.value) emit("move", dragged.value, target);
  dragged.value = "";
}
defineExpose({ openAll, closePicker: () => (pickerOpen.value = false) });
</script>
<template>
  <TabsRoot
    as-child
    :model-value="selected"
    @update:model-value="(id) => emit('select', String(id))"
    ><nav
      class="chat-tabs flex items-center gap-[6px] flex-1 min-w-0 h-full py-[4px] px-[12px]"
      aria-label="Chat tabs"
    >
      <TabsList as-child
        ><div
          ref="strip"
          class="chat-tab-strip flex gap-[5px] flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Open chats"
          @wheel="
            (event) => {
              if (strip && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
                strip.scrollLeft += event.deltaY;
                event.preventDefault();
              }
            }
          "
        >
          <div
            v-for="thread in tabs"
            :key="thread.id"
            class="chat-tab flex flex-[0_0_auto] h-[44px] max-w-[360px] border-[1px] border-solid border-[var(--line)] rounded-[6px] bg-[#1b202b] [&.selected]:bg-[#2a3348] [&.selected]:[border-color:#657ba8] [&>button[role='tab']]:flex [&>button[role='tab']]:items-center [&>button[role='tab']]:gap-[9px] [&>button[role='tab']]:min-w-0 [&>button[role='tab']]:pt-[5px] [&>button[role='tab']]:pr-[5px] [&>button[role='tab']]:pb-[5px] [&>button[role='tab']]:pl-[11px] [&>button[role='tab']]:border-0 [&>button[role='tab']]:bg-[transparent] [&>button[role='tab']]:text-left"
            :class="{ selected: selected === thread.id }"
            draggable="true"
            data-tauri-drag-region="false"
            @contextmenu="chatMenu($event, thread)"
            @keydown.shift.f10.stop.prevent="chatMenu($event, thread)"
            @keydown.context-menu.stop.prevent="chatMenu($event, thread)"
            role="presentation"
            @dragstart="startDrag($event, thread.id)"
            @dragend="dragged = ''"
            @dragover.prevent
            @drop.prevent="drop(thread.id)"
          >
            <TabsTrigger as-child :value="thread.id" :disabled="disabled"
              ><AppButton
                role="tab"
                aria-haspopup="menu"
                :aria-selected="selected === thread.id"
                aria-controls="conversation-panel"
                :tabindex="selected === thread.id ? 0 : -1"
                :disabled="disabled"
                :title="`${root(thread)}\n${thread.worktreePath || ''}\n${thread.title}`"
                @keydown="tabKey($event, thread.id)"
              >
                <ChatStatus
                  :attention="activity[thread.id]?.attention"
                  :unread="activity[thread.id]?.unread"
                  :running="isThreadRunning(thread)"
                  :status="thread.status"
                  :completed="
                    thread.settledOverride === 'settled' ||
                    activity[thread.id]?.completed
                  "
                />
                <span
                  class="tab-label grid gap-[3px] min-w-0 [&_small]:overflow-hidden [&_small]:whitespace-nowrap [&_small]:text-ellipsis [&_strong]:overflow-hidden [&_strong]:whitespace-nowrap [&_strong]:text-ellipsis [&_small]:text-[10px] [&_small]:leading-[12px] [&_small]:text-[#a5b5d5] [&_strong]:text-[12px] [&_strong]:leading-[15px] [&_strong]:font-medium [&_strong]:text-[#e2e7f3]"
                  ><strong>{{ thread.title }}</strong
                  ><small class="[:where(&)]:text-[11px]"
                    >{{ name(thread)
                    }}<span v-if="worktree(thread)">
                      · {{ worktree(thread) }}</span
                    ></small
                  ></span
                >
              </AppButton></TabsTrigger
            >
            <AppButton
              size="icon"
              class="tab-close icon-button self-center my-0 mx-[4px] shrink-0"
              :aria-label="`Close ${thread.title} tab`"
              title="Close tab"
              :disabled="disabled"
              @click="emit('close', thread.id)"
            >
              <X :size="13" />
            </AppButton>
          </div>
          <span
            v-if="!tabs.length"
            class="empty-tabs py-0 px-[5px] text-[#98a5bc] text-[12px]"
            >Open a chat to get started</span
          >
        </div></TabsList
      >
      <AppButton
        size="icon"
        v-if="overflowing"
        class="icon-button"
        aria-label="Open chat tabs"
        title="Open chat tabs"
        @click="openAll(true)"
      >
        <ChevronDown :size="16" />
      </AppButton>
      <AppButton
        variant="primary"
        class="primary new-chat-button [border-color:#adbbff] shrink-0 h-[32px] text-[11px]"
        aria-label="New chat"
        :disabled="disabled"
        @click="emit('new', $event)"
      >
        <Plus :size="15" />New chat
      </AppButton>
      <AppButton
        class="all-chats-button shrink-0 text-[11px] gap-[5px]"
        aria-haspopup="dialog"
        @click="openAll()"
      >
        <MessageSquare :size="14" />All chats
      </AppButton>
      <Teleport to="body">
        <AppDialog
          v-if="pickerOpen"
          :title="openOnly ? 'Open chat tabs' : 'All chats'"
          @close="pickerOpen = false"
          ><section
            class="chat-picker [width:min(660px,_calc(100vw_-_32px))] [max-height:min(720px,_calc(100vh_-_64px))] p-[20px] border-[1px] border-solid border-[#3a455c] rounded-[12px] text-[#e2e7f3] bg-[#171c26] shadow-[0_24px_80px_#0008] flex flex-col gap-[14px]"
            aria-labelledby="chat-picker-title"
          >
            <AppDialogHeader class="modal-heading">
              <h2
                class="[:where(&)]:m-0 [:where(&)]:text-[18px] [:where(&)]:font-semibold"
                id="chat-picker-title"
              >
                {{ openOnly ? "Open chat tabs" : "All chats" }}
              </h2>
              <AppButton
                size="icon"
                class="icon-button"
                aria-label="Close chat picker"
                @click="pickerOpen = false"
              >
                <X :size="18" />
              </AppButton>
            </AppDialogHeader>
            <label
              class="chat-search flex gap-[9px] items-center [&_input]:flex-1 [&_input]:min-w-0"
              ><Search :size="16" /><AppInput
                ref="searchInput"
                v-model="search"
                type="search"
                aria-label="Search chats"
                placeholder="Search chats, repositories, or branches…"
            /></label>
            <label
              v-if="!openOnly"
              class="archive-filter flex items-center gap-[8px] text-[12px] text-[#aab6ce]"
              ><AppInput v-model="archived" type="checkbox" />Include archived
              chats</label
            >
            <div class="chat-picker-results min-h-[90px] overflow-y-auto">
              <section
                v-for="group in groups"
                :key="group.key"
                class="chat-group [&_+_.chat-group]:mt-[18px] [&_h3]:mt-0 [&_h3]:mx-0 [&_h3]:mb-[7px] [&_h3]:text-[12px] [&_h3]:text-[#b7c7e8] [&_h3_small]:block [&_h3_small]:text-[10px] [&_h3_small]:font-normal [&_h3_small]:text-[#8e9bb3] [&_h3_small]:mt-[4px] [&_h3_small]:[overflow-wrap:anywhere]"
              >
                <h3
                  class="[:where(&)]:m-0 [:where(&)]:text-[16px] [:where(&)]:[font-weight:550]"
                >
                  {{ group.name
                  }}<small class="[:where(&)]:text-[11px]">{{
                    group.path
                  }}</small>
                </h3>
                <AppButton
                  v-for="thread in group.threads"
                  :key="thread.id"
                  class="chat-result w-full flex gap-[10px] items-center text-left p-[10px] bg-[transparent] border-[1px] border-solid border-[transparent] hover:bg-[#27334b] hover:[border-color:#415271] [&.current]:bg-[#27334b] [&.current]:[border-color:#415271] [&>span:not(.chat-status)]:flex-1 [&>span:not(.chat-status)]:grid [&>span:not(.chat-status)]:gap-[4px] [&>span:not(.chat-status)]:min-w-0 [&_strong]:text-[12px] [&_strong]:font-medium [&_strong]:[overflow-wrap:anywhere] [&_small]:text-[10px] [&_small]:text-[#97a8c7]"
                  :class="[{ current: selected === thread.id }]"
                  :disabled="disabled"
                  @click="choose(thread.id)"
                  aria-haspopup="menu"
                  @contextmenu="chatMenu($event, thread)"
                  @keydown.shift.f10.stop.prevent="chatMenu($event, thread)"
                  @keydown.context-menu.stop.prevent="chatMenu($event, thread)"
                >
                  <ChatStatus
                    :attention="activity[thread.id]?.attention"
                    :unread="activity[thread.id]?.unread"
                    :running="isThreadRunning(thread)"
                    :status="thread.status"
                    :completed="
                      thread.settledOverride === 'settled' ||
                      activity[thread.id]?.completed
                    "
                  />
                  <span
                    ><strong>{{ thread.title }}</strong
                    ><small class="[:where(&)]:text-[11px]"
                      >{{ worktree(thread)
                      }}{{
                        thread.archivedAt
                          ? " · Archived"
                          : thread.settledOverride === "settled"
                            ? " · Completed"
                            : ""
                      }}</small
                    ></span
                  >
                </AppButton>
              </section>
              <AppHint v-if="!groups.length" class="nav-hint">
                {{
                  search
                    ? "No chats match your search."
                    : "No chats to show. Connect T3 Code or start a new chat."
                }}
              </AppHint>
            </div>
            <ContextMenu
              ref="pickerMenu"
              @error="emit('error', $event)"
            /></section
        ></AppDialog>
      </Teleport>
      <ContextMenu ref="tabMenu" @error="emit('error', $event)" /></nav
  ></TabsRoot>
</template>
