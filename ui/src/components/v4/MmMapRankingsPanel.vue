<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { fetchMapPlayerRankings, type MapPlayerRanking, type GameType, type MapRankingSortBy } from '@/services/dataExplorerService'
import { kdClass } from '@/views/v4/mmTokens'

const props = defineProps<{
  mapName: string
  game?: GameType
  serverGuid?: string
  highlightPlayer?: string
  days?: number
}>()

const router = useRouter()

const tabs = [
  { id: 'score' as const, label: 'Score' },
  { id: 'kills' as const, label: 'Kills' },
  { id: 'wins' as const, label: 'Wins' },
  { id: 'kdRatio' as const, label: 'K/D' },
  { id: 'killRate' as const, label: 'Kill rate' },
]

const activeTab = ref<MapRankingSortBy>('score')
const searchQuery = ref('')
const debouncedSearch = ref('')
let searchTimeout: number | null = null

const pageSize = 15
const rankings = ref<MapPlayerRanking[]>([])
const isLoading = ref(false)
const isRefreshing = ref(false)
const error = ref<string | null>(null)
const currentPage = ref(1)
const totalPages = ref(0)
const totalCount = ref(0)

const selectedDays = ref(props.days || 60)
const selectedMinRounds = ref(3)
const minRoundsOptions = [3, 5, 10, 20, 50]

const handleMinRoundsChange = (rounds: number) => {
  if (rounds === selectedMinRounds.value || isRefreshing.value) return
  selectedMinRounds.value = rounds
  currentPage.value = 1
  loadRankings()
}

const loadRankings = async () => {
  if (!props.mapName) return
  if (rankings.value.length === 0) isLoading.value = true
  else isRefreshing.value = true
  error.value = null

  try {
    const response = await fetchMapPlayerRankings(
      props.mapName,
      props.game || 'bf1942',
      currentPage.value,
      pageSize,
      debouncedSearch.value || undefined,
      props.serverGuid,
      selectedDays.value,
      activeTab.value,
      selectedMinRounds.value,
    )
    rankings.value = response.rankings
    totalPages.value = Math.ceil(response.totalCount / pageSize)
    totalCount.value = response.totalCount
  } catch (err) {
    console.error('Error loading rankings:', err)
    error.value = 'Failed to load rankings'
  } finally {
    isLoading.value = false
    isRefreshing.value = false
  }
}

const handleDaysChange = (days: number) => {
  if (days === selectedDays.value || isRefreshing.value) return
  selectedDays.value = days
  currentPage.value = 1
  loadRankings()
}

const selectTab = (tabId: MapRankingSortBy) => {
  if (tabId === activeTab.value || isRefreshing.value) return
  activeTab.value = tabId
  currentPage.value = 1
  loadRankings()
}

const goToPage = (page: number) => {
  if (page < 1 || page > totalPages.value || isRefreshing.value) return
  currentPage.value = page
  loadRankings()
}

const handleSearchInput = () => {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    debouncedSearch.value = searchQuery.value
    currentPage.value = 1
    loadRankings()
  }, 300) as unknown as number
}

const navigateToPlayer = (playerName: string) => {
  router.push(`/v4/players/${encodeURIComponent(playerName)}`)
}

const primaryColumnHeader = computed(() => {
  switch (activeTab.value) {
    case 'score': return 'Score'
    case 'kills': return 'Kills'
    case 'wins': return 'Wins'
    case 'kdRatio': return 'K/D'
    case 'killRate': return 'Kills / min'
    default: return 'Score'
  }
})

const formatPrimaryValue = (entry: MapPlayerRanking): string => {
  switch (activeTab.value) {
    case 'score': return entry.totalScore.toLocaleString()
    case 'kills': return entry.totalKills.toLocaleString()
    case 'wins': return (entry.totalWins || 0).toLocaleString()
    case 'kdRatio': return entry.kdRatio.toFixed(2)
    case 'killRate': return entry.killsPerMinute.toFixed(3)
    default: return entry.totalScore.toLocaleString()
  }
}

const isHighlighted = (playerName: string): boolean =>
  !!props.highlightPlayer && playerName.toLowerCase() === props.highlightPlayer.toLowerCase()

const paginationRange = computed(() => {
  const range: number[] = []
  const maxVisible = 5
  let start = Math.max(1, currentPage.value - Math.floor(maxVisible / 2))
  const end = Math.min(totalPages.value, start + maxVisible - 1)
  if (end === totalPages.value) start = Math.max(1, end - maxVisible + 1)
  for (let i = start; i <= end; i++) range.push(i)
  return range
})

onMounted(loadRankings)

watch(() => props.mapName, () => {
  currentPage.value = 1
  searchQuery.value = ''
  debouncedSearch.value = ''
  rankings.value = []
  loadRankings()
})

watch(() => props.serverGuid, () => {
  currentPage.value = 1
  rankings.value = []
  loadRankings()
})

watch(() => props.days, (newDays) => {
  if (newDays) {
    selectedDays.value = newDays
    currentPage.value = 1
    loadRankings()
  }
})
</script>

