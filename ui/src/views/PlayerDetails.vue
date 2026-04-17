<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { PlayerTimeStatistics, fetchPlayerStats } from '../services/playerStatsService';
import { TrendDataPoint, PlayerAchievementGroup } from '../types/playerStatsTypes';
import { Line } from 'vue-chartjs';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler } from 'chart.js';
import PlayerAchievementSummary from '../components/PlayerAchievementSummary.vue';
import PlayerRecentRoundsCompact from '../components/PlayerRecentRoundsCompact.vue';
import PlayerAchievementHeroBadges from '../components/PlayerAchievementHeroBadges.vue';
import PlayerServerMapStats from '../components/PlayerServerMapStats.vue';
import MapRankingsPanel from '../components/MapRankingsPanel.vue';
import PlayerDetailPanel from '../components/data-explorer/PlayerDetailPanel.vue';
import PlayerMapDetailPanel from '../components/data-explorer/PlayerMapDetailPanel.vue';
import ServerMapDetailPanel from '../components/data-explorer/ServerMapDetailPanel.vue';
import PlayerCompetitiveRankings from '../components/data-explorer/PlayerCompetitiveRankings.vue';
import MapPerformanceRace from '../components/data-explorer/MapPerformanceRace.vue';
import PlayerActivityHeatmap from '../components/PlayerActivityHeatmap.vue';
import PlayerMapPreference from '../components/PlayerMapPreference.vue';
import PingProximityOrbit from '@/components/PingProximityOrbit.vue';
import PlayerComments from '../components/PlayerComments.vue';
import { formatRelativeTime } from '@/utils/timeUtils';
import { calculateKDR } from '@/utils/statsUtils';
import { useAIContext } from '@/composables/useAIContext';

import bf1942Icon from '@/assets/bf1942.webp';
import fh2Icon from '@/assets/fh2.webp';
import bfvIcon from '@/assets/bfv.webp';
import defaultIcon from '@/assets/servers.webp';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

// Router
const router = useRouter();
const route = useRoute();

// AI Context
const { setContext, clearContext } = useAIContext();

const playerName = ref(route.params.playerName as string);
const playerStats = ref<PlayerTimeStatistics | null>(null);
const isLoading = ref(true);
const error = ref<string | null>(null);
const showLastOnline = ref(false);
const achievementGroups = ref<PlayerAchievementGroup[]>([]);
const achievementGroupsLoading = ref(false);
const achievementGroupsError = ref<string | null>(null);

// V2 Tab Navigation
const activeTab = ref<'overview' | 'rankings' | 'network' | 'awards'>('overview');
const tabs = [
  { id: 'overview' as const, label: 'OVERVIEW' },
  { id: 'rankings' as const, label: 'RANKINGS' },
  { id: 'network' as const, label: 'NETWORK' },
  { id: 'awards' as const, label: 'AWARDS' },
];

// State for server map stats view
const selectedServerGuid = ref<string | null>(null);
const scrollPositionBeforeMapStats = ref(0);

// State for rankings drill-down panel
const rankingsMapName = ref<string | null>(null);
const rankingsServerGuid = ref<string | null>(null);

// State for map detail panel (from data explorer breakdown)
const selectedMapDetailName = ref<string | null>(null);

// State for server map detail panel (drill-down from map detail)
const selectedServerMapDetail = ref<{ serverGuid: string; mapName: string } | null>(null);

// Wide viewport: show slide-out panel side-by-side (lg: 1024px+)
const isWideScreen = ref(false);
const updateWideScreen = () => {
  isWideScreen.value = typeof window !== 'undefined' && window.innerWidth >= 1024;
};

// Servers pagination state
const SERVERS_PAGE_SIZE = 3;
const serversPage = ref(0);

// Best Scores state
const selectedBestScoresTab = ref<'allTime' | 'last30Days' | 'thisWeek'>('thisWeek');
const bestScoresTabOptions = [
  { key: 'allTime' as const, label: 'All Time' },
  { key: 'last30Days' as const, label: '30 Days' },
  { key: 'thisWeek' as const, label: 'This Week' }
] as const;

// Function to handle best scores tab change with scroll reset
const changeBestScoresTab = (tabKey: 'allTime' | 'last30Days' | 'thisWeek') => {
  selectedBestScoresTab.value = tabKey;
  
  // Reset scroll position of horizontal scroll container on mobile
  setTimeout(() => {
    const scrollContainer = document.querySelector('.best-scores-scroll-container');
    if (scrollContainer) {
      scrollContainer.scrollLeft = 0;
    }
  }, 50); // Small delay to ensure DOM has updated
};


// Computed properties for trend charts
const killRateTrendChartData = computed(() => {
  if (!playerStats.value?.recentStats?.killRateTrend) return { labels: [], datasets: [] };

  const trend = playerStats.value.recentStats.killRateTrend;
  const labels = trend.map((point: TrendDataPoint) => new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  const data = trend.map((point: TrendDataPoint) => point.value);

  return {
    labels,
    datasets: [{
      label: 'Kill Rate',
      data,
      borderColor: '#4CAF50',
      backgroundColor: 'rgba(76, 175, 80, 0.1)',
      borderWidth: 2,
      fill: true,
      tension: 0.4,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointBackgroundColor: '#4CAF50',
      pointBorderColor: '#ffffff',
      pointBorderWidth: 1,
    }]
  };
});

const kdRatioTrendChartData = computed(() => {
  if (!playerStats.value?.recentStats?.kdRatioTrend) return { labels: [], datasets: [] };

  const trend = playerStats.value.recentStats.kdRatioTrend;
  const labels = trend.map((point: TrendDataPoint) => new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  const data = trend.map((point: TrendDataPoint) => point.value);

  return {
    labels,
    datasets: [{
      label: 'K/D Ratio',
      data,
      borderColor: '#a855f7',
      backgroundColor: 'rgba(168, 85, 247, 0.1)',
      borderWidth: 2,
      fill: true,
      tension: 0.4,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointBackgroundColor: '#a855f7',
      pointBorderColor: '#ffffff',
      pointBorderWidth: 1,
    }]
  };
});

// Trend summaries: current value + delta vs period start
type TrendSummary = { current: number; delta: number; direction: 'up' | 'down' | 'flat' };
const summarizeTrend = (points: TrendDataPoint[] | undefined): TrendSummary | null => {
  if (!points || points.length === 0) return null;
  const current = points[points.length - 1].value;
  const baseline = points[0].value;
  const delta = baseline > 0 ? ((current - baseline) / baseline) * 100 : 0;
  const direction: TrendSummary['direction'] = delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat';
  return { current, delta, direction };
};
const kdTrendSummary = computed(() => summarizeTrend(playerStats.value?.recentStats?.kdRatioTrend));
const killRateTrendSummary = computed(() => summarizeTrend(playerStats.value?.recentStats?.killRateTrend));

// Combat summary for overview banner
const combatSummary = computed(() => {
  if (!playerStats.value) return null;
  const totalMinutes = playerStats.value.totalPlayTimeMinutes || 0;
  const totalKills = playerStats.value.totalKills || 0;
  const killsPerMin = totalMinutes > 0 ? totalKills / totalMinutes : 0;
  return {
    totalSessions: playerStats.value.totalSessions || 0,
    highestScore: playerStats.value.highestScore || 0,
    killsPerMin,
    roundsAnalyzed: playerStats.value.recentStats?.totalRoundsAnalyzed || 0,
    firstPlayed: playerStats.value.firstPlayed,
  };
});

// Achievements summary for awards banner
const achievementsSummary = computed(() => {
  const groups = achievementGroups.value;
  if (!groups || groups.length === 0) return null;
  const totalCount = groups.reduce((sum, g) => sum + (g.count || 0), 0);
  const tiers = { legend: 0, gold: 0, silver: 0, bronze: 0 } as Record<string, number>;
  for (const g of groups) {
    const t = (g.tier || '').toLowerCase();
    if (t in tiers) tiers[t] += 1;
  }
  const latest = [...groups].sort((a, b) =>
    new Date(b.latestAchievedAt).getTime() - new Date(a.latestAchievedAt).getTime()
  )[0] || null;
  return { totalCount, uniqueCount: groups.length, tiers, latest };
});

// Network summary for network banner
const networkSummary = computed(() => {
  const servers = unifiedServerList.value;
  if (servers.length === 0) return null;
  const topServer = servers.find(s => s.totalMinutes > 0) || servers[0];
  return {
    serverCount: servers.length,
    topServerName: topServer.serverName,
    selectedServerName: selectedProximityServer.value?.serverName,
  };
});

const trendChartOptions = computed(() => {
  const computedStyles = window.getComputedStyle(document.documentElement);
  const isDarkMode = computedStyles.getPropertyValue('--color-background').trim().includes('26, 16, 37') ||
                    document.documentElement.classList.contains('dark-mode') ||
                    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      intersect: false,
      mode: 'index' as const
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: {
          color: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
          borderColor: isDarkMode ? '#30363d' : '#e0e0e0'
        },
        ticks: {
          color: isDarkMode ? '#8b949e' : '#666666',
          font: {
            size: 10
          }
        }
      },
      x: {
        grid: {
          display: false
        },
        ticks: {
          color: isDarkMode ? '#8b949e' : '#666666',
          font: {
            size: 10
          },
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 10
        }
      }
    },
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        enabled: true,
        backgroundColor: isDarkMode ? 'rgba(35, 21, 53, 0.95)' : 'rgba(0, 0, 0, 0.8)',
        titleColor: '#ffffff',
        bodyColor: '#ffffff',
        borderColor: isDarkMode ? '#9c27b0' : '#666666',
        borderWidth: 1,
        cornerRadius: 6,
        displayColors: false,
        padding: 10,
        titleFont: { size: 12, weight: 'bold' as const },
        bodyFont: { size: 11 },
        callbacks: {
          title: function(context: any[]) {
            return context[0].label;
          },
          label: function(context: any) {
            const label = context.dataset.label;
            const value = context.parsed.y;
            if (label === 'Kill Rate') {
              return `${label}: ${value.toFixed(2)} kills/min`;
            } else if (label === 'K/D Ratio') {
              return `${label}: ${value.toFixed(2)}`;
            }
            return `${label}: ${value}`;
          }
        }
      }
    }
  };
});

const microChartOptions = computed(() => {
  const computedStyles = window.getComputedStyle(document.documentElement);
  const isDarkMode = computedStyles.getPropertyValue('--color-background').trim().includes('26, 16, 37') ||
                    document.documentElement.classList.contains('dark-mode') ||
                    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      intersect: false,
      mode: 'index' as const
    },
    scales: {
      y: {
        display: false,
        grid: {
          display: false
        }
      },
      x: {
        display: false,
        grid: {
          display: false
        }
      }
    },
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        enabled: true,
        backgroundColor: isDarkMode ? 'rgba(35, 21, 53, 0.95)' : 'rgba(0, 0, 0, 0.8)',
        titleColor: '#ffffff',
        bodyColor: '#ffffff',
        borderColor: isDarkMode ? '#9c27b0' : '#666666',
        borderWidth: 1,
        cornerRadius: 6,
        displayColors: false,
        padding: 8,
        titleFont: { size: 12, weight: 'bold' as const },
        bodyFont: { size: 11 },
        callbacks: {
          title: function(context: any[]) {
            return context[0].label;
          },
          label: function(context: any) {
            const label = context.dataset.label;
            const value = context.parsed.y;
            if (label === 'Kill Rate') {
              return `${value.toFixed(3)} k/min`;
            } else if (label === 'K/D Ratio') {
              return `${value.toFixed(2)}`;
            }
            return `${value.toFixed(2)}`;
          }
        }
      }
    },
    elements: {
      point: {
        radius: 0,
        hoverRadius: 2
      },
      line: {
        borderWidth: 1
      }
    }
  };
});

