<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { fetchServerMapDetail, type ServerMapDetail } from '../../services/dataExplorerService';
import WinStatsBar from './WinStatsBar.vue';
import ActivityHeatmap from './ActivityHeatmap.vue';
import RecentSessionsList from './RecentSessionsList.vue';
import MapRankingsPanel from '../MapRankingsPanel.vue';

const props = defineProps<{
  serverGuid: string;
  mapName: string;
  playerName?: string;
}>();

const emit = defineEmits<{
  navigateToServer: [serverGuid: string];
  navigateToMap: [mapName: string];
  close: [];
  'open-rankings': [mapName: string];
}>();

const detail = ref<ServerMapDetail | null>(null);
const isLoading = ref(false);
const isRefreshing = ref(false);
const error = ref<string | null>(null);
const selectedDays = ref(60);

const activityPatternsForHeatmap = computed(() => detail.value?.activityPatterns ?? []);

const getGameLabel = (game: string): string => {
  switch (game.toLowerCase()) {
    case 'bf1942': return 'BF1942';
    case 'fh2': return 'FH2';
    case 'bfvietnam': return 'BFV';
    default: return game.toUpperCase();
  }
};

const formatPlayTime = (minutes: number): string => {
  if (minutes < 60) return `${minutes}M`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}H`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}D ${remainingHours}H` : `${days}D`;
};

const loadData = async (isRefresh = false) => {
  if (!props.serverGuid || !props.mapName) return;
  if (isRefresh && detail.value) isRefreshing.value = true;
  else isLoading.value = true;
  error.value = null;

  try {
    detail.value = await fetchServerMapDetail(props.serverGuid, props.mapName, selectedDays.value);
  } catch (err) {
    console.error('Error loading server-map detail:', err);
    error.value = 'Failed to load server-map details';
  } finally {
    isLoading.value = false;
    isRefreshing.value = false;
  }
};

onMounted(() => loadData(false));
watch(() => [props.serverGuid, props.mapName], () => loadData(false));
</script>

