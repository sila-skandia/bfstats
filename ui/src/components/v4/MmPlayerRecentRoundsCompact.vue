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

    <!-- Mobile: shared mm-session-row pattern (win/loss chip + map + sub + stats).
         Desktop: original wide table for at-a-glance scanning. -->
    <ol class="mm-recent-rounds__cards">
      <li
        v-for="(session, index) in compactSessions"
        :key="`m-${session.roundId}-${session.sessionId}-${index}`"
        class="mm-session-row"
        :class="{
          'mm-session-row--win': session.teamResult === 'win',
          'mm-session-row--loss': session.teamResult === 'loss',
        }"
        @click="navigateToRoundReport(session)"
      >
        <span class="mm-session-row__chip">{{ resultLabel(session.teamResult) }}</span>
        <span class="mm-session-row__map">{{ session.mapName }}</span>
        <span class="mm-session-row__date">{{ formatDate(session.startTime) }}</span>
        <span class="mm-session-row__server">{{ session.serverName }}</span>
        <span class="mm-session-row__stats">
          {{ session.totalScore.toLocaleString() }}
          <span class="mm-num__sep">·</span>
          {{ formatPlacement(session.placement) }}
          <span class="mm-num__sep">·</span>
          <span class="mm-num--kill">{{ session.totalKills }}</span><span class="mm-num__sep">/</span><span class="mm-num--death">{{ session.totalDeaths }}</span>
          <span class="mm-num__sep">·</span>
          <span :class="kdClass(kdValue(session))">{{ kdValue(session).toFixed(2) }}</span>
        </span>
      </li>
      <li v-if="compactSessions.length === 0" class="mm-empty" style="border: 0; padding: 24px 0; list-style: none">No recent rounds.</li>
    </ol>

    <table class="mm-list mm-recent-rounds__table">
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
          :key="`d-${session.roundId}-${session.sessionId}-${index}`"
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

<style scoped>
.mm-recent-rounds__cards { display: none; list-style: none; margin: 0; padding: 0; }
@media (max-width: 720px) {
  .mm-recent-rounds__table { display: none; }
  .mm-recent-rounds__cards { display: flex; flex-direction: column; }
  .mm-recent-rounds__cards .mm-session-row { cursor: pointer; }
}
</style>
