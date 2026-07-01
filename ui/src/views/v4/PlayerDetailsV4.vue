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
import MmSparkline from '@/components/v4/MmSparkline.vue'
import MmBars from '@/components/v4/MmBars.vue'
import MmPlayerComments from '@/components/v4/MmPlayerComments.vue'
import MmPlayerSignatureBuilder from '@/components/v4/MmPlayerSignatureBuilder.vue'
import MmCommunityCard from '@/components/v4/MmCommunityCard.vue'
import MmPlayerActivityHeatmap from '@/components/v4/MmPlayerActivityHeatmap.vue'
import MmPlayerMapPreference from '@/components/v4/MmPlayerMapPreference.vue'
import MmPlayerAchievementHeroBadges from '@/components/v4/MmPlayerAchievementHeroBadges.vue'
import MmPlayerRecentRoundsCompact from '@/components/v4/MmPlayerRecentRoundsCompact.vue'
import MmPlayerAchievementSummary from '@/components/v4/MmPlayerAchievementSummary.vue'
import MmPlayerServerMapStats from '@/components/v4/MmPlayerServerMapStats.vue'
import MmPlayerCompetitiveRankings from '@/components/v4/data-explorer/MmPlayerCompetitiveRankings.vue'
import MmMapPerformanceRace from '@/components/v4/data-explorer/MmMapPerformanceRace.vue'
import MmPingProximityOrbit from '@/components/v4/MmPingProximityOrbit.vue'
import { fetchPlayerCommunities, type PlayerCommunity } from '@/services/playerRelationshipsApi'
import { kdClass, streakClass } from './mmTokens'
import { parseUtc, formatLocalTooltip, utcHourToLocalHour } from '@/utils/timeUtils'

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

const loadStats = async () => {
  loading.value = true
  error.value = null
  try {
    stats.value = await fetchPlayerStats(rawName.value)
  } catch (e) {
    error.value = 'Player feed temporarily unavailable.'
  } finally {
    loading.value = false
  }
  // Maps tab data — separate endpoint. Use days=365 so the controller
  // upgrades the period from Last30Days to ThisYear and we surface
  // every map the player has touched this year, not just the last 30d.
  try {
    mapStats.value = await fetchPlayerMapStats(rawName.value, primaryGameId.value, 365)
  } catch {
    mapStats.value = []
  }
}

const loadAchievements = async () => {
  if (achievementGroups.value.length || achievementsLoading.value) return
  achievementsLoading.value = true
  achievementsError.value = null
  try {
    const r = await fetch(`/stats/gamification/player/${encodeURIComponent(rawName.value)}/achievement-groups`)
    if (!r.ok) throw new Error(`http ${r.status}`)
    achievementGroups.value = await r.json()
  } catch (e) {
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
type Tab = 'overview' | 'sessions' | 'maps' | 'servers' | 'achievements'
const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'sessions', label: 'Recent sessions' },
  { id: 'maps', label: 'Maps' },
  { id: 'servers', label: 'Servers' },
  { id: 'achievements', label: 'Achievements' },
]
const activeTab = ref<Tab>((route.query.tab as Tab) || 'overview')
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

