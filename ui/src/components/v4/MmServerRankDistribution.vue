<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  type ChartOptions,
  type ChartData,
} from 'chart.js'
import {
  fetchServerRankDistribution,
  fetchServerPlayerRankings,
  type ServerRankDistributionResponse,
  type ServerPlayerRankingItem,
  type MetricDistribution,
} from '@/services/serverDetailsService'
import { decodePlayerName } from '@/utils/playerName'
import { MM_CHART, kdClass } from '@/views/v4/mmTokens'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const props = defineProps<{
  serverName: string
}>()

const $pn = decodePlayerName

type MetricKey = 'kd' | 'score' | 'kills' | 'playtime' | 'killrate'

const metricTabs: { id: MetricKey; label: string; unit: string }[] = [
  { id: 'kd', label: 'K/D ratio', unit: 'K/D' },
  { id: 'score', label: 'Score', unit: 'pts' },
  { id: 'kills', label: 'Kills', unit: 'kills' },
  { id: 'playtime', label: 'Hours played', unit: 'h' },
  { id: 'killrate', label: 'Kill rate', unit: 'k/min' },
]

const activeMetric = ref<MetricKey>('kd')
const selectedDays = ref<number>(30)
const selectedMinRounds = ref<number>(10)
const dayOptions = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: 365, label: '1y' },
]
const minRoundsOptions = [10, 25, 50, 100, 200]

const data = ref<ServerRankDistributionResponse | null>(null)
const loading = ref(true)
const isRefreshing = ref(false)
const error = ref<string | null>(null)

// Pinned Player Benchmark state
const pinnedPlayer = ref<ServerPlayerRankingItem | null>(null)
const playerSearchQuery = ref('')
const playerSearchResults = ref<ServerPlayerRankingItem[]>([])
const playerSearchLoading = ref(false)
const showSearchDropdown = ref(false)
const searchWrapRef = ref<HTMLElement | null>(null)
let searchDebounceTimeout: any = null

const loadDistribution = async () => {
  if (!props.serverName) return
  if (!data.value) loading.value = true
  else isRefreshing.value = true
  error.value = null

  try {
    const res = await fetchServerRankDistribution(
      props.serverName,
      selectedDays.value,
      selectedMinRounds.value,
    )
    data.value = res

    // If a player is pinned, refresh their stats under the new filter parameters
    if (pinnedPlayer.value) {
      void refreshPinnedPlayerStats(pinnedPlayer.value.playerName)
    }
  } catch (err) {
    console.error('Failed to load rank distribution:', err)
    error.value = 'Failed to load rank distribution data'
  } finally {
    loading.value = false
    isRefreshing.value = false
  }
}

const refreshPinnedPlayerStats = async (playerName: string) => {
  try {
    const res = await fetchServerPlayerRankings(
      props.serverName,
      1,
      10,
      'active',
      selectedDays.value,
      selectedMinRounds.value,
      playerName,
    )
    const matched = res.rankings.find(
      p => p.playerName.toLowerCase() === playerName.toLowerCase(),
    )
    if (matched) {
      pinnedPlayer.value = matched
    }
  } catch (err) {
    console.warn('Could not refresh pinned player stats:', err)
  }
}

const handlePlayerSearchInput = () => {
  if (searchDebounceTimeout) clearTimeout(searchDebounceTimeout)
  const q = playerSearchQuery.value.trim()
  if (q.length < 2) {
    playerSearchResults.value = []
    showSearchDropdown.value = false
    return
  }

  playerSearchLoading.value = true
  showSearchDropdown.value = true

  searchDebounceTimeout = setTimeout(async () => {
    try {
      const res = await fetchServerPlayerRankings(
        props.serverName,
        1,
        8,
        'active',
        selectedDays.value,
        selectedMinRounds.value,
        q,
      )
      playerSearchResults.value = res.rankings
    } catch (err) {
      console.error('Failed searching player rankings:', err)
      playerSearchResults.value = []
    } finally {
      playerSearchLoading.value = false
    }
  }, 250)
}

