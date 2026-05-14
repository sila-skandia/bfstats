<template>
  <div class="mm-winstats">
    <div class="mm-winstats__labels">
      <span>{{ winStats.team1Label }} <span class="is-muted">({{ winStats.team1WinPercentage }}%)</span></span>
      <span>{{ winStats.team2Label }} <span class="is-muted">({{ winStats.team2WinPercentage }}%)</span></span>
    </div>

    <div class="mm-winstats__bar">
      <div
        v-if="winStats.team1WinPercentage > 0"
        class="mm-winstats__team1"
        :style="{ width: `${winStats.team1WinPercentage}%` }"
        :title="`${winStats.team1Label}: ${winStats.team1Victories} wins (${winStats.team1WinPercentage}%)`"
      />
      <div
        v-if="winStats.team2WinPercentage > 0"
        class="mm-winstats__team2"
        :style="{ width: `${winStats.team2WinPercentage}%` }"
        :title="`${winStats.team2Label}: ${winStats.team2Victories} wins (${winStats.team2WinPercentage}%)`"
      />
    </div>

    <div class="mm-winstats__total">{{ winStats.totalRounds }} total rounds</div>
  </div>
</template>

<script setup lang="ts">
import type { WinStats } from '@/services/dataExplorerService'

defineProps<{
  winStats: WinStats
}>()
</script>

<style scoped>
.mm-winstats {
  width: 100%;
}

.mm-winstats__labels {
  display: flex;
  justify-content: space-between;
  font-family: var(--mm-font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: var(--mm-ink);
  margin-bottom: 6px;
}

.is-muted { color: var(--mm-ink-muted); }

.mm-winstats__bar {
  height: 6px;
  background: var(--mm-bg-mute);
  display: flex;
  overflow: hidden;
  border-radius: 1px;
}

.mm-winstats__team1 {
  background: var(--mm-kill);
  transition: width 0.3s;
}

.mm-winstats__team2 {
  background: var(--mm-ink);
  transition: width 0.3s;
}

.mm-winstats__total {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  color: var(--mm-ink-muted);
  text-align: center;
  margin-top: 6px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
</style>
