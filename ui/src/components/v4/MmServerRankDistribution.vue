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
  type Plugin,
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

// Column Callout Plugin drawing graphical badges directly above the columns
const calloutPlugin = computed<Plugin<'bar'>>(() => {
  return {
    id: 'columnCallouts',
    afterDatasetsDraw(chart: any) {
      const { ctx, chartArea } = chart
      if (!chartArea) return
      const meta = chart.getDatasetMeta(0)
      if (!meta || !meta.data || meta.data.length === 0) return

      const dist = activeDist.value
      if (!dist || !dist.bands) return

      ctx.save()

      const drawCalloutBadge = (
        targetX: number,
        targetY: number,
        text: string,
        bgColor: string,
        textColor: string,
        borderColor: string,
        isPrimary: boolean = false,
      ) => {
        ctx.font = isPrimary
          ? 'bold 11px var(--mm-font-mono, monospace)'
          : '10px var(--mm-font-mono, monospace)'

        const textMetrics = ctx.measureText(text)
        const boxWidth = Math.max(textMetrics.width + 12, 36)
        const boxHeight = 20
        const radius = 3
        const pointerH = 4

        let boxX = targetX - boxWidth / 2
        if (boxX < chartArea.left + 2) boxX = chartArea.left + 2
        if (boxX + boxWidth > chartArea.right - 2) boxX = chartArea.right - boxWidth - 2

        const boxY = Math.max(chartArea.top + 2, targetY - boxHeight - pointerH - 2)

        if (isPrimary) {
          ctx.shadowColor = 'rgba(0, 0, 0, 0.4)'
          ctx.shadowBlur = 6
          ctx.shadowOffsetY = 2
        } else {
          ctx.shadowColor = 'transparent'
        }

        ctx.fillStyle = bgColor
        ctx.strokeStyle = borderColor
        ctx.lineWidth = isPrimary ? 1.5 : 1

        ctx.beginPath()
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(boxX, boxY, boxWidth, boxHeight, radius)
        } else {
          ctx.rect(boxX, boxY, boxWidth, boxHeight)
        }
        ctx.fill()
        ctx.stroke()

        if (boxY + boxHeight <= targetY - pointerH + 1) {
          ctx.beginPath()
          ctx.moveTo(targetX - 4, boxY + boxHeight)
          ctx.lineTo(targetX, targetY - 1)
          ctx.lineTo(targetX + 4, boxY + boxHeight)
          ctx.closePath()
          ctx.fill()
          ctx.stroke()
        }

        ctx.shadowColor = 'transparent'

        ctx.fillStyle = textColor
        ctx.textBaseline = 'middle'
        ctx.font = isPrimary
          ? 'bold 11px var(--mm-font-mono, monospace)'
          : '10px var(--mm-font-mono, monospace)'
        ctx.fillText(text, boxX + 6, boxY + boxHeight / 2 + 0.5)
      }

      // 1. Avg Column Callout
      if (avgBandIndex.value >= 0 && avgBandIndex.value !== pinnedPlayerBandIndex.value) {
        const bar = meta.data[avgBandIndex.value]
        if (bar) {
          const valStr = formatMetricValue(dist.average, activeMetric.value)
          drawCalloutBadge(
            bar.x,
            bar.y,
            `Avg: ${valStr}`,
            '#1f2416',
            '#a4b270',
            '#6a753d',
            false,
          )
        }
      }

      // 2. P95 Column Callout
      if (p95BandIndex.value >= 0 && p95BandIndex.value !== pinnedPlayerBandIndex.value) {
        const bar = meta.data[p95BandIndex.value]
        if (bar) {
          const valStr = formatMetricValue(dist.p95, activeMetric.value)
          drawCalloutBadge(
            bar.x,
            bar.y,
            `★ P95: ${valStr}`,
            '#272b14',
            '#c7d66d',
            '#8f9c3f',
            false,
          )
        }
      }

      // 3. Pinned Player Column Callout (Prominent Amber Pin)
      if (pinnedPlayer.value && pinnedPlayerBandIndex.value >= 0) {
        const bar = meta.data[pinnedPlayerBandIndex.value]
        if (bar) {
          const pName = $pn(pinnedPlayer.value.playerName)
          const pVal = formatMetricValue(pinnedMetricValue.value, activeMetric.value)
          drawCalloutBadge(
            bar.x,
            bar.y,
            `📍 ${pName} (${pVal})`,
            '#f0a04b',
            '#121212',
            '#ffffff',
            true,
          )
        }
      }

      ctx.restore()
    },
  }
})

