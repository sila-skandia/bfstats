<template>
  <div class="tournament-matches-tab">
    <!-- Results Form View -->
    <TournamentResultsForm
      v-if="showResultsView && editingMatchForResultsView"
      :tournament="tournament"
      :match="editingMatchForResultsView"
      @close="closeResultsView"
      @updated="onRefresh"
    />

    <!-- Add/Edit Match View -->
    <div
      v-else-if="showForm"
      class="mm-admin-card"
    >
      <div class="mm-admin-card__head" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div>
          <h2 class="mm-admin-card__title mm-admin-card__title--strong" style="font-size: 14px;">
            {{ editingMatch ? 'EDIT MATCH' : 'SCHEDULE MATCH' }}
          </h2>
          <p class="mm-admin-card__desc">
            {{ editingMatch ? 'Update match details' : 'Schedule a new match in the tournament calendar' }}
          </p>
        </div>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
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
          style="margin-bottom: 16px;"
        >
          {{ formError }}
        </div>

        <!-- No Teams Warning -->
        <div
          v-if="tournament.teams.length < 2"
          class="mm-admin-alert mm-admin-alert--warn"
          style="margin-bottom: 16px;"
        >
          You need at least 2 teams to schedule a match.
        </div>

        <template v-else>
          <!-- Date & Week Row -->
          <div class="mm-admin-form-grid" style="grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); margin-bottom: 16px;">
            <div>
              <label class="mm-admin-label">Scheduled Date & Time *</label>
              <input
                v-model="formData.scheduledDate"
                type="datetime-local"
                class="mm-admin-input mm-admin-input--mono"
                :disabled="formLoading"
              >
            </div>
            <div>
              <label class="mm-admin-label">Week</label>
              <select
                v-model="formData.week"
                class="mm-admin-select"
                :disabled="formLoading || availableWeeksForForm.length === 0"
              >
                <option :value="null">
                  No Week (Unscheduled)
                </option>
                <option
                  v-for="week in availableWeeksForForm"
                  :key="week"
                  :value="week"
                >
                  {{ week }}
                </option>
              </select>
              <p class="mm-admin-hint">
                {{ availableWeeksForForm.length === 0 ? 'No week dates defined' : 'Optional: assign to a week' }}
              </p>
            </div>
          </div>

          <!-- Teams Section -->
          <div style="margin-bottom: 16px;">
            <label class="mm-admin-label">Match Teams *</label>
            <div class="teams-selector">
              <select
                v-model="formData.team1Id"
                class="mm-admin-select"
                :disabled="formLoading"
              >
                <option
                  :value="null"
                  disabled
                >
                  Team 1...
                </option>
                <option
                  v-for="team in tournament.teams"
                  :key="team.id"
                  :value="team.id"
                >
                  {{ team.name }} ({{ team.players.length }})
                </option>
              </select>
              <span class="vs-divider">VS</span>
              <select
                v-model="formData.team2Id"
                class="mm-admin-select"
                :disabled="formLoading"
              >
                <option
                  :value="null"
                  disabled
                >
                  Team 2...
                </option>
                <option
                  v-for="team in tournament.teams.filter(t => t.id !== formData.team1Id)"
                  :key="team.id"
                  :value="team.id"
                >
                  {{ team.name }} ({{ team.players.length }})
                </option>
              </select>
            </div>
          </div>

          <!-- Maps Section -->
          <div style="margin-bottom: 16px;">
            <label class="mm-admin-label">Maps *</label>
            <div class="maps-list">
              <div
                v-for="(_map, index) in formData.maps"
                :key="index"
                class="map-entry"
              >
                <span class="map-number mm-admin-mono">{{ index + 1 }}.</span>
                <input
                  v-model="formData.maps[index].name"
                  type="text"
                  placeholder="e.g., Wake Island, El Alamein"
                  class="mm-admin-input"
                  :disabled="formLoading"
                >
                <button
                  v-if="formData.maps.length > 1"
                  type="button"
                  class="mm-admin-btn mm-admin-btn--danger mm-admin-btn--sm"
                  :disabled="formLoading"
                  title="Remove map"
                  @click="removeMap(index)"
                >
                  Remove
                </button>
              </div>
              <button
                type="button"
                class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
                style="align-self: flex-start; margin-top: 6px;"
                :disabled="formLoading"
                @click="addMap"
              >
                + Add Map
              </button>
            </div>
          </div>

          <!-- Server Section -->
          <div style="margin-bottom: 16px;">
            <label class="mm-admin-label">Server (Optional)</label>
            <div class="server-search">
              <input
                v-model="serverSearchQuery"
                type="text"
                placeholder="Search or enter server name..."
                class="mm-admin-input"
                :disabled="formLoading"
                @input="onServerSearchInput"
                @focus="onServerSearchFocus"
                @blur="onServerSearchBlur"
              >
              <div
                v-if="formData.serverGuid"
                class="server-linked"
              >
                ✓ Linked
              </div>
            </div>
            <!-- Server Suggestions -->
            <div
              v-if="showServerDropdown && serverSuggestions.length > 0"
              class="mm-admin-dropdown"
            >
              <div
                v-for="server in serverSuggestions"
                :key="server.serverGuid"
                class="mm-admin-dropdown__item"
                @mousedown.prevent="selectServer(server)"
              >
                <div style="font-weight: 500;">
                  {{ server.serverName }}
                </div>
                <div style="font-family: var(--mm-font-mono); font-size: 10.5px; color: var(--mm-ink-muted);">
                  {{ server.serverIp }}:{{ server.serverPort }}
                </div>
              </div>
            </div>
            <p class="mm-admin-hint">
              {{ formData.serverGuid ? 'Server found and linked' : 'No server linked - name only will be saved' }}
            </p>
          </div>
        </template>

        <!-- Form Actions -->
        <div
          class="mm-admin-actions"
          style="margin-top: 20px; justify-content: flex-end;"
        >
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost"
            :disabled="formLoading"
            @click="closeForm"
          >
            Cancel
          </button>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--primary"
            :disabled="formLoading || !isFormValid"
            @click="submitForm"
          >
            <span v-if="formLoading">Saving...</span>
            <span v-else>{{ editingMatch ? 'Update Match' : 'Schedule Match' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Matches List View -->
    <div
      v-else-if="!showResultsView"
      class="mm-admin-card"
    >
      <div class="mm-admin-card__head" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
        <div>
          <span class="mm-admin-card__title">Match Calendar</span>
          <h2 class="mm-admin-card__title mm-admin-card__title--strong" style="font-size: 16px; margin-top: 2px;">
            Matches & Results
          </h2>
        </div>
        <div class="mm-admin-actions" style="margin-top: 0;">
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost"
            title="Refresh tournament rankings"
            @click="openRecalculateModal"
          >
            ↻ Recalculate Rankings
          </button>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--primary"
            :disabled="tournament.teams.length < 2"
            :title="tournament.teams.length < 2 ? 'Create at least 2 teams first' : ''"
            @click="openAddForm"
          >
            + Schedule Match
          </button>
        </div>
      </div>

      <div class="mm-admin-card__body" style="padding: 0;">
        <!-- Matches Table -->
        <div
          v-if="matchesByWeekGroups.length > 0"
          class="mm-admin-table-wrap"
        >
          <table class="mm-admin-table matches-table">
            <thead>
              <tr>
                <th style="width: 140px;">Date & Time</th>
                <th>Matchup & Server</th>
                <th>Maps & Scores</th>
                <th style="width: 110px;">Status</th>
                <th style="width: 140px; text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              <!-- Week groups with matches -->
              <template
                v-for="weekGroup in matchesByWeekGroups"
                :key="weekGroup.week || 'no-week'"
              >
                <!-- Week Header Row -->
                <tr
                  v-if="!weekGroup.hideWeekHeader"
                >
                  <td
                    colspan="5"
                    class="mm-admin-table__group"
                  >
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                      <div style="display: flex; align-items: center; gap: 12px;">
                        <span style="font-family: var(--mm-font-mono); font-size: 11px; font-weight: 600; color: var(--mm-ink);">{{ weekGroup.week }}</span>
                        <span style="font-family: var(--mm-font-mono); font-size: 10px; color: var(--mm-ink-muted); text-transform: none;">{{ getWeekDateRange(weekGroup.week, weekGroup.matches) }}</span>
                      </div>
                      <button
                        type="button"
                        class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
                        :disabled="tournament.teams.length < 2"
                        :title="tournament.teams.length < 2 ? 'Create at least 2 teams first' : ''"
                        @click="openAddForm"
                      >
                        + Match
                      </button>
                    </div>
                  </td>
                </tr>

                <!-- Match rows -->
                <tr
                  v-for="match in weekGroup.matches"
                  :key="match.id"
                  class="match-row"
                >
                  <!-- Date -->
                  <td class="mm-admin-mono" style="font-size: 11.5px; color: var(--mm-ink-muted);">
                    {{ formatMatchDate(match.scheduledDate) }}
                  </td>

                  <!-- Team Matchup -->
                  <td>
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                      <strong style="color: var(--mm-ink); font-size: 13px;">{{ match.team1Name }}</strong>
                      <span style="font-family: var(--mm-font-mono); font-size: 10px; color: var(--mm-ink-muted);">VS</span>
                      <strong style="color: var(--mm-ink); font-size: 13px;">{{ match.team2Name }}</strong>
                    </div>
                    <div
                      v-if="match.serverName"
                      style="font-family: var(--mm-font-mono); font-size: 10.5px; color: var(--mm-ink-muted); margin-top: 4px; display: flex; align-items: center; gap: 4px;"
                    >
                      <span>🖥️</span> {{ match.serverName }}
                    </div>
                  </td>

                  <!-- Maps Summary -->
                  <td>
                    <div
                      v-for="map in (match.maps || []).filter((m: any) => m)"
                      :key="map.id"
                      style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;"
                    >
                      <span class="mm-admin-mono" style="font-size: 10.5px; color: var(--mm-ink-muted);">{{ map.mapOrder + 1 }}.</span>
                      <span style="font-size: 12.5px; color: var(--mm-ink); font-weight: 500;">{{ map.mapName }}</span>
                      <span
                        v-if="map.matchResults?.length > 0"
                        class="mm-admin-mono"
                        style="font-size: 11px; color: var(--mm-accent); font-weight: 600;"
                      >
                        {{ getResultsAggregation(map) }}
                      </span>
                      <span
                        v-else
                        class="mm-admin-mono"
                        style="font-size: 11px; color: var(--mm-ink-faint);"
                      >—</span>
                    </div>
                  </td>

                  <!-- Results Count -->
                  <td>
                    <div v-if="(match.maps || []).length > 0">
                      <div
                        v-for="map in (match.maps || []).filter((m: any) => m)"
                        :key="`status-${map.id}`"
                        style="margin-bottom: 4px;"
                      >
                        <span
                          v-if="!map.matchResults?.length"
                          style="font-size: 11px; color: var(--mm-ink-muted);"
                        >No results</span>
                        <span
                          v-else
                          style="font-size: 11px; color: var(--mm-load-ok); font-weight: 500;"
                        >
                          {{ map.matchResults.length }} round<span v-if="map.matchResults.length !== 1">s</span>
                        </span>
                      </div>
                    </div>
                  </td>

                  <!-- Actions -->
                  <td style="text-align: right;">
                    <div style="display: flex; align-items: center; justify-content: flex-end; gap: 6px;">
                      <button
                        type="button"
                        class="mm-admin-cell-btn"
                        title="Enter match results for all maps"
                        @click="openResultsView(match)"
                      >
                        Results
                      </button>
                      <button
                        type="button"
                        class="mm-admin-cell-btn"
                        title="Add files and comments"
                        @click="openMatchFilesAndCommentsModal(match)"
                      >
                        Files
                      </button>
                      <button
                        type="button"
                        class="mm-admin-cell-btn"
                        title="Edit match"
                        @click="editMatch(match.id)"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        class="mm-admin-cell-btn"
                        style="color: var(--mm-danger); border-color: rgba(231, 76, 60, 0.4);"
                        title="Delete match"
                        @click="confirmDeleteMatch(match.id)"
                      >
                        Del
                      </button>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <!-- Empty State -->
        <div
          v-else
          class="mm-admin-empty"
        >
          <div style="font-size: 32px; margin-bottom: 8px;">
            📅
          </div>
          <h3 class="mm-admin-empty__title">
            No Matches Scheduled
          </h3>
          <p class="mm-admin-empty__desc">
            {{ tournament.teams.length < 2 ? 'Create at least 2 teams before scheduling matches' : 'Schedule matches to organize your tournament calendar' }}
          </p>
          <button
            v-if="tournament.teams.length >= 2"
            type="button"
            class="mm-admin-btn mm-admin-btn--primary"
            style="margin-top: 16px"
            @click="openAddForm"
          >
            Schedule First Match
          </button>
        </div>
      </div>
    </div>

    <!-- Match Files and Comments Modal -->
    <MatchFilesAndCommentsModal
      v-if="showMatchFilesAndCommentsModal && editingMatchForFilesAndComments"
      :tournament-id="tournament.id"
      :match="editingMatchForFilesAndComments"
      @close="showMatchFilesAndCommentsModal = false; editingMatchForFilesAndComments = null"
      @saved="onRefresh"
    />

    <!-- Delete Match Confirmation Modal -->
    <div
      v-if="deleteMatchConfirmation"
      style="position: fixed; inset: 0; z-index: 999; background: rgba(0,0,0,0.75); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 16px;"
      @click.self="cancelDeleteMatch"
    >
      <div class="mm-admin-card" style="width: 100%; max-width: 440px;">
        <div class="mm-admin-card__head">
          <h3 class="mm-admin-card__title mm-admin-card__title--strong" style="font-size: 14px; color: var(--mm-danger);">
            Delete Match?
          </h3>
        </div>
        <div class="mm-admin-card__body">
          <p style="font-size: 13px; color: var(--mm-ink); margin: 0 0 8px;">
            Are you sure you want to delete this scheduled match?
          </p>
          <p style="font-size: 12px; color: var(--mm-ink-muted); margin: 0;">
            This action cannot be undone and will remove associated map results.
          </p>

          <div class="mm-admin-actions" style="margin-top: 20px; justify-content: flex-end;">
            <button
              type="button"
              class="mm-admin-btn mm-admin-btn--ghost"
              @click="cancelDeleteMatch"
            >
              Cancel
            </button>
            <button
              type="button"
              class="mm-admin-btn mm-admin-btn--danger"
              :disabled="isDeleting"
              @click="executeDeleteMatch"
            >
              <span>{{ isDeleting ? 'Deleting...' : 'Delete Match' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Recalculate Leaderboard Modal -->
    <div
      v-if="showRecalculateModal"
      style="position: fixed; inset: 0; z-index: 999; background: rgba(0,0,0,0.75); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 16px;"
      @click.self="closeRecalculateModal"
    >
      <div class="mm-admin-card" style="width: 100%; max-width: 520px;">
        <div class="mm-admin-card__head">
          <h3 class="mm-admin-card__title mm-admin-card__title--strong" style="font-size: 14px;">
            Recalculate Leaderboard
          </h3>
          <p class="mm-admin-card__desc">
            Choose how you want to recalculate tournament rankings
          </p>
        </div>

        <div class="mm-admin-card__body" style="display: flex; flex-direction: column; gap: 14px;">
          <!-- Option 1: Recalculate Everything -->
          <label class="mm-admin-card" style="padding: 12px; cursor: pointer; display: flex; gap: 12px; align-items: flex-start;">
            <input
              v-model="recalculationMode"
              type="radio"
              value="everything"
              style="margin-top: 3px;"
            >
            <div>
              <div style="font-size: 13px; font-weight: 500; color: var(--mm-ink);">Recalculate Everything</div>
              <div style="font-size: 11.5px; color: var(--mm-ink-muted); margin-top: 2px;">Recalculates all weeks and cumulative leaderboard</div>
            </div>
          </label>

          <!-- Option 2: Fix a Specific Week (only show if multiple weeks) -->
          <label
            v-if="hasMultipleWeeks"
            class="mm-admin-card"
            style="padding: 12px; cursor: pointer; display: flex; gap: 12px; align-items: flex-start;"
          >
            <input
              v-model="recalculationMode"
              type="radio"
              value="specific-week"
              style="margin-top: 3px;"
            >
            <div style="flex: 1;">
              <div style="font-size: 13px; font-weight: 500; color: var(--mm-ink);">Fix a Specific Week</div>
              <div style="font-size: 11.5px; color: var(--mm-ink-muted); margin-top: 2px;">Recalculate only that week</div>
              <select
                v-if="recalculationMode === 'specific-week'"
                v-model="selectedWeek"
                class="mm-admin-select"
                style="margin-top: 8px;"
              >
                <option :value="null">Select a week...</option>
                <option
                  v-for="week in availableWeeks"
                  :key="week"
                  :value="week"
                >
                  {{ week }}
                </option>
              </select>
            </div>
          </label>

          <!-- Option 3: Recalculate From Week Onwards (only show if multiple weeks) -->
          <label
            v-if="hasMultipleWeeks"
            class="mm-admin-card"
            style="padding: 12px; cursor: pointer; display: flex; gap: 12px; align-items: flex-start;"
          >
            <input
              v-model="recalculationMode"
              type="radio"
              value="from-week"
              style="margin-top: 3px;"
            >
            <div style="flex: 1;">
              <div style="font-size: 13px; font-weight: 500; color: var(--mm-ink);">Recalculate From Week Onwards</div>
              <div style="font-size: 11.5px; color: var(--mm-ink-muted); margin-top: 2px;">Recalculate from selected week through cumulative</div>
              <select
                v-if="recalculationMode === 'from-week'"
                v-model="fromWeek"
                class="mm-admin-select"
                style="margin-top: 8px;"
              >
                <option :value="null">Select starting week...</option>
                <option
                  v-for="week in availableWeeks"
                  :key="week"
                  :value="week"
                >
                  {{ week }}
                </option>
              </select>
            </div>
          </label>

          <!-- Message Display -->
          <div
            v-if="recalculationMessage"
            :class="['mm-admin-alert', recalculationMessage.type === 'success' ? 'mm-admin-alert--ok' : 'mm-admin-alert--err']"
          >
            {{ recalculationMessage.text }}
          </div>

          <!-- Action Buttons -->
          <div class="mm-admin-actions" style="margin-top: 10px; justify-content: flex-end;">
            <button
              type="button"
              class="mm-admin-btn mm-admin-btn--ghost"
              :disabled="isRecalculating"
              @click="closeRecalculateModal"
            >
              Cancel
            </button>
            <button
              type="button"
              class="mm-admin-btn mm-admin-btn--primary"
              :disabled="isRecalculating || (recalculationMode === 'specific-week' && !selectedWeek) || (recalculationMode === 'from-week' && !fromWeek)"
              @click="recalculateLeaderboard"
            >
              <span>{{ isRecalculating ? 'Recalculating...' : 'Recalculate' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  adminTournamentService,
  type TournamentDetail,
  type TournamentMatch,
  type TournamentMatchMap
} from '@/services/adminTournamentService';
import TournamentResultsForm from './TournamentResultsForm.vue';
import MatchFilesAndCommentsModal from '@/components/tournament-admin/MatchFilesAndCommentsModal.vue';

interface ServerSearchResult {
  serverGuid: string;
  serverName: string;
  serverIp: string;
  serverPort: number;
  gameType: string;
}

interface MapEntry {
  name: string;
}

const props = defineProps<{
  tournament: TournamentDetail;
}>();

const emit = defineEmits<{
  (e: 'refresh'): void;
}>();

const route = useRoute();
const router = useRouter();

// Form state
const showForm = ref(false);
const editingMatch = ref<TournamentMatch | undefined>(undefined);
const formLoading = ref(false);
const formError = ref<string | null>(null);

const formData = ref({
  scheduledDate: '',
  week: null as string | null,
  team1Id: null as number | null,
  team2Id: null as number | null,
  maps: [{ name: '' }] as MapEntry[],
  serverGuid: '',
  serverName: ''
});

// Server search state
const serverSearchQuery = ref('');
const serverSuggestions = ref<ServerSearchResult[]>([]);
const showServerDropdown = ref(false);
let serverSearchTimeout: number | null = null;
let blurTimeout: number | null = null;

// Results form view state - derived from route params
const editingMatchForResultsView = ref<TournamentMatch | null>(null);

const showResultsView = computed(() => {
  return !!route.query.matchId;
});

// Other modal states
const showMatchFilesAndCommentsModal = ref(false);
const editingMatchForFilesAndComments = ref<TournamentMatch | null>(null);
const deleteMatchConfirmation = ref<{ id: number } | null>(null);
const isDeleting = ref(false);

// Recalculate modal states
const showRecalculateModal = ref(false);
const recalculationMode = ref<'everything' | 'specific-week' | 'from-week'>('everything');
const selectedWeek = ref<string | null>(null);
const fromWeek = ref<string | null>(null);
const isRecalculating = ref(false);
const recalculationMessage = ref<{ type: 'success' | 'error'; text: string } | null>(null);

// Computed properties
const matchesByWeekGroups = computed(() => {
  if (!props.tournament) return [];

  // Use matchesByWeek if available
  if (props.tournament.matchesByWeek && props.tournament.matchesByWeek.length > 0) {
    const hasOnlyOneNullWeek = props.tournament.matchesByWeek.length === 1 && props.tournament.matchesByWeek[0].week === null;

    return props.tournament.matchesByWeek.map(group => ({
      week: group.week,
      hideWeekHeader: hasOnlyOneNullWeek,
      matches: [...group.matches].sort((a, b) => {
        return new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime();
      })
    }));
  }

  // Fallback: group by week field
  const groups: Map<string | null, typeof props.tournament.matches> = new Map();

  props.tournament.matches.forEach(match => {
    const week = match.week ?? null;
    if (!groups.has(week)) {
      groups.set(week, []);
    }
    groups.get(week)!.push(match);
  });

  const hasOnlyOneNullWeek = groups.size === 1 && groups.has(null);

  return Array.from(groups.entries())
    .map(([week, matches]) => ({
      week,
      hideWeekHeader: hasOnlyOneNullWeek,
      matches: [...matches].sort((a, b) => {
        return new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime();
      })
    }))
    .sort((a, b) => {
      if (a.week === null) return 1;
      if (b.week === null) return -1;
      return (a.week || '').localeCompare(b.week || '');
    });
});

const availableWeeks = computed(() => {
  return matchesByWeekGroups.value
    .filter(group => group.week !== null)
    .map(group => group.week as string);
});

const hasMultipleWeeks = computed(() => {
  return availableWeeks.value.length > 1;
});

// Watch for route changes to load the selected match
watch(() => route.query.matchId, async (matchId) => {
  if (matchId) {
    try {
      const freshMatch = await adminTournamentService.getMatchDetail(props.tournament.id, Number(matchId));
      editingMatchForResultsView.value = freshMatch;
    } catch (err) {
      console.error('Error loading match details:', err);
      editingMatchForResultsView.value = null;
    }
  } else {
    editingMatchForResultsView.value = null;
  }
}, { immediate: true });

// Form computed properties
const availableWeeksForForm = computed(() => {
  if (!props.tournament?.weekDates || props.tournament.weekDates.length === 0) {
    return [];
  }
  return props.tournament.weekDates.map(wd => wd.week).sort();
});

const isFormValid = computed(() => {
  return (
    formData.value.scheduledDate.length > 0 &&
    formData.value.team1Id !== null &&
    formData.value.team2Id !== null &&
    formData.value.team1Id !== formData.value.team2Id &&
    formData.value.maps.length > 0 &&
    formData.value.maps.every(map => map.name.trim().length > 0)
  );
});

// Formatting
const formatMatchDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const getWeekDateRange = (week: string | null, matches?: TournamentMatch[]): string => {
  if (props.tournament?.weekDates && week) {
    const weekDate = props.tournament.weekDates.find(w => w.week === week);
    if (weekDate) {
      const formatDateRange = (date: Date) => {
        return date.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric'
        });
      };
      const startDate = new Date(weekDate.startDate);
      const endDate = new Date(weekDate.endDate);
      return `${formatDateRange(startDate)} - ${formatDateRange(endDate)}`;
    }
  }

  if (!matches || matches.length === 0) return '';

  const dates = matches.map(m => new Date(m.scheduledDate));
  if (dates.length === 0) return '';

  const earliestDate = new Date(Math.min(...dates.map(d => d.getTime())));
  const latestDate = new Date(Math.max(...dates.map(d => d.getTime())));

  const formatDateRange = (date: Date) => {
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    });
  };

  return `${formatDateRange(earliestDate)} - ${formatDateRange(latestDate)}`;
};

const getResultsAggregation = (map: TournamentMatchMap): string => {
  const results = map.matchResults;
  if (!results || results.length === 0) return '—';

  const team1Id = results[0]?.team1Id;
  const team2Id = results[0]?.team2Id;
  if (!team1Id || !team2Id) return '—';

  const team1Wins = results.filter((r) => r.winningTeamId === team1Id).length;
  const team2Wins = results.filter((r) => r.winningTeamId === team2Id).length;
  const draws = results.filter((r) => r.winningTeamId !== team1Id && r.winningTeamId !== team2Id).length;

  if (draws > 0) {
    return `${team1Wins}-${team2Wins}-${draws}`;
  }
  return `${team1Wins}-${team2Wins}`;
};

// Helper functions
const roundToNextCleanTime = (date: Date): Date => {
  const rounded = new Date(date);
  const minutes = rounded.getMinutes();
  if (minutes < 30) {
    rounded.setMinutes(30, 0, 0);
  } else {
    rounded.setHours(rounded.getHours() + 1);
    rounded.setMinutes(0, 0, 0);
  }
  return rounded;
};

const dateToDatetimeLocal = (date: Date): string => {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
};

// Form handlers
const openAddForm = () => {
  editingMatch.value = undefined;
  const now = new Date();
  const rounded = roundToNextCleanTime(now);
  formData.value = {
    scheduledDate: dateToDatetimeLocal(rounded),
    week: null,
    team1Id: null,
    team2Id: null,
    maps: [{ name: '' }],
    serverGuid: '',
    serverName: ''
  };
  serverSearchQuery.value = '';
  formError.value = null;
  showForm.value = true;
};

const editMatch = async (matchId: number) => {
  try {
    const match = await adminTournamentService.getMatchDetail(props.tournament.id, matchId);
    editingMatch.value = match;

    const team1 = props.tournament.teams.find(t => t.name === match.team1Name);
    const team2 = props.tournament.teams.find(t => t.name === match.team2Name);

    formData.value = {
      scheduledDate: dateToDatetimeLocal(new Date(match.scheduledDate)),
      week: match.week || null,
      team1Id: team1?.id || null,
      team2Id: team2?.id || null,
      maps: match.maps.map(m => ({ name: m.mapName })),
      serverGuid: match.serverGuid || '',
      serverName: match.serverName || ''
    };
    serverSearchQuery.value = match.serverName || '';
    formError.value = null;
    showForm.value = true;
  } catch (err) {
    console.error('Error loading match details:', err);
  }
};

const closeForm = () => {
  showForm.value = false;
  editingMatch.value = undefined;
  formError.value = null;
};

const addMap = () => {
  formData.value.maps.push({ name: '' });
};

const removeMap = (index: number) => {
  formData.value.maps.splice(index, 1);
};

// Server search functions
const searchServers = async (query: string) => {
  if (!query || query.length < 2) {
    serverSuggestions.value = [];
    showServerDropdown.value = false;
    return;
  }

  try {
    const response = await fetch(`/stats/servers/search?query=${encodeURIComponent(query)}&pageSize=10`);
    if (!response.ok) throw new Error('Failed to search servers');
    const data = await response.json();
    serverSuggestions.value = data.items || [];
    showServerDropdown.value = (data.items?.length || 0) > 0;
  } catch (error) {
    console.error('Error searching servers:', error);
    serverSuggestions.value = [];
    showServerDropdown.value = false;
  }
};

const onServerSearchInput = () => {
  if (formData.value.serverGuid) {
    formData.value.serverGuid = '';
  }
  if (serverSearchTimeout) {
    clearTimeout(serverSearchTimeout);
  }
  serverSearchTimeout = setTimeout(() => {
    searchServers(serverSearchQuery.value);
  }, 300) as unknown as number;
};

const onServerSearchFocus = () => {
  if (blurTimeout) {
    clearTimeout(blurTimeout);
  }
  if (serverSearchQuery.value.length >= 2) {
    searchServers(serverSearchQuery.value);
  }
};

const onServerSearchBlur = () => {
  blurTimeout = setTimeout(() => {
    showServerDropdown.value = false;
  }, 200) as unknown as number;
};

const selectServer = (server: ServerSearchResult) => {
  serverSearchQuery.value = server.serverName;
  formData.value.serverGuid = server.serverGuid;
  formData.value.serverName = server.serverName;
  serverSuggestions.value = [];
  showServerDropdown.value = false;
};

const submitForm = async () => {
  if (!isFormValid.value) return;

  formLoading.value = true;
  formError.value = null;

  try {
    const serverName = serverSearchQuery.value.trim() || formData.value.serverName.trim();
    const weekValue = formData.value.week ? formData.value.week.trim() : null;
    const scheduledDate = new Date(formData.value.scheduledDate);

    const requestData = {
      scheduledDate: scheduledDate.toISOString(),
      team1Id: formData.value.team1Id!,
      team2Id: formData.value.team2Id!,
      maps: formData.value.maps
        .filter(map => map.name.trim().length > 0)
        .map(map => ({ mapName: map.name.trim() })),
      serverGuid: formData.value.serverGuid.trim() || undefined,
      serverName: serverName || undefined,
      week: weekValue && weekValue.length > 0 ? weekValue : null,
    };

    if (editingMatch.value) {
      await adminTournamentService.updateMatch(props.tournament.id, editingMatch.value.id, requestData);
    } else {
      await adminTournamentService.createMatch(props.tournament.id, requestData);
    }

    closeForm();
    emit('refresh');
  } catch (err) {
    console.error('Error saving match:', err);
    formError.value = err instanceof Error ? err.message : 'Failed to save match';
  } finally {
    formLoading.value = false;
  }
};

const openResultsView = (match: TournamentMatch) => {
  router.push({
    query: {
      ...route.query,
      matchId: match.id.toString()
    }
  });
};

const closeResultsView = () => {
  router.push({
    query: {
      ...route.query,
      matchId: undefined,
      resultId: undefined
    }
  });
};

const openMatchFilesAndCommentsModal = (match: TournamentMatch) => {
  editingMatchForFilesAndComments.value = match;
  showMatchFilesAndCommentsModal.value = true;
};

const confirmDeleteMatch = (matchId: number) => {
  deleteMatchConfirmation.value = { id: matchId };
};

const cancelDeleteMatch = () => {
  deleteMatchConfirmation.value = null;
  isDeleting.value = false;
};

const executeDeleteMatch = async () => {
  if (!deleteMatchConfirmation.value) return;

  isDeleting.value = true;
  try {
    await adminTournamentService.deleteMatch(props.tournament.id, deleteMatchConfirmation.value.id);
    deleteMatchConfirmation.value = null;
    emit('refresh');
  } catch (err) {
    console.error('Error deleting match:', err);
  } finally {
    isDeleting.value = false;
  }
};

const onRefresh = () => {
  emit('refresh');
};

// Recalculate modal
const openRecalculateModal = () => {
  recalculationMode.value = 'everything';
  selectedWeek.value = null;
  fromWeek.value = null;
  recalculationMessage.value = null;
  showRecalculateModal.value = true;
};

const closeRecalculateModal = () => {
  showRecalculateModal.value = false;
  recalculationMessage.value = null;
};

const recalculateLeaderboard = async () => {
  isRecalculating.value = true;
  recalculationMessage.value = null;

  try {
    const { authService } = await import('@/services/authService');
    await authService.ensureValidToken();
    const token = localStorage.getItem('authToken');

    const payload: Record<string, string> = {};
    if (recalculationMode.value === 'specific-week' && selectedWeek.value) {
      payload.week = selectedWeek.value;
    } else if (recalculationMode.value === 'from-week' && fromWeek.value) {
      payload.fromWeek = fromWeek.value;
    }

    const response = await fetch(`/stats/admin/tournaments/${props.tournament.id}/leaderboard/recalculate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Failed to recalculate leaderboard');
    }

    recalculationMessage.value = {
      type: 'success',
      text: 'Leaderboard recalculated successfully'
    };

    setTimeout(() => {
      closeRecalculateModal();
    }, 2000);
  } catch (err) {
    console.error('Error recalculating leaderboard:', err);
    recalculationMessage.value = {
      type: 'error',
      text: err instanceof Error ? err.message : 'Failed to recalculate leaderboard'
    };
  } finally {
    isRecalculating.value = false;
  }
};

// Expose load method for parent to trigger refresh
const load = () => {
  // Matches data comes from parent, nothing to load here
};

defineExpose({ load });
</script>

<style scoped>
.matches-table {
  width: 100%;
}

.teams-selector {
  display: flex;
  align-items: center;
  gap: 12px;
}

.teams-selector .mm-admin-select {
  flex: 1;
}

.vs-divider {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--mm-accent);
  flex-shrink: 0;
}

.maps-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.map-entry {
  display: flex;
  align-items: center;
  gap: 8px;
}

.map-entry .mm-admin-input {
  flex: 1;
}

.map-number {
  font-size: 11px;
  color: var(--mm-ink-muted);
  width: 18px;
  flex-shrink: 0;
}

.server-search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
}

.server-search .mm-admin-input {
  flex: 1;
}

.server-linked {
  font-family: var(--mm-font-mono);
  font-size: 11px;
  font-weight: 500;
  color: var(--mm-load-ok);
  flex-shrink: 0;
}

@media (max-width: 640px) {
  .teams-selector {
    flex-direction: column;
  }

  .vs-divider {
    margin: 4px 0;
  }
}
</style>
