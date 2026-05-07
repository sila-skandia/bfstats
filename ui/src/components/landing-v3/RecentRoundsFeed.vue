<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { formatRelativeTimeShort as formatRelativeTime } from '@/utils/timeUtils'
import { getMapAccentColor } from '@/utils/statsUtils'
import type { RecentRoundSummary } from '@/services/landingV3Service'

const props = defineProps<{
  rounds: RecentRoundSummary[]
  hoursBack: number
  minPlayers?: number
}>()

const emit = defineEmits<{
  (e: 'update:minPlayers', value: number): void
}>()

const minPlayersLocal = ref<number>(props.minPlayers ?? 1)
watch(() => props.minPlayers, (v) => {
  if (typeof v === 'number' && v !== minPlayersLocal.value) minPlayersLocal.value = v
})

let commitTimer: number | null = null
const onMinPlayersInput = (event: Event): void => {
  const target = event.target as HTMLInputElement
  const raw = Number(target.value)
  if (!Number.isFinite(raw)) return
  const clamped = Math.max(0, Math.min(128, Math.floor(raw)))
  minPlayersLocal.value = clamped
  if (commitTimer != null) window.clearTimeout(commitTimer)
  commitTimer = window.setTimeout(() => {
    emit('update:minPlayers', clamped)
  }, 250)
}

const router = useRouter()

const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  const r = h % 24
  return r > 0 ? `${d}d ${r}h` : `${d}d`
}

const getWinner = (r: RecentRoundSummary): 'team1' | 'team2' | 'draw' | null => {
  if (r.tickets1 == null || r.tickets2 == null) return null
  if (r.tickets1 === r.tickets2) return 'draw'
  return r.tickets1 > r.tickets2 ? 'team1' : 'team2'
}

const toRoundReport = (r: RecentRoundSummary): void => {
  router.push({ name: 'round-report', params: { roundId: r.roundId } })
}

const toServer = (r: RecentRoundSummary, event?: Event): void => {
  event?.stopPropagation()
  router.push({ name: 'server-details', params: { serverName: r.serverName } })
}

const toPlayer = (name: string, event?: Event): void => {
  event?.stopPropagation()
  router.push({ name: 'player-details', params: { playerName: name } })
}
</script>

