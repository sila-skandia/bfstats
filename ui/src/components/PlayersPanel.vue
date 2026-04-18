<template>
  <div
    v-if="show"
    class="roster-root"
    :class="inline ? 'roster-root--inline' : 'roster-root--modal'"
    :tabindex="!inline ? -1 : undefined"
    :role="!inline ? 'dialog' : undefined"
    aria-label="Player roster"
    @click.self="!inline && $emit('close')"
    @keydown.esc="!inline && $emit('close')"
  >
    <div
      class="roster"
      :class="[
        `roster--${gameAccent}`,
        inline ? 'roster--inline' : 'roster--modal',
        { 'roster--embedded': embedded, 'roster--empty-shell': !hasRoster }
      ]"
      @click.stop
    >
      <!-- Terminal Title Bar (hidden when embedded) -->
      <div
        v-if="!embedded"
        class="roster__titlebar"
      >
        <span
          class="roster__tldot"
          aria-hidden="true"
        />
        <span
          class="roster__tldot"
          aria-hidden="true"
        />
        <span
          class="roster__tldot"
          aria-hidden="true"
        />
        <span class="roster__tltitle">{{ server?.ip ? `${server.ip}:${server.port}` : 'roster' }}</span>
        <button
          class="roster__tlclose"
          type="button"
          aria-label="Close roster"
          @click.stop="$emit('close')"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          ><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <!-- Scan line accent -->
      <div
        v-if="!embedded"
        class="roster__scan"
        aria-hidden="true"
      />

      <div class="roster__body">
        <!-- Hero Header (hidden when embedded) -->
        <div
          v-if="!embedded"
          class="roster__hero"
        >
          <div class="roster__badge">
            <span
              class="roster__badge-dot"
              aria-hidden="true"
            />
            <span>LIVE ROSTER</span>
            <span class="roster__badge-count">{{ totalPlayers }}</span>
          </div>
          <h2 class="roster__name">
            {{ server?.name || 'UNKNOWN SERVER' }}
          </h2>
          <div
            v-if="server?.mapName || hasRoundTime"
            class="roster__chips"
          >
            <span
              v-if="server?.mapName"
              class="roster__chip roster__chip--map"
              :title="server.mapName"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              ><path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3-6-3Z" /><path d="M9 3v15" /><path d="M15 6v15" /></svg>
              <span class="roster__chip-text">{{ server.mapName }}</span>
            </span>
            <span
              v-if="hasRoundTime"
              class="roster__chip roster__chip--time"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              ><circle
                cx="12"
                cy="12"
                r="10"
              /><polyline points="12 6 12 12 16 14" /></svg>
              <span class="roster__chip-text">{{ formatTimeRemaining(server!.roundTimeRemain) }}</span>
            </span>
          </div>
        </div>

        <!-- Stats strip -->
        <div
          v-if="hasRoster && totalPlayers > 0"
          class="roster__stats"
        >
          <div class="rstat">
            <div
              class="rstat__rail"
              aria-hidden="true"
            />
            <div class="rstat__value">
              <span class="rstat__num">{{ totalPlayers }}</span><span class="rstat__denom">/{{ server?.maxPlayers ?? 0 }}</span>
            </div>
            <div class="rstat__label">
              ENGAGED
            </div>
            <div class="rstat__bar">
              <div
                class="rstat__bar-fill"
                :style="{ width: capacityPct + '%' }"
              />
            </div>
          </div>
          <div class="rstat">
            <div
              class="rstat__rail"
              aria-hidden="true"
            />
            <div class="rstat__value">
              <span class="rstat__num">{{ topScore }}</span>
            </div>
            <div class="rstat__label">
              TOP SCORE
            </div>
            <div
              v-if="topScorerName"
              class="rstat__sub"
              :title="topScorerName"
            >
              {{ topScorerName }}
            </div>
          </div>
          <div class="rstat">
            <div
              class="rstat__rail"
              aria-hidden="true"
            />
            <div class="rstat__value">
              <span class="rstat__num">{{ totalKills }}</span>
            </div>
            <div class="rstat__label">
              KILLS
            </div>
            <div class="rstat__sub">
              {{ totalDeaths }} deaths
            </div>
          </div>
          <div class="rstat">
            <div
              class="rstat__rail"
              aria-hidden="true"
            />
            <div class="rstat__value">
              <span class="rstat__num">{{ avgPing }}</span><span class="rstat__denom">ms</span>
            </div>
            <div class="rstat__label">
              AVG PING
            </div>
            <div class="rstat__sub">
              {{ pingLabel }}
            </div>
          </div>
        </div>

        <!-- Sort row -->
        <div
          v-if="hasRoster && totalPlayers > 0"
          class="roster__sort"
          role="toolbar"
          aria-label="Sort players"
        >
          <span class="roster__sort-label">SORT</span>
          <button
            v-for="field in sortFields"
            :key="field.id"
            type="button"
            class="roster__chipbtn"
            :class="{ 'roster__chipbtn--active': playerSortField === field.id }"
            :aria-pressed="playerSortField === field.id"
            @click="sortPlayersBy(field.id)"
          >
            {{ field.label }}
            <span
              v-if="playerSortField === field.id"
              class="roster__chipbtn-arrow"
              :class="{ 'roster__chipbtn-arrow--desc': playerSortDirection === 'desc' }"
              aria-hidden="true"
            >▲</span>
          </button>
        </div>

        <!-- Teams -->
        <div
          v-if="hasRoster"
          class="roster__teams"
        >
          <article
            v-for="team in server?.teams"
            :key="team.index"
            class="team-block"
            :class="`team-block--t${team.index}`"
          >
            <header class="team-block__head">
              <div class="team-block__lead">
                <span
                  class="team-block__rail"
                  aria-hidden="true"
                />
                <div class="team-block__title-col">
                  <h3 class="team-block__label">
                    {{ team.label }}
                  </h3>
                  <div class="team-block__count">
                    <span class="team-block__count-num">{{ getTeamPlayerCount(team.index) }}</span>
                    <span class="team-block__count-lbl">deployed</span>
                  </div>
                </div>
              </div>
              <div class="team-block__tickets">
                <span class="team-block__tickets-num">{{ team.tickets }}</span>
                <span class="team-block__tickets-lbl">TICKETS</span>
              </div>
            </header>

            <div
              v-if="getSortedTeamPlayers(team.index).length > 0"
              class="team-block__list"
            >
              <button
                v-for="(player, idx) in getSortedTeamPlayers(team.index)"
                :key="player.name"
                type="button"
                class="plrow"
                :class="[
                  `plrow--r${Math.min(idx, 3)}`,
                  { 'plrow--mvp': player.name === getTeamMvpName(team.index) }
                ]"
                @click="navigateToPlayerProfile(player.name)"
              >
                <span
                  class="plrow__rank"
                  :aria-label="`Position ${idx + 1}`"
                >
                  <span class="plrow__rank-num">{{ idx + 1 }}</span>
                </span>
                <span class="plrow__name">
                  <span
                    v-if="player.name === getTeamMvpName(team.index)"
                    class="plrow__mvp"
                    title="Top scorer"
                    aria-hidden="true"
                  >★</span>
                  <span class="plrow__name-text">{{ player.name }}</span>
                </span>
                <div class="plrow__stats">
                  <div class="plrow__stat plrow__stat--score">
                    <span
                      class="plrow__val"
                      :class="getScoreClass(player.score)"
                    >{{ player.score }}</span>
                    <span class="plrow__lbl">SCR</span>
                  </div>
                  <div class="plrow__stat plrow__stat--kd">
                    <span class="plrow__val plrow__val--k">{{ player.kills }}</span>
                    <span
                      class="plrow__slash"
                      aria-hidden="true"
                    >/</span>
                    <span class="plrow__val plrow__val--d">{{ player.deaths }}</span>
                    <span class="plrow__lbl">K/D</span>
                  </div>
                  <div
                    class="plrow__stat plrow__stat--ping"
                    :class="`plrow__stat--ping-${getPingLevel(player.ping)}`"
                  >
                    <span
                      class="plrow__ping-dot"
                      aria-hidden="true"
                    />
                    <span class="plrow__val">{{ player.ping }}</span>
                    <span class="plrow__lbl">MS</span>
                  </div>
                </div>
                <span
                  class="plrow__chev"
                  aria-hidden="true"
                >›</span>
              </button>
            </div>

            <div
              v-else
              class="team-block__empty"
            >
              <span class="team-block__empty-prompt">$</span>
              <span>team vacant · awaiting deployment</span>
            </div>
          </article>
        </div>

        <!-- Empty state -->
        <div
          v-else
          class="roster__empty"
        >
          <div class="roster__empty-card">
            <div class="roster__empty-head">
              <span
                class="roster__tldot"
                aria-hidden="true"
              />
              <span
                class="roster__tldot"
                aria-hidden="true"
              />
              <span
                class="roster__tldot"
                aria-hidden="true"
              />
              <span class="roster__empty-title">roster://select-server</span>
            </div>
            <div class="roster__empty-body">
              <div class="roster__empty-line">
                <span class="roster__empty-prompt">$</span> fetch --roster
              </div>
              <div class="roster__empty-line roster__empty-line--muted">
                Server offline or unreachable.
              </div>
              <div class="roster__empty-line roster__empty-line--hint">
                No telemetry received from host.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import type { ServerSummary } from '../types/server'
