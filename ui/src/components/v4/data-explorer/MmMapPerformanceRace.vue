<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import * as d3 from 'd3'
import { fetchMapPerformanceTimeline } from '@/services/playerStatsApi'
import type { MapPerformanceTimelineResponse, MapTimelineMonth } from '@/types/playerStatsTypes'
import { resolveMapArt } from '@/utils/bf1942MapArt'
import { getMapTheater } from '@/composables/useMapTheater'
import { formatPlayTime } from '@/utils/timeUtils'
import { kdClass } from '@/views/v4/mmTokens'

const props = defineProps<{
  playerName: string
  game?: string
}>()

const emit = defineEmits<{
  navigateToMap: [mapName: string]
}>()

// Same theater identity palette used across the parent Maps tab, so a band
// in this river reads as the same "faction" as its map card above.
const THEATER_COLORS: Record<string, string> = {
  'Pacific': '#4a8bad',
  'North Africa': '#c5a23a',
  'Eastern Front': '#b84545',
  'Western Europe': '#7d8849',
  'Mediterranean': '#38989b',
  'Secret Weapons': '#8a65a3',
  'Desert Combat': '#d46f2d',
  'Other': '#6b6b6b',
}

type Metric = 'score' | 'kills' | 'playTimeMinutes'
const METRICS: { value: Metric; label: string }[] = [
  { value: 'score', label: 'Score' },
  { value: 'kills', label: 'Kills' },
  { value: 'playTimeMinutes', label: 'Combat Time' },
]

const WINDOWS = [6, 12, 24] as const

const loading = ref(true)
const error = ref<string | null>(null)
const timelineData = ref<MapPerformanceTimelineResponse | null>(null)
const metric = ref<Metric>('score')
const monthsWindow = ref<(typeof WINDOWS)[number]>(12)
const hoveredMapKey = ref<string | null>(null)
const hoveredMonthIndex = ref<number | null>(null)

const containerRef = ref<HTMLDivElement | null>(null)
const svgElement = ref<SVGSVGElement | null>(null)
const width = ref(760)
const height = ref(340)
let resizeObserver: ResizeObserver | null = null

const OTHER_KEY = '__other__'
const MAX_BANDS = 7

interface BandMonthValue {
  score: number
  kills: number
  deaths: number
  sessions: number
  playTimeMinutes: number
}

interface Band {
  key: string
  mapName: string | null // null for the "Other" rollup
  displayName: string
  color: string
  total: number
  values: BandMonthValue[] // one entry per month, aligned to timelineData.months
}

const displayNameFor = (mapName: string): string => resolveMapArt(mapName)?.displayName || mapName

function baseTheaterColor(mapName: string): string {
  const theater = getMapTheater(mapName, props.game)
  return THEATER_COLORS[theater?.theaterCategory || 'Other'] || THEATER_COLORS['Other']
}

const metricValue = (v: BandMonthValue): number => v[metric.value]

const emptyMonthValue = (): BandMonthValue => ({ score: 0, kills: 0, deaths: 0, sessions: 0, playTimeMinutes: 0 })

