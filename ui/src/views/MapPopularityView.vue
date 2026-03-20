<template>
  <div class="min-h-screen bg-neutral-950 text-neutral-200">
    <!-- Header -->
    <div class="border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-sm sticky top-0 z-20">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 py-4">
        <div class="flex items-center gap-3">
          <router-link
            :to="backLink"
            class="text-neutral-400 hover:text-cyan-400 transition-colors"
          >
            &larr; Back
          </router-link>
          <div>
            <h1 class="text-lg sm:text-xl font-bold text-neutral-100">Map Popularity Report</h1>
            <p v-if="serverName" class="text-sm text-neutral-400">{{ serverName }}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center py-20">
        <div class="flex flex-col items-center gap-3">
          <div class="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
          <span class="text-neutral-400 text-sm">Analysing map rotations...</span>
        </div>
      </div>

      <!-- Error -->
      <div v-else-if="error" class="text-center py-20">
        <p class="text-red-400">{{ error }}</p>
        <button @click="loadData" class="mt-4 px-4 py-2 bg-neutral-800 border border-neutral-600 rounded text-sm hover:bg-neutral-700 transition-colors">
          Retry
        </button>
      </div>

      <!-- Empty -->
      <div v-else-if="!data || data.rounds.length === 0" class="text-center py-20">
        <p class="text-neutral-400">No round data available for this server in the selected period.</p>
      </div>

      <!-- Content -->
      <template v-else>
        <!-- Day selector -->
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div class="flex items-center gap-2">
            <span class="text-xs text-neutral-400 font-medium">Period:</span>
            <div class="flex gap-1">
              <button
                v-for="opt in dayOptions"
                :key="opt"
                @click="selectedDays = opt; loadData()"
                class="px-3 py-1 text-xs font-medium rounded border transition-all"
                :class="selectedDays === opt
                  ? 'text-white bg-cyan-500/20 border-cyan-500/50'
                  : 'text-neutral-400 bg-neutral-800/50 border-neutral-700/50 hover:border-neutral-600'"
              >
                {{ opt }}d
              </button>
            </div>
          </div>

          <!-- Map filter toggle -->
          <button
            @click="showMapFilter = !showMapFilter"
            class="px-3 py-1 text-xs font-medium rounded border border-neutral-700/50 text-neutral-400 hover:border-neutral-600 hover:text-neutral-300 transition-all"
          >
            Filter Maps ({{ selectedMaps.size }}/{{ allMaps.length }})
          </button>
        </div>

        <!-- Map filter panel -->
        <div v-if="showMapFilter" class="bg-neutral-900/80 border border-neutral-700/50 rounded-xl p-4">
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium text-neutral-300">Select maps to display</span>
            <div class="flex gap-2">
              <button @click="selectAllMaps" class="text-xs text-cyan-400 hover:text-cyan-300">Select all</button>
              <button @click="deselectAllMaps" class="text-xs text-neutral-400 hover:text-neutral-300">Clear</button>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="map in allMaps"
              :key="map.mapName"
              @click="toggleMap(map.mapName)"
              class="px-3 py-1.5 text-xs rounded-lg border transition-all flex items-center gap-2"
              :class="selectedMaps.has(map.mapName)
                ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
                : 'border-neutral-700/50 bg-neutral-800/30 text-neutral-500 hover:text-neutral-400'"
            >
              <span
                class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                :style="{ backgroundColor: getMapColor(map.mapName) }"
              />
              {{ map.mapName }}
              <span class="text-neutral-500">{{ map.totalRounds }}r</span>
            </button>
          </div>
        </div>

        <!-- Chart 1: Population Timeline -->
        <div class="bg-neutral-900/80 border border-neutral-700/50 rounded-xl p-4 sm:p-6">
          <h2 class="text-sm font-semibold text-neutral-200 mb-1">Population Timeline</h2>
          <p class="text-xs text-neutral-500 mb-4">Player count over time with map rotations. Coloured bands show which map was active.</p>
          <div class="h-64 sm:h-80">
            <Line :data="timelineChartData" :options="timelineChartOptions" />
          </div>
        </div>

        <!-- Chart 2 + 3 grid -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Map Impact Score -->
          <div class="bg-neutral-900/80 border border-neutral-700/50 rounded-xl p-4 sm:p-6">
            <h2 class="text-sm font-semibold text-neutral-200 mb-1">Map Impact Score</h2>
            <p class="text-xs text-neutral-500 mb-4">Avg player count change when this map starts. Red = drains server, green = attracts players.</p>
            <div :style="{ height: Math.max(200, filteredSummaries.length * 32) + 'px' }">
              <Bar :data="impactChartData" :options="impactChartOptions" />
            </div>
          </div>

          <!-- Time of Day Heatmap -->
          <div class="bg-neutral-900/80 border border-neutral-700/50 rounded-xl p-4 sm:p-6">
            <h2 class="text-sm font-semibold text-neutral-200 mb-1">Popularity by Time of Day</h2>
            <p class="text-xs text-neutral-500 mb-4">Average player count by hour (UTC). Brighter = more popular.</p>
            <div class="map-heatmap">
              <!-- Hour labels -->
              <div class="heatmap-header">
                <div class="heatmap-map-label"></div>
                <div class="heatmap-hours">
                  <span v-for="h in displayHours" :key="h" class="heatmap-hour-label">{{ h.toString().padStart(2, '0') }}</span>
                </div>
              </div>
              <!-- Rows -->
              <div v-for="summary in filteredSummaries" :key="summary.mapName" class="heatmap-row">
                <div class="heatmap-map-label" :title="summary.mapName">
                  <span
                    class="inline-block w-2 h-2 rounded-full mr-1 flex-shrink-0"
                    :style="{ backgroundColor: getMapColor(summary.mapName) }"
                  />
                  <span class="truncate">{{ summary.mapName }}</span>
                </div>
                <div class="heatmap-cells">
                  <div
                    v-for="h in displayHours"
                    :key="h"
                    class="heatmap-cell"
                    :style="{ backgroundColor: getHeatColor(summary.hourlyAvgPlayers[h]) }"
                    :title="`${summary.mapName} @ ${h.toString().padStart(2, '0')}:00 — ${summary.hourlyAvgPlayers[h].toFixed(1)} avg players`"
                  />
                </div>
              </div>
              <!-- Legend -->
              <div class="heatmap-legend">
                <span>0</span>
                <div class="heatmap-legend-colors">
                  <div v-for="(c, i) in heatLegendColors" :key="i" class="heatmap-legend-swatch" :style="{ backgroundColor: c }" />
                </div>
                <span>{{ maxHourly.toFixed(0) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Summary table -->
        <div class="bg-neutral-900/80 border border-neutral-700/50 rounded-xl p-4 sm:p-6">
          <h2 class="text-sm font-semibold text-neutral-200 mb-4">Map Summary</h2>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-neutral-400 text-xs border-b border-neutral-700/50">
                  <th class="pb-2 pr-4">Map</th>
                  <th class="pb-2 pr-4 text-right">Rounds</th>
                  <th class="pb-2 pr-4 text-right">Avg Players</th>
                  <th class="pb-2 pr-4 text-right">Impact</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="s in filteredSummaries"
                  :key="s.mapName"
                  class="border-b border-neutral-800/50 hover:bg-neutral-800/30 transition-colors"
                >
                  <td class="py-2 pr-4 flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" :style="{ backgroundColor: getMapColor(s.mapName) }" />
                    {{ s.mapName }}
                  </td>
                  <td class="py-2 pr-4 text-right font-mono text-neutral-300">{{ s.totalRounds }}</td>
                  <td class="py-2 pr-4 text-right font-mono text-neutral-300">{{ s.avgConcurrentPlayers.toFixed(1) }}</td>
                  <td class="py-2 pr-4 text-right font-mono" :class="s.avgPlayerDelta >= 0 ? 'text-emerald-400' : 'text-red-400'">
                    {{ s.avgPlayerDelta >= 0 ? '+' : '' }}{{ s.avgPlayerDelta.toFixed(1) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Line, Bar } from 'vue-chartjs'
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
  TimeScale,
} from 'chart.js'
import annotationPlugin from 'chartjs-plugin-annotation'
import 'chartjs-adapter-date-fns'
import type { MapPopularityResponse, MapPopularitySummary, MapPopularityRound } from '../services/mapPopularityService'
import { fetchMapPopularity } from '../services/mapPopularityService'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler, TimeScale, annotationPlugin)

const route = useRoute()
const serverGuid = computed(() => route.params.serverGuid as string)
const serverName = ref('')

const loading = ref(false)
const error = ref<string | null>(null)
const data = ref<MapPopularityResponse | null>(null)

const selectedDays = ref(7)
const dayOptions = [3, 7, 14, 30]
const showMapFilter = ref(false)
const selectedMaps = ref<Set<string>>(new Set())

const backLink = computed(() => `/explore/servers/${serverGuid.value}`)

// --- Colors ---
const MAP_COLORS = [
  '#06b6d4', // cyan
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#10b981', // emerald
  '#f43f5e', // rose
  '#3b82f6', // blue
  '#ec4899', // pink
  '#14b8a6', // teal
  '#ef4444', // red
  '#a855f7', // purple
  '#84cc16', // lime
  '#f97316', // orange
  '#6366f1', // indigo
  '#22d3ee', // cyan-lighter
  '#fbbf24', // yellow
  '#e879f9', // fuchsia
]

const mapColorIndex = ref<Record<string, number>>({})

function getMapColor(mapName: string): string {
  if (mapColorIndex.value[mapName] !== undefined) {
    return MAP_COLORS[mapColorIndex.value[mapName] % MAP_COLORS.length]
  }
  return '#555'
}

// --- Data ---
const allMaps = computed<MapPopularitySummary[]>(() =>
  data.value?.mapSummaries ?? []
)

const filteredSummaries = computed(() =>
  allMaps.value.filter(m => selectedMaps.value.has(m.mapName))
)

function selectAllMaps() {
  selectedMaps.value = new Set(allMaps.value.map(m => m.mapName))
}

function deselectAllMaps() {
  selectedMaps.value = new Set()
}

function toggleMap(name: string) {
  const s = new Set(selectedMaps.value)
  if (s.has(name)) s.delete(name); else s.add(name)
  selectedMaps.value = s
}

// --- Timeline chart ---
const timelineChartData = computed(() => {
  if (!data.value) return { labels: [], datasets: [] }

  const filtered = data.value.timeline.filter(
    p => p.mapName === null || selectedMaps.value.has(p.mapName)
  )

  return {
    datasets: [
      {
        label: 'Players',
        data: filtered.map(p => ({ x: new Date(p.timestamp).getTime(), y: p.playerCount })),
        borderColor: '#06b6d4',
        backgroundColor: 'rgba(6, 182, 212, 0.08)',
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: true,
        stepped: 'after' as const,
        tension: 0,
      },
    ],
  }
})

const timelineChartOptions = computed(() => {
  const annotations: Record<string, any> = {}

  if (data.value) {
    const visibleRounds = data.value.rounds.filter(r => selectedMaps.value.has(r.mapName))
    visibleRounds.forEach((round, i) => {
      const color = getMapColor(round.mapName)
      annotations[`round${i}`] = {
        type: 'box',
        xMin: new Date(round.startTime).getTime(),
        xMax: round.endTime ? new Date(round.endTime).getTime() : Date.now(),
        yMin: 0,
        backgroundColor: color + '15',
        borderColor: color + '40',
        borderWidth: 1,
        label: {
          display: shouldShowLabel(visibleRounds, i),
          content: round.mapName,
          position: { x: 'start', y: 'start' } as any,
          color: color,
          font: { size: 9, family: 'ui-monospace, monospace' },
          padding: 2,
        },
      }
    })
  }

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    scales: {
      x: {
        type: 'time' as const,
        time: { tooltipFormat: 'PPp' },
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#8b949e', font: { size: 10 }, maxTicksLimit: 10 },
      },
      y: {
        beginAtZero: true,
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: { color: '#8b949e', font: { size: 10 } },
        title: { display: true, text: 'Players', color: '#8b949e', font: { size: 10 } },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#161b22',
        borderColor: '#30363d',
        borderWidth: 1,
        titleColor: '#e6edf3',
        bodyColor: '#8b949e',
        callbacks: {
          afterBody: (items: any[]) => {
            if (!data.value || !items.length) return ''
            const ts = items[0].parsed.x
            const round = data.value.rounds.find(
              r => new Date(r.startTime).getTime() <= ts && (!r.endTime || new Date(r.endTime).getTime() >= ts)
            )
            return round ? `Map: ${round.mapName}` : ''
          },
        },
      },
      annotation: { annotations },
    },
  }
})

