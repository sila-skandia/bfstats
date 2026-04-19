<template>
  <div class="portal-page sd-v2">
    <div class="portal-grid" aria-hidden="true" />
    <div class="sd-v2-fx" aria-hidden="true">
      <div class="sd-v2-orb sd-v2-orb--cyan" />
      <div class="sd-v2-orb sd-v2-orb--purple" />
    </div>
    <div class="portal-inner">
      <div class="data-explorer sd-v2-explorer">
      <!-- Back to classic -->
      <div class="v3-topbar">
        <span class="v3-topbar__badge">
          <span class="v3-topbar__dot" aria-hidden="true" />
          COMMAND CENTER · BETA
        </span>
        <router-link :to="classicPath" class="v3-topbar__classic">Back to classic browser →</router-link>
      </div>

      <!-- Hero -->
      <section class="v3-hero" :class="`v3-hero--${networkPulseLevel}`">
        <span class="hero-corner hero-corner--tl" aria-hidden="true" />
        <span class="hero-corner hero-corner--tr" aria-hidden="true" />
        <span class="hero-corner hero-corner--bl" aria-hidden="true" />
        <span class="hero-corner hero-corner--br" aria-hidden="true" />
        <div class="v3-hero__left">
          <div class="v3-hero__status">
            <span class="v3-hero__status-dot" aria-hidden="true" />
            {{ networkPulseLabel }} · {{ activeGameLabel }}
          </div>
          <div class="v3-hero__headline">
            <span class="v3-hero__num">{{ totalPlayersOnline.toLocaleString() }}</span>
            <span class="v3-hero__text">in combat across</span>
            <span class="v3-hero__num v3-hero__num--sub">{{ activeServersCount }}</span>
            <span class="v3-hero__text">servers</span>
          </div>
          <div class="v3-hero__search">
            <PlayerSearch
              v-model="playerSearchQuery"
              :full-width="true"
              @select="selectPlayer"
              @enter="navigateToPlayer"
            />
          </div>
        </div>
        <div class="v3-hero__right">
          <div class="v3-hero__stat">
            <div class="v3-hero__stat-label">Load</div>
            <div class="v3-hero__stat-num">{{ capacityUsedPercent }}%</div>
            <div class="v3-hero__stat-bar">
              <div class="v3-hero__stat-fill" :style="{ width: Math.min(100, capacityUsedPercent) + '%' }" />
            </div>
          </div>
          <div class="v3-hero__stat">
            <div class="v3-hero__stat-label">Live hosts</div>
            <div class="v3-hero__stat-num">{{ activeServersCount }}</div>
            <div class="v3-hero__stat-sub">of {{ servers.length }} online</div>
          </div>
        </div>
      </section>

      <!-- Your front -->
      <YourFrontStrip
        v-if="visitedEntries.length > 0"
        :entries="visitedEntries"
        :live-servers="servers"
        @forget="forget"
      />

      <!-- Live rounds ribbon -->
      <LiveRoundsRibbon
        v-if="liveRounds.length > 0"
        :rounds="liveRounds"
      />
      <div
        v-else-if="!loading"
        class="v3-empty"
      >
        <span class="v3-empty__label">LIVE ROUNDS</span>
        <span class="v3-empty__text">Quiet right now — no rounds in progress yet.</span>
      </div>

      <!-- Two-column: recent rounds + heatmap -->
      <div class="v3-pair">
        <RecentRoundsFeed
          :rounds="recentRounds"
          :hours-back="6"
        />
        <NetworkHeatmap
          :cells="networkPulse?.weeklyHeatmap ?? []"
          :recent-trend="networkPulse?.recentTrend ?? []"
          :peak-today="networkPulse?.peakToday ?? null"
        />
      </div>

      <!-- Collapsible classic browser -->
      <section class="v3-browser">
        <button
          type="button"
          class="v3-browser__toggle"
          :aria-expanded="showBrowser"
          @click="showBrowser = !showBrowser"
        >
          <span class="v3-browser__label">SERVER BROWSER</span>
          <span class="v3-browser__count">{{ servers.length }} hosts · {{ activeServersCount }} active</span>
          <span class="v3-browser__chevron" :class="{ 'v3-browser__chevron--open': showBrowser }">▾</span>
        </button>

        <div v-if="showBrowser" class="v3-browser__body">
          <div class="v3-browser__filter">
            <span class="v3-browser__prompt">&gt;</span>
            <input
              v-model="serverFilterQuery"
              type="search"
              class="v3-browser__input"
              placeholder="grep --hosts name,map,ip..."
              aria-label="Filter servers"
            >
          </div>
          <ol class="v3-browser__list">
            <li
              v-for="server in filteredServers"
              :key="server.guid"
              class="v3-browser__row"
            >
              <router-link
                :to="`/servers/${encodeURIComponent(server.name)}`"
                class="v3-browser__name"
              >{{ server.name }}</router-link>
              <span class="v3-browser__players">
                <strong>{{ server.numPlayers }}</strong>/{{ server.maxPlayers }}
              </span>
              <span class="v3-browser__map">{{ server.mapName || '—' }}</span>
              <button
                type="button"
                class="v3-browser__join"
                :disabled="server.numPlayers >= server.maxPlayers"
                @click="joinServer(server)"
              >JOIN</button>
            </li>
          </ol>
        </div>
      </section>

      <!-- Feedback CTA -->
      <div class="v3-feedback">
        <span class="v3-feedback__label">Feedback on the beta?</span>
        <a
          href="https://github.com/anthropics/claude-code/issues"
          class="v3-feedback__link"
          target="_blank"
          rel="noopener noreferrer"
        >Let us know</a>
      </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import PlayerSearch from '@/components/PlayerSearch.vue'