// Function to show map stats for a server
const showServerMapStats = (serverGuid: string) => {
  scrollPositionBeforeMapStats.value = window.scrollY;
  selectedServerGuid.value = serverGuid;
  // On wide screens the panel is side-by-side; scroll to top so the panel is visible. On mobile the panel is a fixed overlay, so don't scroll.
  if (isWideScreen.value) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
};

// Function to close server map stats view
const closeServerMapStats = () => {
  selectedServerGuid.value = null;
  rankingsMapName.value = null;
  rankingsServerGuid.value = null;
  window.scrollTo({ top: scrollPositionBeforeMapStats.value, behavior: 'auto' });
};

// Function to open rankings drill-down from map stats
const openRankingsPanel = (mapName: string) => {
  rankingsMapName.value = mapName;
  rankingsServerGuid.value = effectiveServerGuid.value ?? null;
};

// Function to close rankings and go back to map stats
const closeRankingsPanel = () => {
  rankingsMapName.value = null;
  rankingsServerGuid.value = null;
};

// Function to open map detail from data explorer breakdown
const openMapDetail = (mapName: string) => {
  scrollPositionBeforeMapStats.value = window.scrollY;
  selectedMapDetailName.value = mapName;
};

// Function to close map detail
const closeMapDetail = () => {
  selectedMapDetailName.value = null;
  window.scrollTo({ top: scrollPositionBeforeMapStats.value, behavior: 'auto' });
};

// Function to open server map detail (drill-down from map detail)
const openServerMapDetail = (serverGuid: string) => {
  if (selectedMapDetailName.value) {
    selectedServerMapDetail.value = {
      serverGuid,
      mapName: selectedMapDetailName.value
    };
  }
};

// Function to close server map detail
const closeServerMapDetail = () => {
  selectedServerMapDetail.value = null;
};

// Function to open server map detail from server map stats panel (with player context)
const openPlayerServerMapDetail = (mapName: string) => {
  if (selectedServerGuid.value && selectedServerGuid.value !== '__all__') {
    selectedServerMapDetail.value = {
      serverGuid: selectedServerGuid.value,
      mapName: mapName
    };
  }
};

const fetchData = async () => {
  isLoading.value = true;
  error.value = null;
  
  try {
    playerStats.value = await fetchPlayerStats(playerName.value);
    
    // Auto-fetch achievements if we're on a tab that needs them
    if (activeTab.value === 'overview' || activeTab.value === 'awards') {
      fetchAchievementGroups();
    }
  } catch (err) {
    error.value = `Failed to fetch player stats for ${playerName.value}.`;
    console.error(err);
  } finally {
    isLoading.value = false;
  }
};

// Watch for tab changes to fetch data only when needed
watch(activeTab, (newTab) => {
  if ((newTab === 'overview' || newTab === 'awards') && achievementGroups.value.length === 0 && !achievementGroupsLoading.value) {
    fetchAchievementGroups();
  }
});

const fetchAchievementGroups = async () => {
  achievementGroupsLoading.value = true;
  achievementGroupsError.value = null;
  try {
    const response = await fetch(`/stats/gamification/player/${encodeURIComponent(playerName.value)}/achievement-groups`);
    if (!response.ok) throw new Error('Failed to fetch achievement groups');
    achievementGroups.value = await response.json();
  } catch (err) {
    console.error('Error fetching achievement groups:', err);
    achievementGroupsError.value = 'Failed to load achievements.';
    achievementGroups.value = [];
  } finally {
    achievementGroupsLoading.value = false;
  }
};


// Format minutes to hours and minutes
const formatPlayTime = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.floor(minutes % 60);

  if (hours === 0) {
    return `${remainingMinutes}m`;
  } else {
    return `${hours}h ${remainingMinutes}m`;
  }
};

// Function to navigate to round report using best score data
const navigateToRoundReport = (roundId: string) => {
  router.push({
    name: 'round-report',
    params: {
      roundId: roundId,
    },
    query: {
      players: playerName.value // Include the player name to pin them
    }
  });
};



// Computed property to get the current expanded server's name removed - was unused

// Computed property to get the selected server's name for panel header
const selectedServerName = computed(() => {
  if (!selectedServerGuid.value) return null;
  if (selectedServerGuid.value === '__all__') return 'All Servers';

  // Check server list first
  const server = playerStats.value?.servers?.find(s => s.serverGuid === selectedServerGuid.value);
  if (server) return server.serverName;

  // Fallback to rankings
  const ranking = playerStats.value?.insights?.serverRankings?.find(
    r => r.serverGuid === selectedServerGuid.value
  );
  return ranking?.serverName || null;
});

// Computed property for current best scores
const currentBestScores = computed(() => {
  if (!playerStats.value?.bestScores) return [];
  return playerStats.value.bestScores[selectedBestScoresTab.value] || [];
});

const playerPanelGame = computed(() => {
  return playerStats.value?.servers?.[0]?.gameId || 'bf1942';
});



onMounted(() => {
  fetchData();
  document.addEventListener('click', closeTooltipOnClickOutside);
  updateWideScreen();
  window.addEventListener('resize', updateWideScreen);

  // Set AI context for player page
  setContext({
    pageType: 'player',
    playerName: playerName.value,
    game: 'bf1942'
  });
});

onUnmounted(() => {
  clearContext();
});

const gameIcons: { [key: string]: string } = {
  bf1942: bf1942Icon,
  fh2: fh2Icon,
  bfv: bfvIcon,
};

const getGameIcon = (gameId: string): string => {
  if (!gameId) return defaultIcon;
  return gameIcons[gameId.toLowerCase()] || defaultIcon;
};

// --- Server List ---

// Unified server entry type: stats fields are optional because rankings-only entries won't have them
interface UnifiedServer {
  serverGuid: string;
  serverName: string;
  gameId: string;
  totalMinutes: number;
  totalKills: number;
  totalDeaths: number;
  kdRatio: number;
  killsPerMinute: number;
  totalRounds: number;
  highestScore: number;
  ranking: import('../types/playerStatsTypes').ServerRanking | null;
  hasStats: boolean; // true when playtime/K-D data is available
}

// Unified server list: merges server playtime data with ranking data, sorted by rank
const unifiedServerList = computed<UnifiedServer[]>(() => {
  const servers = playerStats.value?.servers ?? [];
  const rankings = playerStats.value?.insights?.serverRankings ?? [];

  if (servers.length === 0 && rankings.length === 0) return [];

  const rankMap = new Map(rankings.map(r => [r.serverGuid, r]));
  const seenGuids = new Set<string>();

  // Start with servers array (has full stats)
  const unified: UnifiedServer[] = servers.map(server => {
    seenGuids.add(server.serverGuid);
    return {
      ...server,
      ranking: rankMap.get(server.serverGuid) || null,
      hasStats: true,
    };
  });

  // Add any ranked servers that aren't in the servers array
  for (const ranking of rankings) {
    if (!seenGuids.has(ranking.serverGuid)) {
      unified.push({
        serverGuid: ranking.serverGuid,
        serverName: ranking.serverName,
        gameId: '',
        totalMinutes: 0,
        totalKills: 0,
        totalDeaths: 0,
        kdRatio: 0,
        killsPerMinute: 0,
        totalRounds: 0,
        highestScore: 0,
        ranking,
        hasStats: false,
      });
    }
  }

  // Sort by playtime descending
  unified.sort((a, b) => b.totalMinutes - a.totalMinutes);

  return unified;
});

// Paged server list (client-side)
const pagedServers = computed(() => {
  const start = serversPage.value * SERVERS_PAGE_SIZE;
  return unifiedServerList.value.slice(start, start + SERVERS_PAGE_SIZE);
});
const serversTotalPages = computed(() => Math.ceil(unifiedServerList.value.length / SERVERS_PAGE_SIZE));

// Proximity server selection (defaults to most-played server)
const selectedProximityServerGuid = ref('')
watch(unifiedServerList, (list) => {
  if (list.length > 0 && !selectedProximityServerGuid.value) {
    selectedProximityServerGuid.value = list[0].serverGuid
  }
}, { immediate: true })
const selectedProximityServer = computed(() =>
  unifiedServerList.value.find(s => s.serverGuid === selectedProximityServerGuid.value)
)

// Helper: rank badge color based on position
const getRankBadgeClass = (rank: number): string => {
  if (rank === 1) return 'text-neon-gold font-bold';
  if (rank === 2) return 'text-neutral-300 font-bold';
  if (rank === 3) return 'text-orange-400 font-bold';
  if (rank <= 10) return 'text-neon-cyan font-semibold';
  return 'text-neutral-400 font-medium';
};

// Helper to get playtime percentage
const getPlaytimePercentage = (serverMinutes: number) => {
  if (!playerStats.value?.servers) return 0;
  const total = playerStats.value.servers.reduce((sum, s) => sum + s.totalMinutes, 0);
  return total > 0 ? (serverMinutes / total) * 100 : 0;
};

// Show all-servers map rankings
const showAllServerMaps = () => {
  scrollPositionBeforeMapStats.value = window.scrollY;
  selectedServerGuid.value = '__all__';
  if (isWideScreen.value) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
};

// Whether the map stats panel is open (specific server or all servers)
const isMapStatsPanelOpen = computed(() => selectedServerGuid.value !== null);
const effectiveServerGuid = computed(() => selectedServerGuid.value === '__all__' ? undefined : selectedServerGuid.value);

// Lock body scroll when any modal is open
const updateBodyScroll = () => {
  document.body.style.overflow = (isMapStatsPanelOpen.value || selectedMapDetailName.value || selectedServerMapDetail.value) ? 'hidden' : '';
};
watch(isMapStatsPanelOpen, updateBodyScroll);
watch(selectedMapDetailName, updateBodyScroll);
watch(selectedServerMapDetail, updateBodyScroll);

// Numeric rank for ServerRanking (API may send rankDisplay instead of rank)
const rankNum = (ranking: { rank?: number; rankDisplay?: string }): number => {
  if (typeof ranking.rank === 'number' && !Number.isNaN(ranking.rank)) return ranking.rank;
  const parsed = parseInt(ranking.rankDisplay ?? '', 10);
  return Number.isNaN(parsed) ? 99 : parsed;
};

// High-level rankings summary for hero strip
const rankingsSummary = computed(() => {
  const rankings = playerStats.value?.insights?.serverRankings ?? [];
  if (rankings.length === 0) return null;
  const numOnes = rankings.filter(r => rankNum(r) === 1).length;
  const numTop10 = rankings.filter(r => rankNum(r) <= 10).length;
  const best = [...rankings].sort((a, b) => rankNum(a) - rankNum(b))[0];
  return { totalRanked: rankings.length, numOnes, numTop10, best };
});



// Add watcher for route changes to update playerName and refetch data
watch(
  () => route.params.playerName,
  (newName, oldName) => {
    if (newName !== oldName) {
      playerName.value = newName as string;
      // Close all open panels/modals
      selectedServerGuid.value = null;
      rankingsMapName.value = null;
      rankingsServerGuid.value = null;
      selectedMapDetailName.value = null;
      selectedServerMapDetail.value = null;
      fetchData();
    }
  }
);

