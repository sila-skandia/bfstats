<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { PLAYER_STATS_TIME_RANGE_OPTIONS } from '@/utils/constants'
import { fetchPlayerMapRankings, type PlayerMapRankingsResponse, type GameType } from '@/services/dataExplorerService'
import { kdClass } from '@/views/v4/mmTokens'

interface MapStat {
  mapName: string
  totalScore: number
  totalKills: number
  totalDeaths: number
  sessionsPlayed: number
  totalPlayTimeMinutes: number
  rank: number | null
  kdRatio: number
}

const props = defineProps<{
  playerName: string
  serverGuid?: string
  game?: GameType
}>()

const emit = defineEmits<{
  (e: 'open-rankings', mapName: string): void
  (e: 'open-map-detail', mapName: string): void
}>()

const handleRankClick = (mapName: string, rank: number | null) => {
  if (rank !== null) emit('open-rankings', mapName)
}

const handleMapClick = (mapName: string) => {
  emit('open-map-detail', mapName)
}

const playerData = ref<PlayerMapRankingsResponse | null>(null)
const isLoading = ref(false)
const error = ref<string | null>(null)
type SortField = 'mapName' | 'totalScore' | 'kdRatio' | 'totalKills' | 'totalDeaths' | 'sessionsPlayed' | 'rank'
// Default view is "where am I ranked best" — rank ascending (1 = best),
// unranked maps sink to the bottom. See sortedMapStats for the null handling.
const sortField = ref<SortField>('rank')
const sortDirection = ref<'asc' | 'desc'>('asc')

const PAGE_SIZE = 5
const page = ref(1)

const selectedTimeRange = ref<number>(60)
const timeRangeOptions = PLAYER_STATS_TIME_RANGE_OPTIONS

const mapStats = computed<MapStat[]>(() => {
  if (!playerData.value) return []

  return playerData.value.mapGroups
    .map(mapGroup => {
      if (mapGroup.serverStats.length === 0) return null

      if (props.serverGuid) {
        const serverStat = mapGroup.serverStats[0]
        if (!serverStat) return null
        return {
          mapName: mapGroup.mapName,
          totalScore: serverStat.totalScore,
          totalKills: serverStat.totalKills,
          totalDeaths: serverStat.totalDeaths,
          sessionsPlayed: serverStat.totalRounds,
          totalPlayTimeMinutes: 0,
          rank: serverStat.rank,
          kdRatio: serverStat.kdRatio,
        }
      } else {
        const totalScore = mapGroup.serverStats.reduce((s, st) => s + st.totalScore, 0)
        const totalKills = mapGroup.serverStats.reduce((s, st) => s + st.totalKills, 0)
        const totalDeaths = mapGroup.serverStats.reduce((s, st) => s + st.totalDeaths, 0)
        const totalRounds = mapGroup.serverStats.reduce((s, st) => s + st.totalRounds, 0)
        const kdRatio = totalDeaths > 0 ? totalKills / totalDeaths : totalKills > 0 ? totalKills : 0
        return {
          mapName: mapGroup.mapName,
          totalScore,
          totalKills,
          totalDeaths,
          sessionsPlayed: totalRounds,
          totalPlayTimeMinutes: 0,
          rank: mapGroup.bestRank,
          kdRatio,
        }
      }
    })
    .filter((stat): stat is MapStat => stat !== null)
})

const sortedMapStats = computed(() => {
  if (!mapStats.value || mapStats.value.length === 0) return []
  return [...mapStats.value].sort((a, b) => {
    const direction = sortDirection.value === 'asc' ? 1 : -1
    switch (sortField.value) {
      case 'mapName':
        return direction * a.mapName.localeCompare(b.mapName)
      case 'totalScore':
        return direction * (a.totalScore - b.totalScore)
      case 'kdRatio':
        return direction * (a.kdRatio - b.kdRatio)
      case 'totalKills':
        return direction * (a.totalKills - b.totalKills)
      case 'totalDeaths':
        return direction * (a.totalDeaths - b.totalDeaths)
      case 'sessionsPlayed':
        return direction * (a.sessionsPlayed - b.sessionsPlayed)
      case 'rank': {
        if (a.rank === null && b.rank === null) return 0
        if (a.rank === null) return 1
        if (b.rank === null) return -1
        return direction * (a.rank - b.rank)
      }
      default:
        return direction * (a.totalScore - b.totalScore)
    }
  })
})

