<template>
  <div class="wrapped-slide dishonours-slide animate-line-in" @click="$emit('next')">
    <div class="dishonours-left-container">
      <div class="mm-eyebrow animate-rise-up" style="animation-delay: 0.05s">04 — DISHONOURS</div>
      
      <div class="dishonours-heading animate-rise-up" style="animation-delay: 0.1s">
        The not-so-positive fronts.
      </div>

      <div v-if="dishonourCards.length > 0" class="dishonours-list">
        <div 
          v-for="card in dishonourCards" 
          :key="card.label" 
          class="dishonour-card animate-rise-up" 
          :style="{ animationDelay: card.delay }"
        >
          <div class="card-meta">
            <span class="card-title">{{ card.label }}</span>
            <span class="card-rounds">{{ card.rounds }} RDS</span>
          </div>
          
          <div class="card-body">
            <div class="map-name">{{ card.mapName }}</div>
            <div class="value-row">
              <span class="card-val text-danger">{{ card.valNum }}</span>
              <span class="card-unit">{{ card.valUnit }}</span>
            </div>
          </div>
          
          <div class="card-comparison-row">
            <div class="cmp-stats-left">
              <div class="cmp-stat-inline">
                <span class="cmp-label">YOUR AVG</span>
                <span class="cmp-val-inline text-accent">{{ card.avgStr }}</span>
              </div>
              <div class="cmp-stat-inline">
                <span class="cmp-label">YOUR BEST</span>
                <span class="cmp-val-inline text-success">{{ card.bestStr }}</span>
              </div>
            </div>
            <div class="cmp-badge" :class="card.deltaClass">
              {{ card.deltaStr }}
            </div>
          </div>
        </div>
      </div>
      
      <div v-else class="lone-wolf-container animate-rise-up" style="animation-delay: 0.15s">
        <div class="lone-wolf-body">
          No dishonourable activity detected. A clean slate.
        </div>
      </div>

      <!-- Footer Caption matching the design screenshot -->
      <div v-if="dishonourCards.length > 0" class="dishonours-footer animate-rise-up" style="animation-delay: 0.55s">
        EVERY SOLDIER HAS A <span class="text-danger">{{ captionMapName }}</span>. YOURS JUST HAS RECEIPTS.
      </div>
    </div>

    <!-- Right Column: Hero Image Card -->
    <div class="hero-image-container">
      <div class="hero-image-card">
        <div class="hero-placeholder">
          <div class="hero-title">HERO 05</div>
          <div class="hero-sub">DISHONOURS<br>DROP: pw_dishonours.webp</div>
        </div>
        <div class="hero-img-wrapper">
          <img :src="pwDishonours" alt="Dishonours" class="hero-img">
        </div>
        <div class="hero-overlay-smoke"></div>
        <div class="hero-overlay-grad"></div>
        <div class="hero-border-inset"></div>
        <div class="hero-corner hero-corner-tl"></div>
        <div class="hero-corner hero-corner-tr"></div>
        <div class="hero-corner hero-corner-bl"></div>
        <div class="hero-corner hero-corner-br"></div>
        <div class="hero-caption">
          <span class="hero-caption-dot" style="background-color: var(--mm-danger)"></span>
          Fig. 05 — Dishonours
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PlayerWrappedData } from '@/services/wrappedService'
import pwDishonours from '@/assets/wrapped/pw_dishonours.webp'

const props = defineProps<{
  data: PlayerWrappedData
}>()

defineEmits<{
  (e: 'next'): void
}>()

function formatDelta(val: number | string): string {
  const num = typeof val === 'string' ? parseFloat(val) : val
  if (isNaN(num)) return val.toString()
  const isPercent = typeof val === 'string' && val.includes('%')
  const sign = num > 0 ? '+' : ''
  return `${sign}${num}${isPercent ? '%' : ''}`
}

const captionMapName = computed(() => {
  return props.data.dishonours?.leastFavoriteMapByKd?.mapName?.toUpperCase() || 'KHARKOV'
})

