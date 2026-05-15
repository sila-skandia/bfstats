<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { fetchSessions, type PlayerContextInfo } from '@/services/playerStatsService'
import { kdClass, MM_CHART, teamColor, teamFill } from '@/views/v4/mmTokens'
import { decodePlayerName } from '@/utils/playerName'
import { parseUtc, formatLocalTooltip } from '@/utils/timeUtils'
import { Line } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

interface Props {
  playerName?: string
  serverName?: string
  mapName?: string
}

const props = defineProps<Props>()
const router = useRouter()

interface TopPlayer {
  sessionId: number
  roundId: string
  playerName: string
  startTime: string
  endTime: string
  durationMinutes: number
  score: number
  kills: number
  deaths: number
  isActive: boolean
}

interface RoundData {
  roundId: string
  serverName: string
  serverGuid: string
  mapName: string
  gameType: string
  startTime: string
  endTime: string
  durationMinutes: number
  participantCount: number
  totalSessions: number
  isActive: boolean
  team1Label?: string
  team2Label?: string
  team1Points?: number
  team2Points?: number
  topPlayers?: TopPlayer[]
}

const rounds = ref<RoundData[]>([])
const playerInfo = ref<PlayerContextInfo | null>(null)
const playerStatsData = ref<Record<string, TopPlayer>>({})
const roundTopPlayers = ref<Record<string, TopPlayer[]>>({})
const loading = ref(true)
const error = ref<string | null>(null)
const currentPage = ref(1)
const pageSize = ref(25)
const totalItems = ref(0)
const totalPages = ref(0)

const showFilters = ref(false)
// On the global rounds index (no player/server context), default to hiding
// empty rounds — the listing is otherwise dominated by 0-player housekeeping
// entries. Player/server-scoped views keep no minimum so single-player rounds
// still surface.
const isGlobalRoundsView = !props.playerName && !props.serverName
const filterMinParticipants = ref<number | null>(isGlobalRoundsView ? 1 : null)
const filterMapName = ref('')
const filterDateFrom = ref('')
const filterDateTo = ref('')

const contextLabel = computed(() => {
  if (props.playerName) return decodePlayerName(props.playerName)
  if (props.serverName) return props.serverName
  return 'Sessions'
})

const backTarget = computed(() => {
  if (props.playerName) return `/v4/players/${encodeURIComponent(props.playerName)}`
  if (props.serverName) return `/v4/servers/detail/${encodeURIComponent(props.serverName)}`
  return '/v4/servers/bf1942'
})

const fetchData = async () => {
  loading.value = true
  error.value = null

  try {
    const filters: Record<string, string> = {}
    // Backend expects `playerNames` (plural — bound to `List<string>` in
    // RoundsController). Sending `playerName` silently no-ops the filter
    // and returns every round. See verification/player-sessions.md.
    if (props.playerName) filters.playerNames = props.playerName
    if (props.serverName) filters.serverName = props.serverName
    const effectiveMapName = filterMapName.value.trim() || props.mapName
    if (effectiveMapName) filters.mapName = effectiveMapName
    if (filterMinParticipants.value !== null && filterMinParticipants.value > 0) {
      filters.minParticipants = filterMinParticipants.value.toString()
    }
    if (filterDateFrom.value) {
      filters.startTimeFrom = new Date(filterDateFrom.value).toISOString()
    }
    if (filterDateTo.value) {
      const toDate = new Date(filterDateTo.value)
      toDate.setHours(23, 59, 59, 999)
      filters.startTimeTo = toDate.toISOString()
    }

    const [response, playerResponse] = await Promise.all([
      fetchSessions(currentPage.value, pageSize.value, filters, 'startTime', 'desc', false),
      props.playerName
        ? fetchSessions(currentPage.value, pageSize.value, filters, 'startTime', 'desc', true)
        : Promise.resolve(null),
    ])

    rounds.value = response.items as unknown as RoundData[]
    playerInfo.value = response.playerInfo || null
    totalItems.value = response.totalItems
    totalPages.value = response.totalPages

    // First response (isPlayerView=false) carries the global top-3 leaderboard
    // for every round. Cache it by roundId so the table can show rank context.
    const topByRound: Record<string, TopPlayer[]> = {}
    for (const round of rounds.value) {
      if (round.topPlayers && round.topPlayers.length > 0) {
        topByRound[round.roundId] = round.topPlayers
      }
    }
    roundTopPlayers.value = topByRound

    if (playerResponse) {
      const data: Record<string, TopPlayer> = {}
      for (const round of playerResponse.items as unknown as RoundData[]) {
        if (round.topPlayers && round.topPlayers.length > 0) {
          data[round.roundId] = round.topPlayers[0]
        }
      }
      playerStatsData.value = data
    } else {
      playerStatsData.value = {}
    }
  } catch (err) {
    console.error('Error fetching sessions:', err)
    error.value = 'Failed to load sessions. Please try again.'
  } finally {
    loading.value = false
  }
}

