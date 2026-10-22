<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import type { T3ImageAttachment } from "~/lib/types";
const props = defineProps<{
  attachment: T3ImageAttachment;
  load: (attachment: T3ImageAttachment) => Promise<string>;
}>();
const url = ref(""),
  error = ref("");
let disposed = false;
async function load() {
  error.value = "";
  try {
    const result = await props.load(props.attachment);
    if (disposed) URL.revokeObjectURL(result);
    else url.value = result;
  } catch {
    error.value = "Image unavailable";
  }
}
onMounted(load);
onUnmounted(() => {
  disposed = true;
  if (url.value) URL.revokeObjectURL(url.value);
});
</script>

<template>
  <figure
    class="chat-image my-[8px] mx-0 [&_img]:block [&_img]:max-w-full [&_img]:max-h-[240px] [&_img]:[object-fit:contain] [&_img]:border-[1px] [&_img]:border-solid [&_img]:border-[var(--line)] [&_img]:rounded-[6px] [&>span]:text-[var(--muted)] [&>span]:text-[11px] [&>span]:[overflow-wrap:anywhere]"
  >
    <img v-if="url" :src="url" :alt="attachment.name" />
    <span v-else>{{ error || "Loading image…" }}</span>
    <figcaption
      class="text-[var(--muted)] text-[11px] [overflow-wrap:anywhere] mt-[4px]"
    >
      {{ attachment.name }}
      <AppButton
        class="py-[2px] px-[6px] text-[11px]"
        v-if="error"
        @click="load"
      >
        Retry
      </AppButton>
    </figcaption>
  </figure>
</template>
