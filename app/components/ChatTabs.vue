<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ChevronDown, MessageSquare, Plus, Search, X } from 'lucide-vue-next';
import type { T3Project, T3Thread } from '~/lib/types';
import { chatHistory } from '~/lib/chat-tabs';
import { isThreadRunning, repositoryThreadKey } from '~/lib/threads';
import type { ContextMenuHandle, ContextMenuItem } from '~/lib/context-menu';
const props = defineProps<{
  ids: string[]; selected: string; threads: T3Thread[]; projects: T3Project[];
  activity: Record<string, { attention: boolean; unread: boolean; completed: boolean }>;
  repositoryName: (path: string) => string; actions: (thread: T3Thread) => ContextMenuItem[]; disabled: boolean;
}>();
const emit = defineEmits<{
  select: [id: string]; close: [id: string]; move: [id: string, target: string]; new: [event: MouseEvent];
  error: [message: string];
}>();
const strip = ref<HTMLElement>(), picker = ref<HTMLDialogElement>(), searchInput = ref<HTMLInputElement>();
const search = ref(''), archived = ref(false), openOnly = ref(false);
const dragged = ref('');
const tabMenu = ref<ContextMenuHandle>(), pickerMenu = ref<ContextMenuHandle>();
function chatMenu(event: MouseEvent | KeyboardEvent, thread: T3Thread) {
  (picker.value?.open ? pickerMenu.value : tabMenu.value)?.open(event, props.actions(thread));
}
const tabs = computed(() => props.ids.map(id => props.threads.find(thread => thread.id === id)).filter((thread): thread is T3Thread => !!thread && !thread.deletedAt));
function root(thread: T3Thread) { return props.projects.find(project => project.id === thread.projectId)?.workspaceRoot || thread.worktreePath || ''; }
function name(thread: T3Thread) { return props.repositoryName(root(thread)) || props.projects.find(project => project.id === thread.projectId)?.title || 'Unknown repository'; }
function worktree(thread: T3Thread) {
  return thread.branch || (thread.worktreePath && repositoryThreadKey(thread.worktreePath) !== repositoryThreadKey(root(thread)) ? thread.worktreePath.replaceAll('\\', '/').split('/').at(-1) : '');
}
const groups = computed(() => {
  const items = openOnly.value ? tabs.value : archived.value ? props.threads.filter(thread => !thread.deletedAt) : chatHistory(props.threads);
  const grouped = new Map<string, { key: string; name: string; path: string; threads: T3Thread[] }>();
  for (const thread of items) {
    const path = root(thread), key = repositoryThreadKey(path) || thread.projectId;
    if (!`${name(thread)} ${path} ${thread.title} ${thread.branch || ''} ${thread.worktreePath || ''}`.toLowerCase().includes(search.value.toLowerCase().trim())) continue;
    if (!grouped.has(key)) grouped.set(key, { key, name: name(thread), path, threads: [] });
    grouped.get(key)!.threads.push(thread);
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
});
async function revealSelected(focus = false) {
  await nextTick();
  const tab = strip.value?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
  tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (focus) tab?.focus({ preventScroll: true });
}
watch(() => [props.selected, props.ids.join('|')], () => void revealSelected(), { flush: 'post' });
async function openAll(onlyOpen = false) {
  openOnly.value = onlyOpen; search.value = ''; archived.value = false;
  picker.value?.showModal();
  await nextTick(); searchInput.value?.focus();
}
function choose(id: string) { emit('select', id); picker.value?.close(); }
function tabKey(event: KeyboardEvent, id: string) {
  const index = props.ids.indexOf(id);
  let target: string | undefined;
  if (event.key === 'ArrowRight') target = props.ids[(index + 1) % props.ids.length];
  else if (event.key === 'ArrowLeft') target = props.ids[(index - 1 + props.ids.length) % props.ids.length];
  else if (event.key === 'Home') target = props.ids[0];
  else if (event.key === 'End') target = props.ids.at(-1);
  else if (event.key === 'Delete') { event.preventDefault(); emit('close', id); void revealSelected(true); return; }
  if (!target) return;
  event.preventDefault();
  if (event.altKey) emit('move', id, target);
  else emit('select', target);
  void revealSelected(true);
}
function startDrag(event: DragEvent, id: string) {
  dragged.value = id;
  if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); }
}
function drop(target: string) { if (dragged.value) emit('move', dragged.value, target); dragged.value = ''; }
defineExpose({ openAll, closePicker: () => picker.value?.close() });
</script>
<template>
  <nav class="chat-tabs" aria-label="Chat tabs">
    <div ref="strip" class="chat-tab-strip" role="tablist" aria-label="Open chats" @wheel="event => { if (strip && Math.abs(event.deltaY) > Math.abs(event.deltaX)) { strip.scrollLeft += event.deltaY; event.preventDefault(); } }">
      <div v-for="thread in tabs" :key="thread.id" class="chat-tab" :class="{ selected: selected === thread.id }" draggable="true"
        @contextmenu="chatMenu($event, thread)" @keydown.shift.f10.stop.prevent="chatMenu($event, thread)" @keydown.context-menu.stop.prevent="chatMenu($event, thread)"
        role="presentation" @dragstart="startDrag($event, thread.id)" @dragend="dragged = ''" @dragover.prevent @drop.prevent="drop(thread.id)">
        <button role="tab" aria-haspopup="menu" :aria-selected="selected === thread.id" aria-controls="conversation-panel" :tabindex="selected === thread.id ? 0 : -1"
          :disabled="disabled" :title="`${root(thread)}\n${thread.worktreePath || ''}\n${thread.title}`" @click="emit('select', thread.id)" @keydown="tabKey($event, thread.id)">
          <ChatStatus :attention="activity[thread.id]?.attention" :unread="activity[thread.id]?.unread" :running="isThreadRunning(thread)" :status="thread.status" :completed="thread.settledOverride === 'settled' || activity[thread.id]?.completed" />
          <span class="tab-label"><strong>{{ thread.title }}</strong><small>{{ name(thread) }}<span v-if="worktree(thread)"> · {{ worktree(thread) }}</span></small></span>
        </button>
        <button class="tab-close icon-button" :aria-label="`Close ${thread.title} tab`" title="Close tab" :disabled="disabled" @click="emit('close', thread.id); revealSelected(true)"><X :size="13" /></button>
      </div>
      <span v-if="!tabs.length" class="empty-tabs">Open a chat to get started</span>
    </div>
    <button class="icon-button" aria-label="Open chat tabs" title="Open chat tabs" @click="openAll(true)"><ChevronDown :size="16" /></button>
    <button class="icon-button" aria-label="New chat" title="New chat" :disabled="disabled" @click="emit('new', $event)"><Plus :size="17" /></button>
    <button class="all-chats-button" aria-haspopup="dialog" @click="openAll()"><MessageSquare :size="14" />All chats</button>
    <Teleport to="body">
      <dialog ref="picker" class="chat-picker" aria-labelledby="chat-picker-title" @click="event => { if (event.target === picker) picker?.close(); }">
        <div class="modal-heading"><h2 id="chat-picker-title">{{ openOnly ? 'Open chat tabs' : 'All chats' }}</h2><button class="icon-button" aria-label="Close chat picker" @click="picker?.close()"><X :size="18" /></button></div>
        <label class="chat-search"><Search :size="16" /><input ref="searchInput" v-model="search" type="search" aria-label="Search chats" placeholder="Search chats, repositories, or branches…" /></label>
        <label v-if="!openOnly" class="archive-filter"><input v-model="archived" type="checkbox" />Include archived chats</label>
        <div class="chat-picker-results">
          <section v-for="group in groups" :key="group.key" class="chat-group">
            <h3>{{ group.name }}<small>{{ group.path }}</small></h3>
            <button v-for="thread in group.threads" :key="thread.id" class="chat-result" :class="{ current: selected === thread.id }" :disabled="disabled" @click="choose(thread.id)"
              aria-haspopup="menu" @contextmenu="chatMenu($event, thread)" @keydown.shift.f10.stop.prevent="chatMenu($event, thread)" @keydown.context-menu.stop.prevent="chatMenu($event, thread)">
              <ChatStatus :attention="activity[thread.id]?.attention" :unread="activity[thread.id]?.unread" :running="isThreadRunning(thread)" :status="thread.status" :completed="thread.settledOverride === 'settled' || activity[thread.id]?.completed" />
              <span><strong>{{ thread.title }}</strong><small>{{ worktree(thread) }}{{ thread.archivedAt ? ' · Archived' : thread.settledOverride === 'settled' ? ' · Completed' : '' }}</small></span>
            </button>
          </section>
          <p v-if="!groups.length" class="nav-hint">{{ search ? 'No chats match your search.' : 'No chats to show. Connect T3 Code or start a new chat.' }}</p>
        </div>
        <ContextMenu ref="pickerMenu" @error="emit('error', $event)" />
      </dialog>
    </Teleport>
    <ContextMenu ref="tabMenu" @error="emit('error', $event)" />
  </nav>