import { formatTimeRemaining } from '../utils/timeUtils'

interface Props {
  show: boolean
  server: ServerSummary | null
  /** When true, render inline (no overlay) for side-by-side layout */
  inline?: boolean
  /** When true, skip the terminal titlebar + server name (host card provides its own header) */
  embedded?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  inline: false,
  embedded: false,
})

defineEmits<{ close: [] }>()

const router = useRouter()

const playerSortField = ref<'name' | 'score' | 'kills' | 'deaths' | 'ping'>('score')
const playerSortDirection = ref<'asc' | 'desc'>('desc')

const sortFields = [
  { id: 'score' as const, label: 'SCORE' },
  { id: 'kills' as const, label: 'KILLS' },
  { id: 'deaths' as const, label: 'DEATHS' },
  { id: 'ping' as const, label: 'PING' },
  { id: 'name' as const, label: 'NAME' },
]

const gameAccent = computed<'bf1942' | 'fh2' | 'bfvietnam'>(() => {
  const g = (props.server?.gameType || '').toLowerCase()
  if (g.includes('fh2')) return 'fh2'
  if (g.includes('vietnam') || g === 'bfv') return 'bfvietnam'
  return 'bf1942'
})

const hasRoster = computed(() => !!(props.server?.teams && props.server.teams.length > 0))
const hasRoundTime = computed(() =>
  props.server?.roundTimeRemain !== undefined && props.server.roundTimeRemain !== -1
)

