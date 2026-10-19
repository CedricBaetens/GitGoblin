<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';

const props = defineProps<{
  modelValue?: number;
  label: string;
  controls: string;
  storageKey: string;
  min: number;
  max: number;
  horizontal?: boolean;
  reverse?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: number | undefined] }>();
const handle = ref<HTMLElement>();
const size = ref(0), dragging = ref(false);
const maximum = computed(() => Math.max(props.min, props.max));
let pointer: number | undefined, start = 0, startSize = 0;
let observer: ResizeObserver | undefined;
const clamp = (value: number) => Math.round(Math.max(props.min, Math.min(maximum.value, value)));
function save(value: number | undefined) {
  try {
    if (value === undefined) localStorage.removeItem(props.storageKey);
    else localStorage.setItem(props.storageKey, String(value));
  } catch { /* Resizing remains available without storage. */ }
}
function startResize(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  pointer = event.pointerId;
  start = props.horizontal ? event.clientY : event.clientX;
  startSize = size.value;
  dragging.value = true;
  handle.value!.focus({ preventScroll: true });
  handle.value!.setPointerCapture(pointer);
}
function move(event: PointerEvent) {
  if (event.pointerId !== pointer) return;
  const delta = (props.horizontal ? event.clientY : event.clientX) - start;
  emit('update:modelValue', clamp(startSize + delta * (props.reverse ? -1 : 1)));
}
function stop(event: PointerEvent) {
  if (event.pointerId !== pointer) return;
  pointer = undefined;
  dragging.value = false;
  save(props.modelValue);
  if (handle.value?.hasPointerCapture(event.pointerId)) handle.value.releasePointerCapture(event.pointerId);
}
function keydown(event: KeyboardEvent) {
  const decrease = props.horizontal ? 'ArrowUp' : 'ArrowLeft';
  const increase = props.horizontal ? 'ArrowDown' : 'ArrowRight';
  let value: number;
  if (event.key === 'Home') value = props.min;
  else if (event.key === 'End') value = maximum.value;
  else if (event.key === decrease || event.key === increase)
    value = clamp(size.value + (event.key === increase ? 1 : -1) * (props.reverse ? -1 : 1) * (event.shiftKey ? 32 : 16));
  else return;
  event.preventDefault();
  event.stopPropagation();
  emit('update:modelValue', value);
  save(value);
}
function reset() {
  emit('update:modelValue', undefined);
  save(undefined);
}
onMounted(() => {
  try {
    const saved = localStorage.getItem(props.storageKey);
    if (saved !== null && Number.isFinite(Number(saved))) emit('update:modelValue', Number(saved));
  } catch { /* Use the layout's default size when storage is unavailable. */ }
  const parent = handle.value!.parentElement!;
  observer = new ResizeObserver(() => {
    const rect = parent.getBoundingClientRect();
    size.value = Math.round(props.horizontal ? rect.height : rect.width);
  });
  observer.observe(parent);
});
onUnmounted(() => observer?.disconnect());
</script>

<template>
  <div ref="handle" class="pane-resize" :class="{ horizontal, reverse, dragging }" role="separator" tabindex="0"
    :aria-label="label" :aria-controls="controls" :aria-orientation="horizontal ? 'horizontal' : 'vertical'"
    :aria-valuenow="size" :aria-valuemin="min" :aria-valuemax="maximum"
    title="Drag to resize; double-click to reset. Arrow keys also resize."
    @pointerdown="startResize" @pointermove="move" @pointerup="stop" @pointercancel="stop" @lostpointercapture="stop"
    @keydown="keydown" @dblclick="reset" />
</template>

<style scoped>
.pane-resize { position: absolute; top: 0; bottom: 0; right: -4px; width: 8px; z-index: 30; cursor: col-resize; touch-action: none; outline: none; }
.pane-resize::after { content: ''; position: absolute; inset: 0 3px; background: transparent; transition: background .12s; }
.pane-resize.reverse { right: auto; left: -4px; }
.pane-resize.horizontal { top: auto; left: 0; right: 0; bottom: -4px; width: auto; height: 8px; cursor: row-resize; }
.pane-resize.horizontal.reverse { top: -4px; bottom: auto; }
.pane-resize.horizontal::after { inset: 3px 0; }
.pane-resize:hover::after, .pane-resize:focus-visible::after, .pane-resize.dragging::after { background: #9baef2; }
</style>
