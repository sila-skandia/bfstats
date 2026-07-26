<template>
  <Teleport to="body">
    <div
      class="t2 t2-modal"
      :style="themeVars"
      @click.self="emit('close')"
    >
      <div class="t2-modal__panel">
        <!-- Head -->
        <div class="t2-modal__head">
          <div style="min-width: 0">
            <div class="t2-modal__eyebrow">{{ roleLabel }}</div>
            <h2 class="t2-modal__title">
              {{ teamDetails?.teamName || 'Your team' }}
              <small v-if="teamDetails?.tag">{{ teamDetails.tag }}</small>
            </h2>
            <div class="t2-modal__sub">
              {{ approvedPlayers.length }} player{{ approvedPlayers.length !== 1 ? 's' : '' }}<template v-if="canPerformLeaderActions && pendingPlayers.length > 0"> · {{ pendingPlayers.length }} pending</template>
            </div>
          </div>
          <button
            class="t2-modal__close"
            aria-label="Close"
            @click="emit('close')"
          >×</button>
        </div>

        <div class="t2-modal__body--flush">
          <!-- Pending approval banner (pending non-leaders) -->
          <div
            v-if="!isLeader && props.membershipStatus === MembershipStatus.Pending"
            class="t2-panel-section"
          >
            <div class="t2-warnbox" style="color: #d29a4a; border-color: color-mix(in srgb, #d29a4a 40%, transparent); background: color-mix(in srgb, #d29a4a 8%, transparent); margin: 0">
              <strong style="color: #d29a4a">Awaiting approval</strong> — the team leader needs to approve your join request.
            </div>
          </div>

          <!-- Recruitment status (leader/admin) -->
          <div
            v-if="canPerformLeaderActions"
            class="t2-panel-section"
          >
            <h3 class="t2-panel-h">
              Recruitment status
              <span
                class="t2-chip"
                :class="recruitmentChipClass(currentStatus)"
              >
                <span class="t2-chip__dot" />{{ getRecruitmentStatusText(currentStatus) }}
              </span>
            </h3>
            <div class="t2-statusgrid">
              <button
                v-for="status in recruitmentStatusOptions"
                :key="status.value"
                class="t2-statusbtn"
                :class="{ 't2-statusbtn--active': currentStatus === status.value }"
                :disabled="isUpdatingStatus || currentStatus === status.value"
                @click="handleUpdateRecruitmentStatus(status.value)"
              >
                <span class="t2-statusbtn__label">{{ status.label }}</span>
                <span class="t2-statusbtn__desc">{{ status.description }}</span>
              </button>
            </div>
            <div
              v-if="recruitmentStatusError"
              class="t2-errbox"
              style="margin-top: 10px"
            >{{ recruitmentStatusError }}</div>
          </div>

          <!-- Add player (leader/admin) -->
          <div
            v-if="canPerformLeaderActions"
            class="t2-panel-section"
          >
            <h3 class="t2-panel-h">Add players</h3>
            <div class="t2-search__row">
              <T2PlayerSearch
                v-model="addName"
                placeholder="Search players to add…"
                @select="p => addName = p.playerName"
                @enter="handleAddPlayer"
              />
              <button
                type="button"
                class="t2-btn t2-btn--accent"
                :disabled="!addName.trim() || isAddingPlayer"
                @click="handleAddPlayer"
              >
                {{ isAddingPlayer ? '…' : 'Add' }}
              </button>
            </div>
            <div
              v-if="addPlayerError"
              class="t2-errbox"
              style="margin-top: 8px"
            >{{ addPlayerError }}</div>
          </div>

          <!-- Pending approvals (leader/admin) -->
          <div
            v-if="canPerformLeaderActions && pendingPlayers.length > 0"
            class="t2-panel-section"
          >
            <h3 class="t2-panel-h">
              <span class="t2-chip__dot" style="background: #d29a4a" />Pending approvals ({{ pendingPlayers.length }})
            </h3>
            <div
              v-for="player in pendingPlayers"
              :key="player.playerName"
              class="t2-mrow t2-mrow--pending"
            >
              <div style="min-width: 0">
                <router-link
                  :to="`/v4/players/${encodeURIComponent(player.playerName)}`"
                  class="t2-mrow__name"
                >{{ $pn(player.playerName) }}</router-link>
                <div class="t2-mrow__sub">
                  <span class="t2-chip t2-chip--warn"><span class="t2-chip__dot" />Pending</span>
                  <span>Requested {{ formatDate(player.joinedAt) }}</span>
                </div>
              </div>
              <div style="display: flex; gap: 6px; flex-shrink: 0">
                <button
                  class="t2-icon-btn t2-icon-btn--ok"
                  title="Approve member"
                  :disabled="isApprovingMember === player.playerName"
                  @click="handleApproveMember(player.playerName)"
                >
                  <i class="pi pi-check" style="font-size: 12px" />
                </button>
                <button
                  class="t2-icon-btn t2-icon-btn--danger"
                  title="Reject request"
                  :disabled="isRemovingPlayer === player.playerName"
                  @click="handleRemovePlayer(player.playerName)"
                >
                  <i class="pi pi-times" style="font-size: 12px" />
                </button>
              </div>
            </div>
          </div>

          <!-- Players list -->
          <div class="t2-panel-section">
            <h3 class="t2-panel-h">Roster</h3>
            <div
              v-if="isLoading"
              class="t2-loading"
              style="min-height: 80px"
            >
              <div class="t2-spinner" />
            </div>
            <div
              v-else-if="loadError"
              class="t2-errbox"
            >{{ loadError }}</div>
            <template v-else-if="approvedPlayers.length">
              <div
                v-for="player in approvedPlayers"
                :key="player.playerName"
                class="t2-mrow"
              >
                <div style="min-width: 0">
                  <router-link
                    :to="`/v4/players/${encodeURIComponent(player.playerName)}`"
                    class="t2-mrow__name"
                  >{{ $pn(player.playerName) }}</router-link>
                  <div class="t2-mrow__sub">
                    <span
                      v-if="player.isLeader"
                      class="t2-chip t2-chip--accent"
                    >Leader</span>
                    <span>Joined {{ formatDate(player.joinedAt) }}</span>
                  </div>
                </div>
                <button
                  v-if="canPerformLeaderActions && !player.isLeader"
                  class="t2-icon-btn t2-icon-btn--danger"
                  title="Remove player"
                  :disabled="isRemovingPlayer === player.playerName"
                  @click="handleRemovePlayer(player.playerName)"
                >
                  <i class="pi pi-times" style="font-size: 12px" />
                </button>
              </div>
            </template>
            <div
              v-else
              class="t2-empty"
              style="padding: 24px"
            >No players in the team yet</div>
          </div>

          <!-- Leave team (non-leader, on this team) -->
          <div
            v-if="!isLeader && !isAdmin && props.membershipStatus !== undefined"
            class="t2-panel-section"
          >
            <div
              v-if="leaveState === 'confirming'"
              class="t2-warnbox"
            >
              Leaving this team removes you from the tournament and frees your spot. You can rejoin or join another team while registration is open.
            </div>
            <div
              v-if="leaveState === 'error'"
              class="t2-errbox"
              style="margin-bottom: 12px"
            >{{ leaveError }}</div>
            <div style="display: flex; gap: 8px">
              <button
                class="t2-btn"
                :class="leaveState === 'confirming' ? 't2-btn--danger-solid' : 't2-btn--danger'"
                :disabled="leaveState === 'leaving'"
                @click="handleLeaveTeam"
              >{{ getLeaveButtonText() }}</button>
              <button
                v-if="leaveState === 'confirming'"
                class="t2-btn t2-btn--outline"
                @click="cancelLeave"
              >Cancel</button>
            </div>
          </div>

          <!-- Delete team (leader/admin) -->
          <div
            v-if="canPerformLeaderActions"
            class="t2-panel-section"
          >
            <div
              v-if="deleteState === 'confirming'"
              class="t2-warnbox"
            >
              Deleting your team removes all members from the tournament. You can re-register while registration is open.
            </div>
            <div
              v-if="deleteState === 'error'"
              class="t2-errbox"
              style="margin-bottom: 12px"
            >{{ deleteError }}</div>
            <div style="display: flex; gap: 8px">
              <button
                class="t2-btn"
                :class="deleteState === 'confirming' ? 't2-btn--danger-solid' : 't2-btn--danger'"
                :disabled="deleteState === 'deleting'"
                @click="handleDeleteTeam"
              >{{ getDeleteButtonText() }}</button>
              <button
                v-if="deleteState === 'confirming'"
                class="t2-btn t2-btn--outline"
                @click="cancelDelete"
              >Cancel</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import T2PlayerSearch from './T2PlayerSearch.vue'
