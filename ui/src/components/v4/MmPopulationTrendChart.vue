<script setup lang="ts">
import { computed, ref } from 'vue'
import { MM_CHART } from '@/views/v4/mmTokens'

export interface TrendChartSeries {
  key: string
  label: string
  color: string
  values: number[]
}

const props = defineProps<{
  series: TrendChartSeries[]
  prev: number[] | null
  band: { hi: number[]; lo: number[] } | null
  xTicks: { i: number; text: string }[]
  tsLabel: (i: number) => string
  showAvg: boolean
  showPeak: boolean
  avg: number
  peakIndex: number
  height?: number
}>()

const wrapEl = ref<HTMLElement | null>(null)
const hover = ref<number | null>(null)

const W = 1000
const H = computed(() => props.height ?? 360)
const ML = 48
const MR = 56
const MT = 28
const MB = 36

const n = computed(() => props.series[0]?.values.length ?? 0)
const plotW = computed(() => W - ML - MR)
const plotH = computed(() => H.value - MT - MB)

const yMax = computed(() => {
  let raw = 1
  for (const s of props.series) {
    for (const v of s.values) if (v > raw) raw = v
  }
  if (props.band) {
    for (const v of props.band.hi) if (v > raw) raw = v
  }
  if (props.prev) {
    for (const v of props.prev) if (v > raw) raw = v
  }
  return Math.max(10, Math.ceil((raw * 1.14) / 10) * 10)
})

const X = (i: number) => ML + (n.value <= 1 ? 0 : (i / (n.value - 1)) * plotW.value)
const Y = (v: number) => MT + plotH.value - (v / yMax.value) * plotH.value

const gridLines = computed(() =>
  [0, 1, 2, 3, 4].map(g => {
    const val = yMax.value * g / 4
    return { y: Y(val), label: Math.round(val).toLocaleString() }
  }),
)

