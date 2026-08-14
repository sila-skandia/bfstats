<script setup lang="ts">
import { computed, ref } from 'vue'

interface Props {
  values: number[]
  timestamps?: string[]
  labels?: string[]
  width?: number
  height?: number
  fill?: boolean
  accent?: boolean
  showAxis?: boolean
  interactive?: boolean
  unit?: string
  valueFormatter?: (v: number) => string
}

const props = withDefaults(defineProps<Props>(), {
  width: 1000,
  height: 44,
  fill: true,
  accent: false,
  showAxis: false,
  interactive: true,
})

const wrapEl = ref<HTMLElement | null>(null)
const hoverIndex = ref<number | null>(null)

const stroke = computed(() => (props.accent ? 'var(--mm-accent)' : 'var(--mm-ink)'))
const fillColor = computed(() =>
  props.accent ? 'rgba(125, 136, 73, 0.12)' : 'rgba(255, 255, 255, 0.08)',
)

const min = computed(() => (props.values && props.values.length ? Math.min(...props.values) : 0))
const max = computed(() => (props.values && props.values.length ? Math.max(...props.values) : 1))
const range = computed(() => (max.value - min.value) || 1)

const geometry = computed(() => {
  const v = props.values
  if (!v || v.length === 0) {
    return { d: '', area: '', points: [] as [number, number][] }
  }
  const w = props.width
  const h = props.height
  const pad = 2
  const innerW = w - pad * 2
  const innerH = h - pad * 2
  const r = range.value
  const mn = min.value

  const points = v.map((y, i) => {
    const x = v.length === 1 ? w / 2 : pad + (i / (v.length - 1)) * innerW
    const yy = pad + (1 - (y - mn) / r) * innerH
    return [x, yy] as [number, number]
  })

  const d = points
    .map((p, i) => (i === 0 ? `M${p[0]} ${p[1]}` : `L${p[0]} ${p[1]}`))
    .join(' ')
  const area = `${d} L${points[points.length - 1][0]} ${h} L${points[0][0]} ${h} Z`

  return { d, area, points }
})

const lastYPercent = computed(() => {
  const v = props.values
  if (!v || v.length === 0) return 50
  const lastVal = v[v.length - 1]
  const p = (1 - (lastVal - min.value) / range.value) * 100
  return Math.max(4, Math.min(96, p))
})

const activeIndex = computed(() => {
  if (hoverIndex.value !== null) return hoverIndex.value
  return null
})

const hoverPoint = computed(() => {
  if (activeIndex.value === null || !geometry.value.points[activeIndex.value]) return null
  return geometry.value.points[activeIndex.value]
})

const hoverXPercent = computed(() => {
  if (activeIndex.value === null || !props.values || props.values.length <= 1) return 50
  return (activeIndex.value / (props.values.length - 1)) * 100
})

const hoverYPercent = computed(() => {
  if (activeIndex.value === null || !props.values) return 50
  const val = props.values[activeIndex.value]
  const p = (1 - (val - min.value) / range.value) * 100
  return Math.max(4, Math.min(96, p))
})

const hoverValue = computed(() => {
  if (activeIndex.value === null || !props.values) return null
  return props.values[activeIndex.value]
})

const hoverTimestamp = computed(() => {
  if (activeIndex.value === null || !props.timestamps) return null
  return props.timestamps[activeIndex.value] ?? null
})

const tooltipStyle = computed(() => {
  const x = hoverXPercent.value
  let align = '-50%'
  if (x < 12) align = '0%'
  else if (x > 88) align = '-100%'
  return {
    left: `${x}%`,
    transform: `translate(${align}, -100%)`,
  }
})

const formatTipValue = (val: number | null) => {
  if (val == null) return ''
  if (props.valueFormatter) return props.valueFormatter(val)
  return val.toFixed(2)
}

