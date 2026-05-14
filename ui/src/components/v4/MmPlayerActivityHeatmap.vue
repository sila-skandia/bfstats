<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { fetchPlayerActivityHeatmap } from '@/services/playerStatsApi'
import type { ActivityHeatmapResponse, HeatmapCell } from '@/types/playerStatsTypes'

const props = defineProps<{
  playerName: string
  game?: string
}>()

const loading = ref(true)
const error = ref<string | null>(null)
const heatmapData = ref<ActivityHeatmapResponse | null>(null)
const viewMode = ref<'heatmap' | 'table'>('heatmap')
const tooltip = ref<{
  x: number
  y: number
  dayName: string
  hourRange: string
  minutes: number
  map?: string
} | null>(null)

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const cellMap = computed(() => {
  if (!heatmapData.value) return new Map<string, HeatmapCell>()
  const map = new Map<string, HeatmapCell>()
  heatmapData.value.cells.forEach(cell => {
    map.set(`${cell.dayOfWeek}-${cell.hour}`, cell)
  })
  return map
})

const maxMinutes = computed(() => {
  if (!heatmapData.value || heatmapData.value.cells.length === 0) return 1
  return Math.max(...heatmapData.value.cells.map(c => c.minutesActive))
})

const sortedTableData = computed(() => {
  if (!heatmapData.value) return []
  return [...heatmapData.value.cells]
    .filter(cell => cell.minutesActive > 0)
    .sort((a, b) => b.minutesActive - a.minutesActive)
})

function getCellStyle(dayOfWeek: number, hour: number) {
  const cell = cellMap.value.get(`${dayOfWeek}-${hour}`)
  if (!cell || cell.minutesActive === 0) {
    return { backgroundColor: 'var(--mm-bg-mute)' }
  }
  const intensity = cell.minutesActive / maxMinutes.value
  let opacity: number
  if (intensity <= 0.2) opacity = 0.18
  else if (intensity <= 0.4) opacity = 0.36
  else if (intensity <= 0.6) opacity = 0.55
  else if (intensity <= 0.8) opacity = 0.78
  else opacity = 1.0
  return { backgroundColor: `rgba(26, 26, 26, ${opacity})` }
}

function formatHourRange(hour: number) {
  const start = hour === 0 ? '12am' : hour <= 12 ? `${hour}am` : `${hour - 12}pm`
  const endHour = (hour + 1) % 24
  const end = endHour === 0 ? '12am' : endHour <= 12 ? `${endHour}am` : `${endHour - 12}pm`
  return `${start}–${end}`
}

function showTooltip(event: MouseEvent, dayOfWeek: number, hour: number) {
  const cell = cellMap.value.get(`${dayOfWeek}-${hour}`)
  if (!cell || cell.minutesActive === 0) {
    hideTooltip()
    return
  }
  const rect = (event.target as HTMLElement).getBoundingClientRect()
  tooltip.value = {
    x: rect.left + rect.width / 2,
    y: rect.top - 10,
    dayName: dayNames[dayOfWeek],
    hourRange: formatHourRange(hour),
    minutes: cell.minutesActive,
    map: cell.mostPlayedMap,
  }
}

function hideTooltip() {
  tooltip.value = null
}

