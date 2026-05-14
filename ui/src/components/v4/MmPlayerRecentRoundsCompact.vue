<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import type { Session } from '@/types/playerStatsTypes'
import { formatDate } from '@/utils/timeUtils'
import { kdClass } from '@/views/v4/mmTokens'

const props = defineProps<{
  sessions: Session[]
  playerName: string
}>()

const router = useRouter()

const compactSessions = computed(() => (props.sessions ?? []).slice(0, 5))

const formatPlacement = (placement: number | null): string => {
  if (!placement || placement <= 0) return '—'
  return `#${placement}`
}

const resultLabel = (result: Session['teamResult']): string => {
  if (result === 'win') return 'Win'
  if (result === 'loss') return 'Loss'
  if (result === 'tie') return 'Draw'
  return '—'
}

const resultChipClass = (result: Session['teamResult']): string => {
  if (result === 'win') return 'mm-chip--win'
  if (result === 'loss') return 'mm-chip--loss'
  return ''
}

const kdValue = (s: Session): number => {
  if (s.totalDeaths === 0) return s.totalKills
  return s.totalKills / s.totalDeaths
}

const navigateToRoundReport = (session: Session) => {
  router.push({
    path: `/v4/rounds/${encodeURIComponent(session.roundId)}/report`,
    query: { players: props.playerName },
  })
}
</script>

<template>
  <div>
    <div class="mm-eyebrow" style="margin-bottom: 8px">Tap any round for the full debrief — timeline · phase charts · player breakdown</div>

    <table class="mm-list">
      <thead>
        <tr>
          <th>Result</th>
          <th>Map · server</th>
          <th class="is-num">Score</th>
          <th class="is-num">Rank</th>
          <th class="is-num">K / D</th>
          <th class="is-num">Date</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(session, index) in compactSessions"
          :key="`${session.roundId}-${session.sessionId}-${index}`"
          @click="navigateToRoundReport(session)"
        >
          <td data-cell-label="Result">
            <span class="mm-chip" :class="resultChipClass(session.teamResult)">
              {{ resultLabel(session.teamResult) }}
            </span>
          </td>
          <td class="mm-list__name-cell">
            <div class="mm-list__name">
              <span class="mm-list__name-primary">{{ session.mapName }}</span>
              <span class="mm-list__name-sub">{{ session.serverName }}</span>
            </div>
          </td>
          <td class="is-num" data-cell-label="Score">{{ session.totalScore.toLocaleString() }}</td>
          <td
            class="is-num"
            data-cell-label="Rank"
            :class="session.placement && session.placement <= 3 ? 'mm-num--score' : 'is-muted'"
          >
            {{ formatPlacement(session.placement) }}
          </td>
          <td class="is-num" data-cell-label="K / D">
            <span class="mm-num--kill">{{ session.totalKills }}</span>
            <span class="mm-num__sep">/</span>
            <span class="mm-num--death">{{ session.totalDeaths }}</span>
            <span class="mm-num__sep">·</span>
            <span :class="kdClass(kdValue(session))">{{ kdValue(session).toFixed(2) }}</span>
          </td>
          <td class="is-num is-muted" data-cell-label="Date">{{ formatDate(session.startTime) }}</td>
        </tr>
        <tr v-if="compactSessions.length === 0">
          <td colspan="6" class="mm-empty" style="border: 0">No recent rounds.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