const totalPlayers = computed(() => props.server?.players?.length ?? 0)
const capacityPct = computed(() => {
  const max = props.server?.maxPlayers ?? 0
  return max > 0 ? Math.min(100, Math.round((totalPlayers.value / max) * 100)) : 0
})

const topScorer = computed(() => {
  const players = props.server?.players ?? []
  if (players.length === 0) return null
  return players.reduce((best, p) => (p.score > best.score ? p : best), players[0])
})
const topScore = computed(() => topScorer.value?.score ?? 0)
const topScorerName = computed(() => (topScore.value > 0 ? topScorer.value?.name ?? null : null))

const totalKills = computed(() =>
  (props.server?.players ?? []).reduce((sum, p) => sum + (p.kills || 0), 0)
)
const totalDeaths = computed(() =>
  (props.server?.players ?? []).reduce((sum, p) => sum + (p.deaths || 0), 0)
)

const avgPing = computed(() => {
  const players = props.server?.players ?? []
  if (players.length === 0) return 0
  const sum = players.reduce((s, p) => s + (p.ping || 0), 0)
  return Math.round(sum / players.length)
})

const pingLabel = computed(() => {
  const p = avgPing.value
  if (p === 0) return '—'
  if (p <= 50) return 'elite'
  if (p <= 100) return 'stable'
  if (p <= 150) return 'marginal'
  return 'degraded'
})

const navigateToPlayerProfile = (playerName: string) => {
  router.push(`/players/${encodeURIComponent(playerName)}`)
}

const getScoreClass = (score: number) => {
  if (score >= 100) return 'plrow__val--tier-s'
  if (score >= 50) return 'plrow__val--tier-a'
  if (score >= 25) return 'plrow__val--tier-b'
  return 'plrow__val--tier-c'
}