import YourFrontStrip from '@/components/landing-v3/YourFrontStrip.vue'
import LiveRoundsRibbon from '@/components/landing-v3/LiveRoundsRibbon.vue'
import RecentRoundsFeed from '@/components/landing-v3/RecentRoundsFeed.vue'
import NetworkHeatmap from '@/components/landing-v3/NetworkHeatmap.vue'
import { fetchAllServers } from '@/services/serverDetailsService'
import {
  fetchLiveRounds,
  fetchNetworkPulse,
  fetchRecentRoundSummaries,
  type LiveRoundSummary,
  type NetworkPulseResponse,
  type RecentRoundSummary
} from '@/services/landingV3Service'
import { useVisitedServers } from '@/composables/useVisitedServers'
import type { ServerSummary } from '@/types/server'

interface PlayerSearchResult {
  playerName: string
  totalPlayTimeMinutes: number
  lastSeen: string
  isActive: boolean
}

const props = defineProps<{ initialMode?: 'FH2' | '42' | 'BFV' }>()

const router = useRouter()

const resolveGame = (mode?: string): 'bf1942' | 'fh2' | 'bfvietnam' => {
  if (mode === 'FH2') return 'fh2'
  if (mode === 'BFV') return 'bfvietnam'
  return 'bf1942'
}

const activeGame = ref<'bf1942' | 'fh2' | 'bfvietnam'>(resolveGame(props.initialMode))

const servers = ref<ServerSummary[]>([])
const liveRounds = ref<LiveRoundSummary[]>([])
const recentRounds = ref<RecentRoundSummary[]>([])
const networkPulse = ref<NetworkPulseResponse | null>(null)
const loading = ref(true)
const showBrowser = ref(false)
const serverFilterQuery = ref('')
const playerSearchQuery = ref('')
const refreshTimers = ref<{ servers: number | null; rounds: number | null; pulse: number | null }>({
  servers: null,
  rounds: null,
  pulse: null
})

const { visited, recordVisit: _unused, forget } = useVisitedServers()
void _unused

const visitedEntries = computed(() =>
  visited.value.filter(v => v.game === activeGame.value).slice(0, 5)
)

const activeGameLabel = computed(() => {
  if (activeGame.value === 'fh2') return 'FH2'
  if (activeGame.value === 'bfvietnam') return 'BF Vietnam'
  return 'BF1942'
})

const classicPath = computed(() => {
  const g = activeGame.value === 'bfvietnam' ? 'bfv' : activeGame.value
  return `/servers/${g}`
})

const totalPlayersOnline = computed(() =>
  servers.value.reduce((sum, s) => sum + (s.numPlayers || 0), 0)
)

const activeServersCount = computed(() =>
  servers.value.filter(s => (s.numPlayers || 0) > 0).length
)

const totalCapacity = computed(() =>
  servers.value.reduce((sum, s) => sum + (s.maxPlayers || 0), 0)
)

const capacityUsedPercent = computed(() => {
  const cap = totalCapacity.value
  return cap > 0 ? Math.round((totalPlayersOnline.value / cap) * 100) : 0
})

const networkPulseLevel = computed<'very_busy' | 'busy' | 'moderate' | 'quiet'>(() => {
  const pct = capacityUsedPercent.value
  if (pct >= 50) return 'very_busy'
  if (pct >= 25) return 'busy'
  if (pct >= 5) return 'moderate'
  return 'quiet'
})

