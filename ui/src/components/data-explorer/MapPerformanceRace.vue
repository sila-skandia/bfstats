<template>
  <div class="map-performance-race">
    <!-- Loading state -->
    <div
      v-if="loading"
      class="loading-state"
    >
      <div class="explorer-spinner" />
      <span>Loading performance stream...</span>
    </div>

    <!-- Error state -->
    <div
      v-else-if="error"
      class="error-state"
    >
      {{ error }}
    </div>

    <!-- Race chart content -->
    <div
      v-else-if="timelineData && timelineData.months.length > 0"
      class="race-content"
    >
      <!-- Compact Toolbar -->
      <div class="race-toolbar">
        <div class="toolbar-left">
          <button
            :class="['playback-btn', { 'is-playing': isPlaying }]"
            :title="isPlaying ? 'Pause' : 'Play'"
            @click="togglePlayback"
          >
            <span
              v-if="isPlaying"
              class="icon-pause"
            >||</span>
            <span
              v-else
              class="icon-play"
            >▶</span>
          </button>
          
          <div class="month-display">
            <span class="month-label-small">{{ currentMonth?.monthLabel || '' }}</span>
          </div>
        </div>

        <div class="toolbar-center">
          <div class="scrubber-container">
            <input
              v-model.number="currentMonthIndex"
              type="range"
              :min="0"
              :max="timelineData.months.length - 1"
              :disabled="isPlaying"
              class="explorer-scrubber"
            >
          </div>
        </div>

        <div class="toolbar-right">
          <div class="explorer-toggle-group">
            <button
              v-for="metric in metrics"
              :key="metric.value"
              :class="['explorer-toggle-btn', { 'explorer-toggle-btn--active': selectedMetric === metric.value }]"
              @click="selectedMetric = metric.value"
            >
              {{ metric.label }}
            </button>
          </div>
        </div>
      </div>

      <!-- Bar chart with animated reordering -->
      <div class="bar-chart">
        <TransitionGroup
          name="bar-reorder"
          tag="div"
          class="bar-list"
        >
          <div
            v-for="(map, index) in topMaps"
            :key="map.mapName"
            class="bar-row"
          >
            <div
              class="bar-label bar-label--clickable"
              :title="map.mapName"
              @click.stop="emit('navigateToMap', map.mapName)"
            >
              {{ map.mapName }}
            </div>
            <div class="bar-track">
              <div
                class="bar-fill"
                :style="{ width: getBarWidth(map) + '%' }"
                :class="{ 'bar-fill--top': index === 0 }"
              />
            </div>
            <div class="bar-value">
              {{ formatValue(map) }}
            </div>
          </div>
        </TransitionGroup>
      </div>
    </div>

    <!-- No data state -->
    <div
      v-else
      class="no-data"
    >
      No performance data stream available
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { fetchMapPerformanceTimeline } from '@/services/playerStatsApi';
import type { MapPerformanceTimelineResponse } from '@/types/playerStatsTypes';

const props = defineProps<{
  playerName: string;
  game?: string;
}>();

const emit = defineEmits<{
  navigateToMap: [mapName: string];
}>();

const loading = ref(true);
const error = ref<string | null>(null);
const timelineData = ref<MapPerformanceTimelineResponse | null>(null);
const currentMonthIndex = ref(0);
const isPlaying = ref(false);
const selectedMetric = ref<'kdRatio' | 'score' | 'kills'>('kdRatio');
const playbackSpeed = ref(1500);

let playbackInterval: number | null = null;

const metrics: { value: 'kdRatio' | 'score' | 'kills'; label: string }[] = [
  { value: 'kdRatio', label: 'K/D' },
  { value: 'score', label: 'SCORE' },
  { value: 'kills', label: 'KILLS' }
];

const currentMonth = computed(() => {
  if (!timelineData.value) return null;
  return timelineData.value.months[currentMonthIndex.value];
});

const getValue = (m: { kdRatio: number; score: number; kills: number }): number => {
  switch (selectedMetric.value) {
    case 'kdRatio': return m.kdRatio;
    case 'kills': return m.kills;
    case 'score': return m.score;
    default: return m.score;
  }
};

const topMaps = computed(() => {
  if (!currentMonth.value) return [];
  const sorted = [...currentMonth.value.maps].sort((a, b) => getValue(b) - getValue(a));
  return sorted.slice(0, 10);
});

const maxValue = computed(() => {
  if (topMaps.value.length === 0) return 1;
  return Math.max(...topMaps.value.map(getValue));
});

const getBarWidth = (map: { kdRatio: number; score: number; kills: number }): number => {
  const val = getValue(map);
  return maxValue.value > 0 ? (val / maxValue.value) * 100 : 0;
};

const formatValue = (map: { kdRatio: number; score: number; kills: number; playTimeMinutes: number }): string => {
  switch (selectedMetric.value) {
    case 'kdRatio': return map.kdRatio.toFixed(2);
    case 'kills': return map.kills.toLocaleString();
    case 'score': return map.score.toLocaleString();
    default: return '';
  }
};

// Playback control
function togglePlayback() {
  if (isPlaying.value) {
    stopPlayback();
  } else {
    startPlayback();
  }
}

