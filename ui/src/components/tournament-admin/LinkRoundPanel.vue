<template>
  <SlidePanel
    :open="open"
    title="Link Server Round"
    eyebrow="ROUND DATA LINKER"
    subtitle="Search live server round telemetry to link raw stats to a map result"
    size="lg"
    @close="$emit('close')"
  >
    <!-- Mode Selector Chips -->
    <div class="mm-admin-chips" style="margin-bottom: 16px;">
      <button
        type="button"
        :class="['mm-admin-chip', searchMode === 'search' && 'mm-admin-chip--active']"
        @click="searchMode = 'search'"
      >
        Search Rounds
      </button>
      <button
        type="button"
        :class="['mm-admin-chip', searchMode === 'direct' && 'mm-admin-chip--active']"
        @click="searchMode = 'direct'"
      >
        Enter Round ID
      </button>
    </div>

    <!-- Direct Round ID Input Mode -->
    <div
      v-if="searchMode === 'direct'"
      class="mm-admin-card"
      style="padding: 16px;"
    >
      <label class="mm-admin-label">Round ID</label>
      <input
        v-model="directRoundId"
        type="text"
        placeholder="e.g., bf1942-server-guid-2026-01-24-21-30-00"
        class="mm-admin-input mm-admin-input--mono"
      >
      <p class="mm-admin-hint">
        Enter the exact server round ID to fetch ticket scores and round telemetry directly.
      </p>
    </div>

    <!-- Search Mode -->
    <div
      v-else
      style="display: flex; flex-direction: column; gap: 14px;"
    >
      <!-- Server Selection -->
      <div>
        <label class="mm-admin-label">Server</label>

        <!-- Selected Server Display -->
        <div
          v-if="selectedServer"
          class="mm-admin-card__head"
          style="display: flex; align-items: center; justify-content: space-between; border: 1px solid var(--mm-rule-strong); border-radius: 2px;"
        >
          <div>
            <div class="mm-admin-card__title mm-admin-card__title--strong">
              {{ selectedServer.serverName }}
            </div>
            <div
              v-if="selectedServer.serverIp && selectedServer.serverPort"
              class="mm-admin-hint"
            >
              {{ selectedServer.serverIp }}:{{ selectedServer.serverPort }}
            </div>
          </div>
          <button
            type="button"
            class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
            title="Change server"
            @click="clearServerSelection"
          >
            Change
          </button>
        </div>

        <!-- Server Search Input -->
        <div
          v-else
          class="mm-admin-input-wrap"
        >
          <input
            v-model="serverSearchQuery"
            type="text"
            placeholder="Search server by name or IP…"
            class="mm-admin-input"
            @input="onServerSearchInput"
            @focus="onServerSearchFocus"
            @blur="onServerSearchBlur"
          >

          <!-- Server Dropdown -->
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
              <div class="mm-admin-hint" style="margin-top: 2px;">
                {{ server.serverIp }}:{{ server.serverPort }}
              </div>
            </div>
          </div>
          <div
            v-else-if="showServerDropdown && serverSearchQuery.length >= 2 && !isServerSearchLoading"
            class="mm-admin-dropdown"
          >
            <div class="mm-admin-dropdown__ghost">
              No servers found
            </div>
          </div>
        </div>
      </div>

      <!-- Map Name Search -->
      <div>
        <label class="mm-admin-label">Filter by Map Name</label>
        <input
          v-model="filters.mapName"
          type="text"
          placeholder="e.g. Kursk, Omaha Beach, Wake Island…"
          class="mm-admin-input"
          @input="debouncedSearch"
        >
      </div>

      <!-- Search Button -->
      <button
        type="button"
        :disabled="!selectedServer || searchingRounds"
        class="mm-admin-btn mm-admin-btn--primary"
        @click="searchRounds"
      >
        {{ searchingRounds ? 'Searching...' : 'Search Server Rounds' }}
      </button>

      <!-- Rounds List -->
      <div class="rounds-section" style="margin-top: 8px;">
        <!-- Loading State -->
        <div
          v-if="loading"
          class="mm-admin-empty mm-admin-empty--loading"
        >
          <div class="mm-admin-spinner" />
          <span class="mm-admin-empty__desc" style="margin-top: 8px;">Fetching round telemetry…</span>
        </div>

        <!-- Error State -->
        <div
          v-else-if="searchError"
          class="mm-admin-alert mm-admin-alert--err"
        >
          {{ searchError }}
        </div>

        <!-- Rounds Table -->
        <div
          v-else-if="rounds.length > 0"
          class="mm-admin-card"
        >
          <div class="mm-admin-card__head" style="display: flex; justify-content: space-between; align-items: center;">
            <span class="mm-admin-card__title">Available Rounds</span>
            <span class="mm-admin-hint" style="margin: 0;">
              {{ selectedRoundId ? '1 round selected' : 'Click a row to select' }}
            </span>
          </div>

          <div class="mm-admin-table-wrap">
            <table class="mm-admin-table">
              <thead>
                <tr>
                  <th style="width: 28px;" />
                  <th>Round & Map</th>
                  <th class="is-num">Players</th>
                  <th class="is-num">Duration</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="round in rounds"
                  :key="round.roundId"
                  :style="selectedRoundId === round.roundId ? 'background: var(--mm-bg-mute);' : ''"
                  style="cursor: pointer;"
                  @click="toggleRoundSelection(round.roundId)"
                >
                  <td>
                    <span
                      style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; border: 1px solid var(--mm-rule-strong);"
                      :style="selectedRoundId === round.roundId ? 'background: var(--mm-accent); border-color: var(--mm-accent);' : ''"
                    />
                  </td>
                  <td>
                    <div style="font-weight: 500; color: var(--mm-ink);">
                      {{ round.mapName }}
                    </div>
                    <div class="mm-admin-mono" style="font-size: 10px; color: var(--mm-ink-muted);">
                      {{ round.roundId }} · {{ formatDateTime(round.startTime) }}
                    </div>
                  </td>
                  <td class="is-num">
                    {{ round.participantCount }}
                  </td>
                  <td class="is-num">
                    {{ round.durationMinutes }}m
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div
            v-if="totalPages > 1"
            class="mm-admin-pagination"
          >
            <span>Page {{ currentPage }} of {{ totalPages }}</span>
            <div class="mm-admin-pagination__controls">
              <button
                type="button"
                :disabled="currentPage === 1"
                class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
                @click="changePage(currentPage - 1)"
              >
                Prev
              </button>
              <button
                type="button"
                :disabled="currentPage === totalPages"
                class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
                @click="changePage(currentPage + 1)"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div
          v-else-if="hasSearched"
          class="mm-admin-empty"
        >
          <div class="mm-admin-empty__title">No Rounds Found</div>
          <p class="mm-admin-empty__desc">
            Try adjusting your search criteria or date filter.
          </p>
        </div>

        <!-- Initial State -->
        <div
          v-else
          class="mm-admin-empty"
        >
          <div class="mm-admin-empty__title">Select a Server</div>
          <p class="mm-admin-empty__desc">
            Choose a server above to search live telemetry rounds.
          </p>
        </div>
      </div>
    </div>

    <!-- Error Message -->
    <div
      v-if="error"
      class="mm-admin-alert mm-admin-alert--err"
      style="margin-top: 14px;"
    >
      {{ error }}
    </div>

    <!-- Footer -->
    <template #footer>
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost"
          @click="$emit('close')"
        >
          Cancel
        </button>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--primary"
          :disabled="!selectedRoundId && !directRoundId"
          @click="linkRound"
        >
          Link Selected Round
        </button>
      </div>
    </template>
  </SlidePanel>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import SlidePanel from './SlidePanel.vue';