// Close tooltip when clicking outside
const closeTooltipOnClickOutside = (event: MouseEvent) => {
  const target = event.target as HTMLElement;
  if (!target.closest('.group.cursor-pointer')) {
    showLastOnline.value = false;
  }
};

// Cleanup function to restore body scroll and remove event listener when component unmounts
onUnmounted(() => {
  document.body.style.overflow = 'unset';
  document.removeEventListener('click', closeTooltipOnClickOutside);
  window.removeEventListener('resize', updateWideScreen);
});

</script>

<template>
  <div class="portal-page">
    <div class="portal-grid" aria-hidden="true" />
    <div class="portal-inner">
      <div class="data-explorer">
        <div class="explorer-inner">
          
          <!-- Loading State -->
          <div v-if="isLoading" class="loading-terminal" role="status" aria-label="Loading player statistics">
            <div class="loading-terminal-frame">
              <div class="loading-terminal-header">
                <div class="loading-terminal-dots" aria-hidden="true">
                  <span class="loading-dot loading-dot--red" />
                  <span class="loading-dot loading-dot--amber" />
                  <span class="loading-dot loading-dot--green" />
                </div>
                <div class="text-[10px] font-mono text-neutral-500 uppercase tracking-widest">OPERATIVE_DOSSIER.ENCRYPTED</div>
              </div>
              <div class="loading-terminal-body">
                <div class="terminal-line"><span class="terminal-prompt">&gt;</span><span>connect --target <span class="text-neon-cyan">{{ playerName }}</span></span></div>
                <div class="terminal-line terminal-line--muted"><span class="terminal-prompt">$</span><span>fetching telemetry</span><span class="terminal-dots" /></div>
                <div class="terminal-line terminal-line--muted"><span class="terminal-prompt">$</span><span>decrypting rankings</span><span class="terminal-dots" /></div>
                <div class="terminal-line terminal-line--muted"><span class="terminal-prompt">$</span><span>resolving combat log</span><span class="terminal-dots" /></div>
                <div class="terminal-line"><span class="terminal-prompt terminal-prompt--cyan">&gt;</span><span class="text-neon-cyan">loading dossier</span><span class="terminal-cursor">█</span></div>
              </div>
            </div>
          </div>

          <!-- Error State -->
          <div v-else-if="error" class="explorer-card p-8 text-center" role="alert">
            <div class="flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-400"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
            </div>
            <p class="text-neon-red text-lg font-medium">{{ error }}</p>
          </div>

          <!-- Content -->
          <div v-else-if="playerStats" class="space-y-6">
            
            <!-- Player Hero / Command Dossier -->
            <section class="player-hero" :class="{ 'player-hero--active': playerStats?.isActive }" aria-label="Player dossier">
              <span class="hero-corner hero-corner--tl" aria-hidden="true" />
              <span class="hero-corner hero-corner--tr" aria-hidden="true" />
              <span class="hero-corner hero-corner--bl" aria-hidden="true" />
              <span class="hero-corner hero-corner--br" aria-hidden="true" />

              <div class="hero-body">
                <!-- Identity row -->
                <div class="hero-identity">
                  <div class="relative group cursor-pointer flex-shrink-0" @click="showLastOnline = !showLastOnline">
                    <div class="hero-avatar" :class="{ 'hero-avatar--active': playerStats?.isActive }">
                      <span class="hero-avatar-initial">{{ playerName?.charAt(0)?.toUpperCase() || '?' }}</span>
                      <span class="hero-avatar-ring" aria-hidden="true" />
                    </div>
                    <div class="hero-status-dot" :class="playerStats?.isActive ? 'hero-status-dot--on' : 'hero-status-dot--off'" aria-hidden="true" />
                    <div
                      v-if="showLastOnline"
                      class="hero-tooltip"
                      role="tooltip"
                    >
                      <div class="w-2 h-2 rounded-full" :class="playerStats?.isActive ? 'bg-neon-green' : 'bg-neutral-500'" />
                      <span>{{ playerStats?.isActive ? 'CURRENTLY ONLINE' : `LAST ONLINE: ${formatRelativeTime(playerStats?.lastPlayed || '')}`.toUpperCase() }}</span>
                    </div>
                  </div>

                  <div class="hero-identity-text">
                    <div class="hero-eyebrow">
                      <span class="hero-eyebrow-pulse" :class="playerStats?.isActive ? 'hero-eyebrow-pulse--on' : 'hero-eyebrow-pulse--off'" aria-hidden="true" />
                      <span>OPERATIVE // {{ playerStats?.isActive ? 'ACTIVE' : 'DORMANT' }}</span>
                      <span class="hero-eyebrow-sep" aria-hidden="true">·</span>
                      <span class="uppercase tracking-wider">SEEN {{ formatRelativeTime(playerStats?.lastPlayed || '') }}</span>
                    </div>
                    <h1 class="hero-name">{{ playerName }}</h1>
                    <div class="hero-badges-inline">
                      <PlayerAchievementHeroBadges :player-name="playerName" />
                    </div>
                  </div>

                  <div class="hero-actions">
                    <router-link
                      :to="`/players/${encodeURIComponent(playerName)}/network`"
                      class="explorer-btn explorer-btn--ghost explorer-btn--sm hero-action-btn"
                      title="View player network"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hero-action-icon"><circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="m7 7 3 3"/><path d="m17 7-3 3"/><path d="m7 17 3-3"/><path d="m17 17-3-3"/></svg>
                      NETWORK
                    </router-link>
                    <router-link
                      :to="{ path: '/players/compare', query: { player1: playerName } }"
                      class="explorer-btn explorer-btn--ghost explorer-btn--sm hero-action-btn"
                      title="Compare this player"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hero-action-icon"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>
                      COMPARE
                    </router-link>
                  </div>
                </div>

                <!-- KPI grid -->
                <div class="hero-kpi-grid">
                  <div class="hero-kpi">
                    <div class="hero-kpi-label">K/D Ratio</div>
                    <div class="hero-kpi-value hero-kpi-value--cyan">{{ calculateKDR(playerStats?.totalKills || 0, playerStats?.totalDeaths || 0) }}</div>
                    <div class="hero-kpi-foot">{{ (playerStats?.totalKills || 0).toLocaleString() }} K · {{ (playerStats?.totalDeaths || 0).toLocaleString() }} D</div>
                  </div>
                  <div class="hero-kpi">
                    <div class="hero-kpi-label">Total Kills</div>
                    <div class="hero-kpi-value hero-kpi-value--green">{{ (playerStats?.totalKills || 0).toLocaleString() }}</div>
                    <div class="hero-kpi-foot">{{ playerStats?.totalSessions ?? 0 }} sessions</div>
                  </div>
                  <div class="hero-kpi">
                    <div class="hero-kpi-label">Playtime</div>
                    <div class="hero-kpi-value hero-kpi-value--gold">{{ formatPlayTime(playerStats?.totalPlayTimeMinutes || 0) }}</div>
                    <div class="hero-kpi-foot">since {{ playerStats?.firstPlayed ? new Date(playerStats.firstPlayed).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : '—' }}</div>
                  </div>
                  <div class="hero-kpi">
                    <div class="hero-kpi-label">High Score</div>
                    <div class="hero-kpi-value hero-kpi-value--pink">{{ (playerStats?.highestScore || 0).toLocaleString() }}</div>
                    <div class="hero-kpi-foot">single round peak</div>
                  </div>
                </div>

                <!-- Rankings summary strip -->
                <div v-if="rankingsSummary" class="hero-ranks-strip">
                  <div class="hero-rank-chip" v-if="rankingsSummary.numOnes > 0">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hero-rank-icon text-neon-gold"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
                    <div class="hero-rank-chip-body">
                      <div class="hero-rank-num text-neon-gold">{{ rankingsSummary.numOnes }}</div>
                      <div class="hero-rank-label">#1 RANKS</div>
                    </div>
                  </div>
                  <div class="hero-rank-chip">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hero-rank-icon text-neon-cyan"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                    <div class="hero-rank-chip-body">
                      <div class="hero-rank-num text-neon-cyan">{{ rankingsSummary.numTop10 }}</div>
                      <div class="hero-rank-label">TOP 10</div>
                    </div>
                  </div>
                  <div class="hero-rank-chip">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hero-rank-icon text-neon-pink"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
                    <div class="hero-rank-chip-body">
                      <div class="hero-rank-num text-neon-pink">{{ rankingsSummary.totalRanked }}</div>
                      <div class="hero-rank-label">RANKED SERVERS</div>
                    </div>
                  </div>
                  <div class="hero-rank-chip hero-rank-chip--best">
                    <div class="hero-rank-label">Best Rank</div>
                    <div class="hero-rank-best-row">
                      <span class="hero-rank-best-num" :class="getRankBadgeClass(rankNum(rankingsSummary.best))">#{{ rankingsSummary.best.rankDisplay ?? rankingsSummary.best.rank }}</span>
                      <span class="hero-rank-best-server">{{ rankingsSummary.best.serverName }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- Tab Navigation -->
            <div class="hero-tabs" role="tablist">
              <button
                v-for="tab in tabs"
                :key="tab.id"
                role="tab"
                :aria-selected="activeTab === tab.id"
                class="hero-tab"
                :class="{ 'hero-tab--active': activeTab === tab.id }"
                @click="activeTab = tab.id"
              >
                <svg v-if="tab.id === 'overview'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hero-tab-icon"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>
                <svg v-else-if="tab.id === 'rankings'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hero-tab-icon"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
                <svg v-else-if="tab.id === 'network'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hero-tab-icon"><circle cx="12" cy="12" r="2"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="m6.5 6.5 4 4"/><path d="m17.5 6.5-4 4"/><path d="m6.5 17.5 4-4"/><path d="m17.5 17.5-4-4"/></svg>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="hero-tab-icon"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>
                <span>{{ tab.label }}</span>
                <span class="hero-tab-underline" aria-hidden="true" />
              </button>
            </div>

            <!-- Tab Content -->
            <div class="space-y-6">
              <!-- OVERVIEW TAB (Default, merged Combat Log + Breakdown + Comments) -->
              <div v-if="activeTab === 'overview'" class="space-y-6">
                <!-- Combat Stats Banner -->
                <div v-if="combatSummary" class="combat-banner">
                  <div class="combat-banner-eyebrow">
                    <span class="combat-banner-dot" aria-hidden="true" />
                    COMBAT RECORD //
                    <span class="text-neon-cyan">{{ combatSummary.roundsAnalyzed }}</span>
                    rounds analyzed over last 90d
                  </div>
                  <div class="combat-banner-grid">
                    <div class="combat-banner-stat">
                      <div class="combat-banner-value text-neon-cyan">{{ combatSummary.totalSessions.toLocaleString() }}</div>
                      <div class="combat-banner-label">Sessions Logged</div>
                    </div>
                    <div class="combat-banner-stat">
                      <div class="combat-banner-value text-neon-gold">{{ combatSummary.highestScore.toLocaleString() }}</div>
                      <div class="combat-banner-label">Peak Round Score</div>
                    </div>
                    <div class="combat-banner-stat">
                      <div class="combat-banner-value text-neon-green">{{ combatSummary.killsPerMin.toFixed(2) }}</div>
                      <div class="combat-banner-label">Lifetime K/Min</div>
                    </div>
                    <div class="combat-banner-stat">
                      <div class="combat-banner-value text-neon-pink">{{ combatSummary.firstPlayed ? new Date(combatSummary.firstPlayed).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : '—' }}</div>
                      <div class="combat-banner-label">First Deployed</div>
                    </div>
                  </div>
                </div>

                <!-- Section 01 -->
                <div class="section-divider">
                  <span class="section-num">01</span>
                  <div class="section-head">
                    <div class="section-title">Telemetry Trends</div>
                    <div class="section-sub">Ninety-day moving combat analysis</div>
                  </div>
                  <span class="section-line" aria-hidden="true" />
                </div>

                <!-- Performance Trends -->
                <div v-if="playerStats?.recentStats" class="explorer-card">
                  <div class="explorer-card-header flex items-start justify-between gap-3">
                    <div>
                      <h3 class="explorer-card-title">PERFORMANCE TRENDS</h3>
                      <p class="text-[10px] text-neutral-500 font-mono mt-1 uppercase tracking-wider">90-Day Telemetry · {{ playerStats.recentStats.totalRoundsAnalyzed }} rounds analyzed</p>
                    </div>
                    <div class="hidden sm:flex items-center gap-1 text-[9px] font-mono text-neutral-500 uppercase tracking-widest">
                      <span class="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" aria-hidden="true" />
                      LIVE
                    </div>
                  </div>
                  <div class="explorer-card-body">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
                      <div class="trend-block">
                        <div class="trend-head">
                          <div class="trend-label text-neon-pink">K/D Ratio</div>
                          <div v-if="kdTrendSummary" class="trend-current">
                            <span class="trend-current-value text-neon-pink">{{ kdTrendSummary.current.toFixed(2) }}</span>
                            <span class="trend-delta" :class="`trend-delta--${kdTrendSummary.direction}`">
                              <span class="trend-delta-arrow">
                                <template v-if="kdTrendSummary.direction === 'up'">&#9650;</template>
                                <template v-else-if="kdTrendSummary.direction === 'down'">&#9660;</template>
                                <template v-else>&mdash;</template>
                              </span>
                              {{ Math.abs(kdTrendSummary.delta).toFixed(1) }}%
                            </span>
                          </div>
                        </div>
                        <div class="h-44">
                          <Line :data="kdRatioTrendChartData" :options="trendChartOptions" />
                        </div>
                      </div>
                      <div class="trend-block">
                        <div class="trend-head">
                          <div class="trend-label text-neon-cyan">Kill Rate</div>
                          <div v-if="killRateTrendSummary" class="trend-current">
                            <span class="trend-current-value text-neon-cyan">{{ killRateTrendSummary.current.toFixed(2) }}</span>
                            <span class="trend-current-unit">k/min</span>
                            <span class="trend-delta" :class="`trend-delta--${killRateTrendSummary.direction}`">
                              <span class="trend-delta-arrow">
                                <template v-if="killRateTrendSummary.direction === 'up'">&#9650;</template>
                                <template v-else-if="killRateTrendSummary.direction === 'down'">&#9660;</template>
                                <template v-else>&mdash;</template>
                              </span>
                              {{ Math.abs(killRateTrendSummary.delta).toFixed(1) }}%
                            </span>
                          </div>
                        </div>
                        <div class="h-44">
                          <Line :data="killRateTrendChartData" :options="trendChartOptions" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Section 02 -->
                <div class="section-divider">
                  <span class="section-num">02</span>
                  <div class="section-head">
                    <div class="section-title">Combat Log &amp; Trophies</div>
                    <div class="section-sub">Recent deployments and peak scores</div>
                  </div>
                  <span class="section-line" aria-hidden="true" />
                </div>

                <div class="grid grid-cols-1 xl:grid-cols-12 gap-6">
                  <!-- Recent Rounds & Best Scores -->
                  <div class="xl:col-span-7 space-y-6">
                    <div class="explorer-card">
                      <div class="explorer-card-header">
                        <h3 class="explorer-card-title">RECENT ROUNDS</h3>
                      </div>
                      <div class="explorer-card-body">
                        <PlayerRecentRoundsCompact
                          v-if="playerStats?.recentSessions && playerStats.recentSessions.length > 0"
                          :sessions="playerStats.recentSessions"
                          :player-name="playerName"
                        />
                        <div v-else class="text-center py-8 text-neutral-500 font-mono uppercase">No recent rounds found</div>
                      </div>
                    </div>

                    <!-- Best Scores (Full) -->
                    <div class="explorer-card explorer-card--trophy">
                      <div class="explorer-card-header flex items-center justify-between">
                        <h3 class="explorer-card-title">BEST ROUND SCORES</h3>
                        <div class="explorer-toggle-group">
                          <button
                            v-for="tab in bestScoresTabOptions"
                            :key="tab.key"
                            class="explorer-toggle-btn"
                            :class="{ 'explorer-toggle-btn--active': selectedBestScoresTab === tab.key }"
                            @click="changeBestScoresTab(tab.key)"
                          >
                            {{ tab.label }}
                          </button>
                        </div>
                      </div>
                      <div class="explorer-card-body p-0">
                        <div v-if="currentBestScores.length === 0" class="p-4 sm:p-6 text-center text-neutral-500 text-sm font-mono">
                          NO SCORES RECORDED
                        </div>
                        <div v-else class="divide-y divide-[var(--border-color)]">
                          <div
                            v-for="(score, index) in currentBestScores.slice(0, 10)"
                            :key="`${score.roundId}-${index}`"
                            class="best-score-row"
                            :class="{
                              'best-score-row--gold': index === 0,
                              'best-score-row--silver': index === 1,
                              'best-score-row--bronze': index === 2,
                            }"
                            @click="navigateToRoundReport(score.roundId)"
                          >
                            <div class="best-score-medal"
                                 :class="{
                                   'best-score-medal--gold': index === 0,
                                   'best-score-medal--silver': index === 1,
                                   'best-score-medal--bronze': index === 2,
                                 }">
                              <svg v-if="index < 3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="best-score-medal-icon"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>
                              <span class="best-score-medal-num">{{ index + 1 }}</span>
                            </div>
                            <div class="flex-1 min-w-0">
                              <div class="best-score-value">
                                <span class="best-score-pts">{{ score.score.toLocaleString() }}</span>
                                <span class="best-score-unit">PTS</span>
                              </div>
                              <div class="best-score-meta">
                                <span class="best-score-map">{{ score.mapName }}</span>
                                <span class="best-score-sep" aria-hidden="true">·</span>
                                <span class="truncate">{{ score.serverName }}</span>
                              </div>
                            </div>
                            <div class="best-score-aside">
                              <div class="best-score-kd">K/D {{ calculateKDR(score.kills, score.deaths) }}</div>
                              <div class="best-score-time">{{ formatRelativeTime(score.timestamp) }}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Comments & Activity Heatmap -->
                  <div class="xl:col-span-5 space-y-6">
                    <!-- Player Comments (Renamed/Moved from Social) -->
                    <PlayerComments :player-name="playerName" />

                    <div class="explorer-card">
                      <div class="explorer-card-header">
                        <h3 class="explorer-card-title">ACTIVITY HEATMAP</h3>
                        <p class="text-[10px] text-neutral-500 font-mono mt-1 uppercase">Typical play times</p>
                      </div>
                      <div class="explorer-card-body">
                        <PlayerActivityHeatmap
                          :player-name="playerName"
                          :game="playerPanelGame"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- RANKINGS TAB (Swapped Columns) -->
              <div v-if="activeTab === 'rankings'" class="space-y-6">
                <!-- Rankings Banner -->
                <div v-if="rankingsSummary" class="rankings-banner">
                  <div class="rankings-banner-left">
                    <div class="rankings-banner-eyebrow">PEAK STANDING</div>
                    <div class="rankings-banner-rank-row">
                      <span class="rankings-banner-rank" :class="getRankBadgeClass(rankNum(rankingsSummary.best))">
                        #{{ rankingsSummary.best.rankDisplay ?? rankingsSummary.best.rank }}
                      </span>
                      <span class="rankings-banner-on">on</span>
                      <span class="rankings-banner-server">{{ rankingsSummary.best.serverName }}</span>
                    </div>
                    <div class="rankings-banner-context">
                      Ranked among <span class="text-neon-cyan">{{ rankingsSummary.best.totalRankedPlayers?.toLocaleString?.() || '—' }}</span> competitors · score <span class="text-neon-cyan">{{ rankingsSummary.best.scoreDisplay || rankingsSummary.best.totalScore.toLocaleString() }}</span>
                    </div>
                  </div>
                  <div class="rankings-banner-grid">
                    <div class="rankings-banner-cell">
                      <div class="rankings-banner-value text-neon-gold">{{ rankingsSummary.numOnes }}</div>
                      <div class="rankings-banner-label">#1 FINISHES</div>
                    </div>
                    <div class="rankings-banner-cell">
                      <div class="rankings-banner-value text-neon-cyan">{{ rankingsSummary.numTop10 }}</div>
                      <div class="rankings-banner-label">TOP 10</div>
                    </div>
                    <div class="rankings-banner-cell">
                      <div class="rankings-banner-value text-neon-pink">{{ rankingsSummary.totalRanked }}</div>
                      <div class="rankings-banner-label">RANKED SERVERS</div>
                    </div>
                  </div>
                </div>

                <!-- Section 01 -->
                <div class="section-divider">
                  <span class="section-num">01</span>
                  <div class="section-head">
                    <div class="section-title">Server Standings</div>
                    <div class="section-sub">Your position on each active cluster</div>
                  </div>
                  <span class="section-line" aria-hidden="true" />
                </div>

                <div class="grid grid-cols-1 xl:grid-cols-12 gap-6">
                <!-- Col 1: Breakdown, All Server Ranks & Map Preference -->
                <div class="xl:col-span-5 space-y-6">
                  <!-- Detailed Breakdown -->
                  <div class="explorer-card">
                    <PlayerDetailPanel
                      :player-name="playerName"
                      :game="playerPanelGame"
                      @navigate-to-map="openMapDetail"
                    />
                  </div>

                  <!-- Servers List (paged) -->
                  <div class="explorer-card">
                    <div class="explorer-card-header flex items-center justify-between">
                      <div>
                        <h3 class="explorer-card-title">SERVER RANKINGS</h3>
                        <p class="text-[10px] text-neutral-500 font-mono mt-0.5 uppercase">Performance by Server Cluster</p>
                      </div>
                      <button type="button" class="explorer-btn explorer-btn--ghost explorer-btn--sm" @click="showAllServerMaps">GLOBAL MAPS</button>
                    </div>

                    <div class="explorer-card-body p-0">
                      <div class="divide-y divide-[var(--border-color)]">
                        <div
                          v-for="server in pagedServers"
                          :key="server.serverGuid"
                          class="server-rank-row group"
                          :class="server.ranking ? `server-rank-row--r${Math.min(rankNum(server.ranking), 4)}` : ''"
                          @click="showServerMapStats(server.serverGuid)"
                        >
                          <div class="server-rank-badge" :class="getRankBadgeClass(rankNum(server.ranking))">
                            <span v-if="server.ranking">#{{ server.ranking.rankDisplay ?? server.ranking.rank }}</span>
                            <span v-else class="text-neutral-600">—</span>
                          </div>
                          <div class="flex-1 min-w-0">
                            <div class="text-sm font-medium text-neutral-200 truncate font-mono">{{ server.serverName }}</div>
                            <div class="flex items-center gap-2 text-[10px] text-neutral-500 font-mono mt-0.5">
                              <span v-if="server.hasStats">K/D {{ Number(server.kdRatio).toFixed(2) }}</span>
                              <span v-if="server.hasStats && server.totalMinutes > 0">·</span>
                              <span v-if="server.hasStats && server.totalMinutes > 0">{{ formatPlayTime(server.totalMinutes) }}</span>
                              <span v-else-if="server.ranking">{{ server.ranking.scoreDisplay || server.ranking.totalScore.toLocaleString() }} score</span>
                            </div>
                            <div v-if="server.hasStats && server.totalMinutes > 0" class="server-rank-bar" aria-hidden="true">
                              <span class="server-rank-bar-fill" :style="{ width: Math.min(getPlaytimePercentage(server.totalMinutes), 100) + '%' }" />
                            </div>
                          </div>
                          <div class="server-rank-arrow">&rarr;</div>
                        </div>
                      </div>
                      <!-- Pagination controls -->
                      <div v-if="serversTotalPages > 1" class="flex items-center justify-between px-3 py-2 border-t border-[var(--border-color)]">
                        <button class="explorer-btn explorer-btn--ghost explorer-btn--sm" :disabled="serversPage === 0" @click="serversPage--">&larr;</button>
                        <span class="text-[10px] font-mono text-neutral-500">{{ serversPage + 1 }} / {{ serversTotalPages }}</span>
                        <button class="explorer-btn explorer-btn--ghost explorer-btn--sm" :disabled="serversPage >= serversTotalPages - 1" @click="serversPage++">&rarr;</button>
                      </div>
                    </div>
                  </div>

                  <!-- Map Preference -->
                  <div class="explorer-card">
                    <div class="explorer-card-header">
                      <h3 class="explorer-card-title">MAP PREFERENCE</h3>
                      <p class="text-[10px] text-neutral-500 font-mono mt-0.5 uppercase">Last 30 days activity</p>
                    </div>
                    <div class="explorer-card-body">
                      <PlayerMapPreference
                        :player-name="playerName"
                        :game="playerPanelGame"
                        @navigate-to-map="openMapDetail"
                      />
                    </div>
                  </div>
                </div>

                <!-- Col 2: Global Map Rankings & Map Performance Race -->
                <div class="xl:col-span-7 space-y-6">
                  <!-- Global Map Rankings -->
                  <div class="explorer-card">
                    <div class="explorer-card-header">
                      <h3 class="explorer-card-title">GLOBAL MAP RANKINGS</h3>
                      <p class="text-[10px] text-neutral-500 font-mono mt-0.5 uppercase">Your position among all players</p>
                    </div>
                    <div class="explorer-card-body">
                      <PlayerCompetitiveRankings
                        :player-name="playerName"
                        :game="playerPanelGame"
                        @navigate-to-map="openMapDetail"
                      />
                    </div>
                  </div>

                  <!-- Map Performance Race -->
                  <div class="explorer-card">
                    <div class="explorer-card-header">
                      <h3 class="explorer-card-title">MAP PERFORMANCE OVER TIME</h3>
                      <p class="text-[10px] text-neutral-500 font-mono mt-0.5 uppercase">Historical Map Race</p>
                    </div>
                    <div class="explorer-card-body">
                      <MapPerformanceRace
                        :player-name="playerName"
                        :game="playerPanelGame"
                        @navigate-to-map="openMapDetail"
                      />
                    </div>
                  </div>
                </div>
                </div>
              </div>

              <!-- NETWORK TAB -->
              <div v-if="activeTab === 'network'" class="space-y-6">
                <!-- Network Banner -->
                <div class="network-banner">
                  <div class="network-banner-main">
                    <div class="network-banner-eyebrow">
                      <span class="network-banner-live" aria-hidden="true" />
                      SIGNAL INTEL //
                      <span class="text-neon-cyan">PROXIMITY ANALYSIS</span>
                    </div>
                    <h2 class="network-banner-title">Relationship Mapping</h2>
                    <p class="network-banner-sub">
                      Real-time companion detection derived from ping correlation and session overlap across
                      <span class="text-neon-cyan">{{ networkSummary?.serverCount ?? 0 }}</span>
                      tracked nodes.
                    </p>
                  </div>
                  <div class="network-banner-side">
                    <div class="network-banner-metric">
                      <div class="network-banner-metric-label">ACTIVE NODE</div>
                      <div class="network-banner-metric-value text-neon-cyan">{{ networkSummary?.selectedServerName || networkSummary?.topServerName || '—' }}</div>
                    </div>
                    <div v-if="unifiedServerList.length > 1" class="network-banner-filter">
                      <label class="network-banner-filter-label">FILTER BY NODE</label>
                      <select v-model="selectedProximityServerGuid" class="explorer-select network-banner-select">
                        <option v-for="server in unifiedServerList" :key="server.serverGuid" :value="server.serverGuid">{{ server.serverName }}</option>
                      </select>
                    </div>
                  </div>
                </div>

                <!-- Section 01 -->
                <div class="section-divider">
                  <span class="section-num">01</span>
                  <div class="section-head">
                    <div class="section-title">Proximity Orbit</div>
                    <div class="section-sub">Companions ordered by session correlation</div>
                  </div>
                  <span class="section-line" aria-hidden="true" />
                </div>

                <div class="explorer-card">
                  <div class="explorer-card-body p-0 sm:p-6">
                    <div v-if="unifiedServerList.length > 0" class="w-full">
                      <PingProximityOrbit
                        seamless
                        :server-guid="selectedProximityServerGuid"
                        :server-name="selectedProximityServer?.serverName"
                        @player-click="(name: string) => router.push(`/players/${encodeURIComponent(name)}`)"
                      />
                    </div>
                    <div v-else class="explorer-empty">
                      <div class="explorer-empty-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/></svg>
                      </div>
                      <p class="explorer-empty-title">NO SIGNAL DETECTED</p>
                      <p class="explorer-empty-desc">This operative has no recorded server sessions yet.</p>
                    </div>
                  </div>
                </div>

                <!-- Section 02 -->
                <div class="section-divider">
                  <span class="section-num">02</span>
                  <div class="section-head">
                    <div class="section-title">Deep Analysis</div>
                    <div class="section-sub">Full interactive social graph</div>
                  </div>
                  <span class="section-line" aria-hidden="true" />
                </div>

                <div class="network-cta">
                  <div class="network-cta-text">
                    <div class="network-cta-title">Extended Network Investigation</div>
                    <div class="network-cta-desc">Time-lapse view of squads, alt accounts, and recurring opponents.</div>
                  </div>
                  <router-link :to="`/players/${encodeURIComponent(playerName)}/network`" class="network-cta-btn">
                    <span>LAUNCH GRAPH</span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                  </router-link>
                </div>
              </div>

              <!-- AWARDS TAB (Prev Social) -->
              <div v-if="activeTab === 'awards'" class="space-y-6">
                <!-- Trophy Cabinet Banner -->
                <div class="trophy-banner">
                  <div class="trophy-banner-glow" aria-hidden="true" />
                  <div class="trophy-banner-left">
                    <div class="trophy-banner-eyebrow">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>
                      TROPHY CABINET
                    </div>
                    <h2 class="trophy-banner-title">
                      <span v-if="achievementsSummary" class="text-neon-gold">{{ achievementsSummary.totalCount.toLocaleString() }}</span>
                      <span v-else class="text-neutral-600">—</span>
                      <span class="trophy-banner-unit">achievements earned</span>
                    </h2>
                    <div v-if="achievementsSummary?.latest" class="trophy-banner-latest">
                      <span class="text-neutral-500 uppercase tracking-wider">Latest unlock:</span>
                      <span class="text-neon-cyan font-mono">{{ achievementsSummary.latest.achievementName }}</span>
                      <span class="trophy-banner-tier" :class="`trophy-tier-${(achievementsSummary.latest.tier || '').toLowerCase()}`">{{ achievementsSummary.latest.tier?.toUpperCase() }}</span>
                      <span class="text-neutral-500 font-mono">{{ formatRelativeTime(achievementsSummary.latest.latestAchievedAt) }}</span>
                    </div>
                  </div>
                  <div v-if="achievementsSummary" class="trophy-banner-tiers">
                    <div class="trophy-tier-cell trophy-tier-cell--legend">
                      <div class="trophy-tier-count">{{ achievementsSummary.tiers.legend }}</div>
                      <div class="trophy-tier-label">LEGEND</div>
                    </div>
                    <div class="trophy-tier-cell trophy-tier-cell--gold">
                      <div class="trophy-tier-count">{{ achievementsSummary.tiers.gold }}</div>
                      <div class="trophy-tier-label">GOLD</div>
                    </div>
                    <div class="trophy-tier-cell trophy-tier-cell--silver">
                      <div class="trophy-tier-count">{{ achievementsSummary.tiers.silver }}</div>
                      <div class="trophy-tier-label">SILVER</div>
                    </div>
                    <div class="trophy-tier-cell trophy-tier-cell--bronze">
                      <div class="trophy-tier-count">{{ achievementsSummary.tiers.bronze }}</div>
                      <div class="trophy-tier-label">BRONZE</div>
                    </div>
                  </div>
                </div>

                <!-- Section 01 -->
                <div class="section-divider">
                  <span class="section-num">01</span>
                  <div class="section-head">
                    <div class="section-title">Badge Collection</div>
                    <div class="section-sub">Grouped by category &amp; tier</div>
                  </div>
                  <span class="section-line" aria-hidden="true" />
                  <router-link :to="`/players/${encodeURIComponent(playerName)}/achievements`" class="section-link">VIEW ALL &rarr;</router-link>
                </div>

                <div class="explorer-card explorer-card--achievement">
                  <div class="explorer-card-body">
                    <PlayerAchievementSummary
                      :player-name="playerName"
                      :achievement-groups="achievementGroups"
                      :loading="achievementGroupsLoading"
                      :error="achievementGroupsError"
                    />
                  </div>
                </div>
              </div>
            </div>

          </div>

          <!-- Empty State -->
          <div v-else class="explorer-empty">
            <div class="explorer-empty-icon"><svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-neutral-500"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg></div>
            <p class="explorer-empty-title">No player data available</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Map Stats Panel (Overlay) -->
    <div v-if="isMapStatsPanelOpen && playerStats?.servers" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4" @click="closeServerMapStats" @keydown.esc="closeServerMapStats" tabindex="-1">
      <div class="w-full max-w-5xl h-full sm:h-auto sm:max-h-[90vh] overflow-hidden flex flex-col bg-[var(--bg-panel)] border-x-0 sm:border border-[var(--border-color)] rounded-none sm:rounded-lg shadow-2xl" @click.stop>
        <!-- Header -->
        <div class="p-3 sm:p-4 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--bg-panel)] sticky top-0 z-10">
          <div class="flex-1 min-w-0 mr-4">
            <h2 class="text-base sm:text-lg font-bold text-neon-cyan font-mono truncate">
              {{ rankingsMapName ? `RANKINGS: ${rankingsMapName}` : 'MAP RANKINGS' }}
            </h2>
            <p class="text-[10px] sm:text-xs text-neutral-400 font-mono mt-1 truncate">
              {{ selectedServerName || 'SELECTED SERVER' }}
            </p>
          </div>
          <button class="explorer-btn explorer-btn--ghost explorer-btn--sm flex-shrink-0" aria-label="Close map rankings panel" @click="closeServerMapStats">CLOSE</button>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto">
          <div v-if="rankingsMapName" class="p-3 sm:p-4">
            <button
              class="explorer-btn explorer-btn--ghost explorer-btn--sm mb-4 flex items-center gap-2"
              @click="closeRankingsPanel"
            >
              &larr; BACK TO MAP STATS
            </button>
            <MapRankingsPanel
              :map-name="rankingsMapName"
              :server-guid="rankingsServerGuid ?? undefined"
              :highlight-player="playerName"
              :game="(effectiveServerGuid ? playerStats?.servers?.find(s => s.serverGuid === effectiveServerGuid)?.gameId as any : undefined) || 'bf1942'"
            />
          </div>
          <PlayerServerMapStats
            v-else
            :player-name="playerName"
            :server-guid="effectiveServerGuid"
            :game="(effectiveServerGuid ? playerStats?.servers?.find(s => s.serverGuid === effectiveServerGuid)?.gameId as any : undefined) || 'bf1942'"
            @open-rankings="openRankingsPanel"
            @open-map-detail="openPlayerServerMapDetail"
            @close="closeServerMapStats"
          />
        </div>
      </div>
    </div>

    <!-- Map Detail Panel (Overlay from Data Explorer Breakdown) -->
    <div v-if="selectedMapDetailName" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4" @click="closeMapDetail" @keydown.esc="closeMapDetail" tabindex="-1">
      <div class="w-full max-w-5xl h-full sm:h-auto sm:max-h-[90vh] overflow-hidden flex flex-col bg-[var(--bg-panel)] border-x-0 sm:border border-[var(--border-color)] rounded-none sm:rounded-lg shadow-2xl" @click.stop>
        <!-- Header -->
        <div class="p-3 sm:p-4 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--bg-panel)] sticky top-0 z-10">
          <div class="flex-1 min-w-0 mr-4">
            <h2 class="text-base sm:text-lg font-bold text-neon-cyan font-mono truncate">
              MAP DETAILS
            </h2>
            <p class="text-[10px] sm:text-xs text-neutral-400 font-mono mt-1 truncate">
              {{ selectedMapDetailName }}
            </p>
          </div>
          <button class="explorer-btn explorer-btn--ghost explorer-btn--sm flex-shrink-0" aria-label="Close map detail panel" @click="closeMapDetail">CLOSE</button>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto bg-[var(--bg-panel)]">
          <PlayerMapDetailPanel 
            :map-name="selectedMapDetailName"
            :player-name="playerName"
            :game="playerPanelGame"
            @navigate-to-server="openServerMapDetail"
            @close="closeMapDetail"
          />
        </div>
      </div>
    </div>

    <!-- Server Map Detail Panel (Overlay from Map Detail Panel) -->
    <div v-if="selectedServerMapDetail" class="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4" @click="closeServerMapDetail" @keydown.esc="closeServerMapDetail" tabindex="-1">
      <div class="w-full max-w-5xl h-full sm:h-auto sm:max-h-[90vh] overflow-hidden flex flex-col bg-[var(--bg-panel)] border-x-0 sm:border border-[var(--border-color)] rounded-none sm:rounded-lg shadow-2xl" @click.stop>
        <!-- Header -->
        <div class="p-3 sm:p-4 border-b border-[var(--border-color)] flex justify-between items-center bg-[var(--bg-panel)] sticky top-0 z-10">
          <div class="flex-1 min-w-0 mr-4">
            <h2 class="text-base sm:text-lg font-bold text-neon-cyan font-mono truncate">
              SERVER MAP DETAILS
            </h2>
            <p class="text-[10px] sm:text-xs text-neutral-400 font-mono mt-1 truncate">
              {{ selectedServerMapDetail.mapName }}
            </p>
          </div>
          <button class="explorer-btn explorer-btn--ghost explorer-btn--sm flex-shrink-0" aria-label="Close server map detail panel" @click="closeServerMapDetail">CLOSE</button>
        </div>

        <!-- Content -->
        <div class="flex-1 overflow-y-auto p-0 bg-[var(--bg-panel)]">
          <ServerMapDetailPanel
            :server-guid="selectedServerMapDetail.serverGuid"
            :map-name="selectedServerMapDetail.mapName"
            :player-name="playerName"
            @close="closeServerMapDetail"
          />
        </div>
      </div>
    </div>

  </div>
