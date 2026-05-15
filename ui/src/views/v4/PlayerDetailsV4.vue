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
  KillMilestone,
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
import MmPlayerAchievementSummary from '@/components/v4/MmPlayerAchievementSummary.vue'
import MmPlayerAchievementHeroBadges from '@/components/v4/MmPlayerAchievementHeroBadges.vue'
import MmPlayerRecentRoundsCompact from '@/components/v4/MmPlayerRecentRoundsCompact.vue'
import MmPlayerServerMapStats from '@/components/v4/MmPlayerServerMapStats.vue'
import MmPlayerCompetitiveRankings from '@/components/v4/data-explorer/MmPlayerCompetitiveRankings.vue'
import MmMapPerformanceRace from '@/components/v4/data-explorer/MmMapPerformanceRace.vue'
import MmPingProximityOrbit from '@/components/v4/MmPingProximityOrbit.vue'
import { fetchPlayerCommunities, type PlayerCommunity } from '@/services/playerRelationshipsApi'
import { kdClass, streakClass } from './mmTokens'

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

type Tab = 'overview' | 'sessions' | 'maps' | 'servers' | 'achievements'
const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'sessions', label: 'Recent sessions' },
  { id: 'maps', label: 'Maps' },
  { id: 'servers', label: 'Servers' },
  { id: 'achievements', label: 'Achievements' },
]

const activeTab = ref<Tab>((route.query.tab as Tab) || 'overview')

// Sync the active tab into the URL via the native History API instead of
// router.replace — going through vue-router triggers scrollBehavior, which
// on the first navigation has `from` pointing at the initial entry and so
// the path-equality guard doesn't match. History.replaceState updates the
// URL without invoking the router pipeline.
watch(activeTab, (t) => {
  if (route.query.tab === t) return
  const url = new URL(window.location.href)
  if (t === 'overview') url.searchParams.delete('tab')
  else url.searchParams.set('tab', t)
  window.history.replaceState(window.history.state, '', url.toString())
})

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

watch(activeTab, (t) => {
  if (t === 'achievements' || t === 'overview') void loadAchievements()
}, { immediate: true })

onMounted(() => {
  void loadStats()
  void loadCommunities()
})

watch(rawName, () => {
  stats.value = null
  mapStats.value = []
  achievementGroups.value = []
  playerCommunities.value = []
  void loadStats()
  void loadCommunities()
  if (activeTab.value === 'achievements' || activeTab.value === 'overview') void loadAchievements()
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
  return new Date(firstSeen.value).toISOString().slice(0, 10)
})
const yearsActive = computed(() => {
  if (!firstSeen.value) return 0
  const ms = Date.now() - new Date(firstSeen.value).getTime()
  return ms / (1000 * 60 * 60 * 24 * 365.25)
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
    .sort((a, b) => new Date(b.latestAchievedAt).getTime() - new Date(a.latestAchievedAt).getTime())
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
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 60) return `${Math.round(diff)}s ago`
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  return `${Math.round(diff / 86400)}d ago`
}
const formatDate = (iso: string) => {
  if (!iso) return '—'
  return new Date(iso).toISOString().slice(0, 10)
}
const formatTier = (tier: string) => {
  if (!tier) return ''
  return tier.toUpperCase()
}
const friendlyAchievementName = (g: PlayerAchievementGroup) => {
  const t = formatTier(g.tier)
  return t ? `${g.achievementName} — ${t}` : g.achievementName
}

// servers + maps aggregations
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

