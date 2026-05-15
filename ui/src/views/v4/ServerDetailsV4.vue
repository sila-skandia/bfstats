<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  fetchServerDetails,
  fetchServerInsights,
  fetchServerLeaderboards,
  fetchLiveServerData,
  fetchServerBusyIndicators,
  fetchServerMapsInsights,
  type ServerDetails,
  type ServerInsights,
  type LeaderboardsData,
  type ServerHourlyTimelineEntry,
  type PopularMap,
} from '@/services/serverDetailsService'
import type { ServerSummary } from '@/types/server'
import { decodePlayerName } from '@/utils/playerName'
import { countryCodeToName } from '@/types/countryCodes'
import MmSparkline from '@/components/v4/MmSparkline.vue'
import MmBars from '@/components/v4/MmBars.vue'
import MmPlayersPanel from '@/components/v4/MmPlayersPanel.vue'
import MmServerComments from '@/components/v4/MmServerComments.vue'
import MmServerSignatureBuilder from '@/components/v4/MmServerSignatureBuilder.vue'
import MmForecastModal from '@/components/v4/MmForecastModal.vue'
import MmPingProximityOrbit from '@/components/v4/MmPingProximityOrbit.vue'
import MmServerMapDetailPanel from '@/components/v4/data-explorer/MmServerMapDetailPanel.vue'
import MmRankCell from '@/components/v4/MmRankCell.vue'
import { useDrillIn } from '@/composables/useDrillIn'
import { kdClass } from './mmTokens'

const route = useRoute()
const router = useRouter()

const serverName = computed(() => decodeURIComponent(route.params.serverName as string))

const details = ref<ServerDetails | null>(null)
const insights = ref<ServerInsights | null>(null)
const leaderboards = ref<LeaderboardsData | null>(null)
const liveServer = ref<ServerSummary | null>(null)
const hourlyTimeline = ref<ServerHourlyTimelineEntry[]>([])
const mapsList = ref<PopularMap[]>([])
const loading = ref(true)
const insightsLoading = ref(false)
const boardsLoading = ref(false)
const liveLoading = ref(false)
const error = ref<string | null>(null)

const showForecast = ref(false)
const selectedMap = ref<string | null>(null)
const mapDrillRef = ref<HTMLElement | null>(null)
const mapDrill = useDrillIn()

const openMapDrill = (mapName: string) => {
  selectedMap.value = mapName
  mapDrill.enter(mapDrillRef)
}
const closeMapDrill = () => {
  selectedMap.value = null
  mapDrill.exit()
}
// Allow opening the drill from anywhere on the page (e.g. the Overview
// "Most played maps" row) — switch to the Maps tab first so the drill
// target gets mounted, then enter the drill. useDrillIn's nextTick
// guarantees the scrollIntoView fires once the ref is bound.
const openMapAnywhere = (mapName: string) => {
  activeTab.value = 'maps'
  openMapDrill(mapName)
}

const goPlayerFromOrbit = (name: string) => {
  router.push(`/v4/players/${encodeURIComponent(name)}`)
}

type Tab = 'overview' | 'players' | 'maps'
const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'players', label: 'Ranks' },
  { id: 'maps', label: 'Maps' },
]
const activeTab = ref<Tab>((route.query.tab as Tab) || 'players')
// Sync the active tab into the URL via the native History API instead of
// router.replace — going through vue-router triggers scrollBehavior even for
// query-only changes (the path-equality guard misses the first-click edge
// where `from` is the route at mount). History.replaceState updates the URL
// without invoking the router pipeline at all.
const DEFAULT_TAB: Tab = 'players'
watch(activeTab, (t) => {
  if (route.query.tab === t) return
  const url = new URL(window.location.href)
  if (t === DEFAULT_TAB) url.searchParams.delete('tab')
  else url.searchParams.set('tab', t)
  window.history.replaceState(window.history.state, '', url.toString())
})

