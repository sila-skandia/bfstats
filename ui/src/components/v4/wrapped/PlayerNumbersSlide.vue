<template>
  <div class="wrapped-slide numbers-slide animate-line-in" @click="$emit('next')">
    <div class="mm-eyebrow animate-rise-up" style="animation-delay: 0.05s">01 — THE YEAR IN NUMBERS</div>
    
    <div class="numbers-heading animate-rise-up" style="animation-delay: 0.1s">
      <div class="rounds-text">{{ data.yearInNumbers.roundsPlayed.toLocaleString() }} ROUNDS PLAYED BY</div>
      <div class="player-name-large">{{ data.playerName }}</div>
    </div>

    <div class="numbers-grid">
      <div class="grid-item animate-rise-up" style="animation-delay: 0.15s">
        <div class="stat-value">
          <num-count :data-to="data.yearInNumbers.roundsPlayed" data-dur="1000" data-delay="120"></num-count>
        </div>
        <div class="mm-eyebrow-small">ROUNDS PLAYED</div>
      </div>
      <div class="grid-item text-k animate-rise-up" style="animation-delay: 0.25s">
        <div class="stat-value">
          <num-count :data-to="data.yearInNumbers.totalKills" data-dur="1150" data-delay="240"></num-count>
        </div>
        <div class="mm-eyebrow-small">KILLS</div>
      </div>
      <div class="grid-item text-d animate-rise-up" style="animation-delay: 0.35s">
        <div class="stat-value">
          <num-count :data-to="data.yearInNumbers.totalDeaths" data-dur="1150" data-delay="360"></num-count>
        </div>
        <div class="mm-eyebrow-small">DEATHS</div>
      </div>
      <div class="grid-item animate-rise-up" style="animation-delay: 0.45s">
        <div class="stat-value">
          <num-count :data-to="Math.round(data.yearInNumbers.hoursInCombat)" data-dur="1150" data-delay="480"></num-count>
        </div>
        <div class="mm-eyebrow-small">HOURS IN COMBAT</div>
      </div>
    </div>

    <div class="numbers-footer animate-rise-up" style="animation-delay: 0.55s">
      K/D RATIO <span class="text-k">{{ data.yearInNumbers.kdRatio.toFixed(2) }}</span>
      <span class="divider">·</span>
      RANK <span class="text-accent">#{{ data.yearInNumbers.serverRank }}</span> ON <span class="text-strong">{{ data.serverName }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PlayerWrappedData } from '@/services/wrappedService'

defineProps<{
  data: PlayerWrappedData
}>()

defineEmits<{
  (e: 'next'): void
}>()
</script>

<style scoped>
.wrapped-slide {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  cursor: pointer;
  padding: 40px;
}

.mm-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--mm-ink-muted);
}

.numbers-heading {
  margin: 20px 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  text-align: left;
}

.rounds-text {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.15em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.player-name-large {
  font-family: var(--mm-font-display);
  font-weight: 700;
  font-size: clamp(32px, 6vw, 64px);
  line-height: 1;
  letter-spacing: -0.04em;
  color: var(--mm-ink);
  text-transform: uppercase;
  margin-top: 4px;
}

.numbers-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1px;
  background-color: var(--mm-rule);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  margin: auto 0;
}

@media (min-width: 768px) {
  .numbers-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.grid-item {
  background-color: var(--mm-bg);
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.stat-value {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(28px, 4vw, 44px);
  line-height: 1;
  color: var(--mm-ink);
}

.mm-eyebrow-small {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--mm-ink-muted);
  margin-top: 8px;
  text-transform: uppercase;
}

.text-k {
  color: var(--mm-kd-elite) !important;
}

.text-d {
  color: var(--mm-ink-muted) !important;
}

.text-accent {
  color: var(--mm-accent-soft);
  font-weight: 600;
}

.text-strong {
  color: var(--mm-ink);
}

.numbers-footer {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-muted);
  margin-top: 20px;
  line-height: 1.5;
}

.divider {
  color: var(--mm-ink-faint);
  margin: 0 8px;
}
</style>
