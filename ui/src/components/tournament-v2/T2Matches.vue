<template>
  <div>
    <div
      v-if="weekGroups.length === 0"
      class="t2-empty"
    >
      No matches scheduled yet.
    </div>

    <template v-else>
      <div
        class="t2-eyebrow"
        style="margin-bottom: 18px"
      >
        Times shown in your local time
      </div>

      <section
        v-for="group in weekGroups"
        :key="group.key"
        style="margin-bottom: 40px"
      >
        <div
          class="t2-section-head"
          style="margin-bottom: 8px"
        >
          <span class="t2-section-head__mark">//</span>
          <h2
            class="t2-section-head__title"
            style="font-size: 22px"
          >{{ group.title }}</h2>
          <span class="t2-section-head__meta">{{ group.meta }}</span>
        </div>

        <div
          v-for="entry in group.matches"
          :key="entry.match.id"
          class="t2-match"
        >
          <div class="t2-match__meta">
            <div class="t2-match__meta-left">
              <span :title="formatLocalTooltip(entry.match.scheduledDate)">{{ formatAbsoluteTime(entry.match.scheduledDate) }}</span>
              <template v-if="entry.match.serverName">
                <span style="color: var(--t-faint)">·</span>
                <span>{{ entry.match.serverName }}</span>
              </template>
            </div>
            <span
              v-if="entry.scheduled"
              class="t2-badge t2-badge--outline-accent"
            >Scheduled</span>
          </div>

          <div class="t2-match__scoreline">
            <div class="t2-match__team">
              <div
                class="t2-match__team-name"
                :class="{ 't2-match__team-name--winner': entry.winner !== 'team2' }"
              >{{ entry.match.team1Name }}</div>
              <div
                v-if="teamTag(entry.match.team1Name)"
                class="t2-eyebrow"
              >[{{ teamTag(entry.match.team1Name) }}]</div>
            </div>
            <div class="t2-match__center">
              <div class="t2-match__tickets">{{ entry.tickets }}</div>
              <div
                v-if="entry.rounds"
                class="t2-match__rounds"
              >{{ entry.rounds }}</div>
              <div class="t2-match__badge-row">
                <span
                  class="t2-badge"
                  :class="{ 't2-badge--win': entry.badgeWin }"
                >{{ entry.badge }}</span>
              </div>
            </div>
            <div class="t2-match__team t2-match__team--right">
              <div
                class="t2-match__team-name"
                :class="{ 't2-match__team-name--winner': entry.winner !== 'team1' }"
              >{{ entry.match.team2Name }}</div>
              <div
                v-if="teamTag(entry.match.team2Name)"
                class="t2-eyebrow"
              >[{{ teamTag(entry.match.team2Name) }}]</div>
            </div>
          </div>

          <template v-if="entry.match.maps?.length && !entry.scheduled">
            <div class="t2-match__maps">
              <div
                v-for="map in entry.match.maps"
                :key="map.id"
                class="t2-map-tile"
              >
                <div
                  class="t2-map-tile__art"
                  :style="mapArtStyle(map)"
                >
                  <div class="t2-map-tile__scrim" />
                  <div class="t2-map-tile__label">
                    <span class="t2-map-tile__name">{{ map.mapName }}</span>
                    <span class="t2-map-tile__order">MAP #{{ map.mapOrder + 1 }}</span>
                  </div>
                </div>
                <div class="t2-map-tile__detail">
                  <div
                    v-if="map.teamName"
                    class="t2-map-tile__picked"
                  >Picked by {{ map.teamName }}</div>
                  <div class="t2-map-tile__rounds">
                    <span
                      v-for="(result, i) in map.matchResults"
                      :key="result.id"
                    >R{{ i + 1 }} <strong>{{ result.team1Tickets }} – {{ result.team2Tickets }}</strong></span>
                    <span v-if="!map.matchResults?.length">No rounds reported</span>
                  </div>
                </div>
              </div>
            </div>
            <button
              class="t2-match__details-link"
              @click="openMatch(entry.match)"
            >
              Match details &amp; demos <i
                class="pi pi-arrow-up-right"
                style="font-size: 10px"
              />
            </button>
          </template>
        </div>
      </section>
    </template>

    <T2MatchDetailsModal
      :match="selectedMatch"
      :teams="tournament.teams || []"
      :tournament-id="tournamentId"
      :tournament="tournament"
      @close="selectedMatch = null"
      @compare-players="comparePlayers"
    />
  </div>
