<template>
  <div class="player-detail-panel">
    <!-- Loading State -->
    <div
      v-if="isLoading"
      class="flex flex-col gap-4 p-6"
    >
      <div
        class="explorer-skeleton"
        style="height: 2rem; width: 33%"
      />
      <div
        class="explorer-skeleton"
        style="height: 1rem; width: 25%"
      />
      <div
        class="explorer-skeleton"
        style="height: 12rem"
      />
    </div>

    <!-- Error State -->
    <div
      v-else-if="error"
      class="explorer-empty"
    >
      <div class="explorer-empty-icon text-neon-red">
        !
      </div>
      <p class="explorer-empty-title text-neon-red">
        {{ error }}
      </p>
      <p class="explorer-empty-desc">
        Try selecting a different time period or slice dimension.
      </p>
      <div class="flex gap-2 justify-center mt-4">
        <button
          class="explorer-btn explorer-btn--ghost explorer-btn--sm"
          @click="loadData()"
        >
          Try again
        </button>
      </div>
    </div>

    <!-- Content -->
    <div v-else-if="slicedData">
      <!-- Integrated Header Area -->
      <div class="explorer-header-integrated mb-6">
        <div class="explorer-header-main">
          <div class="explorer-title-minimal">
            <h2
              class="metric-title-subtle"
              :data-metric="getMetricTypeForSlice(selectedSliceType)"
            >
              {{ getCurrentSliceName() }}
            </h2>
            <p class="metric-description-subtle">
              {{ getCurrentSliceDescription() }}
            </p>
          </div>

          <div class="explorer-header-actions">
            <!-- Metric Selector -->
            <div
              class="explorer-toggle-group"
              :data-metric="getMetricTypeForSlice(selectedSliceType)"
            >
              <button
                v-for="tab in metricTabs"
                :key="tab.type"
                class="explorer-toggle-btn explorer-toggle-btn--compact"
                :class="{ 'explorer-toggle-btn--active': getMetricTypeForSlice(selectedSliceType) === tab.type }"
                :data-metric="tab.type"
                @click="selectMetric(tab.type)"
              >
                {{ tab.label }}
              </button>
            </div>

            <!-- Scope Toggle -->
            <div class="explorer-toggle-group">
              <button
                class="explorer-toggle-btn explorer-toggle-btn--compact"
                :class="{ 'explorer-toggle-btn--active': !includeServerInSlice() }"
                @click="toggleScope('map')"
              >
                MAP
              </button>
              <button
                class="explorer-toggle-btn explorer-toggle-btn--compact"
                :class="{ 'explorer-toggle-btn--active': includeServerInSlice() }"
                @click="toggleScope('map-server')"
              >
                +SERVER
              </button>
            </div>

            <!-- Time Range -->
            <select
              :value="selectedTimeRange"
              class="explorer-select explorer-select--compact explorer-mono text-xs"
              :disabled="isLoading"
              @change="changeTimeRange(parseInt(($event.target as HTMLSelectElement).value))"
            >
              <option
                v-for="option in timeRangeOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </div>
        </div>
      </div>

      <!-- Compact Summary Stats -->
      <div
        v-if="slicedData.results.length > 0"
        class="explorer-stats-grid-compact mb-8"
      >
        <!-- Card 1: Count -->
        <div class="explorer-stat-minimal">
          <div class="explorer-stat-label-minimal">
            {{ getResultTypeLabel() }}
          </div>
          <div class="explorer-stat-value-minimal">
            {{ slicedData.pagination.totalItems }}
          </div>
        </div>

        <!-- Card 2: Primary Metric -->
        <div class="explorer-stat-minimal">
          <div class="explorer-stat-label-minimal">
            {{ getPrimaryMetricLabel() }}
          </div>
          <div
            class="explorer-stat-value-minimal"
            :class="themeStatClass"
          >
            {{ getTotalPrimaryValue() }}
          </div>
        </div>

        <!-- Card 3: Secondary Metric -->
        <div class="explorer-stat-minimal">
          <div class="explorer-stat-label-minimal">
            {{ getSecondaryMetricLabel() }}
          </div>
          <div class="explorer-stat-value-minimal">
            {{ getTotalSecondaryValue() }}
          </div>
        </div>

        <!-- Card 4: Average Primary Per Round -->
        <div class="explorer-stat-minimal">
          <div class="explorer-stat-label-minimal">
            {{ getAveragePrimaryLabel() }}
          </div>
          <div
            class="explorer-stat-value-minimal"
            :class="themeStatClass"
          >
            {{ getAveragePrimaryPerRound() }}
          </div>
        </div>

        <!-- Card 5: Average K/D or Win Rate -->
        <div class="explorer-stat-minimal">
          <div class="explorer-stat-label-minimal">
            {{ getPercentageLabel() }}
          </div>
          <div
            class="explorer-stat-value-minimal"
            :class="percentageStatClass"
          >
            {{ getAveragePercentage() }}<span class="text-[10px] ml-0.5 opacity-50">{{ getPercentageUnit() || '' }}</span>
          </div>
        </div>
      </div>

      <!-- Results Table -->
      <div
        v-if="slicedData.results.length > 0"
        class="explorer-results-area"
      >
        <div class="explorer-section-header flex items-center justify-between">
          <h3 class="explorer-section-title !mb-0 border-none !pb-0">
            DETAILED RESULTS
          </h3>
          <div
            v-if="slicedData.pagination.totalPages > 1"
            class="flex items-center gap-4"
          >
            <span
              class="text-[10px] explorer-mono"
              style="color: var(--text-secondary)"
            >
              PAGE <span style="color: var(--text-primary)">{{ slicedData.pagination.page }}</span> / {{ slicedData.pagination.totalPages }}
            </span>
            <div class="explorer-pagination-controls">
              <button
                :disabled="!slicedData.pagination.hasPrevious || isLoading"
                class="explorer-pagination-btn explorer-pagination-btn--compact"
                @click="changePage(slicedData.pagination.page - 1)"
              >
                &larr;
              </button>
              <button
                :disabled="!slicedData.pagination.hasNext || isLoading"
                class="explorer-pagination-btn explorer-pagination-btn--compact"
                @click="changePage(slicedData.pagination.page + 1)"
              >
                &rarr;
              </button>
            </div>
          </div>
        </div>

        <div class="explorer-table-wrapper">
          <div class="overflow-x-auto">
            <table class="explorer-table explorer-table--integrated">
              <!-- Table Header -->
              <thead>
                <tr>
                  <th class="w-10 text-center">
                    #
                  </th>
                  <th class="text-left pl-4">
                    {{ getTableHeaderLabel() }}
                  </th>
                  <th class="text-right">
                    {{ getSecondaryMetricLabel() }}
                  </th>
                  <th
                    class="text-right"
                    :class="themeColorClass"
                  >
                    {{ getPrimaryMetricLabel() }}
                  </th>
                  <th
                    class="text-right pr-6"
                    :class="percentageColorClass"
                  >
                    {{ getPercentageLabel() }}
                  </th>
                  <th
                    v-if="hasAdditionalData()"
                    class="text-left pl-4"
                  >
                    ADDITIONAL
                  </th>
                </tr>
              </thead>

              <!-- Table Body -->
              <tbody>
                <tr
                  v-for="(result, index) in slicedData.results"
                  :key="`${result.sliceKey}-${result.subKey || 'global'}`"
                  class="cursor-pointer"
                  @click="handleSliceClick(result)"
                >
                  <!-- Rank -->
                  <td class="text-center explorer-mono text-[11px]">
                    <span :class="getRankClass(result.rank)">{{ result.rank }}</span>
                  </td>

                  <!-- Main Label -->
                  <td class="pl-4">
                    <div class="flex items-center">
                      <span
                        class="font-bold text-[13px]"
                        :class="{ 'text-neon-cyan': isMapSlice() }"
                        style="color: var(--text-primary)"
                      >
                        {{ result.sliceLabel }}
                      </span>
                      <span
                        v-if="result.subKey"
                        class="explorer-tag explorer-tag--mini ml-2"
                      >
                        {{ result.subKeyLabel || getServerName(result.subKey) }}
                      </span>
                    </div>
                  </td>

                  <!-- Secondary Value -->
                  <td class="text-right explorer-mono explorer-table-muted text-[11px]">
                    {{ result.secondaryValue.toLocaleString() }}
                  </td>

                  <!-- Primary Value -->
                  <td
                    class="text-right explorer-mono font-bold text-[12px]"
                    :class="themeColorClass"
                  >
                    {{ result.primaryValue.toLocaleString() }}
                  </td>

                  <!-- Percentage -->
                  <td
                    class="text-right pr-6 explorer-mono text-[11px]"
                    :class="percentageColorClass"
                  >
                    {{ result.percentage.toFixed(1) }}<span class="text-[10px] ml-0.5 opacity-70">{{ getPercentageUnit() }}</span>
                  </td>

                  <!-- Additional Data -->
                  <td
                    v-if="hasAdditionalData()"
                    class="pl-4 py-1.5"
                  >
                    <div
                      v-if="isTeamWinSlice()"
                      class="w-full max-w-[140px]"
                    >
                      <!-- Visual Win Rate Bar -->
                      <div v-if="getTeamLabel(result.additionalData, 'team1Label') || getTeamLabel(result.additionalData, 'team2Label')">
                        <WinStatsBar :win-stats="getTeamWinStats(result)" />
                      </div>
                    </div>
                    <div
                      v-else
                      class="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]"
                      style="color: var(--text-secondary)"
                    >
                      <div
                        v-for="(value, key) in result.additionalData"
                        :key="key"
                        class="flex gap-1"
                      >
                        <span class="opacity-50 uppercase tracking-tighter">{{ formatAdditionalKey(key) }}:</span>
                        <span
                          class="explorer-mono"
                          style="color: var(--text-primary)"
                        >{{ formatAdditionalValue(value) }}</span>
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-else
        class="explorer-empty"
      >
        <div class="explorer-empty-icon">
          { }
        </div>
        <p class="explorer-empty-title">
          NO DATA AVAILABLE
        </p>
        <p class="explorer-empty-desc">
          No statistics found for this player with the current filters.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue';
