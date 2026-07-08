<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchAllServers } from '@/services/serverDetailsService'
import type { ServerSummary } from '@/types/server'
import { countryCodeToName, countryCodeToFlag } from '@/types/countryCodes'
import { loadClass } from './mmTokens'
import MmInstallationLinks from '@/components/v4/MmInstallationLinks.vue'
import { formatTimeRemaining } from '@/utils/timeUtils'

// Only BF1942 is actively tracked in the modern-minimal preview today.
type GameKey = 'bf1942'
const GAME_LABEL = 'Battlefield 1942'

defineProps<{ initialMode?: string }>()

const route = useRoute()
const router = useRouter()

const game = ref<GameKey>('bf1942')
const servers = ref<ServerSummary[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
let refreshTimer: number | undefined
let tickTimer: number | undefined

const REFRESH_INTERVAL_MS = 30_000
const nextRefreshAt = ref(Date.now() + REFRESH_INTERVAL_MS)
const now = ref(Date.now())

// Path is fixed to bf1942 today — only re-fetch on revisit.
watch(() => route.path, () => void load(false))

const selectedServer = ref<ServerSummary | null>(null)
const showQuiet = ref(true)

const load = async (showSpinner = false) => {
  if (showSpinner) loading.value = true
  error.value = null
  try {
    const data = await fetchAllServers(game.value)
    servers.value = [...data].sort((a, b) => (b.numPlayers || 0) - (a.numPlayers || 0))

    // Re-link selectedServer to point to the new data object (by GUID)
    if (selectedServer.value) {
      const found = servers.value.find(s => s.guid === selectedServer.value?.guid)
      if (found) {
        selectedServer.value = found
      } else {
        selectedServer.value = null
      }
    }

    // Auto-select first active server with players on initial load
    if (!selectedServer.value && servers.value.length > 0) {
      const firstActive = servers.value.find(s => (s.numPlayers || 0) > 0)
      if (firstActive) {
        selectedServer.value = firstActive
      }
    }
  } catch (e) {
    error.value = 'Server feed temporarily unavailable.'
  } finally {
    loading.value = false
    nextRefreshAt.value = Date.now() + REFRESH_INTERVAL_MS
  }
}

onMounted(() => {
  void load(true)
  refreshTimer = window.setInterval(() => void load(false), REFRESH_INTERVAL_MS)
  tickTimer = window.setInterval(() => { now.value = Date.now() }, 1000)
})
onUnmounted(() => {
  if (refreshTimer) window.clearInterval(refreshTimer)
  if (tickTimer) window.clearInterval(tickTimer)
})

const refreshProgress = computed(() => {
  const remaining = Math.max(0, nextRefreshAt.value - now.value)
  return 1 - Math.min(1, remaining / REFRESH_INTERVAL_MS)
})
const secondsUntilRefresh = computed(() =>
  Math.max(0, Math.ceil((nextRefreshAt.value - now.value) / 1000)),
)
const REFRESH_RING_CIRCUMFERENCE = 2 * Math.PI * 6

const totalPlayers = computed(() =>
  servers.value.reduce((s, srv) => s + (srv.numPlayers || 0), 0),
)
const totalCapacity = computed(() =>
  servers.value.reduce((s, srv) => s + (srv.maxPlayers || 0), 0),
)
const activeCount = computed(() =>
  servers.value.filter(s => (s.numPlayers || 0) > 0).length,
)
const loadPercent = computed(() => {
  if (totalCapacity.value === 0) return 0
  return Math.round((totalPlayers.value / totalCapacity.value) * 100)
})
const topServer = computed(() => servers.value[0] ?? null)

const networkStatus = computed(() => {
  if (loading.value) return { label: 'Syncing', tone: 'off' as const }
  if (error.value) return { label: 'Offline', tone: 'off' as const }
  if (totalPlayers.value === 0) return { label: 'Quiet', tone: 'off' as const }
  if (totalPlayers.value < 30) return { label: 'Live', tone: 'on' as const }
  return { label: 'Live · Heavy', tone: 'on' as const }
})

const friendlyCountry = (code?: string) => {
  if (!code) return '—'
  return countryCodeToName[code.toUpperCase()] ?? code.toUpperCase()
}

const formatNumber = (n: number) => n.toLocaleString()

const goServer = (s: ServerSummary) => {
  router.push(`/v4/servers/detail/${encodeURIComponent(s.name)}`)
}

// Group active and quiet servers
const activeServers = computed(() => servers.value.filter(s => (s.numPlayers || 0) > 0))
const quietServers = computed(() => servers.value.filter(s => (s.numPlayers || 0) === 0))

// Selected server computed properties and roster helpers
const averagePing = computed(() => {
  if (!selectedServer.value || !selectedServer.value.players || selectedServer.value.players.length === 0) return null
  const validPings = selectedServer.value.players.map(p => p.ping).filter(p => p > 0)
  if (validPings.length === 0) return null
  const sum = validPings.reduce((acc, p) => acc + p, 0)
  return Math.round(sum / validPings.length)
})

const formattedTimeRemaining = computed(() => {
  if (!selectedServer.value || selectedServer.value.roundTimeRemain === undefined || selectedServer.value.roundTimeRemain === -1) {
    return '—'
  }
  return formatTimeRemaining(selectedServer.value.roundTimeRemain)
})

const formattedTotalRoundTime = computed(() => {
  if (!selectedServer.value) return '—'
  const total = (selectedServer.value as any).roundTime || 1800
  return formatTimeRemaining(total)
})

const getTeamPlayerCount = (server: ServerSummary, teamIndex: number) =>
  (server.players ?? []).filter(p => p.team === teamIndex).length

const getSortedTeamPlayers = (server: ServerSummary, teamIndex: number) => {
  const players = (server.players ?? []).filter(p => p.team === teamIndex)
  return [...players].sort((a, b) => b.score - a.score)
}

const getTeamColor = (label: string) => {
  const l = label.toLowerCase()
  if (l.includes('axis') || l.includes('germany') || l.includes('japan')) return '#d65a5a'
  if (l.includes('allies') || l.includes('ussr') || l.includes('usa') || l.includes('uk') || l.includes('canada') || l.includes('france')) return '#7da34c'
  return '#8a8a8a'
}

const getPlayerRowClass = (team: any, pidx: number) => {
  if (pidx === 0) {
    const label = (team.label || '').toLowerCase()
    if (label.includes('axis') || team.index === 1) {
      return 'mm-rank--gold'
    } else {
      return 'mm-rank--silver'
    }
  }
  return ''
}

const handleRowClick = (s: ServerSummary) => {
  if (window.innerWidth >= 1024) {
    selectedServer.value = s
  } else {
    goServer(s)
  }
}

const isInitialLoad = computed(() => loading.value && servers.value.length === 0)
</script>

<template>
  <div class="mm-container mm-section">
    <!-- meta row -->
    <div class="mm-landing__top">
      <!-- Only show on mobile because desktop has it in the hero band -->
      <div class="mm-meta-row mm-only-mobile">
        <span class="mm-chip" :class="{ 'mm-chip--off': networkStatus.tone === 'off' }">
          <span class="mm-chip__dot" />
          {{ networkStatus.label }}
        </span>
        <span class="mm-meta-row__sep">·</span>
        <span class="mm-meta-row__strong">
          <span v-if="isInitialLoad" class="mm-skeleton" style="width: 16px; height: 1em; display: inline-block; vertical-align: middle"></span>
          <template v-else>{{ formatNumber(activeCount) }}</template>
        </span> active hosts
        <span class="mm-meta-row__sep">·</span>
        <span class="mm-meta-row__strong">
          <span v-if="isInitialLoad" class="mm-skeleton" style="width: 24px; height: 1em; display: inline-block; vertical-align: middle"></span>
          <template v-else>{{ formatNumber(servers.length) }}</template>
        </span> tracked
        <span class="mm-meta-row__sep">·</span>
        Network load <span class="mm-meta-row__strong">
          <span v-if="isInitialLoad" class="mm-skeleton" style="width: 28px; height: 1em; display: inline-block; vertical-align: middle"></span>
          <template v-else>{{ loadPercent }}%</template>
        </span>
        <span class="mm-meta-row__sep">·</span>
        <span
          class="mm-refresh-ring"
          :title="`Next refresh in ${secondsUntilRefresh}s`"
          :aria-label="`Next refresh in ${secondsUntilRefresh} seconds`"
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <circle cx="8" cy="8" r="6" fill="none" stroke="var(--mm-rule)" stroke-width="1.5" />
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              stroke="var(--mm-accent)"
              stroke-width="1.5"
              stroke-linecap="round"
              :stroke-dasharray="REFRESH_RING_CIRCUMFERENCE"
              :stroke-dashoffset="REFRESH_RING_CIRCUMFERENCE * (1 - refreshProgress)"
              transform="rotate(-90 8 8)"
            />
          </svg>
          <span class="mm-refresh-ring__label">{{ secondsUntilRefresh }}s</span>
        </span>
      </div>
      <MmInstallationLinks />
    </div>

    <!-- compact hero band: headline + stat strip merged -->
    <div class="mm-landing__hero-only mm-landing__hero-band">
      <div>
        <div class="mm-meta-row" style="margin-bottom: 12px;">
          <span class="mm-chip" :class="{ 'mm-chip--off': networkStatus.tone === 'off' }">
            <span class="mm-chip__dot" />
            {{ networkStatus.label }}
          </span>
          <span class="mm-meta-row__sep">·</span>
          refresh in <span class="mm-meta-row__strong">{{ secondsUntilRefresh }}s</span>
        </div>
        <div class="mm-display" style="font-size: 58px; line-height: 1;">
          <span v-if="isInitialLoad" class="mm-skeleton" style="width: 80px; height: 1em; display: inline-block; vertical-align: middle"></span>
          <template v-else>
            <span>{{ formatNumber(totalPlayers) }}</span>
            <span style="color: var(--mm-ink-soft); font-style: italic; margin-left: 0.25em;">in combat</span>
          </template>
        </div>
      </div>
      <div style="display: flex; align-items: stretch;">
        <div style="padding: 4px 36px 4px 0;">
          <div class="mm-stats__label">Players online</div>
          <div class="mm-stat__value" :class="loadClass(totalCapacity ? totalPlayers / totalCapacity : 0)" style="font-size: 27px;">
            <div v-if="isInitialLoad" class="mm-skeleton" style="width: 40px; height: 1em;"></div>
            <template v-else>{{ formatNumber(totalPlayers) }}</template>
          </div>
          <div class="mm-stat__delta">
            <div v-if="isInitialLoad" class="mm-skeleton" style="width: 80px; height: 1em;"></div>
            <template v-else>of {{ formatNumber(totalCapacity) }} capacity</template>
          </div>
        </div>
        <div style="padding: 4px 36px; border-left: 1px solid var(--mm-rule);">
          <div class="mm-stats__label">Active servers</div>
          <div class="mm-stat__value" style="font-size: 27px;">
            <div v-if="isInitialLoad" class="mm-skeleton" style="width: 30px; height: 1em;"></div>
            <template v-else>{{ formatNumber(activeCount) }}</template>
          </div>
          <div class="mm-stat__delta">
            <div v-if="isInitialLoad" class="mm-skeleton" style="width: 80px; height: 1em;"></div>
            <template v-else>of {{ formatNumber(servers.length) }} tracked</template>
          </div>
        </div>
        <div style="padding: 4px 36px; border-left: 1px solid var(--mm-rule);">
          <div class="mm-stats__label">Network load</div>
          <div class="mm-stat__value" :class="loadClass(loadPercent / 100)" style="font-size: 27px;">
            <div v-if="isInitialLoad" class="mm-skeleton" style="width: 40px; height: 1em;"></div>
            <template v-else>{{ loadPercent }}<span class="mm-stat__suffix">%</span></template>
          </div>
          <div class="mm-stat__delta">across all hosts</div>
        </div>
        <div style="padding: 4px 0 4px 36px; border-left: 1px solid var(--mm-rule); max-width: 220px;">
          <div class="mm-stats__label">Top server</div>
          <div class="mm-stat__value" style="font-size: 27px;">
            <div v-if="isInitialLoad" class="mm-skeleton" style="width: 60px; height: 1em;"></div>
            <template v-else-if="topServer">
              <span :class="loadClass(topServer.maxPlayers ? topServer.numPlayers / topServer.maxPlayers : 0)">
                {{ topServer.numPlayers }}</span><span class="mm-stat__suffix">/{{ topServer.maxPlayers }}</span>
            </template>
            <template v-else>—</template>
          </div>
          <div class="mm-stat__delta" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            <div v-if="isInitialLoad" class="mm-skeleton" style="width: 100px; height: 1em;"></div>
            <template v-else>{{ topServer ? topServer.name : 'awaiting feed' }}</template>
          </div>
        </div>
      </div>
    </div>

    <!-- Mobile-only "Get online" CTA strip (above the list). The inline
         dropdown stays in the top meta row on desktop. -->
    <div class="mm-landing__cta">
      <MmInstallationLinks variant="cta-strip" />
    </div>

    <!-- search-all entry — the list below is live servers only; this finds
         every tracked server (offline / historical) by name. -->
    <div class="mm-landing__search-all">
      <router-link to="/v4/servers/search" class="mm-landing__search-link">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        Search all servers
      </router-link>
    </div>

    <!-- list -->
    <div v-if="loading && servers.length === 0" style="padding: 40px 0">
      <div v-for="i in 6" :key="i" class="mm-skeleton" style="margin-bottom: 12px" />
    </div>

    <div v-else-if="error" class="mm-empty">{{ error }}</div>

    <div v-else-if="servers.length === 0" class="mm-empty">
      No {{ GAME_LABEL }} servers reporting in right now.
    </div>

    <template v-else>
      <!-- Section bar is the anchor for the mobile card list — on
           desktop, the table <thead> below already carries the olive
           header treatment, so showing both produces a stacked strip. -->
      <div class="mm-section-bar mm-only-mobile">
        <span># SERVER</span>
        <span class="mm-section-bar__meta">PLAYERS · LOAD</span>
      </div>

      <!-- Mobile rendering — bespoke card matching mock #1: rank +
           name-stack on the left, players value over load bar on the right. -->
      <ol class="mm-landing__mobile">
        <li
          v-for="(s, idx) in activeServers"
          :key="`m-${s.guid}`"
          class="mm-landing__mcard"
          @click="goServer(s)"
        >
          <span class="mm-landing__mrank">{{ String(idx + 1).padStart(2, '0') }}</span>
          <div class="mm-landing__mbody">
            <div class="mm-landing__mtitle">{{ s.name }}</div>
            <div class="mm-landing__msub">{{ s.ip }}:{{ s.port }}</div>
            <div v-if="s.mapName || s.country" class="mm-landing__msub mm-landing__msub--alt">
              <template v-if="s.mapName">{{ s.mapName }}</template>
              <template v-if="s.mapName && s.country"> · </template>
              <template v-if="s.country"><span class="mm-landing__flag">{{ countryCodeToFlag(s.country) }}</span> {{ friendlyCountry(s.country) }}</template>
            </div>
          </div>
          <div class="mm-landing__mright">
            <div class="mm-landing__mplayers">
              <span :class="loadClass(s.maxPlayers ? s.numPlayers / s.maxPlayers : 0)">{{ s.numPlayers }}</span><span style="color: var(--mm-ink-faint)">/{{ s.maxPlayers }}</span>
            </div>
            <div class="mm-list__bar mm-landing__mbar" :title="`${s.maxPlayers ? Math.round((s.numPlayers / s.maxPlayers) * 100) : 0}%`">
              <div
                class="mm-list__bar-fill"
                :class="{
                  'mm-list__bar-fill--accent': s.maxPlayers && s.numPlayers / s.maxPlayers >= 0.66,
                  'mm-list__bar-fill--idle': !s.numPlayers,
                }"
                :style="{ width: (s.maxPlayers ? Math.min(100, (s.numPlayers / s.maxPlayers) * 100) : 0) + '%' }"
              />
            </div>
          </div>
        </li>
      </ol>

      <!-- Condensed grid or full-width container -->
      <div :class="selectedServer ? 'mm-landing__grid' : 'mm-landing__full'">
        <div class="mm-landing__list-container">
          <div v-if="activeServers.length === 0" class="mm-empty" style="padding: 20px 0;">
            No active servers right now.
          </div>
          <table v-else class="mm-list mm-list--dense mm-landing__desktop">
            <thead>
              <tr>
                <th style="width: 40px"></th>
                <th>Server</th>
                <th class="mm-list__col--hide-condensed" style="width: 25%;">Map</th>
                <th class="mm-list__col--hide-condensed" style="width: 20%;">Region</th>
                <th class="is-num" style="width: 100px">Players</th>
                <th class="is-num" style="width: 90px">Load</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(s, idx) in activeServers"
                :key="s.guid"
                :class="{ 'mm-landing__row--selected': selectedServer?.guid === s.guid }"
                @click="handleRowClick(s)"
              >
                <td class="mm-list__rank is-muted">{{ String(idx + 1).padStart(2, '0') }}</td>
                <td class="mm-list__name-cell">
                  <div class="mm-list__name">
                    <span class="mm-list__name-primary">{{ s.name }}</span>
                    <!-- Subline normal (visible when full-width or mobile) -->
                    <span class="mm-list__name-sub mm-landing__sub-normal">
                      {{ s.ip }}:{{ s.port }}
                      <template v-if="s.mapName"> · {{ s.mapName }}</template>
                      <template v-if="s.country"> · {{ friendlyCountry(s.country) }}</template>
                    </span>
                    <!-- Subline folded (visible when condensed on desktop) -->
                    <span class="mm-list__name-sub mm-landing__sub-folded">
                      <span v-if="s.country" class="mm-landing__flag" :title="friendlyCountry(s.country)">{{ countryCodeToFlag(s.country) }}</span>
                      {{ s.country ? friendlyCountry(s.country).toUpperCase() : '' }}
                      <template v-if="s.mapName"> · {{ s.mapName.toUpperCase() }}</template>
                      · {{ s.ip }}:{{ s.port }}
                    </span>
                  </div>
                </td>
                <td class="is-muted mm-list__col--hide-sm mm-list__col--hide-condensed" data-cell-label="Map">{{ s.mapName || '—' }}</td>
                <td class="is-muted mm-list__col--hide-sm mm-list__col--hide-condensed" data-cell-label="Region">
                  <span v-if="s.country" class="mm-landing__flag" :title="friendlyCountry(s.country)">{{ countryCodeToFlag(s.country) }}</span>
                  <span>{{ friendlyCountry(s.country) }}</span>
                </td>
                <td class="is-num" data-cell-label="Players">
                  <span :class="loadClass(s.maxPlayers ? s.numPlayers / s.maxPlayers : 0)">{{ s.numPlayers }}</span>
                  <span style="color: var(--mm-ink-faint)"> / {{ s.maxPlayers }}</span>
                </td>
                <td class="is-num" data-cell-label="Load">
                  <div class="mm-list__bar" :title="`${s.maxPlayers ? Math.round((s.numPlayers / s.maxPlayers) * 100) : 0}%`">
                    <div
                      class="mm-list__bar-fill"
                      :class="{
                        'mm-list__bar-fill--accent': s.maxPlayers && s.numPlayers / s.maxPlayers >= 0.66,
                        'mm-list__bar-fill--idle': !s.numPlayers,
                      }"
                      :style="{ width: (s.maxPlayers ? Math.min(100, (s.numPlayers / s.maxPlayers) * 100) : 0) + '%' }"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <!-- Quiet servers list below active servers -->
          <div v-if="showQuiet && quietServers.length > 0">
            <div class="mm-landing__quiet-header">
              <span class="mm-eyebrow">Quiet · {{ quietServers.length }} hosts standing by</span>
              <hr class="mm-rule" />
            </div>
            <div class="mm-landing__quiet-grid">
              <div
                v-for="s in quietServers"
                :key="s.guid"
                class="mm-landing__quiet-cell"
                @click="goServer(s)"
              >
                <span class="mm-landing__quiet-name" :title="s.name">{{ s.name }}</span>
                <span class="mm-landing__quiet-meta">
                  {{ s.country ? s.country.toUpperCase() : '—' }} · 0/{{ s.maxPlayers }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Sticky selected server aside panel -->
        <aside v-if="selectedServer" class="mm-landing__aside">
          <div class="mm-landing__aside-head">
            <div>
              <span class="mm-eyebrow">Selected host</span>
              <div class="mm-landing__aside-title-row">
                <span class="mm-landing__aside-title" :title="selectedServer.name">{{ selectedServer.name }}</span>
                <span class="mm-chip mm-chip--live"><span class="mm-chip__dot"></span>Online</span>
              </div>
              <div class="mm-meta-row" style="margin-top: 8px;">
                <span v-if="selectedServer.country" class="mm-landing__flag" :title="friendlyCountry(selectedServer.country)">{{ countryCodeToFlag(selectedServer.country) }}</span>
                <span>{{ friendlyCountry(selectedServer.country) }}</span>
                <span class="mm-meta-row__sep">·</span>{{ selectedServer.ip }}:{{ selectedServer.port }}
                <span v-if="averagePing !== null" class="mm-meta-row__sep">·</span>
                <span v-if="averagePing !== null">avg ping <span class="mm-meta-row__strong">{{ averagePing }}ms</span></span>
              </div>
            </div>
            <button @click="selectedServer = null" type="button" title="Close panel" class="mm-landing__aside-close">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 1l10 10M11 1L1 11"></path></svg>
            </button>
          </div>

          <div class="mm-landing__aside-stats">
            <div class="mm-landing__aside-stat-cell">
              <div class="mm-stats__label">Now playing</div>
              <div class="mm-stat__value mm-stat__value--small" style="margin-top: 6px;">{{ selectedServer.mapName || '—' }}</div>
              <div class="mm-stat__delta">{{ selectedServer.gameType || 'Conquest' }}</div>
            </div>
            <div class="mm-landing__aside-stat-cell">
              <div class="mm-stats__label">Round ends</div>
              <div class="mm-stat__value mm-stat__value--small" style="margin-top: 6px; font-family: var(--mm-font-mono);">
                {{ formattedTimeRemaining }}
              </div>
              <div class="mm-stat__delta">of {{ formattedTotalRoundTime }}</div>
            </div>
            <div class="mm-landing__aside-stat-cell">
              <div class="mm-stats__label">Population</div>
              <div class="mm-stat__value mm-stat__value--small" style="margin-top: 6px;">
                {{ selectedServer.numPlayers }}<span class="mm-stat__suffix">/{{ selectedServer.maxPlayers }}</span>
              </div>
              <div class="mm-stat__delta">{{ Math.round((selectedServer.numPlayers / (selectedServer.maxPlayers || 1)) * 100) }}% full</div>
            </div>
          </div>

          <div class="mm-section-bar" style="margin-top: 0;">
            <span># LIVE ROSTER</span>
            <span class="mm-section-bar__meta">{{ selectedServer.numPlayers }} PLAYING · SORTED BY SCORE</span>
          </div>

          <div v-if="selectedServer.players && selectedServer.players.length > 0" class="mm-landing__aside-roster">
            <div
              v-for="team in selectedServer.teams"
              :key="team.index"
              class="mm-landing__aside-team"
              :class="{ 'mm-landing__aside-team--left': team.index === 1 }"
            >
              <div class="mm-landing__aside-team-header">
                <span
                  class="mm-landing__aside-team-label"
                  :style="{ color: getTeamColor(team.label || '') }"
                >
                  {{ team.label || `Team ${team.index}` }} · {{ getTeamPlayerCount(selectedServer, team.index) }}
                </span>
                <span class="mm-landing__aside-tickets">
                  TICKETS <span :style="{ color: getTeamColor(team.label || '') }">{{ team.tickets }}</span>
                </span>
              </div>
              <table class="mm-list mm-list--dense">
                <tbody>
                  <tr
                    v-for="(player, pidx) in getSortedTeamPlayers(selectedServer, team.index)"
                    :key="player.name"
                    :class="getPlayerRowClass(team, pidx)"
                  >
                    <td class="mm-list__rank" style="width: 30px;">
                      {{ String(pidx + 1).padStart(2, '0') }}
                    </td>
                    <td class="mm-list__name-cell">
                      <span class="mm-list__name-primary">{{ player.name }}</span>
                    </td>
                    <td class="is-num">
                      <span class="mm-num--kill">{{ player.kills }}</span>
                      <span class="mm-num__sep">/</span>
                      <span class="mm-num--death">{{ player.deaths }}</span>
                    </td>
                    <td class="is-num">{{ formatNumber(player.score) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div v-else class="mm-empty" style="padding: 30px;">
            No players online
          </div>

          <div class="mm-landing__aside-foot">
            <router-link :to="`/v4/servers/detail/${encodeURIComponent(selectedServer.name)}`" class="mm-landing__aside-full-link">
              Full server view ↗
            </router-link>
            <span style="font-family: var(--mm-font-mono); font-size: 10px; letter-spacing: .08em; color: #555;">
              REFRESH {{ secondsUntilRefresh }}S
            </span>
          </div>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mm-landing__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 14px;
}

.mm-landing__roster-btn {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: 1px solid var(--mm-rule);
  padding: 4px 10px;
  border-radius: 2px;
}

.mm-landing__roster-btn:hover:not(:disabled) {
  border-color: var(--mm-ink);
  color: var(--mm-ink);
}

.mm-landing__roster-btn:disabled {
  color: var(--mm-ink-faint);
  border-color: var(--mm-rule);
  cursor: not-allowed;
}

.mm-landing__search-all {
  display: flex;
  justify-content: flex-end;
  margin-top: 20px;
}

.mm-landing__search-link {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: var(--mm-font-mono);
  font-size: 11.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
  text-decoration: none;
  padding: 7px 12px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  transition: color 0.15s, border-color 0.15s;
}

.mm-landing__search-link:hover {
  color: var(--mm-accent);
  border-color: var(--mm-accent);
}

@media (max-width: 640px) {
  .mm-landing__search-all { justify-content: stretch; }
  .mm-landing__search-link { flex: 1; justify-content: center; }
}

/* CTA strip only shows on mobile — desktop keeps the inline install button
   in the meta row. */
.mm-landing__cta { display: none; margin-top: 24px; }
@media (max-width: 640px) {
  .mm-landing__cta { display: block; }
  /* Inline install dropdown in the top meta row collapses on mobile —
     the CTA strip takes over. */
  .mm-landing__top .mm-install { display: none; }
  /* Hero text + stat grid hide on mobile — meta row carries enough
     summary, and the user goes straight to the servers list. */
  .mm-landing__hero-only { display: none; }
}

/* Desktop/mobile swap for the servers list. Card layout on mobile matches
   mock #1: rank · name-stack · players + bar stacked on the right. */
.mm-landing__mobile {
  display: none;
  list-style: none;
  margin: 0;
  padding: 0;
}

@media (max-width: 720px) {
  .mm-landing__desktop { display: none; }
  .mm-landing__mobile { display: flex; flex-direction: column; }
}

.mm-landing__mcard {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  gap: 4px 12px;
  align-items: start;
  padding: 12px 0;
  border-bottom: 1px solid var(--mm-rule);
  cursor: pointer;
}
.mm-landing__mcard:last-child { border-bottom: 0; }

.mm-landing__mrank {
  grid-row: 1 / span 3;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--mm-ink-muted);
  align-self: start;
  padding-top: 2px;
}

.mm-landing__mbody { min-width: 0; }

.mm-landing__mtitle {
  font-family: var(--mm-font-display);
  font-size: 15px;
  font-weight: 500;
  color: var(--mm-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-landing__msub {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-landing__msub--alt {
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.mm-landing__mright {
  grid-row: 1 / span 3;
  grid-column: 3;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  min-width: 80px;
}

.mm-landing__mplayers {
  font-family: var(--mm-font-mono);
  font-size: 14px;
  font-weight: 500;
}

.mm-landing__mbar {
  width: 80px;
}

/* Flag emoji needs an explicit emoji font stack — otherwise some
   browsers fall back to the monochrome regional-indicator letters. */
.mm-landing__flag {
  font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
  font-size: 1.05em;
  margin-right: 4px;
  vertical-align: -0.05em;
}

.mm-refresh-ring {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  vertical-align: middle;
  color: var(--mm-ink-soft);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.04em;
}

.mm-refresh-ring svg {
  display: block;
}

.mm-refresh-ring svg circle:last-child {
  transition: stroke-dashoffset 1s linear;
}

.mm-refresh-ring__label {
  min-width: 22px;
  text-align: left;
}

/* Merged compact hero band */
.mm-landing__hero-band {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 40px;
  padding: 30px 0 26px;
  border-bottom: 1px solid var(--mm-rule);
  flex-wrap: wrap;
}

/* Grid layout for active list + details sidebar */
.mm-landing__grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 32px;
  align-items: start;
  margin-top: 26px;
}

@media (min-width: 1024px) {
  .mm-landing__grid {
    grid-template-columns: 1fr 660px;
  }
}

.mm-landing__full {
  margin-top: 26px;
}

/* Server table condensed styling */
@media (min-width: 1024px) {
  .mm-landing__grid .mm-list__col--hide-condensed {
    display: none;
  }
}

/* Sub-line folded/normal control */
.mm-landing__sub-folded {
  display: none;
}
.mm-landing__sub-normal {
  display: inline;
}

@media (min-width: 1024px) {
  .mm-landing__grid .mm-landing__sub-folded {
    display: inline-block;
    margin-top: 2px;
  }
  .mm-landing__grid .mm-landing__sub-normal {
    display: none;
  }
}

/* Row selection state */
.mm-landing__row--selected {
  background: #1a1a1a !important;
  box-shadow: inset 2px 0 0 var(--mm-accent);
}

.mm-landing__desktop tbody tr {
  cursor: pointer;
}

/* Sticky selected server aside panel */
.mm-landing__aside {
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  position: sticky;
  top: 24px;
  background: #131313;
  width: 100%;
}

@media (max-width: 1023px) {
  .mm-landing__aside {
    display: none;
  }
}

.mm-landing__aside-head {
  padding: 18px 22px 16px;
  border-bottom: 1px solid var(--mm-rule);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.mm-landing__aside-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}

.mm-landing__aside-title {
  font-family: var(--mm-font-display);
  font-size: 21px;
  font-weight: 400;
  color: var(--mm-ink);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 480px;
}

.mm-landing__aside-close {
  background: transparent;
  border: 1px solid #3d3d3d;
  border-radius: 2px;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  color: var(--mm-ink-soft);
  cursor: pointer;
  flex: 0 0 auto;
  transition: border-color 0.15s, color 0.15s;
}

.mm-landing__aside-close:hover {
  border-color: var(--mm-ink);
  color: var(--mm-ink);
}

.mm-landing__aside-stats {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  border-bottom: 1px solid var(--mm-rule);
}

.mm-landing__aside-stat-cell {
  padding: 14px 22px;
  border-right: 1px solid var(--mm-rule);
  min-width: 0;
}

.mm-landing__aside-stat-cell:last-child {
  border-right: 0;
}

.mm-landing__aside-roster {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.mm-landing__aside-team {
  min-width: 0;
}

.mm-landing__aside-team--left {
  border-right: 1px solid var(--mm-rule);
}

.mm-landing__aside-team-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 12px 18px 10px;
  border-bottom: 1px solid var(--mm-rule);
}

.mm-landing__aside-team-label {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: .12em;
  text-transform: uppercase;
}

.mm-landing__aside-tickets {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: .08em;
  color: var(--mm-ink-soft);
}

.mm-landing__aside-foot {
  padding: 14px 22px;
  border-top: 1px solid var(--mm-rule);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.mm-landing__aside-full-link {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--mm-ink);
  text-decoration: none;
  transition: color 0.15s;
}

.mm-landing__aside-full-link:hover {
  color: var(--mm-accent);
}

/* Quiet servers styling */
.mm-landing__quiet-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 34px 0 14px;
}

.mm-landing__quiet-header hr {
  flex: 1;
  margin: 0;
}

.mm-landing__quiet-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  column-gap: 40px;
}

@media (max-width: 768px) {
  .mm-landing__quiet-grid {
    grid-template-columns: 1fr;
  }
}

.mm-landing__quiet-cell {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  padding: 9px 0;
  border-bottom: 1px solid #222;
  min-width: 0;
  cursor: pointer;
}

.mm-landing__quiet-cell:hover .mm-landing__quiet-name {
  color: var(--mm-accent);
}

.mm-landing__quiet-name {
  font-size: 13px;
  color: var(--mm-ink-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.15s;
}

.mm-landing__quiet-meta {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: .06em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
