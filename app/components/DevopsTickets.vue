<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue';
import { Search, LoaderCircle, Check } from 'lucide-vue-next';
import { desktop, invoke } from '~/lib/native';
import type { ConversationTicket } from '~/lib/conversation-presets';

interface Ticket { id: number; title: string; state: string; kind: string; assignedTo: string; url: string }
interface Results { organization: string; project: string; tickets: Ticket[] }
const props = defineProps<{ repo: string; selected: string; disabled: boolean }>();
const emit = defineEmits<{ select: [ticket: ConversationTicket] }>();
const query = ref(''), loading = ref(false), error = ref('');
const results = ref<Results>();
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
async function load(request: number) {
  try {
    if (!desktop()) throw new Error('DevOps search is available in the desktop app. You can enter a ticket below.');
    const response = await invoke<Results>('devops_tickets', { repo: props.repo, query: query.value });
    if (request === generation) results.value = response;
  } catch (e) {
    if (request === generation) error.value = String(e);
  } finally {
    if (request === generation) loading.value = false;
  }
}
function search() {
  clearTimeout(timer);
  const request = ++generation;
  loading.value = true;
  error.value = '';
  results.value = undefined;
  timer = setTimeout(() => void load(request), query.value.trim() ? 500 : 0);
}
watch([() => props.repo, query], search, { immediate: true });
onUnmounted(() => { clearTimeout(timer); generation++; });
</script>

<template>
  <section class="devops-tickets" aria-label="Azure DevOps tickets">
    <label>Find in Azure DevOps
      <div class="ticket-search"><Search :size="15" /><input v-model="query" type="search" maxlength="200" :disabled="disabled" placeholder="Search by title or ticket number" aria-label="Search Azure DevOps tickets" @keydown.enter.stop.prevent="search" /></div>
    </label>
    <p v-if="loading" class="ticket-status" role="status"><LoaderCircle :size="13" class="spin" />Finding tickets…</p>
    <p v-else-if="error" class="ticket-status" role="status">{{ error }}</p>
    <template v-else-if="results">
      <p class="ticket-status">{{ query.trim() ? 'Search results' : 'Your active tickets' }} · {{ results.project }}</p>
      <div v-if="results.tickets.length" class="ticket-results">
        <button v-for="ticket in results.tickets" :key="ticket.id" type="button" :disabled="disabled"
          :aria-pressed="selected === ticket.url" @click="emit('select', ticket)">
          <span class="ticket-number">#{{ ticket.id }}</span>
          <span class="ticket-summary"><strong>{{ ticket.title }}</strong><small>{{ [ticket.kind, ticket.state, ticket.assignedTo].filter(Boolean).join(' · ') }}</small></span>
          <Check v-if="selected === ticket.url" :size="14" />
        </button>
      </div>
      <p v-if="results.tickets.length === 30" class="ticket-status">Showing up to 30 tickets. Refine your search to narrow the list.</p>
      <p v-if="!results.tickets.length" class="ticket-status">{{ query.trim() ? 'No matching tickets. Try another title or number.' : 'No active tickets assigned to you. Search the project or enter a ticket below.' }}</p>
    </template>
  </section>
</template>

<style scoped>
.devops-tickets { margin-top: 16px; }
.ticket-search { display: flex; align-items: center; gap: 8px; }
.ticket-search svg { color: #9eadc8; }
.ticket-search input { flex: 1; min-width: 0; }
.ticket-status { display: flex; align-items: center; gap: 7px; margin: 8px 0; color: #9eadc8; font-size: 11px; line-height: 1.6; }
.ticket-results { max-height: 175px; overflow: auto; border: 1px solid #35405a; border-radius: 6px; }
.ticket-results button { width: 100%; justify-content: flex-start; align-items: flex-start; text-align: left; padding: 10px; gap: 10px; white-space: normal; }
.ticket-results button + button { border-top: 1px solid #282e3c; border-radius: 0; }
.ticket-results button[aria-pressed="true"] { background: #27334b; }
.ticket-number { color: #a8bbeb; font-size: 11px; padding-top: 1px; }
.ticket-summary { flex: 1; min-width: 0; display: grid; gap: 4px; }
.ticket-summary strong { font-size: 12px; font-weight: 500; overflow-wrap: anywhere; }
.ticket-summary small { color: #9eadc8; font-size: 10px; }
</style>
