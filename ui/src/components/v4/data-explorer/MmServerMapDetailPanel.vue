<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { fetchServerMapDetail, type ServerMapDetail } from '@/services/dataExplorerService'
import MmWinStatsBar from './MmWinStatsBar.vue'
import MmActivityHeatmap from './MmActivityHeatmap.vue'
import MmRecentSessionsList from './MmRecentSessionsList.vue'
import MmMapRankingsPanel from '@/components/v4/MmMapRankingsPanel.vue'

const props = defineProps<{
  serverGuid: string
  mapName: string
  playerName?: string
}>()

const emit = defineEmits<{
  navigateToServer: [serverGuid: string]
  navigateToMap: [mapName: string]
  close: []
  'open-rankings': [mapName: string]
}>()

const detail = ref<ServerMapDetail | null>(null)
const isLoading = ref(false)
const isRefreshing = ref(false)
const error = ref<string | null>(null)
const selectedDays = ref(60)

const activityPatternsForHeatmap = computed(() => detail.value?.activityPatterns ?? [])

const getGameLabel = (game: string): string => {
  switch (game.toLowerCase()) {
    case 'bf1942': return 'BF1942'
    case 'fh2': return 'FH2'
    case 'bfvietnam': return 'BFV'
    default: return game.toUpperCase()
  }
}

const formatPlayTime = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  const rem = hours % 24
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`
}

const loadData = async (isRefresh = false) => {
  if (!props.serverGuid || !props.mapName) return
  if (isRefresh && detail.value) isRefreshing.value = true
  else isLoading.value = true
  error.value = null
  try {
    detail.value = await fetchServerMapDetail(props.serverGuid, props.mapName, selectedDays.value)
  } catch (err) {
    console.error('Error loading server-map detail:', err)
    error.value = 'Failed to load server-map details'
  } finally {
    isLoading.value = false
    isRefreshing.value = false
  }
}

onMounted(() => loadData(false))
watch(() => [props.serverGuid, props.mapName], () => loadData(false))
</script>

<template>
  <section class="mm-smdp">
    <div v-if="isLoading && !detail" class="mm-smdp__state">
      <div v-for="i in 4" :key="i" class="mm-skeleton" style="margin-bottom: 10px" />
    </div>

    <div v-else-if="error && !detail" class="mm-empty">
      {{ error }}
      <button type="button" class="mm-btn mm-btn--inline" style="margin-left: 12px" @click="loadData(false)">Retry</button>
    </div>

    <template v-else-if="detail">
      <header class="mm-smdp__head">
        <button type="button" class="mm-btn mm-btn--inline mm-smdp__back" @click="emit('close')">←</button>
        <div class="mm-smdp__head-text">
          <div class="mm-eyebrow">{{ getGameLabel(detail.game) }} · {{ detail.serverName }}</div>
          <h2 class="mm-h2 mm-smdp__title">{{ detail.mapName }}</h2>
          <span v-if="playerName" class="mm-chip mm-chip--accent" style="margin-top: 6px">Tracking {{ $pn(playerName) }}</span>
        </div>
        <div class="mm-smdp__head-controls">
          <span v-if="isRefreshing" class="mm-eyebrow">Syncing…</span>
          <select v-model="selectedDays" class="mm-smdp__select" @change="loadData(true)">
            <option :value="30">30 days</option>
            <option :value="60">60 days</option>
            <option :value="90">90 days</option>
            <option :value="180">6 months</option>
            <option :value="365">1 year</option>
          </select>
        </div>
      </header>

      <hr class="mm-rule" />

      <section class="mm-smdp__section">
        <div class="mm-eyebrow mm-eyebrow--strong">Traffic intelligence</div>
        <div class="mm-stats" style="border-top: 0">
          <div class="mm-stats__cell">
            <div class="mm-stats__label">Total rounds</div>
            <div class="mm-stat__value mm-stat__value--small">{{ detail.mapActivity.totalRounds.toLocaleString() }}</div>
          </div>
          <div class="mm-stats__cell">
            <div class="mm-stats__label">Engagement time</div>
            <div class="mm-stat__value mm-stat__value--small">{{ formatPlayTime(detail.mapActivity.totalPlayTimeMinutes) }}</div>
          </div>
          <div class="mm-stats__cell">
            <div class="mm-stats__label">Avg population</div>
            <div class="mm-stat__value mm-stat__value--small">{{ detail.mapActivity.avgConcurrentPlayers.toFixed(1) }}</div>
          </div>
          <div class="mm-stats__cell">
            <div class="mm-stats__label">Peak population</div>
            <div class="mm-stat__value mm-stat__value--small">{{ detail.mapActivity.peakConcurrentPlayers }}</div>
          </div>
        </div>

        <div v-if="detail.activityPatterns?.length > 0" style="margin-top: 18px">
          <div class="mm-eyebrow" style="margin-bottom: 8px">Temporal density</div>
          <MmActivityHeatmap :patterns="activityPatternsForHeatmap" />
        </div>
      </section>

      <section class="mm-smdp__section">
        <div class="mm-eyebrow mm-eyebrow--strong">Strategic balance</div>
        <MmWinStatsBar :win-stats="detail.winStats" />
      </section>

      <section class="mm-smdp__section">
        <MmMapRankingsPanel
          :map-name="mapName"
          :server-guid="serverGuid"
          :game="(detail.game as any)"
          :days="selectedDays"
          :highlight-player="playerName"
        />
      </section>

      <section class="mm-smdp__section">
        <div class="mm-eyebrow mm-eyebrow--strong">Recent engagements</div>
        <MmRecentSessionsList
          :server-guid="serverGuid"
          :server-name="detail.serverName"
          :map-name="mapName"
          :limit="5"
          empty-message="No recent sessions logged."
        />
      </section>
    </template>
  </section>
</template>

<style scoped>
.mm-smdp {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.mm-smdp__state { padding: 14px 0; }

.mm-smdp__head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.mm-smdp__back {
  flex-shrink: 0;
  margin-top: 2px;
}

.mm-smdp__head-text { flex: 1; min-width: 0; }
.mm-smdp__title { margin: 6px 0 0; }

.mm-smdp__head-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.mm-smdp__select {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  padding: 5px 8px;
  background: var(--mm-bg);
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  color: var(--mm-ink);
}

.mm-smdp__section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
</style>
