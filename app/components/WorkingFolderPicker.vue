<script setup lang="ts">
import { Check, ChevronDown, FolderGit2 } from "lucide-vue-next";
import {
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectLabel,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "reka-ui";

const props = defineProps<{
  options: { path: string; label: string }[];
  value: string;
  disabled: boolean;
  hint: string;
}>();
const emit = defineEmits<{ select: [path: string] }>();

function choose(path: unknown) {
  if (!props.disabled && typeof path === "string" && path !== props.value)
    emit("select", path);
}
</script>

<template>
  <div
    class="flex items-center gap-2 border-0 border-b border-solid border-b-(--line) px-3 py-[5px] text-ui-muted"
    :title="`${value}\n${hint}`"
  >
    <span class="flex shrink-0 items-center gap-1.5 text-[11px]"
      ><FolderGit2 :size="14" />Working in</span
    >
    <SelectRoot
      :model-value="value"
      :disabled="disabled"
      @update:model-value="choose"
    >
      <SelectTrigger
        aria-label="Agent working folder"
        :aria-description="`${value}. ${hint}`"
        class="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md border-0 bg-transparent px-2 py-[5px] text-[11px] text-ui-text hover:bg-ui-selected focus-visible:outline-2 focus-visible:outline-ui-accent data-[state=open]:bg-ui-selected"
      >
        <SelectValue class="truncate" /><ChevronDown :size="13" />
      </SelectTrigger>
      <SelectPortal>
        <SelectContent
          position="popper"
          align="start"
          :side-offset="5"
          :collision-padding="8"
          class="z-50 w-[max(280px,var(--reka-select-trigger-width))] max-w-[min(420px,calc(100vw-16px))] max-h-(--reka-select-content-available-height) overflow-hidden rounded-lg border border-solid border-ui-border bg-ui-menu p-[5px] text-ui-text shadow-xl"
        >
          <SelectViewport>
            <SelectGroup>
              <SelectLabel
                class="block px-2 pt-1.5 pb-2 text-[10px] text-ui-muted"
                >Choose where the agent works</SelectLabel
              >
              <SelectItem
                v-for="option in options"
                :key="option.path"
                :value="option.path"
                :text-value="option.label"
                class="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2.5 outline-none data-[state=checked]:bg-ui-selected data-highlighted:bg-ui-hover"
              >
                <FolderGit2 :size="16" class="text-ui-muted" />
                <span class="grid min-w-0 flex-1 gap-1">
                  <SelectItemText class="truncate text-[12px] font-medium">{{
                    option.label
                  }}</SelectItemText>
                  <span
                    class="truncate text-[10px] text-ui-muted"
                    :title="option.path"
                    >{{ option.path }}</span
                  >
                </span>
                <SelectItemIndicator class="text-ui-accent"
                  ><Check :size="15"
                /></SelectItemIndicator>
              </SelectItem>
            </SelectGroup>
          </SelectViewport>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>
  </div>
</template>
