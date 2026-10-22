<script setup lang="ts">
import { ref, useId } from 'vue';
import { Check, ChevronDown, FolderGit2 } from 'lucide-vue-next';
const props = defineProps<{
  options: { path: string; label: string }[];
  value: string;
  disabled: boolean;
  hint: string;
}>();
const emit = defineEmits<{ select: [path: string] }>();
const menu = ref<HTMLDivElement>(), trigger = ref<HTMLButtonElement>();
const menuId = useId();
const expanded = ref(false);
function open() {
  if (props.disabled || !menu.value || !trigger.value) return;
  if (menu.value.matches(':popover-open')) { menu.value.hidePopover(); return; }
  const rect = trigger.value.getBoundingClientRect();
  menu.value.style.width = `${Math.min(420, Math.max(280, rect.width), innerWidth - 16)}px`;
  menu.value.showPopover();
  menu.value.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - menu.value.offsetWidth - 8))}px`;
  menu.value.style.top = `${Math.max(8, Math.min(rect.bottom + 5, innerHeight - menu.value.offsetHeight - 8))}px`;
  menu.value.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
}
function choose(path: string) {
  menu.value?.hidePopover();
  trigger.value?.focus();
  if (!props.disabled && path !== props.value) emit('select', path);
}
function navigate(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault(); menu.value?.hidePopover(); trigger.value?.focus(); return;
  }
  if (event.key === 'Tab') { menu.value?.hidePopover(); trigger.value?.focus(); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...menu.value!.querySelectorAll<HTMLButtonElement>('button')];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}
</script>

<template>
  <div class="working-folder" :title="`${value}\n${hint}`">
    <span class="working-folder-label"><FolderGit2 :size="14" />Working in</span>
    <button ref="trigger" class="working-folder-trigger" :disabled="disabled" aria-label="Agent working folder" :aria-description="`${value}. ${hint}`"
      aria-haspopup="menu" :aria-expanded="expanded" :aria-controls="menuId" @click="open" @keydown.down.prevent="open" @keydown.up.prevent="open">
      <span>{{ options.find(option => option.path === value)?.label || 'Current folder' }}</span><ChevronDown :size="13" />
    </button>
    <div :id="menuId" ref="menu" popover="auto" role="menu" aria-label="Agent working folder" class="working-folder-menu"
      @toggle="expanded = $event.newState === 'open'" @keydown="navigate">
      <div class="working-folder-heading">Choose where the agent works</div>
      <button v-for="option in options" :key="option.path" role="menuitemradio" :aria-checked="option.path === value" :disabled="disabled" @click="choose(option.path)">
        <FolderGit2 :size="16" />
        <span class="working-folder-copy"><strong>{{ option.label }}</strong><small :title="option.path">{{ option.path }}</small></span>
        <Check v-if="option.path === value" :size="15" class="working-folder-check" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.working-folder { display: flex; align-items: center; gap: 8px; padding: 5px 12px; border-bottom: 1px solid var(--line); color: #96a3ba; }
.working-folder-label { display: flex; align-items: center; gap: 6px; flex-shrink: 0; font-size: 11px; }
.working-folder-trigger { flex: 1; min-width: 0; justify-content: space-between; padding: 5px 8px; font-size: 11px; color: #c4ccdc; }
.working-folder-trigger > span { overflow: hidden; text-overflow: ellipsis; }
.working-folder-trigger[aria-expanded="true"] { background: #252c3a; }
.working-folder-menu { position: fixed; inset: auto; margin: 0; max-width: calc(100vw - 16px); max-height: min(360px, calc(100vh - 16px)); overflow: auto; padding: 5px; background: #1b202b; color: #c4ccdc; border: 1px solid #35405a; border-radius: 8px; box-shadow: 0 12px 32px #0008; }
.working-folder-heading { padding: 7px 9px 9px; color: #8e9bb4; font-size: 10px; }
.working-folder-menu > button { display: flex; width: 100%; gap: 10px; padding: 10px 9px; text-align: left; border-radius: 5px; }
.working-folder-menu > button[aria-checked="true"] { background: #293348; }
.working-folder-menu > button:focus-visible { outline-offset: -2px; background: #303b50; }
.working-folder-copy { display: grid; flex: 1; gap: 4px; min-width: 0; }
.working-folder-copy strong, .working-folder-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.working-folder-copy strong { color: #d7deed; font-size: 12px; font-weight: 500; }
.working-folder-copy small { color: #8e9bb4; font-size: 10px; }
.working-folder-check { color: #a7b6ff; }
</style>
