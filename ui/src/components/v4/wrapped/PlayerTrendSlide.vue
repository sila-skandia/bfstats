<template>
  <div class="wrapped-slide trend-slide animate-line-in" @click="$emit('next')">
    <div class="trend-content">
      <div class="mm-eyebrow animate-rise-up" style="animation-delay: 0.05s">02 — RANK &amp; K/D TREND</div>
      
      <div class="trend-heading animate-rise-up" style="animation-delay: 0.1s">
        K/D climbed to {{ maxKD.toFixed(2) }} this year.
      </div>

      <div class="trend-charts">
        <div class="chart-box animate-rise-up" style="animation-delay: 0.15s">
          <div class="chart-header">
            <span class="mm-eyebrow-small">K/D TREND</span>
            <span class="chart-value text-accent">{{ startKD.toFixed(2) }} → {{ endKD.toFixed(2) }}</span>
          </div>
          <div class="chart-container">
            <svg viewBox="0 0 100 32" preserveAspectRatio="none">
              <polyline :points="kdPoints" fill="none" stroke="var(--mm-kd-elite)" stroke-width="1.6" vector-effect="non-scaling-stroke" pathLength="1" class="animate-draw-line" style="animation-delay: 0.25s"></polyline>
            </svg>
          </div>
        </div>

        <div class="chart-box animate-rise-up" style="animation-delay: 0.25s">
          <div class="chart-header">
            <span class="mm-eyebrow-small">KILL RATE TREND</span>
            <span class="chart-value text-muted">{{ startKillRate.toFixed(1) }} → {{ endKillRate.toFixed(1) }} KILLS/RD</span>
          </div>
          <div class="chart-container">
            <svg viewBox="0 0 100 32" preserveAspectRatio="none">
              <polyline :points="killRatePoints" fill="none" stroke="var(--mm-accent)" stroke-width="1.6" vector-effect="non-scaling-stroke" pathLength="1" class="animate-draw-line" style="animation-delay: 0.35s"></polyline>
            </svg>
          </div>
        </div>
      </div>

      <div class="bottom-grid animate-rise-up" style="animation-delay: 0.35s">
        <!-- Top performing maps -->
        <div class="top-maps-section">
          <div class="mm-eyebrow-small section-title">TOP PERFORMING MAPS</div>
          <div class="maps-grid">
            <div 
              v-for="map in data.trend.topMaps" 
              :key="map.metricName" 
              class="map-card"
            >
              <div class="map-rank">{{ map.metricName }}</div>
              <div class="map-name" :title="map.mapName">{{ map.mapName }}</div>
              <div class="map-meta">{{ map.metricValue }}</div>
            </div>
          </div>
        </div>

        <!-- Top server rankings -->
        <div class="rankings-section" v-if="data.serverRankings && data.serverRankings.length > 0">
          <div class="mm-eyebrow-small section-title">TOP SERVER RANKINGS</div>
          <div class="rankings-grid">
            <div 
              v-for="rank in data.serverRankings.slice(0, 2)" 
              :key="rank.serverGuid" 
              class="ranking-card"
            >
              <div class="ranking-badge">RANK #{{ rank.rank }}</div>
              <div class="server-name" :title="rank.serverName">{{ rank.serverName }}</div>
              <div class="ranking-meta">of {{ rank.totalRankedPlayers.toLocaleString() }} players · {{ Math.round(rank.averagePing) }}ms</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Right Column: Hero Image Card -->
    <div class="hero-image-container">
      <div class="hero-image-card">
        <div class="hero-placeholder">
          <div class="hero-title">HERO 03</div>
          <div class="hero-sub">THE ASCENT<br>DROP: ch3p.webp</div>
        </div>
        <div class="hero-img-wrapper">
          <img :src="ch3p" alt="The Ascent" class="hero-img">
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
          Fig. 03 — The Ascent
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PlayerWrappedData } from '@/services/wrappedService'
import ch3p from '@/assets/wrapped/ch3p.webp'

const props = defineProps<{
  data: PlayerWrappedData
}>()

defineEmits<{
  (e: 'next'): void
}>()

// Find start/end/max values
const activeMonthlyKDs = computed(() => props.data.trend.monthlyKDs.filter(v => v > 0) || [0])
const activeMonthlyKRs = computed(() => props.data.trend.monthlyKillRates.filter(v => v > 0) || [0])

const startKD = computed(() => activeMonthlyKDs.value[0] || 0)
const endKD = computed(() => activeMonthlyKDs.value[activeMonthlyKDs.value.length - 1] || 0)
const maxKD = computed(() => Math.max(...props.data.trend.monthlyKDs, 0))

const startKillRate = computed(() => activeMonthlyKRs.value[0] || 0)
const endKillRate = computed(() => activeMonthlyKRs.value[activeMonthlyKRs.value.length - 1] || 0)

const toSparkPoints = (series: number[]) => {
  if (series.length === 0) return '0,15'
  if (series.length === 1) return '0,15 100,15'
  const max = Math.max(...series)
  const min = Math.min(...series)
  const range = max - min || 1
  return series.map((v, i) => {
    const x = (i / (series.length - 1)) * 100
    const y = 31 - ((v - min) / range) * 30
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

const kdPoints = computed(() => toSparkPoints(props.data.trend.monthlyKDs))
const killRatePoints = computed(() => toSparkPoints(props.data.trend.monthlyKillRates))
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

.trend-heading {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(20px, 3vw, 32px);
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
  margin: 14px 0 20px 0;
}

.trend-charts {
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-bottom: 24px;
}

.chart-box {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.chart-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 6px;
}

.mm-eyebrow-small {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.chart-value {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
}

.text-accent {
  color: var(--mm-kd-elite);
}

.text-muted {
  color: var(--mm-ink-soft);
}

.chart-container {
  border: 1px solid var(--border-hairline);
  border-radius: 2px;
  padding: 8px;
  background-color: var(--surface-raised);
}

.chart-container svg {
  width: 100%;
  height: 38px;
  display: block;
}

.bottom-grid {
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-top: auto;
}

@media (min-width: 768px) {
  .bottom-grid {
    display: grid;
    grid-template-columns: 1.2fr 0.8fr;
    gap: 24px;
  }
}

.section-title {
  margin-bottom: 8px;
}

.maps-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.rankings-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

@media (min-width: 768px) {
  .rankings-grid {
    grid-template-columns: 1fr;
  }
}

.map-card, .ranking-card {
  border: 1px solid var(--border-hairline);
  border-radius: 2px;
  padding: 10px 12px;
  background-color: var(--surface-raised);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  min-height: 70px;
}

.map-rank, .ranking-badge {
  font-family: var(--mm-font-mono);
  font-weight: 600;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--mm-accent-soft);
  text-transform: uppercase;
}

.map-name, .server-name {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(13px, 1.8vw, 16px);
  color: var(--mm-ink);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}

.map-meta, .ranking-meta {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  font-weight: 600;
  color: var(--mm-ink-muted);
  margin-top: auto;
  padding-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}
</style>
