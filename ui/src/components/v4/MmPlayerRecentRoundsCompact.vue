<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { Session } from '@/types/playerStatsTypes'
import { formatLocalTooltip, formatRelativeTimeShort } from '@/utils/timeUtils'
import { kdClass } from '@/views/v4/mmTokens'

const props = defineProps<{
  sessions: Session[]
  playerName: string
}>()

const router = useRouter()

const badgeSessions = computed(() => (props.sessions ?? []).slice(0, 10))

// Debrief panel is closed initially; clicking a square reveals it
const activeSession = ref<Session | null>(null)

const toggleSession = (session: Session) => {
  if (activeSession.value?.sessionId === session.sessionId) {
    activeSession.value = null
  } else {
    activeSession.value = session
  }
}

const formatPlacement = (placement: number | null): string => {
  if (!placement || placement <= 0) return '—'
  return `#${placement}`
}

const resultChar = (result: Session['teamResult']): string => {
  if (result === 'win') return 'W'
  if (result === 'loss') return 'L'
  if (result === 'tie') return 'D'
  return '—'
}

const resultLabel = (result: Session['teamResult']): string => {
  if (result === 'win') return 'Win'
  if (result === 'loss') return 'Loss'
  if (result === 'tie') return 'Draw'
  return '—'
}

const resultChipClass = (result: Session['teamResult']): string => {
  if (result === 'win') return 'mm-chip--win'
  if (result === 'loss') return 'mm-chip--loss'
  return 'mm-chip--off'
}

const kdValue = (s: Session): number => {
  if (s.totalDeaths === 0) return s.totalKills
  return s.totalKills / s.totalDeaths
}

const navigateToRoundReport = (session: Session) => {
  if (!session.roundId) return
  router.push({
    path: `/v4/rounds/${encodeURIComponent(session.roundId)}/report`,
    query: { players: props.playerName },
  })
}
</script>

<template>
  <div class="mm-recent-rounds">
    <div v-if="badgeSessions.length === 0" class="mm-empty" style="border: 0; padding: 14px 0">
      No recent rounds recorded.
    </div>

    <template v-else>
      <!-- L / W Squares Ribbon -->
      <div class="mm-match-squares" role="toolbar" aria-label="Recent combat match history">
        <button
          v-for="(session, index) in badgeSessions"
          :key="`sq-${session.roundId}-${session.sessionId}-${index}`"
          type="button"
          class="mm-match-square"
          :class="[
            `mm-match-square--${session.teamResult}`,
            { 'mm-match-square--active': activeSession?.sessionId === session.sessionId }
          ]"
          :aria-label="`Round ${index + 1}: ${resultLabel(session.teamResult)} on ${session.mapName || 'Unknown'}. Click to inspect.`"
          :title="`${resultLabel(session.teamResult)} · ${session.mapName || 'Unknown'} · ${session.totalKills}k/${session.totalDeaths}d · ${formatRelativeTimeShort(session.startTime)}`"
          @click="toggleSession(session)"
        >
          <span class="mm-match-square__char">{{ resultChar(session.teamResult) }}</span>

          <!-- Floating hover tooltip -->
          <span class="mm-match-square__tooltip" role="tooltip">
            <span class="mm-sq-tip__res" :class="`is-${session.teamResult}`">
              [{{ resultChar(session.teamResult) }}]
            </span>
            <span class="mm-sq-tip__map">{{ session.mapName || 'Unknown' }}</span>
            <span class="mm-sq-tip__stats">
              {{ session.totalKills }}k / {{ session.totalDeaths }}d · {{ kdValue(session).toFixed(2) }} K/D
            </span>
            <span class="mm-sq-tip__time">{{ formatRelativeTimeShort(session.startTime) }}</span>
          </span>
        </button>
      </div>

      <!-- Active inspected round debrief panel (revealed on click) -->
      <div
        v-if="activeSession"
        class="mm-match-card"
      >
        <div class="mm-match-card__head">
          <div class="mm-match-card__meta">
            <span class="mm-chip" :class="resultChipClass(activeSession.teamResult)">
              {{ resultLabel(activeSession.teamResult).toUpperCase() }}
            </span>
            <span class="mm-match-card__map">{{ activeSession.mapName || 'Unknown' }}</span>
            <span v-if="activeSession.gameType" class="mm-match-card__mode">
              {{ activeSession.gameType.toUpperCase() }}
            </span>
          </div>
          <button
            type="button"
            class="mm-match-card__close"
            aria-label="Close debrief panel"
            @click="activeSession = null"
          >
            [x]
          </button>
        </div>

        <div class="mm-match-card__subhead">
          <span class="mm-match-card__server">{{ $pn(activeSession.serverName) }}</span>
          <span
            class="mm-match-card__date"
            :title="formatLocalTooltip(activeSession.startTime)"
          >
            {{ formatRelativeTimeShort(activeSession.startTime) }}
          </span>
        </div>

        <div class="mm-match-card__body">
          <div class="mm-match-card__col">
            <span class="mm-match-card__lbl">Score</span>
            <span class="mm-match-card__val">{{ activeSession.totalScore.toLocaleString() }}</span>
          </div>
          <div class="mm-match-card__col">
            <span class="mm-match-card__lbl">Placement</span>
            <span
              class="mm-match-card__val"
              :class="activeSession.placement && activeSession.placement <= 3 ? 'mm-num--score' : 'is-muted'"
            >
              {{ formatPlacement(activeSession.placement) }}
            </span>
          </div>
          <div class="mm-match-card__col">
            <span class="mm-match-card__lbl">K / D</span>
            <span class="mm-match-card__val">
              <span class="mm-num--kill">{{ activeSession.totalKills }}</span>
              <span class="mm-num__sep">/</span>
              <span class="mm-num--death">{{ activeSession.totalDeaths }}</span>
            </span>
          </div>
          <div class="mm-match-card__col">
            <span class="mm-match-card__lbl">Ratio</span>
            <span class="mm-match-card__val" :class="kdClass(kdValue(activeSession))">
              {{ kdValue(activeSession).toFixed(2) }}
            </span>
          </div>
        </div>

        <div class="mm-match-card__actions">
          <button
            v-if="activeSession.roundId"
            type="button"
            class="mm-btn mm-btn--sm mm-btn--primary"
            @click="navigateToRoundReport(activeSession)"
          >
            Inspect round [-&gt;]
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mm-recent-rounds {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* L / W Squares Ribbon */
.mm-match-squares {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.mm-match-square {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: var(--mm-radius-sm, 3px);
  cursor: pointer;
  padding: 0;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  transition: transform 0.12s ease, background-color 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;
  user-select: none;
}

.mm-match-square:hover {
  transform: translateY(-1px);
}

.mm-match-square:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: 2px;
}

/* Win Square */
.mm-match-square--win {
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.5);
  color: var(--mm-success);
}
.mm-match-square--win:hover {
  background: rgba(34, 197, 94, 0.25);
  border-color: var(--mm-success);
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.35);
}
.mm-match-square--win.mm-match-square--active {
  background: var(--mm-success);
  color: #000000;
  border-color: var(--mm-success);
  box-shadow: 0 0 0 2px #0f0f0f, 0 0 0 4px var(--mm-success);
}

