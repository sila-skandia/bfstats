<template>
  <div class="mm mm-admin">
    <!-- Substrip / Breadcrumb -->
    <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 14px; flex-wrap: wrap;">
      <button
        type="button"
        class="mm-admin-btn mm-admin-btn--ghost mm-admin-btn--sm"
        style="font-family: var(--mm-font-mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;"
        @click="router.push('/v4/admin/tournaments')"
      >
        ← Tournaments
      </button>

      <button
        v-if="tournament"
        type="button"
        class="mm-admin-btn mm-admin-btn--primary mm-admin-btn--sm"
        style="font-family: var(--mm-font-mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase;"
        @click="router.push(`/t/${tournament.slug || tournament.id}`)"
      >
        View Public ↗
      </button>
    </div>

    <!-- Loading State -->
    <div
      v-if="loading"
      class="mm-admin-empty mm-admin-empty--loading"
    >
      <div class="mm-admin-spinner" />
      <span class="mm-admin-empty__desc" style="margin-top: 12px">Loading tournament details...</span>
    </div>

    <!-- Error State -->
    <div
      v-else-if="error"
      class="mm-admin-card"
    >
      <div class="mm-admin-empty">
        <div class="mm-admin-alert mm-admin-alert--err">
          {{ error }}
        </div>
        <button
          type="button"
          class="mm-admin-btn mm-admin-btn--ghost"
          style="margin-top: 16px"
          @click="router.push('/v4/admin/tournaments')"
        >
          ← Back to Tournaments
        </button>
      </div>
    </div>

    <!-- Tournament Content -->
    <div v-else-if="tournament" style="display: flex; flex-direction: column; gap: 20px">
      <!-- Header Hero Section -->
      <header class="mm-admin-card" style="position: relative;">
        <!-- Hero Banner Layer -->
        <div
          class="tournament-hero-banner"
          :style="heroImageUrl ? { backgroundImage: `url(${heroImageUrl})` } : {}"
        >
          <div class="tournament-hero-overlay" />
          <span v-if="!heroImageUrl" class="tournament-hero-placeholder">
            Hero banner · 1280 × 220
          </span>
        </div>

        <div class="mm-admin-card__body" style="padding: 18px 22px;">
          <div style="display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap;">
            <div style="display: flex; align-items: center; gap: 16px;">
              <!-- Logo / Game Badge -->
              <div
                v-if="logoImageUrl"
                class="tournament-logo-wrap"
                :style="{ backgroundImage: `url(${logoImageUrl})` }"
              />
              <div
                v-else
                class="game-icon"
                :style="{ backgroundImage: getGameIcon() }"
              />

              <div>
                <h1 class="mm-admin-header__title" style="font-size: 24px; margin: 0;">
                  {{ tournament.name }}
                </h1>
                <div style="font-family: var(--mm-font-mono); font-size: 10.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--mm-ink-muted); margin-top: 6px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                  <span>ORGANIZER · <strong style="color: var(--mm-ink)">{{ tournament.organizer }}</strong></span>
                  <span style="color: var(--mm-ink-faint)">•</span>
                  <span>CREATED {{ formatDate(tournament.createdAt) }}</span>
                </div>
              </div>
            </div>

            <!-- Stats & Status Pill -->
            <div style="display: flex; align-items: center; gap: 20px;">
              <div style="text-align: right;">
                <div style="font-family: var(--mm-font-mono); font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--mm-ink-muted);">
                  Progress
                </div>
                <div style="font-family: var(--mm-font-display); font-size: 24px; font-weight: 500; color: var(--mm-ink); font-variant-numeric: tabular-nums; margin-top: 2px;">
                  {{ (tournament.matches?.length ?? 0) }}
                  <span style="color: var(--mm-ink-faint); font-size: 16px;">/ {{ tournament.anticipatedRoundCount || '—' }}</span>
                </div>
              </div>

              <!-- Status Badge -->
              <span
                class="mm-status-pill"
                :class="`mm-status-pill--${(tournament.status || 'draft').toLowerCase()}`"
              >
                <span class="mm-status-pill__dot" />
                {{ (tournament.status || 'Draft').toUpperCase() }}
              </span>
            </div>
          </div>
        </div>
      </header>

      <!-- Tab Navigation -->
      <nav class="mm-admin-tabs" aria-label="Tournament management tabs">
        <button
          type="button"
          :class="['mm-admin-tab', activeTab === 'matches' && 'mm-admin-tab--active']"
          @click="setTab('matches')"
        >
          Matches <span v-if="tournament.matches?.length" class="mm-tab-badge">{{ tournament.matches.length }}</span>
        </button>
        <button
          type="button"
          :class="['mm-admin-tab', activeTab === 'teams' && 'mm-admin-tab--active']"
          @click="setTab('teams')"
        >
          Teams <span v-if="tournament.teams?.length" class="mm-tab-badge">{{ tournament.teams.length }}</span>
        </button>
        <button
          type="button"
          :class="['mm-admin-tab', activeTab === 'weeks' && 'mm-admin-tab--active']"
          @click="setTab('weeks')"
        >
          Weeks <span v-if="(tournament as any).weeks?.length" class="mm-tab-badge">{{ (tournament as any).weeks.length }}</span>
        </button>
        <button
          type="button"
          :class="['mm-admin-tab', activeTab === 'files' && 'mm-admin-tab--active']"
          @click="setTab('files')"
        >
          Files <span v-if="tournament.files?.length" class="mm-tab-badge">{{ tournament.files.length }}</span>
        </button>
        <button
          type="button"
          :class="['mm-admin-tab', activeTab === 'posts' && 'mm-admin-tab--active']"
          @click="setTab('posts')"
        >
          Posts <span v-if="(tournament as any).posts?.length" class="mm-tab-badge">{{ (tournament as any).posts.length }}</span>
        </button>
        <button
          type="button"
          :class="['mm-admin-tab', activeTab === 'settings' && 'mm-admin-tab--active']"
          @click="setTab('settings')"
        >
          Settings
        </button>
      </nav>

      <!-- Tab Panels -->
      <div class="mm-admin-panel">
        <div v-if="activeTab === 'matches'">
          <TournamentMatchesTab
            ref="matchesTabRef"
            :tournament="tournament"
            @refresh="handleRefresh"
          />
        </div>

        <div v-if="activeTab === 'teams'">
          <TournamentTeamsTab
            ref="teamsTabRef"
            :tournament="tournament"
            @refresh="handleRefresh"
          />
        </div>

        <div v-if="activeTab === 'weeks'">
          <TournamentWeeksTab
            ref="weeksTabRef"
            :tournament="tournament"
            @refresh="handleRefresh"
          />
        </div>

        <div v-if="activeTab === 'files'">
          <TournamentFilesTab
            ref="filesTabRef"
            :tournament="tournament"
            @refresh="handleRefresh"
          />
        </div>

        <div v-if="activeTab === 'posts'">
          <TournamentPostsTab
            ref="postsTabRef"
            :tournament="tournament"
            @refresh="handleRefresh"
          />
        </div>

        <div v-if="activeTab === 'settings'">
          <TournamentSettingsTab
            ref="settingsTabRef"
            :tournament="tournament"
            @refresh="handleRefresh"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import {
  adminTournamentService,
  type TournamentDetail
} from '@/services/adminTournamentService';
import TournamentTeamsTab from '@/components/tournament-admin/TournamentTeamsTab.vue';
import TournamentWeeksTab from '@/components/tournament-admin/TournamentWeeksTab.vue';
import TournamentFilesTab from '@/components/tournament-admin/TournamentFilesTab.vue';
import TournamentPostsTab from '@/components/tournament-admin/TournamentPostsTab.vue';
import TournamentMatchesTab from '@/components/tournament-admin/TournamentMatchesTab.vue';
import TournamentSettingsTab from '@/components/tournament-admin/TournamentSettingsTab.vue';
import bf1942Icon from '@/assets/bf1942.webp';
import fh2Icon from '@/assets/fh2.webp';
import bfvIcon from '@/assets/bfv.webp';

