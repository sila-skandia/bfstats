<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import MmPlayerCompetitiveRankingsChart from './MmPlayerCompetitiveRankingsChart.vue'
import MmSparkline from '@/components/v4/MmSparkline.vue'
import { kdClass } from '@/views/v4/mmTokens'

const props = defineProps<{
  playerName: string
  game?: string
}>()

const emit = defineEmits<{
  navigateToMap: [mapName: string]
}>()

interface MapRanking {
  mapName: string
  rank: number
  totalPlayers: number
  percentile: number
  totalScore: number
  totalKills: number
  totalDeaths: number
  kdRatio: number
  totalRounds: number
  playTimeMinutes: number
  trend: 'up' | 'down' | 'stable' | 'new'
  previousRank?: number
}

interface RankingSummary {
  totalMapsPlayed: number
  top1Rankings: number
  top10Rankings: number
  top25Rankings: number
  top100Rankings: number
  averagePercentile: number
  bestRankedMap?: string
  bestRank?: number
  percentileCategory: 'elite' | 'master' | 'expert' | 'veteran' | 'regular'
}

interface CompetitiveRankingsResponse {
  playerName: string
  game: string
  mapRankings: MapRanking[]
  summary: RankingSummary
  dateRange: { days: number; fromDate: string; toDate: string }
}

interface TimelineSnapshot {
  year: number
  month: number
  monthLabel: string
  rank: number
  totalPlayers: number
  percentile: number
  totalScore: number
  kdRatio: number
  hasData: boolean
}

interface RankingTimelineResponse {
  playerName: string
  mapName?: string
  game: string
  timeline: TimelineSnapshot[]
}

const tabs = [
  { id: 'current' as const, label: 'Performance' },
  { id: 'timeline' as const, label: 'Rank timeline' },
]

const activeTab = ref<'current' | 'timeline'>('current')
const viewMode = ref<'chart' | 'list'>('chart')
const rankingsData = ref<CompetitiveRankingsResponse | null>(null)
const timelineData = ref<RankingTimelineResponse | null>(null)
const isLoading = ref(false)
const isTimelineLoading = ref(false)
const error = ref<string | null>(null)
const selectedTimelineMap = ref('')

const timePeriod = ref<'last-month' | 'all-time'>('last-month')

const currentPage = ref(1)
const itemsPerPage = 10

const sortedRankings = computed(() => {
  if (!rankingsData.value) return []
  return [...rankingsData.value.mapRankings].sort((a, b) => a.rank - b.rank)
})

const availableMaps = computed(() => {
  if (!rankingsData.value) return []
  return rankingsData.value.mapRankings.map(r => r.mapName).sort()
})

const totalPages = computed(() => {
  if (!sortedRankings.value.length) return 0
  return Math.ceil(sortedRankings.value.length / itemsPerPage)
})

const paginatedRankings = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage
  return sortedRankings.value.slice(start, start + itemsPerPage)
})

const validTimelinePoints = computed(() =>
  (timelineData.value?.timeline ?? []).filter(t => t.hasData),
)

const timelineRanks = computed(() => validTimelinePoints.value.map(t => -t.rank))

const selectTimePeriod = (period: 'last-month' | 'all-time') => {
  timePeriod.value = period
  loadRankingsForPeriod()
}

const loadRankingsForPeriod = async () => {
  isLoading.value = true
  error.value = null
  try {
    let url = `/stats/data-explorer/players/${encodeURIComponent(props.playerName)}/competitive-rankings?game=${props.game || 'bf1942'}`
    if (timePeriod.value === 'last-month') url += '&days=30'
    else url += '&days=999999'

    const response = await fetch(url)
    if (!response.ok) {
      if (response.status === 404) throw new Error('No ranking data found for this player')
      throw new Error('Failed to load competitive rankings')
    }
    rankingsData.value = await response.json()
    currentPage.value = 1
  } catch (err: any) {
    console.error('Error loading competitive rankings:', err)
    error.value = err.message || 'Failed to load rankings'
  } finally {
    isLoading.value = false
  }
}

const loadTimeline = async () => {
  isTimelineLoading.value = true
  try {
    const params = new URLSearchParams({ game: props.game || 'bf1942', months: '12' })
    if (selectedTimelineMap.value) params.append('mapName', selectedTimelineMap.value)
    const response = await fetch(
      `/stats/data-explorer/players/${encodeURIComponent(props.playerName)}/ranking-timeline?${params}`,
    )
    if (!response.ok) throw new Error('Failed to load ranking timeline')
    timelineData.value = await response.json()
  } catch (err: any) {
    console.error('Error loading timeline:', err)
    timelineData.value = null
  } finally {
    isTimelineLoading.value = false
  }
}

