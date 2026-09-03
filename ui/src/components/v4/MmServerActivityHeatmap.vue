<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import {
  fetchServerWeeklyPattern,
  type ServerWeeklyPatternResponse,
  type ServerWeeklyPatternSlot,
} from '@/services/serverDetailsService'
import {
  fetchServerPlayerTrend,
  type PlayerTrendPoint,
} from '@/services/playerTrendService'

const props = defineProps<{
  serverGuid: string
  serverName?: string
}>()

const emit = defineEmits<{
  summary: [payload: { peak: number; avg: number }]
}>()

export type OverlayMode = 'activity' | 'momentum' | 'ceiling'

const loading = ref(true)
const error = ref<string | null>(null)
const patternData = ref<ServerWeeklyPatternResponse | null>(null)
const trendPoints = ref<PlayerTrendPoint[]>([])
const useLocalTime = ref(true)

// Overlay controls
const activeOverlayMode = ref<OverlayMode>('activity')
const showTrendWave = ref(true)
const showMicroVectors = ref(false)
const selectedDay = ref<number | null>(null)
const hoveredHour = ref<number | null>(null)
const selectedSlot = ref<{
  displayDay: number
  displayHour: number
  slot?: ServerWeeklyPatternSlot
  trend?: SlotTrendInfo
} | null>(null)

export interface SlotTrendInfo {
  recentAvg: number
  baselineAvg: number
  pctChange: number
  momentumStatus: 'surging' | 'cooling' | 'steady'
  sparkPoints: number[]
  sampleCount: number
}

const tooltip = ref<{
  x: number
  y: number
  dayName: string
  hourRange: string
  avgPlayers: number
  maxPlayers: number
  dataPoints: number
  trend?: SlotTrendInfo
} | null>(null)

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dayFullNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const slotMap = computed(() => {
  if (!patternData.value) return new Map<string, ServerWeeklyPatternSlot>()
  const map = new Map<string, ServerWeeklyPatternSlot>()
  patternData.value.slots.forEach(slot => {
    map.set(`${slot.dayOfWeek}-${slot.hourOfDay}`, slot)
  })
  return map
})

function localToUtcDayHour(localDay: number, localHour: number): { utcDay: number; utcHour: number } {
  const today = new Date()
  const offsetDays = localDay - today.getDay()
  const local = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offsetDays, localHour, 0, 0)
  return { utcDay: local.getUTCDay(), utcHour: local.getUTCHours() }
}

function utcToLocalDayHour(utcDay: number, utcHour: number): { localDay: number; localHour: number } {
  const today = new Date()
  const offsetDays = utcDay - today.getUTCDay()
  const utc = new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() + offsetDays,
    utcHour,
    0,
    0,
  ))
  return { localDay: utc.getDay(), localHour: utc.getHours() }
}

const maxAvgPlayers = computed(() => {
  if (!patternData.value || patternData.value.slots.length === 0) return 1
  return Math.max(...patternData.value.slots.map(s => s.avgPlayers), 1)
})

const maxPeakPlayers = computed(() => {
  if (!patternData.value || patternData.value.slots.length === 0) return 1
  return Math.max(...patternData.value.slots.map(s => s.maxPlayers), 1)
})

const overallPeak = computed(() => {
  const trendMax = trendPoints.value.length ? Math.max(...trendPoints.value.map(p => p.peakPlayers)) : 0
  const slotMax = maxPeakPlayers.value
  return Math.max(trendMax, slotMax, 0)
})

const overallAvg = computed(() => {
  if (patternData.value && patternData.value.overallAvgPlayers > 0) {
    return patternData.value.overallAvgPlayers
  }
  if (trendPoints.value.length > 0) {
    const sum = trendPoints.value.reduce((acc, p) => acc + p.avgPlayers, 0)
    return Math.round((sum / trendPoints.value.length) * 10) / 10
  }
  return 0
})

const overallTrendPct = computed(() => {
  if (!trendPoints.value.length) return 0
  const nowMs = Date.now()
  const recent = trendPoints.value.filter(p => nowMs - new Date(p.timestamp).getTime() <= 14 * 86_400_000)
  const baseline = trendPoints.value.filter(p => {
    const age = nowMs - new Date(p.timestamp).getTime()
    return age > 14 * 86_400_000 && age <= 45 * 86_400_000
  })
  const rAvg = recent.length ? recent.reduce((sum, p) => sum + p.avgPlayers, 0) / recent.length : 0
  const bAvg = baseline.length ? baseline.reduce((sum, p) => sum + p.avgPlayers, 0) / baseline.length : 0
  if (bAvg > 0) return Math.round(((rAvg - bAvg) / bAvg) * 100)
  if (rAvg > 0) return 100
  return 0
})

watch([overallPeak, overallAvg], ([peak, avg]) => {
  if (peak > 0) {
    emit('summary', { peak, avg })
  }
}, { immediate: true })

// Calculate trend momentum per (displayDay, displayHour) slot based on 60d points
const slotTrendMap = computed(() => {
  const map = new Map<string, SlotTrendInfo>()
  if (!trendPoints.value || trendPoints.value.length === 0) return map

  const nowMs = Date.now()
  const ms14d = 14 * 86_400_000
  const ms45d = 45 * 86_400_000

  // Group points by slot key
  const slotGroups = new Map<string, { t: number; avg: number }[]>()

  for (const p of trendPoints.value) {
    const d = new Date(p.timestamp)
    const t = d.getTime()
    if (Number.isNaN(t)) continue

    const day = useLocalTime.value ? d.getDay() : d.getUTCDay()
    const hour = useLocalTime.value ? d.getHours() : d.getUTCHours()
    const key = `${day}-${hour}`

    let group = slotGroups.get(key)
    if (!group) {
      group = []
      slotGroups.set(key, group)
    }
    group.push({ t, avg: p.avgPlayers })
  }

  slotGroups.forEach((points, key) => {
    points.sort((a, b) => a.t - b.t)

    const recent = points.filter(pt => nowMs - pt.t <= ms14d).map(pt => pt.avg)
    const baseline = points.filter(pt => nowMs - pt.t > ms14d && nowMs - pt.t <= ms45d).map(pt => pt.avg)

    const recentAvg = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0
    const baselineAvg = baseline.length > 0 ? baseline.reduce((a, b) => a + b, 0) / baseline.length : 0

    let pctChange = 0
    if (baselineAvg > 0) {
      pctChange = Math.round(((recentAvg - baselineAvg) / baselineAvg) * 100)
    } else if (recentAvg > 0) {
      pctChange = 100
    }

    let momentumStatus: 'surging' | 'cooling' | 'steady' = 'steady'
    if (pctChange >= 15 && recentAvg >= 1) {
      momentumStatus = 'surging'
    } else if (pctChange <= -15 && (baselineAvg >= 1 || recentAvg < baselineAvg)) {
      momentumStatus = 'cooling'
    }

    // Generate 4-point sparkline (weekly bins over past 4 weeks)
    const sparkPoints: number[] = []
    for (let w = 3; w >= 0; w--) {
      const wStart = nowMs - (w + 1) * 7 * 86_400_000
      const wEnd = nowMs - w * 7 * 86_400_000
      const wPts = points.filter(pt => pt.t >= wStart && pt.t < wEnd).map(pt => pt.avg)
      sparkPoints.push(wPts.length > 0 ? Math.round((wPts.reduce((a, b) => a + b, 0) / wPts.length) * 10) / 10 : 0)
    }

    map.set(key, {
      recentAvg: Math.round(recentAvg * 10) / 10,
      baselineAvg: Math.round(baselineAvg * 10) / 10,
      pctChange,
      momentumStatus,
      sparkPoints,
      sampleCount: points.length,
    })
  })

  return map
})

