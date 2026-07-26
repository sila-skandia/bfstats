<template>
  <div>
    <div class="t2-section-head">
      <span class="t2-section-head__mark">//</span>
      <h2 class="t2-section-head__title">
        Registered teams <small>· {{ sortedTeams.length }}</small>
      </h2>
      <div
        v-if="showRegistrationActions"
        style="margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap"
      >
        <button
          class="t2-btn t2-btn--outline"
          @click="showJoinTeamModal = true"
        >
          Join a team
        </button>
        <button
          class="t2-btn t2-btn--accent"
          @click="showCreateTeamModal = true"
        >
          Create team
        </button>
      </div>
    </div>

    <!-- Sign-in prompt when registration is open but the viewer is anonymous -->
    <div
      v-if="!isAuthenticated && isRegistrationPhase"
      class="t2-reg-banner"
      style="margin-bottom: 24px"
    >
      <div>
        <div
          class="t2-reg-banner__title"
          style="font-size: 20px"
        >
          Registrations are open
        </div>
        <div class="t2-reg-banner__sub">Sign in with Discord to create a team or join a squad.</div>
      </div>
      <button
        class="t2-btn t2-btn--accent"
        :disabled="isLoginLoading"
        @click="handleDiscordLogin"
      >
        <i class="pi pi-discord" /> {{ isLoginLoading ? 'Redirecting…' : 'Sign in' }}
      </button>
    </div>

    <div
      v-if="sortedTeams.length === 0"
      class="t2-empty"
    >
      No teams registered yet.
    </div>

    <div
      v-else
      class="t2-team-grid"
    >
      <div
        v-for="team in sortedTeams"
        :key="team.id"
        class="t2-team-card"
        :class="{ 't2-team-card--mine': isUserTeam(team.id) }"
      >
        <div class="t2-team-card__head">
          <div>
            <div class="t2-team-card__name">
              {{ team.name }}
              <span
                v-if="team.tag"
                class="t2-team-card__tag"
              >[{{ team.tag }}]</span>
            </div>
            <div class="t2-team-card__sub">
              <template v-if="team.leaderPlayerName">Led by <strong>{{ $pn(team.leaderPlayerName) }}</strong> · </template>Reg {{ formatDate(team.createdAt) }}
            </div>
          </div>
          <span
            class="t2-chip"
            :class="{ 't2-chip--accent': normalizeRecruitmentStatus(team.recruitmentStatus) !== TeamRecruitmentStatus.Closed }"
          >{{ getRecruitmentStatusText(normalizeRecruitmentStatus(team.recruitmentStatus)) }}</span>
        </div>

        <div class="t2-team-card__roster">
          <div
            v-for="player in rosterFor(team)"
            :key="player.playerName"
            class="t2-roster-row"
          >
            <span class="t2-roster-row__name">
              {{ $pn(player.playerName) }}
              <span
                v-if="player.isLeader"
                class="t2-roster-row__capt"
              >CAPT</span>
            </span>
            <span
              v-if="player.membershipStatus === MembershipStatus.Pending"
              class="t2-roster-row__status t2-roster-row__status--pending"
            >Pending</span>
          </div>
          <div
            v-if="rosterFor(team).length === 0"
            class="t2-eyebrow"
            style="padding: 6px 0"
          >
            Roster not published
          </div>
        </div>

        <div
          v-if="canManageTeam(team.id)"
          class="t2-team-card__actions"
        >
          <button
            class="t2-btn t2-btn--outline"
            style="padding: 8px 14px; font-size: 11px"
            @click="openManageTeamModal(team.id)"
          >
            Manage team
          </button>
        </div>
      </div>
    </div>

    <!-- Registration workflow modals (V2-native) -->
    <T2CreateTeamModal
      v-if="tournament.id"
      :is-visible="showCreateTeamModal"
      :tournament-id="tournament.id"
      :registration-rules="tournament.registrationRules"
      :tournament="tournament"
      @close="showCreateTeamModal = false"
      @success="handleTeamCreated"
    />

    <T2JoinTeamModal
      v-if="tournament.id"
      :is-visible="showJoinTeamModal"
      :tournament-id="tournament.id"
      :registration-rules="tournament.registrationRules"
      :tournament="tournament"
      @close="showJoinTeamModal = false"
      @success="handleTeamJoined"
    />

    <T2TeamManagementPanel
      v-if="tournament.id && showManageTeamModal && managingTeamId"
      :tournament-id="tournament.id"
      :team-id="managingTeamId"
      :is-leader="isManagingOwnTeamAsLeader"
      :is-admin="registrationStatus?.isTournamentAdmin ?? false"
      :membership-status="isManagingOwnTeam ? registrationStatus?.teamMembership?.membershipStatus : undefined"
      :tournament="tournament"
      @close="closeManageTeamModal"
      @team-updated="handleTeamUpdated"
      @left-team="handleLeftTeam"
      @deleted-team="handleDeletedTeam"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import type { PublicTournamentDetail, PublicTournamentTeam } from '@/services/publicTournamentService'
