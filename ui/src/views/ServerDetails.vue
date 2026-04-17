<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ServerDetails, ServerInsights, LeaderboardsData, fetchServerDetails, fetchServerInsights, fetchServerLeaderboards, fetchLiveServerData, ServerBusyIndicator, ServerHourlyTimelineEntry, fetchServerBusyIndicators } from '../services/serverDetailsService';
import { fetchServerMapRotation, type DetectedRotation, type MapRotationItem } from '../services/dataExplorerService';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import { countryCodeToName } from '../types/countryCodes';
import { ServerSummary } from '../types/server';
import PlayersPanel from '../components/PlayersPanel.vue';
import PlayerHistoryChart from '../components/PlayerHistoryChart.vue';
import ServerLeaderboards from '../components/ServerLeaderboards.vue';
import RecentSessionsList from '../components/data-explorer/RecentSessionsList.vue';
import MapRotationTable from '../components/data-explorer/MapRotationTable.vue';
import ServerMapDetailPanel from '../components/data-explorer/ServerMapDetailPanel.vue';
import MapRankingsPanel from '../components/MapRankingsPanel.vue';
import ServerComments from '../components/ServerComments.vue';
import { formatDate } from '../utils/date';
import HeroBackButton from '../components/HeroBackButton.vue';
import ForecastModal from '../components/ForecastModal.vue';
import discordIcon from '@/assets/discord.webp';
import { useAIContext } from '@/composables/useAIContext';
import PingProximityOrbit from '@/components/PingProximityOrbit.vue';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

const route = useRoute();
const router = useRouter();

// AI Context
const { setContext, clearContext } = useAIContext();

// State
const serverName = ref(route.params.serverName as string);
const serverDetails = ref<ServerDetails | null>(null);
const serverInsights = ref<ServerInsights | null>(null);
const leaderboardsData = ref<LeaderboardsData | null>(null);
const liveServerInfo = ref<ServerSummary | null>(null);
const isLoading = ref(true);
const isInsightsLoading = ref(true);
const isLeaderboardsLoading = ref(true);
const isLiveServerLoading = ref(false);
const error = ref<string | null>(null);
const insightsError = ref<string | null>(null);
const leaderboardsError = ref<string | null>(null);
const liveServerError = ref<string | null>(null);
const showPlayersModal = ref(false);
const currentLeaderboardPeriod = ref<'week' | 'month' | 'alltime'>('week');
const minPlayersForWeighting = ref(15);
const minRoundsForKillBoards = ref(20);
const roundFilterMode = ref<'withPlayers' | 'all' | 'min'>('withPlayers');
const roundParticipantThreshold = ref(4);
const normalizedRoundParticipantThreshold = computed(() => Math.max(1, Math.round(roundParticipantThreshold.value)));
const recentRoundFilters = computed<Record<string, string>>(() => {
  if (roundFilterMode.value === 'all') {
    return {};
  }
  const minParticipants = roundFilterMode.value === 'min' ? normalizedRoundParticipantThreshold.value : 1;
  return { minParticipants: minParticipants.toString() };
});
const historyRollingWindow = ref('7d');
const historyPeriod = ref<'1d' | '3d' | '7d' | 'longer'>('7d');
const longerPeriod = ref<'1month' | '3months' | 'thisyear' | 'alltime'>('1month');
const showLongerDropdown = ref(false);
const showPlayerHistory = ref(true);
const hasLoadedPlayerHistory = ref(false);

// Maps state
const mapRotation = ref<MapRotationItem[]>([]);
const mapRotationPage = ref(1);
const mapRotationPageSize = ref(10);
const mapRotationTotalCount = ref(0);
const mapRotationTotalPages = computed(() => Math.max(1, Math.ceil(mapRotationTotalCount.value / mapRotationPageSize.value)));
const mapRotationDays = ref(60);
const detectedRotation = ref<DetectedRotation | null>(null);
const isMapsLoading = ref(false);
const mapsError = ref<string | null>(null);
const hasLoadedMaps = ref(false);
const showMapRotation = ref(true);

// Server-map detail panel state
const selectedMapName = ref<string | null>(null);
const showMapDetailPanel = ref(false);

// Rankings drill-down panel state (nested inside map detail panel)
const showRankingsInPanel = ref(false);
const rankingsMapNameForPanel = ref<string | null>(null);

// Busy indicator state
const serverBusyIndicator = ref<ServerBusyIndicator | null>(null);
const serverHourlyTimeline = ref<ServerHourlyTimelineEntry[]>([]);
const isBusyIndicatorLoading = ref(false);
const busyIndicatorError = ref<string | null>(null);
const showForecastOverlay = ref(false);

// V2 Tab Navigation
const activeTab = ref<'live' | 'leaderboards' | 'maps' | 'insights'>('live');
const tabs = [
  { id: 'live' as const, label: 'LIVE STATUS' },
  { id: 'leaderboards' as const, label: 'LEADERBOARDS' },
  { id: 'maps' as const, label: 'MAPS' },
  { id: 'insights' as const, label: 'INSIGHTS' },
];

// Wide viewport: show slide-out panels side-by-side (lg: 1024px+)
const isWideScreen = ref(false);
const updateWideScreen = () => {
  isWideScreen.value = typeof window !== 'undefined' && window.innerWidth >= 1024;
};