const primeTimeBadge = computed(() => {
  if (!patternData.value || patternData.value.peakDayOfWeek == null || patternData.value.peakHourOfDay == null) {
    return null
  }
  const { peakDayOfWeek, peakHourOfDay, peakAvgPlayers } = patternData.value
  if (peakAvgPlayers <= 0) return null

  if (useLocalTime.value) {
    const { localDay, localHour } = utcToLocalDayHour(peakDayOfWeek, peakHourOfDay)
    const day = dayNames[localDay]
    const hourStr = formatHourRange(localHour)
    return {
      day,
      time: hourStr,
      avg: peakAvgPlayers,
      tz: 'Local',
    }
  }

  return {
    day: dayNames[peakDayOfWeek],
    time: formatHourRange(peakHourOfDay),
    avg: peakAvgPlayers,
    tz: 'UTC',
  }
})

// Current slot for pulsing outline
const now = new Date()
const currentDay = computed(() => useLocalTime.value ? now.getDay() : now.getUTCDay())
const currentHour = computed(() => useLocalTime.value ? now.getHours() : now.getUTCHours())

function getSlotForDisplay(displayDay: number, displayHour: number): ServerWeeklyPatternSlot | undefined {
  if (useLocalTime.value) {
    const { utcDay, utcHour } = localToUtcDayHour(displayDay, displayHour)
    return slotMap.value.get(`${utcDay}-${utcHour}`)
  }
  return slotMap.value.get(`${displayDay}-${displayHour}`)
}

function getTrendForDisplay(displayDay: number, displayHour: number): SlotTrendInfo | undefined {
  return slotTrendMap.value.get(`${displayDay}-${displayHour}`)
}

function getCellStyle(displayDay: number, displayHour: number) {
  const slot = getSlotForDisplay(displayDay, displayHour)
  const trend = getTrendForDisplay(displayDay, displayHour)

  if (activeOverlayMode.value === 'momentum') {
    if (!slot || slot.avgPlayers <= 0) {
      return { backgroundColor: 'var(--mm-bg-mute)' }
    }
    if (trend) {
      if (trend.momentumStatus === 'surging') {
        const intensity = Math.min(1, 0.4 + (trend.pctChange / 100) * 0.6)
        return {
          backgroundColor: `rgba(125, 163, 76, ${intensity})`,
          boxShadow: 'inset 0 0 0 1px rgba(125, 163, 76, 0.4)',
        }
      }
      if (trend.momentumStatus === 'cooling') {
        const intensity = Math.min(1, 0.35 + Math.abs(trend.pctChange / 100) * 0.5)
        return {
          backgroundColor: `rgba(214, 90, 90, ${intensity})`,
          boxShadow: 'inset 0 0 0 1px rgba(214, 90, 90, 0.35)',
        }
      }
    }
    const intensity = Math.min(1, slot.avgPlayers / Math.max(maxAvgPlayers.value, 15))
    return { backgroundColor: `rgba(138, 138, 106, ${0.2 + intensity * 0.5})` }
  }

  if (activeOverlayMode.value === 'ceiling') {
    if (!slot || slot.maxPlayers <= 0) {
      return { backgroundColor: 'var(--mm-bg-mute)' }
    }
    const intensity = Math.min(1, slot.maxPlayers / Math.max(maxPeakPlayers.value, 20))
    let opacity: number
    if (intensity <= 0.2) opacity = 0.25
    else if (intensity <= 0.4) opacity = 0.48
    else if (intensity <= 0.6) opacity = 0.68
    else if (intensity <= 0.8) opacity = 0.86
    else opacity = 1.0
    return { backgroundColor: `rgba(201, 147, 59, ${opacity})` }
  }

  // Standard 'activity' mode
  if (!slot || slot.avgPlayers <= 0) {
    return { backgroundColor: 'var(--mm-bg-mute)' }
  }

  const intensity = Math.min(1, slot.avgPlayers / Math.max(maxAvgPlayers.value, 15))
  let opacity: number
  if (intensity <= 0.2) opacity = 0.22
  else if (intensity <= 0.4) opacity = 0.42
  else if (intensity <= 0.6) opacity = 0.62
  else if (intensity <= 0.8) opacity = 0.82
  else opacity = 1.0

  return { backgroundColor: `rgba(125, 136, 73, ${opacity})` }
}

function formatHourRange(hour: number) {
  const start = hour === 0 ? '12am' : hour <= 12 ? `${hour}am` : `${hour - 12}pm`
  const endHour = (hour + 1) % 24
  const end = endHour === 0 ? '12am' : endHour <= 12 ? `${endHour}am` : `${endHour - 12}pm`
  return `${start}–${end}`
}

function showTooltip(event: MouseEvent, displayDay: number, displayHour: number) {
  const slot = getSlotForDisplay(displayDay, displayHour)
  const trend = getTrendForDisplay(displayDay, displayHour)
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  hoveredHour.value = displayHour

  tooltip.value = {
    x: rect.left + rect.width / 2,
    y: rect.top - 8,
    dayName: dayNames[displayDay],
    hourRange: formatHourRange(displayHour),
    avgPlayers: slot?.avgPlayers ?? 0,
    maxPlayers: slot?.maxPlayers ?? 0,
    dataPoints: slot?.dataPoints ?? 0,
    trend,
  }
}

