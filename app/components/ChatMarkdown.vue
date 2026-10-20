<script setup lang="ts">
import { computed } from 'vue';
import { renderMarkdown } from '~/lib/markdown';
const props = defineProps<{ text: string; streaming?: boolean }>();
const html = computed(() => renderMarkdown(props.text));
</script>

<template>
  <div class="chat-markdown">
    <div v-html="html" />
    <span v-if="streaming" class="streaming-cursor" aria-hidden="true" />
  </div>
</template>

<style scoped>
.chat-markdown { font-size: 13px; line-height: 1.7; color: #d4d7df; overflow-wrap: anywhere; }
.chat-markdown :deep(p), .chat-markdown :deep(ul), .chat-markdown :deep(ol), .chat-markdown :deep(blockquote), .chat-markdown :deep(pre) { margin: 0 0 12px; }
.chat-markdown :deep(p) { font-size: inherit; line-height: inherit; color: inherit; }
.chat-markdown :deep(div > :last-child) { margin-bottom: 0; }
.chat-markdown :deep(h1), .chat-markdown :deep(h2), .chat-markdown :deep(h3), .chat-markdown :deep(h4), .chat-markdown :deep(h5), .chat-markdown :deep(h6) { margin: 18px 0 8px; color: #e0e6f4; line-height: 1.4; }
.chat-markdown :deep(h1) { font-size: 20px; }
.chat-markdown :deep(h2) { font-size: 17px; }
.chat-markdown :deep(h3) { font-size: 14px; }
.chat-markdown :deep(h4), .chat-markdown :deep(h5), .chat-markdown :deep(h6) { font-size: 12px; }
.chat-markdown :deep(div > :first-child) { margin-top: 0; }
.chat-markdown :deep(ul), .chat-markdown :deep(ol) { padding-left: 22px; }
.chat-markdown :deep(li + li) { margin-top: 4px; }
.chat-markdown :deep(li > ul), .chat-markdown :deep(li > ol) { margin-top: 4px; }
.chat-markdown :deep(strong) { font-weight: 600; color: #e7e9ef; }
.chat-markdown :deep(a) { color: #a7b6ff; text-decoration: underline; text-underline-offset: 2px; }
.chat-markdown :deep(a:hover) { color: #d2dbff; }
.chat-markdown :deep(a:focus-visible) { outline: 2px solid #a7b6ff; outline-offset: 2px; }
.chat-markdown :deep(code) { font-family: ui-monospace, "Cascadia Code", "SFMono-Regular", Consolas, monospace; font-size: .9em; background: #ffffff08; color: #dde1e9; border-radius: 4px; padding: 2px 4px; }
.chat-markdown :deep(pre) { overflow-x: auto; padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: #101218; white-space: pre; overflow-wrap: normal; }
.chat-markdown :deep(pre code) { padding: 0; background: none; border-radius: 0; }
.chat-markdown :deep(blockquote) { margin-left: 0; padding-left: 12px; border-left: 3px solid #57688f; color: #98a6c2; }
.chat-markdown :deep(table) { display: block; overflow-x: auto; border-collapse: collapse; margin: 12px 0; }
.chat-markdown :deep(th), .chat-markdown :deep(td) { border: 1px solid #353d4d; padding: 6px 10px; text-align: left; }
.chat-markdown :deep(th) { background: #202633; }
.chat-markdown :deep(hr) { border: 0; border-top: 1px solid var(--line); margin: 16px 0; }
.chat-markdown :deep(img) { max-width: 100%; height: auto; }
.streaming-cursor { display: inline-block; width: 2px; height: 1em; margin-left: 3px; vertical-align: -2px; background: #a8b6ec; animation: cursor-pulse 1s ease-in-out infinite alternate; }
@keyframes cursor-pulse { to { opacity: .25; } }
@media (prefers-reduced-motion: reduce) { .streaming-cursor { animation: none; } }
</style>