const router = useRouter();
const route = useRoute();

// Core state
const tournament = ref<TournamentDetail | null>(null);
const heroImageUrl = ref<string | null>(null);
const logoImageUrl = ref<string | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

// Tab state
type TabName = 'matches' | 'teams' | 'weeks' | 'files' | 'posts' | 'settings';
const activeTab = ref<TabName>('matches');

// Initialize activeTab from route
const initializeTabFromRoute = () => {
  const tabParam = route.params.tab as string;
  const validTabs: TabName[] = ['matches', 'teams', 'weeks', 'files', 'posts', 'settings'];
  if (tabParam && validTabs.includes(tabParam as TabName)) {
    activeTab.value = tabParam as TabName;
  } else {
    activeTab.value = 'matches';
  }
};

// Watch for route changes to update active tab and trigger load
watch(() => route.params.tab, (newTab) => {
  const validTabs: TabName[] = ['matches', 'teams', 'weeks', 'files', 'posts', 'settings'];
  if (newTab && validTabs.includes(newTab as TabName)) {
    activeTab.value = newTab as TabName;
    // Trigger load on the tab component when route changes
    const tabRefs: Record<TabName, { value: { load?: () => void } | null }> = {
      matches: matchesTabRef,
      teams: teamsTabRef,
      weeks: weeksTabRef,
      files: filesTabRef,
      posts: postsTabRef,
      settings: settingsTabRef
    };
    tabRefs[newTab as TabName].value?.load?.();
  }
});