// Activity rhythm — 24-hour bars
const activityHours = computed<number[]>(() => {
  const a = stats.value?.insights?.activityByHour ?? []
  if (a.length === 0) return []
  const buckets = Array(24).fill(0)
  for (const slot of a) {
    if (typeof slot.hour === 'number' && slot.hour >= 0 && slot.hour < 24) {
      buckets[slot.hour] += slot.minutesActive ?? 0
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

// Best kill map
const bestKillMap = computed(() => stats.value?.insights?.bestKillMap ?? null)

// Server rankings (top 4)
const allServerRankings = computed<ServerRanking[]>(() => {
  const r = stats.value?.insights?.serverRankings ?? []
  return [...r].sort((a, b) => a.rank - b.rank).slice(0, 4)
})

// Kill milestones — sort newest first
const killMilestones = computed<KillMilestone[]>(() => {
  const m = stats.value?.killMilestones ?? []
  return [...m].sort((a, b) =>
    new Date(b.achievedDate).getTime() - new Date(a.achievedDate).getTime()
  )
})

// Best scores — show top 3 for each window
const bestScores = computed(() => stats.value?.bestScores ?? null)
const hasAnyBestScores = computed(() => {
  const b = bestScores.value
  if (!b) return false
  return (b.thisWeek?.length ?? 0) > 0 || (b.last30Days?.length ?? 0) > 0 || (b.allTime?.length ?? 0) > 0
})
const formatScoreEntry = (e: BestScoreEntry) =>
  `${e.mapName} · ${truncate(e.serverName, 22)}`

const goCompare = () => {
  router.push({ path: '/v4/players/compare', query: { player1: rawName.value } })
}
const goSessions = () => {
  router.push(`/v4/players/${encodeURIComponent(rawName.value)}/sessions`)
}
const goAchievements = () => {
  router.push(`/v4/players/${encodeURIComponent(rawName.value)}/achievements`)
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
  <div class="mm-container mm-section">
    <!-- back link to players index -->
    <div class="mm-meta-row" style="margin-bottom: 10px">
      <router-link
        to="/v4/players"
        class="mm-meta-row__strong"
        style="text-decoration: underline; text-underline-offset: 3px"
      >‹ PLAYERS</router-link>
    </div>

    <!-- meta row -->
    <div class="mm-meta-row" style="margin-bottom: 18px">
      <span class="mm-chip" :class="{ 'mm-chip--off': !isOnline }">
        <span class="mm-chip__dot" />
        {{ isOnline ? 'Online' : 'Offline' }}
      </span>
      <span v-if="isOnline">in combat</span>
      <span class="mm-meta-row__sep">·</span>
      <span v-if="bestRank">
        Rank <span class="mm-meta-row__strong">#{{ bestRank.rank }}</span> of {{ formatNumber(bestRank.of) }}
      </span>
      <span v-else>Unranked</span>
      <span class="mm-meta-row__sep">·</span>
      <span>First seen <span class="mm-meta-row__strong">{{ firstSeenDate }}</span></span>
    </div>

    <!-- hero name + actions -->
    <div style="display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; flex-wrap: wrap">
      <div style="min-width: 0">
        <h1 class="mm-display">
          {{ displayName }}
          <span v-if="tierLabel" class="mm-display__muted">{{ tierLabel }}</span>
        </h1>
        <div class="mm-meta-row" style="margin-top: 12px; text-transform: none; letter-spacing: 0.02em; font-family: var(--mm-font-display); font-size: 13.5px; color: var(--mm-ink-soft)">
          <template v-if="currentServer">
            currently on
            <a
              class="mm-meta-row__strong"
              style="text-decoration: underline; text-underline-offset: 3px; cursor: pointer"
              @click="goServer(currentServer.serverName)"
            >{{ currentServer.serverName }}</a>
            <span v-if="currentServer.mapName" class="mm-meta-row__sep">·</span>
            <span v-if="currentServer.mapName">{{ currentServer.mapName }}</span>
          </template>
          <template v-else>
            last seen <span class="mm-meta-row__strong">{{ stats?.lastPlayed ? formatRelative(stats.lastPlayed) : '—' }}</span>
          </template>
        </div>
        <div style="margin-top: 14px">
          <MmPlayerAchievementHeroBadges :player-name="rawName" :total-count="achievementGroups.length" />
        </div>
      </div>

      <div class="mm-btn-row">
        <button class="mm-btn" type="button" @click="goCompare">Compare</button>
        <button class="mm-btn" type="button" @click="goAchievements">Achievements</button>
        <button class="mm-btn" type="button" @click="goNetwork">Network</button>
        <button class="mm-btn mm-btn--strong" type="button" @click="goSessions">Sessions →</button>
      </div>
    </div>

    <!-- stat strip -->
    <div class="mm-stats" style="margin-top: 28px">
      <div class="mm-stats__cell">
        <div class="mm-stats__label">Lifetime kills</div>
        <div class="mm-stat__value mm-num--kill">{{ formatNumber(totalKills) }}</div>
        <div class="mm-stat__delta">
          <span class="mm-num--death">{{ formatNumber(totalDeaths) }}</span> deaths
        </div>
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
        <div
          class="mm-stat__value"
          :class="streakClass(bestStreak?.latestValue)"
        >{{ bestStreak ? bestStreak.latestValue : '—' }}</div>
        <div class="mm-stat__delta">
          {{ bestStreak ? `${bestStreak.count}× recorded` : 'no streaks logged' }}
        </div>
      </div>
    </div>

    <!-- tabs -->
    <div class="mm-tabs" style="margin-top: 32px">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        class="mm-tab"
        :class="{ 'mm-tab--active': activeTab === t.id }"
        @click="activeTab = t.id"
      >{{ t.label }}</button>
    </div>

    <!-- loading / error overlay (shared) -->
    <div v-if="loading" style="padding: 40px 0">
      <div v-for="i in 5" :key="i" class="mm-skeleton" style="margin-bottom: 12px" />
    </div>

    <div v-else-if="error" class="mm-empty">{{ error }}</div>

    <!-- panels -->
    <section v-else class="mm-section--tight">
      <!-- ========== overview ========== -->
      <div v-if="activeTab === 'overview'" class="mm-overview">
        <!-- row 1: latest sessions + recent achievements -->
        <div class="mm-overview__row mm-overview__row--split">
          <div>
            <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 12px">Latest sessions</div>
            <MmPlayerRecentRoundsCompact :sessions="recentSessions" :player-name="rawName" />
          </div>

          <div>
            <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 12px">Recent achievements</div>
            <div v-if="achievementsLoading" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px">
              <div v-for="i in 4" :key="i" class="mm-skeleton mm-skeleton--lg" />
            </div>
            <div v-else-if="achievementsError" class="mm-empty" style="padding: 24px">{{ achievementsError }}</div>
            <div v-else-if="achievementsForGrid.length === 0" class="mm-empty" style="padding: 24px">No achievements yet.</div>
            <div v-else style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px 12px">
              <div
                v-for="g in achievementsForGrid.slice(0, 8)"
                :key="g.achievementId"
                style="text-align: center"
              >
                <img
                  :src="getAchievementImage(g.achievementId, g.tier)"
                  :alt="friendlyAchievementName(g)"
                  loading="lazy"
                  style="width: 56px; height: 56px; object-fit: contain; display: block; margin: 0 auto 8px"
                />
                <div class="mm-eyebrow mm-eyebrow--strong" style="font-size: 9px; line-height: 1.3">
                  {{ friendlyAchievementName(g) }}
                </div>
              </div>
            </div>
            <button
              v-if="achievementsForGrid.length > 8"
              type="button"
              class="mm-btn"
              style="margin-top: 16px"
              @click="activeTab = 'achievements'"
            >View all →</button>
          </div>
        </div>

        <!-- row 2: insight rail (activity, k/d trend, kill rate trend) -->
        <div class="mm-overview__row mm-overview__row--triple">
          <div class="mm-card">
            <div class="mm-eyebrow mm-eyebrow--strong">Activity rhythm</div>
            <div class="mm-card__hint">UTC hours · last 30d</div>
            <div v-if="activityHours.length > 0" style="margin-top: 12px">
              <MmBars :values="activityHours" :labels="['00', '06', '12', '18', '23']" :height="56" />
            </div>
            <div v-else class="mm-card__empty">No activity recorded.</div>
            <div v-if="peakHour" class="mm-card__foot">
              Peak around <span class="mm-meta-row__strong">{{ String(peakHour.hour).padStart(2, '0') }}:00 UTC</span>
              · {{ formatDuration(peakHour.minutes) }}
            </div>
          </div>

          <div class="mm-card">
            <div class="mm-eyebrow mm-eyebrow--strong">K/D trend</div>
            <div class="mm-card__hint">{{ stats?.recentStats?.granularity || 'rolling' }} · {{ kdTrend.length || 0 }} pts</div>
            <div v-if="kdTrend.length > 1" style="margin-top: 12px">
              <MmSparkline :values="kdTrend.map(p => p.value)" :height="56" :width="260" />
            </div>
            <div v-else class="mm-card__empty">Not enough rounds yet.</div>
            <div v-if="kdTrendDelta != null" class="mm-card__foot">
              <span :class="kdTrendDelta >= 0 ? 'mm-stat__delta--up' : 'mm-stat__delta--down'">
                {{ kdTrendDelta >= 0 ? '+' : '' }}{{ kdTrendDelta.toFixed(1) }}%
              </span>
              vs first sample · last {{ kdTrend[kdTrend.length - 1]?.value.toFixed(2) }}
            </div>
          </div>

          <div class="mm-card">
            <div class="mm-eyebrow mm-eyebrow--strong">Kill rate</div>
            <div class="mm-card__hint">kills / minute</div>
            <div v-if="killRateTrend.length > 1" style="margin-top: 12px">
              <MmSparkline :values="killRateTrend.map(p => p.value)" :height="56" :width="260" :accent="true" />
            </div>
            <div v-else class="mm-card__empty">Not enough rounds yet.</div>
            <div v-if="killRateTrendDelta != null" class="mm-card__foot">
              <span :class="killRateTrendDelta >= 0 ? 'mm-stat__delta--up' : 'mm-stat__delta--down'">
                {{ killRateTrendDelta >= 0 ? '+' : '' }}{{ killRateTrendDelta.toFixed(1) }}%
              </span>
              vs first sample · last {{ killRateTrend[killRateTrend.length - 1]?.value.toFixed(2) }}
            </div>
          </div>
        </div>

        <!-- row 3: favourite maps + server rankings -->
        <div class="mm-overview__row mm-overview__row--split">
          <div>
            <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 12px">
              Favourite maps
              <span v-if="bestKillMap" style="text-transform: none; letter-spacing: 0.02em; color: var(--mm-ink-soft); font-family: var(--mm-font-display); margin-left: 8px">
                — best on
                <span class="mm-meta-row__strong">{{ bestKillMap.mapName }}</span>
                ({{ bestKillMap.kdRatio.toFixed(2) }} K/D)
              </span>
            </div>
            <table class="mm-list mm-list--dense">
              <tbody>
                <tr
                  v-for="(m, i) in topMaps.slice(0, 6)"
                  :key="m.mapName"
                  :class="i < 3 ? `mm-rank--${['gold', 'silver', 'bronze'][i]}` : ''"
                  @click="openMapRankings(m.mapName); activeTab = 'maps'"
                >
                  <td class="mm-list__name-cell">
                    <div class="mm-list__name">
                      <span class="mm-list__name-primary">{{ m.mapName }}</span>
                      <span class="mm-list__name-sub">
                        {{ formatDuration(m.minutes) }} ·
                        <span class="mm-num--kill">{{ formatNumber(m.kills) }}</span> kills
                      </span>
                    </div>
                  </td>
                  <td class="is-num" data-cell-label="K/D" style="width: 100px">
                    <div style="display: flex; align-items: center; gap: 8px; justify-content: flex-end">
                      <span :class="kdClass(m.kd)">{{ m.kd.toFixed(2) }}</span>
                      <div class="mm-list__bar" style="width: 64px">
                        <div
                          class="mm-list__bar-fill"
                          :class="{ 'mm-list__bar-fill--accent': m.kd >= kd }"
                          :style="{ width: Math.min(100, (m.kd / Math.max(1, kd * 1.6)) * 100) + '%' }"
                        />
                      </div>
                    </div>
                  </td>
                </tr>
                <tr v-if="topMaps.length === 0">
                  <td colspan="2" class="mm-empty" style="border: 0">No map history yet.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div>
            <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 12px">Server rankings</div>
            <table class="mm-list mm-list--dense">
              <tbody>
                <tr
                  v-for="r in allServerRankings"
                  :key="r.serverGuid"
                  @click="goServer(r.serverName)"
                >
                  <td style="width: 72px; padding-right: 6px">
                    <span
                      class="mm-headline-rank"
                      :class="{ 'mm-headline-rank--podium': r.rank <= 3 }"
                    >
                      <span class="mm-headline-rank__hash">#</span>{{ r.rank }}
                    </span>
                  </td>
                  <td class="mm-list__name-cell">
                    <div class="mm-list__name">
                      <span class="mm-list__name-primary">{{ truncate(r.serverName, 30) }}</span>
                      <span class="mm-list__name-sub">of {{ formatNumber(r.totalRankedPlayers) }} players</span>
                    </div>
                  </td>
                  <td class="is-num" data-cell-label="Ping">{{ r.averagePing }}<span style="color: var(--mm-ink-faint)">ms</span></td>
                </tr>
                <tr v-if="allServerRankings.length === 0">
                  <td colspan="3" class="mm-empty" style="border: 0">No competitive rankings yet.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- row 4: kill milestones (if any) + best scores -->
        <div
          v-if="killMilestones.length > 0 || hasAnyBestScores"
          class="mm-overview__row"
          :class="killMilestones.length > 0 && hasAnyBestScores ? 'mm-overview__row--split' : ''"
        >
          <div v-if="killMilestones.length > 0">
            <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 12px">Kill milestones</div>
            <ul class="mm-timeline">
              <li v-for="ms in killMilestones.slice(0, 5)" :key="ms.milestone">
                <span class="mm-timeline__dot" />
                <div>
                  <div class="mm-timeline__primary">
                    {{ formatNumber(ms.milestone) }} kills
                  </div>
                  <div class="mm-timeline__sub">
                    {{ formatDate(ms.achievedDate) }} · {{ formatNumber(ms.daysToAchieve) }} days to reach
                  </div>
                </div>
              </li>
            </ul>
          </div>

          <div v-if="hasAnyBestScores">
            <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 14px">Best scores</div>
            <div class="mm-bestscores">
              <section
                v-for="(group, key) in {
                  'This week': bestScores?.thisWeek ?? [],
                  'Last 30 days': bestScores?.last30Days ?? [],
                  'All-time': bestScores?.allTime ?? [],
                }"
                :key="key"
                class="mm-bestscores__group"
                :class="{ 'mm-bestscores__group--accent': key === 'This week' && group.length > 0 }"
              >
                <header class="mm-bestscores__group-head">
                  <span class="mm-eyebrow mm-eyebrow--strong">{{ key }}</span>
                  <span v-if="group.length > 0" class="mm-bestscores__top-score">{{ formatNumber(group[0].score) }}</span>
                </header>
                <div v-if="group.length === 0" class="mm-bestscores__empty">— no scores</div>
                <ul v-else class="mm-bestscores__list">
                  <li
                    v-for="(s, i) in group.slice(0, 3)"
                    :key="i"
                    :class="['mm-rank--' + (['gold', 'silver', 'bronze'][i])]"
                  >
                    <span class="mm-bestscores__rank">{{ i + 1 }}</span>
                    <span class="mm-bestscores__score">{{ formatNumber(s.score) }}</span>
                    <span class="mm-bestscores__detail">{{ formatScoreEntry(s) }}</span>
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      </div>

      <!-- ========== sessions ========== -->
      <div v-else-if="activeTab === 'sessions'" style="margin-top: 8px">
        <table class="mm-list mm-list--dense">
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
              <td class="is-muted" data-cell-label="Server">{{ truncate(s.serverName) }}</td>
              <td class="is-muted" data-cell-label="When">{{ formatRelative(s.startTime) }}</td>
              <td class="is-num" data-cell-label="Duration">
                {{ formatDuration(((new Date(s.lastSeenTime).getTime() - new Date(s.startTime).getTime()) / 60000) || 0) }}
              </td>
              <td class="is-num" data-cell-label="K / D">
                <span class="mm-num--kill">{{ s.totalKills }}</span>
                <span class="mm-num__sep">/</span>
                <span class="mm-num--death">{{ s.totalDeaths }}</span>
              </td>
              <td class="is-num" data-cell-label="K/D ratio" :class="kdClass(s.totalDeaths === 0 ? s.totalKills : s.totalKills / s.totalDeaths)">
                {{ (s.totalDeaths === 0 ? s.totalKills : s.totalKills / s.totalDeaths).toFixed(2) }}
              </td>
              <td class="is-num" data-cell-label="Score">{{ formatNumber(s.totalScore) }}</td>
              <td class="is-num" data-cell-label="Result">
                <span
                  class="mm-chip"
                  :class="{
                    'mm-chip--win': s.teamResult === 'win',
                    'mm-chip--loss': s.teamResult === 'loss',
                    'mm-chip--off': s.teamResult === 'tie',
                  }"
                  style="text-transform: uppercase"
                >{{ s.teamResult === 'win' ? 'Win' : s.teamResult === 'loss' ? 'Loss' : s.teamResult === 'tie' ? 'Tie' : '—' }}</span>
              </td>
            </tr>
            <tr v-if="recentSessions.length === 0">
              <td colspan="8" class="mm-empty" style="border: 0">No sessions logged yet.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ========== maps ========== -->
      <div v-else-if="activeTab === 'maps'" style="margin-top: 8px">
        <table class="mm-list mm-list--dense">
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
              :class="i < 3 ? `mm-rank--${['gold', 'silver', 'bronze'][i]}` : ''"
              @click="openMapRankings(m.mapName)"
            >
              <td class="mm-list__rank">{{ String(i + 1).padStart(2, '0') }}</td>
              <td class="mm-list__name-cell">
                <div class="mm-list__name">
                  <span class="mm-list__name-primary">{{ m.mapName }}</span>
                </div>
              </td>
              <td class="is-num" data-cell-label="Time">{{ formatDuration(m.minutes) }}</td>
              <td class="is-num mm-num--kill" data-cell-label="Kills">{{ formatNumber(m.kills) }}</td>
              <td class="is-num mm-num--death" data-cell-label="Deaths">{{ formatNumber(m.deaths) }}</td>
              <td class="is-num" :class="kdClass(m.kd)" data-cell-label="K/D">{{ m.kd.toFixed(2) }}</td>
              <td data-cell-label="">
                <span class="mm-eyebrow">Rank →</span>
              </td>
            </tr>
            <tr v-if="topMaps.length === 0">
              <td colspan="7" class="mm-empty" style="border: 0">No map history yet.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ========== servers ========== -->
      <div v-else-if="activeTab === 'servers'" style="margin-top: 8px">
        <table class="mm-list mm-list--dense">
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
              :class="i < 3 ? `mm-rank--${['gold', 'silver', 'bronze'][i]}` : ''"
              @click="goServer(s.serverName)"
            >
              <td class="mm-list__rank">{{ String(i + 1).padStart(2, '0') }}</td>
              <td class="mm-list__name-cell">
                <div class="mm-list__name">
                  <span class="mm-list__name-primary">{{ s.serverName }}</span>
                  <span class="mm-list__name-sub">{{ s.gameId.toUpperCase() }}</span>
                </div>
              </td>
              <td class="is-num" data-cell-label="Time">{{ formatDuration(s.totalMinutes) }}</td>
              <td class="is-num" data-cell-label="Rounds">{{ formatNumber(s.totalRounds) }}</td>
              <td class="is-num mm-num--kill" data-cell-label="Kills">{{ formatNumber(s.totalKills) }}</td>
              <td class="is-num" :class="kdClass(s.kdRatio)" data-cell-label="K/D">{{ s.kdRatio.toFixed(2) }}</td>
            </tr>
            <tr v-if="topServers.length === 0">
              <td colspan="5" class="mm-empty" style="border: 0">No server history yet.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- ========== achievements ========== -->
      <div v-else-if="activeTab === 'achievements'" style="margin-top: 8px">
        <MmPlayerAchievementSummary
          :player-name="rawName"
          :achievement-groups="achievementGroups"
          :loading="achievementsLoading"
          :error="achievementsError"
        />
      </div>
    </section>

    <section class="mm-section--tight" style="margin-top: 8px">
      <MmPlayerServerMapStats
        :player-name="rawName"
        :game="primaryGameId"
        @open-rankings="openMapRankings($event); activeTab = 'maps'"
        @open-map-detail="openMapRankings($event); activeTab = 'maps'"
      />
    </section>

    <section class="mm-section--tight">
      <MmPlayerCompetitiveRankings
        :player-name="rawName"
        :game="primaryGameId"
        @navigate-to-map="openMapRankings($event); activeTab = 'maps'"
      />
    </section>

    <section class="mm-section--tight">
      <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 14px">Map performance over time</div>
      <MmMapPerformanceRace
        :player-name="rawName"
        :game="primaryGameId"
        @navigate-to-map="openMapRankings($event); activeTab = 'maps'"
      />
    </section>

    <section v-if="primaryServer" class="mm-section--tight">
      <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 14px">
        Proximity orbit — {{ primaryServer.serverName }}
      </div>
      <MmPingProximityOrbit
        seamless
        :server-guid="primaryServer.serverGuid"
        :server-name="primaryServer.serverName"
        @player-click="goPlayerFromOrbit"
      />
    </section>

    <section class="mm-section--tight" style="margin-top: 8px">
      <MmPlayerActivityHeatmap :player-name="rawName" :game="primaryGameId" />
    </section>

    <section class="mm-section--tight">
      <MmPlayerMapPreference
        :player-name="rawName"
        :game="primaryGameId"
        @navigate-to-map="openMapRankings($event); activeTab = 'maps'"
      />
    </section>

    <section v-if="playerCommunities.length > 0" class="mm-section--tight">
      <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 14px">Communities</div>
      <div class="mm-player-communities">
        <MmCommunityCard
          v-for="c in playerCommunities"
          :key="c.id"
          :community="c"
        />
      </div>
    </section>

    <MmPlayerSignatureBuilder
      v-if="signatureServers.length > 0"
      :player-name="rawName"
      :servers="signatureServers"
    />

    <MmPlayerComments :player-name="rawName" />
  </div>
</template>

<style scoped>
.mm-player-communities {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 18px;
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
</style>