const getPingLevel = (ping: number): 'ok' | 'warn' | 'bad' | 'dead' => {
  if (ping <= 60) return 'ok'
  if (ping <= 120) return 'warn'
  if (ping <= 200) return 'bad'
  return 'dead'
}

const sortPlayersBy = (field: typeof playerSortField.value) => {
  if (playerSortField.value === field) {
    playerSortDirection.value = playerSortDirection.value === 'asc' ? 'desc' : 'asc'
  } else {
    playerSortField.value = field
    playerSortDirection.value = field === 'name' || field === 'ping' ? 'asc' : 'desc'
  }
}

const getTeamPlayerCount = (teamIndex: number) =>
  (props.server?.players ?? []).filter(p => p.team === teamIndex).length

const getTeamMvpName = (teamIndex: number): string | null => {
  const players = (props.server?.players ?? []).filter(p => p.team === teamIndex)
  if (players.length === 0) return null
  const top = players.reduce((best, p) => (p.score > best.score ? p : best), players[0])
  return top.score > 0 ? top.name : null
}

const getSortedTeamPlayers = (teamIndex: number) => {
  const players = (props.server?.players ?? []).filter(p => p.team === teamIndex)
  const field = playerSortField.value
  const dir = playerSortDirection.value
  return [...players].sort((a, b) => {
    let aVal: string | number
    let bVal: string | number
    switch (field) {
      case 'name':
        aVal = a.name.toLowerCase()
        bVal = b.name.toLowerCase()
        break
      case 'score':
        aVal = a.score
        bVal = b.score
        break
      case 'kills':
        aVal = a.kills
        bVal = b.kills
        break
      case 'deaths':
        aVal = a.deaths
        bVal = b.deaths
        break
      case 'ping':
        aVal = a.ping
        bVal = b.ping
        break
    }
    if (aVal < bVal) return dir === 'asc' ? -1 : 1
    if (aVal > bVal) return dir === 'asc' ? 1 : -1
    return 0
  })
}
</script>

<style scoped>
/* ============================================================
   ROSTER PANEL — command-center / hacker theme
   Mirrors LandingPageV2 + ServerDetails visual language
   ============================================================ */

/* ---- Root positioning ---- */
.roster-root--inline {
  display: contents;
}

.roster-root--modal {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: stretch;
  justify-content: center;
  background: rgba(0, 0, 0, 0.82);
  backdrop-filter: blur(4px);
  animation: roster-fade-in 0.2s ease-out;
}

@media (min-width: 640px) {
  .roster-root--modal {
    align-items: center;
    padding: 1rem;
  }
}

@keyframes roster-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* ---- Roster shell ---- */
.roster {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  isolation: isolate;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  background: linear-gradient(135deg, rgba(23, 23, 23, 0.96) 0%, rgba(8, 8, 8, 0.96) 100%);
  border: 1px solid rgba(64, 64, 64, 0.7);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.45);

  /* Accent defaults, overridden per-game below */
  --r-accent: #c084fc;
  --r-accent-rgb: 192, 132, 252;
  --r-accent-dim: rgba(192, 132, 252, 0.12);
  --r-accent-line: rgba(192, 132, 252, 0.35);
}

.roster--bf1942 {
  --r-accent: #c084fc;
  --r-accent-rgb: 192, 132, 252;
  --r-accent-dim: rgba(192, 132, 252, 0.12);
  --r-accent-line: rgba(192, 132, 252, 0.35);
}
.roster--fh2 {
  --r-accent: #4ade80;
  --r-accent-rgb: 74, 222, 128;
  --r-accent-dim: rgba(74, 222, 128, 0.12);
  --r-accent-line: rgba(74, 222, 128, 0.35);
}
.roster--bfvietnam {
  --r-accent: #22d3ee;
  --r-accent-rgb: 34, 211, 238;
  --r-accent-dim: rgba(34, 211, 238, 0.12);
  --r-accent-line: rgba(34, 211, 238, 0.35);
}

.roster--inline {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.roster--modal {
  width: 100%;
  max-width: 64rem;
  height: 100%;
  border-radius: 0;
}

@media (min-width: 640px) {
  .roster--modal {
    height: auto;
    max-height: 90vh;
    border-radius: 14px;
  }
}

.roster--embedded {
  border: 0;
  background: transparent;
  box-shadow: none;
}

/* Subtle scan-line background across the whole panel */
.roster::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    0deg,
    rgba(var(--r-accent-rgb), 0.025) 0,
    rgba(var(--r-accent-rgb), 0.025) 1px,
    transparent 1px,
    transparent 4px
  );
  pointer-events: none;
  opacity: 0.5;
  z-index: 0;
}