const chartPlugins = computed(() => [calloutPlugin.value])

const chartOptions = computed<ChartOptions<'bar'>>(() => {
  const dist = activeDist.value
  const maxCount = dist?.bands ? Math.max(1, ...dist.bands.map(b => b.count)) : 1

  return {
    responsive: true,
    maintainAspectRatio: false,
    layout: {
      padding: {
        top: 28,
      },
    },
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
        suggestedMax: Math.ceil(maxCount * 1.35),
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
              notes.push(`📍 ${$pn(pinnedPlayer.value.playerName)} (${formatMetricValue(pinnedMetricValue.value, activeMetric.value)}) is in this column`)
            }
            if (idx === avgBandIndex.value && dist) {
              notes.push(`⚡ Server Avg: ${formatMetricValue(dist.average, activeMetric.value)}`)
            }
            if (idx === p95BandIndex.value && dist) {
              notes.push(`★ 95th Percentile: ${formatMetricValue(dist.p95, activeMetric.value)}`)
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
    <!-- Standard Header bar (Pure Typography on Olive Anchor Strip) -->
    <div class="mm-pbar">
      <span class="mm-pbar__t"># Rank distribution</span>
      <span class="mm-pbar__m">{{ activeDist?.metricName ?? 'Performance curve' }} · {{ selectedDays }}d window</span>
    </div>

    <!-- Controls Row on Dark Surface (Metric tabs + High-contrast Search + Filters) -->
    <div class="mm-rank-dist__controls-row">
      <!-- Left: Metric Switcher Tabs -->
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

      <!-- Right: Search Input + Filters Group -->
      <div class="mm-rank-dist__filters-group">
        <!-- Player Benchmark Search Input (Crisp White Typography on Dark Surface) -->
        <div ref="searchWrapRef" class="mm-rank-dist__search-wrap">
          <label class="mm-search mm-rank-dist__search">
            <svg class="mm-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              v-model="playerSearchQuery"
              type="text"
              class="mm-search__input mm-rank-dist__input"
              placeholder="Plot player on curve…"
              @input="handlePlayerSearchInput"
              @focus="showSearchDropdown = playerSearchResults.length > 0"
            />
            <button
              v-if="playerSearchQuery"
              type="button"
              class="mm-search__clear mm-rank-dist__clear-btn"
              title="Clear search"
              @click="clearPlayerSearch"
            >×</button>
          </label>

          <!-- Autocomplete Dropdown on Dark Surface -->
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

    <!-- Loading skeleton -->
    <div v-if="loading" class="mm-panel__body">
      <div class="mm-rank-dist__kpis">
        <div v-for="i in 5" :key="i" class="mm-skeleton" style="height: 48px" />
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
      No player activity recorded on this server for the selected criteria.
    </div>

    <!-- Main Content: Graphical Distribution Bar Chart + Callouts + Compact Metrics -->
    <div v-else-if="activeDist" class="mm-rank-dist__content" :class="{ 'is-refreshing': isRefreshing }">
      <!-- Pinned Player Graphical Tag Strip -->
      <div v-if="pinnedPlayer" class="mm-rank-dist__pinned-chip">
        <span class="mm-rank-dist__pin-icon">📍</span>
        <span class="mm-rank-dist__pin-name">{{ $pn(pinnedPlayer.playerName) }}</span>
        <span class="mm-rank-dist__pin-val">{{ formatMetricValue(pinnedMetricValue, activeMetric) }}</span>
        <span
          class="mm-rank-dist__pin-tag"
          :class="pinnedDiffAvg != null && pinnedDiffAvg >= 0 ? 'is-pos' : 'is-neg'"
        >
          {{ formatDiff(pinnedDiffAvg, activeMetric) }} vs avg
        </span>
        <span v-if="pinnedDiffP95 != null && pinnedDiffP95 >= 0" class="mm-rank-dist__pin-tag is-elite">
          ★ Top 5%
        </span>
        <span class="mm-rank-dist__pin-meta">Rank #{{ pinnedPlayer.rank }} · {{ pinnedPlayer.totalRounds }} rnds</span>
        <button type="button" class="mm-rank-dist__pin-clear" title="Unpin player" @click="clearPinnedPlayer">✕</button>
      </div>

      <!-- Vertical Distribution Bar Chart with Graphical Column Callouts -->
      <div class="mm-rank-dist__chart-wrap">
        <div class="mm-rank-dist__chart-canvas">
          <Bar :data="chartData" :options="chartOptions" :plugins="chartPlugins" />
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

      <!-- Minimal Compact KPI Strip -->
      <div class="mm-rank-dist__kpi-bar">
        <div class="mm-rank-dist__kpi-item">
          <span class="mm-rank-dist__kpi-label">Average</span>
          <span class="mm-rank-dist__kpi-val" :class="activeMetric === 'kd' ? kdClass(activeDist.average) : ''">
            {{ formatMetricValue(activeDist.average, activeMetric) }}
          </span>
        </div>
        <div class="mm-rank-dist__kpi-item mm-rank-dist__kpi-item--p95">
          <span class="mm-rank-dist__kpi-label">95th % (P95)</span>
          <span class="mm-rank-dist__kpi-val mm-rank-dist__kpi-val--p95">
            {{ formatMetricValue(activeDist.p95, activeMetric) }}
          </span>
        </div>
        <div class="mm-rank-dist__kpi-item">
          <span class="mm-rank-dist__kpi-label">Median (P50)</span>
          <span class="mm-rank-dist__kpi-val">
            {{ formatMetricValue(activeDist.median, activeMetric) }}
          </span>
        </div>
        <div class="mm-rank-dist__kpi-item">
          <span class="mm-rank-dist__kpi-label">Peak</span>
          <span class="mm-rank-dist__kpi-val">
            {{ formatMetricValue(activeDist.max, activeMetric) }}
          </span>
        </div>
        <div class="mm-rank-dist__kpi-item mm-list__col--hide-sm">
          <span class="mm-rank-dist__kpi-label">Sample</span>
          <span class="mm-rank-dist__kpi-val">
            {{ data.totalPlayers.toLocaleString() }}
          </span>
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
  padding-bottom: 16px;
  margin-bottom: 16px;
}

.mm-rank-dist__controls-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px 0;
  background: var(--mm-surface, #181818);
}

.mm-rank-dist__filters-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
}

/* High-Contrast Search Input on Dark Panel Body */
.mm-rank-dist__search-wrap {
  position: relative;
  width: 200px;
}

.mm-rank-dist__search {
  width: 100%;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.mm-rank-dist__search:focus-within {
  background: rgba(255, 255, 255, 0.1);
  border-color: #f0a04b;
}

.mm-rank-dist__search .mm-search__icon {
  color: #cccccc;
}

.mm-rank-dist__input {
  color: #ffffff !important;
  font-family: var(--mm-font-mono, monospace);
  font-size: 11px !important;
  padding-top: 5px !important;
  padding-bottom: 5px !important;
}

.mm-rank-dist__input::placeholder {
  color: #a0a0a0 !important;
  opacity: 1;
}

.mm-rank-dist__clear-btn {
  color: #ffffff !important;
}

.mm-rank-dist__dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  width: 280px;
  background: #181818;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.7);
  max-height: 240px;
  overflow-y: auto;
  z-index: 50;
}

.mm-rank-dist__dropdown-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  transition: background 0.1s ease;
}

