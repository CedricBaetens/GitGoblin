<script setup lang="ts">
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from "reka-ui";

defineOptions({ inheritAttrs: false });
withDefaults(defineProps<{ title?: string; dismissible?: boolean }>(), {
  title: "GitGoblin",
  dismissible: true,
});
const emit = defineEmits<{ close: [] }>();
const trigger =
  typeof document === "undefined"
    ? null
    : (document.activeElement as HTMLElement | null);

function restoreFocus() {
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
}
</script>

<template>
  <DialogRoot
    :open="true"
    @update:open="
      (open) => {
        if (!open && dismissible) emit('close');
      }
    "
  >
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-[100] bg-[#070a11b8] backdrop-blur-[5px]"
      />
      <DialogContent
        v-bind="$attrs"
        :aria-describedby="undefined"
        class="fixed left-1/2 top-1/2 z-[101] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 outline-none"
        @escape-key-down="
          (event) => {
            if (!dismissible) event.preventDefault();
          }
        "
        @interact-outside="
          (event) => {
            if (!dismissible) event.preventDefault();
          }
        "
        @close-auto-focus.prevent="restoreFocus"
      >
        <DialogTitle class="sr-only">{{ title }}</DialogTitle>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