const applyFilters = () => {
  currentPage.value = 1
  fetchData()
}

const resetFilters = () => {
  filterMinParticipants.value = isGlobalRoundsView ? 1 : null
  filterMapName.value = ''
  filterDateFrom.value = ''
  filterDateTo.value = ''
  currentPage.value = 1
  fetchData()
}

const goToPage = (page: number) => {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
}

const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`
}

const formatTime = (iso: string): string => {
  const d = parseUtc(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const goRound = (round: RoundData) => {
  const query: Record<string, string> = {}
  if (props.playerName) query.players = props.playerName
  router.push({ path: `/v4/rounds/${encodeURIComponent(round.roundId)}/report`, query })
}

const goServer = (round: RoundData) => {
  router.push(`/v4/servers/detail/${encodeURIComponent(round.serverName)}`)
}

const playerStatsKd = (stats: TopPlayer): number => {
  return stats.deaths > 0 ? stats.kills / stats.deaths : stats.kills
}

const playerRankInRound = (round: RoundData): number | null => {
  if (!props.playerName) return null
  const top = roundTopPlayers.value[round.roundId]
  if (!top) return null
  const idx = top.findIndex(p => p.playerName === props.playerName)
  return idx >= 0 ? idx + 1 : null
}

const playerAggregate = computed(() => {
  const values = Object.values(playerStatsData.value)
  if (values.length === 0) return null
  const totalKills = values.reduce((s, p) => s + p.kills, 0)
  const totalDeaths = values.reduce((s, p) => s + p.deaths, 0)
  const avgKills = totalKills / values.length
  const bestKills = Math.max(...values.map(p => p.kills))
  const bestScore = Math.max(...values.map(p => p.score))
  const kd = totalDeaths > 0 ? totalKills / totalDeaths : totalKills
  let podiums = 0
  for (const round of rounds.value) {
    const top = roundTopPlayers.value[round.roundId]
    if (top && top.slice(0, 3).some(p => p.playerName === props.playerName)) podiums++
  }
  return { avgKills, bestKills, bestScore, kd, rounds: values.length, podiums }
})

const ordinal = (n: number): string => {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n}st`
  if (mod10 === 2 && mod100 !== 12) return `${n}nd`
  if (mod10 === 3 && mod100 !== 13) return `${n}rd`
  return `${n}th`
}

const showCharts = ref(true)

// Chart palette — sourced from mmTokens so dark-mode + team-aware coloring
// stay consistent across every V4 chart.
const { inkSoft: MM_INK_SOFT, inkMuted: MM_INK_MUTED, grid: MM_RULE, accent: MM_ACCENT, kill: MM_KILL } = MM_CHART

// Rounds with team scores, chronological (oldest → newest)
const roundsWithScores = computed(() =>
  [...rounds.value]
    .filter(r => r.team1Points !== undefined && r.team2Points !== undefined && r.team1Label && r.team2Label)
    .reverse(),
)

