<template>
  <div class="competitive-rankings">
    <!-- Loading State -->
    <div
      v-if="isLoading"
      class="flex flex-col gap-4"
    >
      <div
        class="explorer-skeleton"
        style="height: 2.5rem"
      />
      <div
        class="explorer-skeleton"
        style="height: 10rem"
      />
      <div
        class="explorer-skeleton"
        style="height: 15rem"
      />
    </div>

    <!-- Content -->
    <div v-else-if="rankingsData">
      <!-- Integrated Toolbar -->
      <div class="explorer-header-integrated mb-4">
        <div class="explorer-header-main">
          <!-- Left side: Tabs -->
          <div class="explorer-toggle-group">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="explorer-toggle-btn explorer-toggle-btn--compact"
              :class="{ 'explorer-toggle-btn--active': activeTab === tab.id }"
              @click="activeTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>

          <div class="explorer-header-actions">
            <!-- View Mode Toggle (only for Performance tab) -->
            <div
              v-if="activeTab === 'current'"
              class="explorer-toggle-group"
            >
              <button 
                class="explorer-toggle-btn explorer-toggle-btn--compact"
                :class="{ 'explorer-toggle-btn--active': viewMode === 'chart' }"
                @click="viewMode = 'chart'"
              >
                CHART
              </button>
              <button 
                class="explorer-toggle-btn explorer-toggle-btn--compact"
                :class="{ 'explorer-toggle-btn--active': viewMode === 'list' }"
                @click="viewMode = 'list'"
              >
                LIST
              </button>
            </div>

            <!-- Time Period Selection -->
            <div class="flex items-center gap-2">
              <div class="explorer-toggle-group">
                <button
                  class="explorer-toggle-btn explorer-toggle-btn--compact"
                  :class="{ 'explorer-toggle-btn--active': timePeriod === 'last-month' }"
                  @click="selectTimePeriod('last-month')"
                >
                  30D
                </button>
                <button
                  class="explorer-toggle-btn explorer-toggle-btn--compact"
                  :class="{ 'explorer-toggle-btn--active': timePeriod === 'all-time' }"
                  @click="selectTimePeriod('all-time')"
                >
                  ALL
                </button>
              </div>

              <div class="flex items-center gap-1">
                <select
                  v-model.number="selectedYear"
                  class="explorer-select explorer-select--compact explorer-mono text-[10px]"
                  @change="onDateChange"
                >
                  <option
                    v-for="year in availableYears"
                    :key="year"
                    :value="year"
                  >
                    {{ year }}
                  </option>
                </select>
                <select
                  v-model.number="selectedMonth"
                  class="explorer-select explorer-select--compact explorer-mono text-[10px]"
                  @change="onDateChange"
                >
                  <option
                    v-for="month in availableMonths"
                    :key="month.value"
                    :value="month.value"
                    :disabled="month.disabled"
                  >
                    {{ month.label.substring(0, 3) }}
                  </option>
                </select>
                <button
                  class="explorer-btn explorer-btn--ghost explorer-btn--sm !py-1 !px-2 text-[10px]"
                  @click="loadRankingsForPeriod"
                >
                  VIEW
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Error State (shown inline with controls) -->
      <div
        v-if="error"
        class="mb-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg"
      >
        <div class="flex items-center gap-3">
          <div class="text-red-400 text-lg">
            !
          </div>
          <div>
            <p class="text-red-400 font-medium">
              {{ error }}
            </p>
            <button
              class="text-red-400 text-sm underline mt-1 hover:text-red-300"
              @click="loadData()"
            >
              Try again
            </button>
          </div>
        </div>
      </div>

      <!-- Performance Tab -->
      <div
        v-if="!error && activeTab === 'current'"
        class="space-y-0"
      >
        <!-- Chart view -->
        <div v-if="viewMode === 'chart'">
          <PlayerCompetitiveRankingsChart
            :rankings="rankingsData.mapRankings"
            :sort-by="'kdRatio'"
            @navigate-to-map="navigateToMapRankings"
          />
        </div>

        <!-- List view -->
        <div
          v-else
          class="explorer-table-wrapper"
        >
          <div 
            v-for="ranking in paginatedRankings"
            :key="ranking.mapName"
            class="ranking-item-compact"
            @click="navigateToMapRankings(ranking.mapName)"
          >
            <div class="ranking-position-compact">
              <div
                class="ranking-badge-compact"
                :class="getRankBadgeClass(ranking.rank)"
              >
                <span v-if="ranking.rank === 1">🥇</span>
                <span v-else-if="ranking.rank === 2">🥈</span>
                <span v-else-if="ranking.rank === 3">🥉</span>
                <span v-else>{{ ranking.rank }}</span>
              </div>
            </div>

            <div class="ranking-details-compact">
              <div class="flex items-center gap-2">
                <div class="ranking-map-compact">
                  {{ ranking.mapName }}
                </div>
                <div
                  class="ranking-trend-compact"
                  :class="getTrendClass(ranking.trend)"
                >
                  <span v-if="ranking.trend === 'up'">↑</span>
                  <span v-else-if="ranking.trend === 'down'">↓</span>
                  <span v-else-if="ranking.trend === 'stable'">→</span>
                  <span v-else>★</span>
                  <span
                    v-if="ranking.previousRank"
                    class="text-[9px] ml-0.5 opacity-70"
                  >{{ Math.abs(ranking.rank - ranking.previousRank) }}</span>
                </div>
              </div>
              <div class="ranking-stats-compact">
                <span class="ranking-stat-compact">
                  <span class="opacity-50">SCORE:</span>
                  <span class="font-bold">{{ ranking.totalScore.toLocaleString() }}</span>
                </span>
                <span class="ranking-stat-compact">
                  <span class="opacity-50">K/D:</span>
                  <span
                    class="font-bold"
                    :class="ranking.kdRatio >= 1 ? 'text-neon-green' : 'text-neon-red'"
                  >{{ ranking.kdRatio.toFixed(2) }}</span>
                </span>
                <span class="ranking-stat-compact">
                  <span class="opacity-50">TIME:</span>
                  <span class="font-bold">{{ formatPlayTime(ranking.playTimeMinutes) }}</span>
                </span>
              </div>
            </div>

            <div class="ranking-percentile-compact">
              <div
                class="percentile-badge-compact"
                :class="getPercentileClass(ranking.percentile)"
              >
                TOP {{ (100 - ranking.percentile).toFixed(1) }}%
              </div>
              <div class="text-[9px] opacity-50 font-mono mt-0.5 text-right">
                {{ ranking.totalPlayers }} PLRS
              </div>
            </div>
          </div>

          <!-- Empty state for no rankings -->
          <div
            v-if="rankingsData.mapRankings.length === 0"
            class="explorer-empty"
          >
            <p class="text-neutral-500">
              No competitive rankings available for this time period.
            </p>
          </div>
        </div>

        <!-- Pagination Controls (only for list view) -->
        <div
          v-if="viewMode === 'list' && totalPages > 1"
          class="pagination-controls-compact"
        >
          <button
            class="pagination-btn-compact"
            :disabled="currentPage === 1"
            @click="goToPage(currentPage - 1)"
          >
            &larr;
          </button>
          
          <button
            v-for="pageNum in paginationRange"
            :key="pageNum"
            class="pagination-btn-compact"
            :class="{ 'pagination-btn-compact--active': pageNum === currentPage }"
            @click="goToPage(pageNum)"
          >
            {{ pageNum }}
          </button>
          
          <button
            class="pagination-btn-compact"
            :disabled="currentPage === totalPages"
            @click="goToPage(currentPage + 1)"
          >
            &rarr;
          </button>
        </div>
      </div>

      <!-- Timeline Tab -->
      <div
        v-else-if="!error && activeTab === 'timeline'"
        class="timeline-content"
      >
        <!-- Map Selector and controls Integrated -->
        <div class="flex items-center justify-between mb-4">
          <select 
            v-model="selectedTimelineMap" 
            class="explorer-select explorer-select--compact explorer-mono text-xs"
            @change="loadTimeline"
          >
            <option value="">
              All Maps (Average)
            </option>
            <option
              v-for="map in availableMaps"
              :key="map"
              :value="map"
            >
              {{ map }}
            </option>
          </select>
          <div class="text-[10px] explorer-mono opacity-50 uppercase">
            Historical Trend (12 Months)
          </div>
        </div>

        <!-- Timeline Chart -->
        <div
          v-if="timelineData && timelineData.timeline.length > 0"
          class="timeline-chart-container"
        >
          <div class="timeline-chart">
            <canvas ref="timelineCanvas" />
          </div>
        </div>

        <!-- Loading state for timeline -->
        <div
          v-else-if="isTimelineLoading"
          class="flex justify-center py-8"
        >
          <div class="explorer-spinner" />
        </div>

        <!-- No timeline data -->
        <div
          v-else
          class="explorer-empty"
        >
          <p class="text-neutral-500">
            No historical ranking data available.
          </p>
        </div>
      </div>
    </div>

    <!-- No Data State -->
    <div
      v-else
      class="explorer-empty"
    >
      <div class="explorer-empty-icon">
        📊
      </div>
      <p class="explorer-empty-title">
        NO RANKING DATA
      </p>
      <p class="explorer-empty-desc">
        Play more matches to establish your competitive rankings.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, nextTick, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import Chart from 'chart.js/auto';
