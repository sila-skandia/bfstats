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

            <!-- Time of day filter -->
            <div class="flex items-center gap-2">
              <span class="text-xs text-neutral-400 font-medium">Hours:</span>
              <div class="flex gap-1">
                <button
                  v-for="preset in hourPresets"
                  :key="preset.label"
                  @click="applyHourPreset(preset)"
                  class="px-3 py-1 text-xs font-medium rounded border transition-all"
                  :class="activeHourPreset === preset.label
                    ? 'text-white bg-amber-500/20 border-amber-500/50'
                    : 'text-neutral-400 bg-neutral-800/50 border-neutral-700/50 hover:border-neutral-600'"
                >
                  {{ preset.label }}
                </button>
              </div>
            </div>

            <!-- Custom hour range -->
            <div v-if="activeHourPreset === 'Custom'" class="flex items-center gap-1.5">
              <select
                v-model.number="hourStart"
                class="bg-neutral-800 border border-neutral-700/50 rounded px-2 py-1 text-xs text-neutral-200 focus:border-amber-500/50 outline-none"
              >
                <option v-for="h in 24" :key="h - 1" :value="h - 1">{{ (h - 1).toString().padStart(2, '0') }}:00</option>
              </select>
              <span class="text-xs text-neutral-500">to</span>
              <select
                v-model.number="hourEnd"
                class="bg-neutral-800 border border-neutral-700/50 rounded px-2 py-1 text-xs text-neutral-200 focus:border-amber-500/50 outline-none"
              >
                <option v-for="h in 24" :key="h - 1" :value="h - 1">{{ (h - 1).toString().padStart(2, '0') }}:59</option>
              </select>
              <span class="text-xs text-neutral-500">(UTC)</span>
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

        <!-- Active hour filter indicator -->
        <div v-if="activeHourPreset !== 'All'" class="text-xs text-amber-400/80 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
          Filtering transitions and averages to <strong>{{ hourRangeLabel }}</strong> only.
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
              <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" :style="{ backgroundColor: getMapColor(map.mapName) }" />
              {{ map.mapName }}
              <span class="text-neutral-500">{{ map.totalRounds }}r</span>
            </button>
          </div>
        </div>

        <!-- Worst Transitions -->
        <div class="bg-neutral-900/80 border border-neutral-700/50 rounded-xl p-4 sm:p-6">
          <h2 class="text-sm font-semibold text-neutral-200 mb-1">Map Transitions</h2>
          <p class="text-xs text-neutral-500 mb-4">What happens to player count when the rotation moves between maps. Sorted by most damaging.</p>

          <div v-if="sortedTransitions.length === 0" class="text-center py-8 text-neutral-500 text-sm">
            Not enough round data to compute transitions.
          </div>
          <div v-else class="space-y-1.5">
            <div
              v-for="t in sortedTransitions"
              :key="`${t.fromMap}-${t.toMap}`"
              class="transition-row"
            >
              <!-- From → To -->
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <span class="w-2 h-2 rounded-full flex-shrink-0" :style="{ backgroundColor: getMapColor(t.fromMap) }" />
                <span class="truncate text-neutral-300 text-sm">{{ t.fromMap }}</span>
                <span class="text-neutral-600 flex-shrink-0">&rarr;</span>
                <span class="w-2 h-2 rounded-full flex-shrink-0" :style="{ backgroundColor: getMapColor(t.toMap) }" />
                <span class="truncate text-neutral-300 text-sm">{{ t.toMap }}</span>
              </div>

              <!-- Stats -->
              <div class="flex items-center gap-3 flex-shrink-0 text-xs">
                <span class="text-neutral-500 hidden sm:inline" :title="`${t.count} transitions observed`">{{ t.count }}x</span>
                <span class="font-mono text-neutral-400 hidden sm:inline">{{ t.avgBefore.toFixed(0) }}</span>
                <span class="text-neutral-600 hidden sm:inline">&rarr;</span>
                <span class="font-mono text-neutral-400 hidden sm:inline">{{ t.avgAfter.toFixed(0) }}</span>

                <!-- Delta with visual bar -->
                <div class="flex items-center gap-1.5 w-28 sm:w-36">
                  <div class="flex-1 h-3 bg-neutral-800 rounded-sm overflow-hidden relative">
                    <!-- Center line -->
                    <div class="absolute top-0 bottom-0 left-1/2 w-px bg-neutral-600 z-10" />
                    <!-- Bar -->
                    <div
                      class="absolute top-0 bottom-0 rounded-sm"
                      :style="getTransitionBarStyle(t.avgDelta)"
                    />
                  </div>
                  <span
                    class="font-mono text-xs w-12 text-right font-medium"
                    :class="t.avgDelta >= 0 ? 'text-emerald-400' : 'text-red-400'"
                  >
                    {{ t.avgDelta >= 0 ? '+' : '' }}{{ t.avgDelta.toFixed(1) }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Transition Matrix + Impact Chart grid -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <!-- Transition Matrix -->
          <div class="bg-neutral-900/80 border border-neutral-700/50 rounded-xl p-4 sm:p-6">
            <h2 class="text-sm font-semibold text-neutral-200 mb-1">Transition Matrix</h2>
            <p class="text-xs text-neutral-500 mb-4">Row = from, Column = to. Red = server drains, green = players join.</p>
            <div class="transition-matrix" v-if="matrixMaps.length > 0">
              <!-- Column headers -->
              <div class="matrix-header">
                <div class="matrix-label-corner"></div>
                <div
                  v-for="map in matrixMaps"
                  :key="`col-${map}`"
                  class="matrix-col-label"
                  :title="map"
                >
                  <span class="w-2 h-2 rounded-full inline-block" :style="{ backgroundColor: getMapColor(map) }" />
                </div>
              </div>
              <!-- Rows -->
              <div v-for="fromMap in matrixMaps" :key="`row-${fromMap}`" class="matrix-row">
                <div class="matrix-row-label" :title="fromMap">
                  <span class="truncate">{{ fromMap }}</span>
                </div>
                <div
                  v-for="toMap in matrixMaps"
                  :key="`cell-${fromMap}-${toMap}`"
                  class="matrix-cell"
                  :style="{ backgroundColor: getMatrixCellColor(fromMap, toMap) }"
                  :title="getMatrixTooltip(fromMap, toMap)"
                />
              </div>
              <!-- Legend -->
              <div class="heatmap-legend mt-3">
                <span class="text-red-400">Drains</span>
                <div class="heatmap-legend-colors">
                  <div class="heatmap-legend-swatch" style="background-color: rgba(239, 68, 68, 0.6)" />
                  <div class="heatmap-legend-swatch" style="background-color: rgba(239, 68, 68, 0.25)" />
                  <div class="heatmap-legend-swatch" style="background-color: #1a1a24" />
                  <div class="heatmap-legend-swatch" style="background-color: rgba(16, 185, 129, 0.25)" />
                  <div class="heatmap-legend-swatch" style="background-color: rgba(16, 185, 129, 0.6)" />
                </div>
                <span class="text-emerald-400">Attracts</span>
              </div>
            </div>
          </div>

          <!-- Map Impact Score -->
          <div class="bg-neutral-900/80 border border-neutral-700/50 rounded-xl p-4 sm:p-6">
            <h2 class="text-sm font-semibold text-neutral-200 mb-1">Map Impact Score</h2>
            <p class="text-xs text-neutral-500 mb-4">Overall avg player change when this map starts, regardless of what came before.</p>
            <div :style="{ height: Math.max(200, filteredSummaries.length * 32) + 'px' }">
              <Bar :data="impactChartData" :options="impactChartOptions" />
            </div>
          </div>
        </div>

        <!-- Time of Day Heatmap -->
        <div class="bg-neutral-900/80 border border-neutral-700/50 rounded-xl p-4 sm:p-6">
          <h2 class="text-sm font-semibold text-neutral-200 mb-1">Popularity by Time of Day</h2>
          <p class="text-xs text-neutral-500 mb-4">Average player count by hour (UTC). Brighter = more popular.</p>
          <div class="map-heatmap">
            <div class="heatmap-header">
              <div class="heatmap-map-label"></div>
              <div class="heatmap-hours">
                <span v-for="h in displayHours" :key="h" class="heatmap-hour-label">{{ h.toString().padStart(2, '0') }}</span>
              </div>
            </div>
            <div v-for="summary in filteredSummaries" :key="summary.mapName" class="heatmap-row">
              <div class="heatmap-map-label" :title="summary.mapName">
                <span class="inline-block w-2 h-2 rounded-full mr-1 flex-shrink-0" :style="{ backgroundColor: getMapColor(summary.mapName) }" />
                <span class="truncate">{{ summary.mapName }}</span>
              </div>
              <div class="heatmap-cells">
                <div
                  v-for="h in displayHours"
                  :key="h"
                  class="heatmap-cell"
                  :style="{
                    backgroundColor: getHeatColor(summary.hourlyAvgPlayers[h]),
                    opacity: isHourInRange(h) ? 1 : 0.25,
                    outline: isHourInRange(h) && activeHourPreset !== 'All' ? '1px solid rgba(245, 158, 11, 0.3)' : 'none'
                  }"
                  :title="`${summary.mapName} @ ${h.toString().padStart(2, '0')}:00 — ${summary.hourlyAvgPlayers[h].toFixed(1)} avg players`"
                />
              </div>
            </div>
            <div class="heatmap-legend">
              <span>0</span>
              <div class="heatmap-legend-colors">
                <div v-for="(c, i) in heatLegendColors" :key="i" class="heatmap-legend-swatch" :style="{ backgroundColor: c }" />
              </div>
              <span>{{ maxHourly.toFixed(0) }}</span>
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
}