// Tab refs for triggering load on tab switch
const matchesTabRef = ref<InstanceType<typeof TournamentMatchesTab> | null>(null);
const teamsTabRef = ref<InstanceType<typeof TournamentTeamsTab> | null>(null);
const weeksTabRef = ref<InstanceType<typeof TournamentWeeksTab> | null>(null);
const filesTabRef = ref<InstanceType<typeof TournamentFilesTab> | null>(null);
const postsTabRef = ref<InstanceType<typeof TournamentPostsTab> | null>(null);
const settingsTabRef = ref<InstanceType<typeof TournamentSettingsTab> | null>(null);

const tournamentId = parseInt(route.params.id as string);

// Tab switching
const setTab = (tab: TabName) => {
  // Update route instead of just local state
  router.push(`/v4/admin/tournaments/${tournamentId}/${tab}`);
  // Trigger load on the tab component when it becomes active
  const tabRefs: Record<TabName, { value: { load?: () => void } | null }> = {
    matches: matchesTabRef,
    teams: teamsTabRef,
    weeks: weeksTabRef,
    files: filesTabRef,
    posts: postsTabRef,
    settings: settingsTabRef
  };
  tabRefs[tab].value?.load?.();
};

// Data loading
const loadTournament = async (showLoadingSpinner = true) => {
  if (showLoadingSpinner || !tournament.value) {
    loading.value = true;
  }
  error.value = null;

  try {
    if (isNaN(tournamentId)) {
      throw new Error('Invalid tournament ID');
    }

    const data = await adminTournamentService.getTournamentDetail(tournamentId);
    tournament.value = {
      ...data,
      matches: data.matches ?? []
    };

    document.title = `${tournament.value.name} - Tournament Details`;
    loading.value = false;

    // Load images asynchronously
    if (data.hasHeroImage) {
      loadHeroImage().catch(err => console.debug('Failed to load hero image:', err));
    } else {
      heroImageUrl.value = null;
    }

    if (data.hasCommunityLogo) {
      loadLogoImage().catch(err => console.debug('Failed to load logo image:', err));
    } else {
      logoImageUrl.value = null;
    }
  } catch (err) {
    console.error('Error loading tournament:', err);
    error.value = err instanceof Error ? err.message : 'Failed to load tournament';
    loading.value = false;
  }
};

const handleRefresh = () => loadTournament(false);

