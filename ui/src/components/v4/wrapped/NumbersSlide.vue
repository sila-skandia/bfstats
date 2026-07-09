<template>
  <div class="wrapped-slide numbers-slide animate-line-in">
    <div class="slide-header">
      <span class="slide-badge animate-rise-up" style="animation-delay: 0.05s">01 — THE YEAR IN NUMBERS</span>
      <h2 class="slide-title animate-rise-up" style="animation-delay: 0.1s">The front never slept.</h2>
    </div>

    <div class="numbers-content">
      <!-- 1. Key Metrics Row -->
      <div class="metrics-row animate-rise-up" style="animation-delay: 0.15s">
        <!-- Column 1: Rounds Fought -->
        <div class="metric-column">
          <div class="metric-val">
            <num-count :data-to="data.yearInNumbers.roundsFought" data-dur="1200" data-delay="120"></num-count>
          </div>
          <div class="mm-eyebrow">ROUNDS FOUGHT</div>
        </div>
        <!-- Column 2: Unique Soldiers -->
        <div class="metric-column">
          <div class="metric-val">
            <num-count :data-to="data.yearInNumbers.uniqueSoldiers" data-dur="1200" data-delay="240"></num-count>
          </div>
          <div class="mm-eyebrow">UNIQUE SOLDIERS</div>
        </div>
        <!-- Column 3: Combat Hours -->
        <div class="metric-column last">
          <div class="metric-val">
            <num-count :data-to="Math.round(data.yearInNumbers.hoursInCombat)" data-dur="1250" data-delay="360"></num-count>
          </div>
          <div class="mm-eyebrow">HOURS IN COMBAT</div>
        </div>
      </div>

      <!-- 2. Chart Section (Busiest Hours Heatmap / Bar chart) -->
      <div class="chart-section animate-rise-up" style="animation-delay: 0.3s">
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
                :style="{ height: hb.height, backgroundColor: hb.bg, transformOrigin: 'bottom', animation: 'growY 0.7s cubic-bezier(0.22, 0.61, 0.36, 1) both', animationDelay: (idx * 0.015) + 's' }"
              ></div>
            </div>
          </div>
          <div class="bars-labels">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>23:00</span>
          </div>
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
                :style="{ backgroundColor: getCellColor(dIdx, hIdx - 1), animation: 'cellIn 0.4s ease both', animationDelay: ((dIdx * 24 + hIdx) * 0.002) + 's' }"
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

        <!-- Busiest time text description -->
        <p class="chart-desc animate-rise-up" style="animation-delay: 0.35s">
          Average population by hour of day. Busiest day/time: <span class="text-ink">{{ peakDayName }}s around {{ peakHourFormatted }}</span>. Weekends averaged 30% busier than weekdays.
        </p>
      </div>

      <!-- 3. Slide Footer -->
      <div class="metrics-footer animate-rise-up" style="animation-delay: 0.4s">
        PEAK POPULATION <span class="text-ink">{{ data.yearInNumbers.peakPopulation }}</span> · {{ formattedPeakDate }} · <span class="text-ink">{{ data.yearInNumbers.totalDecorations.toLocaleString() }}</span> DECORATIONS AWARDED
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

const formattedPeakDate = computed(() => {
  if (!props.data.yearInNumbers.peakTimestamp || props.data.yearInNumbers.peakTimestamp.startsWith('-999')) {
    return 'N/A'
  }
  try {
    const d = new Date(props.data.yearInNumbers.peakTimestamp)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).toUpperCase()
  } catch {
    return '2026'
  }
})

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
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
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
  font-size: clamp(22px, 3.2vw, 32px);
  font-weight: 300;
  letter-spacing: -0.02em;
  color: var(--mm-ink);
  margin: 0;
  line-height: 1.25;
}

.numbers-content {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.metrics-row {
  display: grid;
  grid-template-columns: 1fr;
  border-top: 1px solid var(--mm-ink);
  border-bottom: 1px solid var(--mm-rule);
  width: 100%;
}

@media (min-width: 640px) {
  .metrics-row {
    grid-template-columns: 1fr 1fr 1fr;
  }
}

.metric-column {
  padding: 12px 12px 12px 0;
  border-bottom: 1px solid var(--mm-rule);
}

@media (min-width: 640px) {
  .metric-column {
    border-bottom: none;
    border-right: 1px solid var(--mm-rule);
    padding: 12px;
  }
  .metric-column.last {
    border-right: none;
    padding-right: 0;
  }
}

.metric-val {
  font-family: var(--mm-font-display);
  font-weight: 300;
  font-size: 38px;
  line-height: 1;
  color: var(--mm-ink);
}

.mm-eyebrow {
  font-family: var(--mm-font-mono);
  font-size: 8px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
  margin-top: 6px;
}

/* CHART CONTAINER styles */
.chart-section {
  width: 100%;
}

.desktop-chart-container {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.bars-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 80px;
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
  margin-top: 6px;
  font-family: var(--mm-font-mono);
  font-size: 9px;
  color: var(--mm-ink-faint);
}

/* MOBILE HEATMAP GRID styles */
.mobile-grid-container {
  display: flex;
  flex-direction: column;
  width: 100%;
}

.grid-row {
  display: flex;
  align-items: center;
  margin-top: 3px;
}

.grid-day-label {
  width: 28px;
  font-family: var(--mm-font-mono);
  font-size: 8px;
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
  height: 10px;
  border-radius: 1px;
  border: 1px solid var(--mm-rule);
}

.grid-labels {
  display: flex;
  justify-content: space-between;
  margin: 6px 0 0 28px;
  font-family: var(--mm-font-mono);
  font-size: 8px;
  color: var(--mm-ink-faint);
}

.chart-desc {
  margin-top: 12px;
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  color: var(--mm-ink-soft);
  line-height: 1.4;
}

.metrics-footer {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-muted);
  line-height: 1.4;
}

.text-ink {
  color: var(--mm-ink);
  font-weight: 600;
}

@keyframes growY {
  from { transform: scaleY(0); }
  to { transform: scaleY(1); }
}

@keyframes cellIn {
  from { opacity: 0; transform: scale(0.8); }
  to { opacity: 1; transform: scale(1); }
}
</style>