function shouldShowLabel(rounds: MapPopularityRound[], index: number): boolean {
  if (index === 0) return true
  return rounds[index].mapName !== rounds[index - 1].mapName
}

// --- Impact chart ---
const impactChartData = computed(() => {
  const sorted = [...filteredSummaries.value].sort((a, b) => a.avgPlayerDelta - b.avgPlayerDelta)

  return {
    labels: sorted.map(s => s.mapName),
    datasets: [
      {
        label: 'Avg Player Delta',
        data: sorted.map(s => s.avgPlayerDelta),
        backgroundColor: sorted.map(s =>
          s.avgPlayerDelta >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)'
        ),
        borderColor: sorted.map(s =>
          s.avgPlayerDelta >= 0 ? '#10b981' : '#ef4444'
        ),
        borderWidth: 1,
        borderRadius: 3,
      },
    ],
  }
})

const impactChartOptions = computed(() => ({
  indexAxis: 'y' as const,
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: {
      grid: { color: 'rgba(255,255,255,0.04)' },
      ticks: { color: '#8b949e', font: { size: 10 } },
      title: { display: true, text: 'Avg Player Change', color: '#8b949e', font: { size: 10 } },
    },
    y: {
      grid: { display: false },
      ticks: { color: '#e6edf3', font: { size: 11 } },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#161b22',
      borderColor: '#30363d',
      borderWidth: 1,
      titleColor: '#e6edf3',
      bodyColor: '#8b949e',
      callbacks: {
        label: (ctx: any) => {
          const val = ctx.parsed.x
          return `${val >= 0 ? '+' : ''}${val.toFixed(1)} players avg`
        },
      },
    },
  },
}))