const totalRows = computed(() => sortedMapStats.value.length)
const totalPages = computed(() => Math.max(1, Math.ceil(totalRows.value / PAGE_SIZE)))
const pagedMapStats = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE
  return sortedMapStats.value.slice(start, start + PAGE_SIZE)
})
const rangeStart = computed(() => (totalRows.value === 0 ? 0 : (page.value - 1) * PAGE_SIZE + 1))
const rangeEnd = computed(() => Math.min(page.value * PAGE_SIZE, totalRows.value))

// Sliding window of at most 5 page numbers centred on the current page.
const paginationRange = computed(() => {
  const total = totalPages.value
  const span = Math.min(5, total)
  let first = Math.max(1, page.value - Math.floor(span / 2))
  first = Math.min(first, total - span + 1)
  return Array.from({ length: span }, (_, i) => first + i)
})

const goPage = (p: number) => {
  if (p < 1 || p > totalPages.value) return
  page.value = p
}

const changeSort = (field: SortField) => {
  if (sortField.value === field) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortField.value = field
    sortDirection.value = field === 'rank' ? 'asc' : 'desc'
  }
  page.value = 1
}

const loadData = async (days?: number) => {
  if (!props.playerName) return
  const timeRange = days || selectedTimeRange.value
  isLoading.value = true
  error.value = null
  page.value = 1
  try {
    playerData.value = await fetchPlayerMapRankings(
      props.playerName,
      props.game || 'bf1942',
      timeRange,
      props.serverGuid,
    )
    if (playerData.value.mapGroups.length === 0) {
      const scope = props.serverGuid ? 'on this server' : 'across all servers'
      error.value = `No statistics found ${scope} for the selected time period`
    }
  } catch (err: any) {
    console.error('Error fetching map rankings:', err)
    if (err.message === 'PLAYER_NOT_FOUND') {
      const scope = props.serverGuid ? 'on this server' : 'across all servers'
      error.value = `No statistics found ${scope} for the selected time period`
    } else {
      error.value = 'Failed to load map statistics'
    }
    playerData.value = null
  } finally {
    isLoading.value = false
  }
}

const changeTimeRange = (days: number) => {
  selectedTimeRange.value = days
  loadData(days)
}

onMounted(() => loadData())
watch(() => props.playerName, () => loadData())
watch(() => props.serverGuid, () => loadData())

const sortIndicator = (field: SortField) => {
  if (sortField.value !== field) return ''
  return sortDirection.value === 'asc' ? ' ↑' : ' ↓'
}
</script>