const goToPage = (page: number) => {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
}

const handleMapClick = (mapName: string) => emit('navigateToMap', mapName)

const tierClass = (category: string) => {
  switch (category) {
    case 'elite': return 'mm-kd--elite'
    case 'master': return 'mm-kd--good'
    case 'expert': return 'mm-kd--mid'
    case 'veteran': return 'mm-kd--low'
    default: return ''
  }
}

const trendArrow = (t: MapRanking['trend']): string => {
  switch (t) {
    case 'up': return '↑'
    case 'down': return '↓'
    case 'new': return '◇'
    default: return '·'
  }
}

const trendClass = (t: MapRanking['trend']): string => {
  if (t === 'up') return 'mm-stat__delta--up'
  if (t === 'down') return 'mm-stat__delta--down'
  return ''
}

onMounted(() => loadRankingsForPeriod())
watch(() => props.playerName, loadRankingsForPeriod)
watch(activeTab, (t) => { if (t === 'timeline' && !timelineData.value) loadTimeline() })
watch(selectedTimelineMap, () => { if (activeTab.value === 'timeline') loadTimeline() })
</script>

<template>
  <section class="mm-pcr">
    <header class="mm-pcr__head">
      <div>
        <div class="mm-eyebrow mm-eyebrow--strong">Competitive rankings</div>
        <div class="mm-card__hint">map-level percentile vs the wider population</div>
      </div>
      <div class="mm-pcr__head-controls">
        <div class="mm-subtabs">
          <button
            v-for="t in tabs"
            :key="t.id"
            type="button"
            class="mm-subtab"
            :class="{ 'mm-subtab--active': activeTab === t.id }"
            @click="activeTab = t.id"
          >{{ t.label }}</button>
        </div>
        <div v-if="activeTab === 'current'" class="mm-subtabs">
          <button
            type="button"
            class="mm-subtab"
            :class="{ 'mm-subtab--active': viewMode === 'chart' }"
            @click="viewMode = 'chart'"
          >Chart</button>
          <button
            type="button"
            class="mm-subtab"
            :class="{ 'mm-subtab--active': viewMode === 'list' }"
            @click="viewMode = 'list'"
          >List</button>
        </div>
        <div v-if="activeTab === 'current'" class="mm-subtabs">
          <button
            type="button"
            class="mm-subtab"
            :class="{ 'mm-subtab--active': timePeriod === 'last-month' }"
            @click="selectTimePeriod('last-month')"
          >30d</button>
          <button
            type="button"
            class="mm-subtab"
            :class="{ 'mm-subtab--active': timePeriod === 'all-time' }"
            @click="selectTimePeriod('all-time')"
          >All time</button>
        </div>
      </div>
    </header>

    <div v-if="isLoading" class="mm-pcr__state">
      <div v-for="i in 4" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">
      {{ error }}
      <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="loadRankingsForPeriod">Retry</button>
    </div>

    <template v-else-if="rankingsData">
      <template v-if="activeTab === 'current'">
        <div class="mm-stats" style="border-top: 0">
          <div class="mm-stats__cell">
            <div class="mm-stats__label">Maps played</div>
            <div class="mm-stat__value mm-stat__value--small">{{ rankingsData.summary.totalMapsPlayed }}</div>
            <div class="mm-stat__delta" :class="tierClass(rankingsData.summary.percentileCategory)">
              {{ rankingsData.summary.percentileCategory }}
            </div>
          </div>
          <div class="mm-stats__cell">
            <div class="mm-stats__label">Top 1%</div>
            <div class="mm-stat__value mm-stat__value--small mm-kd--elite">{{ rankingsData.summary.top1Rankings }}</div>
          </div>
          <div class="mm-stats__cell">
            <div class="mm-stats__label">Top 10</div>
            <div class="mm-stat__value mm-stat__value--small mm-kd--good">{{ rankingsData.summary.top10Rankings }}</div>
          </div>
          <div class="mm-stats__cell">
            <div class="mm-stats__label">Best rank</div>
            <div class="mm-stat__value mm-stat__value--small">
              {{ rankingsData.summary.bestRank ? `#${rankingsData.summary.bestRank}` : '—' }}
            </div>
            <div class="mm-stat__delta">
              {{ rankingsData.summary.bestRankedMap || '—' }}
            </div>
          </div>
        </div>

        <div v-if="viewMode === 'chart'" style="margin-top: 18px">
          <MmPlayerCompetitiveRankingsChart
            :rankings="rankingsData.mapRankings"
            @navigate-to-map="handleMapClick"
          />
        </div>

        <table v-else class="mm-list" style="margin-top: 18px">
          <thead>
            <tr>
              <th class="mm-list__rank">#</th>
              <th>Map</th>
              <th class="is-num">Rank</th>
              <th class="is-num">Percentile</th>
              <th class="is-num">K/D</th>
              <th class="is-num">Rounds</th>
              <th class="is-num">Trend</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, idx) in paginatedRankings"
              :key="r.mapName"
              @click="handleMapClick(r.mapName)"
            >
              <td class="mm-list__rank">{{ (currentPage - 1) * itemsPerPage + idx + 1 }}</td>
              <td class="mm-list__name-cell">
                <div class="mm-list__name">
                  <span class="mm-list__name-primary">{{ r.mapName }}</span>
                </div>
              </td>
              <td class="is-num" data-cell-label="Rank">#{{ r.rank }} / {{ r.totalPlayers }}</td>
              <td class="is-num" data-cell-label="Percentile">{{ r.percentile.toFixed(1) }}%</td>
              <td class="is-num" :class="kdClass(r.kdRatio)" data-cell-label="K/D">{{ r.kdRatio.toFixed(2) }}</td>
              <td class="is-num is-muted" data-cell-label="Rounds">{{ r.totalRounds }}</td>
              <td class="is-num" :class="trendClass(r.trend)" data-cell-label="Trend">
                {{ trendArrow(r.trend) }}
                <template v-if="r.trend !== 'new' && r.previousRank">{{ Math.abs(r.previousRank - r.rank) }}</template>
              </td>
            </tr>
            <tr v-if="paginatedRankings.length === 0">
              <td colspan="7" class="mm-empty" style="border: 0">No map rankings.</td>
            </tr>
          </tbody>
        </table>

        <div v-if="totalPages > 1 && viewMode === 'list'" class="mm-pcr__pagination">
          <button type="button" class="mm-btn mm-btn--inline" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">‹</button>
          <span class="mm-eyebrow">{{ currentPage }} / {{ totalPages }}</span>
          <button type="button" class="mm-btn mm-btn--inline" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">›</button>
        </div>
      </template>

      <template v-else>
        <div class="mm-pcr__timeline-controls">
          <label class="mm-eyebrow" for="mm-pcr-tl-map">Map filter</label>
          <select id="mm-pcr-tl-map" v-model="selectedTimelineMap" class="mm-pcr__select">
            <option value="">Overall ranking</option>
            <option v-for="m in availableMaps" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>

        <div v-if="isTimelineLoading" class="mm-pcr__state">
          <div v-for="i in 3" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
        </div>

        <div v-else-if="!timelineData || validTimelinePoints.length === 0" class="mm-empty">
          No timeline data for the selected scope.
        </div>

        <div v-else class="mm-pcr__timeline">
          <div class="mm-card__hint">Lower is better — values inverted in the sparkline.</div>
          <MmSparkline
            :values="timelineRanks"
            :width="640"
            :height="80"
            :accent="true"
          />
          <table class="mm-list" style="margin-top: 14px">
            <thead>
              <tr>
                <th>Month</th>
                <th class="is-num">Rank</th>
                <th class="is-num">Percentile</th>
                <th class="is-num">K/D</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in validTimelinePoints" :key="t.monthLabel">
                <td>{{ t.monthLabel }}</td>
                <td class="is-num" data-cell-label="Rank">#{{ t.rank }} / {{ t.totalPlayers }}</td>
                <td class="is-num" data-cell-label="Percentile">{{ t.percentile.toFixed(1) }}%</td>
                <td class="is-num" :class="kdClass(t.kdRatio)" data-cell-label="K/D">{{ t.kdRatio.toFixed(2) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </section>
</template>

<style scoped>
.mm-pcr {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mm-pcr__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

.mm-pcr__head-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.mm-pcr__state { padding: 14px 0; }

.mm-pcr__pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding-top: 12px;
}

.mm-pcr__timeline-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mm-pcr__select {
  font-family: var(--mm-font-display);
  font-size: 13px;
  padding: 5px 8px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
  min-width: 200px;
}

.mm-pcr__timeline {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