interface ServerSearchResult {
  serverGuid: string;
  serverName: string;
  serverIp: string;
  serverPort: number;
  gameType: string;
}

interface RoundListItem {
  roundId: string;
  serverName: string;
  serverGuid: string;
  mapName: string;
  gameType: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  participantCount: number;
  isActive: boolean;
}

interface Props {
  open: boolean;
  game: 'bf1942';
  defaultServerGuid?: string;
  defaultServerName?: string;
  defaultMapName?: string;
}

const props = withDefaults(defineProps<Props>(), {});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'selected', roundId: string): void;
}>();

const searchMode = ref<'search' | 'direct'>('search');
const directRoundId = ref('');

const rounds = ref<RoundListItem[]>([]);
const selectedRoundId = ref<string | null>(null);
const loading = ref(false);
const adding = ref(false);
const error = ref<string | null>(null);
const searchError = ref<string | null>(null);
const hasSearched = ref(false);

// Server search state
const serverSearchQuery = ref('');
const serverSuggestions = ref<ServerSearchResult[]>([]);
const selectedServer = ref<ServerSearchResult | null>(null);
const isServerSearchLoading = ref(false);
const showServerDropdown = ref(false);
const searchingRounds = ref(false);

const filters = ref({
  mapName: props.defaultMapName || '',
});

