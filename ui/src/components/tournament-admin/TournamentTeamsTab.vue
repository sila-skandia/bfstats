<template>
  <div class="tournament-teams-tab mm-admin">
    <!-- Add/Edit Team View / Modal -->
    <div
      v-if="showForm"
      key="team-form-card"
      class="mm-admin-card"
    >
      <div class="mm-admin-card__head" style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <span class="mm-admin-label" style="margin-bottom: 2px;">Roster Management</span>
          <h2 class="mm-admin-card__title mm-admin-card__title--strong" style="font-size: 18px;">
            {{ editingTeam ? 'Edit Team' : 'Add Team' }}
          </h2>
        </div>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost"
          @click="closeForm"
        >
          Cancel
        </button>
      </div>

      <div class="mm-admin-card__body">
        <!-- Error Message -->
        <div
          v-if="formError"
          class="mm-admin-alert mm-admin-alert--err"
          style="margin-bottom: 14px;"
        >
          {{ formError }}
        </div>

        <div class="mm-admin-form-grid" style="grid-template-columns: 2fr 1fr;">
          <!-- Team Name -->
          <div>
            <label class="mm-admin-label">Team Name</label>
            <input
              v-model="formData.name"
              type="text"
              placeholder="e.g., Skandia or Black Knights"
              class="mm-admin-input"
              :disabled="formLoading"
            >
          </div>

          <!-- Tag -->
          <div>
            <label class="mm-admin-label">Tag</label>
            <input
              v-model="formData.tag"
              type="text"
              placeholder="e.g. [sK]"
              class="mm-admin-input mm-admin-input--mono"
              :disabled="formLoading"
            >
          </div>

          <!-- Players Section -->
          <div class="mm-admin-field--wide">
            <label class="mm-admin-label">Add Players</label>
            <MultiPlayerSelector
              :current-players="formData.players"
              :loading="formLoading"
              accent-color="var(--mm-accent)"
              text-color="var(--mm-ink)"
              text-muted-color="var(--mm-ink-muted)"
              background-color="var(--mm-bg)"
              background-mute-color="var(--mm-bg-mute)"
              @add-players="handleAddPlayers"
              @remove-player="removePlayer"
              @clear-all-players="clearAllPlayers"
            />
          </div>
        </div>

        <!-- Form Actions -->
        <div class="mm-admin-actions" style="margin-top: 20px;">
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--primary"
            :disabled="formLoading || !formData.name.trim()"
            @click="submitForm"
          >
            {{ formLoading ? 'Saving...' : (editingTeam ? 'Update Team' : 'Save Team') }}
          </button>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost"
            :disabled="formLoading"
            @click="closeForm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>

    <!-- Teams List View -->
    <div
      v-else
      key="teams-list-card"
      class="mm-admin-card"
    >
      <div class="mm-admin-card__head" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
          <div class="mm-admin-input-wrap" style="min-width: 240px; max-width: 360px; width: 100%;">
            <input
              v-model="teamFilterQuery"
              class="mm-admin-input"
              placeholder="Filter teams…"
            >
          </div>
        </div>

        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--primary"
          @click="openAddForm"
        >
          + Add Team
        </button>
      </div>

      <div class="mm-admin-card__body">
        <!-- Teams List / Cards -->
        <div
          v-if="filteredTeams.length > 0"
          style="display: flex; flex-direction: column; gap: 14px;"
        >
          <div
            v-for="team in filteredTeams"
            :key="team.id"
            class="mm-admin-card"
          >
            <div class="mm-admin-card__head" style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
              <span
                v-if="team.tag || getTeamTag(team.name)"
                class="mm-admin-mono"
                style="font-size: 11px; color: var(--mm-accent); border: 1px solid var(--mm-rule-strong); border-radius: 2px; padding: 2px 8px; font-weight: 500;"
              >
                {{ team.tag || getTeamTag(team.name) }}
              </span>
              <span style="font-family: var(--mm-font-display); font-size: 15px; font-weight: 500; color: var(--mm-ink);">
                {{ team.name }}
              </span>
              <span class="mm-admin-hint" style="margin: 0;">
                {{ team.players.length }} {{ team.players.length === 1 ? 'player' : 'players' }}
              </span>

              <div class="mm-admin-actions" style="margin-left: auto; margin-top: 0;">
                <button
                  type="button"
                  class="mm-admin-cell-btn"
                  @click="openEditForm(team.id)"
                >
                  Edit Team
                </button>
                <button
                  type="button"
                  class="mm-admin-cell-btn"
                  style="color: var(--mm-danger); border-color: var(--mm-danger);"
                  @click="confirmDeleteTeam(team.id, team.name)"
                >
                  Delete
                </button>
              </div>
            </div>

            <!-- Roster Table -->
            <!-- Roster Table -->
            <div v-if="team.players.length > 0" class="mm-admin-table-wrap">
              <div v-if="getSelectedPlayerCount(team.id) > 0" style="display: flex; align-items: center; justify-content: space-between; padding: 8px 14px; background: var(--mm-bg-mute); border-bottom: 1px solid var(--mm-rule);">
                <span class="mm-admin-mono" style="font-size: 11px; color: var(--mm-ink);">
                  {{ getSelectedPlayerCount(team.id) }} {{ getSelectedPlayerCount(team.id) === 1 ? 'player' : 'players' }} selected
                </span>
                <button
                  type="button"
                  class="mm-admin-cell-btn"
                  style="color: var(--mm-danger); border-color: var(--mm-danger);"
                  @click="confirmRemoveSelectedPlayers(team.id, team.name)"
                >
                  Remove Selected ({{ getSelectedPlayerCount(team.id) }})
                </button>
              </div>

              <table class="mm-admin-table" style="table-layout: fixed; width: 100%;">
                <thead>
                  <tr>
                    <th style="width: 36px; text-align: center; vertical-align: middle;">
                      <input
                        type="checkbox"
                        :checked="isAllPlayersSelected(team)"
                        style="cursor: pointer;"
                        @change="toggleSelectAllPlayers(team)"
                      >
                    </th>
                    <th style="vertical-align: middle;">Player</th>
                    <th style="width: 100px; text-align: right; vertical-align: middle;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="player in team.players" :key="player.playerName">
                    <td style="text-align: center; vertical-align: middle;">
                      <input
                        type="checkbox"
                        :checked="isPlayerSelected(team.id, player.playerName)"
                        style="cursor: pointer;"
                        @change="toggleSelectPlayer(team.id, player.playerName)"
                      >
                    </td>
                    <td style="font-weight: 500; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span>{{ $pn(player.playerName) }}</span>
                        <button
                          v-if="isTeamLeader(team, player)"
                          type="button"
                          class="mm-admin-chip"
                          title="Click to remove leader status"
                          style="color: var(--mm-accent); border-color: var(--mm-accent); font-size: 10px; padding: 1px 7px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;"
                          @click="toggleLeader(team, player)"
                        >
                          👑 Leader
                        </button>
                        <button
                          v-else
                          type="button"
                          class="mm-admin-cell-btn"
                          title="Set as Team Leader"
                          style="font-size: 10px; padding: 1px 6px; opacity: 0.65; border-style: dashed;"
                          @click="toggleLeader(team, player)"
                        >
                          👑 Set Leader
                        </button>
                      </div>
                    </td>
                    <td style="text-align: right; vertical-align: middle;">
                      <button
                        type="button"
                        class="mm-admin-cell-btn"
                        style="color: var(--mm-danger);"
                        @click="confirmRemoveSinglePlayer(team.id, team.name, player.playerName)"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div
          v-else
          class="mm-admin-empty"
        >
          <div class="mm-admin-empty__title">No Teams Found</div>
          <p class="mm-admin-empty__desc">
            Create teams to organize players for tournament matches.
          </p>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--primary"
            style="margin-top: 16px;"
            @click="openAddForm"
          >
            + Add First Team
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Team Confirmation Modal -->
    <MmBaseModal
      :model-value="!!deleteTeamConfirmation"
      title="Delete Team?"
      subtitle="Destructive Action"
      size="sm"
      @close="cancelDeleteTeam"
    >
      <p style="margin: 0 0 12px; font-size: 13px; color: var(--mm-ink-soft); line-height: 1.5;">
        Are you sure you want to delete team <strong style="color: var(--mm-ink);">{{ deleteTeamConfirmation?.name }}</strong>?
      </p>
      <p style="margin: 0; font-size: 12px; color: var(--mm-ink-muted); line-height: 1.4;">
        This will remove the team and all its roster player assignments from the tournament.
      </p>

      <template #footer>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost"
          :disabled="isDeleting"
          @click="cancelDeleteTeam"
        >
          Cancel
        </button>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--danger"
          :disabled="isDeleting"
          @click="executeDeleteTeam"
        >
          {{ isDeleting ? 'Deleting...' : 'Delete Team' }}
        </button>
      </template>
    </MmBaseModal>

    <!-- Remove Player Confirmation Modal -->
    <MmBaseModal
      :model-value="!!deletePlayerConfirmation"
      title="Remove Player?"
      subtitle="Roster Action"
      size="sm"
      @close="cancelDeletePlayer"
    >
      <p style="margin: 0 0 12px; font-size: 13px; color: var(--mm-ink-soft); line-height: 1.5;">
        <template v-if="deletePlayerConfirmation?.playerNames.length === 1">
          Are you sure you want to remove <strong style="color: var(--mm-ink);">{{ deletePlayerConfirmation?.playerNames[0] }}</strong> from team <strong style="color: var(--mm-ink);">{{ deletePlayerConfirmation?.teamName }}</strong>?
        </template>
        <template v-else>
          Are you sure you want to remove <strong style="color: var(--mm-ink);">{{ deletePlayerConfirmation?.playerNames.length }} players</strong> from team <strong style="color: var(--mm-ink);">{{ deletePlayerConfirmation?.teamName }}</strong>?
        </template>
      </p>

      <template #footer>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost"
          :disabled="isRemovingPlayer"
          @click="cancelDeletePlayer"
        >
          Cancel
        </button>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--danger"
          :disabled="isRemovingPlayer"
          @click="executeDeletePlayers"
        >
          {{ isRemovingPlayer ? 'Removing...' : 'Remove' }}
        </button>
      </template>
    </MmBaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import {
  adminTournamentService,
  type TournamentDetail,
  type TournamentTeam
} from '@/services/adminTournamentService';
import MultiPlayerSelector from '@/components/MultiPlayerSelector.vue';
import MmBaseModal from '@/components/v4/MmBaseModal.vue';

