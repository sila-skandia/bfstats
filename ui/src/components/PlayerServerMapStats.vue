<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { calculateKDR, getRankClass } from '@/utils/statsUtils';
import { PLAYER_STATS_TIME_RANGE_OPTIONS } from '@/utils/constants';
import { fetchPlayerMapRankings, type PlayerMapRankingsResponse, type GameType } from '../services/dataExplorerService';

interface MapStat {
  mapName: string;
  totalScore: number;
  totalKills: number;
  totalDeaths: number;
  sessionsPlayed: number;
  totalPlayTimeMinutes: number;
  rank: number | null;
  kdRatio: number;
}

const props = defineProps<{
  playerName: string;
  serverGuid?: string;
  game?: GameType;
}>();

const emit = defineEmits<{
  (e: 'open-rankings', mapName: string): void;
  (e: 'open-map-detail', mapName: string): void;
  (e: 'close'): void;
}>();

const handleRankClick = (mapName: string, rank: number | null) => {
  if (rank !== null) {
    emit('open-rankings', mapName);
  }
};

const handleMapClick = (mapName: string) => {
  emit('open-map-detail', mapName);
};

const playerData = ref<PlayerMapRankingsResponse | null>(null);
const isLoading = ref(false);
const error = ref<string | null>(null);
const sortField = ref<'mapName' | 'totalScore' | 'kdRatio' | 'totalKills' | 'totalDeaths' | 'sessionsPlayed' | 'rank'>('totalScore');
const sortDirection = ref<'asc' | 'desc'>('desc');

const selectedTimeRange = ref<number>(60);
const timeRangeOptions = PLAYER_STATS_TIME_RANGE_OPTIONS;

const mapStats = computed<MapStat[]>(() => {
  if (!playerData.value) return [];

  return playerData.value.mapGroups
    .map(mapGroup => {
      if (mapGroup.serverStats.length === 0) return null;

      if (props.serverGuid) {
        const serverStat = mapGroup.serverStats[0];
        if (!serverStat) return null;
        return {
          mapName: mapGroup.mapName,
          totalScore: serverStat.totalScore,
          totalKills: serverStat.totalKills,
          totalDeaths: serverStat.totalDeaths,
          sessionsPlayed: serverStat.totalRounds,
          totalPlayTimeMinutes: 0,
          rank: serverStat.rank,
          kdRatio: serverStat.kdRatio
        };
      } else {
        const totalScore = mapGroup.serverStats.reduce((s, st) => s + st.totalScore, 0);
        const totalKills = mapGroup.serverStats.reduce((s, st) => s + st.totalKills, 0);
        const totalDeaths = mapGroup.serverStats.reduce((s, st) => s + st.totalDeaths, 0);
        const totalRounds = mapGroup.serverStats.reduce((s, st) => s + st.totalRounds, 0);
        const kdRatio = totalDeaths > 0 ? totalKills / totalDeaths : totalKills > 0 ? totalKills : 0;
        return {
          mapName: mapGroup.mapName,
          totalScore,
          totalKills,
          totalDeaths,
          sessionsPlayed: totalRounds,
          totalPlayTimeMinutes: 0,
          rank: mapGroup.bestRank,
          kdRatio
        };
      }
    })
    .filter((stat): stat is MapStat => stat !== null);
});

const sortedMapStats = computed(() => {
  if (!mapStats.value || mapStats.value.length === 0) return [];

  return [...mapStats.value].sort((a, b) => {
    const direction = sortDirection.value === 'asc' ? 1 : -1;

    switch (sortField.value) {
      case 'mapName':
        return direction * a.mapName.localeCompare(b.mapName);
      case 'totalScore':
        return direction * (a.totalScore - b.totalScore);
      case 'kdRatio':
        return direction * (a.kdRatio - b.kdRatio);
      case 'totalKills':
        return direction * (a.totalKills - b.totalKills);
      case 'totalDeaths':
        return direction * (a.totalDeaths - b.totalDeaths);
      case 'sessionsPlayed':
        return direction * (a.sessionsPlayed - b.sessionsPlayed);
      case 'rank': {
        if (a.rank === null && b.rank === null) return 0;
        if (a.rank === null) return 1;
        if (b.rank === null) return -1;
        return direction * (a.rank - b.rank);
      }
      default:
        return direction * (a.totalScore - b.totalScore);
    }
  });
});

const changeSort = (field: typeof sortField.value) => {
  if (sortField.value === field) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortField.value = field;
    sortDirection.value = field === 'rank' ? 'asc' : 'desc';
  }
};


