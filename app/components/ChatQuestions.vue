<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { questionAnswers } from "~/lib/chat-questions";
import type { T3QuestionRequest } from "~/lib/types";
const props = defineProps<{
  request: T3QuestionRequest;
  disabled: boolean;
  respond: (answers: Record<string, string | string[]>) => Promise<unknown>;
}>();
const id = useId();
const selections = ref<Record<string, string[]>>({});
const custom = ref<Record<string, string>>(
  Object.fromEntries(
    props.request.questions
      .filter((q) => q.initialAnswer !== undefined)
      .map((q) => [q.id, q.initialAnswer!]),
  ),
);
const sending = ref(false),
  submitted = ref(false),
  error = ref("");
const answers = computed(() =>
  questionAnswers(props.request.questions, selections.value, custom.value),
);
function choose(questionId: string, value: string, multi = false) {
  const selected = selections.value[questionId] || [];
  selections.value[questionId] = multi
    ? selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value]
    : [value];
  custom.value[questionId] = "";
}
async function submit() {
  if (
    !answers.value ||
    sending.value ||
    props.disabled ||
    props.request.unavailableReason
  )
    return;
  sending.value = true;
  error.value = "";
  try {
    await props.respond(answers.value);
    submitted.value = true;
  } catch (e) {
    error.value = String(e);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <form
    class="chat-questions my-[12px] mx-0 p-[12px] bg-[#1b1f29] border-[1px] border-solid border-[#353d4d] rounded-[8px]"
    aria-label="Agent questions"
    @submit.prevent="submit"
  >
    <p
      class="text-[12px] leading-[1.6] [overflow-wrap:anywhere] my-[8px] mx-0"
      v-if="submitted"
      role="status"
    >
      Answers sent
    </p>
    <template v-else>
      <fieldset
        class="border-0 p-0 mt-0 mx-0 mb-[14px] min-w-0"
        v-for="(question, index) in request.questions"
        :key="question.id"
        :disabled="disabled || sending || !!request.unavailableReason"
      >
        <legend class="text-[12px] text-[#a7b6ff] font-semibold">
          {{ question.header }}
        </legend>
        <p
          class="text-[12px] leading-[1.6] [overflow-wrap:anywhere] my-[8px] mx-0"
        >
          {{ question.question }}
        </p>
        <small
          class="text-[11px] text-[#9ca8bf] leading-[1.5] [:where(&)]:text-[11px]"
          v-if="question.multiSelect"
          >Select one or more options.</small
        >
        <label
          v-for="(option, optionIndex) in question.options"
          :key="optionIndex"
          class="question-option flex items-start gap-[8px] p-[8px] mt-[5px] border-[1px] border-solid border-[var(--line)] rounded-[5px] cursor-pointer [&:has(input:checked)]:[border-color:#8ca5e7] [&:has(input:checked)]:bg-[#27334b] [&_input]:shrink-0 [&_input]:mt-[3px] [&_span]:grid [&_span]:gap-[4px] [&_strong]:text-[12px] [&_strong]:font-medium"
        >
          <AppInput
            :type="question.multiSelect ? 'checkbox' : 'radio'"
            :name="`${id}-${index}`"
            :checked="
              !custom[question.id] &&
              selections[question.id]?.includes(option.value ?? option.label)
            "
            @change="
              choose(
                question.id,
                option.value ?? option.label,
                question.multiSelect,
              )
            "
          />
          <span
            ><strong>{{ option.label }}</strong
            ><small
              class="text-[11px] text-[#9ca8bf] leading-[1.5] [:where(&)]:text-[11px]"
              v-if="option.description"
              >{{ option.description }}</small
            ></span
          >
        </label>
        <label
          v-if="question.allowCustomAnswer !== false"
          class="question-custom grid gap-[6px] text-[11px] mt-[10px]"
        >
          {{ question.options.length ? "Your own answer" : "Your answer" }}
          <AppTextarea
            class="w-full text-[12px] resize-y"
            v-model="custom[question.id]"
            :aria-label="`Answer: ${question.header}`"
            rows="2"
            @input="selections[question.id] = []"
          />
        </label>
      </fieldset>
      <p
        class="text-[12px] leading-[1.6] [overflow-wrap:anywhere] my-[8px] mx-0"
        v-if="request.unavailableReason"
        role="status"
      >
        {{ request.unavailableReason }}
      </p>
      <p
        v-if="error"
        class="inline-error text-[#e4a6b0] bg-[#472b343f] py-[10px] px-[12px] text-[12px] leading-[1.6] whitespace-pre-wrap [overflow-wrap:anywhere] my-[8px] mx-0"
        role="alert"
      >
        {{ error }}
      </p>
      <AppButton
        variant="primary"
        v-if="!request.unavailableReason"
        type="submit"
        class="primary [border-color:#adbbff] text-[12px]"
        :disabled="disabled || sending || !answers"
      >
        {{ sending ? "Sending…" : "Submit answers" }}
      </AppButton>
    </template>
  </form>
</template>
