<template>
  <Teleport to="body">
    <div
      v-if="match"
      class="t2 t2-modal"
      :style="themeVars"
      @click.self="emit('close')"
    >
      <div class="t2-modal__panel t2-modal__panel--wide">
        <div class="t2-modal__head">
          <div style="min-width: 0">
            <div class="t2-modal__eyebrow">Match details</div>
            <h2 class="t2-modal__title">
              {{ match.team1Name }} <span style="color: var(--t-muted)">vs</span> {{ match.team2Name }}
            </h2>
            <div
              class="t2-modal__sub"
              :title="formatLocalTooltip(match.scheduledDate)"
            >
              {{ formatAbsoluteTime(match.scheduledDate) }}<template v-if="match.serverName"> · {{ match.serverName }}</template>
            </div>
          </div>
          <button
            class="t2-modal__close"
            aria-label="Close"
            @click="emit('close')"
          >×</button>
        </div>

        <div class="t2-modal__body">
          <div class="t2-eyebrow" style="margin-bottom: 14px">Times shown in your local time</div>

          <!-- Maps -->
          <div class="t2-md-maps">
            <div
              v-for="map in match.maps"
              :key="map.id"
              class="t2-md-map"
            >
              <div class="t2-md-map__head">
                <span class="t2-md-map__name">{{ map.mapName }}</span>
                <span
                  v-if="map.teamName"
                  class="t2-md-map__picked"
                >Picked by {{ map.teamName }}</span>
              </div>

              <div class="t2-md-map__body">
                <button
                  v-if="getMapImageUrl(map)"
                  type="button"
                  class="t2-md-map__thumb"
                  :style="{ backgroundImage: `url(${getMapImageUrl(map)})` }"
                  aria-label="View map image"
                  @click="openFullscreenImage(getMapImageUrl(map), map.mapName)"
                >
                  <i class="pi pi-search-plus" />
                </button>

                <div class="t2-md-map__results">
                  <template v-if="map.matchResults && map.matchResults.length > 0">
                    <div class="t2-md-round t2-md-round--head">
                      <span>{{ match.team1Name }}</span>
                      <span>{{ match.team2Name }}</span>
                    </div>
                    <div
                      v-for="result in map.matchResults"
                      :key="`${map.id}-${result.id}`"
                      class="t2-md-round"
                    >
                      <span :class="{ 't2-md-round__win': result.winningTeamId === getTeamIdForColumn('team1') }">{{ getTeamTickets(result, 'team1') }}</span>
                      <span :class="{ 't2-md-round__win': result.winningTeamId === getTeamIdForColumn('team2') }">{{ getTeamTickets(result, 'team2') }}</span>
                    </div>
                    <div class="t2-md-round t2-md-round--total">
                      <span>{{ calculateMapTotal(map).team1 }}</span>
                      <span>{{ calculateMapTotal(map).team2 }}</span>
                    </div>
                  </template>
                  <div
                    v-else
                    class="t2-eyebrow"
                    style="padding: 8px 0"
                  >Waiting for results</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Match summary -->
          <div
            v-if="hasResults"
            class="t2-md-summary"
          >
            <div class="t2-eyebrow">Match summary</div>
            <div class="t2-md-summary__row">
              <div class="t2-md-summary__side">
                <span class="t2-md-summary__team">{{ match.team1Name }}</span>
                <span class="t2-md-summary__score">{{ calculateGrandTotal().team1 }}</span>
              </div>
              <div class="t2-md-summary__mid">
                <template v-if="getMatchWinner()">
                  <span class="t2-eyebrow" style="color: var(--t-accent)">Winner</span>
                  <span class="t2-md-summary__winner">{{ getMatchWinner() }}</span>
                </template>
                <span
                  v-else
                  class="t2-badge"
                >Tie</span>
              </div>
              <div class="t2-md-summary__side t2-md-summary__side--right">
                <span class="t2-md-summary__score">{{ calculateGrandTotal().team2 }}</span>
                <span class="t2-md-summary__team">{{ match.team2Name }}</span>
              </div>
            </div>
          </div>

          <!-- Files & comments -->
          <div
            v-if="hasFilesOrComments"
            style="margin-top: 26px"
          >
            <div
              v-if="isLoadingFilesAndComments"
              class="t2-loading"
              style="min-height: 60px"
            >
              <div class="t2-spinner" />
            </div>

            <template v-else>
              <div v-if="matchFiles.length > 0">
                <div class="t2-section-head" style="margin-bottom: 12px">
                  <span class="t2-section-head__mark">//</span>
                  <h3 class="t2-section-head__title" style="font-size: 18px">Recordings</h3>
                  <span class="t2-section-head__meta">{{ matchFiles.length }}</span>
                </div>
                <div
                  v-for="file in matchFiles"
                  :key="file.id"
                  class="t2-file-row"
                >
                  <i class="pi pi-video t2-file-row__icon" />
                  <div>
                    <div class="t2-file-row__name">{{ file.name }}</div>
                    <div
                      class="t2-file-row__meta"
                      :title="formatLocalTooltip(file.uploadedAt)"
                    >
                      Uploaded {{ formatFileDate(file.uploadedAt) }}<template v-if="file.tags"> · {{ file.tags.split(',').slice(0, 3).map(t => t.trim()).join(' · ') }}</template>
                    </div>
                  </div>
                  <span class="t2-chip t2-file-row__pill">Demo</span>
                  <a
                    :href="file.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="t2-file-row__dl"
                  >Download <i class="pi pi-arrow-down" style="font-size: 10px" /></a>
                </div>
              </div>

              <div
                v-if="matchComments.length > 0"
                style="margin-top: 22px"
              >
                <div class="t2-section-head" style="margin-bottom: 12px">
                  <span class="t2-section-head__mark">//</span>
                  <h3 class="t2-section-head__title" style="font-size: 18px">Referee comments</h3>
                  <span class="t2-section-head__meta">{{ matchComments.length }}</span>
                </div>
                <div
                  v-for="comment in matchComments"
                  :key="comment.id"
                  class="t2-md-comment"
                >
                  <div class="t2-md-comment__body">
                    <template
                      v-for="(part, idx) in parseCommentContent(comment.content)"
                      :key="idx"
                    >
                      <a
                        v-if="part.url"
                        :href="part.url"
                        target="_blank"
                        rel="noopener noreferrer"
                      >{{ part.text }}</a>
                      <span v-else>{{ part.text }}</span>
                    </template>
                  </div>
                  <div
                    class="t2-md-comment__meta"
                    :title="formatLocalTooltip(comment.createdAt)"
                  >{{ formatCommentDate(comment.createdAt) }}</div>
                </div>
              </div>
            </template>
          </div>

          <!-- Public discussion -->
          <T2CommentThread
            :tournament-id="tournamentId"
            :match-id="match.id"
            title="Discussion"
          />

          <!-- Compare players -->
          <div
            v-if="getTeamRoster(match.team1Name).length > 0 || getTeamRoster(match.team2Name).length > 0"
            style="margin-top: 26px"
          >
            <div class="t2-section-head" style="margin-bottom: 12px">
              <span class="t2-section-head__mark">//</span>
              <h3 class="t2-section-head__title" style="font-size: 18px">Compare players</h3>
            </div>

            <div class="t2-table-wrap">
              <table class="t2-md-roster">
                <thead>
                  <tr>
                    <th>{{ match.team1Name }} <small>· {{ getTeamRoster(match.team1Name).length }}</small></th>
                    <th>{{ match.team2Name }} <small>· {{ getTeamRoster(match.team2Name).length }}</small></th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(_, idx) in Math.max(getTeamRoster(match.team1Name).length, getTeamRoster(match.team2Name).length)"
                    :key="idx"
                  >
                    <td>
                      <button
                        v-if="getTeamRoster(match.team1Name)[idx]"
                        type="button"
                        class="t2-md-pick"
                        :class="{ 't2-md-pick--on': isPlayerSelected(getTeamRoster(match.team1Name)[idx].playerName) }"
                        @click="selectPlayerForComparison(getTeamRoster(match.team1Name)[idx].playerName)"
                      >
                        <span>{{ $pn(getTeamRoster(match.team1Name)[idx].playerName) }}</span>
                        <i
                          v-if="isPlayerSelected(getTeamRoster(match.team1Name)[idx].playerName)"
                          class="pi pi-check"
                          style="font-size: 11px"
                        />
                      </button>
                    </td>
                    <td>
                      <button
                        v-if="getTeamRoster(match.team2Name)[idx]"
                        type="button"
                        class="t2-md-pick"
                        :class="{ 't2-md-pick--on': isPlayerSelected(getTeamRoster(match.team2Name)[idx].playerName) }"
                        @click="selectPlayerForComparison(getTeamRoster(match.team2Name)[idx].playerName)"
                      >
                        <span>{{ $pn(getTeamRoster(match.team2Name)[idx].playerName) }}</span>
                        <i
                          v-if="isPlayerSelected(getTeamRoster(match.team2Name)[idx].playerName)"
                          class="pi pi-check"
                          style="font-size: 11px"
                        />
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div
              v-if="selectedPlayers.length === 2"
              style="margin-top: 16px; text-align: center"
            >
              <button
                class="t2-btn t2-btn--accent"
                @click="emit('compare-players', selectedPlayers)"
              >
                Compare {{ $pn(selectedPlayers[0]) }} vs {{ $pn(selectedPlayers[1]) }}
              </button>
            </div>
            <div
              v-else-if="selectedPlayers.length === 1"
              class="t2-eyebrow"
              style="margin-top: 12px; text-align: center"
            >
              Select one more player from the other team to compare
            </div>
          </div>
        </div>
      </div>

      <!-- Fullscreen image -->
      <div
        v-if="fullscreenImage"
        class="t2-md-fullscreen"
        @click="fullscreenImage = null"
      >
        <img
          :src="fullscreenImage.url"
          :alt="fullscreenImage.mapName"
        >
        <div class="t2-md-fullscreen__name">{{ fullscreenImage.mapName }}</div>
        <button
          class="t2-modal__close"
          style="position: absolute; top: 20px; right: 20px"
          aria-label="Close"
          @click.stop="fullscreenImage = null"
        >×</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { PublicTournamentMatch, MatchFile, MatchComment, PublicTournamentDetail } from '@/services/publicTournamentService'
