<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { PLAYER_STATS_TIME_RANGE_OPTIONS } from '@/utils/constants'
import { kdClass } from '@/views/v4/mmTokens'

const props = defineProps<{
  playerName: string
  game?: string
  serverGuid?: string
}>()

const emit = defineEmits<{
  'navigate-to-server': [serverGuid: string]
  'navigate-to-map': [mapName: string]
}>()

interface PlayerSliceResultDto {
  sliceKey: string
  subKey: string | null
  subKeyLabel?: string | null
  sliceLabel: string
  primaryValue: number
  secondaryValue: number
  percentage: number
  rank: number
  totalPlayers: number
  additionalData: Record<string, any>
}

interface PlayerSlicedStatsResponse {
  playerName: string
  game: string
  sliceDimension: string
  sliceType: string
  results: PlayerSliceResultDto[]
  dateRange: { days: number; fromDate: string; toDate: string }
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
    hasNext: boolean
    hasPrevious: boolean
  }
}

const slicedData = ref<PlayerSlicedStatsResponse | null>(null)
const isLoading = ref(false)
const error = ref<string | null>(null)

const selectedTimeRange = ref<number>(60)
const selectedSliceType = ref<string>('ScoreByMap')
const currentPage = ref<number>(1)
const pageSize = 10
const allResults = ref<PlayerSliceResultDto[]>([])

const timeRangeOptions = PLAYER_STATS_TIME_RANGE_OPTIONS

const metricTabs = [
  { type: 'score' as const, label: 'Score' },
  { type: 'kills' as const, label: 'Kills' },
  { type: 'wins' as const, label: 'Wins' },
]

const getMetricTypeForSlice = (sliceType: string): 'score' | 'kills' | 'wins' => {
  if (sliceType.includes('Kills')) return 'kills'
  if (sliceType.includes('Wins')) return 'wins'
  return 'score'
}

const includeServerInSlice = (): boolean => selectedSliceType.value.includes('Server')

const currentMetric = computed(() => getMetricTypeForSlice(selectedSliceType.value))

const isMapSlice = (): boolean => selectedSliceType.value.includes('Map')

const handleSliceClick = (result: PlayerSliceResultDto) => {
  if (isMapSlice()) emit('navigate-to-map', result.sliceKey)
}

const toggleScope = (scope: 'map' | 'map-server') => {
  const metric = currentMetric.value
  const includeServer = scope === 'map-server'
  let newSliceType = ''
  if (metric === 'kills') newSliceType = includeServer ? 'KillsByMapAndServer' : 'KillsByMap'
  else if (metric === 'wins') newSliceType = includeServer ? 'WinsByMapAndServer' : 'WinsByMap'
  else newSliceType = includeServer ? 'ScoreByMapAndServer' : 'ScoreByMap'
  selectedSliceType.value = newSliceType
  currentPage.value = 1
  loadData()
}

const selectMetric = (metricType: 'score' | 'kills' | 'wins') => {
  const currentHasServer = includeServerInSlice()
  let newSliceType = ''
  if (metricType === 'kills') newSliceType = currentHasServer ? 'KillsByMapAndServer' : 'KillsByMap'
  else if (metricType === 'wins') newSliceType = currentHasServer ? 'WinsByMapAndServer' : 'WinsByMap'
  else newSliceType = currentHasServer ? 'ScoreByMapAndServer' : 'ScoreByMap'
  selectedSliceType.value = newSliceType
  currentPage.value = 1
  loadData()
}

const primaryLabel = computed(() => {
  if (currentMetric.value === 'kills') return 'Kills'
  if (currentMetric.value === 'wins') return 'Wins'
  return 'Score'
})

const secondaryLabel = computed(() => {
  if (currentMetric.value === 'kills') return 'Deaths'
  if (currentMetric.value === 'wins') return 'Rounds'
  return 'Rounds'
})

const formatPrimary = (r: PlayerSliceResultDto): string => {
  if (currentMetric.value === 'wins') return r.primaryValue.toLocaleString()
  return r.primaryValue.toLocaleString()
}

const totalPrimary = computed(() =>
  allResults.value.reduce((sum, r) => sum + r.primaryValue, 0),
)

const totalSecondary = computed(() =>
  allResults.value.reduce((sum, r) => sum + r.secondaryValue, 0),
)

const avgPercentage = computed(() => {
  if (allResults.value.length === 0) return 0
  return allResults.value.reduce((s, r) => s + r.percentage, 0) / allResults.value.length
})

const percentLabel = computed(() => {
  if (currentMetric.value === 'wins') return 'Avg win %'
  return 'Avg K/D'
})

const paginatedResults = computed(() => {
  const start = (currentPage.value - 1) * pageSize
  return allResults.value.slice(start, start + pageSize)
})

const totalPages = computed(() => Math.ceil(allResults.value.length / pageSize) || 1)

const loadData = async (days?: number) => {
  if (!props.playerName) return
  const timeRange = days || selectedTimeRange.value
  isLoading.value = true
  try {
    const params = new URLSearchParams({
      sliceType: selectedSliceType.value,
      game: props.game || 'bf1942',
      page: '1',
      pageSize: '1000',
      days: timeRange.toString(),
    })
    const response = await fetch(`/stats/data-explorer/players/${encodeURIComponent(props.playerName)}/sliced-stats?${params}`)
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`No data available for this player in the last ${timeRange} days`)
      }
      throw new Error('Failed to load player statistics')
    }
    const responseData = await response.json()
    error.value = null
    allResults.value = responseData.results || []
    slicedData.value = responseData
  } catch (err: any) {
    console.error('Error loading sliced player data:', err)
    error.value = err.message || 'Failed to load player details'
  } finally {
    isLoading.value = false
  }
}

