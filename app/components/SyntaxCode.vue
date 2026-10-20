<script setup lang="ts">
import type { SyntaxToken } from '~/lib/syntax';
const props = defineProps<{ text: string; path: string; editable?: boolean; label: string; selectable?: boolean; selected?: number[]; selectableRange?: { start: number; end: number }; activeRange?: { start: number; end: number } }>();
const emit = defineEmits<{ 'update:text': [text: string]; toggle: [line: number] }>();
const tokens = shallowRef<SyntaxToken[][]>([]), scroller = ref<HTMLElement>(), input = ref<HTMLTextAreaElement>();
const lines = computed(() => props.text.split('\n'));
let worker: Worker | undefined, request = 0;
function highlight() { tokens.value = []; worker?.postMessage({ id: ++request, kind: 'code', text: props.text, path: props.path }); }
onMounted(() => {
  try {
    worker = new Worker(new URL('../lib/syntax.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { if (data.id === request) tokens.value = data.tokens; };
    highlight();
  } catch { /* Plain code remains available without workers. */ }
});
onUnmounted(() => worker?.terminate());
watch(() => [props.text, props.path], highlight);
function reveal(offset: number, end: number) {
  const editor = input.value;
  if (!editor) {
    if (scroller.value) scroller.value.scrollTop = Math.max(0, (props.text.slice(0, offset).split('\n').length - 5) * 20);
    return;
  }
  editor.setSelectionRange(offset, end);
  editor.scrollTop = Math.max(0, (props.text.slice(0, offset).split('\n').length - 5) * 20);
  syncScroll();
}
function syncScroll() { if (input.value && scroller.value) { scroller.value.scrollTop = input.value.scrollTop; scroller.value.scrollLeft = input.value.scrollLeft; } }
defineExpose({ reveal });
</script>
<template>
  <div class="syntax-code" :class="{ editable, selectable }">
    <div ref="scroller" class="code-scroll" :aria-hidden="editable || undefined" :aria-label="editable ? undefined : label" :tabindex="editable ? undefined : 0">
      <div v-for="(line, index) in lines" :key="index" class="code-row" :class="{ chosen: selected?.includes(index), 'active-conflict': activeRange && index >= activeRange.start && index <= activeRange.end }"><button v-if="selectable && (!selectableRange || index >= selectableRange.start && index <= selectableRange.end) && (index < lines.length - 1 || line)" class="choose-line" :aria-label="`Select ${label} line ${index + 1}`" :aria-pressed="selected?.includes(index) || false" @click="emit('toggle', index)">{{ selected?.includes(index) ? '✓' : '+' }}</button><span v-else-if="selectable" class="choose-line" /><span class="code-number">{{ index + 1 }}</span><code><template v-if="tokens[index]"><span v-for="(token, i) in tokens[index]" :key="i" :class="token.classes">{{ token.text }}</span></template><template v-else>{{ line }}</template>{{ !line ? ' ' : '' }}</code></div>
    </div>
    <textarea v-if="editable" ref="input" :aria-label="label" :value="text" spellcheck="false" wrap="off" @input="emit('update:text', ($event.target as HTMLTextAreaElement).value)" @scroll="syncScroll" />
  </div>
</template>
<style scoped>
.syntax-code { position: relative; background: #111824; border: 1px solid #303b50; border-radius: 6px; overflow: hidden; height: 210px; }
.code-scroll { height: 100%; overflow: auto; padding: 12px 0; }
.code-row { display: flex; width: max-content; min-width: 100%; height: 20px; font: 12px/20px Consolas, monospace; white-space: pre; }
.code-row.active-conflict { background: #cda65c12; box-shadow: inset 3px 0 #cda65c; }
.code-row.chosen { background: #294331; }
.code-number { width: 46px; padding-right: 12px; text-align: right; flex-shrink: 0; color: #69788f; user-select: none; }
code { font: inherit; padding-right: 12px; }
.choose-line { width: 26px; flex-shrink: 0; height: 20px; min-height: 0; padding: 0; border: 0; border-radius: 0; background: transparent; color: #8ea7ff; }
.choose-line:hover { background: #354363; }
.editable { height: 280px; }
.editable .code-scroll { pointer-events: none; scrollbar-width: none; }
textarea { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; padding: 12px 12px 12px 46px; background: transparent; color: transparent; caret-color: #e0e7ff; -webkit-text-fill-color: transparent; border: 0; border-radius: 0; resize: none; font: 12px/20px Consolas, monospace; white-space: pre; tab-size: 4; }
textarea::selection { background: #647bc855; }
.code-row { tab-size: 4; }
</style>