.roster--embedded::before {
  opacity: 0;
}

.roster > * {
  position: relative;
  z-index: 1;
}

/* ---- Terminal title bar ---- */
.roster__titlebar {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.875rem;
  background: rgba(0, 0, 0, 0.55);
  border-bottom: 1px solid rgba(64, 64, 64, 0.55);
  flex-shrink: 0;
}

.roster__tldot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #404040;
  flex-shrink: 0;
}
.roster__tldot:nth-child(1) { background: #ef4444; }
.roster__tldot:nth-child(2) { background: #eab308; }
.roster__tldot:nth-child(3) { background: #4ade80; }

.roster__tltitle {
  margin-left: 0.375rem;
  font-size: 0.6875rem;
  color: #737373;
  letter-spacing: 0.05em;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.roster__tlclose {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid rgba(64, 64, 64, 0.6);
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.4);
  color: #a3a3a3;
  cursor: pointer;
  transition: all 0.18s ease;
  flex-shrink: 0;
}
.roster__tlclose:hover {
  border-color: rgba(239, 68, 68, 0.55);
  color: #fca5a5;
  background: rgba(239, 68, 68, 0.12);
  box-shadow: 0 0 12px rgba(239, 68, 68, 0.28);
}
.roster__tlclose:focus-visible {
  outline: 2px solid #ef4444;
  outline-offset: 2px;
}

/* ---- Animated scan line along top ---- */
.roster__scan {
  position: absolute;
  left: 0;
  right: 0;
  top: 34px;
  height: 1px;
  background: linear-gradient(90deg, transparent 0%, var(--r-accent) 50%, transparent 100%);
  opacity: 0.45;
  animation: roster-scan 5s ease-in-out infinite;
  z-index: 2;
  pointer-events: none;
}

@keyframes roster-scan {
  0%, 100% { transform: translateX(-100%); opacity: 0; }
  50%      { transform: translateX(0%);    opacity: 0.6; }
}

/* ---- Body (scrollable) ---- */
.roster__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.875rem 1rem 1.125rem;
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
}

.roster--embedded .roster__body {
  padding: 0.875rem 0.875rem 1rem;
}

/* ---- Hero section ---- */
.roster__hero {
  display: flex;
  flex-direction: column;
  gap: 0.4375rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid rgba(64, 64, 64, 0.4);
}

.roster__badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  width: fit-content;
  padding: 0.1875rem 0.625rem;
  border: 1px solid var(--r-accent-line);
  border-radius: 999px;
  background: rgba(var(--r-accent-rgb), 0.08);
  color: var(--r-accent);
  font-size: 0.625rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.roster__badge-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--r-accent);
  box-shadow: 0 0 8px var(--r-accent);
  animation: roster-dot 1.6s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes roster-dot {
  0%, 100% { opacity: 1;   transform: scale(1); }
  50%      { opacity: 0.5; transform: scale(1.4); }
}

.roster__badge-count {
  margin-left: 0.125rem;
  padding: 0 0.375rem;
  border-left: 1px solid rgba(var(--r-accent-rgb), 0.35);
  color: #f5f5f4;
  font-weight: 800;
}

.roster__name {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.01em;
  color: #f5f5f4;
  text-shadow:
    0 0 14px rgba(var(--r-accent-rgb), 0.35),
    0 0 2px rgba(var(--r-accent-rgb), 0.5);
  text-transform: uppercase;
  word-break: break-word;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

@media (min-width: 640px) {
  .roster__name { font-size: 1.25rem; }
}

.roster__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.roster__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  padding: 0.1875rem 0.5rem;
  border: 1px solid rgba(64, 64, 64, 0.55);
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.4);
  font-size: 0.6875rem;
  color: #d4d4d4;
  min-width: 0;
  max-width: 100%;
}
.roster__chip--map { color: #fb923c; border-color: rgba(251, 146, 60, 0.3); }
.roster__chip--time { color: #4ade80; border-color: rgba(74, 222, 128, 0.3); font-variant-numeric: tabular-nums; }

.roster__chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* ---- Stats strip ---- */
.roster__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.4375rem;
}

@media (min-width: 640px) {
  .roster__stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

.rstat {
  position: relative;
  padding: 0.5rem 0.625rem 0.5625rem 0.75rem;
  border: 1px solid rgba(64, 64, 64, 0.55);
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.35);
  overflow: hidden;
  min-width: 0;
}

.rstat__rail {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: linear-gradient(180deg, transparent, var(--r-accent), transparent);
  opacity: 0.7;
}

.rstat__value {
  display: flex;
  align-items: baseline;
  gap: 0.125rem;
  line-height: 1;
}

.rstat__num {
  font-size: 1.125rem;
  font-weight: 800;
  color: #f5f5f4;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

.rstat__denom {
  font-size: 0.75rem;
  color: #737373;
  font-weight: 600;
}

.rstat__label {
  margin-top: 0.25rem;
  font-size: 0.5625rem;
  font-weight: 800;
  letter-spacing: 0.15em;
  color: var(--r-accent);
  text-transform: uppercase;
}

.rstat__sub {
  font-size: 0.5625rem;
  color: #737373;
  margin-top: 0.125rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rstat__bar {
  margin-top: 0.3125rem;
  height: 3px;
  border-radius: 999px;
  background: rgba(64, 64, 64, 0.45);
  overflow: hidden;
}

.rstat__bar-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--r-accent), rgba(var(--r-accent-rgb), 0.6));
  border-radius: inherit;
  transition: width 0.6s cubic-bezier(0.25, 0.8, 0.25, 1);
  box-shadow: 0 0 8px rgba(var(--r-accent-rgb), 0.5);
}

