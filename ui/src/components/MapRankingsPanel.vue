<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { fetchMapPlayerRankings, type MapPlayerRanking, type GameType, type MapRankingSortBy } from '../services/dataExplorerService';
import { getRankClass } from '@/utils/statsUtils';

const props = defineProps<{
  mapName: string;
  game?: GameType;
  serverGuid?: string;
  highlightPlayer?: string;
  days?: number;
}>();

const router = useRouter();

// Tab configuration
const tabs = [
  { id: 'score' as const, label: 'Score', title: 'Top by Score' },
  { id: 'kills' as const, label: 'Kills', title: 'Top by Kills' },
  { id: 'wins' as const, label: 'Wins', title: 'Top by Wins' },
  { id: 'kdRatio' as const, label: 'K/D', title: 'Top by K/D Ratio' },
  { id: 'killRate' as const, label: 'Kill Rate', title: 'Top by Kill Rate' },
];

const activeTab = ref<MapRankingSortBy>('score');
const searchQuery = ref('');
const debouncedSearch = ref('');
let searchTimeout: number | null = null;

const pageSize = 15;
const rankings = ref<MapPlayerRanking[]>([]);
const isLoading = ref(false);
const isRefreshing = ref(false);
const error = ref<string | null>(null);
const currentPage = ref(1);
const totalPages = ref(0);
const totalCount = ref(0);

const selectedDays = ref(props.days || 60);
const selectedMinRounds = ref(3);
const minRoundsOptions = [3, 5, 10, 20, 50];

const handleMinRoundsChange = (rounds: number) => {
  if (rounds === selectedMinRounds.value || isRefreshing.value) return;
  selectedMinRounds.value = rounds;
  currentPage.value = 1;
  loadRankings();
};

const loadRankings = async () => {
  if (!props.mapName) return;

  if (rankings.value.length === 0) {
    isLoading.value = true;
  } else {
    isRefreshing.value = true;
  }
  error.value = null;

  try {
    const response = await fetchMapPlayerRankings(
      props.mapName,
      props.game || 'bf1942',
      currentPage.value,
      pageSize,
      debouncedSearch.value || undefined,
      props.serverGuid,
      selectedDays.value,
      activeTab.value,
      selectedMinRounds.value
    );

    rankings.value = response.rankings;
    totalPages.value = Math.ceil(response.totalCount / pageSize);
    totalCount.value = response.totalCount;
  } catch (err) {
    console.error('Error loading rankings:', err);
    error.value = 'Failed to load rankings';
  } finally {
    isLoading.value = false;
    isRefreshing.value = false;
  }
};

const handleDaysChange = (days: number) => {
  if (days === selectedDays.value || isRefreshing.value) return;
  selectedDays.value = days;
  currentPage.value = 1;
  loadRankings();
};

const selectTab = (tabId: MapRankingSortBy) => {
  if (tabId === activeTab.value || isRefreshing.value) return;
  activeTab.value = tabId;
  currentPage.value = 1;
  loadRankings();
};

const goToPage = (page: number) => {
  if (page < 1 || page > totalPages.value || isRefreshing.value) return;
  currentPage.value = page;
  loadRankings();
};

const handleSearchInput = () => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    debouncedSearch.value = searchQuery.value;
    currentPage.value = 1;
    loadRankings();
  }, 300) as unknown as number;
};

const navigateToPlayer = (playerName: string) => {
  router.push({ name: 'player-details', params: { playerName } });
};

const primaryColumnHeader = computed(() => {
  switch (activeTab.value) {
    case 'score': return 'Score';
    case 'kills': return 'Kills';
    case 'wins': return 'Wins';
    case 'kdRatio': return 'K/D';
    case 'killRate': return 'Kills/Min';
    default: return 'Score';
  }
});

const formatPrimaryValue = (entry: MapPlayerRanking): string => {
  switch (activeTab.value) {
    case 'score': return entry.totalScore.toLocaleString();
    case 'kills': return entry.totalKills.toLocaleString();
    case 'wins': return (entry.totalWins || 0).toLocaleString();
    case 'kdRatio': return entry.kdRatio.toFixed(2);
    case 'killRate': return entry.killsPerMinute.toFixed(3);
    default: return entry.totalScore.toLocaleString();
  }
};

const isHighlighted = (playerName: string): boolean => {
  return !!props.highlightPlayer && playerName.toLowerCase() === props.highlightPlayer.toLowerCase();
};