import { publicTournamentService } from '@/services/publicTournamentService'
import { resolveT2Theme } from './t2Theme'
import { formatAbsoluteTime, formatLocalTooltip } from '@/utils/timeUtils'
import T2CommentThread from './T2CommentThread.vue'

interface Team {
  id: number
  name: string
  players: Array<{ playerName: string }>
}

interface Props {
  match: PublicTournamentMatch | null
  teams: Team[]
  tournamentId: number | string
  tournament?: PublicTournamentDetail | null
}

const props = withDefaults(defineProps<Props>(), { tournament: null })

const emit = defineEmits<{
  close: []
  'compare-players': [players: string[]]
}>()

const themeVars = computed(() => {
  const t = resolveT2Theme(props.tournament)
  return { '--t-bg': t.bg, '--t-text': t.text, '--t-accent': t.accent }
})

// --- state + logic ported verbatim from MatchDetailsModal ---
const selectedPlayers = ref<string[]>([])
const fullscreenImage = ref<{ url: string; mapName: string } | null>(null)
const matchFiles = ref<MatchFile[]>([])
const matchComments = ref<MatchComment[]>([])
const isLoadingFilesAndComments = ref(false)

watch(() => props.match?.id, async (matchId) => {
  selectedPlayers.value = []
  if (!matchId) {
    matchFiles.value = []
    matchComments.value = []
    return
  }
  isLoadingFilesAndComments.value = true
  try {
    const tournamentId = typeof props.tournamentId === 'string' ? parseInt(props.tournamentId) : props.tournamentId
    const data = await publicTournamentService.getMatchFilesAndComments(tournamentId, matchId)
    matchFiles.value = data.files
    matchComments.value = data.comments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  } finally {
    isLoadingFilesAndComments.value = false
  }
})