/* ---- Sort row ---- */
.roster__sort {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  padding: 0.4375rem 0.5rem;
  border: 1px solid rgba(64, 64, 64, 0.5);
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.3);
}

.roster__sort-label {
  font-size: 0.5625rem;
  color: #737373;
  letter-spacing: 0.18em;
  font-weight: 700;
  margin-right: 0.125rem;
}

.roster__chipbtn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5625rem;
  border: 1px solid rgba(64, 64, 64, 0.55);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.35);
  color: #a3a3a3;
  font-family: inherit;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: all 0.15s ease;
}

.roster__chipbtn:hover {
  color: #e5e5e5;
  border-color: rgba(var(--r-accent-rgb), 0.4);
}

.roster__chipbtn--active {
  color: var(--r-accent);
  background: rgba(var(--r-accent-rgb), 0.12);
  border-color: var(--r-accent-line);
  box-shadow:
    0 0 0 1px rgba(var(--r-accent-rgb), 0.22),
    0 0 10px rgba(var(--r-accent-rgb), 0.18);
}

.roster__chipbtn-arrow {
  display: inline-block;
  font-size: 0.5625rem;
  transition: transform 0.2s ease;
}
.roster__chipbtn-arrow--desc { transform: rotate(180deg); }

.roster__chipbtn:focus-visible {
  outline: 2px solid var(--r-accent);
  outline-offset: 2px;
}

/* ---- Teams ---- */
.roster__teams {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.team-block {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(64, 64, 64, 0.55);
  border-radius: 9px;
  background: linear-gradient(155deg, rgba(18, 18, 18, 0.9), rgba(6, 6, 6, 0.9));
  overflow: hidden;

  /* Team accent defaults (indexes beyond 2 fall back) */
  --team-accent: #94a3b8;
  --team-accent-rgb: 148, 163, 184;
}

.team-block--t1 {
  --team-accent: #f87171;
  --team-accent-rgb: 248, 113, 113;
}
.team-block--t2 {
  --team-accent: #60a5fa;
  --team-accent-rgb: 96, 165, 250;
}
.team-block--t3 {
  --team-accent: #fbbf24;
  --team-accent-rgb: 251, 191, 36;
}

.team-block::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, transparent, var(--team-accent), transparent);
  opacity: 0.5;
  pointer-events: none;
}

.team-block__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.625rem;
  padding: 0.5625rem 0.75rem 0.5625rem 0.875rem;
  border-bottom: 1px solid rgba(64, 64, 64, 0.4);
  background: rgba(0, 0, 0, 0.3);
}

