<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  value: number
  max: number
  tone?: 'neutral' | 'kill' | 'death' | 'kd'
  /** When true, formats `value` as compact-locale; otherwise the slot rules */
  showValue?: boolean
  /** Decimal places for the rendered number; ignored if a default slot is provided */
  decimals?: number
}

const props = withDefaults(defineProps<Props>(), {
  tone: 'neutral',
  showValue: false,
  decimals: 0,
})

const pct = computed(() => {
  if (props.max <= 0) return 0
  return Math.min(100, Math.max(0, (props.value / props.max) * 100))
})

const displayValue = computed(() => {
  if (props.decimals > 0) return props.value.toFixed(props.decimals)
  return Math.round(props.value).toLocaleString()
})
</script>

<template>
  <span class="mm-rank-cell">
    <span class="mm-rank-cell__bar">
      <span
        class="mm-rank-cell__bar-fill"
        :class="`mm-rank-cell__bar-fill--${tone}`"
        :style="{ width: pct + '%' }"
      />
    </span>
    <span class="mm-rank-cell__num">
      <slot>{{ showValue ? displayValue : '' }}</slot>
    </span>
  </span>
</template>

<style scoped>
.mm-rank-cell {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  justify-content: flex-end;
  width: 100%;
}

.mm-rank-cell__bar {
  flex: 1 1 auto;
  min-width: 40px;
  max-width: 110px;
  height: 7px;
  background: var(--mm-bg-mute);
  border-radius: 1px;
  overflow: hidden;
}

.mm-rank-cell__bar-fill {
  display: block;
  height: 100%;
  border-radius: 1px;
  transition: width 0.2s ease;
}

.mm-rank-cell__bar-fill--neutral { background: var(--mm-ink-faint); }
.mm-rank-cell__bar-fill--kill { background: var(--mm-kill-soft); }
.mm-rank-cell__bar-fill--death { background: var(--mm-ink-faint); }
.mm-rank-cell__bar-fill--kd { background: var(--mm-highlight); }

.mm-rank-cell__num {
  font-family: var(--mm-font-mono);
  font-variant-numeric: tabular-nums;
  min-width: 0;
  flex-shrink: 0;
  text-align: right;
}

@media (max-width: 720px) {
  .mm-rank-cell__bar {
    display: none;
  }
}
</style>