function hideTooltip() {
  tooltip.value = null
  hoveredHour.value = null
}

function onCellClick(displayDay: number, displayHour: number) {
  const slot = getSlotForDisplay(displayDay, displayHour)
  const trend = getTrendForDisplay(displayDay, displayHour)

  if (
    selectedSlot.value &&
    selectedSlot.value.displayDay === displayDay &&
    selectedSlot.value.displayHour === displayHour
  ) {
    selectedSlot.value = null
  } else {
    selectedSlot.value = { displayDay, displayHour, slot, trend }
    selectedDay.value = displayDay
  }
}

function toggleSelectDay(dayIdx: number) {
  if (selectedDay.value === dayIdx) {
    selectedDay.value = null
    selectedSlot.value = null
  } else {
    selectedDay.value = dayIdx
    let bestH = 0
    let bestAvg = -1
    for (let h = 0; h < 24; h++) {
      const s = getSlotForDisplay(dayIdx, h)
      if (s && s.avgPlayers > bestAvg) {
        bestAvg = s.avgPlayers
        bestH = h
      }
    }
    selectedSlot.value = {
      displayDay: dayIdx,
      displayHour: bestH,
      slot: getSlotForDisplay(dayIdx, bestH),
      trend: getTrendForDisplay(dayIdx, bestH),
    }
  }
}

// 24-Hour Chrono-Wave calculation
const waveData = computed(() => {
  const hours = Array.from({ length: 24 }, (_, i) => i)
  const allWeekAvgs = hours.map(h => {
    let sum = 0
    for (let d = 0; d < 7; d++) {
      sum += getSlotForDisplay(d, h)?.avgPlayers ?? 0
    }
    return Math.round((sum / 7) * 10) / 10
  })

  let primarySeries: number[]
  let ghostSeries: number[]
  let label = 'Weekly 24h Diurnal Average'

  if (selectedDay.value !== null) {
    const d = selectedDay.value
    primarySeries = hours.map(h => getSlotForDisplay(d, h)?.avgPlayers ?? 0)
    ghostSeries = allWeekAvgs
    label = `${dayFullNames[d]} Trajectory vs Weekly Average`
  } else {
    primarySeries = allWeekAvgs
    ghostSeries = hours.map(h => {
      let maxH = 0
      for (let d = 0; d < 7; d++) {
        const s = getSlotForDisplay(d, h)
        if (s && s.maxPlayers > maxH) maxH = s.maxPlayers
      }
      return maxH
    })
    label = 'All-Week Diurnal Wave (Ghost: Historical Peaks)'
  }

  const maxVal = Math.max(...primarySeries, ...ghostSeries, 10)
  const w = 1000
  const h = 54
  const paddingY = 6

  const getX = (i: number) => (i / 23) * w
  const getY = (val: number) => h - paddingY - (val / maxVal) * (h - 2 * paddingY)

  let lineD = ''
  for (let i = 0; i < 24; i++) {
    const x = getX(i)
    const y = getY(primarySeries[i])
    lineD += `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `
  }
  const areaD = `${lineD} L ${w} ${h} L 0 ${h} Z`

  let ghostD = ''
  for (let i = 0; i < 24; i++) {
    const x = getX(i)
    const y = getY(ghostSeries[i])
    ghostD += `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `
  }

  const peakIdx = primarySeries.indexOf(Math.max(...primarySeries))

  return {
    label,
    primarySeries,
    ghostSeries,
    maxVal,
    lineD,
    areaD,
    ghostD,
    peakIdx,
    peakVal: primarySeries[peakIdx] ?? 0,
    peakX: getX(peakIdx),
    peakY: getY(primarySeries[peakIdx] ?? 0),
  }
})