import { resolveT2Theme } from './t2Theme'
import { teamRegistrationService, TeamRecruitmentStatus, MembershipStatus, getRecruitmentStatusText, normalizeRecruitmentStatus, type TeamDetailsResponse, type TeamPlayerInfo } from '@/services/teamRegistrationService'
import type { PublicTournamentDetail } from '@/services/publicTournamentService'

interface Props {
  tournamentId: number
  teamId: number
  isLeader: boolean
  isAdmin?: boolean
  membershipStatus?: MembershipStatus | null
  tournament?: PublicTournamentDetail | null
}

const props = withDefaults(defineProps<Props>(), {
  isAdmin: false,
  tournament: null,
})

const emit = defineEmits<{
  close: []
  teamUpdated: []
  leftTeam: []
  deletedTeam: []
}>()

const themeVars = computed(() => {
  const t = resolveT2Theme(props.tournament)
  return { '--t-bg': t.bg, '--t-text': t.text, '--t-accent': t.accent }
})

const roleLabel = computed(() => {
  if (props.isAdmin && !props.isLeader) return 'Tournament admin'
  if (props.isLeader) return 'Team leader'
  if (props.membershipStatus === MembershipStatus.Pending) return 'Pending approval'
  return 'Team member'
})

// --- logic ported verbatim from TeamManagementPanel ---
const canPerformLeaderActions = computed(() => props.isLeader || props.isAdmin)
const getTeamIdForService = () => (props.isAdmin && !props.isLeader ? props.teamId : undefined)