const props = defineProps<{
  tournament: TournamentDetail;
}>();

const emit = defineEmits<{
  (e: 'refresh'): void;
}>();

// Filter state
const teamFilterQuery = ref('');

const filteredTeams = computed(() => {
  const teams = props.tournament?.teams || [];
  if (!teamFilterQuery.value.trim()) return teams;
  const q = teamFilterQuery.value.toLowerCase().trim();
  return teams.filter(t => t.name.toLowerCase().includes(q) || (t.tag && t.tag.toLowerCase().includes(q)));
});

// Helpers
const getTeamTag = (teamName: string): string => {
  if (!teamName) return '';
  const match = teamName.match(/\[(.*?)\]|\((.*?)\)/);
  if (match) return match[1] || match[2];
  return teamName.substring(0, 3).toUpperCase();
};

// Selection state per team
const selectedPlayerNames = ref<Record<number, Set<string>>>({});

function getSelectedPlayerSet(teamId: number): Set<string> {
  if (!selectedPlayerNames.value[teamId]) {
    selectedPlayerNames.value[teamId] = new Set<string>();
  }
  return selectedPlayerNames.value[teamId];
}

function isPlayerSelected(teamId: number, playerName: string): boolean {
  return getSelectedPlayerSet(teamId).has(playerName);
}