const clearPlayerSearch = () => {
  playerSearchQuery.value = ''
  playerSearchResults.value = []
  showSearchDropdown.value = false
}

const pinPlayer = (player: ServerPlayerRankingItem) => {
  pinnedPlayer.value = player
  clearPlayerSearch()
}

const clearPinnedPlayer = () => {
  pinnedPlayer.value = null
}

const handleClickOutside = (e: MouseEvent) => {
  if (searchWrapRef.value && !searchWrapRef.value.contains(e.target as Node)) {
    showSearchDropdown.value = false
  }
}

onMounted(() => {
  loadDistribution()
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
  if (searchDebounceTimeout) clearTimeout(searchDebounceTimeout)
})

watch(() => props.serverName, loadDistribution)
watch([selectedDays, selectedMinRounds], loadDistribution)

const activeDist = computed<MetricDistribution | null>(() => {
  if (!data.value) return null
  switch (activeMetric.value) {
    case 'kd': return data.value.kdDistribution
    case 'score': return data.value.scoreDistribution
    case 'kills': return data.value.killsDistribution
    case 'playtime': return data.value.playTimeDistribution
    case 'killrate': return data.value.killRateDistribution
    default: return data.value.kdDistribution
  }
})

const activeUnit = computed(() => {
  return metricTabs.find(t => t.id === activeMetric.value)?.unit ?? ''
})

const formatMetricValue = (val: number | null | undefined, metric: MetricKey): string => {
  if (val == null) return '—'
  switch (metric) {
    case 'kd':
      return val.toFixed(2)
    case 'score':
    case 'kills':
      return Math.round(val).toLocaleString()
    case 'playtime':
      return `${val.toFixed(1)}h`
    case 'killrate':
      return val.toFixed(2)
    default:
      return val.toString()
  }
}

// Find which band index contains a specific value
const getBandIndexForValue = (val: number, dist: MetricDistribution): number => {
  if (!dist.bands || dist.bands.length === 0) return -1
  for (let i = 0; i < dist.bands.length; i++) {
    const band = dist.bands[i]
    if (band.maxValue != null) {
      if (val >= band.minValue && val < band.maxValue) return i
    } else {
      if (val >= band.minValue) return i
    }
  }
  return -1
}

const avgBandIndex = computed(() => {
  if (!activeDist.value) return -1
  return getBandIndexForValue(activeDist.value.average, activeDist.value)
})

const p95BandIndex = computed(() => {
  if (!activeDist.value) return -1
  return getBandIndexForValue(activeDist.value.p95, activeDist.value)
})

// Pinned Player Computed Metrics
const getPlayerMetricVal = (p: ServerPlayerRankingItem, metric: MetricKey): number => {
  switch (metric) {
    case 'kd': return p.kdRatio
    case 'score': return p.totalScore
    case 'kills': return p.totalKills
    case 'playtime': return p.minutesPlayed / 60
    case 'killrate': return p.killRate
    default: return p.kdRatio
  }
}

const pinnedMetricValue = computed<number | null>(() => {
  if (!pinnedPlayer.value) return null
  return getPlayerMetricVal(pinnedPlayer.value, activeMetric.value)
})

const pinnedPlayerBandIndex = computed(() => {
  if (!activeDist.value || pinnedMetricValue.value == null) return -1
  return getBandIndexForValue(pinnedMetricValue.value, activeDist.value)
})

const pinnedDiffAvg = computed<number | null>(() => {
  if (pinnedMetricValue.value == null || !activeDist.value) return null
  return pinnedMetricValue.value - activeDist.value.average
})

const pinnedDiffP95 = computed<number | null>(() => {
  if (pinnedMetricValue.value == null || !activeDist.value) return null
  return pinnedMetricValue.value - activeDist.value.p95
})

