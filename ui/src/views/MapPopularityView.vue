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
            <h1 class="text-lg sm:text-xl font-bold text-neutral-100">
              Map Popularity
            </h1>
            <p
              v-if="serverName"
              class="text-sm text-neutral-400"
            >
              {{ serverName }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <div class="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <!-- Loading -->
      <div
        v-if="loading"
        class="flex items-center justify-center py-20"
      >
        <div class="flex flex-col items-center gap-3">
          <div class="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin" />
          <span class="text-neutral-400 text-sm">Analysing map data...</span>
        </div>
      </div>

      <!-- Error -->
      <div
        v-else-if="error"
        class="text-center py-20"
      >
        <p class="text-red-400">
          {{ error }}
        </p>
        <button
          class="mt-4 px-4 py-2 bg-neutral-800 border border-neutral-600 rounded text-sm hover:bg-neutral-700 transition-colors"
          @click="loadData"
        >
          Retry
        </button>
      </div>

      <!-- Empty -->
      <div
        v-else-if="!data || data.rounds.length === 0"
        class="text-center py-20"
      >
        <p class="text-neutral-400">
          No round data available for this server in the selected period.
        </p>
      </div>

      <!-- Content -->
      <template v-else>
        <!-- Controls row -->
        <div class="flex items-center justify-between flex-wrap gap-3">
          <div class="flex items-center gap-4 flex-wrap">
            <!-- Period -->
            <div class="flex items-center gap-2">
              <span class="text-xs text-neutral-400 font-medium">Period:</span>
              <div class="flex gap-1">
                <button
                  v-for="opt in dayOptions"
                  :key="opt"
                  class="px-3 py-1 text-xs font-medium rounded border transition-all"
                  :class="selectedDays === opt
                    ? 'text-white bg-cyan-500/20 border-cyan-500/50'
                    : 'text-neutral-400 bg-neutral-800/50 border-neutral-700/50 hover:border-neutral-600'"
                  @click="selectedDays = opt; loadData()"
                >
                  {{ opt }}d
                </button>
              </div>
            </div>

            <!-- Time of day filter -->
            <div class="flex items-center gap-2">
              <span class="text-xs text-neutral-400 font-medium">Hours:</span>
              <div class="flex gap-1">
                <button
                  v-for="preset in hourPresets"
                  :key="preset.label"
                  class="px-3 py-1 text-xs font-medium rounded border transition-all"
                  :class="activeHourPreset === preset.label
                    ? 'text-white bg-amber-500/20 border-amber-500/50'
                    : 'text-neutral-400 bg-neutral-800/50 border-neutral-700/50 hover:border-neutral-600'"
                  @click="applyHourPreset(preset)"
                >
                  {{ preset.label }}
                </button>
              </div>
            </div>

            <!-- Custom hour range -->
            <div
              v-if="activeHourPreset === 'Custom'"
              class="flex items-center gap-1.5"
            >
              <select
                v-model.number="hourStart"
                class="bg-neutral-800 border border-neutral-700/50 rounded px-2 py-1 text-xs text-neutral-200 focus:border-amber-500/50 outline-none"
              >
                <option
                  v-for="h in 24"
                  :key="h - 1"
                  :value="h - 1"
                >
                  {{ (h - 1).toString().padStart(2, '0') }}:00
                </option>
              </select>
              <span class="text-xs text-neutral-500">to</span>
              <select
                v-model.number="hourEnd"
                class="bg-neutral-800 border border-neutral-700/50 rounded px-2 py-1 text-xs text-neutral-200 focus:border-amber-500/50 outline-none"
              >
                <option
                  v-for="h in 24"
                  :key="h - 1"
                  :value="h - 1"
                >
                  {{ (h - 1).toString().padStart(2, '0') }}:59
                </option>
              </select>
              <span class="text-xs text-neutral-500">(UTC)</span>
            </div>
          </div>

          <!-- Map filter toggle -->
          <button
            class="px-3 py-1 text-xs font-medium rounded border border-neutral-700/50 text-neutral-400 hover:border-neutral-600 hover:text-neutral-300 transition-all"
            @click="showMapFilter = !showMapFilter"
          >
            Filter Maps ({{ selectedMaps.size }}/{{ allMaps.length }})
          </button>
        </div>

        <!-- Active hour filter indicator -->
        <div
          v-if="activeHourPreset !== 'All'"
          class="text-xs text-amber-400/80 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2"
        >
          Showing averages for <strong>{{ hourRangeLabel }}</strong> only.
        </div>

        <!-- Map filter panel -->
        <div
          v-if="showMapFilter"
          class="bg-neutral-900/80 border border-neutral-700/50 rounded-xl p-4"
        >
          <div class="flex items-center justify-between mb-3">
            <span class="text-sm font-medium text-neutral-300">Select maps to display</span>
            <div class="flex gap-2">
              <button
                class="text-xs text-cyan-400 hover:text-cyan-300"
                @click="selectAllMaps"
              >
                Select all
              </button>
              <button
                class="text-xs text-neutral-400 hover:text-neutral-300"
                @click="deselectAllMaps"
              >
                Clear
              </button>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="map in allMaps"
              :key="map.mapName"
              class="px-3 py-1.5 text-xs rounded-lg border transition-all flex items-center gap-2"
              :class="selectedMaps.has(map.mapName)
                ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
                : 'border-neutral-700/50 bg-neutral-800/30 text-neutral-500 hover:text-neutral-400'"
              @click="toggleMap(map.mapName)"
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

        <!-- Average Players per Map (bar chart) -->
        <div class="bg-neutral-900/80 border border-neutral-700/50 rounded-xl p-4 sm:p-6">
          <h2 class="text-sm font-semibold text-neutral-200 mb-1">
            Average Players per Map
          </h2>
          <p class="text-xs text-neutral-500 mb-4">
            Maps in a rotation should track similarly. Low outliers indicate maps that drain the server.
          </p>
          <div :style="{ height: Math.max(200, filteredSummaries.length * 36) + 'px' }">
            <Bar
              :data="avgPlayersChartData"
              :options="avgPlayersChartOptions"
            />
          </div>
        </div>

        <!-- Time of Day Heatmap -->
        <div class="bg-neutral-900/80 border border-neutral-700/50 rounded-xl p-4 sm:p-6">
          <h2 class="text-sm font-semibold text-neutral-200 mb-1">
            Popularity by Time of Day
          </h2>
          <p class="text-xs text-neutral-500 mb-4">
            Average player count by hour (UTC). Brighter = more popular.
          </p>
          <div class="map-heatmap">
            <div class="heatmap-header">
              <div class="heatmap-map-label" />
              <div class="heatmap-hours">
                <span
                  v-for="h in 24"
                  :key="h - 1"
                  class="heatmap-hour-label"
                >{{ (h - 1).toString().padStart(2, '0') }}</span>
              </div>
            </div>
            <div
              v-for="summary in filteredSummaries"
              :key="summary.mapName"
              class="heatmap-row"
            >
              <div
                class="heatmap-map-label"
                :title="summary.mapName"
              >
                <span
                  class="inline-block w-2 h-2 rounded-full mr-1 flex-shrink-0"
                  :style="{ backgroundColor: getMapColor(summary.mapName) }"
                />
                <span class="truncate">{{ summary.mapName }}</span>
              </div>
              <div class="heatmap-cells">
                <div
                  v-for="h in 24"
                  :key="h - 1"
                  class="heatmap-cell"
                  :style="{
                    backgroundColor: getHeatColor(summary.hourlyAvgPlayers[h - 1]),
                    opacity: isHourInRange(h - 1) ? 1 : 0.25,
                    outline: isHourInRange(h - 1) && activeHourPreset !== 'All' ? '1px solid rgba(245, 158, 11, 0.3)' : 'none'
                  }"
                  :title="`${summary.mapName} @ ${(h - 1).toString().padStart(2, '0')}:00 — ${summary.hourlyAvgPlayers[h - 1].toFixed(1)} avg players`"
                />
              </div>
            </div>
            <div class="heatmap-legend">
              <span>0</span>
              <div class="heatmap-legend-colors">
                <div
                  v-for="(c, i) in heatLegendColors"
                  :key="i"
                  class="heatmap-legend-swatch"
                  :style="{ backgroundColor: c }"
                />
              </div>
              <span>{{ maxHourly.toFixed(0) }}</span>
            </div>
          </div>
        </div>

        <!-- Summary table -->
        <div class="bg-neutral-900/80 border border-neutral-700/50 rounded-xl p-4 sm:p-6">
          <h2 class="text-sm font-semibold text-neutral-200 mb-4">
            Map Summary
          </h2>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="text-left text-neutral-400 text-xs border-b border-neutral-700/50">
                  <th class="pb-2 pr-4">
                    Map
                  </th>
                  <th class="pb-2 pr-4 text-right">
                    Rounds
                  </th>
                  <th class="pb-2 pr-4 text-right">
                    Avg Players
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="s in filteredSummaries"
                  :key="s.mapName"
                  class="border-b border-neutral-800/50 hover:bg-neutral-800/30 transition-colors"
                >
                  <td class="py-2 pr-4 flex items-center gap-2">
                    <span
                      class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      :style="{ backgroundColor: getMapColor(s.mapName) }"
                    />
                    {{ s.mapName }}
                  </td>
                  <td class="py-2 pr-4 text-right font-mono text-neutral-300">
                    {{ s.totalRounds }}
                  </td>
                  <td class="py-2 pr-4 text-right font-mono text-neutral-300">
                    {{ s.avgConcurrentPlayers.toFixed(1) }}
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
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import type { MapPopularityResponse, MapPopularitySummary } from '../services/mapPopularityService'
import { fetchMapPopularity } from '../services/mapPopularityService'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

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

