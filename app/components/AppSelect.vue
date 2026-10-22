<script setup lang="ts">
import { Check, ChevronDown } from "lucide-vue-next";
import { computed } from "vue";
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "reka-ui";

defineOptions({ inheritAttrs: false });
const props = defineProps<{
  modelValue?: string | number | boolean;
  options: { value: string; label: string; disabled?: boolean }[];
  disabled?: boolean;
  placeholder?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const emptyValue = "__provider_default__";
const selectedValue = computed(() => {
  if (props.modelValue === undefined) return undefined;
  if (props.modelValue === "")
    return props.options.some((option) => option.value === "")
      ? emptyValue
      : undefined;
  return String(props.modelValue);
});
function choose(value: unknown) {
  emit("update:modelValue", value === emptyValue ? "" : String(value ?? ""));
}
</script>

<template>
  <SelectRoot
    :model-value="selectedValue"
    :disabled="disabled"
    @update:model-value="choose"
  >
    <SelectTrigger
      v-bind="$attrs"
      class="flex min-w-0 items-center justify-between gap-[8px] text-left disabled:cursor-not-allowed disabled:opacity-40 [:where(&)]:[font:inherit] [:where(&)]:text-[inherit] [:where(&)]:bg-[#101115] [:where(&)]:border-[1px] [:where(&)]:border-solid [:where(&)]:border-[#343640] [:where(&)]:rounded-[6px] [:where(&)]:py-[9px] [:where(&)]:px-[10px] [:where(&)]:outline-none [:where(&)]:min-w-0 [:where(&:focus)]:[border-color:#8092d2] [:where(&:focus)]:shadow-[0_0_0_2px_#8297ec12]"
    >
      <SelectValue class="truncate" :placeholder="placeholder" /><ChevronDown
        :size="13"
        class="shrink-0"
      />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        position="popper"
        :side-offset="4"
        :collision-padding="8"
        class="z-[150] max-h-(--reka-select-content-available-height) min-w-(--reka-select-trigger-width) max-w-[calc(100vw-16px)] overflow-hidden rounded-[6px] border border-ui-border bg-ui-menu p-[4px] text-[12px] text-ui-text shadow-xl"
      >
        <SelectViewport>
          <SelectItem
            v-for="option in options"
            :key="option.value"
            :value="option.value || emptyValue"
            :disabled="option.disabled"
            :text-value="option.label"
            class="flex cursor-pointer items-center gap-[8px] rounded-[4px] px-[10px] py-[7px] outline-none data-[highlighted]:bg-ui-hover data-[state=checked]:bg-ui-selected data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
          >
            <SelectItemText class="min-w-0 flex-1 truncate">{{
              option.label
            }}</SelectItemText>
            <SelectItemIndicator><Check :size="13" /></SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
