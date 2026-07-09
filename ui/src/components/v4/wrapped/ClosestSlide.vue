<template>
  <div class="wrapped-slide closest-slide animate-line-in">
    <div class="slide-header">
      <span class="slide-badge animate-rise-up" style="animation-delay: 0.05s">07 — CLOSEST BATTLES · 50+ SOLDIERS</span>
      <h2 class="slide-title animate-rise-up" style="animation-delay: 0.1s">Decided by {{ lowestMargin }} {{ lowestMargin === 1 ? 'ticket' : 'tickets' }}.</h2>
    </div>

    <div class="closest-content">
      <div class="battles-flex-container">
        <div 
          v-for="(battle, idx) in data.closestBattles.slice(0, 3)" 
          :key="idx" 
          class="battle-card-item animate-rise-up"
          :style="{ animationDelay: ((idx * 0.08) + 0.15) + 's' }"
        >
          <div class="battle-date-mono">{{ formatDate(battle.date) }}</div>
          <div class="battle-map-name">{{ battle.mapName }}</div>
          <div class="battle-margin-val">{{ battle.ticketsMargin }}</div>
          <div class="mm-eyebrow">TICKET MARGIN</div>
          <div class="battle-details-row">
            <span><strong class="text-ink">{{ battle.playersCount }}</strong> SOLDIERS</span>
            <span>{{ Math.round(battle.durationMinutes) }} MINS</span>
          </div>
        </div>
        <div v-if="data.closestBattles.length === 0" class="empty-state">
          No records of extremely close rounds.
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ServerWrappedData } from '@/services/wrappedService'

const props = defineProps<{
  data: ServerWrappedData
}>()

const lowestMargin = computed(() => {
  if (!props.data.closestBattles || props.data.closestBattles.length === 0) return 3
  return Math.min(...props.data.closestBattles.map(b => b.ticketsMargin))
})

function formatDate(dateStr: string): string {
  if (!dateStr || dateStr.startsWith('-999')) return '2026'
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
  } catch {
    return '2026'
  }
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

.closest-content {
  width: 100%;
  margin-top: auto;
  margin-bottom: auto;
  display: flex;
  flex-direction: column;
}

.battles-flex-container {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
}

@media (min-width: 640px) {
  .battles-flex-container {
    flex-direction: row;
  }
}

.battle-card-item {
  flex: 1;
  border: 1px solid var(--mm-rule);
  border-radius: var(--mm-radius-sm, 2px);
  padding: 12px 14px;
  background-color: var(--mm-bg);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}

.battle-date-mono {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--mm-ink-muted);
}

.battle-map-name {
  font-family: var(--mm-font-display);
  font-size: 17px;
  color: var(--mm-ink);
  margin: 7px 0 12px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}

.battle-margin-val {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: 40px;
  line-height: 1;
  color: var(--mm-danger);
}

.mm-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 8.5px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
  margin-top: 5px;
}

.battle-details-row {
  display: flex;
  gap: 10px;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--mm-rule);
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
  width: 100%;
}

.text-ink {
  color: var(--mm-ink);
}

.empty-state {
  text-align: center;
  padding: 30px;
  color: var(--mm-ink-faint);
  font-family: var(--mm-font-mono);
  font-size: 11px;
  width: 100%;
}
</style>
