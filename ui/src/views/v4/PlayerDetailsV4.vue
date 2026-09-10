<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchPlayerStats } from '@/services/playerStatsService'
import { fetchPlayerMapStats } from '@/services/playerStatsApi'
import type {
  PlayerAchievementGroup,
  PlayerTimeStatistics,
  PlayerMapStatEntry,
  Session,
  ServerRanking,
  BestScoreEntry,
} from '@/types/playerStatsTypes'
import { decodePlayerName } from '@/utils/playerName'
import { getAchievementImage } from '@/utils/achievementImageUtils'
import MmPlayerTrendPanel from '@/components/v4/MmPlayerTrendPanel.vue'
import MmPlayerComments from '@/components/v4/MmPlayerComments.vue'
import MmPlayerSignatureBuilder from '@/components/v4/MmPlayerSignatureBuilder.vue'
import MmCommunityCard from '@/components/v4/MmCommunityCard.vue'
import MmPlayerActivityHeatmap from '@/components/v4/MmPlayerActivityHeatmap.vue'
import MmPlayerMapsTab from '@/components/v4/MmPlayerMapsTab.vue'
import MmPlayerAchievementHeroBadges from '@/components/v4/MmPlayerAchievementHeroBadges.vue'
import MmPlayerAllyOrbit from '@/components/v4/MmPlayerAllyOrbit.vue'
import MmPlayerRivalsDossier from '@/components/v4/MmPlayerRivalsDossier.vue'
import MmPlayerFormMathModal, { type FormInsight, type FormContributingSession } from '@/components/v4/MmPlayerFormMathModal.vue'
import MmPlayerAchievementsSlideover from '@/components/v4/MmPlayerAchievementsSlideover.vue'
import { fetchPlayerCommunities, type PlayerCommunity } from '@/services/playerRelationshipsApi'
import { kdClass, streakClass } from './mmTokens'
import { parseUtc, formatLocalTooltip } from '@/utils/timeUtils'

const route = useRoute()
const router = useRouter()

const rawName = computed(() => decodeURIComponent(route.params.playerName as string))
const displayName = computed(() => decodePlayerName(rawName.value))

const stats = ref<PlayerTimeStatistics | null>(null)
// `stats.insights.favoriteMaps` was a dead TS field — the C# PlayerInsights
// model doesn't have a FavoriteMaps property. The real source is the
// /stats/players/:name/map-stats endpoint, which the previous wiring of
// the Maps tab silently ignored.
const mapStats = ref<PlayerMapStatEntry[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const showFormMathModal = ref(false)

const achievementGroups = ref<PlayerAchievementGroup[]>([])
const achievementsLoading = ref(false)
const achievementsError = ref<string | null>(null)

const playerCommunities = ref<PlayerCommunity[]>([])
const communitiesLoading = ref(false)

const loadCommunities = async () => {
  communitiesLoading.value = true
  try {
    playerCommunities.value = await fetchPlayerCommunities(rawName.value)
  } catch {
    playerCommunities.value = []
  } finally {
    communitiesLoading.value = false
  }
}

// Tightest squads first — cohesion is the most interesting axis when the
// cards sit side by side, and it keeps the accent order stable per player.
const sortedCommunities = computed(() =>
  [...playerCommunities.value].sort((a, b) => b.cohesionScore - a.cohesionScore),
)

const loadStats = async () => {
  loading.value = true
  error.value = null

  // Maps tab data — separate endpoint. Use days=365 so the controller
  // upgrades the period from Last30Days to ThisYear and we surface
  // every map the player has touched this year, not just the last 30d.
  //
  // It has no data dependency on the profile payload — primaryGameId is a constant —
  // so start both together. Awaiting them in sequence pushed map-stats into a second
  // round trip that landed ~440ms after the rest of the page had finished.
  const statsRequest = fetchPlayerStats(rawName.value)
  const mapStatsRequest = fetchPlayerMapStats(rawName.value, primaryGameId, 365)

  // Attach the rejection handler now rather than at the await below: nothing is
  // awaiting this promise while the profile request is in flight, so a fast failure
  // would otherwise surface as an unhandled rejection.
  const settledMapStats = mapStatsRequest.catch((): PlayerMapStatEntry[] => [])

  // Await the profile first so the page gate lifts as soon as it lands, independently
  // of how long map-stats takes.
  try {
    stats.value = await statsRequest
  } catch {
    error.value = 'Player feed temporarily unavailable.'
  } finally {
    loading.value = false
  }

  mapStats.value = await settledMapStats
}

const loadAchievements = async () => {
  if (achievementGroups.value.length || achievementsLoading.value) return
  achievementsLoading.value = true
  achievementsError.value = null
  try {
    const r = await fetch(`/stats/gamification/player/${encodeURIComponent(rawName.value)}/achievement-groups`)
    if (!r.ok) throw new Error(`http ${r.status}`)
    achievementGroups.value = await r.json()
  } catch {
    achievementsError.value = 'Achievement feed unavailable.'
  } finally {
    achievementsLoading.value = false
  }
}

onMounted(() => {
  void loadStats()
  void loadCommunities()
  void loadAchievements()
})

watch(rawName, () => {
  stats.value = null
  mapStats.value = []
  achievementGroups.value = []
  playerCommunities.value = []
  void loadStats()
  void loadCommunities()
  void loadAchievements()
})

// --- tabs ---
// Sessions and Achievements were dropped as tabs: both already have richer
// standalone pages (/sessions, /achievements) that the hero links to, so the
// tab was a truncated second copy. Servers folded into the Accolades panel —
// see `serverRoster`.
type Tab = 'overview' | 'maps' | 'communities' | 'signature'
const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'maps', label: 'Maps' },
  { id: 'communities', label: 'Communities' },
  { id: 'signature', label: 'Signature' },
]
const isTab = (v: unknown): v is Tab => tabs.some(t => t.id === v)
// Links to the removed tabs are already out in the wild. Send the two that
// became pages to those pages, and land ?tab=servers on the panel that
// absorbed it, rather than rendering a tab bar with nothing under it.
const legacyTab = route.query.tab
if (legacyTab === 'sessions' || legacyTab === 'achievements') {
  router.replace(`/v4/players/${encodeURIComponent(rawName.value)}/${legacyTab}`)
}
const activeTab = ref<Tab>(isTab(legacyTab) ? legacyTab : 'overview')
// A ?tab= we no longer honour would otherwise sit in the address bar
// describing a tab that isn't open. The watcher below can't clear it —
// activeTab never changes — so drop it here.
if (legacyTab !== undefined && !isTab(legacyTab)) {
  const url = new URL(window.location.href)
  url.searchParams.delete('tab')
  window.history.replaceState(window.history.state, '', url.toString())
}
// Sync active tab into the URL via the native History API (see server view
// for why we bypass router.replace here).
watch(activeTab, (t) => {
  if (route.query.tab === t) return
  const url = new URL(window.location.href)
  if (t === 'overview') url.searchParams.delete('tab')
  else url.searchParams.set('tab', t)
  window.history.replaceState(window.history.state, '', url.toString())
})

// ---------- derived ----------

const isOnline = computed(() => stats.value?.isActive === true)
const currentServer = computed(() => stats.value?.currentServer ?? null)

const totalKills = computed(() => stats.value?.totalKills ?? 0)
const totalDeaths = computed(() => stats.value?.totalDeaths ?? 0)
const kd = computed(() => {
  if (!stats.value) return 0
  if (totalDeaths.value === 0) return totalKills.value
  return totalKills.value / totalDeaths.value
})
const playtimeMinutes = computed(() => stats.value?.totalPlayTimeMinutes ?? 0)
const playtimeHours = computed(() => Math.round(playtimeMinutes.value / 60))
const sessionsCount = computed(() => stats.value?.totalSessions ?? 0)