<template>
  <div
    class="rsf-root"
    aria-label="Recently completed rounds"
  >
    <header class="rsf-section-head">
      <span class="rsf-section-label">JUST ENDED</span>
      <span class="rsf-section-sub">Last {{ rounds.length }} rounds · past {{ hoursBack }}h</span>
      <label class="rsf-minplayers" :title="'Filter rounds by minimum player count'">
        <span class="rsf-minplayers__label">MIN PLAYERS</span>
        <input
          type="number"
          class="rsf-minplayers__input"
          min="0"
          max="128"
          step="1"
          :value="minPlayersLocal"
          aria-label="Minimum players"
          @input="onMinPlayersInput"
        >
      </label>
    </header>

    <div v-if="rounds.length === 0" class="rsf-empty">
      <span class="rsf-empty__text">No rounds in the last {{ hoursBack }}h with at least {{ minPlayersLocal }} player{{ minPlayersLocal === 1 ? '' : 's' }}.</span>
    </div>

    <div v-else class="rsf-feed">
      <div class="rsf-hint" aria-hidden="true">
        <span class="rsf-hint__pulse" />
        <span class="rsf-hint__text">
          <span class="text-neon-cyan">TAP</span> ANY ROUND FOR FULL
          <span class="text-neon-cyan">DEBRIEFING</span> —
          TIMELINE · PHASE CHARTS · PLAYER BREAKDOWN
        </span>
      </div>

      <article
        v-for="r in rounds"
        :key="r.roundId"
        class="rsf-card"
        role="button"
        tabindex="0"
        @click="toRoundReport(r)"
        @keydown.enter="toRoundReport(r)"
      >
        <span class="rsf-card__accent" aria-hidden="true" />
        <span class="rsf-card__timeline-dot" aria-hidden="true" />

        <header class="rsf-card__server-head">
          <button
            type="button"
            class="rsf-card__server"
            :title="`Open ${r.serverName}`"
            @click="toServer(r, $event)"
          >
            <span class="rsf-card__server-icon" aria-hidden="true">◈</span>
            <span class="rsf-card__server-name">{{ r.serverName }}</span>
          </button>
          <div class="rsf-card__time">
            <span class="rsf-card__time-value">{{ formatRelativeTime(r.endTime) }}</span>
            <span class="rsf-card__time-label">ago</span>
          </div>
        </header>

        <header class="rsf-card__head">
          <div class="rsf-card__map-wrap">
            <h4
              class="rsf-card__map"
              :class="getMapAccentColor(r.mapName)"
            >
              {{ r.mapName || 'unknown map' }}
            </h4>
            <span
              v-if="r.gameType"
              class="rsf-card__mode"
            >{{ r.gameType }}</span>
          </div>
        </header>

        <div
          v-if="getWinner(r)"
          class="rsf-card__duel"
        >
          <div
            class="rsf-duel-side"
            :class="{ 'rsf-duel-side--winner': getWinner(r) === 'team1' }"
          >
            <span class="rsf-duel-side__label">{{ r.team1Label || 'TEAM 1' }}</span>
            <span class="rsf-duel-side__pts">{{ r.tickets1 }}</span>
          </div>
          <span class="rsf-duel-vs" aria-hidden="true">VS</span>
          <div
            class="rsf-duel-side rsf-duel-side--right"
            :class="{ 'rsf-duel-side--winner': getWinner(r) === 'team2' }"
          >
            <span class="rsf-duel-side__pts">{{ r.tickets2 }}</span>
            <span class="rsf-duel-side__label">{{ r.team2Label || 'TEAM 2' }}</span>
          </div>
          <span
            v-if="getWinner(r) === 'draw'"
            class="rsf-duel-tag rsf-duel-tag--draw"
          >DEADLOCK</span>
          <span
            v-else
            class="rsf-duel-tag rsf-duel-tag--victor"
          >VICTOR →
            {{ getWinner(r) === 'team1' ? (r.team1Label || 'TEAM 1') : (r.team2Label || 'TEAM 2') }}
            <span v-if="r.ticketMargin != null && r.ticketMargin > 0" class="rsf-duel-tag__margin">by {{ r.ticketMargin }}</span>
          </span>
        </div>

        <div
          v-if="r.mvp"
          class="rsf-card__top"
        >
          <span class="rsf-card__top-tag">MVP</span>
          <span class="rsf-card__top-chev" aria-hidden="true">▸</span>
          <button
            type="button"
            class="rsf-card__top-name"
            :title="`View ${$pn(r.mvp.playerName)}`"
            @click="toPlayer(r.mvp.playerName, $event)"
          >
            {{ $pn(r.mvp.playerName) }}
          </button>
          <span class="rsf-card__top-stat">
            <span class="rsf-card__top-num">{{ r.mvp.score.toLocaleString() }}</span>
            <span class="rsf-card__top-unit">pts</span>
          </span>
          <span class="rsf-card__top-stat">
            <span class="rsf-card__top-num rsf-card__top-num--k">{{ r.mvp.kills }}</span>
            <span class="rsf-card__top-unit">K</span>
            <span class="rsf-card__top-slash">/</span>
            <span class="rsf-card__top-num rsf-card__top-num--d">{{ r.mvp.deaths }}</span>
            <span class="rsf-card__top-unit">D</span>
          </span>
        </div>

        <footer class="rsf-card__foot">
          <span class="rsf-card__meta">
            <span class="rsf-card__meta-icon" aria-hidden="true">◴</span>
            {{ formatDuration(r.durationMinutes) }}
          </span>
          <span class="rsf-card__meta-dot" />
          <span class="rsf-card__meta">
            <span class="rsf-card__meta-icon" aria-hidden="true">◉</span>
            {{ r.participantCount }} operatives
          </span>
          <span
            class="rsf-briefing"
            aria-hidden="true"
          >
            <span class="briefing-chart">
              <span /><span /><span />
            </span>
            <span class="rsf-briefing__label">Open Briefing</span>
            <span class="rsf-briefing__arrow">▸</span>
          </span>
        </footer>
      </article>
    </div>
  </div>
