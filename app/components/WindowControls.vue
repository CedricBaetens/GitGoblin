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
onUnmounted(() => { disposed = true; unlisten?.(); });
</script>

<template>
  <div class="window-controls" data-tauri-drag-region="false">
    <button aria-label="Minimize window" title="Minimize" @click="control('minimize')"><Minus :size="14" /></button>
    <button :aria-label="maximized ? 'Restore window' : 'Maximize window'" :title="maximized ? 'Restore' : 'Maximize'" @click="control('toggleMaximize')">
      <Copy v-if="maximized" :size="12" /><Square v-else :size="12" />
    </button>
    <button class="window-close" aria-label="Close window" title="Close" @click="control('close')"><X :size="15" /></button>
  </div>
</template>

<style scoped>
.window-controls { display: flex; height: 100%; margin-left: 5px; flex-shrink: 0; }
button { width: 44px; height: 100%; padding: 0; border: 0; border-radius: 0; color: #a5aab7; }
button:hover { background: #2a2d36; color: white; }
button.window-close:hover { background: #c42b3a; }
button:focus-visible { outline-offset: -3px; }
</style>