async function loadData() {
  loading.value = true
  error.value = null
  try {
    heatmapData.value = await fetchPlayerActivityHeatmap(
      props.playerName,
      props.game || 'bf1942',
      90,
    )
  } catch (err) {
    error.value = 'Failed to load activity heatmap'
    console.error(err)
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
watch(() => props.playerName, loadData)
</script>

<template>
  <section class="mm-heat">
    <header class="mm-heat__head">
      <div class="mm-eyebrow mm-eyebrow--strong">Weekly activity rhythm</div>
      <div class="mm-subtabs">
        <button
          type="button"
          class="mm-subtab"
          :class="{ 'mm-subtab--active': viewMode === 'heatmap' }"
          @click="viewMode = 'heatmap'"
        >Heatmap</button>
        <button
          type="button"
          class="mm-subtab"
          :class="{ 'mm-subtab--active': viewMode === 'table' }"
          @click="viewMode = 'table'"
        >Table</button>
      </div>
    </header>

    <div v-if="loading" class="mm-heat__state">
      <div v-for="i in 4" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">{{ error }}</div>

    <div v-else-if="viewMode === 'heatmap' && heatmapData" class="mm-heat__grid">
      <div class="mm-heat__hours">
        <div class="mm-heat__day-label" />
        <div v-for="hour in 24" :key="hour" class="mm-heat__hour-label">{{ hour - 1 }}</div>
      </div>
      <div
        v-for="(dayName, dayIndex) in dayNames"
        :key="dayIndex"
        class="mm-heat__row"
      >
        <div class="mm-heat__day-label">{{ dayName }}</div>
        <div
          v-for="hour in 24"
          :key="hour"
          class="mm-heat__cell"
          :style="getCellStyle(dayIndex, hour - 1)"
          @mouseenter="showTooltip($event, dayIndex, hour - 1)"
          @mouseleave="hideTooltip"
        />
      </div>
    </div>

    <table v-else-if="viewMode === 'table' && heatmapData" class="mm-list">
      <thead>
        <tr>
          <th>Day</th>
          <th>Hour</th>
          <th class="is-num">Minutes</th>
          <th>Most-played map</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="cell in sortedTableData" :key="`${cell.dayOfWeek}-${cell.hour}`">
          <td data-cell-label="Day">{{ dayNames[cell.dayOfWeek] }}</td>
          <td data-cell-label="Hour">{{ formatHourRange(cell.hour) }}</td>
          <td class="is-num" data-cell-label="Minutes">{{ cell.minutesActive }}</td>
          <td class="is-muted" data-cell-label="Map">{{ cell.mostPlayedMap || '—' }}</td>
        </tr>
        <tr v-if="sortedTableData.length === 0">
          <td colspan="4" class="mm-empty" style="border: 0">No activity recorded.</td>
        </tr>
      </tbody>
    </table>

    <div
      v-if="tooltip"
      class="mm-heat__tooltip"
      :style="{ left: tooltip.x + 'px', top: tooltip.y + 'px' }"
    >
      <div class="mm-heat__tooltip-title">{{ tooltip.dayName }} · {{ tooltip.hourRange }}</div>
      <div class="mm-heat__tooltip-line">{{ tooltip.minutes }} minutes active</div>
      <div v-if="tooltip.map" class="mm-heat__tooltip-line">Most played: {{ tooltip.map }}</div>
    </div>
  </section>
</template>

<style scoped>
.mm-heat {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mm-heat__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mm-heat__state { padding: 14px 0; }

.mm-heat__grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-x: auto;
}

.mm-heat__hours {
  display: grid;
  grid-template-columns: 36px repeat(24, 1fr);
  gap: 2px;
  align-items: center;
}

.mm-heat__hour-label {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
  text-align: center;
}

.mm-heat__row {
  display: grid;
  grid-template-columns: 36px repeat(24, 1fr);
  gap: 2px;
  align-items: center;
}

.mm-heat__day-label {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  text-align: right;
  padding-right: 6px;
}

.mm-heat__cell {
  aspect-ratio: 1 / 1;
  min-height: 16px;
  border-radius: 1px;
  transition: outline 0.12s ease;
}

.mm-heat__cell:hover {
  outline: 1px solid var(--mm-accent);
  outline-offset: -1px;
}

.mm-heat__tooltip {
  position: fixed;
  transform: translate(-50%, -100%);
  pointer-events: none;
  background: var(--mm-ink);
  color: var(--mm-bg);
  padding: 8px 12px;
  border-radius: 2px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  z-index: 100;
  white-space: nowrap;
}

.mm-heat__tooltip-title { color: var(--mm-bg); margin-bottom: 4px; font-weight: 500; }
.mm-heat__tooltip-line { color: var(--mm-bg-mute); }

@media (max-width: 720px) {
  .mm-heat__cell { min-height: 12px; }
  .mm-heat__hour-label { font-size: 8px; }
  .mm-heat__day-label { font-size: 9px; }
}
</style>