const teamDetails = ref<TeamDetailsResponse | null>(null)
const isLoading = ref(false)
const loadError = ref('')
const addName = ref('')
const isAddingPlayer = ref(false)
const addPlayerError = ref('')
const isRemovingPlayer = ref<string | null>(null)
const leaveState = ref<'idle' | 'confirming' | 'leaving' | 'error'>('idle')
const leaveError = ref('')
const deleteState = ref<'idle' | 'confirming' | 'deleting' | 'error'>('idle')
const deleteError = ref('')
const isUpdatingStatus = ref(false)
const recruitmentStatusError = ref('')
const isApprovingMember = ref<string | null>(null)

const pendingPlayers = computed<TeamPlayerInfo[]>(() =>
  teamDetails.value?.players?.filter(p => p.membershipStatus === MembershipStatus.Pending) ?? [])
const approvedPlayers = computed<TeamPlayerInfo[]>(() =>
  teamDetails.value?.players?.filter(p => p.membershipStatus === MembershipStatus.Approved || p.membershipStatus == null) ?? [])

const recruitmentStatusOptions = [
  { value: TeamRecruitmentStatus.Open, label: 'Open', description: 'Accepting new members' },
  { value: TeamRecruitmentStatus.Closed, label: 'Closed', description: 'Not recruiting' },
  { value: TeamRecruitmentStatus.LookingForBTeam, label: 'B-Team', description: 'Starting a second team' },
]

// teamDetails.recruitmentStatus arrives as an enum string; normalize for comparison
const currentStatus = computed(() => normalizeRecruitmentStatus(teamDetails.value?.recruitmentStatus))

const recruitmentChipClass = (status: TeamRecruitmentStatus | string): string => {
  switch (normalizeRecruitmentStatus(status)) {
    case TeamRecruitmentStatus.Open: return 't2-chip--accent'
    case TeamRecruitmentStatus.Closed: return 't2-chip--danger'
    case TeamRecruitmentStatus.LookingForBTeam: return 't2-chip--warn'
    default: return 't2-chip--muted'
  }
}

