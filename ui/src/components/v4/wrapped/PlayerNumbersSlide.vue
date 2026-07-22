<template>
  <div class="wrapped-slide numbers-slide animate-line-in" @click="clickAdvancesSlide() && $emit('next')">
    <div class="numbers-content">
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
          <div v-if="data.yearInNumbers.roundsPercentile >= 50" class="stat-percentile animate-rise-up" style="animation-delay: 0.2s">
            TOP {{ Math.max(0.1, (100 - data.yearInNumbers.roundsPercentile)).toFixed(1) }}%
          </div>
        </div>
        <div class="grid-item text-k animate-rise-up" style="animation-delay: 0.25s">
          <div class="stat-value">
            <num-count :data-to="data.yearInNumbers.totalKills" data-dur="1150" data-delay="240"></num-count>
          </div>
          <div class="mm-eyebrow-small">KILLS</div>
          <div v-if="data.yearInNumbers.killsPercentile >= 50" class="stat-percentile text-k animate-rise-up" style="animation-delay: 0.3s">
            TOP {{ Math.max(0.1, (100 - data.yearInNumbers.killsPercentile)).toFixed(1) }}%
          </div>
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
          <div v-if="data.yearInNumbers.playTimePercentile >= 50" class="stat-percentile animate-rise-up" style="animation-delay: 0.5s">
            TOP {{ Math.max(0.1, (100 - data.yearInNumbers.playTimePercentile)).toFixed(1) }}%
          </div>
        </div>
      </div>

      <div class="numbers-footer">
        <div class="footer-row animate-rise-up" style="animation-delay: 0.55s">
          K/D RATIO <span class="text-k highlight">{{ data.yearInNumbers.kdRatio.toFixed(2) }}</span>
          <span v-if="data.yearInNumbers.kdPercentile >= 50" class="percentile-mini"> (TOP {{ Math.max(0.1, (100 - data.yearInNumbers.kdPercentile)).toFixed(1) }}%)</span>
          <span class="divider">·</span>
          PLAYED ON <span class="text-strong highlight">{{ data.serverName }}</span>
        </div>
        <div class="footer-row footer-ranks animate-rise-up" style="animation-delay: 0.65s">
          <div class="rank-item">
            <span class="rank-label">SCORE RANK</span>
            <span class="rank-val">#{{ data.yearInNumbers.serverRank }}</span>
          </div>
          <div class="rank-item">
            <span class="rank-label">KILLS RANK</span>
            <span class="rank-val">#{{ data.yearInNumbers.killsRank }}</span>
          </div>
          <div class="rank-item">
            <span class="rank-label">PLACEMENTS RANK</span>
            <span class="rank-val">#{{ data.yearInNumbers.placementsRank }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Right Column: Hero Image Card -->
    <div class="hero-image-container">
      <div class="hero-image-card">
        <div class="hero-placeholder">
          <div class="hero-title">HERO 02</div>
          <div class="hero-sub">THE CAMPAIGN<br>DROP: ch2p.webp</div>
        </div>
        <div class="hero-img-wrapper">
          <img :src="ch2p" alt="The Campaign" class="hero-img">
        </div>
        <div class="hero-overlay-smoke"></div>
        <div class="hero-overlay-grad"></div>
        <div class="hero-border-inset"></div>
        <div class="hero-corner hero-corner-tl"></div>
        <div class="hero-corner hero-corner-tr"></div>
        <div class="hero-corner hero-corner-bl"></div>
        <div class="hero-corner hero-corner-br"></div>
        <div class="hero-caption">
          <span class="hero-caption-dot"></span>
          Fig. 02 — The Campaign
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { clickAdvancesSlide } from './slideTap'
import type { PlayerWrappedData } from '@/services/wrappedService'
import ch2p from '@/assets/wrapped/ch2p.webp'

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
  padding: 0;
}

@media (min-width: 1024px) {
  .wrapped-slide {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
    gap: 46px;
    align-items: stretch;
    padding: 40px;
  }
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
  font-size: 13.5px; /* increased from 11px */
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

@media (min-width: 768px) and (max-width: 1023px) {
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
  font-size: 13px; /* increased from 10.5px */
  letter-spacing: 0.12em;
  color: var(--mm-ink-muted);
  margin-top: 8px;
  text-transform: uppercase;
}

.stat-percentile {
  font-family: var(--mm-font-mono);
  font-size: 12px; /* increased from 10px */
  letter-spacing: 0.05em;
  color: var(--mm-accent);
  margin-top: 5px;
  font-weight: 600;
  text-transform: uppercase;
}

.percentile-mini {
  font-family: var(--mm-font-mono);
  font-size: 13px; /* increased from 10.5px */
  color: var(--mm-accent);
  font-weight: 600;
  margin-left: 4px;
}

.text-k {
  color: var(--mm-kd-elite) !important;
}

.text-d {
  color: var(--mm-ink-muted) !important;
}

.text-accent {
  color: var(--mm-kd-elite);
  font-weight: 600;
}

.text-strong {
  color: var(--mm-ink);
}

.numbers-footer {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 20px;
}

.footer-row {
  font-family: var(--mm-font-mono);
  font-size: 14px; /* increased from 11.5px */
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
}

.footer-row .highlight {
  font-size: 16px; /* increased from 13px */
  font-weight: 600;
  margin-left: 6px;
}

.footer-ranks {
  display: flex;
  gap: 28px;
}

.rank-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.rank-label {
  font-size: 12px; /* increased from 10px */
  letter-spacing: 0.1em;
  color: var(--mm-ink-soft);
  text-transform: uppercase;
  margin-bottom: 2px;
}

.rank-val {
  font-family: var(--mm-font-display);
  font-size: 22px; /* increased from 19px */
  font-weight: 500;
  color: var(--mm-kd-elite);
}

.divider {
  color: var(--mm-ink-faint);
  margin: 0 10px;
}
</style>