const hexToRgba = (hex: string, a: number) => {
  const m = hex.replace('#', '')
  const r = parseInt(m.slice(0, 2), 16)
  const g = parseInt(m.slice(2, 4), 16)
  const b = parseInt(m.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

const bandPath = computed(() => {
  if (!props.band || n.value === 0) return ''
  let d = 'M'
  for (let i = 0; i < n.value; i++) {
    d += `${i ? ' L' : ' '}${X(i).toFixed(1)} ${Y(props.band.hi[i] ?? 0).toFixed(1)}`
  }
  for (let i = n.value - 1; i >= 0; i--) {
    d += ` L${X(i).toFixed(1)} ${Y(props.band.lo[i] ?? 0).toFixed(1)}`
  }
  return d + ' Z'
})

const prevPath = computed(() => {
  if (!props.prev || n.value === 0) return ''
  let d = ''
  for (let i = 0; i < n.value; i++) {
    d += `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(props.prev[i] ?? 0).toFixed(1)} `
  }
  return d
})

const areaPath = computed(() => {
  if (props.series.length !== 1 || n.value === 0) return ''
  const s = props.series[0]
  let d = ''
  for (let i = 0; i < n.value; i++) {
    d += `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(s.values[i] ?? 0).toFixed(1)} `
  }
  d += `L${X(n.value - 1).toFixed(1)} ${MT + plotH.value} L${X(0).toFixed(1)} ${MT + plotH.value} Z`
  return d
})

const linePaths = computed(() =>
  props.series.map(s => {
    let d = ''
    for (let i = 0; i < n.value; i++) {
      d += `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(s.values[i] ?? 0).toFixed(1)} `
    }
    return { key: s.key, color: s.color, d }
  }),
)

const primary = computed(() => props.series[0] ?? null)

const peak = computed(() => {
  if (!props.showPeak || !primary.value || n.value === 0) return null
  const i = Math.max(0, Math.min(n.value - 1, props.peakIndex))
  const v = primary.value.values[i] ?? 0
  const px = X(i)
  const py = Y(v)
  return { i, v, px, py, flip: px > W - MR - 90 }
})

const hoverLines = computed(() => {
  const hv = hover.value
  if (hv == null || hv < 0 || hv >= n.value) return null
  const hx = X(hv)
  const dots = props.series.map(s => ({
    key: s.key,
    color: s.color,
    label: s.label,
    value: s.values[hv] ?? 0,
    cy: Y(s.values[hv] ?? 0),
  }))
  const lines = [props.tsLabel(hv), ...dots.map(d => `${d.label}  ${Math.round(d.value).toLocaleString()}`)]
  const tw = Math.max(...lines.map(l => l.length)) * 6.4 + 18
  const th = 16 + lines.length * 15 + 4
  let tx = hx + 12
  if (tx + tw > W - 4) tx = hx - 12 - tw
  return { hx, dots, lines, tw, th, tx, ty: MT + 6, title: lines[0] }
})

const onMove = (e: PointerEvent) => {
  if (n.value === 0) return
  const el = e.currentTarget as SVGRectElement
  const r = el.getBoundingClientRect()
  const rel = (e.clientX - r.left) / r.width
  hover.value = Math.max(0, Math.min(n.value - 1, Math.round(rel * (n.value - 1))))
}

const CH = MM_CHART
</script>

<template>
  <div ref="wrapEl" class="mm-pop-chart">
    <svg
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="none"
      role="img"
      aria-label="Player population over time"
    >
      <line
        v-for="(g, gi) in gridLines"
        :key="`g${gi}`"
        :x1="ML"
        :x2="W - MR"
        :y1="g.y"
        :y2="g.y"
        :stroke="gi === 0 ? CH.gridStrong : CH.grid"
        stroke-width="1"
      />
      <text
        v-for="(g, gi) in gridLines"
        :key="`gl${gi}`"
        :x="ML - 8"
        :y="g.y + 3"
        text-anchor="end"
        :fill="CH.inkFaint"
        font-size="10"
        font-family="var(--mm-font-mono)"
      >{{ g.label }}</text>

      <text
        v-for="(t, ti) in xTicks"
        :key="`x${ti}`"
        :x="X(t.i)"
        :y="H - 12"
        :text-anchor="ti === 0 ? 'start' : (ti === xTicks.length - 1 ? 'end' : 'middle')"
        :fill="CH.inkMuted"
        font-size="9.5"
        font-family="var(--mm-font-mono)"
        letter-spacing="0.06em"
      >{{ t.text.toUpperCase() }}</text>

      <path v-if="bandPath" :d="bandPath" :fill="hexToRgba(CH.ink, 0.055)" />
      <path
        v-if="prevPath"
        :d="prevPath"
        fill="none"
        :stroke="CH.inkFaint"
        stroke-width="1.3"
        stroke-dasharray="4 4"
      />
      <path
        v-if="areaPath && primary"
        :d="areaPath"
        :fill="hexToRgba(primary.color, 0.15)"
      />
      <path
        v-for="ln in linePaths"
        :key="ln.key"
        :d="ln.d"
        fill="none"
        :stroke="ln.color"
        stroke-width="2"
        stroke-linejoin="round"
        stroke-linecap="round"
      />

      <template v-if="showAvg && n > 0">
        <line
          :x1="ML"
          :x2="W - MR"
          :y1="Y(avg)"
          :y2="Y(avg)"
          :stroke="CH.inkMuted"
          stroke-width="1"
          stroke-dasharray="2 4"
        />
        <text
          :x="ML + 4"
          :y="Y(avg) - 5"
          :fill="CH.inkMuted"
          font-size="9.5"
          font-family="var(--mm-font-mono)"
          letter-spacing="0.08em"
        >AVG {{ Math.round(avg).toLocaleString() }}</text>
      </template>

      <template v-if="peak && primary">
        <circle :cx="peak.px" :cy="peak.py" r="3.6" :fill="primary.color" :stroke="CH.surface" stroke-width="1.5" />
        <line
          :x1="peak.px"
          :x2="peak.px"
          :y1="peak.py - 6"
          :y2="MT + 4"
          :stroke="CH.gridStrong"
          stroke-width="1"
          stroke-dasharray="2 3"
        />
        <text
          :x="peak.flip ? peak.px - 6 : peak.px + 6"
          :y="MT + 2"
          :text-anchor="peak.flip ? 'end' : 'start'"
          :fill="primary.color"
          font-size="10.5"
          font-family="var(--mm-font-mono)"
          letter-spacing="0.06em"
        >PEAK {{ Math.round(peak.v).toLocaleString() }}</text>
      </template>

      <template v-if="hoverLines">
        <line
          :x1="hoverLines.hx"
          :x2="hoverLines.hx"
          :y1="MT"
          :y2="MT + plotH"
          :stroke="CH.gridStrong"
          stroke-width="1"
        />
        <circle
          v-for="d in hoverLines.dots"
          :key="d.key"
          :cx="hoverLines.hx"
          :cy="d.cy"
          r="3.4"
          :fill="d.color"
          :stroke="CH.surface"
          stroke-width="1.5"
        />
        <rect
          :x="hoverLines.tx"
          :y="hoverLines.ty"
          :width="hoverLines.tw"
          :height="hoverLines.th"
          rx="2"
          :fill="CH.surfaceSoft"
          :stroke="CH.gridStrong"
          stroke-width="1"
        />
        <text
          :x="hoverLines.tx + 9"
          :y="hoverLines.ty + 16"
          :fill="CH.inkMuted"
          font-size="9.5"
          font-family="var(--mm-font-mono)"
          letter-spacing="0.06em"
        >{{ hoverLines.title.toUpperCase() }}</text>
        <template v-for="(d, si) in hoverLines.dots" :key="`tt${d.key}`">
          <rect :x="hoverLines.tx + 9" :y="hoverLines.ty + 16 + (si + 1) * 15 - 8" width="9" height="3" :fill="d.color" />
          <text
            :x="hoverLines.tx + 23"
            :y="hoverLines.ty + 16 + (si + 1) * 15"
            :fill="CH.ink"
            font-size="11"
            font-family="var(--mm-font-mono)"
          >{{ d.label }}  {{ Math.round(d.value).toLocaleString() }}</text>
        </template>
      </template>

      <rect
        :x="ML"
        :y="MT"
        :width="plotW"
        :height="plotH"
        fill="transparent"
        style="touch-action: none; cursor: crosshair"
        @pointermove="onMove"
        @pointerleave="hover = null"
      />
    </svg>
  </div>
</template>

<style scoped>
.mm-pop-chart {
  width: 100%;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
}
.mm-pop-chart svg {
  display: block;
  width: 100%;
  height: auto;
  min-height: 280px;
}
@media (min-width: 721px) {
  .mm-pop-chart svg { min-height: 380px; }
}
</style>