</template>

<script setup lang="ts">
// Icon font for the `pi pi-*` classes in this component's template. Imported
// here rather than via a <link> in index.html so it ships in this route's CSS
// chunk — it used to be a render-blocking stylesheet fetched from unpkg.com on
// every page load, including the three routes that never use an icon from it.
import 'primeicons/primeicons.css'
import { ref, computed } from 'vue'
import type { PublicTournamentDetail, PublicTournamentMatch, PublicTournamentMatchMap } from '@/services/publicTournamentService'
import T2MatchDetailsModal from './T2MatchDetailsModal.vue'
import { usePlayerComparison } from '@/composables/usePlayerComparison'
import { formatAbsoluteTime, formatLocalTooltip } from '@/utils/timeUtils'

const props = defineProps<{
  tournament: PublicTournamentDetail
  tournamentId: string
}>()

const { comparePlayers } = usePlayerComparison()

const selectedMatch = ref<PublicTournamentMatch | null>(null)
const openMatch = (match: PublicTournamentMatch) => { selectedMatch.value = match }

const tagByTeamName = computed(() => {
  const map = new Map<string, string>()
  for (const team of props.tournament.teams ?? []) {
    if (team.tag) map.set(team.name, team.tag)
  }
  return map
})
const teamTag = (name: string) => tagByTeamName.value.get(name)

interface MatchEntry {
  match: PublicTournamentMatch
  scheduled: boolean
  winner: 'team1' | 'team2' | 'tie'
  tickets: string
  rounds: string
  badge: string
  badgeWin: boolean
}

const buildEntry = (match: PublicTournamentMatch): MatchEntry => {
  let team1Tickets = 0
  let team2Tickets = 0
  let team1Rounds = 0
  let team2Rounds = 0
  let roundCount = 0

  for (const map of match.maps ?? []) {
    for (const result of map.matchResults ?? []) {
      roundCount++
      team1Tickets += result.team1Tickets
      team2Tickets += result.team2Tickets
      if (result.team1Tickets > result.team2Tickets) team1Rounds++
      else if (result.team2Tickets > result.team1Tickets) team2Rounds++
    }
  }

  const scheduled = roundCount === 0
  let winner: MatchEntry['winner'] = 'tie'
  if (team1Rounds !== team2Rounds) winner = team1Rounds > team2Rounds ? 'team1' : 'team2'
  else if (team1Tickets !== team2Tickets) winner = team1Tickets > team2Tickets ? 'team1' : 'team2'

  return {
    match,
    scheduled,
    winner,
    tickets: scheduled ? '—' : `${team1Tickets} – ${team2Tickets}`,
    rounds: scheduled ? '' : `${team1Rounds}–${team2Rounds}`,
    badge: scheduled
      ? 'Upcoming'
      : winner === 'tie' ? 'Tie' : `${winner === 'team1' ? match.team1Name : match.team2Name} win`,
    badgeWin: !scheduled && winner !== 'tie',
  }
}

const weekGroups = computed(() => {
  const groups = props.tournament.matchesByWeek ?? []
  return groups
    .filter(g => g.matches.length > 0)
    .map((g, i) => {
      const matches = g.matches.map(buildEntry)
      const complete = matches.filter(m => !m.scheduled).length
      const meta = complete === matches.length
        ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'} · complete`
        : complete === 0
          ? `${matches.length} ${matches.length === 1 ? 'match' : 'matches'} · scheduled`
          : `${complete} of ${matches.length} played`
      return { key: g.week ?? `group-${i}`, title: g.week ?? 'Schedule', meta, matches }
    })
})

// Map tile art: uploaded image when present, deterministic gradient otherwise
const mapArtStyle = (map: PublicTournamentMatchMap) => {
  if (map.imagePath) {
    return { backgroundImage: `url(/stats/assets/tournaments/${map.imagePath})` }
  }
  let hash = 0
  for (const ch of map.mapName) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const hue = hash % 360
  return {
    backgroundImage: `linear-gradient(135deg, hsl(${hue} 18% 26%), hsl(${hue} 22% 12%))`,
  }
}
</script>
