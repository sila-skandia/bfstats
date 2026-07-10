<template>
  <div class="wrapped-slide map-slide animate-line-in" @click="$emit('next')">
    <div class="map-content">
      <div class="mm-eyebrow animate-rise-up" style="animation-delay: 0.05s">03 — FAVOURITE MAP &amp; SERVER</div>
      
      <div class="map-body">
        <div class="map-feature animate-rise-up" style="animation-delay: 0.15s">
          <div class="mm-eyebrow-small">MOST PLAYED MAP</div>
          <div class="feature-name">{{ data.favouriteMap.mapName }}</div>
          <div class="feature-meta">
            <span class="text-accent">{{ data.favouriteMap.rounds }} ROUNDS</span>
            <span class="divider">·</span>
            <span class="text-victory">{{ Math.round(data.favouriteMap.winRate * 100) }}% WIN RATE</span>
          </div>
        </div>
        
        <div class="maps-list">
          <div 
            v-for="(map, idx) in data.favouriteMap.topMaps5" 
            :key="map.mapName" 
            class="list-item animate-rise-up"
            :style="{ animationDelay: ((idx * 0.08) + 0.25) + 's' }"
          >
            <div class="item-header">
              <span class="map-label">{{ map.mapName }}</span>
              <span class="map-rounds">{{ map.rounds }}</span>
            </div>
            <div class="progress-bar-track">
              <div 
                class="progress-bar-fill animate-grow-x" 
                :style="{ width: `${map.playTimePercentage}%`, backgroundColor: map.barColor, animationDelay: ((idx * 0.08) + 0.25) + 's' }"
              ></div>
            </div>
          </div>
        </div>
      </div>

      <div class="map-footer animate-rise-up" style="animation-delay: 0.6s">
        HOME SERVER <span class="text-strong">{{ data.favouriteMap.homeServerName }}</span> · <span class="text-accent">{{ data.favouriteMap.homeServerLocation }}</span>
      </div>
    </div>

    <!-- Right Column: Hero Image Card -->
    <div class="hero-image-container">
      <div class="hero-image-card">
        <div class="hero-placeholder">
          <div class="hero-title">HERO 04</div>
          <div class="hero-sub">LIBERATION OF CAEN<br>DROP: ch4p.webp</div>
        </div>
        <div class="hero-img-wrapper">
          <img :src="ch4p" alt="Liberation of Caen" class="hero-img">
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
          Fig. 04 — Liberation of Caen
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { PlayerWrappedData } from '@/services/wrappedService'
import ch4p from '@/assets/wrapped/ch4p.webp'

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

@media (min-width: 1024px) {
  .wrapped-slide {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    gap: 46px;
    align-items: stretch;
  }
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

@media (min-width: 768px) and (max-width: 1023px) {
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
