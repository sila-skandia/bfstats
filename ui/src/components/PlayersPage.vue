<script setup lang="ts">
import { ref, onMounted, computed, watch, defineProps } from 'vue';
import { useRouter } from 'vue-router';
import { formatLastSeen, formatPlayTime } from '@/utils/timeUtils';
import { calculateKDR, getKDRColor } from '@/utils/statsUtils';

// Props from parent
interface Props {
  searchQuery?: string;
  manualSearch?: boolean; // If true, don't auto-load on mount
}

const props = defineProps<Props>();

// Router
const router = useRouter();

// Interface for player search results with enhanced stats
interface PlayerSearchResult {
  playerName: string;
  totalPlayTimeMinutes: number;
  lastSeen: string;
  isActive: boolean;
  currentServer?: {
    serverGuid: string;
    serverName: string;
    sessionKills: number;
    sessionDeaths: number;
    mapName: string;
    gameId: string;
  };
  // Enhanced stats (from aggregate tables)
  totalKills?: number;
  totalDeaths?: number;
  totalRounds?: number;
  favoriteServer?: string;
  recentActivity?: {
    roundsThisWeek: number;
    lastScore?: number;
  };
}

interface PlayerSearchResponse {
  items: PlayerSearchResult[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

// State variables
const players = ref<PlayerSearchResult[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const sortBy = ref<string>('lastSeen');
const sortOrder = ref<'asc' | 'desc'>('desc');
const hasSearched = ref(false);

// Pagination state
const currentPage = ref(1);
const pageSize = ref(50);
const totalItems = ref(0);
const totalPages = ref(0);

// Expose loading state to parent
defineExpose({ loading });

// Highlight matching text in player names
const highlightMatch = (name: string): string => {
  const query = props.searchQuery?.trim();
  if (!query) return name;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  return name.replace(regex, '<mark class="dossier__mark">$1</mark>');
};

// Alias for the template (keeps semantic name "kdrColorClass")
const kdrColorClass = getKDRColor;

// Sort players function
const sortPlayers = (field: string) => {
  if (sortBy.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortBy.value = field;
    sortOrder.value = field === 'lastSeen' ? 'desc' : 'asc';
  }

  currentPage.value = 1;
  if (hasSearched.value) {
    fetchPlayers();
  }
};

// Fetch players list
const fetchPlayers = async () => {
  loading.value = true;
  error.value = null;
  hasSearched.value = true;

  try {
    const params = new URLSearchParams({
      page: currentPage.value.toString(),
      pageSize: pageSize.value.toString(),
      sortBy: sortBy.value,
      sortOrder: sortOrder.value
    });

    const query = String(props.searchQuery || '');
    if (query.trim()) {
      params.append('playerName', query.trim());
    } else if (props.manualSearch) {
      // In manual search mode, don't fetch without a query
      players.value = [];
      loading.value = false;
      hasSearched.value = false;
      return;
    } else {
      // Only show active players when not searching
      params.append('isActive', 'true');
    }

    const response = await fetch(`/stats/players?${params.toString()}`);

    if (!response.ok) {
      throw new Error('Failed to fetch players');
    }

    const data: PlayerSearchResponse = await response.json();
    players.value = data.items;
    totalItems.value = data.totalItems;
    totalPages.value = data.totalPages;

  } catch (err) {
    console.error('Error fetching players:', err);
    error.value = 'Failed to fetch players data. Please try again.';
  } finally {
    loading.value = false;
  }
};

// Pagination functions
const goToPage = (page: number) => {
  if (page < 1 || page > totalPages.value) return;
  currentPage.value = page;
  fetchPlayers();
};

// Computed property for pagination range display
const paginationRange = computed(() => {
  const range = [];
  const maxVisiblePages = 5;

  let startPage = Math.max(1, currentPage.value - Math.floor(maxVisiblePages / 2));
  const endPage = Math.min(totalPages.value, startPage + maxVisiblePages - 1);

  if (endPage === totalPages.value) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    range.push(i);
  }

  return range;
});

// Navigate to player profile
const navigateToPlayer = (playerName: string) => {
  router.push(`/players/${encodeURIComponent(playerName)}`);
};

// Watch for external search query changes
watch(() => props.searchQuery, (newQuery, oldQuery) => {
  if (newQuery !== oldQuery) {
    currentPage.value = 1;
    if (newQuery?.trim() || !props.manualSearch) {
      fetchPlayers();
    } else {
      players.value = [];
      hasSearched.value = false;
    }
  }
});

// Lifecycle hooks
onMounted(() => {
  // Only auto-load if not in manual search mode
  if (!props.manualSearch) {
    fetchPlayers();
  }
});
</script>

<template>
  <div class="operatives">
    <!-- Skeleton Loading State -->
    <div
      v-if="loading"
      class="space-y-3"
    >
      <div class="operatives__bar">
        <div class="operatives__bar-skeleton" />
        <div class="operatives__bar-skeleton operatives__bar-skeleton--sm" />
      </div>
      <div class="operatives__grid">
        <div
          v-for="n in 8"
          :key="n"
          class="dossier dossier--skeleton"
        >
          <div class="dossier__head">
            <div class="dossier__badge-skel" />
            <div class="dossier__lines">
              <div class="dossier__line dossier__line--lg" />
              <div class="dossier__line dossier__line--sm" />
            </div>
          </div>
          <div class="dossier__body">
            <div class="dossier__line dossier__line--row" />
            <div class="dossier__line dossier__line--row" />
          </div>
        </div>
      </div>
    </div>

    <!-- Error State -->
    <div
      v-else-if="error"
      class="operatives__alert"
      role="alert"
    >
      <div
        class="operatives__alert-corner"
        aria-hidden="true"
      />
      <div class="operatives__alert-icon">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        ><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
      </div>
      <div>
        <div class="operatives__alert-title">
          SIGNAL DEGRADED
        </div>
        <div class="operatives__alert-msg">
          {{ error }}
        </div>
      </div>
    </div>

    <!-- Welcome State (before first search) -->
    <div
      v-else-if="!hasSearched && props.manualSearch"
      class="operatives__welcome"
    >
      <div class="operatives__welcome-frame">
        <div
          class="operatives__welcome-scan"
          aria-hidden="true"
        />
        <div
          class="operatives__welcome-ascii"
          aria-hidden="true"
        >
          <span>╭──────────╮</span>
          <span>│ ▓▓▒▒░░░░ │</span>
          <span>│ OPERATIVE │</span>
          <span>│ ░░░▒▒▓▓ │</span>
          <span>╰──────────╯</span>
        </div>
        <div class="operatives__welcome-title">
          STANDING BY
        </div>
        <p class="operatives__welcome-sub">
          Enter a codename above to query the operative archive.
          <br>Partial matches are welcome — spelling is not.
        </p>
        <div class="operatives__welcome-tags">
          <span class="operatives__welcome-tag">↑↓ sort</span>
          <span class="operatives__welcome-tag">⏎ execute</span>
          <span class="operatives__welcome-tag">ESC clear</span>
        </div>
      </div>
    </div>

    <!-- No Results State -->
    <div
      v-else-if="hasSearched && players.length === 0"
      class="operatives__empty"
    >
      <div class="operatives__empty-code">
        404
      </div>
      <p class="operatives__empty-title">
        NO MATCHING OPERATIVES
      </p>
      <p class="operatives__empty-msg">
        Archive returned zero records for
        <span class="operatives__empty-query">"{{ props.searchQuery }}"</span>.
      </p>
      <p class="operatives__empty-hint">
        Try a shorter fragment or a different handle.
      </p>
    </div>

    <!-- Results Section -->
    <div
      v-else-if="players.length > 0"
      class="operatives__results"
    >
      <!-- Results Header -->
      <div class="operatives__bar">
        <div class="operatives__bar-lead">
          <span class="operatives__bar-prompt">&gt;</span>
          <span class="operatives__bar-count">{{ totalItems.toLocaleString() }}</span>
          <span class="operatives__bar-label">operative{{ totalItems !== 1 ? 's' : '' }} indexed</span>
          <span
            v-if="props.searchQuery"
            class="operatives__bar-sep"
          >·</span>
          <span
            v-if="props.searchQuery"
            class="operatives__bar-query"
          >
            match "<span>{{ props.searchQuery }}</span>"
          </span>
        </div>
        <div class="operatives__bar-sort">
          <span class="operatives__bar-sort-label">SORT</span>
          <button
            type="button"
            class="operatives__chip"
            :class="{ 'operatives__chip--active': sortBy === 'lastSeen' }"
            @click="sortPlayers('lastSeen')"
          >
            LAST SEEN
            <span class="operatives__chip-arrow">{{ sortBy === 'lastSeen' ? (sortOrder === 'desc' ? '↓' : '↑') : '·' }}</span>
          </button>
          <button
            type="button"
            class="operatives__chip"
            :class="{ 'operatives__chip--active': sortBy === 'playerName' }"
            @click="sortPlayers('playerName')"
          >
            CODENAME
            <span class="operatives__chip-arrow">{{ sortBy === 'playerName' ? (sortOrder === 'desc' ? '↓' : '↑') : '·' }}</span>
          </button>
        </div>
      </div>

      <!-- Dossier Grid -->
      <div class="operatives__grid">
        <article
          v-for="(player, idx) in players"
          :key="player.playerName"
          class="dossier"
          :class="{ 'dossier--live': player.isActive }"
          tabindex="0"
          role="link"
          :aria-label="`Open profile for ${$pn(player.playerName)}`"
          @click="navigateToPlayer(player.playerName)"
          @keydown.enter.prevent="navigateToPlayer(player.playerName)"
          @keydown.space.prevent="navigateToPlayer(player.playerName)"
        >
          <!-- Corner marks -->
          <span
            class="dossier__corner dossier__corner--tl"
            aria-hidden="true"
          />
          <span
            class="dossier__corner dossier__corner--br"
            aria-hidden="true"
          />

          <!-- Live ribbon -->
          <div
            v-if="player.isActive"
            class="dossier__ribbon"
            aria-label="Live now"
          >
            <span class="dossier__ribbon-dot" />
            <span>LIVE</span>
          </div>

          <!-- Header: serial + avatar + name -->
          <div class="dossier__head">
            <div class="dossier__badge">
              <span class="dossier__initial">{{ $pn(player.playerName).charAt(0).toUpperCase() }}</span>
              <span class="dossier__serial">#{{ String(((currentPage - 1) * pageSize) + idx + 1).padStart(4, '0') }}</span>
            </div>
            <div class="dossier__id">
              <h4
                class="dossier__name"
                v-html="highlightMatch(player.playerName)"
              />
              <div class="dossier__last">
                <span
                  class="dossier__last-dot"
                  :class="{ 'dossier__last-dot--live': player.isActive }"
                />
                <span v-if="player.isActive">In combat</span>
                <span v-else>{{ formatLastSeen(player.lastSeen) }}</span>
              </div>
            </div>
          </div>

          <!-- Stats Strip -->
          <dl class="dossier__stats">
            <div
              class="dossier__stat"
              :title="'Total playtime'"
            >
              <dt>PLAYTIME</dt>
              <dd>{{ formatPlayTime(player.totalPlayTimeMinutes) }}</dd>
            </div>
            <div
              v-if="player.totalKills !== undefined && player.totalKills !== null"
              class="dossier__stat"
              title="All-time K/D ratio"
            >
              <dt>K/D</dt>
              <dd :class="kdrColorClass(player.totalKills, player.totalDeaths ?? 0)">
                {{ calculateKDR(player.totalKills, player.totalDeaths ?? 0) }}
              </dd>
            </div>
            <div
              v-if="player.totalRounds"
              class="dossier__stat"
              title="Total rounds played"
            >
              <dt>ROUNDS</dt>
              <dd>{{ player.totalRounds.toLocaleString() }}</dd>
            </div>
            <div
              v-if="player.recentActivity?.roundsThisWeek"
              class="dossier__stat"
              title="Rounds played this week"
            >
              <dt>WEEK</dt>
              <dd class="dossier__stat-accent">
                {{ player.recentActivity.roundsThisWeek }}
              </dd>
            </div>
          </dl>

          <!-- Favorite server -->
          <div
            v-if="player.favoriteServer"
            class="dossier__fav"
            :title="`Most played: ${player.favoriteServer}`"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            ><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
            <span class="dossier__fav-label">FAV</span>
            <span class="dossier__fav-name">{{ player.favoriteServer }}</span>
          </div>

          <!-- Live session -->
          <div
            v-if="player.isActive && player.currentServer"
            class="dossier__live"
          >
            <div class="dossier__live-head">
              <span
                class="dossier__live-scan"
                aria-hidden="true"
              />
              <span class="dossier__live-server">{{ player.currentServer.serverName }}</span>
            </div>
            <div class="dossier__live-row">
              <span class="dossier__live-map">{{ player.currentServer.mapName }}</span>
              <span class="dossier__live-sep">·</span>
              <span
                class="dossier__live-kd"
                :class="kdrColorClass(player.currentServer.sessionKills, player.currentServer.sessionDeaths)"
              >
                {{ calculateKDR(player.currentServer.sessionKills, player.currentServer.sessionDeaths) }} K/D
              </span>
              <span class="dossier__live-sep">·</span>
              <span class="dossier__live-k">{{ player.currentServer.sessionKills }}K</span>
              <span class="dossier__live-d">{{ player.currentServer.sessionDeaths }}D</span>
            </div>
          </div>

          <!-- Open arrow -->
          <div
            class="dossier__open"
            aria-hidden="true"
          >
            OPEN <span class="dossier__open-arrow">→</span>
          </div>
        </article>
      </div>

      <!-- Pagination -->
      <nav
        v-if="totalPages > 1"
        class="operatives__pager"
        aria-label="Pagination"
      >
        <button
          type="button"
          class="operatives__page"
          :disabled="currentPage === 1"
          @click="goToPage(1)"
        >
          ⏮ FIRST
        </button>
        <button
          type="button"
          class="operatives__page"
          :disabled="currentPage === 1"
          @click="goToPage(currentPage - 1)"
        >
          ◂ PREV
        </button>

        <div class="operatives__page-numbers">
          <button
            v-for="page in paginationRange"
            :key="page"
            type="button"
            class="operatives__page-num"
            :class="{ 'operatives__page-num--active': page === currentPage }"
            @click="goToPage(page)"
          >
            {{ String(page).padStart(2, '0') }}
          </button>
        </div>

        <button
          type="button"
          class="operatives__page"
          :disabled="currentPage === totalPages"
          @click="goToPage(currentPage + 1)"
        >
          NEXT ▸
        </button>
        <button
          type="button"
          class="operatives__page"
          :disabled="currentPage === totalPages"
          @click="goToPage(totalPages)"
        >
          LAST ⏭
        </button>

        <div class="operatives__page-status">
          PAGE {{ String(currentPage).padStart(2, '0') }} / {{ String(totalPages).padStart(2, '0') }}
        </div>
      </nav>
    </div>
  </div>
</template>

<style scoped>
/* ===== OPERATIVES — COMMAND-CENTER / DOSSIER GRID ===== */

.operatives {
  --op-bg: #0a0a0a;
  --op-surface: rgba(23, 23, 23, 0.85);
  --op-surface-2: rgba(10, 10, 10, 0.65);
  --op-border: rgba(64, 64, 64, 0.7);
  --op-border-soft: rgba(64, 64, 64, 0.45);
  --op-amber: #fbbf24;
  --op-amber-rgb: 251, 191, 36;
  --op-cyan: #22d3ee;
  --op-cyan-rgb: 34, 211, 238;
  --op-green: #4ade80;
  --op-green-rgb: 74, 222, 128;
  --op-red: #ef4444;
  --op-muted: #737373;
  --op-dim: #525252;
  --op-text: #d4d4d4;
  --op-text-bright: #f5f5f4;

  font-family: system-ui, sans-serif;
}

/* ===== Bar (results header) ===== */
.operatives__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  justify-content: space-between;
  padding: 0.625rem 0.875rem;
  margin-bottom: 1rem;
  border: 1px solid var(--op-border);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(23,23,23,0.75), rgba(10,10,10,0.75));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.operatives__bar-lead {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.45rem;
  font-size: 0.75rem;
  color: var(--op-muted);
  letter-spacing: 0.04em;
  min-width: 0;
}

.operatives__bar-prompt { color: var(--op-cyan); font-weight: 800; }
.operatives__bar-count  { color: var(--op-amber); font-weight: 800; font-size: 0.95rem; }
.operatives__bar-label  { color: var(--op-text); text-transform: uppercase; font-size: 0.65rem; letter-spacing: 0.1em; font-weight: 700; }
.operatives__bar-sep    { color: #3f3f3f; }
.operatives__bar-query  { color: var(--op-text); font-size: 0.7rem; }
.operatives__bar-query span { color: var(--op-cyan); font-weight: 700; }

.operatives__bar-sort {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.operatives__bar-sort-label {
  color: var(--op-dim);
  font-size: 0.6rem;
  letter-spacing: 0.15em;
  font-weight: 700;
}

.operatives__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.6rem;
  border: 1px solid var(--op-border);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.4);
  color: var(--op-muted);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  cursor: pointer;
  transition: all 0.15s ease;
}

.operatives__chip:hover {
  color: var(--op-text-bright);
  border-color: var(--op-muted);
}

.operatives__chip--active {
  color: var(--op-amber);
  border-color: rgba(var(--op-amber-rgb), 0.55);
  background: rgba(var(--op-amber-rgb), 0.08);
  box-shadow: 0 0 10px rgba(var(--op-amber-rgb), 0.15);
}

.operatives__chip-arrow {
  color: var(--op-amber);
  font-weight: 900;
  font-size: 0.75rem;
  line-height: 1;
  min-width: 8px;
  text-align: center;
}

.operatives__chip:not(.operatives__chip--active) .operatives__chip-arrow { color: var(--op-dim); }

.operatives__bar-skeleton {
  height: 12px;
  width: 180px;
  border-radius: 4px;
  background: linear-gradient(90deg, rgba(64,64,64,0.35) 0%, rgba(82,82,82,0.55) 50%, rgba(64,64,64,0.35) 100%);
  background-size: 200% 100%;
  animation: op-shimmer 1.4s ease-in-out infinite;
}
.operatives__bar-skeleton--sm { width: 90px; }

@keyframes op-shimmer {
  0%   { background-position: -100% 0; }
  100% { background-position: 200% 0; }
}

/* ===== Grid ===== */
.operatives__grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 0.85rem;
}
@media (min-width: 640px)  { .operatives__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 1024px) { .operatives__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (min-width: 1400px) { .operatives__grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }

/* ===== Dossier Card ===== */
.dossier {
  position: relative;
  padding: 0.85rem 0.95rem 0.9rem;
  border: 1px solid var(--op-border);
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(23,23,23,0.95) 0%, rgba(10,10,10,0.95) 100%);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
  isolation: isolate;
}

