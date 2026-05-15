<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
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
import type { MapPopularityResponse, MapPopularitySummary } from '@/services/mapPopularityService'
import { fetchMapPopularity } from '@/services/mapPopularityService'
import { MM_CHART } from '@/views/v4/mmTokens'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const route = useRoute()
const router = useRouter()
const serverGuid = computed(() => route.params.serverGuid as string)
const serverName = ref('')

const loading = ref(false)
const error = ref<string | null>(null)
const data = ref<MapPopularityResponse | null>(null)

const selectedDays = ref(7)
const dayOptions = [3, 7, 14, 30]
const showMapFilter = ref(false)
const selectedMaps = ref<Set<string>>(new Set())

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

const applyHourPreset = (preset: HourPreset) => {
  activeHourPreset.value = preset.label
  if (preset.start >= 0) {
    hourStart.value = preset.start
    hourEnd.value = preset.end
  }
  void loadData()
}

watch([hourStart, hourEnd], () => {
  if (activeHourPreset.value === 'Custom') void loadData()
})

const isHourInRange = (hour: number): boolean => {
  if (hourStart.value <= hourEnd.value) {
    return hour >= hourStart.value && hour <= hourEnd.value
  }
  return hour >= hourStart.value || hour <= hourEnd.value
}

const hourRangeLabel = computed(() =>
  `${hourStart.value.toString().padStart(2, '0')}:00–${hourEnd.value.toString().padStart(2, '0')}:59 UTC`
)

// Neutral Depth dark palette — olive accent + brightened semantic tints,
// repeated so distinct maps stay visually separable on the dark surface.
const MAP_COLORS = [
  MM_CHART.accent,     // olive
  MM_CHART.success,    // brightened olive-green
  MM_CHART.elite,      // lifted olive
  MM_CHART.kill,       // brightened red
  MM_CHART.inkSoft,    // off-white
  '#b4a060',           // dusty gold
  '#c5a23a',           // load-busy
  '#8aa466',           // moss
  '#a86a4c',           // burnt sienna
  '#5a8a78',           // sea green
  '#a89070',           // bronze
  '#c8c8c8',           // ink-soft repeat
]

const mapColorIndex = ref<Record<string, number>>({})

const getMapColor = (mapName: string): string => {
  const i = mapColorIndex.value[mapName]
  return i !== undefined ? MAP_COLORS[i % MAP_COLORS.length] : MM_CHART.inkMuted
}

const allMaps = computed<MapPopularitySummary[]>(() => data.value?.mapSummaries ?? [])

const filteredSummaries = computed<MapPopularitySummary[]>(() =>
  allMaps.value
    .filter(m => selectedMaps.value.has(m.mapName))
    .sort((a, b) => b.avgConcurrentPlayers - a.avgConcurrentPlayers)
)

const selectAllMaps = () => { selectedMaps.value = new Set(allMaps.value.map(m => m.mapName)) }
const deselectAllMaps = () => { selectedMaps.value = new Set() }
const toggleMap = (name: string) => {
  const s = new Set(selectedMaps.value)
  if (s.has(name)) s.delete(name); else s.add(name)
  selectedMaps.value = s
}

const avgPlayersChartData = computed(() => {
  const sorted = [...filteredSummaries.value].sort((a, b) => a.avgConcurrentPlayers - b.avgConcurrentPlayers)
  return {
    labels: sorted.map(s => s.mapName),
    datasets: [{
      label: 'Avg Players',
      data: sorted.map(s => s.avgConcurrentPlayers),
      backgroundColor: sorted.map(s => getMapColor(s.mapName) + 'cc'),
      borderColor: sorted.map(s => getMapColor(s.mapName)),
      borderWidth: 1,
      borderRadius: 2,
    }],
  }
})

const avgPlayersChartOptions = computed(() => ({
  indexAxis: 'y' as const,
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: {
      grid: { color: MM_CHART.grid },
      ticks: { color: MM_CHART.inkMuted, font: { size: 10 } },
      title: { display: true, text: 'Avg concurrent players', color: MM_CHART.inkMuted, font: { size: 10 } },
      beginAtZero: true,
    },
    y: {
      grid: { display: false },
      ticks: { color: MM_CHART.ink, font: { size: 11 } },
    },
  },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: MM_CHART.surfaceSoft,
      titleColor: MM_CHART.ink,
      bodyColor: MM_CHART.inkSoft,
      borderColor: MM_CHART.gridStrong,
      borderWidth: 1,
      callbacks: {
        label: (ctx: any) => `${ctx.parsed.x.toFixed(1)} avg players`,
      },
    },
  },
}))