function generateSparkPath(points: number[], width = 120, height = 24): string {
  if (!points || points.length === 0) return ''
  const max = Math.max(...points, 1)
  const step = width / (points.length - 1 || 1)
  return points
    .map((v, i) => {
      const x = i * step
      const y = height - (v / max) * (height - 4) - 2
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

const loadData = async () => {
  if (!props.serverGuid) return
  loading.value = true
  error.value = null
  try {
    const [patRes, trRes] = await Promise.allSettled([
      fetchServerWeeklyPattern(props.serverGuid),
      fetchServerPlayerTrend(props.serverGuid, 60),
    ])

    if (patRes.status === 'fulfilled') {
      patternData.value = patRes.value
    } else {
      error.value = 'Weekly pattern data unavailable'
    }

    if (trRes.status === 'fulfilled') {
      trendPoints.value = trRes.value.points ?? []
    }
  } catch {
    error.value = 'Data unavailable'
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
watch(() => props.serverGuid, loadData)
</script>

<template>
  <div class="mm-server-heat" data-testid="golden-hour-heatmap">
    <!-- Header & Controls -->
    <div class="mm-server-heat__head">
      <div class="mm-server-heat__titles">
        <div class="mm-server-heat__title-row">
          <span class="mm-eyebrow mm-eyebrow--strong">Trends</span>
          <span v-if="trendPoints.length > 0" class="mm-tag mm-tag--trend">
            <span class="mm-status-dot mm-status-dot--synced" />
            60d Trend Synced
          </span>
        </div>
        <div v-if="primeTimeBadge" class="mm-server-heat__badge">
          <span class="mm-status-dot mm-status-dot--prime" />
          <span>Prime Time: <strong>{{ primeTimeBadge.day }} {{ primeTimeBadge.time }}</strong> (Avg ~{{ primeTimeBadge.avg }} players) [{{ primeTimeBadge.tz }}]</span>
        </div>
      </div>

      <!-- Tactical View Mode & Tooling Controls -->
      <div class="mm-server-heat__controls-cluster">
        <!-- View Mode Segmented Control -->
        <div class="mm-mode-selector" role="group" aria-label="Overlay mode selection">
          <button
            type="button"
            class="mm-mode-btn"
            :class="{ 'mm-mode-btn--active': activeOverlayMode === 'activity' }"
            @click="activeOverlayMode = 'activity'"
            title="Standard density heatmap"
          >
            Activity
          </button>
          <button
            type="button"
            class="mm-mode-btn mm-mode-btn--momentum"
            :class="{ 'mm-mode-btn--active': activeOverlayMode === 'momentum' }"
            @click="activeOverlayMode = 'momentum'"
            title="Highlight slots surging or cooling in the last 30 days"
          >
            Momentum ↗
          </button>
          <button
            type="button"
            class="mm-mode-btn"
            :class="{ 'mm-mode-btn--active': activeOverlayMode === 'ceiling' }"
            @click="activeOverlayMode = 'ceiling'"
            title="Max recorded player capacity per slot"
          >
            Ceiling
          </button>
        </div>

        <!-- Wave / Vector toggles -->
        <div class="mm-aux-toggles">
          <button
            type="button"
            class="mm-aux-btn"
            :class="{ 'mm-aux-btn--active': showTrendWave }"
            @click="showTrendWave = !showTrendWave"
            title="Toggle 24-hour diurnal trend wave"
          >
            ∿ Wave
          </button>
          <button
            type="button"
            class="mm-aux-btn"
            :class="{ 'mm-aux-btn--active': showMicroVectors }"
            @click="showMicroVectors = !showMicroVectors"
            title="Toggle micro trend arrows in cells"
          >
            ↗ Vectors
          </button>
        </div>

        <!-- Timezone Toggle -->
        <div class="mm-server-heat__tz-wrap">
          <button
            type="button"
            class="mm-server-heat__tz-toggle"
            :class="{ 'mm-server-heat__tz-toggle--active': useLocalTime }"
            @click="useLocalTime = true"
          >
            Local
          </button>
          <button
            type="button"
            class="mm-server-heat__tz-toggle"
            :class="{ 'mm-server-heat__tz-toggle--active': !useLocalTime }"
            @click="useLocalTime = false"
          >
            UTC
          </button>
        </div>
      </div>
    </div>

    <!-- Loading / Error States -->
    <div v-if="loading" class="mm-server-heat__state mm-meta-row">
      <span>Analyzing historical population patterns & 60-day trend telemetry…</span>
    </div>

    <div v-else-if="error || !patternData || patternData.slots.length === 0" class="mm-server-heat__state mm-meta-row mm-display__muted">
      <span>No historical hourly patterns available for this server yet.</span>
    </div>

    <div v-else class="mm-server-heat__grid-wrap">
      <!-- Server Population Telemetry Strip (Incorporated from Player Trend) -->
      <div class="mm-server-heat__telemetry" data-testid="trend-insights">
        <div class="mm-telemetry-card">
          <span class="mm-telemetry-card__k">Peak Attendance</span>
          <div class="mm-telemetry-card__v-row">
            <span class="mm-telemetry-card__v mm-telemetry-card__v--gold">
              {{ Math.round(overallPeak) }}
            </span>
            <span class="mm-telemetry-card__unit">players</span>
          </div>
          <span class="mm-telemetry-card__sub">
            {{ primeTimeBadge ? `${primeTimeBadge.day} ${primeTimeBadge.time}` : 'All-time peak' }}
          </span>
        </div>

        <div class="mm-telemetry-card">
          <span class="mm-telemetry-card__k">Hourly Average</span>
          <div class="mm-telemetry-card__v-row">
            <span class="mm-telemetry-card__v">
              {{ overallAvg.toFixed(1) }}
            </span>
            <span class="mm-telemetry-card__unit">players/hr</span>
          </div>
          <span class="mm-telemetry-card__sub">Across all sampled hours</span>
        </div>

        <div class="mm-telemetry-card">
          <span class="mm-telemetry-card__k">30-Day Momentum</span>
          <div class="mm-telemetry-card__v-row">
            <span
              class="mm-telemetry-card__v"
              :class="{
                'mm-telemetry-card__v--green': overallTrendPct >= 10,
                'mm-telemetry-card__v--red': overallTrendPct <= -10
              }"
            >
              {{ overallTrendPct > 0 ? `▲ +${overallTrendPct}%` : overallTrendPct < 0 ? `▼ ${overallTrendPct}%` : '● 0%' }}
            </span>
          </div>
          <span class="mm-telemetry-card__sub">
            {{ overallTrendPct >= 10 ? 'Net population growth' : overallTrendPct <= -10 ? 'Cooling attendance' : 'Stable server baseline' }}
          </span>
        </div>
      </div>

      <!-- 7x24 Heatmap Grid -->
      <div class="mm-server-heat__grid">
        <!-- Hour headers -->
        <div class="mm-server-heat__hours">
          <div class="mm-server-heat__corner-label">{{ useLocalTime ? 'LOC' : 'UTC' }}</div>
          <div
            v-for="h in 24"
            :key="h - 1"
            class="mm-server-heat__hour-label"
            :class="{ 'mm-server-heat__hour-label--hover': hoveredHour === (h - 1) }"
          >
            {{ (h - 1) % 3 === 0 ? (h - 1) : '' }}
          </div>
        </div>

        <!-- 7 Days -->
        <div
          v-for="(dayName, dayIdx) in dayNames"
          :key="dayIdx"
          class="mm-server-heat__row"
          :class="{ 'mm-server-heat__row--selected': selectedDay === dayIdx }"
        >
          <button
            type="button"
            class="mm-server-heat__day-btn"
            :class="{ 'mm-server-heat__day-btn--active': selectedDay === dayIdx }"
            @click="toggleSelectDay(dayIdx)"
            :title="`Click to focus ${dayFullNames[dayIdx]} trend trajectory`"
          >
            {{ dayName }}
          </button>
          <div
            v-for="hour in 24"
            :key="hour - 1"
            class="mm-server-heat__cell"
            :class="{
              'mm-server-heat__cell--current': dayIdx === currentDay && (hour - 1) === currentHour,
              'mm-server-heat__cell--col-hover': hoveredHour === (hour - 1),
              'mm-server-heat__cell--selected': selectedSlot?.displayDay === dayIdx && selectedSlot?.displayHour === (hour - 1)
            }"
            :style="getCellStyle(dayIdx, hour - 1)"
            @mouseenter="showTooltip($event, dayIdx, hour - 1)"
            @mouseleave="hideTooltip"
            @click="onCellClick(dayIdx, hour - 1)"
          >
            <!-- In-cell micro trend vector indicator -->
            <span
              v-if="(showMicroVectors || activeOverlayMode === 'momentum') && getTrendForDisplay(dayIdx, hour - 1)"
              class="mm-cell-vector"
              :class="`mm-cell-vector--${getTrendForDisplay(dayIdx, hour - 1)?.momentumStatus}`"
            >
              <template v-if="getTrendForDisplay(dayIdx, hour - 1)?.momentumStatus === 'surging'">▲</template>
              <template v-else-if="getTrendForDisplay(dayIdx, hour - 1)?.momentumStatus === 'cooling'">▼</template>
              <template v-else-if="getSlotForDisplay(dayIdx, hour - 1)?.avgPlayers">·</template>
            </span>
          </div>
        </div>
      </div>

      <!-- Chrono-Wave 24-Hour Diurnal Ribbon -->
      <div v-if="showTrendWave" class="mm-chrono-wave">
        <div class="mm-chrono-wave__label-col">
          <span class="mm-chrono-wave__tag">24h TREND</span>
        </div>
        <div class="mm-chrono-wave__chart-wrap">
          <div class="mm-chrono-wave__meta">
            <span>{{ waveData.label }}</span>
            <span v-if="selectedDay !== null" class="mm-chrono-wave__reset" @click="selectedDay = null">
              Reset to Weekly
            </span>
          </div>
          <svg
            class="mm-chrono-wave__svg"
            viewBox="0 0 1000 54"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="chronoWaveGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#7d8849" stop-opacity="0.45" />
                <stop offset="100%" stop-color="#7d8849" stop-opacity="0.02" />
              </linearGradient>
            </defs>

            <!-- Ghost baseline path -->
            <path
              :d="waveData.ghostD"
              fill="none"
              stroke="rgba(255, 255, 255, 0.15)"
              stroke-width="1.2"
              stroke-dasharray="3,3"
            />

            <!-- Primary diurnal area and curve -->
            <path
              :d="waveData.areaD"
              fill="url(#chronoWaveGrad)"
            />
            <path
              :d="waveData.lineD"
              fill="none"
              stroke="#b4c060"
              stroke-width="1.7"
            />

            <!-- Peak point marker -->
            <circle
              :cx="waveData.peakX"
              :cy="waveData.peakY"
              r="3.5"
              fill="#c9933b"
              stroke="#131313"
              stroke-width="1.5"
            />

            <!-- Scanline for hovered hour -->
            <line
              v-if="hoveredHour !== null"
              :x1="(hoveredHour / 23) * 1000"
              y1="0"
              :x2="(hoveredHour / 23) * 1000"
              y2="54"
              stroke="#b4c060"
              stroke-width="1.5"
              stroke-dasharray="2,2"
            />
          </svg>
        </div>
      </div>

      <!-- Slot Trend Inspector Flyout / HUD -->
      <transition name="mm-slide">
        <div v-if="selectedSlot" class="mm-slot-inspector">
          <div class="mm-slot-inspector__head">
            <div class="mm-slot-inspector__headline">
              <span class="mm-eyebrow mm-eyebrow--strong">
                {{ dayFullNames[selectedSlot.displayDay] }} · {{ formatHourRange(selectedSlot.displayHour) }}
              </span>
              <span
                v-if="selectedSlot.trend"
                class="mm-momentum-pill"
                :class="`mm-momentum-pill--${selectedSlot.trend.momentumStatus}`"
              >
                <template v-if="selectedSlot.trend.momentumStatus === 'surging'">
                  ▲ Surging ({{ selectedSlot.trend.pctChange > 0 ? `+${selectedSlot.trend.pctChange}%` : `${selectedSlot.trend.pctChange}%` }})
                </template>
                <template v-else-if="selectedSlot.trend.momentumStatus === 'cooling'">
                  ▼ Cooling ({{ selectedSlot.trend.pctChange }}%)
                </template>
                <template v-else>
                  ● Steady Momentum
                </template>
              </span>
            </div>
            <button
              type="button"
              class="mm-slot-inspector__close"
              @click="selectedSlot = null"
              aria-label="Close trend inspector"
            >
              ✕
            </button>
          </div>

          <div class="mm-slot-inspector__body">
            <!-- Metrics grid -->
            <div class="mm-slot-inspector__metrics">
              <div class="mm-metric-tile">
                <span class="mm-metric-tile__k">Recent 14d Avg</span>
                <span class="mm-metric-tile__v mm-metric-tile__v--highlight">
                  {{ selectedSlot.trend ? selectedSlot.trend.recentAvg : (selectedSlot.slot?.avgPlayers ?? 0) }}
                  <small>players</small>
                </span>
              </div>
              <div class="mm-metric-tile">
                <span class="mm-metric-tile__k">Historical Baseline</span>
                <span class="mm-metric-tile__v">
                  {{ selectedSlot.trend ? selectedSlot.trend.baselineAvg : (selectedSlot.slot?.avgPlayers ?? 0) }}
                  <small>players</small>
                </span>
              </div>
              <div class="mm-metric-tile">
                <span class="mm-metric-tile__k">All-Time Peak</span>
                <span class="mm-metric-tile__v mm-metric-tile__v--gold">
                  {{ selectedSlot.slot?.maxPlayers ?? 0 }}
                  <small>players</small>
                </span>
              </div>
              <div class="mm-metric-tile">
                <span class="mm-metric-tile__k">Sample Depth</span>
                <span class="mm-metric-tile__v">
                  {{ selectedSlot.slot?.dataPoints ?? 0 }}
                  <small>snapshots</small>
                </span>
              </div>
            </div>

            <!-- Attendance Sparkline progression -->
            <div v-if="selectedSlot.trend && selectedSlot.trend.sparkPoints.length > 0" class="mm-slot-inspector__sparkbox">
              <div class="mm-sparkbox__label">
                <span>4-Week Slot Progression:</span>
                <span class="mm-sparkbox__vals">
                  {{ selectedSlot.trend.sparkPoints.join(' → ') }} avg
                </span>
              </div>
              <svg class="mm-sparkbox__svg" viewBox="0 0 120 28">
                <path
                  :d="generateSparkPath(selectedSlot.trend.sparkPoints, 120, 24)"
                  fill="none"
                  stroke="#b4c060"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>

            <!-- Match Viability Recommendation -->
            <div
              class="mm-viability-callout"
              :class="{
                'mm-viability-callout--prime': (selectedSlot.slot?.avgPlayers ?? 0) >= 20,
                'mm-viability-callout--skirmish': (selectedSlot.slot?.avgPlayers ?? 0) >= 8 && (selectedSlot.slot?.avgPlayers ?? 0) < 20,
                'mm-viability-callout--quiet': (selectedSlot.slot?.avgPlayers ?? 0) < 8
              }"
            >
              <div class="mm-viability-callout__bar" />
              <div class="mm-viability-callout__text">
                <div class="mm-viability-callout__badge-row">
                  <span class="mm-status-dot" />
                  <span class="mm-viability-callout__title">
                    <template v-if="(selectedSlot.slot?.avgPlayers ?? 0) >= 20">Prime Time Window</template>
                    <template v-else-if="(selectedSlot.slot?.avgPlayers ?? 0) >= 8">Active Skirmish Window</template>
                    <template v-else>Seeding / Quiet Window</template>
                  </span>
                </div>
                <span class="mm-viability-callout__desc">
                  <template v-if="(selectedSlot.slot?.avgPlayers ?? 0) >= 20">
                    High likelihood of full, competitive rounds. Player momentum is {{ selectedSlot.trend?.momentumStatus || 'steady' }}.
                  </template>
                  <template v-else-if="(selectedSlot.slot?.avgPlayers ?? 0) >= 8">
                    Moderate squad battles regularly form during this hour.
                  </template>
                  <template v-else>
                    Low population baseline. Best used for warmup or community server seeding.
                  </template>
                </span>
              </div>
            </div>
          </div>
        </div>
      </transition>

      <!-- Legend & stats row -->
      <div class="mm-server-heat__foot">
        <div class="mm-server-heat__legend">
          <template v-if="activeOverlayMode === 'activity'">
            <span class="mm-server-heat__legend-label">Activity:</span>
            <span class="mm-server-heat__legend-swatch" style="background: var(--mm-bg-mute)" title="Quiet" />
            <span class="mm-server-heat__legend-swatch" style="background: rgba(125, 136, 73, 0.25)" />
            <span class="mm-server-heat__legend-swatch" style="background: rgba(125, 136, 73, 0.55)" />
            <span class="mm-server-heat__legend-swatch" style="background: rgba(125, 136, 73, 0.85)" />
            <span class="mm-server-heat__legend-swatch" style="background: rgba(125, 136, 73, 1.0)" title="Peak" />
            <span class="mm-server-heat__legend-label">Peak</span>
          </template>

          <template v-else-if="activeOverlayMode === 'momentum'">
            <span class="mm-server-heat__legend-label">Momentum:</span>
            <span class="mm-server-heat__legend-swatch" style="background: rgba(214, 90, 90, 0.8)" title="Cooling (<= -15%)" />
            <span class="mm-server-heat__legend-label">Cooling</span>
            <span class="mm-server-heat__legend-swatch" style="background: rgba(138, 138, 106, 0.4)" title="Steady (-14% to +14%)" />
            <span class="mm-server-heat__legend-label">Steady</span>
            <span class="mm-server-heat__legend-swatch" style="background: rgba(125, 163, 76, 0.9)" title="Surging (>= +15%)" />
            <span class="mm-server-heat__legend-label">Surging</span>
          </template>

          <template v-else-if="activeOverlayMode === 'ceiling'">
            <span class="mm-server-heat__legend-label">Max Record:</span>
            <span class="mm-server-heat__legend-swatch" style="background: rgba(201, 147, 59, 0.25)" />
            <span class="mm-server-heat__legend-swatch" style="background: rgba(201, 147, 59, 0.55)" />
            <span class="mm-server-heat__legend-swatch" style="background: rgba(201, 147, 59, 0.85)" />
            <span class="mm-server-heat__legend-swatch" style="background: rgba(201, 147, 59, 1.0)" title="Record" />
            <span class="mm-server-heat__legend-label">High Watermark</span>
          </template>
        </div>

        <div class="mm-server-heat__meta">
          <span v-if="patternData.overallAvgPlayers > 0">Average ~{{ patternData.overallAvgPlayers }} players/hr</span>
          <span>·</span>
          <span>{{ patternData.totalDataPoints.toLocaleString() }} samples</span>
          <span>·</span>
          <span class="mm-server-heat__tip">Tip: Click day or cell for deep trend inspector</span>
        </div>
      </div>
    </div>

    <!-- Tooltip -->
    <Teleport to="body">
      <div
        v-if="tooltip"
        class="mm mm-server-heat__tooltip"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      >
        <div class="mm-server-heat__tooltip-title">{{ tooltip.dayName }} · {{ tooltip.hourRange }}</div>
        <div class="mm-server-heat__tooltip-line">
          Average: <strong>{{ tooltip.avgPlayers }}</strong> players
        </div>
        <div v-if="tooltip.maxPlayers > 0" class="mm-server-heat__tooltip-sub">
          Historical peak: {{ tooltip.maxPlayers }} players ({{ tooltip.dataPoints }} samples)
        </div>
        <div v-if="tooltip.trend" class="mm-server-heat__tooltip-trend">
          <span
            class="mm-tooltip-badge"
            :class="`mm-tooltip-badge--${tooltip.trend.momentumStatus}`"
          >
            <template v-if="tooltip.trend.momentumStatus === 'surging'">▲ Surging +{{ tooltip.trend.pctChange }}%</template>
            <template v-else-if="tooltip.trend.momentumStatus === 'cooling'">▼ Cooling {{ tooltip.trend.pctChange }}%</template>
            <template v-else>● Steady</template>
          </span>
          <span class="mm-tooltip-note">14d vs baseline</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.mm-server-heat {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--mm-surface);
  border: 1px solid var(--mm-line-subtle);
  border-radius: 4px;
  padding: 16px;
}

.mm-server-heat__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.mm-server-heat__titles {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mm-server-heat__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mm-tag--trend {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  border-radius: 2px;
  background: rgba(125, 163, 76, 0.15);
  color: #b4c060;
  border: 1px solid rgba(125, 163, 76, 0.3);
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.mm-status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mm-ink-muted);
  flex-shrink: 0;
}

.mm-status-dot--synced {
  background: #b4c060;
  box-shadow: 0 0 5px rgba(180, 192, 96, 0.6);
}

.mm-status-dot--prime {
  background: #c9933b;
  box-shadow: 0 0 6px rgba(201, 147, 59, 0.7);
}

.mm-server-heat__badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink);
  background: rgba(125, 136, 73, 0.15);
  border: 1px solid rgba(125, 136, 73, 0.35);
  border-radius: 3px;
  padding: 3px 8px;
  width: fit-content;
}