// Fetch live server data asynchronously (non-blocking)
const fetchLiveServerDataAsync = async () => {
  if (!serverDetails.value?.serverIp || !serverDetails.value?.serverPort) return;

  isLiveServerLoading.value = true;
  liveServerError.value = null;

  try {
    // Use gameId from server details API response, fallback to guessing from server name
    const gameId = serverDetails.value.gameId || 
      (serverName.value.toLowerCase().includes('fh2') ? 'fh2' : 
       serverName.value.toLowerCase().includes('vietnam') || serverName.value.toLowerCase().includes('bfv') ? 'bfvietnam' : 'bf1942');
    
    liveServerInfo.value = await fetchLiveServerData(
      gameId,
      serverDetails.value.serverIp,
      serverDetails.value.serverPort
    );
  } catch (err) {
    console.error('Error fetching live server data:', err);
    liveServerError.value = 'Failed to load current server info.';
  } finally {
    isLiveServerLoading.value = false;
  }
};

// Fetch busy indicator data for the server
const fetchBusyIndicatorData = async () => {
  if (!serverDetails.value?.serverGuid) return;

  isBusyIndicatorLoading.value = true;
  busyIndicatorError.value = null;

  try {
    const response = await fetchServerBusyIndicators([serverDetails.value.serverGuid]);
    if (response.serverResults.length > 0) {
      const result = response.serverResults[0];
      serverBusyIndicator.value = result.busyIndicator;
      serverHourlyTimeline.value = result.hourlyTimeline;
    }
  } catch (err) {
    console.error('Error fetching busy indicator data:', err);
    busyIndicatorError.value = 'Failed to load server activity forecast.';
  } finally {
    isBusyIndicatorLoading.value = false;
  }
};

// Fetch server details, insights, and leaderboards in parallel
const fetchData = async () => {
  if (!serverName.value) return;

  // Set AI context immediately with server name from route so chat shows correct context before fetch
  setContext({
    pageType: 'server',
    serverName: serverName.value,
    game: 'bf1942'
  });

  isLoading.value = true;
  error.value = null;

  try {
    // Fetch server details first (blocks UI)
    serverDetails.value = await fetchServerDetails(serverName.value);

    // Update AI context with serverGuid once we have it (API uses serverGuid)
    setContext({
      pageType: 'server',
      serverGuid: serverDetails.value?.serverGuid,
      serverName: serverName.value,
      game: serverDetails.value?.gameId || 'bf1942'
    });

    // Fetch live server data and busy indicator data asynchronously after server details are loaded
    fetchLiveServerDataAsync();
    fetchBusyIndicatorData();

    // Now fetch leaderboards (non-blocking)
    // Player history and maps will be loaded when user expands those sections
    fetchLeaderboardsAsync();

    // Fetch insights if player history is shown by default
    if (showPlayerHistory.value) {
      hasLoadedPlayerHistory.value = true;
      fetchInsightsAsync();
    }
  } catch (err) {
    console.error('Error fetching server details:', err);
    error.value = 'Failed to load server details. Please try again later.';
  } finally {
    isLoading.value = false;
  }
};

// Fetch insights asynchronously (non-blocking)
const fetchInsightsAsync = async () => {
  isInsightsLoading.value = true;
  insightsError.value = null;

  try {
    const days = getPeriodInDays();
    serverInsights.value = await fetchServerInsights(serverName.value, days, historyRollingWindow.value);
  } catch (err) {
    console.error('Error fetching server insights:', err);
    insightsError.value = 'Failed to load server insights.';
  } finally {
    isInsightsLoading.value = false;
  }
};

// Fetch leaderboards asynchronously (non-blocking)
const fetchLeaderboardsAsync = async () => {
  isLeaderboardsLoading.value = true;
  leaderboardsError.value = null;

  try {
    leaderboardsData.value = await fetchServerLeaderboards(
      serverName.value,
      currentLeaderboardPeriod.value,
      minPlayersForWeighting.value,
      minRoundsForKillBoards.value
    );
  } catch (err) {
    console.error('Error fetching server leaderboards:', err);
    leaderboardsError.value = 'Failed to load server leaderboards.';
  } finally {
    isLeaderboardsLoading.value = false;
  }
};

// Fetch map rotation data asynchronously (non-blocking)
const fetchMapRotationAsync = async (page: number = 1) => {
  if (!serverDetails.value?.serverGuid) return;

  isMapsLoading.value = true;
  mapsError.value = null;

  try {
    const response = await fetchServerMapRotation(
      serverDetails.value.serverGuid,
      page,
      mapRotationPageSize.value,
      mapRotationDays.value
    );
    mapRotation.value = response.maps;
    mapRotationPage.value = response.page;
    mapRotationTotalCount.value = response.totalCount;
    detectedRotation.value = response.detectedRotation ?? null;
  } catch (err) {
    console.error('Error fetching server map rotation:', err);
    mapsError.value = 'Failed to load map rotation.';
    detectedRotation.value = null;
  } finally {
    isMapsLoading.value = false;
  }
};

// Handle map rotation page change
const handleMapRotationPageChange = (page: number) => {
  if (page >= 1 && page <= mapRotationTotalPages.value) {
    fetchMapRotationAsync(page);
  }
};

const handleMapRotationDaysChange = (days: number) => {
  if (days === mapRotationDays.value) return;
  mapRotationDays.value = days;
  mapRotationPage.value = 1;
  fetchMapRotationAsync(1);
};

watch(
  () => route.params.serverName,
  (newName, oldName) => {
    if (newName !== oldName) {
      serverName.value = newName as string;
      fetchData();
    }
  }
);

watch(
  () => serverDetails.value?.serverGuid,
  (guid) => {
    if (guid && !hasLoadedMaps.value) {
      hasLoadedMaps.value = true;
      fetchMapRotationAsync();
    }
  },
  { immediate: true }
);

// Lock body scroll when any modal is open
const updateBodyScroll = () => {
  document.body.style.overflow = (showPlayersModal.value || showMapDetailPanel.value) ? 'hidden' : '';
};
watch(showPlayersModal, updateBodyScroll);
watch(showMapDetailPanel, updateBodyScroll);

