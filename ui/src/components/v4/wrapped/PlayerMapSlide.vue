<template>
  <div class="wrapped-slide map-slide animate-line-in" @click="clickAdvancesSlide() && $emit('next')">
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

          <div v-if="data.favouriteMap.kpmMultiplier > 0" class="map-comparison animate-rise-up" style="animation-delay: 0.2s">
            <div class="comparison-kpm">
              {{ data.favouriteMap.playerKPM.toFixed(2) }} <span class="unit">KILLS/MIN</span>
            </div>
            <div class="comparison-desc">
              Your combat efficiency on {{ data.favouriteMap.mapName }} was
              <span class="text-accent highlight">{{ data.favouriteMap.kpmMultiplier.toFixed(1) }}x</span>
              {{ data.favouriteMap.kpmMultiplier >= 1.0 ? 'higher' : 'lower' }} than the server average ({{ data.favouriteMap.globalKPM.toFixed(2) }} K/Min).
            </div>
          </div>

          <!-- Extra Stats Grid -->
          <div class="extra-stats-grid animate-rise-up" style="animation-delay: 0.25s">
            <div class="extra-stat-item">
              <span class="stat-num kills-color">{{ data.favouriteMap.totalKills.toLocaleString() }}</span>
              <span class="stat-label">KILLS</span>
            </div>
            <div class="extra-stat-item">
              <span class="stat-num deaths-color">{{ data.favouriteMap.totalDeaths.toLocaleString() }}</span>
              <span class="stat-label">DEATHS</span>
            </div>
            <div class="extra-stat-item">
              <span class="stat-num kd-color">{{ data.favouriteMap.kdRatio.toFixed(2) }}</span>
              <span class="stat-label">K/D</span>
            </div>
            <div class="extra-stat-item">
              <span class="stat-num score-color">{{ data.favouriteMap.totalScore.toLocaleString() }}</span>
              <span class="stat-label">SCORE</span>
            </div>
            <div class="extra-stat-item">
              <span class="stat-num time-color">{{ Math.round(data.favouriteMap.playTimeMinutes) }}m</span>
              <span class="stat-label">TIME</span>
            </div>
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
import { clickAdvancesSlide } from './slideTap'
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
  padding: 0;
}

@media (min-width: 1024px) {
  .wrapped-slide {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
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

.map-comparison {
  margin-top: 18px;
  background-color: var(--surface-sunken);
  border: 1px solid var(--border-hairline);
  border-radius: 2px;
  padding: 14px;
  width: 100%;
  box-sizing: border-box;
}

.comparison-kpm {
  font-family: var(--mm-font-display);
  font-size: 22px;
  font-weight: 700;
  color: var(--mm-accent);
}

.comparison-kpm .unit {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  color: var(--mm-ink-muted);
  letter-spacing: 0.1em;
  margin-left: 2px;
}

.comparison-desc {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  line-height: 1.4;
  color: var(--mm-ink-muted);
  margin-top: 4px;
  text-transform: uppercase;
}

.comparison-desc .highlight {
  font-weight: 700;
  color: var(--mm-accent-soft);
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

.extra-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 18px;
  width: 100%;
  box-sizing: border-box;
}

.extra-stat-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 8px 10px;
  background-color: var(--surface-sunken);
  border: 1px solid var(--border-hairline);
  border-radius: 2px;
}

.stat-num {
  font-family: var(--mm-font-display);
  font-size: 16px;
  font-weight: 600;
  line-height: 1.2;
}

.stat-label {
  font-family: var(--mm-font-mono);
  font-size: 8px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
  margin-top: 3px;
  text-transform: uppercase;
}

.kills-color {
  color: var(--mm-kill);
}

.deaths-color {
  color: var(--mm-bronze);
}

.kd-color {
  color: var(--mm-kd-elite);
}

.score-color {
  color: var(--mm-load-busy);
}

.time-color {
  color: var(--mm-success);
}
</style>