const hasResults = computed(() =>
  props.match?.maps?.some(map => map.matchResults && map.matchResults.length > 0) ?? false)

const hasFilesOrComments = computed(() => matchFiles.value.length > 0 || matchComments.value.length > 0)

const getMapImageUrl = (map: { imagePath?: string }): string | undefined =>
  map.imagePath ? `/stats/assets/tournaments/${map.imagePath}` : undefined

const getTeamIdForColumn = (column: 'team1' | 'team2'): number | undefined => {
  if (!props.match) return undefined
  const targetName = column === 'team1' ? props.match.team1Name : props.match.team2Name
  for (const map of props.match.maps) {
    if (map.matchResults && map.matchResults.length > 0) {
      const result = map.matchResults[0]
      if (result.team1Name === targetName) return result.team1Id
      if (result.team2Name === targetName) return result.team2Id
    }
  }
  return undefined
}

const getTeamTickets = (result: { team1Id?: number; team2Id?: number; team1Tickets: number; team2Tickets: number }, column: 'team1' | 'team2'): number => {
  if (!props.match) return 0
  const targetTeamId = getTeamIdForColumn(column)
  if (!targetTeamId) return 0
  if (result.team1Id === targetTeamId) return result.team1Tickets || 0
  if (result.team2Id === targetTeamId) return result.team2Tickets || 0
  return 0
}

