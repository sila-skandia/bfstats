<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  fetchServerDetails,
  fetchServerInsights,
  fetchServerLeaderboards,
  fetchServerPlayerRankings,
  fetchLiveServerData,
  fetchServerBusyIndicators,
  type ServerDetails,
  type ServerInsights,
  type LeaderboardsData,
  type ServerPlayerRankingsResponse,
  type ServerPlayerRankingItem,
  type ServerHourlyTimelineEntry,
} from '@/services/serverDetailsService'
import type { ServerSummary } from '@/types/server'
import { decodePlayerName } from '@/utils/playerName'
import { countryCodeToName } from '@/types/countryCodes'
import MmPlayersPanel from '@/components/v4/MmPlayersPanel.vue'
import MmServerComments from '@/components/v4/MmServerComments.vue'
import MmServerSignatureBuilder from '@/components/v4/MmServerSignatureBuilder.vue'
import MmForecastModal from '@/components/v4/MmForecastModal.vue'
import MmPingProximityOrbit from '@/components/v4/MmPingProximityOrbit.vue'
import MmServerMapPopularity from '@/components/v4/MmServerMapPopularity.vue'
import MmRankCell from '@/components/v4/MmRankCell.vue'
import MmServerConnectAction from '@/components/v4/MmServerConnectAction.vue'
import MmServerRankDistribution from '@/components/v4/MmServerRankDistribution.vue'
import { kdClass } from './mmTokens'

const route = useRoute()
const router = useRouter()

const serverName = computed(() => decodeURIComponent(route.params.serverName as string))

const details = ref<ServerDetails | null>(null)
const insights = ref<ServerInsights | null>(null)
const leaderboards = ref<LeaderboardsData | null>(null)
const liveServer = ref<ServerSummary | null>(null)
const hourlyTimeline = ref<ServerHourlyTimelineEntry[]>([])
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

// These feeds were previously awaited one after another. Every request from
// Australia costs ~320ms of round trip to the Finnish origin regardless of how
// little work it does, so six serial calls cost ~2.4s of pure latency before the
// page settled. Only two of them actually depend on the details payload (the live
// roster needs gameId/ip/port, the forecast needs serverGuid); the rest need only
// serverName, which we have at mount. Two parallel waves instead of six hops.
// Guards against two loads interleaving when serverName changes mid-flight — a
// slower earlier response must not overwrite a newer server's data. The serial
// version had the same hazard; firing concurrently just makes it easier to hit.
let loadSeq = 0

