<script setup lang="ts">
import { computed, ref } from 'vue'
import { parseUtc } from '@/utils/timeUtils'

export interface SparklineBrushRange {
  startIndex: number
  endIndex: number
}

interface Props {
  values: number[]
  timestamps?: string[]
  labels?: string[]
  width?: number
  height?: number
  fill?: boolean
  accent?: boolean
  showAxis?: boolean
  showValueScale?: boolean
  interactive?: boolean
  brushable?: boolean
  highlightRange?: SparklineBrushRange | null
  showReset?: boolean
  canWiden?: boolean
  unit?: string
  valueFormatter?: (v: number) => string
}

const props = withDefaults(defineProps<Props>(), {
  width: 1000,
  height: 44,
  fill: true,
  accent: false,
  showAxis: false,
  showValueScale: false,
  interactive: true,
  brushable: false,
  highlightRange: null,
  showReset: false,
  canWiden: false,
})

const emit = defineEmits<{
  brush: [range: SparklineBrushRange]
  reset: []
  widen: []
}>()

const wrapEl = ref<HTMLElement | null>(null)
const hoverIndex = ref<number | null>(null)

const pointerStartX = ref(0)
const pointerStartY = ref(0)
const brushOriginIndex = ref<number | null>(null)
const brushLiveIndex = ref<number | null>(null)
const isBrushing = ref(false)

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

const indexToPercent = (idx: number) => {
  if (!props.values || props.values.length <= 1) return 50
  return (idx / (props.values.length - 1)) * 100
}

