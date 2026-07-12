<template>
  <div class="wrapped-slide honours-slide animate-line-in">
    <div class="slide-header">
      <span class="slide-badge animate-rise-up" style="animation-delay: 0.05s">04 — HONOURS</span>
      <h2 class="slide-title animate-rise-up" style="animation-delay: 0.1s">Skill, not hours.</h2>
      <span class="mm-chip mm-chip--accent animate-rise-up" style="animation-delay: 0.15s">MIN 100 ROUNDS</span>
    </div>

    <div class="honours-content">
      <!-- Stacked on mobile, side-by-side on desktop -->
      <div class="boards-grid">
        <!-- 1. K/D Ratio Board -->
        <div class="board-card">
          <div class="board-header-row animate-rise-up" style="animation-delay: 0.15s">
            <span>K/D RATIO</span>
            <span>RDS</span>
          </div>
          <div 
            v-for="(p, i) in data.honours.topKDRatios.slice(0, 10)" 
            :key="p.playerName" 
            class="board-row animate-rise-up"
            :style="{ animationDelay: ((i * 0.08) + 0.2) + 's' }"
          >
            <span class="col-rank">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="col-name">{{ p.playerName }}</span>
            <span class="col-stat text-elite">{{ p.kdRatio.toFixed(2) }}</span>
            <span class="col-rounds">{{ p.rounds }}</span>
          </div>
          <div v-if="data.honours.topKDRatios.length === 0" class="empty-state">
            No qualified combatants.
          </div>
        </div>

        <!-- 2. Kill Rate Board -->
        <div class="board-card">
          <div class="board-header-row animate-rise-up" style="animation-delay: 0.25s">
            <span>KILL RATE · KILLS/MIN</span>
            <span>RDS</span>
          </div>
          <div 
            v-for="(p, i) in data.honours.topKillRates.slice(0, 10)" 
            :key="p.playerName" 
            class="board-row animate-rise-up"
            :style="{ animationDelay: ((i * 0.08) + 0.3) + 's' }"
          >
            <span class="col-rank">{{ String(i + 1).padStart(2, '0') }}</span>
            <span class="col-name">{{ p.playerName }}</span>
            <span class="col-stat text-elite">{{ p.killRate.toFixed(2) }}</span>
            <span class="col-rounds">{{ p.rounds }}</span>
          </div>
          <div v-if="data.honours.topKillRates.length === 0" class="empty-state">
            No qualified combatants.
          </div>
        </div>
      </div>

      <!-- Volume Board Footer -->
      <div class="volume-footer animate-rise-up" style="animation-delay: 0.5s">
        <span class="volume-title">VOLUME BOARDS (THEY TRACK HOURS, NOT SKILL) — </span>
        <span class="volume-mobile-prefix">VOLUME BOARDS — </span>
        <span class="volume-item">
          SCORE <strong class="text-highlight">{{ data.honours.volumeBoards.topScore.playerName || 'None' }} {{ data.honours.volumeBoards.topScore.value.toLocaleString() }}</strong>
        </span>
        <span class="divider">·</span>
        <span class="volume-item">
          KILLS <strong class="text-highlight">{{ data.honours.volumeBoards.topKills.playerName || 'None' }} {{ data.honours.volumeBoards.topKills.value.toLocaleString() }}</strong>
        </span>
        <span class="divider">·</span>
        <span class="volume-item">
          HOURS <strong class="text-highlight">{{ data.honours.volumeBoards.topHours.playerName || 'None' }} {{ data.honours.volumeBoards.topHours.value.toLocaleString() }}h</strong>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ServerWrappedData } from '@/services/wrappedService'

defineProps<{
  data: ServerWrappedData
}>()
</script>

<style scoped>
.wrapped-slide {
  width: 100%;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
}

.slide-header {
  margin-bottom: 20px;
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

.mm-chip--accent {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  color: var(--mm-accent-soft);
  border: 1px solid var(--mm-rule);
  padding: 2px 6px;
  border-radius: var(--mm-radius-sm, 2px);
  text-transform: uppercase;
  display: inline-block;
  margin-top: 4px;
}

.honours-content {
  width: 100%;
  display: flex;
  flex-direction: column;
}

.boards-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

@media (min-width: 1024px) {
  .boards-grid {
    grid-template-columns: 1fr 1fr;
    gap: 40px;
  }
}

.board-card {
  display: flex;
  flex-direction: column;
}

.board-header-row {
  display: flex;
  justify-content: space-between;
  background-color: var(--mm-highlight);
  color: #000;
  border-radius: var(--mm-radius-sm, 2px);
  padding: 5px 12px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 600;
}

.board-row {
  display: flex;
  align-items: baseline;
  padding: 12px 12px;
  border-bottom: 1px solid var(--mm-rule);
}

@media (min-width: 1024px) {
  .board-row {
    padding: 7px 12px;
  }
}

.col-rank {
  width: 28px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-faint);
}

.col-name {
  flex: 1;
  font-family: var(--mm-font-display);
  font-size: 14.5px;
  font-weight: 500;
  color: var(--mm-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-right: 12px;
  text-align: left;
}

.col-stat {
  font-family: var(--mm-font-mono);
  font-size: 14px;
  font-weight: 600;
}

.text-elite {
  color: var(--mm-accent-soft);
}

.col-rounds {
  width: 44px;
  text-align: right;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-faint);
}

.empty-state {
  text-align: center;
  padding: 20px;
  color: var(--mm-ink-faint);
  font-family: var(--mm-font-mono);
  font-size: 11px;
}

.volume-footer {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid var(--mm-rule);
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
  line-height: 1.6;
  text-align: left;
}

.volume-mobile-prefix {
  display: none;
}

.volume-title {
  color: var(--mm-ink-faint);
}

.text-highlight {
  color: var(--mm-ink);
  font-weight: 600;
}

.divider {
  margin: 0 8px;
  color: var(--mm-ink-faint);
}

@media (max-width: 1023px) {
  .board-card .board-row:nth-child(n+5) {
    display: none !important;
  }
  
  .volume-title {
    display: none;
  }
  
  .volume-mobile-prefix {
    display: inline;
    color: var(--mm-ink-muted);
  }
  
  .volume-footer {
    margin-top: 20px;
    line-height: 1.8;
  }
}
</style>
