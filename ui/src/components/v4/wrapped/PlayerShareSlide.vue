<template>
  <div class="wrapped-slide share-slide">
    <div class="share-container">
      <!-- The Card itself -->
      <div class="share-card">
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
      <div class="share-actions">
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
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
}

.share-container {
  width: 100%;
  max-width: 460px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.share-card {
  border: 1px solid var(--border-strong);
  border-radius: var(--mm-radius-sm, 2px);
  padding: 22px;
  background-color: var(--surface-page);
  text-align: left;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
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
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--mm-accent-soft);
  text-transform: uppercase;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-name {
  font-family: var(--mm-font-display);
  font-size: clamp(20px, 3.5vw, 28px);
  color: var(--mm-ink);
  margin: 12px 0 16px 0;
  font-weight: 400;
}

.card-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  border-top: 1px solid var(--border-hairline);
  padding-top: 14px;
}

.stat-box {
  display: flex;
  flex-direction: column;
}

.stat-num {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(18px, 2.5vw, 24px);
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
  font-size: 8px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
  margin-top: 5px;
  text-transform: uppercase;
}

.card-footer {
  margin-top: 18px;
  padding-top: 11px;
  border-top: 1px solid var(--border-hairline);
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  color: var(--mm-ink-muted);
}

.share-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.mm-btn {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  padding: 8px 16px;
  border-radius: var(--mm-radius-sm, 2px);
  cursor: pointer;
  border: none;
  background-color: var(--mm-accent);
  color: var(--mm-highlight-ink);
  transition: background-color 0.2s ease;
}

.mm-btn:hover {
  background-color: var(--mm-accent-soft);
}

.actions-meta {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-faint);
}
</style>