import { PLAYER_STATS_TIME_RANGE_OPTIONS } from '@/utils/constants';
import WinStatsBar from '@/components/data-explorer/WinStatsBar.vue';
import type { WinStats } from '@/services/dataExplorerService';

const props = defineProps<{
  playerName: string;
  game?: string;
  serverGuid?: string; // Optional: filter to a specific server
}>();

const emit = defineEmits<{
  'navigate-to-server': [serverGuid: string];
  'navigate-to-map': [mapName: string];
}>();

const isMapSlice = () => {
  return selectedSliceType.value.includes('Map');
};

const handleSliceClick = (result: PlayerSliceResultDto) => {
  if (isMapSlice()) {
    emit('navigate-to-map', result.sliceKey);
  }
};

// API Types
interface SliceDimensionOption {
  type: string;
  name: string;
  description: string;
}

interface PlayerSlicedStatsResponse {
  playerName: string;
  game: string;
  sliceDimension: string;
  sliceType: string;
  results: PlayerSliceResultDto[];
  dateRange: { days: number; fromDate: string; toDate: string };
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

interface PlayerSliceResultDto {
  sliceKey: string;
  subKey: string | null;
  subKeyLabel?: string | null;
  sliceLabel: string;
  primaryValue: number;
  secondaryValue: number;
  percentage: number;
  rank: number;
  totalPlayers: number;
  additionalData: Record<string, any>;
}

const slicedData = ref<PlayerSlicedStatsResponse | null>(null);
const availableDimensions = ref<SliceDimensionOption[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);

// Control states
const selectedTimeRange = ref<number>(60);
const selectedSliceType = ref<string>('ScoreByMap');
const currentPage = ref<number>(1);
const pageSize = ref<number>(10);
const allResults = ref<PlayerSliceResultDto[]>([]);

const timeRangeOptions = PLAYER_STATS_TIME_RANGE_OPTIONS;

// Metric tabs configuration
interface MetricTab {
  type: 'score' | 'kills' | 'wins';
  label: string;
}

const metricTabs: MetricTab[] = [
  { type: 'score', label: 'SCORE' },
  { type: 'kills', label: 'KILLS' },
  { type: 'wins', label: 'WINS' }
];

// Extract metric type from slice type
const getMetricTypeForSlice = (sliceType: string): 'score' | 'kills' | 'wins' => {
  if (sliceType.includes('Kills')) return 'kills';
  if (sliceType.includes('Wins')) return 'wins';
  return 'score';
};

// Check if current slice includes server breakdown
const includeServerInSlice = (): boolean => {
  return selectedSliceType.value.includes('Server');
};

// Toggle between map-only and map+server scope
const toggleScope = (scope: 'map' | 'map-server') => {
  let newSliceType = '';
  const currentMetric = getMetricTypeForSlice(selectedSliceType.value);
  const includeServer = scope === 'map-server';

  if (currentMetric === 'kills') {
    newSliceType = includeServer ? 'KillsByMapAndServer' : 'KillsByMap';
  } else if (currentMetric === 'wins') {
    newSliceType = includeServer ? 'WinsByMapAndServer' : 'WinsByMap';
  } else {
    newSliceType = includeServer ? 'ScoreByMapAndServer' : 'ScoreByMap';
  }

  selectedSliceType.value = newSliceType;
  currentPage.value = 1;
  loadData(selectedTimeRange.value);
};

// Select a metric and update slice type accordingly
const selectMetric = (metricType: 'score' | 'kills' | 'wins') => {
  let newSliceType = '';
  const currentHasServer = includeServerInSlice();

  if (metricType === 'kills') {
    newSliceType = currentHasServer ? 'KillsByMapAndServer' : 'KillsByMap';
  } else if (metricType === 'wins') {
    newSliceType = currentHasServer ? 'WinsByMapAndServer' : 'WinsByMap';
  } else {
    newSliceType = currentHasServer ? 'ScoreByMapAndServer' : 'ScoreByMap';
  }
  selectedSliceType.value = newSliceType;
  currentPage.value = 1;
  loadData(selectedTimeRange.value);
};

const gameLabel = computed(() => {
  switch (slicedData.value?.game?.toLowerCase()) {
    case 'bf1942': return 'BF1942';
    case 'fh2': return 'FH2';
    case 'bfvietnam': return 'BFV';
    default: return slicedData.value?.game || 'UNKNOWN';
  }
});

// Theme Logic - classes for neon text utilities (defined in DataExplorer.vue.css)
const themeColorClass = computed(() => {
  const type = selectedSliceType.value;
  if (type.includes('Kills')) return 'text-neon-red';
  if (type.includes('Wins')) return 'text-neon-green';
  return 'text-neon-cyan';
});

const percentageColorClass = computed(() => {
  const type = selectedSliceType.value;
  if (type.includes('Kills')) return 'text-neon-pink';
  if (type.includes('Wins')) return 'text-neon-green';
  return 'text-neon-gold';
});

// Stat value classes with text-shadow glow effects
const themeStatClass = computed(() => {
  const type = selectedSliceType.value;
  if (type.includes('Kills')) return 'explorer-stat-value--pink';
  if (type.includes('Wins')) return 'explorer-stat-value--green';
  return 'explorer-stat-value--accent';
});

const percentageStatClass = computed(() => {
  const type = selectedSliceType.value;
  if (type.includes('Kills')) return 'explorer-stat-value--pink';
  if (type.includes('Wins')) return 'explorer-stat-value--green';
  return 'explorer-stat-value--gold';
});

const getRankClass = (rank: number) => {
  if (rank === 1) return 'explorer-rank-1';
  if (rank === 2) return 'explorer-rank-2';
  if (rank === 3) return 'explorer-rank-3';
  return '';
};

// Load available slice dimensions
const loadSliceDimensions = async () => {
  try {
    const response = await fetch('/stats/data-explorer/slice-dimensions');
    if (!response.ok) throw new Error('Failed to fetch slice dimensions');
    availableDimensions.value = await response.json();
  } catch (err) {
    console.error('Error loading slice dimensions:', err);
    availableDimensions.value = [
      { type: 'ScoreByMap', name: 'Score by Map', description: 'Total player score per map' },
      { type: 'ScoreByMapAndServer', name: 'Score by Map + Server', description: 'Player score per map per server' },
      { type: 'KillsByMap', name: 'Kills by Map', description: 'Total kills per map' },
      { type: 'KillsByMapAndServer', name: 'Kills by Map + Server', description: 'Kills per map per server' },
      { type: 'WinsByMap', name: 'Wins by Map', description: 'Win statistics per map' },
      { type: 'WinsByMapAndServer', name: 'Wins by Map + Server', description: 'Wins per map per server' }
    ];
  }
};

const loadData = async (days?: number) => {
  if (!props.playerName) return;

  const timeRange = days || selectedTimeRange.value;

  isLoading.value = true;

  try {
    const params = new URLSearchParams({
      sliceType: selectedSliceType.value,
      game: props.game || 'bf1942',
      page: '1',
      pageSize: '1000',
      days: timeRange.toString()
    });

    const response = await fetch(`/stats/data-explorer/players/${encodeURIComponent(props.playerName)}/sliced-stats?${params}`);

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`No data available for this player in the last ${timeRange} days`);
      } else {
        throw new Error('Failed to load player statistics');
      }
    }

    const responseData = await response.json();
    error.value = null; // Clear error on success

    allResults.value = responseData.results || [];

    slicedData.value = {
      ...responseData,
      results: getPaginatedResults(),
      pagination: {
        page: currentPage.value,
        pageSize: pageSize.value,
        totalItems: allResults.value.length,
        totalPages: Math.ceil(allResults.value.length / pageSize.value),
        hasNext: currentPage.value < Math.ceil(allResults.value.length / pageSize.value),
        hasPrevious: currentPage.value > 1
      }
    };
  } catch (err: any) {
    console.error(`Error loading sliced player data:`, err);
    error.value = err.message || 'Failed to load player details';
    // Don't clear slicedData so user can navigate away from the failed metric
  }

  isLoading.value = false;
};

