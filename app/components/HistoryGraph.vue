<script setup lang="ts">
import type { GraphRow } from "~/lib/graph";
defineProps<{ row: GraphRow }>();
const colors = [
  "#9babec",
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
    :width="Math.max(50, row.width * 12 + 10)"
    height="45"
    aria-label="Commit ancestry"
  >
    <path
      v-for="edge in row.above"
      :key="`top-${edge.lane}`"
      :d="`M ${x(edge.lane)} 0 L ${x(edge.lane)} 22`"
      :stroke="colors[edge.color % colors.length]"
      fill="none"
      stroke-width="1.5"
    />
    <path
      v-for="(edge, i) in row.edges"
      :key="i"
      :d="`M ${x(edge.from)} 22 C ${x(edge.from)} 37 ${x(edge.to)} 32 ${x(edge.to)} 45`"
      :stroke="colors[edge.color % colors.length]"
      fill="none"
      stroke-width="1.5"
    />
    <circle
      :cx="x(row.lane)"
      cy="22"
      r="4"
      fill="#171c28"
      :stroke="colors[row.lane % colors.length]"
      stroke-width="2"
    />
  </svg>
</template>
