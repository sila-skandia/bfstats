<script setup lang="ts">
import { computed, ref, onMounted, watch } from 'vue';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
  type ChartData
} from 'chart.js';
import { Line, Scatter } from 'vue-chartjs';
import type { RoundReport, LeaderboardSnapshot } from '../../services/serverDetailsService';
import type { BattleEvent, RoundSummary } from '../../utils/battleEventGenerator';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface Props {
  roundReport: RoundReport;
  battleEvents: BattleEvent[];
  currentTimeIndex: number;
  batchUpdateEvents: any[];
  trackedPlayer: string;
  roundSummary?: RoundSummary | null;
}

const props = defineProps<Props>();

// --- 1. Combat Velocity (KPM Trend) ---
const velocityChartData = computed<ChartData<'line'>>(() => {
  const snapshots = props.roundReport.leaderboardSnapshots;
  if (!snapshots.length) return { labels: [], datasets: [] };
  const labels = snapshots.map((_, i) => `${i}m`);
  const serverKills = snapshots.map(s => s.entries.reduce((sum, e) => sum + e.kills, 0));
  const kpmData = serverKills.map((kills, i) => i === 0 ? 0 : kills - serverKills[i - 1]);
  return {
    labels,
    datasets: [{
      label: 'SERVER_KPM',
      data: kpmData,
      borderColor: '#22d3ee',
      backgroundColor: 'rgba(34, 211, 238, 0.1)',
      fill: true,
      tension: 0.3,
      pointRadius: 0,
      borderWidth: 1,
    }]
  };
});

// --- 2. The "Race" (Top 5 + Tracked) ---
const raceChartData = computed<ChartData<'line'>>(() => {
  const snapshots = props.roundReport.leaderboardSnapshots;
  if (!snapshots.length) return { labels: [], datasets: [] };

  const finalSnapshot = snapshots[snapshots.length - 1];
  const top5Names = finalSnapshot.entries.slice(0, 5).map(e => e.playerName);
  
  // Selective Interest: Top 5 + the tracked player
  const playersOfInterest = [...top5Names];
  if (props.trackedPlayer.trim() && !top5Names.includes(props.trackedPlayer.trim())) {
    playersOfInterest.push(props.trackedPlayer.trim());
  }
  
  const colors = ['#f59e0b', '#ec4899', '#8b5cf6', '#10b981', '#3b82f6', '#00e5ff'];
  const labels = snapshots.map((_, i) => `${i}m`);

  const datasets = playersOfInterest.map((name, idx) => {
    return {
      label: name,
      data: snapshots.map(s => {
        const entry = s.entries.find(e => e.playerName.toLowerCase() === name.toLowerCase());
        return entry ? entry.score : 0;
      }),
      borderColor: colors[idx % colors.length],
      borderWidth: name.toLowerCase() === props.trackedPlayer.trim().toLowerCase() ? 4 : 2,
      pointRadius: 0,
      tension: 0.1,
      fill: false,
      opacity: name.toLowerCase() === props.trackedPlayer.trim().toLowerCase() ? 1 : 0.6
    };
  });

  return { labels, datasets };
});

// --- 3. Efficiency Quadrants (Adaptive Cloud) ---
const efficiencyChartData = computed<ChartData<'scatter'>>(() => {
  const snapshots = props.roundReport.leaderboardSnapshots;
  if (!snapshots.length) return { datasets: [] };

  const currentIdx = Math.min(
    Math.floor((props.currentTimeIndex / props.batchUpdateEvents.length) * (snapshots.length - 1)),
    snapshots.length - 1
  );
  const activeSnapshot = snapshots[currentIdx] || snapshots[0];
  
  const highInterestNames = activeSnapshot.entries.slice(0, 10).map(e => e.playerName.toLowerCase());
  if (props.trackedPlayer.trim()) highInterestNames.push(props.trackedPlayer.trim().toLowerCase());

  // High interest players (Operatives)
  const operatives = activeSnapshot.entries.filter(e => highInterestNames.includes(e.playerName.toLowerCase()));
  // Everyone else (Background Cloud)
  const recruits = activeSnapshot.entries.filter(e => !highInterestNames.includes(e.playerName.toLowerCase()));

  return {
    datasets: [
      {
        label: 'RECRUITS',
        data: recruits.map(e => ({ x: e.deaths, y: e.kills, playerName: e.playerName })),
        backgroundColor: 'rgba(71, 85, 105, 0.2)',
        pointRadius: 2,
        pointHoverRadius: 4,
      },
      {
        label: 'OPERATIVES',
        data: operatives.map(e => ({ x: e.deaths, y: e.kills, playerName: e.playerName })),
        backgroundColor: (context: any) => {
          const p = context.raw;
          if (!p) return '#94a3b8';
          if (p.playerName.toLowerCase() === props.trackedPlayer.trim().toLowerCase()) return '#fbbf24'; // tracked = gold
          return p.y > p.x ? '#22d3ee' : '#f87171';
        },
        pointRadius: (context: any) => {
           const p = context.raw;
           return p?.playerName.toLowerCase() === props.trackedPlayer.trim().toLowerCase() ? 8 : 5;
        },
        pointHoverRadius: 10,
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1
      }
    ]
  };
});

