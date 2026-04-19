<template>
  <section
    v-if="cells.length > 0"
    class="nhm"
    aria-label="Weekly player activity heatmap"
  >
    <header class="nhm__head">
      <span class="nhm__label">NETWORK PULSE</span>
      <span class="nhm__sub">Average concurrent players by hour · local time</span>
    </header>

    <div
      v-if="recentTrend.length > 0"
      class="nhm__trend"
      aria-label="Last 12 hours of network activity"
    >
      <svg
        class="nhm__trend-svg"
        :viewBox="`0 0 ${trendWidth} ${trendHeight}`"
        preserveAspectRatio="none"
        role="img"
      >
        <path
          class="nhm__trend-area"
          :d="trendArea"
        />
        <path
          class="nhm__trend-line"
          :d="trendLine"
        />
        <circle
          v-for="(p, i) in trendPoints"
          :key="i"
          class="nhm__trend-dot"
          :cx="p.x"
          :cy="p.y"
          r="2"
        />
      </svg>
      <div class="nhm__trend-foot">
        <span>{{ trendLabelStart }}</span>
        <span v-if="peakToday">Peak today · {{ Math.round(peakToday.avgPlayers) }} @ {{ formatHour(peakToday.hourUtc) }}</span>
        <span>now</span>
      </div>
    </div>

    <div class="nhm__grid" role="grid" :aria-rowcount="7" :aria-colcount="24">
      <div class="nhm__corner" aria-hidden="true" />
      <div
        v-for="h in hourLabels"
        :key="'hh-' + h"
        class="nhm__hour-label"
        role="columnheader"
      >{{ h }}</div>

      <template v-for="row in 7" :key="'row-' + row">
        <div class="nhm__day-label" role="rowheader">{{ dayLabels[row - 1] }}</div>
        <div
          v-for="col in 24"
          :key="`c-${row}-${col}`"
          class="nhm__cell"
          :class="intensityClass(localIndex(row - 1, col - 1))"
          :title="cellTooltip(row - 1, col - 1)"
          role="gridcell"
        />
      </template>
    </div>

    <div class="nhm__legend" aria-hidden="true">
      <span class="nhm__legend-label">Quiet</span>
      <span class="nhm__legend-cells">
        <span v-for="i in 5" :key="i" class="nhm__legend-cell" :class="`nhm__cell--l${i}`" />
      </span>
      <span class="nhm__legend-label">Peak</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { NetworkPulseHeatmapCell, NetworkPulseHourlyPoint, NetworkPulsePeakInfo } from '@/services/landingV3Service'

const props = defineProps<{
  cells: NetworkPulseHeatmapCell[]
  recentTrend: NetworkPulseHourlyPoint[]
  peakToday?: NetworkPulsePeakInfo | null
}>()

const trendWidth = 600
const trendHeight = 60

// The server sends day-of-week using SQLite convention (0 = Sunday … 6 = Saturday)
// and hour-of-day in UTC. Convert to the user's local timezone.
const hourLabels = Array.from({ length: 24 }, (_, i) => (i === 0 || i === 12 || i === 6 || i === 18 ? String(i).padStart(2, '0') : ''))
const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const cellMap = computed(() => {
  const map = new Map<string, number>()
  const tzOffsetMinutes = new Date().getTimezoneOffset()
  for (const c of props.cells) {
    // Convert UTC (dayOfWeek, hourOfDay) to local.
    // SQLite strftime('%w') gives 0=Sun..6=Sat in UTC.
    const utcDay = c.dayOfWeek
    const utcHour = c.hourOfDay
    const totalUtcMin = utcDay * 24 * 60 + utcHour * 60
    const localTotal = totalUtcMin - tzOffsetMinutes
    const adjusted = ((localTotal % (7 * 24 * 60)) + 7 * 24 * 60) % (7 * 24 * 60)
    const localDay = Math.floor(adjusted / (24 * 60))
    const localHour = Math.floor((adjusted % (24 * 60)) / 60)
    // Remap from 0=Sun..6=Sat to 0=Mon..6=Sun for display
    const row = (localDay + 6) % 7
    map.set(`${row}:${localHour}`, c.avgPlayers)
  }
  return map
})

const maxValue = computed(() => {
  let max = 0
  for (const v of cellMap.value.values()) {
    if (v > max) max = v
  }
  return max
})

