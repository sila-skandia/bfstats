<template>
  <div class="wrapped-slide dishonours-slide animate-line-in">
    <div class="slide-header">
      <div class="header-badge-row animate-rise-up" style="animation-delay: 0.05s">
        <span class="slide-badge">06 — DISHONOURS</span>
        <span class="mm-chip-love">WITH LOVE</span>
      </div>
      <h2 class="slide-title animate-rise-up" style="animation-delay: 0.1s">Someone had to.</h2>
    </div>

    <div class="dishonours-content">
      <div class="dishonours-grid">
        <!-- Cannon Fodder -->
        <div class="dishonour-card animate-rise-up" style="animation-delay: 0.15s">
          <div class="mm-eyebrow color-kill">CANNON FODDER</div>
          <div class="card-body-row">
            <span class="card-name">{{ data.dishonours.cannonFodder.playerName }}</span>
            <span class="card-val text-death">{{ data.dishonours.cannonFodder.value.toLocaleString() }} DEATHS</span>
          </div>
          <p class="card-desc">Died more than anyone alive. Showed up anyway.</p>
        </div>

        <!-- Hard Luck Division -->
        <div class="dishonour-card animate-rise-up" style="animation-delay: 0.23s">
          <div class="mm-eyebrow color-kill">HARD LUCK DIVISION</div>
          <div v-if="data.dishonours.hardLuck" class="card-body-row">
            <span class="card-name">{{ data.dishonours.hardLuck.playerName }}</span>
            <span class="card-val text-death">{{ (data.dishonours.hardLuck.lossRate * 100).toFixed(0) }}% LOSSES · {{ data.dishonours.hardLuck.rounds }} RDS</span>
          </div>
          <div v-else class="card-body-row">
            <span class="card-name">None</span>
            <span class="card-val text-muted">No records</span>
          </div>
          <p class="card-desc">Wrong team. Every single time.</p>
        </div>

        <!-- Dial-up Warrior -->
        <div class="dishonour-card animate-rise-up" style="animation-delay: 0.31s">
          <div class="mm-eyebrow color-kill">DIAL-UP WARRIOR</div>
          <div v-if="data.dishonours.dialUp" class="card-body-row">
            <span class="card-name">{{ data.dishonours.dialUp.playerName }}</span>
            <span class="card-val text-ping">{{ Math.round(data.dishonours.dialUp.avgPing) }} MS AVG PING</span>
          </div>
          <div v-else class="card-body-row">
            <span class="card-name">None</span>
            <span class="card-val text-muted">No records</span>
          </div>
          <p class="card-desc">Fought the entire war by airmail. Still qualified.</p>
        </div>

        <!-- Stat Tourist -->
        <div class="dishonour-card animate-rise-up" style="animation-delay: 0.39s">
          <div class="mm-eyebrow color-kill">STAT TOURIST</div>
          <div v-if="data.dishonours.statTourist" class="card-body-row">
            <span class="card-name text-strikethrough">{{ data.dishonours.statTourist.playerName }}</span>
            <span class="card-val text-muted">K/D {{ data.dishonours.statTourist.kdRatio.toFixed(1) }} · {{ data.dishonours.statTourist.rounds }} RDS</span>
          </div>
          <div v-else class="card-body-row">
            <span class="card-name">None</span>
            <span class="card-val text-muted">No records</span>
          </div>
          <p class="card-desc">No tourists. The 100-round minimum stands.</p>
        </div>
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
  margin-bottom: 24px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.header-badge-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.slide-badge {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.2em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.mm-chip-love {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  color: var(--mm-danger);
  border: 1px solid var(--mm-danger);
  padding: 2px 6px;
  border-radius: var(--mm-radius-sm, 2px);
  text-transform: uppercase;
  display: inline-block;
  font-weight: 600;
}

.slide-title {
  font-family: var(--mm-font-display);
  font-size: 38px;
  font-weight: 300;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
  margin: 0;
}

.dishonours-content {
  width: 100%;
  margin-top: auto;
  margin-bottom: auto;
  display: flex;
  flex-direction: column;
}

.dishonours-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
}

@media (min-width: 640px) {
  .dishonours-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.dishonour-card {
  border: 1px solid var(--mm-rule);
  border-radius: var(--mm-radius-sm, 2px);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  background-color: var(--mm-bg);
}

.mm-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 8.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.color-kill {
  color: var(--mm-danger);
}

.card-body-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-top: 8px;
}

.card-name {
  font-family: var(--mm-font-display);
  font-size: 16px;
  font-weight: 500;
  color: var(--mm-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.text-strikethrough {
  text-decoration: line-through;
  text-decoration-color: var(--mm-danger);
}

.card-val {
  font-family: var(--mm-font-mono);
  font-size: 13px;
  font-weight: 600;
}

.text-death {
  color: var(--mm-danger);
}

.text-ping {
  color: var(--mm-accent-soft);
}

.text-muted {
  color: var(--mm-ink-muted);
}

.card-desc {
  font-family: var(--mm-font-display);
  font-size: 12.5px;
  color: var(--mm-ink-muted);
  margin: 6px 0 0 0;
  line-height: 1.4;
  text-align: left;
}
</style>