const hoverXPercent = computed(() => {
  if (activeIndex.value === null) return 50
  return indexToPercent(activeIndex.value)
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

const liveBrush = computed<SparklineBrushRange | null>(() => {
  if (!isBrushing.value || brushOriginIndex.value === null || brushLiveIndex.value === null) return null
  return {
    startIndex: Math.min(brushOriginIndex.value, brushLiveIndex.value),
    endIndex: Math.max(brushOriginIndex.value, brushLiveIndex.value),
  }
})

const overlayRange = computed<SparklineBrushRange | null>(() => {
  return liveBrush.value ?? props.highlightRange ?? null
})

const overlayStyle = computed(() => {
  const sel = overlayRange.value
  if (!sel || !props.values || props.values.length <= 1) return null
  const lo = indexToPercent(sel.startIndex)
  const hi = indexToPercent(sel.endIndex)
  return {
    left: `${Math.min(lo, hi)}%`,
    width: `${Math.abs(hi - lo)}%`,
  }
})

const dimLeftStyle = computed(() => {
  const sel = overlayRange.value
  if (!sel || !props.highlightRange || liveBrush.value) return null
  if (!props.values || props.values.length <= 1) return null
  return { width: `${indexToPercent(sel.startIndex)}%` }
})

const dimRightStyle = computed(() => {
  const sel = overlayRange.value
  if (!sel || !props.highlightRange || liveBrush.value) return null
  if (!props.values || props.values.length <= 1) return null
  return { width: `${100 - indexToPercent(sel.endIndex)}%` }
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
  const d = parseUtc(raw)
  if (isNaN(d.getTime())) return raw
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const brushRangeLabel = computed(() => {
  const sel = liveBrush.value
  if (!sel || !props.timestamps) return ''
  const a = props.timestamps[sel.startIndex]
  const b = props.timestamps[sel.endIndex]
  if (!a || !b) return ''
  const left = formatTipDate(a)
  const right = formatTipDate(b)
  return left === right ? left : `${left} – ${right}`
})

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

const indexFromClientX = (clientX: number) => {
  if (!wrapEl.value || !props.values || props.values.length === 0) return 0
  const rect = wrapEl.value.getBoundingClientRect()
  const relX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  return Math.max(0, Math.min(props.values.length - 1, Math.round(relX * (props.values.length - 1))))
}

const canBrush = computed(() => props.brushable && props.interactive && (props.values?.length ?? 0) >= 3)

const tryCapture = (pointerId: number) => {
  try {
    wrapEl.value?.setPointerCapture(pointerId)
  } catch {
    /* Synthetic events (Playwright dispatch) may not support capture. */
  }
}

const resetBrush = () => {
  isBrushing.value = false
  brushOriginIndex.value = null
  brushLiveIndex.value = null
}

const onPointerDown = (e: PointerEvent) => {
  if (!props.interactive || !props.values || props.values.length === 0) return
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const idx = indexFromClientX(e.clientX)
  hoverIndex.value = idx
  pointerStartX.value = e.clientX
  pointerStartY.value = e.clientY
  if (canBrush.value) {
    brushOriginIndex.value = idx
    brushLiveIndex.value = idx
    isBrushing.value = false
    if (e.pointerType === 'mouse') tryCapture(e.pointerId)
  }
}

const onPointerMove = (e: PointerEvent) => {
  if (!props.interactive || !props.values || props.values.length === 0) return
  const idx = indexFromClientX(e.clientX)
  hoverIndex.value = idx

  if (brushOriginIndex.value === null) return

  const dx = e.clientX - pointerStartX.value
  const dy = e.clientY - pointerStartY.value

  if (!isBrushing.value) {
    if (Math.abs(dx) < 8) return
    if (e.pointerType !== 'mouse' && Math.abs(dy) > Math.abs(dx)) {
      resetBrush()
      return
    }
    isBrushing.value = true
    tryCapture(e.pointerId)
  }

  brushLiveIndex.value = idx
}

const commitBrush = () => {
  const origin = brushOriginIndex.value
  const live = brushLiveIndex.value
  const brushed = isBrushing.value
  resetBrush()
  if (!brushed || origin === null || live === null) return
  const startIndex = Math.min(origin, live)
  const endIndex = Math.max(origin, live)
  if (endIndex <= startIndex) return
  emit('brush', { startIndex, endIndex })
}

const onPointerUp = (e: PointerEvent) => {
  commitBrush()
  if (e.pointerType !== 'mouse') hoverIndex.value = null
}

const onPointerCancel = () => {
  resetBrush()
  hoverIndex.value = null
}

const onPointerLeave = (e: PointerEvent) => {
  if (brushOriginIndex.value !== null) return
  if (e.pointerType === 'mouse') hoverIndex.value = null
}
</script>

<template>
  <div class="mm-sparkline-root">
    <div
      ref="wrapEl"
      class="mm-sparkline-wrap"
      :class="{
        'mm-sparkline-wrap--brushable': canBrush,
        'mm-sparkline-wrap--brushing': isBrushing,
      }"
      :style="{ height: `${height}px` }"
      :aria-label="brushable ? 'Trend chart. Drag horizontally to zoom a time range.' : 'Trend chart.'"
      role="group"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @pointerleave="onPointerLeave"
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
          v-if="hoverPoint && !isBrushing"
          :x1="hoverPoint[0]"
          y1="0"
          :x2="hoverPoint[0]"
          :y2="height"
          stroke="var(--mm-rule-strong)"
          stroke-dasharray="2 2"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
        />
      </svg>

      <div
        v-if="dimLeftStyle"
        class="mm-sparkline__dim mm-sparkline__dim--left"
        :style="dimLeftStyle"
      />
      <div
        v-if="dimRightStyle"
        class="mm-sparkline__dim mm-sparkline__dim--right"
        :style="dimRightStyle"
      />

      <div
        v-if="overlayStyle"
        class="mm-sparkline__sel"
        :class="{ 'mm-sparkline__sel--live': isBrushing }"
        :style="overlayStyle"
      />

      <!-- Active point dot -->
      <div
        v-if="hoverIndex !== null && !isBrushing"
        class="mm-sparkline__dot"
        :style="{
          left: `${hoverXPercent}%`,
          top: `${hoverYPercent}%`,
          background: stroke,
        }"
      />
      <!-- Default last point dot when idle -->
      <div
        v-else-if="values && values.length > 0 && !overlayRange"
        class="mm-sparkline__dot mm-sparkline__dot--idle"
        :style="{
          left: '100%',
          top: `${lastYPercent}%`,
          background: stroke,
        }"
      />

      <!-- Floating Hover Tooltip -->
      <div
        v-if="isBrushing && brushRangeLabel"
        class="mm-sparkline__tooltip"
        :style="tooltipStyle"
      >
        <span class="mm-sparkline__tip-time">{{ brushRangeLabel }}</span>
        <span class="mm-sparkline__tip-val">Release to zoom</span>
      </div>
      <div
        v-else-if="hoverIndex !== null && hoverValue !== null && !isBrushing"
        class="mm-sparkline__tooltip"
        :style="tooltipStyle"
      >
        <span v-if="hoverTimestamp" class="mm-sparkline__tip-time">{{ formatTipDate(hoverTimestamp) }}</span>
        <span class="mm-sparkline__tip-val">
          {{ formatTipValue(hoverValue) }}
          <span v-if="unit" class="mm-sparkline__tip-unit">{{ unit }}</span>
        </span>
      </div>

      <div
        v-if="showReset || canWiden"
        class="mm-sparkline__overlay"
        @pointerdown.stop
        @pointermove.stop
        @pointerup.stop
        @click.stop
      >
        <button
          v-if="canWiden"
          type="button"
          class="mm-sparkline__reset"
          @click="emit('widen')"
        >
          Wider
        </button>
        <button
          v-if="showReset"
          type="button"
          class="mm-sparkline__reset"
          @click="emit('reset')"
        >
          Reset
        </button>
      </div>
    </div>

    <div v-if="showValueScale" class="mm-sparkline__scale">
      <span>{{ formatTipValue(max) }}</span>
      <span>{{ formatTipValue(min) }}</span>
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
  user-select: none;
}