const teamLabels = computed(() => {
  const data = roundsWithScores.value
  if (data.length === 0) return { team1: '', team2: '' }
  return { team1: data[0].team1Label!, team2: data[0].team2Label! }
})

const scoreLineChartData = computed(() => {
  const data = roundsWithScores.value
  const { team1, team2 } = teamLabels.value
  if (!team1 || !team2) return { labels: [], datasets: [] }

  const labels = data.map(r => {
    const d = parseUtc(r.startTime)
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${r.mapName}`
  })

  const team1Scores: (number | null)[] = []
  const team2Scores: (number | null)[] = []
  for (const r of data) {
    if (r.team1Label === team1) {
      team1Scores.push(r.team1Points!)
      team2Scores.push(r.team2Points!)
    } else if (r.team2Label === team1) {
      team1Scores.push(r.team2Points!)
      team2Scores.push(r.team1Points!)
    } else {
      team1Scores.push(r.team1Points!)
      team2Scores.push(r.team2Points!)
    }
  }

  return {
    labels,
    datasets: [
      {
        label: team1,
        data: team1Scores,
        borderColor: teamColor(team1),
        backgroundColor: teamFill(team1, 0.12),
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 5,
        tension: 0.3,
        fill: false,
      },
      {
        label: team2,
        data: team2Scores,
        borderColor: teamColor(team2),
        backgroundColor: teamFill(team2, 0.12),
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 5,
        tension: 0.3,
        fill: false,
      },
    ],
  }
})

const scoreLineChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: {
      display: true,
      position: 'top' as const,
      labels: { color: MM_INK_SOFT, font: { size: 11 }, boxWidth: 12, padding: 14 },
    },
    tooltip: {
      backgroundColor: MM_CHART.surfaceSoft,
      titleColor: MM_CHART.ink,
      bodyColor: MM_CHART.inkSoft,
      borderColor: MM_CHART.gridStrong,
      borderWidth: 1,
      callbacks: {
        title: (items: any[]) => {
          const idx = items[0]?.dataIndex
          if (idx === undefined) return ''
          const r = roundsWithScores.value[idx]
          return r ? `${r.mapName} — ${r.serverName}` : ''
        },
      },
    },
  },
  scales: {
    x: { display: false },
    y: {
      ticks: { color: MM_INK_MUTED, font: { size: 10 } },
      grid: { color: MM_RULE },
      title: { display: true, text: 'Tickets', color: MM_INK_MUTED, font: { size: 10 } },
    },
  },
}))

// Player performance worm (player context only)
const playerPerformanceRounds = computed(() => {
  if (!props.playerName) return []
  return [...rounds.value]
    .filter(r => playerStatsData.value[r.roundId])
    .reverse()
})

const playerPerformanceChartData = computed(() => {
  const data = playerPerformanceRounds.value
  if (data.length === 0) return { labels: [], datasets: [] }

  const labels = data.map(r => {
    const d = parseUtc(r.startTime)
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${r.mapName}`
  })

  const playerKills = data.map(r => playerStatsData.value[r.roundId]?.kills ?? null)
  const playerKD = data.map(r => {
    const s = playerStatsData.value[r.roundId]
    if (!s) return null
    return s.deaths > 0 ? s.kills / s.deaths : s.kills
  })
  const topKills = data.map(r => {
    const top = roundTopPlayers.value[r.roundId]?.[0]
    return top ? top.kills : null
  })

  return {
    labels,
    datasets: [
      {
        label: 'Your kills',
        data: playerKills,
        borderColor: MM_KILL,
        backgroundColor: 'rgba(214, 90, 90, 0.16)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: MM_KILL,
        pointBorderColor: MM_CHART.surface,
        pointBorderWidth: 1.5,
        yAxisID: 'yKills',
      },
      {
        label: 'Top kills',
        data: topKills,
        borderColor: MM_INK_MUTED,
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderDash: [4, 3],
        fill: false,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        yAxisID: 'yKills',
      },
      {
        label: 'Your K/D',
        data: playerKD,
        borderColor: MM_ACCENT,
        backgroundColor: 'rgba(125, 136, 73, 0.10)',
        borderWidth: 2,
        fill: false,
        tension: 0.4,
        pointRadius: 2,
        pointHoverRadius: 5,
        pointBackgroundColor: MM_ACCENT,
        pointBorderColor: MM_CHART.surface,
        pointBorderWidth: 1,
        yAxisID: 'yKD',
      },
    ],
  }
})

const playerPerformanceChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: {
      display: true,
      position: 'top' as const,
      labels: { color: MM_INK_SOFT, font: { size: 11 }, boxWidth: 12, padding: 14 },
    },
    tooltip: {
      backgroundColor: MM_CHART.surfaceSoft,
      titleColor: MM_CHART.ink,
      bodyColor: MM_CHART.inkSoft,
      borderColor: MM_CHART.gridStrong,
      borderWidth: 1,
      callbacks: {
        title: (items: any[]) => {
          const idx = items[0]?.dataIndex
          if (idx === undefined) return ''
          const r = playerPerformanceRounds.value[idx]
          return r ? `${r.mapName} · ${r.serverName}` : ''
        },
        afterBody: (items: any[]) => {
          const idx = items[0]?.dataIndex
          if (idx === undefined) return []
          const r = playerPerformanceRounds.value[idx]
          const s = r ? playerStatsData.value[r.roundId] : null
          return s ? [`Score: ${s.score}`] : []
        },
      },
    },
  },
  scales: {
    x: { display: false },
    yKills: {
      type: 'linear' as const,
      position: 'left' as const,
      beginAtZero: true,
      ticks: { color: MM_INK_MUTED, font: { size: 10 } },
      grid: { color: MM_RULE },
      title: { display: true, text: 'Kills', color: MM_INK_MUTED, font: { size: 10 } },
    },
    yKD: {
      type: 'linear' as const,
      position: 'right' as const,
      beginAtZero: true,
      ticks: { color: MM_INK_MUTED, font: { size: 10 } },
      grid: { display: false },
      title: { display: true, text: 'K/D', color: MM_INK_MUTED, font: { size: 10 } },
    },
  },
}))

onMounted(fetchData)
watch(() => pageSize.value, () => { currentPage.value = 1; fetchData() })
watch(() => currentPage.value, fetchData)
watch(() => [props.playerName, props.serverName, props.mapName], () => {
  currentPage.value = 1
  fetchData()
})

const paginationRange = computed(() => {
  const range: number[] = []
  const maxVisible = 5
  let start = Math.max(1, currentPage.value - Math.floor(maxVisible / 2))
  const end = Math.min(totalPages.value, start + maxVisible - 1)
  if (end === totalPages.value) start = Math.max(1, end - maxVisible + 1)
  for (let i = start; i <= end; i++) range.push(i)
  return range
})
</script>