const formatTipDate = (raw: string) => {
  if (!raw) return ''
  const d = new Date(raw)
  if (isNaN(d.getTime())) return raw
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const axisLabels = computed(() => {
  if (props.labels && props.labels.length) return props.labels
  if (!props.timestamps || props.timestamps.length < 2) return []
  const first = formatTipDate(props.timestamps[0])
  const last = formatTipDate(props.timestamps[props.timestamps.length - 1])
  if (props.timestamps.length > 5) {
    const midIndex = Math.floor(props.timestamps.length / 2)
    const mid = formatTipDate(props.timestamps[midIndex])
    return [first, mid, last]
  }
  return [first, last]
})

const onPointerMove = (e: MouseEvent | TouchEvent) => {
  if (!props.interactive || !wrapEl.value || !props.values || props.values.length === 0) return
  const rect = wrapEl.value.getBoundingClientRect()
  const clientX = 'touches' in e && e.touches.length ? e.touches[0].clientX : (e as MouseEvent).clientX
  const relX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  const idx = Math.round(relX * (props.values.length - 1))
  hoverIndex.value = Math.max(0, Math.min(props.values.length - 1, idx))
}

const onPointerLeave = () => {
  hoverIndex.value = null
}
</script>

<template>
  <div class="mm-sparkline-root">
    <div
      ref="wrapEl"
      class="mm-sparkline-wrap"
      :style="{ height: `${height}px` }"
      @mousemove="onPointerMove"
      @mouseleave="onPointerLeave"
      @touchstart.passive="onPointerMove"
      @touchmove.passive="onPointerMove"
      @touchend="onPointerLeave"
      @touchcancel="onPointerLeave"
    >
      <svg
        :viewBox="`0 0 ${width} ${height}`"
        preserveAspectRatio="none"
        class="mm-sparkline-svg"
        aria-hidden="true"
      >
        <path
          v-if="fill && geometry.area"
          :d="geometry.area"
          :fill="fillColor"
          stroke="none"
        />
        <path
          v-if="geometry.d"
          :d="geometry.d"
          :stroke="stroke"
          stroke-width="1.25"
          vector-effect="non-scaling-stroke"
          fill="none"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <line
          v-if="hoverPoint"
          :x1="hoverPoint[0]"
          y1="0"
          :x2="hoverPoint[0]"
          :y2="height"
          stroke="var(--mm-rule-strong, rgba(255, 255, 255, 0.25))"
          stroke-dasharray="2 2"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
        />
      </svg>

      <!-- Active point dot -->
      <div
        v-if="hoverIndex !== null"
        class="mm-sparkline__dot"
        :style="{
          left: `${hoverXPercent}%`,
          top: `${hoverYPercent}%`,
          background: stroke,
        }"
      />
      <!-- Default last point dot when idle -->
      <div
        v-else-if="values && values.length > 0"
        class="mm-sparkline__dot mm-sparkline__dot--idle"
        :style="{
          left: '100%',
          top: `${lastYPercent}%`,
          background: stroke,
        }"
      />

      <!-- Floating Hover Tooltip -->
      <div
        v-if="hoverIndex !== null && hoverValue !== null"
        class="mm-sparkline__tooltip"
        :style="tooltipStyle"
      >
        <span v-if="hoverTimestamp" class="mm-sparkline__tip-time">{{ formatTipDate(hoverTimestamp) }}</span>
        <span class="mm-sparkline__tip-val">
          {{ formatTipValue(hoverValue) }}
          <span v-if="unit" class="mm-sparkline__tip-unit">{{ unit }}</span>
        </span>
      </div>
    </div>

    <!-- Axis Labels -->
    <div
      v-if="showAxis && axisLabels && axisLabels.length"
      class="mm-sparkline__axis"
    >
      <span v-for="(l, i) in axisLabels" :key="i">{{ l }}</span>
    </div>
  </div>
</template>

<style scoped>
.mm-sparkline-root {
  width: 100%;
  position: relative;
}

.mm-sparkline-wrap {
  position: relative;
  width: 100%;
  cursor: crosshair;
  touch-action: pan-y;
}

.mm-sparkline-svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.mm-sparkline__dot {
  position: absolute;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 0 1.5px var(--mm-bg, #0d0d0d);
  pointer-events: none;
  z-index: 2;
  transition: transform 0.08s ease;
}

.mm-sparkline__dot--idle {
  transform: translate(-100%, -50%);
  width: 5px;
  height: 5px;
  opacity: 0.8;
}

.mm-sparkline__tooltip {
  position: absolute;
  top: -8px;
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 4px 8px;
  background: var(--mm-surface-raised, #161616);
  border: 1px solid var(--mm-rule, rgba(255, 255, 255, 0.12));
  border-radius: 3px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
  pointer-events: none;
  z-index: 10;
  white-space: nowrap;
}

.mm-sparkline__tip-time {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted, rgba(255, 255, 255, 0.5));
  text-transform: uppercase;
}

.mm-sparkline__tip-val {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--mm-ink, #ffffff);
}

.mm-sparkline__tip-unit {
  font-size: 9.5px;
  font-weight: normal;
  color: var(--mm-ink-soft, rgba(255, 255, 255, 0.7));
  margin-left: 2px;
}

.mm-sparkline__axis {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  color: var(--mm-ink-muted, rgba(255, 255, 255, 0.45));
  text-transform: uppercase;
}
</style>