.mm-sparkline-wrap--brushable {
  touch-action: pan-y;
}

.mm-sparkline-wrap--brushing {
  cursor: ew-resize;
  touch-action: none;
}

.mm-sparkline-svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.mm-sparkline__dim {
  position: absolute;
  top: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--mm-bg) 55%, transparent);
  pointer-events: none;
  z-index: 1;
}

.mm-sparkline__dim--left { left: 0; }
.mm-sparkline__dim--right { right: 0; }

.mm-sparkline__sel {
  position: absolute;
  top: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--mm-accent) 18%, transparent);
  border-left: 1px solid var(--mm-accent);
  border-right: 1px solid var(--mm-accent);
  pointer-events: none;
  z-index: 1;
}

.mm-sparkline__sel--live {
  background: color-mix(in srgb, var(--mm-accent) 28%, transparent);
}

.mm-sparkline__overlay {
  position: absolute;
  top: 4px;
  left: 4px;
  z-index: 6;
  display: flex;
  gap: 4px;
  pointer-events: auto;
}

.mm-sparkline__reset {
  font-family: var(--mm-font-mono);
  font-size: 9.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--mm-ink-soft);
  background: color-mix(in srgb, var(--mm-bg) 82%, transparent);
  border: 1px solid var(--mm-rule-strong);
  padding: 5px 8px;
  min-height: 28px;
  cursor: pointer;
  border-radius: 2px;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.mm-sparkline__reset:hover,
.mm-sparkline__reset:focus-visible {
  color: var(--mm-ink);
  border-color: var(--mm-ink-soft);
  outline: none;
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

.mm-sparkline__scale {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 22px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  pointer-events: none;
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.06em;
  color: var(--mm-ink-muted);
  text-align: right;
  padding: 0 0 0 8px;
}

@media (prefers-reduced-motion: reduce) {
  .mm-sparkline__dot { transition: none; }
}
</style>
