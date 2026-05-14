<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  values: number[]
  /** optional labels — show first, mid, last under the chart */
  labels?: string[]
  height?: number
  accent?: boolean
  /** show the value rail along the bottom (e.g. "0  6  12  18  23") */
  showAxis?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  height: 48,
  accent: false,
  showAxis: true,
})

const max = computed(() => Math.max(1, ...props.values))
const barColor = computed(() => (props.accent ? 'var(--mm-accent)' : 'var(--mm-ink)'))
</script>

<template>
  <div>
    <div
      :style="{
        display: 'flex',
        alignItems: 'flex-end',
        gap: '2px',
        height: height + 'px',
        borderBottom: '1px solid var(--mm-rule)',
      }"
    >
      <div
        v-for="(v, i) in values"
        :key="i"
        :title="String(v)"
        :style="{
          flex: 1,
          height: ((v / max) * 100) + '%',
          background: v > 0 ? barColor : 'var(--mm-bg-mute)',
          minHeight: v > 0 ? '2px' : '1px',
          opacity: v > 0 ? '0.85' : '0.4',
        }"
      />
    </div>
    <div
      v-if="showAxis && labels && labels.length"
      style="display: flex; justify-content: space-between; margin-top: 6px; font-family: var(--mm-font-mono); font-size: 9.5px; letter-spacing: 0.08em; color: var(--mm-ink-muted); text-transform: uppercase"
    >
      <span v-for="(l, i) in labels" :key="i">{{ l }}</span>
    </div>
  </div>
</template>