// --- Heatmap ---
const displayHours = computed(() => {
  // Show every hour on desktop, every 2h on mobile (handled via CSS)
  return Array.from({ length: 24 }, (_, i) => i)
})

const maxHourly = computed(() => {
  let max = 1
  for (const s of filteredSummaries.value) {
    for (const v of s.hourlyAvgPlayers) {
      if (v > max) max = v
    }
  }
  return max
})

const heatLegendColors = [
  '#111118',
  '#1a1a24',
  '#0d3d2d',
  '#0a5c45',
  '#07785c',
  '#00e5a0',
]

function getHeatColor(value: number): string {
  if (value === 0) return heatLegendColors[0]
  const intensity = value / maxHourly.value
  const idx = Math.min(Math.floor(intensity * heatLegendColors.length), heatLegendColors.length - 1)
  return heatLegendColors[idx]
}

// --- Load ---
async function loadData() {
  loading.value = true
  error.value = null
  try {
    const result = await fetchMapPopularity(serverGuid.value, selectedDays.value)
    if (!result) {
      error.value = 'Server not found'
      return
    }
    data.value = result

    // Preserve existing color assignments, only assign new indices for new maps
    const colorMap: Record<string, number> = { ...mapColorIndex.value }
    let nextIdx = Object.keys(colorMap).length
    result.mapSummaries.forEach(m => {
      if (colorMap[m.mapName] === undefined) {
        colorMap[m.mapName] = nextIdx++
      }
    })
    mapColorIndex.value = colorMap

    // Auto-select all maps on first load, add new maps on reload
    const allMapNames = new Set(result.mapSummaries.map(m => m.mapName))
    if (selectedMaps.value.size === 0) {
      selectedMaps.value = allMapNames
    } else {
      const updated = new Set(selectedMaps.value)
      for (const name of allMapNames) {
        if (!updated.has(name)) updated.add(name)
      }
      selectedMaps.value = updated
    }
  } catch (e: any) {
    error.value = e.message || 'Failed to load data'
  } finally {
    loading.value = false
  }
}