function startPlayback() {
  if (!timelineData.value) return;

  if (currentMonthIndex.value >= timelineData.value.months.length - 1) {
    currentMonthIndex.value = 0;
  }

  isPlaying.value = true;

  playbackInterval = window.setInterval(() => {
    if (currentMonthIndex.value < timelineData.value!.months.length - 1) {
      currentMonthIndex.value++;
    } else {
      stopPlayback();
    }
  }, playbackSpeed.value);
}

function stopPlayback() {
  isPlaying.value = false;
  if (playbackInterval !== null) {
    clearInterval(playbackInterval);
    playbackInterval = null;
  }
}

async function loadData() {
  loading.value = true;
  error.value = null;

  try {
    timelineData.value = await fetchMapPerformanceTimeline(
      props.playerName,
      props.game || 'bf1942',
      12
    );
    currentMonthIndex.value = 0;
  } catch (err) {
    error.value = 'Failed to load performance timeline';
    console.error(err);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadData();
});

onUnmounted(() => {
  stopPlayback();
});
</script>

<style scoped>
.map-performance-race {
  height: 100%;
  display: flex;
  flex-direction: column;
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-secondary);
}

/* States */
.loading-state,
.error-state,
.no-data {
  padding: 1.5rem;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
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

.race-content {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Toolbar */
.race-toolbar {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1rem;
  padding-bottom: 0.75rem;
  margin-bottom: 1rem;
}

@media (max-width: 640px) {
  .race-toolbar {
    grid-template-columns: 1fr;
    gap: 0.5rem;
  }
  
  .toolbar-left, .toolbar-center, .toolbar-right {
    justify-content: center;
  }
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.playback-btn {
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--neon-cyan);
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.7rem;
}

.playback-btn:hover {
  border-color: var(--neon-cyan);
  background: rgba(245, 158, 11, 0.1);
  box-shadow: 0 0 10px rgba(245, 158, 11, 0.2);
}

.playback-btn.is-playing {
  color: var(--neon-red);
  border-color: rgba(248, 113, 113, 0.3);
}

.playback-btn.is-playing:hover {
  background: rgba(248, 113, 113, 0.1);
  border-color: var(--neon-red);
  box-shadow: 0 0 10px rgba(248, 113, 113, 0.2);
}

.month-label-small {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--text-primary);
  text-transform: uppercase;
  white-space: nowrap;
}

.toolbar-center {
  flex: 1;
  display: flex;
  align-items: center;
}

.scrubber-container {
  width: 100%;
  display: flex;
  align-items: center;
}

.explorer-scrubber {
  width: 100%;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--bg-card);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}

.explorer-scrubber::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 12px;
  height: 12px;
  background: var(--neon-cyan);
  cursor: pointer;
  border-radius: 2px;
  box-shadow: 0 0 5px rgba(245, 158, 11, 0.5);
}

.explorer-scrubber::-moz-range-thumb {
  width: 12px;
  height: 12px;
  background: var(--neon-cyan);
  cursor: pointer;
  border-radius: 2px;
  border: none;
  box-shadow: 0 0 5px rgba(245, 158, 11, 0.5);
}

.explorer-scrubber:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* Bar chart */
.bar-chart {
  position: relative;
  overflow: hidden;
}

.bar-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 20px;
}

.bar-label {
  width: 100px;
  min-width: 100px;
  font-size: 10px;
  font-weight: 500;
  color: var(--text-secondary);
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.02em;
}

.bar-label--clickable {
  cursor: pointer;
  transition: color 0.2s ease;
}

.bar-label--clickable:hover {
  color: var(--neon-cyan);
}

@media (max-width: 640px) {
  .bar-label {
    width: 70px;
    min-width: 70px;
    font-size: 9px;
  }
}

.bar-track {
  flex: 1;
  height: 8px;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 1px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.03);
}

.bar-fill {
  height: 100%;
  background: var(--portal-accent-dim, rgba(245, 158, 11, 0.15));
  border-right: 2px solid var(--neon-cyan);
  transition: width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.bar-fill--top {
  background: var(--portal-accent-glow, rgba(245, 158, 11, 0.25));
  border-right: 2px solid var(--neon-gold);
}

.bar-value {
  width: 50px;
  min-width: 50px;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-primary);
  text-align: right;
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
}

@media (max-width: 640px) {
  .bar-value {
    width: 40px;
    min-width: 40px;
    font-size: 9px;
  }
}

/* FLIP animation for reordering */
.bar-reorder-move {
  transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.bar-reorder-enter-active {
  transition: all 0.4s ease;
}

.bar-reorder-leave-active {
  transition: all 0.3s ease;
  position: absolute;
  width: 100%;
}

.bar-reorder-enter-from {
  opacity: 0;
  transform: translateX(-10px);
}

.bar-reorder-leave-to {
  opacity: 0;
  transform: translateX(10px);
}

/* Theme integration helpers */
.explorer-toggle-group {
  display: flex;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 0.125rem;
}

.explorer-toggle-btn {
  padding: 0.25rem 0.5rem;
  font-size: 0.65rem;
  font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  text-transform: uppercase;
}

.explorer-toggle-btn:hover {
  color: var(--text-primary);
}

.explorer-toggle-btn--active {
  background: var(--neon-cyan);
  color: var(--bg-dark);
  box-shadow: 0 0 10px rgba(245, 158, 11, 0.3);
}
</style>