const load = async () => {
  loading.value = true
  error.value = null
  liveServer.value = null
  try {
    details.value = await fetchServerDetails(serverName.value)
  } catch (e) {
    error.value = 'Server feed temporarily unavailable.'
  } finally {
    loading.value = false
  }
  // fire-and-forget the optional feeds — the page is still useful without them
  insightsLoading.value = true
  boardsLoading.value = true
  liveLoading.value = true
  try {
    insights.value = await fetchServerInsights(serverName.value, 30, '7d')
  } catch { insights.value = null } finally { insightsLoading.value = false }
  try {
    leaderboards.value = await fetchServerLeaderboards(serverName.value, 'month')
  } catch { leaderboards.value = null } finally { boardsLoading.value = false }
  // Live roster — needs gameId + ip + port from the details payload
  try {
    if (details.value?.gameId && details.value.serverIp && details.value.serverPort) {
      liveServer.value = await fetchLiveServerData(
        details.value.gameId,
        details.value.serverIp,
        details.value.serverPort,
      )
    } else {
      liveServer.value = null
    }
  } catch {
    liveServer.value = null
  } finally {
    liveLoading.value = false
  }
  // Forecast / busy-indicator hourly timeline — best-effort
  try {
    if (details.value?.serverGuid) {
      const response = await fetchServerBusyIndicators([details.value.serverGuid])
      if (response.serverResults.length > 0) {
        hourlyTimeline.value = response.serverResults[0].hourlyTimeline
      }
    }
  } catch {
    hourlyTimeline.value = []
  }
  // Popular maps — own endpoint (the backend never set details.popularMaps)
  try {
    const maps = await fetchServerMapsInsights(serverName.value, 30)
    mapsList.value = maps.maps ?? []
  } catch {
    mapsList.value = []
  }
}

const liveNumPlayers = computed(() => liveServer.value?.numPlayers ?? 0)
const hasLiveRoster = computed(() => !!liveServer.value && liveNumPlayers.value > 0)

onMounted(load)
watch(serverName, load)

// `details.popularMaps` was always undefined — the backend ServerStatistics
// model has no such field. The real source is /servers/:name/maps-insights
// which queries the SQLite ServerMapStats table. See `mapsList` ref above.
const popularMaps = computed(() => mapsList.value)

const region = computed(() => {
  const code = details.value?.countryCode
  if (!code) return details.value?.country ?? '—'
  return countryCodeToName[code.toUpperCase()] ?? code.toUpperCase()
})

// Still used inside the Population history card footer in the Overview tab.
const peakPlayers = computed(() => insights.value?.playerCountSummary?.peakPlayerCount ?? null)
const avgPlayers = computed(() => insights.value?.playerCountSummary?.averagePlayerCount ?? null)

const playersList = computed(() => leaderboards.value?.mostActivePlayersByTime ?? [])
const topKDRatios = computed(() => leaderboards.value?.topKDRatios ?? [])
const topKillRates = computed(() => leaderboards.value?.topKillRates ?? [])
const topPlacements = computed(() => leaderboards.value?.topPlacements ?? [])

// Per-column maxes for the Ranks tab — drive the in-cell magnitude bars.
const activeMax = computed(() => {
  const list = playersList.value
  if (list.length === 0) return { minutes: 1, kills: 1, deaths: 1, kd: 1 }
  return {
    minutes: Math.max(1, ...list.map(p => p.minutesPlayed)),
    kills: Math.max(1, ...list.map(p => p.totalKills)),
    deaths: Math.max(1, ...list.map(p => p.totalDeaths)),
    kd: Math.max(1, ...list.map(p => p.kdRatio)),
  }
})
// `TopKDRatio` and `TopKillRate` DTOs carry PlayerName/Kills/Deaths/KDRatio/TotalRounds —
// no MapName, Timestamp, or Score (the TS interface aliases them as TopScore but the
// JSON payload doesn't include those fields). Don't reference fields that aren't on the DTO.
const kdValue = (s: { kdRatio?: number; deaths: number; kills: number }) =>
  s.kdRatio ?? (s.deaths === 0 ? s.kills : s.kills / s.deaths)

const kdViewMax = computed(() => {
  const list = topKDRatios.value
  if (list.length === 0) return { kills: 1, deaths: 1, kd: 1, totalRounds: 1 }
  return {
    kills: Math.max(1, ...list.map(s => s.kills)),
    deaths: Math.max(1, ...list.map(s => s.deaths)),
    kd: Math.max(1, ...list.map(s => kdValue(s))),
    totalRounds: Math.max(1, ...list.map(s => (s as any).totalRounds ?? 0)),
  }
})
const killRateMax = computed(() => {
  const list = topKillRates.value
  if (list.length === 0) return { kills: 1, deaths: 1, killRate: 1, totalRounds: 1 }
  return {
    kills: Math.max(1, ...list.map(s => s.kills)),
    deaths: Math.max(1, ...list.map(s => s.deaths)),
    killRate: Math.max(1, ...list.map(s => s.killRate ?? 0)),
    totalRounds: Math.max(1, ...list.map(s => (s as any).totalRounds ?? 0)),
  }
})
const placementMax = computed(() => {
  const list = topPlacements.value
  if (list.length === 0) return { firstPlaces: 1, secondPlaces: 1, thirdPlaces: 1, totalPlacements: 1, placementPoints: 1 }
  return {
    firstPlaces: Math.max(1, ...list.map(p => p.firstPlaces)),
    secondPlaces: Math.max(1, ...list.map(p => p.secondPlaces)),
    thirdPlaces: Math.max(1, ...list.map(p => p.thirdPlaces)),
    totalPlacements: Math.max(1, ...list.map(p => p.totalPlacements)),
    placementPoints: Math.max(1, ...list.map(p => p.placementPoints)),
  }
})