const networkPulseLabel = computed(() => {
  switch (networkPulseLevel.value) {
    case 'very_busy': return 'PEAK COMBAT'
    case 'busy': return 'ACTIVE FRONT'
    case 'moderate': return 'OPERATIONAL'
    default: return 'STANDING BY'
  }
})

const filteredServers = computed(() => {
  const q = serverFilterQuery.value.trim().toLowerCase()
  const base = [...servers.value].sort((a, b) => b.numPlayers - a.numPlayers)
  if (!q) return base
  return base.filter(s =>
    (s.name || '').toLowerCase().includes(q) ||
    (s.mapName || '').toLowerCase().includes(q) ||
    `${s.ip}:${s.port}`.toLowerCase().includes(q)
  )
})

const loadServers = async (): Promise<void> => {
  try {
    const data = await fetchAllServers(activeGame.value)
    servers.value = data
  } catch (err) {
    console.error('V3: failed to load servers', err)
  }
}

const loadLiveRounds = async (): Promise<void> => {
  try {
    liveRounds.value = await fetchLiveRounds(activeGame.value, 12)
  } catch (err) {
    console.error('V3: failed to load live rounds', err)
  }
}

const loadRecentRounds = async (): Promise<void> => {
  try {
    recentRounds.value = await fetchRecentRoundSummaries(activeGame.value, 10, 6)
  } catch (err) {
    console.error('V3: failed to load recent rounds', err)
  }
}

const loadNetworkPulse = async (): Promise<void> => {
  try {
    networkPulse.value = await fetchNetworkPulse(activeGame.value, 12)
  } catch (err) {
    console.error('V3: failed to load network pulse', err)
  }
}

const refreshAll = async (): Promise<void> => {
  loading.value = true
  await Promise.all([loadServers(), loadLiveRounds(), loadRecentRounds(), loadNetworkPulse()])
  loading.value = false
}

const selectPlayer = (player: PlayerSearchResult): void => {
  playerSearchQuery.value = player.playerName
  router.push(`/players/${encodeURIComponent(player.playerName)}`)
}

const navigateToPlayer = (): void => {
  const q = playerSearchQuery.value.trim()
  if (q) router.push(`/players/${encodeURIComponent(q)}`)
}

const joinServer = (server: ServerSummary): void => {
  const joinUrl = `bf1942://${server.ip}:${server.port}`
  const newWindow = window.open(joinUrl, '_blank', 'noopener,noreferrer')
  if (newWindow) {
    newWindow.blur()
    window.focus()
  }
}

watch(() => props.initialMode, (mode) => {
  activeGame.value = resolveGame(mode)
  refreshAll()
})

onMounted(() => {
  refreshAll()
  refreshTimers.value.servers = window.setInterval(loadServers, 60_000)
  refreshTimers.value.rounds = window.setInterval(() => {
    loadLiveRounds()
    loadRecentRounds()
  }, 60_000)
  refreshTimers.value.pulse = window.setInterval(loadNetworkPulse, 180_000)
})

onUnmounted(() => {
  for (const key of ['servers', 'rounds', 'pulse'] as const) {
    const id = refreshTimers.value[key]
    if (id != null) window.clearInterval(id)
  }
})
</script>

<style src="./portal-layout.css"></style>
<style src="./ExplorerTheme.css"></style>
<style>
/* Shared sd-v2 palette + orbs + corner brackets, copied from ServerDetails.vue.css
   so the command-center page wears the same cyan/purple futuristic skin. */
.sd-v2 {
  --sd-cyan: #00e5ff;
  --sd-cyan-soft: rgba(0, 229, 255, 0.18);
  --sd-cyan-glow: rgba(0, 229, 255, 0.45);
  --sd-purple: #c084fc;
  --sd-purple-soft: rgba(192, 132, 252, 0.18);
  --sd-bg: #0a0a0f;
  --sd-panel: rgba(13, 13, 24, 0.82);
  --sd-border: rgba(48, 54, 61, 0.55);
  --sd-border-hot: rgba(0, 229, 255, 0.35);
  background: var(--sd-bg);
  color: #cbd5e1;
}
.sd-v2 .sd-v2-fx {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}
.sd-v2 .sd-v2-orb {
  position: absolute;
  width: 46%;
  height: 46%;
  border-radius: 50%;
  filter: blur(120px);
  opacity: 0.9;
}
.sd-v2 .sd-v2-orb--cyan { top: -14%; left: -12%; background: rgba(0, 229, 255, 0.08); }
.sd-v2 .sd-v2-orb--purple { bottom: -14%; right: -12%; background: rgba(168, 85, 247, 0.08); }

.sd-v2 .portal-grid {
  background-image:
    linear-gradient(rgba(0, 229, 255, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 229, 255, 0.04) 1px, transparent 1px);
  background-size: 48px 48px;
}

