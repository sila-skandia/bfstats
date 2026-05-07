<template>
  <section
    v-if="rounds.length > 0"
    class="lrr"
    aria-label="Live rounds in progress"
  >
    <header class="lrr__head">
      <span class="lrr__label">
        <span class="lrr__pulse" aria-hidden="true" />
        LIVE ROUNDS
      </span>
      <span class="lrr__sub">Ranked by drama · tickets, fill, urgency</span>
    </header>
    <div class="lrr__rail">
      <router-link
        v-for="round in rounds"
        :key="round.roundId"
        :to="`/servers/${encodeURIComponent(round.serverName)}`"
        class="lrr-card"
      >
        <div class="lrr-card__head">
          <span class="lrr-card__drama" :title="`Drama score ${round.dramaScore}`">
            <span
              v-for="i in 5"
              :key="i"
              class="lrr-card__drama-pip"
              :class="{ 'lrr-card__drama-pip--on': i <= Math.ceil(round.dramaScore * 5) }"
            />
          </span>
          <span class="lrr-card__elapsed">{{ round.minutesElapsed }}m in</span>
        </div>
        <div class="lrr-card__map">{{ round.mapName || 'unknown map' }}</div>
        <div class="lrr-card__server" :title="round.serverName">{{ round.serverName }}</div>
        <div
          v-if="round.tickets1 != null && round.tickets2 != null"
          class="lrr-card__tickets"
          :aria-label="`Score ${round.tickets1} to ${round.tickets2}`"
        >
          <div class="lrr-card__team lrr-card__team--1">
            <span class="lrr-card__team-label">{{ round.team1Label || 'Team 1' }}</span>
            <span class="lrr-card__team-num">{{ round.tickets1 }}</span>
          </div>
          <div
            class="lrr-card__bar"
            aria-hidden="true"
          >
            <div
              class="lrr-card__bar-fill lrr-card__bar-fill--1"
              :style="{ width: team1Percent(round) + '%' }"
            />
          </div>
          <div class="lrr-card__team lrr-card__team--2">
            <span class="lrr-card__team-num">{{ round.tickets2 }}</span>
            <span class="lrr-card__team-label">{{ round.team2Label || 'Team 2' }}</span>
          </div>
        </div>
        <div class="lrr-card__foot">
          <button
            type="button"
            class="lrr-card__players"
            @click.prevent="$emit('show-players', round.serverName)"
          >
            <strong>{{ round.currentPlayers }}</strong>/{{ round.maxPlayers }}
          </button>
          <span class="lrr-card__sep" aria-hidden="true">·</span>
          <span v-if="round.roundTimeRemain && round.roundTimeRemain > 0">{{ formatRemain(round.roundTimeRemain) }} left</span>
          <span v-else>ongoing</span>
        </div>
        <div
          v-if="round.topPlayers && round.topPlayers.length > 0"
          class="lrr-card__leaders"
        >
          <span
            v-for="(player, pi) in round.topPlayers"
            :key="player.playerName + pi"
            class="lrr-card__leader"
            :class="`lrr-card__leader--${pi + 1}`"
          >
            <span class="lrr-card__leader-rank">#{{ pi + 1 }}</span>
            <span class="lrr-card__leader-name">{{ $pn(player.playerName) }}</span>
            <span class="lrr-card__leader-score">{{ player.score }}</span>
          </span>
        </div>
      </router-link>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { LiveRoundSummary } from '@/services/landingV3Service'

const props = defineProps<{ rounds: LiveRoundSummary[] }>()

defineEmits<{
  'show-players': [server: string]
}>()

const team1Percent = (round: LiveRoundSummary): number => {
  const t1 = round.tickets1 ?? 0
  const t2 = round.tickets2 ?? 0
  const total = t1 + t2
  if (total <= 0) return 50
  return Math.max(5, Math.min(95, Math.round((t1 / total) * 100)))
}

const formatRemain = (seconds: number): string => {
  const mins = Math.max(0, Math.round(seconds / 60))
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}

// expose for template compiler when props referenced
void props
</script>