function isHourInRange(hour: number): boolean {
  if (hourStart.value <= hourEnd.value) {
    return hour >= hourStart.value && hour <= hourEnd.value
  }
  return hour >= hourStart.value || hour <= hourEnd.value
}

const hourRangeLabel = computed(() =>
  `${hourStart.value.toString().padStart(2, '0')}:00–${hourEnd.value.toString().padStart(2, '0')}:59 UTC`
)

const backLink = computed(() => `/explore/servers/${serverGuid.value}`)

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

// Timeline points filtered by selected hour range
const hourFilteredTimeline = computed(() => {
  if (!data.value) return []
  if (activeHourPreset.value === 'All') return data.value.timeline
  return data.value.timeline.filter(p => {
    const hour = new Date(p.timestamp).getUTCHours()
    return isHourInRange(hour)
  })
})

// --- Transitions ---

interface MapTransition {
  fromMap: string
  toMap: string
  count: number
  avgBefore: number
  avgAfter: number
  avgDelta: number
  worstDelta: number
}

const transitions = computed<MapTransition[]>(() => {
  if (!data.value || data.value.rounds.length < 2) return []
  const rounds = data.value.rounds
  const timeline = hourFilteredTimeline.value

  // Pre-compute round avg player counts from (hour-filtered) timeline
  const roundAvgs: number[] = []
  for (const round of rounds) {
    const startMs = new Date(round.startTime).getTime()
    const endMs = round.endTime ? new Date(round.endTime).getTime() : Date.now()
    const pts = timeline.filter(p => {
      const ts = new Date(p.timestamp).getTime()
      return ts >= startMs && ts <= endMs
    })
    roundAvgs.push(pts.length > 0 ? pts.reduce((s, p) => s + p.playerCount, 0) / pts.length : -1)
  }

  // Collect individual transitions
  const grouped: Record<string, { count: number; totalBefore: number; totalAfter: number; deltas: number[] }> = {}

  for (let i = 1; i < rounds.length; i++) {
    // Skip if either round has no data in the selected hours
    if (roundAvgs[i] < 0 || roundAvgs[i - 1] < 0) continue
    // Skip if either map is not selected
    if (!selectedMaps.value.has(rounds[i].mapName) || !selectedMaps.value.has(rounds[i - 1].mapName)) continue

    const key = `${rounds[i - 1].mapName}\0${rounds[i].mapName}`
    const g = grouped[key] ??= { count: 0, totalBefore: 0, totalAfter: 0, deltas: [] }
    g.count++
    g.totalBefore += roundAvgs[i - 1]
    g.totalAfter += roundAvgs[i]
    g.deltas.push(roundAvgs[i] - roundAvgs[i - 1])
  }

  return Object.entries(grouped).map(([key, g]) => {
    const [fromMap, toMap] = key.split('\0')
    return {
      fromMap,
      toMap,
      count: g.count,
      avgBefore: g.totalBefore / g.count,
      avgAfter: g.totalAfter / g.count,
      avgDelta: g.deltas.reduce((s, v) => s + v, 0) / g.deltas.length,
      worstDelta: Math.min(...g.deltas),
    }
  })
})

