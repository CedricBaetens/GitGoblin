<script setup lang="ts">
import { computed } from "vue";
import {
  Check,
  Circle,
  CircleAlert,
  LoaderCircle,
  MessageCircleQuestion,
} from "lucide-vue-next";
import { chatState } from "~/lib/chat-tabs";
const props = defineProps<{
  attention?: boolean;
  running?: boolean;
  unread?: boolean;
  completed?: boolean;
  status?: string;
}>();
const state = computed(() => chatState(props));
const labels = {
  waiting: "Waiting for input",
  working: "Working",
  done: "Done",
  ready: "Ready",
  failed: "Failed",
};
</script>
<template>
  <span
    class="chat-status relative inline-flex items-center shrink-0 [&_.waiting]:text-[#f6cc83] [&_.waiting]:bg-[#edaf3924] [&_.working]:text-[#aacbff] [&_.working]:bg-[#659bff24] [&_.done]:text-[#a0deb0] [&_.done]:bg-[#57bd7624] [&_.ready]:text-[#b6c0d3] [&_.ready]:bg-[#9aabc018] [&_.failed]:text-[#ffa7ad] [&_.failed]:bg-[#ed637424]"
    :title="`${labels[state]}${unread ? ' · Unread response' : ''}`"
  >
    <span
      class="state-badge inline-flex items-center justify-center w-[22px] h-[22px] rounded-full shadow-[inset_0_0_0_1px_color-mix(in_srgb,_currentColor_22%,_transparent)]"
      :class="state"
      role="img"
      :aria-label="labels[state]"
    >
      <MessageCircleQuestion
        v-if="state === 'waiting'"
        :size="12"
        aria-hidden="true"
      />
      <LoaderCircle
        v-else-if="state === 'working'"
        :size="12"
        class="spin animate-spin"
        aria-hidden="true"
      />
      <Check v-else-if="state === 'done'" :size="12" aria-hidden="true" />
      <CircleAlert
        v-else-if="state === 'failed'"
        :size="12"
        aria-hidden="true"
      />
      <Circle v-else :size="7" aria-hidden="true" />
    </span>
    <span
      v-if="unread"
      class="unread absolute top-[-1px] right-[-1px] w-[6px] h-[6px] rounded-full bg-[#b3bfff] shadow-[0_0_0_2px_#1b202b]"
      role="img"
      aria-label="Unread response"
    />
  </span>
</template>