const load = async () => {
  const seq = ++loadSeq
  const stale = () => seq !== loadSeq

  loading.value = true
  error.value = null
  liveServer.value = null
  insightsLoading.value = true
  boardsLoading.value = true
  liveLoading.value = true

  // Wave 1 — everything keyed off serverName alone.
  const detailsP = fetchServerDetails(serverName.value)
    .then(d => { if (!stale()) details.value = d })
    .catch(() => { if (!stale()) error.value = 'Server feed temporarily unavailable.' })
    .finally(() => { if (!stale()) loading.value = false })

  const insightsP = fetchServerInsights(serverName.value, 30, '7d')
    .then(i => { if (!stale()) insights.value = i })
    .catch(() => { if (!stale()) insights.value = null })
    .finally(() => { if (!stale()) insightsLoading.value = false })

  const boardsP = fetchServerLeaderboards(serverName.value, 'month')
    .then(b => { if (!stale()) leaderboards.value = b })
    .catch(() => { if (!stale()) leaderboards.value = null })
    .finally(() => { if (!stale()) boardsLoading.value = false })

  // Wave 2 — needs fields from the details payload, so it waits on that one
  // request only, not on the whole of wave 1.
  const dependentP = detailsP.then(() => Promise.all([
    (async () => {
      try {
        if (stale()) return
        if (details.value?.gameId && details.value.serverIp && details.value.serverPort) {
          const live = await fetchLiveServerData(
            details.value.serverIp,
            details.value.serverPort,
          )
          if (!stale()) liveServer.value = live
        } else {
          liveServer.value = null
        }
      } catch {
        if (!stale()) liveServer.value = null
      } finally {
        if (!stale()) liveLoading.value = false
      }
    })(),
    // Forecast / busy-indicator hourly timeline — best-effort
    (async () => {
      try {
        if (stale()) return
        if (details.value?.serverGuid) {
          const response = await fetchServerBusyIndicators([details.value.serverGuid])
          if (!stale() && response.serverResults.length > 0) {
            hourlyTimeline.value = response.serverResults[0].hourlyTimeline
          }
        }
      } catch {
        if (!stale()) hourlyTimeline.value = []
      }
    })(),
  ]))

  pagedRankings.value = null
  if (activeTab.value === 'players') {
    void loadPagedRankings()
  }

  await Promise.all([detailsP, insightsP, boardsP, dependentP])
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

onMounted(load)
watch(serverName, load)

const region = computed(() => {
  const code = details.value?.countryCode
  if (!code) return details.value?.country ?? '—'
  return countryCodeToName[code.toUpperCase()] ?? code.toUpperCase()
})

// Still used inside the Population history card footer in the Overview tab.
const peakPlayers = computed(() => insights.value?.playerCountSummary?.peakPlayerCount ?? null)
const avgPlayers = computed(() => insights.value?.playerCountSummary?.averagePlayerCount ?? null)

// players-tab sub-view selector
type PlayersView = 'active' | 'score' | 'kd' | 'killrate' | 'placement'
const playersView = ref<PlayersView>('active')
const playersViewOptions: { id: PlayersView; label: string }[] = [
  { id: 'active', label: 'Most active' },
  { id: 'score', label: 'Top score' },
  { id: 'kd', label: 'Top K/D' },
  { id: 'killrate', label: 'Top kill rate' },
  { id: 'placement', label: 'Top placements' },
]

const ranksPage = ref(1)
const ranksPageSize = ref(20)
const ranksDays = ref(30)
const ranksMinRounds = ref(10)
const ranksSearch = ref('')
const debouncedRanksSearch = ref('')
let ranksSearchTimeout: any = null

const pagedRankings = ref<ServerPlayerRankingsResponse | null>(null)
const ranksLoading = ref(false)
const ranksRefreshing = ref(false)
const ranksError = ref<string | null>(null)

const loadPagedRankings = async () => {
  if (!serverName.value) return
  if (!pagedRankings.value) ranksLoading.value = true
  else ranksRefreshing.value = true
  ranksError.value = null

  try {
    const res = await fetchServerPlayerRankings(
      serverName.value,
      ranksPage.value,
      ranksPageSize.value,
      playersView.value,
      ranksDays.value,
      ranksMinRounds.value,
      debouncedRanksSearch.value || undefined,
    )
    pagedRankings.value = res
  } catch (err) {
    console.error('Failed to load server player rankings:', err)
    ranksError.value = 'Failed to load player rankings'
  } finally {
    ranksLoading.value = false
    ranksRefreshing.value = false
  }
}

const handleRankSearch = () => {
  if (ranksSearchTimeout) clearTimeout(ranksSearchTimeout)
  ranksSearchTimeout = setTimeout(() => {
    debouncedRanksSearch.value = ranksSearch.value
    ranksPage.value = 1
    loadPagedRankings()
  }, 300)
}

const clearRankSearch = () => {
  ranksSearch.value = ''
  debouncedRanksSearch.value = ''
  ranksPage.value = 1
  loadPagedRankings()
}

const setPlayersView = (view: PlayersView) => {
  if (playersView.value === view && !ranksError.value) return
  playersView.value = view
  ranksPage.value = 1
  loadPagedRankings()
}

const setRanksDays = (days: number) => {
  if (ranksDays.value === days && !ranksError.value) return
  ranksDays.value = days
  ranksPage.value = 1
  loadPagedRankings()
}

const setRanksMinRounds = (rounds: number) => {
  if (ranksMinRounds.value === rounds && !ranksError.value) return
  ranksMinRounds.value = rounds
  ranksPage.value = 1
  loadPagedRankings()
}

const goToRankPage = (page: number) => {
  if (page < 1 || (pagedRankings.value && page > pagedRankings.value.totalPages) || ranksRefreshing.value) return
  ranksPage.value = page
  loadPagedRankings()
}

const rankPaginationRange = computed(() => {
  const total = pagedRankings.value?.totalPages ?? 0
  if (total <= 1) return []
  const maxVisible = 5
  let start = Math.max(1, ranksPage.value - Math.floor(maxVisible / 2))
  const end = Math.min(total, start + maxVisible - 1)
  if (end === total) start = Math.max(1, end - maxVisible + 1)
  const range: number[] = []
  for (let i = start; i <= end; i++) range.push(i)
  return range
})

const rankedPlayers = computed(() => pagedRankings.value?.rankings ?? [])

// Per-column maxes for the Ranks tab — drive the in-cell magnitude bars.
const rankMax = computed(() => {
  const list = rankedPlayers.value
  if (list.length === 0) return { minutes: 1, kills: 1, deaths: 1, kd: 1, score: 1, killRate: 1, rounds: 1, placements: 1, first: 1, second: 1, third: 1, points: 1 }
  return {
    minutes: Math.max(1, ...list.map(p => p.minutesPlayed)),
    kills: Math.max(1, ...list.map(p => p.totalKills)),
    deaths: Math.max(1, ...list.map(p => p.totalDeaths)),
    kd: Math.max(1, ...list.map(p => p.kdRatio)),
    score: Math.max(1, ...list.map(p => p.totalScore)),
    killRate: Math.max(1, ...list.map(p => p.killRate)),
    rounds: Math.max(1, ...list.map(p => p.totalRounds)),
    placements: Math.max(1, ...list.map(p => p.totalPlacements)),
    first: Math.max(1, ...list.map(p => p.firstPlaces)),
    second: Math.max(1, ...list.map(p => p.secondPlaces)),
    third: Math.max(1, ...list.map(p => p.thirdPlaces)),
    points: Math.max(1, ...list.map(p => p.placementPoints)),
  }
})

// K/D tier → cell background class
const kdTierBg = (kd: number): string => {
  if (kd < 1) return 'mm-rank__kd-bg--poor'
  if (kd >= 2) return 'mm-rank__kd-bg--good'
  return ''
}

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

const rankDistRef = ref<InstanceType<typeof MmServerRankDistribution> | null>(null)

const benchmarkPlayer = (p: ServerPlayerRankingItem) => {
  if (rankDistRef.value) {
    rankDistRef.value.pinPlayer(p)
    const el = document.querySelector('.mm-rank-dist')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}

watch(activeTab, (t) => {
  if (t === 'players' && !pagedRankings.value) {
    loadPagedRankings()
  }
})
</script>

<template>
  <div class="mm-container mm-container--wide mm-section">
    <div v-if="error" class="mm-empty">{{ error }}</div>

    <template v-else>
      <!-- back link to servers index -->
      <router-link to="/v4/servers/bf1942" class="mm-server__back">‹ Servers</router-link>

      <!-- Hero: painted from the route param, not from the details payload. The
           server name is already in the URL, so there is no reason to hold the
           whole page behind a ~1s round trip to Finland just to learn it. The
           rest of the page fills in around it. -->
      <div class="mm-server-hero">
        <h1 class="mm-display mm-server__name">{{ $pn(serverName) }}</h1>
        <div class="mm-server-hero__links">
          <MmServerConnectAction
            v-if="details?.serverIp"
            :ip="details.serverIp"
            :port="details.serverPort"
            :server-name="serverName"
          />
          <button
            v-if="hourlyTimeline.length > 0"
            type="button"
            class="mm-server__quick"
            @click="showForecast = true"
          >Forecast →</button>
          <router-link
            :to="`/v4/servers/${encodeURIComponent(serverName)}/sessions`"
            class="mm-server__quick"
          >Rounds →</router-link>
        </div>
      </div>

      <div class="mm-meta-row mm-server__meta">
        <span class="mm-chip mm-chip--live"><span class="mm-chip__dot" />Tracking</span>
        <template v-if="details">
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
        </template>
        <template v-else-if="loading">
          <span class="mm-meta-row__sep">·</span>
          <span class="mm-skeleton" style="width: 180px; height: 1em; display: inline-block; vertical-align: middle" />
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
        <!-- Full-width Online Now panel -->
        <section class="mm-panel">
          <div class="mm-pbar">
            <span class="mm-pbar__t">● Online now</span>
            <span class="mm-pbar__m">
              <template v-if="hasLiveRoster">{{ liveNumPlayers }} playing · by score</template>
              <template v-else-if="liveLoading">checking…</template>
              <template v-else>server quiet</template>
            </span>
          </div>
          <div v-if="hasLiveRoster" style="padding: 10px 14px">
            <MmPlayersPanel :show="true" :server="liveServer" :inline="true" :embedded="true" />
          </div>
          <div v-else-if="liveLoading" class="mm-panel__body">
            <div class="mm-skeleton" style="margin-bottom: 8px" />
            <div class="mm-skeleton" />
          </div>
          <div v-else class="mm-panel__body mm-empty" style="border: 0; padding: 24px 0">No players online right now.</div>
        </section>

        <div class="mm-dash-grid mm-dash-grid--early" style="grid-template-columns: 1fr 1.15fr; margin-top: 20px">
          <section class="mm-panel">
            <div class="mm-pbar">
              <span class="mm-pbar__t"># Player proximity</span>
              <span class="mm-pbar__m">regulars by ping</span>
            </div>
            <!-- Genuinely needs serverGuid from the details payload, so this one
                 panel keeps its own skeleton rather than blocking the page. -->
            <div class="mm-panel__body">
              <MmPingProximityOrbit
                v-if="details?.serverGuid"
                seamless
                :server-guid="details.serverGuid"
                :server-name="details.serverName"
                @player-click="goPlayerFromOrbit"
              />
              <template v-else-if="loading">
                <div class="mm-skeleton" style="margin-bottom: 8px" />
                <div class="mm-skeleton" />
              </template>
            </div>
          </section>

          <MmServerSignatureBuilder :server-name="serverName" />
        </div>
      </div>

      <!-- ===================== RANKS ===================== -->
      <section v-else-if="activeTab === 'players'" class="mm-panel" style="margin-top: 20px">
        <!-- Distribution Bar Chart Component -->
        <MmServerRankDistribution ref="rankDistRef" :server-name="serverName" />

        <!-- Ladder Header + Filter Bar -->
        <div class="mm-pbar mm-ranks__ladder-pbar">
          <div>
            <span class="mm-pbar__t"># Player ranks</span>
            <span class="mm-pbar__m">{{ playersViewOptions.find(o => o.id === playersView)?.label }} · this server</span>
          </div>
          <span v-if="pagedRankings && pagedRankings.totalCount > 0" class="mm-chip">
            {{ pagedRankings.totalCount.toLocaleString() }} ranked players
          </span>
        </div>

        <div class="mm-ranks__controls-row">
          <!-- Subtabs for Sort / View -->
          <div class="mm-subtabs mm-ranks__sort-subtabs">
            <button
              v-for="opt in playersViewOptions"
              :key="opt.id"
              type="button"
              class="mm-subtab"
              :class="{ 'mm-subtab--active': playersView === opt.id }"
              :disabled="ranksRefreshing"
              @click="setPlayersView(opt.id)"
            >{{ opt.label }}</button>
          </div>

          <div class="mm-ranks__filters-group">
            <!-- Min rounds filter -->
            <div class="mm-rank__filter">
              <span class="mm-rank__filter-label">Min rounds</span>
              <div class="mm-subtabs">
                <button
                  v-for="rounds in [10, 25, 50, 100, 200]"
                  :key="rounds"
                  type="button"
                  class="mm-subtab"
                  :class="{ 'mm-subtab--active': ranksMinRounds === rounds }"
                  :disabled="ranksRefreshing"
                  @click="setRanksMinRounds(rounds)"
                >{{ rounds }}+</button>
              </div>
            </div>

            <!-- Window filter -->
            <div class="mm-rank__filter">
              <span class="mm-rank__filter-label">Window</span>
              <div class="mm-subtabs">
                <button
                  v-for="days in [7, 30, 90, 365]"
                  :key="days"
                  type="button"
                  class="mm-subtab"
                  :class="{ 'mm-subtab--active': ranksDays === days }"
                  :disabled="ranksRefreshing"
                  @click="setRanksDays(days)"
                >{{ days === 365 ? '1y' : `${days}d` }}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Search input -->
        <div style="padding: 10px 14px 0">
          <label class="mm-search mm-ranks__search">
            <svg class="mm-search__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              v-model="ranksSearch"
              type="text"
              class="mm-search__input"
              placeholder="Search players…"
              @input="handleRankSearch"
            />
            <button
              v-if="ranksSearch"
              type="button"
              class="mm-search__clear"
              title="Clear search"
              @click="clearRankSearch"
            >×</button>
          </label>
        </div>

        <!-- Table Container -->
        <div class="mm-panel__rank">
          <!-- Loading skeleton -->
          <div v-if="ranksLoading" style="padding: 12px">
            <div v-for="i in 8" :key="i" class="mm-skeleton" style="margin-bottom: 8px; height: 32px" />
          </div>

          <!-- Error state -->
          <div v-else-if="ranksError" class="mm-empty" style="border: 0; padding: 24px 0">
            {{ ranksError }}
            <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="loadPagedRankings">Retry</button>
          </div>

          <!-- Empty state -->
          <div v-else-if="rankedPlayers.length === 0" class="mm-empty" style="border: 0; padding: 24px 0">
            No player history found for the selected view and filter criteria.
          </div>

          <!-- Tables -->
          <template v-else>
            <!-- Most active -->
            <table v-if="playersView === 'active'" class="mm-list mm-list--dense mm-rank" :class="{ 'is-refreshing': ranksRefreshing }">
              <thead>
                <tr>
                  <th style="width: 44px">#</th>
                  <th>Player</th>
                  <th class="is-num">Hours played</th>
                  <th class="is-num">Kills</th>
                  <th class="is-num">Deaths</th>
                  <th class="is-num">K/D</th>
                  <th class="is-num is-muted">Rounds</th>
                  <th style="width: 32px"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in rankedPlayers"
                  :key="p.playerName"
                  :class="{ 'mm-rank__row--top3': p.rank <= 3 }"
                  @click="goPlayer(p.playerName)"
                >
                  <td class="mm-list__rank is-muted">{{ String(p.rank).padStart(2, '0') }}</td>
                  <td class="mm-list__name-cell">
                    <div class="mm-list__name">
                      <span class="mm-list__name-primary">{{ $pn(p.playerName) }}</span>
                    </div>
                  </td>
                  <td class="is-num" data-cell-label="Hours">
                    <MmRankCell :value="p.minutesPlayed" :max="rankMax.minutes" tone="neutral">{{ formatHours(p.minutesPlayed) }}</MmRankCell>
                  </td>
                  <td class="is-num mm-list__col--hide-sm" data-cell-label="Kills">
                    <MmRankCell :value="p.totalKills" :max="rankMax.kills" tone="kill"><span class="mm-num--kill">{{ formatNumber(p.totalKills) }}</span></MmRankCell>
                  </td>
                  <td class="is-num mm-list__col--hide-sm" data-cell-label="Deaths">
                    <MmRankCell :value="p.totalDeaths" :max="rankMax.deaths" tone="death"><span class="mm-num--death">{{ formatNumber(p.totalDeaths) }}</span></MmRankCell>
                  </td>
                  <td class="is-num" :class="kdTierBg(p.kdRatio)" data-cell-label="K/D">
                    <MmRankCell :value="p.kdRatio" :max="rankMax.kd" tone="kd"><span :class="kdClass(p.kdRatio)">{{ p.kdRatio.toFixed(2) }}</span></MmRankCell>
                  </td>
                  <td class="is-num is-muted mm-list__col--hide-sm" data-cell-label="Rounds">
                    <MmRankCell :value="p.totalRounds" :max="rankMax.rounds" tone="neutral">{{ p.totalRounds }}</MmRankCell>
                  </td>
                  <td class="mm-list__col--hide-sm" style="width: 32px; text-align: center">
                    <button
                      type="button"
                      class="mm-btn mm-btn--inline mm-rank__pin-btn"
                      title="Plot player on distribution curve"
                      @click.stop="benchmarkPlayer(p)"
                    >📍</button>
                  </td>
                </tr>
              </tbody>
            </table>

            <!-- Top score -->
            <table v-else-if="playersView === 'score'" class="mm-list mm-list--dense mm-rank" :class="{ 'is-refreshing': ranksRefreshing }">
              <thead>
                <tr>
                  <th style="width: 44px">#</th>
                  <th>Player</th>
                  <th class="is-num">Score</th>
                  <th class="is-num">Kills</th>
                  <th class="is-num">Deaths</th>
                  <th class="is-num">K/D</th>
                  <th class="is-num is-muted">Rounds</th>
                  <th style="width: 32px"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in rankedPlayers"
                  :key="p.playerName"
                  :class="{ 'mm-rank__row--top3': p.rank <= 3 }"
                  @click="goPlayer(p.playerName)"
                >
                  <td class="mm-list__rank is-muted">{{ String(p.rank).padStart(2, '0') }}</td>
                  <td class="mm-list__name-cell">
                    <div class="mm-list__name">
                      <span class="mm-list__name-primary">{{ $pn(p.playerName) }}</span>
                    </div>
                  </td>
                  <td class="is-num" data-cell-label="Score">
                    <MmRankCell :value="p.totalScore" :max="rankMax.score" tone="neutral"><span class="mm-num--score">{{ formatNumber(p.totalScore) }}</span></MmRankCell>
                  </td>
                  <td class="is-num mm-list__col--hide-sm" data-cell-label="Kills">
                    <MmRankCell :value="p.totalKills" :max="rankMax.kills" tone="kill"><span class="mm-num--kill">{{ formatNumber(p.totalKills) }}</span></MmRankCell>
                  </td>
                  <td class="is-num mm-list__col--hide-sm" data-cell-label="Deaths">
                    <MmRankCell :value="p.totalDeaths" :max="rankMax.deaths" tone="death"><span class="mm-num--death">{{ formatNumber(p.totalDeaths) }}</span></MmRankCell>
                  </td>
                  <td class="is-num" :class="kdTierBg(p.kdRatio)" data-cell-label="K/D">
                    <MmRankCell :value="p.kdRatio" :max="rankMax.kd" tone="kd"><span :class="kdClass(p.kdRatio)">{{ p.kdRatio.toFixed(2) }}</span></MmRankCell>
                  </td>
                  <td class="is-num is-muted mm-list__col--hide-sm" data-cell-label="Rounds">
                    <MmRankCell :value="p.totalRounds" :max="rankMax.rounds" tone="neutral">{{ p.totalRounds }}</MmRankCell>
                  </td>
                  <td class="mm-list__col--hide-sm" style="width: 32px; text-align: center">
                    <button
                      type="button"
                      class="mm-btn mm-btn--inline mm-rank__pin-btn"
                      title="Plot player on distribution curve"
                      @click.stop="benchmarkPlayer(p)"
                    >📍</button>
                  </td>
                </tr>
              </tbody>
            </table>

            <!-- Top K/D -->
            <table v-else-if="playersView === 'kd'" class="mm-list mm-list--dense mm-rank" :class="{ 'is-refreshing': ranksRefreshing }">
              <thead>
                <tr>
                  <th style="width: 44px">#</th>
                  <th>Player</th>
                  <th class="is-num">K/D</th>
                  <th class="is-num">Kills</th>
                  <th class="is-num">Deaths</th>
                  <th class="is-num">Hours</th>
                  <th class="is-num is-muted">Rounds</th>
                  <th style="width: 32px"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in rankedPlayers"
                  :key="p.playerName"
                  :class="{ 'mm-rank__row--top3': p.rank <= 3 }"
                  @click="goPlayer(p.playerName)"
                >
                  <td class="mm-list__rank is-muted">{{ String(p.rank).padStart(2, '0') }}</td>
                  <td class="mm-list__name-cell">
                    <div class="mm-list__name">
                      <span class="mm-list__name-primary">{{ $pn(p.playerName) }}</span>
                    </div>
                  </td>
                  <td class="is-num" :class="kdTierBg(p.kdRatio)" data-cell-label="K/D">
                    <MmRankCell :value="p.kdRatio" :max="rankMax.kd" tone="kd">
                      <span :class="kdClass(p.kdRatio)">{{ p.kdRatio.toFixed(2) }}</span>
                    </MmRankCell>
                  </td>
                  <td class="is-num mm-list__col--hide-sm" data-cell-label="Kills">
                    <MmRankCell :value="p.totalKills" :max="rankMax.kills" tone="kill"><span class="mm-num--kill">{{ formatNumber(p.totalKills) }}</span></MmRankCell>
                  </td>
                  <td class="is-num mm-list__col--hide-sm" data-cell-label="Deaths">
                    <MmRankCell :value="p.totalDeaths" :max="rankMax.deaths" tone="death"><span class="mm-num--death">{{ formatNumber(p.totalDeaths) }}</span></MmRankCell>
                  </td>
                  <td class="is-num mm-list__col--hide-sm" data-cell-label="Hours">
                    <MmRankCell :value="p.minutesPlayed" :max="rankMax.minutes" tone="neutral">{{ formatHours(p.minutesPlayed) }}</MmRankCell>
                  </td>
                  <td class="is-num is-muted" data-cell-label="Rounds">
                    <MmRankCell :value="p.totalRounds" :max="rankMax.rounds" tone="neutral">{{ p.totalRounds }}</MmRankCell>
                  </td>
                  <td class="mm-list__col--hide-sm" style="width: 32px; text-align: center">
                    <button
                      type="button"
                      class="mm-btn mm-btn--inline mm-rank__pin-btn"
                      title="Plot player on distribution curve"
                      @click.stop="benchmarkPlayer(p)"
                    >📍</button>
                  </td>
                </tr>
              </tbody>
            </table>

            <!-- Top kill rate -->
            <table v-else-if="playersView === 'killrate'" class="mm-list mm-list--dense mm-rank" :class="{ 'is-refreshing': ranksRefreshing }">
              <thead>
                <tr>
                  <th style="width: 44px">#</th>
                  <th>Player</th>
                  <th class="is-num">Kills / min</th>
                  <th class="is-num">Kills</th>
                  <th class="is-num">Deaths</th>
                  <th class="is-num">Hours</th>
                  <th class="is-num is-muted">Rounds</th>
                  <th style="width: 32px"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in rankedPlayers"
                  :key="p.playerName"
                  :class="{ 'mm-rank__row--top3': p.rank <= 3 }"
                  @click="goPlayer(p.playerName)"
                >
                  <td class="mm-list__rank is-muted">{{ String(p.rank).padStart(2, '0') }}</td>
                  <td class="mm-list__name-cell">
                    <div class="mm-list__name">
                      <span class="mm-list__name-primary">{{ $pn(p.playerName) }}</span>
                    </div>
                  </td>
                  <td class="is-num" data-cell-label="Kills / min">
                    <MmRankCell :value="p.killRate" :max="rankMax.killRate" tone="kill"><span class="mm-num--kill">{{ p.killRate.toFixed(2) }}</span></MmRankCell>
                  </td>
                  <td class="is-num mm-list__col--hide-sm" data-cell-label="Kills">
                    <MmRankCell :value="p.totalKills" :max="rankMax.kills" tone="kill"><span class="mm-num--kill">{{ formatNumber(p.totalKills) }}</span></MmRankCell>
                  </td>
                  <td class="is-num mm-list__col--hide-sm" data-cell-label="Deaths">
                    <MmRankCell :value="p.totalDeaths" :max="rankMax.deaths" tone="death"><span class="mm-num--death">{{ formatNumber(p.totalDeaths) }}</span></MmRankCell>
                  </td>
                  <td class="is-num mm-list__col--hide-sm" data-cell-label="Hours">
                    <MmRankCell :value="p.minutesPlayed" :max="rankMax.minutes" tone="neutral">{{ formatHours(p.minutesPlayed) }}</MmRankCell>
                  </td>
                  <td class="is-num is-muted" data-cell-label="Rounds">
                    <MmRankCell :value="p.totalRounds" :max="rankMax.rounds" tone="neutral">{{ p.totalRounds }}</MmRankCell>
                  </td>
                  <td class="mm-list__col--hide-sm" style="width: 32px; text-align: center">
                    <button
                      type="button"
                      class="mm-btn mm-btn--inline mm-rank__pin-btn"
                      title="Plot player on distribution curve"
                      @click.stop="benchmarkPlayer(p)"
                    >📍</button>
                  </td>
                </tr>
              </tbody>
            </table>

            <!-- Top placements -->
            <table v-else-if="playersView === 'placement'" class="mm-list mm-list--dense mm-rank" :class="{ 'is-refreshing': ranksRefreshing }">
              <thead>
                <tr>
                  <th style="width: 44px">#</th>
                  <th>Player</th>
                  <th class="is-num">1st</th>
                  <th class="is-num">2nd</th>
                  <th class="is-num">3rd</th>
                  <th class="is-num">Total</th>
                  <th class="is-num">Points</th>
                  <th style="width: 32px"></th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="p in rankedPlayers"
                  :key="p.playerName"
                  :class="{ 'mm-rank__row--top3': p.rank <= 3 }"
                  @click="goPlayer(p.playerName)"
                >
                  <td class="mm-list__rank is-muted">{{ String(p.rank).padStart(2, '0') }}</td>
                  <td class="mm-list__name-cell">
                    <div class="mm-list__name">
                      <span class="mm-list__name-primary">{{ $pn(p.playerName) }}</span>
                    </div>
                  </td>
                  <td class="is-num" data-cell-label="1st">
                    <MmRankCell :value="p.firstPlaces" :max="rankMax.first" tone="kd">{{ p.firstPlaces }}</MmRankCell>
                  </td>
                  <td class="is-num mm-list__col--hide-sm" data-cell-label="2nd">
                    <MmRankCell :value="p.secondPlaces" :max="rankMax.second" tone="neutral">{{ p.secondPlaces }}</MmRankCell>
                  </td>
                  <td class="is-num mm-list__col--hide-sm" data-cell-label="3rd">
                    <MmRankCell :value="p.thirdPlaces" :max="rankMax.third" tone="neutral">{{ p.thirdPlaces }}</MmRankCell>
                  </td>
                  <td class="is-num mm-list__col--hide-sm" data-cell-label="Total">
                    <MmRankCell :value="p.totalPlacements" :max="rankMax.placements" tone="neutral">{{ p.totalPlacements }}</MmRankCell>
                  </td>
                  <td class="is-num" data-cell-label="Points">
                    <MmRankCell :value="p.placementPoints" :max="rankMax.points" tone="kd">{{ formatNumber(p.placementPoints) }}</MmRankCell>
                  </td>
                  <td class="mm-list__col--hide-sm" style="width: 32px; text-align: center">
                    <button
                      type="button"
                      class="mm-btn mm-btn--inline mm-rank__pin-btn"
                      title="Plot player on distribution curve"
                      @click.stop="benchmarkPlayer(p)"
                    >📍</button>
                  </td>
                </tr>
              </tbody>
            </table>

            <!-- Pagination Bar -->
            <div v-if="pagedRankings && pagedRankings.totalPages > 1" class="mm-ranks__pagination-wrap">
              <span class="mm-ranks__pagination-summary">
                Showing {{ (ranksPage - 1) * ranksPageSize + 1 }}–{{ Math.min(ranksPage * ranksPageSize, pagedRankings.totalCount) }} of {{ pagedRankings.totalCount.toLocaleString() }}
              </span>

              <div class="mm-rank__pagination">
                <button
                  type="button"
                  class="mm-btn mm-btn--inline"
                  :disabled="ranksPage <= 1 || ranksRefreshing"
                  aria-label="Previous page"
                  @click="goToRankPage(ranksPage - 1)"
                >‹</button>
                <button
                  v-for="p in rankPaginationRange"
                  :key="p"
                  type="button"
                  class="mm-btn mm-btn--inline"
                  :class="{ 'mm-rank__page--active': p === ranksPage }"
                  :disabled="ranksRefreshing"
                  @click="goToRankPage(p)"
                >{{ p }}</button>
                <button
                  type="button"
                  class="mm-btn mm-btn--inline"
                  :disabled="ranksPage >= pagedRankings.totalPages || ranksRefreshing"
                  aria-label="Next page"
                  @click="goToRankPage(ranksPage + 1)"
                >›</button>
              </div>
            </div>
          </template>
        </div>
      </section>

      <!-- ===================== MAPS ===================== -->
      <div v-else-if="activeTab === 'maps'" style="margin-top: 20px">
        <MmServerMapPopularity
          v-if="details?.serverGuid"
          :server-guid="details.serverGuid"
          :server-name="serverName"
        />
        <div v-else-if="loading" style="padding: 32px 0">
          <div v-for="i in 6" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
        </div>
        <div v-else class="mm-empty">
          Map statistics not available for this server.
        </div>
      </div>

      <!-- always-visible: comments -->
      <MmServerComments :server-name="serverName" />
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

/* Ranks Ladder Controls & Pagination */
.mm-ranks__ladder-pbar {
  flex-wrap: wrap;
  gap: 12px;
}

.mm-ranks__controls-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px 0;
}

.mm-ranks__filters-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}