const sortedTransitions = computed(() =>
  [...transitions.value].sort((a, b) => a.avgDelta - b.avgDelta)
)

// Max absolute delta for scaling the visual bars
const maxAbsDelta = computed(() => {
  let max = 1
  for (const t of transitions.value) {
    const abs = Math.abs(t.avgDelta)
    if (abs > max) max = abs
  }
  return max
})

function getTransitionBarStyle(delta: number) {
  const pct = Math.abs(delta) / maxAbsDelta.value * 50 // max 50% of bar width
  if (delta >= 0) {
    return { left: '50%', width: `${pct}%`, backgroundColor: 'rgba(16, 185, 129, 0.6)' }
  }
  return { right: '50%', width: `${pct}%`, backgroundColor: 'rgba(239, 68, 68, 0.6)' }
}

// --- Transition matrix ---
const matrixMaps = computed(() => {
  // Only maps involved in transitions, ordered by round count
  const involved = new Set<string>()
  for (const t of transitions.value) {
    involved.add(t.fromMap)
    involved.add(t.toMap)
  }
  return allMaps.value
    .filter(m => involved.has(m.mapName))
    .map(m => m.mapName)
})

const transitionLookup = computed(() => {
  const map = new Map<string, MapTransition>()
  for (const t of transitions.value) {
    map.set(`${t.fromMap}\0${t.toMap}`, t)
  }
  return map
})