function toggleSelectPlayer(teamId: number, playerName: string) {
  const set = getSelectedPlayerSet(teamId);
  if (set.has(playerName)) {
    set.delete(playerName);
  } else {
    set.add(playerName);
  }
}

function isAllPlayersSelected(team: TournamentTeam): boolean {
  if (!team?.players || team.players.length === 0) return false;
  const set = getSelectedPlayerSet(team.id);
  return team.players.every(p => set.has(p.playerName));
}

function toggleSelectAllPlayers(team: TournamentTeam) {
  const set = getSelectedPlayerSet(team.id);
  if (isAllPlayersSelected(team)) {
    set.clear();
  } else {
    team.players.forEach(p => set.add(p.playerName));
  }
}

function getSelectedPlayerCount(teamId: number): number {
  return getSelectedPlayerSet(teamId)?.size || 0;
}

function isTeamLeader(team: TournamentTeam, player: { playerName: string; isLeader?: boolean }): boolean {
  if (player.isLeader) return true;
  if (team.leaderPlayerName && team.leaderPlayerName.toLowerCase() === player.playerName.toLowerCase()) return true;
  return false;
}

// Leader Toggle
async function toggleLeader(team: TournamentTeam, player: { playerName: string; isLeader?: boolean }) {
  try {
    const currentlyLeader = isTeamLeader(team, player);
    const newLeaderName = currentlyLeader ? '' : player.playerName;
    
    // Optimistic local update
    team.leaderPlayerName = newLeaderName;
    team.players.forEach(p => {
      p.isLeader = (p.playerName.toLowerCase() === newLeaderName.toLowerCase());
    });

    await adminTournamentService.setTeamLeader(props.tournament.id, team.id, newLeaderName);
    emit('refresh');
  } catch (err) {
    console.error('Error setting team leader:', err);
  }
}

// Remove Player Confirmation & Execution
const deletePlayerConfirmation = ref<{ teamId: number; teamName: string; playerNames: string[] } | null>(null);
const isRemovingPlayer = ref(false);

const confirmRemoveSinglePlayer = (teamId: number, teamName: string, playerName: string) => {
  deletePlayerConfirmation.value = {
    teamId,
    teamName,
    playerNames: [playerName]
  };
};

