<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Check, MessageSquarePlus, Minus, Plus } from "lucide-vue-next";
import { parseDiff, selectedPatch } from "~/lib/diff";
const props = defineProps<{ text: string; mode: string; editable?: boolean }>();
const emit = defineEmits<{ patch: [text: string]; context: [text: string] }>();
const parsed = computed(() =>
  (props.text.match(/^diff --git /gm)?.length || 0) > 1
    ? { header: "", hunks: [] }
    : parseDiff(props.text),
);
const selected = ref(new Set<number>());
const error = ref("");
watch(
  () => props.text,
  () => {
    selected.value = new Set();
    error.value = "";
  },
);
function toggle(index: number) {
  const next = new Set(selected.value);
  next.has(index) ? next.delete(index) : next.add(index);
  selected.value = next;
}
function stage(indices?: number[]) {
  try {
    emit(
      "patch",
      selectedPatch(
        props.text,
        indices ? new Set(indices) : selected.value,
        props.mode === "staged",
      ),
    );
    error.value = "";
  } catch (e) {
    error.value = String(e);
  }
}
function context() {
  const lines = props.text.split("\n");
  emit(
    "context",
    selected.value.size
      ? [...selected.value]
          .sort((a, b) => a - b)
          .map((i) => lines[i])
          .join("\n")
      : props.text,
  );
}
</script>
<template>
  <div class="diff-view">
    <div class="diff-actions">
      <span>{{
        selected.size
          ? `${selected.size} lines selected`
          : "Select changed lines to stage or discuss"
      }}</span
      ><button v-if="editable && selected.size" class="small" @click="stage()">
        <Check :size="13" />{{
          mode === "staged" ? "Unstage" : "Stage"
        }}
        selection</button
      ><button class="small" @click="context">
        <MessageSquarePlus :size="14" />Add to chat
      </button>
    </div>
    <div v-if="error" class="inline-error">{{ error }}</div>
    <div class="diff-scroll">
      <template v-if="parsed.hunks.length">
        <section v-for="hunk in parsed.hunks" :key="hunk.start" class="hunk">
          <div class="hunk-header">
            <code>{{ hunk.header }}</code
            ><button
              v-if="editable"
              class="small"
              @click="
                stage(
                  hunk.lines
                    .filter((l) => l.kind === 'add' || l.kind === 'delete')
                    .map((l) => l.index),
                )
              "
            >
              {{ mode === "staged" ? "Unstage" : "Stage" }} hunk
            </button>
          </div>
          <div
            v-for="line in hunk.lines"
            :key="line.index"
            class="diff-line"
            :class="[line.kind, { selected: selected.has(line.index) }]"
          >
            <button
              v-if="line.kind === 'add' || line.kind === 'delete'"
              class="line-select"
              :aria-label="`Select changed line ${line.next || line.old}`"
              :aria-pressed="selected.has(line.index)"
              @click="toggle(line.index)"
            >
              <Check v-if="selected.has(line.index)" :size="11" /><span v-else
                >·</span
              ></button
            ><span v-else class="line-select" />
            <span class="line-number">{{ line.old }}</span
            ><span class="line-number">{{ line.next }}</span
            ><span class="line-sign">{{
              line.kind === "add" ? "+" : line.kind === "delete" ? "−" : ""
            }}</span
            ><code>{{
              line.kind === "meta" ? line.text : line.text.slice(1)
            }}</code>
          </div>
        </section>
      </template>
      <pre v-else class="plain-output">{{
        text || "No text changes to display."
      }}</pre>
    </div>
  </div>
</template>