const getPaginatedResults = (): PlayerSliceResultDto[] => {
  const startIndex = (currentPage.value - 1) * pageSize.value;
  const endIndex = startIndex + pageSize.value;
  return allResults.value.slice(startIndex, endIndex);
};

const changeTimeRange = (days: number) => {
  selectedTimeRange.value = days;
  currentPage.value = 1;
  loadData(days);
};

const changePage = (page: number) => {
  if (page < 1 || page > Math.ceil(allResults.value.length / pageSize.value)) return;
  currentPage.value = page;
  if (slicedData.value) {
    slicedData.value = {
      ...slicedData.value,
      results: getPaginatedResults(),
      pagination: {
        page: currentPage.value,
        pageSize: pageSize.value,
        totalItems: allResults.value.length,
        totalPages: Math.ceil(allResults.value.length / pageSize.value),
        hasNext: currentPage.value < Math.ceil(allResults.value.length / pageSize.value),
        hasPrevious: currentPage.value > 1
      }
    };
  }
};

// UI Helper Methods
const getCurrentSliceName = () => {
  const dimension = availableDimensions.value.find(d => d.type === selectedSliceType.value);
  return dimension?.name || selectedSliceType.value;
};

const getCurrentSliceDescription = () => {
  const dimension = availableDimensions.value.find(d => d.type === selectedSliceType.value);
  return dimension?.description || 'Player statistics broken down by selected dimension';
};

