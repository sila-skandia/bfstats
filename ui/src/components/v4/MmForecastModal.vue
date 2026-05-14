<script setup lang="ts">
import { computed } from 'vue'
import MmBaseModal from './MmBaseModal.vue'
import type { ServerHourlyTimelineEntry } from '@/services/serverDetailsService'

interface Props {
  modelValue: boolean
  hourlyTimeline: ServerHourlyTimelineEntry[]
  currentStatus?: string
  currentPlayers?: number
}

const props = withDefaults(defineProps<Props>(), {
  currentStatus: '',
  currentPlayers: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
}>()

const maxTypical = computed(() => {
  return Math.max(1, ...props.hourlyTimeline.map(e => Math.max(0, e.typicalPlayers || 0)))
})

const getBarHeight = (entry: ServerHourlyTimelineEntry): number => {
  const pct = Math.max(0, Math.min(1, (entry.typicalPlayers || 0) / maxTypical.value))
  return Math.max(8, Math.round(pct * 100))
}

const formatHourLabel = (entry: ServerHourlyTimelineEntry): string => {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), entry.hour, 0, 0))
  return d.toLocaleTimeString(undefined, { hour: '2-digit' })
}

const getBusyLabel = (level: string): string => {
  switch (level) {
    case 'very_busy': return 'Very busy'
    case 'busy': return 'Busy'
    case 'moderate': return 'Moderate'
    case 'quiet': return 'Quiet'
    case 'very_quiet': return 'Very quiet'
    default: return 'Unknown'
  }
}

const barFillClass = (level: string): string => {
  switch (level) {
    case 'very_busy':
    case 'busy':
      return 'mm-forecast__bar-fill--busy'
    case 'moderate':
      return ''
    default:
      return 'mm-forecast__bar-fill--idle'
  }
}

const tooltipFor = (entry: ServerHourlyTimelineEntry): string => {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), entry.hour, 0, 0))
  const local = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${local} · typical ${Math.round(entry.typicalPlayers)} · ${getBusyLabel(entry.busyLevel)}`
}
</script>

<template>
  <MmBaseModal
    :model-value="modelValue"
    size="lg"
    title="24-hour forecast"
    subtitle="Typical player counts by local hour"
    @update:model-value="emit('update:modelValue', $event)"
    @close="emit('close')"
  >
    <div v-if="currentStatus || currentPlayers != null" class="mm-forecast__now">
      <span class="mm-eyebrow">Right now</span>
      <span v-if="currentPlayers != null" class="mm-stat__value mm-stat__value--small">{{ currentPlayers }}</span>
      <span v-if="currentStatus" class="mm-chip">{{ currentStatus }}</span>
    </div>

    <div v-if="hourlyTimeline.length === 0" class="mm-empty">No forecast data yet.</div>

    <div v-else class="mm-forecast__chart">
      <div
        v-for="entry in hourlyTimeline"
        :key="entry.hour"
        class="mm-forecast__col"
        :title="tooltipFor(entry)"
      >
        <div class="mm-forecast__bar">
          <div
            class="mm-forecast__bar-fill"
            :class="barFillClass(entry.busyLevel)"
            :style="{ height: getBarHeight(entry) + 'px' }"
          />
        </div>
        <span class="mm-forecast__label">{{ formatHourLabel(entry) }}</span>
      </div>
    </div>

    <div class="mm-forecast__legend">
      <span class="mm-chip mm-chip--accent">Busy</span>
      <span class="mm-chip">Moderate</span>
      <span class="mm-chip mm-chip--off">Quiet</span>
    </div>
  </MmBaseModal>
</template>

<style scoped>
.mm-forecast__now {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--mm-rule);
  margin-bottom: 16px;
}

.mm-forecast__chart {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 140px;
  padding: 8px 0;
  border-bottom: 1px solid var(--mm-rule);
}

.mm-forecast__col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.mm-forecast__bar {
  width: 100%;
  height: 110px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.mm-forecast__bar-fill {
  width: 100%;
  background: var(--mm-ink);
  border-radius: 1px 1px 0 0;
  transition: height 0.2s ease;
}

.mm-forecast__bar-fill--busy { background: var(--mm-accent); }
.mm-forecast__bar-fill--idle { background: var(--mm-ink-faint); }

.mm-forecast__label {
  font-family: var(--mm-font-mono);
  font-size: 9px;
  letter-spacing: 0.04em;
  color: var(--mm-ink-muted);
}

.mm-forecast__legend {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
}

@media (max-width: 720px) {
  .mm-forecast__chart { height: 110px; }
  .mm-forecast__bar { height: 80px; }
  .mm-forecast__label { font-size: 8px; }
}
</style>
