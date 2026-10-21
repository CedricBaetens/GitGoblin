<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { CheckCheck, LoaderCircle, X } from 'lucide-vue-next';
import type { T3Thread } from '~/lib/types';

const props = defineProps<{
  thread: T3Thread;
  connected: boolean;
  confirm: (settle: boolean) => Promise<void>;
}>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const settle = ref(true), submitting = ref(false), error = ref('');
const alreadySettled = computed(() => props.thread.settledOverride === 'settled' || !!props.thread.archivedAt);
const willSettle = computed(() => settle.value && !alreadySettled.value);
let trigger: HTMLElement | null;
onMounted(() => { trigger = document.activeElement as HTMLElement | null; dialog.value?.showModal(); });
onUnmounted(() => void nextTick(() => {
  const target = trigger?.isConnected ? trigger : document.querySelector<HTMLElement>('.chat-tabs [aria-selected="true"], .chat-tabs button[aria-label="New chat"]');
  target?.focus();
}));
function dismiss() { if (!submitting.value) emit('close'); }
async function submit() {
  if (submitting.value) return;
  submitting.value = true;
  error.value = '';
  try {
    await props.confirm(willSettle.value);
    emit('close');
  } catch (e) { error.value = String(e); }
  finally { submitting.value = false; }
}
</script>

<template>
  <dialog ref="dialog" class="modal close-chat-dialog" aria-labelledby="close-chat-title" aria-describedby="close-chat-description"
    @cancel.prevent="dismiss" @click="event => { if (event.target === dialog) dismiss(); }">
    <form @submit.prevent="submit">
      <div class="modal-heading">
        <h2 id="close-chat-title">Close conversation tab?</h2>
        <button type="button" class="icon-button" aria-label="Cancel closing tab" :disabled="submitting" @click="dismiss"><X :size="18" /></button>
      </div>
      <p id="close-chat-description">You’re closing <strong>{{ thread.title }}</strong>. You can reopen it from All chats.</p>
      <p v-if="alreadySettled" class="settled-note"><CheckCheck :size="18" />This conversation is already {{ thread.archivedAt ? 'archived' : 'settled' }}.</p>
      <label v-else class="settle-choice" :class="{ enabled: settle }">
        <input v-model="settle" type="checkbox" :disabled="submitting" aria-label="Settle conversation" aria-describedby="settle-chat-description" />
        <span><strong>Settle conversation</strong><small id="settle-chat-description">Mark this conversation as settled in T3 Code when closing the tab.</small></span>
        <span v-if="settle" class="settle-badge">Enabled</span>
      </label>
      <p class="close-chat-hint">{{ willSettle ? 'The conversation will be marked as settled before the tab closes.' : 'Only the tab will close. The conversation’s status will stay the same.' }}</p>
      <p v-if="willSettle && !connected" class="inline-error">Reconnect T3 Code to settle, or uncheck “Settle conversation” to close only the tab.</p>
      <div v-if="error" class="inline-error" role="alert">{{ error }}</div>
      <div class="modal-footer">
        <button type="button" autofocus :disabled="submitting" @click="dismiss">Cancel</button>
        <button type="submit" class="primary" :disabled="submitting || (willSettle && !connected)">
          <LoaderCircle v-if="submitting" :size="14" class="spin" />
          {{ submitting ? 'Closing…' : willSettle ? 'Settle & close tab' : 'Close tab' }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.close-chat-dialog { margin: auto; color: #d5d7df; }
.close-chat-dialog::backdrop { background: #070a11b8; backdrop-filter: blur(5px); }
p { margin: 0; font-size: 12px; line-height: 1.7; color: #9eadc8; overflow-wrap: anywhere; }
p strong { color: #e2e7f3; }
.modal .settle-choice { display: flex; flex-direction: row; align-items: center; gap: 12px; padding: 16px; margin: 20px 0 10px; border: 1px solid #35405a; border-radius: 8px; background: #171c26; cursor: pointer; }
.settle-choice.enabled { border-color: #8ca5e7; background: #27334b; }
.settle-choice:has(input:focus-visible) { outline: 2px solid #a7b6ff; outline-offset: 3px; }
.modal .settle-choice input { width: 18px; height: 18px; margin: 0; flex-shrink: 0; }
.settle-choice > span:first-of-type { display: grid; gap: 5px; flex: 1; }
.settle-choice strong { font-size: 13px; color: #e2e7f3; }
.settle-choice small { line-height: 1.6; }
.settle-badge { padding: 3px 7px; border-radius: 4px; color: #c9d5ff; background: #40517a; font-size: 10px; }
.close-chat-hint { font-size: 11px; }
.settled-note { display: flex; align-items: center; gap: 8px; margin: 20px 0 10px; }
</style>
