<script setup lang="ts">
import { computed } from 'vue'
import { Line } from 'vue-chartjs'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js'
import { decodePlayerName } from '@/utils/playerName'
import { MM_CHART } from '@/views/v4/mmTokens'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler)

interface Props {
  pinnedPlayers: Set<string>
  roundReport: any
  selectedSnapshotIndex: number
  serverGuid: string
}

const props = defineProps<Props>()

defineEmits<{
  'clear-all-pinned': []
  'unpin-player': [playerName: string]
}>()

const SERIES_COLORS = [MM_CHART.accent, MM_CHART.kill, MM_CHART.success, MM_CHART.elite, MM_CHART.inkSoft, MM_CHART.inkMuted]

const pinnedPerformance = computed(() => {
  if (!props.pinnedPlayers.size || !props.roundReport) return {}
  const map: Record<string, any[]> = {}
  Array.from(props.pinnedPlayers).forEach(name => {
    map[name] = props.roundReport.leaderboardSnapshots.map((snap: any, idx: number) => {
      const entry = snap.entries.find((e: any) => e.playerName === name)
      if (!entry) return null
      return { snapshotIndex: idx, timestamp: snap.timestamp, ...entry }
    }).filter(Boolean)
  })
  return map
})

const getElapsedTime = (timestamp: string): string => {
  if (!props.roundReport) return '+0m'
  const roundStart = new Date(props.roundReport.round.startTime)
  const snapshotTime = new Date(timestamp)
  const diffMs = snapshotTime.getTime() - roundStart.getTime()
  const totalMinutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `+${hours}h ${minutes}m` : `+${totalMinutes}m`
}

const chartData = computed(() => {
  if (!props.pinnedPlayers.size || !props.roundReport) return { labels: [], datasets: [] }
  const labels = props.roundReport.leaderboardSnapshots.map((snap: any) => getElapsedTime(snap.timestamp))

  const datasets = Array.from(props.pinnedPlayers).map((playerName, index) => {
    const performance = pinnedPerformance.value[playerName] || []
    const data: (number | null)[] = props.roundReport.leaderboardSnapshots.map((_: any, idx: number) => {
      const entry = performance.find((p: any) => p.snapshotIndex === idx)
      return entry ? entry.score : null
    })
    const color = SERIES_COLORS[index % SERIES_COLORS.length]
    const pointRadii = data.map((_v, idx) => (idx === props.selectedSnapshotIndex ? 8 : 3))
    const pointBackgroundColors = data.map((_v, idx) => (idx === props.selectedSnapshotIndex ? MM_CHART.elite : color))
    const pointBorderColors = data.map((_v, idx) => (idx === props.selectedSnapshotIndex ? MM_CHART.ink : MM_CHART.surface))
    const pointBorderWidths = data.map((_v, idx) => (idx === props.selectedSnapshotIndex ? 2 : 1))

    return {
      label: decodePlayerName(playerName),
      rawPlayerName: playerName,
      backgroundColor: color + '20',
      borderColor: color,
      borderWidth: 1.5,
      fill: false,
      tension: 0.3,
      pointRadius: pointRadii,
      pointHoverRadius: 10,
      pointBackgroundColor: pointBackgroundColors,
      pointBorderColor: pointBorderColors,
      pointBorderWidth: pointBorderWidths,
      data,
    }
  })
  return { labels, datasets }
})

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: { intersect: false, mode: 'index' as const },
  animation: { duration: 300 },
  scales: {
    y: {
      beginAtZero: false,
      grid: { color: MM_CHART.grid },
      title: { display: true, text: 'Score', color: MM_CHART.inkMuted, font: { family: 'Geist Mono Variable', size: 10 } },
      ticks: { color: MM_CHART.inkMuted, font: { family: 'Geist Mono Variable', size: 10 } },
    },
    x: {
      grid: { color: MM_CHART.grid },
      title: { display: true, text: 'Elapsed', color: MM_CHART.inkMuted, font: { family: 'Geist Mono Variable', size: 10 } },
      ticks: { color: MM_CHART.inkMuted, maxTicksLimit: 8, font: { family: 'Geist Mono Variable', size: 10 } },
    },
  },
  plugins: {
    legend: {
      display: true,
      position: 'top' as const,
      labels: {
        color: MM_CHART.inkSoft,
        usePointStyle: true,
        pointStyle: 'line',
        font: { family: 'Geist Variable', size: 11 },
      },
    },
    tooltip: {
      backgroundColor: MM_CHART.surfaceSoft,
      titleColor: MM_CHART.ink,
      bodyColor: MM_CHART.inkSoft,
      borderColor: MM_CHART.gridStrong,
      borderWidth: 1,
      titleFont: { family: 'Geist Mono Variable', size: 11 },
      bodyFont: { family: 'Geist Mono Variable', size: 10 },
      cornerRadius: 2,
      callbacks: {
        label: (context: any) => {
          const raw = context.dataset.rawPlayerName ?? context.dataset.label
          const display = context.dataset.label
          const snapshotIndex = context.dataIndex
          const performance = pinnedPerformance.value[raw]
          if (performance) {
            const point = performance.find((p: any) => p.snapshotIndex === snapshotIndex)
            if (point) return `${display}: ${point.score} · ${point.kills}K / ${point.deaths}D`
          }
          return `${display}: ${context.parsed.y}`
        },
      },
    },
  },
}))
</script>

<template>
  <section v-if="pinnedPlayers.size > 0" class="mm-pinned">
    <header class="mm-pinned__head">
      <div class="mm-eyebrow mm-eyebrow--strong">Pinned players · performance</div>
      <div class="mm-pinned__badges">
        <button
          v-for="playerName in Array.from(pinnedPlayers)"
          :key="playerName"
          type="button"
          class="mm-pinned__badge"
          :title="`Unpin ${$pn(playerName)}`"
          @click="$emit('unpin-player', playerName)"
        >
          {{ $pn(playerName) }} <span class="mm-pinned__badge-close">×</span>
        </button>
        <button
          v-if="pinnedPlayers.size > 1"
          type="button"
          class="mm-btn mm-btn--inline"
          @click="$emit('clear-all-pinned')"
        >Clear all</button>
      </div>
    </header>

    <div v-if="chartData.datasets.length > 0" class="mm-pinned__chart">
      <Line :data="chartData" :options="chartOptions" />
    </div>
  </section>
</template>

<style scoped>
.mm-pinned {
  margin: 14px 0;
  padding: 16px 18px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  background: var(--mm-bg);
}

.mm-pinned__head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.mm-pinned__badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.mm-pinned__badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--mm-highlight);
  color: var(--mm-ink);
  border: 1px solid var(--mm-accent);
  border-radius: 2px;
  padding: 3px 8px;
  font-family: var(--mm-font-display);
  font-size: 12px;
  cursor: pointer;
}

.mm-pinned__badge:hover {
  background: var(--mm-accent);
  color: var(--mm-bg);
}

.mm-pinned__badge-close {
  font-family: var(--mm-font-mono);
  font-size: 12px;
  opacity: 0.7;
}

.mm-pinned__chart {
  height: 220px;
  position: relative;
}

@media (max-width: 720px) {
  .mm-pinned__chart { height: 160px; }
}
</style>
