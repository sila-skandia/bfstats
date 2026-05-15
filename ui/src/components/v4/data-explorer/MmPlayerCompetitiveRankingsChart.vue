<script setup lang="ts">
import { ref, computed } from 'vue'

interface MapRanking {
  mapName: string
  rank: number
  totalPlayers: number
  percentile: number
  totalScore: number
  totalKills: number
  totalDeaths: number
  kdRatio: number
  playTimeMinutes: number
}

const props = defineProps<{
  rankings: MapRanking[]
  sortBy?: 'kdRatio' | 'kills' | 'timePlayed' | 'score'
}>()

const emit = defineEmits<{
  navigateToMap: [mapName: string]
}>()

const sortBy = ref<'kdRatio' | 'kills' | 'timePlayed' | 'score'>(props.sortBy || 'kdRatio')

const metrics: { value: 'kdRatio' | 'kills' | 'timePlayed' | 'score'; label: string }[] = [
  { value: 'kdRatio', label: 'K/D' },
  { value: 'kills', label: 'Kills' },
  { value: 'timePlayed', label: 'Time' },
  { value: 'score', label: 'Score' },
]

const getValue = (m: MapRanking): number => {
  switch (sortBy.value) {
    case 'kdRatio': return m.kdRatio
    case 'kills': return m.totalKills
    case 'timePlayed': return m.playTimeMinutes
    case 'score': return m.totalScore
    default: return m.totalScore
  }
}

const topMaps = computed(() => {
  const sorted = [...props.rankings].sort((a, b) => getValue(b) - getValue(a))
  return sorted.slice(0, 15)
})

const maxValue = computed(() => {
  if (topMaps.value.length === 0) return 1
  return Math.max(...topMaps.value.map(getValue))
})

const getBarWidth = (m: MapRanking): number => {
  if (maxValue.value === 0) return 0
  return (getValue(m) / maxValue.value) * 100
}

const formatValue = (m: MapRanking): string => {
  const v = getValue(m)
  switch (sortBy.value) {
    case 'kdRatio': return v.toFixed(2)
    case 'kills': return v.toLocaleString()
    case 'timePlayed': {
      const hours = v / 60
      return hours >= 10 ? `${Math.round(hours)}h` : `${hours.toFixed(1)}h`
    }
    case 'score': return v.toLocaleString()
    default: return v.toString()
  }
}
</script>

<template>
  <div class="mm-pcrc">
    <div class="mm-subtabs mm-pcrc__metrics">
      <button
        v-for="m in metrics"
        :key="m.value"
        type="button"
        class="mm-subtab"
        :class="{ 'mm-subtab--active': sortBy === m.value }"
        @click="sortBy = m.value"
      >{{ m.label }}</button>
    </div>

    <TransitionGroup name="mm-pcrc-reorder" tag="div" class="mm-pcrc__list">
      <button
        v-for="(map, index) in topMaps"
        :key="map.mapName"
        type="button"
        class="mm-pcrc__row"
        @click.stop="emit('navigateToMap', map.mapName)"
      >
        <span class="mm-pcrc__label" :title="map.mapName">{{ map.mapName }}</span>
        <div class="mm-list__bar mm-pcrc__bar">
          <div
            class="mm-list__bar-fill"
            :class="{ 'mm-list__bar-fill--accent': index === 0 }"
            :style="{ width: getBarWidth(map) + '%' }"
          />
        </div>
        <span class="mm-pcrc__value">{{ formatValue(map) }}</span>
      </button>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.mm-pcrc { display: flex; flex-direction: column; gap: 12px; }

.mm-pcrc__metrics { align-self: flex-start; }

.mm-pcrc__list { display: flex; flex-direction: column; gap: 2px; }

.mm-pcrc__row {
  display: grid;
  grid-template-columns: 1fr 160px 70px;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--mm-rule);
  text-align: left;
  cursor: pointer;
  color: var(--mm-ink);
  transition: opacity 0.3s, transform 0.3s;
}

.mm-pcrc__row:hover .mm-pcrc__label { color: var(--mm-accent); }

.mm-pcrc__label {
  font-family: var(--mm-font-display);
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.12s ease;
}

.mm-pcrc__bar { width: 160px; }

.mm-pcrc__value {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
  text-align: right;
}

.mm-pcrc-reorder-move { transition: transform 0.45s cubic-bezier(0.3, 0, 0.2, 1); }

@media (max-width: 720px) {
  .mm-pcrc__row { grid-template-columns: 1fr 80px 60px; gap: 8px; }
  .mm-pcrc__bar { width: 80px; }
}
</style>