.dossier::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 2px;
  background: var(--op-amber);
  opacity: 0;
  transition: opacity 0.18s ease;
}

.dossier:hover,
.dossier:focus-visible {
  transform: translateY(-2px);
  border-color: rgba(var(--op-amber-rgb), 0.55);
  box-shadow:
    0 10px 30px -15px rgba(0, 0, 0, 0.9),
    0 0 0 1px rgba(var(--op-amber-rgb), 0.12),
    0 0 22px rgba(var(--op-amber-rgb), 0.12);
  outline: none;
}

.dossier:hover::before,
.dossier:focus-visible::before {
  opacity: 1;
}

.dossier--live {
  border-color: rgba(var(--op-green-rgb), 0.35);
}
.dossier--live::before {
  background: var(--op-green);
  opacity: 0.7;
}
.dossier--live:hover {
  border-color: rgba(var(--op-green-rgb), 0.65);
  box-shadow:
    0 10px 30px -15px rgba(0, 0, 0, 0.9),
    0 0 22px rgba(var(--op-green-rgb), 0.18);
}

/* Corner tick marks (like mil-spec dossier) */
.dossier__corner {
  position: absolute;
  width: 10px; height: 10px;
  border-color: var(--op-amber);
  opacity: 0.45;
  pointer-events: none;
}
.dossier__corner--tl {
  top: 6px; left: 6px;
  border-top: 1px solid; border-left: 1px solid;
}
.dossier__corner--br {
  bottom: 6px; right: 6px;
  border-bottom: 1px solid; border-right: 1px solid;
}

