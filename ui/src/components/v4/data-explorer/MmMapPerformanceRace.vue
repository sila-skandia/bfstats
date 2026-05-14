<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { fetchMapPerformanceTimeline } from '@/services/playerStatsApi'
import type { MapPerformanceTimelineResponse } from '@/types/playerStatsTypes'

const props = defineProps<{
  playerName: string
  game?: string
}>()

const emit = defineEmits<{
  navigateToMap: [mapName: string]
}>()

const loading = ref(true)
const error = ref<string | null>(null)
const timelineData = ref<MapPerformanceTimelineResponse | null>(null)
const currentMonthIndex = ref(0)
const isPlaying = ref(false)
const selectedMetric = ref<'kdRatio' | 'score' | 'kills'>('kdRatio')
const playbackSpeed = ref(1500)

let playbackInterval: number | null = null

const metrics: { value: 'kdRatio' | 'score' | 'kills'; label: string }[] = [
  { value: 'kdRatio', label: 'K/D' },
  { value: 'score', label: 'Score' },
  { value: 'kills', label: 'Kills' },
]

const currentMonth = computed(() => {
  if (!timelineData.value) return null
  return timelineData.value.months[currentMonthIndex.value]
})

const getValue = (m: { kdRatio: number; score: number; kills: number }): number => {
  switch (selectedMetric.value) {
    case 'kdRatio': return m.kdRatio
    case 'kills': return m.kills
    case 'score': return m.score
    default: return m.score
  }
}

const topMaps = computed(() => {
  if (!currentMonth.value) return []
  return [...currentMonth.value.maps].sort((a, b) => getValue(b) - getValue(a)).slice(0, 10)
})

const maxValue = computed(() => {
  if (topMaps.value.length === 0) return 1
  return Math.max(...topMaps.value.map(getValue))
})

const getBarWidth = (m: { kdRatio: number; score: number; kills: number }): number => {
  const val = getValue(m)
  return maxValue.value > 0 ? (val / maxValue.value) * 100 : 0
}

const formatValue = (m: { kdRatio: number; score: number; kills: number }): string => {
  switch (selectedMetric.value) {
    case 'kdRatio': return m.kdRatio.toFixed(2)
    case 'kills': return m.kills.toLocaleString()
    case 'score': return m.score.toLocaleString()
    default: return ''
  }
}

function togglePlayback() {
  if (isPlaying.value) stopPlayback()
  else startPlayback()
}

function startPlayback() {
  if (!timelineData.value) return
  if (currentMonthIndex.value >= timelineData.value.months.length - 1) currentMonthIndex.value = 0
  isPlaying.value = true
  playbackInterval = window.setInterval(() => {
    if (currentMonthIndex.value < timelineData.value!.months.length - 1) currentMonthIndex.value++
    else stopPlayback()
  }, playbackSpeed.value)
}

function stopPlayback() {
  isPlaying.value = false
  if (playbackInterval !== null) {
    clearInterval(playbackInterval)
    playbackInterval = null
  }
}

async function loadData() {
  loading.value = true
  error.value = null
  try {
    timelineData.value = await fetchMapPerformanceTimeline(
      props.playerName,
      props.game || 'bf1942',
      12,
    )
    currentMonthIndex.value = timelineData.value?.months.length
      ? timelineData.value.months.length - 1
      : 0
  } catch (err: any) {
    console.error('Error loading map performance timeline:', err)
    error.value = 'Failed to load performance stream'
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
onUnmounted(stopPlayback)
watch(() => props.playerName, () => { stopPlayback(); loadData() })
</script>

<template>
  <section class="mm-mpr">
    <div v-if="loading" class="mm-mpr__state">
      <div v-for="i in 4" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">{{ error }}</div>

    <div v-else-if="!timelineData || timelineData.months.length === 0" class="mm-empty">
      No performance stream available.
    </div>

    <template v-else>
      <header class="mm-mpr__head">
        <button
          type="button"
          class="mm-btn mm-btn--inline mm-mpr__playback"
          :title="isPlaying ? 'Pause' : 'Play'"
          @click="togglePlayback"
        >
          {{ isPlaying ? '⏸' : '▶' }}
        </button>
        <span class="mm-eyebrow mm-eyebrow--strong mm-mpr__month">
          {{ currentMonth?.monthLabel || '' }}
        </span>
        <input
          v-model.number="currentMonthIndex"
          type="range"
          :min="0"
          :max="timelineData.months.length - 1"
          :disabled="isPlaying"
          class="mm-mpr__scrubber"
        />
        <div class="mm-subtabs">
          <button
            v-for="m in metrics"
            :key="m.value"
            type="button"
            class="mm-subtab"
            :class="{ 'mm-subtab--active': selectedMetric === m.value }"
            @click="selectedMetric = m.value"
          >{{ m.label }}</button>
        </div>
      </header>

      <TransitionGroup name="mm-mpr-reorder" tag="div" class="mm-mpr__list">
        <button
          v-for="(map, index) in topMaps"
          :key="map.mapName"
          type="button"
          class="mm-mpr__row"
          @click.stop="emit('navigateToMap', map.mapName)"
        >
          <span class="mm-mpr__label" :title="map.mapName">{{ map.mapName }}</span>
          <div class="mm-list__bar mm-mpr__bar">
            <div
              class="mm-list__bar-fill"
              :class="{ 'mm-list__bar-fill--accent': index === 0 }"
              :style="{ width: getBarWidth(map) + '%' }"
            />
          </div>
          <span class="mm-mpr__value">{{ formatValue(map) }}</span>
        </button>
      </TransitionGroup>
    </template>
  </section>
</template>

<style scoped>
.mm-mpr { display: flex; flex-direction: column; gap: 14px; }

.mm-mpr__state { padding: 14px 0; }

.mm-mpr__head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.mm-mpr__playback {
  font-family: var(--mm-font-mono);
  font-size: 14px;
  padding: 4px 12px;
}

.mm-mpr__month {
  min-width: 110px;
}

.mm-mpr__scrubber {
  flex: 1;
  min-width: 120px;
  accent-color: var(--mm-ink);
}

.mm-mpr__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mm-mpr__row {
  display: grid;
  grid-template-columns: 1fr 200px 90px;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--mm-rule);
  cursor: pointer;
  color: var(--mm-ink);
  text-align: left;
  transition: opacity 0.4s, transform 0.4s;
}

.mm-mpr__row:hover .mm-mpr__label { color: var(--mm-accent); }

.mm-mpr__label {
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.12s ease;
}

.mm-mpr__bar { width: 200px; }

.mm-mpr__value {
  font-family: var(--mm-font-mono);
  font-size: 11.5px;
  color: var(--mm-ink-muted);
  text-align: right;
}

.mm-mpr-reorder-move { transition: transform 0.6s cubic-bezier(0.3, 0, 0.2, 1); }

@media (max-width: 720px) {
  .mm-mpr__row { grid-template-columns: 1fr 90px 70px; gap: 8px; }
  .mm-mpr__bar { width: 90px; }
}
</style>