const calculateMapTotal = (map: { matchResults?: Array<{ team1Id?: number; team1Tickets: number; team2Tickets: number }> }) => {
  if (!props.match?.maps) return { team1: 0, team2: 0 }
  const team1Id = getTeamIdForColumn('team1')
  let team1Total = 0
  let team2Total = 0
  map.matchResults?.forEach(roundResult => {
    if (roundResult.team1Id === team1Id) {
      team1Total += roundResult.team1Tickets || 0
      team2Total += roundResult.team2Tickets || 0
    } else {
      team1Total += roundResult.team2Tickets || 0
      team2Total += roundResult.team1Tickets || 0
    }
  })
  return { team1: team1Total, team2: team2Total }
}

const calculateGrandTotal = () => {
  if (!props.match?.maps) return { team1: 0, team2: 0 }
  const teamsMap = new Map<number, { id: number; name: string }>()
  for (const map of props.match.maps) {
    for (const round of map.matchResults ?? []) {
      if (round.team1Id && round.team1Name) teamsMap.set(round.team1Id, { id: round.team1Id, name: round.team1Name })
      if (round.team2Id && round.team2Name) teamsMap.set(round.team2Id, { id: round.team2Id, name: round.team2Name })
    }
  }
  if (teamsMap.size !== 2) return { team1: 0, team2: 0 }
  const teams = Array.from(teamsMap.values())
  const isATeam1 = teams[0].name === props.match.team1Name
  const team1Id = isATeam1 ? teams[0].id : teams[1].id
  let team1Total = 0
  let team2Total = 0
  props.match.maps.forEach(map => {
    map.matchResults?.forEach(result => {
      if (result.team1Id === team1Id) {
        team1Total += result.team1Tickets || 0
        team2Total += result.team2Tickets || 0
      } else {
        team1Total += result.team2Tickets || 0
        team2Total += result.team1Tickets || 0
      }
    })
  })
  return { team1: team1Total, team2: team2Total }
}

const getMatchWinner = (): string | null => {
  if (!props.match?.maps) return null
  const grandTotal = calculateGrandTotal()
  if (grandTotal.team1 > grandTotal.team2) return props.match.team1Name
  if (grandTotal.team2 > grandTotal.team1) return props.match.team2Name
  return null
}

const getTeamRoster = (teamName: string) =>
  props.teams.find(t => t.name === teamName)?.players || []

const isPlayerSelected = (playerName: string): boolean => selectedPlayers.value.includes(playerName)

const selectPlayerForComparison = (playerName: string) => {
  const index = selectedPlayers.value.indexOf(playerName)
  if (index > -1) selectedPlayers.value.splice(index, 1)
  else if (selectedPlayers.value.length < 2) selectedPlayers.value.push(playerName)
}

const openFullscreenImage = (imageUrl: string | undefined, mapName: string) => {
  if (imageUrl) fullscreenImage.value = { url: imageUrl, mapName }
}

const formatFileDate = (dateString: string): string => {
  const date = new Date(dateString)
  return isNaN(date.getTime()) ? dateString : date.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' })
}