const recentSessions = computed<Session[]>(() => stats.value?.recentSessions ?? [])

const currentForm = computed<FormInsight | null>(() => {
  if (!stats.value) return null
  const lifetimeKd = kd.value
  const lifetimeKills = totalKills.value
  const lifetimeDeaths = totalDeaths.value
  const sessions = recentSessions.value

  const lastPlayedDate = stats.value.lastPlayed ? parseUtc(stats.value.lastPlayed) : null
  const daysSincePlayed = lastPlayedDate && !isNaN(lastPlayedDate.getTime())
    ? Math.max(0, (Date.now() - lastPlayedDate.getTime()) / (1000 * 60 * 60 * 24))
    : 999

  if (sessions.length === 0 || !stats.value.lastPlayed) {
    return {
      status: 'dormant',
      badge: '[DORMANT]',
      label: 'Inactive',
      deltaPercent: 0,
      recentKd: 0,
      detail: 'no recent combat',
      lifetimeKd,
      lifetimeKills,
      lifetimeDeaths,
      sampleKills: 0,
      sampleDeaths: 0,
      sampleSize: 0,
      daysSincePlayed,
      contributingSessions: [],
    }
  }

  if (daysSincePlayed > 30) {
    return {
      status: 'dormant',
      badge: '[DORMANT]',
      label: 'Dormant',
      deltaPercent: 0,
      recentKd: 0,
      detail: `last seen ${Math.round(daysSincePlayed)}d ago`,
      lifetimeKd,
      lifetimeKills,
      lifetimeDeaths,
      sampleKills: 0,
      sampleDeaths: 0,
      sampleSize: 0,
      daysSincePlayed,
      contributingSessions: [],
    }
  }

  const sample = sessions.slice(0, 10)
  const sampleKills = sample.reduce((sum, s) => sum + (s.totalKills ?? 0), 0)
  const sampleDeaths = sample.reduce((sum, s) => sum + (s.totalDeaths ?? 0), 0)

  const contributingSessions: FormContributingSession[] = sample.map(s => {
    const k = s.totalKills ?? 0
    const d = s.totalDeaths ?? 0
    const skd = d === 0 ? k : Number((k / d).toFixed(2))
    const sDelta = lifetimeKd > 0 ? Math.round(((skd - lifetimeKd) / lifetimeKd) * 100) : 0
    return {
      sessionId: s.sessionId,
      roundId: s.roundId,
      date: s.startTime ? (parseUtc(s.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) : '—',
      mapName: s.mapName || 'Unknown Map',
      kills: k,
      deaths: d,
      kd: skd,
      deltaPercent: sDelta,
      teamResult: s.teamResult || 'unknown',
    }
  })

  if (sampleKills === 0 && sampleDeaths === 0) {
    return {
      status: 'steady',
      badge: '[STEADY]',
      label: 'Steady',
      deltaPercent: 0,
      recentKd: lifetimeKd,
      detail: 'nominal pacing',
      lifetimeKd,
      lifetimeKills,
      lifetimeDeaths,
      sampleKills,
      sampleDeaths,
      sampleSize: sample.length,
      daysSincePlayed,
      contributingSessions,
    }
  }

  const recentKd = sampleDeaths === 0 ? sampleKills : Number((sampleKills / sampleDeaths).toFixed(2))
  const deltaPercent = lifetimeKd > 0 ? Math.round(((recentKd - lifetimeKd) / lifetimeKd) * 100) : 0

  let status: 'surge' | 'slump' | 'steady' = 'steady'
  let badge = '[STEADY]'
  let label = 'Steady'
  let detail = `${deltaPercent >= 0 ? '+' : ''}${deltaPercent}% vs lifetime (${recentKd.toFixed(2)} recent)`

  if (deltaPercent >= 15) {
    status = 'surge'
    badge = '[SURGE]'
    label = 'Surging'
    detail = `+${deltaPercent}% vs lifetime (${recentKd.toFixed(2)} recent)`
  } else if (deltaPercent <= -15) {
    status = 'slump'
    badge = '[SLUMP]'
    label = 'Cold Spell'
    detail = `${deltaPercent}% vs lifetime (${recentKd.toFixed(2)} recent)`
  }

  return {
    status,
    badge,
    label,
    deltaPercent,
    recentKd,
    detail,
    lifetimeKd,
    lifetimeKills,
    lifetimeDeaths,
    sampleKills,
    sampleDeaths,
    sampleSize: sample.length,
    daysSincePlayed,
    contributingSessions,
  }
})

const firstSeen = computed(() => stats.value?.firstPlayed ?? null)
const firstSeenDate = computed(() => {
  if (!firstSeen.value) return '—'
  const d = parseUtc(firstSeen.value)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
})
// best server rank (lowest rank number = best)
const bestRank = computed(() => {
  const rankings = stats.value?.insights?.serverRankings
  if (!rankings || rankings.length === 0) return null
  const best = [...rankings].sort((a, b) => a.rank - b.rank)[0]
  return { rank: best.rank, of: best.totalRankedPlayers, server: best.serverName }
})

// best streak from achievement groups (kill_streak_*)
const bestStreak = computed(() => {
  const streaks = achievementGroups.value.filter(g => g.achievementId.startsWith('kill_streak_'))
  if (streaks.length === 0) return null
  const sorted = [...streaks].sort((a, b) => b.latestValue - a.latestValue)
  return sorted[0]
})

// for the achievements grid — show all groups, ordered by latestAchievedAt desc
const achievementsForGrid = computed(() => {
  return [...achievementGroups.value]
    .sort((a, b) => parseUtc(b.latestAchievedAt).getTime() - parseUtc(a.latestAchievedAt).getTime())
})

// --- session helpers ---
const formatNumber = (n: number) => n.toLocaleString()
const formatDuration = (mins: number) => {
  if (!mins) return '0m'
  if (mins < 60) return `${Math.round(mins)}m`
  const h = Math.floor(mins / 60)
  const m = Math.round(mins - h * 60)
  return m ? `${h}h ${m}m` : `${h}h`
}
const formatRelative = (iso: string) => {
  const d = parseUtc(iso)
  if (isNaN(d.getTime())) return '—'
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return `${Math.round(diff)}s ago`
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  return `${Math.round(diff / 86400)}d ago`
}
const rankNum = (i: number) => String(i + 1).padStart(2, '0')
const rankTintClass = (i: number) => (i < 3 ? `mm-rank--${['gold', 'silver', 'bronze'][i]}` : '')
const formatTier = (tier: string) => {
  if (!tier) return ''
  return tier.toUpperCase()
}
const friendlyAchievementName = (g: PlayerAchievementGroup) => {
  const t = formatTier(g.tier)
  return t ? `${g.achievementName} — ${t}` : g.achievementName
}

// Accolades subtab state (servers | bestScores | achievements) — Servers
// is the default landing view; Achievements has its own full drill-in
// (the slideover below) so it sits last.
type AccoladeSection = 'achievements' | 'bestScores' | 'servers'
const activeAccoladeTab = ref<AccoladeSection>('servers')

// Achievements "View all" opens a slide-in panel (same pattern as the
// round report slideover) instead of navigating to the full page.
const achievementsSlideoverOpen = ref(false)

const kdTrend = computed(() => stats.value?.recentStats?.kdRatioTrend ?? [])
const killRateTrend = computed(() => stats.value?.recentStats?.killRateTrend ?? [])

// Per-server roster — the old Servers tab, folded into the Accolades panel.
// Joins the aggregate stats (time / rounds / kills / K/D) onto the ranking
// entries (rank / of-N / ping) so one list carries what both used to show.
// Ordered by playtime, not rank: an unranked home server still belongs first.
interface ServerRosterEntry {
  serverGuid: string
  serverName: string
  gameId: string
  totalMinutes: number
  totalRounds: number
  totalKills: number
  kdRatio: number
  rank: number | null
  totalRankedPlayers: number
  averagePing: number | null
}
const serverRoster = computed<ServerRosterEntry[]>(() => {
  const unmatched = new Map<string, ServerRanking>()
  for (const r of stats.value?.insights?.serverRankings ?? []) unmatched.set(r.serverGuid, r)

  const rows: ServerRosterEntry[] = (stats.value?.servers ?? []).map(s => {
    const r = unmatched.get(s.serverGuid)
    unmatched.delete(s.serverGuid)
    return {
      serverGuid: s.serverGuid,
      serverName: s.serverName,
      gameId: s.gameId,
      totalMinutes: s.totalMinutes ?? 0,
      totalRounds: s.totalRounds ?? 0,
      totalKills: s.totalKills ?? 0,
      kdRatio: s.kdRatio ?? 0,
      rank: r?.rank ?? null,
      totalRankedPlayers: r?.totalRankedPlayers ?? 0,
      averagePing: r?.averagePing ?? null,
    }
  })

  // A server can carry a ranking without appearing in `servers`. Keep it
  // rather than silently dropping a standing the player earned.
  for (const r of unmatched.values()) {
    rows.push({
      serverGuid: r.serverGuid,
      serverName: r.serverName,
      gameId: '',
      totalMinutes: 0,
      totalRounds: 0,
      totalKills: 0,
      kdRatio: 0,
      rank: r.rank,
      totalRankedPlayers: r.totalRankedPlayers,
      averagePing: r.averagePing,
    })
  }

  return rows.sort((a, b) => b.totalMinutes - a.totalMinutes)
})

// Sub-line for a roster row: standing first, then the play record. A ranked
// server with no aggregate row still has a standing worth showing, so the
// two halves are independent.
const serverSubLine = (s: ServerRosterEntry) => {
  const parts: string[] = []
  if (s.rank !== null) parts.push(`of ${formatNumber(s.totalRankedPlayers)}`)
  if (s.totalMinutes > 0) parts.push(formatDuration(s.totalMinutes))
  if (s.totalRounds > 0) parts.push(`${formatNumber(s.totalRounds)} rounds`)
  return parts.join(' · ') || 'no recorded rounds'
}

// Best scores — show top 3 for each window
const bestScores = computed(() => stats.value?.bestScores ?? null)
type ScoreWindow = 'thisWeek' | 'last30Days' | 'allTime'
const activeScoreWindow = ref<ScoreWindow>('thisWeek')
const currentBestScores = computed<BestScoreEntry[]>(() => bestScores.value?.[activeScoreWindow.value] ?? [])

const topThisWeekScore = computed<BestScoreEntry | null>(() => bestScores.value?.thisWeek?.[0] ?? null)
const topLast30DaysScore = computed<BestScoreEntry | null>(() => bestScores.value?.last30Days?.[0] ?? null)
const topAllTimeScore = computed<BestScoreEntry | null>(() => bestScores.value?.allTime?.[0] ?? null)

// Highest most recent score (prioritizing thisWeek if available, else last30Days, else allTime)
const highestRecentScore = computed<BestScoreEntry | null>(() => {
  if (topThisWeekScore.value) return topThisWeekScore.value
  if (topLast30DaysScore.value) return topLast30DaysScore.value
  if (topAllTimeScore.value) return topAllTimeScore.value
  return null
})

// Up to 10 latest rounds for the hero direct-link ribbon
const heroSessions = computed(() => recentSessions.value.slice(0, 10))

const scoreKd = (e: BestScoreEntry): number => {
  if (e.deaths === 0) return e.kills
  return e.kills / e.deaths
}
const openScoreRound = (e: BestScoreEntry) => {
  if (!e.roundId) return
  router.push({
    path: `/v4/rounds/${encodeURIComponent(e.roundId)}/report`,
    query: { players: rawName.value },
  })
}

const goCompare = () => {
  router.push({ path: '/v4/players/compare', query: { player1: rawName.value } })
}
const goSessions = () => {
  router.push(`/v4/players/${encodeURIComponent(rawName.value)}/sessions`)
}
const goAchievements = () => {
  achievementsSlideoverOpen.value = true
}
const goNetwork = () => {
  router.push(`/v4/players/${encodeURIComponent(rawName.value)}/network`)
}
const goServer = (serverName: string) => {
  router.push(`/v4/servers/detail/${encodeURIComponent(serverName)}`)
}

// Map detail used to be an in-page drill-in which let the user scroll
// past it and lose context. Now it's its own route (/v4/players/:name/maps/:map)
// so navigation handles scroll-to-top and back-button behaviour cleanly.
const openMapRankings = (mapName: string, gameId?: string) => {
  router.push({
    path: `/v4/players/${encodeURIComponent(rawName.value)}/maps/${encodeURIComponent(mapName)}`,
    query: { game: gameId || primaryGameId },
  })
}

// bf1942 is the only tracked game.
const primaryGameId = 'bf1942' as const

const goPlayerFromOrbit = (name: string) => {
  router.push(`/v4/players/${encodeURIComponent(name)}`)
}

const truncate = (s: string, n = 28) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

// Servers list for the signature builder — merge per-server stats + ranking entries
const signatureServers = computed(() => {
  const fromStats = (stats.value?.servers ?? []).map(s => ({
    serverGuid: s.serverGuid,
    serverName: s.serverName,
    totalMinutes: s.totalMinutes ?? 0,
  }))
  const fromRankings = (stats.value?.insights?.serverRankings ?? []).map(r => ({
    serverGuid: r.serverGuid,
    serverName: r.serverName,
    totalMinutes: 0,
  }))
  const seen = new Set(fromStats.map(s => s.serverGuid))
  for (const r of fromRankings) if (!seen.has(r.serverGuid)) fromStats.push(r)
  return fromStats
})
</script>

<template>
  <div class="mm-container mm-container--wide mm-section">
    <!-- back link to players index -->
    <router-link
      to="/v4/players"
      class="mm-player__back"
    >
      ‹ Players
    </router-link>

    <div
      v-if="error"
      class="mm-empty"
    >
      {{ error }}
    </div>

    <template v-else>
      <!-- Hero: the player name comes from the route param via `displayName`, so
           it paints on the first frame. Only the parts that genuinely need the
           stats payload (rank, first seen, current server) wait on the API. -->
      <div class="mm-player-hero">
        <div class="mm-player-hero__main">
          <div
            class="mm-meta-row"
            style="margin-bottom: 8px"
          >
            <template v-if="loading">
              <span
                class="mm-skeleton"
                style="width: 220px; height: 1em; display: inline-block; vertical-align: middle"
              />
            </template>
            <template v-else>
              <span
                class="mm-chip"
                :class="isOnline ? 'mm-chip--live' : 'mm-chip--off'"
              >
                <span class="mm-chip__dot" />{{ isOnline ? 'Online' : 'Offline' }}
              </span>
              <span class="mm-meta-row__sep">·</span>
              <span v-if="bestRank">Rank <span class="mm-meta-row__strong">#{{ bestRank.rank }}</span> of {{ formatNumber(bestRank.of) }}</span>
              <span v-else>Unranked</span>
              <span class="mm-meta-row__sep">·</span>
              <span>First seen {{ firstSeenDate }}</span>
            </template>
          </div>

          <h1 class="mm-display mm-player__name">
            {{ displayName }}
          </h1>

          <div
            v-if="!loading && isOnline && currentServer"
            class="mm-live-deployment"
          >
            <div class="mm-live-deployment__status">
              <span class="mm-live-deployment__radar">
                <span class="mm-live-deployment__ping" />
                <span class="mm-live-deployment__core" />
              </span>
              <span class="mm-live-deployment__tag">Currently playing on ..</span>
            </div>
            <div class="mm-live-deployment__info">
              <a
                class="mm-live-deployment__server"
                @click="goServer(currentServer.serverName)"
              >
                {{ $pn(currentServer.serverName) }}
              </a>
              <span
                v-if="currentServer.mapName"
                class="mm-live-deployment__map"
              >
                {{ currentServer.mapName }}
              </span>
              <span
                v-if="currentServer.gameId"
                class="mm-live-deployment__mode"
              >
                {{ currentServer.gameId.toUpperCase() }}
              </span>
              <span
                v-if="currentServer.sessionKills !== undefined"
                class="mm-live-deployment__stats"
              >
                Round: <span class="mm-num--kill">{{ currentServer.sessionKills }}</span> k / <span class="mm-num--death">{{ currentServer.sessionDeaths }}</span> d
              </span>
            </div>
            <button
              type="button"
              class="mm-live-deployment__cta"
              @click="goServer(currentServer.serverName)"
            >
              Server Intel & Join →
            </button>
          </div>

          <div
            v-else
            class="mm-meta-row mm-player__where"
          >
            <span
              v-if="loading"
              class="mm-skeleton"
              style="width: 260px; height: 1em; display: inline-block; vertical-align: middle"
            />
            <template v-else-if="currentServer">
              last seen on
              <a
                class="mm-meta-row__strong"
                style="text-decoration: underline; text-underline-offset: 3px; cursor: pointer"
                @click="goServer(currentServer.serverName)"
              >{{ $pn(currentServer.serverName) }}</a>
              <template v-if="currentServer.mapName">
                <span class="mm-meta-row__sep">·</span><span>{{ currentServer.mapName }}</span>
              </template>
              <span class="mm-meta-row__sep">·</span>
              <span :title="stats?.lastPlayed ? formatLocalTooltip(stats.lastPlayed) : ''">{{ stats?.lastPlayed ? formatRelative(stats.lastPlayed) : '—' }}</span>
            </template>
            <template v-else>
              last seen <span
                class="mm-meta-row__strong"
                :title="stats?.lastPlayed ? formatLocalTooltip(stats.lastPlayed) : ''"
              >{{ stats?.lastPlayed ? formatRelative(stats.lastPlayed) : '—' }}</span>
            </template>
          </div>

          <div style="margin-top: 16px; display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap">
            <MmPlayerAchievementHeroBadges
              :player-name="rawName"
              :total-count="achievementGroups.length"
            />

            <!-- Latest Sessions L / W in Player Hero (direct to round report) -->
            <div
              v-if="heroSessions.length > 0"
              class="mm-hero-sessions"
            >
              <span class="mm-hero-sessions__label">RECENT:</span>
              <div class="mm-hero-sessions__squares">
                <div
                  v-for="s in heroSessions"
                  :key="s.sessionId"
                  class="mm-hero-match-wrap"
                >
                  <router-link
                    :to="s.roundId ? { path: `/v4/rounds/${encodeURIComponent(s.roundId)}/report`, query: { players: rawName } } : '#'"
                    class="mm-match-sq"
                    :class="`mm-match-sq--${s.teamResult}`"
                  >
                    {{ s.teamResult === 'win' ? 'W' : s.teamResult === 'loss' ? 'L' : s.teamResult === 'tie' ? 'D' : '?' }}
                  </router-link>

                  <!-- Tactical hover tooltip -->
                  <div
                    class="mm-hero-tooltip"
                    role="tooltip"
                  >
                    <div class="mm-hero-tooltip__top">
                      <span
                        class="mm-hero-tooltip__tag"
                        :class="`mm-hero-tooltip__tag--${s.teamResult}`"
                      >
                        {{ s.teamResult === 'win' ? '[VICTORY]' : s.teamResult === 'loss' ? '[DEFEAT]' : s.teamResult === 'tie' ? '[DRAW]' : '[ROUND]' }}
                      </span>
                      <span
                        v-if="s.startTime"
                        class="mm-hero-tooltip__time"
                      >
                        {{ formatRelative(s.startTime) }}
                      </span>
                    </div>
                    <div class="mm-hero-tooltip__map">
                      {{ s.mapName || 'Unknown Map' }}
                    </div>
                    <div class="mm-hero-tooltip__meta">
                      <span class="mm-num--kill">{{ s.totalKills }} k</span>
                      <span class="mm-num__sep">/</span>
                      <span class="mm-num--death">{{ s.totalDeaths }} d</span>
                      <span class="mm-num__sep">·</span>
                      <span :class="kdClass(s.totalDeaths === 0 ? s.totalKills : s.totalKills / s.totalDeaths)">
                        {{ (s.totalDeaths === 0 ? s.totalKills : s.totalKills / s.totalDeaths).toFixed(2) }} K/D
                      </span>
                    </div>
                    <div class="mm-hero-tooltip__hint">
                      Click for round report [-&gt;]
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="mm-player-hero__nav">
          <button
            class="mm-player__navlink"
            type="button"
            @click="goCompare"
          >
            Compare
          </button>
          <button
            class="mm-player__navlink"
            type="button"
            @click="goNetwork"
          >
            Network
          </button>
          <button
            class="mm-player__navlink mm-player__navlink--strong"
            type="button"
            @click="goSessions"
          >
            Sessions →
          </button>
        </div>
      </div>

      <!-- KPI strip. Labels are static and paint immediately; only the numbers
           wait on the payload, so the strip keeps its height and the page
           doesn't jump when the stats land. -->
      <div
        class="mm-stats"
        style="margin-top: 24px"
      >
        <div class="mm-stats__cell">
          <div class="mm-stats__label">
            Lifetime kills
          </div>
          <template v-if="loading">
            <div
              class="mm-skeleton mm-skeleton--lg"
              style="width: 60%"
            />
          </template>
          <template v-else>
            <div class="mm-stat__value mm-num--kill">
              {{ formatNumber(totalKills) }}
            </div>
            <div class="mm-stat__delta">
              <span class="mm-num--death">{{ formatNumber(totalDeaths) }}</span> deaths
            </div>
          </template>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">
            K/D ratio
          </div>
          <template v-if="loading">
            <div
              class="mm-skeleton mm-skeleton--lg"
              style="width: 50%"
            />
          </template>
          <template v-else>
            <div
              class="mm-stat__value"
              :class="kdClass(kd)"
            >
              {{ kd.toFixed(2) }}
            </div>
            <div class="mm-stat__delta">
              <template v-if="totalKills > 0">
                <span class="mm-num--kill">{{ formatNumber(totalKills) }} k</span>
                <span class="mm-num__sep">/</span>
                <span class="mm-num--death">{{ formatNumber(totalDeaths) }} d</span>
              </template>
              <template v-else>
                no rounds yet
              </template>
            </div>
          </template>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">
            Playtime
          </div>
          <template v-if="loading">
            <div
              class="mm-skeleton mm-skeleton--lg"
              style="width: 55%"
            />
          </template>
          <template v-else>
            <div class="mm-stat__value">
              {{ formatNumber(playtimeHours) }}<span class="mm-stat__suffix">h</span>
            </div>
            <div class="mm-stat__delta">
              {{ formatNumber(sessionsCount) }} sessions
            </div>
          </template>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">
            Best streak
          </div>
          <template v-if="achievementsLoading && !bestStreak">
            <div
              class="mm-skeleton mm-skeleton--lg"
              style="width: 45%"
            />
          </template>
          <template v-else>
            <div
              class="mm-stat__value"
              :class="streakClass(bestStreak?.latestValue)"
            >
              {{ bestStreak ? bestStreak.latestValue : '—' }}
            </div>
            <div class="mm-stat__delta">
              {{ bestStreak ? `${bestStreak.count}× recorded` : 'no streaks logged' }}
            </div>
          </template>
        </div>
        <div
          class="mm-stats__cell mm-stats__cell--clickable"
          tabindex="0"
          role="button"
          :aria-expanded="showFormMathModal"
          aria-haspopup="dialog"
          aria-label="Inspect Current Form Telemetry & Mathematics"
          title="Click to view mathematical breakdown and telemetry formula"
          @click="showFormMathModal = true"
          @keydown.enter="showFormMathModal = true"
          @keydown.space.prevent="showFormMathModal = true"
        >
          <div class="mm-stats__label-wrap">
            <span
              class="mm-stats__label"
              style="margin-bottom: 0"
            >Current form</span>
            <span class="mm-stats__math-hint">Formula [-&gt;]</span>
          </div>
          <template v-if="loading">
            <div
              class="mm-skeleton mm-skeleton--lg"
              style="width: 50%"
            />
          </template>
          <template v-else-if="currentForm">
            <div
              class="mm-stat__value mm-form-badge"
              :class="`mm-form--${currentForm.status}`"
            >
              <span class="mm-form-dot" />
              {{ currentForm.badge }}
            </div>
            <div class="mm-stat__delta">
              {{ currentForm.detail }}
            </div>
          </template>
          <template v-else>
            <div class="mm-stat__value is-muted">
              —
            </div>
            <div class="mm-stat__delta">
              no telemetry
            </div>
          </template>
        </div>
      </div>

      <!-- tabs -->
      <div
        class="mm-tabs"
        style="margin-top: 30px"
      >
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          class="mm-tab"
          :class="{ 'mm-tab--active': activeTab === t.id }"
          @click="activeTab = t.id"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- ===================== OVERVIEW ===================== -->
      <div
        v-if="activeTab === 'overview'"
        style="margin-top: 22px"
      >
        <!-- main 2-column grid: trends | accolades (achievements, best scores, rankings) -->
        <div
          class="mm-dash-grid"
          style="grid-template-columns: 1.15fr 1fr"
        >
          <!-- Column 1: Performance trends -->
          <div class="mm-dash-col">
            <MmPlayerTrendPanel
              :kd-trend="kdTrend"
              :kill-rate-trend="killRateTrend"
              :granularity="stats?.recentStats?.granularity || 'daily'"
              :player-name="rawName"
              :loading="loading"
            />
          </div>

          <!-- Column 2: Accolades (Achievements, Best Scores, Server Rankings) -->
          <div class="mm-dash-col">
            <section class="mm-panel mm-panel--trophy">
              <div class="mm-pbar mm-pbar--trophy">
                <span class="mm-pbar__t"># Accolades</span>
                <span class="mm-pbar__m">records &amp; rankings</span>
              </div>
              <div style="padding: 10px 12px 12px">
                <!-- Color-coded Accolade Tabs -->
                <div class="mm-accolade-tabs">
                  <button
                    type="button"
                    class="mm-accolade-tab mm-accolade-tab--rankings"
                    :class="{ 'mm-accolade-tab--active': activeAccoladeTab === 'servers' }"
                    @click="activeAccoladeTab = 'servers'"
                  >
                    Servers
                    <span
                      v-if="serverRoster.length"
                      class="mm-accolade-badge mm-accolade-badge--violet"
                    >
                      {{ serverRoster.length }}
                    </span>
                  </button>
                  <button
                    type="button"
                    class="mm-accolade-tab mm-accolade-tab--scores"
                    :class="{ 'mm-accolade-tab--active': activeAccoladeTab === 'bestScores' }"
                    @click="activeAccoladeTab = 'bestScores'"
                  >
                    Best scores
                    <span
                      v-if="highestRecentScore"
                      class="mm-accolade-badge mm-accolade-badge--cyan"
                    >
                      {{ highestRecentScore.score }}
                    </span>
                  </button>
                  <button
                    type="button"
                    class="mm-accolade-tab mm-accolade-tab--achievements"
                    :class="{ 'mm-accolade-tab--active': activeAccoladeTab === 'achievements' }"
                    @click="activeAccoladeTab = 'achievements'"
                  >
                    Achievements
                    <span
                      v-if="achievementsForGrid.length"
                      class="mm-accolade-badge"
                    >
                      {{ achievementsForGrid.length }}
                    </span>
                  </button>
                </div>

                <!-- 1. Servers view — standing plus the per-server record
                     that used to live in its own tab. -->
                <div v-if="activeAccoladeTab === 'servers'">
                  <div
                    v-if="serverRoster.length > 0"
                    style="padding: 2px 0"
                  >
                    <div
                      v-for="s in serverRoster"
                      :key="s.serverGuid"
                      class="mm-rrow mm-srank"
                      @click="goServer(s.serverName)"
                    >
                      <span
                        v-if="s.rank !== null"
                        class="mm-srank__rank"
                      >#{{ s.rank }}</span>
                      <span
                        v-else
                        class="mm-srank__rank mm-srank__rank--unranked"
                      >—</span>
                      <span class="mm-srank__body">
                        <span class="mm-srank__name">{{ truncate($pn(s.serverName), 28) }}</span>
                        <span class="mm-srank__sub">{{ serverSubLine(s) }}</span>
                      </span>
                      <span class="mm-srank__record">
                        <span
                          v-if="s.totalRounds > 0"
                          class="mm-srank__kd"
                          :class="kdClass(s.kdRatio)"
                        >{{ s.kdRatio.toFixed(2) }}</span>
                        <span class="mm-srank__meta">
                          <template v-if="s.totalRounds > 0">
                            <span class="mm-num--kill">{{ formatNumber(s.totalKills) }}</span> k
                          </template>
                          <template v-else-if="s.averagePing">{{ Math.round(s.averagePing) }}ms</template>
                        </span>
                      </span>
                    </div>
                  </div>
                  <div
                    v-else
                    class="mm-empty"
                    style="border: 0; padding: 20px 0"
                  >
                    No server history yet.
                  </div>
                </div>

                <!-- 2. Best scores view -->
                <div v-else-if="activeAccoladeTab === 'bestScores'">
                  <!-- 3 Time-Horizon Window Buttons -->
                  <div class="mm-score-windows">
                    <button
                      type="button"
                      class="mm-score-win-btn"
                      :class="{ 'mm-score-win-btn--active': activeScoreWindow === 'thisWeek' }"
                      @click="activeScoreWindow = 'thisWeek'"
                    >
                      <span class="mm-score-win-btn__title">This week</span>
                      <span class="mm-score-win-btn__score">{{ topThisWeekScore ? topThisWeekScore.score : '—' }}</span>
                    </button>
                    <button
                      type="button"
                      class="mm-score-win-btn"
                      :class="{ 'mm-score-win-btn--active': activeScoreWindow === 'last30Days' }"
                      @click="activeScoreWindow = 'last30Days'"
                    >
                      <span class="mm-score-win-btn__title">Last 30d</span>
                      <span class="mm-score-win-btn__score">{{ topLast30DaysScore ? topLast30DaysScore.score : '—' }}</span>
                    </button>
                    <button
                      type="button"
                      class="mm-score-win-btn"
                      :class="{ 'mm-score-win-btn--active': activeScoreWindow === 'allTime' }"
                      @click="activeScoreWindow = 'allTime'"
                    >
                      <span class="mm-score-win-btn__title">All-time</span>
                      <span class="mm-score-win-btn__score">{{ topAllTimeScore ? topAllTimeScore.score : '—' }}</span>
                    </button>
                  </div>

                  <!-- Best scores list for active window -->
                  <div
                    v-if="currentBestScores.length > 0"
                    class="mm-bestrail"
                  >
                    <div
                      v-for="(s, i) in currentBestScores"
                      :key="`bsc-${s.roundId}-${i}`"
                      class="mm-rrow mm-bestrail__row"
                      :class="rankTintClass(i)"
                      @click="openScoreRound(s)"
                    >
                      <span class="mm-bestrail__idx">{{ rankNum(i) }}</span>
                      <span class="mm-bestrail__score">{{ formatNumber(s.score) }}</span>
                      <span class="mm-bestrail__body">
                        <span class="mm-bestrail__map">{{ s.mapName }}</span>
                        <span class="mm-bestrail__server">{{ truncate($pn(s.serverName), 28) }}</span>
                      </span>
                      <span class="mm-bestrail__stats">
                        <span class="mm-num--kill">{{ s.kills }}</span><span class="mm-num__sep">/</span><span class="mm-num--death">{{ s.deaths }}</span>
                        · <span :class="kdClass(scoreKd(s))">{{ scoreKd(s).toFixed(2) }}</span>
                      </span>
                    </div>
                  </div>
                  <div
                    v-else
                    class="mm-empty"
                    style="border: 0; padding: 20px 0"
                  >
                    No scores in this window yet.
                  </div>
                </div>

                <!-- 3. Achievements view -->
                <div v-else-if="activeAccoladeTab === 'achievements'">
                  <div
                    v-if="achievementsLoading"
                    style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px 10px"
                  >
                    <div
                      v-for="i in 4"
                      :key="i"
                      class="mm-skeleton mm-skeleton--lg"
                    />
                  </div>
                  <div
                    v-else-if="achievementsError"
                    class="mm-empty"
                    style="border: 0; padding: 12px 0"
                  >
                    {{ achievementsError }}
                  </div>
                  <div
                    v-else-if="achievementsForGrid.length === 0"
                    class="mm-empty"
                    style="border: 0; padding: 12px 0"
                  >
                    No achievements yet.
                  </div>
                  <div
                    v-else
                    class="mm-ach-mini"
                  >
                    <div
                      v-for="g in achievementsForGrid.slice(0, 6)"
                      :key="g.achievementId"
                      class="mm-ach-mini__item"
                    >
                      <img
                        :src="getAchievementImage(g.achievementId, g.tier)"
                        :alt="friendlyAchievementName(g)"
                        loading="lazy"
                        class="mm-ach-mini__img"
                      >
                      <span class="mm-ach-mini__label">{{ friendlyAchievementName(g) }}</span>
                    </div>
                  </div>
                  <button
                    v-if="achievementsForGrid.length > 6"
                    type="button"
                    class="mm-btn"
                    style="margin-top: 14px"
                    @click="goAchievements"
                  >
                    View all →
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>

        <MmPlayerAchievementsSlideover
          :open="achievementsSlideoverOpen"
          :player-name="rawName"
          @close="achievementsSlideoverOpen = false"
        />

        <!-- weekly activity rhythm heatmap -->
        <div style="margin-top: 20px">
          <MmPlayerActivityHeatmap
            :player-name="rawName"
            :game="primaryGameId"
          />
        </div>

        <!-- Rivals and battle dossier -->
        <div style="margin-top: 24px">
          <MmPlayerRivalsDossier :player-name="rawName" />
        </div>

        <!-- ally proximity orbit -->
        <section
          class="mm-panel mm-panel--social"
          style="margin-top: 24px"
        >
          <div class="mm-pbar mm-pbar--social">
            <span class="mm-pbar__t"># Ally proximity orbit</span>
            <span class="mm-pbar__m">{{ displayName }}</span>
          </div>
          <div class="mm-panel__body">
            <MmPlayerAllyOrbit
              seamless
              :player-name="rawName"
              @player-click="goPlayerFromOrbit"
            />
          </div>
        </section>
      </div>

      <!-- ===================== MAPS ===================== -->
      <div
        v-else-if="activeTab === 'maps'"
        style="margin-top: 20px"
      >
        <MmPlayerMapsTab
          :player-name="rawName"
          :game="primaryGameId"
          :map-stats="mapStats"
          :loading="loading"
          @navigate-to-map="openMapRankings"
        />
      </div>

      <!-- ===================== COMMUNITIES ===================== -->
      <div
        v-else-if="activeTab === 'communities'"
        style="margin-top: 20px"
      >
        <div class="mm-section-bar">
          <span>Communities</span>
          <span class="mm-section-bar__meta">
            {{ playerCommunities.length }} {{ playerCommunities.length === 1 ? 'squad' : 'squads' }} · by cohesion
          </span>
        </div>

        <div
          v-if="communitiesLoading"
          style="margin-top: 18px"
        >
          <div
            v-for="i in 2"
            :key="i"
            class="mm-skeleton mm-skeleton--lg"
            style="margin-bottom: 12px"
          />
        </div>
        <div
          v-else-if="playerCommunities.length === 0"
          class="mm-empty"
          style="margin-top: 18px"
        >
          This player isn't part of any detected community yet.
        </div>
        <div
          v-else
          class="mm-player-communities"
          style="margin-top: 18px"
        >
          <MmCommunityCard
            v-for="(c, i) in sortedCommunities"
            :key="c.id"
            :community="c"
            :accent-index="i"
          />
        </div>
      </div>

      <!-- ===================== SIGNATURE ===================== -->
      <div
        v-else-if="activeTab === 'signature'"
        style="margin-top: 20px"
      >
        <MmPlayerSignatureBuilder
          v-if="signatureServers.length > 0"
          :player-name="rawName"
          :servers="signatureServers"
        />
        <div
          v-else
          class="mm-empty"
        >
          No server history yet — a signature needs at least one ranked server.
        </div>
      </div>

      <!-- always-visible: comments -->
      <div style="margin-top: 24px">
        <MmPlayerComments :player-name="rawName" />
      </div>

      <!-- Current Form Mathematics & Telemetry Modal -->
      <MmPlayerFormMathModal
        v-model="showFormMathModal"
        :player-name="displayName"
        :form="currentForm"
      />
    </template>
  </div>
</template>

<style scoped>
/* back link above the hero */
.mm-player__back {
  display: inline-block;
  margin-bottom: 14px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  text-decoration: none;
}
.mm-player__back:hover { color: var(--mm-ink); }

/* hero */
.mm-player-hero {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 24px;
  flex-wrap: wrap;
}
.mm-player-hero__main { min-width: 0; flex: 1 1 300px; }
.mm-player__name {
  margin: 0;
  font-size: clamp(30px, 3.6vw, 52px);
}
.mm-player__where {
  margin-top: 8px;
  text-transform: none;
  letter-spacing: 0.02em;
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  color: var(--mm-ink-soft);
}
.mm-player-hero__nav {
  display: flex;
  gap: 22px;
  align-items: center;
  padding-top: 6px;
  flex-wrap: wrap;
}
.mm-player__navlink {
  font-family: var(--mm-font-display);
  font-size: 13px;
  color: var(--mm-ink-soft);
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.mm-player__navlink:hover { color: var(--mm-ink); }
.mm-player__navlink--strong { color: var(--mm-ink); font-weight: 500; }

@media (max-width: 720px) {
  .mm-player-hero {
    flex-direction: column;
    gap: 16px;
  }
  .mm-player-hero__main {
    flex: none;
    width: 100%;
  }
  .mm-player-hero__nav {
    padding-top: 0;
    gap: 14px 20px;
  }
}

/* recent-achievements mini grid inside the rankings column */
.mm-ach-mini {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 10px;
}
.mm-ach-mini__item {
  display: flex;
  gap: 9px;
  align-items: center;
  min-width: 0;
}
.mm-ach-mini__img {
  width: 38px;
  height: 38px;
  object-fit: contain;
  flex: none;
}
.mm-ach-mini__label {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
  line-height: 1.35;
}

/* server-rankings rail rows */
.mm-srank {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 11px 12px;
  border-top: 1px solid var(--mm-rule);
  cursor: pointer;
}
.mm-srank__rank {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: 24px;
  color: var(--mm-accent-soft);
  line-height: 1;
}
.mm-srank__body { min-width: 0; display: flex; flex-direction: column; }
.mm-srank__name {
  font-family: var(--mm-font-display);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mm-srank__sub {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}
.mm-srank__rank--unranked {
  color: var(--mm-ink-faint);
  font-size: 18px;
}
/* Right column carries the per-server record the Servers tab used to show:
   K/D on top, kills (or ping, when the server is ranked but unplayed in the
   window) beneath it. */
.mm-srank__record {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  font-variant-numeric: tabular-nums;
}
.mm-srank__kd {
  font-family: var(--mm-font-mono);
  font-size: 13px;
}
.mm-srank__meta {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-track__f--accent { background: var(--mm-accent); }

/* best-scores rail */
.mm-bestrail { display: flex; flex-direction: column; }
.mm-bestrail__row {
  display: grid;
  grid-template-columns: 24px 52px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 11px 12px;
  border-top: 1px solid var(--mm-rule);
  cursor: pointer;
}
.mm-bestrail__idx { font-family: var(--mm-font-mono); font-size: 10px; color: var(--mm-ink-muted); }
.mm-bestrail__score { font-family: var(--mm-font-mono); font-size: 16px; color: var(--mm-ink); }
.mm-bestrail__body { min-width: 0; display: flex; flex-direction: column; }
.mm-bestrail__map { font-family: var(--mm-font-display); font-size: 13px; }
.mm-bestrail__server {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mm-bestrail__stats {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  text-align: right;
  white-space: nowrap;
}
.mm-bestrail__row.mm-rank--gold .mm-bestrail__idx { color: var(--mm-kd-elite); }

/* Communities tab — squads side by side, wrapping to a single column once
   a card can no longer hold its 4-up stat strip comfortably. */
.mm-player-communities {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));
  gap: 18px;
  align-items: stretch;
}

/* Local best-scores override — the modern-minimal default is too washed out for
   a stack of three scoring windows. Give each window its own framed block with
   a strong label, a hairline divider, and a prominent top score callout. */
.mm-bestscores {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.mm-bestscores__group {
  padding: 14px 0 16px;
  border-top: 1px solid var(--mm-rule);
}

.mm-bestscores__group:first-child { border-top: 0; padding-top: 4px; }

.mm-bestscores__group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.mm-bestscores__window {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink);
  font-weight: 500;
}

.mm-bestscores__group--accent .mm-bestscores__window {
  color: var(--mm-accent);
}

.mm-bestscores__top-score {
  font-family: var(--mm-font-display);
  font-size: 22px;
  font-weight: 400;
  color: var(--mm-ink);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.mm-bestscores__group--accent .mm-bestscores__top-score {
  color: var(--mm-accent);
}

.mm-bestscores__empty {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-faint);
}

.mm-bestscores :deep(.mm-bestscores__list li) {
  padding: 6px 0;
  border-top: 1px dashed var(--mm-rule);
}

.mm-bestscores :deep(.mm-bestscores__list li:first-child) {
  border-top: 0;
}

.mm-bestscores :deep(.mm-bestscores__score) {
  font-size: 15px;
  font-weight: 500;
  color: var(--mm-ink);
}

.mm-bestscores :deep(.mm-bestscores__detail) {
  color: var(--mm-ink-soft);
}

.mm-subtab--active,
.mm-subtab--active:hover,
.mm-subtab--active:focus {
  background: var(--mm-ink) !important;
  color: var(--mm-bg) !important;
}

/* Live combat deployment banner in player hero */
.mm-live-deployment {
  margin-top: 12px;
  padding: 10px 14px;
  background: #141c10;
  border: 1px solid rgba(125, 163, 76, 0.35);
  border-left: 3px solid var(--mm-success);
  border-radius: 2px;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.mm-live-deployment__status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mm-live-deployment__radar {
  position: relative;
  width: 10px;
  height: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mm-live-deployment__core {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mm-success);
  position: relative;
  z-index: 2;
}

.mm-live-deployment__ping {
  position: absolute;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: var(--mm-success);
  opacity: 0.75;
  animation: mmRadarPing 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;
}

@keyframes mmRadarPing {
  0% { transform: scale(0.8); opacity: 0.9; }
  80%, 100% { transform: scale(2.4); opacity: 0; }
}

.mm-live-deployment__tag {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.12em;
  color: var(--mm-success);
  font-weight: 600;
}

.mm-live-deployment__info {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: var(--mm-font-display);
  font-size: 13px;
  color: var(--mm-ink);
  flex: 1 1 auto;
  flex-wrap: wrap;
}

.mm-live-deployment__server {
  font-weight: 500;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
  color: var(--mm-ink);
}

.mm-live-deployment__server:hover {
  color: var(--mm-accent-soft);
}

.mm-live-deployment__map {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 7px;
  border-radius: 2px;
  color: var(--mm-ink-soft);
}

.mm-live-deployment__mode {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
}

.mm-live-deployment__stats {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
}

.mm-live-deployment__cta {
  background: transparent;
  border: 1px solid rgba(125, 163, 76, 0.5);
  color: var(--mm-success);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 5px 11px;
  cursor: pointer;
  border-radius: 2px;
  transition: all 0.15s ease;
}

.mm-live-deployment__cta:hover {
  background: var(--mm-success);
  color: #000;
}

/* 5-up stat strip override */
.mm-stats {
  grid-template-columns: repeat(5, 1fr);
}

@media (max-width: 1024px) {
  .mm-stats {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 720px) {
  .mm-stats {
    grid-template-columns: repeat(2, 1fr);
  }
}

.mm-stats__cell--clickable {
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
  user-select: none;
}

.mm-stats__cell--clickable:hover {
  background: rgba(255, 255, 255, 0.04);
}

.mm-stats__cell--clickable:hover .mm-stats__math-hint {
  color: #60a5fa;
  border-color: rgba(96, 165, 250, 0.4);
}

.mm-stats__cell--clickable:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: -2px;
}

.mm-stats__label-wrap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.mm-stats__math-hint {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
  border: 1px solid rgba(255, 255, 255, 0.12);
  padding: 1px 5px;
  border-radius: 2px;
  transition: color 0.15s ease, border-color 0.15s ease;
}

/* Current form / momentum badge */
.mm-form-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--mm-font-mono);
  font-size: 20px;
  letter-spacing: 0.06em;
  font-variant-numeric: tabular-nums;
}

.mm-form-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}

.mm-form--surge {
  color: var(--mm-success);
}
.mm-form--surge .mm-form-dot {
  background: var(--mm-success);
  box-shadow: 0 0 7px var(--mm-success);
  animation: mmPulse 1.8s ease-in-out infinite;
}

.mm-form--slump {
  color: var(--mm-danger);
}
.mm-form--slump .mm-form-dot {
  background: var(--mm-danger);
}

.mm-form--steady {
  color: var(--mm-ink);
}
.mm-form--steady .mm-form-dot {
  background: var(--mm-ink-soft);
}

.mm-form--dormant {
  color: var(--mm-ink-muted);
}
.mm-form--dormant .mm-form-dot {
  background: var(--mm-ink-faint);
}

@keyframes mmPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}

