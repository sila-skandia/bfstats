<template>
  <div class="wrapped-slide hours-slide animate-line-in">
    <div class="slide-header">
      <span class="slide-badge animate-rise-up" style="animation-delay: 0.05s">02 — BUSIEST HOURS</span>
      <h2 class="slide-title animate-rise-up" style="animation-delay: 0.1s">{{ peakDayName }}, {{ peakHourFormatted }}. Always.</h2>
      <span class="mm-chip animate-rise-up" style="animation-delay: 0.15s">LOCAL TIMEZONE</span>
    </div>

    <div class="hours-content">
      <!-- Widescreen: 24 vertical bars -->
      <div v-if="isDesktop" class="desktop-chart-container">
        <div class="bars-wrapper">
          <div 
            v-for="(hb, idx) in hourBars" 
            :key="hb.hour" 
            class="bar-item"
            :title="`Hour ${hb.hour}:00`"
          >
            <div 
              class="bar-fill"
              :style="{ height: hb.height, backgroundColor: hb.bg, transformOrigin: 'bottom', animation: 'growY 0.7s cubic-bezier(0.22, 0.61, 0.36, 1) both', animationDelay: (idx * 0.02) + 's' }"
            ></div>
          </div>
        </div>
        <div class="bars-labels animate-rise-up" style="animation-delay: 0.5s">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>23:00</span>
        </div>
        <p class="chart-desc animate-rise-up" style="animation-delay: 0.55s">
          Average population by hour of day all year. Peak times ran heavy — weekends averaged 30% busier than weekdays.
        </p>
      </div>

      <!-- Mobile/Tablet: 7x24 grid of micro cells -->
      <div v-else class="mobile-grid-container">
        <div 
          v-for="(day, dIdx) in daysOfWeek" 
          :key="day" 
          class="grid-row"
        >
          <span class="grid-day-label">{{ day }}</span>
          <div class="cells-wrapper">
            <div
              v-for="hIdx in 24"
              :key="hIdx"
              class="grid-cell"
              :style="{ backgroundColor: getCellColor(dIdx, hIdx - 1), animation: 'cellIn 0.4s ease both', animationDelay: ((dIdx * 24 + hIdx) * 0.003) + 's' }"
              :title="getCellTooltip(dIdx, hIdx - 1)"
            ></div>
          </div>
        </div>
        <div class="grid-labels">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>23</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import type { ServerWrappedData } from '@/services/wrappedService'

const props = defineProps<{
  data: ServerWrappedData
}>()

const daysOfWeek = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const daysNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const isDesktop = ref(true)

// Find peak cell
const peakCell = computed(() => {
  const cells = props.data.busiestHours.heatmapCells
  if (!cells || cells.length === 0) return null
  return cells.reduce((max, c) => (c.avgPlayers > max.avgPlayers ? c : max), cells[0])
})

const peakDayIndex = computed(() => {
  if (!peakCell.value) return 6 // Sun
  const cVal = peakCell.value.dayOfWeek
  return cVal === 0 ? 6 : cVal - 1
})

const peakHourIndex = computed(() => {
  return peakCell.value ? peakCell.value.hourOfDay : 21
})

const peakDayName = computed(() => {
  return daysNames[peakDayIndex.value]
})

const peakHourFormatted = computed(() => {
  const hour = peakHourIndex.value
  return `${String(hour).padStart(2, '0')}:00`
})

// Calculations for desktop 24-hour bars
const hourBars = computed(() => {
  const cells = props.data.busiestHours.heatmapCells
  const hourlyAverages = Array.from({ length: 24 }, (_, hour) => {
    const hourCells = cells.filter(c => c.hourOfDay === hour)
    const avg = hourCells.length > 0 ? hourCells.reduce((sum, c) => sum + c.avgPlayers, 0) / hourCells.length : 0
    return { hour, avg }
  })
  
  const maxAvgVal = Math.max(...hourlyAverages.map(h => h.avg), 1.0)
  return hourlyAverages.map(h => {
    const percentage = (h.avg / maxAvgVal) * 100
    const isPeak = h.hour === peakHourIndex.value
    return {
      hour: h.hour,
      height: `${Math.max(6, percentage)}%`,
      bg: isPeak ? 'var(--mm-accent)' : 'var(--mm-bg-soft)'
    }
  })
})

const maxAvg = computed(() => {
  const cells = props.data.busiestHours.heatmapCells
  if (!cells || cells.length === 0) return 1.0
  return Math.max(...cells.map(c => c.avgPlayers), 1.0)
})

function getCellColor(dayIdx: number, hourIdx: number): string {
  const dbDayOfWeek = dayIdx === 6 ? 0 : dayIdx + 1
  const cell = props.data.busiestHours.heatmapCells.find(
    c => c.dayOfWeek === dbDayOfWeek && c.hourOfDay === hourIdx
  )
  
  if (!cell || cell.avgPlayers <= 0) return 'var(--mm-bg)'
  
  if (dayIdx === peakDayIndex.value && hourIdx === peakHourIndex.value) {
    return 'var(--mm-accent)'
  }
  
  const intensity = cell.avgPlayers / maxAvg.value
  return `rgba(125, 136, 73, ${Math.max(0.15, intensity * 0.85).toFixed(2)})`
}

function getCellTooltip(dayIdx: number, hourIdx: number): string {
  const dbDayOfWeek = dayIdx === 6 ? 0 : dayIdx + 1
  const cell = props.data.busiestHours.heatmapCells.find(
    c => c.dayOfWeek === dbDayOfWeek && c.hourOfDay === hourIdx
  )
  const players = cell ? Math.round(cell.avgPlayers) : 0
  return `${daysNames[dayIdx]} ${hourIdx}:00 - Avg ${players} players`
}

function checkViewport() {
  isDesktop.value = window.innerWidth > 768
}

onMounted(() => {
  checkViewport()
  window.addEventListener('resize', checkViewport)
})

onUnmounted(() => {
  window.removeEventListener('resize', checkViewport)
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

.mm-chip {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  color: var(--mm-accent-soft);
  border: 1px solid var(--mm-rule);
  padding: 2px 6px;
  border-radius: var(--mm-radius-sm, 2px);
  text-transform: uppercase;
  display: inline-block;
}

.hours-content {
  width: 100%;
  margin-top: auto;
  margin-bottom: auto;
  display: flex;
  flex-direction: column;
}

/* WIDESCREEN BAR CHART style */
.desktop-chart-container {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.bars-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 140px;
  width: 100%;
  border-bottom: 1px solid var(--mm-rule);
  padding-bottom: 4px;
}

.bar-item {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
}

.bar-fill {
  width: 100%;
  border-radius: 1px;
  transition: all 0.3s ease;
}

.bars-labels {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-family: var(--mm-font-mono);
  font-size: 9px;
  color: var(--mm-ink-faint);
}

.chart-desc {
  margin-top: 14px;
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  color: var(--mm-ink-soft);
  line-height: 1.4;
}

/* MOBILE HEATMAP GRID style */
.mobile-grid-container {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.grid-row {
  display: flex;
  align-items: center;
  margin-top: 5px;
}

.grid-day-label {
  width: 32px;
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
}

.cells-wrapper {
  flex: 1;
  display: flex;
  gap: 2px;
}

.grid-cell {
  flex: 1;
  height: 13px;
  border-radius: 1px;
  border: 1px solid var(--mm-rule);
}

.grid-labels {
  display: flex;
  justify-content: space-between;
  margin: 8px 0 0 32px;
  font-family: var(--mm-font-mono);
  font-size: 9px;
  color: var(--mm-ink-faint);
}
</style>