const formatCommentDate = (dateString: string): string => {
  const date = new Date(dateString)
  return isNaN(date.getTime()) ? dateString : date.toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const parseCommentContent = (content: string): Array<{ text: string; url?: string }> => {
  const urlRegex = /(https?:\/\/[^\s]+)/g
  const parts: Array<{ text: string; url?: string }> = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  const tempRegex = new RegExp(urlRegex)
  while ((match = tempRegex.exec(content)) !== null) {
    if (match.index > lastIndex) parts.push({ text: content.substring(lastIndex, match.index) })
    parts.push({ text: match[0], url: match[0] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < content.length) parts.push({ text: content.substring(lastIndex) })
  return parts.length === 0 ? [{ text: content }] : parts
}
</script>

<style src="@/styles/tournament-v2.css"></style>
<style scoped>
.t2-md-maps { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.t2-md-map { border: 1px solid var(--t-rule); border-radius: 2px; padding: 14px; background: var(--t-surface); }
.t2-md-map__head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.t2-md-map__name { font-family: var(--t-font-display); font-size: 17px; font-weight: 600; letter-spacing: 0.02em; text-transform: uppercase; color: var(--t-text); }
.t2-md-map__picked { font-family: var(--t-font-mono); font-size: 9.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--t-muted); }
.t2-md-map__body { display: flex; gap: 12px; }
.t2-md-map__thumb {
  flex-shrink: 0; width: 96px; height: 96px; position: relative; cursor: pointer;
  border: 1px solid var(--t-rule-strong); border-radius: 2px;
  background-size: cover; background-position: center; padding: 0;
  display: grid; place-items: center; color: rgba(255, 255, 255, 0.85);
}
.t2-md-map__thumb .pi { opacity: 0; transition: opacity 0.15s ease; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8); }
.t2-md-map__thumb:hover .pi { opacity: 1; }
.t2-md-map__results { flex: 1; min-width: 0; }
.t2-md-round { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-family: var(--t-font-mono); font-size: 13px; text-align: center; }
.t2-md-round span { padding: 6px 4px; color: var(--t-text); }
.t2-md-round--head span { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--t-accent); padding-bottom: 4px; }
.t2-md-round__win { color: var(--t-accent); font-weight: 600; }
.t2-md-round--total { border-top: 1px solid var(--t-rule-strong); margin-top: 4px; }
.t2-md-round--total span { color: var(--t-accent); font-weight: 600; }

.t2-md-summary { margin-top: 20px; border: 1px solid var(--t-rule-strong); border-radius: 2px; padding: 16px 20px; }
.t2-md-summary__row { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 10px; flex-wrap: wrap; }
.t2-md-summary__side { display: flex; align-items: center; gap: 12px; }
.t2-md-summary__side--right { justify-content: flex-end; }
.t2-md-summary__team { font-family: var(--t-font-mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--t-muted); }
.t2-md-summary__score { font-family: var(--t-font-display); font-size: 32px; font-weight: 700; color: var(--t-accent); }
.t2-md-summary__mid { text-align: center; display: flex; flex-direction: column; gap: 2px; }
.t2-md-summary__winner { font-family: var(--t-font-display); font-size: 16px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--t-text); }

.t2-md-comment { border: 1px solid var(--t-rule); border-radius: 2px; padding: 12px 14px; margin-bottom: 8px; background: var(--t-surface); }
.t2-md-comment__body { font-size: 14px; color: var(--t-text); line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
.t2-md-comment__meta { font-family: var(--t-font-mono); font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--t-muted); margin-top: 6px; }

.t2-md-roster { width: 100%; border-collapse: collapse; min-width: 420px; }
.t2-md-roster th {
  padding: 10px; text-align: center; border-bottom: 2px solid var(--t-accent);
  font-family: var(--t-font-display); font-size: 15px; font-weight: 600; letter-spacing: 0.03em;
  text-transform: uppercase; color: var(--t-text);
}
.t2-md-roster th small { font-family: var(--t-font-mono); font-size: 11px; font-weight: 400; color: var(--t-muted); }
.t2-md-roster td { padding: 4px; width: 50%; border-bottom: 1px solid var(--t-rule); }
.t2-md-pick {
  width: 100%; appearance: none; cursor: pointer; text-align: left;
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 9px 12px; background: none; border: 1px solid transparent; border-radius: 2px;
  color: var(--t-text); font-family: var(--t-font-body); font-size: 14px; transition: border-color 0.15s ease, background 0.15s ease;
}
.t2-md-pick:hover { border-color: var(--t-rule-strong); }
.t2-md-pick--on { border-color: var(--t-accent); background: color-mix(in srgb, var(--t-accent) 12%, transparent); color: var(--t-accent); font-weight: 600; }

.t2-md-fullscreen {
  position: fixed; inset: 0; z-index: 1010; background: rgba(0, 0, 0, 0.9);
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 24px;
}
.t2-md-fullscreen img { max-width: 100%; max-height: 82vh; object-fit: contain; border: 1px solid var(--t-rule-strong); }
.t2-md-fullscreen__name { font-family: var(--t-font-display); font-size: 20px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: #fff; }

@media (max-width: 720px) {
  .t2-md-maps { grid-template-columns: 1fr; }
  .t2-md-summary__row { flex-direction: column; align-items: stretch; }
  .t2-md-summary__side--right { justify-content: flex-start; }
}
</style>