/* Live ribbon */
.dossier__ribbon {
  position: absolute;
  top: 10px;
  right: 10px;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.5rem;
  border: 1px solid rgba(var(--op-green-rgb), 0.5);
  border-radius: 999px;
  background: rgba(var(--op-green-rgb), 0.1);
  color: var(--op-green);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.6rem;
  font-weight: 800;
  letter-spacing: 0.15em;
  z-index: 2;
}

.dossier__ribbon-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--op-green);
  box-shadow: 0 0 6px var(--op-green);
  animation: op-pulse 1.6s ease-in-out infinite;
}

@keyframes op-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.5; transform: scale(1.4); }
}

/* Head */
.dossier__head {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-bottom: 0.7rem;
  padding-right: 2.5rem; /* space for ribbon */
}

.dossier__badge {
  position: relative;
  width: 44px; height: 44px;
  border-radius: 8px;
  border: 1px solid rgba(var(--op-amber-rgb), 0.35);
  background:
    linear-gradient(135deg, rgba(var(--op-amber-rgb), 0.12), rgba(var(--op-amber-rgb), 0.03));
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.dossier--live .dossier__badge {
  border-color: rgba(var(--op-green-rgb), 0.4);
  background: linear-gradient(135deg, rgba(var(--op-green-rgb), 0.12), rgba(var(--op-green-rgb), 0.03));
}

.dossier__initial {
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--op-amber);
  line-height: 1;
  text-shadow: 0 0 12px rgba(var(--op-amber-rgb), 0.4);
}