const firstSeen = computed(() => stats.value?.firstPlayed ?? null)
const firstSeenDate = computed(() => {
  if (!firstSeen.value) return '—'
  const d = parseUtc(firstSeen.value)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
})
const yearsActive = computed(() => {
  if (!firstSeen.value) return 0
  const d = parseUtc(firstSeen.value)
  if (isNaN(d.getTime())) return 0
  return (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25)
})
const tierLabel = computed(() => {
  const y = yearsActive.value
  if (y >= 10) return 'Old Guard'
  if (y >= 5) return 'Veteran'
  if (y >= 2) return 'Regular'
  if (y > 0) return 'Recruit'
  return ''
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
const resultLabel = (result: Session['teamResult']) => {
  if (result === 'win') return 'Win'
  if (result === 'loss') return 'Loss'
  if (result === 'tie') return 'Draw'
  return '—'
}
const sessionDurationMinutes = (s: Session) => {
  const start = parseUtc(s.startTime).getTime()
  const end = parseUtc(s.lastSeenTime).getTime()
  if (isNaN(start) || isNaN(end)) return 0
  return Math.max(0, (end - start) / 60000)
}
const sessionKd = (s: Session) => (s.totalDeaths === 0 ? s.totalKills : s.totalKills / s.totalDeaths)
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

// Servers tab — aggregate per-server stats, most-played first.
const topServers = computed(() => {
  const s = stats.value?.servers ?? []
  return [...s].sort((a, b) => b.totalMinutes - a.totalMinutes).slice(0, 12)
})

interface MapAgg { mapName: string; minutes: number; kills: number; deaths: number; kd: number }
// Backend (/players/:name/map-stats) returns ServerStatistics which has no
// KdRatio property — the TS interface lies. Compute K/D locally.
const topMaps = computed<MapAgg[]>(() => {
  return [...mapStats.value]
    .sort((a, b) => (b.totalPlayTimeMinutes ?? 0) - (a.totalPlayTimeMinutes ?? 0))
    .slice(0, 12)
    .map(m => {
      const kills = m.totalKills ?? 0
      const deaths = m.totalDeaths ?? 0
      return {
        mapName: m.mapName,
        minutes: m.totalPlayTimeMinutes ?? 0,
        kills,
        deaths,
        kd: deaths > 0 ? kills / deaths : kills,
      }
    })
})

// ---------- richer overview data ----------

// Activity rhythm — 24-hour bars. API delivers UTC-bucketed counts;
// remap to viewer's local hour so the axis matches their wall clock.
const activityHours = computed<number[]>(() => {
  const a = stats.value?.insights?.activityByHour ?? []
  if (a.length === 0) return []
  const buckets = Array(24).fill(0)
  for (const slot of a) {
    if (typeof slot.hour === 'number' && slot.hour >= 0 && slot.hour < 24) {
      const localHour = utcHourToLocalHour(slot.hour)
      buckets[localHour] += slot.minutesActive ?? 0
    }
  }
  return buckets
})
const peakHour = computed(() => {
  const v = activityHours.value
  if (v.length === 0) return null
  const max = Math.max(...v)
  if (max === 0) return null
  const i = v.indexOf(max)
  return { hour: i, minutes: max }
})

// Trend sparklines (recentStats)
const kdTrend = computed(() => stats.value?.recentStats?.kdRatioTrend ?? [])
const killRateTrend = computed(() => stats.value?.recentStats?.killRateTrend ?? [])
const trendDelta = (series: { value: number }[]) => {
  if (series.length < 2) return null
  const first = series[0].value
  const last = series[series.length - 1].value
  if (first === 0) return null
  return ((last - first) / Math.abs(first)) * 100
}
const kdTrendDelta = computed(() => trendDelta(kdTrend.value))
const killRateTrendDelta = computed(() => trendDelta(killRateTrend.value))

// Server rankings (top 4)
const allServerRankings = computed<ServerRanking[]>(() => {
  const r = stats.value?.insights?.serverRankings ?? []
  return [...r].sort((a, b) => a.rank - b.rank).slice(0, 4)
})

// Best scores — show top 3 for each window
const bestScores = computed(() => stats.value?.bestScores ?? null)
const hasAnyBestScores = computed(() => {
  const b = bestScores.value
  if (!b) return false
  return (b.thisWeek?.length ?? 0) > 0 || (b.last30Days?.length ?? 0) > 0 || (b.allTime?.length ?? 0) > 0
})

// Best-score window picker. Mirrors the per-map tab/table pattern — a
// tab row at the top, a sortable table beneath, each row pinned to a
// gold/silver/bronze tint for the top three.
type ScoreWindow = 'thisWeek' | 'last30Days' | 'allTime'
const scoreWindows: { id: ScoreWindow; label: string }[] = [
  { id: 'thisWeek', label: 'This week' },
  { id: 'last30Days', label: 'Last 30 days' },
  { id: 'allTime', label: 'All-time' },
]
const activeScoreWindow = ref<ScoreWindow>('thisWeek')
const currentBestScores = computed<BestScoreEntry[]>(() => bestScores.value?.[activeScoreWindow.value] ?? [])

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
const goNetwork = () => {
  router.push(`/v4/players/${encodeURIComponent(rawName.value)}/network`)
}
const goRoundReport = (s: Session) => {
  if (s.roundId) router.push(`/v4/rounds/${encodeURIComponent(s.roundId)}/report`)
}

const goServer = (serverName: string) => {
  router.push(`/v4/servers/detail/${encodeURIComponent(serverName)}`)
}

// Map detail used to be an in-page drill-in which let the user scroll
// past it and lose context. Now it's its own route (/v4/players/:name/maps/:map)
// so navigation handles scroll-to-top and back-button behaviour cleanly.
const openMapRankings = (mapName: string) => {
  router.push({
    path: `/v4/players/${encodeURIComponent(rawName.value)}/maps/${encodeURIComponent(mapName)}`,
    query: { game: primaryGameId.value },
  })
}

const primaryGameId = computed<'bf1942' | 'fh2' | 'bfvietnam'>(() => {
  const g = (stats.value?.servers?.[0]?.gameId || 'bf1942').toLowerCase()
  if (g.includes('fh2')) return 'fh2'
  if (g.includes('vietnam') || g === 'bfv') return 'bfvietnam'
  return 'bf1942'
})

const primaryServer = computed(() => stats.value?.servers?.[0] ?? null)

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
    <router-link to="/v4/players" class="mm-player__back">‹ Players</router-link>

    <!-- loading / error overlay (shared) -->
    <div v-if="loading" style="padding: 40px 0">
      <div v-for="i in 5" :key="i" class="mm-skeleton" style="margin-bottom: 12px" />
    </div>

    <div v-else-if="error" class="mm-empty">{{ error }}</div>

    <template v-else>
      <!-- hero -->
      <div class="mm-player-hero">
        <div class="mm-player-hero__avatar">{{ (displayName[0] || '?').toUpperCase() }}</div>

        <div class="mm-player-hero__main">
          <div class="mm-meta-row" style="margin-bottom: 8px">
            <span class="mm-chip" :class="isOnline ? 'mm-chip--live' : 'mm-chip--off'">
              <span class="mm-chip__dot" />{{ isOnline ? 'Online' : 'Offline' }}
            </span>
            <span class="mm-meta-row__sep">·</span>
            <span v-if="bestRank">Rank <span class="mm-meta-row__strong">#{{ bestRank.rank }}</span> of {{ formatNumber(bestRank.of) }}</span>
            <span v-else>Unranked</span>
            <span class="mm-meta-row__sep">·</span>
            <span>First seen {{ firstSeenDate }}</span>
          </div>

          <h1 class="mm-display mm-player__name">
            {{ displayName }}
            <span v-if="tierLabel" class="mm-display__muted">{{ tierLabel }}</span>
          </h1>

          <div class="mm-meta-row mm-player__where">
            <template v-if="currentServer">
              currently on
              <a
                class="mm-meta-row__strong"
                style="text-decoration: underline; text-underline-offset: 3px; cursor: pointer"
                @click="goServer(currentServer.serverName)"
              >{{ currentServer.serverName }}</a>
              <template v-if="currentServer.mapName">
                <span class="mm-meta-row__sep">·</span><span>{{ currentServer.mapName }}</span>
              </template>
            </template>
            <template v-else>
              last seen <span class="mm-meta-row__strong" :title="stats?.lastPlayed ? formatLocalTooltip(stats.lastPlayed) : ''">{{ stats?.lastPlayed ? formatRelative(stats.lastPlayed) : '—' }}</span>
            </template>
          </div>

          <div style="margin-top: 16px">
            <MmPlayerAchievementHeroBadges :player-name="rawName" :total-count="achievementGroups.length" />
          </div>
        </div>

        <div class="mm-player-hero__nav">
          <button class="mm-player__navlink" type="button" @click="goCompare">Compare</button>
          <button class="mm-player__navlink" type="button" @click="goNetwork">Network</button>
          <button class="mm-player__navlink mm-player__navlink--strong" type="button" @click="goSessions">Sessions →</button>
        </div>
      </div>

      <!-- KPI strip -->
      <div class="mm-stats" style="margin-top: 24px">
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Lifetime kills</div>
          <div class="mm-stat__value mm-num--kill">{{ formatNumber(totalKills) }}</div>
          <div class="mm-stat__delta"><span class="mm-num--death">{{ formatNumber(totalDeaths) }}</span> deaths</div>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">K/D ratio</div>
          <div class="mm-stat__value" :class="kdClass(kd)">{{ kd.toFixed(2) }}</div>
          <div class="mm-stat__delta">
            <template v-if="totalKills > 0">
              <span class="mm-num--kill">{{ formatNumber(totalKills) }} k</span>
              <span class="mm-num__sep">/</span>
              <span class="mm-num--death">{{ formatNumber(totalDeaths) }} d</span>
            </template>
            <template v-else>no rounds yet</template>
          </div>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Playtime</div>
          <div class="mm-stat__value">{{ formatNumber(playtimeHours) }}<span class="mm-stat__suffix">h</span></div>
          <div class="mm-stat__delta">{{ formatNumber(sessionsCount) }} sessions</div>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Best streak</div>
          <div class="mm-stat__value" :class="streakClass(bestStreak?.latestValue)">{{ bestStreak ? bestStreak.latestValue : '—' }}</div>
          <div class="mm-stat__delta">{{ bestStreak ? `${bestStreak.count}× recorded` : 'no streaks logged' }}</div>
        </div>
      </div>

      <!-- tabs -->
      <div class="mm-tabs" style="margin-top: 30px">
        <button
          v-for="t in tabs"
          :key="t.id"
          type="button"
          class="mm-tab"
          :class="{ 'mm-tab--active': activeTab === t.id }"
          @click="activeTab = t.id"
        >{{ t.label }}</button>
      </div>

      <!-- ===================== OVERVIEW ===================== -->
      <div v-if="activeTab === 'overview'" style="margin-top: 22px">
        <!-- main grid: sessions | charts | achievements + rankings -->
        <div class="mm-dash-grid" style="grid-template-columns: 1.5fr 0.85fr 1fr">
          <section class="mm-panel">
            <div class="mm-pbar">
              <span class="mm-pbar__t"># Latest sessions</span>
              <span class="mm-pbar__m">tap for full debrief</span>
            </div>
            <div class="mm-panel__body">
              <MmPlayerRecentRoundsCompact :sessions="recentSessions" :player-name="rawName" />
            </div>
          </section>

          <div class="mm-dash-col">
            <section class="mm-panel"><div class="mm-panel__body">
              <span class="mm-eyebrow mm-eyebrow--strong">Activity rhythm</span>
              <div class="mm-card__hint">your local hours · last 30d</div>
              <div v-if="activityHours.length > 0" style="margin-top: 10px">
                <MmBars :values="activityHours" :labels="['00', '06', '12', '18', '23']" :height="56" />
              </div>
              <div v-else class="mm-card__empty">No activity recorded.</div>
              <div v-if="peakHour" class="mm-card__foot">
                Peak around <span class="mm-meta-row__strong">{{ String(peakHour.hour).padStart(2, '0') }}:00</span>
                · {{ formatDuration(peakHour.minutes) }}
              </div>
            </div></section>

            <section class="mm-panel"><div class="mm-panel__body">
              <span class="mm-eyebrow mm-eyebrow--strong">K/D trend</span>
              <div class="mm-card__hint">{{ stats?.recentStats?.granularity || 'rolling' }} · {{ kdTrend.length || 0 }} pts</div>
              <div v-if="kdTrend.length > 1" style="margin-top: 10px">
                <MmSparkline :values="kdTrend.map(p => p.value)" :height="56" :width="260" />
              </div>
              <div v-else class="mm-card__empty">Not enough rounds yet.</div>
              <div v-if="kdTrendDelta != null" class="mm-card__foot">
                <span :class="kdTrendDelta >= 0 ? 'mm-stat__delta--up' : 'mm-stat__delta--down'">
                  {{ kdTrendDelta >= 0 ? '+' : '' }}{{ kdTrendDelta.toFixed(1) }}%
                </span>
                vs first · last {{ kdTrend[kdTrend.length - 1]?.value.toFixed(2) }}
              </div>
            </div></section>

            <section class="mm-panel"><div class="mm-panel__body">
              <span class="mm-eyebrow mm-eyebrow--strong">Kill rate</span>
              <div class="mm-card__hint">kills / minute</div>
              <div v-if="killRateTrend.length > 1" style="margin-top: 10px">
                <MmSparkline :values="killRateTrend.map(p => p.value)" :height="56" :width="260" :accent="true" />
              </div>
              <div v-else class="mm-card__empty">Not enough rounds yet.</div>
              <div v-if="killRateTrendDelta != null" class="mm-card__foot">
                <span :class="killRateTrendDelta >= 0 ? 'mm-stat__delta--up' : 'mm-stat__delta--down'">
                  {{ killRateTrendDelta >= 0 ? '+' : '' }}{{ killRateTrendDelta.toFixed(1) }}%
                </span>
                vs first · last {{ killRateTrend[killRateTrend.length - 1]?.value.toFixed(2) }}
              </div>
            </div></section>
          </div>

          <div class="mm-dash-col">
            <section class="mm-panel">
              <div class="mm-pbar"><span class="mm-pbar__t"># Recent achievements</span></div>
              <div class="mm-panel__body">
                <div v-if="achievementsLoading" style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px 10px">
                  <div v-for="i in 4" :key="i" class="mm-skeleton mm-skeleton--lg" />
                </div>
                <div v-else-if="achievementsError" class="mm-empty" style="border: 0; padding: 12px 0">{{ achievementsError }}</div>
                <div v-else-if="achievementsForGrid.length === 0" class="mm-empty" style="border: 0; padding: 12px 0">No achievements yet.</div>
                <div v-else class="mm-ach-mini">
                  <div v-for="g in achievementsForGrid.slice(0, 6)" :key="g.achievementId" class="mm-ach-mini__item">
                    <img
                      :src="getAchievementImage(g.achievementId, g.tier)"
                      :alt="friendlyAchievementName(g)"
                      loading="lazy"
                      class="mm-ach-mini__img"
                    />
                    <span class="mm-ach-mini__label">{{ friendlyAchievementName(g) }}</span>
                  </div>
                </div>
                <button
                  v-if="achievementsForGrid.length > 6"
                  type="button"
                  class="mm-btn"
                  style="margin-top: 14px"
                  @click="activeTab = 'achievements'"
                >View all →</button>
              </div>
            </section>

            <section class="mm-panel">
              <div class="mm-pbar"><span class="mm-pbar__t"># Server rankings</span></div>
              <div style="padding: 4px 6px 6px">
                <div
                  v-for="r in allServerRankings"
                  :key="r.serverGuid"
                  class="mm-rrow mm-srank"
                  @click="goServer(r.serverName)"
                >
                  <span class="mm-srank__rank">#{{ r.rank }}</span>
                  <span class="mm-srank__body">
                    <span class="mm-srank__name">{{ truncate(r.serverName, 30) }}</span>
                    <span class="mm-srank__sub">of {{ formatNumber(r.totalRankedPlayers) }} players</span>
                  </span>
                  <span class="mm-srank__ping">{{ r.averagePing }}ms</span>
                </div>
                <div v-if="allServerRankings.length === 0" class="mm-empty" style="border: 0; padding: 12px">No competitive rankings yet.</div>
              </div>
            </section>
          </div>
        </div>

        <!-- favourite maps + per-map statistics -->
        <div class="mm-dash-grid mm-dash-grid--early" style="grid-template-columns: 1fr 1.4fr; margin-top: 20px">
          <section class="mm-panel">
            <div class="mm-pbar">
              <span class="mm-pbar__t"># Favourite maps</span>
              <span class="mm-pbar__m">by K/D</span>
            </div>
            <div class="mm-panel__body mm-favmaps">
              <div
                v-for="m in topMaps.slice(0, 6)"
                :key="m.mapName"
                class="mm-favmaps__row"
                @click="openMapRankings(m.mapName)"
              >
                <span class="mm-favmaps__name">{{ m.mapName }}</span>
                <span class="mm-favmaps__bar">
                  <span class="mm-track" style="width: 120px; height: 5px"><span class="mm-track__f" :class="{ 'mm-track__f--accent': m.kd >= kd }" :style="{ width: Math.min(100, (m.kd / Math.max(1, kd * 1.6)) * 100) + '%' }" /></span>
                  <span class="mm-favmaps__kd" :class="kdClass(m.kd)">{{ m.kd.toFixed(2) }}</span>
                </span>
                <span class="mm-favmaps__meta">{{ formatDuration(m.minutes) }} · <span class="mm-num--kill">{{ formatNumber(m.kills) }}</span> kills</span>
              </div>
              <div v-if="topMaps.length === 0" class="mm-empty" style="border: 0; padding: 12px 0">No map history yet.</div>
            </div>
          </section>

          <MmPlayerServerMapStats
            :player-name="rawName"
            :game="primaryGameId"
            @open-rankings="openMapRankings"
            @open-map-detail="openMapRankings"
          />
        </div>

        <!-- competitive rankings -->
        <div class="mm-section-bar" style="margin-top: 24px">
          <span>Competitive rankings</span>
          <span class="mm-section-bar__meta">map-level K/D vs population</span>
        </div>
        <div style="margin-top: 16px">
          <MmPlayerCompetitiveRankings
            :player-name="rawName"
            :game="primaryGameId"
            @navigate-to-map="openMapRankings"
          />
        </div>

        <!-- weekly heatmap + best scores -->
        <div class="mm-dash-grid mm-dash-grid--early" style="grid-template-columns: 1.3fr 1fr; margin-top: 24px">
          <MmPlayerActivityHeatmap :player-name="rawName" :game="primaryGameId" />

          <section v-if="hasAnyBestScores" class="mm-panel">
            <div class="mm-pbar">
              <span class="mm-pbar__t"># Best scores</span>
              <span class="mm-pbar__m">your local time</span>
            </div>
            <div style="padding: 12px 14px 6px">
              <div class="mm-subtabs" style="margin-bottom: 10px">
                <button
                  v-for="w in scoreWindows"
                  :key="w.id"
                  type="button"
                  class="mm-subtab"
                  :class="{ 'mm-subtab--active': activeScoreWindow === w.id }"
                  @click="activeScoreWindow = w.id"
                >{{ w.label }}</button>
              </div>
              <div v-if="currentBestScores.length > 0" class="mm-bestrail">
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
                    <span class="mm-bestrail__server">{{ truncate(s.serverName, 32) }}</span>
                  </span>
                  <span class="mm-bestrail__stats">
                    <span class="mm-num--kill">{{ s.kills }}</span><span class="mm-num__sep">/</span><span class="mm-num--death">{{ s.deaths }}</span>
                    · <span :class="kdClass(scoreKd(s))">{{ scoreKd(s).toFixed(2) }}</span>
                  </span>
                </div>
              </div>
              <div v-else class="mm-empty" style="border: 0; padding: 24px 0">No scores in this window yet.</div>
            </div>
          </section>
        </div>

        <!-- proximity orbit + communities (retained, columnar) -->
        <div class="mm-dash-grid mm-dash-grid--early" style="grid-template-columns: 1fr 1fr; margin-top: 24px">
          <section v-if="primaryServer" class="mm-panel">
            <div class="mm-pbar">
              <span class="mm-pbar__t"># Proximity orbit</span>
              <span class="mm-pbar__m">{{ truncate(primaryServer.serverName, 22) }}</span>
            </div>
            <div class="mm-panel__body">
              <MmPingProximityOrbit
                seamless
                :server-guid="primaryServer.serverGuid"
                :server-name="primaryServer.serverName"
                @player-click="goPlayerFromOrbit"
              />
            </div>
          </section>

          <section v-if="playerCommunities.length > 0" class="mm-panel">
            <div class="mm-pbar"><span class="mm-pbar__t"># Communities</span></div>
            <div class="mm-panel__body mm-comm-col">
              <MmCommunityCard v-for="c in playerCommunities" :key="c.id" :community="c" />
            </div>
          </section>
        </div>
      </div>

      <!-- ===================== SESSIONS ===================== -->
      <div v-else-if="activeTab === 'sessions'" style="margin-top: 20px">
        <div class="mm-eyebrow mm-tz-hint">Times shown in your local time</div>
        <ol class="mm-tab-cards">
          <li
            v-for="s in recentSessions"
            :key="`mc-${s.sessionId}`"
            class="mm-session-row"
            :class="{
              'mm-session-row--win': s.teamResult === 'win',
              'mm-session-row--loss': s.teamResult === 'loss',
            }"
            @click="goRoundReport(s)"
          >
            <span class="mm-session-row__chip">{{ resultLabel(s.teamResult) }}</span>
            <span class="mm-session-row__map">{{ s.mapName || 'Unknown' }}</span>
            <span class="mm-session-row__date" :title="formatLocalTooltip(s.startTime)">{{ formatRelative(s.startTime) }}</span>
            <span class="mm-session-row__server">{{ truncate(s.serverName, 32) }}</span>
            <span class="mm-session-row__stats">
              {{ formatNumber(s.totalScore) }}
              <span class="mm-num__sep">·</span>
              <span class="mm-num--kill">{{ s.totalKills }}</span><span class="mm-num__sep">/</span><span class="mm-num--death">{{ s.totalDeaths }}</span>
              <span class="mm-num__sep">·</span>
              <span :class="kdClass(sessionKd(s))">{{ sessionKd(s).toFixed(2) }}</span>
            </span>
          </li>
          <li v-if="recentSessions.length === 0" class="mm-empty" style="border: 0; padding: 24px 0; list-style: none">No sessions logged yet.</li>
        </ol>

        <table class="mm-list mm-list--dense mm-tab-table">
          <thead>
            <tr>
              <th>Map</th>
              <th>Server</th>
              <th>When</th>
              <th class="is-num" style="width: 90px">Duration</th>
              <th class="is-num" style="width: 110px">K / D</th>
              <th class="is-num" style="width: 70px">K/D</th>
              <th class="is-num" style="width: 80px">Score</th>
              <th class="is-num" style="width: 80px">Result</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="s in recentSessions" :key="s.sessionId" @click="goRoundReport(s)">
              <td class="mm-list__name-cell">
                <div class="mm-list__name">
                  <span class="mm-list__name-primary">{{ s.mapName || 'Unknown' }}</span>
                  <span class="mm-list__name-sub">{{ s.gameType || '—' }}</span>
                </div>
              </td>
              <td class="is-muted">{{ truncate(s.serverName) }}</td>
              <td class="is-muted" :title="formatLocalTooltip(s.startTime)">{{ formatRelative(s.startTime) }}</td>
              <td class="is-num">{{ formatDuration(sessionDurationMinutes(s)) }}</td>
              <td class="is-num">
                <span class="mm-num--kill">{{ s.totalKills }}</span>
                <span class="mm-num__sep">/</span>
                <span class="mm-num--death">{{ s.totalDeaths }}</span>
              </td>
              <td class="is-num" :class="kdClass(sessionKd(s))">{{ sessionKd(s).toFixed(2) }}</td>
              <td class="is-num">{{ formatNumber(s.totalScore) }}</td>
              <td class="is-num">
                <span
                  class="mm-chip"
                  :class="{
                    'mm-chip--win': s.teamResult === 'win',
                    'mm-chip--loss': s.teamResult === 'loss',
                    'mm-chip--off': s.teamResult === 'tie',
                  }"
                  style="text-transform: uppercase"
                >{{ resultLabel(s.teamResult) }}</span>
              </td>
            </tr>
            <tr v-if="recentSessions.length === 0">
              <td colspan="8" class="mm-empty" style="border: 0">No sessions logged yet.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ===================== MAPS ===================== -->
      <div v-else-if="activeTab === 'maps'" style="margin-top: 20px">
        <ol class="mm-tab-cards">
          <li
            v-for="(m, i) in topMaps"
            :key="`mc-${m.mapName}`"
            class="mm-session-row mm-session-row--rank"
            :class="rankTintClass(i)"
            @click="openMapRankings(m.mapName)"
          >
            <span class="mm-session-row__chip">{{ rankNum(i) }}</span>
            <span class="mm-session-row__map">{{ m.mapName }}</span>
            <span class="mm-session-row__date">{{ formatDuration(m.minutes) }}</span>
            <span class="mm-session-row__server">Rank →</span>
            <span class="mm-session-row__stats">
              <span class="mm-num--kill">{{ formatNumber(m.kills) }}</span><span class="mm-num__sep">/</span><span class="mm-num--death">{{ formatNumber(m.deaths) }}</span>
              <span class="mm-num__sep">·</span>
              <span :class="kdClass(m.kd)">{{ m.kd.toFixed(2) }}</span>
            </span>
          </li>
          <li v-if="topMaps.length === 0" class="mm-empty" style="border: 0; padding: 24px 0; list-style: none">No map history yet.</li>
        </ol>

        <table class="mm-list mm-list--dense mm-tab-table">
          <thead>
            <tr>
              <th style="width: 40px"></th>
              <th>Map</th>
              <th class="is-num">Time</th>
              <th class="is-num">Kills</th>
              <th class="is-num">Deaths</th>
              <th class="is-num">K/D</th>
              <th style="width: 100px"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(m, i) in topMaps"
              :key="m.mapName"
              :class="rankTintClass(i)"
              @click="openMapRankings(m.mapName)"
            >
              <td class="mm-list__rank">{{ rankNum(i) }}</td>
              <td class="mm-list__name-cell">
                <div class="mm-list__name">
                  <span class="mm-list__name-primary">{{ m.mapName }}</span>
                </div>
              </td>
              <td class="is-num">{{ formatDuration(m.minutes) }}</td>
              <td class="is-num mm-num--kill">{{ formatNumber(m.kills) }}</td>
              <td class="is-num mm-num--death">{{ formatNumber(m.deaths) }}</td>
              <td class="is-num" :class="kdClass(m.kd)">{{ m.kd.toFixed(2) }}</td>
              <td><span class="mm-eyebrow">Rank →</span></td>
            </tr>
            <tr v-if="topMaps.length === 0">
              <td colspan="7" class="mm-empty" style="border: 0">No map history yet.</td>
            </tr>
          </tbody>
        </table>

        <!-- map performance + map preference (retained, columnar) -->
        <div class="mm-dash-grid mm-dash-grid--early" style="grid-template-columns: 1fr 1fr; margin-top: 24px">
          <div>
            <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 14px">Map performance over time</div>
            <MmMapPerformanceRace
              :player-name="rawName"
              :game="primaryGameId"
              @navigate-to-map="openMapRankings"
            />
          </div>
          <MmPlayerMapPreference
            :player-name="rawName"
            :game="primaryGameId"
            @navigate-to-map="openMapRankings"
          />
        </div>
      </div>

      <!-- ===================== SERVERS ===================== -->
      <div v-else-if="activeTab === 'servers'" style="margin-top: 20px">
        <ol class="mm-tab-cards">
          <li
            v-for="(s, i) in topServers"
            :key="`sc-${s.serverGuid}`"
            class="mm-session-row mm-session-row--rank"
            :class="rankTintClass(i)"
            @click="goServer(s.serverName)"
          >
            <span class="mm-session-row__chip">{{ rankNum(i) }}</span>
            <span class="mm-session-row__map">{{ s.serverName }}</span>
            <span class="mm-session-row__date">{{ formatDuration(s.totalMinutes) }}</span>
            <span class="mm-session-row__server">{{ s.gameId.toUpperCase() }} · {{ formatNumber(s.totalRounds) }} rounds</span>
            <span class="mm-session-row__stats">
              <span class="mm-num--kill">{{ formatNumber(s.totalKills) }}</span>
              <span class="mm-num__sep">·</span>
              <span :class="kdClass(s.kdRatio)">{{ s.kdRatio.toFixed(2) }}</span>
            </span>
          </li>
          <li v-if="topServers.length === 0" class="mm-empty" style="border: 0; padding: 24px 0; list-style: none">No server history yet.</li>
        </ol>

        <table class="mm-list mm-list--dense mm-tab-table">
          <thead>
            <tr>
              <th style="width: 40px"></th>
              <th>Server</th>
              <th class="is-num">Time</th>
              <th class="is-num">Rounds</th>
              <th class="is-num">Kills</th>
              <th class="is-num">K/D</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(s, i) in topServers"
              :key="s.serverGuid"
              :class="rankTintClass(i)"
              @click="goServer(s.serverName)"
            >
              <td class="mm-list__rank">{{ rankNum(i) }}</td>
              <td class="mm-list__name-cell">
                <div class="mm-list__name">
                  <span class="mm-list__name-primary">{{ s.serverName }}</span>
                  <span class="mm-list__name-sub">{{ s.gameId.toUpperCase() }}</span>
                </div>
              </td>
              <td class="is-num">{{ formatDuration(s.totalMinutes) }}</td>
              <td class="is-num">{{ formatNumber(s.totalRounds) }}</td>
              <td class="is-num mm-num--kill">{{ formatNumber(s.totalKills) }}</td>
              <td class="is-num" :class="kdClass(s.kdRatio)">{{ s.kdRatio.toFixed(2) }}</td>
            </tr>
            <tr v-if="topServers.length === 0">
              <td colspan="6" class="mm-empty" style="border: 0">No server history yet.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ===================== ACHIEVEMENTS ===================== -->
      <div v-else-if="activeTab === 'achievements'" style="margin-top: 20px">
        <MmPlayerAchievementSummary
          :player-name="rawName"
          :achievement-groups="achievementGroups"
          :loading="achievementsLoading"
          :error="achievementsError"
        />
      </div>

      <!-- always-visible: signature + comments (retained, columnar) -->
      <div class="mm-dash-grid mm-dash-grid--early" style="grid-template-columns: 1fr 1fr; margin-top: 24px">
        <MmPlayerSignatureBuilder
          v-if="signatureServers.length > 0"
          :player-name="rawName"
          :servers="signatureServers"
        />
        <MmPlayerComments :player-name="rawName" />
      </div>
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
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 24px;
  align-items: start;
}
.mm-player-hero__avatar {
  width: 88px;
  height: 88px;
  border-radius: 4px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-rule-strong);
  color: var(--mm-ink);
  font-family: var(--mm-font-mono);
  font-weight: 600;
  font-size: 40px;
  display: grid;
  place-items: center;
}
.mm-player-hero__main { min-width: 0; }
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
  .mm-player-hero { grid-template-columns: auto 1fr; }
  .mm-player-hero__avatar { width: 64px; height: 64px; font-size: 30px; }
  /* nav drops to a full-width wrapping row beneath the identity block */
  .mm-player-hero__nav {
    grid-column: 1 / -1;
    flex-wrap: wrap;
    gap: 16px 22px;
    padding-top: 4px;
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
.mm-srank__ping {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
}

/* favourite-maps rows */
.mm-favmaps { display: flex; flex-direction: column; gap: 14px; }
.mm-favmaps__row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 4px 12px;
  align-items: center;
  cursor: pointer;
}
.mm-favmaps__name { font-family: var(--mm-font-display); font-size: 14px; }
.mm-favmaps__bar { display: flex; align-items: center; gap: 10px; }
.mm-favmaps__kd {
  font-family: var(--mm-font-mono);
  font-size: 12px;
  width: 34px;
  text-align: right;
}
.mm-favmaps__meta {
  grid-column: 1;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
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

.mm-player-communities {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 18px;
}

/* communities stacked inside a dashboard panel column */
.mm-comm-col {
  display: flex;
  flex-direction: column;
  gap: 14px;
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

/* Mobile/desktop split for the per-tab lists (sessions · maps · servers ·
   best scores). Mobile gets the airy mm-session-row card from the recent-
   rounds pattern; desktop keeps the wide table. */
.mm-tab-cards {
  display: none;
  list-style: none;
  margin: 0;
  padding: 0;
}
@media (max-width: 720px) {
  .mm-tab-table { display: none; }
  .mm-tab-cards { display: flex; flex-direction: column; }
  .mm-tab-cards .mm-session-row { cursor: pointer; }
}

/* Rank variant of the session row — the chip slot shows a rank number
   instead of a win/loss label, picking up the row's gold/silver/bronze
   tint when applicable. */
.mm-session-row--rank .mm-session-row__chip {
  font-family: var(--mm-font-mono);
  background: transparent;
  color: var(--mm-ink-muted);
  border-color: var(--mm-rule);
}
.mm-session-row--rank.mm-rank--gold .mm-session-row__chip {
  color: var(--mm-kd-elite);
  border-color: var(--mm-kd-elite);
}
.mm-session-row--rank.mm-rank--silver .mm-session-row__chip {
  color: var(--mm-ink);
  border-color: var(--mm-ink-soft);
}
.mm-session-row--rank.mm-rank--bronze .mm-session-row__chip {
  color: #c08a4c;
  border-color: #c08a4c;
}

/* Subtle "Times shown in your local time" hint above date-heavy clusters. */
.mm-tz-hint {
  color: var(--mm-ink-faint);
  margin-bottom: 8px;
  font-size: 10px;
}
</style>