// K/D tier → cell background class
const kdTierBg = (kd: number): string => {
  if (kd < 1) return 'mm-rank__kd-bg--poor'
  if (kd >= 2) return 'mm-rank__kd-bg--good'
  return ''
}

// players-tab sub-view selector
type PlayersView = 'active' | 'kd' | 'killrate' | 'placement'
const playersView = ref<PlayersView>('active')
const playersViewOptions: { id: PlayersView; label: string }[] = [
  { id: 'active', label: 'Most active' },
  { id: 'kd', label: 'Top K/D' },
  { id: 'killrate', label: 'Top kill rate' },
  { id: 'placement', label: 'Top placements' },
]

// Player count history sparkline (downsampled)
const playerCountSeries = computed<number[]>(() => {
  const h = insights.value?.playerCountHistory ?? []
  if (h.length === 0) return []
  // downsample to ~80 points so the sparkline reads cleanly
  const target = 80
  if (h.length <= target) return h.map(p => p.playerCount)
  const step = h.length / target
  const out: number[] = []
  for (let i = 0; i < target; i++) {
    out.push(h[Math.floor(i * step)].playerCount)
  }
  return out
})

// Ping-by-hour bar series (24 bins)
const pingByHourBars = computed<number[]>(() => {
  const data = insights.value?.pingByHour?.data ?? []
  if (data.length === 0) return []
  const buckets = Array(24).fill(0)
  const counts = Array(24).fill(0)
  for (const d of data) {
    if (typeof d.hour === 'number' && d.hour >= 0 && d.hour < 24) {
      buckets[d.hour] += d.medianPing ?? d.averagePing ?? 0
      counts[d.hour] += 1
    }
  }
  return buckets.map((sum, i) => (counts[i] === 0 ? 0 : sum / counts[i]))
})
const avgPing = computed(() => {
  const v = pingByHourBars.value.filter(x => x > 0)
  if (v.length === 0) return null
  return v.reduce((s, n) => s + n, 0) / v.length
})

// Activity rhythm — bucket player-count history by UTC hour
const activityByHour = computed<number[]>(() => {
  const h = insights.value?.playerCountHistory ?? []
  if (h.length === 0) return []
  const buckets = Array(24).fill(0)
  const counts = Array(24).fill(0)
  for (const p of h) {
    const hour = new Date(p.timestamp).getUTCHours()
    buckets[hour] += p.playerCount
    counts[hour] += 1
  }
  return buckets.map((sum, i) => (counts[i] === 0 ? 0 : sum / counts[i]))
})
const peakHour = computed(() => {
  const v = activityByHour.value
  if (v.length === 0) return null
  const max = Math.max(...v)
  if (max === 0) return null
  return { hour: v.indexOf(max), avgPlayers: max }
})

// Trend sense from playersOnlineHistory.insights
const onlineInsights = computed(() => insights.value?.playersOnlineHistory?.insights ?? null)

const formatNumber = (n: number) => Math.round(n).toLocaleString()
const formatHours = (mins: number) => {
  if (!mins) return '0h'
  const h = mins / 60
  return h >= 10 ? `${Math.round(h)}h` : `${h.toFixed(1)}h`
}
const formatPercent = (v: number) => `${v.toFixed(1)}%`

const goPlayer = (name: string) => {
  router.push(`/v4/players/${encodeURIComponent(name)}`)
}

const $pn = decodePlayerName
</script>