.team-block__lead {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.team-block__rail {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--team-accent);
  box-shadow: 0 0 8px rgba(var(--team-accent-rgb), 0.7);
  flex-shrink: 0;
}

.team-block__title-col {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.team-block__label {
  margin: 0;
  font-size: 0.8125rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--team-accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.team-block__count {
  display: flex;
  align-items: baseline;
  gap: 0.25rem;
  font-size: 0.625rem;
  color: #737373;
}

.team-block__count-num {
  color: #d4d4d4;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.team-block__tickets {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.0625rem;
  padding: 0.25rem 0.5rem;
  border: 1px solid rgba(var(--team-accent-rgb), 0.3);
  border-radius: 6px;
  background: rgba(var(--team-accent-rgb), 0.08);
  flex-shrink: 0;
}

.team-block__tickets-num {
  font-size: 0.875rem;
  font-weight: 800;
  color: #f5f5f4;
  line-height: 1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 10px rgba(var(--team-accent-rgb), 0.35);
}

.team-block__tickets-lbl {
  font-size: 0.5rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  color: rgba(var(--team-accent-rgb), 0.85);
  text-transform: uppercase;
}

/* ---- Empty team ---- */
.team-block__empty {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.875rem 1rem;
  font-size: 0.6875rem;
  color: #737373;
  letter-spacing: 0.04em;
  background:
    repeating-linear-gradient(
      45deg,
      rgba(64, 64, 64, 0.08) 0 6px,
      transparent 6px 12px
    );
}

.team-block__empty-prompt {
  color: var(--team-accent);
  font-weight: 800;
}

/* ---- Player rows ---- */
.team-block__list {
  display: flex;
  flex-direction: column;
}

.plrow {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  padding: 0.5rem 0.75rem 0.5rem 0.625rem;
  border: 0;
  border-bottom: 1px solid rgba(64, 64, 64, 0.3);
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, box-shadow 0.15s ease;
  min-width: 0;
}

.plrow:last-child { border-bottom: 0; }

.plrow:hover {
  background: rgba(var(--r-accent-rgb), 0.055);
  box-shadow: inset 2px 0 0 var(--r-accent);
}

.plrow:focus-visible {
  outline: 2px solid var(--r-accent);
  outline-offset: -2px;
}

.plrow__rank {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: rgba(64, 64, 64, 0.35);
  color: #737373;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  transition: all 0.15s ease;
}

.plrow--r0 .plrow__rank {
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.22), rgba(251, 191, 36, 0.08));
  color: #fbbf24;
  box-shadow: 0 0 10px rgba(251, 191, 36, 0.22), inset 0 0 0 1px rgba(251, 191, 36, 0.35);
}
.plrow--r1 .plrow__rank {
  background: linear-gradient(135deg, rgba(203, 213, 225, 0.2), rgba(203, 213, 225, 0.06));
  color: #cbd5e1;
  box-shadow: inset 0 0 0 1px rgba(203, 213, 225, 0.3);
}
.plrow--r2 .plrow__rank {
  background: linear-gradient(135deg, rgba(251, 146, 60, 0.18), rgba(251, 146, 60, 0.05));
  color: #fdba74;
  box-shadow: inset 0 0 0 1px rgba(251, 146, 60, 0.3);
}

.plrow__name {
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: 0.3125rem;
  min-width: 0;
  color: #e5e5e5;
  font-size: 0.8125rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  transition: color 0.15s ease;
}

.plrow:hover .plrow__name {
  color: var(--r-accent);
}

.plrow__name-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.plrow__mvp {
  font-size: 0.6875rem;
  color: #fbbf24;
  text-shadow: 0 0 8px rgba(251, 191, 36, 0.7);
  flex-shrink: 0;
  line-height: 1;
}

.plrow__stats {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}

.plrow__stat {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1;
  gap: 0.125rem;
  min-width: 0;
}

.plrow__stat--kd,
.plrow__stat--ping {
  flex-direction: row;
  align-items: baseline;
  gap: 0.1875rem;
}

.plrow__val {
  font-size: 0.8125rem;
  font-weight: 800;
  color: #d4d4d4;
  letter-spacing: -0.01em;
}