.sd-v2 .data-explorer.sd-v2-explorer {
  --neon-cyan: #00e5ff;
  --accent-rgb: 0, 229, 255;
  --bg-dark: #0a0a0f;
  --bg-panel: rgba(13, 13, 24, 0.82);
  --bg-card: rgba(22, 27, 34, 0.78);
  --border-color: rgba(48, 54, 61, 0.55);
  --portal-accent: #00e5ff;
  --portal-accent-dim: rgba(0, 229, 255, 0.12);
  --portal-accent-glow: rgba(0, 229, 255, 0.25);
  --portal-border: rgba(48, 54, 61, 0.55);
  --portal-surface: rgba(13, 13, 24, 0.82);
  --portal-text: #8b949e;
  --portal-text-bright: #e6edf3;
}

.sd-v2 :focus-visible { outline-color: var(--sd-cyan) !important; }

/* Hero corner brackets — tiny L-shaped brackets in the corners of featured cards */
.sd-v2 .hero-corner {
  position: absolute;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--sd-cyan);
  opacity: 0.55;
  pointer-events: none;
}
.sd-v2 .hero-corner--tl { top: 8px; left: 8px; border-right: none; border-bottom: none; }
.sd-v2 .hero-corner--tr { top: 8px; right: 8px; border-left: none; border-bottom: none; }
.sd-v2 .hero-corner--bl { bottom: 8px; left: 8px; border-right: none; border-top: none; }
.sd-v2 .hero-corner--br { bottom: 8px; right: 8px; border-left: none; border-top: none; }
</style>
<style scoped>
.v3-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.25rem 0 0.5rem;
  font-size: 0.72rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.v3-topbar__badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--portal-accent);
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  text-shadow: 0 0 8px var(--portal-accent-glow);
}
.v3-topbar__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--portal-accent);
  box-shadow: 0 0 10px var(--portal-accent);
  animation: v3-dot-pulse 2.2s infinite ease-in-out;
}
@keyframes v3-dot-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 10px var(--portal-accent); }
  50% { opacity: 0.7; box-shadow: 0 0 4px var(--portal-accent); }
}
.v3-topbar__classic {
  color: var(--portal-text);
  text-decoration: none;
  opacity: 0.8;
}
.v3-topbar__classic:hover { color: var(--portal-accent); opacity: 1; }

.v3-hero {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
  padding: 1.25rem 1.25rem 1.35rem;
  background: var(--portal-surface);
  border: 1px solid var(--portal-border);
  border-radius: 10px;
  position: relative;
  overflow: hidden;
  margin-bottom: 1rem;
  box-shadow: 0 0 30px rgba(0, 229, 255, 0.05), inset 0 1px 0 rgba(255, 255, 255, 0.03);
}
.v3-hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at top right, rgba(0, 229, 255, 0.12), transparent 60%);
  pointer-events: none;
}
.v3-hero--very_busy::before { background: radial-gradient(ellipse at top right, rgba(248, 113, 113, 0.18), transparent 60%); }
.v3-hero--busy::before { background: radial-gradient(ellipse at top right, rgba(251, 191, 36, 0.15), transparent 60%); }
.v3-hero--quiet::before { background: radial-gradient(ellipse at top right, rgba(192, 132, 252, 0.12), transparent 60%); }

.v3-hero__left { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 0.6rem; }
.v3-hero__status {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  color: var(--portal-accent);
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  width: fit-content;
  text-shadow: 0 0 10px var(--portal-accent-glow);
}
.v3-hero__status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #34d399;
  box-shadow: 0 0 10px rgba(52, 211, 153, 0.6);
}
.v3-hero--very_busy .v3-hero__status-dot { background: #f87171; box-shadow: 0 0 10px rgba(248, 113, 113, 0.6); }
.v3-hero--busy .v3-hero__status-dot { background: #fbbf24; box-shadow: 0 0 10px rgba(251, 191, 36, 0.6); }
.v3-hero__headline {
  font-size: clamp(1.35rem, 4vw, 2rem);
  line-height: 1.2;
  color: var(--portal-text-bright);
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.35rem;
}
.v3-hero__num {
  font-weight: 800;
  color: var(--portal-accent);
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 12px var(--portal-accent-glow);
  font-family: 'JetBrains Mono', monospace;
}
.v3-hero__num--sub { font-size: 0.85em; color: var(--portal-text-bright); }
.v3-hero__text { color: var(--portal-text); font-size: 0.9em; }
.v3-hero__search { max-width: 520px; }

.v3-hero__right {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.6rem;
  position: relative;
  z-index: 1;
}
.v3-hero__stat {
  padding: 0.6rem 0.75rem;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--portal-border);
  border-radius: 6px;
}
.v3-hero__stat-label {
  font-size: 0.68rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--portal-text);
  opacity: 0.8;
}
.v3-hero__stat-num {
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--portal-text-bright);
  font-variant-numeric: tabular-nums;
}
.v3-hero__stat-sub { font-size: 0.72rem; color: var(--portal-text); opacity: 0.7; }
.v3-hero__stat-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 0.3rem;
}
.v3-hero__stat-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--portal-accent), #c084fc);
  box-shadow: 0 0 8px var(--portal-accent-glow);
  transition: width 0.4s ease;
}
@media (min-width: 900px) {
  .v3-hero { grid-template-columns: 1fr 280px; }
}

