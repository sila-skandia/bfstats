<template>
  <div class="mm-admin-card mm-admin-round">
    <div
      v-if="detail.isDeleted"
      class="mm-admin-round__deleted-banner"
    >
      This round has been marked as deleted. It is excluded from stats and
      aggregates. Achievements were removed; round and sessions remain for
      recovery.
      <span
        v-if="undeleteError"
        class="mm-admin-round__deleted-err"
      >{{ undeleteError }}</span>
    </div>

    <div class="mm-admin-card__head mm-admin-round__head">
      <div class="mm-admin-round__meta">
        <h3 class="mm-admin-card__title mm-admin-card__title--strong">
          Round {{ detail.roundId }}
        </h3>
        <div
          v-if="detail.mapName || detail.serverName || detail.startTime"
          class="mm-admin-round__tags"
        >
          <span v-if="detail.mapName" class="mm-admin-round__tag">{{ detail.mapName }}</span>
          <span v-if="detail.serverName" class="mm-admin-round__tag">{{ detail.serverName }}</span>
          <span
            v-if="detail.startTime"
            class="mm-admin-round__tag mm-admin-mono"
          >{{ formatDate(detail.startTime) }}</span>
        </div>
      </div>

      <button
        v-if="canDelete && !detail.isDeleted"
        type="button"
        class="mm-admin-btn mm-admin-btn--danger mm-admin-btn--sm"
        :disabled="loading"
        @click="$emit('delete')"
      >
        Delete round
      </button>
      <button
        v-else-if="canDelete && detail.isDeleted"
        type="button"
        class="mm-admin-btn mm-admin-btn--primary mm-admin-btn--sm"
        :disabled="loading"
        @click="$emit('undelete')"
      >
        Undelete round
      </button>
    </div>

    <div class="mm-admin-card__body">
      <div class="mm-admin-mini-stats mm-admin-round__stats">
        <div class="mm-admin-mini-stat">
          <span class="mm-admin-mini-stat__label">Players</span>
          <span class="mm-admin-mini-stat__value">{{ detail.players.length }}</span>
        </div>

        <div class="mm-admin-mini-stat mm-admin-mini-stat--warn">
          <span class="mm-admin-mini-stat__label">Achievements to delete</span>
          <span class="mm-admin-mini-stat__value">
            {{ achievementCount }}
            <button
              v-if="achievementCount > 0"
              type="button"
              class="mm-admin-cell-btn"
              @click="$emit('viewAchievements')"
            >
              View
            </button>
          </span>
        </div>

        <div
          v-if="detail.observationCountToDelete != null"
          class="mm-admin-mini-stat"
        >
          <span class="mm-admin-mini-stat__label">Observations</span>
          <span class="mm-admin-mini-stat__value">{{ detail.observationCountToDelete }}</span>
        </div>

        <div
          v-if="detail.sessionCountToDelete != null"
          class="mm-admin-mini-stat"
        >
          <span class="mm-admin-mini-stat__label">Sessions</span>
          <span class="mm-admin-mini-stat__value">{{ detail.sessionCountToDelete }}</span>
        </div>
      </div>

      <div class="mm-admin-round__players">
        <div class="mm-admin-round__players-head">Players in round</div>
        <div class="mm-admin-table-wrap">
          <table class="mm-admin-table">
            <thead>
              <tr>
                <th>Player</th>
                <th class="is-num">Score</th>
                <th class="is-num">Kills</th>
                <th class="is-num">Deaths</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in playersByScoreDesc"
                :key="p.playerName"
              >
                <td>{{ $pn(p.playerName) }}</td>
                <td class="is-num">{{ pickScore(p) }}</td>
                <td class="is-num">{{ pickKills(p) }}</td>
                <td class="is-num">{{ pickDeaths(p) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RoundDetailResponse, RoundPlayerEntry } from '@/services/adminDataService'

const props = withDefaults(
  defineProps<{
    detail: RoundDetailResponse
    loading?: boolean
    undeleteError?: string | null
    canDelete?: boolean
  }>(),
  { canDelete: false },
)

defineEmits<{
  delete: []
  undelete: []
  viewAchievements: []
}>()

const achievementCount = computed(() => props.detail.achievementCountToDelete ?? 0)

const playersByScoreDesc = computed(() => {
  const players = [...(props.detail.players ?? [])]
  return players.sort((a, b) => pickScore(b) - pickScore(a))
})

function pickScore(p: RoundPlayerEntry): number {
  return p.totalScore ?? p.score ?? 0
}
function pickKills(p: RoundPlayerEntry): number {
  return p.totalKills ?? p.kills ?? 0
}
function pickDeaths(p: RoundPlayerEntry): number {
  return p.totalDeaths ?? p.deaths ?? 0
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return iso
  }
}
</script>

<style scoped>
.mm-admin-round__deleted-banner {
  padding: 10px 16px;
  font-size: 12px;
  color: var(--mm-load-busy);
  background: rgba(197, 162, 58, 0.10);
  border-bottom: 1px solid rgba(197, 162, 58, 0.30);
  line-height: 1.5;
}

.mm-admin-round__deleted-err {
  display: block;
  margin-top: 6px;
  color: var(--mm-danger);
  font-size: 11.5px;
}

.mm-admin-round__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}

.mm-admin-round__meta {
  flex: 1;
  min-width: 0;
}

.mm-admin-round__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 6px;
  font-size: 12px;
  color: var(--mm-ink-muted);
}

.mm-admin-round__stats {
  margin-bottom: 16px;
}

.mm-admin-round__players {
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  overflow: hidden;
}

.mm-admin-round__players-head {
  padding: 8px 14px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--mm-ink-muted);
  background: var(--mm-bg-soft);
  border-bottom: 1px solid var(--mm-rule);
}
</style>
