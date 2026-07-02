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

const goPlayerFromOrbit = (name: string) => {
  router.push(`/v4/players/${encodeURIComponent(name)}`)
}

// --- tabs ---
type Tab = 'overview' | 'players' | 'maps'
const tabs: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'players', label: 'Ranks' },
  { id: 'maps', label: 'Maps' },
]
const DEFAULT_TAB: Tab = 'overview'
const activeTab = ref<Tab>((route.query.tab as Tab) || DEFAULT_TAB)
// Sync the active tab into the URL via the native History API instead of
// router.replace — going through vue-router triggers scrollBehavior even for
// query-only changes. History.replaceState updates the URL without invoking
// the router pipeline at all.
watch(activeTab, (t) => {
  if (route.query.tab === t) return
  const url = new URL(window.location.href)
  if (t === DEFAULT_TAB) url.searchParams.delete('tab')
  else url.searchParams.set('tab', t)
  window.history.replaceState(window.history.state, '', url.toString())
})

// --- map drill-in (Maps tab) ---
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
// From the Overview map-popularity rail: jump to the Maps tab, then drill.
const openMapAnywhere = (mapName: string) => {
  activeTab.value = 'maps'
  openMapDrill(mapName)
}

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

// --- KPI-strip derived values (wide dashboard header) ---
const liveMap = computed(() => liveServer.value?.mapName || null)
const liveMode = computed(() => liveServer.value?.gameType || '')
const maxPlayers = computed(() => liveServer.value?.maxPlayers ?? null)
const capacityPct = computed(() => {
  const max = liveServer.value?.maxPlayers
  if (!max) return null
  return Math.round((liveNumPlayers.value / max) * 100)
})
// Capacity load tier drives the value colour (idle → busy → full).
const loadClass = computed(() => {
  const pct = capacityPct.value
  if (pct == null || pct <= 0) return 'mm-num--load-idle'
  if (pct >= 95) return 'mm-num--load-full'
  if (pct >= 60) return 'mm-num--load-busy'
  return 'mm-num--score'
})
// Live ticket lead — prefer the labelled teams array, fall back to tickets1/2.
const teamTickets = computed<{ label: string; tickets: number }[]>(() => {
  const teams = liveServer.value?.teams ?? []
  if (teams.length >= 2) return teams.slice(0, 2).map(t => ({ label: t.label, tickets: t.tickets }))
  const t1 = liveServer.value?.tickets1
  const t2 = liveServer.value?.tickets2
  if (t1 != null && t2 != null && (t1 > 0 || t2 > 0)) {
    return [{ label: 'Team 1', tickets: t1 }, { label: 'Team 2', tickets: t2 }]
  }
  return []
})
// Regional-indicator flag emoji from the ISO country code.
const countryFlag = computed(() => {
  const cc = details.value?.countryCode
  if (!cc || cc.length !== 2) return ''
  return String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
})

