<script setup lang="ts">
import { computed } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
  type ChartData,
} from 'chart.js'
import { Line, Scatter } from 'vue-chartjs'
import type { RoundReport } from '@/services/serverDetailsService'
import type { BattleEvent, RoundSummary } from '@/utils/battleEventGenerator'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler)

interface Props {
  roundReport: RoundReport
  battleEvents: BattleEvent[]
  currentTimeIndex: number
  batchUpdateEvents: any[]
  trackedPlayer: string
  roundSummary?: RoundSummary | null
}

const props = defineProps<Props>()

// V4 palette for chart series — earthy ink instead of neon
const SERIES_COLORS = ['#c8772b', '#a83838', '#5a7d3a', '#8a5a18', '#4d4a42', '#1a1a1a']
const AXIS_TEXT = '#8a8579'
const GRID = '#d8d2c0'
const TRACK_LINE = '#c8772b'

const velocityChartData = computed<ChartData<'line'>>(() => {
  const snapshots = props.roundReport.leaderboardSnapshots
  if (!snapshots.length) return { labels: [], datasets: [] }
  const labels = snapshots.map((_, i) => `${i}m`)
  const serverKills = snapshots.map(s => s.entries.reduce((sum, e) => sum + e.kills, 0))
  const kpmData = serverKills.map((kills, i) => (i === 0 ? 0 : kills - serverKills[i - 1]))
  return {
    labels,
    datasets: [{
      label: 'Server KPM',
      data: kpmData,
      borderColor: '#1a1a1a',
      backgroundColor: 'rgba(26, 26, 26, 0.08)',
      fill: true,
      tension: 0.3,
      pointRadius: 0,
      borderWidth: 1.2,
    }],
  }
})

const raceChartData = computed<ChartData<'line'>>(() => {
  const snapshots = props.roundReport.leaderboardSnapshots
  if (!snapshots.length) return { labels: [], datasets: [] }

  const finalSnapshot = snapshots[snapshots.length - 1]
  const top5Names = finalSnapshot.entries.slice(0, 5).map(e => e.playerName)

  const playersOfInterest = [...top5Names]
  if (props.trackedPlayer.trim() && !top5Names.includes(props.trackedPlayer.trim())) {
    playersOfInterest.push(props.trackedPlayer.trim())
  }

  const labels = snapshots.map((_, i) => `${i}m`)

  const datasets = playersOfInterest.map((name, idx) => {
    const isTracked = name.toLowerCase() === props.trackedPlayer.trim().toLowerCase()
    return {
      label: name,
      data: snapshots.map(s => {
        const entry = s.entries.find(e => e.playerName.toLowerCase() === name.toLowerCase())
        return entry ? entry.score : 0
      }),
      borderColor: isTracked ? TRACK_LINE : SERIES_COLORS[idx % SERIES_COLORS.length],
      borderWidth: isTracked ? 3 : 1.5,
      pointRadius: 0,
      tension: 0.1,
      fill: false,
    }
  })

  return { labels, datasets }
})

const efficiencyChartData = computed<ChartData<'scatter'>>(() => {
  const snapshots = props.roundReport.leaderboardSnapshots
  if (!snapshots.length) return { datasets: [] }

  const currentIdx = Math.min(
    Math.floor((props.currentTimeIndex / props.batchUpdateEvents.length) * (snapshots.length - 1)),
    snapshots.length - 1,
  )
  const activeSnapshot = snapshots[currentIdx] || snapshots[0]

  const highInterestNames = activeSnapshot.entries.slice(0, 10).map(e => e.playerName.toLowerCase())
  if (props.trackedPlayer.trim()) highInterestNames.push(props.trackedPlayer.trim().toLowerCase())

  const operatives = activeSnapshot.entries.filter(e => highInterestNames.includes(e.playerName.toLowerCase()))
  const recruits = activeSnapshot.entries.filter(e => !highInterestNames.includes(e.playerName.toLowerCase()))

  return {
    datasets: [
      {
        label: 'Recruits',
        data: recruits.map(e => ({ x: e.deaths, y: e.kills, playerName: e.playerName })),
        backgroundColor: 'rgba(182, 177, 163, 0.45)',
        pointRadius: 2,
        pointHoverRadius: 4,
      },
      {
        label: 'Operatives',
        data: operatives.map(e => ({ x: e.deaths, y: e.kills, playerName: e.playerName })),
        backgroundColor: (context: any) => {
          const p = context.raw
          if (!p) return '#1a1a1a'
          if (p.playerName.toLowerCase() === props.trackedPlayer.trim().toLowerCase()) return '#c8772b'
          return p.y > p.x ? '#5a7d3a' : '#a83838'
        },
        pointRadius: (context: any) => {
          const p = context.raw
          return p?.playerName.toLowerCase() === props.trackedPlayer.trim().toLowerCase() ? 8 : 5
        },
        pointHoverRadius: 10,
        borderColor: 'rgba(26, 26, 26, 0.15)',
        borderWidth: 1,
      },
    ],
  }
})