const dishonourCards = computed(() => {
  if (!props.data.dishonours) return []
  
  const d = props.data.dishonours
  const list = []
  
  if (d.leastFavoriteMapByKd) {
    list.push({
      label: 'LEAST FAVOURITE MAP (BY K/D)',
      mapName: d.leastFavoriteMapByKd.mapName,
      rounds: d.leastFavoriteMapByKd.rounds,
      valNum: d.leastFavoriteMapByKd.value.toFixed(2),
      valUnit: 'K/D',
      avgStr: d.leastFavoriteMapByKd.playerAvg.toFixed(2),
      bestStr: d.leastFavoriteMapByKd.playerBest.toFixed(2),
      deltaStr: formatDelta(d.leastFavoriteMapByKd.delta.toFixed(2)),
      deltaClass: d.leastFavoriteMapByKd.delta < 0 ? 'badge-bad' : 'badge-good',
      delay: '0.15s'
    })
  }
  
  if (d.lowestKillRateMap) {
    list.push({
      label: 'LOWEST KILL RATE MAP',
      mapName: d.lowestKillRateMap.mapName,
      rounds: d.lowestKillRateMap.rounds,
      valNum: d.lowestKillRateMap.value.toFixed(1),
      valUnit: 'KILLS/RD',
      avgStr: d.lowestKillRateMap.playerAvg.toFixed(1),
      bestStr: d.lowestKillRateMap.playerBest.toFixed(1),
      deltaStr: formatDelta(d.lowestKillRateMap.delta.toFixed(1)),
      deltaClass: d.lowestKillRateMap.delta < 0 ? 'badge-bad' : 'badge-good',
      delay: '0.23s'
    })
  }
  
  if (d.mostLossesMap) {
    list.push({
      label: 'HARD LUCK FRONT (LOSS RATE)',
      mapName: d.mostLossesMap.mapName,
      rounds: d.mostLossesMap.rounds,
      valNum: `${Math.round(d.mostLossesMap.value * 100)}%`,
      valUnit: 'LOSSES',
      avgStr: `${Math.round(d.mostLossesMap.playerAvg * 100)}%`,
      bestStr: `${Math.round(d.mostLossesMap.playerBest * 100)}%`,
      deltaStr: formatDelta(`${Math.round(d.mostLossesMap.delta * 100)}%`),
      // For losses, positive delta (more losses than avg) is bad
      deltaClass: d.mostLossesMap.delta > 0 ? 'badge-bad' : 'badge-good',
      delay: '0.31s'
    })
  }
  
  if (d.lowestScoreRateMap) {
    list.push({
      label: 'UNSUNG HERO (LOWEST SCORE RATE)',
      mapName: d.lowestScoreRateMap.mapName,
      rounds: d.lowestScoreRateMap.rounds,
      valNum: Math.round(d.lowestScoreRateMap.value).toString(),
      valUnit: 'SCORE/RD',
      avgStr: Math.round(d.lowestScoreRateMap.playerAvg).toString(),
      bestStr: Math.round(d.lowestScoreRateMap.playerBest).toString(),
      deltaStr: formatDelta(Math.round(d.lowestScoreRateMap.delta).toString()),
      deltaClass: d.lowestScoreRateMap.delta < 0 ? 'badge-bad' : 'badge-good',
      delay: '0.39s'
    })
  }
  
  if (d.maxDeathsMap) {
    list.push({
      label: 'BULLET SPONGE (DEATHS/ROUND)',
      mapName: d.maxDeathsMap.mapName,
      rounds: d.maxDeathsMap.rounds,
      valNum: d.maxDeathsMap.value.toFixed(1),
      valUnit: 'DEATHS/RD',
      avgStr: d.maxDeathsMap.playerAvg.toFixed(1),
      bestStr: d.maxDeathsMap.playerBest.toFixed(1),
      deltaStr: formatDelta(d.maxDeathsMap.delta.toFixed(1)),
      // For deaths, positive delta (more deaths than avg) is bad
      deltaClass: d.maxDeathsMap.delta > 0 ? 'badge-bad' : 'badge-good',
      delay: '0.47s'
    })
  }
  
  return list
})
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

.dishonours-left-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none; /* Firefox */
  -ms-overflow-style: none; /* IE and Edge */
}

.dishonours-left-container::-webkit-scrollbar {
  display: none; /* Chrome, Safari and Opera */
}

.mm-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--mm-ink-muted);
  text-align: left;
}

.dishonours-heading {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(22px, 3.5vw, 36px);
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
  margin: 14px 0 20px 0;
  text-align: left;
}

.dishonours-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  margin: auto 0;
  width: 100%;
}

@media (min-width: 640px) {
  .dishonours-list {
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .dishonour-card:last-child {
    grid-column: span 2;
  }
}

.dishonour-card {
  border: 1px solid var(--mm-rule);
  border-radius: var(--mm-radius-sm, 2px);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  background-color: var(--mm-bg);
  text-align: left;
  transition: border-color 0.25s ease;
}

.dishonour-card:hover {
  border-color: var(--mm-danger);
}

.card-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.card-title {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.text-danger {
  color: var(--mm-danger) !important;
}

.text-success {
  color: var(--mm-success) !important;
}

.text-accent {
  color: var(--mm-accent) !important;
}

.card-rounds {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-muted);
}

.card-body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  margin-top: 10px;
}

.map-name {
  font-family: var(--mm-font-display);
  font-size: 18px;
  font-weight: 400;
  color: var(--mm-ink);
  text-transform: lowercase;
  word-break: break-word;
  margin-bottom: 2px;
}

.value-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.card-val {
  font-family: var(--mm-font-mono);
  font-size: 26px;
  font-weight: 500;
}

.card-unit {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.card-comparison-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--mm-rule);
}

.cmp-stats-left {
  display: flex;
  gap: 24px;
}

.cmp-stat-inline {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.cmp-label {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
  font-weight: 500;
}

.cmp-val-inline {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 600;
}

/* Badge styled exactly like the screenshot design */
.cmp-badge {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 2px;
  border: 1px solid transparent;
}

.badge-bad {
  color: var(--mm-danger) !important;
  border-color: rgba(214, 90, 90, 0.4) !important;
  background-color: rgba(214, 90, 90, 0.05);
}

.badge-good {
  color: var(--mm-success) !important;
  border-color: rgba(40, 167, 69, 0.4) !important;
  background-color: rgba(40, 167, 69, 0.05);
}

.dishonours-footer {
  margin-top: 24px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-muted);
  text-align: left;
  text-transform: uppercase;
}

.lone-wolf-container {
  margin: auto 0;
  text-align: left;
}

.lone-wolf-body {
  font-family: var(--mm-font-display);
  font-size: 16px;
  line-height: 1.5;
  color: var(--mm-ink-muted);
  margin-top: 10px;
}
</style>
