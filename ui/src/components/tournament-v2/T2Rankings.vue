<template>
  <div>
    <div class="t2-section-head">
      <span class="t2-section-head__mark">//</span>
      <div>
        <h2 class="t2-section-head__title">Season leaderboard</h2>
        <div class="t2-section-head__sub">Ranked by points across all completed matches</div>
      </div>
      <div
        v-if="weeks.length"
        class="t2-filter"
        style="margin-left: auto"
      >
        <button
          class="t2-filter__btn"
          :class="{ 't2-filter__btn--active': selectedWeek === null }"
          @click="selectWeek(null)"
        >
          Overall
        </button>
        <button
          v-for="week in weeks"
          :key="week"
          class="t2-filter__btn"
          :class="{ 't2-filter__btn--active': selectedWeek === week }"
          @click="selectWeek(week)"
        >
          {{ week }}
        </button>
      </div>
    </div>

    <div
      v-if="loading"
      class="t2-loading"
      style="min-height: 200px"
    >
      <div class="t2-spinner" />
    </div>

    <div
      v-else-if="rankings.length === 0"
      class="t2-empty"
    >
      No completed matches reported yet.
    </div>

    <template v-else>
      <div class="t2-table-wrap">
        <table class="t2-table">
          <thead>
            <tr>
              <th
                class="t2-table__left"
                style="width: 38px"
              >#</th>
              <th class="t2-table__left">Team</th>
              <th>MP</th>
              <th>V</th>
              <th>T</th>
              <th>L</th>
              <th>RW</th>
              <th>RT</th>
              <th>RL</th>
              <th>TF</th>
              <th>TA</th>
              <th>+/-</th>
              <th class="t2-table__accent">PTS</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="team in rankings"
              :key="team.teamId"
            >
              <td
                class="t2-table__left t2-table__rank"
                :class="rankClass(team.rank)"
              >{{ team.rank }}</td>
              <td class="t2-table__left">
                <span class="t2-table__team-name">{{ team.teamName }}</span>
              </td>
              <td>{{ team.matchesPlayed }}</td>
              <td class="t2-table__ink">{{ team.victories }}</td>
              <td>{{ team.ties }}</td>
              <td>{{ team.losses }}</td>
              <td class="t2-table__ink">{{ team.roundsWon }}</td>
              <td>{{ team.roundsTied }}</td>
              <td>{{ team.roundsLost }}</td>
              <td class="t2-table__ink">{{ team.ticketsFor.toLocaleString() }}</td>
              <td>{{ team.ticketsAgainst.toLocaleString() }}</td>
              <td :style="{ color: diffTint(team.ticketDifferential) }">{{ formatDiff(team.ticketDifferential) }}</td>
              <td class="t2-table__pts">{{ team.points }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div
        class="t2-eyebrow"
        style="margin-top: 14px"
      >
        MP matches · V/T/L · RW/RT/RL rounds · TF/TA tickets · +/- differential · PTS points
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import type { PublicTournamentDetail, PublicTeamRanking } from '@/services/publicTournamentService'
import { publicTournamentService } from '@/services/publicTournamentService'

const props = defineProps<{
  tournament: PublicTournamentDetail
  tournamentId: string
}>()

const rankings = ref<PublicTeamRanking[]>([])
const loading = ref(true)
const selectedWeek = ref<string | null>(null)

// Week choices come from the schedule groups (non-null weeks, in schedule order)
const weeks = computed(() => {
  const seen = new Set<string>()
  const list: string[] = []
  for (const group of props.tournament.matchesByWeek ?? []) {
    if (group.week && !seen.has(group.week)) {
      seen.add(group.week)
      list.push(group.week)
    }
  }
  return list
})

const loadLeaderboard = async () => {
  loading.value = true
  try {
    const data = await publicTournamentService.getLeaderboard(props.tournamentId, selectedWeek.value ?? undefined)
    rankings.value = data.rankings ?? []
  } catch (err) {
    console.error('Failed to load leaderboard:', err)
    rankings.value = []
  } finally {
    loading.value = false
  }
}

const selectWeek = (week: string | null) => {
  if (selectedWeek.value === week) return
  selectedWeek.value = week
  loadLeaderboard()
}

const rankClass = (rank: number) => (rank >= 1 && rank <= 3 ? `t2-rank--${rank}` : undefined)
const formatDiff = (diff: number) => (diff >= 0 ? '+' : '') + diff.toLocaleString()
const diffTint = (diff: number) =>
  diff > 0 ? 'var(--t-accent)' : diff < 0 ? 'var(--t-muted)' : 'var(--t-text)'

onMounted(loadLeaderboard)
watch(() => props.tournamentId, () => {
  selectedWeek.value = null
  loadLeaderboard()
})
</script>
