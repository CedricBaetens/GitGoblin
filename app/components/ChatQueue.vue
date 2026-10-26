<script setup lang="ts">
import { computed, ref } from 'vue';
import { ChevronRight, Clock3, GripVertical, Pencil, CornerUpRight, X } from 'lucide-vue-next';
import { queuedMessages } from '~/lib/chat-queue';
import type { T3Projection } from '~/lib/types';
const props = defineProps<{
  projection: T3Projection;
  disabled: boolean;
  dispatch: (command: Record<string, unknown>) => Promise<unknown>;
}>();
const emit = defineEmits<{ error: [message: string] }>();
const rows = computed(() => queuedMessages(props.projection));
const dragged = ref('');
const expanded = ref(true), pending = ref(false), editing = ref(''), text = ref('');
const active = computed(() => props.projection.runs?.find(run => ['running', 'starting'].includes(run.status))?.id || props.projection.thread.activeRunId);
async function action(type: string, fields: Record<string, unknown> = {}) {
  pending.value = true;
  try {
    await props.dispatch({ type, commandId: crypto.randomUUID(), threadId: props.projection.thread.id, ...fields });
    if (type === 'queued-run.edit') editing.value = '';
  } catch (error) { emit('error', String(error)); }
  finally { pending.value = false; }
}
function reorder(index: number, direction: number) {
  if (index + direction < 0 || index + direction >= rows.value.length) return;
  void action('queued-run.reorder', { runId: rows.value[index]!.run.id,
    beforeRunId: rows.value[direction < 0 ? index - 1 : index + 2]?.run.id || null });
}
</script>

<template>
  <section v-if="rows.length" class="shrink-0 mx-[10px] mt-[10px] rounded-[8px] border border-[#353d4d] bg-[#1b1f29] text-[12px]" aria-label="Queued messages">
    <div class="flex items-center gap-2 px-3 py-2 text-[#9eadc8]">
      <AppButton :aria-expanded="expanded" aria-label="Toggle queued messages" @click="expanded = !expanded">
        <ChevronRight :size="14" :class="{ 'rotate-90': expanded }" />
        <Clock3 :size="14" /> Queued <span>{{ rows.length }}</span>
      </AppButton>
      <span class="flex-1" />
      <AppButton v-if="rows.some(row => row.run.queueHeld)" :disabled="disabled || pending" @click="action('queue.resume')">Resume queue</AppButton>
    </div>
    <ol v-if="expanded" class="m-0 max-h-[240px] overflow-auto list-none p-0">
      <li v-for="(row, index) in rows" :key="row.run.id" class="flex items-start gap-2 border-t border-[#353d4d] px-3 py-2" @dragover.prevent @drop.prevent="dragged && action('queued-run.reorder', { runId: dragged, beforeRunId: row.run.id }); dragged = ''">
        <AppButton aria-label="Reorder queued message (drag or press arrow keys)" title="Drag or move with Up/Down arrow keys" :draggable="!disabled && !pending" @dragstart="dragged = row.run.id" @dragend="dragged = ''" :disabled="disabled || pending" @keydown.up.prevent="reorder(index, -1)" @keydown.down.prevent="reorder(index, 1)"><GripVertical :size="14" /></AppButton>
        <div class="min-w-0 flex-1">
          <template v-if="editing === row.run.id">
            <AppTextarea v-model="text" aria-label="Edit queued message" :disabled="pending" />
            <AppButton :disabled="disabled || pending || (!text.trim() && !row.message?.attachments?.length)" @click="action('queued-run.edit', { runId: row.run.id, text })">Save</AppButton>
            <AppButton :disabled="pending" @click="editing = ''">Cancel</AppButton>
          </template>
          <template v-else>
            <p class="m-0 whitespace-pre-wrap break-words">{{ row.message?.text || 'Image instruction' }}</p>
            <span v-for="image in row.message?.attachments || []" :key="image.id" class="mr-2 text-[#9eadc8]">{{ image.name }}</span>
            <span v-if="row.run.queueHeld" class="text-[#9eadc8]">Queue paused</span>
          </template>
        </div>
        <AppButton aria-label="Edit queued message" title="Edit queued message" :disabled="disabled || pending || !row.message" @click="editing = row.run.id; text = row.message?.text || ''"><Pencil :size="14" /></AppButton>
        <AppButton :disabled="disabled || pending || !active" title="Send into the current task" @click="action('queued-message.promote-to-steer', { queuedRunId: row.run.id, targetRunId: active })"><CornerUpRight :size="14" /> Steer</AppButton>
        <AppButton aria-label="Remove queued message" title="Remove from queue" :disabled="disabled || pending" @click="action('queued-run.cancel', { runId: row.run.id })"><X :size="14" /></AppButton>
      </li>
    </ol>
  </section>
</template>