const maxHourly = computed(() => {
  let max = 1
  for (const s of filteredSummaries.value) {
    for (const v of s.hourlyAvgPlayers) {
      if (v > max) max = v
    }
  }
  return max
})

// Dark → olive heat scale. Empty cell sits at the surface color and
// brightens through olive accent to a lifted highlight at peak.
const heatLegendColors = ['#1a1a1a', '#2d2d2d', '#4a5028', '#7d8849', '#9aa666', '#b4c060']

const getHeatColor = (value: number): string => {
  if (value === 0) return heatLegendColors[0]
  const intensity = value / maxHourly.value
  const idx = Math.min(Math.floor(intensity * heatLegendColors.length), heatLegendColors.length - 1)
  return heatLegendColors[idx]
}

const loadData = async () => {
  loading.value = true
  error.value = null
  try {
    const result = await fetchMapPopularity(
      serverGuid.value,
      selectedDays.value,
      activeHourPreset.value !== 'All' ? hourStart.value : undefined,
      activeHourPreset.value !== 'All' ? hourEnd.value : undefined,
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
    error.value = e?.message || 'Failed to load data'
  } finally {
    loading.value = false
  }
}

const fetchServerName = async () => {
  try {
    const { fetchServerDetail } = await import('@/services/dataExplorerService')
    const detail = await fetchServerDetail(serverGuid.value)
    serverName.value = detail.name
  } catch { /* non-critical */ }
}

const backToServer = () => {
  if (serverName.value) {
    router.push(`/v4/servers/detail/${encodeURIComponent(serverName.value)}`)
  } else {
    router.back()
  }
}

onMounted(() => {
  void loadData()
  void fetchServerName()
})
</script>

<template>
  <div class="mm-container mm-section">
    <div class="mm-meta-row" style="margin-bottom: 14px">
      <a
        href="#"
        class="mm-meta-row__strong"
        style="text-decoration: underline; text-underline-offset: 3px"
        @click.prevent="backToServer"
      >← {{ serverName ? `Back to ${serverName}` : 'Back' }}</a>
    </div>

    <h1 class="mm-display">
      Map popularity
      <span v-if="serverName" class="mm-display__muted">· {{ serverName }}</span>
    </h1>

    <hr class="mm-rule" style="margin-top: 24px" />

    <!-- Controls -->
    <div class="mm-mp__controls">
      <div class="mm-mp__group">
        <span class="mm-eyebrow">Period</span>
        <div class="mm-mp__pills">
          <button
            v-for="opt in dayOptions"
            :key="opt"
            type="button"
            class="mm-mp__pill"
            :class="{ 'mm-mp__pill--active': selectedDays === opt }"
            @click="selectedDays = opt; loadData()"
          >{{ opt }}d</button>
        </div>
      </div>

      <div class="mm-mp__group">
        <span class="mm-eyebrow">Hours</span>
        <div class="mm-mp__pills">
          <button
            v-for="preset in hourPresets"
            :key="preset.label"
            type="button"
            class="mm-mp__pill"
            :class="{ 'mm-mp__pill--active': activeHourPreset === preset.label }"
            @click="applyHourPreset(preset)"
          >{{ preset.label }}</button>
        </div>
      </div>

      <div v-if="activeHourPreset === 'Custom'" class="mm-mp__group mm-mp__group--inline">
        <select v-model.number="hourStart" class="mm-mp__select">
          <option v-for="h in 24" :key="h - 1" :value="h - 1">{{ (h - 1).toString().padStart(2, '0') }}:00</option>
        </select>
        <span class="mm-meta-row__sep">to</span>
        <select v-model.number="hourEnd" class="mm-mp__select">
          <option v-for="h in 24" :key="h - 1" :value="h - 1">{{ (h - 1).toString().padStart(2, '0') }}:59</option>
        </select>
        <span class="mm-card__hint">(UTC)</span>
      </div>

      <button
        type="button"
        class="mm-btn mm-btn--inline mm-mp__group--end"
        @click="showMapFilter = !showMapFilter"
      >Maps ({{ selectedMaps.size }}/{{ allMaps.length }})</button>
    </div>

    <div v-if="activeHourPreset !== 'All'" class="mm-mp__notice">
      Showing averages for <strong>{{ hourRangeLabel }}</strong> only.
    </div>

    <!-- Map filter panel -->
    <div v-if="showMapFilter && allMaps.length > 0" class="mm-mp__filter-panel">
      <div class="mm-mp__filter-head">
        <span class="mm-eyebrow">Select maps</span>
        <div style="display: flex; gap: 12px">
          <button type="button" class="mm-btn mm-btn--inline" @click="selectAllMaps">Select all</button>
          <button type="button" class="mm-btn mm-btn--inline" @click="deselectAllMaps">Clear</button>
        </div>
      </div>
      <div class="mm-mp__chips">
        <button
          v-for="map in allMaps"
          :key="map.mapName"
          type="button"
          class="mm-mp__chip"
          :class="{ 'mm-mp__chip--active': selectedMaps.has(map.mapName) }"
          @click="toggleMap(map.mapName)"
        >
          <span class="mm-mp__chip-dot" :style="{ backgroundColor: getMapColor(map.mapName) }" />
          {{ map.mapName }}
          <span class="mm-mp__chip-count">{{ map.totalRounds }}r</span>
        </button>
      </div>
    </div>

    <hr class="mm-rule" style="margin-top: 24px" />

    <div v-if="loading && !data" style="padding: 32px 0">
      <div v-for="i in 6" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">
      {{ error }}
      <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="loadData">Retry</button>
    </div>

    <div v-else-if="!data || data.rounds.length === 0" class="mm-empty">
      No round data available for this server in the selected period.
    </div>

    <template v-else>
      <!-- Average players bar chart -->
      <section style="margin-top: 16px">
        <div class="mm-eyebrow">Average players per map</div>
        <p class="mm-card__hint" style="margin-top: 4px">
          Maps in rotation should track similarly. Low outliers indicate maps that drain the server.
        </p>
        <div :style="{ height: Math.max(220, filteredSummaries.length * 36) + 'px', marginTop: '12px' }">
          <Bar :data="avgPlayersChartData" :options="avgPlayersChartOptions" />
        </div>
      </section>

      <hr class="mm-rule" style="margin-top: 28px" />

      <!-- Time-of-day heatmap -->
      <section style="margin-top: 16px">
        <div class="mm-eyebrow">Popularity by time of day</div>
        <p class="mm-card__hint" style="margin-top: 4px">
          Average player count by hour (UTC). Brighter = more popular.
        </p>
        <div class="mm-mp__heatmap" style="margin-top: 12px">
          <div class="mm-mp__heat-header">
            <div class="mm-mp__heat-label" />
            <div class="mm-mp__heat-hours">
              <span v-for="h in 24" :key="h - 1" class="mm-mp__heat-hour">{{ (h - 1).toString().padStart(2, '0') }}</span>
            </div>
          </div>
          <div
            v-for="summary in filteredSummaries"
            :key="summary.mapName"
            class="mm-mp__heat-row"
          >
            <div class="mm-mp__heat-label" :title="summary.mapName">
              <span class="mm-mp__chip-dot" :style="{ backgroundColor: getMapColor(summary.mapName) }" />
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ summary.mapName }}</span>
            </div>
            <div class="mm-mp__heat-cells">
              <div
                v-for="h in 24"
                :key="h - 1"
                class="mm-mp__heat-cell"
                :style="{
                  backgroundColor: getHeatColor(summary.hourlyAvgPlayers[h - 1]),
                  opacity: isHourInRange(h - 1) ? 1 : 0.25,
                  outline: isHourInRange(h - 1) && activeHourPreset !== 'All' ? '1px solid var(--mm-accent)' : 'none',
                }"
                :title="`${summary.mapName} @ ${(h - 1).toString().padStart(2, '0')}:00 — ${summary.hourlyAvgPlayers[h - 1].toFixed(1)} avg players`"
              />
            </div>
          </div>
          <div class="mm-mp__heat-legend">
            <span>0</span>
            <div class="mm-mp__heat-legend-colors">
              <div
                v-for="(c, i) in heatLegendColors"
                :key="i"
                class="mm-mp__heat-legend-swatch"
                :style="{ backgroundColor: c }"
              />
            </div>
            <span>{{ maxHourly.toFixed(0) }}</span>
          </div>
        </div>
      </section>

      <hr class="mm-rule" style="margin-top: 28px" />

      <!-- Summary table -->
      <section style="margin-top: 16px">
        <div class="mm-eyebrow" style="margin-bottom: 10px">Map summary</div>
        <table class="mm-list mm-list--dense">
          <thead>
            <tr>
              <th>Map</th>
              <th class="is-num" style="width: 120px">Rounds</th>
              <th class="is-num" style="width: 160px">Avg players</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in filteredSummaries" :key="s.mapName">
              <td class="mm-list__name-cell">
                <div class="mm-list__name" style="flex-direction: row; align-items: center; gap: 8px">
                  <span class="mm-mp__chip-dot" :style="{ backgroundColor: getMapColor(s.mapName) }" />
                  <span class="mm-list__name-primary">{{ s.mapName }}</span>
                </div>
              </td>
              <td class="is-num" data-cell-label="Rounds">{{ s.totalRounds }}</td>
              <td class="is-num" data-cell-label="Avg players">{{ s.avgConcurrentPlayers.toFixed(1) }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.mm-mp__controls {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 16px 24px;
  margin-top: 18px;
}

.mm-mp__group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mm-mp__group--inline {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}

.mm-mp__group--end {
  margin-left: auto;
  align-self: flex-end;
}

.mm-mp__pills {
  display: flex;
  gap: 6px;
}

.mm-mp__pill {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 5px 10px;
  background: transparent;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink-soft);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.mm-mp__pill:hover { border-color: var(--mm-ink); color: var(--mm-ink); }

.mm-mp__pill--active {
  background: var(--mm-ink);
  color: var(--mm-bg);
  border-color: var(--mm-ink);
}

.mm-mp__select {
  font-family: var(--mm-font-mono);
  font-size: 12px;
  padding: 4px 8px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
}

.mm-mp__notice {
  margin-top: 12px;
  padding: 8px 12px;
  border: 1px solid var(--mm-accent-soft);
  border-radius: 2px;
  font-size: 12px;
  color: var(--mm-accent);
  background: rgba(125, 136, 73, 0.06);
}

.mm-mp__filter-panel {
  margin-top: 16px;
  padding: 14px 16px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
}

.mm-mp__filter-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 8px;
}