const paginationRange = computed(() => {
  const range: number[] = [];
  const maxVisible = 5;
  let start = Math.max(1, currentPage.value - Math.floor(maxVisible / 2));
  const end = Math.min(totalPages.value, start + maxVisible - 1);
  if (end === totalPages.value) start = Math.max(1, end - maxVisible + 1);
  for (let i = start; i <= end; i++) range.push(i);
  return range;
});

onMounted(() => {
  loadRankings();
});

watch(() => props.mapName, () => {
  currentPage.value = 1;
  searchQuery.value = '';
  debouncedSearch.value = '';
  rankings.value = [];
  loadRankings();
});

watch(() => props.serverGuid, () => {
  currentPage.value = 1;
  rankings.value = [];
  loadRankings();
});

watch(() => props.days, (newDays) => {
  if (newDays) {
    selectedDays.value = newDays;
    currentPage.value = 1;
    loadRankings();
  }
});
</script>

<template>
  <div class="p-6 bg-[#05050a] flex flex-col gap-6">
    <!-- Search & Control Cluster -->
    <div class="flex flex-col gap-6 border-b border-white/5 pb-6">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div class="flex items-center gap-4">
          <div class="w-1 h-5 bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
          <h3 class="text-lg font-black text-white uppercase italic tracking-tighter">
            Global Engagement Ladder
          </h3>
          <span
            v-if="totalCount > 0"
            class="px-2 py-0.5 bg-white/5 border border-white/10 rounded text-[9px] font-mono text-slate-500 uppercase tracking-widest"
          >{{ totalCount.toLocaleString() }} Operatives</span>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <!-- Min Rounds Filter -->
          <div class="flex bg-black/40 p-0.5 border border-white/5 rounded">
            <div class="px-2 py-1 text-[8px] font-mono text-slate-600 uppercase flex items-center">
              Engagements
            </div>
            <button
              v-for="rounds in minRoundsOptions"
              :key="rounds"
              class="px-2.5 py-1 text-[9px] font-mono font-black transition-all"
              :class="selectedMinRounds === rounds
                ? 'bg-cyan-500 text-black shadow-[0_0_10px_rgba(0,229,255,0.3)]'
                : 'text-slate-500 hover:text-slate-300'"
              @click="handleMinRoundsChange(rounds)"
            >
              {{ rounds }}+
            </button>
          </div>

          <!-- Period Selector -->
          <div class="flex bg-black/40 p-0.5 border border-white/5 rounded">
            <button
              v-for="days in [30, 60, 90, 365]"
              :key="days"
              class="px-2.5 py-1 text-[9px] font-mono font-black transition-all uppercase"
              :class="selectedDays === days
                ? 'bg-emerald-500 text-black shadow-[0_0_10px_rgba(16,185,129,0.3)]'
                : 'text-slate-500 hover:text-slate-300'"
              @click="handleDaysChange(days)"
            >
              {{ days === 365 ? '1Y' : `${days}D` }}
            </button>
          </div>
        </div>
      </div>

      <!-- Search Input -->
      <div class="relative group">
        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <svg
            class="w-4 h-4 text-slate-600 group-focus-within:text-cyan-400 transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          ><path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          /></svg>
        </div>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="SEARCH_OPERATIVE_ID..."
          class="w-full bg-black/40 border border-white/5 focus:border-cyan-500/50 rounded-lg pl-10 pr-4 py-2.5 text-xs font-mono text-cyan-400 placeholder:text-slate-800 transition-all focus:bg-cyan-500/[0.02]"
          @input="handleSearchInput"
        >
      </div>
    </div>

    <!-- Metric Tabs -->
    <div class="flex bg-white/5 p-1 rounded-lg border border-white/5">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :disabled="isRefreshing"
        class="flex-1 py-2 text-[9px] font-mono font-black uppercase tracking-widest transition-all rounded"
        :class="activeTab === tab.id
          ? 'bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.2)]'
          : 'text-slate-500 hover:text-slate-300'"
        @click="selectTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Data State Rendering -->
    <div class="flex-1 relative min-h-[400px]">
      <!-- Loading Overlay -->
      <div
        v-if="isLoading || isRefreshing"
        class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#05050a]/60 backdrop-blur-sm transition-opacity"
      >
        <div class="w-8 h-8 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mb-3" />
        <span class="text-[9px] font-mono text-cyan-400 uppercase tracking-[0.3em] animate-pulse">Syncing_Telemetry...</span>
      </div>

      <!-- Error State -->
      <div
        v-if="error"
        class="flex flex-col items-center justify-center py-20 text-center"
      >
        <div class="text-4xl mb-4">
          ⚠️
        </div>
        <p class="text-sm font-mono text-red-400 uppercase tracking-widest mb-6">
          {{ error }}
        </p>
        <button
          class="px-6 py-2 bg-red-500/10 border border-red-500/50 text-red-400 text-[10px] font-mono font-black uppercase tracking-widest hover:bg-red-500/20 transition-all"
          @click="loadRankings"
        >
          Retransmit_Query
        </button>
      </div>

      <!-- Table View -->
      <div
        v-else-if="rankings.length > 0"
        class="overflow-hidden border border-white/5 rounded-xl bg-black/20"
      >
        <div class="overflow-x-auto custom-scrollbar">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="bg-white/5 border-b border-white/10 font-mono text-[9px] text-slate-500 uppercase tracking-[0.2em]">
                <th class="p-3 w-12 text-center">
                  #
                </th>
                <th class="p-3">
                  Operative
                </th>
                <th class="p-3 text-right">
                  {{ primaryColumnHeader }}
                </th>
                <th class="p-3 text-right">
                  Efficiency
                </th>
                <th class="p-3 text-right">
                  Engagements
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/5 font-mono">
              <tr
                v-for="entry in rankings"
                :key="entry.playerName"
                class="group transition-all cursor-pointer"
                :class="isHighlighted(entry.playerName) ? 'bg-cyan-500/10' : 'hover:bg-white/[0.03]'"
                @click="navigateToPlayer(entry.playerName)"
              >
                <td class="p-3">
                  <div
                    class="w-7 h-7 flex items-center justify-center rounded border text-[10px] font-black"
                    :class="[getRankClass(entry.rank), 'border-current/20 shadow-[inset_0_0_8px_rgba(0,0,0,0.5)]']"
                  >
                    {{ entry.rank }}
                  </div>
                </td>
                <td class="p-3">
                  <div class="flex items-center gap-2">
                    <div
                      v-if="isHighlighted(entry.playerName)"
                      class="w-1 h-3 bg-cyan-400 animate-pulse"
                    />
                    <span
                      class="text-xs font-bold text-white uppercase group-hover:text-cyan-400 transition-colors"
                      :class="{ 'text-cyan-400': isHighlighted(entry.playerName) }"
                    >{{ entry.playerName }}</span>
                  </div>
                </td>
                <td class="p-3 text-right">
                  <span class="text-xs font-black text-cyan-400">{{ formatPrimaryValue(entry) }}</span>
                </td>
                <td class="p-3 text-right">
                  <span class="text-xs font-bold text-emerald-500">{{ entry.kdRatio.toFixed(2) }}</span>
                </td>
                <td class="p-3 text-right text-slate-500 text-xs">
                  {{ entry.totalRounds }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-else
        class="flex flex-col items-center justify-center py-20 text-center opacity-30"
      >
        <div class="text-5xl mb-6">
          ∅
        </div>
        <p class="text-xs font-mono text-slate-400 uppercase tracking-[0.4em]">
          Zero_Data_Points_Detected
        </p>
      </div>
    </div>

    <!-- Pagination -->
    <div
      v-if="totalPages > 1"
      class="flex items-center justify-center gap-2 pt-6 mt-auto border-t border-white/5"
    >
      <button
        class="w-8 h-8 flex items-center justify-center rounded border border-white/5 text-slate-500 hover:border-cyan-500/50 hover:text-cyan-400 transition-all disabled:opacity-20"
        :disabled="currentPage === 1 || isRefreshing"
        @click="goToPage(currentPage - 1)"
      >
        <svg
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        ><path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M15 19l-7-7 7-7"
        /></svg>
      </button>
      
      <div class="flex items-center gap-1">
        <button
          v-for="pageNum in paginationRange"
          :key="pageNum"
          class="w-8 h-8 text-[10px] font-mono font-black transition-all rounded border"
          :class="pageNum === currentPage
            ? 'bg-white text-black border-white shadow-[0_0_10px_rgba(255,255,255,0.3)]'
            : 'border-white/5 text-slate-500 hover:border-white/20 hover:text-white'"
          @click="goToPage(pageNum)"
        >
          {{ pageNum }}
        </button>
      </div>

      <button
        class="w-8 h-8 flex items-center justify-center rounded border border-white/5 text-slate-500 hover:border-cyan-500/50 hover:text-cyan-400 transition-all disabled:opacity-20"
        :disabled="currentPage === totalPages || isRefreshing"
        @click="goToPage(currentPage + 1)"
      >
        <svg
          class="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        ><path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 5l7 7-7 7"
        /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.font-mono {
  font-family: 'JetBrains Mono', monospace;
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
