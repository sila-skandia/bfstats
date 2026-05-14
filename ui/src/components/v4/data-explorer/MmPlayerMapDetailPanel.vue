<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import MmMapRankingsPanel from '@/components/v4/MmMapRankingsPanel.vue'
import { kdClass } from '@/views/v4/mmTokens'
import type { GameType } from '@/services/dataExplorerService'

const props = defineProps<{
  mapName: string
  playerName: string
  game?: GameType
}>()

const emit = defineEmits<{
  close: []
  navigateToServer: [serverGuid: string]
}>()

interface PlayerMapStats {
  totalScore: number
  totalKills: number
  totalDeaths: number
  totalRounds: number
  playTimeMinutes: number
}

const isLoading = ref(true)
const error = ref<string | null>(null)
const playerStats = ref<PlayerMapStats | null>(null)

const kdRatio = computed(() => {
  if (!playerStats.value) return 0
  return playerStats.value.totalKills / Math.max(1, playerStats.value.totalDeaths)
})

const formatPlayTime = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  const rem = hours % 24
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`
}

const loadData = async () => {
  isLoading.value = true
  error.value = null
  try {
    const response = await fetch(
      `/stats/players/${encodeURIComponent(props.playerName)}/map-stats?game=${props.game || 'bf1942'}&days=365`,
    )
    if (!response.ok) throw new Error('Failed to load player map statistics')
    const mapsList = await response.json()
    const mapData = mapsList.find((m: any) => m.mapName.toLowerCase() === props.mapName.toLowerCase())
    if (mapData) {
      playerStats.value = {
        totalScore: mapData.totalScore,
        totalKills: mapData.totalKills,
        totalDeaths: mapData.totalDeaths,
        totalRounds: mapData.sessionsPlayed,
        playTimeMinutes: mapData.totalPlayTimeMinutes,
      }
    } else {
      playerStats.value = null
    }
  } catch (err: any) {
    console.error('Error loading player map data:', err)
    error.value = err.message || 'Failed to load data'
  } finally {
    isLoading.value = false
  }
}

onMounted(loadData)
watch(() => [props.mapName, props.playerName, props.game], loadData)
</script>

<template>
  <section class="mm-pmdp">
    <header class="mm-pmdp__head">
      <button type="button" class="mm-btn mm-btn--inline mm-pmdp__back" @click="emit('close')">←</button>
      <div class="mm-pmdp__head-text">
        <div class="mm-eyebrow">{{ $pn(playerName) }} · last 365 days</div>
        <h2 class="mm-h2 mm-pmdp__title">{{ mapName }}</h2>
      </div>
    </header>

    <hr class="mm-rule" />

    <div v-if="isLoading" class="mm-pmdp__state">
      <div v-for="i in 3" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error" class="mm-empty">{{ error }}</div>

    <div v-else-if="!playerStats" class="mm-empty">
      {{ $pn(playerName) }} hasn't played {{ mapName }} in the last 365 days.
    </div>

    <template v-else>
      <div class="mm-stats" style="border-top: 0">
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Score</div>
          <div class="mm-stat__value mm-stat__value--small">{{ playerStats.totalScore.toLocaleString() }}</div>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">K/D</div>
          <div class="mm-stat__value mm-stat__value--small" :class="kdClass(kdRatio)">{{ kdRatio.toFixed(2) }}</div>
          <div class="mm-stat__delta">
            <span class="mm-num--kill">{{ playerStats.totalKills.toLocaleString() }}</span>
            <span class="mm-num__sep">/</span>
            <span class="mm-num--death">{{ playerStats.totalDeaths.toLocaleString() }}</span>
          </div>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Rounds</div>
          <div class="mm-stat__value mm-stat__value--small">{{ playerStats.totalRounds.toLocaleString() }}</div>
        </div>
        <div class="mm-stats__cell">
          <div class="mm-stats__label">Playtime</div>
          <div class="mm-stat__value mm-stat__value--small">{{ formatPlayTime(playerStats.playTimeMinutes) }}</div>
        </div>
      </div>

      <div class="mm-pmdp__section">
        <MmMapRankingsPanel
          :map-name="mapName"
          :game="game || 'bf1942'"
          :highlight-player="playerName"
        />
      </div>
    </template>
  </section>
</template>

<style scoped>
.mm-pmdp {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.mm-pmdp__head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.mm-pmdp__back { flex-shrink: 0; margin-top: 2px; }

.mm-pmdp__head-text { flex: 1; min-width: 0; }
.mm-pmdp__title { margin: 6px 0 0; }

.mm-pmdp__state { padding: 14px 0; }

.mm-pmdp__section { display: flex; flex-direction: column; gap: 14px; }
</style>