const currentPage = ref(1);
const pageSize = 50;
const totalPages = ref(1);

let searchTimeout: number | null = null;
let serverSearchTimeout: number | null = null;
let blurTimeout: number | null = null;

const searchServers = async (query: string) => {
  if (!query || query.length < 2) {
    serverSuggestions.value = [];
    showServerDropdown.value = false;
    return;
  }

  isServerSearchLoading.value = true;

  try {
    const response = await fetch(`/stats/servers/search?query=${encodeURIComponent(query)}&game=${props.game}&pageSize=10`);
    if (!response.ok) {
      throw new Error('Failed to search servers');
    }

    const data = await response.json();
    serverSuggestions.value = data.items || [];
    showServerDropdown.value = (data.items?.length || 0) > 0 || query.length >= 2;
  } catch (err) {
    console.error('Error searching servers:', err);
    serverSuggestions.value = [];
    showServerDropdown.value = false;
  } finally {
    isServerSearchLoading.value = false;
  }
};

const onServerSearchInput = () => {
  selectedServer.value = null;

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
  selectedServer.value = server;
  serverSearchQuery.value = server.serverName;
  serverSuggestions.value = [];
  showServerDropdown.value = false;

  // Auto-search rounds when server is selected
  searchRounds();
};

const clearServerSelection = () => {
  selectedServer.value = null;
  serverSearchQuery.value = '';
  rounds.value = [];
  selectedRoundId.value = null;
  hasSearched.value = false;
};

const toggleRoundSelection = (roundId: string) => {
  if (selectedRoundId.value === roundId) {
    selectedRoundId.value = null;
  } else {
    selectedRoundId.value = roundId;
  }
};

const searchRounds = async () => {
  if (!selectedServer.value) {
    searchError.value = 'Please select a server first';
    return;
  }

  loading.value = true;
  searchingRounds.value = true;
  searchError.value = null;
  hasSearched.value = true;

  try {
    const params = new URLSearchParams({
      page: currentPage.value.toString(),
      pageSize: pageSize.toString(),
      sortBy: 'StartTime',
      sortOrder: 'desc',
      includePlayers: 'false',
      serverGuid: selectedServer.value.serverGuid,
    });

    if (filters.value.mapName) {
      params.append('mapName', filters.value.mapName);
    }

    const response = await fetch(`/stats/rounds?${params.toString()}`);

    // Handle 404 as "no results found"
    if (response.status === 404) {
      rounds.value = [];
      totalPages.value = 0;
      searchError.value = null;
    } else if (!response.ok) {
      throw new Error('Failed to search rounds');
    } else {
      const data = await response.json();
      rounds.value = data.items;
      totalPages.value = data.totalPages;
      searchError.value = null;
    }
  } catch (err) {
    console.error('Error searching rounds:', err);
    searchError.value = 'Failed to load rounds';
  } finally {
    loading.value = false;
    searchingRounds.value = false;
  }
};

const debouncedSearch = () => {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }

  searchTimeout = setTimeout(() => {
    if (selectedServer.value) {
      currentPage.value = 1;
      searchRounds();
    }
  }, 300) as unknown as number;
};

const changePage = (page: number) => {
  currentPage.value = page;
  searchRounds();
};

const formatDateTime = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const linkRound = () => {
  const roundId = searchMode.value === 'direct'
    ? directRoundId.value.trim()
    : selectedRoundId.value;

  if (!roundId) return;

  adding.value = true;
  error.value = null;

  // Emit the selected round ID - parent component handles the API call
  emit('selected', roundId);
  adding.value = false;
};

// Initialize default server if provided
onMounted(() => {
  if (props.defaultServerGuid && props.defaultServerName) {
    selectedServer.value = {
      serverGuid: props.defaultServerGuid,
      serverName: props.defaultServerName,
      serverIp: '',
      serverPort: 0,
      gameType: props.game,
    };
    // Auto-search rounds with the pre-selected server
    searchRounds();
  }
});
</script>

<style scoped>
.rounds-section {
  margin-top: 8px;
}
</style>
