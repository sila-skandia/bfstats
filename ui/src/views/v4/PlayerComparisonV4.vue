<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import MmPlayerSearch from '@/components/v4/MmPlayerSearch.vue'
import { kdClass, MM_CHART } from '@/views/v4/mmTokens'
import { decodePlayerName } from '@/utils/playerName'
import { getAchievementImageFromObject } from '@/utils/achievementImageUtils'
import { parseUtc } from '@/utils/timeUtils'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)

// --- API shapes — mirror what /stats/players/compare returns ---

interface PerformanceStats { score: number; kills: number; deaths: number }
interface BucketTotal {
  bucket: 'Last30Days' | 'Last6Months' | 'LastYear' | 'AllTime'
  player1Totals: PerformanceStats & { playTimeMinutes?: number }
  player2Totals: PerformanceStats & { playTimeMinutes?: number }
}
interface MapPerformance { mapName: string; player1Totals: PerformanceStats; player2Totals: PerformanceStats }
interface KillRateData { playerName: string; killRate: number }
interface AveragePingData { playerName: string; averagePing: number }
interface HourlyOverlap { hour: number; player1Minutes: number; player2Minutes: number; overlapMinutes: number }
interface HeadToHeadEncounter {
  timestamp: string
  serverGuid: string
  mapName: string
  player1Score: number
  player1Kills: number
  player1Deaths: number
  player2Score: number
  player2Kills: number
  player2Deaths: number
  roundId?: string
}
interface ServerDetails {
  guid: string
  name: string
  ip: string
  port: number
  gameId: string
  country: string
  region: string
}
interface MilestoneAchievement {
  achievementId: string
  achievementName: string
  tier: string
  value: number
  achievedAt: string
}

interface ComparisonData {
  player1: string
  player2: string
  killRates: KillRateData[]
  bucketTotals: BucketTotal[]
  averagePing: AveragePingData[]
  mapPerformance: MapPerformance[]
  headToHead: HeadToHeadEncounter[]
  hourlyOverlap?: HourlyOverlap[]
  serverDetails?: ServerDetails
  commonServers?: ServerDetails[]
  player1MilestoneAchievements?: MilestoneAchievement[]
  player2MilestoneAchievements?: MilestoneAchievement[]
}

const route = useRoute()
const router = useRouter()

const player1Input = ref<string>((route.query.player1 as string) ?? '')
const player2Input = ref<string>((route.query.player2 as string) ?? '')
const player2InputEl = ref<HTMLInputElement | null>(null)

const comparisonData = ref<ComparisonData | null>(null)
const isLoading = ref(false)
const error = ref<string | null>(null)

const calcKd = (kills: number, deaths: number): number => {
  if (deaths === 0) return kills
  return kills / deaths
}
const formatKd = (n: number) => n.toFixed(2)
const formatNumber = (n: number) => n.toLocaleString()

const fetchComparison = async (p1: string, p2: string, includeServerGuid = true, specificServerGuid?: string) => {
  if (!p1 || !p2) {
    comparisonData.value = null
    return
  }
  isLoading.value = true
  error.value = null
  comparisonData.value = null
  try {
    let url = `/stats/players/compare?player1=${encodeURIComponent(p1)}&player2=${encodeURIComponent(p2)}`
    const serverGuid = specificServerGuid || (route.query.serverGuid as string)
    if (serverGuid && includeServerGuid) url += `&serverGuid=${encodeURIComponent(serverGuid)}`

    const response = await fetch(url)
    if (!response.ok) {
      if (response.status === 404) throw new Error('One or both players not found.')
      throw new Error('Failed to fetch comparison data.')
    }
    const data = await response.json() as ComparisonData
    if (!data?.player1 || !data?.player2 || !data?.killRates || !data?.bucketTotals) {
      throw new Error('No comparison data returned — the two players may not have overlapping history.')
    }
    comparisonData.value = data

    const query: Record<string, string> = { player1: p1, player2: p2 }
    if (serverGuid && includeServerGuid) query.serverGuid = serverGuid
    router.replace({ query })
  } catch (e: any) {
    error.value = e?.message ?? 'Comparison feed unavailable.'
  } finally {
    isLoading.value = false
  }
}

const handleCompare = async () => {
  const p1 = player1Input.value.trim()
  const p2 = player2Input.value.trim()
  if (p1 && p2) await fetchComparison(p1, p2)
}

const clearServerFilter = async () => {
  if (player1Input.value && player2Input.value) await fetchComparison(player1Input.value, player2Input.value, false)
}
const selectServer = async (serverGuid: string) => {
  if (player1Input.value && player2Input.value) {
    await fetchComparison(player1Input.value, player2Input.value, true, serverGuid)
  }
}

onMounted(() => {
  const p1 = route.query.player1 as string | undefined
  const p2 = route.query.player2 as string | undefined
  if (p1 && p2) {
    void fetchComparison(p1, p2)
  } else if (p1 && !p2) {
    // One-player deep link — focus the second input.
    void nextTick(() => player2InputEl.value?.focus())
  }
})

// --- Derived ---

const player1Display = computed(() => decodePlayerName(comparisonData.value?.player1 ?? player1Input.value))
const player2Display = computed(() => decodePlayerName(comparisonData.value?.player2 ?? player2Input.value))

