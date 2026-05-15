<template>
  <div class="mm-aheat">
    <div class="mm-aheat__head">
      <div class="mm-aheat__day-label" />
      <div class="mm-aheat__hours">
        <span v-for="h in 24" :key="h" class="mm-aheat__hour-label">{{ (h - 1).toString().padStart(2, '0') }}</span>
      </div>
    </div>

    <div
      v-for="day in days"
      :key="day.index"
      class="mm-aheat__row"
    >
      <div class="mm-aheat__day-label">{{ day.label }}</div>
      <div class="mm-aheat__cells">
        <div
          v-for="hour in 24"
          :key="hour"
          class="mm-aheat__cell"
          :style="getCellStyle(day.index, hour - 1)"
          :title="getCellTooltip(day.index, hour - 1)"
        />
      </div>
    </div>

    <div class="mm-aheat__legend">
      <span class="mm-eyebrow">Quiet</span>
      <div class="mm-aheat__legend-colors">
        <div
          v-for="i in 6"
          :key="i"
          class="mm-aheat__legend-color"
          :style="{ backgroundColor: legendColor(i - 1) }"
        />
      </div>
      <span class="mm-eyebrow">Busy</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ActivityPattern } from '@/services/dataExplorerService'

const props = defineProps<{
  patterns: ActivityPattern[]
}>()

const days = [
  { index: 0, label: 'Sun' },
  { index: 1, label: 'Mon' },
  { index: 2, label: 'Tue' },
  { index: 3, label: 'Wed' },
  { index: 4, label: 'Thu' },
  { index: 5, label: 'Fri' },
  { index: 6, label: 'Sat' },
]

const timezoneOffsetHours = computed(() => -new Date().getTimezoneOffset() / 60)

const utcToLocal = (utcDay: number, utcHour: number): { day: number; hour: number } => {
  let localHour = utcHour + timezoneOffsetHours.value
  let localDay = utcDay
  if (localHour >= 24) { localHour -= 24; localDay = (localDay + 1) % 7 }
  else if (localHour < 0) { localHour += 24; localDay = (localDay + 6) % 7 }
  return { day: localDay, hour: localHour }
}

const patternMap = computed(() => {
  const map = new Map<string, ActivityPattern>()
  props.patterns.forEach(p => {
    const local = utcToLocal(p.dayOfWeek, p.hourOfDay)
    map.set(`${local.day}-${local.hour}`, p)
  })
  return map
})

const maxPlayers = computed(() => Math.max(...props.patterns.map(p => p.avgPlayers), 1))

const legendColor = (idx: number) => {
  const opacities = [0.06, 0.18, 0.35, 0.55, 0.78, 1.0]
  return `rgba(125, 136, 73, ${opacities[idx] ?? 0.06})`
}

const getCellStyle = (dayOfWeek: number, hourOfDay: number) => {
  const pattern = patternMap.value.get(`${dayOfWeek}-${hourOfDay}`)
  if (!pattern || pattern.avgPlayers === 0) return { backgroundColor: 'var(--mm-bg-mute)' }
  const intensity = pattern.avgPlayers / maxPlayers.value
  const colorIndex = Math.min(Math.floor(intensity * 6), 5)
  return { backgroundColor: legendColor(colorIndex) }
}

const getCellTooltip = (dayOfWeek: number, hourOfDay: number): string => {
  const pattern = patternMap.value.get(`${dayOfWeek}-${hourOfDay}`)
  const timeStr = `${hourOfDay.toString().padStart(2, '0')}:00`
  if (!pattern) return `${days[dayOfWeek].label} ${timeStr} — no data`
  return `${days[dayOfWeek].label} ${timeStr} — avg ${pattern.avgPlayers.toFixed(1)} players`
}
</script>

<style scoped>
.mm-aheat { width: 100%; }

.mm-aheat__head {
  display: flex;
  margin-bottom: 4px;
}

.mm-aheat__day-label {
  width: 40px;
  flex-shrink: 0;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
  text-align: right;
  padding-right: 6px;
}

.mm-aheat__hours {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(24, minmax(0, 1fr));
  gap: 1px;
}

.mm-aheat__hour-label {
  text-align: center;
  font-family: var(--mm-font-mono);
  font-size: 8px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-faint);
  display: none;
}

@media (min-width: 640px) {
  .mm-aheat__hour-label { display: block; }
}

.mm-aheat__row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 1px;
}

.mm-aheat__cells {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(24, minmax(0, 1fr));
  gap: 1px;
}

.mm-aheat__cell {
  aspect-ratio: 1;
  border-radius: 1px;
  transition: outline 0.12s ease;
}

.mm-aheat__cell:hover {
  outline: 1px solid var(--mm-accent);
  outline-offset: -1px;
}

.mm-aheat__legend {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 10px;
}

.mm-aheat__legend-colors {
  display: flex;
  gap: 1px;
}

.mm-aheat__legend-color {
  width: 16px;
  height: 10px;
  border-radius: 1px;
}
</style>