<template>
  <div class="mm-container mm-section">
    <div v-if="loading" style="padding: 40px 0">
      <div v-for="i in 5" :key="i" class="mm-skeleton" style="margin-bottom: 12px" />
    </div>

    <div v-else-if="error" class="mm-empty">{{ error }}</div>

    <template v-else-if="details">
      <!-- back link to servers index -->
      <div class="mm-meta-row" style="margin-bottom: 10px">
        <router-link
          to="/v4/servers/bf1942"
          class="mm-meta-row__strong"
          style="text-decoration: underline; text-underline-offset: 3px"
        >‹ SERVERS</router-link>
      </div>

      <!-- slim header: name + a compact meta row including the forecast trigger -->
      <header class="mm-server__head">
        <h1 class="mm-display mm-server__name">{{ details.serverName }}</h1>
        <div class="mm-meta-row mm-server__meta">
          <span class="mm-chip">
            <span class="mm-chip__dot" />
            Tracking
          </span>
          <span class="mm-meta-row__sep">·</span>
          <span>{{ region }}</span>
          <span v-if="details.gameId" class="mm-meta-row__sep">·</span>
          <span v-if="details.gameId" class="mm-meta-row__strong">{{ details.gameId.toUpperCase() }}</span>
          <span v-if="details.serverIp" class="mm-meta-row__sep">·</span>
          <span v-if="details.serverIp" class="mm-meta-row__strong">{{ details.serverIp }}:{{ details.serverPort }}</span>
          <button
            v-if="hourlyTimeline.length > 0"
            type="button"
            class="mm-btn mm-btn--inline mm-server__forecast"
            @click="showForecast = true"
          >Forecast →</button>
          <router-link
            v-if="details.serverGuid"
            :to="`/v4/map-popularity/${encodeURIComponent(details.serverGuid)}`"
            class="mm-btn mm-btn--inline mm-server__forecast"
          >Map popularity →</router-link>
          <router-link
            v-if="details.serverName"
            :to="`/v4/servers/${encodeURIComponent(details.serverName)}/sessions`"
            class="mm-btn mm-btn--inline mm-server__forecast"
          >Rounds →</router-link>
        </div>
      </header>

      <!-- live roster — the page now leads with this -->
      <section v-if="liveLoading || hasLiveRoster || liveServer" class="mm-section--tight">
        <div class="mm-section-bar">
          <span>Online now</span>
          <span v-if="hasLiveRoster" class="mm-section-bar__meta">
            {{ liveNumPlayers }} engaged<template v-if="liveServer?.mapName"> · {{ liveServer.mapName }}</template>
          </span>
          <span v-else-if="liveLoading" class="mm-section-bar__meta">Checking…</span>
          <span v-else class="mm-section-bar__meta">Server quiet</span>
        </div>
        <div v-if="hasLiveRoster" style="margin-top: 12px">
          <MmPlayersPanel
            :show="true"
            :server="liveServer"
            :inline="true"
            :embedded="true"
          />
        </div>
        <div v-else-if="liveLoading" style="margin-top: 12px">
          <div class="mm-skeleton" style="margin-bottom: 8px" />
          <div class="mm-skeleton" />
        </div>
      </section>

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

      <section class="mm-section--tight">
        <!-- ============ overview ============ -->
        <div v-if="activeTab === 'overview'" class="mm-overview">
          <!-- row 1: most played maps (top scoring rounds removed — corrupted upstream data) -->
          <div class="mm-overview__row">
            <div>
              <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 12px">Most played maps</div>
              <table class="mm-list mm-list--dense">
                <tbody>
                  <tr
                    v-for="m in popularMaps.slice(0, 8)"
                    :key="m.mapName"
                    @click="openMapAnywhere(m.mapName)"
                  >
                    <td class="mm-list__name-cell">
                      <div class="mm-list__name">
                        <span class="mm-list__name-primary">{{ m.mapName }}</span>
                        <span class="mm-list__name-sub">avg {{ m.averagePlayerCount.toFixed(1) }} players</span>
                      </div>
                    </td>
                    <td class="is-num" data-cell-label="Share">{{ formatPercent(m.playTimePercentage) }}</td>
                  </tr>
                  <tr v-if="popularMaps.length === 0">
                    <td colspan="2" class="mm-empty" style="border: 0">No map history.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- row 2: sparkline + activity rhythm + ping -->
          <div class="mm-overview__row mm-overview__row--triple">
            <div class="mm-card">
              <div class="mm-eyebrow mm-eyebrow--strong">Population history</div>
              <div class="mm-card__hint">last 30 days</div>
              <div v-if="playerCountSeries.length > 1" style="margin-top: 12px">
                <MmSparkline :values="playerCountSeries" :height="56" :width="320" />
              </div>
              <div v-else class="mm-card__empty">No history yet.</div>
              <div v-if="onlineInsights" class="mm-card__foot">
                <span :class="onlineInsights.percentageChange >= 0 ? 'mm-stat__delta--up' : 'mm-stat__delta--down'">
                  {{ onlineInsights.percentageChange >= 0 ? '+' : '' }}{{ onlineInsights.percentageChange.toFixed(1) }}%
                </span>
                {{ onlineInsights.trendDirection }} · peak {{ onlineInsights.peakPlayers }} players
              </div>
              <div v-else-if="peakPlayers != null" class="mm-card__foot">
                Peak {{ peakPlayers }} · avg {{ avgPlayers != null ? avgPlayers.toFixed(1) : '—' }}
              </div>
            </div>

            <div class="mm-card">
              <div class="mm-eyebrow mm-eyebrow--strong">Activity rhythm</div>
              <div class="mm-card__hint">avg players · UTC hour</div>
              <div v-if="activityByHour.length > 0" style="margin-top: 12px">
                <MmBars :values="activityByHour" :labels="['00', '06', '12', '18', '23']" :height="56" />
              </div>
              <div v-else class="mm-card__empty">No activity rhythm yet.</div>
              <div v-if="peakHour" class="mm-card__foot">
                Busiest at <span class="mm-meta-row__strong">{{ String(peakHour.hour).padStart(2, '0') }}:00 UTC</span>
                · {{ peakHour.avgPlayers.toFixed(1) }} avg
              </div>
            </div>

            <div class="mm-card">
              <div class="mm-eyebrow mm-eyebrow--strong">Ping rhythm</div>
              <div class="mm-card__hint">median ms · UTC hour</div>
              <div v-if="pingByHourBars.length > 0 && pingByHourBars.some(v => v > 0)" style="margin-top: 12px">
                <MmBars :values="pingByHourBars" :labels="['00', '06', '12', '18', '23']" :height="56" :accent="true" />
              </div>
              <div v-else class="mm-card__empty">No ping samples.</div>
              <div v-if="avgPing != null" class="mm-card__foot">
                Avg <span class="mm-meta-row__strong">{{ Math.round(avgPing) }}ms</span> across the day
              </div>
            </div>
          </div>

          <!-- row 3: most active + top placements -->
          <div class="mm-overview__row mm-overview__row--split">
            <div>
              <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 12px">Most active players · 30d</div>
              <table class="mm-list mm-list--dense">
                <tbody>
                  <tr v-for="(p, i) in playersList.slice(0, 6)" :key="p.playerName" @click="goPlayer(p.playerName)">
                    <td class="mm-list__rank is-muted">{{ String(i + 1).padStart(2, '0') }}</td>
                    <td class="mm-list__name-cell">
                      <div class="mm-list__name">
                        <span class="mm-list__name-primary">{{ $pn(p.playerName) }}</span>
                        <span class="mm-list__name-sub">
                          <span class="mm-num--kill">{{ formatNumber(p.totalKills) }} k</span>
                          ·
                          <span :class="kdClass(p.kdRatio)">{{ p.kdRatio.toFixed(2) }} K/D</span>
                        </span>
                      </div>
                    </td>
                    <td class="is-num" data-cell-label="Hours">{{ formatHours(p.minutesPlayed) }}</td>
                  </tr>
                  <tr v-if="playersList.length === 0">
                    <td colspan="3" class="mm-empty" style="border: 0">{{ boardsLoading ? 'Loading…' : 'No active players yet.' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 12px">Top podium finishers</div>
              <table class="mm-list mm-list--dense">
                <tbody>
                  <tr v-for="(p, i) in topPlacements.slice(0, 6)" :key="p.playerName" @click="goPlayer(p.playerName)">
                    <td class="mm-list__rank is-muted">{{ String(i + 1).padStart(2, '0') }}</td>
                    <td class="mm-list__name-cell">
                      <div class="mm-list__name">
                        <span class="mm-list__name-primary">{{ $pn(p.playerName) }}</span>
                        <span class="mm-list__name-sub">
                          {{ p.firstPlaces }}× 1st · {{ p.secondPlaces }}× 2nd · {{ p.thirdPlaces }}× 3rd
                        </span>
                      </div>
                    </td>
                    <td class="is-num" data-cell-label="Points">{{ formatNumber(p.placementPoints) }}</td>
                  </tr>
                  <tr v-if="topPlacements.length === 0">
                    <td colspan="3" class="mm-empty" style="border: 0">{{ boardsLoading ? 'Loading…' : 'No placements yet.' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- ============ players ============ -->
        <div v-else-if="activeTab === 'players'" style="margin-top: 8px">
          <div class="mm-subtabs">
            <button
              v-for="opt in playersViewOptions"
              :key="opt.id"
              type="button"
              class="mm-subtab"
              :class="{ 'mm-subtab--active': playersView === opt.id }"
              @click="playersView = opt.id"
            >{{ opt.label }}</button>
          </div>

          <!-- Most active -->
          <table v-if="playersView === 'active'" class="mm-list mm-list--dense mm-rank" style="margin-top: 12px">
            <thead>
              <tr>
                <th style="width: 40px"></th>
                <th>Player</th>
                <th class="is-num">Hours played</th>
                <th class="is-num">Kills</th>
                <th class="is-num">Deaths</th>
                <th class="is-num">K/D</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(p, i) in playersList"
                :key="p.playerName"
                :class="{ 'mm-rank__row--top3': i < 3 }"
                @click="goPlayer(p.playerName)"
              >
                <td class="mm-list__rank is-muted">{{ String(i + 1).padStart(2, '0') }}</td>
                <td class="mm-list__name-cell">
                  <div class="mm-list__name">
                    <span class="mm-list__name-primary">{{ $pn(p.playerName) }}</span>
                  </div>
                </td>
                <td class="is-num" data-cell-label="Hours">
                  <MmRankCell :value="p.minutesPlayed" :max="activeMax.minutes" tone="neutral">{{ formatHours(p.minutesPlayed) }}</MmRankCell>
                </td>
                <td class="is-num mm-list__col--hide-sm" data-cell-label="Kills">
                  <MmRankCell :value="p.totalKills" :max="activeMax.kills" tone="kill"><span class="mm-num--kill">{{ formatNumber(p.totalKills) }}</span></MmRankCell>
                </td>
                <td class="is-num mm-list__col--hide-sm" data-cell-label="Deaths">
                  <MmRankCell :value="p.totalDeaths" :max="activeMax.deaths" tone="death"><span class="mm-num--death">{{ formatNumber(p.totalDeaths) }}</span></MmRankCell>
                </td>
                <td class="is-num" :class="kdTierBg(p.kdRatio)" data-cell-label="K/D">
                  <MmRankCell :value="p.kdRatio" :max="activeMax.kd" tone="kd"><span :class="kdClass(p.kdRatio)">{{ p.kdRatio.toFixed(2) }}</span></MmRankCell>
                </td>
              </tr>
              <tr v-if="playersList.length === 0">
                <td colspan="6" class="mm-empty" style="border: 0">{{ boardsLoading ? 'Loading…' : 'No player history yet.' }}</td>
              </tr>
            </tbody>
          </table>

          <!-- Top K/D — aggregate over the period, not per-round; no mapName/timestamp/score on the DTO. -->
          <table v-else-if="playersView === 'kd'" class="mm-list mm-list--dense mm-rank" style="margin-top: 12px">
            <thead>
              <tr>
                <th style="width: 40px"></th>
                <th>Player</th>
                <th class="is-num">Kills</th>
                <th class="is-num">Deaths</th>
                <th class="is-num">K/D</th>
                <th class="is-num">Rounds</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(s, i) in topKDRatios"
                :key="i"
                :class="{ 'mm-rank__row--top3': i < 3 }"
                @click="goPlayer(s.playerName)"
              >
                <td class="mm-list__rank is-muted">{{ String(i + 1).padStart(2, '0') }}</td>
                <td class="mm-list__name-cell">
                  <div class="mm-list__name">
                    <span class="mm-list__name-primary">{{ $pn(s.playerName) }}</span>
                  </div>
                </td>
                <td class="is-num mm-list__col--hide-sm" data-cell-label="Kills">
                  <MmRankCell :value="s.kills" :max="kdViewMax.kills" tone="kill"><span class="mm-num--kill">{{ s.kills }}</span></MmRankCell>
                </td>
                <td class="is-num mm-list__col--hide-sm" data-cell-label="Deaths">
                  <MmRankCell :value="s.deaths" :max="kdViewMax.deaths" tone="death"><span class="mm-num--death">{{ s.deaths }}</span></MmRankCell>
                </td>
                <td
                  class="is-num"
                  data-cell-label="K/D"
                  :class="kdTierBg(kdValue(s))"
                >
                  <MmRankCell :value="kdValue(s)" :max="kdViewMax.kd" tone="kd">
                    <span :class="kdClass(kdValue(s))">{{ kdValue(s).toFixed(2) }}</span>
                  </MmRankCell>
                </td>
                <td class="is-num is-muted" data-cell-label="Rounds">
                  <MmRankCell :value="(s as any).totalRounds ?? 0" :max="kdViewMax.totalRounds" tone="neutral">{{ (s as any).totalRounds ?? '—' }}</MmRankCell>
                </td>
              </tr>
              <tr v-if="topKDRatios.length === 0">
                <td colspan="6" class="mm-empty" style="border: 0">{{ boardsLoading ? 'Loading…' : 'No K/D leaderboard yet.' }}</td>
              </tr>
            </tbody>
          </table>

          <!-- Top kill rate — aggregate, no mapName/timestamp. -->
          <table v-else-if="playersView === 'killrate'" class="mm-list mm-list--dense mm-rank" style="margin-top: 12px">
            <thead>
              <tr>
                <th style="width: 40px"></th>
                <th>Player</th>
                <th class="is-num">Kills</th>
                <th class="is-num">Deaths</th>
                <th class="is-num">Kills / min</th>
                <th class="is-num">Rounds</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(s, i) in topKillRates"
                :key="i"
                :class="{ 'mm-rank__row--top3': i < 3 }"
                @click="goPlayer(s.playerName)"
              >
                <td class="mm-list__rank is-muted">{{ String(i + 1).padStart(2, '0') }}</td>
                <td class="mm-list__name-cell">
                  <div class="mm-list__name">
                    <span class="mm-list__name-primary">{{ $pn(s.playerName) }}</span>
                  </div>
                </td>
                <td class="is-num mm-list__col--hide-sm" data-cell-label="Kills">
                  <MmRankCell :value="s.kills" :max="killRateMax.kills" tone="kill"><span class="mm-num--kill">{{ s.kills }}</span></MmRankCell>
                </td>
                <td class="is-num mm-list__col--hide-sm" data-cell-label="Deaths">
                  <MmRankCell :value="s.deaths" :max="killRateMax.deaths" tone="death"><span class="mm-num--death">{{ s.deaths }}</span></MmRankCell>
                </td>
                <td class="is-num" data-cell-label="Kills / min">
                  <MmRankCell :value="s.killRate ?? 0" :max="killRateMax.killRate" tone="kill"><span class="mm-num--kill">{{ (s.killRate ?? 0).toFixed(2) }}</span></MmRankCell>
                </td>
                <td class="is-num is-muted" data-cell-label="Rounds">
                  <MmRankCell :value="(s as any).totalRounds ?? 0" :max="killRateMax.totalRounds" tone="neutral">{{ (s as any).totalRounds ?? '—' }}</MmRankCell>
                </td>
              </tr>
              <tr v-if="topKillRates.length === 0">
                <td colspan="6" class="mm-empty" style="border: 0">{{ boardsLoading ? 'Loading…' : 'No kill-rate leaderboard yet.' }}</td>
              </tr>
            </tbody>
          </table>

          <!-- Top placements -->
          <table v-else-if="playersView === 'placement'" class="mm-list mm-list--dense mm-rank" style="margin-top: 12px">
            <thead>
              <tr>
                <th style="width: 40px"></th>
                <th>Player</th>
                <th class="is-num">1st</th>
                <th class="is-num">2nd</th>
                <th class="is-num">3rd</th>
                <th class="is-num">Total</th>
                <th class="is-num">Points</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(p, i) in topPlacements"
                :key="p.playerName"
                :class="{ 'mm-rank__row--top3': i < 3 }"
                @click="goPlayer(p.playerName)"
              >
                <td class="mm-list__rank is-muted">{{ String(i + 1).padStart(2, '0') }}</td>
                <td class="mm-list__name-cell">
                  <div class="mm-list__name">
                    <span class="mm-list__name-primary">{{ $pn(p.playerName) }}</span>
                  </div>
                </td>
                <td class="is-num" data-cell-label="1st">
                  <MmRankCell :value="p.firstPlaces" :max="placementMax.firstPlaces" tone="kd">{{ p.firstPlaces }}</MmRankCell>
                </td>
                <td class="is-num mm-list__col--hide-sm" data-cell-label="2nd">
                  <MmRankCell :value="p.secondPlaces" :max="placementMax.secondPlaces" tone="neutral">{{ p.secondPlaces }}</MmRankCell>
                </td>
                <td class="is-num mm-list__col--hide-sm" data-cell-label="3rd">
                  <MmRankCell :value="p.thirdPlaces" :max="placementMax.thirdPlaces" tone="neutral">{{ p.thirdPlaces }}</MmRankCell>
                </td>
                <td class="is-num mm-list__col--hide-sm" data-cell-label="Total">
                  <MmRankCell :value="p.totalPlacements" :max="placementMax.totalPlacements" tone="neutral">{{ p.totalPlacements }}</MmRankCell>
                </td>
                <td class="is-num" data-cell-label="Points">
                  <MmRankCell :value="p.placementPoints" :max="placementMax.placementPoints" tone="kd">{{ formatNumber(p.placementPoints) }}</MmRankCell>
                </td>
              </tr>
              <tr v-if="topPlacements.length === 0">
                <td colspan="7" class="mm-empty" style="border: 0">{{ boardsLoading ? 'Loading…' : 'No placement leaderboard yet.' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- ============ maps ============ -->
        <div v-else-if="activeTab === 'maps'" style="margin-top: 8px">
          <template v-if="!selectedMap">
            <table class="mm-list mm-list--dense">
              <thead>
                <tr>
                  <th style="width: 40px"></th>
                  <th>Map</th>
                  <th class="is-num">Avg players</th>
                  <th class="is-num">Peak</th>
                  <th class="is-num">Time played</th>
                  <th class="is-num">Share</th>
                  <th style="width: 70px"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(m, i) in popularMaps" :key="m.mapName" @click="openMapDrill(m.mapName)">
                  <td class="mm-list__rank is-muted">{{ String(i + 1).padStart(2, '0') }}</td>
                  <td class="mm-list__name-cell">
                    <div class="mm-list__name">
                      <span class="mm-list__name-primary">{{ m.mapName }}</span>
                    </div>
                  </td>
                  <td class="is-num" data-cell-label="Avg players">{{ m.averagePlayerCount.toFixed(1) }}</td>
                  <td class="is-num mm-list__col--hide-sm" data-cell-label="Peak">{{ m.peakPlayerCount }}</td>
                  <td class="is-num mm-list__col--hide-sm" data-cell-label="Time played">{{ formatHours(m.totalPlayTime) }}</td>
                  <td class="is-num" data-cell-label="Share">
                    <div style="display: flex; align-items: center; gap: 8px; justify-content: flex-end">
                      <span>{{ formatPercent(m.playTimePercentage) }}</span>
                      <div class="mm-list__bar mm-list__col--hide-sm" style="width: 80px">
                        <div
                          class="mm-list__bar-fill"
                          :class="{ 'mm-list__bar-fill--accent': m.playTimePercentage >= 20 }"
                          :style="{ width: Math.min(100, m.playTimePercentage * 2) + '%' }"
                        />
                      </div>
                    </div>
                  </td>
                  <td data-cell-label="" class="mm-list__col--hide-sm"><span class="mm-eyebrow">Drill →</span></td>
                </tr>
                <tr v-if="popularMaps.length === 0">
                  <td colspan="7" class="mm-empty" style="border: 0">No map history yet.</td>
                </tr>
              </tbody>
            </table>
          </template>

          <div v-else ref="mapDrillRef" style="scroll-margin-top: 16px">
            <button type="button" class="mm-btn mm-btn--inline" style="margin-bottom: 16px" @click="closeMapDrill">← Back to maps</button>
            <MmServerMapDetailPanel
              v-if="details"
              :server-guid="details.serverGuid"
              :map-name="selectedMap"
              @close="closeMapDrill"
            />
          </div>
        </div>

      </section>

      <section class="mm-section--tight" style="margin-top: 8px">
        <div class="mm-eyebrow mm-eyebrow--strong" style="margin-bottom: 14px">
          Player proximity
        </div>
        <MmPingProximityOrbit
          seamless
          :server-guid="details.serverGuid"
          :server-name="details.serverName"
          @player-click="goPlayerFromOrbit"
        />
      </section>

      <MmServerSignatureBuilder :server-name="details.serverName" />

      <MmServerComments :server-name="details.serverName" />
    </template>

    <MmForecastModal
      v-model="showForecast"
      :hourly-timeline="hourlyTimeline"
      :current-status="liveServer?.numPlayers != null ? `${liveServer.numPlayers} engaged` : ''"
      :current-players="liveServer?.numPlayers"
    />
  </div>
</template>

<style scoped>
.mm-server__head {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 8px;
}

.mm-server__name {
  margin: 0;
  font-size: clamp(28px, 3.6vw, 44px);
}

.mm-server__meta {
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.mm-server__forecast {
  margin-left: auto;
}

.mm-roster-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--mm-rule);
}

/* Ranks tab — leaderboard styling. Top-3 rows get an amber left rail, and
   the K/D cell picks up a tier-tinted background (poor → kill-soft pink,
   good → highlight butter-yellow). Numeric cells render with MmRankCell
   for the inline magnitude bar. */
.mm-rank :deep(tbody tr.mm-rank__row--top3 td:first-child) {
  box-shadow: inset 3px 0 0 var(--mm-accent);
}

.mm-rank :deep(td.mm-rank__kd-bg--good) {
  background: rgba(125, 136, 73, 0.18);
}

.mm-rank :deep(td.mm-rank__kd-bg--poor) {
  background: rgba(214, 90, 90, 0.22);
}

.mm-rank :deep(tbody tr:hover td.mm-rank__kd-bg--good) {
  background: rgba(125, 136, 73, 0.32);
}

.mm-rank :deep(tbody tr:hover td.mm-rank__kd-bg--poor) {
  background: rgba(214, 90, 90, 0.34);
}
</style>