</template>
<style scoped>
.chat-tabs { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 9px 14px; border-bottom: 1px solid var(--line); background: #151923; }
.chat-tab-strip { display: flex; gap: 5px; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: thin; }
.chat-tab { display: flex; flex: 0 0 auto; max-width: 360px; border: 1px solid var(--line); border-radius: 7px; background: #1b202b; }
.chat-tab.selected { background: #2a3348; border-color: #657ba8; }
.chat-tab > button[role="tab"] { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 7px 5px 7px 11px; border: 0; background: transparent; text-align: left; }
.tab-label { display: grid; gap: 3px; min-width: 0; }
.tab-label small, .tab-label strong { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tab-label small { font-size: 10px; color: #a5b5d5; }
.tab-label strong { font-size: 12px; font-weight: 500; color: #e2e7f3; }
.tab-close { align-self: center; margin: 0 4px; padding: 4px; flex-shrink: 0; }
.empty-tabs { padding: 13px 5px; color: #98a5bc; font-size: 12px; }
.all-chats-button { flex-shrink: 0; font-size: 11px; gap: 5px; }
.chat-picker { width: min(660px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 64px)); padding: 20px; border: 1px solid #3a455c; border-radius: 12px; color: #e2e7f3; background: #171c26; box-shadow: 0 24px 80px #0008; }
.chat-picker::backdrop { background: #090c14aa; }
.chat-picker[open] { display: flex; flex-direction: column; gap: 14px; }
.chat-search { display: flex; gap: 9px; align-items: center; }
.chat-search input { flex: 1; min-width: 0; }
.archive-filter { display: flex; align-items: center; gap: 8px; font-size: 12px; color: #aab6ce; }
.chat-picker-results { min-height: 90px; overflow-y: auto; }
.chat-group + .chat-group { margin-top: 18px; }
.chat-group h3 { margin: 0 0 7px; font-size: 12px; color: #b7c7e8; }
.chat-group h3 small { display: block; font-size: 10px; font-weight: normal; color: #8e9bb3; margin-top: 4px; overflow-wrap: anywhere; }
.chat-result { width: 100%; display: flex; gap: 10px; align-items: center; text-align: left; padding: 10px; background: transparent; border: 1px solid transparent; }
.chat-result:hover, .chat-result.current { background: #27334b; border-color: #415271; }
.chat-result > span:not(.chat-status) { flex: 1; display: grid; gap: 4px; min-width: 0; }
.chat-result strong { font-size: 12px; font-weight: 500; overflow-wrap: anywhere; }
.chat-result small { font-size: 10px; color: #97a8c7; }
</style>