const allTime = computed(() => comparisonData.value?.bucketTotals?.find(b => b.bucket === 'AllTime') ?? null)
const player1Kd = computed(() => {
  const t = allTime.value?.player1Totals
  if (!t) return 0
  return calcKd(t.kills, t.deaths)
})
const player2Kd = computed(() => {
  const t = allTime.value?.player2Totals
  if (!t) return 0
  return calcKd(t.kills, t.deaths)
})
const player1IsWinner = computed(() => player1Kd.value > player2Kd.value)
const player2IsWinner = computed(() => player2Kd.value > player1Kd.value)

const player1KillRate = computed(() => {
  const list = comparisonData.value?.killRates ?? []
  return list.find(r => r.playerName === comparisonData.value?.player1)?.killRate ?? 0
})
const player2KillRate = computed(() => {
  const list = comparisonData.value?.killRates ?? []
  return list.find(r => r.playerName === comparisonData.value?.player2)?.killRate ?? 0
})
const player1Ping = computed(() => {
  const list = comparisonData.value?.averagePing ?? []
  return list.find(r => r.playerName === comparisonData.value?.player1)?.averagePing ?? 0
})
const player2Ping = computed(() => {
  const list = comparisonData.value?.averagePing ?? []
  return list.find(r => r.playerName === comparisonData.value?.player2)?.averagePing ?? 0
})

// Bucket totals — tabbed period selector matching the legacy comparison.
// Each tab swaps the visible "Performance over time" block to that window.
type Bucket = BucketTotal['bucket']
const bucketOrder: Bucket[] = ['Last30Days', 'Last6Months', 'LastYear', 'AllTime']
const bucketLabel = (b: Bucket): string => ({
  Last30Days: 'Last 30 days',
  Last6Months: 'Last 6 months',
  LastYear: 'Last year',
  AllTime: 'All time',
})[b]

const selectedBucket = ref<Bucket>('Last30Days')
const bucketMap = computed(() =>
  new Map<Bucket, BucketTotal>((comparisonData.value?.bucketTotals ?? []).map(b => [b.bucket, b])),
)
const availableBuckets = computed(() => bucketOrder.filter(b => bucketMap.value.has(b)))
const currentBucket = computed(() => bucketMap.value.get(selectedBucket.value) ?? null)

// Used for the "+X better" delta tag next to a leading value.
const winnerOf = (a: number, b: number): 'p1' | 'p2' | 'tie' => {
  if (a > b) return 'p1'
  if (b > a) return 'p2'
  return 'tie'
}
const winnerOfInverse = (a: number, b: number): 'p1' | 'p2' | 'tie' => {
  // For deaths: lower is better.
  if (a < b) return 'p1'
  if (b < a) return 'p2'
  return 'tie'
}
const deltaNumber = (a: number, b: number): string => {
  const diff = Math.abs(a - b)
  return diff.toLocaleString()
}
const deltaPlaytime = (a: number, b: number): string => {
  const diff = Math.abs(a - b)
  const hours = Math.floor(diff / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}
const formatPlaytime = (minutes: number): string => {
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

// Map performance comparison — toggleable detailed columns + hide
// "shared" maps where either player has no score (i.e. they technically
// played the map but the other didn't, so the comparison is misleading).
const showMapDetails = ref(false)
const hideNoScoreMaps = ref(false)
type MapSortCol = '' | 'map' | 'p1-score' | 'p1-kills' | 'p1-deaths' | 'p1-kd'
                       | 'p2-score' | 'p2-kills' | 'p2-deaths' | 'p2-kd'
const mapSortColumn = ref<MapSortCol>('')
const mapSortDir = ref<'asc' | 'desc'>('desc')

const setMapSort = (col: MapSortCol) => {
  if (mapSortColumn.value === col) {
    mapSortDir.value = mapSortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    mapSortColumn.value = col
    mapSortDir.value = 'desc'
  }
}

const mapRows = computed(() => {
  let rows = comparisonData.value?.mapPerformance ?? []
  if (hideNoScoreMaps.value) {
    rows = rows.filter(r =>
      r.player1Totals.score > 0 && r.player2Totals.score > 0,
    )
  }
  const projected = rows.map(r => {
    const p1Kd = calcKd(r.player1Totals.kills, r.player1Totals.deaths)
    const p2Kd = calcKd(r.player2Totals.kills, r.player2Totals.deaths)
    return {
      mapName: r.mapName,
      p1Kd,
      p2Kd,
      p1Score: r.player1Totals.score,
      p2Score: r.player2Totals.score,
      p1Kills: r.player1Totals.kills,
      p2Kills: r.player2Totals.kills,
      p1Deaths: r.player1Totals.deaths,
      p2Deaths: r.player2Totals.deaths,
      winner: p1Kd > p2Kd ? 'p1' : p2Kd > p1Kd ? 'p2' : 'tie' as 'p1' | 'p2' | 'tie',
    }
  })
  if (!mapSortColumn.value) return projected
  const sorted = [...projected]
  const dir = mapSortDir.value === 'asc' ? 1 : -1
  sorted.sort((a, b) => {
    const get = (row: typeof a): number | string => {
      switch (mapSortColumn.value) {
        case 'map': return row.mapName
        case 'p1-score': return row.p1Score
        case 'p1-kills': return row.p1Kills
        case 'p1-deaths': return row.p1Deaths
        case 'p1-kd': return row.p1Kd
        case 'p2-score': return row.p2Score
        case 'p2-kills': return row.p2Kills
        case 'p2-deaths': return row.p2Deaths
        case 'p2-kd': return row.p2Kd
        default: return 0
      }
    }
    const av = get(a); const bv = get(b)
    if (typeof av === 'string' && typeof bv === 'string') {
      return dir * av.localeCompare(bv)
    }
    return dir * (Number(av) - Number(bv))
  })
  return sorted
})

const mapSortArrow = (col: MapSortCol): string => {
  if (mapSortColumn.value !== col) return ''
  return mapSortDir.value === 'asc' ? ' ▲' : ' ▼'
}

// Head-to-head encounters
const headToHead = computed(() => comparisonData.value?.headToHead ?? [])

// Hourly overlap chart
const overlapChartData = computed(() => {
  const list = comparisonData.value?.hourlyOverlap ?? []
  if (list.length === 0) return { labels: [], datasets: [] }
  const labels = list.map(h => `${h.hour.toString().padStart(2, '0')}h`)
  return {
    labels,
    datasets: [
      {
        label: player1Display.value,
        data: list.map(h => h.player1Minutes),
        borderColor: MM_CHART.accent,
        backgroundColor: 'rgba(125, 136, 73, 0.10)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
      },
      {
        label: player2Display.value,
        data: list.map(h => h.player2Minutes),
        borderColor: MM_CHART.kill,
        backgroundColor: 'rgba(214, 90, 90, 0.10)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
      },
      {
        label: 'Overlap',
        data: list.map(h => h.overlapMinutes),
        borderColor: MM_CHART.elite,
        backgroundColor: 'transparent',
        borderDash: [4, 3],
        fill: false,
        tension: 0.3,
        pointRadius: 0,
      },
    ],
  }
})

const overlapChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: { display: true, labels: { color: MM_CHART.inkSoft, font: { size: 11 } } },
    tooltip: {
      backgroundColor: MM_CHART.surfaceSoft,
      titleColor: MM_CHART.ink,
      bodyColor: MM_CHART.inkSoft,
      borderColor: MM_CHART.gridStrong,
      borderWidth: 1,
      callbacks: { label: (ctx: any) => `${ctx.dataset.label}: ${ctx.parsed.y} min` },
    },
  },
  scales: {
    x: { ticks: { color: MM_CHART.inkMuted, font: { size: 9 } }, grid: { display: false }, title: { display: true, text: 'Hour (UTC)', color: MM_CHART.inkMuted, font: { size: 10 } } },
    y: { ticks: { color: MM_CHART.inkMuted, font: { size: 9 } }, grid: { color: MM_CHART.grid }, title: { display: true, text: 'Minutes', color: MM_CHART.inkMuted, font: { size: 10 } } },
  },
}))

