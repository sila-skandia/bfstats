<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { decodePlayerName } from '@/utils/playerName'
import MmPlayerAchievementSummary from '@/components/v4/MmPlayerAchievementSummary.vue'

const route = useRoute()

const rawName = computed(() => decodeURIComponent(route.params.playerName as string))
const displayName = computed(() => decodePlayerName(rawName.value))
</script>

<template>
  <div class="mm-container mm-section">
    <div class="mm-meta-row" style="margin-bottom: 14px">
      <router-link
        :to="`/v4/players/${encodeURIComponent(rawName)}`"
        class="mm-meta-row__strong"
        style="text-decoration: underline; text-underline-offset: 3px"
      >
        ← Back to {{ displayName }}
      </router-link>
    </div>

    <h1 class="mm-display">
      Achievements
      <span class="mm-display__muted">· {{ displayName }}</span>
    </h1>

    <hr class="mm-rule" style="margin-top: 24px; margin-bottom: 24px" />

    <MmPlayerAchievementSummary :player-name="rawName" />
  </div>
</template>