.mm-rank__filter {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mm-rank__filter-label {
  font-family: var(--mm-font-mono, monospace);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--mm-ink-soft, #b3b3b3);
  font-weight: 500;
}

.mm-ranks__search {
  width: 100%;
  max-width: 320px;
}

.mm-ranks__pagination-wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px 8px;
  border-top: 1px solid var(--mm-rule, rgba(255, 255, 255, 0.04));
  margin-top: 8px;
}

.mm-ranks__pagination-summary {
  font-family: var(--mm-font-mono, monospace);
  font-size: 11px;
  color: var(--mm-ink-muted, #8a8a8a);
}

.mm-rank__pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.mm-rank__page--active {
  background: var(--mm-ink, #ffffff) !important;
  color: var(--mm-bg, #131313) !important;
  border-color: var(--mm-ink, #ffffff) !important;
}

.mm-list.is-refreshing {
  opacity: 0.6;
  pointer-events: none;
}

.mm-rank__pin-btn {
  padding: 2px 6px;
  font-size: 11px;
  opacity: 0.5;
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.mm-rank__pin-btn:hover {
  opacity: 1;
  transform: scale(1.15);
}

@media (max-width: 768px) {
  .mm-ranks__controls-row {
    flex-direction: column;
    align-items: flex-start;
  }
  .mm-ranks__filters-group {
    width: 100%;
    justify-content: space-between;
  }
  .mm-ranks__search {
    max-width: 100%;
  }
}
</style>