.v3-empty {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
  margin: 1rem 0 1.25rem;
  padding: 0.65rem 0.85rem;
  background: var(--portal-surface);
  border: 1px dashed var(--portal-border);
  border-radius: 6px;
  font-size: 0.78rem;
  color: var(--portal-text);
}
.v3-empty__label {
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  color: var(--portal-danger);
  font-weight: 700;
  opacity: 0.7;
}

.v3-pair {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.5rem;
}
@media (min-width: 1024px) {
  .v3-pair { grid-template-columns: 1fr 1fr; gap: 1rem; }
}

.v3-browser {
  margin: 1.25rem 0 1rem;
  background: var(--portal-surface);
  border: 1px solid var(--portal-border);
  border-radius: 8px;
  overflow: hidden;
}
.v3-browser__toggle {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.75rem;
  align-items: center;
  width: 100%;
  padding: 0.65rem 0.85rem;
  background: transparent;
  border: 0;
  color: var(--portal-text-bright);
  cursor: pointer;
  font-size: 0.82rem;
  text-align: left;
}
.v3-browser__toggle:hover { background: rgba(255, 255, 255, 0.03); }
.v3-browser__label {
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  color: var(--portal-accent);
  font-weight: 700;
}
.v3-browser__count {
  font-size: 0.72rem;
  color: var(--portal-text);
  opacity: 0.8;
}
.v3-browser__chevron {
  transition: transform 0.2s ease;
  opacity: 0.7;
}
.v3-browser__chevron--open { transform: rotate(180deg); }
.v3-browser__body {
  border-top: 1px solid var(--portal-border);
  padding: 0.6rem 0.75rem 0.85rem;
}
.v3-browser__filter {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.6rem;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--portal-border);
  border-radius: 4px;
  margin-bottom: 0.5rem;
}
.v3-browser__prompt { color: var(--portal-accent); font-weight: 700; }
.v3-browser__input {
  flex: 1;
  background: transparent;
  border: 0;
  color: var(--portal-text-bright);
  font-size: 0.82rem;
  outline: none;
}
.v3-browser__list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 480px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.v3-browser__row {
  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 0.75rem;
  align-items: center;
  padding: 0.45rem 0.5rem;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  font-size: 0.82rem;
}
.v3-browser__name {
  color: var(--portal-text-bright);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.v3-browser__name:hover { color: var(--portal-accent); }
.v3-browser__players strong {
  color: var(--portal-text-bright);
  font-weight: 700;
}
.v3-browser__players {
  color: var(--portal-text);
  font-variant-numeric: tabular-nums;
}
.v3-browser__map {
  color: var(--portal-text);
  max-width: 10rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.85;
}
.v3-browser__join {
  background: var(--portal-accent-dim);
  border: 1px solid var(--portal-accent);
  border-radius: 3px;
  color: var(--portal-accent);
  font-size: 0.7rem;
  font-family: 'JetBrains Mono', monospace;
  padding: 0.25rem 0.55rem;
  cursor: pointer;
  letter-spacing: 0.12em;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
.v3-browser__join:disabled { opacity: 0.35; cursor: not-allowed; }
.v3-browser__join:hover:not(:disabled) {
  background: var(--portal-accent);
  color: var(--bg-dark, #0a0a0f);
  box-shadow: 0 0 12px var(--portal-accent-glow);
}

@media (max-width: 640px) {
  .v3-browser__row { grid-template-columns: 1fr auto auto; }
  .v3-browser__map { display: none; }
}

.v3-feedback {
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  text-align: center;
  font-size: 0.76rem;
  color: var(--portal-text);
  opacity: 0.75;
}
.v3-feedback__link {
  color: var(--portal-accent);
  text-decoration: none;
  margin-left: 0.35rem;
}
.v3-feedback__link:hover { text-decoration: underline; }
</style>