import type { ChartConfiguration } from 'chart.js';
import PlayerCompetitiveRankingsChart from './PlayerCompetitiveRankingsChart.vue';

const props = defineProps<{
  playerName: string;
  game?: string;
}>();

const emit = defineEmits<{
  navigateToMap: [mapName: string];
}>();

const router = useRouter();

// Types
interface MapRanking {
  mapName: string;
  rank: number;
  totalPlayers: number;
  percentile: number;
  totalScore: number;
  totalKills: number;
  totalDeaths: number;
  kdRatio: number;
  totalRounds: number;
  playTimeMinutes: number;
  trend: 'up' | 'down' | 'stable' | 'new';
  previousRank?: number;
}

interface RankingSummary {
  totalMapsPlayed: number;
  top1Rankings: number;
  top10Rankings: number;
  top25Rankings: number;
  top100Rankings: number;
  averagePercentile: number;
  bestRankedMap?: string;
  bestRank?: number;
  percentileCategory: 'elite' | 'master' | 'expert' | 'veteran' | 'regular';
}

interface CompetitiveRankingsResponse {
  playerName: string;
  game: string;
  mapRankings: MapRanking[];
  summary: RankingSummary;
  dateRange: {
    days: number;
    fromDate: string;
    toDate: string;
  };
}

