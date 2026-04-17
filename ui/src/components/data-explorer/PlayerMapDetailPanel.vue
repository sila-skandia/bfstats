<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { fetchMapPlayerRankings, type MapPlayerRanking, type MapRankingSortBy } from '../../services/dataExplorerService';
import { getRankClass } from '@/utils/statsUtils';

const props = defineProps<{
  mapName: string;
  playerName: string;
  game?: string;
}>();

const emit = defineEmits<{
  close: [];
  navigateToServer: [serverGuid: string];
}>();

const router = useRouter();

// Types
interface PlayerMapStats {
  totalScore: number;
  totalKills: number;
  totalDeaths: number;
  totalRounds: number;
  playTimeMinutes: number;
}

interface ServerStats {
  serverGuid: string;
  serverName: string;
  score: number;
  kills: number;
  deaths: number;
  rounds: number;
  playTime: number;
}

// State
const isLoading = ref(true);
const error = ref<string | null>(null);
const playerStats = ref<PlayerMapStats | null>(null);
const serverStats = ref<ServerStats[]>([]);
const rankings = ref<MapPlayerRanking[]>([]);
const playerRanking = ref<MapPlayerRanking | null>(null);
const totalRankedPlayers = ref(0);
const isRankingsLoading = ref(false);

// Ranking tabs
const rankingTabs = [
  { id: 'score' as const, label: 'By Score' },
  { id: 'kills' as const, label: 'By Kills' },
  { id: 'kdRatio' as const, label: 'By K/D' },
  { id: 'killRate' as const, label: 'By Kill Rate' }
];

const activeRankingTab = ref<MapRankingSortBy>('score');
const selectedServerGuid = ref<string>('');
const currentPage = ref(1);
const pageSize = 20;
const totalPages = ref(1);
const selectedMinRounds = ref(3);
const minRoundsOptions = [3, 5, 10, 20, 50];

// Computed
const kdRatio = computed(() => {
  if (!playerStats.value) return '0.00';
  return (playerStats.value.totalKills / Math.max(1, playerStats.value.totalDeaths)).toFixed(2);
});

const serverOptions = computed(() => {
  return serverStats.value.map(s => ({
    guid: s.serverGuid,
    name: s.serverName
  }));
});

// Methods
const loadData = async () => {
  isLoading.value = true;
  error.value = null;

  try {
    const response = await fetch(
      `/stats/players/${encodeURIComponent(props.playerName)}/map-stats?game=${props.game || 'bf1942'}&days=365`
    );

    if (!response.ok) throw new Error('Failed to load player map statistics');
    const mapsList = await response.json();
    const mapData = mapsList.find((m: any) => m.mapName.toLowerCase() === props.mapName.toLowerCase());

    if (mapData) {
      playerStats.value = {
        totalScore: mapData.totalScore,
        totalKills: mapData.totalKills,
        totalDeaths: mapData.totalDeaths,
        totalRounds: mapData.sessionsPlayed,
        playTimeMinutes: mapData.totalPlayTimeMinutes
      };
    }

    await loadRankings();
  } catch (err: any) {
    console.error('Error loading player map data:', err);
    error.value = err.message || 'Failed to load data';
  } finally {
    isLoading.value = false;
  }
};

const loadRankings = async () => {
  isRankingsLoading.value = true;
  try {
    const response = await fetchMapPlayerRankings(
      props.mapName,
      props.game as any || 'bf1942',
      currentPage.value,
      pageSize,
      undefined,
      selectedServerGuid.value || undefined,
      60,
      activeRankingTab.value,
      selectedMinRounds.value
    );

    rankings.value = response.rankings;
    totalPages.value = Math.ceil(response.totalCount / pageSize);
    totalCount.value = response.totalCount;
  } catch (err) {
    console.error('Error loading rankings:', err);
  } finally {
    isRankingsLoading.value = false;
  }
};

const totalCount = ref(0);