<template>
  <section class="mm-rank">
    <header class="mm-rank__head">
      <div>
        <div class="mm-eyebrow mm-eyebrow--strong">Engagement ladder</div>
        <h3 class="mm-h2 mm-rank__title">{{ mapName }}</h3>
      </div>
      <span v-if="totalCount > 0" class="mm-chip">{{ totalCount.toLocaleString() }} players</span>
    </header>

    <div class="mm-rank__filters">
      <div class="mm-rank__filter">
        <span class="mm-eyebrow">Min rounds</span>
        <div class="mm-subtabs">
          <button
            v-for="rounds in minRoundsOptions"
            :key="rounds"
            type="button"
            class="mm-subtab"
            :class="{ 'mm-subtab--active': selectedMinRounds === rounds }"
            :disabled="isRefreshing"
            @click="handleMinRoundsChange(rounds)"
          >{{ rounds }}+</button>
        </div>
      </div>

      <div class="mm-rank__filter">
        <span class="mm-eyebrow">Window</span>
        <div class="mm-subtabs">
          <button
            v-for="days in [30, 60, 90, 365]"
            :key="days"
            type="button"
            class="mm-subtab"
            :class="{ 'mm-subtab--active': selectedDays === days }"
            :disabled="isRefreshing"
            @click="handleDaysChange(days)"
          >{{ days === 365 ? '1y' : `${days}d` }}</button>
        </div>
      </div>
    </div>

    <label class="mm-search mm-rank__search">
      <svg class="mm-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        v-model="searchQuery"
        type="text"
        class="mm-search__input"
        placeholder="Search players…"
        @input="handleSearchInput"
      />
    </label>

    <div class="mm-tabs mm-rank__tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        class="mm-tab"
        :class="{ 'mm-tab--active': activeTab === tab.id }"
        :disabled="isRefreshing"
        @click="selectTab(tab.id)"
      >{{ tab.label }}</button>
    </div>

    <div v-if="isLoading" class="mm-rank__state">
      <div v-for="i in 5" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">
      {{ error }}
      <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="loadRankings">Retry</button>
    </div>

    <div v-else-if="rankings.length === 0" class="mm-empty">
      No rankings yet for this map.
    </div>

    <table v-else class="mm-list" :class="{ 'is-refreshing': isRefreshing }">
      <thead>
        <tr>
          <th class="mm-list__rank">#</th>
          <th>Player</th>
          <th class="is-num">{{ primaryColumnHeader }}</th>
          <th class="is-num">K/D</th>
          <th class="is-num">Rounds</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="entry in rankings"
          :key="entry.playerName"
          :class="{ 'mm-rank__row--highlight': isHighlighted(entry.playerName) }"
          @click="navigateToPlayer(entry.playerName)"
        >
          <td class="mm-list__rank">{{ entry.rank }}</td>
          <td class="mm-list__name-cell">
            <div class="mm-list__name">
              <span class="mm-list__name-primary">{{ $pn(entry.playerName) }}</span>
            </div>
          </td>
          <td class="is-num" data-cell-label="Primary">{{ formatPrimaryValue(entry) }}</td>
          <td class="is-num" :class="kdClass(entry.kdRatio)" data-cell-label="K/D">{{ entry.kdRatio.toFixed(2) }}</td>
          <td class="is-num is-muted" data-cell-label="Rounds">{{ entry.totalRounds }}</td>
        </tr>
      </tbody>
    </table>

    <div v-if="totalPages > 1" class="mm-rank__pagination">
      <button type="button" class="mm-btn mm-btn--inline" :disabled="currentPage <= 1 || isRefreshing" @click="goToPage(currentPage - 1)">‹</button>
      <button
        v-for="page in paginationRange"
        :key="page"
        type="button"
        class="mm-btn mm-btn--inline"
        :class="{ 'mm-rank__page--active': page === currentPage }"
        :disabled="isRefreshing"
        @click="goToPage(page)"
      >{{ page }}</button>
      <button type="button" class="mm-btn mm-btn--inline" :disabled="currentPage >= totalPages || isRefreshing" @click="goToPage(currentPage + 1)">›</button>
    </div>
  </section>
</template>

<style scoped>
.mm-rank {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mm-rank__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.mm-rank__title {
  margin: 4px 0 0;
}

.mm-rank__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.mm-rank__filter {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mm-rank__search { width: 100%; max-width: 360px; }

.mm-rank__tabs {
  margin-top: 4px;
}

.mm-rank__state { padding: 14px 0; }

.mm-list.is-refreshing { opacity: 0.6; pointer-events: none; }

.mm-rank__row--highlight {
  background: var(--mm-highlight) !important;
}

.mm-rank__pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding-top: 12px;
}

.mm-rank__page--active {
  background: var(--mm-ink);
  color: var(--mm-bg);
  border-color: var(--mm-ink);
}

@media (max-width: 720px) {
  .mm-rank__head { gap: 6px; }
  .mm-rank__filter { flex-wrap: wrap; }
}
</style>
