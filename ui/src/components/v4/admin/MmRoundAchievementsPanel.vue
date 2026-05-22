<template>
  <div class="mm-admin-card mm-admin-round-ach">
    <div class="mm-admin-card__head mm-admin-round-ach__head">
      <h3 class="mm-admin-card__title mm-admin-card__title--strong">
        Achievements in round
      </h3>
      <button
        type="button"
        class="mm-admin-round-ach__close"
        aria-label="Close achievements panel"
        @click="$emit('close')"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>

    <div class="mm-admin-card__body mm-admin-round-ach__body">
      <div v-if="loading" class="mm-admin-empty mm-admin-empty--loading">
        <span class="mm-admin-spinner" aria-hidden="true" />
        <span class="mm-admin-empty__text">Loading…</span>
      </div>

      <div v-else-if="!achievements || achievements.length === 0" class="mm-admin-empty">
        <span class="mm-admin-empty__title">No achievements</span>
        <span class="mm-admin-empty__desc">No achievements were recorded in this round.</span>
      </div>

      <div v-else class="mm-admin-table-wrap">
        <table class="mm-admin-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Achievement</th>
              <th>Tier</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(a, i) in achievements"
              :key="`${a.playerName}-${a.achievedAt}-${i}`"
            >
              <td>{{ $pn(a.playerName) }}</td>
              <td class="mm-admin-round-ach__cell">
                <img
                  :src="getAchievementImage(a.achievementId, a.tier)"
                  :alt="a.achievementName"
                  class="mm-admin-round-ach__img"
                  @error="(e) => { (e.target as HTMLImageElement).src = getAchievementImage('kill_streak_10'); }"
                >
                {{ a.achievementName }}
              </td>
              <td class="mm-admin-mono mm-admin-round-ach__tier">{{ a.tier || '–' }}</td>
              <td class="mm-admin-mono">{{ formatTime(a.achievedAt) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getAchievementImageFromObject } from '@/utils/achievementImageUtils'
import type { RoundAchievement } from '@/services/adminDataService'

defineProps<{
  roundId: string
  achievements: RoundAchievement[]
  loading: boolean
}>()

defineEmits<{
  close: []
}>()

function getAchievementImage(achievementId: string, tier?: string): string {
  return getAchievementImageFromObject({ achievementId, tier: tier ?? '' })
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}
</script>

<style scoped>
.mm-admin-round-ach__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.mm-admin-round-ach__close {
  background: transparent;
  border: 1px solid var(--mm-rule);
  border-radius: 999px;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  color: var(--mm-ink-muted);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.mm-admin-round-ach__close:hover {
  color: var(--mm-ink);
  border-color: var(--mm-ink);
}

.mm-admin-round-ach__body { padding: 0; }
.mm-admin-round-ach__body .mm-admin-empty { padding: 36px 24px; gap: 8px; }
.mm-admin-round-ach__body .mm-admin-table { border-top: 0; }

.mm-admin-round-ach__cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mm-admin-round-ach__img {
  width: 22px;
  height: 22px;
  object-fit: contain;
  flex-shrink: 0;
}

.mm-admin-round-ach__tier {
  text-transform: capitalize;
}
</style>
