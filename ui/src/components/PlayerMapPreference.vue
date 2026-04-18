<template>
  <div class="player-map-preference">
    <!-- Loading state -->
    <div
      v-if="loading"
      class="loading-state"
    >
      <div class="explorer-spinner" />
      <span>Loading map preferences...</span>
    </div>

    <!-- Error state -->
    <div
      v-else-if="error"
      class="error-state"
    >
      {{ error }}
    </div>

    <!-- Map preference data -->
    <div
      v-else-if="topMap"
      class="preference-content"
    >
      <!-- Hero card for top map -->
      <div
        class="hero-map hero-map--clickable"
        @click="emit('navigateToMap', topMap.mapName)"
      >
        <div class="hero-header">
          <span class="hero-label">TOP MAP</span>
          <h4 class="hero-map-name">
            {{ topMap.mapName }}
          </h4>
        </div>
        <div class="hero-stats">
          <div class="stat-item">
            <span class="stat-value">{{ calculateKD(topMap) }}</span>
            <span class="stat-label">K/D</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ topMap.sessionsPlayed }}</span>
            <span class="stat-label">SESSIONS</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">{{ formatPlayTime(topMap.totalPlayTimeMinutes) }}</span>
            <span class="stat-label">PLAYTIME</span>
          </div>
        </div>
      </div>

      <!-- Top 5 maps bars -->
      <div
        v-if="topMaps.length > 1"
        class="map-bars"
      >
        <div class="section-header">
          RECENT ACTIVITY
        </div>
        <div
          v-for="(map, index) in topMaps.slice(0, 5)"
          :key="map.mapName"
          class="bar-row bar-row--clickable"
          @click="emit('navigateToMap', map.mapName)"
        >
          <div
            class="bar-label"
            :title="map.mapName"
          >
            <span class="map-position">{{ index + 1 }}</span>
            <span class="map-name">{{ map.mapName }}</span>
          </div>
          <div class="bar-track">
            <div 
              class="bar-fill"
              :style="{ width: getBarWidth(map) + '%' }"
              :class="{ 'bar-fill--top': index === 0 }"
            />
          </div>
          <div class="bar-value">
            {{ formatPlayTime(map.totalPlayTimeMinutes) }}
          </div>
        </div>
      </div>

      <!-- No maps fallback -->
      <div
        v-else
        class="no-maps"
      >
        <p>No recent map activity in the last 30 days</p>
      </div>
    </div>

    <!-- No data state -->
    <div
      v-else
      class="no-data"
    >
      No map data available
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { fetchPlayerMapStats } from '../services/playerStatsApi';
import type { PlayerMapStatEntry } from '../types/playerStatsTypes';

const props = defineProps<{
  playerName: string;
  game?: string;
}>();

const emit = defineEmits<{
  navigateToMap: [mapName: string];
}>();

const loading = ref(true);
const error = ref<string | null>(null);
const mapStats = ref<PlayerMapStatEntry[]>([]);

// Get top maps sorted by play time
const topMaps = computed(() => {
  return [...mapStats.value].sort((a, b) => b.totalPlayTimeMinutes - a.totalPlayTimeMinutes);
});

// Get the top map
const topMap = computed(() => {
  return topMaps.value[0] || null;
});

// Calculate K/D ratio
function calculateKD(map: PlayerMapStatEntry | null): string {
  if (!map) return '0.00';
  const ratio = map.totalDeaths > 0 ? map.totalKills / map.totalDeaths : map.totalKills;
  return ratio.toFixed(2);
}

// Calculate bar width as percentage of max play time
function getBarWidth(map: PlayerMapStatEntry): number {
  if (!topMap.value) return 0;
  return (map.totalPlayTimeMinutes / topMap.value.totalPlayTimeMinutes) * 100;
}

// Format play time to human readable format
function formatPlayTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  
  if (hours === 0) {
    return `${mins}m`;
  } else if (mins === 0) {
    return `${hours}h`;
  } else {
    return `${hours}h ${mins}m`;
  }
}

async function loadData() {
  loading.value = true;
  error.value = null;

  try {
    mapStats.value = await fetchPlayerMapStats(
      props.playerName,
      props.game || 'bf1942',
      30 // Last 30 days
    );
  } catch (err) {
    error.value = 'Failed to load map preferences';
    console.error(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadData();
});
</script>

<style scoped>
.player-map-preference {
  padding: 0;
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-secondary);
}

.loading-state,
.error-state,
.no-data,
.no-maps {
  text-align: center;
  color: var(--text-secondary);
  padding: 2rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.8rem;
}

.explorer-spinner {
  width: 1.5rem;
  height: 1.5rem;
  border: 2px solid var(--border-color);
  border-top-color: var(--neon-cyan);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state {
  color: var(--neon-red);
}

/* Hero map card */
.hero-map {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1.5rem;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.02) 0%, transparent 100%);
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
}

.hero-map--clickable {
  cursor: pointer;
}

.hero-map--clickable:hover {
  border-color: rgba(245, 158, 11, 0.3);
  box-shadow: 0 0 20px rgba(245, 158, 11, 0.1);
}

.hero-header {
  margin-bottom: 1rem;
}

.hero-label {
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--neon-gold);
  text-transform: uppercase;
  display: block;
  margin-bottom: 0.25rem;
}

.hero-map-name {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  letter-spacing: -0.02em;
}

.hero-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  border-top: 1px solid var(--border-color);
  padding-top: 1rem;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.stat-label {
  font-size: 0.65rem;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.stat-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--neon-cyan);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}

/* Section Header */
.section-header {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--neon-cyan);
  margin-bottom: 0.75rem;
  text-transform: uppercase;
  text-shadow: 0 0 10px rgba(245, 158, 11, 0.3);
}

/* Map bars */
.map-bars {
  margin-top: 1rem;
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 24px;
  padding: 0 4px;
  transition: background 0.2s ease;
  border-radius: 4px;
}

.bar-row--clickable {
  cursor: pointer;
}

.bar-row--clickable:hover {
  background: rgba(255, 255, 255, 0.03);
}

.bar-row--clickable:hover .map-name {
  color: var(--neon-cyan);
}

.bar-label {
  width: 120px;
  min-width: 120px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  overflow: hidden;
}

.map-position {
  font-size: 0.65rem;
  color: var(--text-secondary);
  opacity: 0.5;
  width: 12px;
}

.map-name {
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.2s;
}

.bar-track {
  flex: 1;
  height: 8px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 1px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.03);
  position: relative;
}

.bar-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: var(--portal-accent-dim, rgba(245, 158, 11, 0.15));
  border-right: 2px solid var(--neon-cyan);
  transition: width 0.3s ease;
}

.bar-fill--top {
  background: var(--portal-accent-glow, rgba(245, 158, 11, 0.25));
  border-right: 2px solid var(--neon-gold);
}

.bar-value {
  width: 50px;
  min-width: 50px;
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--text-primary);
  text-align: right;
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
}

@media (max-width: 640px) {
  .bar-label {
    width: 90px;
    min-width: 90px;
  }
}
</style>