<template>
  <div class="mm-container mm-section">
    <div v-if="playerName || serverName" class="mm-meta-row" style="margin-bottom: 14px">
      <router-link
        :to="backTarget"
        class="mm-meta-row__strong"
        style="text-decoration: underline; text-underline-offset: 3px"
      >
        ← Back to {{ contextLabel }}
      </router-link>
    </div>

    <header class="mm-sessions__head">
      <div>
        <div v-if="playerName || serverName" class="mm-eyebrow">Sessions</div>
        <h1 class="mm-display">
          <template v-if="playerName || serverName">
            Sessions
            <span class="mm-display__muted">· {{ contextLabel }}</span>
          </template>
          <template v-else>
            Rounds
          </template>
        </h1>
        <p class="mm-card__hint" style="margin-top: 8px">
          {{ totalItems.toLocaleString() }} {{ totalItems === 1 ? 'round' : 'rounds' }}<template v-if="totalPages > 1"> · page {{ currentPage }} of {{ totalPages }}</template>
        </p>
      </div>
      <button type="button" class="mm-btn" @click="showFilters = !showFilters">
        {{ showFilters ? 'Hide filters' : 'Filters' }}
      </button>
    </header>

    <div v-if="showFilters" class="mm-sessions__filters">
      <label class="mm-sessions__filter">
        <span class="mm-eyebrow">Map</span>
        <input
          v-model="filterMapName"
          type="text"
          class="mm-sessions__input"
          placeholder="any"
          @keyup.enter="applyFilters"
        />
      </label>
      <label class="mm-sessions__filter">
        <span class="mm-eyebrow">Min players</span>
        <input
          v-model.number="filterMinParticipants"
          type="number"
          min="0"
          class="mm-sessions__input"
          placeholder="any"
          @keyup.enter="applyFilters"
        />
      </label>
      <label class="mm-sessions__filter">
        <span class="mm-eyebrow">From</span>
        <input v-model="filterDateFrom" type="date" class="mm-sessions__input" />
      </label>
      <label class="mm-sessions__filter">
        <span class="mm-eyebrow">To</span>
        <input v-model="filterDateTo" type="date" class="mm-sessions__input" />
      </label>
      <div class="mm-sessions__filter-actions">
        <button type="button" class="mm-btn mm-btn--accent" @click="applyFilters">Apply</button>
        <button type="button" class="mm-btn mm-btn--inline" @click="resetFilters">Reset</button>
      </div>
    </div>

    <hr class="mm-rule" style="margin-top: 24px; margin-bottom: 8px" />

    <div v-if="loading" style="padding: 24px 0">
      <div v-for="i in 6" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">
      {{ error }}
      <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="fetchData">Retry</button>
    </div>

    <div v-else-if="rounds.length === 0" class="mm-empty">No sessions match the current filters.</div>

    <template v-else>
      <!-- Aggregate strip (player context only) -->
      <div v-if="playerName && playerAggregate" class="mm-sessions__agg">
        <div class="mm-sessions__agg-cell">
          <div class="mm-eyebrow">Avg kills</div>
          <div class="mm-stat__value mm-stat__value--small">{{ playerAggregate.avgKills.toFixed(1) }}</div>
          <div class="mm-stat__delta">per round · {{ playerAggregate.rounds }} sampled</div>
        </div>
        <div class="mm-sessions__agg-cell">
          <div class="mm-eyebrow">Overall K/D</div>
          <div class="mm-stat__value mm-stat__value--small" :class="kdClass(playerAggregate.kd)">{{ playerAggregate.kd.toFixed(2) }}</div>
          <div class="mm-stat__delta">across shown rounds</div>
        </div>
        <div class="mm-sessions__agg-cell">
          <div class="mm-eyebrow">Best kills</div>
          <div class="mm-stat__value mm-stat__value--small mm-num--kill">{{ playerAggregate.bestKills }}</div>
          <div class="mm-stat__delta">best score {{ playerAggregate.bestScore }}</div>
        </div>
        <div class="mm-sessions__agg-cell">
          <div class="mm-eyebrow">Podium finishes</div>
          <div class="mm-stat__value mm-stat__value--small">{{ playerAggregate.podiums }}</div>
          <div class="mm-stat__delta">top-3 in {{ playerAggregate.rounds }} rounds</div>
        </div>
      </div>

      <!-- Charts (collapsible) -->
      <div v-if="rounds.length > 1" class="mm-sessions__charts">
        <button
          type="button"
          class="mm-sessions__charts-toggle"
          @click="showCharts = !showCharts"
        >
          <span class="mm-eyebrow">Charts</span>
          <span style="font-family: var(--mm-font-mono); font-size: 11px; color: var(--mm-ink-muted)">{{ showCharts ? '−' : '+' }}</span>
        </button>
        <div v-if="showCharts" class="mm-sessions__charts-body">
          <div v-if="playerName && playerPerformanceRounds.length > 1">
            <div class="mm-eyebrow" style="margin-bottom: 8px">
              {{ contextLabel }} performance
              <span style="text-transform: none; letter-spacing: 0.02em; color: var(--mm-ink-muted); margin-left: 6px">
                · {{ playerPerformanceRounds.length }} rounds · oldest → newest
              </span>
            </div>
            <div style="height: 220px">
              <Line
                :key="`player-perf-${playerPerformanceRounds.length}`"
                :data="playerPerformanceChartData"
                :options="playerPerformanceChartOptions"
              />
            </div>
          </div>
          <div v-if="roundsWithScores.length > 1" style="margin-top: 24px">
            <div class="mm-eyebrow" style="margin-bottom: 8px">Team scores over time</div>
            <div style="height: 200px">
              <Line
                :key="`scores-${roundsWithScores.length}`"
                :data="scoreLineChartData"
                :options="scoreLineChartOptions"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Mobile card-list (≤720px) — matches the round card layout from
           the sessions mock: title + time on top, sub-line, nested top-3. -->
      <ol class="mm-card-list mm-sessions__cards">
        <li
          v-for="round in rounds"
          :key="`m-${round.roundId}`"
          class="mm-card-list__item"
          @click="goRound(round)"
        >
          <div class="mm-card-list__head">
            <span class="mm-card-list__title">
              <span v-if="round.team1Label && round.team2Label">{{ round.team1Label }} {{ round.team1Points }} – {{ round.team2Points }} {{ round.team2Label }}</span>
              <span v-else>Round {{ round.roundId.slice(0, 8) }}</span>
            </span>
            <span class="mm-card-list__time" :title="formatLocalTooltip(round.startTime)">{{ formatTime(round.startTime) }}</span>
          </div>
          <div class="mm-card-list__sub">
            <span>{{ round.mapName }}</span>
            <span class="mm-meta-row__sep">·</span>
            <span>{{ formatDuration(round.durationMinutes) }}</span>
            <span v-if="round.isActive" class="mm-chip" style="margin-left: 2px"><span class="mm-chip__dot" />Live</span>
          </div>
          <ol v-if="roundTopPlayers[round.roundId]?.length" class="mm-card-list__rows">
            <li
              v-for="(p, i) in roundTopPlayers[round.roundId].slice(0, 3)"
              :key="i"
              class="mm-card-list__row"
              :class="i === 0 ? 'mm-card-list__row--rust' : 'mm-card-list__row--ink'"
            >
              <span class="mm-card-list__rank">{{ i + 1 }}.</span>
              <span class="mm-card-list__row-name">{{ $pn(p.playerName) }}</span>
              <span class="mm-card-list__row-kd" :class="kdClass(playerStatsKd(p))">{{ playerStatsKd(p).toFixed(2) }}</span>
              <span class="mm-card-list__row-score">{{ p.score }}</span>
            </li>
          </ol>
          <div
            v-if="playerName && playerStatsData[round.roundId]"
            class="mm-sessions__mine"
            style="margin-top: 8px"
          >
            <span
              v-if="playerRankInRound(round)"
              class="mm-sessions__mine-rank"
            >{{ ordinal(playerRankInRound(round)!) }}</span>
            <span class="mm-num--kill">{{ playerStatsData[round.roundId].kills }}</span>
            <span class="mm-num__sep">/</span>
            <span class="mm-num--death">{{ playerStatsData[round.roundId].deaths }}</span>
            <span class="mm-num__sep">·</span>
            <span :class="kdClass(playerStatsKd(playerStatsData[round.roundId]))">{{ playerStatsKd(playerStatsData[round.roundId]).toFixed(2) }}</span>
            <span class="mm-sessions__mine-score">{{ playerStatsData[round.roundId].score }} pts</span>
          </div>
        </li>
      </ol>

      <table class="mm-list mm-sessions__table">
        <thead>
          <tr>
            <th>Round · server</th>
            <th>Map</th>
            <th class="mm-sessions__col--top">Top players</th>
            <th v-if="playerName">{{ contextLabel }}</th>
            <th class="is-num">Duration</th>
            <th class="is-num">Started</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="round in rounds" :key="round.roundId" @click="goRound(round)">
            <td class="mm-list__name-cell">
              <div class="mm-list__name">
                <span class="mm-list__name-primary">
                  <span v-if="round.team1Label && round.team2Label">{{ round.team1Label }} {{ round.team1Points }} – {{ round.team2Points }} {{ round.team2Label }}</span>
                  <span v-else>Round {{ round.roundId.slice(0, 8) }}</span>
                </span>
                <span class="mm-list__name-sub">
                  <a
                    href="#"
                    @click.stop.prevent="goServer(round)"
                    style="color: inherit; text-decoration: underline; text-underline-offset: 2px"
                  >{{ round.serverName }}</a>
                  <span class="mm-meta-row__sep">·</span>
                  <span>{{ round.participantCount }} players</span>
                  <span v-if="round.isActive" class="mm-meta-row__sep">·</span>
                  <span v-if="round.isActive" class="mm-chip" style="margin-left: 4px"><span class="mm-chip__dot" />Live</span>
                </span>
              </div>
            </td>
            <td data-cell-label="Map">{{ round.mapName }}</td>
            <td class="mm-sessions__col--top" data-cell-label="Top players">
              <ol v-if="roundTopPlayers[round.roundId]?.length" class="mm-sessions__top">
                <li
                  v-for="(p, i) in roundTopPlayers[round.roundId].slice(0, 3)"
                  :key="i"
                  :class="{ 'mm-sessions__top--mine': playerName && p.playerName === playerName }"
                >
                  <span class="mm-sessions__top-rank">{{ i + 1 }}.</span>
                  <span class="mm-sessions__top-name" :title="$pn(p.playerName)">{{ $pn(p.playerName) }}</span>
                  <span class="mm-sessions__top-kd" :class="kdClass(playerStatsKd(p))">{{ playerStatsKd(p).toFixed(2) }}</span>
                  <span class="mm-sessions__top-score">{{ p.score }}</span>
                </li>
              </ol>
              <span v-else class="is-muted">—</span>
            </td>
            <td v-if="playerName" class="mm-sessions__col--mine" data-cell-label="My round">
              <template v-if="playerStatsData[round.roundId]">
                <div class="mm-sessions__mine">
                  <span
                    v-if="playerRankInRound(round)"
                    class="mm-sessions__mine-rank"
                    :title="`${ordinal(playerRankInRound(round)!)} in top 3`"
                  >{{ ordinal(playerRankInRound(round)!) }}</span>
                  <span class="mm-num--kill">{{ playerStatsData[round.roundId].kills }}</span>
                  <span class="mm-num__sep">/</span>
                  <span class="mm-num--death">{{ playerStatsData[round.roundId].deaths }}</span>
                  <span class="mm-num__sep">·</span>
                  <span :class="kdClass(playerStatsKd(playerStatsData[round.roundId]))">{{ playerStatsKd(playerStatsData[round.roundId]).toFixed(2) }}</span>
                  <span class="mm-sessions__mine-score">{{ playerStatsData[round.roundId].score }} pts</span>
                </div>
              </template>
              <span v-else class="is-muted">—</span>
            </td>
            <td class="is-num is-muted" data-cell-label="Duration">{{ formatDuration(round.durationMinutes) }}</td>
            <td class="is-num is-muted" data-cell-label="Started" :title="formatLocalTooltip(round.startTime)">{{ formatTime(round.startTime) }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <div v-if="totalPages > 1" class="mm-sessions__pagination">
      <button type="button" class="mm-btn mm-btn--inline" :disabled="currentPage <= 1" @click="goToPage(currentPage - 1)">‹</button>
      <button
        v-for="page in paginationRange"
        :key="page"
        type="button"
        class="mm-btn mm-btn--inline"
        :class="{ 'mm-sessions__page--active': page === currentPage }"
        @click="goToPage(page)"
      >{{ page }}</button>
      <button type="button" class="mm-btn mm-btn--inline" :disabled="currentPage >= totalPages" @click="goToPage(currentPage + 1)">›</button>
    </div>
  </div>
</template>

<style scoped>
.mm-sessions__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.mm-sessions__filters {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px;
  align-items: end;
  margin-top: 18px;
  padding: 16px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
}

.mm-sessions__filter {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mm-sessions__input {
  font-family: var(--mm-font-display);
  font-size: 13px;
  padding: 6px 10px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
}

.mm-sessions__input:focus { outline: 0; border-color: var(--mm-ink); }

.mm-sessions__filter-actions {
  display: flex;
  gap: 8px;
  grid-column: 1 / -1;
  justify-content: flex-end;
}

.mm-sessions__pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding-top: 24px;
}

.mm-sessions__page--active {
  background: var(--mm-ink);
  color: var(--mm-bg);
  border-color: var(--mm-ink);
}

.mm-sessions__agg {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  margin-bottom: 20px;
}

.mm-sessions__agg-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mm-sessions__top {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-family: var(--mm-font-mono);
  font-size: 11.5px;
  line-height: 1.4;
}

.mm-sessions__top li {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 44px 56px;
  gap: 8px;
  align-items: baseline;
  color: var(--mm-ink-soft);
}

.mm-sessions__top--mine {
  color: var(--mm-ink) !important;
  font-weight: 600;
}

.mm-sessions__top-rank {
  color: var(--mm-ink-muted);
  text-align: right;
}

.mm-sessions__top--mine .mm-sessions__top-rank {
  color: var(--mm-accent);
}

.mm-sessions__top-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-sessions__top-kd {
  text-align: right;
}

.mm-sessions__top-score {
  text-align: right;
  color: var(--mm-ink-muted);
}

.mm-sessions__col--top { min-width: 220px; }
.mm-sessions__col--mine { min-width: 200px; }

.mm-sessions__mine {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mm-font-mono);
  font-size: 12px;
  flex-wrap: wrap;
}

