<script setup lang="ts">
import { computed } from 'vue';
import { Check, Circle, CircleAlert, LoaderCircle, MessageCircleQuestion } from 'lucide-vue-next';
import { chatState } from '~/lib/chat-tabs';
const props = defineProps<{ attention?: boolean; running?: boolean; unread?: boolean; completed?: boolean; status?: string }>();
const state = computed(() => chatState(props));
const labels = { waiting: 'Waiting for input', working: 'Working', done: 'Done', ready: 'Ready', failed: 'Failed' };
</script>
<template>
  <span class="chat-status" :title="`${labels[state]}${unread ? ' · Unread response' : ''}`">
    <span class="state-badge" :class="state" role="img" :aria-label="labels[state]">
      <MessageCircleQuestion v-if="state === 'waiting'" :size="12" aria-hidden="true" />
      <LoaderCircle v-else-if="state === 'working'" :size="12" class="spin" aria-hidden="true" />
      <Check v-else-if="state === 'done'" :size="12" aria-hidden="true" />
      <CircleAlert v-else-if="state === 'failed'" :size="12" aria-hidden="true" />
      <Circle v-else :size="7" aria-hidden="true" />
    </span>
    <span v-if="unread" class="unread" role="img" aria-label="Unread response" />
  </span>
</template>
<style scoped>
.chat-status { position: relative; display: inline-flex; align-items: center; flex-shrink: 0; }
.state-badge { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 50%; box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 22%, transparent); }
.waiting { color: #f6cc83; background: #edaf3924; }
.working { color: #aacbff; background: #659bff24; }
.done { color: #a0deb0; background: #57bd7624; }
.ready { color: #b6c0d3; background: #9aabc018; }
.failed { color: #ffa7ad; background: #ed637424; }
.unread { position: absolute; top: -1px; right: -1px; width: 6px; height: 6px; border-radius: 50%; background: #b3bfff; box-shadow: 0 0 0 2px #1b202b; }
</style>