const baseOptions: ChartOptions<any> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(26, 26, 26, 0.95)',
      titleColor: '#f5f1e8',
      bodyColor: '#e7e1d1',
      titleFont: { family: 'Geist Mono Variable', size: 11 },
      bodyFont: { family: 'Geist Mono Variable', size: 10 },
      padding: 10,
      borderColor: 'rgba(184, 177, 160, 0.4)',
      borderWidth: 1,
      callbacks: {
        label: (context: any) => {
          if (context.raw?.playerName) return `${context.raw.playerName}: ${context.raw.y}K / ${context.raw.x}D`
          return `${context.dataset.label}: ${context.raw}`
        },
      },
    },
  },
  scales: {
    x: { grid: { color: GRID }, ticks: { color: AXIS_TEXT, font: { family: 'Geist Mono Variable', size: 9 } } },
    y: { grid: { color: GRID }, ticks: { color: AXIS_TEXT, font: { family: 'Geist Mono Variable', size: 9 } } },
  },
}

const raceOptions = {
  ...baseOptions,
  scales: {
    ...baseOptions.scales,
    x: { display: false },
    y: { position: 'right', grid: { display: false }, ticks: { color: AXIS_TEXT, font: { family: 'Geist Mono Variable', size: 9 } } },
  },
}

const efficiencyOptions = {
  ...baseOptions,
  scales: {
    x: {
      title: { display: true, text: 'DEATHS', color: AXIS_TEXT, font: { family: 'Geist Mono Variable', size: 8 } },
      grid: { color: GRID },
      ticks: { color: AXIS_TEXT, font: { family: 'Geist Mono Variable', size: 9 } },
    },
    y: {
      title: { display: true, text: 'KILLS', color: AXIS_TEXT, font: { family: 'Geist Mono Variable', size: 8 } },
      grid: { color: GRID },
      ticks: { color: AXIS_TEXT, font: { family: 'Geist Mono Variable', size: 9 } },
    },
  },
}

const currentTimeProgress = computed(() => {
  if (!props.batchUpdateEvents.length) return 0
  return (props.currentTimeIndex / (props.batchUpdateEvents.length - 1)) * 100
})
</script>