const loadData = async (days?: number) => {
  if (!props.playerName) return;

  const timeRange = days || selectedTimeRange.value;
  isLoading.value = true;
  error.value = null;

  try {
    playerData.value = await fetchPlayerMapRankings(
      props.playerName,
      props.game || 'bf1942',
      timeRange,
      props.serverGuid
    );

    if (playerData.value.mapGroups.length === 0) {
      const scope = props.serverGuid ? 'on this server' : 'across all servers';
      error.value = `No statistics found for this player ${scope} for the selected time period`;
    }
  } catch (err: any) {
    console.error('Error fetching map rankings:', err);
    if (err.message === 'PLAYER_NOT_FOUND') {
      const scope = props.serverGuid ? 'on this server' : 'across all servers';
      error.value = `No statistics found for this player ${scope} for the selected time period`;
    } else {
      error.value = 'Failed to load map statistics';
    }
    playerData.value = null;
  } finally {
    isLoading.value = false;
  }
};

const changeTimeRange = (days: number) => {
  selectedTimeRange.value = days;
  loadData(days);
};

onMounted(() => loadData());
watch(() => props.playerName, () => loadData());
watch(() => props.serverGuid, () => loadData());
</script>

<template>
  <div class="p-4 sm:p-8 flex flex-col h-full bg-[#05050a]">
    <!-- Terminal Loading -->
    <div v-if="isLoading" class="flex-1 flex flex-col items-center justify-center space-y-4 opacity-50">
      <div class="w-12 h-12 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
      <div class="font-mono text-[10px] text-cyan-400 uppercase tracking-[0.3em]">Querying_Database...</div>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="flex-1 flex flex-col items-center justify-center p-12 text-center">
      <div class="text-3xl mb-4">📡</div>
      <p class="text-sm font-mono text-slate-400 mb-8 uppercase tracking-widest">{{ error }}</p>
      <div class="flex flex-wrap justify-center gap-2">
        <button
          v-for="option in timeRangeOptions"
          :key="option.value"
          class="px-4 py-2 text-[10px] font-mono uppercase tracking-widest border transition-all"
          :class="selectedTimeRange === option.value ? 'bg-cyan-500/10 border-cyan-500 text-cyan-400 shadow-[0_0_15px_rgba(0,229,255,0.1)]' : 'bg-white/5 border-white/10 text-slate-500 hover:border-white/30 hover:text-white'"
          @click="changeTimeRange(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <!-- Main Content -->
    <div v-else-if="mapStats.length > 0" class="flex flex-col h-full space-y-8">
      <!-- High Density Header -->
      <div class="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-white/5 pb-8">
        <div class="flex items-start gap-6">
          <button
            @click="emit('close')"
            class="w-12 h-12 flex items-center justify-center rounded border border-white/10 hover:border-cyan-500/50 hover:bg-cyan-500/5 text-slate-400 hover:text-cyan-400 transition-all group"
          >
            <svg class="w-5 h-5 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/30 text-[9px] font-mono text-cyan-400 uppercase tracking-[0.2em]">Intel_Report</span>
              <span class="text-[10px] text-slate-500 font-mono uppercase">Nodes_Found: {{ mapStats.length }}</span>
            </div>
            <h2 class="text-3xl font-black text-white uppercase italic tracking-tighter">Strategic Deployments</h2>
            <div class="text-[10px] text-slate-500 font-mono mt-1 uppercase tracking-widest">Temporal Range: Last {{ playerData?.dateRange.days }} Cycles</div>
          </div>
        </div>
        
        <!-- Tabbed Time Ranges -->
        <div class="flex bg-black/40 p-1 border border-white/5 rounded">
          <button
            v-for="option in timeRangeOptions"
            :key="option.value"
            class="px-4 py-2 text-[10px] font-mono uppercase font-black transition-all"
            :class="selectedTimeRange === option.value ? 'bg-cyan-500 text-black shadow-[0_0_15px_rgba(0,229,255,0.3)]' : 'text-slate-500 hover:text-slate-300'"
            @click="changeTimeRange(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <!-- High Density Grid Table -->
      <div class="flex-1 overflow-hidden bg-black/20 border border-white/5 rounded-xl flex flex-col">
        <div class="overflow-x-auto custom-scrollbar">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="bg-white/5 border-b border-white/10 font-mono text-[10px] text-slate-500 uppercase tracking-[0.2em]">
                <th class="p-4 font-black cursor-pointer hover:text-white transition-colors" @click="changeSort('rank')">
                  <div class="flex items-center gap-2"># <span v-if="sortField === 'rank'">{{ sortDirection === 'asc' ? '▲' : '▼' }}</span></div>
                </th>
                <th class="p-4 font-black cursor-pointer hover:text-white transition-colors" @click="changeSort('mapName')">
                  <div class="flex items-center gap-2">Designation <span v-if="sortField === 'mapName'">{{ sortDirection === 'asc' ? '▲' : '▼' }}</span></div>
                </th>
                <th class="p-4 font-black text-right cursor-pointer hover:text-white transition-colors" @click="changeSort('totalScore')">
                  <div class="flex items-center justify-end gap-2">Net_Score <span v-if="sortField === 'totalScore'">{{ sortDirection === 'asc' ? '▲' : '▼' }}</span></div>
                </th>
                <th class="p-4 font-black text-right cursor-pointer hover:text-white transition-colors" @click="changeSort('kdRatio')">
                  <div class="flex items-center justify-end gap-2">Efficiency <span v-if="sortField === 'kdRatio'">{{ sortDirection === 'asc' ? '▲' : '▼' }}</span></div>
                </th>
                <th class="p-4 font-black text-right cursor-pointer hover:text-white transition-colors" @click="changeSort('totalKills')">
                  <div class="flex items-center justify-end gap-2">Kills <span v-if="sortField === 'totalKills'">{{ sortDirection === 'asc' ? '▲' : '▼' }}</span></div>
                </th>
                <th class="p-4 font-black text-right cursor-pointer hover:text-white transition-colors" @click="changeSort('totalDeaths')">
                  <div class="flex items-center justify-end gap-2">Losses <span v-if="sortField === 'totalDeaths'">{{ sortDirection === 'asc' ? '▲' : '▼' }}</span></div>
                </th>
                <th class="p-4 font-black text-right cursor-pointer hover:text-white transition-colors" @click="changeSort('sessionsPlayed')">
                  <div class="flex items-center justify-end gap-2">Engagements <span v-if="sortField === 'sessionsPlayed'">{{ sortDirection === 'asc' ? '▲' : '▼' }}</span></div>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/5 font-mono">
              <tr
                v-for="(map, index) in sortedMapStats"
                :key="map.mapName"
                class="group hover:bg-white/[0.03] transition-all cursor-pointer"
                @click="handleMapClick(map.mapName)"
              >
                <td class="p-4">
                  <div
                    v-if="map.rank !== null"
                    class="w-8 h-8 flex items-center justify-center rounded border transition-all text-xs font-black"
                    :class="[getRankClass(map.rank), 'border-current/20 group-hover:border-current shadow-[inset_0_0_8px_rgba(0,0,0,0.5)]']"
                    @click.stop="handleRankClick(map.mapName, map.rank)"
                  >
                    {{ map.rank }}
                  </div>
                  <span v-else class="text-slate-700 text-xs">—</span>
                </td>
                <td class="p-4">
                  <div class="flex flex-col">
                    <span class="text-sm font-bold text-white uppercase group-hover:text-cyan-400 transition-colors tracking-tight">{{ map.mapName }}</span>
                    <span class="text-[9px] text-slate-600 uppercase tracking-widest">Map_ID: 0x{{ index.toString(16).padStart(2, '0') }}</span>
                  </div>
                </td>
                <td class="p-4 text-right">
                  <span class="text-sm font-black text-neon-gold">{{ map.totalScore.toLocaleString() }}</span>
                </td>
                <td class="p-4 text-right">
                  <span class="text-sm font-black text-emerald-500">{{ map.kdRatio.toFixed(2) }}</span>
                </td>
                <td class="p-4 text-right text-red-400 text-xs">
                  {{ map.totalKills.toLocaleString() }}
                </td>
                <td class="p-4 text-right text-slate-500 text-xs">
                  {{ map.totalDeaths.toLocaleString() }}
                </td>
                <td class="p-4 text-right text-cyan-400/80 text-xs font-black">
                  {{ map.sessionsPlayed.toLocaleString() }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      
      <!-- Operational Footer -->
      <div class="flex items-center justify-between px-4 py-2 border-t border-white/5 opacity-40">
        <div class="text-[9px] font-mono uppercase tracking-[0.3em] text-slate-500">Auto_Refresh: Nominal</div>
        <div class="text-[9px] font-mono uppercase tracking-[0.3em] text-slate-500">Terminal_ID: INTEL_PRIME_01</div>
      </div>
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
  height: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: rgba(0, 0, 0, 0.1);
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 10px;
}
</style>