.plrow__val--tier-s { color: #4ade80; text-shadow: 0 0 10px rgba(74, 222, 128, 0.35); }
.plrow__val--tier-a { color: #22d3ee; }
.plrow__val--tier-b { color: #fb923c; }
.plrow__val--tier-c { color: #a3a3a3; font-weight: 700; }

.plrow__val--k { color: #4ade80; }
.plrow__val--d { color: #fca5a5; }

.plrow__slash {
  color: #525252;
  font-size: 0.75rem;
}

.plrow__lbl {
  font-size: 0.5rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  color: #525252;
  text-transform: uppercase;
  line-height: 1;
}

.plrow__stat--kd .plrow__lbl,
.plrow__stat--ping .plrow__lbl {
  margin-left: 0.1875rem;
}

.plrow__ping-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #525252;
  flex-shrink: 0;
  margin-right: 0.125rem;
}

.plrow__stat--ping-ok .plrow__ping-dot { background: #4ade80; box-shadow: 0 0 6px rgba(74, 222, 128, 0.6); }
.plrow__stat--ping-ok .plrow__val { color: #86efac; }

.plrow__stat--ping-warn .plrow__ping-dot { background: #eab308; box-shadow: 0 0 6px rgba(234, 179, 8, 0.55); }
.plrow__stat--ping-warn .plrow__val { color: #fde047; }

.plrow__stat--ping-bad .plrow__ping-dot { background: #f97316; box-shadow: 0 0 6px rgba(249, 115, 22, 0.55); }
.plrow__stat--ping-bad .plrow__val { color: #fdba74; }

.plrow__stat--ping-dead .plrow__ping-dot { background: #ef4444; box-shadow: 0 0 6px rgba(239, 68, 68, 0.65); }
.plrow__stat--ping-dead .plrow__val { color: #fca5a5; }

.plrow__chev {
  color: #525252;
  font-size: 1rem;
  line-height: 1;
  flex-shrink: 0;
  transition: transform 0.15s ease, color 0.15s ease;
}

.plrow:hover .plrow__chev {
  color: var(--r-accent);
  transform: translateX(2px);
}

/* ---- Empty-shell (no roster available) ---- */
.roster__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem 0.5rem;
}

.roster__empty-card {
  width: 100%;
  max-width: 360px;
  border: 1px solid rgba(64, 64, 64, 0.55);
  border-radius: 9px;
  background: linear-gradient(135deg, rgba(23, 23, 23, 0.95), rgba(10, 10, 10, 0.95));
  overflow: hidden;
}

.roster__empty-head {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.4375rem 0.75rem;
  background: rgba(0, 0, 0, 0.4);
  border-bottom: 1px solid rgba(64, 64, 64, 0.4);
}

.roster__empty-title {
  margin-left: 0.375rem;
  font-size: 0.625rem;
  color: #737373;
  letter-spacing: 0.05em;
}

.roster__empty-body {
  padding: 0.875rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  font-size: 0.75rem;
  color: #d4d4d4;
}

.roster__empty-line--muted { color: #737373; }
.roster__empty-line--hint { color: #a3a3a3; font-size: 0.6875rem; }

.roster__empty-prompt {
  color: var(--r-accent);
  margin-right: 0.375rem;
}

/* ---- Narrow mobile: stack stats below name ---- */
@media (max-width: 420px) {
  .plrow {
    flex-wrap: wrap;
    padding: 0.5rem 0.625rem 0.5rem 0.5rem;
    gap: 0.4375rem;
  }

  .plrow__stats {
    width: 100%;
    margin-left: calc(22px + 0.4375rem);
    justify-content: flex-start;
    gap: 0.625rem;
  }

  .plrow__chev {
    order: 3;
  }

  .roster__body {
    padding: 0.75rem 0.625rem 1rem;
    gap: 0.75rem;
  }

  .roster__name { font-size: 1rem; }
  .rstat__num { font-size: 1rem; }
}

/* ---- Scrollbar polish ---- */
.roster__body::-webkit-scrollbar { width: 6px; }
.roster__body::-webkit-scrollbar-track { background: transparent; }
.roster__body::-webkit-scrollbar-thumb {
  background: rgba(var(--r-accent-rgb), 0.2);
  border-radius: 999px;
}
.roster__body::-webkit-scrollbar-thumb:hover {
  background: rgba(var(--r-accent-rgb), 0.4);
}
</style>