const loadHeroImage = async () => {
  try {
    const { authService } = await import('@/services/authService');
    await authService.ensureValidToken();
    const token = localStorage.getItem('authToken');

    const response = await fetch(`/stats/admin/tournaments/${tournamentId}/image`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (response.ok) {
      const blob = await response.blob();
      heroImageUrl.value = URL.createObjectURL(blob);
    }
  } catch (err) {
    console.debug('No hero image available');
  }
};

const loadLogoImage = async () => {
  try {
    const { authService } = await import('@/services/authService');
    await authService.ensureValidToken();
    const token = localStorage.getItem('authToken');

    const response = await fetch(`/stats/admin/tournaments/${tournamentId}/logo`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (response.ok) {
      const blob = await response.blob();
      logoImageUrl.value = URL.createObjectURL(blob);
    }
  } catch (err) {
    console.debug('No logo image available');
  }
};

// Helpers
const getProgressPercentage = (): number => {
  if (!tournament.value?.anticipatedRoundCount || tournament.value.anticipatedRoundCount === 0) {
    return 0;
  }
  return Math.min(100, ((tournament.value.matches?.length ?? 0) / tournament.value.anticipatedRoundCount) * 100);
};

const formatDate = (dateString: string): string => {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
};

const getGameIcon = (): string => {
  if (!tournament.value) return `url('${bf1942Icon}')`;

  const iconMap: Record<string, string> = {
    'bf1942': `url('${bf1942Icon}')`,
    'fh2': `url('${fh2Icon}')`,
    'bfvietnam': `url('${bfvIcon}')`
  };
  return iconMap[tournament.value.game] || `url('${bf1942Icon}')`;
};

onMounted(() => {
  initializeTabFromRoute();
  loadTournament();
});

onUnmounted(() => {
  // Clean up blob URLs
  if (heroImageUrl.value) URL.revokeObjectURL(heroImageUrl.value);
  if (logoImageUrl.value) URL.revokeObjectURL(logoImageUrl.value);
});
</script>

<style src="@/styles/mm-admin.css"></style>
<style scoped src="./TournamentDetails.vue.css"></style>

<style scoped>
.tournament-hero-banner {
  position: relative;
  height: 140px;
  background-size: cover;
  background-position: center;
  background-image: linear-gradient(180deg, var(--mm-bg-mute), var(--mm-bg-soft));
  display: grid;
  place-items: center;
  border-bottom: 1px solid var(--mm-rule);
}

.tournament-hero-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, rgba(19, 19, 19, 0.2) 0%, rgba(19, 19, 19, 0.85) 100%);
}

.tournament-hero-placeholder {
  font-family: var(--mm-font-mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--mm-ink-faint);
  position: relative;
  z-index: 1;
}

.tournament-logo-wrap {
  width: 56px;
  height: 56px;
  border: 1px solid var(--mm-rule-strong);
  border-radius: 2px;
  background-size: cover;
  background-position: center;
  flex-shrink: 0;
}

.game-icon {
  width: 44px;
  height: 44px;
  border: 1px solid var(--mm-rule);
  border-radius: 2px;
  background-size: cover;
  background-position: center;
  flex-shrink: 0;
}

.mm-tab-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  border-radius: 999px;
  background: var(--mm-bg-mute);
  color: var(--mm-ink-muted);
  border: 1px solid var(--mm-rule);
}

.mm-admin-tab--active .mm-tab-badge {
  background: var(--mm-highlight);
  color: var(--mm-highlight-ink);
  border-color: var(--mm-highlight);
}

/* Status Pills */
.mm-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mm-font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 4px 10px;
  border-radius: 2px;
  line-height: 1;
}

.mm-status-pill__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
}

.mm-status-pill--draft {
  border: 1px solid var(--mm-rule-strong);
  color: var(--mm-ink-muted);
  background: rgba(142, 142, 142, 0.1);
}
.mm-status-pill--draft .mm-status-pill__dot { background: var(--mm-ink-muted); }

.mm-status-pill--registration {
  border: 1px solid #3498db;
  color: #60a5fa;
  background: rgba(52, 152, 219, 0.12);
}
.mm-status-pill--registration .mm-status-pill__dot { background: #60a5fa; }

.mm-status-pill--open {
  border: 1px solid #2ecc71;
  color: #2ecc71;
  background: rgba(46, 204, 113, 0.12);
}
.mm-status-pill--open .mm-status-pill__dot { background: #2ecc71; }

.mm-status-pill--closed {
  border: 1px solid #e74c3c;
  color: #e74c3c;
  background: rgba(231, 76, 60, 0.12);
}
.mm-status-pill--closed .mm-status-pill__dot { background: #e74c3c; }
</style>