// --- Options ---
const baseOptions: ChartOptions<any> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(5, 5, 10, 0.95)',
      titleFont: { family: 'JetBrains Mono', size: 11 },
      bodyFont: { family: 'JetBrains Mono', size: 10 },
      padding: 10,
      borderColor: 'rgba(34, 211, 238, 0.3)',
      borderWidth: 1,
      callbacks: {
        label: (context: any) => {
          if (context.raw.playerName) return `${context.raw.playerName}: ${context.raw.y}K / ${context.raw.x}D`;
          return `${context.dataset.label}: ${context.raw}`;
        }
      }
    }
  },
  scales: {
    x: { grid: { color: 'rgba(255, 255, 255, 0.03)' }, ticks: { color: '#475569', font: { family: 'JetBrains Mono', size: 8 } } },
    y: { grid: { color: 'rgba(255, 255, 255, 0.03)' }, ticks: { color: '#475569', font: { family: 'JetBrains Mono', size: 8 } } }
  }
};

const raceOptions = {
  ...baseOptions,
  scales: {
    ...baseOptions.scales,
    x: { display: false },
    y: { position: 'right', grid: { display: false }, ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 9 } } }
  }
};

const efficiencyOptions = {
  ...baseOptions,
  scales: {
    x: { 
      title: { display: true, text: 'DEATHS', color: '#64748b', font: { family: 'JetBrains Mono', size: 8 } },
      grid: { color: 'rgba(255, 255, 255, 0.05)' },
      ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 9 } }
    },
    y: { 
      title: { display: true, text: 'KILLS', color: '#64748b', font: { family: 'JetBrains Mono', size: 8 } },
      grid: { color: 'rgba(255, 255, 255, 0.05)' },
      ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 9 } }
    }
  }
};

const currentTimeProgress = computed(() => {
  if (!props.batchUpdateEvents.length) return 0;
  return (props.currentTimeIndex / (props.batchUpdateEvents.length - 1)) * 100;
});
</script>