.dossier--live .dossier__initial {
  color: var(--op-green);
  text-shadow: 0 0 12px rgba(var(--op-green-rgb), 0.4);
}

.dossier__serial {
  position: absolute;
  left: 0; right: 0;
  bottom: -14px;
  text-align: center;
  font-size: 0.5rem;
  letter-spacing: 0.15em;
  color: var(--op-dim);
  font-weight: 700;
}

.dossier__id {
  min-width: 0;
  flex: 1;
}

.dossier__name {
  color: var(--op-text-bright);
  font-weight: 700;
  font-size: 0.95rem;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  transition: color 0.15s ease;
}

.dossier:hover .dossier__name { color: var(--op-amber); }
.dossier--live:hover .dossier__name { color: var(--op-green); }

.dossier__name :deep(.dossier__mark) {
  background: rgba(var(--op-amber-rgb), 0.25);
  color: var(--op-amber);
  padding: 0 2px;
  border-radius: 2px;
}

.dossier__last {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.15rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.65rem;
  color: var(--op-dim);
  letter-spacing: 0.03em;
}

.dossier__last-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: var(--op-dim);
}
.dossier__last-dot--live {
  background: var(--op-green);
  box-shadow: 0 0 6px var(--op-green);
  animation: op-pulse 1.6s ease-in-out infinite;
}