<style scoped>
.lrr {
  margin: 1rem 0 1.5rem;
}
.lrr__head {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
  padding: 0 0.25rem;
}
.lrr__label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  color: #f87171;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  text-shadow: 0 0 8px rgba(248, 113, 113, 0.5);
}
.lrr__pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f87171;
  box-shadow: 0 0 10px rgba(248, 113, 113, 0.8);
  animation: lrr-pulse 1.6s ease-in-out infinite;
}
@keyframes lrr-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.4); }
}
.lrr__sub {
  font-size: 0.72rem;
  color: var(--portal-text);
  opacity: 0.75;
}
.lrr__rail {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(260px, 1fr);
  gap: 0.75rem;
  overflow-x: auto;
  padding: 0.25rem;
  scroll-snap-type: x mandatory;
}
@media (min-width: 768px) {
  .lrr__rail {
    grid-auto-columns: minmax(300px, 1fr);
  }
}
.lrr-card {
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.75rem 0.85rem;
  background: var(--portal-surface);
  border: 1px solid var(--portal-border);
  border-radius: 8px;
  text-decoration: none;
  color: var(--portal-text-bright);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  min-width: 0;
  position: relative;
}
.lrr-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 10%;
  bottom: 10%;
  width: 2px;
  background: linear-gradient(180deg, transparent, var(--portal-accent), transparent);
  opacity: 0.55;
  border-radius: 1px;
}
.lrr-card:hover {
  border-color: var(--portal-accent);
  box-shadow: 0 0 20px var(--portal-accent-glow);
}
.lrr-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.68rem;
  letter-spacing: 0.12em;
  color: var(--portal-text);
}
.lrr-card__drama {
  display: inline-flex;
  gap: 2px;
}
.lrr-card__drama-pip {
  width: 6px;
  height: 6px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.08);
}
.lrr-card__drama-pip--on {
  background: var(--portal-accent);
  box-shadow: 0 0 6px var(--portal-accent);
}
.lrr-card__elapsed {
  text-transform: uppercase;
  opacity: 0.75;
}
.lrr-card__map {
  font-size: 1rem;
  font-weight: 700;
  text-transform: capitalize;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lrr-card__server {
  font-size: 0.78rem;
  color: var(--portal-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lrr-card__tickets {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0;
}
.lrr-card__team {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
}
.lrr-card__team--2 {
  flex-direction: row-reverse;
}
.lrr-card__team-label {
  color: var(--portal-text);
  max-width: 6rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lrr-card__team-num {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--portal-text-bright);
}
.lrr-card__bar {
  height: 4px;
  background: rgba(192, 132, 252, 0.3);
  border-radius: 2px;
  overflow: hidden;
  box-shadow: inset 0 0 4px rgba(192, 132, 252, 0.2);
}
.lrr-card__bar-fill {
  height: 100%;
  background: var(--portal-accent);
  box-shadow: 0 0 6px var(--portal-accent-glow);
  transition: width 0.3s ease;
}
.lrr-card__foot {
  display: flex;
  gap: 0.35rem;
  align-items: center;
  font-size: 0.76rem;
  color: var(--portal-text);
}
.lrr-card__players {
  background: transparent;
  border: 0;
  padding: 0;
  font-family: inherit;
  font-size: 0.76rem;
  color: var(--portal-text);
  cursor: pointer;
}
.lrr-card__players strong {
  color: var(--portal-text-bright);
  font-weight: 700;
}
.lrr-card__players:hover strong {
  color: var(--portal-accent);
}
.lrr-card__sep { opacity: 0.5; }
.lrr-card__leaders {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 0.25rem;
  padding-top: 0.4rem;
  border-top: 1px dashed var(--portal-border);
}
.lrr-card__leader {
  display: grid;
  grid-template-columns: 1.5rem 1fr auto;
  gap: 0.4rem;
  font-size: 0.74rem;
  align-items: baseline;
}
.lrr-card__leader-rank {
  color: var(--portal-accent);
  font-weight: 600;
  font-size: 0.68rem;
}
.lrr-card__leader--1 .lrr-card__leader-rank { color: var(--portal-accent); }
.lrr-card__leader-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lrr-card__leader-score {
  font-variant-numeric: tabular-nums;
  color: var(--portal-text-bright);
  font-weight: 600;
}
</style>
