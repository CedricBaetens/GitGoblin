<script setup lang="ts">
import { computed } from 'vue';
import { Bot, Check, CircleAlert, LoaderCircle, Pause, X } from 'lucide-vue-next';
import type { ChatSubagent } from '~/lib/chat-subagents';
const props = defineProps<{ agents: ChatSubagent[] }>();
const running = (status: string) => ['pending', 'running', 'in_progress', 'inProgress'].includes(status);
const activeCount = computed(() => props.agents.filter(agent => running(agent.status) || agent.status === 'waiting').length);
const label = (status: string) => ({ pending: 'Pending', running: 'Running', in_progress: 'Running', inProgress: 'Running', waiting: 'Waiting', idle: 'Idle', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' })[status] || status;
</script>

<template>
  <section v-if="agents.length" class="mb-[16px] space-y-[8px]" aria-label="Subagents">
    <div class="flex items-center gap-[7px] text-[11px] text-[#9eadc8]" role="status">
      <Bot :size="14" />
      <span>Subagents · {{ activeCount ? `${activeCount} active · ` : '' }}{{ agents.length }} total</span>
    </div>
    <article v-for="agent in agents" :key="agent.id" class="rounded-[8px] border border-[#353d4d] bg-[#1b1f29] px-[12px] py-[10px] text-[12px]">
      <div class="flex items-start gap-[8px]">
        <LoaderCircle v-if="running(agent.status)" :size="14" class="mt-[2px] shrink-0 animate-spin text-[#a7b6ed] motion-reduce:animate-none" />
        <Check v-else-if="agent.status === 'completed'" :size="14" class="mt-[2px] shrink-0 text-[#81bda2]" />
        <CircleAlert v-else-if="agent.status === 'failed'" :size="14" class="mt-[2px] shrink-0 text-[#e48791]" />
        <X v-else-if="['cancelled', 'interrupted'].includes(agent.status)" :size="14" class="mt-[2px] shrink-0 text-[#9eadc8]" />
        <Pause v-else :size="14" class="mt-[2px] shrink-0 text-[#9eadc8]" />
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-baseline justify-between gap-[6px]">
            <strong class="break-words text-[#cbd4e8]">{{ agent.title }}</strong>
            <span class="text-[11px] text-[#9eadc8]">{{ label(agent.status) }}</span>
          </div>
          <p v-if="agent.model" class="m-0 mt-[4px] text-[10px] text-[#9eadc8]">{{ agent.model }}</p>
          <p v-if="agent.progress" class="m-0 mt-[6px] whitespace-pre-wrap break-words text-[#9eadc8]">{{ agent.progress }}</p>
          <details v-if="agent.result || (agent.prompt && agent.prompt !== agent.title)" class="mt-[8px] text-[#9eadc8]">
            <summary class="cursor-pointer">{{ agent.result ? 'View result' : 'View task' }}</summary>
            <ChatMarkdown v-if="agent.result" :text="agent.result" />
            <p v-else class="whitespace-pre-wrap break-words">{{ agent.prompt }}</p>
          </details>
        </div>
      </div>
    </article>
  </section>
</template>