.mm-server-heat__flame {
  color: #c9933b;
}

.mm-server-heat__controls-cluster {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* Mode Selector */
.mm-mode-selector {
  display: inline-flex;
  align-items: center;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-line);
  border-radius: 3px;
  overflow: hidden;
}

.mm-mode-btn {
  background: transparent;
  border: none;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  padding: 4px 10px;
  color: var(--mm-ink-muted);
  cursor: pointer;
  transition: all 0.12s ease;
  white-space: nowrap;
}

.mm-mode-btn:not(:last-child) {
  border-right: 1px solid var(--mm-line-subtle);
}

.mm-mode-btn:hover {
  color: var(--mm-ink);
}

.mm-mode-btn--active {
  background: var(--mm-ink);
  color: var(--mm-bg) !important;
  font-weight: 600;
}

.mm-mode-btn--momentum.mm-mode-btn--active {
  background: #7da34c;
  color: #131313 !important;
}

/* Aux toggles */
.mm-aux-toggles {
  display: inline-flex;
  gap: 4px;
}

.mm-aux-btn {
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-line);
  border-radius: 3px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  padding: 4px 8px;
  color: var(--mm-ink-muted);
  cursor: pointer;
  transition: all 0.12s ease;
}

.mm-aux-btn:hover {
  color: var(--mm-ink);
  border-color: var(--mm-ink-faint);
}