onMounted(() => {
  fetchData();
  updateWideScreen();
  window.addEventListener('resize', updateWideScreen);
});

onUnmounted(() => {
  window.removeEventListener('resize', updateWideScreen);
  document.body.style.overflow = '';
  clearContext();
});


// Helper to get current time and UTC offset for a timezone string
function getTimezoneDisplay(timezone: string | undefined): string | null {
  if (!timezone) return null;
  try {
    const now = new Date();
    // Get current time in the timezone
    const time = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit', minute: '2-digit', timeZone: timezone
    }).format(now);
    // Get UTC offset in hours
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const offsetMinutes = (tzDate.getTime() - now.getTime()) / 60000;
    const offsetHours = Math.round(offsetMinutes / 60);
    const sign = offsetHours >= 0 ? '+' : '-';
    return `${time} (${sign}${Math.abs(offsetHours)})`;
  } catch {
    return timezone;
  }
}

// Helper to get full country name from code
function getCountryName(code: string | undefined, fallback: string | undefined): string | undefined {
  if (!code) return fallback;
  const name = countryCodeToName[code.toUpperCase()];
  return name || fallback;
}

// Helper to get the correct servers route based on gameId
const getServersRoute = (gameId?: string): string => {
  if (!gameId) return '/servers';
  
  const normalizedGameId = gameId.toLowerCase();
  switch (normalizedGameId) {
    case 'fh2':
      return '/servers/fh2';
    case 'bfv':
    case 'bfvietnam':
      return '/servers/bfv';
    case 'bf1942':
    case '42':
    default:
      return '/servers/bf1942';
  }
};

// Join server function
const joinServer = () => {
  if (!liveServerInfo.value?.joinLink) return;
  
  const newWindow = window.open(liveServerInfo.value.joinLink, '_blank', 'noopener,noreferrer');
  if (newWindow) {
    newWindow.blur();
    window.focus();
  }
};

// Players modal functions
const openPlayersModal = () => {
  if (!liveServerInfo.value) return;
  showMapDetailPanel.value = false;
  showPlayersModal.value = true;
};

const closePlayersModal = () => {
  showPlayersModal.value = false;
};

// Handle leaderboard period change
const handleLeaderboardPeriodChange = async (period: 'week' | 'month' | 'alltime') => {
  if (period === currentLeaderboardPeriod.value) return;

  currentLeaderboardPeriod.value = period;
  isLeaderboardsLoading.value = true;
  leaderboardsError.value = null;

  try {
    leaderboardsData.value = await fetchServerLeaderboards(
      serverName.value,
      period,
      minPlayersForWeighting.value,
      minRoundsForKillBoards.value
    );
  } catch (err) {
    console.error('Error fetching leaderboards for period:', period, err);
    leaderboardsError.value = 'Failed to load leaderboards for selected period.';
  } finally {
    isLeaderboardsLoading.value = false;
  }
};

// Handle min players for weighting update
const handleMinPlayersUpdate = async (value: number) => {
  minPlayersForWeighting.value = value;

  // Refetch leaderboards with new min players value
  isLeaderboardsLoading.value = true;
  leaderboardsError.value = null;

  try {
    leaderboardsData.value = await fetchServerLeaderboards(
      serverName.value,
      currentLeaderboardPeriod.value,
      value,
      minRoundsForKillBoards.value
    );
  } catch (err) {
    console.error('Error refreshing leaderboards with new min players:', err);
    leaderboardsError.value = 'Failed to refresh leaderboards.';
  } finally {
    isLeaderboardsLoading.value = false;
  }
};

// Handle min rounds for kill boards update
const handleMinRoundsUpdate = async (value: number) => {
  minRoundsForKillBoards.value = value;

  // Refetch leaderboards with new min rounds value
  isLeaderboardsLoading.value = true;
  leaderboardsError.value = null;

  try {
    leaderboardsData.value = await fetchServerLeaderboards(
      serverName.value,
      currentLeaderboardPeriod.value,
      minPlayersForWeighting.value,
      value
    );
  } catch (err) {
    console.error('Error refreshing leaderboards with new min rounds:', err);
    leaderboardsError.value = 'Failed to refresh leaderboards.';
  } finally {
    isLeaderboardsLoading.value = false;
  }
};

// Handle rolling window change for player history chart
const handleRollingWindowChange = async (rollingWindow: string) => {
  historyRollingWindow.value = rollingWindow;
  // Refetch insights with new rolling window - the API will recalculate rolling average
  await fetchInsightsAsync();
};

// Convert period string to days for API
const getPeriodInDays = (): number => {
  if (historyPeriod.value === 'longer') {
    switch (longerPeriod.value) {
      case '1month': return 30;
      case '3months': return 90;
      case 'thisyear': {
        const now = new Date();
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        return Math.floor((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24));
      }
      case 'alltime': return 36500; // ~100 years
    }
  }

  switch (historyPeriod.value) {
    case '1d': return 1;
    case '3d': return 3;
    case '7d': return 7;
    default: return 7;
  }
};

// Handle period change
const handleHistoryPeriodChange = async (period: '1d' | '3d' | '7d') => {
  historyPeriod.value = period;
  showLongerDropdown.value = false;
  await fetchInsightsAsync();
};

// Handle longer period selection
const selectLongerPeriod = async (period: '1month' | '3months' | 'thisyear' | 'alltime') => {
  longerPeriod.value = period;
  historyPeriod.value = 'longer';
  showLongerDropdown.value = false;
  await fetchInsightsAsync();
};

