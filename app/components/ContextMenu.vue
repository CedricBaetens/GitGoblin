<script setup lang="ts">
import { nextTick, ref } from 'vue';
type Item = { label: string; disabled?: boolean; run: () => unknown };
const emit = defineEmits<{ error: [message: string] }>();
const element = ref<HTMLDivElement>();
const items = ref<Item[]>([]);
let trigger: HTMLElement | undefined;
async function open(event: MouseEvent | KeyboardEvent, actions: Item[]) {
  event.preventDefault();
  trigger = event.currentTarget as HTMLElement;
  items.value = actions;
  const rect = trigger.getBoundingClientRect();
  const mouse = event instanceof MouseEvent && (event.clientX || event.clientY);
  const x = mouse ? event.clientX : rect.left;
  const y = mouse ? event.clientY : rect.bottom;
  await nextTick();
  const menu = element.value;
  if (!menu) return;
  menu.showPopover();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - menu.offsetWidth - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 4))}px`;
  menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}
function close() { element.value?.hidePopover(); }
async function choose(item: Item) {
  if (item.disabled) return;
  close();
  trigger?.focus({ preventScroll: true });
  try { await item.run(); } catch (error) { emit('error', String(error)); }
}
function navigate(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault(); close(); trigger?.focus({ preventScroll: true }); return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...element.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[index]?.focus();
}
defineExpose({ open, close });
</script>
<template>
  <div ref="element" popover="auto" role="menu" aria-label="Sidebar actions" class="sidebar-context-menu" @keydown="navigate" @contextmenu.prevent>
    <button v-for="item in items" :key="item.label" role="menuitem" :disabled="item.disabled" @click="choose(item)">{{ item.label }}</button>
  </div>
</template>
<style scoped>
.sidebar-context-menu { position: fixed; inset: auto; margin: 0; padding: 4px; min-width: 190px; max-width: calc(100vw - 8px); max-height: calc(100vh - 8px); overflow: auto; background: #1b202b; color: #d3dffa; border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 8px 28px #0008; }
button { display: flex; width: 100%; justify-content: flex-start; padding: 7px 10px; font-size: 11px; border-radius: 3px; }
button:focus-visible { outline: 1px solid #8ca5e7; outline-offset: -1px; background: #2a3244; }
</style>