<template>
  <div class="flex flex-col h-full bg-[#05050a] p-4 sm:p-8 overflow-y-auto custom-scrollbar">
    <!-- Status States -->
    <div v-if="isLoading && !detail" class="flex-1 flex flex-col items-center justify-center opacity-50">
      <div class="w-10 h-10 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mb-4" />
      <div class="font-mono text-[9px] text-cyan-400 uppercase tracking-[0.3em]">Querying_Cluster_Nodes...</div>
    </div>

    <div v-else-if="error && !detail" class="flex-1 flex flex-col items-center justify-center text-center">
      <div class="text-3xl mb-4">⚠️</div>
      <p class="text-red-400 font-mono text-xs uppercase tracking-widest mb-6">{{ error }}</p>
      <button @click="loadData(false)" class="px-6 py-2 bg-white/5 border border-white/10 text-white text-[10px] font-mono font-black uppercase tracking-widest hover:bg-white/10 transition-all">Retry_Request</button>
    </div>

    <!-- Main Content -->
    <div v-else-if="detail" class="space-y-10">
      <!-- High Density Header -->
      <div class="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-white/5 pb-8">
        <div class="flex items-start gap-6">
          <button
            @click="emit('close')"
            class="w-12 h-12 flex items-center justify-center rounded border border-white/10 hover:border-cyan-500/50 hover:bg-cyan-500/5 text-slate-400 hover:text-cyan-400 transition-all group"
          >
            <svg class="w-5 h-5 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/30 text-[9px] font-mono text-cyan-400 uppercase tracking-widest tracking-[0.2em]">Operational_Node</span>
              <span class="text-[10px] text-slate-500 font-mono uppercase">{{ getGameLabel(detail.game) }} // {{ detail.serverName }}</span>
            </div>
            <h2 class="text-3xl md:text-4xl font-black text-white uppercase italic tracking-tighter">{{ detail.mapName }}</h2>
            <div v-if="playerName" class="mt-2 inline-flex px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/30 text-[9px] font-mono text-emerald-400 uppercase tracking-widest">Active_Target: {{ playerName }}</div>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <div v-if="isRefreshing" class="flex items-center gap-2 px-3 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded">
             <div class="w-2 h-2 border border-cyan-500 border-t-transparent rounded-full animate-spin" />
             <span class="text-[8px] font-mono text-cyan-400 uppercase font-black">Syncing...</span>
          </div>
          <select v-model="selectedDays" @change="loadData(true)" class="bg-black/40 border border-white/10 rounded px-3 py-1.5 text-[10px] font-mono font-black text-white uppercase focus:outline-none focus:border-cyan-500/50 cursor-pointer">
            <option :value="30">30_DAYS</option>
            <option :value="60">60_DAYS</option>
            <option :value="90">90_DAYS</option>
            <option :value="180">6_MONTHS</option>
            <option :value="365">1_YEAR</option>
          </select>
        </div>
      </div>

      <!-- Activity Analytics -->
      <section class="space-y-6">
        <div class="flex items-center gap-4">
           <div class="w-1 h-3 bg-cyan-500 shadow-[0_0_8px_rgba(0,229,255,0.4)]" />
           <h3 class="text-[10px] font-mono font-black text-white uppercase tracking-[0.3em]">Traffic_Intelligence</h3>
        </div>
        
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div v-for="stat in [
            { label: 'Total_Rounds', val: detail.mapActivity.totalRounds.toLocaleString(), color: 'text-white' },
            { label: 'Engagement_Time', val: formatPlayTime(detail.mapActivity.totalPlayTimeMinutes), color: 'text-cyan-400' },
            { label: 'Avg_Population', val: detail.mapActivity.avgConcurrentPlayers.toFixed(1), color: 'text-emerald-400' },
            { label: 'Peak_Population', val: detail.mapActivity.peakConcurrentPlayers, color: 'text-neon-gold' }
          ]" :key="stat.label" class="bg-black/40 border border-white/5 p-5 rounded-xl">
            <div class="text-[8px] font-mono text-slate-500 uppercase tracking-widest mb-1">{{ stat.label }}</div>
            <div class="text-2xl font-black font-mono leading-none" :class="stat.color">{{ stat.val }}</div>
          </div>
        </div>

        <div v-if="detail.activityPatterns?.length > 0" class="bg-black/40 border border-white/5 p-6 rounded-xl">
           <div class="text-[9px] font-mono text-slate-500 uppercase tracking-widest mb-4">TEMPORAL_DENSITY_PATTERN</div>
           <ActivityHeatmap :patterns="activityPatternsForHeatmap" />
        </div>
      </section>

      <!-- Combat Balance -->
      <section class="space-y-6">
        <div class="flex items-center gap-4">
           <div class="w-1 h-3 bg-red-500 shadow-[0_0_8px_rgba(248,113,113,0.4)]" />
           <h3 class="text-[10px] font-mono font-black text-white uppercase tracking-[0.3em]">Strategic_Balance</h3>
        </div>
        <div class="bg-black/40 border border-white/5 p-6 rounded-xl">
           <WinStatsBar :win-stats="detail.winStats" />
        </div>
      </section>

      <!-- Local Leaderboard -->
      <section class="space-y-6">
        <div class="flex items-center gap-4">
           <div class="w-1 h-3 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
           <h3 class="text-[10px] font-mono font-black text-white uppercase tracking-[0.3em]">Sector_Standings</h3>
        </div>
        <div class="bg-black/20 border border-white/5 rounded-xl overflow-hidden">
          <MapRankingsPanel
            :map-name="mapName"
            :server-guid="serverGuid"
            :game="(detail.game as any)"
            :days="selectedDays"
            :highlight-player="playerName"
          />
        </div>
      </section>

      <!-- Mission History -->
      <section class="space-y-6">
        <div class="flex items-center gap-4">
           <div class="w-1 h-3 bg-slate-500" />
           <h3 class="text-[10px] font-mono font-black text-white uppercase tracking-[0.3em]">Recent_Engagements</h3>
        </div>
        <RecentSessionsList
          :server-guid="serverGuid"
          :server-name="detail?.serverName"
          :map-name="mapName"
          :limit="5"
          empty-message="NO_RECENT_SESSIONS_LOGGED"
        />
      </section>
    </div>
  </div>
</template>

<style scoped>
.font-mono {
  font-family: 'JetBrains Mono', monospace;
}
.text-neon-gold {
  color: #f59e0b;
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