// Map-popularity rail rows (right column). Track width scaled to the busiest map.
const mapRows = computed(() => {
  const maps = popularMaps.value.slice(0, 8)
  const maxShare = Math.max(1, ...maps.map(m => m.playTimePercentage))
  return maps.map(m => ({
    mapName: m.mapName,
    share: m.playTimePercentage,
    avg: m.averagePlayerCount,
    w: Math.round((m.playTimePercentage / maxShare) * 100),
  }))
})

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
  <div class="mm-container mm-container--wide mm-section">
    <div v-if="loading" style="padding: 40px 0">
      <div v-for="i in 5" :key="i" class="mm-skeleton" style="margin-bottom: 12px" />
    </div>

    <div v-else-if="error" class="mm-empty">{{ error }}</div>

    <template v-else-if="details">
      <!-- back link to servers index -->
      <router-link to="/v4/servers/bf1942" class="mm-server__back">‹ Servers</router-link>

      <!-- hero: name + quick links -->
      <div class="mm-server-hero">
        <h1 class="mm-display mm-server__name">{{ details.serverName }}</h1>
        <div class="mm-server-hero__links">
          <button
            v-if="hourlyTimeline.length > 0"
            type="button"
            class="mm-server__quick"
            @click="showForecast = true"
          >Forecast →</button>
          <router-link
            v-if="details.serverGuid"
            :to="`/v4/map-popularity/${encodeURIComponent(details.serverGuid)}`"
            class="mm-server__quick"
          >Map popularity →</router-link>
          <router-link
            v-if="details.serverName"
            :to="`/v4/servers/${encodeURIComponent(details.serverName)}/sessions`"
            class="mm-server__quick"
          >Rounds →</router-link>
        </div>
      </div>

      <div class="mm-meta-row mm-server__meta">
        <span class="mm-chip mm-chip--live"><span class="mm-chip__dot" />Tracking</span>
        <span class="mm-meta-row__sep">·</span>
        <span><span v-if="countryFlag" class="mm-flag">{{ countryFlag }}</span>{{ region }}</span>
        <template v-if="details.gameId">
          <span class="mm-meta-row__sep">·</span>
          <span>{{ details.gameId.toUpperCase() }}</span>
        </template>
        <template v-if="details.serverIp">
          <span class="mm-meta-row__sep">·</span>
          <span>{{ details.serverIp }}:{{ details.serverPort }}</span>
        </template>
      </div>

      <!-- KPI strip -->
      <div class="mm-stats" style="margin-top: 24px">
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Online now</div>
          <div class="mm-stat__value" :class="loadClass">
            {{ liveNumPlayers }}<span v-if="maxPlayers != null" class="mm-stat__suffix">/{{ maxPlayers }}</span>
          </div>
          <div class="mm-stat__delta">
            <template v-if="capacityPct != null">{{ capacityPct }}% of capacity</template>
            <template v-else-if="liveLoading">checking…</template>
            <template v-else>offline</template>
          </div>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Now playing</div>
          <div class="mm-stat__value mm-stat__value--small">{{ liveMap || '—' }}</div>
          <div class="mm-stat__delta">{{ liveMode || (liveLoading ? 'checking…' : 'server quiet') }}</div>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Peak · 30d</div>
          <div class="mm-stat__value">{{ peakPlayers != null ? peakPlayers : '—' }}</div>
          <div class="mm-stat__delta">
            <template v-if="avgPlayers != null">avg {{ avgPlayers.toFixed(1) }} players</template>
            <template v-else>no history yet</template>
          </div>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Live ticket lead</div>
          <div class="mm-stat__value">
            <template v-if="teamTickets.length === 2">
              <span class="mm-num--kill">{{ formatNumber(teamTickets[0].tickets) }}</span>
              <span class="mm-num__sep">/</span>
              <span style="color: var(--mm-success)">{{ formatNumber(teamTickets[1].tickets) }}</span>
            </template>
            <template v-else>—</template>
          </div>
          <div class="mm-stat__delta">
            <template v-if="teamTickets.length === 2">{{ teamTickets[0].label }} / {{ teamTickets[1].label }}</template>
            <template v-else>no live round</template>
          </div>
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
      <div v-if="activeTab === 'overview'" style="margin-top: 20px">
        <div class="mm-dash-grid mm-dash-grid--early" style="grid-template-columns: 1fr 1fr">
          <section class="mm-panel">
            <div class="mm-pbar">
              <span class="mm-pbar__t">● Online now</span>
              <span class="mm-pbar__m">
                <template v-if="hasLiveRoster">{{ liveNumPlayers }} playing · by score</template>
                <template v-else-if="liveLoading">checking…</template>
                <template v-else>server quiet</template>
              </span>
            </div>
            <div v-if="hasLiveRoster" style="padding: 6px">
              <MmPlayersPanel :show="true" :server="liveServer" :inline="true" :embedded="true" />
            </div>
            <div v-else-if="liveLoading" class="mm-panel__body">
              <div class="mm-skeleton" style="margin-bottom: 8px" />
              <div class="mm-skeleton" />
            </div>
            <div v-else class="mm-panel__body mm-empty" style="border: 0; padding: 24px 0">No players online right now.</div>
          </section>

          <section class="mm-panel">
            <div class="mm-pbar">
              <span class="mm-pbar__t"># Map popularity</span>
              <span class="mm-pbar__m">share · last 30d</span>
            </div>
            <div class="mm-panel__body mm-maprail">
              <div
                v-for="m in mapRows"
                :key="m.mapName"
                class="mm-rrow mm-maprail__row"
                @click="openMapAnywhere(m.mapName)"
              >
                <span class="mm-maprail__name">{{ m.mapName }}</span>
                <span class="mm-track"><span class="mm-track__f mm-track__f--accent" :style="{ width: m.w + '%' }" /></span>
                <span class="mm-maprail__val">{{ formatPercent(m.share) }}</span>
              </div>
              <div v-if="mapRows.length === 0" class="mm-empty" style="border: 0; padding: 12px 0">No map history yet.</div>
            </div>
          </section>
        </div>

        <div class="mm-dash-grid mm-dash-grid--early" style="grid-template-columns: 1fr 1.15fr; margin-top: 20px">
          <section class="mm-panel">
            <div class="mm-pbar">
              <span class="mm-pbar__t"># Player proximity</span>
              <span class="mm-pbar__m">regulars by ping</span>
            </div>
            <div class="mm-panel__body">
              <MmPingProximityOrbit
                seamless
                :server-guid="details.serverGuid"
                :server-name="details.serverName"
                @player-click="goPlayerFromOrbit"
              />
            </div>
          </section>

          <MmServerSignatureBuilder :server-name="details.serverName" />
        </div>
      </div>

      <!-- ===================== RANKS ===================== -->
      <section v-else-if="activeTab === 'players'" class="mm-panel" style="margin-top: 20px">
        <div class="mm-pbar">
          <span class="mm-pbar__t"># Player ranks</span>
          <span class="mm-pbar__m">{{ playersViewOptions.find(o => o.id === playersView)?.label }} · this server</span>
        </div>
        <div style="padding: 12px 14px 0">
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
        </div>

        <div class="mm-panel__rank">
          <!-- Most active -->
          <table v-if="playersView === 'active'" class="mm-list mm-list--dense mm-rank">
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

          <!-- Top K/D -->
          <table v-else-if="playersView === 'kd'" class="mm-list mm-list--dense mm-rank">
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
                <td class="is-num" data-cell-label="K/D" :class="kdTierBg(kdValue(s))">
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

          <!-- Top kill rate -->
          <table v-else-if="playersView === 'killrate'" class="mm-list mm-list--dense mm-rank">
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
          <table v-else-if="playersView === 'placement'" class="mm-list mm-list--dense mm-rank">
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
      </section>

      <!-- ===================== MAPS ===================== -->
      <div v-else-if="activeTab === 'maps'" style="margin-top: 20px">
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

      <!-- always-visible: comments -->
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
/* back link above the hero */
.mm-server__back {
  display: inline-block;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  text-decoration: none;
}
.mm-server__back:hover { color: var(--mm-ink); }

.mm-server-hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.mm-server-hero__links {
  display: flex;
  gap: 22px;
  align-items: center;
}

.mm-server__quick {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  text-decoration: none;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}
.mm-server__quick:hover { color: var(--mm-ink); }

.mm-server__name {
  margin: 0;
  font-size: clamp(28px, 3.4vw, 44px);
}

.mm-server__meta {
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 12px;
}

.mm-flag {
  font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
  margin-right: 5px;
}

/* Rank panel body — tighten table padding to sit inside the panel frame. */
.mm-panel__rank { padding: 8px 6px 6px; }

/* Map-popularity rail rows. */
.mm-maprail {
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.mm-maprail__row {
  display: grid;
  grid-template-columns: 1fr 2fr auto;
  gap: 12px;
  align-items: center;
}
.mm-maprail__name {
  font-family: var(--mm-font-display);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mm-maprail .mm-track { height: 5px; }
.mm-track__f--accent { background: var(--mm-accent); }
.mm-maprail__val {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
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