const getResultTypeLabel = () => {
  if (!slicedData.value) return 'Results';
  return selectedSliceType.value.includes('Server') ? 'Map-Server Combos' : 'Maps';
};

const getPrimaryMetricLabel = () => {
  if (selectedSliceType.value.includes('Score')) return 'Total Score';
  if (selectedSliceType.value.includes('Kills')) return 'Total Kills';
  if (selectedSliceType.value.includes('Wins')) return 'Total Wins';
  return 'Total';
};

const getSecondaryMetricLabel = () => {
  return 'Rounds';
};

const getPercentageLabel = () => {
  if (selectedSliceType.value.includes('Score') || selectedSliceType.value.includes('Kills')) return 'Avg K/D';
  if (selectedSliceType.value.includes('Wins')) return 'Win Rate';
  return 'Rate';
};

const getPercentageUnit = () => {
  if (selectedSliceType.value.includes('Wins')) return '%';
  return '';
};

const getTableHeaderLabel = () => {
  if (selectedSliceType.value.includes('Server')) return 'Map & Server';
  return 'Map';
};

const hasAdditionalData = () => {
  return slicedData.value?.results.some(result => Object.keys(result.additionalData).length > 0) || false;
};

const getTotalPrimaryValue = () => {
  if (!slicedData.value) return 0;
  return slicedData.value.results.reduce((sum, result) => sum + result.primaryValue, 0).toLocaleString();
};