.mm-aux-btn--active {
  border-color: var(--mm-accent);
  color: var(--mm-ink);
  background: rgba(125, 136, 73, 0.18);
}

/* Timezone toggle */
.mm-server-heat__tz-wrap {
  display: flex;
  align-items: center;
  border: 1px solid var(--mm-line);
  border-radius: 3px;
  overflow: hidden;
}

.mm-server-heat__tz-toggle {
  background: transparent;
  border: none;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  padding: 4px 8px;
  color: var(--mm-ink-muted);
  cursor: pointer;
  transition: all 0.12s ease;
}

.mm-server-heat__tz-toggle--active {
  background: var(--mm-ink);
  color: var(--mm-bg);
  font-weight: 600;
}

.mm-server-heat__state {
  padding: 24px 0;
  text-align: center;
}

.mm-server-heat__grid-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Telemetry Strip (Incorporated from Player Trend) */
.mm-server-heat__telemetry {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 8px;
}

.mm-telemetry-card {
  display: flex;
  flex-direction: column;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-line-subtle);
  border-radius: 3px;
  padding: 8px 12px;
  gap: 2px;
}

.mm-telemetry-card__k {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.05em;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
}

.mm-telemetry-card__v-row {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.mm-telemetry-card__v {
  font-family: var(--mm-font-mono);
  font-size: 18px;
  font-weight: 700;
  color: var(--mm-ink);
  line-height: 1.2;
}

.mm-telemetry-card__v--gold {
  color: #c9933b;
}

.mm-telemetry-card__v--green {
  color: #a8e063;
}

.mm-telemetry-card__v--red {
  color: #ff7675;
}

.mm-telemetry-card__unit {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-muted);
}