<template>
  <section class="mm-psms">
    <header class="mm-psms__head">
      <div>
        <div class="mm-eyebrow mm-eyebrow--strong">Per-map statistics</div>
        <div class="mm-card__hint">{{ selectedTimeRange === 0 ? 'all time' : `last ${selectedTimeRange} days` }}</div>
      </div>
      <div class="mm-subtabs">
        <button
          v-for="opt in timeRangeOptions"
          :key="opt.value"
          type="button"
          class="mm-subtab"
          :class="{ 'mm-subtab--active': selectedTimeRange === opt.value }"
          @click="changeTimeRange(opt.value)"
        >{{ opt.label }}</button>
      </div>
    </header>

    <div v-if="isLoading" class="mm-psms__state">
      <div v-for="i in 4" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">{{ error }}</div>

    <table v-else class="mm-list mm-list--dense">
      <thead>
        <tr>
          <th>
            <button type="button" class="mm-psms__sort-btn" @click="changeSort('mapName')">Map{{ sortIndicator('mapName') }}</button>
          </th>
          <th class="is-num">
            <button type="button" class="mm-psms__sort-btn" @click="changeSort('rank')">Rank{{ sortIndicator('rank') }}</button>
          </th>
          <th class="is-num">
            <button type="button" class="mm-psms__sort-btn" @click="changeSort('totalScore')">Score{{ sortIndicator('totalScore') }}</button>
          </th>
          <th class="is-num">
            <button type="button" class="mm-psms__sort-btn" @click="changeSort('totalKills')">Kills{{ sortIndicator('totalKills') }}</button>
          </th>
          <th class="is-num">
            <button type="button" class="mm-psms__sort-btn" @click="changeSort('totalDeaths')">Deaths{{ sortIndicator('totalDeaths') }}</button>
          </th>
          <th class="is-num">
            <button type="button" class="mm-psms__sort-btn" @click="changeSort('kdRatio')">K/D{{ sortIndicator('kdRatio') }}</button>
          </th>
          <th class="is-num">
            <button type="button" class="mm-psms__sort-btn" @click="changeSort('sessionsPlayed')">Rounds{{ sortIndicator('sessionsPlayed') }}</button>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in pagedMapStats" :key="m.mapName" @click="handleMapClick(m.mapName)">
          <td class="mm-list__name-cell">
            <div class="mm-list__name">
              <span class="mm-list__name-primary">{{ m.mapName }}</span>
            </div>
          </td>
          <td class="is-num" data-cell-label="Rank">
            <button
              v-if="m.rank !== null"
              type="button"
              class="mm-psms__rank-btn"
              @click.stop="handleRankClick(m.mapName, m.rank)"
            >#{{ m.rank }}</button>
            <span v-else class="is-muted">—</span>
          </td>
          <td class="is-num" data-cell-label="Score">{{ m.totalScore.toLocaleString() }}</td>
          <td class="is-num mm-num--kill" data-cell-label="Kills">{{ m.totalKills.toLocaleString() }}</td>
          <td class="is-num mm-num--death" data-cell-label="Deaths">{{ m.totalDeaths.toLocaleString() }}</td>
          <td class="is-num" :class="kdClass(m.kdRatio)" data-cell-label="K/D">{{ m.kdRatio.toFixed(2) }}</td>
          <td class="is-num is-muted" data-cell-label="Rounds">{{ m.sessionsPlayed }}</td>
        </tr>
      </tbody>
    </table>

    <div v-if="!isLoading && !error && totalRows > 0" class="mm-psms__foot">
      <span class="mm-psms__count">
        Showing {{ rangeStart }}–{{ rangeEnd }} of {{ totalRows.toLocaleString() }}
      </span>
      <div v-if="totalPages > 1" class="mm-psms__pagination">
        <button
          type="button"
          class="mm-btn mm-btn--inline"
          :disabled="page <= 1"
          @click="goPage(page - 1)"
        >‹</button>
        <button
          v-for="p in paginationRange"
          :key="p"
          type="button"
          class="mm-btn mm-btn--inline"
          :class="{ 'mm-psms__page--active': p === page }"
          @click="goPage(p)"
        >{{ p }}</button>
        <button
          type="button"
          class="mm-btn mm-btn--inline"
          :disabled="page >= totalPages"
          @click="goPage(page + 1)"
        >›</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mm-psms {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mm-psms__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.mm-psms__state { padding: 14px 0; }

.mm-psms__sort-btn {
  background: transparent;
  border: 0;
  padding: 0;
  font: inherit;
  color: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  cursor: pointer;
}

.mm-psms__sort-btn:hover { color: var(--mm-ink); }

.mm-psms__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.mm-psms__count {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-psms__pagination {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mm-psms__page--active {
  background: var(--mm-ink);
  color: var(--mm-bg);
  border-color: var(--mm-ink);
}

.mm-psms__rank-btn {
  font-family: var(--mm-font-mono);
  font-size: 12.5px;
  background: transparent;
  border: 0;
  padding: 0;
  color: var(--mm-accent);
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 3px;
}
</style>