.mm-rank-dist__dropdown-item:last-child {
  border-bottom: 0;
}

.mm-rank-dist__dropdown-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.mm-rank-dist__dropdown-item.is-loading {
  cursor: default;
  font-family: var(--mm-font-mono, monospace);
  font-size: 11px;
  color: #a0a0a0;
  padding: 10px;
}

.mm-rank-dist__dd-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #ffffff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-rank-dist__dd-stats {
  font-family: var(--mm-font-mono, monospace);
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 4px;
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
  color: #e0e0e0;
  font-weight: 600;
}

/* Pinned Player Compact Chip */
.mm-rank-dist__pinned-chip {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  background: rgba(240, 160, 75, 0.12);
  border: 1px solid rgba(240, 160, 75, 0.45);
  border-radius: 4px;
  padding: 6px 10px;
  font-family: var(--mm-font-mono, monospace);
  font-size: 11.5px;
  color: #ffffff;
  width: fit-content;
}

.mm-rank-dist__pin-icon {
  font-size: 12px;
}

.mm-rank-dist__pin-name {
  font-family: var(--mm-font-display, sans-serif);
  font-weight: 600;
  color: #f0a04b;
}

.mm-rank-dist__pin-val {
  font-weight: 700;
  color: #ffffff;
}

.mm-rank-dist__pin-tag {
  font-size: 10.5px;
  padding: 2px 6px;
  border-radius: 2px;
  font-weight: 500;
}