.mm-telemetry-card__sub {
  font-size: 10px;
  color: var(--mm-ink-soft);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mm-server-heat__grid {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.mm-server-heat__hours,
.mm-server-heat__row {
  display: grid;
  grid-template-columns: 38px repeat(24, 1fr);
  gap: 2px;
  align-items: center;
  min-width: 560px;
}

.mm-server-heat__corner-label,
.mm-server-heat__hour-label {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
  text-align: center;
  transition: color 0.1s ease;
}

.mm-server-heat__hour-label--hover {
  color: #b4c060;
  font-weight: 700;
}

.mm-server-heat__day-btn {
  background: transparent;
  border: none;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  text-align: right;
  padding-right: 6px;
  cursor: pointer;
  transition: color 0.12s ease;
}

.mm-server-heat__day-btn:hover {
  color: var(--mm-ink);
}

.mm-server-heat__day-btn--active {
  color: #b4c060;
  font-weight: 700;
}

.mm-server-heat__row--selected {
  outline: 1px dashed rgba(180, 192, 96, 0.4);
  outline-offset: 1px;
  border-radius: 2px;
}

.mm-server-heat__cell {
  position: relative;
  aspect-ratio: 1 / 1;
  min-height: 16px;
  border-radius: 1px;
  cursor: pointer;
  transition: outline 0.12s ease, transform 0.1s ease;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mm-server-heat__cell:hover {
  outline: 1.5px solid var(--mm-accent);
  outline-offset: -1px;
  transform: scale(1.18);
  z-index: 4;
}

.mm-server-heat__cell--current {
  outline: 1.5px solid #c9933b;
  outline-offset: -1px;
}

.mm-server-heat__cell--col-hover {
  filter: brightness(1.15);
}

.mm-server-heat__cell--selected {
  outline: 2px solid #b4c060 !important;
  outline-offset: -1px;
  z-index: 3;
}

.mm-cell-vector {
  font-size: 8px;
  line-height: 1;
  pointer-events: none;
  font-weight: 700;
}

.mm-cell-vector--surging {
  color: #a8e063;
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.8);
}

.mm-cell-vector--cooling {
  color: #ff7675;
  text-shadow: 0 0 4px rgba(0, 0, 0, 0.8);
}

.mm-cell-vector--steady {
  color: rgba(255, 255, 255, 0.4);
}

/* 24h Chrono-Wave Ribbon */
.mm-chrono-wave {
  display: grid;
  grid-template-columns: 38px 1fr;
  gap: 2px;
  align-items: center;
  min-width: 560px;
  border-top: 1px solid var(--mm-line-subtle);
  padding-top: 6px;
}

.mm-chrono-wave__label-col {
  display: flex;
  justify-content: flex-end;
  padding-right: 6px;
}

.mm-chrono-wave__tag {
  font-family: var(--mm-font-mono);
  font-size: 8.5px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
  writing-mode: vertical-lr;
  transform: rotate(180deg);
  text-align: center;
}

.mm-chrono-wave__chart-wrap {
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: relative;
}

.mm-chrono-wave__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  color: var(--mm-ink-muted);
}

.mm-chrono-wave__reset {
  color: #b4c060;
  cursor: pointer;
  text-decoration: underline;
}

.mm-chrono-wave__svg {
  width: 100%;
  height: 48px;
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-line-subtle);
  border-radius: 2px;
}

