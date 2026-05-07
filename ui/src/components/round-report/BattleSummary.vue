<script setup lang="ts">
import { computed } from 'vue';
import type { RoundSummary } from '../../utils/battleEventGenerator';

interface Props {
  summary: RoundSummary;
}

const props = defineProps<Props>();

const kdColor = computed(() => {
  const kd = props.summary.avgKD;
  if (kd >= 1.5) return 'text-emerald-400';
  if (kd >= 1) return 'text-yellow-400';
  return 'text-orange-400';
});

const mvpKdColor = computed(() => {
  if (!props.summary.mvp) return 'text-slate-400';
  const kd = props.summary.mvp.kd;
  if (kd >= 2) return 'text-emerald-400';
  if (kd >= 1.5) return 'text-green-400';
  if (kd >= 1) return 'text-yellow-400';
  return 'text-orange-400';
});
</script>

<template>
  <div class="grid grid-cols-1 md:grid-cols-12 gap-6">
    <!-- Main Stats Row (8 cols) -->
    <div class="md:col-span-8 grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div
        v-for="stat in [
          { label: 'DURATION', value: summary.duration, color: 'text-cyan-400' },
          { label: 'TOTAL KILLS', value: summary.totalKills, color: 'text-emerald-400' },
          { label: 'PARTICIPANTS', value: summary.participants, color: 'text-blue-400' },
          { label: 'AVG K/D', value: summary.avgKD.toFixed(2), color: kdColor }
        ]"
        :key="stat.label"
        class="bg-black/40 backdrop-blur-md border border-white/5 p-4 rounded-lg flex flex-col items-center justify-center group hover:border-cyan-500/30 transition-all"
      >
        <span class="text-[9px] font-mono text-slate-500 uppercase tracking-widest mb-1">{{ stat.label }}</span>
        <span
          class="text-xl font-black font-mono transition-transform group-hover:scale-110"
          :class="stat.color"
        >{{ stat.value }}</span>
      </div>
    </div>

    <!-- MVP Card (4 cols) -->
    <div
      v-if="summary.mvp"
      class="md:col-span-4 bg-gradient-to-br from-yellow-500/10 to-orange-600/10 backdrop-blur-md border border-yellow-500/20 p-4 rounded-lg flex items-center gap-4 relative overflow-hidden group"
    >
      <div class="absolute top-[-10px] right-[-10px] text-4xl opacity-10 rotate-12 group-hover:rotate-0 transition-transform">
        🏆
      </div>
      <div class="flex-shrink-0 w-12 h-12 flex items-center justify-center bg-yellow-500/20 rounded-full border border-yellow-500/30 shadow-[0_0_15px_rgba(234,179,8,0.2)]">
        <span class="text-xl">🎖️</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[9px] font-mono text-yellow-500 uppercase tracking-[0.2em] mb-0.5">
          Tactical MVP
        </div>
        <div class="text-lg font-black text-white uppercase truncate tracking-tight">
          {{ $pn(summary.mvp.playerName) }}
        </div>
        <div class="flex items-center gap-3 text-[10px] font-mono text-slate-400">
          <span>{{ summary.mvp.score }} PTS</span>
          <span class="text-slate-600">|</span>
          <span :class="mvpKdColor">{{ summary.mvp.kills }}/{{ summary.mvp.deaths }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.font-mono {
  font-family: 'JetBrains Mono', monospace;
}
</style>