// Toggle longer period dropdown
const toggleLongerDropdown = () => {
  showLongerDropdown.value = !showLongerDropdown.value;
};

// Get label for longer period button
const getLongerPeriodLabel = () => {
  if (historyPeriod.value !== 'longer') return 'More';
  const labels = {
    '1month': '1 Month',
    '3months': '3 Months',
    'thisyear': 'This Year',
    'alltime': 'All Time'
  };
  return labels[longerPeriod.value];
};

// Toggle player history visibility and fetch data on first expand
const togglePlayerHistory = () => {
  showPlayerHistory.value = !showPlayerHistory.value;

  // Fetch data on first expand
  if (showPlayerHistory.value && !hasLoadedPlayerHistory.value) {
    hasLoadedPlayerHistory.value = true;
    fetchInsightsAsync();
  }
};

// Toggle map rotation section (expand to show maps inline)
const toggleMapRotation = () => {
  showMapRotation.value = !showMapRotation.value;
  if (showMapRotation.value && !hasLoadedMaps.value) {
    hasLoadedMaps.value = true;
    fetchMapRotationAsync();
  }
};

// Handle map navigation from MapRotationTable - open same server-map detail panel as DataExplorer
const handleMapNavigate = (mapName: string) => {
  if (!serverDetails.value?.serverGuid) return;
  showPlayersModal.value = false;
  selectedMapName.value = mapName;
  showMapDetailPanel.value = true;
};

// Handle close map detail panel
const handleCloseMapDetailPanel = () => {
  showMapDetailPanel.value = false;
  selectedMapName.value = null;
  showRankingsInPanel.value = false;
  rankingsMapNameForPanel.value = null;
};

// Handle opening rankings from map detail panel
const handleOpenRankingsFromMap = (mapName: string) => {
  rankingsMapNameForPanel.value = mapName;
  showRankingsInPanel.value = true;
};

// Handle closing rankings back to map detail
const handleCloseRankingsInPanel = () => {
  showRankingsInPanel.value = false;
  rankingsMapNameForPanel.value = null;
};

// Handle navigation from map detail panel
const handleNavigateToServerFromMap = () => {
  // Already on server details page, just close the panel
  handleCloseMapDetailPanel();
};

const handleNavigateToMapFromMap = (mapName: string) => {
  // Navigate to map detail in Data Explorer
  router.push({
    name: 'explore-map-detail',
    params: { mapName }
  });
};

// Helper functions for mini forecast bars
const getMiniTimelineBarHeight = (entry: ServerHourlyTimelineEntry): number => {
  const timeline = serverHourlyTimeline.value || [];
  const maxTypical = Math.max(1, ...timeline.map(e => Math.max(0, e.typicalPlayers || 0)));
  const pct = Math.max(0, Math.min(1, (entry.typicalPlayers || 0) / maxTypical));
  const maxHeight = 20; // px for mini bars (h-6 = 24px container)
  const minHeight = 2;
  return Math.max(minHeight, Math.round(pct * maxHeight));
};

const formatTimelineTooltip = (entry: ServerHourlyTimelineEntry): string => {
  // Convert UTC hour to local "HH:00" display
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), entry.hour, 0, 0));
  const local = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const levelLabel = getBusyLevelLabel(entry.busyLevel);
  return `${local} • Typical ${Math.round(entry.typicalPlayers)} • ${levelLabel}`;
};

const getBusyLevelLabel = (level: string): string => {
  switch (level) {
    case 'very_busy': return 'Very busy';
    case 'busy': return 'Busy';
    case 'moderate': return 'Moderate';
    case 'quiet': return 'Quiet';
    case 'very_quiet': return 'Very quiet';
    default: return 'Unknown';
  }
};

// Toggle forecast overlay for mobile
const toggleForecastOverlay = () => {
  showForecastOverlay.value = !showForecastOverlay.value;
};

// Close forecast overlay when clicking outside
const closeForecastOverlay = () => {
  showForecastOverlay.value = false;
};

// ===== Server Beacon =====

// Normalize gameId to an accent color key used by CSS
const beaconGameAccent = computed<'bf1942' | 'fh2' | 'bfvietnam' | 'unknown'>(() => {
  const id = (serverDetails.value?.gameId || '').toLowerCase();
  if (id === 'fh2') return 'fh2';
  if (id === 'bfv' || id === 'bfvietnam') return 'bfvietnam';
  if (id === 'bf1942' || id === '42') return 'bf1942';
  // Fallback: guess from the server name
  const name = (serverName.value || '').toLowerCase();
  if (name.includes('fh2')) return 'fh2';
  if (name.includes('vietnam')) return 'bfvietnam';
  if (!serverDetails.value) return 'unknown';
  return 'bf1942';
});

// Current server capacity percentage (0-100)
const capacityPercent = computed(() => {
  const n = liveServerInfo.value?.numPlayers ?? 0;
  const m = liveServerInfo.value?.maxPlayers ?? 0;
  return m > 0 ? Math.min(100, Math.round((n / m) * 100)) : 0;
});

// Pulse level for the beacon — prefer server's busy indicator when present,
// otherwise fall back to capacity thresholds, and 'offline' when we have
// live data but zero players.
const beaconPulseLevel = computed<'very_busy' | 'busy' | 'moderate' | 'quiet' | 'very_quiet' | 'offline'>(() => {
  const level = serverBusyIndicator.value?.busyLevel;
  if (level === 'very_busy' || level === 'busy' || level === 'moderate' || level === 'quiet' || level === 'very_quiet') {
    return level;
  }
  if (liveServerInfo.value) {
    const n = liveServerInfo.value.numPlayers ?? 0;
    if (n === 0) return 'offline';
    const pct = capacityPercent.value;
    if (pct >= 80) return 'very_busy';
    if (pct >= 50) return 'busy';
    if (pct >= 20) return 'moderate';
    return 'quiet';
  }
  return 'quiet';
});