.mm-sessions__mine-rank {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 2px 6px;
  border: 1px solid var(--mm-accent-soft);
  border-radius: 2px;
  color: var(--mm-accent);
  background: rgba(125, 136, 73, 0.10);
}

.mm-sessions__mine-score {
  color: var(--mm-ink-muted);
  font-size: 11px;
}

/* Hide the dense top-3 stack on narrow screens — kept in the data table via
   data-cell-label fallback elsewhere. The full top-3 only shows ≥ 720px. */
@media (max-width: 720px) {
  .mm-sessions__col--top, th.mm-sessions__col--top { display: none; }
}

.mm-sessions__charts {
  margin-bottom: 20px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
}

.mm-sessions__charts-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  background: transparent;
  border: 0;
  padding: 12px 16px;
  cursor: pointer;
  color: var(--mm-ink);
}

.mm-sessions__charts-toggle:hover { background: var(--mm-bg-soft); }

.mm-sessions__charts-body {
  padding: 8px 16px 16px;
  border-top: 1px solid var(--mm-rule);
}

/* Mobile / desktop swap for the rounds list. The table covers desktop
   (table-heads scannable across a wide column set); the mm-card-list
   covers mobile (round card with nested top-3 — matches sessions mock). */
.mm-sessions__cards { display: none; }
@media (max-width: 720px) {
  .mm-sessions__table { display: none; }
  .mm-sessions__cards { display: flex; flex-direction: column; }
  .mm-sessions__cards .mm-card-list__item { cursor: pointer; }
}
</style>