<template>
  <div class="grid grid-cols-1 md:grid-cols-12 gap-6 h-full p-6 custom-scrollbar overflow-y-auto">
    
    <!-- LEFT COLUMN: MOMENTUM & FLOW -->
    <div class="md:col-span-8 flex flex-col gap-6">
      
      <!-- Chart 1: The Race -->
      <div class="flex-1 min-h-[340px] flex flex-col bg-black/40 rounded-xl border border-white/5 p-5 relative overflow-hidden group">
        <div class="flex items-center justify-between mb-4 z-10">
          <div class="flex items-center gap-2">
            <div class="w-1 h-3 bg-cyan-500 shadow-[0_0_8px_rgba(0,229,255,0.5)]" />
            <h4 class="text-[10px] font-mono font-black text-white uppercase tracking-[0.3em]">Operational Lead Flow</h4>
          </div>
          <div class="flex flex-wrap gap-2 justify-end">
            <div v-for="(ds, i) in raceChartData.datasets" :key="i" class="flex items-center gap-1.5 px-2 py-0.5 bg-black/40 border border-white/5 rounded">
              <div class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: ds.borderColor }" />
              <span class="text-[8px] font-mono uppercase" :class="ds.label.toLowerCase() === trackedPlayer.trim().toLowerCase() ? 'text-cyan-400 font-black' : 'text-slate-500'">{{ ds.label }}</span>
            </div>
          </div>
        </div>
        
        <div class="flex-1 relative">
          <Line :data="raceChartData" :options="raceOptions" />
          <div 
            class="absolute top-0 bottom-0 w-px bg-cyan-500 shadow-[0_0_12px_rgba(0,229,255,0.6)] z-20 pointer-events-none transition-all duration-300"
            :style="{ left: `${currentTimeProgress}%` }"
          >
            <div class="absolute top-0 left-[-3px] w-1.5 h-1.5 bg-cyan-500 rounded-full" />
          </div>
        </div>
      </div>

      <!-- Chart 2: Combat Velocity -->
      <div class="h-[180px] flex flex-col bg-black/40 rounded-xl border border-white/5 p-5 relative group">
        <div class="flex items-center gap-2 mb-4 z-10">
          <div class="w-1 h-3 bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]" />
          <h4 class="text-[10px] font-mono font-black text-white uppercase tracking-[0.3em]">Instantaneous Combat Velocity</h4>
        </div>
        <div class="flex-1 relative">
          <Line :data="velocityChartData" :options="baseOptions" />
          <div 
            class="absolute top-0 bottom-0 w-px bg-white/20 z-20 pointer-events-none"
            :style="{ left: `${currentTimeProgress}%` }"
          />
        </div>
      </div>
    </div>

    <!-- RIGHT COLUMN: EFFICIENCY -->
    <div class="md:col-span-4 flex flex-col gap-6">
      <div class="flex-1 min-h-[300px] flex flex-col bg-black/40 rounded-xl border border-white/5 p-5">
        <div class="flex items-center gap-2 mb-6">
          <div class="w-1 h-3 bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
          <h4 class="text-[10px] font-mono font-black text-white uppercase tracking-[0.3em]">Efficiency Quadrants</h4>
        </div>
        <div class="flex-1 relative">
          <Scatter :data="efficiencyChartData" :options="efficiencyOptions" />
          
          <!-- Quadrant Labels -->
          <div class="absolute inset-0 pointer-events-none flex flex-wrap opacity-20 text-[7px] font-mono font-bold text-slate-500 p-8">
            <div class="w-1/2 h-1/2 flex items-start justify-end pr-2 border-r border-b border-white/5">HUNTERS</div>
            <div class="w-1/2 h-1/2 flex items-start justify-start pl-2 border-b border-white/5">ELITE</div>
            <div class="w-1/2 h-1/2 flex items-end justify-end pr-2 border-r border-white/5">RECRUITS</div>
            <div class="w-1/2 h-1/2 flex items-end justify-start pl-2">GRINDERS</div>
          </div>
        </div>
        <div class="mt-4 p-2 bg-black/20 rounded border border-white/5">
          <p class="text-[8px] font-mono text-slate-500 uppercase leading-tight">
            System automatically highlights Top 10 and Pinned targets. Ambient noise reduced for operational clarity.
          </p>
        </div>
      </div>

      <!-- Summary Metrics -->
      <div class="bg-cyan-500/5 border border-cyan-500/20 rounded-xl p-6 flex flex-col gap-4">
        <div v-for="metric in [
          { label: 'Kill Velocity', val: (roundSummary?.totalKills || 0) / 10, unit: 'KPM', color: 'text-cyan-400' },
          { label: 'Lead Stability', val: 100 - (roundSummary?.leadChanges || 0) * 10, unit: '%', color: 'text-purple-400' },
          { label: 'Tactical Spread', val: roundSummary?.avgKD || 0, unit: 'K/D', color: 'text-emerald-400' }
        ]" :key="metric.label" class="flex justify-between items-end border-b border-white/5 pb-2 last:border-0 last:pb-0">
          <span class="text-[9px] font-mono text-slate-500 uppercase tracking-widest">{{ metric.label }}</span>
          <div class="text-right">
            <span class="text-xl font-black font-mono leading-none mr-1" :class="metric.color">{{ metric.val.toFixed(1) }}</span>
            <span class="text-[8px] font-mono text-slate-600 uppercase">{{ metric.unit }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.font-mono {
  font-family: 'JetBrains Mono', monospace;
}
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
}
</style>