/* Stats strip */
.dossier__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(60px, 1fr));
  gap: 0.35rem;
  margin: 0;
  padding: 0.5rem 0;
  border-top: 1px dashed var(--op-border-soft);
  border-bottom: 1px dashed var(--op-border-soft);
}

.dossier__stat {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  padding: 0 0.15rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  min-width: 0;
}

.dossier__stat dt {
  font-size: 0.55rem;
  letter-spacing: 0.15em;
  color: var(--op-dim);
  font-weight: 700;
  text-transform: uppercase;
}

.dossier__stat dd {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 800;
  color: var(--op-text-bright);
  line-height: 1.1;
  letter-spacing: -0.01em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dossier__stat-accent { color: var(--op-cyan) !important; }

/* Favorite server line */
.dossier__fav {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.55rem;
  padding: 0.2rem 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.65rem;
  color: var(--op-muted);
  border: 1px dashed var(--op-border-soft);
  border-radius: 4px;
  max-width: 100%;
  min-width: 0;
}

.dossier__fav svg { color: var(--op-amber); flex-shrink: 0; }
.dossier__fav-label {
  color: var(--op-dim);
  letter-spacing: 0.12em;
  font-weight: 700;
  flex-shrink: 0;
}
.dossier__fav-name {
  color: var(--op-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* Live session panel */
.dossier__live {
  margin-top: 0.55rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid rgba(var(--op-green-rgb), 0.25);
  border-radius: 6px;
  background: linear-gradient(90deg, rgba(var(--op-green-rgb), 0.08), rgba(var(--op-green-rgb), 0.02));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  position: relative;
  overflow: hidden;
}

.dossier__live-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  position: relative;
}

.dossier__live-scan {
  position: absolute;
  left: -10%; right: -10%;
  top: -4px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--op-green), transparent);
  opacity: 0.6;
  animation: loc-scan 3.2s ease-in-out infinite;
}