const getTotalSecondaryValue = () => {
  if (!slicedData.value) return 0;
  return slicedData.value.results.reduce((sum, result) => sum + result.secondaryValue, 0).toLocaleString();
};

const getAveragePercentage = () => {
  if (!slicedData.value || slicedData.value.results.length === 0) return 0;
  const total = slicedData.value.results.reduce((sum, result) => sum + result.percentage, 0);
  return (total / slicedData.value.results.length).toFixed(1);
};

const getAveragePrimaryPerRound = () => {
  if (!slicedData.value || slicedData.value.results.length === 0) return '0';
  const totalPrimary = slicedData.value.results.reduce((sum, result) => sum + result.primaryValue, 0);
  const totalSecondary = slicedData.value.results.reduce((sum, result) => sum + result.secondaryValue, 0);

  if (totalSecondary === 0) return '0';

  const average = totalPrimary / totalSecondary;
  if (selectedSliceType.value.includes('Kills')) {
    return average.toFixed(2);
  }
  return average.toLocaleString('en-US', { maximumFractionDigits: 0 });
};

const getAveragePrimaryLabel = () => {
  if (selectedSliceType.value.includes('Score')) return 'Avg Score/Round';
  if (selectedSliceType.value.includes('Kills')) return 'Avg Kills/Round';
  if (selectedSliceType.value.includes('Wins')) return 'Avg Wins/Round';
  return 'Avg Per Round';
};