.mm-mp__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mm-mp__chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  background: transparent;
  font-family: var(--mm-font-display);
  font-size: 12px;
  color: var(--mm-ink-soft);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.mm-mp__chip:hover { border-color: var(--mm-ink); color: var(--mm-ink); }

.mm-mp__chip--active {
  border-color: var(--mm-ink);
  color: var(--mm-ink);
  background: var(--mm-bg-soft);
}

.mm-mp__chip-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.mm-mp__chip-count {
  color: var(--mm-ink-faint);
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
}

.mm-mp__heatmap {
  width: 100%;
  overflow-x: auto;
}

.mm-mp__heat-header {
  display: flex;
  margin-bottom: 4px;
}

.mm-mp__heat-label {
  width: 7rem;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--mm-ink-soft);
  font-family: var(--mm-font-mono);
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  padding-right: 8px;
}

@media (max-width: 640px) {
  .mm-mp__heat-label { width: 5rem; }
}

.mm-mp__heat-hours {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(24, minmax(0, 1fr));
  gap: 1px;
}

.mm-mp__heat-hour {
  text-align: center;
  font-size: 9px;
  color: var(--mm-ink-muted);
  font-family: var(--mm-font-mono);
}

@media (max-width: 640px) {
  .mm-mp__heat-hour:nth-child(odd) { visibility: hidden; }
}

.mm-mp__heat-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-bottom: 1px;
}

.mm-mp__heat-cells {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(24, minmax(0, 1fr));
  gap: 1px;
}

.mm-mp__heat-cell {
  aspect-ratio: 2 / 1;
  border-radius: 2px;
  min-height: 12px;
  transition: box-shadow 0.15s;
}

.mm-mp__heat-cell:hover {
  box-shadow: 0 0 0 2px var(--mm-accent-soft);
}

.mm-mp__heat-legend {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 12px;
  font-size: 11px;
  color: var(--mm-ink-muted);
  font-family: var(--mm-font-mono);
}

.mm-mp__heat-legend-colors {
  display: flex;
  gap: 1px;
}

.mm-mp__heat-legend-swatch {
  width: 1rem;
  height: 0.75rem;
  border-radius: 2px;
}
</style>