// Fetch server name
async function fetchServerName() {
  try {
    const { fetchServerDetail } = await import('../services/dataExplorerService')
    const detail = await fetchServerDetail(serverGuid.value)
    serverName.value = detail.name
  } catch {
    // non-critical
  }
}

onMounted(() => {
  loadData()
  fetchServerName()
})
</script>

<style scoped>
/* Heatmap styles */
.map-heatmap {
  width: 100%;
  overflow-x: auto;
}

.heatmap-header {
  display: flex;
  margin-bottom: 0.25rem;
}

.heatmap-map-label {
  width: 7rem;
  flex-shrink: 0;
  font-size: 0.65rem;
  color: #8b949e;
  font-family: ui-monospace, monospace;
  display: flex;
  align-items: center;
  overflow: hidden;
}

@media (max-width: 640px) {
  .heatmap-map-label {
    width: 5rem;
  }
}

.heatmap-hours {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(24, minmax(0, 1fr));
  gap: 1px;
}

.heatmap-hour-label {
  text-align: center;
  font-size: 0.5rem;
  color: #8b949e;
  font-family: ui-monospace, monospace;
}

@media (max-width: 640px) {
  .heatmap-hour-label:nth-child(odd) {
    visibility: hidden;
  }
}

.heatmap-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-bottom: 1px;
}

.heatmap-cells {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(24, minmax(0, 1fr));
  gap: 1px;
}

.heatmap-cell {
  aspect-ratio: 2 / 1;
  border-radius: 2px;
  transition: box-shadow 0.2s;
  min-height: 12px;
}

.heatmap-cell:hover {
  box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.3);
}

.heatmap-legend {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  font-size: 0.65rem;
  color: #8b949e;
}

.heatmap-legend-colors {
  display: flex;
  gap: 1px;
}

.heatmap-legend-swatch {
  width: 1rem;
  height: 0.75rem;
  border-radius: 2px;
}
</style>