/* Trophy & Accolades Tier (Best Scores, Achievements) */
.mm-panel--trophy {
  border-color: rgba(245, 158, 11, 0.28);
  border-left: 3px solid rgba(245, 158, 11, 0.7);
}
.mm-pbar--trophy {
  background: #231b0e;
  border-bottom: 1px solid rgba(245, 158, 11, 0.35);
}
.mm-pbar--trophy .mm-pbar__t {
  color: #f59e0b;
  letter-spacing: 0.16em;
}
.mm-pbar--trophy .mm-pbar__m {
  color: #fbbf24;
  opacity: 0.75;
}

/* Social Graph Tier (Ally Orbit) */
.mm-panel--social {
  border-color: rgba(99, 102, 241, 0.25);
  border-left: 3px solid rgba(99, 102, 241, 0.65);
}
.mm-pbar--social {
  background: #131724;
  border-bottom: 1px solid rgba(99, 102, 241, 0.3);
}
.mm-pbar--social .mm-pbar__t {
  color: #a5b4fc;
  letter-spacing: 0.16em;
}
.mm-pbar--social .mm-pbar__m {
  color: #c7d2fe;
  opacity: 0.75;
}

/* Hero Sessions ribbon */
.mm-hero-sessions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.mm-hero-sessions__label {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--mm-ink-muted);
}
.mm-hero-sessions__squares {
  display: inline-flex;
  gap: 3px;
  align-items: center;
}
.mm-hero-match-wrap {
  position: relative;
}
.mm-match-sq {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  font-weight: 700;
  text-decoration: none;
  border-radius: 2px;
  transition: transform 0.15s ease, filter 0.15s ease;
}
.mm-match-sq:hover {
  transform: translateY(-2px);
  filter: brightness(1.25);
  z-index: 10;
}
.mm-match-sq--win {
  background: rgba(34, 197, 94, 0.2);
  border: 1px solid rgba(34, 197, 94, 0.6);
  color: #4ade80;
}
.mm-match-sq--loss {
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.6);
  color: #f87171;
}
.mm-match-sq--tie {
  background: rgba(234, 179, 8, 0.2);
  border: 1px solid rgba(234, 179, 8, 0.6);
  color: #facc15;
}
.mm-match-sq--unknown {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: var(--mm-ink-muted);
}

