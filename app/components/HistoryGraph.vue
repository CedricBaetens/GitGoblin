<script setup lang="ts">
import type { GraphRow } from "~/lib/graph";
defineProps<{ row: GraphRow }>();
const colors = [
  "#d9ac60",
  "#83c8aa",
  "#d8ac83",
  "#c69bd3",
  "#80b8d5",
  "#db929f",
];
const x = (lane: number) => 10 + lane * 12;
</script>
<template>
  <svg
    class="history-graph"
    :width="Math.max(24, row.width * 12 + 10)"
    height="22"
    aria-label="Commit ancestry"
  >
    <path
      v-for="edge in row.above"
      :key="`top-${edge.lane}`"
      :d="`M ${x(edge.lane)} 0 L ${x(edge.lane)} 11`"
      :stroke="colors[edge.color % colors.length]"
      fill="none"
      stroke-width="1.5"
    />
    <path
      v-for="(edge, i) in row.edges"
      :key="i"
      :d="`M ${x(edge.from)} 11 C ${x(edge.from)} 17 ${x(edge.to)} 17 ${x(edge.to)} 22`"
      :stroke="colors[edge.color % colors.length]"
      fill="none"
      stroke-width="1.5"
    />
    <circle
      :cx="x(row.lane)"
      cy="11"
      r="3"
      :fill="colors[row.lane % colors.length]"
      :stroke="colors[row.lane % colors.length]"
      stroke-width="1"
    />
  </svg>
</template>
