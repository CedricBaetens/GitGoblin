<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { T3ImageAttachment } from '~/lib/types';
const props = defineProps<{ attachment: T3ImageAttachment; load: (attachment: T3ImageAttachment) => Promise<string> }>();
const url = ref(''), error = ref('');
let disposed = false;
async function load() {
  error.value = '';
  try {
    const result = await props.load(props.attachment);
    if (disposed) URL.revokeObjectURL(result);
    else url.value = result;
  } catch { error.value = 'Image unavailable'; }
}
onMounted(load);
onUnmounted(() => { disposed = true; if (url.value) URL.revokeObjectURL(url.value); });
</script>

<template>
  <figure class="chat-image">
    <img v-if="url" :src="url" :alt="attachment.name" />
    <span v-else>{{ error || 'Loading image…' }}</span>
    <figcaption>{{ attachment.name }} <button v-if="error" @click="load">Retry</button></figcaption>
  </figure>
</template>

<style scoped>
.chat-image { margin: 8px 0; }
.chat-image img { display: block; max-width: 100%; max-height: 240px; object-fit: contain; border: 1px solid var(--line); border-radius: 6px; }
figcaption, .chat-image > span { color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
figcaption { margin-top: 4px; }
button { padding: 2px 6px; font-size: 11px; }
</style>