/* Loss Square */
.mm-match-square--loss {
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.5);
  color: var(--mm-danger);
}
.mm-match-square--loss:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: var(--mm-danger);
  box-shadow: 0 0 8px rgba(239, 68, 68, 0.35);
}
.mm-match-square--loss.mm-match-square--active {
  background: var(--mm-danger);
  color: #ffffff;
  border-color: var(--mm-danger);
  box-shadow: 0 0 0 2px #0f0f0f, 0 0 0 4px var(--mm-danger);
}

/* Tie Square */
.mm-match-square--tie {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: var(--mm-ink-soft);
}
.mm-match-square--tie:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: var(--mm-ink-muted);
}
.mm-match-square--tie.mm-match-square--active {
  background: var(--mm-ink-soft);
  color: #000000;
  border-color: var(--mm-ink);
  box-shadow: 0 0 0 2px #0f0f0f, 0 0 0 4px var(--mm-ink);
}

.mm-match-square__char {
  line-height: 1;
}

/* Floating Hover Tooltip */
.mm-match-square__tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  background: #181818;
  border: 1px solid var(--mm-rule, rgba(255, 255, 255, 0.15));
  border-radius: var(--mm-radius-sm, 3px);
  padding: 6px 10px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease, transform 0.15s ease;
  z-index: 40;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}

.mm-match-square:hover .mm-match-square__tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.mm-match-square:nth-child(-n+2) .mm-match-square__tooltip {
  left: 0;
  transform: translateX(0) translateY(4px);
}
.mm-match-square:nth-child(-n+2):hover .mm-match-square__tooltip {
  transform: translateX(0) translateY(0);
}

.mm-match-square:nth-last-child(-n+2) .mm-match-square__tooltip {
  left: auto;
  right: 0;
  transform: translateX(0) translateY(4px);
}
.mm-match-square:nth-last-child(-n+2):hover .mm-match-square__tooltip {
  transform: translateX(0) translateY(0);
}

.mm-sq-tip__res {
  font-weight: 700;
  margin-right: 4px;
}
.mm-sq-tip__res.is-win { color: var(--mm-success); }
.mm-sq-tip__res.is-loss { color: var(--mm-danger); }
.mm-sq-tip__res.is-tie { color: var(--mm-ink-muted); }

.mm-sq-tip__map {
  color: var(--mm-ink);
  font-weight: 500;
}

.mm-sq-tip__stats {
  color: var(--mm-ink-soft);
  font-size: 10px;
}

.mm-sq-tip__time {
  color: var(--mm-ink-muted);
  font-size: 9.5px;
}

/* Debrief card */
.mm-match-card {
  border: 1px solid var(--mm-rule, rgba(255, 255, 255, 0.12));
  background: var(--mm-surface-soft, #161616);
  border-radius: var(--mm-radius-sm, 3px);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  animation: mmFadeSlide 0.15s ease-out;
}

@keyframes mmFadeSlide {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.mm-match-card__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.mm-match-card__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.mm-match-card__map {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--mm-ink);
}

.mm-match-card__mode {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  color: var(--mm-ink-muted);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 1px 4px;
  border-radius: 2px;
}

.mm-match-card__close {
  background: none;
  border: 0;
  color: var(--mm-ink-muted);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 4px;
}
.mm-match-card__close:hover {
  color: var(--mm-ink);
}

.mm-match-card__subhead {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  font-size: 11px;
  color: var(--mm-ink-muted);
  font-family: var(--mm-font-mono);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding-bottom: 8px;
}

.mm-match-card__server {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.mm-match-card__body {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(55px, 1fr));
  gap: 8px;
}

.mm-match-card__col {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mm-match-card__lbl {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
}

.mm-match-card__val {
  font-family: var(--mm-font-mono);
  font-size: 13.5px;
  font-weight: 700;
  color: var(--mm-ink);
}

.mm-match-card__actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}
</style>
