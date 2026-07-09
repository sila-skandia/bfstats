<template>
  <div class="wrapped-slide rotation-slide">
    <div class="slide-header">
      <span class="slide-badge">03 — THE ROTATION</span>
      <h2 class="slide-title">Theatre of operations.</h2>
    </div>

    <div class="rotation-content">
      <div class="rotation-layout">
        <!-- Left Side: Top Maps List with Bars -->
        <div class="maps-list">
          <div 
            v-for="map in topMaps" 
            :key="map.mapName" 
            class="map-row"
          >
            <div class="map-labels">
              <span class="map-name">{{ map.mapName }}</span>
              <span class="map-rounds">{{ map.roundsPlayed.toLocaleString() }} rounds</span>
            </div>
            <div class="map-bar-container">
              <div 
                class="map-bar" 
                :style="{ width: getBarWidth(map.roundsPlayed), backgroundColor: 'var(--mm-accent)' }"
              ></div>
            </div>
            <!-- Top placement details under map -->
            <div class="map-placements" v-if="map.topPlacements && map.topPlacements.length > 0">
              <span class="placements-title">🏆 Top Wins:</span>
              <span 
                v-for="(placement, pIdx) in map.topPlacements" 
                :key="placement.playerName"
                class="placement-badge"
              >
                {{ pIdx + 1 }}. {{ placement.playerName }} ({{ placement.firstPlaceCount }})
              </span>
            </div>
          </div>
        </div>

        <!-- Right Side: Most Played Highlight -->
        <div class="most-played-hero">
          <div class="mm-eyebrow">MOST PLAYED</div>
          <h3 class="hero-map-name">{{ data.rotation.mostPlayedMapName || 'None' }}</h3>
          <div class="hero-stats-mono">
            <span class="text-accent">{{ data.rotation.mostPlayedRounds.toLocaleString() }} ROUNDS</span> 
            · {{ data.rotation.mostPlayedPercentage }}% OF THE YEAR
          </div>
          
          <div v-if="topPlayerOnMostPlayed" class="hero-top-placement">
            <div class="mm-eyebrow" style="margin-top: 20px; margin-bottom: 8px;">TOP PERFORMER</div>
            <div class="hero-player-name">{{ topPlayerOnMostPlayed.playerName }}</div>
            <div class="hero-stats-mono">
              <span class="text-accent">{{ topPlayerOnMostPlayed.firstPlaceCount }} #1 FINISHES</span> ON THIS MAP
            </div>
          </div>
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

// Take top 5 maps
const topMaps = computed(() => {
  return props.data.rotation.maps.slice(0, 5)
})

const maxRounds = computed(() => {
  const maps = topMaps.value
  if (!maps || maps.length === 0) return 1
  return Math.max(...maps.map(m => m.roundsPlayed), 1)
})

function getBarWidth(rounds: number): string {
  return `${Math.max(8, (rounds / maxRounds.value) * 100)}%`
}

const mostPlayedMap = computed(() => {
  const name = props.data.rotation.mostPlayedMapName
  return props.data.rotation.maps.find(m => m.mapName === name)
})

const topPlayerOnMostPlayed = computed(() => {
  const map = mostPlayedMap.value
  if (!map || !map.topPlacements || map.topPlacements.length === 0) return null
  return map.topPlacements[0]
})
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

.rotation-content {
  width: 100%;
  margin-top: auto;
  margin-bottom: auto;
  display: flex;
  flex-direction: column;
}

.rotation-layout {
  display: flex;
  flex-direction: column;
  gap: 32px;
}

@media (min-width: 769px) {
  .rotation-layout {
    flex-direction: row;
    align-items: center;
    gap: 40px;
  }
}

.maps-list {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.map-row {
  padding: 6px 0;
  border-top: 1px solid var(--mm-rule);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.map-labels {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.map-name {
  font-family: var(--mm-font-display);
  font-size: 14.5px;
  color: var(--mm-ink);
}

.map-rounds {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  color: var(--mm-ink-muted);
}

.map-bar-container {
  height: 3px;
  background-color: var(--mm-bg-mute);
  border-radius: 1px;
  width: 100%;
}

.map-bar {
  height: 100%;
  border-radius: 1px;
  transition: width 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}

.most-played-hero {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

@media (min-width: 769px) {
  .most-played-hero {
    width: 260px;
    flex-shrink: 0;
  }
}

.mm-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 8.5px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
  margin-bottom: 8px;
}

.hero-map-name {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: 36px;
  line-height: 1.05;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
  margin: 0 0 10px 0;
}

.hero-stats-mono {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-muted);
  line-height: 1.4;
}

.text-accent {
  color: var(--mm-accent-soft);
  font-weight: 600;
}

.map-placements {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  font-family: var(--mm-font-sans);
  font-size: 11px;
}

.placements-title {
  color: var(--mm-ink-muted);
  font-weight: 600;
  margin-right: 2px;
}

.placement-badge {
  color: var(--mm-ink);
  background-color: var(--mm-bg-mute);
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--mm-rule);
  font-family: var(--mm-font-mono);
  font-size: 10px;
}

.hero-top-placement {
  border-top: 1px dashed var(--mm-rule);
  margin-top: 20px;
  padding-top: 16px;
}

.hero-player-name {
  font-family: var(--mm-font-display);
  font-size: 24px;
  font-weight: 300;
  color: var(--mm-ink);
  margin-bottom: 4px;
  line-height: 1.1;
}
</style>