// --- Build bands: fixed set of top-N maps (by the active metric, summed across
// the whole window) plus an "Other" rollup. The set only changes when the
// metric or window changes -- never per month -- so nothing reorders or
// pops in/out while scanning across time. ---
const bands = computed<Band[]>(() => {
  const months = timelineData.value?.months || []
  if (months.length === 0) return []

  const totals = new Map<string, number>()
  for (const m of months) {
    for (const e of m.maps) {
      const val = metric.value === 'score' ? e.score : metric.value === 'kills' ? e.kills : e.playTimeMinutes
      totals.set(e.mapName, (totals.get(e.mapName) || 0) + val)
    }
  }

  const topMapNames = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_BANDS)
    .map(([name]) => name)
  const topSet = new Set(topMapNames)
  const hasOther = totals.size > topMapNames.length

  const colorUsage = new Map<string, number>()
  const colorFor = (mapName: string): string => {
    const base = baseTheaterColor(mapName)
    const uses = colorUsage.get(base) || 0
    colorUsage.set(base, uses + 1)
    if (uses === 0) return base
    // Same theater as an earlier band -- nudge lightness so bands stay
    // distinguishable while keeping the family relationship visible.
    const lifted = d3.color(base)?.brighter(uses * 0.65)
    return lifted ? lifted.formatHex() : base
  }

  const bandList: Band[] = topMapNames.map(mapName => ({
    key: mapName,
    mapName,
    displayName: displayNameFor(mapName),
    color: colorFor(mapName),
    total: totals.get(mapName) || 0,
    values: months.map(() => emptyMonthValue()),
  }))

  const otherBand: Band | null = hasOther
    ? {
        key: OTHER_KEY,
        mapName: null,
        displayName: 'Other Sectors',
        color: THEATER_COLORS['Other'],
        total: 0,
        values: months.map(() => emptyMonthValue()),
      }
    : null

  const bandByKey = new Map(bandList.map(b => [b.key, b]))

  months.forEach((m, monthIdx) => {
    for (const e of m.maps) {
      const target = topSet.has(e.mapName) ? bandByKey.get(e.mapName) : otherBand
      if (!target) continue
      const slot = target.values[monthIdx]
      slot.score += e.score
      slot.kills += e.kills
      slot.deaths += e.deaths
      slot.sessions += e.sessions
      slot.playTimeMinutes += e.playTimeMinutes
    }
  })

  if (otherBand) {
    otherBand.total = otherBand.values.reduce((acc, v) => acc + metricValue(v), 0)
    bandList.push(otherBand)
  }

  return bandList
})

const months = computed<MapTimelineMonth[]>(() => timelineData.value?.months || [])

const hasData = computed(() => bands.value.some(b => b.total > 0))

// --- Formatting ---
const formatNumber = (n: number): string => Math.round(n).toLocaleString()
const formatMetric = (v: number): string => {
  switch (metric.value) {
    case 'playTimeMinutes': return formatPlayTime(v)
    default: return formatNumber(v)
  }
}
const kdFor = (v: BandMonthValue): number => (v.deaths > 0 ? v.kills / v.deaths : v.kills)

// --- Data loading ---
async function loadData() {
  loading.value = true
  error.value = null
  try {
    timelineData.value = await fetchMapPerformanceTimeline(
      props.playerName,
      props.game || 'bf1942',
      monthsWindow.value,
    )
  } catch (err) {
    console.error('Error loading map performance timeline:', err)
    error.value = 'Failed to load performance stream'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadData()
  updateDimensions()
  if (containerRef.value && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => updateDimensions())
    resizeObserver.observe(containerRef.value)
  }
})

onUnmounted(() => resizeObserver?.disconnect())

watch(() => props.playerName, () => { hoveredMapKey.value = null; hoveredMonthIndex.value = null; loadData() })
watch(monthsWindow, loadData)
watch([bands, width, height], () => nextTick(renderStream))