const intensityLevel = (val: number): number => {
  if (maxValue.value <= 0) return 0
  const ratio = val / maxValue.value
  if (ratio <= 0.05) return 0
  if (ratio < 0.2) return 1
  if (ratio < 0.4) return 2
  if (ratio < 0.6) return 3
  if (ratio < 0.8) return 4
  return 5
}

const localIndex = (row: number, col: number): number => {
  return cellMap.value.get(`${row}:${col}`) ?? 0
}

const intensityClass = (val: number): string => `nhm__cell--l${intensityLevel(val)}`

const cellTooltip = (row: number, col: number): string => {
  const val = localIndex(row, col)
  return `${dayLabels[row]} ${String(col).padStart(2, '0')}:00 — ${val.toFixed(1)} avg players`
}

const trendPoints = computed(() => {
  if (props.recentTrend.length === 0) return []
  const maxP = Math.max(1, ...props.recentTrend.map(p => p.avgPlayers))
  const step = props.recentTrend.length <= 1 ? 0 : trendWidth / (props.recentTrend.length - 1)
  return props.recentTrend.map((p, i) => {
    const ratio = p.avgPlayers / maxP
    return {
      x: i * step,
      y: trendHeight - ratio * (trendHeight - 4) - 2
    }
  })
})

const trendLine = computed(() => {
  if (trendPoints.value.length === 0) return ''
  return trendPoints.value
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ')
})

const trendArea = computed(() => {
  if (trendPoints.value.length === 0) return ''
  const line = trendPoints.value
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ')
  const last = trendPoints.value[trendPoints.value.length - 1]
  const first = trendPoints.value[0]
  return `${line} L${last.x.toFixed(1)},${trendHeight} L${first.x.toFixed(1)},${trendHeight} Z`
})

const trendLabelStart = computed(() => {
  if (props.recentTrend.length === 0) return ''
  const firstIso = props.recentTrend[0].hourUtc
  try {
    const d = new Date(firstIso)
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
})

const formatHour = (iso: string): string => {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}
</script>

<style scoped>
.nhm {
  margin: 1.25rem 0 1.5rem;
  padding: 0.85rem 0.9rem;
  background: var(--portal-surface);
  border: 1px solid var(--portal-border);
  border-radius: 8px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}
.nhm__head {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin-bottom: 0.6rem;
}
.nhm__label {
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  color: var(--portal-accent);
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  text-shadow: 0 0 8px var(--portal-accent-glow);
}
.nhm__sub {
  font-size: 0.72rem;
  color: var(--portal-text);
  opacity: 0.75;
}
.nhm__trend {
  margin-bottom: 0.85rem;
}
.nhm__trend-svg {
  width: 100%;
  height: 60px;
  display: block;
}
.nhm__trend-area {
  fill: var(--portal-accent-dim);
}
.nhm__trend-line {
  fill: none;
  stroke: var(--portal-accent);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.nhm__trend-dot {
  fill: var(--portal-accent);
}
.nhm__trend-foot {
  display: flex;
  justify-content: space-between;
  font-size: 0.68rem;
  color: var(--portal-text);
  opacity: 0.75;
  padding: 0 0.15rem;
}
.nhm__grid {
  display: grid;
  grid-template-columns: 2.75rem repeat(24, 1fr);
  gap: 2px;
  align-items: center;
}
.nhm__corner { }
.nhm__hour-label {
  font-size: 0.6rem;
  color: var(--portal-text);
  opacity: 0.6;
  text-align: center;
}
.nhm__day-label {
  font-size: 0.7rem;
  color: var(--portal-text);
  opacity: 0.85;
  padding-right: 0.25rem;
  text-align: right;
}
.nhm__cell {
  aspect-ratio: 1;
  border-radius: 1px;
  min-height: 10px;
}
.nhm__cell--l0 { background: rgba(255, 255, 255, 0.04); }
.nhm__cell--l1 { background: rgba(0, 229, 255, 0.12); }
.nhm__cell--l2 { background: rgba(0, 229, 255, 0.28); }
.nhm__cell--l3 { background: rgba(0, 229, 255, 0.48); }
.nhm__cell--l4 { background: rgba(0, 229, 255, 0.75); }
.nhm__cell--l5 {
  background: #00e5ff;
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.6);
}
.nhm__legend {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.6rem;
  font-size: 0.68rem;
  color: var(--portal-text);
  opacity: 0.75;
  justify-content: flex-end;
}
.nhm__legend-cells {
  display: inline-flex;
  gap: 2px;
}
.nhm__legend-cell {
  width: 10px;
  height: 10px;
  border-radius: 1px;
}
</style>