/* Hero match tactical hover tooltip */
.mm-hero-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  width: 190px;
  background: #141414;
  border: 1px solid #333333;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.7);
  padding: 8px 10px;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.15s ease, transform 0.15s ease;
  z-index: 100;
}
.mm-hero-match-wrap:hover .mm-hero-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(-2px);
}
.mm-hero-tooltip__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: var(--mm-font-mono);
  font-size: 9px;
  margin-bottom: 4px;
}
.mm-hero-tooltip__tag--win {
  color: #4ade80;
  font-weight: 700;
}
.mm-hero-tooltip__tag--loss {
  color: #f87171;
  font-weight: 700;
}
.mm-hero-tooltip__tag--tie {
  color: #facc15;
  font-weight: 700;
}
.mm-hero-tooltip__time {
  color: var(--mm-ink-muted);
}
.mm-hero-tooltip__map {
  font-family: var(--mm-font-display);
  font-size: 11px;
  font-weight: 600;
  color: var(--mm-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 3px;
}
.mm-hero-tooltip__meta {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-muted);
}
.mm-hero-tooltip__hint {
  margin-top: 5px;
  padding-top: 4px;
  border-top: 1px solid #262626;
  font-family: var(--mm-font-mono);
  font-size: 9px;
  color: #38bdf8;
  letter-spacing: 0.04em;
}