const formatDiff = (diff: number | null, metric: MetricKey): string => {
  if (diff == null) return '—'
  const sign = diff >= 0 ? '+' : ''
  if (metric === 'kd' || metric === 'killrate') {
    return `${sign}${diff.toFixed(2)}`
  }
  if (metric === 'playtime') {
    return `${sign}${diff.toFixed(1)}h`
  }
  return `${sign}${Math.round(diff).toLocaleString()}`
}

const chartData = computed<ChartData<'bar'>>(() => {
  const dist = activeDist.value
  if (!dist || !dist.bands || dist.bands.length === 0) {
    return { labels: [], datasets: [] }
  }

  const bgColors = dist.bands.map((_, idx) => {
    if (idx === pinnedPlayerBandIndex.value) return 'rgba(240, 160, 75, 0.90)' // Warm Amber for Pinned Player
    if (idx === p95BandIndex.value) return 'rgba(180, 192, 96, 0.85)' // Elite lifted olive for P95
    if (idx === avgBandIndex.value) return 'rgba(154, 166, 102, 0.85)' // Soft accent for Avg
    return 'rgba(125, 136, 73, 0.65)' // Default brand olive
  })

  const borderColors = dist.bands.map((_, idx) => {
    if (idx === pinnedPlayerBandIndex.value) return '#f0a04b' // Amber border for Pinned Player
    if (idx === p95BandIndex.value) return MM_CHART.elite
    if (idx === avgBandIndex.value) return MM_CHART.accentSoft
    return MM_CHART.accent
  })

  return {
    labels: dist.bands.map(b => b.label),
    datasets: [
      {
        label: 'Players',
        data: dist.bands.map(b => b.count),
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 1,
        borderRadius: 3,
      },
    ],
  }
})

const chartOptions = computed<ChartOptions<'bar'>>(() => {
  const dist = activeDist.value
  const maxCount = dist?.bands ? Math.max(1, ...dist.bands.map(b => b.count)) : 1

  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: MM_CHART.inkSoft,
          font: { family: 'var(--mm-font-mono, monospace)', size: 10 },
        },
      },
      y: {
        grid: { color: MM_CHART.grid },
        ticks: {
          color: MM_CHART.inkMuted,
          font: { family: 'var(--mm-font-mono, monospace)', size: 10 },
          precision: 0,
        },
        title: {
          display: true,
          text: 'Player count',
          color: MM_CHART.inkMuted,
          font: { family: 'var(--mm-font-mono, monospace)', size: 10 },
        },
        suggestedMax: Math.ceil(maxCount * 1.15),
        beginAtZero: true,
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: MM_CHART.surfaceSoft,
        titleColor: MM_CHART.ink,
        titleFont: { family: 'var(--mm-font-mono, monospace)', size: 12, weight: 'bold' },
        bodyColor: MM_CHART.inkSoft,
        bodyFont: { family: 'var(--mm-font-mono, monospace)', size: 11 },
        borderColor: MM_CHART.gridStrong,
        borderWidth: 1,
        padding: 10,
        callbacks: {
          title: (items: any[]) => {
            if (!items.length) return ''
            const idx = items[0].dataIndex
            const band = dist?.bands[idx]
            return band ? `Band: ${band.label} ${activeUnit.value}` : ''
          },
          label: (ctx: any) => {
            const idx = ctx.dataIndex
            const band = dist?.bands[idx]
            if (!band) return ''
            const pct = band.percentage.toFixed(1)
            return `${band.count} players (${pct}% of server)`
          },
          afterLabel: (ctx: any) => {
            const idx = ctx.dataIndex
            const notes: string[] = []
            if (idx === pinnedPlayerBandIndex.value && pinnedPlayer.value) {
              notes.push(`📍 ${$pn(pinnedPlayer.value.playerName)} (${formatMetricValue(pinnedMetricValue.value, activeMetric.value)}) is in this band`)
            }
            if (idx === avgBandIndex.value && dist) {
              notes.push(`⚡ Contains Server Avg (${formatMetricValue(dist.average, activeMetric.value)})`)
            }
            if (idx === p95BandIndex.value && dist) {
              notes.push(`★ Contains 95th Percentile (${formatMetricValue(dist.p95, activeMetric.value)})`)
            }
            return notes.join('\n')
          },
        },
      },
    },
  }
})