const changeTimeRange = (days: number) => {
  selectedTimeRange.value = days
  currentPage.value = 1
  loadData(days)
}

const changePage = (page: number) => {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
}

onMounted(() => loadData())
watch(() => props.playerName, () => loadData())
watch(() => props.serverGuid, () => loadData())
</script>

<template>
  <section class="mm-pdp">
    <header class="mm-pdp__head">
      <div>
        <div class="mm-eyebrow mm-eyebrow--strong">Sliced statistics</div>
        <div class="mm-card__hint">map-by-map breakdown of {{ currentMetric }} performance</div>
      </div>
      <div class="mm-pdp__head-controls">
        <div class="mm-subtabs">
          <button
            v-for="t in metricTabs"
            :key="t.type"
            type="button"
            class="mm-subtab"
            :class="{ 'mm-subtab--active': currentMetric === t.type }"
            @click="selectMetric(t.type)"
          >{{ t.label }}</button>
        </div>
        <div class="mm-subtabs">
          <button
            type="button"
            class="mm-subtab"
            :class="{ 'mm-subtab--active': !includeServerInSlice() }"
            @click="toggleScope('map')"
          >Map</button>
          <button
            type="button"
            class="mm-subtab"
            :class="{ 'mm-subtab--active': includeServerInSlice() }"
            @click="toggleScope('map-server')"
          >+ Server</button>
        </div>
        <select
          :value="selectedTimeRange"
          class="mm-pdp__select"
          :disabled="isLoading"
          @change="changeTimeRange(parseInt(($event.target as HTMLSelectElement).value))"
        >
          <option v-for="opt in timeRangeOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
    </header>

    <div v-if="isLoading" class="mm-pdp__state">
      <div v-for="i in 4" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">
      {{ error }}
      <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="loadData()">Retry</button>
    </div>

    <template v-else-if="slicedData && allResults.length > 0">
      <div class="mm-stats" style="border-top: 0">
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Slices</div>
          <div class="mm-stat__value mm-stat__value--small">{{ allResults.length }}</div>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Total {{ primaryLabel.toLowerCase() }}</div>
          <div class="mm-stat__value mm-stat__value--small">{{ totalPrimary.toLocaleString() }}</div>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Total {{ secondaryLabel.toLowerCase() }}</div>
          <div class="mm-stat__value mm-stat__value--small">{{ totalSecondary.toLocaleString() }}</div>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">{{ percentLabel }}</div>
          <div class="mm-stat__value mm-stat__value--small">
            {{ currentMetric === 'wins' ? avgPercentage.toFixed(1) + '%' : avgPercentage.toFixed(2) }}
          </div>
        </div>
      </div>

      <table class="mm-list" style="margin-top: 18px">
        <thead>
          <tr>
            <th class="mm-list__rank">#</th>
            <th>{{ isMapSlice() ? 'Map' : 'Slice' }}</th>
            <th class="is-num">{{ primaryLabel }}</th>
            <th class="is-num">{{ secondaryLabel }}</th>
            <th class="is-num">{{ currentMetric === 'wins' ? 'Win %' : 'K/D' }}</th>
            <th class="is-num">Rank</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(r, idx) in paginatedResults"
            :key="r.sliceKey + (r.subKey || '')"
            @click="handleSliceClick(r)"
          >
            <td class="mm-list__rank">{{ (currentPage - 1) * pageSize + idx + 1 }}</td>
            <td class="mm-list__name-cell">
              <div class="mm-list__name">
                <span class="mm-list__name-primary">{{ r.sliceLabel }}</span>
                <span v-if="r.subKeyLabel" class="mm-list__name-sub">{{ r.subKeyLabel }}</span>
              </div>
            </td>
            <td class="is-num" data-cell-label="Primary">{{ formatPrimary(r) }}</td>
            <td class="is-num is-muted" data-cell-label="Secondary">{{ r.secondaryValue.toLocaleString() }}</td>
            <td
              class="is-num"
              :class="currentMetric === 'wins' ? '' : kdClass(r.percentage)"
              data-cell-label="Ratio"
            >
              {{ currentMetric === 'wins' ? r.percentage.toFixed(1) + '%' : r.percentage.toFixed(2) }}
            </td>
            <td class="is-num is-muted" data-cell-label="Rank">#{{ r.rank }} / {{ r.totalPlayers }}</td>
          </tr>
        </tbody>
      </table>

      <div v-if="totalPages > 1" class="mm-pdp__pagination">
        <button
          type="button"
          class="mm-btn mm-btn--inline"
          :disabled="currentPage <= 1"
          @click="changePage(currentPage - 1)"
        >‹</button>
        <span class="mm-eyebrow">{{ currentPage }} / {{ totalPages }}</span>
        <button
          type="button"
          class="mm-btn mm-btn--inline"
          :disabled="currentPage >= totalPages"
          @click="changePage(currentPage + 1)"
        >›</button>
      </div>
    </template>

    <div v-else class="mm-empty">No slice data available.</div>
  </section>
</template>

<style scoped>
.mm-pdp { display: flex; flex-direction: column; gap: 14px; }

.mm-pdp__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

.mm-pdp__head-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.mm-pdp__select {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  padding: 5px 8px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
}

.mm-pdp__state { padding: 14px 0; }

.mm-pdp__pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding-top: 12px;
}
</style>