/* Color-coded Accolade Tabs */
.mm-accolade-tabs {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}
.mm-accolade-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 8px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  background: transparent;
  border: 1px solid var(--mm-rule, #333);
  color: var(--mm-ink-muted);
  cursor: pointer;
  transition: all 0.15s ease;
  border-radius: 2px;
}
.mm-accolade-tab:hover {
  color: var(--mm-ink);
  border-color: #555;
}
.mm-accolade-tab--achievements.mm-accolade-tab--active {
  background: rgba(245, 158, 11, 0.15);
  border-color: #f59e0b;
  color: #f59e0b;
  font-weight: 600;
}
.mm-accolade-tab--scores.mm-accolade-tab--active {
  background: rgba(56, 189, 248, 0.15);
  border-color: #38bdf8;
  color: #38bdf8;
  font-weight: 600;
}
.mm-accolade-tab--rankings.mm-accolade-tab--active {
  background: rgba(167, 139, 250, 0.15);
  border-color: #a78bfa;
  color: #a78bfa;
  font-weight: 600;
}
.mm-accolade-badge {
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 2px;
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
  font-weight: 700;
}
.mm-accolade-badge--cyan {
  background: rgba(56, 189, 248, 0.2);
  color: #38bdf8;
}
.mm-accolade-badge--violet {
  background: rgba(167, 139, 250, 0.2);
  color: #a78bfa;
}