defineExpose({
  pinPlayer,
  clearPinnedPlayer,
})
</script>

<template>
  <div class="mm-rank-dist">
    <!-- Header with title -->
    <div class="mm-pbar">
      <span class="mm-pbar__t"># Rank distribution</span>
      <span class="mm-pbar__m">player performance curve · {{ selectedDays }}d window</span>
    </div>

    <!-- Controls Row: Metric Switcher + Filters -->
    <div class="mm-rank-dist__controls-row">
      <!-- Metric Switcher Tabs -->
      <div class="mm-subtabs mm-rank-dist__metric-subtabs">
        <button
          v-for="tab in metricTabs"
          :key="tab.id"
          type="button"
          class="mm-subtab"
          :class="{ 'mm-subtab--active': activeMetric === tab.id }"
          @click="activeMetric = tab.id"
        >{{ tab.label }}</button>
      </div>

      <!-- Filters: Min rounds & Window -->
      <div class="mm-rank-dist__filters-group">
        <!-- Min rounds filter -->
        <div class="mm-rank-dist__filter">
          <span class="mm-rank-dist__filter-label">Min rounds</span>
          <div class="mm-subtabs">
            <button
              v-for="rounds in minRoundsOptions"
              :key="rounds"
              type="button"
              class="mm-subtab"
              :class="{ 'mm-subtab--active': selectedMinRounds === rounds }"
              :disabled="isRefreshing"
              @click="selectedMinRounds = rounds"
            >{{ rounds }}+</button>
          </div>
        </div>

        <!-- Window filter -->
        <div class="mm-rank-dist__filter">
          <span class="mm-rank-dist__filter-label">Window</span>
          <div class="mm-subtabs">
            <button
              v-for="opt in dayOptions"
              :key="opt.value"
              type="button"
              class="mm-subtab"
              :class="{ 'mm-subtab--active': selectedDays === opt.value }"
              :disabled="isRefreshing"
              @click="selectedDays = opt.value"
            >{{ opt.label }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Player Benchmark Search Input -->
    <div class="mm-rank-dist__search-bar">
      <div ref="searchWrapRef" class="mm-rank-dist__search-wrap">
        <label class="mm-search mm-rank-dist__search">
          <svg class="mm-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            v-model="playerSearchQuery"
            type="text"
            class="mm-search__input"
            placeholder="Benchmark a player on curve (type name)…"
            @input="handlePlayerSearchInput"
            @focus="showSearchDropdown = playerSearchResults.length > 0"
          />
          <button
            v-if="playerSearchQuery"
            type="button"
            class="mm-search__clear"
            title="Clear search"
            @click="clearPlayerSearch"
          >×</button>
        </label>

        <!-- Dropdown Suggestions -->
        <div v-if="showSearchDropdown && (playerSearchResults.length > 0 || playerSearchLoading)" class="mm-rank-dist__dropdown">
          <div v-if="playerSearchLoading" class="mm-rank-dist__dropdown-item is-loading">
            Searching players on this server…
          </div>
          <div
            v-for="item in playerSearchResults"
            :key="item.playerName"
            class="mm-rank-dist__dropdown-item"
            @click="pinPlayer(item)"
          >
            <div class="mm-rank-dist__dd-name">
              <span class="mm-list__rank">#{{ item.rank }}</span>
              <span class="mm-list__name-primary">{{ $pn(item.playerName) }}</span>
            </div>
            <div class="mm-rank-dist__dd-stats">
              <span :class="kdClass(item.kdRatio)">{{ item.kdRatio.toFixed(2) }} K/D</span>
              <span class="is-muted">· {{ item.totalRounds }} rnds</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading skeleton -->
    <div v-if="loading" class="mm-panel__body">
      <div class="mm-rank-dist__kpis">
        <div v-for="i in 5" :key="i" class="mm-skeleton" style="height: 60px" />
      </div>
      <div class="mm-skeleton" style="height: 220px; margin-top: 14px" />
    </div>

    <!-- Error state -->
    <div v-else-if="error" class="mm-empty" style="border: 0; padding: 20px 0">
      {{ error }}
      <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="loadDistribution">Retry</button>
    </div>

    <!-- Empty state -->
    <div v-else-if="!data || data.totalPlayers === 0" class="mm-empty" style="border: 0; padding: 24px 0">
      No player activity recorded on this server for the selected window and round criteria.
    </div>

    <!-- Main Content: KPIs + Pinned Player Card + Distribution Bar Chart -->
    <div v-else-if="activeDist" class="mm-rank-dist__content" :class="{ 'is-refreshing': isRefreshing }">
      <!-- Pinned Player Benchmark Banner -->
      <div v-if="pinnedPlayer" class="mm-rank-dist__benchmark-banner">
        <div class="mm-rank-dist__bm-player">
          <div class="mm-rank-dist__bm-pin">
            <span class="mm-rank-dist__bm-dot" />
            <span>Pinned benchmark</span>
          </div>
          <div class="mm-rank-dist__bm-name">{{ $pn(pinnedPlayer.playerName) }}</div>
          <div class="mm-rank-dist__bm-meta">
            Rank #{{ pinnedPlayer.rank }} of {{ data.totalPlayers }} · {{ pinnedPlayer.totalRounds }} rounds
          </div>
        </div>

        <div class="mm-rank-dist__bm-stats">
          <div class="mm-rank-dist__bm-stat">
            <span class="mm-rank-dist__bm-label">Player {{ activeDist.metricName }}</span>
            <span class="mm-stat__value mm-rank-dist__bm-val">{{ formatMetricValue(pinnedMetricValue, activeMetric) }}</span>
          </div>

          <div class="mm-rank-dist__bm-stat">
            <span class="mm-rank-dist__bm-label">vs Server Avg</span>
            <span
              class="mm-rank-dist__bm-diff"
              :class="pinnedDiffAvg != null && pinnedDiffAvg >= 0 ? 'mm-bm-diff--pos' : 'mm-bm-diff--neg'"
            >
              {{ formatDiff(pinnedDiffAvg, activeMetric) }}
            </span>
          </div>

          <div class="mm-rank-dist__bm-stat">
            <span class="mm-rank-dist__bm-label">vs P95 (Top 5%)</span>
            <span
              class="mm-rank-dist__bm-diff"
              :class="pinnedDiffP95 != null && pinnedDiffP95 >= 0 ? 'mm-bm-diff--elite' : 'mm-bm-diff--neg'"
            >
              {{ formatDiff(pinnedDiffP95, activeMetric) }}
            </span>
          </div>
        </div>

        <button
          type="button"
          class="mm-btn mm-btn--inline mm-rank-dist__bm-clear"
          title="Unpin player"
          @click="clearPinnedPlayer"
        >✕ Unpin</button>
      </div>

      <!-- KPI stats grid -->
      <div class="mm-stats mm-rank-dist__kpis">
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Server average</div>
          <div class="mm-stat__value" :class="activeMetric === 'kd' ? kdClass(activeDist.average) : ''">
            {{ formatMetricValue(activeDist.average, activeMetric) }}
          </div>
          <div class="mm-stat__delta">overall mean</div>
        </div>

        <div class="mm-stats__cell mm-rank-dist__cell--p95">
          <div class="mm-stats__label">95th percentile (P95)</div>
          <div class="mm-stat__value mm-rank-dist__val--p95">
            {{ formatMetricValue(activeDist.p95, activeMetric) }}
          </div>
          <div class="mm-stat__delta">top 5% threshold</div>
        </div>

        <div class="mm-stats__cell">
          <div class="mm-stats__label">Median (P50)</div>
          <div class="mm-stat__value">
            {{ formatMetricValue(activeDist.median, activeMetric) }}
          </div>
          <div class="mm-stat__delta">50th percentile</div>
        </div>

        <div class="mm-stats__cell">
          <div class="mm-stats__label">Peak / Max</div>
          <div class="mm-stat__value">
            {{ formatMetricValue(activeDist.max, activeMetric) }}
          </div>
          <div class="mm-stat__delta">top player record</div>
        </div>

        <div class="mm-stats__cell mm-list__col--hide-sm">
          <div class="mm-stats__label">Ranked sample</div>
          <div class="mm-stat__value">
            {{ data.totalPlayers.toLocaleString() }}
          </div>
          <div class="mm-stat__delta">qualified players</div>
        </div>
      </div>

      <!-- Vertical Distribution Bar Chart -->
      <div class="mm-rank-dist__chart-wrap">
        <div class="mm-rank-dist__chart-canvas">
          <Bar :data="chartData" :options="chartOptions" />
        </div>

        <!-- Legend / Indicators -->
        <div class="mm-rank-dist__legend">
          <div class="mm-rank-dist__legend-item">
            <span class="mm-rank-dist__legend-dot" style="background: var(--mm-accent, #7d8849)" />
            <span>Distribution bands</span>
          </div>
          <div v-if="avgBandIndex >= 0" class="mm-rank-dist__legend-item">
            <span class="mm-rank-dist__legend-dot" style="background: #9aa666" />
            <span>Avg: <strong>{{ formatMetricValue(activeDist.average, activeMetric) }}</strong></span>
          </div>
          <div v-if="p95BandIndex >= 0" class="mm-rank-dist__legend-item">
            <span class="mm-rank-dist__legend-dot" style="background: var(--mm-elite, #b4c060)" />
            <span>P95: <strong>{{ formatMetricValue(activeDist.p95, activeMetric) }}</strong></span>
          </div>
          <div v-if="pinnedPlayer && pinnedPlayerBandIndex >= 0" class="mm-rank-dist__legend-item mm-rank-dist__legend-item--pinned">
            <span class="mm-rank-dist__legend-dot" style="background: #f0a04b" />
            <span>📍 <strong>{{ $pn(pinnedPlayer.playerName) }}</strong>: {{ formatMetricValue(pinnedMetricValue, activeMetric) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mm-rank-dist {
  display: flex;
  flex-direction: column;
  border-bottom: 1px solid var(--mm-rule, rgba(255, 255, 255, 0.08));
  padding-bottom: 18px;
  margin-bottom: 18px;
}

.mm-rank-dist__controls-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px 0;
}

.mm-rank-dist__filters-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}

.mm-rank-dist__filter {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mm-rank-dist__filter-label {
  font-family: var(--mm-font-mono, monospace);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-soft, #b3b3b3);
  font-weight: 500;
}

.mm-rank-dist__search-bar {
  padding: 10px 14px 0;
}

.mm-rank-dist__search-wrap {
  position: relative;
  width: 100%;
  max-width: 380px;
}

.mm-rank-dist__search {
  width: 100%;
}

.mm-rank-dist__dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  background: var(--mm-surface, #181818);
  border: 1px solid var(--mm-rule-strong, rgba(255, 255, 255, 0.15));
  border-radius: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  max-height: 260px;
  overflow-y: auto;
  z-index: 50;
}

.mm-rank-dist__dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--mm-rule, rgba(255, 255, 255, 0.04));
  transition: background 0.1s ease;
}