const loadTeamDetails = async () => {
  isLoading.value = true
  loadError.value = ''
  try {
    teamDetails.value = await teamRegistrationService.getTeamDetails(props.tournamentId, getTeamIdForService())
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Failed to load team details'
  } finally {
    isLoading.value = false
  }
}

const handleUpdateRecruitmentStatus = async (status: TeamRecruitmentStatus) => {
  if (isUpdatingStatus.value || currentStatus.value === status) return
  isUpdatingStatus.value = true
  recruitmentStatusError.value = ''
  try {
    await teamRegistrationService.updateRecruitmentStatus(props.tournamentId, status, getTeamIdForService())
    await loadTeamDetails()
    emit('teamUpdated')
  } catch (error) {
    recruitmentStatusError.value = error instanceof Error ? error.message : 'Failed to update recruitment status'
  } finally {
    isUpdatingStatus.value = false
  }
}

const handleAddPlayer = async () => {
  const name = addName.value.trim()
  if (!name || isAddingPlayer.value) return
  isAddingPlayer.value = true
  addPlayerError.value = ''
  try {
    await teamRegistrationService.addPlayer(props.tournamentId, { playerName: name }, getTeamIdForService())
    addName.value = ''
    await loadTeamDetails()
    emit('teamUpdated')
  } catch (error) {
    addPlayerError.value = error instanceof Error ? error.message : 'Failed to add player'
  } finally {
    isAddingPlayer.value = false
  }
}

const handleRemovePlayer = async (playerName: string) => {
  if (isRemovingPlayer.value) return
  isRemovingPlayer.value = playerName
  try {
    await teamRegistrationService.removePlayer(props.tournamentId, playerName, getTeamIdForService())
    await loadTeamDetails()
    emit('teamUpdated')
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Failed to remove player'
    setTimeout(() => { loadError.value = '' }, 3000)
  } finally {
    isRemovingPlayer.value = null
  }
}

const handleApproveMember = async (playerName: string) => {
  if (isApprovingMember.value) return
  isApprovingMember.value = playerName
  try {
    await teamRegistrationService.approveMember(props.tournamentId, playerName, getTeamIdForService())
    await loadTeamDetails()
    emit('teamUpdated')
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'Failed to approve member'
    setTimeout(() => { loadError.value = '' }, 3000)
  } finally {
    isApprovingMember.value = null
  }
}

const doLeave = async () => {
  try {
    await teamRegistrationService.leaveTeam(props.tournamentId, props.teamId)
    emit('leftTeam')
  } catch (error) {
    leaveError.value = error instanceof Error ? error.message : 'Failed to leave team'
    leaveState.value = 'error'
  }
}
const handleLeaveTeam = async () => {
  if (leaveState.value === 'leaving') return
  if (leaveState.value === 'idle') { leaveState.value = 'confirming'; leaveError.value = ''; return }
  leaveState.value = 'leaving'
  leaveError.value = ''
  await doLeave()
}
const cancelLeave = () => { leaveState.value = 'idle'; leaveError.value = '' }
const getLeaveButtonText = (): string =>
  ({ idle: 'Leave team', confirming: 'Confirm leave', leaving: 'Leaving…', error: 'Try again' })[leaveState.value]

const doDelete = async () => {
  try {
    await teamRegistrationService.deleteTeam(props.tournamentId, getTeamIdForService())
    emit('deletedTeam')
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : 'Failed to delete team'
    deleteState.value = 'error'
  }
}
const handleDeleteTeam = async () => {
  if (deleteState.value === 'deleting') return
  if (deleteState.value === 'idle') { deleteState.value = 'confirming'; deleteError.value = ''; return }
  deleteState.value = 'deleting'
  deleteError.value = ''
  await doDelete()
}
const cancelDelete = () => { deleteState.value = 'idle'; deleteError.value = '' }
const getDeleteButtonText = (): string =>
  ({ idle: 'Delete team', confirming: 'Confirm delete', deleting: 'Deleting…', error: 'Try again' })[deleteState.value]

const formatDate = (dateStr: string): string =>
  new Date(dateStr).toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' })

onMounted(loadTeamDetails)
watch(() => props.teamId, () => {
  leaveState.value = 'idle'
  leaveError.value = ''
  loadTeamDetails()
})
</script>

<style src="@/styles/tournament-v2.css"></style>