interface TimelineSnapshot {
  year: number;
  month: number;
  monthLabel: string;
  rank: number;
  totalPlayers: number;
  percentile: number;
  totalScore: number;
  kdRatio: number;
  hasData: boolean;
}

interface RankingTimelineResponse {
  playerName: string;
  mapName?: string;
  game: string;
  timeline: TimelineSnapshot[];
}

// State
const tabs = [
  { id: 'current', label: 'PERFORMANCE' },
  { id: 'timeline', label: 'RANK TIMELINE' }
];

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const activeTab = ref<'current' | 'timeline'>('current' as 'current' | 'timeline');
const viewMode = ref<'chart' | 'list'>('chart' as 'chart' | 'list'); // Default to chart view
const rankingsData = ref<CompetitiveRankingsResponse | null>(null);
const timelineData = ref<RankingTimelineResponse | null>(null);
const isLoading = ref(false);
const isTimelineLoading = ref(false);
const error = ref<string | null>(null);
const selectedTimelineMap = ref('');
const timelineCanvas = ref<HTMLCanvasElement | null>(null);
let timelineChart: Chart | null = null;

// Time period state
const timePeriod = ref<'last-month' | 'all-time' | 'custom'>('last-month');
const selectedYear = ref(new Date().getFullYear());
const selectedMonth = ref(new Date().getMonth() + 1);