import T2CreateTeamModal from './T2CreateTeamModal.vue'
import T2JoinTeamModal from './T2JoinTeamModal.vue'
import T2TeamManagementPanel from './T2TeamManagementPanel.vue'
import { useAuth } from '@/composables/useAuth'
import { useTournamentCache } from '@/composables/useTournamentCache'
import {
  teamRegistrationService,
  TeamRecruitmentStatus,
  MembershipStatus,
  getRecruitmentStatusText,
  normalizeRecruitmentStatus,
  type RegistrationStatusResponse,
} from '@/services/teamRegistrationService'
import { notificationService } from '@/services/notificationService'
import { formatDate } from '@/utils/timeUtils'

const props = defineProps<{
  tournament: PublicTournamentDetail
  tournamentId: string
}>()

const emit = defineEmits<{ refresh: [] }>()

const { isAuthenticated, loginWithDiscord } = useAuth()
const { clearCache } = useTournamentCache()

// ----- Registration state (ported from the legacy Teams view) -----
const registrationStatus = ref<RegistrationStatusResponse | null>(null)
const showCreateTeamModal = ref(false)
const showJoinTeamModal = ref(false)
const showManageTeamModal = ref(false)
const managingTeamId = ref<number | null>(null)
const isLoginLoading = ref(false)

// Team details for leaders (to surface pending members)
const leaderTeamDetails = ref<{ players: { playerName: string; isLeader: boolean; membershipStatus?: MembershipStatus | null }[] } | null>(null)

const isRegistrationPhase = computed(() => props.tournament.status?.toLowerCase() === 'registration')

const showRegistrationActions = computed(() =>
  isAuthenticated.value &&
  isRegistrationPhase.value &&
  !registrationStatus.value?.teamMembership)

const loadRegistrationStatus = async () => {
  if (!isAuthenticated.value || !props.tournament.id) return
  leaderTeamDetails.value = null
  try {
    registrationStatus.value = await teamRegistrationService.getRegistrationStatus(props.tournament.id)
    if (registrationStatus.value?.teamMembership?.isLeader) {
      try {
        leaderTeamDetails.value = await teamRegistrationService.getTeamDetails(props.tournament.id)
      } catch {
        // Leader just won't see pending members in the list
      }
    }
  } catch {
    registrationStatus.value = null
  }
}

// Sort teams so the viewer's team is first; inject pending members visible to them
const sortedTeams = computed(() => {
  const userTeamId = registrationStatus.value?.teamMembership?.teamId
  const userMembership = registrationStatus.value?.teamMembership
  const isLeader = userMembership?.isLeader

  const teams = (props.tournament.teams ?? []).map(team => ({ ...team, players: [...team.players] }))

  if (userTeamId && userMembership) {
    const userTeam = teams.find(t => t.id === userTeamId)
    if (userTeam) {
      if (isLeader && leaderTeamDetails.value?.players) {
        for (const player of leaderTeamDetails.value.players) {
          if (!userTeam.players.some(p => p.playerName === player.playerName)) {
            userTeam.players.push({
              playerName: player.playerName,
              isLeader: player.isLeader,
              membershipStatus: player.membershipStatus ?? MembershipStatus.Approved,
            })
          }
        }
      } else if (!userTeam.players.some(p => p.playerName === userMembership.playerName)) {
        userTeam.players.push({
          playerName: userMembership.playerName,
          isLeader: userMembership.isLeader,
          membershipStatus: userMembership.membershipStatus ?? MembershipStatus.Pending,
        })
      }
    }
  }

  if (!userTeamId) return teams
  return teams.sort((a, b) => (a.id === userTeamId ? -1 : b.id === userTeamId ? 1 : 0))
})

