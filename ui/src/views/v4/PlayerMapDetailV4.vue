<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { decodePlayerName } from '@/utils/playerName'
import MmMapRankingsPanel from '@/components/v4/MmMapRankingsPanel.vue'
import type { GameType } from '@/services/dataExplorerService'

const route = useRoute()

const rawName = computed(() => decodeURIComponent(route.params.playerName as string))
const displayName = computed(() => decodePlayerName(rawName.value))
const mapName = computed(() => decodeURIComponent(route.params.mapName as string))
// Game id flows through the query string so we don't conflate the player's
// primary game with the URL. Falls back to bf1942 (the only tracked game).
const game = computed<GameType>(() => {
  const g = (route.query.game as string) || 'bf1942'
  if (g === 'fh2' || g === 'bfvietnam') return g
  return 'bf1942'
})
</script>

<template>
  <div class="mm-container mm-section">
    <div class="mm-meta-row" style="margin-bottom: 14px">
      <router-link
        :to="`/v4/players/${encodeURIComponent(rawName)}?tab=maps`"
        class="mm-meta-row__strong"
        style="text-decoration: underline; text-underline-offset: 3px"
      >‹ {{ displayName }} · MAPS</router-link>
    </div>

    <h1 class="mm-display">
      {{ mapName }}
      <span class="mm-display__muted">· {{ displayName }}</span>
    </h1>

    <hr class="mm-rule" style="margin-top: 24px; margin-bottom: 24px" />

    <MmMapRankingsPanel
      :map-name="mapName"
      :highlight-player="rawName"
      :game="game"
    />
  </div>
</template>