function getMatrixCellColor(fromMap: string, toMap: string): string {
  if (fromMap === toMap) return '#1a1a24'
  const t = transitionLookup.value.get(`${fromMap}\0${toMap}`)
  if (!t) return '#111118'
  const intensity = Math.min(Math.abs(t.avgDelta) / maxAbsDelta.value, 1)
  if (t.avgDelta >= 0) {
    return `rgba(16, 185, 129, ${0.1 + intensity * 0.5})`
  }
  return `rgba(239, 68, 68, ${0.1 + intensity * 0.5})`
}

function getMatrixTooltip(fromMap: string, toMap: string): string {
  if (fromMap === toMap) return `${fromMap} (same map)`
  const t = transitionLookup.value.get(`${fromMap}\0${toMap}`)
  if (!t) return `${fromMap} → ${toMap}: no data`
  const sign = t.avgDelta >= 0 ? '+' : ''
  return `${fromMap} → ${toMap}\n${t.count}x observed\nAvg: ${t.avgBefore.toFixed(1)} → ${t.avgAfter.toFixed(1)} (${sign}${t.avgDelta.toFixed(1)})`
}

// --- Recomputed summaries ---
const filteredSummaries = computed<MapPopularitySummary[]>(() => {
  if (!data.value) return []
  const isFiltered = activeHourPreset.value !== 'All'

  if (!isFiltered) {
    return allMaps.value.filter(m => selectedMaps.value.has(m.mapName))
  }

  const timeline = hourFilteredTimeline.value
  const rounds = data.value.rounds

  const mapPoints: Record<string, number[]> = {}
  for (const p of timeline) {
    if (p.mapName && selectedMaps.value.has(p.mapName)) {
      ;(mapPoints[p.mapName] ??= []).push(p.playerCount)
    }
  }

  const roundAvgs: number[] = []
  for (const round of rounds) {
    const startMs = new Date(round.startTime).getTime()
    const endMs = round.endTime ? new Date(round.endTime).getTime() : Date.now()
    const points = timeline.filter(p => {
      const ts = new Date(p.timestamp).getTime()
      return ts >= startMs && ts <= endMs
    })
    roundAvgs.push(points.length > 0 ? points.reduce((s, p) => s + p.playerCount, 0) / points.length : 0)
  }

  const mapDeltas: Record<string, number[]> = {}
  for (let i = 1; i < rounds.length; i++) {
    if (roundAvgs[i] === 0 && roundAvgs[i - 1] === 0) continue
    ;(mapDeltas[rounds[i].mapName] ??= []).push(roundAvgs[i] - roundAvgs[i - 1])
  }

  const mapRoundCounts: Record<string, number> = {}
  for (const r of rounds) {
    mapRoundCounts[r.mapName] = (mapRoundCounts[r.mapName] ?? 0) + 1
  }

  return Object.keys(mapPoints)
    .filter(name => selectedMaps.value.has(name))
    .map(mapName => {
      const pts = mapPoints[mapName]
      const avgConcurrent = pts.length > 0 ? pts.reduce((s, v) => s + v, 0) / pts.length : 0
      const deltas = mapDeltas[mapName]
      const avgDelta = deltas?.length ? deltas.reduce((s, v) => s + v, 0) / deltas.length : 0
      const apiSummary = allMaps.value.find(m => m.mapName === mapName)

      return {
        mapName,
        totalRounds: mapRoundCounts[mapName] ?? 0,
        avgConcurrentPlayers: Math.round(avgConcurrent * 10) / 10,
        avgPlayerDelta: Math.round(avgDelta * 10) / 10,
        hourlyAvgPlayers: apiSummary?.hourlyAvgPlayers ?? new Array(24).fill(0),
      } as MapPopularitySummary
    })
    .sort((a, b) => b.totalRounds - a.totalRounds)
})