// Human-readable status label shown inside the beacon badge
const beaconStatusLabel = computed(() => {
  switch (beaconPulseLevel.value) {
    case 'very_busy': return 'PEAK COMBAT';
    case 'busy': return 'ACTIVE FRONT';
    case 'moderate': return 'OPERATIONAL';
    case 'quiet': return 'LOW ACTIVITY';
    case 'very_quiet': return 'STANDING BY';
    case 'offline': return 'DORMANT';
    default: return 'STANDING BY';
  }
});

// Typical playerbase from busy indicator (for forecast status line)
const beaconTypicalPlayers = computed(() => {
  const t = serverBusyIndicator.value?.typicalPlayers;
  return typeof t === 'number' ? Math.round(t) : null;
});

// Forecast bar height (0-28px) for the beacon bars
const getForecastBarHeight = (entry: ServerHourlyTimelineEntry): number => {
  const timeline = serverHourlyTimeline.value || [];
  const maxTypical = Math.max(1, ...timeline.map(e => Math.max(0, e.typicalPlayers || 0)));
  const pct = Math.max(0, Math.min(1, (entry.typicalPlayers || 0) / maxTypical));
  const maxHeight = 28;
  const minHeight = 3;
  return Math.max(minHeight, Math.round(pct * maxHeight));
};

// Peak hour in the shown timeline
const forecastPeakHour = computed(() => {
  const timeline = serverHourlyTimeline.value || [];
  if (timeline.length === 0) return null;
  let peak = timeline[0];
  for (const e of timeline) {
    if ((e.typicalPlayers || 0) > (peak.typicalPlayers || 0)) peak = e;
  }
  return peak;
});
</script>