// Pagination state
const currentPage = ref(1);
const itemsPerPage = 10;

// Computed
const sortedRankings = computed(() => {
  if (!rankingsData.value) return [];
  return [...rankingsData.value.mapRankings].sort((a, b) => a.rank - b.rank);
});

const availableMaps = computed(() => {
  if (!rankingsData.value) return [];
  return rankingsData.value.mapRankings.map(r => r.mapName).sort();
});

const DATA_START_YEAR = 2025;
const DATA_START_MONTH = 6; // June 2025

const availableYears = computed(() => {
  const currentYear = new Date().getFullYear();
  const years = [];
  for (let i = DATA_START_YEAR; i <= currentYear; i++) {
    years.push(i);
  }
  return years;
});

const availableMonths = computed(() => {
  return monthNames.map((name, idx) => ({
    value: idx + 1,
    label: name,
    disabled: selectedYear.value === DATA_START_YEAR && idx + 1 < DATA_START_MONTH
  }));
});

// Pagination computed properties
const totalPages = computed(() => {
  if (!sortedRankings.value.length) return 0;
  return Math.ceil(sortedRankings.value.length / itemsPerPage);
});

const paginatedRankings = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  return sortedRankings.value.slice(start, end);
});

const paginationRange = computed(() => {
  const range: number[] = [];
  const maxVisible = 5;
  let start = Math.max(1, currentPage.value - Math.floor(maxVisible / 2));
  const end = Math.min(totalPages.value, start + maxVisible - 1);
  if (end === totalPages.value) start = Math.max(1, end - maxVisible + 1);
  for (let i = start; i <= end; i++) range.push(i);
  return range;
});

// Methods
const selectTimePeriod = (period: 'last-month' | 'all-time') => {
  timePeriod.value = period;
  loadRankingsForPeriod();
};

const onDateChange = () => {
  timePeriod.value = 'custom';
  // Clamp month if before data start
  if (selectedYear.value === DATA_START_YEAR && selectedMonth.value < DATA_START_MONTH) {
    selectedMonth.value = DATA_START_MONTH;
  }
};

const loadRankingsForPeriod = async () => {
  isLoading.value = true;
  error.value = null;

  try {
    let url = `/stats/data-explorer/players/${encodeURIComponent(props.playerName)}/competitive-rankings?game=${props.game || 'bf1942'}`;

    if (timePeriod.value === 'last-month') {
      url += '&days=30';
    } else if (timePeriod.value === 'all-time') {
      url += '&days=999999'; // Effectively all-time
    } else if (timePeriod.value === 'custom') {
      // For custom, send year/month parameters
      url += `&year=${selectedYear.value}&month=${selectedMonth.value}`;
    }

    const response = await fetch(url);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('No ranking data found for this player');
      }
      throw new Error('Failed to load competitive rankings');
    }

    rankingsData.value = await response.json();
    currentPage.value = 1; // Reset to first page when data loads
  } catch (err: any) {
    console.error('Error loading competitive rankings:', err);
    error.value = err.message || 'Failed to load rankings';
  } finally {
    isLoading.value = false;
  }
};

const loadData = async () => {
  await loadRankingsForPeriod();
};

const goToPage = (page: number) => {
  if (page < 1 || page > totalPages.value) return;
  currentPage.value = page;
};

const loadTimeline = async () => {
  isTimelineLoading.value = true;

  try {
    const params = new URLSearchParams({
      game: props.game || 'bf1942',
      months: '12'
    });
    
    if (selectedTimelineMap.value) {
      params.append('mapName', selectedTimelineMap.value);
    }

    const response = await fetch(
      `/stats/data-explorer/players/${encodeURIComponent(props.playerName)}/ranking-timeline?${params}`
    );

    if (!response.ok) {
      throw new Error('Failed to load ranking timeline');
    }

    timelineData.value = await response.json();
    await nextTick();
    drawTimelineChart();
  } catch (err: any) {
    console.error('Error loading timeline:', err);
  } finally {
    isTimelineLoading.value = false;
  }
};