/* Slot Inspector Drawer */
.mm-slot-inspector {
  background: var(--mm-bg-soft);
  border: 1px solid var(--mm-line);
  border-left: 3px solid #b4c060;
  border-radius: 3px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mm-slot-inspector__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mm-slot-inspector__headline {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.mm-momentum-pill {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.05em;
  padding: 2px 7px;
  border-radius: 2px;
  font-weight: 600;
}

.mm-momentum-pill--surging {
  background: rgba(125, 163, 76, 0.2);
  color: #b4c060;
  border: 1px solid rgba(125, 163, 76, 0.4);
}

.mm-momentum-pill--cooling {
  background: rgba(214, 90, 90, 0.2);
  color: #d65a5a;
  border: 1px solid rgba(214, 90, 90, 0.4);
}

.mm-momentum-pill--steady {
  background: rgba(255, 255, 255, 0.08);
  color: var(--mm-ink-muted);
  border: 1px solid var(--mm-line-subtle);
}

.mm-slot-inspector__close {
  background: transparent;
  border: none;
  color: var(--mm-ink-muted);
  cursor: pointer;
  font-size: 13px;
  padding: 2px 6px;
  border-radius: 2px;
}

.mm-slot-inspector__close:hover {
  color: var(--mm-ink);
  background: rgba(255, 255, 255, 0.1);
}

.mm-slot-inspector__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mm-slot-inspector__metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 8px;
}

.mm-metric-tile {
  display: flex;
  flex-direction: column;
  background: var(--mm-surface);
  border: 1px solid var(--mm-line-subtle);
  border-radius: 3px;
  padding: 6px 10px;
}

.mm-metric-tile__k {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  color: var(--mm-ink-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.mm-metric-tile__v {
  font-family: var(--mm-font-mono);
  font-size: 16px;
  font-weight: 700;
  color: var(--mm-ink);
}

.mm-metric-tile__v small {
  font-size: 10px;
  font-weight: 400;
  color: var(--mm-ink-muted);
  margin-left: 2px;
}

.mm-metric-tile__v--highlight {
  color: #b4c060;
}

.mm-metric-tile__v--gold {
  color: #c9933b;
}

.mm-slot-inspector__sparkbox {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--mm-surface);
  border: 1px solid var(--mm-line-subtle);
  border-radius: 3px;
  padding: 6px 12px;
  gap: 12px;
  flex-wrap: wrap;
}

.mm-sparkbox__label {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-muted);
  display: flex;
  align-items: center;
  gap: 6px;
}

.mm-sparkbox__vals {
  color: var(--mm-ink);
  font-weight: 600;
}

.mm-sparkbox__svg {
  width: 120px;
  height: 24px;
}

.mm-viability-callout {
  display: flex;
  align-items: stretch;
  gap: 12px;
  background: var(--mm-surface);
  border: 1px solid var(--mm-line-subtle);
  border-radius: 3px;
  padding: 10px 14px;
  transition: all 0.15s ease;
}

.mm-viability-callout--prime {
  background: rgba(201, 147, 59, 0.08);
  border-color: rgba(201, 147, 59, 0.35);
}

.mm-viability-callout--prime .mm-viability-callout__bar {
  background: #c9933b;
  box-shadow: 0 0 8px rgba(201, 147, 59, 0.5);
}

.mm-viability-callout--prime .mm-status-dot {
  background: #c9933b;
  box-shadow: 0 0 6px rgba(201, 147, 59, 0.8);
}

.mm-viability-callout--prime .mm-viability-callout__title {
  color: #c9933b;
}

.mm-viability-callout--skirmish {
  background: rgba(125, 163, 76, 0.08);
  border-color: rgba(125, 163, 76, 0.35);
}

.mm-viability-callout--skirmish .mm-viability-callout__bar {
  background: #7da34c;
  box-shadow: 0 0 8px rgba(125, 163, 76, 0.5);
}

.mm-viability-callout--skirmish .mm-status-dot {
  background: #7da34c;
  box-shadow: 0 0 6px rgba(125, 163, 76, 0.8);
}

.mm-viability-callout--skirmish .mm-viability-callout__title {
  color: #b4c060;
}

.mm-viability-callout--quiet {
  background: rgba(255, 255, 255, 0.02);
  border-color: var(--mm-line-subtle);
}

.mm-viability-callout--quiet .mm-viability-callout__bar {
  background: #555555;
}

.mm-viability-callout--quiet .mm-status-dot {
  background: #666666;
}

.mm-viability-callout--quiet .mm-viability-callout__title {
  color: var(--mm-ink-muted);
}

.mm-viability-callout__bar {
  width: 3px;
  border-radius: 2px;
  flex-shrink: 0;
}

.mm-viability-callout__text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mm-viability-callout__badge-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mm-viability-callout__title {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.mm-viability-callout__desc {
  color: var(--mm-ink-soft);
  font-size: 11px;
  line-height: 1.4;
}

/* Legend & Foot */
.mm-server-heat__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding-top: 4px;
  border-top: 1px solid var(--mm-line-subtle);
}

.mm-server-heat__legend {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mm-server-heat__legend-label {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  color: var(--mm-ink-muted);
}

.mm-server-heat__legend-swatch {
  width: 11px;
  height: 11px;
  border-radius: 1px;
}

.mm-server-heat__meta {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-muted);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.mm-server-heat__tip {
  color: #b4c060;
}

/* Tooltip */
.mm-server-heat__tooltip {
  position: fixed;
  transform: translate(-50%, -100%);
  pointer-events: none;
  background: #181818 !important;
  color: #ffffff !important;
  border: 1px solid #444444;
  padding: 8px 12px;
  border-radius: 4px;
  font-family: var(--mm-font-mono, monospace);
  font-size: 11px;
  letter-spacing: 0.03em;
  z-index: 99999;
  white-space: nowrap;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.75), 0 2px 6px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  gap: 3px;
  opacity: 1 !important;
}

.mm-server-heat__tooltip-title {
  font-weight: 700;
  color: #ffffff;
  font-size: 11.5px;
}

.mm-server-heat__tooltip-line {
  color: #d1d1d1;
}

.mm-server-heat__tooltip-line strong {
  color: #b4c060;
  font-weight: 700;
}

.mm-server-heat__tooltip-sub {
  font-size: 9.5px;
  color: #999999;
}

.mm-server-heat__tooltip-trend {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
}

.mm-tooltip-badge {
  font-size: 9.5px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 2px;
}

.mm-tooltip-badge--surging {
  background: rgba(125, 163, 76, 0.28);
  color: #a8e063;
  border: 1px solid rgba(125, 163, 76, 0.5);
}

.mm-tooltip-badge--cooling {
  background: rgba(214, 90, 90, 0.28);
  color: #ff7675;
  border: 1px solid rgba(214, 90, 90, 0.5);
}

.mm-tooltip-badge--steady {
  background: rgba(255, 255, 255, 0.12);
  color: #d1d1d1;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.mm-tooltip-note {
  font-size: 9px;
  color: #888888;
}

.mm-slide-enter-active,
.mm-slide-leave-active {
  transition: all 0.2s ease;
}

.mm-slide-enter-from,
.mm-slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