.mm-rank-dist__dropdown-item:last-child {
  border-bottom: 0;
}

.mm-rank-dist__dropdown-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.mm-rank-dist__dropdown-item.is-loading {
  cursor: default;
  font-family: var(--mm-font-mono, monospace);
  font-size: 11px;
  color: var(--mm-ink-muted, #8a8a8a);
  padding: 12px;
}

.mm-rank-dist__dd-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-rank-dist__dd-stats {
  font-family: var(--mm-font-mono, monospace);
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Pinned Player Benchmark Banner */
.mm-rank-dist__benchmark-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  background: rgba(240, 160, 75, 0.08);
  border: 1px solid rgba(240, 160, 75, 0.28);
  border-radius: 4px;
  padding: 10px 14px;
}

.mm-rank-dist__bm-player {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mm-rank-dist__bm-pin {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mm-font-mono, monospace);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #f0a04b;
  font-weight: 600;
}

.mm-rank-dist__bm-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f0a04b;
}

.mm-rank-dist__bm-name {
  font-family: var(--mm-font-display, sans-serif);
  font-size: 15px;
  font-weight: 600;
  color: var(--mm-ink, #ffffff);
}

.mm-rank-dist__bm-meta {
  font-family: var(--mm-font-mono, monospace);
  font-size: 11px;
  color: var(--mm-ink-muted, #8a8a8a);
}

.mm-rank-dist__bm-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}

.mm-rank-dist__bm-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mm-rank-dist__bm-label {
  font-family: var(--mm-font-mono, monospace);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted, #8a8a8a);
}

.mm-rank-dist__bm-val {
  font-size: 15px;
  color: #f0a04b;
  font-weight: 700;
}

.mm-rank-dist__bm-diff {
  font-family: var(--mm-font-mono, monospace);
  font-size: 13px;
  font-weight: 600;
}

.mm-bm-diff--pos {
  color: var(--mm-accent-soft, #9aa666);
}

.mm-bm-diff--elite {
  color: var(--mm-elite, #b4c060);
}

.mm-bm-diff--neg {
  color: var(--mm-ink-muted, #8a8a8a);
}

.mm-rank-dist__bm-clear {
  border-color: rgba(240, 160, 75, 0.4);
  color: #f0a04b;
}
.mm-rank-dist__bm-clear:hover {
  background: rgba(240, 160, 75, 0.15);
  border-color: #f0a04b;
}

.mm-rank-dist__content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px 14px 4px;
  transition: opacity 0.15s ease;
}

.mm-rank-dist__content.is-refreshing {
  opacity: 0.6;
  pointer-events: none;
}

.mm-rank-dist__kpis {
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
}

.mm-rank-dist__val--p95 {
  color: var(--mm-elite, #b4c060);
}

.mm-rank-dist__chart-wrap {
  background: var(--mm-surface-soft, rgba(255, 255, 255, 0.02));
  border: 1px solid var(--mm-rule, rgba(255, 255, 255, 0.06));
  border-radius: 4px;
  padding: 14px 14px 10px;
}

.mm-rank-dist__chart-canvas {
  height: 210px;
  width: 100%;
}

.mm-rank-dist__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--mm-rule, rgba(255, 255, 255, 0.04));
  font-family: var(--mm-font-mono, monospace);
  font-size: 11px;
  color: var(--mm-ink-muted, #8a8a8a);
}

.mm-rank-dist__legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mm-rank-dist__legend-item--pinned {
  color: #f0a04b;
}

.mm-rank-dist__legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  display: inline-block;
}

@media (max-width: 768px) {
  .mm-rank-dist__controls-row {
    flex-direction: column;
    align-items: flex-start;
  }
  .mm-rank-dist__filters-group {
    width: 100%;
    justify-content: space-between;
  }
  .mm-rank-dist__chart-canvas {
    height: 180px;
  }
  .mm-rank-dist__legend {
    justify-content: flex-start;
  }
  .mm-rank-dist__benchmark-banner {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