// Hour-of-day filter
const hourStart = ref(0)
const hourEnd = ref(23)
const activeHourPreset = ref('All')

interface HourPreset { label: string; start: number; end: number }

const hourPresets: HourPreset[] = [
  { label: 'All', start: 0, end: 23 },
  { label: 'Off-peak', start: 0, end: 11 },
  { label: 'Afternoon', start: 12, end: 17 },
  { label: 'Peak', start: 18, end: 23 },
  { label: 'Custom', start: -1, end: -1 },
]

function applyHourPreset(preset: HourPreset) {
  activeHourPreset.value = preset.label
  if (preset.start >= 0) {
    hourStart.value = preset.start
    hourEnd.value = preset.end
  }
  loadData()
}

// Reload when custom hour range changes
watch([hourStart, hourEnd], () => {
  if (activeHourPreset.value === 'Custom') loadData()
})

function isHourInRange(hour: number): boolean {
  if (hourStart.value <= hourEnd.value) {
    return hour >= hourStart.value && hour <= hourEnd.value
  }
  return hour >= hourStart.value || hour <= hourEnd.value
}

const hourRangeLabel = computed(() =>
  `${hourStart.value.toString().padStart(2, '0')}:00–${hourEnd.value.toString().padStart(2, '0')}:59 UTC`
)