.mm-rank-dist__pin-tag.is-pos {
  background: rgba(154, 166, 102, 0.25);
  color: #b8c77e;
}

.mm-rank-dist__pin-tag.is-neg {
  background: rgba(255, 255, 255, 0.08);
  color: #b8b8b8;
}

.mm-rank-dist__pin-tag.is-elite {
  background: rgba(180, 192, 96, 0.3);
  color: #d6e676;
  font-weight: 600;
}

.mm-rank-dist__pin-meta {
  color: #a8a8a8;
  font-size: 10.5px;
}

.mm-rank-dist__pin-clear {
  background: none;
  border: none;
  color: #f0a04b;
  cursor: pointer;
  padding: 0 4px;
  font-size: 12px;
  opacity: 0.85;
}
.mm-rank-dist__pin-clear:hover {
  opacity: 1;
}

.mm-rank-dist__content {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px 2px;
  transition: opacity 0.15s ease;
}

.mm-rank-dist__content.is-refreshing {
  opacity: 0.6;
  pointer-events: none;
}

.mm-rank-dist__chart-wrap {
  background: var(--mm-surface-soft, rgba(255, 255, 255, 0.02));
  border: 1px solid var(--mm-rule, rgba(255, 255, 255, 0.06));
  border-radius: 4px;
  padding: 10px 14px 8px;
}

.mm-rank-dist__chart-canvas {
  height: 230px;
  width: 100%;
}

.mm-rank-dist__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid var(--mm-rule, rgba(255, 255, 255, 0.04));
  font-family: var(--mm-font-mono, monospace);
  font-size: 10.5px;
  color: #a8a8a8;
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

/* Minimal Compact KPI Strip */
.mm-rank-dist__kpi-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  padding: 8px 12px;
  font-family: var(--mm-font-mono, monospace);
}

.mm-rank-dist__kpi-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.mm-rank-dist__kpi-label {
  color: #a0a0a0;
  text-transform: uppercase;
  font-size: 9.5px;
  letter-spacing: 0.06em;
  font-weight: 500;
}

.mm-rank-dist__kpi-val {
  font-weight: 600;
  color: #ffffff;
}

.mm-rank-dist__kpi-val--p95 {
  color: #d6e676;
}

@media (max-width: 768px) {
  .mm-rank-dist__controls-row {
    flex-direction: column;
    align-items: flex-start;
  }
  .mm-rank-dist__filters-group {
    width: 100%;
    flex-direction: column;
    align-items: flex-start;
  }
  .mm-rank-dist__search-wrap {
    width: 100%;
  }
  .mm-rank-dist__dropdown {
    width: 100%;
  }
  .mm-rank-dist__chart-canvas {
    height: 190px;
  }
  .mm-rank-dist__legend {
    justify-content: flex-start;
  }
}
</style>