</template>

<style scoped>
.rsf-root {
  margin: 1rem 0 1.5rem;
  padding: 0.5rem 0.75rem 1rem;
  background: rgba(13, 13, 24, 0.5);
  border: 1px solid rgba(48, 54, 61, 0.55);
  border-radius: 8px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}
.rsf-section-head {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  padding: 0.5rem 0.25rem 0.65rem;
}
.rsf-section-label {
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  color: #00e5ff;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  text-shadow: 0 0 8px rgba(0, 229, 255, 0.4);
}
.rsf-section-sub {
  font-size: 0.68rem;
  color: rgba(139, 148, 158, 0.8);
  font-family: 'JetBrains Mono', monospace;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.rsf-minplayers {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'JetBrains Mono', monospace;
}
.rsf-minplayers__label {
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  color: rgba(139, 148, 158, 0.85);
  text-transform: uppercase;
}
.rsf-minplayers__input {
  width: 3.25rem;
  padding: 0.2rem 0.4rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.72rem;
  color: #00e5ff;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(0, 229, 255, 0.35);
  border-radius: 4px;
  outline: none;
  text-align: right;
}
.rsf-minplayers__input:focus {
  border-color: rgba(0, 229, 255, 0.8);
  box-shadow: 0 0 0 2px rgba(0, 229, 255, 0.15);
}
.rsf-empty {
  padding: 1.5rem 0.5rem;
  text-align: center;
  color: rgba(139, 148, 158, 0.75);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  letter-spacing: 0.08em;
}

.rsf-feed {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.rsf-feed::before {
  content: '';
  position: absolute;
  top: 3.2rem;
  bottom: 1.1rem;
  left: 13px;
  width: 1px;
  background: linear-gradient(180deg,
    transparent,
    rgba(0, 229, 255, 0.25) 10%,
    rgba(0, 229, 255, 0.25) 90%,
    transparent);
  pointer-events: none;
}

.rsf-card {
  position: relative;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.45rem;
  padding: 0.75rem 0.9rem 0.75rem 1.75rem;
  margin-left: 0.6rem;
  background:
    linear-gradient(90deg, rgba(0, 229, 255, 0.03), transparent 40%),
    rgba(13, 13, 24, 0.55);
  border: 1px solid rgba(48, 54, 61, 0.55);
  border-radius: 5px;
  cursor: pointer;
  transition: border-color 180ms ease, background 180ms ease, transform 180ms ease;
  outline: none;
}
.rsf-card:hover,
.rsf-card:focus-visible {
  border-color: rgba(0, 229, 255, 0.5);
  background:
    linear-gradient(90deg, rgba(0, 229, 255, 0.06), transparent 40%),
    rgba(13, 13, 24, 0.75);
  transform: translateY(-1px);
}

.rsf-card__accent {
  position: absolute;
  left: 0;
  top: 0.5rem;
  bottom: 0.5rem;
  width: 3px;
  background: linear-gradient(180deg, #00e5ff, rgba(0, 229, 255, 0.1));
  border-radius: 2px;
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.35);
}
.rsf-card__timeline-dot {
  position: absolute;
  left: -0.3rem;
  top: 1rem;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: #0a0a0f;
  border: 2px solid #00e5ff;
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.5);
}

/* Server header — the prominent server-name row, unique to the landing variant */
.rsf-card__server-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding-bottom: 0.35rem;
  margin-bottom: 0.1rem;
  border-bottom: 1px dashed rgba(0, 229, 255, 0.2);
}
.rsf-card__server {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  cursor: pointer;
  color: #e6edf3;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  min-width: 0;
  flex: 1;
  text-align: left;
  transition: color 150ms ease;
}
.rsf-card__server:hover {
  color: #00e5ff;
}
.rsf-card__server-icon {
  color: #00e5ff;
  font-size: 0.8rem;
  flex-shrink: 0;
  filter: drop-shadow(0 0 4px rgba(0, 229, 255, 0.4));
}
.rsf-card__server-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.rsf-card__head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.rsf-card__map-wrap {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}
.rsf-card__map {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: 0.04em;
  margin: 0;
  text-transform: capitalize;
}
.rsf-card__mode {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.55rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(139, 148, 158, 0.9);
  padding: 0.15rem 0.4rem;
  border: 1px solid rgba(48, 54, 61, 0.55);
  border-radius: 2px;
}
.rsf-card__time {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(139, 148, 158, 0.9);
  margin-left: auto;
  flex-shrink: 0;
}
.rsf-card__time-value { color: #e6edf3; font-weight: 600; }

.rsf-card__duel {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  flex-wrap: wrap;
}
.rsf-duel-side {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
  padding: 0.2rem 0.5rem;
  border: 1px solid rgba(48, 54, 61, 0.55);
  border-radius: 3px;
  color: rgba(139, 148, 158, 0.9);
  letter-spacing: 0.08em;
}
.rsf-duel-side--right { flex-direction: row-reverse; }
.rsf-duel-side__label {
  font-size: 0.58rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.rsf-duel-side__pts {
  color: #e6edf3;
  font-weight: 700;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}
.rsf-duel-side--winner {
  color: #00e5ff;
  border-color: rgba(0, 229, 255, 0.45);
  background: rgba(0, 229, 255, 0.06);
}
.rsf-duel-side--winner .rsf-duel-side__pts {
  color: #00e5ff;
  text-shadow: 0 0 6px rgba(0, 229, 255, 0.35);
}
.rsf-duel-vs {
  font-size: 0.6rem;
  letter-spacing: 0.2em;
  color: rgba(139, 148, 158, 0.55);
  font-weight: 700;
}
.rsf-duel-tag {
  margin-left: auto;
  padding: 0.15rem 0.45rem;
  border: 1px solid rgba(0, 229, 255, 0.3);
  border-radius: 2px;
  font-size: 0.55rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #00e5ff;
  background: rgba(0, 229, 255, 0.06);
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.rsf-duel-tag__margin {
  color: rgba(139, 148, 158, 0.95);
  font-weight: 600;
  letter-spacing: 0.12em;
}
.rsf-duel-tag--draw {
  color: rgba(139, 148, 158, 0.9);
  border-color: rgba(139, 148, 158, 0.35);
  background: rgba(139, 148, 158, 0.06);
}

.rsf-card__top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  padding: 0.4rem 0.55rem;
  border: 1px dashed rgba(168, 139, 250, 0.25);
  border-radius: 3px;
  background: rgba(168, 139, 250, 0.04);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.68rem;
}
.rsf-card__top-tag {
  font-size: 0.55rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: #a78bfa;
  font-weight: 700;
}
.rsf-card__top-chev { color: #a78bfa; }
.rsf-card__top-name {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: #e6edf3;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
  border-bottom: 1px dotted rgba(168, 139, 250, 0.45);
}
.rsf-card__top-name:hover { color: #a78bfa; }
.rsf-card__top-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 0.2rem;
  color: rgba(139, 148, 158, 0.9);
  text-transform: uppercase;
  font-size: 0.55rem;
  letter-spacing: 0.14em;
}
.rsf-card__top-num {
  color: #e6edf3;
  font-weight: 700;
  font-size: 0.8rem;
}
.rsf-card__top-num--k { color: #00e5ff; }
.rsf-card__top-num--d { color: #ff4d6d; }
.rsf-card__top-slash { color: rgba(139, 148, 158, 0.45); }
.rsf-card__top-unit { font-size: 0.55rem; }

.rsf-card__foot {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(139, 148, 158, 0.9);
}
.rsf-card__meta {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}
.rsf-card__meta-icon { color: #00e5ff; font-size: 0.75rem; }
.rsf-card__meta-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgba(139, 148, 158, 0.4);
}

.rsf-briefing {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.28rem 0.6rem 0.28rem 0.5rem;
  border: 1px dashed rgba(0, 229, 255, 0.5);
  border-radius: 3px;
  background: linear-gradient(135deg, rgba(0, 229, 255, 0.05) 0%, rgba(0, 229, 255, 0.12) 100%);
  color: #00e5ff;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6rem;
  letter-spacing: 0.2em;
  font-weight: 700;
  text-transform: uppercase;
  transition: background 200ms ease, border-color 200ms ease, box-shadow 200ms ease, transform 200ms ease, color 200ms ease;
}
.rsf-briefing__label { line-height: 1; }
.rsf-briefing__arrow {
  font-size: 0.85rem;
  line-height: 1;
  transition: transform 200ms ease;
}

.briefing-chart {
  display: inline-flex;
  align-items: flex-end;
  justify-content: space-between;
  width: 15px;
  height: 13px;
  padding: 2px 2px 1px;
  border: 1px solid currentColor;
  border-radius: 2px;
  box-sizing: border-box;
}
.briefing-chart > span {
  width: 2px;
  background: currentColor;
  display: block;
  transition: height 320ms ease;
}
.briefing-chart > span:nth-child(1) { height: 38%; }
.briefing-chart > span:nth-child(2) { height: 72%; }
.briefing-chart > span:nth-child(3) { height: 52%; }

.rsf-card:hover .rsf-briefing,
.rsf-card:focus-visible .rsf-briefing {
  background: linear-gradient(135deg, rgba(0, 229, 255, 0.18) 0%, rgba(0, 229, 255, 0.28) 100%);
  border-style: solid;
  border-color: #00e5ff;
  box-shadow:
    0 0 0 1px rgba(0, 229, 255, 0.25),
    0 6px 18px -6px rgba(0, 229, 255, 0.55);
  transform: translateX(2px);
  color: #e0fbff;
}
.rsf-card:hover .rsf-briefing__arrow,
.rsf-card:focus-visible .rsf-briefing__arrow {
  transform: translateX(3px);
}
.rsf-card:hover .briefing-chart > span:nth-child(1),
.rsf-card:focus-visible .briefing-chart > span:nth-child(1) { height: 62%; }
.rsf-card:hover .briefing-chart > span:nth-child(2),
.rsf-card:focus-visible .briefing-chart > span:nth-child(2) { height: 92%; }
.rsf-card:hover .briefing-chart > span:nth-child(3),
.rsf-card:focus-visible .briefing-chart > span:nth-child(3) { height: 45%; }

.rsf-hint {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.25rem;
  border-left: 2px solid rgba(0, 229, 255, 0.45);
  background: linear-gradient(90deg, rgba(0, 229, 255, 0.08), transparent 70%);
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(139, 148, 158, 0.9);
}
.rsf-hint__pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #00e5ff;
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.75);
  animation: rsf-hint-blink 1.6s ease-in-out infinite;
  flex-shrink: 0;
}
@keyframes rsf-hint-blink {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50%      { opacity: 1;    transform: scale(1); }
}
.text-neon-cyan { color: #00e5ff; font-weight: 700; }

@media (prefers-reduced-motion: reduce) {
  .rsf-hint__pulse { animation: none; }
}
</style>