</template>

<style src="./portal-layout.css"></style>
<style scoped src="./DataExplorer.vue.css"></style>

<style scoped>
/* ============ PLAYER HERO / COMMAND DOSSIER ============ */
.player-hero {
  position: relative;
  background:
    linear-gradient(135deg, rgba(245, 158, 11, 0.04) 0%, rgba(168, 85, 247, 0.04) 100%),
    var(--bg-panel, #0d1117);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 10px;
  overflow: hidden;
  isolation: isolate;
}

.player-hero::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(245, 158, 11, 0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(245, 158, 11, 0.04) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: radial-gradient(ellipse at top left, black 0%, transparent 65%);
  -webkit-mask-image: radial-gradient(ellipse at top left, black 0%, transparent 65%);
  pointer-events: none;
  z-index: 0;
}

.player-hero--active::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--neon-green, #34d399), transparent);
  animation: hero-scan 4s ease-in-out infinite;
  z-index: 0;
  pointer-events: none;
}

@keyframes hero-scan {
  0%, 100% { opacity: 0.2; transform: translateX(-30%); }
  50% { opacity: 0.8; transform: translateX(30%); }
}

/* Corner brackets */
.hero-corner {
  position: absolute;
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--neon-cyan, #F59E0B);
  opacity: 0.55;
  pointer-events: none;
  z-index: 1;
}
.hero-corner--tl { top: 8px; left: 8px; border-right: none; border-bottom: none; }
.hero-corner--tr { top: 8px; right: 8px; border-left: none; border-bottom: none; }
.hero-corner--bl { bottom: 8px; left: 8px; border-right: none; border-top: none; }
.hero-corner--br { bottom: 8px; right: 8px; border-left: none; border-top: none; }

