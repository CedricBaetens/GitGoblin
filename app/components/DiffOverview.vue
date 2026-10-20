<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import type { DiffChange } from '~/lib/diff-window';

const props = defineProps<{ scroller?: HTMLElement; revision: unknown; changes?: DiffChange[] }>();
const markers = ref<{ top: number; height: number; kind: string; line: string; offset: number }[]>([]);
const viewport = ref({ top: 0, height: 100 });
let observer: ResizeObserver | undefined;
let frame = 0;
function updateViewport() {
  const el = props.scroller;
  if (!el) return;
  viewport.value = { top: el.scrollTop / el.scrollHeight * 100, height: el.clientHeight / el.scrollHeight * 100 };
}
function measure() {
  const el = props.scroller;
  if (!el) return;
  const origin = el.getBoundingClientRect().top;
  const height = el.scrollHeight;
  const groups: typeof markers.value = [];
  for (const kind of ['delete', 'add']) {
    let previous: (typeof groups)[number] | undefined;
    const changes = props.changes?.filter(change => change.kind === kind) ?? [...el.querySelectorAll<HTMLElement>(`.diff-line.${kind}`)].map(row => {
      const bounds = row.getBoundingClientRect();
      const offset = bounds.top - origin + el.scrollTop;
      const numbers = [...row.querySelectorAll('.line-number')].map(number => number.textContent?.trim()).filter(Boolean);
      return { offset, height: bounds.height, line: (kind === 'add' ? numbers.at(-1) : numbers[0]) || 'change' };
    });
    for (const change of changes) {
      const offset = change.offset;
      const top = offset / height * 100;
      const size = change.height / height * 100;
      if (previous && Math.abs(previous.top + previous.height - top) * height / 100 < 1) previous.height += size;
      else {
        previous = { top, height: size, kind, offset, line: change.line };
        groups.push(previous);
      }
    }
  }
  markers.value = groups;
  updateViewport();
}
function schedule() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(measure);
}
watch(() => props.scroller, (el, old) => {
  old?.removeEventListener('scroll', updateViewport);
  observer?.disconnect();
  if (!el) return;
  el.addEventListener('scroll', updateViewport, { passive: true });
  observer = new ResizeObserver(schedule);
  observer.observe(el);
  if (el.firstElementChild) observer.observe(el.firstElementChild);
  schedule();
}, { immediate: true, flush: 'post' });
watch(() => props.revision, schedule, { flush: 'post' });
onUnmounted(() => {
  cancelAnimationFrame(frame);
  observer?.disconnect();
  props.scroller?.removeEventListener('scroll', updateViewport);
});
function jump(offset: number) {
  props.scroller?.scrollTo({ top: Math.max(0, offset - props.scroller.clientHeight / 3), behavior: 'instant' });
  updateViewport();
}
let pointer: number | undefined, grabOffset = 0;
function startDrag(event: PointerEvent) {
  const el = props.scroller;
  if (!el || event.button !== 0 || pointer !== undefined || event.target !== event.currentTarget) return;
  const track = event.currentTarget as HTMLElement;
  const bounds = track.getBoundingClientRect();
  if (!bounds.height || !el.scrollHeight) return;
  event.preventDefault();
  const y = event.clientY - bounds.top;
  const top = el.scrollTop / el.scrollHeight * bounds.height;
  const height = el.clientHeight / el.scrollHeight * bounds.height;
  grabOffset = y >= top && y <= top + height ? y - top : height / 2;
  pointer = event.pointerId;
  track.setPointerCapture(pointer);
  drag(event);
}
function drag(event: PointerEvent) {
  const el = props.scroller;
  if (event.pointerId !== pointer || !el) return;
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  if (!bounds.height) return;
  el.scrollTo({ top: Math.max(0, (event.clientY - bounds.top - grabOffset) / bounds.height * el.scrollHeight), behavior: 'instant' });
  updateViewport();
}
function stopDrag(event: PointerEvent) {
  if (event.pointerId !== pointer) return;
  pointer = undefined;
  const track = event.currentTarget as HTMLElement;
  if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
}
</script>

<template>
  <nav class="diff-overview" aria-label="Change overview"
    @pointerdown="startDrag" @pointermove="drag" @pointerup="stopDrag" @pointercancel="stopDrag" @lostpointercapture="stopDrag">
    <div class="overview-viewport" :style="{ top: `${viewport.top}%`, height: `${Math.min(100, viewport.height)}%` }" />
    <button v-for="(marker, i) in markers" :key="i" class="overview-marker" :class="marker.kind"
      :style="{ top: `${marker.top}%`, height: `${marker.height}%` }"
      :aria-label="`Jump to ${marker.kind === 'add' ? 'added' : 'deleted'} lines near line ${marker.line}`"
      :title="`${marker.kind === 'add' ? 'Added' : 'Deleted'} lines near line ${marker.line}`"
      @click.stop="jump(marker.offset)" />
  </nav>
</template>

<style scoped>
.diff-overview { position: relative; flex: 0 0 22px; background: #11151d; border-left: 1px solid var(--line); cursor: pointer; overflow: hidden; touch-action: none; user-select: none; }
.overview-viewport { position: absolute; left: 0; width: 100%; background: #94a7cc18; border-block: 1px solid #94a7cc45; pointer-events: none; }
.overview-marker { position: absolute; width: 8px; min-height: 4px; padding: 0; border: 0; border-radius: 1px; }
.overview-marker.add { right: 2px; background: #72c795; }
.overview-marker.delete { left: 2px; background: #e48791; }
.overview-marker:hover, .overview-marker:focus-visible { outline: 2px solid #d5dff4; z-index: 1; }
</style>
