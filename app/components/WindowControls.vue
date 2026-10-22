<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X } from "lucide-vue-next";

const emit = defineEmits<{ error: [message: string] }>();
const maximized = ref(false);
let unlisten: (() => void) | undefined;
let disposed = false;

async function updateState() {
  maximized.value = await getCurrentWindow().isMaximized();
}
async function control(action: "minimize" | "toggleMaximize" | "close") {
  try {
    await getCurrentWindow()[action]();
    if (action === "toggleMaximize") await updateState();
  } catch (error) {
    emit("error", `Window action failed: ${error}`);
  }
}
onMounted(async () => {
  try {
    await updateState();
    const stop = await getCurrentWindow().onResized(() => {
      void updateState().catch((error) => emit("error", String(error)));
    });
    if (disposed) stop();
    else unlisten = stop;
  } catch (error) {
    emit("error", `Could not read window state: ${error}`);
  }
});
onUnmounted(() => {
  disposed = true;
  unlisten?.();
});
</script>

<template>
  <div
    class="window-controls flex h-full ml-[5px] shrink-0"
    data-tauri-drag-region="false"
  >
    <AppButton
      class="w-[44px] h-full p-0 border-0 rounded-none text-[#a5aab7] hover:bg-[#2a2d36] hover:text-[white] focus-visible:outline-offset-[-3px]"
      aria-label="Minimize window"
      title="Minimize"
      @click="control('minimize')"
    >
      <Minus :size="14" />
    </AppButton>
    <AppButton
      class="w-[44px] h-full p-0 border-0 rounded-none text-[#a5aab7] hover:bg-[#2a2d36] hover:text-[white] focus-visible:outline-offset-[-3px]"
      :aria-label="maximized ? 'Restore window' : 'Maximize window'"
      :title="maximized ? 'Restore' : 'Maximize'"
      @click="control('toggleMaximize')"
    >
      <Copy v-if="maximized" :size="12" /><Square v-else :size="12" />
    </AppButton>
    <AppButton
      class="window-close w-[44px] h-full p-0 border-0 rounded-none text-[#a5aab7] hover:bg-[#2a2d36] hover:text-[white] [button&:hover]:bg-[#c42b3a] focus-visible:outline-offset-[-3px]"
      aria-label="Close window"
      title="Close"
      @click="control('close')"
    >
      <X :size="15" />
    </AppButton>
  </div>
</template>