.hero-body {
  position: relative;
  z-index: 2;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
@media (min-width: 640px) {
  .hero-body { padding: 1.25rem 1.5rem; gap: 1.25rem; }
}

/* Identity row */
.hero-identity {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
}

.hero-avatar {
  position: relative;
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 50%;
  background:
    radial-gradient(circle at 30% 30%, rgba(245, 158, 11, 0.18), transparent 60%),
    var(--bg-card, #161b22);
  border: 1px solid var(--border-color, #30363d);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
}
@media (min-width: 640px) {
  .hero-avatar { width: 3.75rem; height: 3.75rem; }
}

.hero-avatar-initial {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 1.5rem;
  color: var(--neon-cyan, #F59E0B);
  text-shadow: 0 0 14px rgba(245, 158, 11, 0.5);
}

.hero-avatar-ring {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 1px dashed rgba(245, 158, 11, 0.35);
  opacity: 0.6;
}

.hero-avatar--active {
  border-color: rgba(52, 211, 153, 0.45);
  box-shadow: 0 0 18px rgba(52, 211, 153, 0.25);
}
.hero-avatar--active .hero-avatar-ring {
  border-color: rgba(52, 211, 153, 0.45);
  animation: hero-avatar-spin 14s linear infinite;
}

@keyframes hero-avatar-spin {
  to { transform: rotate(360deg); }
}

.hero-status-dot {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 50%;
  border: 2px solid var(--bg-panel, #0d1117);
}
.hero-status-dot--on {
  background: var(--neon-green, #34d399);
  box-shadow: 0 0 12px rgba(52, 211, 153, 0.7);
  animation: hero-dot-pulse 2s ease-in-out infinite;
}
.hero-status-dot--off { background: #525252; }

@keyframes hero-dot-pulse {
  0%, 100% { box-shadow: 0 0 8px rgba(52, 211, 153, 0.5); }
  50% { box-shadow: 0 0 18px rgba(52, 211, 153, 0.9); }
}

.hero-tooltip {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--bg-card, #161b22);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 4px;
  padding: 0.5rem 0.75rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  color: var(--text-primary, #e6edf3);
  white-space: nowrap;
  z-index: 50;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
}

.hero-identity-text {
  flex: 1 1 240px;
  min-width: 0;
}

.hero-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  color: var(--text-secondary, #8b949e);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  margin-bottom: 0.375rem;
}
.hero-eyebrow-sep { opacity: 0.5; }

.hero-eyebrow-pulse {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  flex-shrink: 0;
}
.hero-eyebrow-pulse--on {
  background: var(--neon-green, #34d399);
  box-shadow: 0 0 8px var(--neon-green, #34d399);
  animation: hero-dot-pulse 2s ease-in-out infinite;
}
.hero-eyebrow-pulse--off { background: #525252; }

.hero-name {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.5rem;
  line-height: 1.1;
  font-weight: 700;
  color: var(--neon-cyan, #F59E0B);
  text-shadow: 0 0 20px rgba(245, 158, 11, 0.35);
  letter-spacing: -0.01em;
  word-break: break-word;
  margin: 0;
}
@media (min-width: 640px) { .hero-name { font-size: 2rem; } }
@media (min-width: 1024px) { .hero-name { font-size: 2.25rem; } }

.hero-badges-inline { margin-top: 0.5rem; display: flex; flex-wrap: wrap; gap: 0.375rem; }

.hero-actions {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.hero-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}
.hero-action-icon { width: 0.85rem; height: 0.85rem; }

/* KPI Grid */
.hero-kpi-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}
@media (min-width: 640px) {
  .hero-kpi-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.75rem; }
}

.hero-kpi {
  position: relative;
  padding: 0.75rem 0.875rem;
  background: rgba(22, 27, 34, 0.6);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
  transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
  overflow: hidden;
}
.hero-kpi::before {
  content: '';
  position: absolute;
  top: 0; left: 0;
  width: 3px; height: 100%;
  background: var(--neon-cyan, #F59E0B);
  opacity: 0.35;
}
.hero-kpi:hover {
  border-color: rgba(245, 158, 11, 0.35);
  transform: translateY(-1px);
  box-shadow: 0 4px 20px rgba(245, 158, 11, 0.08);
}

.hero-kpi-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-secondary, #8b949e);
}

.hero-kpi-value {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 1.375rem;
  line-height: 1.1;
  margin-top: 0.25rem;
  letter-spacing: -0.02em;
}
@media (min-width: 640px) { .hero-kpi-value { font-size: 1.625rem; } }

.hero-kpi-value--cyan { color: var(--neon-cyan, #F59E0B); text-shadow: 0 0 14px rgba(245, 158, 11, 0.4); }
.hero-kpi-value--green { color: var(--neon-green, #34d399); text-shadow: 0 0 14px rgba(52, 211, 153, 0.4); }
.hero-kpi-value--gold { color: var(--neon-gold, #fbbf24); text-shadow: 0 0 14px rgba(251, 191, 36, 0.4); }
.hero-kpi-value--pink { color: var(--neon-pink, #fb7185); text-shadow: 0 0 14px rgba(251, 113, 133, 0.4); }

.hero-kpi-foot {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  color: var(--text-secondary, #8b949e);
  opacity: 0.7;
  margin-top: 0.25rem;
}

/* Rankings strip */
.hero-ranks-strip {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-color, #30363d);
}
@media (min-width: 768px) {
  .hero-ranks-strip { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.75rem; }
}

.hero-rank-chip {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem 0.75rem;
  background: rgba(22, 27, 34, 0.45);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
}

.hero-rank-icon { width: 1.25rem; height: 1.25rem; flex-shrink: 0; }

.hero-rank-chip-body { min-width: 0; }

.hero-rank-num {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 1.125rem;
  line-height: 1;
}

.hero-rank-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.575rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-secondary, #8b949e);
  margin-top: 0.125rem;
}

.hero-rank-chip--best {
  grid-column: span 2;
  display: block;
}
@media (min-width: 768px) {
  .hero-rank-chip--best { grid-column: span 1; }
}

.hero-rank-best-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-top: 0.125rem;
}
.hero-rank-best-num {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 1.25rem;
  line-height: 1;
}
.hero-rank-best-server {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  color: var(--text-secondary, #8b949e);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

/* ============ TABS ============ */
.hero-tabs {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.25rem;
  overflow-x: auto;
  scrollbar-width: none;
  margin: 1.25rem 0;
  padding-bottom: 1px;
  border-bottom: 1px solid var(--border-color, #30363d);
  position: relative;
}
.hero-tabs::-webkit-scrollbar { display: none; }

.hero-tab {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1.125rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-secondary, #8b949e);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.2s;
  white-space: nowrap;
}
.hero-tab:hover { color: var(--text-primary, #e6edf3); }

.hero-tab-icon {
  width: 0.875rem;
  height: 0.875rem;
  opacity: 0.75;
  transition: opacity 0.2s, transform 0.2s;
}
.hero-tab:hover .hero-tab-icon { opacity: 1; }

.hero-tab-underline {
  position: absolute;
  left: 1rem;
  right: 1rem;
  bottom: -1px;
  height: 2px;
  background: var(--neon-cyan, #F59E0B);
  transform: scaleX(0);
  transform-origin: center;
  transition: transform 0.25s ease;
  box-shadow: 0 0 10px rgba(245, 158, 11, 0.6);
}

.hero-tab--active {
  color: var(--neon-cyan, #F59E0B);
  text-shadow: 0 0 10px rgba(245, 158, 11, 0.35);
}
.hero-tab--active .hero-tab-icon { opacity: 1; transform: scale(1.05); }
.hero-tab--active .hero-tab-underline { transform: scaleX(1); }

/* ============ PERFORMANCE TRENDS ============ */
.trend-block {
  position: relative;
  padding: 0.875rem;
  background: rgba(22, 27, 34, 0.4);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
}

.trend-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
}

.trend-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-weight: 600;
}

.trend-current {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
}
.trend-current-value {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 1.5rem;
  line-height: 1;
  letter-spacing: -0.02em;
}
.trend-current-unit {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  color: var(--text-secondary, #8b949e);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.trend-delta {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.15rem 0.45rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  font-weight: 600;
  border-radius: 4px;
  margin-left: 0.25rem;
}
.trend-delta-arrow { font-size: 0.6rem; line-height: 1; }

.trend-delta--up {
  background: rgba(52, 211, 153, 0.15);
  color: var(--neon-green, #34d399);
  border: 1px solid rgba(52, 211, 153, 0.3);
}
.trend-delta--down {
  background: rgba(248, 113, 113, 0.15);
  color: var(--neon-red, #f87171);
  border: 1px solid rgba(248, 113, 113, 0.3);
}
.trend-delta--flat {
  background: rgba(139, 148, 158, 0.12);
  color: var(--text-secondary, #8b949e);
  border: 1px solid var(--border-color, #30363d);
}

/* ============ BEST SCORES PODIUM ============ */
.best-score-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 0.75rem;
  cursor: pointer;
  transition: background 0.2s;
}
@media (min-width: 640px) {
  .best-score-row { padding: 0.75rem 1rem; gap: 0.75rem; }
}
.best-score-row:hover { background: rgba(255, 255, 255, 0.04); }

.best-score-row--gold {
  background: linear-gradient(90deg, rgba(251, 191, 36, 0.09), transparent 55%);
  border-left: 3px solid rgba(251, 191, 36, 0.6);
  padding-left: calc(0.75rem - 3px);
}
.best-score-row--silver {
  background: linear-gradient(90deg, rgba(203, 213, 225, 0.06), transparent 55%);
  border-left: 3px solid rgba(203, 213, 225, 0.45);
  padding-left: calc(0.75rem - 3px);
}
.best-score-row--bronze {
  background: linear-gradient(90deg, rgba(251, 146, 60, 0.06), transparent 55%);
  border-left: 3px solid rgba(251, 146, 60, 0.45);
  padding-left: calc(0.75rem - 3px);
}

.best-score-medal {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 6px;
  background: var(--bg-panel, #0d1117);
  border: 1px solid var(--border-color, #30363d);
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 0.75rem;
  color: var(--text-secondary, #8b949e);
  flex-shrink: 0;
}
.best-score-medal-icon {
  position: absolute;
  width: 1.1rem;
  height: 1.1rem;
  opacity: 0.35;
}
.best-score-medal-num { position: relative; z-index: 1; }

.best-score-medal--gold {
  background: linear-gradient(135deg, rgba(251, 191, 36, 0.25), rgba(251, 191, 36, 0.05));
  border-color: rgba(251, 191, 36, 0.55);
  color: var(--neon-gold, #fbbf24);
  box-shadow: 0 0 12px rgba(251, 191, 36, 0.25), inset 0 0 10px rgba(251, 191, 36, 0.1);
}
.best-score-medal--gold .best-score-medal-icon { opacity: 0.55; color: var(--neon-gold, #fbbf24); }

.best-score-medal--silver {
  background: linear-gradient(135deg, rgba(203, 213, 225, 0.22), rgba(203, 213, 225, 0.04));
  border-color: rgba(203, 213, 225, 0.4);
  color: #e5e7eb;
  box-shadow: 0 0 10px rgba(203, 213, 225, 0.15), inset 0 0 8px rgba(203, 213, 225, 0.08);
}
.best-score-medal--silver .best-score-medal-icon { opacity: 0.45; color: #e5e7eb; }

.best-score-medal--bronze {
  background: linear-gradient(135deg, rgba(251, 146, 60, 0.22), rgba(251, 146, 60, 0.04));
  border-color: rgba(251, 146, 60, 0.4);
  color: #fb923c;
  box-shadow: 0 0 10px rgba(251, 146, 60, 0.15), inset 0 0 8px rgba(251, 146, 60, 0.08);
}
.best-score-medal--bronze .best-score-medal-icon { opacity: 0.45; color: #fb923c; }

.best-score-value {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
}
.best-score-pts {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 0.95rem;
  color: var(--neon-cyan, #F59E0B);
  letter-spacing: -0.01em;
}
.best-score-row--gold .best-score-pts { color: var(--neon-gold, #fbbf24); text-shadow: 0 0 10px rgba(251, 191, 36, 0.45); }
.best-score-unit {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  color: var(--text-secondary, #8b949e);
  letter-spacing: 0.08em;
}
.best-score-meta {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6875rem;
  color: var(--text-secondary, #8b949e);
  margin-top: 0.15rem;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.best-score-map { color: var(--text-primary, #e6edf3); opacity: 0.85; }
.best-score-sep { opacity: 0.5; }

.best-score-aside {
  text-align: right;
  flex-shrink: 0;
}
.best-score-kd {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: var(--neon-green, #34d399);
  font-weight: 600;
}
.best-score-time {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  color: var(--text-secondary, #8b949e);
  margin-top: 0.1rem;
}

/* ============ SERVER RANKINGS LIST ============ */
.server-rank-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  cursor: pointer;
  transition: background 0.2s;
  border-left: 2px solid transparent;
}
.server-rank-row:hover { background: rgba(255, 255, 255, 0.04); }

.server-rank-row--r1 {
  background: linear-gradient(90deg, rgba(251, 191, 36, 0.07), transparent 60%);
  border-left-color: rgba(251, 191, 36, 0.55);
}
.server-rank-row--r2 {
  background: linear-gradient(90deg, rgba(203, 213, 225, 0.05), transparent 60%);
  border-left-color: rgba(203, 213, 225, 0.35);
}
.server-rank-row--r3 {
  background: linear-gradient(90deg, rgba(251, 146, 60, 0.05), transparent 60%);
  border-left-color: rgba(251, 146, 60, 0.35);
}

.server-rank-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 2.5rem;
  padding: 0.25rem 0.4rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  flex-shrink: 0;
}

.server-rank-bar {
  margin-top: 0.375rem;
  height: 3px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 2px;
  overflow: hidden;
}
.server-rank-bar-fill {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, rgba(245, 158, 11, 0.55), rgba(168, 85, 247, 0.55));
  transition: width 0.4s ease;
}

.server-rank-arrow {
  color: var(--text-secondary, #8b949e);
  opacity: 0.4;
  transition: color 0.2s, opacity 0.2s, transform 0.2s;
  flex-shrink: 0;
}
.server-rank-row:hover .server-rank-arrow {
  opacity: 1;
  color: var(--neon-cyan, #F59E0B);
  transform: translateX(2px);
}

/* ============ LOADING TERMINAL ============ */
.loading-terminal {
  display: flex;
  justify-content: center;
  padding: 2rem 1rem 3rem;
}

.loading-terminal-frame {
  width: 100%;
  max-width: 28rem;
  background: var(--bg-panel, #0d1117);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.35), 0 0 20px rgba(245, 158, 11, 0.08);
}

.loading-terminal-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: rgba(22, 27, 34, 0.8);
  border-bottom: 1px solid var(--border-color, #30363d);
}
.loading-terminal-dots {
  display: flex;
  gap: 0.375rem;
}
.loading-dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  display: block;
}
.loading-dot--red { background: #f87171; }
.loading-dot--amber { background: #fbbf24; }
.loading-dot--green { background: #34d399; }

.loading-terminal-body {
  padding: 1rem 1.25rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  color: var(--text-primary, #e6edf3);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.terminal-line {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  opacity: 0;
  animation: terminal-appear 0.35s forwards;
}
.terminal-line:nth-child(1) { animation-delay: 0.05s; }
.terminal-line:nth-child(2) { animation-delay: 0.3s; }
.terminal-line:nth-child(3) { animation-delay: 0.55s; }
.terminal-line:nth-child(4) { animation-delay: 0.8s; }
.terminal-line:nth-child(5) { animation-delay: 1.05s; }

@keyframes terminal-appear {
  from { opacity: 0; transform: translateX(-4px); }
  to { opacity: 1; transform: translateX(0); }
}

.terminal-line--muted { color: var(--text-secondary, #8b949e); }

.terminal-prompt {
  color: var(--neon-green, #34d399);
  font-weight: 700;
}
.terminal-prompt--cyan { color: var(--neon-cyan, #F59E0B); }

.terminal-dots::after {
  content: '';
  display: inline-block;
  animation: terminal-dots 1.4s steps(4, end) infinite;
}
@keyframes terminal-dots {
  0% { content: ''; }
  25% { content: '.'; }
  50% { content: '..'; }
  75% { content: '...'; }
  100% { content: ''; }
}

.terminal-cursor {
  display: inline-block;
  width: 0.5rem;
  animation: terminal-blink 1s steps(2) infinite;
  color: var(--neon-cyan, #F59E0B);
}
@keyframes terminal-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* ============ SECTION DIVIDER ============ */
.section-divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0.25rem 0 -0.25rem;
  padding: 0.125rem 0;
}

.section-num {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 0.65rem;
  color: var(--neon-cyan, #F59E0B);
  padding: 0.2rem 0.45rem;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 4px;
  letter-spacing: 0.14em;
  flex-shrink: 0;
  text-shadow: 0 0 6px rgba(245, 158, 11, 0.3);
}

.section-head { flex-shrink: 0; min-width: 0; }

.section-title {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 0.8rem;
  color: var(--text-primary, #e6edf3);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  line-height: 1.1;
}

.section-sub {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.6rem;
  color: var(--text-secondary, #8b949e);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-top: 0.15rem;
}

.section-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, rgba(245, 158, 11, 0.35), transparent 75%);
  min-width: 1.5rem;
}

.section-link {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--neon-cyan, #F59E0B);
  padding: 0.3rem 0.55rem;
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 4px;
  flex-shrink: 0;
  transition: all 0.2s;
}
.section-link:hover {
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.55);
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.2);
}

/* ============ COMBAT BANNER ============ */
.combat-banner {
  position: relative;
  padding: 1rem 1.25rem;
  background:
    linear-gradient(135deg, rgba(52, 211, 153, 0.04) 0%, rgba(245, 158, 11, 0.04) 100%),
    var(--bg-panel, #0d1117);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 8px;
  overflow: hidden;
}
.combat-banner::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(90deg, rgba(52, 211, 153, 0.04) 0, rgba(52, 211, 153, 0.04) 1px, transparent 1px, transparent 6px);
  mask-image: linear-gradient(180deg, transparent, black 30%, black 70%, transparent);
  -webkit-mask-image: linear-gradient(180deg, transparent, black 30%, black 70%, transparent);
  pointer-events: none;
  opacity: 0.5;
}

.combat-banner-eyebrow {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--text-secondary, #8b949e);
  margin-bottom: 0.75rem;
}

.combat-banner-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--neon-green, #34d399);
  box-shadow: 0 0 10px var(--neon-green, #34d399);
  animation: hero-dot-pulse 2s ease-in-out infinite;
  flex-shrink: 0;
}

.combat-banner-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
}
@media (min-width: 640px) {
  .combat-banner-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1rem; }
}

.combat-banner-stat {
  padding: 0.5rem 0.75rem;
  border-left: 2px solid var(--border-color, #30363d);
}

.combat-banner-value {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 1.25rem;
  line-height: 1.1;
  letter-spacing: -0.02em;
}
@media (min-width: 640px) { .combat-banner-value { font-size: 1.5rem; } }

.combat-banner-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-secondary, #8b949e);
  margin-top: 0.2rem;
}

/* ============ RANKINGS BANNER ============ */
.rankings-banner {
  position: relative;
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
  padding: 1.25rem;
  background:
    radial-gradient(ellipse at top right, rgba(251, 191, 36, 0.06), transparent 60%),
    var(--bg-panel, #0d1117);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 8px;
  overflow: hidden;
}
@media (min-width: 768px) {
  .rankings-banner { grid-template-columns: 1fr auto; align-items: center; gap: 1.5rem; }
}

.rankings-banner-eyebrow {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--text-secondary, #8b949e);
  margin-bottom: 0.5rem;
}

.rankings-banner-rank-row {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.rankings-banner-rank {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 2.5rem;
  line-height: 1;
  letter-spacing: -0.03em;
  text-shadow: 0 0 20px currentColor;
}
@media (min-width: 640px) { .rankings-banner-rank { font-size: 3rem; } }

.rankings-banner-on {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: var(--text-secondary, #8b949e);
  text-transform: uppercase;
}

.rankings-banner-server {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text-primary, #e6edf3);
}

.rankings-banner-context {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  color: var(--text-secondary, #8b949e);
  margin-top: 0.6rem;
  line-height: 1.5;
}

.rankings-banner-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}
@media (min-width: 768px) {
  .rankings-banner-grid { gap: 0.75rem; }
}

.rankings-banner-cell {
  padding: 0.5rem 0.75rem;
  text-align: center;
  background: rgba(22, 27, 34, 0.55);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
  min-width: 4.5rem;
}

.rankings-banner-value {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 1.4rem;
  line-height: 1;
  letter-spacing: -0.02em;
}

.rankings-banner-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.55rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-secondary, #8b949e);
  margin-top: 0.3rem;
}

/* ============ NETWORK BANNER ============ */
.network-banner {
  position: relative;
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
  padding: 1.25rem;
  background:
    radial-gradient(ellipse at bottom right, rgba(168, 85, 247, 0.08), transparent 60%),
    radial-gradient(ellipse at top left, rgba(245, 158, 11, 0.05), transparent 60%),
    var(--bg-panel, #0d1117);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 8px;
  overflow: hidden;
}
@media (min-width: 768px) {
  .network-banner { grid-template-columns: 1fr auto; align-items: center; gap: 1.5rem; }
}
.network-banner::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(circle at 20% 30%, rgba(245, 158, 11, 0.12) 1px, transparent 1.5px),
    radial-gradient(circle at 80% 70%, rgba(168, 85, 247, 0.12) 1px, transparent 1.5px),
    radial-gradient(circle at 60% 20%, rgba(52, 211, 153, 0.12) 1px, transparent 1.5px);
  background-size: 60px 60px, 80px 80px, 100px 100px;
  opacity: 0.5;
  pointer-events: none;
}

.network-banner-main { position: relative; z-index: 1; }

.network-banner-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--text-secondary, #8b949e);
  margin-bottom: 0.5rem;
}

.network-banner-live {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--neon-cyan, #F59E0B);
  box-shadow: 0 0 10px var(--neon-cyan, #F59E0B);
  animation: hero-dot-pulse 2s ease-in-out infinite;
  flex-shrink: 0;
}

.network-banner-title {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 1.5rem;
  color: var(--text-primary, #e6edf3);
  letter-spacing: -0.01em;
  margin: 0;
  line-height: 1.2;
}
@media (min-width: 640px) { .network-banner-title { font-size: 1.875rem; } }

.network-banner-sub {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.75rem;
  color: var(--text-secondary, #8b949e);
  line-height: 1.6;
  margin-top: 0.5rem;
  max-width: 48ch;
}

.network-banner-side {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 220px;
}

.network-banner-metric {
  padding: 0.6rem 0.85rem;
  background: rgba(22, 27, 34, 0.7);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 6px;
}

.network-banner-metric-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.55rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--text-secondary, #8b949e);
}

.network-banner-metric-value {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 600;
  font-size: 0.85rem;
  margin-top: 0.2rem;
  word-break: break-word;
}

.network-banner-filter { display: flex; flex-direction: column; gap: 0.25rem; }
.network-banner-filter-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.55rem;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--text-secondary, #8b949e);
}
.network-banner-select { width: 100%; min-width: 100%; }

.network-cta {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  background:
    linear-gradient(90deg, rgba(168, 85, 247, 0.08), rgba(245, 158, 11, 0.05));
  border: 1px solid var(--border-color, #30363d);
  border-radius: 8px;
}
@media (min-width: 640px) {
  .network-cta { flex-direction: row; align-items: center; justify-content: space-between; }
}

.network-cta-title {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 0.85rem;
  color: var(--text-primary, #e6edf3);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.network-cta-desc {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  color: var(--text-secondary, #8b949e);
  margin-top: 0.25rem;
}

.network-cta-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.6rem 1.5rem;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 0.75rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--bg-dark, #0a0a0f);
  background: linear-gradient(90deg, var(--neon-cyan, #F59E0B), #fbbf24);
  border: none;
  border-radius: 6px;
  white-space: nowrap;
  transition: all 0.2s;
  box-shadow: 0 0 20px rgba(245, 158, 11, 0.25);
}
.network-cta-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 30px rgba(245, 158, 11, 0.5);
}

/* ============ TROPHY BANNER ============ */
.trophy-banner {
  position: relative;
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
  padding: 1.25rem;
  background:
    radial-gradient(ellipse at top left, rgba(251, 191, 36, 0.08), transparent 50%),
    var(--bg-panel, #0d1117);
  border: 1px solid var(--border-color, #30363d);
  border-radius: 8px;
  overflow: hidden;
}
@media (min-width: 768px) {
  .trophy-banner { grid-template-columns: 1fr auto; align-items: center; gap: 1.5rem; }
}

.trophy-banner-glow {
  position: absolute;
  inset: -50% -20% auto auto;
  width: 60%;
  height: 200%;
  background: radial-gradient(ellipse, rgba(251, 191, 36, 0.15), transparent 60%);
  pointer-events: none;
  filter: blur(20px);
}

.trophy-banner-left { position: relative; z-index: 1; min-width: 0; }

.trophy-banner-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--neon-gold, #fbbf24);
  padding: 0.25rem 0.5rem;
  border: 1px solid rgba(251, 191, 36, 0.3);
  border-radius: 4px;
  background: rgba(251, 191, 36, 0.05);
  margin-bottom: 0.75rem;
}

.trophy-banner-title {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 1.75rem;
  color: var(--text-primary, #e6edf3);
  margin: 0;
  letter-spacing: -0.02em;
  line-height: 1.1;
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
}
@media (min-width: 640px) { .trophy-banner-title { font-size: 2.25rem; } }

.trophy-banner-unit {
  font-weight: 500;
  font-size: 0.9rem;
  color: var(--text-secondary, #8b949e);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.trophy-banner-latest {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  margin-top: 0.75rem;
}

.trophy-banner-tier {
  font-size: 0.55rem;
  font-weight: 700;
  padding: 0.15rem 0.4rem;
  border-radius: 3px;
  letter-spacing: 0.12em;
  border: 1px solid;
}

.trophy-tier-legend { color: #a855f7; border-color: rgba(168, 85, 247, 0.5); background: rgba(168, 85, 247, 0.1); }
.trophy-tier-gold { color: var(--neon-gold, #fbbf24); border-color: rgba(251, 191, 36, 0.5); background: rgba(251, 191, 36, 0.1); }
.trophy-tier-silver { color: #e5e7eb; border-color: rgba(229, 231, 235, 0.35); background: rgba(229, 231, 235, 0.08); }
.trophy-tier-bronze { color: #fb923c; border-color: rgba(251, 146, 60, 0.45); background: rgba(251, 146, 60, 0.1); }

.trophy-banner-tiers {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.5rem;
}
@media (min-width: 768px) { .trophy-banner-tiers { gap: 0.625rem; } }

.trophy-tier-cell {
  padding: 0.5rem 0.75rem;
  text-align: center;
  border-radius: 6px;
  border: 1px solid;
  background: rgba(22, 27, 34, 0.6);
  min-width: 3.75rem;
}

.trophy-tier-cell--legend { border-color: rgba(168, 85, 247, 0.4); box-shadow: 0 0 12px rgba(168, 85, 247, 0.1); }
.trophy-tier-cell--gold { border-color: rgba(251, 191, 36, 0.45); box-shadow: 0 0 12px rgba(251, 191, 36, 0.1); }
.trophy-tier-cell--silver { border-color: rgba(229, 231, 235, 0.25); }
.trophy-tier-cell--bronze { border-color: rgba(251, 146, 60, 0.35); }

.trophy-tier-count {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: 1.35rem;
  line-height: 1;
  letter-spacing: -0.02em;
}
.trophy-tier-cell--legend .trophy-tier-count { color: #a855f7; text-shadow: 0 0 10px rgba(168, 85, 247, 0.4); }
.trophy-tier-cell--gold .trophy-tier-count { color: var(--neon-gold, #fbbf24); text-shadow: 0 0 10px rgba(251, 191, 36, 0.4); }
.trophy-tier-cell--silver .trophy-tier-count { color: #e5e7eb; }
.trophy-tier-cell--bronze .trophy-tier-count { color: #fb923c; text-shadow: 0 0 10px rgba(251, 146, 60, 0.3); }

.trophy-tier-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.55rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-secondary, #8b949e);
  margin-top: 0.3rem;
}

/* Reduced motion */
@media (prefers-reduced-motion: reduce) {
  .hero-avatar-ring,
  .hero-status-dot--on,
  .hero-eyebrow-pulse--on,
  .combat-banner-dot,
  .network-banner-live,
  .terminal-line,
  .terminal-cursor,
  .terminal-dots::after,
  .player-hero--active::after {
    animation: none !important;
  }
}
</style>