/* Highest Recent Score Spotlight Card */
.mm-score-spotlight {
  background: #17202a;
  border: 1px solid rgba(56, 189, 248, 0.35);
  border-left: 3px solid #38bdf8;
  padding: 10px 12px;
  margin-bottom: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.mm-score-spotlight:hover {
  background: #1c2734;
  border-color: #38bdf8;
  box-shadow: 0 4px 14px rgba(56, 189, 248, 0.15);
}
.mm-score-spotlight__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
}
.mm-score-spotlight__tag {
  color: #38bdf8;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.mm-score-spotlight__date {
  color: var(--mm-ink-muted);
}
.mm-score-spotlight__body {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.mm-score-spotlight__val {
  font-family: var(--mm-font-mono);
  font-size: 22px;
  font-weight: 700;
  color: #ffffff;
  line-height: 1;
}
.mm-score-spotlight__pts {
  font-size: 10px;
  color: #38bdf8;
  margin-left: 3px;
  font-weight: 600;
}
.mm-score-spotlight__meta {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 140px;
}
.mm-score-spotlight__map {
  font-family: var(--mm-font-display);
  font-weight: 600;
  font-size: 12px;
  color: var(--mm-ink);
}
.mm-score-spotlight__server {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-muted);
}
.mm-score-spotlight__kd {
  font-family: var(--mm-font-mono);
  font-size: 11px;
}

