<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  values: number[]
  width?: number
  height?: number
  fill?: boolean
  accent?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  width: 220,
  height: 44,
  fill: true,
  accent: false,
})

const stroke = computed(() => (props.accent ? 'var(--mm-accent)' : 'var(--mm-ink)'))
const fillColor = computed(() =>
  props.accent ? 'rgba(125, 136, 73, 0.12)' : 'rgba(255, 255, 255, 0.08)',
)

const geometry = computed(() => {
  const v = props.values
  if (!v || v.length === 0) {
    return { d: '', area: '', last: null as null | { x: number; y: number; value: number } }
  }
  const min = Math.min(...v)
  const max = Math.max(...v)
  const range = max - min || 1
  const w = props.width
  const h = props.height
  // 1px padding so stroke isn't clipped
  const pad = 1.5
  const innerW = w - pad * 2
  const innerH = h - pad * 2
  const points = v.map((y, i) => {
    const x = v.length === 1 ? w / 2 : pad + (i / (v.length - 1)) * innerW
    const yy = pad + (1 - (y - min) / range) * innerH
    return [x, yy] as const
  })
  const d = points
    .map((p, i) => (i === 0 ? `M${p[0]} ${p[1]}` : `L${p[0]} ${p[1]}`))
    .join(' ')
  const area = `${d} L${points[points.length - 1][0]} ${h} L${points[0][0]} ${h} Z`
  const lastPoint = points[points.length - 1]
  return {
    d,
    area,
    last: { x: lastPoint[0], y: lastPoint[1], value: v[v.length - 1] },
  }
})
</script>

<template>
  <svg
    :viewBox="`0 0 ${width} ${height}`"
    :width="width"
    :height="height"
    preserveAspectRatio="none"
    aria-hidden="true"
    style="display: block"
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
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <circle
      v-if="geometry.last"
      :cx="geometry.last.x"
      :cy="geometry.last.y"
      r="2"
      :fill="stroke"
    />
  </svg>
</template>