// Milestone achievement panels — render with existing tile pattern
const player1Milestones = computed(() => comparisonData.value?.player1MilestoneAchievements ?? [])
const player2Milestones = computed(() => comparisonData.value?.player2MilestoneAchievements ?? [])
const getAchImg = (id: string, tier?: string) => getAchievementImageFromObject({ achievementId: id, tier })

// Navigation to V4 player profile from any in-page link
const goPlayer = (name: string) => router.push(`/v4/players/${encodeURIComponent(name)}`)

// Open the round report with both players highlighted, from a h2h row.
const openH2HRound = (roundId: string) => {
  const p1 = comparisonData.value?.player1 ?? player1Input.value
  const p2 = comparisonData.value?.player2 ?? player2Input.value
  router.push({
    path: `/v4/rounds/${encodeURIComponent(roundId)}/report`,
    query: { players: `${p1},${p2}` },
  })
}

const formatDateShort = (iso: string): string => {
  const d = parseUtc(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <div class="mm-container mm-section">
    <div class="mm-meta-row" style="margin-bottom: 10px">
      <router-link
        to="/v4/players"
        class="mm-meta-row__strong"
        style="text-decoration: underline; text-underline-offset: 3px"
      >‹ PLAYERS</router-link>
    </div>

    <h1 class="mm-display">Compare</h1>
    <p class="mm-card__hint" style="margin-top: 6px">Two players, side by side — K/D, kill rate, overlap, head-to-head.</p>

    <hr class="mm-rule" style="margin-top: 24px" />

    <!-- Search row -->
    <div class="mm-cmp__search">
      <MmPlayerSearch
        v-model="player1Input"
        placeholder="Player 1"
        :full-width="true"
        @enter="handleCompare"
      />
      <span class="mm-cmp__vs">VS</span>
      <MmPlayerSearch
        v-model="player2Input"
        placeholder="Player 2"
        :full-width="true"
        @enter="handleCompare"
      />
      <button
        type="button"
        class="mm-btn mm-btn--accent"
        :disabled="isLoading || !player1Input.trim() || !player2Input.trim()"
        @click="handleCompare"
      >
        {{ isLoading ? 'Comparing…' : 'Compare' }}
      </button>
    </div>

    <!-- Loading / error / intro -->
    <div v-if="isLoading" style="padding: 32px 0">
      <div v-for="i in 5" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">
      {{ error }}
      <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="handleCompare">Retry</button>
    </div>

    <div v-else-if="!comparisonData" class="mm-empty" style="padding: 48px 16px">
      Enter two players above and run a comparison.
    </div>

    <template v-else>
      <!-- Common servers filter -->
      <section v-if="comparisonData.commonServers && comparisonData.commonServers.length > 0" style="margin-top: 24px">
        <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 10px">Common servers</div>
        <div class="mm-cmp__servers">
          <button
            type="button"
            class="mm-btn mm-btn--inline"
            :class="{ 'mm-cmp__server--active': !comparisonData.serverDetails }"
            @click="clearServerFilter"
          >All servers</button>
          <button
            v-for="srv in comparisonData.commonServers"
            :key="srv.guid"
            type="button"
            class="mm-btn mm-btn--inline"
            :class="{ 'mm-cmp__server--active': comparisonData.serverDetails?.guid === srv.guid }"
            @click="selectServer(srv.guid)"
          >{{ srv.name }}</button>
        </div>
      </section>

      <!-- Summary cards -->
      <section style="margin-top: 28px">
        <div class="mm-cmp__summary">
          <article
            class="mm-cmp__card"
            :class="{ 'mm-cmp__card--winner-p1': player1IsWinner }"
            @click="goPlayer(comparisonData.player1)"
          >
            <div class="mm-eyebrow">Player 1</div>
            <h2 class="mm-cmp__name">{{ player1Display }}</h2>
            <div class="mm-cmp__kd" :class="kdClass(player1Kd)">{{ formatKd(player1Kd) }}</div>
            <div class="mm-cmp__kd-meta">all-time K/D</div>
            <span v-if="player1IsWinner" class="mm-cmp__crown">★ Higher K/D</span>
          </article>

          <div class="mm-cmp__vs-divider">VS</div>

          <article
            class="mm-cmp__card mm-cmp__card--alt"
            :class="{ 'mm-cmp__card--winner-p2': player2IsWinner }"
            @click="goPlayer(comparisonData.player2)"
          >
            <div class="mm-eyebrow">Player 2</div>
            <h2 class="mm-cmp__name">{{ player2Display }}</h2>
            <div class="mm-cmp__kd" :class="kdClass(player2Kd)">{{ formatKd(player2Kd) }}</div>
            <div class="mm-cmp__kd-meta">all-time K/D</div>
            <span v-if="player2IsWinner" class="mm-cmp__crown">★ Higher K/D</span>
          </article>
        </div>
      </section>

      <!-- Core stats: kill rate + ping -->
      <section style="margin-top: 32px">
        <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 12px">Core stats</div>
        <div class="mm-cmp__core">
          <div class="mm-cmp__metric">
            <div class="mm-eyebrow">Kill rate · per min</div>
            <div class="mm-cmp__metric-row">
              <span class="mm-cmp__metric-side mm-cmp__metric-side--p1" :class="{ 'mm-cmp__metric-side--lead': player1KillRate > player2KillRate }">{{ player1KillRate.toFixed(2) }}</span>
              <div class="mm-cmp__metric-bar">
                <div
                  class="mm-cmp__metric-fill mm-cmp__metric-fill--p1"
                  :style="{ width: (player1KillRate / Math.max(0.001, player1KillRate + player2KillRate)) * 100 + '%' }"
                />
                <div
                  class="mm-cmp__metric-fill mm-cmp__metric-fill--p2"
                  :style="{ width: (player2KillRate / Math.max(0.001, player1KillRate + player2KillRate)) * 100 + '%' }"
                />
              </div>
              <span class="mm-cmp__metric-side mm-cmp__metric-side--p2" :class="{ 'mm-cmp__metric-side--lead': player2KillRate > player1KillRate }">{{ player2KillRate.toFixed(2) }}</span>
            </div>
          </div>

          <div class="mm-cmp__metric">
            <div class="mm-eyebrow">Avg ping · lower is better</div>
            <div class="mm-cmp__metric-row">
              <span class="mm-cmp__metric-side mm-cmp__metric-side--p1" :class="{ 'mm-cmp__metric-side--lead': player1Ping < player2Ping && player1Ping > 0 }">{{ Math.round(player1Ping) }}ms</span>
              <div class="mm-cmp__metric-bar">
                <div
                  class="mm-cmp__metric-fill mm-cmp__metric-fill--p1"
                  :style="{ width: (player1Ping / Math.max(1, player1Ping + player2Ping)) * 100 + '%' }"
                />
                <div
                  class="mm-cmp__metric-fill mm-cmp__metric-fill--p2"
                  :style="{ width: (player2Ping / Math.max(1, player1Ping + player2Ping)) * 100 + '%' }"
                />
              </div>
              <span class="mm-cmp__metric-side mm-cmp__metric-side--p2" :class="{ 'mm-cmp__metric-side--lead': player2Ping < player1Ping && player2Ping > 0 }">{{ Math.round(player2Ping) }}ms</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Performance over time — tabbed period selector + 4 metric rows
           (Score, Kills, Deaths, Playtime) with delta indicators. -->
      <section v-if="availableBuckets.length > 0" style="margin-top: 32px">
        <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 12px">Performance over time</div>
        <div class="mm-tabs mm-cmp__period-tabs">
          <button
            v-for="b in availableBuckets"
            :key="b"
            type="button"
            class="mm-tab"
            :class="{ 'mm-tab--active': selectedBucket === b }"
            @click="selectedBucket = b"
          >{{ bucketLabel(b) }}</button>
        </div>

        <div v-if="currentBucket" class="mm-cmp__perf">
          <!-- Score: higher better -->
          <div class="mm-cmp__perf-row">
            <div class="mm-cmp__perf-label">Score</div>
            <div
              class="mm-cmp__perf-cell"
              :class="{ 'mm-cmp__perf-cell--lead': winnerOf(currentBucket.player1Totals.score, currentBucket.player2Totals.score) === 'p1' }"
            >
              <span class="mm-cmp__perf-value">{{ formatNumber(currentBucket.player1Totals.score) }}</span>
              <span v-if="winnerOf(currentBucket.player1Totals.score, currentBucket.player2Totals.score) === 'p1'" class="mm-cmp__perf-delta">+{{ deltaNumber(currentBucket.player1Totals.score, currentBucket.player2Totals.score) }} better</span>
            </div>
            <div
              class="mm-cmp__perf-cell"
              :class="{ 'mm-cmp__perf-cell--lead': winnerOf(currentBucket.player1Totals.score, currentBucket.player2Totals.score) === 'p2' }"
            >
              <span class="mm-cmp__perf-value">{{ formatNumber(currentBucket.player2Totals.score) }}</span>
              <span v-if="winnerOf(currentBucket.player1Totals.score, currentBucket.player2Totals.score) === 'p2'" class="mm-cmp__perf-delta">+{{ deltaNumber(currentBucket.player1Totals.score, currentBucket.player2Totals.score) }} better</span>
            </div>
          </div>

          <!-- Kills: higher better -->
          <div class="mm-cmp__perf-row">
            <div class="mm-cmp__perf-label">Kills</div>
            <div
              class="mm-cmp__perf-cell"
              :class="{ 'mm-cmp__perf-cell--lead': winnerOf(currentBucket.player1Totals.kills, currentBucket.player2Totals.kills) === 'p1' }"
            >
              <span class="mm-cmp__perf-value mm-num--kill">{{ formatNumber(currentBucket.player1Totals.kills) }}</span>
              <span v-if="winnerOf(currentBucket.player1Totals.kills, currentBucket.player2Totals.kills) === 'p1'" class="mm-cmp__perf-delta">+{{ deltaNumber(currentBucket.player1Totals.kills, currentBucket.player2Totals.kills) }} more</span>
            </div>
            <div
              class="mm-cmp__perf-cell"
              :class="{ 'mm-cmp__perf-cell--lead': winnerOf(currentBucket.player1Totals.kills, currentBucket.player2Totals.kills) === 'p2' }"
            >
              <span class="mm-cmp__perf-value mm-num--kill">{{ formatNumber(currentBucket.player2Totals.kills) }}</span>
              <span v-if="winnerOf(currentBucket.player1Totals.kills, currentBucket.player2Totals.kills) === 'p2'" class="mm-cmp__perf-delta">+{{ deltaNumber(currentBucket.player1Totals.kills, currentBucket.player2Totals.kills) }} more</span>
            </div>
          </div>

          <!-- Deaths: lower better (winner is the inverse) -->
          <div class="mm-cmp__perf-row">
            <div class="mm-cmp__perf-label">Deaths · lower wins</div>
            <div
              class="mm-cmp__perf-cell"
              :class="{ 'mm-cmp__perf-cell--lead': winnerOfInverse(currentBucket.player1Totals.deaths, currentBucket.player2Totals.deaths) === 'p1' }"
            >
              <span class="mm-cmp__perf-value mm-num--death">{{ formatNumber(currentBucket.player1Totals.deaths) }}</span>
              <span v-if="winnerOfInverse(currentBucket.player1Totals.deaths, currentBucket.player2Totals.deaths) === 'p1'" class="mm-cmp__perf-delta">−{{ deltaNumber(currentBucket.player1Totals.deaths, currentBucket.player2Totals.deaths) }} fewer</span>
            </div>
            <div
              class="mm-cmp__perf-cell"
              :class="{ 'mm-cmp__perf-cell--lead': winnerOfInverse(currentBucket.player1Totals.deaths, currentBucket.player2Totals.deaths) === 'p2' }"
            >
              <span class="mm-cmp__perf-value mm-num--death">{{ formatNumber(currentBucket.player2Totals.deaths) }}</span>
              <span v-if="winnerOfInverse(currentBucket.player1Totals.deaths, currentBucket.player2Totals.deaths) === 'p2'" class="mm-cmp__perf-delta">−{{ deltaNumber(currentBucket.player1Totals.deaths, currentBucket.player2Totals.deaths) }} fewer</span>
            </div>
          </div>

          <!-- Playtime -->
          <div class="mm-cmp__perf-row">
            <div class="mm-cmp__perf-label">Playtime</div>
            <div
              class="mm-cmp__perf-cell"
              :class="{ 'mm-cmp__perf-cell--lead': winnerOf(currentBucket.player1Totals.playTimeMinutes ?? 0, currentBucket.player2Totals.playTimeMinutes ?? 0) === 'p1' }"
            >
              <span class="mm-cmp__perf-value">{{ formatPlaytime(currentBucket.player1Totals.playTimeMinutes ?? 0) }}</span>
              <span v-if="winnerOf(currentBucket.player1Totals.playTimeMinutes ?? 0, currentBucket.player2Totals.playTimeMinutes ?? 0) === 'p1'" class="mm-cmp__perf-delta">+{{ deltaPlaytime(currentBucket.player1Totals.playTimeMinutes ?? 0, currentBucket.player2Totals.playTimeMinutes ?? 0) }} more</span>
            </div>
            <div
              class="mm-cmp__perf-cell"
              :class="{ 'mm-cmp__perf-cell--lead': winnerOf(currentBucket.player1Totals.playTimeMinutes ?? 0, currentBucket.player2Totals.playTimeMinutes ?? 0) === 'p2' }"
            >
              <span class="mm-cmp__perf-value">{{ formatPlaytime(currentBucket.player2Totals.playTimeMinutes ?? 0) }}</span>
              <span v-if="winnerOf(currentBucket.player1Totals.playTimeMinutes ?? 0, currentBucket.player2Totals.playTimeMinutes ?? 0) === 'p2'" class="mm-cmp__perf-delta">+{{ deltaPlaytime(currentBucket.player1Totals.playTimeMinutes ?? 0, currentBucket.player2Totals.playTimeMinutes ?? 0) }} more</span>
            </div>
          </div>
        </div>
      </section>

      <!-- Hourly overlap -->
      <section v-if="comparisonData.hourlyOverlap && comparisonData.hourlyOverlap.length > 0" style="margin-top: 32px">
        <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 12px">Hourly playtime overlap</div>
        <p class="mm-card__hint" style="margin-bottom: 12px">When both players are most often online — the dashed line is shared time on the same server.</p>
        <div style="height: 220px">
          <Line :key="`overlap-${comparisonData.hourlyOverlap.length}`" :data="overlapChartData" :options="overlapChartOptions" />
        </div>
      </section>

      <!-- Map performance -->
      <section v-if="comparisonData.mapPerformance && comparisonData.mapPerformance.length > 0" style="margin-top: 32px">
        <div class="mm-cmp__maps-head">
          <div class="mm-eyebrow mm-eyebrow--strong">Map performance</div>
          <div class="mm-cmp__maps-actions">
            <label class="mm-cmp__toggle">
              <input v-model="hideNoScoreMaps" type="checkbox" />
              Hide no-score maps
            </label>
            <button
              type="button"
              class="mm-btn mm-btn--inline"
              @click="showMapDetails = !showMapDetails"
            >{{ showMapDetails ? 'Hide details' : 'Show Score / K / D' }}</button>
          </div>
        </div>
        <div v-if="mapRows.length === 0" class="mm-empty" style="padding: 32px">
          No maps where both players have scored.
        </div>
        <table v-else class="mm-list mm-list--dense">
          <thead>
            <tr>
              <th @click="setMapSort('map')" style="cursor: pointer">Map{{ mapSortArrow('map') }}</th>
              <th v-if="showMapDetails" class="is-num" @click="setMapSort('p1-score')" style="cursor: pointer">{{ player1Display }} score{{ mapSortArrow('p1-score') }}</th>
              <th v-if="showMapDetails" class="is-num" @click="setMapSort('p1-kills')" style="cursor: pointer">{{ player1Display }} K{{ mapSortArrow('p1-kills') }}</th>
              <th v-if="showMapDetails" class="is-num" @click="setMapSort('p1-deaths')" style="cursor: pointer">{{ player1Display }} D{{ mapSortArrow('p1-deaths') }}</th>
              <th class="is-num" @click="setMapSort('p1-kd')" style="cursor: pointer">{{ player1Display }} K/D{{ mapSortArrow('p1-kd') }}</th>
              <th v-if="showMapDetails" class="is-num" @click="setMapSort('p2-score')" style="cursor: pointer">{{ player2Display }} score{{ mapSortArrow('p2-score') }}</th>
              <th v-if="showMapDetails" class="is-num" @click="setMapSort('p2-kills')" style="cursor: pointer">{{ player2Display }} K{{ mapSortArrow('p2-kills') }}</th>
              <th v-if="showMapDetails" class="is-num" @click="setMapSort('p2-deaths')" style="cursor: pointer">{{ player2Display }} D{{ mapSortArrow('p2-deaths') }}</th>
              <th class="is-num" @click="setMapSort('p2-kd')" style="cursor: pointer">{{ player2Display }} K/D{{ mapSortArrow('p2-kd') }}</th>
              <th class="is-num">Edge</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in mapRows" :key="r.mapName">
              <td class="mm-list__name-cell">
                <div class="mm-list__name">
                  <span class="mm-list__name-primary">{{ r.mapName }}</span>
                </div>
              </td>
              <td v-if="showMapDetails" class="is-num" data-cell-label="P1 score">{{ formatNumber(r.p1Score) }}</td>
              <td v-if="showMapDetails" class="is-num mm-num--kill" data-cell-label="P1 K">{{ r.p1Kills }}</td>
              <td v-if="showMapDetails" class="is-num mm-num--death" data-cell-label="P1 D">{{ r.p1Deaths }}</td>
              <td class="is-num" data-cell-label="P1 K/D">
                <span :class="r.winner === 'p1' ? 'mm-cmp__win' : 'is-muted'">{{ formatKd(r.p1Kd) }}</span>
              </td>
              <td v-if="showMapDetails" class="is-num" data-cell-label="P2 score">{{ formatNumber(r.p2Score) }}</td>
              <td v-if="showMapDetails" class="is-num mm-num--kill" data-cell-label="P2 K">{{ r.p2Kills }}</td>
              <td v-if="showMapDetails" class="is-num mm-num--death" data-cell-label="P2 D">{{ r.p2Deaths }}</td>
              <td class="is-num" data-cell-label="P2 K/D">
                <span :class="r.winner === 'p2' ? 'mm-cmp__win' : 'is-muted'">{{ formatKd(r.p2Kd) }}</span>
              </td>
              <td class="is-num" data-cell-label="Edge">
                <span v-if="r.winner === 'p1'" class="mm-cmp__edge mm-cmp__edge--p1">{{ player1Display }}</span>
                <span v-else-if="r.winner === 'p2'" class="mm-cmp__edge mm-cmp__edge--p2">{{ player2Display }}</span>
                <span v-else class="is-muted">Tie</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Head-to-head encounters -->
      <section v-if="headToHead.length > 0" style="margin-top: 32px">
        <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 12px">Head-to-head · last {{ headToHead.length }} rounds together</div>
        <p class="mm-card__hint" style="margin-bottom: 12px">Click a row to open the round report with both players highlighted.</p>
        <table class="mm-list mm-list--dense">
          <thead>
            <tr>
              <th>Date · map</th>
              <th class="is-num mm-list__col--hide-sm">{{ player1Display }} score</th>
              <th class="is-num">{{ player1Display }} K / D</th>
              <th class="is-num mm-list__col--hide-sm">{{ player2Display }} score</th>
              <th class="is-num">{{ player2Display }} K / D</th>
              <th class="is-num">Edge</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(h, i) in headToHead"
              :key="i"
              :class="{ 'mm-cmp__h2h-row--clickable': !!h.roundId }"
              @click="h.roundId && openH2HRound(h.roundId)"
            >
              <td class="mm-list__name-cell">
                <div class="mm-list__name">
                  <span class="mm-list__name-primary">{{ formatDateShort(h.timestamp) }}</span>
                  <span class="mm-list__name-sub">{{ h.mapName }}<span v-if="h.roundId"> · round report →</span></span>
                </div>
              </td>
              <td class="is-num mm-list__col--hide-sm" data-cell-label="P1 score">{{ formatNumber(h.player1Score) }}</td>
              <td class="is-num" data-cell-label="P1 K/D">
                <span class="mm-num--kill">{{ h.player1Kills }}</span>/<span class="mm-num--death">{{ h.player1Deaths }}</span>
                <span class="mm-num__sep">·</span>
                <span :class="kdClass(calcKd(h.player1Kills, h.player1Deaths))">{{ formatKd(calcKd(h.player1Kills, h.player1Deaths)) }}</span>
              </td>
              <td class="is-num mm-list__col--hide-sm" data-cell-label="P2 score">{{ formatNumber(h.player2Score) }}</td>
              <td class="is-num" data-cell-label="P2 K/D">
                <span class="mm-num--kill">{{ h.player2Kills }}</span>/<span class="mm-num--death">{{ h.player2Deaths }}</span>
                <span class="mm-num__sep">·</span>
                <span :class="kdClass(calcKd(h.player2Kills, h.player2Deaths))">{{ formatKd(calcKd(h.player2Kills, h.player2Deaths)) }}</span>
              </td>
              <td class="is-num" data-cell-label="Edge">
                <span v-if="h.player1Kills > h.player2Kills" class="mm-cmp__edge mm-cmp__edge--p1">{{ player1Display }}</span>
                <span v-else-if="h.player2Kills > h.player1Kills" class="mm-cmp__edge mm-cmp__edge--p2">{{ player2Display }}</span>
                <span v-else class="is-muted">Tie</span>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Milestones -->
      <section
        v-if="player1Milestones.length > 0 || player2Milestones.length > 0"
        style="margin-top: 32px"
      >
        <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 12px">Operational milestones</div>
        <div class="mm-cmp__milestones">
          <div>
            <div class="mm-eyebrow" style="margin-bottom: 10px">{{ player1Display }}</div>
            <div v-if="player1Milestones.length === 0" class="mm-empty" style="padding: 16px">No milestones recorded.</div>
            <div v-else class="mm-cmp__badges">
              <div
                v-for="m in player1Milestones"
                :key="m.achievementId"
                class="mm-cmp__badge"
                :title="m.achievementName"
              >
                <img :src="getAchImg(m.achievementId, m.tier)" :alt="m.achievementName" loading="lazy" />
                <span class="mm-cmp__badge-name">{{ m.achievementName }}</span>
              </div>
            </div>
          </div>

          <div>
            <div class="mm-eyebrow" style="margin-bottom: 10px">{{ player2Display }}</div>
            <div v-if="player2Milestones.length === 0" class="mm-empty" style="padding: 16px">No milestones recorded.</div>
            <div v-else class="mm-cmp__badges">
              <div
                v-for="m in player2Milestones"
                :key="m.achievementId"
                class="mm-cmp__badge"
                :title="m.achievementName"
              >
                <img :src="getAchImg(m.achievementId, m.tier)" :alt="m.achievementName" loading="lazy" />
                <span class="mm-cmp__badge-name">{{ m.achievementName }}</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.mm-cmp__search {
  display: grid;
  grid-template-columns: 1fr auto 1fr auto;
  gap: 12px 16px;
  align-items: center;
  margin-top: 20px;
}
.mm-cmp__vs {
  font-family: var(--mm-font-mono);
  font-size: 13px;
  letter-spacing: 0.2em;
  color: var(--mm-accent);
  font-weight: 600;
}
@media (max-width: 720px) {
  .mm-cmp__search {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .mm-cmp__vs { text-align: center; }
}

.mm-cmp__servers {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.mm-cmp__server--active {
  background: var(--mm-bg-soft);
  color: var(--mm-ink);
  border-color: var(--mm-accent);
}

.mm-cmp__summary {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 16px;
  align-items: stretch;
}
@media (max-width: 720px) {
  .mm-cmp__summary { grid-template-columns: 1fr; }
}

.mm-cmp__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 20px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.mm-cmp__card:hover { border-color: var(--mm-ink); background: var(--mm-bg-soft); }
.mm-cmp__card--winner-p1 { border-color: var(--mm-accent); }
.mm-cmp__card--winner-p2 { border-color: var(--mm-accent); }
.mm-cmp__card--alt { text-align: right; align-items: flex-end; }

.mm-cmp__name {
  margin: 0;
  font-family: var(--mm-font-display);
  font-size: clamp(22px, 2.5vw, 30px);
  font-weight: 500;
  line-height: 1.1;
  color: var(--mm-ink);
}

.mm-cmp__kd {
  font-family: var(--mm-font-mono);
  font-size: 44px;
  font-weight: 500;
  line-height: 1;
  margin-top: 8px;
}
.mm-cmp__kd-meta {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-cmp__crown {
  position: absolute;
  top: 12px;
  right: 12px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--mm-accent);
}
.mm-cmp__card--alt .mm-cmp__crown { right: auto; left: 12px; }

.mm-cmp__vs-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--mm-font-mono);
  font-size: 18px;
  letter-spacing: 0.3em;
  color: var(--mm-ink-muted);
  min-width: 60px;
}
@media (max-width: 720px) {
  .mm-cmp__vs-divider { padding: 6px 0; }
  .mm-cmp__card--alt { text-align: left; align-items: flex-start; }
  .mm-cmp__card--alt .mm-cmp__crown { left: auto; right: 12px; }
}

.mm-cmp__core {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}
@media (max-width: 720px) {
  .mm-cmp__core { grid-template-columns: 1fr; }
}

.mm-cmp__metric { display: flex; flex-direction: column; gap: 6px; }
.mm-cmp__metric-row {
  display: grid;
  grid-template-columns: 60px 1fr 60px;
  gap: 10px;
  align-items: center;
}
.mm-cmp__metric-side {
  font-family: var(--mm-font-mono);
  font-size: 13px;
  color: var(--mm-ink-soft);
}
.mm-cmp__metric-side--p1 { text-align: right; }
.mm-cmp__metric-side--p2 { text-align: left; }
.mm-cmp__metric-side--lead { color: var(--mm-accent); font-weight: 600; }
.mm-cmp__metric-bar {
  display: flex;
  height: 6px;
  border-radius: 2px;
  overflow: hidden;
  background: var(--mm-bg-mute);
}
.mm-cmp__metric-fill--p1 { background: var(--mm-accent); }
.mm-cmp__metric-fill--p2 { background: var(--mm-kill); }

.mm-cmp__win {
  color: var(--mm-accent);
  font-weight: 600;
}
.mm-cmp__edge {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
}
.mm-cmp__edge--p1 { color: var(--mm-accent); }
.mm-cmp__edge--p2 { color: var(--mm-kill); }

.mm-cmp__milestones {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}
@media (max-width: 720px) {
  .mm-cmp__milestones { grid-template-columns: 1fr; }
}

.mm-cmp__badges {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 14px;
}
.mm-cmp__badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 8px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  text-align: center;
}
.mm-cmp__badge img {
  width: 56px;
  height: 56px;
  object-fit: contain;
}
.mm-cmp__badge-name {
  font-family: var(--mm-font-display);
  font-size: 11.5px;
  line-height: 1.3;
  color: var(--mm-ink);
}

.mm-cmp__maps-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.mm-cmp__maps-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}
.mm-cmp__toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-soft);
  cursor: pointer;
}
.mm-cmp__toggle input { accent-color: var(--mm-accent); }

.mm-cmp__h2h-row--clickable { cursor: pointer; }

.mm-cmp__period-tabs {
  margin-bottom: 16px;
}

.mm-cmp__perf {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mm-cmp__perf-row {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) 1fr 1fr;
  gap: 8px 24px;
  align-items: center;
  padding: 14px 16px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
}

.mm-cmp__perf-label {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-cmp__perf-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: center;
}

.mm-cmp__perf-value {
  font-family: var(--mm-font-mono);
  font-size: 22px;
  font-weight: 500;
  color: var(--mm-ink-soft);
  line-height: 1;
}

.mm-cmp__perf-cell--lead .mm-cmp__perf-value {
  color: var(--mm-accent);
}
.mm-cmp__perf-cell--lead .mm-cmp__perf-value.mm-num--kill { color: var(--mm-kd-good); }
.mm-cmp__perf-cell--lead .mm-cmp__perf-value.mm-num--death { color: var(--mm-success); }

.mm-cmp__perf-delta {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--mm-accent);
}

@media (max-width: 720px) {
  .mm-cmp__perf-row {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto;
    gap: 8px;
  }
  .mm-cmp__perf-label {
    grid-column: 1 / -1;
    text-align: left;
  }
}
</style>