function updateDimensions() {
  if (!containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  if (rect.width > 0) {
    width.value = Math.max(320, rect.width)
    renderStream()
  }
}

// --- Tooltip state ---
const tooltip = ref<{ visible: boolean; x: number; y: number }>({ visible: false, x: 0, y: 0 })

const tooltipMonth = computed(() => {
  if (hoveredMonthIndex.value == null) return null
  return months.value[hoveredMonthIndex.value] || null
})

const tooltipRows = computed(() => {
  const idx = hoveredMonthIndex.value
  if (idx == null) return []
  return bands.value
    .map(b => ({ band: b, v: b.values[idx] }))
    .filter(r => r.v.sessions > 0 || metricValue(r.v) > 0)
    .sort((a, b) => metricValue(b.v) - metricValue(a.v))
})

// --- D3 render ---
const MARGIN = { top: 18, right: 16, bottom: 26, left: 16 }

function renderStream() {
  if (!svgElement.value) return
  const svg = d3.select(svgElement.value)
  svg.selectAll('*').remove()

  const monthList = months.value
  const bandList = bands.value
  if (monthList.length === 0 || bandList.length === 0) return

  const w = width.value
  const h = height.value
  const innerW = Math.max(10, w - MARGIN.left - MARGIN.right)
  const innerH = Math.max(10, h - MARGIN.top - MARGIN.bottom)

  const xScale = d3.scaleLinear().domain([0, Math.max(1, monthList.length - 1)]).range([0, innerW])

  const stackData = monthList.map((_, i) => {
    const row: Record<string, number> = {}
    for (const b of bandList) row[b.key] = metricValue(b.values[i])
    return row
  })

  const stackGen = d3.stack<Record<string, number>>()
    .keys(bandList.map(b => b.key))
    .order(d3.stackOrderInsideOut)
    .offset(d3.stackOffsetWiggle)

  const series = stackGen(stackData)

  const yMin = d3.min(series, layer => d3.min(layer, d => d[0])) ?? 0
  const yMax = d3.max(series, layer => d3.max(layer, d => d[1])) ?? 1
  const yScale = d3.scaleLinear().domain([yMin, yMax]).range([innerH, 0]).nice()

  const g = svg.append('g').attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)

  const areaGen = d3.area<[number, number]>()
    .x((_d, i) => xScale(i))
    .y0(d => yScale(d[0]))
    .y1(d => yScale(d[1]))
    .curve(d3.curveBasis)

  const layerG = g.append('g').attr('class', 'mm-stream-layers')

  layerG.selectAll('path.mm-stream-band')
    .data(series)
    .enter()
    .append('path')
    .attr('class', 'mm-stream-band')
    .attr('data-key', (_d, i) => bandList[i].key)
    .attr('d', d => areaGen(d as unknown as [number, number][]))
    .attr('fill', (_d, i) => bandList[i].color)
    .attr('opacity', (_d, i) => {
      if (!hoveredMapKey.value) return bandList[i].key === OTHER_KEY ? 0.55 : 0.88
      return bandList[i].key === hoveredMapKey.value ? 0.96 : 0.14
    })
    .attr('stroke', (_d, i) => bandList[i].color)
    .attr('stroke-width', 0.6)
    .attr('stroke-opacity', 0.5)
    .style('cursor', (_d, i) => (bandList[i].mapName ? 'pointer' : 'default'))
    .on('click', (_event, d) => {
      const idx = series.indexOf(d)
      const band = bandList[idx]
      if (band?.mapName) emit('navigateToMap', band.mapName)
    })

  // Month tick labels along the bottom -- thin out so labels never collide.
  const maxTicks = Math.max(3, Math.floor(innerW / 70))
  const tickEvery = Math.max(1, Math.ceil(monthList.length / maxTicks))
  const tickIdxs = monthList.map((_, i) => i).filter(i => i % tickEvery === 0 || i === monthList.length - 1)

  g.append('g')
    .attr('class', 'mm-stream-ticks')
    .selectAll('text')
    .data(tickIdxs)
    .enter()
    .append('text')
    .attr('x', i => xScale(i))
    .attr('y', innerH + 18)
    .attr('text-anchor', i => (i === 0 ? 'start' : i === monthList.length - 1 ? 'end' : 'middle'))
    .attr('font-family', 'var(--mm-font-mono)')
    .attr('font-size', 9.5)
    .attr('fill', 'var(--mm-ink-muted)')
    .text(i => monthList[i].monthLabel)

  // Crosshair + hover capture
  const crosshair = g.append('line')
    .attr('class', 'mm-stream-crosshair')
    .attr('y1', 0)
    .attr('y2', innerH)
    .attr('stroke', 'var(--mm-ink)')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '2 3')
    .attr('opacity', 0)

  const dotsG = g.append('g').attr('class', 'mm-stream-dots')

  const overlay = g.append('rect')
    .attr('width', innerW)
    .attr('height', innerH)
    .attr('fill', 'transparent')
    .style('cursor', 'crosshair')

  function showAtIndex(idx: number, clientX: number, clientY: number) {
    hoveredMonthIndex.value = idx
    crosshair.attr('x1', xScale(idx)).attr('x2', xScale(idx)).attr('opacity', 1)

    const dots = series.map((layer, i) => ({ y0: layer[idx][0], y1: layer[idx][1], color: bandList[i].color, key: bandList[i].key }))
      .filter(d => d.y1 - d.y0 > 0.0001)

    const sel = dotsG.selectAll<SVGCircleElement, typeof dots[number]>('circle').data(dots, d => d.key)
    sel.exit().remove()
    sel.enter()
      .append('circle')
      .attr('r', 3)
      .merge(sel as any)
      .attr('cx', xScale(idx))
      .attr('cy', d => yScale((d.y0 + d.y1) / 2))
      .attr('fill', d => d.color)
      .attr('stroke', '#111312')
      .attr('stroke-width', 1)

    const rect = containerRef.value?.getBoundingClientRect()
    if (rect) {
      const mouseX = clientX - rect.left
      const mouseY = clientY - rect.top
      const tipX = mouseX + 230 > rect.width ? mouseX - 220 : mouseX + 16
      const tipY = mouseY + 160 > rect.height ? Math.max(8, mouseY - 140) : mouseY + 16
      tooltip.value = { visible: true, x: Math.max(8, tipX), y: Math.max(8, tipY) }
    }
  }

  overlay
    .on('mousemove', (event: MouseEvent) => {
      const [mx] = d3.pointer(event, g.node())
      const idx = Math.round(xScale.invert(mx))
      const clamped = Math.max(0, Math.min(monthList.length - 1, idx))
      showAtIndex(clamped, event.clientX, event.clientY)
    })
    .on('mouseleave', () => {
      hoveredMonthIndex.value = null
      tooltip.value.visible = false
      crosshair.attr('opacity', 0)
      dotsG.selectAll('circle').remove()
    })
}