const formatMetricValue = (player: MapPlayerRanking): string => {
  switch (activeRankingTab.value) {
    case 'score': return player.totalScore.toLocaleString();
    case 'kills': return player.totalKills.toLocaleString();
    case 'kdRatio': return player.kdRatio.toFixed(2);
    case 'killRate': return player.killsPerMinute.toFixed(2);
    default: return '0';
  }
};

const getMetricLabel = (): string => {
  switch (activeRankingTab.value) {
    case 'score': return 'Score';
    case 'kills': return 'Kills';
    case 'kdRatio': return 'K/D Ratio';
    case 'killRate': return 'KPM';
    default: return 'Value';
  }
};

const formatPlayTime = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${Math.floor(minutes % 60)}m`;
  return `${Math.floor(minutes)}m`;
};

onMounted(() => loadData());
watch([activeRankingTab, selectedServerGuid], () => { currentPage.value = 1; loadRankings(); });
</script>

<template>
  <div class="flex flex-col h-full bg-[#05050a] p-4 sm:p-8 overflow-y-auto custom-scrollbar">
    <!-- Status States -->
    <div v-if="isLoading" class="flex-1 flex flex-col items-center justify-center opacity-50">
      <div class="w-10 h-10 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mb-4" />
      <div class="font-mono text-[9px] text-cyan-400 uppercase tracking-[0.3em]">Decoding_Map_Telemetry...</div>
    </div>

    <div v-else-if="error" class="flex-1 flex flex-col items-center justify-center text-center">
      <div class="text-3xl mb-4">🚫</div>
      <p class="text-red-400 font-mono text-xs uppercase tracking-widest mb-6">{{ error }}</p>
      <button @click="loadData" class="px-6 py-2 bg-white/5 border border-white/10 text-white text-[10px] font-mono font-black uppercase tracking-widest hover:bg-white/10 transition-all">Retry_Link</button>
    </div>

    <!-- Main Content -->
    <div v-else class="space-y-10">
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
              <span class="px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/30 text-[9px] font-mono text-cyan-400 uppercase tracking-widest tracking-[0.2em]">Map_Directive</span>
              <span class="text-[10px] text-slate-500 font-mono uppercase tracking-widest">{{ playerName }}</span>
            </div>
            <h2 class="text-3xl md:text-4xl font-black text-white uppercase italic tracking-tighter">{{ mapName }}</h2>
          </div>
        </div>
      </div>

      <!-- Performance Grid -->
      <section class="space-y-4">
        <div class="flex items-center gap-4">
           <div class="w-1 h-3 bg-cyan-500 shadow-[0_0_8px_rgba(0,229,255,0.4)]" />
           <h3 class="text-[10px] font-mono font-black text-white uppercase tracking-[0.3em]">Operative_Summary</h3>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div v-for="stat in [
            { label: 'Net_Score', val: playerStats?.totalScore.toLocaleString(), color: 'text-cyan-400' },
            { label: 'Confirmed_Kills', val: playerStats?.totalKills.toLocaleString(), color: 'text-emerald-400' },
            { label: 'Defeats', val: playerStats?.totalDeaths.toLocaleString(), color: 'text-red-400' },
            { label: 'Efficiency_Rate', val: kdRatio, color: 'text-neon-gold' }
          ]" :key="stat.label" class="bg-black/40 border border-white/5 p-5 rounded-xl hover:bg-white/[0.02] transition-all">
            <div class="text-[8px] font-mono text-slate-500 uppercase tracking-widest mb-1">{{ stat.label }}</div>
            <div class="text-2xl font-black font-mono leading-none" :class="stat.color">{{ stat.val || '0' }}</div>
          </div>
        </div>
      </section>

      <!-- Engagement Ladder -->
      <section class="space-y-6">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div class="flex items-center gap-4">
            <div class="w-1 h-3 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
            <h3 class="text-[10px] font-mono font-black text-white uppercase tracking-[0.3em]">Sector_Standings</h3>
          </div>
          
          <div class="flex flex-wrap gap-2">
            <div class="flex bg-black/40 p-0.5 border border-white/5 rounded">
              <button
                v-for="rounds in minRoundsOptions" :key="rounds"
                class="px-2 py-1 text-[8px] font-mono font-black transition-all"
                :class="selectedMinRounds === rounds ? 'bg-cyan-500 text-black shadow-[0_0_10px_rgba(0,229,255,0.3)]' : 'text-slate-500 hover:text-slate-300'"
                @click="selectedMinRounds = rounds; loadRankings()"
              >
                {{ rounds }}+
              </button>
            </div>
            <select v-if="serverOptions.length > 1" v-model="selectedServerGuid" @change="loadRankings" class="bg-black/40 border border-white/10 rounded px-3 py-1 text-[9px] font-mono text-cyan-400 focus:outline-none focus:border-cyan-500/50">
              <option value="">ALL_NODES</option>
              <option v-for="s in serverOptions" :key="s.guid" :value="s.guid">{{ s.name }}</option>
            </select>
          </div>
        </div>

        <div class="flex bg-white/5 p-1 rounded-lg border border-white/5">
          <button
            v-for="tab in rankingTabs" :key="tab.id"
            class="flex-1 py-1.5 text-[8px] font-mono font-black uppercase tracking-widest transition-all rounded"
            :class="activeRankingTab === tab.id ? 'bg-white text-black' : 'text-slate-500 hover:text-slate-300'"
            @click="activeRankingTab = tab.id; loadRankings()"
          >
            {{ tab.label }}
          </button>
        </div>

        <div class="relative min-h-[300px] border border-white/5 rounded-xl overflow-hidden bg-black/20">
          <div v-if="isRankingsLoading" class="absolute inset-0 z-10 flex items-center justify-center bg-[#05050a]/40 backdrop-blur-sm">
            <div class="w-6 h-6 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin" />
          </div>

          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="bg-white/5 border-b border-white/10 font-mono text-[8px] text-slate-500 uppercase tracking-widest">
                <th class="p-3 w-10 text-center">#</th>
                <th class="p-3">Operative</th>
                <th class="p-3 text-right">{{ getMetricLabel() }}</th>
                <th class="p-3 text-right">Rnds</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/5 font-mono">
              <tr v-for="p in rankings" :key="p.playerName" class="group hover:bg-white/[0.03] transition-colors" :class="{ 'bg-cyan-500/10': p.playerName === playerName }">
                <td class="p-3">
                  <div class="w-6 h-6 mx-auto flex items-center justify-center rounded border text-[9px] font-black shadow-[inset_0_0_5px_rgba(0,0,0,0.5)]" :class="[getRankClass(p.rank), 'border-current/20']">
                    {{ p.rank }}
                  </div>
                </td>
                <td class="p-3">
                   <router-link :to="`/players/${encodeURIComponent(p.playerName)}`" class="text-xs font-bold text-white uppercase group-hover:text-cyan-400 transition-colors">
                     {{ p.playerName }}
                   </router-link>
                </td>
                <td class="p-3 text-right">
                  <span class="text-xs font-black text-cyan-400">{{ formatMetricValue(p) }}</span>
                </td>
                <td class="p-3 text-right text-[10px] text-slate-500">
                  {{ p.totalRounds }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div v-if="totalPages > 1" class="flex items-center justify-center gap-4 pt-4 border-t border-white/5">
          <button @click="currentPage--; loadRankings()" :disabled="currentPage === 1" class="text-slate-500 hover:text-white disabled:opacity-20">&larr;</button>
          <span class="text-[10px] font-mono text-slate-500">PAGE {{ currentPage }} / {{ totalPages }}</span>
          <button @click="currentPage++; loadRankings()" :disabled="currentPage === totalPages" class="text-slate-500 hover:text-white disabled:opacity-20">&rarr;</button>
        </div>
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