<template>
  <div class="portal-page">
    <div class="portal-grid" aria-hidden="true" />
    <div class="portal-inner">
      <div class="data-explorer">
        <div class="explorer-inner">
          
          <!-- Loading State -->
          <div v-if="isLoading" class="beacon-loading" role="status" aria-label="Loading server profile">
            <div class="beacon-loading__card">
              <div class="beacon-loading__header">
                <span class="beacon-loading__dot" />
                <span class="beacon-loading__dot" />
                <span class="beacon-loading__dot" />
                <span class="beacon-loading__title">gamefront://server/{{ serverName }}</span>
              </div>
              <div class="beacon-loading__body">
                <div class="beacon-loading__line"><span class="beacon-loading__prompt">$</span> locate_server --name="{{ serverName }}"</div>
                <div class="beacon-loading__line beacon-loading__line--muted">Opening encrypted channel...</div>
                <div class="beacon-loading__line beacon-loading__line--muted">Fetching telemetry, leaderboards, rotation...</div>
                <div class="beacon-loading__line beacon-loading__line--cursor">Streaming live roster<span class="beacon-loading__caret">▊</span></div>
              </div>
              <div class="beacon-loading__progress">
                <div class="beacon-loading__progress-fill" />
              </div>
            </div>
          </div>

          <!-- Error State -->
          <div v-else-if="error" class="beacon-error" role="alert">
            <div class="beacon-error__card">
              <div class="beacon-error__glitch" aria-hidden="true">
                <span>SIGNAL LOST</span>
                <span>SIGNAL LOST</span>
                <span>SIGNAL LOST</span>
              </div>
              <div class="beacon-error__icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
              </div>
              <div class="beacon-error__title">SERVER UNREACHABLE</div>
              <div class="beacon-error__msg">{{ error }}</div>
              <router-link to="/servers" class="beacon-error__retry">
                <span>←</span> BACK TO SERVERS
              </router-link>
            </div>
          </div>

          <!-- Content -->
          <div v-else-if="serverDetails" class="server-details-v2 space-y-6">

            <!-- Server Beacon Hero -->
            <section
              class="server-beacon"
              :class="[`server-beacon--${beaconGameAccent}`, `server-beacon--${beaconPulseLevel}`]"
              aria-label="Server status beacon"
            >
              <div class="server-beacon__bg" aria-hidden="true" />
              <div class="server-beacon__scan" aria-hidden="true" />
              <div class="server-beacon__inner">

                <!-- Status row: badge + location meta -->
                <div class="server-beacon__status-row">
                  <div class="server-beacon__badge">
                    <span class="server-beacon__dot" aria-hidden="true" />
                    <span>{{ beaconStatusLabel }}</span>
                  </div>
                  <div class="server-beacon__meta">
                    <span v-if="serverDetails?.region" class="server-beacon__meta-item--accent">{{ serverDetails.region }}</span>
                    <span v-if="serverDetails?.region && (serverDetails?.country || serverDetails?.countryCode)" class="server-beacon__meta-divider">·</span>
                    <span v-if="serverDetails?.country || serverDetails?.countryCode">{{ getCountryName(serverDetails?.countryCode, serverDetails?.country) }}</span>
                    <template v-if="getTimezoneDisplay(serverDetails?.timezone)">
                      <span class="server-beacon__meta-divider">·</span>
                      <span>{{ getTimezoneDisplay(serverDetails?.timezone) }}</span>
                    </template>
                    <template v-if="serverDetails?.serverIp && serverDetails?.serverPort">
                      <span class="server-beacon__meta-divider">·</span>
                      <span>{{ serverDetails.serverIp }}:{{ serverDetails.serverPort }}</span>
                    </template>
                  </div>
                </div>

                <!-- Server name -->
                <h1 class="server-beacon__name">{{ serverName }}</h1>

                <!-- Now playing -->
                <div v-if="liveServerInfo?.mapName" class="server-beacon__current">
                  <span class="server-beacon__current-chev" aria-hidden="true">▸</span>
                  <span class="server-beacon__current-label">Now Playing</span>
                  <span class="server-beacon__map">{{ liveServerInfo.mapName }}</span>
                </div>

                <!-- Action deck -->
                <div class="server-beacon__deck">
                  <!-- Online panel -->
                  <div v-if="liveServerInfo" class="beacon-online">
                    <div class="beacon-online__head">
                      <div>
                        <span class="beacon-online__num" :class="{ 'beacon-online__num--empty': liveServerInfo.numPlayers === 0 }">{{ liveServerInfo.numPlayers }}</span>
                        <span class="beacon-online__max">/{{ liveServerInfo.maxPlayers }}</span>
                      </div>
                    </div>
                    <div class="beacon-online__label">Soldiers Engaged</div>
                    <div class="beacon-online__bar">
                      <div class="beacon-online__bar-fill" :style="{ width: capacityPercent + '%' }" />
                    </div>
                  </div>
                  <div v-else-if="isLiveServerLoading" class="beacon-online">
                    <div class="beacon-online__head">
                      <div>
                        <span class="beacon-online__num beacon-online__num--empty">—</span>
                      </div>
                    </div>
                    <div class="beacon-online__label">Connecting...</div>
                    <div class="beacon-online__bar">
                      <div class="beacon-online__bar-fill" style="width: 0%" />
                    </div>
                  </div>
                  <div v-else-if="liveServerError" class="beacon-online">
                    <div class="beacon-online__head">
                      <div>
                        <span class="beacon-online__num beacon-online__num--empty">?</span>
                      </div>
                    </div>
                    <div class="beacon-online__label">Offline / Unreachable</div>
                  </div>

                  <!-- Forecast panel -->
                  <button
                    v-if="serverBusyIndicator && serverHourlyTimeline.length > 0"
                    type="button"
                    class="beacon-forecast"
                    aria-label="Open 24-hour forecast"
                    @click.stop="toggleForecastOverlay"
                  >
                    <div class="beacon-forecast__head">
                      <span class="beacon-forecast__label">24H Forecast</span>
                      <span v-if="beaconTypicalPlayers !== null" class="beacon-forecast__status">
                        Typical {{ beaconTypicalPlayers }}
                      </span>
                    </div>
                    <div class="beacon-forecast__bars">
                      <span
                        v-for="(entry, idx) in serverHourlyTimeline"
                        :key="idx"
                        class="beacon-forecast__bar"
                        :class="{
                          'beacon-forecast__bar--now': entry.isCurrentHour,
                          'beacon-forecast__bar--peak': forecastPeakHour && !entry.isCurrentHour && entry.hour === forecastPeakHour.hour
                        }"
                        :style="{ height: getForecastBarHeight(entry) + 'px' }"
                        :title="formatTimelineTooltip(entry)"
                      />
                    </div>
                    <div class="beacon-forecast__hint">Tap for details</div>
                    <ForecastModal
                      :show-overlay="false"
                      :show-modal="showForecastOverlay"
                      :hourly-timeline="serverHourlyTimeline"
                      :current-status="`${serverBusyIndicator.currentPlayers} players (typical: ${Math.round(serverBusyIndicator.typicalPlayers)})`"
                      :current-players="serverBusyIndicator.currentPlayers"
                      @close="closeForecastOverlay"
                    />
                  </button>
                  <div v-else-if="isBusyIndicatorLoading" class="beacon-forecast" aria-hidden="true">
                    <div class="beacon-forecast__head">
                      <span class="beacon-forecast__label">24H Forecast</span>
                      <span class="beacon-forecast__status">Calibrating…</span>
                    </div>
                    <div class="beacon-forecast__bars">
                      <span v-for="n in 24" :key="n" class="beacon-forecast__bar" :style="{ height: ((n % 6) + 3) + 'px' }" />
                    </div>
                  </div>

                  <!-- Deploy actions -->
                  <div class="beacon-actions">
                    <button
                      v-if="liveServerInfo?.joinLink"
                      type="button"
                      class="beacon-deploy"
                      :class="{ 'beacon-deploy--disabled': liveServerInfo.numPlayers >= liveServerInfo.maxPlayers }"
                      :disabled="liveServerInfo.numPlayers >= liveServerInfo.maxPlayers"
                      :aria-label="liveServerInfo.numPlayers >= liveServerInfo.maxPlayers ? 'Server full' : 'Join server'"
                      @click="joinServer"
                    >
                      <span class="beacon-deploy__text">{{ liveServerInfo.numPlayers >= liveServerInfo.maxPlayers ? 'SERVER FULL' : 'DEPLOY →' }}</span>
                      <span class="beacon-deploy__sub">{{ liveServerInfo.numPlayers >= liveServerInfo.maxPlayers ? 'No open slots' : 'Join Game' }}</span>
                    </button>

                    <a
                      v-if="liveServerInfo?.discordUrl"
                      :href="liveServerInfo.discordUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="beacon-link"
                      title="Join Discord"
                      aria-label="Join Discord"
                    >
                      <img :src="discordIcon" alt="Discord">
                    </a>

                    <a
                      v-if="liveServerInfo?.forumUrl"
                      :href="liveServerInfo.forumUrl"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="beacon-link beacon-link__label"
                      title="Visit Forum"
                      aria-label="Visit Forum"
                    >
                      FORUM
                    </a>
                  </div>
                </div>
              </div>
            </section>

            <!-- Tab Navigation (Terminal style) -->
            <nav class="terminal-tabs" role="tablist" aria-label="Server detail sections">
              <button
                v-for="tab in tabs"
                :key="tab.id"
                type="button"
                role="tab"
                :aria-selected="activeTab === tab.id"
                class="terminal-tab"
                :class="{ 'terminal-tab--active': activeTab === tab.id }"
                @click="activeTab = tab.id"
              >
                <span class="terminal-tab__bracket" aria-hidden="true">[</span>
                <span>{{ tab.label }}</span>
                <span class="terminal-tab__bracket" aria-hidden="true">]</span>
                <span class="terminal-tab__underline" aria-hidden="true" />
              </button>
            </nav>

            <!-- Tab Content -->
            <div class="space-y-6">
              <!-- LIVE STATUS TAB -->
              <div v-if="activeTab === 'live'" class="grid grid-cols-1 xl:grid-cols-12 gap-6">
                <!-- Online Players -->
                <div class="xl:col-span-6 space-y-6">
                  <div class="explorer-card">
                    <div class="explorer-card-header flex items-center justify-between">
                      <h3 class="explorer-card-title">ONLINE PLAYERS</h3>
                    </div>
                    <div class="explorer-card-body p-0">
                      <PlayersPanel
                        v-if="liveServerInfo"
                        :show="true"
                        :server="liveServerInfo"
                        :inline="true"
                      />
                      <div v-else-if="isLiveServerLoading" class="p-8 flex justify-center"><div class="explorer-spinner"></div></div>
                      <div v-else class="p-8 text-center text-neutral-500 font-mono uppercase">No live server data</div>
                    </div>
                  </div>
                </div>

                <!-- Right Column: Comments & Recent Sessions -->
                <div class="xl:col-span-6 space-y-6">
                  <!-- Server Comments -->
                  <ServerComments :server-name="serverName" />

                  <!-- Recent Sessions -->
                  <div class="explorer-card">
                    <div class="explorer-card-header flex items-center justify-between">
                      <h3 class="explorer-card-title">RECENT SESSIONS</h3>
                      <router-link :to="`/servers/${encodeURIComponent(serverName)}/sessions`" class="explorer-link text-xs font-mono uppercase">View All &rarr;</router-link>
                    </div>
                    <div class="explorer-card-body p-0">
                      <div class="flex flex-col gap-2 px-4 py-3 border-b border-[var(--border-color)] bg-black/20">
                        <div class="flex flex-wrap items-center gap-2">
                          <span class="text-[10px] text-neutral-500 font-mono uppercase">Rounds:</span>
                          <button type="button" class="explorer-toggle-btn text-[10px] px-2 py-1" :class="{ 'explorer-toggle-btn--active': roundFilterMode === 'withPlayers' }" @click="roundFilterMode = 'withPlayers'">With Players</button>
                          <button type="button" class="explorer-toggle-btn text-[10px] px-2 py-1" :class="{ 'explorer-toggle-btn--active': roundFilterMode === 'all' }" @click="roundFilterMode = 'all'">All</button>
                        </div>
                      </div>
                      <RecentSessionsList
                        v-if="serverDetails?.serverGuid"
                        :server-guid="serverDetails.serverGuid"
                        :server-name="serverName"
                        :limit="8"
                        :initial-visible-count="4"
                        :filters="recentRoundFilters"
                        empty-message="No recent sessions found"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <!-- LEADERBOARDS TAB -->
              <div v-if="activeTab === 'leaderboards'" class="explorer-card">
                <div class="explorer-card-header">
                  <h3 class="explorer-card-title">SERVER LEADERBOARDS</h3>
                </div>
                <div class="explorer-card-body">
                  <ServerLeaderboards
                    :leaderboards-data="leaderboardsData"
                    :is-loading="isLeaderboardsLoading"
                    :error="leaderboardsError"
                    :server-name="serverName"
                    :server-guid="serverDetails.serverGuid"
                    :min-players-for-weighting="minPlayersForWeighting"
                    :min-rounds-for-kill-boards="minRoundsForKillBoards"
                    @update-min-players-for-weighting="handleMinPlayersUpdate"
                    @update-min-rounds-for-kill-boards="handleMinRoundsUpdate"
                    @period-change="handleLeaderboardPeriodChange"
                  />
                </div>
              </div>

              <!-- MAPS TAB -->
              <div v-if="activeTab === 'maps'" class="grid grid-cols-1 xl:grid-cols-12 gap-6">
                <div class="xl:col-span-12">
                  <div class="explorer-card">
                    <div class="explorer-card-header flex items-center justify-between">
                      <h3 class="explorer-card-title">MAP ROTATION & STATISTICS</h3>
                      <div class="flex items-center gap-2">
                        <span class="text-[10px] text-neutral-500 font-mono uppercase">Period:</span>
                        <div class="flex bg-[var(--bg-panel)] border border-[var(--border-color)] rounded overflow-hidden">
                          <button v-for="days in [30, 60, 90, 365]" :key="days" class="px-2 py-1 text-[10px] font-mono transition-colors border-r border-[var(--border-color)] last:border-r-0" :class="mapRotationDays === days ? 'bg-white/10 text-neon-cyan' : 'text-neutral-400 hover:text-neutral-200'" @click="handleMapRotationDaysChange(days)">{{ days === 365 ? '1Y' : `${days}D` }}</button>
                        </div>
                      </div>
                    </div>
                    <div class="explorer-card-body p-0">
                      <MapRotationTable
                        :map-rotation="mapRotation"
                        :current-page="mapRotationPage"
                        :total-pages="mapRotationTotalPages"
                        :total-count="mapRotationTotalCount"
                        :page-size="mapRotationPageSize"
                        :detected-rotation="detectedRotation"
                        :is-loading="isMapsLoading"
                        @navigate="handleMapNavigate"
                        @page-change="handleMapRotationPageChange"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <!-- INSIGHTS TAB -->
              <div v-if="activeTab === 'insights'" class="space-y-6">
                <!-- Population Trends -->
                <div class="explorer-card">
                  <div class="explorer-card-header">
                    <h3 class="explorer-card-title">POPULATION TRENDS</h3>
                  </div>
                  <div class="explorer-card-body">
                    <div class="flex justify-center mb-6">
                      <div class="explorer-toggle-group">
                        <button v-for="period in ['1d', '3d', '7d']" :key="period" class="explorer-toggle-btn" :class="{ 'explorer-toggle-btn--active': historyPeriod === period }" @click="handleHistoryPeriodChange(period as '1d' | '3d' | '7d')">{{ period === '1d' ? '24H' : period === '3d' ? '3D' : '7D' }}</button>
                      </div>
                    </div>
                    <PlayerHistoryChart
                      v-if="serverInsights?.playersOnlineHistory"
                      :chart-data="serverInsights.playersOnlineHistory.dataPoints"
                      :insights="serverInsights.playersOnlineHistory.insights"
                      :period="serverInsights.playersOnlineHistory.period"
                      :rolling-window="historyRollingWindow"
                      :loading="isInsightsLoading"
                      :error="insightsError"
                      @rolling-window-change="handleRollingWindowChange"
                    />
                  </div>
                </div>

                <!-- Ping Proximity -->
                <div class="explorer-card">
                  <div class="explorer-card-header">
                    <h3 class="explorer-card-title">PING PROXIMITY</h3>
                    <p class="text-[10px] text-neutral-500 font-mono mt-1 uppercase">Nearby players by network latency</p>
                  </div>
                  <div class="explorer-card-body">
                    <PingProximityOrbit
                      v-if="serverDetails?.serverGuid"
                      :server-guid="serverDetails.serverGuid"
                      :server-name="serverName"
                      @player-click="(name: string) => router.push(`/players/${encodeURIComponent(name)}`)"
                    />
                  </div>
                </div>
              </div>
            </div>

          </div>

          <!-- Empty State -->
          <div v-else class="explorer-empty">
            <div class="explorer-empty-icon"><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-500"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg></div>
            <p class="explorer-empty-title">No server data available</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Players Modal (Overlay) -->
    <div v-if="showPlayersModal" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4" @click="closePlayersModal" @keydown.esc="closePlayersModal" tabindex="-1">
      <div class="w-full max-w-4xl h-full sm:h-auto sm:max-h-[90vh] overflow-hidden flex flex-col bg-[var(--bg-panel)] border-x-0 sm:border border-[var(--border-color)] rounded-none sm:rounded-lg shadow-2xl" @click.stop>
        <div class="p-3 sm:p-4 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--bg-panel)]">
          <h3 class="explorer-card-title text-lg">ONLINE PLAYERS</h3>
          <button class="explorer-btn explorer-btn--ghost explorer-btn--sm" @click="closePlayersModal">CLOSE</button>
        </div>
        <div class="flex-1 overflow-y-auto">
          <PlayersPanel
            :show="true"
            :server="liveServerInfo"
            :inline="true"
            @close="closePlayersModal"
          />
        </div>
      </div>
    </div>

    <!-- Map Detail Panel (Overlay) -->
    <div v-if="showMapDetailPanel && selectedMapName && serverDetails?.serverGuid" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4" @click="handleCloseMapDetailPanel" @keydown.esc="handleCloseMapDetailPanel" tabindex="-1">
      <div class="w-full max-w-5xl h-full sm:h-auto sm:max-h-[90vh] overflow-hidden flex flex-col bg-[var(--bg-panel)] border-x-0 sm:border border-[var(--border-color)] rounded-none sm:rounded-lg shadow-2xl" @click.stop>
        <!-- Header -->
        <div class="p-3 sm:p-4 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--bg-panel)]">
          <div>
            <h2 class="text-base sm:text-lg font-bold text-neon-cyan font-mono">
              {{ showRankingsInPanel ? `RANKINGS: ${rankingsMapNameForPanel}` : selectedMapName }}
            </h2>
            <p class="text-[10px] sm:text-xs text-neutral-400 font-mono mt-1">ON {{ serverName }}</p>
          </div>
          <button class="explorer-btn explorer-btn--ghost explorer-btn--sm" aria-label="Close map detail panel" @click="handleCloseMapDetailPanel">CLOSE</button>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto">
          <div v-if="showRankingsInPanel && rankingsMapNameForPanel" class="p-3 sm:p-4">
            <button
              class="explorer-btn explorer-btn--ghost explorer-btn--sm mb-4 flex items-center gap-2"
              @click="handleCloseRankingsInPanel"
            >
              &larr; BACK TO MAP DETAIL
            </button>
            <MapRankingsPanel
              :map-name="rankingsMapNameForPanel"
              :server-guid="serverDetails.serverGuid"
              :game="(serverDetails.gameId as any) || 'bf1942'"
            />
          </div>
          <ServerMapDetailPanel
            v-else
            :server-guid="serverDetails.serverGuid"
            :map-name="selectedMapName"
            @navigate-to-server="handleNavigateToServerFromMap"
            @navigate-to-map="handleNavigateToMapFromMap"
            @close="handleCloseMapDetailPanel"
            @open-rankings="handleOpenRankingsFromMap"
          />
        </div>
      </div>
    </div>

  </div>
</template>

<style src="./portal-layout.css"></style>
<style scoped src="./DataExplorer.vue.css"></style>
<style scoped src="./ServerDetails.vue.css"></style>