function highlightBand(key: string | null) {
  hoveredMapKey.value = key
  renderStream()
}
</script>

<template>
  <section ref="containerRef" class="mm-mpr">
    <div v-if="loading" class="mm-mpr__state">
      <div v-for="i in 4" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">{{ error }}</div>

    <div v-else-if="!timelineData || timelineData.months.length === 0 || !hasData" class="mm-empty">
      No performance stream available.
    </div>

    <template v-else>
      <header class="mm-mpr__head">
        <div class="mm-subtabs">
          <button
            v-for="m in METRICS"
            :key="m.value"
            type="button"
            class="mm-subtab"
            :class="{ 'mm-subtab--active': metric === m.value }"
            @click="metric = m.value"
          >{{ m.label }}</button>
        </div>

        <div class="mm-mpr__window">
          <span class="mm-eyebrow">SPAN:</span>
          <select v-model.number="monthsWindow" class="mm-select">
            <option v-for="w in WINDOWS" :key="w" :value="w">{{ w }} months</option>
          </select>
        </div>
      </header>

      <div class="mm-mpr__hint mm-card__hint">
        Band thickness = {{ METRICS.find(m => m.value === metric)?.label.toLowerCase() }} per month · hover to inspect · click a band to open its leaderboard
      </div>

      <div class="mm-mpr__chart-wrap">
        <svg ref="svgElement" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" style="display: block" />

        <transition name="mm-tip-fade">
          <div
            v-if="tooltip.visible && tooltipMonth"
            class="mm-mpr-tooltip"
            :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
          >
            <div class="mm-mpr-tooltip__head">{{ tooltipMonth.monthLabel }}</div>
            <div v-for="row in tooltipRows" :key="row.band.key" class="mm-mpr-tooltip__row">
              <span class="mm-mpr-tooltip__dot" :style="{ background: row.band.color }" />
              <span class="mm-mpr-tooltip__name">{{ row.band.displayName }}</span>
              <span class="mm-mpr-tooltip__val">{{ formatMetric(metricValue(row.v)) }}</span>
              <span
                v-if="row.band.mapName"
                class="mm-mpr-tooltip__kd"
                :class="kdClass(kdFor(row.v))"
              >{{ kdFor(row.v).toFixed(2) }} K/D</span>
            </div>
          </div>
        </transition>
      </div>

      <div class="mm-mpr__legend">
        <button
          v-for="b in bands"
          :key="b.key"
          type="button"
          class="mm-mpr-chip"
          :class="{ 'is-dimmed': hoveredMapKey && hoveredMapKey !== b.key }"
          :style="{ borderColor: b.color, color: b.color }"
          :disabled="!b.mapName"
          @mouseenter="highlightBand(b.key)"
          @mouseleave="highlightBand(null)"
          @click="b.mapName && emit('navigateToMap', b.mapName)"
        >
          <span class="mm-mpr-chip__dot" :style="{ background: b.color }" />
          <span class="mm-mpr-chip__label">{{ b.displayName }}</span>
          <span class="mm-mpr-chip__total">{{ formatMetric(b.total) }}</span>
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.mm-mpr { display: flex; flex-direction: column; gap: 12px; }