function selectAllMaps() { selectedMaps.value = new Set(allMaps.value.map(m => m.mapName)) }
function deselectAllMaps() { selectedMaps.value = new Set() }
function toggleMap(name: string) {
  const s = new Set(selectedMaps.value)
  if (s.has(name)) s.delete(name); else s.add(name)
  selectedMaps.value = s
}

// --- Impact chart ---
const impactChartData = computed(() => {
  const sorted = [...filteredSummaries.value].sort((a, b) => a.avgPlayerDelta - b.avgPlayerDelta)
  return {
    labels: sorted.map(s => s.mapName),
    datasets: [{
      label: 'Avg Player Delta',
      data: sorted.map(s => s.avgPlayerDelta),
      backgroundColor: sorted.map(s =>
        s.avgPlayerDelta >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)'
      ),
      borderColor: sorted.map(s => s.avgPlayerDelta >= 0 ? '#10b981' : '#ef4444'),
      borderWidth: 1,
      borderRadius: 3,
    }],
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

// --- Time of Day Heatmap ---
const displayHours = computed(() => Array.from({ length: 24 }, (_, i) => i))

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
    const result = await fetchMapPopularity(serverGuid.value, selectedDays.value)
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
/* Transition rows */
.transition-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid transparent;
  transition: all 0.15s;
}

.transition-row:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.06);
}

/* Transition matrix */
.transition-matrix {
  overflow-x: auto;
}

.matrix-header {
  display: flex;
  gap: 1px;
  margin-bottom: 1px;
}

.matrix-label-corner {
  width: 5.5rem;
  flex-shrink: 0;
}

@media (max-width: 640px) {
  .matrix-label-corner {
    width: 4rem;
  }
}

.matrix-col-label {
  flex: 1;
  min-width: 1.25rem;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 0.25rem 0;
}

.matrix-row {
  display: flex;
  gap: 1px;
  margin-bottom: 1px;
}

.matrix-row-label {
  width: 5.5rem;
  flex-shrink: 0;
  font-size: 0.6rem;
  color: #8b949e;
  font-family: ui-monospace, monospace;
  display: flex;
  align-items: center;
  overflow: hidden;
}

@media (max-width: 640px) {
  .matrix-row-label {
    width: 4rem;
  }
}

.matrix-cell {
  flex: 1;
  min-width: 1.25rem;
  aspect-ratio: 1;
  border-radius: 2px;
  transition: box-shadow 0.2s;
  cursor: default;
}

.matrix-cell:hover {
  box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.3);
}

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