const formatAdditionalKey = (key: string) => {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d+)/g, '$1 $2')
    .replace(/^./, str => str.toUpperCase());
};

const formatAdditionalValue = (value: any) => {
  if (typeof value === 'number') {
    return value.toLocaleString();
  }
  return String(value);
};

const getServerName = (serverGuid: string) => {
  return serverGuid.substring(0, 8) + '...';
};

const isTeamWinSlice = () => selectedSliceType.value.includes('TeamWins');

const getTeamLabel = (additionalData: Record<string, any>, key: 'team1Label' | 'team2Label') => {
  const value = additionalData?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
};

const getTeamWinStats = (result: PlayerSliceResultDto): WinStats => {
  const team1Label = getTeamLabel(result.additionalData, 'team1Label') || 'Team 1';
  const team2Label = getTeamLabel(result.additionalData, 'team2Label') || 'Team 2';

  return {
    team1Label,
    team2Label,
    team1Victories: result.primaryValue,
    team2Victories: result.additionalData.team2Victories || 0,
    team1WinPercentage: Math.round(result.percentage),
    team2WinPercentage: Math.round(result.additionalData.team2WinRate || 0),
    totalRounds: result.secondaryValue
  };
};

onMounted(async () => {
  await loadSliceDimensions();
  await loadData();
});

watch(() => props.playerName, () => {
  currentPage.value = 1;
  loadData();
});

watch(() => props.game, () => {
  currentPage.value = 1;
  loadData();
});

watch(() => props.serverGuid, () => {
  currentPage.value = 1;
  loadData();
});
</script>

<style scoped>
/* ===== Integrated Data Dashboard Theme ===== */

/* --- Integrated Header --- */
.explorer-header-integrated {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 1rem 1rem 1.5rem 1rem;
}