const currentUserPlayerName = computed(() => registrationStatus.value?.teamMembership?.playerName)

const isUserTeam = (teamId: number) => registrationStatus.value?.teamMembership?.teamId === teamId
const canManageTeam = (teamId: number) => isUserTeam(teamId) || (registrationStatus.value?.isTournamentAdmin ?? false)
const isLeaderOfTeam = (teamId: number) =>
  isUserTeam(teamId) && (registrationStatus.value?.teamMembership?.isLeader ?? false)

// Leaders see pending members on their own team; everyone sees themselves
const rosterFor = (team: PublicTournamentTeam) => {
  const includePending = isLeaderOfTeam(team.id)
  return [...team.players]
    .filter(p =>
      includePending ||
      p.membershipStatus === MembershipStatus.Approved ||
      p.membershipStatus == null ||
      p.playerName === currentUserPlayerName.value)
    .sort((a, b) => {
      if (a.isLeader && !b.isLeader) return -1
      if (!a.isLeader && b.isLeader) return 1
      const aApproved = a.membershipStatus === MembershipStatus.Approved || a.membershipStatus == null
      const bApproved = b.membershipStatus === MembershipStatus.Approved || b.membershipStatus == null
      if (aApproved && !bApproved) return -1
      if (!aApproved && bApproved) return 1
      return a.playerName.localeCompare(b.playerName)
    })
}

// ----- Modal handlers -----
const openManageTeamModal = (teamId: number) => {
  managingTeamId.value = teamId
  showManageTeamModal.value = true
}
const closeManageTeamModal = () => {
  showManageTeamModal.value = false
  managingTeamId.value = null
}
const isManagingOwnTeam = computed(() => managingTeamId.value === registrationStatus.value?.teamMembership?.teamId)
const isManagingOwnTeamAsLeader = computed(() => isManagingOwnTeam.value && (registrationStatus.value?.teamMembership?.isLeader ?? false))

const refreshAfterChange = async () => {
  clearCache(props.tournamentId)
  await loadRegistrationStatus()
  emit('refresh') // gate re-fetches the tournament; props flow back down
}

const handleTeamCreated = async () => {
  showCreateTeamModal.value = false
  await refreshAfterChange()
}

const handleTeamJoined = async (_teamId: number, teamName: string, isPending: boolean) => {
  showJoinTeamModal.value = false
  if (isPending) {
    notificationService.addNotification({
      type: 'info',
      title: 'Request Submitted',
      message: `Waiting for ${teamName} leader to approve your membership.`,
      duration: 5000,
    })
  }
  await refreshAfterChange()
}

const handleTeamUpdated = async () => { await refreshAfterChange() }
const handleLeftTeam = async () => {
  closeManageTeamModal()
  await refreshAfterChange()
}
const handleDeletedTeam = async () => {
  closeManageTeamModal()
  await refreshAfterChange()
}

const handleDiscordLogin = async () => {
  if (isLoginLoading.value) return
  try {
    isLoginLoading.value = true
    await loginWithDiscord()
  } catch (err) {
    console.error('Discord login failed:', err)
  } finally {
    isLoginLoading.value = false
  }
}

watch(() => isAuthenticated.value, (authenticated) => {
  if (authenticated) loadRegistrationStatus()
  else registrationStatus.value = null
}, { immediate: true })

watch(() => props.tournament.id, (id) => {
  if (id && isAuthenticated.value) loadRegistrationStatus()
})

onMounted(() => {
  if (isAuthenticated.value) loadRegistrationStatus()
})
</script>