const backLink = computed(() => {
  if (serverName.value) {
    return `/servers/${encodeURIComponent(serverName.value)}`;
  }
  return '/servers';
});

// --- Colors ---
const MAP_COLORS = [
  '#06b6d4', '#f59e0b', '#8b5cf6', '#10b981', '#f43f5e', '#3b82f6',
  '#ec4899', '#14b8a6', '#ef4444', '#a855f7', '#84cc16', '#f97316',
  '#6366f1', '#22d3ee', '#fbbf24', '#e879f9',
]

const mapColorIndex = ref<Record<string, number>>({})

function getMapColor(mapName: string): string {
  if (mapColorIndex.value[mapName] !== undefined) {
    return MAP_COLORS[mapColorIndex.value[mapName] % MAP_COLORS.length]
  }
  return '#555'
}

// --- Data ---
const allMaps = computed<MapPopularitySummary[]>(() => data.value?.mapSummaries ?? [])

// Summaries filtered by selected maps
const filteredSummaries = computed<MapPopularitySummary[]>(() =>
  allMaps.value
    .filter(m => selectedMaps.value.has(m.mapName))
    .sort((a, b) => b.avgConcurrentPlayers - a.avgConcurrentPlayers)
)

function selectAllMaps() { selectedMaps.value = new Set(allMaps.value.map(m => m.mapName)) }
function deselectAllMaps() { selectedMaps.value = new Set() }
function toggleMap(name: string) {
  const s = new Set(selectedMaps.value)
  if (s.has(name)) s.delete(name); else s.add(name)
  selectedMaps.value = s
}

// --- Average Players chart ---
const avgPlayersChartData = computed(() => {
  const sorted = [...filteredSummaries.value].sort((a, b) => a.avgConcurrentPlayers - b.avgConcurrentPlayers)
  return {
    labels: sorted.map(s => s.mapName),
    datasets: [{
      label: 'Avg Players',
      data: sorted.map(s => s.avgConcurrentPlayers),
      backgroundColor: sorted.map(s => getMapColor(s.mapName) + 'b3'),
      borderColor: sorted.map(s => getMapColor(s.mapName)),
      borderWidth: 1,
      borderRadius: 3,
    }],
  }
})

const avgPlayersChartOptions = computed(() => ({
  indexAxis: 'y' as const,
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: {
      grid: { color: 'rgba(255,255,255,0.04)' },
      ticks: { color: '#8b949e', font: { size: 10 } },
      title: { display: true, text: 'Avg Concurrent Players', color: '#8b949e', font: { size: 10 } },
      beginAtZero: true,
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
        label: (ctx: any) => `${ctx.parsed.x.toFixed(1)} avg players`,
      },
    },
  },
}))

// --- Time of Day Heatmap ---
const maxHourly = computed(() => {
  let max = 1
  for (const s of filteredSummaries.value) {
    for (const v of s.hourlyAvgPlayers) {
      if (v > max) max = v
    }
  }
  return max
})

const heatLegendColors = ['#111118', '#1a1a24', '#0d3d2d', '#0a5c45', '#07785c', '#00e5a0']

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
    const result = await fetchMapPopularity(
      serverGuid.value,
      selectedDays.value,
      activeHourPreset.value !== 'All' ? hourStart.value : undefined,
      activeHourPreset.value !== 'All' ? hourEnd.value : undefined
    )
    if (!result) {
      error.value = 'Server not found'
      return
    }
    data.value = result

    const colorMap: Record<string, number> = { ...mapColorIndex.value }
    let nextIdx = Object.keys(colorMap).length
    result.mapSummaries.forEach(m => {
      if (colorMap[m.mapName] === undefined) {
        colorMap[m.mapName] = nextIdx++
      }
    })
    mapColorIndex.value = colorMap

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

async function fetchServerName() {
  try {
    const { fetchServerDetail } = await import('../services/dataExplorerService')
    const detail = await fetchServerDetail(serverGuid.value)
    serverName.value = detail.name
  } catch { /* non-critical */ }
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
  .heatmap-map-label { width: 5rem; }
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
  .heatmap-hour-label:nth-child(odd) { visibility: hidden; }
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
