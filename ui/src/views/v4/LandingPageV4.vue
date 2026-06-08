<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchAllServers } from '@/services/serverDetailsService'
import type { ServerSummary } from '@/types/server'
import { countryCodeToName, countryCodeToFlag } from '@/types/countryCodes'
import { loadClass } from './mmTokens'
import MmInstallationLinks from '@/components/v4/MmInstallationLinks.vue'
import MmPlayersPanel from '@/components/v4/MmPlayersPanel.vue'

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

const load = async (showSpinner = false) => {
  if (showSpinner) loading.value = true
  error.value = null
  try {
    const data = await fetchAllServers(game.value)
    servers.value = [...data].sort((a, b) => (b.numPlayers || 0) - (a.numPlayers || 0))
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

const selectedServer = ref<ServerSummary | null>(null)
const showRoster = ref(false)

const openRoster = (s: ServerSummary) => {
  selectedServer.value = s
  showRoster.value = true
}

const closeRoster = () => {
  showRoster.value = false
}

const isInitialLoad = computed(() => loading.value && servers.value.length === 0)
</script>

<template>
  <div class="mm-container mm-section">
    <!-- meta row -->
    <div class="mm-landing__top">
      <div class="mm-meta-row">
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

    <!-- editorial hero -->
    <h1 class="mm-display mm-landing__hero-only">
      <span v-if="isInitialLoad" class="mm-skeleton" style="width: 80px; height: 1em; display: inline-block; vertical-align: middle"></span>
      <span v-else :class="loadClass(totalCapacity ? totalPlayers / totalCapacity : 0)">{{ formatNumber(totalPlayers) }}</span>
      <span class="mm-display__muted" style="margin-left: 0.3em">in combat</span>
    </h1>
    <p class="mm-display mm-landing__hero-only" style="font-size: clamp(20px, 2vw, 26px); margin-top: 8px; color: var(--mm-ink-soft)">
      across
      <span v-if="isInitialLoad" class="mm-skeleton" style="width: 30px; height: 1em; display: inline-block; vertical-align: middle"></span>
      <template v-else>{{ formatNumber(activeCount) }}</template>
      live {{ GAME_LABEL }} servers tonight.
    </p>

    <hr class="mm-rule mm-landing__hero-only" style="margin-top: 32px" />

    <!-- stat strip -->
    <div class="mm-stats mm-landing__hero-only" style="border-top: 0; margin-top: 0">
      <div class="mm-stats__cell">
        <div class="mm-stats__label">Players online</div>
        <div class="mm-stat__value" :class="loadClass(totalCapacity ? totalPlayers / totalCapacity : 0)">
          <div v-if="isInitialLoad" class="mm-skeleton" style="width: 60px; height: 1em; display: inline-block; vertical-align: middle"></div>
          <template v-else>{{ formatNumber(totalPlayers) }}</template>
        </div>
        <div class="mm-stat__delta">
          <div v-if="isInitialLoad" class="mm-skeleton" style="width: 100px; height: 1em; display: inline-block; vertical-align: middle"></div>
          <template v-else>of {{ formatNumber(totalCapacity) }} capacity</template>
        </div>
      </div>
      <div class="mm-stats__cell">
        <div class="mm-stats__label">Active servers</div>
        <div class="mm-stat__value">
          <div v-if="isInitialLoad" class="mm-skeleton" style="width: 40px; height: 1em; display: inline-block; vertical-align: middle"></div>
          <template v-else>{{ formatNumber(activeCount) }}</template>
        </div>
        <div class="mm-stat__delta">
          <div v-if="isInitialLoad" class="mm-skeleton" style="width: 80px; height: 1em; display: inline-block; vertical-align: middle"></div>
          <template v-else>of {{ formatNumber(servers.length) }} tracked</template>
        </div>
      </div>
      <div class="mm-stats__cell">
        <div class="mm-stats__label">Network load</div>
        <div class="mm-stat__value" :class="loadClass(loadPercent / 100)">
          <div v-if="isInitialLoad" class="mm-skeleton" style="width: 60px; height: 1em; display: inline-block; vertical-align: middle"></div>
          <template v-else>{{ loadPercent }}<span class="mm-stat__suffix">%</span></template>
        </div>
        <div class="mm-stat__delta">
          <div v-if="isInitialLoad" class="mm-skeleton" style="width: 80px; height: 1em; display: inline-block; vertical-align: middle"></div>
          <template v-else>across all hosts</template>
        </div>
      </div>
      <div class="mm-stats__cell">
        <div class="mm-stats__label">Top server</div>
        <div v-if="isInitialLoad" class="mm-stat__value mm-stat__value--small">
          <div class="mm-skeleton" style="width: 60px; height: 1em; display: inline-block; vertical-align: middle"></div>
        </div>
        <div v-else-if="topServer" class="mm-stat__value mm-stat__value--small" :title="topServer.name">
          <span :class="loadClass(topServer.maxPlayers ? topServer.numPlayers / topServer.maxPlayers : 0)">
            {{ topServer.numPlayers }}</span><span class="mm-stat__suffix">/{{ topServer.maxPlayers }}</span>
        </div>
        <div v-else class="mm-stat__value mm-stat__value--small">—</div>
        <div class="mm-stat__delta" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis">
          <div v-if="isInitialLoad" class="mm-skeleton" style="width: 120px; height: 1em; display: inline-block; vertical-align: middle"></div>
          <template v-else>{{ topServer ? topServer.name : 'awaiting feed' }}</template>
        </div>
      </div>
    </div>

    <!-- Mobile-only "Get online" CTA strip (above the list). The inline
         dropdown stays in the top meta row on desktop. -->
    <div class="mm-landing__cta">
      <MmInstallationLinks variant="cta-strip" />
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
          v-for="(s, idx) in servers"
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

      <table class="mm-list mm-list--dense mm-landing__desktop">
      <thead>
        <tr>
          <th style="width: 40px"></th>
          <th>Server</th>
          <th>Map</th>
          <th>Region</th>
          <th class="is-num" style="width: 140px">Players</th>
          <th class="is-num" style="width: 100px">Load</th>
          <th style="width: 90px"></th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(s, idx) in servers"
          :key="s.guid"
          @click="goServer(s)"
        >
          <td class="mm-list__rank is-muted">{{ String(idx + 1).padStart(2, '0') }}</td>
          <td class="mm-list__name-cell">
            <div class="mm-list__name">
              <span class="mm-list__name-primary">{{ s.name }}</span>
              <span class="mm-list__name-sub">
                {{ s.ip }}:{{ s.port }}
                <template v-if="s.mapName"> · {{ s.mapName }}</template>
                <template v-if="s.country"> · {{ friendlyCountry(s.country) }}</template>
              </span>
            </div>
          </td>
          <td class="is-muted mm-list__col--hide-sm" data-cell-label="Map">{{ s.mapName || '—' }}</td>
          <td class="is-muted mm-list__col--hide-sm" data-cell-label="Region">
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
          <td data-cell-label="" class="mm-list__col--hide-sm">
            <button
              type="button"
              class="mm-btn mm-landing__roster-btn"
              :disabled="(s.numPlayers || 0) === 0"
              :title="(s.numPlayers || 0) === 0 ? 'Empty server' : 'View live roster'"
              @click.stop="openRoster(s)"
            >
              Roster
            </button>
          </td>
        </tr>
      </tbody>
      </table>
    </template>

    <MmPlayersPanel
      :show="showRoster"
      :server="selectedServer"
      @close="closeRoster"
    />
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
</style>