.dossier__live-server {
  color: var(--op-green);
  font-size: 0.7rem;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.dossier__live-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem;
  margin-top: 0.2rem;
  font-size: 0.65rem;
  color: var(--op-muted);
}

.dossier__live-sep { color: #3f3f3f; }
.dossier__live-map { color: var(--op-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px; }
.dossier__live-kd  { font-weight: 700; }
.dossier__live-k   { color: var(--op-green); font-weight: 700; }
.dossier__live-d   { color: var(--op-red);   font-weight: 700; }

/* Open arrow */
.dossier__open {
  position: absolute;
  right: 10px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.55rem;
  letter-spacing: 0.15em;
  font-weight: 800;
  color: var(--op-amber);
  opacity: 0;
  transition: opacity 0.18s ease, transform 0.18s ease;
  transform: translateX(-4px);
  pointer-events: none;
}
.dossier:hover .dossier__open,
.dossier:focus-visible .dossier__open {
  opacity: 1;
  transform: translateX(0);
}

.dossier__open-arrow {
  font-size: 0.9rem;
  line-height: 1;
}

/* ===== Skeleton ===== */
.dossier--skeleton {
  cursor: default;
  pointer-events: none;
}

.dossier__badge-skel {
  width: 44px; height: 44px;
  border-radius: 8px;
  background: linear-gradient(90deg, rgba(64,64,64,0.3) 0%, rgba(82,82,82,0.55) 50%, rgba(64,64,64,0.3) 100%);
  background-size: 200% 100%;
  animation: op-shimmer 1.4s ease-in-out infinite;
  flex-shrink: 0;
}

.dossier__lines { flex: 1; display: flex; flex-direction: column; gap: 0.4rem; }
.dossier__line {
  height: 10px;
  border-radius: 4px;
  background: linear-gradient(90deg, rgba(64,64,64,0.3) 0%, rgba(82,82,82,0.55) 50%, rgba(64,64,64,0.3) 100%);
  background-size: 200% 100%;
  animation: op-shimmer 1.4s ease-in-out infinite;
}
.dossier__line--lg { width: 75%; height: 12px; }
.dossier__line--sm { width: 50%; height: 8px; }
.dossier__line--row { width: 100%; height: 10px; margin-top: 0.45rem; }
.dossier__body { padding-top: 0.5rem; }

/* ===== Alert (error) ===== */
.operatives__alert {
  position: relative;
  display: flex;
  gap: 0.9rem;
  padding: 1rem 1.1rem;
  border: 1px solid rgba(239, 68, 68, 0.35);
  border-radius: 12px;
  background:
    linear-gradient(90deg, rgba(239, 68, 68, 0.08), rgba(0, 0, 0, 0.4));
  color: #fecaca;
  overflow: hidden;
}

.operatives__alert-corner {
  position: absolute;
  inset: 0;
  background:
    repeating-linear-gradient(45deg, transparent 0 8px, rgba(239, 68, 68, 0.06) 8px 10px);
  pointer-events: none;
  opacity: 0.7;
}

.operatives__alert-icon {
  width: 40px; height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(239, 68, 68, 0.5);
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.1);
  color: var(--op-red);
  flex-shrink: 0;
  z-index: 1;
}

.operatives__alert-title {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.18em;
  color: var(--op-red);
  text-transform: uppercase;
  margin-bottom: 0.2rem;
}

.operatives__alert-msg {
  font-size: 0.875rem;
  color: var(--op-text);
}

/* ===== Welcome ===== */
.operatives__welcome {
  padding: 2.5rem 1rem;
  display: flex;
  justify-content: center;
}

.operatives__welcome-frame {
  position: relative;
  padding: 1.75rem 2rem;
  border: 1px solid var(--op-border);
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(23,23,23,0.85) 0%, rgba(10,10,10,0.85) 100%);
  text-align: center;
  overflow: hidden;
  max-width: 520px;
}