const drawTimelineChart = () => {
  if (!timelineCanvas.value || !timelineData.value) return;

  // Destroy existing chart
  if (timelineChart) {
    timelineChart.destroy();
  }

  const validData = timelineData.value.timeline.filter(t => t.hasData);
  if (validData.length === 0) return;

  const ctx = timelineCanvas.value.getContext('2d');
  if (!ctx) return;

  const isDarkMode = document.documentElement.classList.contains('dark-mode');

  const config: ChartConfiguration = {
    type: 'line',
    data: {
      labels: validData.map(t => t.monthLabel).reverse(),
      datasets: [
        {
          label: 'Rank',
          data: validData.map(t => t.rank).reverse(),
          borderColor: '#2196F3',
          backgroundColor: 'rgba(33, 150, 243, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: '#2196F3',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointHoverRadius: 6,
          yAxisID: 'y-rank'
        },
        {
          label: 'Percentile',
          data: validData.map(t => t.percentile).reverse(),
          borderColor: '#E91E63',
          backgroundColor: 'rgba(233, 30, 99, 0.1)',
          borderWidth: 2,
          fill: false,
          tension: 0.3,
          pointRadius: 3,
          pointBackgroundColor: '#E91E63',
          yAxisID: 'y-percentile'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          display: true,
          labels: {
            color: isDarkMode ? '#ffffff' : '#000000',
            font: { family: 'JetBrains Mono' }
          }
        },
        tooltip: {
          backgroundColor: isDarkMode ? 'rgba(35, 21, 53, 0.95)' : 'rgba(0, 0, 0, 0.9)',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: '#2196F3',
          borderWidth: 1,
          cornerRadius: 6,
          displayColors: true,
          callbacks: {
            afterLabel: (context) => {
              const dataIndex = context.dataIndex;
              const snapshot = validData[validData.length - 1 - dataIndex];
              return [
                `Score: ${snapshot.totalScore.toLocaleString()}`,
                `K/D: ${snapshot.kdRatio.toFixed(2)}`,
                `Players: ${snapshot.totalPlayers}`
              ];
            }
          }
        }
      },
      scales: {
        'y-rank': {
          type: 'linear',
          display: true,
          position: 'left',
          reverse: true, // Lower rank is better
          title: {
            display: true,
            text: 'Rank Position',
            color: isDarkMode ? '#ffffff' : '#000000',
            font: { family: 'JetBrains Mono' }
          },
          ticks: {
            color: isDarkMode ? '#ffffff' : '#000000',
            font: { family: 'JetBrains Mono' }
          },
          grid: {
            color: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
          }
        },
        'y-percentile': {
          type: 'linear',
          display: true,
          position: 'right',
          title: {
            display: true,
            text: 'Top %',
            color: isDarkMode ? '#ffffff' : '#000000',
            font: { family: 'JetBrains Mono' }
          },
          ticks: {
            color: isDarkMode ? '#ffffff' : '#000000',
            font: { family: 'JetBrains Mono' },
            callback: (value) => `${value}%`
          },
          grid: {
            display: false
          }
        },
        x: {
          ticks: {
            color: isDarkMode ? '#ffffff' : '#000000',
            font: { family: 'JetBrains Mono' }
          },
          grid: {
            color: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
          }
        }
      }
    }
  };

  timelineChart = new Chart(ctx, config);
};

