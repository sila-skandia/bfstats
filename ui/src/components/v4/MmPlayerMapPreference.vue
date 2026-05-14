<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { fetchPlayerMapStats } from '@/services/playerStatsApi'
import type { PlayerMapStatEntry } from '@/types/playerStatsTypes'
import { kdClass } from '@/views/v4/mmTokens'

const props = defineProps<{
  playerName: string
  game?: string
}>()

const emit = defineEmits<{
  navigateToMap: [mapName: string]
}>()

const loading = ref(true)
const error = ref<string | null>(null)
const mapStats = ref<PlayerMapStatEntry[]>([])

const topMaps = computed(() =>
  [...mapStats.value].sort((a, b) => b.totalPlayTimeMinutes - a.totalPlayTimeMinutes),
)

const topMap = computed(() => topMaps.value[0] || null)

const calculateKD = (map: PlayerMapStatEntry | null): number => {
  if (!map) return 0
  return map.totalDeaths > 0 ? map.totalKills / map.totalDeaths : map.totalKills
}

const getBarWidth = (map: PlayerMapStatEntry): number => {
  if (!topMap.value) return 0
  return (map.totalPlayTimeMinutes / topMap.value.totalPlayTimeMinutes) * 100
}

const formatPlayTime = (minutes: number): string => {
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

async function loadData() {
  loading.value = true
  error.value = null
  try {
    mapStats.value = await fetchPlayerMapStats(
      props.playerName,
      props.game || 'bf1942',
      30,
    )
  } catch (err) {
    error.value = 'Failed to load map preferences'
    console.error(err)
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
watch(() => props.playerName, loadData)
</script>

<template>
  <section class="mm-mappref">
    <header class="mm-mappref__head">
      <div class="mm-eyebrow mm-eyebrow--strong">Recent map preference</div>
      <div class="mm-card__hint">last 30 days</div>
    </header>

    <div v-if="loading" class="mm-mappref__state">
      <div v-for="i in 3" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">{{ error }}</div>

    <div v-else-if="!topMap" class="mm-empty">No map activity in the last 30 days.</div>

    <template v-else>
      <button
        type="button"
        class="mm-mappref__hero"
        @click="emit('navigateToMap', topMap.mapName)"
      >
        <div class="mm-eyebrow">Top map</div>
        <h3 class="mm-h2 mm-mappref__hero-name">{{ topMap.mapName }}</h3>
        <div class="mm-mappref__hero-stats">
          <div>
            <div class="mm-stats__label">K/D</div>
            <div class="mm-stat__value mm-stat__value--small" :class="kdClass(calculateKD(topMap))">
              {{ calculateKD(topMap).toFixed(2) }}
            </div>
          </div>
          <div>
            <div class="mm-stats__label">Sessions</div>
            <div class="mm-stat__value mm-stat__value--small">{{ topMap.sessionsPlayed }}</div>
          </div>
          <div>
            <div class="mm-stats__label">Playtime</div>
            <div class="mm-stat__value mm-stat__value--small">{{ formatPlayTime(topMap.totalPlayTimeMinutes) }}</div>
          </div>
        </div>
      </button>

      <div v-if="topMaps.length > 1" class="mm-mappref__bars">
        <div class="mm-eyebrow">Recent activity</div>
        <button
          v-for="(map, index) in topMaps.slice(0, 5)"
          :key="map.mapName"
          type="button"
          class="mm-mappref__row"
          @click="emit('navigateToMap', map.mapName)"
        >
          <span class="mm-list__rank">{{ String(index + 1).padStart(2, '0') }}</span>
          <span class="mm-mappref__row-name">{{ map.mapName }}</span>
          <div class="mm-list__bar mm-mappref__row-bar">
            <div
              class="mm-list__bar-fill"
              :class="{ 'mm-list__bar-fill--accent': index === 0 }"
              :style="{ width: getBarWidth(map) + '%' }"
            />
          </div>
          <span class="mm-mappref__row-value">{{ formatPlayTime(map.totalPlayTimeMinutes) }}</span>
        </button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.mm-mappref {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.mm-mappref__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.mm-mappref__state { padding: 14px 0; }

.mm-mappref__hero {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  padding: 18px 20px;
  cursor: pointer;
  color: var(--mm-ink);
  transition: border-color 0.12s ease, background-color 0.12s ease;
}

.mm-mappref__hero:hover {
  background: var(--mm-bg-soft);
  border-color: var(--mm-ink);
}

.mm-mappref__hero-name {
  margin: 6px 0 14px;
}

.mm-mappref__hero-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--mm-rule);
}

.mm-mappref__bars {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mm-mappref__row {
  display: grid;
  grid-template-columns: 28px 1fr 120px auto;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--mm-rule);
  cursor: pointer;
  color: var(--mm-ink);
  text-align: left;
}

.mm-mappref__row:hover .mm-mappref__row-name { color: var(--mm-accent); }

.mm-mappref__row-name {
  font-family: var(--mm-font-display);
  font-size: 13.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.12s ease;
}

.mm-mappref__row-bar { width: 120px; }

.mm-mappref__row-value {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  color: var(--mm-ink-muted);
  text-align: right;
}

@media (max-width: 720px) {
  .mm-mappref__hero-stats {
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .mm-mappref__row {
    grid-template-columns: 28px 1fr 60px auto;
    gap: 8px;
  }
  .mm-mappref__row-bar { width: 60px; }
}
</style>
