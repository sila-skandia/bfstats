<template>
  <div class="wrapped-slide share-slide animate-line-in">
    <div class="slide-header">
      <span class="slide-badge animate-rise-up" style="animation-delay: 0.05s">08 — THE BRIEFING OVERVIEW</span>
      <h2 class="slide-title animate-rise-up" style="animation-delay: 0.1s">Share the report.</h2>
    </div>

    <div class="share-content">
      <!-- Minimalist Share Card Box -->
      <div class="share-card-box animate-wrapped-in" style="animation-delay: 0.15s">
        <div class="card-header-row">
          <div class="mm-eyebrow">SERVER WRAPPED · 2026</div>
          <span class="card-badge-mono">#1 MOST ACTIVE</span>
        </div>
        
        <h3 class="server-title-text">{{ data.serverName }}</h3>
        
        <div class="card-metrics-grid">
          <div class="grid-metric-col">
            <div class="grid-metric-val">{{ data.yearInNumbers.roundsFought.toLocaleString() }}</div>
            <div class="mm-eyebrow">ROUNDS</div>
          </div>
          <div class="grid-metric-col">
            <div class="grid-metric-val">{{ data.yearInNumbers.uniqueSoldiers.toLocaleString() }}</div>
            <div class="mm-eyebrow">SOLDIERS</div>
          </div>
          <div class="grid-metric-col">
            <div class="grid-metric-val">{{ data.yearInNumbers.totalDecorations.toLocaleString() }}</div>
            <div class="mm-eyebrow">MEDALS</div>
          </div>
          <div class="grid-metric-col last">
            <div class="grid-metric-val text-accent">{{ data.yearInNumbers.peakPopulation }}</div>
            <div class="mm-eyebrow">PEAK</div>
          </div>
        </div>
        
        <div class="card-footer-mono">
          BFSTATS.IO/WRAPPED
        </div>
      </div>

      <!-- Action buttons -->
      <div class="actions-row animate-rise-up" style="animation-delay: 0.35s">
        <button class="action-btn-primary" @click="copyShareMessage">
          {{ copied ? 'Copied summary!' : 'Copy Summary Text ↗' }}
        </button>
        <button class="action-btn-outline" @click="mockDownload">
          {{ downloaded ? 'Image Exported!' : 'Export Image ↗' }}
        </button>
        <span class="export-note">EXPORTS 1200×630 PNG</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ServerWrappedData } from '@/services/wrappedService'

const props = defineProps<{
  data: ServerWrappedData
}>()

const copied = ref(false)
const downloaded = ref(false)

const topKDPlayerName = computed(() => {
  const list = props.data.honours.topKDRatios
  return list && list.length > 0 ? list[0].playerName : 'None'
})

const highestStreakCount = computed(() => {
  if (props.data.decorations.streakOfTheYear) {
    return props.data.decorations.streakOfTheYear.streak
  }
  return props.data.decorations.mostStreaksOf25.value > 0 ? 25 : 0
})

function copyShareMessage() {
  const msg = `🎮 2026 Server Wrapped for ${props.data.serverName} 🎮\n` +
              `• Rounds Fought: ${props.data.yearInNumbers.roundsFought.toLocaleString()}\n` +
              `• Hours in Combat: ${Math.round(props.data.yearInNumbers.hoursInCombat).toLocaleString()}h\n` +
              `• Most Played Map: ${props.data.rotation.mostPlayedMapName}\n` +
              `• Top K/D Player: ${topKDPlayerName.value}\n` +
              `• Highest Kill Streak: ${highestStreakCount.value} kills\n` +
              `Check the full year in review stats at bfstats.io! #BFStats2026`

  navigator.clipboard.writeText(msg).then(() => {
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  })
}

function mockDownload() {
  downloaded.value = true
  setTimeout(() => { downloaded.value = false }, 2000)
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

.share-content {
  width: 100%;
  margin-top: auto;
  margin-bottom: auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 24px;
}

.share-card-box {
  width: 100%;
  max-width: 800px;
  border: 1px solid var(--mm-rule-strong);
  border-radius: var(--mm-radius-sm, 2px);
  padding: 40px;
  background-color: var(--mm-bg);
  box-sizing: border-box;
  aspect-ratio: 1200 / 630;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: border-color 0.3s ease;
}

.share-card-box:hover {
  border-color: var(--mm-accent-soft);
}

.card-header-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  width: 100%;
}

.mm-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.15em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.card-badge-mono {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--mm-accent-soft);
  text-transform: uppercase;
  border: 1px solid var(--mm-accent-soft);
  padding: 2px 8px;
  border-radius: 2px;
}

.server-title-text {
  font-family: var(--mm-font-display);
  font-size: clamp(24px, 4vw, 42px);
  color: var(--mm-ink);
  margin: 24px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
  font-weight: 300;
  text-align: left;
}

.card-metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
  border-top: 1px solid var(--mm-rule);
  padding-top: 24px;
  width: 100%;
}

.grid-metric-col {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}

.grid-metric-val {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(26px, 3.5vw, 44px);
  color: var(--mm-ink);
  line-height: 1.1;
  margin-bottom: 6px;
}

.grid-metric-col .mm-eyebrow {
  font-size: 9px;
  letter-spacing: 0.08em;
  margin-top: 0;
}

.text-accent {
  color: var(--mm-accent-soft);
}

.card-footer-mono {
  padding-top: 16px;
  border-top: 1px solid var(--mm-rule);
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.18em;
  color: var(--mm-ink-muted);
  text-align: left;
  width: 100%;
}

.actions-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  width: 100%;
}

.action-btn-primary {
  background-color: var(--mm-accent);
  border: none;
  color: #000;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  padding: 10px 20px;
  border-radius: var(--mm-radius-sm, 2px);
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 600;
}

.action-btn-primary:hover {
  background-color: var(--mm-accent-soft);
}

.action-btn-outline {
  background: none;
  border: 1px solid var(--mm-rule);
  color: var(--mm-ink-soft);
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  padding: 10px 20px;
  border-radius: var(--mm-radius-sm, 2px);
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn-outline:hover {
  border-color: var(--mm-rule-strong);
  color: var(--mm-ink);
}

.export-note {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-faint);
}

@media (max-width: 768px) {
  .share-card-box {
    aspect-ratio: auto;
    padding: 24px;
  }
  .server-title-text {
    margin: 16px 0;
  }
  .card-metrics-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }
}
</style>
