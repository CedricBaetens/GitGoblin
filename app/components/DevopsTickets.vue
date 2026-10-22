<script setup lang="ts">
import { ref, watch, onUnmounted } from "vue";
import { Search, LoaderCircle, Check } from "lucide-vue-next";
import { desktop, invoke } from "~/lib/native";
import type { ConversationTicket } from "~/lib/conversation-presets";

interface Ticket {
  id: number;
  title: string;
  state: string;
  kind: string;
  assignedTo: string;
  url: string;
}
interface Results {
  organization: string;
  project: string;
  tickets: Ticket[];
}
const props = defineProps<{
  repo: string;
  selected: string;
  disabled: boolean;
}>();
const emit = defineEmits<{ select: [ticket: ConversationTicket] }>();
const query = ref(""),
  loading = ref(false),
  error = ref("");
const results = ref<Results>();
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
async function load(request: number) {
  try {
    if (!desktop())
      throw new Error(
        "DevOps search is available in the desktop app. You can enter a ticket below.",
      );
    const response = await invoke<Results>("devops_tickets", {
      repo: props.repo,
      query: query.value,
    });
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
  error.value = "";
  results.value = undefined;
  timer = setTimeout(() => void load(request), query.value.trim() ? 500 : 0);
}
watch([() => props.repo, query], search, { immediate: true });
onUnmounted(() => {
  clearTimeout(timer);
  generation++;
});
</script>

<template>
  <section class="devops-tickets mt-[16px]" aria-label="Azure DevOps tickets">
    <label
      >Find in Azure DevOps
      <div
        class="ticket-search flex items-center gap-[8px] [&_svg]:text-[#9eadc8] [&_input]:flex-1 [&_input]:min-w-0"
      >
        <Search :size="15" /><AppInput
          v-model="query"
          type="search"
          maxlength="200"
          :disabled="disabled"
          placeholder="Search by title or ticket number"
          aria-label="Search Azure DevOps tickets"
          @keydown.enter.stop.prevent="search"
        />
      </div>
    </label>
    <p
      v-if="loading"
      class="ticket-status flex items-center gap-[7px] my-[8px] mx-0 text-[#9eadc8] text-[11px] leading-[1.6]"
      role="status"
    >
      <LoaderCircle :size="13" class="spin animate-spin" />Finding tickets…
    </p>
    <p
      v-else-if="error"
      class="ticket-status flex items-center gap-[7px] my-[8px] mx-0 text-[#9eadc8] text-[11px] leading-[1.6]"
      role="status"
    >
      {{ error }}
    </p>
    <template v-else-if="results">
      <p
        class="ticket-status flex items-center gap-[7px] my-[8px] mx-0 text-[#9eadc8] text-[11px] leading-[1.6]"
      >
        {{ query.trim() ? "Search results" : "Your active tickets" }} ·
        {{ results.project }}
      </p>
      <div
        v-if="results.tickets.length"
        class="ticket-results max-h-[175px] overflow-auto border-[1px] border-solid border-[#35405a] rounded-[6px] [&_button]:w-full [&_button]:justify-start [&_button]:items-start [&_button]:text-left [&_button]:p-[10px] [&_button]:gap-[10px] [&_button]:whitespace-normal [&_button_+_button]:border-t-[1px] [&_button_+_button]:border-solid [&_button_+_button]:border-t-[#282e3c] [&_button_+_button]:rounded-none [&_button[aria-pressed='true']]:bg-[#27334b]"
      >
        <AppButton
          v-for="ticket in results.tickets"
          :key="ticket.id"
          type="button"
          :disabled="disabled"
          :aria-pressed="selected === ticket.url"
          @click="emit('select', ticket)"
        >
          <span class="ticket-number text-[#a8bbeb] text-[11px] pt-[1px]"
            >#{{ ticket.id }}</span
          >
          <span
            class="ticket-summary flex-1 min-w-0 grid gap-[4px] [&_strong]:text-[12px] [&_strong]:font-medium [&_strong]:[overflow-wrap:anywhere] [&_small]:text-[#9eadc8] [&_small]:text-[10px]"
            ><strong>{{ ticket.title }}</strong
            ><small class="[:where(&)]:text-[11px]">{{
              [ticket.kind, ticket.state, ticket.assignedTo]
                .filter(Boolean)
                .join(" · ")
            }}</small></span
          >
          <Check v-if="selected === ticket.url" :size="14" />
        </AppButton>
      </div>
      <p
        v-if="results.tickets.length === 30"
        class="ticket-status flex items-center gap-[7px] my-[8px] mx-0 text-[#9eadc8] text-[11px] leading-[1.6]"
      >
        Showing up to 30 tickets. Refine your search to narrow the list.
      </p>
      <p
        v-if="!results.tickets.length"
        class="ticket-status flex items-center gap-[7px] my-[8px] mx-0 text-[#9eadc8] text-[11px] leading-[1.6]"
      >
        {{
          query.trim()
            ? "No matching tickets. Try another title or number."
            : "No active tickets assigned to you. Search the project or enter a ticket below."
        }}
      </p>
    </template>
  </section>
</template>