const confirmRemoveSelectedPlayers = (teamId: number, teamName: string) => {
  const selected = Array.from(getSelectedPlayerSet(teamId));
  if (selected.length === 0) return;
  deletePlayerConfirmation.value = {
    teamId,
    teamName,
    playerNames: selected
  };
};

const cancelDeletePlayer = () => {
  deletePlayerConfirmation.value = null;
};

const executeDeletePlayers = async () => {
  if (!deletePlayerConfirmation.value) return;
  const { teamId, playerNames } = deletePlayerConfirmation.value;
  isRemovingPlayer.value = true;
  try {
    for (const name of playerNames) {
      await adminTournamentService.removePlayerFromTeam(props.tournament.id, teamId, name);
    }
    getSelectedPlayerSet(teamId).clear();
    cancelDeletePlayer();
    emit('refresh');
  } catch (err) {
    console.error('Error removing player(s) from team:', err);
  } finally {
    isRemovingPlayer.value = false;
  }
};

// Form state
const showForm = ref(false);
const editingTeam = ref<TournamentTeam | null>(null);
const formLoading = ref(false);
const formError = ref<string | null>(null);

const formData = ref({
  name: '',
  tag: '',
  players: [] as string[]
});

// Delete state
const deleteTeamConfirmation = ref<{ id: number; name: string } | null>(null);
const isDeleting = ref(false);

// Form handlers
const openAddForm = () => {
  editingTeam.value = null;
  formData.value = { name: '', tag: '', players: [] };
  formError.value = null;
  showForm.value = true;
};

const openEditForm = async (teamId: number) => {
  try {
    const team = await adminTournamentService.getTeamDetail(props.tournament.id, teamId);
    editingTeam.value = team;
    formData.value = {
      name: team.name,
      tag: team.tag || '',
      players: team.players.map(p => p.playerName)
    };
    formError.value = null;
    showForm.value = true;
  } catch (err) {
    console.error('Error loading team details:', err);
  }
};

const closeForm = () => {
  showForm.value = false;
  editingTeam.value = null;
  formError.value = null;
};

// Player management
const handleAddPlayers = (players: string[]) => {
  for (const playerName of players) {
    if (!formData.value.players.includes(playerName)) {
      formData.value.players.push(playerName);
    }
  }
  formError.value = null;
};

const removePlayer = (index: number) => {
  formData.value.players.splice(index, 1);
};

const clearAllPlayers = () => {
  formData.value.players = [];
};

const submitForm = async () => {
  if (!formData.value.name.trim()) return;

  formLoading.value = true;
  formError.value = null;

  try {
    if (editingTeam.value) {
      // Update team name/tag if changed
      if (formData.value.name !== editingTeam.value.name || formData.value.tag !== (editingTeam.value.tag || '')) {
        await adminTournamentService.updateTeam(props.tournament.id, editingTeam.value.id, {
          name: formData.value.name,
        });
      }

      // Sync players
      const currentPlayers = editingTeam.value.players.map(p => p.playerName);
      const newPlayers = formData.value.players;

      for (const player of currentPlayers) {
        if (!newPlayers.includes(player)) {
          await adminTournamentService.removePlayerFromTeam(props.tournament.id, editingTeam.value.id, player);
        }
      }

      for (const player of newPlayers) {
        if (!currentPlayers.includes(player)) {
          await adminTournamentService.addPlayerToTeam(props.tournament.id, editingTeam.value.id, {
            playerName: player,
          });
        }
      }
    } else {
      // Create new team
      const team = await adminTournamentService.createTeam(props.tournament.id, {
        name: formData.value.name,
      });

      // Add players
      for (const player of formData.value.players) {
        await adminTournamentService.addPlayerToTeam(props.tournament.id, team.id, {
          playerName: player,
        });
      }
    }

    closeForm();
    emit('refresh');
  } catch (err) {
    console.error('Error saving team:', err);
    formError.value = err instanceof Error ? err.message : 'Failed to save team';
  } finally {
    formLoading.value = false;
  }
};

// Delete handlers
const confirmDeleteTeam = (teamId: number, teamName: string) => {
  deleteTeamConfirmation.value = { id: teamId, name: teamName };
};

const cancelDeleteTeam = () => {
  deleteTeamConfirmation.value = null;
  isDeleting.value = false;
};

const executeDeleteTeam = async () => {
  if (!deleteTeamConfirmation.value) return;

  isDeleting.value = true;
  try {
    await adminTournamentService.deleteTeam(props.tournament.id, deleteTeamConfirmation.value.id);
    deleteTeamConfirmation.value = null;
    emit('refresh');
  } catch (err) {
    console.error('Error deleting team:', err);
  } finally {
    isDeleting.value = false;
  }
};

// Expose load method for parent to trigger refresh
const load = () => {
  // Teams data comes from parent, nothing to load here
};

defineExpose({ load });
</script>

<style scoped>
</style>