.operatives__welcome-scan {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--op-amber), transparent);
  opacity: 0.5;
  animation: loc-scan 4s ease-in-out infinite;
}

@keyframes loc-scan {
  0%, 100% { transform: translateX(-100%); opacity: 0; }
  50%      { transform: translateX(0%);    opacity: 0.6; }
}

.operatives__welcome-ascii {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.7rem;
  color: var(--op-muted);
  letter-spacing: 0.05em;
  line-height: 1.3;
  margin-bottom: 0.75rem;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.operatives__welcome-ascii span { display: block; }
.operatives__welcome-ascii span:nth-child(3) { color: var(--op-amber); font-weight: 800; }

.operatives__welcome-title {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.9rem;
  font-weight: 800;
  letter-spacing: 0.3em;
  color: var(--op-amber);
  margin-bottom: 0.5rem;
}

.operatives__welcome-sub {
  color: var(--op-muted);
  font-size: 0.85rem;
  line-height: 1.5;
  margin-bottom: 1rem;
}

.operatives__welcome-tags {
  display: inline-flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  justify-content: center;
}

.operatives__welcome-tag {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.625rem;
  letter-spacing: 0.12em;
  color: var(--op-muted);
  padding: 0.2rem 0.5rem;
  border: 1px dashed var(--op-border);
  border-radius: 4px;
}

/* ===== Empty (no results) ===== */
.operatives__empty {
  text-align: center;
  padding: 3rem 1rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.operatives__empty-code {
  font-size: 3.25rem;
  font-weight: 900;
  letter-spacing: 0.2em;
  color: var(--op-red);
  text-shadow: 0 0 24px rgba(239, 68, 68, 0.25);
  line-height: 1;
  margin-bottom: 0.25rem;
}

.operatives__empty-title {
  color: var(--op-text-bright);
  font-weight: 800;
  letter-spacing: 0.2em;
  font-size: 0.85rem;
  margin-bottom: 0.75rem;
}

.operatives__empty-msg {
  color: var(--op-muted);
  font-size: 0.85rem;
  font-family: system-ui, sans-serif;
}

.operatives__empty-query {
  color: var(--op-amber);
  font-weight: 700;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.operatives__empty-hint {
  margin-top: 0.4rem;
  color: var(--op-dim);
  font-size: 0.75rem;
}

/* ===== Pagination ===== */
.operatives__pager {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  margin-top: 1.5rem;
  padding: 0.75rem 0.75rem;
  border-top: 1px dashed var(--op-border);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.operatives__page,
.operatives__page-num {
  padding: 0.35rem 0.65rem;
  border: 1px solid var(--op-border);
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.4);
  color: var(--op-muted);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: all 0.15s ease;
  min-width: 2rem;
  text-align: center;
}

.operatives__page:hover:not(:disabled),
.operatives__page-num:hover:not(.operatives__page-num--active) {
  color: var(--op-text-bright);
  border-color: var(--op-muted);
  background: rgba(255, 255, 255, 0.04);
}

.operatives__page:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.operatives__page-num--active {
  color: var(--op-amber);
  border-color: rgba(var(--op-amber-rgb), 0.55);
  background: rgba(var(--op-amber-rgb), 0.1);
  box-shadow: 0 0 10px rgba(var(--op-amber-rgb), 0.15);
}

.operatives__page-numbers {
  display: inline-flex;
  gap: 0.25rem;
}

.operatives__page-status {
  margin-left: 0.5rem;
  padding: 0.35rem 0.65rem;
  color: var(--op-dim);
  font-size: 0.625rem;
  letter-spacing: 0.15em;
  border-left: 1px dashed var(--op-border);
}

/* ===== Focus visible ===== */
.dossier:focus-visible {
  outline: 2px solid var(--op-amber);
  outline-offset: 2px;
}
</style>