<template>
  <div class="mm-viz">
    <div class="mm-viz__left">
      <section class="mm-viz__card">
        <header class="mm-viz__head">
          <div class="mm-eyebrow mm-eyebrow--strong">Lead flow</div>
          <div class="mm-viz__legend">
            <span
              v-for="(ds, i) in raceChartData.datasets"
              :key="i"
              class="mm-viz__legend-chip"
              :class="{ 'mm-viz__legend-chip--tracked': (ds.label ?? '').toLowerCase() === trackedPlayer.trim().toLowerCase() }"
            >
              <span class="mm-viz__legend-dot" :style="{ backgroundColor: String(ds.borderColor ?? '#1a1a1a') }" />
              {{ ds.label }}
            </span>
          </div>
        </header>
        <div class="mm-viz__chart mm-viz__chart--tall">
          <Line :data="raceChartData" :options="raceOptions" />
          <div class="mm-viz__cursor" :style="{ left: `${currentTimeProgress}%` }">
            <div class="mm-viz__cursor-dot" />
          </div>
        </div>
      </section>

      <section class="mm-viz__card">
        <header class="mm-viz__head">
          <div class="mm-eyebrow mm-eyebrow--strong">Combat velocity</div>
        </header>
        <div class="mm-viz__chart">
          <Line :data="velocityChartData" :options="baseOptions" />
          <div class="mm-viz__cursor mm-viz__cursor--muted" :style="{ left: `${currentTimeProgress}%` }" />
        </div>
      </section>
    </div>

    <div class="mm-viz__right">
      <section class="mm-viz__card">
        <header class="mm-viz__head">
          <div class="mm-eyebrow mm-eyebrow--strong">Efficiency quadrants</div>
        </header>
        <div class="mm-viz__chart mm-viz__chart--scatter">
          <Scatter :data="efficiencyChartData" :options="efficiencyOptions" />
          <div class="mm-viz__quadrants" aria-hidden="true">
            <div class="mm-viz__quadrant mm-viz__quadrant--tl">Hunters</div>
            <div class="mm-viz__quadrant mm-viz__quadrant--tr">Elite</div>
            <div class="mm-viz__quadrant mm-viz__quadrant--bl">Recruits</div>
            <div class="mm-viz__quadrant mm-viz__quadrant--br">Grinders</div>
          </div>
        </div>
        <div class="mm-card__hint" style="margin-top: 8px">
          Top 10 plus the pinned target render bold. Background cloud is the rest of the lobby.
        </div>
      </section>

      <section class="mm-viz__card">
        <header class="mm-viz__head">
          <div class="mm-eyebrow mm-eyebrow--strong">Round metrics</div>
        </header>
        <ul class="mm-viz__metrics">
          <li>
            <span class="mm-eyebrow">Kill velocity</span>
            <span>
              <span class="mm-stat__value mm-stat__value--small">{{ ((roundSummary?.totalKills || 0) / 10).toFixed(1) }}</span>
              <span class="mm-stat__suffix">KPM</span>
            </span>
          </li>
          <li>
            <span class="mm-eyebrow">Lead stability</span>
            <span>
              <span class="mm-stat__value mm-stat__value--small">{{ (100 - (roundSummary?.leadChanges || 0) * 10).toFixed(0) }}</span>
              <span class="mm-stat__suffix">%</span>
            </span>
          </li>
          <li>
            <span class="mm-eyebrow">Avg K/D</span>
            <span>
              <span class="mm-stat__value mm-stat__value--small">{{ (roundSummary?.avgKD || 0).toFixed(2) }}</span>
            </span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
.mm-viz {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 20px;
  padding: 18px 0;
}

.mm-viz__left, .mm-viz__right { display: flex; flex-direction: column; gap: 20px; }

.mm-viz__card {
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
}

.mm-viz__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.mm-viz__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}

.mm-viz__legend-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
  padding: 1px 6px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
}

.mm-viz__legend-chip--tracked {
  color: var(--mm-accent);
  border-color: var(--mm-accent);
}

.mm-viz__legend-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.mm-viz__chart {
  position: relative;
  height: 140px;
}

.mm-viz__chart--tall { height: 280px; }
.mm-viz__chart--scatter { height: 280px; }

.mm-viz__cursor {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--mm-accent);
  z-index: 5;
  pointer-events: none;
  transition: left 0.2s ease;
}

.mm-viz__cursor--muted { background: var(--mm-ink-faint); }

.mm-viz__cursor-dot {
  position: absolute;
  top: -2px;
  left: -2px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--mm-accent);
}

.mm-viz__quadrants {
  position: absolute;
  inset: 24px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  pointer-events: none;
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--mm-ink-faint);
  text-transform: uppercase;
}

.mm-viz__quadrant {
  display: flex;
  padding: 4px;
}

.mm-viz__quadrant--tl { justify-content: flex-end; align-items: flex-start; border-right: 1px dashed var(--mm-rule); border-bottom: 1px dashed var(--mm-rule); }
.mm-viz__quadrant--tr { justify-content: flex-start; align-items: flex-start; border-bottom: 1px dashed var(--mm-rule); }
.mm-viz__quadrant--bl { justify-content: flex-end; align-items: flex-end; border-right: 1px dashed var(--mm-rule); }
.mm-viz__quadrant--br { justify-content: flex-start; align-items: flex-end; }

.mm-viz__metrics {
  list-style: none;
  margin: 0;
  padding: 0;
}

.mm-viz__metrics li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--mm-rule);
  gap: 12px;
}

.mm-viz__metrics li:last-child { border-bottom: 0; }

@media (max-width: 880px) {
  .mm-viz { grid-template-columns: 1fr; }
}
</style>