.explorer-header-main {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

@media (min-width: 1024px) {
  .explorer-header-main {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}

.explorer-title-minimal {
  border-left: 2px solid var(--neon-cyan);
  padding-left: 0.75rem;
}

.metric-title-subtle {
  font-size: 0.85rem;
  font-weight: 700;
  margin: 0;
  letter-spacing: 0.05em;
  font-family: 'JetBrains Mono', monospace;
  text-transform: uppercase;
}

.metric-title-subtle[data-metric="score"] { color: var(--neon-cyan); }
.metric-title-subtle[data-metric="kills"] { color: var(--neon-red); }
.metric-title-subtle[data-metric="wins"] { color: var(--neon-green); }

.metric-description-subtle {
  font-size: 0.65rem;
  color: var(--text-secondary);
  margin-top: 0.1rem;
  letter-spacing: 0.02em;
  opacity: 0.7;
}

.explorer-header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}

/* --- Compact Stats Grid --- */
.explorer-stats-grid-compact {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.75rem;
  padding: 0 1rem 2rem 1rem;
}

@media (min-width: 640px) {
  .explorer-stats-grid-compact {
    grid-template-columns: repeat(5, 1fr);
  }
}

.explorer-stat-minimal {
  padding: 0.5rem 0.75rem;
  background: rgba(22, 27, 34, 0.4);
  border-left: 1px solid var(--border-color);
  transition: all 0.3s ease;
}

.explorer-stat-minimal:hover {
  background: rgba(245, 158, 11, 0.03);
  border-left-color: var(--neon-cyan);
}

.explorer-stat-label-minimal {
  font-size: 0.6rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.15rem;
}

.explorer-stat-value-minimal {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
  font-family: 'JetBrains Mono', monospace;
}

.explorer-stat-value--accent { color: var(--neon-cyan); }
.explorer-stat-value--green { color: var(--neon-green); }
.explorer-stat-value--pink { color: var(--neon-red); }
.explorer-stat-value--gold { color: var(--neon-gold); }

/* --- Integrated Table --- */
.explorer-results-area {
  width: 100%;
}

.explorer-section-header {
  padding: 0 1rem 0.75rem 1rem;
}

.explorer-table-wrapper {
  background: transparent;
  border-top: 1px solid var(--border-color);
  width: 100%;
}

.explorer-table--integrated {
  border-collapse: separate;
  border-spacing: 0;
  width: 100%;
}

.explorer-table--integrated th {
  background: transparent;
  border-bottom: 1px solid var(--border-color);
  padding: 0.75rem 0.5rem;
  font-size: 0.65rem;
  opacity: 0.8;
}

.explorer-table--integrated th:first-child {
  padding-left: 1rem;
}

.explorer-table--integrated th:last-child {
  padding-right: 1rem;
}

.explorer-table--integrated td {
  border-bottom: 1px solid rgba(48, 54, 61, 0.5);
  padding: 0.5rem 0.5rem;
  background: transparent;
}

.explorer-table--integrated td:first-child {
  padding-left: 1rem;
}

.explorer-table--integrated td:last-child {
  padding-right: 1rem;
}

.explorer-table--integrated tbody tr:hover td {
  background: rgba(245, 158, 11, 0.05);
}

/* --- Controls & UI Elements --- */
.explorer-toggle-group {
  display: flex;
  background: rgba(13, 17, 23, 0.5);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.1rem;
}

.explorer-toggle-btn--compact {
  padding: 0.25rem 0.5rem;
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.03em;
}

.explorer-toggle-btn--active {
  background: var(--neon-cyan);
  color: var(--bg-dark);
}

.explorer-toggle-btn--active[data-metric="score"] { background: var(--neon-cyan); }
.explorer-toggle-btn--active[data-metric="kills"] { background: var(--neon-red); }
.explorer-toggle-btn--active[data-metric="wins"] { background: var(--neon-green); }

.explorer-select--compact {
  padding: 0.2rem 0.4rem;
  height: 1.75rem;
  font-size: 0.7rem;
  background: rgba(13, 17, 23, 0.5);
}

.explorer-pagination-btn--compact {
  padding: 0.1rem 0.4rem;
  font-size: 0.65rem;
  min-width: 1.25rem;
}

.explorer-tag--mini {
  font-size: 0.6rem;
  padding: 0.05rem 0.25rem;
  opacity: 0.8;
}

/* Base Explorer Styles (Re-applied as needed) */
.explorer-section-title {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--neon-cyan);
  font-family: 'JetBrains Mono', monospace;
  text-transform: uppercase;
}

.explorer-mono { font-family: 'JetBrains Mono', monospace; }
.explorer-table-muted { color: var(--text-secondary); opacity: 0.6; }

/* Rank Colors */
.explorer-rank-1 { color: var(--neon-gold); font-weight: 700; }
.explorer-rank-2 { color: #c0c0c0; }
.explorer-rank-3 { color: #cd7f32; }

/* Transitions */
.explorer-btn, .explorer-toggle-btn, .explorer-select, .explorer-table tbody tr {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Skeleton & Empty States */
.explorer-skeleton {
  background: linear-gradient(90deg, var(--bg-card) 0%, var(--border-color) 50%, var(--bg-card) 100%);
  background-size: 200% 100%;
  animation: explorer-skeleton 1.5s ease-in-out infinite;
  border-radius: 4px;
}

@keyframes explorer-skeleton {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.explorer-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem 1.5rem;
  text-align: center;
}

.explorer-empty-icon {
  font-size: 2rem;
  color: var(--neon-cyan);
  opacity: 0.3;
  margin-bottom: 0.5rem;
}

.explorer-empty-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.05em;
}

.explorer-empty-desc {
  font-size: 0.75rem;
  color: var(--text-secondary);
  margin-top: 0.25rem;
  opacity: 0.7;
}

/* Neon text utilities */
.text-neon-cyan { color: var(--neon-cyan); }
.text-neon-green { color: var(--neon-green); }
.text-neon-pink { color: var(--neon-pink); }
.text-neon-gold { color: var(--neon-gold); }
.text-neon-red { color: var(--neon-red); }
</style>
