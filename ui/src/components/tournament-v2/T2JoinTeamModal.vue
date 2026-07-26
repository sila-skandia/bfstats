<template>
  <Teleport to="body">
    <div
      v-if="isVisible"
      class="t2 t2-modal"
      :style="themeVars"
      @click.self="closeModal"
    >
      <div class="t2-modal__panel t2-modal__panel--wide">
        <div class="t2-modal__head">
          <div>
            <div class="t2-modal__eyebrow">Team registration</div>
            <h2 class="t2-modal__title">Join a team</h2>
          </div>
          <button
            class="t2-modal__close"
            aria-label="Close"
            @click="closeModal"
          >×</button>
        </div>

        <div
          v-if="isLoading"
          class="t2-loading"
          style="min-height: 160px"
        >
          <div class="t2-spinner" />
        </div>

        <div
          v-else-if="availableTeams.length === 0"
          class="t2-modal__body"
        >
          <div class="t2-empty">
            No teams available to join.<br>Try creating a new team instead.
          </div>
        </div>

        <form
          v-else
          class="t2-modal__body"
          @submit.prevent="handleSubmit"
        >
          <div
            v-if="registrationRules"
            class="t2-collapse"
          >
            <button
              type="button"
              class="t2-collapse__toggle"
              @click="showRegistrationRules = !showRegistrationRules"
            >
              <span>Registration info</span>
              <i
                class="pi"
                :class="showRegistrationRules ? 'pi-chevron-up' : 'pi-chevron-down'"
                style="font-size: 11px"
              />
            </button>
            <div
              v-if="showRegistrationRules"
              class="t2-collapse__body t2-md"
              v-html="renderedRegistrationRules"
            />
          </div>

          <div class="t2-field">
            <label class="t2-label">Select team <span class="t2-req">*</span></label>
            <div class="t2-jointeam-grid">
              <label
                v-for="team in availableTeams"
                :key="team.id"
                class="t2-option"
                style="flex-direction: column; align-items: stretch; gap: 8px"
                :class="{
                  't2-option--active': selectedTeamId === team.id,
                  't2-option--disabled': !isTeamOpen(team),
                }"
                @click.prevent="handleTeamClick(team)"
              >
                <div style="display: flex; align-items: center; gap: 12px">
                  <input
                    v-model="selectedTeamId"
                    type="radio"
                    :value="team.id"
                    :disabled="!isTeamOpen(team)"
                  >
                  <div style="flex: 1; min-width: 0">
                    <div style="display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap">
                      <span class="t2-option__name">{{ team.name }}</span>
                      <span
                        v-if="team.tag"
                        class="t2-option__meta"
                      >{{ team.tag }}</span>
                    </div>
                    <span class="t2-option__meta">{{ team.playerCount }} player{{ team.playerCount !== 1 ? 's' : '' }}</span>
                  </div>
                </div>
                <span
                  class="t2-chip"
                  :class="recruitmentChipClass(team.recruitmentStatus)"
                  style="align-self: flex-start"
                >
                  <span class="t2-chip__dot" />{{ getRecruitmentStatusText(normalizeRecruitmentStatus(team.recruitmentStatus)) }}
                </span>
                <div
                  v-if="!isTeamOpen(team)"
                  class="t2-hint"
                  style="text-transform: none; letter-spacing: 0"
                >{{ getTeamStatusMessage(team) }}</div>
              </label>
            </div>
          </div>

          <div class="t2-field">
            <label class="t2-label">Your in-game name <span class="t2-req">*</span></label>

            <label
              v-for="player in linkedPlayerNames"
              :key="player.id"
              class="t2-option"
              :class="{ 't2-option--active': form.playerName === player.playerName }"
            >
              <input
                v-model="form.playerName"
                type="radio"
                :value="player.playerName"
              >
              <span class="t2-option__name">{{ $pn(player.playerName) }}</span>
            </label>

            <button
              v-if="!showAddPlayerName && linkedPlayerNames.length > 0"
              type="button"
              class="t2-match__details-link"
              style="margin-top: 4px"
              @click="showAddPlayerName = true"
            >
              + Link a different player name
            </button>

            <div v-if="showAddPlayerName || linkedPlayerNames.length === 0">
              <div
                v-if="linkedPlayerNames.length === 0"
                class="t2-hint"
                style="margin-bottom: 8px"
              >
                Search for your in-game player name:
              </div>
              <div class="t2-search__row">
                <T2PlayerSearch
                  v-model="newPlayerName"
                  placeholder="Search for your player name..."
                  @select="handlePlayerSelected"
                />
                <button
                  type="button"
                  class="t2-btn t2-btn--accent"
                  :disabled="!newPlayerName.trim() || isLinkingPlayerName"
                  @click="handleLinkPlayerName"
                >
                  {{ isLinkingPlayerName ? '…' : 'Link' }}
                </button>
              </div>
              <div
                v-if="linkPlayerError"
                class="t2-errbox"
                style="margin-top: 8px"
              >{{ linkPlayerError }}</div>
            </div>
          </div>

          <div
            v-if="errorMessage"
            class="t2-errbox"
          >{{ errorMessage }}</div>
        </form>

        <div
          v-if="availableTeams.length > 0"
          class="t2-modal__footer"
        >
          <button
            type="button"
            class="t2-btn t2-btn--outline"
            @click="closeModal"
          >Cancel</button>
          <button
            type="button"
            class="t2-btn t2-btn--accent"
            :disabled="isSubmitting || !isFormValid"
            @click="handleSubmit"
          >
            {{ isSubmitting ? 'Joining…' : 'Join team' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { marked } from 'marked'
import T2PlayerSearch from './T2PlayerSearch.vue'
import { resolveT2Theme } from './t2Theme'
import { teamRegistrationService, TeamRecruitmentStatus, getRecruitmentStatusText, normalizeRecruitmentStatus, type JoinTeamRequest, type AvailableTeam, type LinkedPlayerName } from '@/services/teamRegistrationService'
import type { PublicTournamentDetail } from '@/services/publicTournamentService'

interface Props {
  isVisible: boolean
  tournamentId: number
  registrationRules?: string
  tournament?: PublicTournamentDetail | null
}

const props = withDefaults(defineProps<Props>(), {
  registrationRules: '',
  tournament: null,
})

const emit = defineEmits<{
  close: []
  success: [teamId: number, teamName: string, isPending: boolean]
}>()

const themeVars = computed(() => {
  const t = resolveT2Theme(props.tournament)
  return { '--t-bg': t.bg, '--t-text': t.text, '--t-accent': t.accent }
})

const showRegistrationRules = ref(false)
const renderedRegistrationRules = computed(() => {
  if (!props.registrationRules) return ''
  try {
    return marked(props.registrationRules, { breaks: true }) as string
  } catch {
    return ''
  }
})

// --- logic ported verbatim from JoinTeamModal ---
const isLoading = ref(false)
const availableTeams = ref<AvailableTeam[]>([])
const selectedTeamId = ref<number | null>(null)
const linkedPlayerNames = ref<LinkedPlayerName[]>([])
const showAddPlayerName = ref(false)
const newPlayerName = ref('')
const isLinkingPlayerName = ref(false)
const linkPlayerError = ref('')
const form = ref({ playerName: '', rulesAcknowledged: true })
const isSubmitting = ref(false)
const errorMessage = ref('')

const isTeamOpen = (team: AvailableTeam): boolean =>
  normalizeRecruitmentStatus(team.recruitmentStatus) === TeamRecruitmentStatus.Open

const isFormValid = computed(() => {
  const selectedTeam = availableTeams.value.find(t => t.id === selectedTeamId.value)
  return selectedTeamId.value !== null && form.value.playerName !== '' && !!selectedTeam && isTeamOpen(selectedTeam)
})

const handleTeamClick = (team: AvailableTeam) => {
  if (isTeamOpen(team)) selectedTeamId.value = team.id
}

const getTeamStatusMessage = (team: AvailableTeam): string => {
  const status = normalizeRecruitmentStatus(team.recruitmentStatus)
  if (status === TeamRecruitmentStatus.Closed) {
    return 'This team is not currently recruiting new members.'
  }
  if (status === TeamRecruitmentStatus.LookingForBTeam) {
    return team.leaderPlayerName
      ? `Looking to start a second team. Contact ${team.leaderPlayerName} on Discord to discuss.`
      : 'Looking to start a second team. Contact the team leader on Discord to discuss.'
  }
  return ''
}

const recruitmentChipClass = (status: TeamRecruitmentStatus | string): string => {
  switch (normalizeRecruitmentStatus(status)) {
    case TeamRecruitmentStatus.Open: return 't2-chip--accent'
    case TeamRecruitmentStatus.Closed: return 't2-chip--danger'
    case TeamRecruitmentStatus.LookingForBTeam: return 't2-chip--warn'
    default: return 't2-chip--muted'
  }
}

const loadData = async () => {
  isLoading.value = true
  errorMessage.value = ''
  try {
    const [teams, playerNames] = await Promise.all([
      teamRegistrationService.getAvailableTeams(props.tournamentId),
      teamRegistrationService.getLinkedPlayerNames().catch(() => [] as LinkedPlayerName[]),
    ])
    availableTeams.value = teams
    linkedPlayerNames.value = playerNames
    if (playerNames.length === 1) form.value.playerName = playerNames[0].playerName
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to load teams'
  } finally {
    isLoading.value = false
  }
}

const handlePlayerSelected = (player: { playerName: string }) => {
  newPlayerName.value = player.playerName
}

const handleLinkPlayerName = async () => {
  if (!newPlayerName.value.trim() || isLinkingPlayerName.value) return
  isLinkingPlayerName.value = true
  linkPlayerError.value = ''
  try {
    const linked = await teamRegistrationService.linkPlayerName(newPlayerName.value.trim())
    linkedPlayerNames.value.push(linked)
    form.value.playerName = linked.playerName
    newPlayerName.value = ''
    showAddPlayerName.value = false
  } catch (error) {
    linkPlayerError.value = error instanceof Error ? error.message : 'Failed to link player name'
  } finally {
    isLinkingPlayerName.value = false
  }
}

const closeModal = () => emit('close')

const resetForm = () => {
  selectedTeamId.value = null
  form.value = { playerName: '', rulesAcknowledged: true }
  errorMessage.value = ''
  showAddPlayerName.value = false
  newPlayerName.value = ''
  linkPlayerError.value = ''
}

const handleSubmit = async () => {
  if (!isFormValid.value || isSubmitting.value || selectedTeamId.value === null) return
  isSubmitting.value = true
  errorMessage.value = ''
  try {
    const request: JoinTeamRequest = {
      playerName: form.value.playerName,
      rulesAcknowledged: form.value.rulesAcknowledged,
    }
    await teamRegistrationService.joinTeam(props.tournamentId, selectedTeamId.value, request)
    const joinedTeam = availableTeams.value.find(t => t.id === selectedTeamId.value)
    const isPending = !!joinedTeam?.leaderPlayerName
    emit('success', selectedTeamId.value, joinedTeam?.name || 'Team', isPending)
    resetForm()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Failed to join team'
  } finally {
    isSubmitting.value = false
  }
}

watch(() => props.isVisible, (visible) => {
  if (visible) loadData()
  else resetForm()
})
</script>

<style src="@/styles/tournament-v2.css"></style>
<style scoped>
.t2-jointeam-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
  max-height: 320px;
  overflow-y: auto;
}
.t2-jointeam-grid .t2-option { margin-bottom: 0; }
</style>
