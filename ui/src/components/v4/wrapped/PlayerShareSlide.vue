<template>
  <div class="wrapped-slide share-slide animate-line-in">
    <div class="slide-header">
      <span class="slide-badge animate-rise-up" style="animation-delay: 0.05s">09 — THE SUMMARY</span>
      <h2 class="slide-title animate-rise-up" style="animation-delay: 0.1s">Your combat record.</h2>
    </div>

    <div class="share-container">
      <!-- The Card itself -->
      <div class="share-card animate-wrapped-in" style="animation-delay: 0.15s">
        <div class="card-header">
          <div class="mm-eyebrow">PLAYER WRAPPED · 2026</div>
          <span class="card-badge">#{{ data.yearInNumbers.serverRank }} · {{ data.serverName }}</span>
        </div>
        
        <div class="player-name">{{ data.playerName }}</div>
        
        <div class="card-stats-grid">
          <div class="stat-box">
            <div class="stat-num">{{ data.yearInNumbers.totalKills.toLocaleString() }}</div>
            <div class="mm-eyebrow-small">KILLS</div>
          </div>
          <div class="stat-box">
            <div class="stat-num text-kd">{{ data.yearInNumbers.kdRatio.toFixed(2) }}</div>
            <div class="mm-eyebrow-small">K/D</div>
          </div>
          <div class="stat-box">
            <div class="stat-num">{{ data.medals.killStreaks25 }}</div>
            <div class="mm-eyebrow-small">STREAKS 25+</div>
          </div>
          <div class="stat-box">
            <div class="stat-num text-rank">#{{ data.yearInNumbers.serverRank }}</div>
            <div class="mm-eyebrow-small">RANK</div>
          </div>
        </div>
        
        <div class="card-footer">
          BFSTATS.IO/WRAPPED
        </div>
      </div>

      <!-- Action Button -->
      <div class="share-actions animate-rise-up" style="animation-delay: 0.35s">
        <button class="mm-btn mm-btn--accent" @click="mockShare">Share card ↗</button>
        <span class="actions-meta">EXPORTS 1200×630 PNG</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PlayerWrappedData } from '@/services/wrappedService'

defineProps<{
  data: PlayerWrappedData
}>()

function mockShare() {
  alert('Exporting wrapped stats card (Mock Action)...')
}
</script>

<style scoped>
.wrapped-slide {
  width: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.slide-header {
  margin-bottom: 24px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.slide-badge {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.slide-title {
  font-family: var(--mm-font-display);
  font-size: 38px;
  font-weight: 300;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
  margin: 0;
}

.share-container {
  width: 100%;
  margin-top: auto;
  margin-bottom: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 24px;
}

.share-card {
  width: 100%;
  max-width: 800px;
  border: 1px solid var(--border-strong);
  border-radius: var(--mm-radius-sm, 2px);
  padding: 40px;
  background-color: var(--surface-page);
  text-align: left;
  aspect-ratio: 1200 / 630;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-sizing: border-box;
  transition: border-color 0.3s ease;
}

.share-card:hover {
  border-color: var(--mm-accent-soft);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  width: 100%;
}

.mm-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.card-badge {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--mm-accent-soft);
  text-transform: uppercase;
  border: 1px solid var(--mm-accent-soft);
  padding: 2px 8px;
  border-radius: 2px;
  max-width: 250px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-name {
  font-family: var(--mm-font-display);
  font-size: clamp(24px, 4.5vw, 46px);
  color: var(--mm-ink);
  margin: 24px 0;
  font-weight: 400;
}

.card-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  border-top: 1px solid var(--border-hairline);
  padding-top: 24px;
  width: 100%;
}

.stat-box {
  display: flex;
  flex-direction: column;
}

.stat-num {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(26px, 3.5vw, 44px);
  color: var(--mm-ink);
  line-height: 1.1;
}

.text-kd {
  color: var(--mm-kd-elite);
}

.text-rank {
  color: var(--mm-accent-soft);
}

.mm-eyebrow-small {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
  margin-top: 6px;
  text-transform: uppercase;
}

.card-footer {
  padding-top: 16px;
  border-top: 1px solid var(--border-hairline);
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  color: var(--mm-ink-muted);
  width: 100%;
}

.share-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  width: 100%;
}

.mm-btn {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.15em;
  padding: 10px 20px;
  border-radius: var(--mm-radius-sm, 2px);
  cursor: pointer;
  border: none;
  background-color: var(--mm-accent);
  color: var(--mm-highlight-ink);
  transition: background-color 0.2s ease;
  text-transform: uppercase;
}

.mm-btn:hover {
  background-color: var(--mm-accent-soft);
}

.actions-meta {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-faint);
}

@media (max-width: 768px) {
  .share-card {
    aspect-ratio: auto;
    padding: 24px;
  }
  .player-name {
    margin: 16px 0;
  }
  .card-stats-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }
}
</style>