// Helper functions
const formatPlayTime = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h` : `${Math.floor(minutes)}m`;
};

const navigateToMapRankings = (mapName: string) => {
  // Emit event to parent component instead of navigating
  emit('navigateToMap', mapName);
};

const getRankBadgeClass = (rank: number): string => {
  if (rank === 1) return 'rank-gold';
  if (rank === 2) return 'rank-silver';
  if (rank === 3) return 'rank-bronze';
  if (rank <= 10) return 'rank-top10';
  if (rank <= 25) return 'rank-top25';
  return '';
};

const getPercentileClass = (percentile: number): string => {
  if (percentile >= 99) return 'percentile-elite';
  if (percentile >= 95) return 'percentile-master';
  if (percentile >= 90) return 'percentile-expert';
  if (percentile >= 75) return 'percentile-veteran';
  return '';
};

const getTrendClass = (trend: string): string => {
  switch (trend) {
    case 'up': return 'trend-up';
    case 'down': return 'trend-down';
    case 'new': return 'trend-new';
    default: return 'trend-stable';
  }
};

// Lifecycle
onMounted(() => {
  loadData();
});

onUnmounted(() => {
  if (timelineChart) {
    timelineChart.destroy();
  }
});

watch(activeTab, (newTab) => {
  if (newTab === 'timeline' && !timelineData.value) {
    loadTimeline();
  } else if (newTab === 'current') {
    currentPage.value = 1; // Reset to first page when switching back to current rankings
  }
});

watch(() => props.playerName, () => {
  loadData();
  timelineData.value = null;
  selectedTimelineMap.value = '';
});
</script>

<style scoped>
/* ===== Integrated Data Dashboard Style ===== */
.competitive-rankings {
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-secondary);
}

/* --- Integrated Header & Toolbar --- */
.explorer-header-integrated {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0 0 1rem 0;
}

.explorer-header-main {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

@media (min-width: 1024px) {
  .explorer-header-main {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}

.explorer-header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

/* --- Toggle Groups (Tabs/Modes) --- */
.explorer-toggle-group {
  display: flex;
  background: rgba(13, 17, 23, 0.5);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.125rem;
}

.explorer-toggle-btn--compact {
  padding: 0.25rem 0.6rem;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  font-family: 'JetBrains Mono', monospace;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  text-transform: uppercase;
}

.explorer-toggle-btn--compact:hover:not(.explorer-toggle-btn--active) {
  color: var(--text-primary);
  background: rgba(245, 158, 11, 0.05);
}

.explorer-toggle-btn--active {
  background: var(--neon-cyan);
  color: var(--bg-dark);
  box-shadow: 0 0 10px rgba(245, 158, 11, 0.3);
}

/* --- Compact Selects & Buttons --- */
.explorer-select--compact {
  padding: 0.2rem 1.5rem 0.2rem 0.4rem;
  height: 1.75rem;
  font-size: 0.7rem;
  background: rgba(13, 17, 23, 0.5);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath fill='%23F59E0B' d='M6 8.825L1.175 4l1.414-1.415L6 6l3.411-3.415L10.825 4z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.4rem center;
  background-size: 10px;
}

.explorer-select--compact:focus {
  outline: none;
  border-color: var(--neon-cyan);
}

.explorer-btn {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.explorer-btn--ghost {
  background: transparent;
  color: var(--text-secondary);
  border-color: var(--border-color);
}

.explorer-btn--ghost:hover {
  color: var(--text-primary);
  border-color: var(--neon-cyan);
  background: rgba(245, 158, 11, 0.05);
}

/* --- Compact Ranking Items (List View) --- */
.explorer-table-wrapper {
  border-top: 1px solid var(--border-color);
}

.ranking-item-compact {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid rgba(48, 54, 61, 0.5);
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.ranking-item-compact:hover {
  background: rgba(245, 158, 11, 0.05);
  padding-left: 0.9rem;
}

.ranking-position-compact {
  flex-shrink: 0;
}

.ranking-badge-compact {
  width: 1.75rem;
  height: 1.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 700;
  background: rgba(13, 17, 23, 0.5);
  border: 1px solid var(--border-color);
  border-radius: 4px;
}

.rank-gold { color: var(--neon-gold); border-color: var(--neon-gold); text-shadow: 0 0 8px rgba(251, 191, 36, 0.3); }
.rank-silver { color: #c0c0c0; border-color: #c0c0c0; }
.rank-bronze { color: #cd7f32; border-color: #cd7f32; }
.rank-top10 { color: var(--neon-cyan); border-color: var(--neon-cyan); }
.rank-top25 { color: var(--neon-pink); border-color: var(--neon-pink); }

.ranking-details-compact {
  flex: 1;
  min-width: 0;
}

.ranking-map-compact {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-primary);
  text-transform: uppercase;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ranking-trend-compact {
  font-size: 0.7rem;
  font-weight: 700;
  display: flex;
  align-items: center;
}

.trend-up { color: var(--neon-green); }
.trend-down { color: var(--neon-red); }
.trend-stable { color: var(--text-secondary); opacity: 0.5; }
.trend-new { color: var(--neon-gold); }

.ranking-stats-compact {
  display: flex;
  gap: 0.75rem;
  font-size: 0.65rem;
  margin-top: 0.1rem;
}

.ranking-stat-compact {
  display: flex;
  gap: 0.25rem;
  white-space: nowrap;
}

.ranking-percentile-compact {
  flex-shrink: 0;
  text-align: right;
}

.percentile-badge-compact {
  padding: 0.15rem 0.4rem;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  border-radius: 3px;
  text-transform: uppercase;
  text-align: center;
}

.percentile-elite { background: var(--neon-gold); color: var(--bg-dark); }
.percentile-master { background: var(--neon-cyan); color: var(--bg-dark); }
.percentile-expert { background: var(--neon-pink); color: var(--bg-dark); }
.percentile-veteran { border: 1px solid var(--neon-cyan); color: var(--neon-cyan); }

/* --- Compact Pagination --- */
.pagination-controls-compact {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  padding: 0.75rem;
  margin-top: 0.5rem;
  border-top: 1px solid var(--border-color);
}

.pagination-btn-compact {
  padding: 0.2rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
  background: rgba(13, 17, 23, 0.5);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 1.5rem;
}

.pagination-btn-compact:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--neon-cyan);
  background: rgba(245, 158, 11, 0.05);
}

.pagination-btn-compact:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.pagination-btn-compact--active {
  background: var(--neon-cyan);
  color: var(--bg-dark);
  border-color: var(--neon-cyan);
}

/* --- Timeline & Charts --- */
.timeline-content {
  padding: 0.5rem 0;
}

.timeline-chart-container {
  background: rgba(13, 17, 23, 0.2);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 0.75rem;
  height: 350px;
  position: relative;
}

.timeline-chart {
  height: 100%;
}

/* --- Utilities & Common --- */
.explorer-empty {
  text-align: center;
  padding: 2.5rem 1rem;
}

.explorer-empty-icon {
  font-size: 2rem;
  margin-bottom: 0.5rem;
  opacity: 0.3;
  color: var(--neon-cyan);
}

.explorer-empty-title {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-primary);
}

.explorer-skeleton {
  background: linear-gradient(90deg, var(--bg-card) 0%, var(--border-color) 50%, var(--bg-card) 100%);
  background-size: 200% 100%;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
  border-radius: 4px;
}

@keyframes skeleton-pulse {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.explorer-spinner {
  width: 1.5rem;
  height: 1.5rem;
  border: 2px solid var(--border-color);
  border-top-color: var(--neon-cyan);
  border-radius: 50%;
  animation: spinner-rotate 0.8s linear infinite;
}

@keyframes spinner-rotate {
  to { transform: rotate(360deg); }
}

.text-neon-green { color: var(--neon-green); }
.text-neon-red { color: var(--neon-red); }
.font-mono { font-family: 'JetBrains Mono', monospace; }

@media (max-width: 640px) {
  .ranking-stats-compact {
    flex-direction: column;
    gap: 0.1rem;
  }
  
  .ranking-item-compact {
    padding: 0.5rem;
  }
  
  .explorer-header-actions {
    justify-content: space-between;
    width: 100%;
  }
}
</style>