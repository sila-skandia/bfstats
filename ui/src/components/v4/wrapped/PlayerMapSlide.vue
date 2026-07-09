<template>
  <div class="wrapped-slide map-slide" @click="$emit('next')">
    <div class="mm-eyebrow">03 — FAVOURITE MAP &amp; SERVER</div>
    
    <div class="map-body">
      <div class="map-feature">
        <div class="mm-eyebrow-small">MOST PLAYED MAP</div>
        <div class="feature-name">{{ data.favouriteMap.mapName }}</div>
        <div class="feature-meta">
          <span class="text-accent">{{ data.favouriteMap.rounds }} ROUNDS</span>
          <span class="divider">·</span>
          <span class="text-victory">{{ Math.round(data.favouriteMap.winRate * 100) }}% WIN RATE</span>
        </div>
      </div>
      
      <div class="maps-list">
        <div v-for="map in data.favouriteMap.topMaps5" :key="map.mapName" class="list-item">
          <div class="item-header">
            <span class="map-label">{{ map.mapName }}</span>
            <span class="map-rounds">{{ map.rounds }}</span>
          </div>
          <div class="progress-bar-track">
            <div class="progress-bar-fill" :style="{ width: `${map.playTimePercentage}%`, backgroundColor: map.barColor }"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="map-footer">
      HOME SERVER <span class="text-strong">{{ data.favouriteMap.homeServerName }}</span> · <span class="text-accent">{{ data.favouriteMap.homeServerLocation }}</span>
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

.map-body {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin: auto 0;
}

@media (min-width: 768px) {
  .map-body {
    flex-direction: row;
    gap: 40px;
    align-items: center;
  }
}

.map-feature {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
}

.mm-eyebrow-small {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.feature-name {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: clamp(28px, 4vw, 44px);
  line-height: 1.05;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
  margin: 8px 0 10px 0;
}

.feature-meta {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-muted);
}

.text-accent {
  color: var(--mm-accent-soft);
}

.text-victory {
  color: var(--mm-success);
}

.divider {
  color: var(--mm-ink-faint);
  margin: 0 6px;
}

.maps-list {
  flex: 1.2;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.list-item {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-hairline);
}

.item-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-family: var(--mm-font-display);
  font-size: 14.5px;
}

.map-label {
  color: var(--mm-ink);
}

.map-rounds {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  color: var(--mm-ink-muted);
}

.progress-bar-track {
  height: 3px;
  background-color: var(--surface-sunken);
  border-radius: 1px;
  margin-top: 7px;
  width: 100%;
}

.progress-bar-fill {
  height: 3px;
  border-radius: 1px;
  transition: width 0.6s ease-out;
}

.map-footer {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-muted);
  line-height: 1.5;
}

.text-strong {
  color: var(--mm-ink);
}
</style>