.mm-mpr__state { padding: 14px 0; }

.mm-mpr__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.mm-mpr__window {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mm-mpr__hint { margin-top: -4px; }

.mm-mpr__chart-wrap {
  position: relative;
  width: 100%;
}

.mm-mpr__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mm-mpr-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  padding: 4px 10px;
  border-radius: 2px;
  border: 1px solid var(--mm-rule);
  background: transparent;
  cursor: pointer;
  transition: opacity 0.15s ease, filter 0.15s ease;
}

.mm-mpr-chip:disabled { cursor: default; }

.mm-mpr-chip:not(:disabled):hover { filter: brightness(1.2); }

.mm-mpr-chip.is-dimmed { opacity: 0.35; }

.mm-mpr-chip__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.mm-mpr-chip__label { color: var(--mm-ink); }

.mm-mpr-chip__total { color: var(--mm-ink-muted); }

.mm-mpr-tooltip {
  position: absolute;
  z-index: 100;
  pointer-events: none;
  min-width: 190px;
  max-width: 260px;
  padding: 10px 12px;
  background: rgba(18, 20, 19, 0.94);
  backdrop-filter: blur(10px);
  border: 1px solid var(--mm-rule-strong);
  border-top: 2.5px solid var(--mm-accent);
  border-radius: 3px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.65);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mm-mpr-tooltip__head {
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted);
  border-bottom: 1px solid var(--mm-rule);
  padding-bottom: 6px;
  margin-bottom: 2px;
}

.mm-mpr-tooltip__row {
  display: grid;
  grid-template-columns: 8px 1fr auto;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
}

.mm-mpr-tooltip__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.mm-mpr-tooltip__name {
  font-family: var(--mm-font-display);
  color: var(--mm-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mm-mpr-tooltip__val {
  font-family: var(--mm-font-mono);
  color: var(--mm-ink-soft);
  text-align: right;
}

.mm-mpr-tooltip__kd {
  grid-column: 2 / span 2;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  text-align: right;
  opacity: 0.85;
}

.mm-tip-fade-enter-active,
.mm-tip-fade-leave-active { transition: opacity 0.12s ease, transform 0.12s ease; }

.mm-tip-fade-enter-from,
.mm-tip-fade-leave-to { opacity: 0; transform: translateY(4px); }

@media (max-width: 720px) {
  .mm-mpr__head { flex-direction: column; align-items: flex-start; }
}
</style>
