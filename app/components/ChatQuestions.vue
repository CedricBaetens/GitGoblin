<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { questionAnswers } from '~/lib/chat-questions';
import type { T3QuestionRequest } from '~/lib/types';
const props = defineProps<{ request: T3QuestionRequest; disabled: boolean; respond: (answers: Record<string, string | string[]>) => Promise<unknown> }>();
const id = useId();
const selections = ref<Record<string, string[]>>({});
const custom = ref<Record<string, string>>(Object.fromEntries(props.request.questions.filter(q => q.initialAnswer !== undefined).map(q => [q.id, q.initialAnswer!])));
const sending = ref(false), submitted = ref(false), error = ref('');
const answers = computed(() => questionAnswers(props.request.questions, selections.value, custom.value));
function choose(questionId: string, value: string, multi = false) {
  const selected = selections.value[questionId] || [];
  selections.value[questionId] = multi ? selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value] : [value];
  custom.value[questionId] = '';
}
async function submit() {
  if (!answers.value || sending.value || props.disabled || props.request.unavailableReason) return;
  sending.value = true; error.value = '';
  try { await props.respond(answers.value); submitted.value = true; }
  catch (e) { error.value = String(e); }
  finally { sending.value = false; }
}
</script>

<template>
  <form class="chat-questions" aria-label="Agent questions" @submit.prevent="submit">
    <p v-if="submitted" role="status">Answers sent</p>
    <template v-else>
      <fieldset v-for="(question, index) in request.questions" :key="question.id" :disabled="disabled || sending || !!request.unavailableReason">
        <legend>{{ question.header }}</legend>
        <p>{{ question.question }}</p>
        <small v-if="question.multiSelect">Select one or more options.</small>
        <label v-for="(option, optionIndex) in question.options" :key="optionIndex" class="question-option">
          <input :type="question.multiSelect ? 'checkbox' : 'radio'" :name="`${id}-${index}`"
            :checked="!custom[question.id] && selections[question.id]?.includes(option.value ?? option.label)"
            @change="choose(question.id, option.value ?? option.label, question.multiSelect)" />
          <span><strong>{{ option.label }}</strong><small v-if="option.description">{{ option.description }}</small></span>
        </label>
        <label v-if="question.allowCustomAnswer !== false" class="question-custom">
          {{ question.options.length ? 'Your own answer' : 'Your answer' }}
          <textarea v-model="custom[question.id]" :aria-label="`Answer: ${question.header}`" rows="2" @input="selections[question.id] = []" />
        </label>
      </fieldset>
      <p v-if="request.unavailableReason" role="status">{{ request.unavailableReason }}</p>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <button v-if="!request.unavailableReason" type="submit" class="primary" :disabled="disabled || sending || !answers">{{ sending ? 'Sending…' : 'Submit answers' }}</button>
    </template>
  </form>
</template>

<style scoped>
.chat-questions { margin: 12px 0; padding: 12px; background: #1b1f29; border: 1px solid #353d4d; border-radius: 8px; }
fieldset { border: 0; padding: 0; margin: 0 0 14px; min-width: 0; }
legend { font-size: 12px; color: #a7b6ff; font-weight: 600; }
p { font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; margin: 8px 0; }
.question-option { display: flex; align-items: flex-start; gap: 8px; padding: 8px; margin-top: 5px; border: 1px solid var(--line); border-radius: 5px; cursor: pointer; }
.question-option:has(input:checked) { border-color: #8ca5e7; background: #27334b; }
.question-option input { flex-shrink: 0; margin-top: 3px; }
.question-option span { display: grid; gap: 4px; }
.question-option strong { font-size: 12px; font-weight: 500; }
small { font-size: 11px; color: #9ca8bf; line-height: 1.5; }
.question-custom { display: grid; gap: 6px; font-size: 11px; margin-top: 10px; }
textarea { width: 100%; font-size: 12px; resize: vertical; }
button { font-size: 12px; }
</style>