/* 3 Time-Horizon Window Buttons */
.mm-score-windows {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
.mm-score-win-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 5px 6px;
  background: var(--mm-bg-soft, #161616);
  border: 1px solid var(--mm-rule, #333);
  color: var(--mm-ink-muted);
  font-family: var(--mm-font-mono);
  cursor: pointer;
  transition: all 0.15s ease;
  border-radius: 2px;
}
.mm-score-win-btn:hover {
  border-color: #555;
  color: var(--mm-ink);
}
.mm-score-win-btn--active {
  background: rgba(56, 189, 248, 0.12);
  border-color: #38bdf8;
  color: var(--mm-ink);
}
.mm-score-win-btn__title {
  font-size: 9.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.mm-score-win-btn__score {
  font-size: 13px;
  font-weight: 700;
  color: #38bdf8;
}

/* Mobile density for the accolades panel. The tab row is three `flex: 1`
   items, but a flex item defaults to `min-width: auto`, so it can't shrink
   below its own min-content — "Achievements" plus its badge held 134px in a
   ~100px slot and pushed the third tab past the panel edge. Tighten the type
   and let the items actually shrink. The score windows drop from stacked
   title-over-score to a single line, which is what made them read as bulky. */
@media (max-width: 720px) {
  .mm-accolade-tabs { gap: 4px; }
  /* `flex: 1` forced three equal slots, which made the longest label wrap to
     a second line. Sizing from content instead lets the labels sit on one
     line and still fill the row. */
  .mm-accolade-tab {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    padding: 6px 4px;
    gap: 4px;
    font-size: 10px;
    letter-spacing: 0.01em;
  }
  .mm-accolade-badge {
    flex: none;
    font-size: 9px;
    padding: 1px 3px;
  }

  .mm-score-windows { gap: 4px; }
  .mm-score-win-btn {
    flex-direction: row;
    justify-content: center;
    gap: 5px;
    min-width: 0;
    padding: 5px 4px;
  }
  .mm-score-win-btn__title { font-size: 9px; letter-spacing: 0.01em; }
  .mm-score-win-btn__score { font-size: 11px; }
}
</style>
