<script setup lang="ts">
import { ref, computed, onMounted, watch, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { fetchSessions, PlayerContextInfo } from '../services/playerStatsService';
import HeroBackButton from './HeroBackButton.vue';
import { formatPlayTime, formatRelativeTimeShort as formatRelativeTime } from '@/utils/timeUtils';
import { calculateKDR, getKDRColor, getTeamColor, getMapAccentColor } from '@/utils/statsUtils';
import { Line, Bar } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

// Router
const router = useRouter();

// Props from router
interface Props {
  playerName?: string;
  serverName?: string;
  mapName?: string;
}

const props = defineProps<Props>();

// Session data types
interface TopPlayer {
  sessionId: number;
  roundId: string;
  playerName: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  score: number;
  kills: number;
  deaths: number;
  isActive: boolean;
}

interface RoundData {
  roundId: string;
  serverName: string;
  serverGuid: string;
  mapName: string;
  gameType: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  participantCount: number;
  totalSessions: number;
  isActive: boolean;
  team1Label?: string;
  team2Label?: string;
  team1Points?: number;
  team2Points?: number;
  roundTimeRemain?: number;
  topPlayers?: TopPlayer[];
}

// State
const rounds = ref<RoundData[]>([]);
const playerInfo = ref<PlayerContextInfo | null>(null);
const playerStatsData = ref<Record<string, TopPlayer>>({});
const loading = ref(true);
const error = ref<string | null>(null);
const currentPage = ref(1);
const pageSize = ref(100);
const totalItems = ref(0);
const totalPages = ref(0);

// Filter state
const showFilters = ref(false);
const filterMinParticipants = ref<number | null>(null);
const filterMapName = ref('');
const filterDateFrom = ref('');
const filterDateTo = ref('');

const hasActiveFilters = computed(() => {
  return (filterMinParticipants.value !== null && filterMinParticipants.value > 0)
    || filterMapName.value.trim() !== ''
    || filterDateFrom.value !== ''
    || filterDateTo.value !== '';
});

const activeFilterCount = computed(() => {
  let count = 0;
  if (filterMinParticipants.value !== null && filterMinParticipants.value > 0) count++;
  if (filterMapName.value.trim()) count++;
  if (filterDateFrom.value || filterDateTo.value) count++;
  return count;
});

const clearFilters = () => {
  filterMinParticipants.value = null;
  filterMapName.value = '';
  filterDateFrom.value = '';
  filterDateTo.value = '';
  currentPage.value = 1;
  fetchData();
};

const applyFilters = () => {
  currentPage.value = 1;
  fetchData();
};

// Show/hide charts
const showCharts = ref(true);

// --- Chart data: Team scores over time (plotted by team identity) ---
const roundsWithScores = computed(() => {
  return [...rounds.value]
    .filter(r => r.team1Points !== undefined && r.team2Points !== undefined && r.team1Label && r.team2Label)
    .reverse(); // chronological order (oldest first)
});

// Get a consistent color for a team label
const getTeamChartColor = (label: string): string => {
  const lbl = label.toLowerCase();
  if (lbl.includes('axis') || lbl.includes('red') || lbl.includes('north') || lbl.includes('nva') || lbl.includes('team 2')) return '#f87171';
  if (lbl.includes('allies') || lbl.includes('allied') || lbl.includes('blue') || lbl.includes('south') || lbl.includes('usa') || lbl.includes('team 1')) return '#60a5fa';
  return '#a78bfa';
};

// Discover the two consistent team labels across rounds
const teamLabels = computed(() => {
  const data = roundsWithScores.value;
  if (data.length === 0) return { team1: '', team2: '' };
  // Use the labels from the first round as the canonical order
  return { team1: data[0].team1Label!, team2: data[0].team2Label! };
});

const scoreLineChartData = computed(() => {
  const data = roundsWithScores.value;
  const { team1, team2 } = teamLabels.value;
  if (!team1 || !team2) return { labels: [], datasets: [] };

  const labels = data.map(r => {
    const d = new Date(r.startTime);
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${r.mapName}`;
  });

  // For each round, map team1/team2 scores consistently
  // If a round has the same labels, use them directly; if swapped, flip
  const team1Scores: (number | null)[] = [];
  const team2Scores: (number | null)[] = [];

  for (const r of data) {
    if (r.team1Label === team1) {
      team1Scores.push(r.team1Points!);
      team2Scores.push(r.team2Points!);
    } else if (r.team2Label === team1) {
      team1Scores.push(r.team2Points!);
      team2Scores.push(r.team1Points!);
    } else {
      // Different teams entirely — plot as team1=team1Label, team2=team2Label
      team1Scores.push(r.team1Points!);
      team2Scores.push(r.team2Points!);
    }
  }

  const color1 = getTeamChartColor(team1);
  const color2 = getTeamChartColor(team2);

  return {
    labels,
    datasets: [
      {
        label: team1,
        data: team1Scores,
        borderColor: color1,
        backgroundColor: color1 + '1a',
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 5,
        tension: 0.3,
        fill: false,
      },
      {
        label: team2,
        data: team2Scores,
        borderColor: color2,
        backgroundColor: color2 + '1a',
        borderWidth: 2,
        pointRadius: 2,
        pointHoverRadius: 5,
        tension: 0.3,
        fill: false,
      },
    ],
  };
});

const scoreLineChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index' as const,
    intersect: false,
  },
  plugins: {
    legend: {
      display: true,
      position: 'top' as const,
      labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12, padding: 16 },
    },
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      titleColor: '#e2e8f0',
      bodyColor: '#94a3b8',
      borderColor: 'rgba(100, 116, 139, 0.3)',
      borderWidth: 1,
      padding: 10,
      callbacks: {
        title: (items: any[]) => {
          const idx = items[0]?.dataIndex;
          if (idx === undefined) return '';
          const r = roundsWithScores.value[idx];
          if (!r) return '';
          return `${r.mapName} — ${r.serverName}`;
        },
        afterTitle: (items: any[]) => {
          const idx = items[0]?.dataIndex;
          if (idx === undefined) return '';
          const r = roundsWithScores.value[idx];
          if (!r) return '';
          const t1 = r.team1Points!;
          const t2 = r.team2Points!;
          const winner = t1 >= t2 ? r.team1Label : r.team2Label;
          const loser = t1 >= t2 ? r.team2Label : r.team1Label;
          return `${winner} beat ${loser}`;
        },
      },
    },
  },
  scales: {
    x: {
      display: false,
    },
    y: {
      ticks: { color: '#64748b', font: { size: 10 } },
      grid: { color: 'rgba(100, 116, 139, 0.15)' },
      title: { display: true, text: 'Tickets', color: '#64748b', font: { size: 10 } },
    },
  },
}));

// --- Chart data: Player placement frequency (1st, 2nd, 3rd) ---
const placementChartData = computed(() => {
  const placements: Record<string, { first: number; second: number; third: number }> = {};

  for (const round of rounds.value) {
    if (!round.topPlayers || round.topPlayers.length === 0) continue;
    const top3 = round.topPlayers.slice(0, 3);
    top3.forEach((player, idx) => {
      if (!placements[player.playerName]) {
        placements[player.playerName] = { first: 0, second: 0, third: 0 };
      }
      if (idx === 0) placements[player.playerName].first++;
      else if (idx === 1) placements[player.playerName].second++;
      else if (idx === 2) placements[player.playerName].third++;
    });
  }

  // Sort by total placements descending, take top 15
  const sorted = Object.entries(placements)
    .map(([name, counts]) => ({ name, ...counts, total: counts.first + counts.second + counts.third }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  return {
    labels: sorted.map(p => p.name),
    datasets: [
      {
        label: '1st',
        data: sorted.map(p => p.first),
        backgroundColor: '#fbbf24',
        borderColor: '#f59e0b',
        borderWidth: 1,
        borderRadius: 2,
      },
      {
        label: '2nd',
        data: sorted.map(p => p.second),
        backgroundColor: '#94a3b8',
        borderColor: '#64748b',
        borderWidth: 1,
        borderRadius: 2,
      },
      {
        label: '3rd',
        data: sorted.map(p => p.third),
        backgroundColor: '#d97706',
        borderColor: '#b45309',
        borderWidth: 1,
        borderRadius: 2,
      },
    ],
  };
});

const placementChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: 'y' as const,
  plugins: {
    legend: {
      display: true,
      position: 'top' as const,
      labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12, padding: 16 },
    },
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      titleColor: '#e2e8f0',
      bodyColor: '#94a3b8',
      borderColor: 'rgba(100, 116, 139, 0.3)',
      borderWidth: 1,
      padding: 10,
    },
  },
  scales: {
    x: {
      stacked: true,
      ticks: { color: '#64748b', font: { size: 10 }, stepSize: 1 },
      grid: { color: 'rgba(100, 116, 139, 0.15)' },
      title: { display: true, text: 'Rounds', color: '#64748b', font: { size: 10 } },
    },
    y: {
      stacked: true,
      ticks: { color: '#e2e8f0', font: { size: 11 } },
      grid: { display: false },
    },
  },
}));

// --- Chart data: Team win counts ---
const teamWinChartData = computed(() => {
  const wins: Record<string, number> = {};

  for (const round of rounds.value) {
    if (round.team1Points === undefined || round.team2Points === undefined) continue;
    if (!round.team1Label || !round.team2Label) continue;
    const winner = round.team1Points >= round.team2Points ? round.team1Label : round.team2Label;
    wins[winner] = (wins[winner] || 0) + 1;
  }

  const sorted = Object.entries(wins).sort((a, b) => b[1] - a[1]);

  // Map team names to colors
  const teamColors: Record<string, string> = {};
  for (const [team] of sorted) {
    const lbl = team.toLowerCase();
    if (lbl.includes('axis') || lbl.includes('red') || lbl.includes('north') || lbl.includes('nva') || lbl.includes('team 2')) {
      teamColors[team] = '#f87171';
    } else if (lbl.includes('allies') || lbl.includes('allied') || lbl.includes('blue') || lbl.includes('south') || lbl.includes('usa') || lbl.includes('team 1')) {
      teamColors[team] = '#60a5fa';
    } else {
      teamColors[team] = '#a78bfa';
    }
  }

  return {
    labels: sorted.map(([team]) => team),
    datasets: [
      {
        label: 'Wins',
        data: sorted.map(([, count]) => count),
        backgroundColor: sorted.map(([team]) => teamColors[team]),
        borderColor: sorted.map(([team]) => teamColors[team]),
        borderWidth: 1,
        borderRadius: 4,
      },
    ],
  };
});

const teamWinChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: 'y' as const,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      titleColor: '#e2e8f0',
      bodyColor: '#94a3b8',
      borderColor: 'rgba(100, 116, 139, 0.3)',
      borderWidth: 1,
      padding: 10,
    },
  },
  scales: {
    x: {
      ticks: { color: '#64748b', font: { size: 10 }, stepSize: 1 },
      grid: { color: 'rgba(100, 116, 139, 0.15)' },
      title: { display: true, text: 'Wins', color: '#64748b', font: { size: 10 } },
    },
    y: {
      ticks: { color: '#e2e8f0', font: { size: 12, weight: 'bold' as const } },
      grid: { display: false },
    },
  },
}));

const navigateToRoundReport = (roundId: string) => {
  router.push({
    name: 'round-report',
    params: {
      roundId: roundId,
    },
  });
};

// --- Player performance worm chart (only in player context) ---
const playerPerformanceRounds = computed(() => {
  if (!props.playerName) return [];
  return [...rounds.value]
    .filter(r => playerStatsData.value[r.roundId])
    .reverse(); // chronological (oldest first)
});

const playerPerformanceChartData = computed(() => {
  const data = playerPerformanceRounds.value;
  if (data.length === 0) return { labels: [], datasets: [] };

  const labels = data.map(r => {
    const d = new Date(r.startTime);
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${r.mapName}`;
  });

  const playerKills = data.map(r => playerStatsData.value[r.roundId]?.kills ?? null);
  const playerKD = data.map(r => {
    const s = playerStatsData.value[r.roundId];
    return s ? parseFloat(calculateKDR(s.kills, s.deaths)) : null;
  });
  const topKills = data.map(r => {
    const top = r.topPlayers?.[0];
    return top ? top.kills : null;
  });

  return {
    labels,
    datasets: [
      {
        label: 'Your Kills',
        data: playerKills,
        borderColor: '#4ade80',
        backgroundColor: 'rgba(74, 222, 128, 0.12)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: '#4ade80',
        pointBorderColor: '#1e293b',
        pointBorderWidth: 1.5,
        yAxisID: 'yKills',
      },
      {
        label: '🥇 Top Kills',
        data: topKills,
        borderColor: '#f97316',
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderDash: [4, 3],
        fill: false,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
        yAxisID: 'yKills',
      },
      {
        label: 'Your K/D',
        data: playerKD,
        borderColor: '#a78bfa',
        backgroundColor: 'rgba(167, 139, 250, 0.08)',
        borderWidth: 2,
        fill: false,
        tension: 0.4,
        pointRadius: 2,
        pointHoverRadius: 5,
        pointBackgroundColor: '#a78bfa',
        pointBorderColor: '#1e293b',
        pointBorderWidth: 1,
        yAxisID: 'yKD',
      },
    ],
  };
});

const playerPerformanceChartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index' as const,
    intersect: false,
  },
  plugins: {
    legend: {
      display: true,
      position: 'top' as const,
      labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12, padding: 14 },
    },
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      titleColor: '#e2e8f0',
      bodyColor: '#94a3b8',
      borderColor: 'rgba(100, 116, 139, 0.3)',
      borderWidth: 1,
      padding: 10,
      callbacks: {
        title: (items: any[]) => {
          const idx = items[0]?.dataIndex;
          if (idx === undefined) return '';
          const r = playerPerformanceRounds.value[idx];
          return r ? `${r.mapName} · ${r.serverName}` : '';
        },
        afterBody: (items: any[]) => {
          const idx = items[0]?.dataIndex;
          if (idx === undefined) return [];
          const r = playerPerformanceRounds.value[idx];
          const s = r ? playerStatsData.value[r.roundId] : null;
          return s ? [`Score: ${s.score}`] : [];
        },
      },
    },
  },
  scales: {
    x: { display: false },
    yKills: {
      type: 'linear' as const,
      position: 'left' as const,
      beginAtZero: true,
      ticks: { color: '#64748b', font: { size: 10 } },
      grid: { color: 'rgba(100, 116, 139, 0.12)' },
      title: { display: true, text: 'Kills', color: '#64748b', font: { size: 10 } },
    },
    yKD: {
      type: 'linear' as const,
      position: 'right' as const,
      beginAtZero: true,
      ticks: { color: '#64748b', font: { size: 10 } },
      grid: { display: false },
      title: { display: true, text: 'K/D', color: '#64748b', font: { size: 10 } },
    },
  },
}));

const playerAggregate = computed(() => {
  const values = Object.values(playerStatsData.value);
  if (values.length === 0) return null;
  const totalKills = values.reduce((s, p) => s + p.kills, 0);
  const totalDeaths = values.reduce((s, p) => s + p.deaths, 0);
  const avgKills = totalKills / values.length;
  const bestKills = Math.max(...values.map(p => p.kills));
  const bestScore = Math.max(...values.map(p => p.score));
  const kd = parseFloat(calculateKDR(totalKills, totalDeaths));
  return { avgKills: avgKills.toFixed(1), bestKills, bestScore, kd: kd.toFixed(2), rounds: values.length };
});

// Fetch data
const fetchData = async () => {
  try {
    loading.value = true;
    error.value = null;

    const filters: Record<string, string> = {};
    if (props.playerName) {
      filters.playerNames = props.playerName;
    }
    if (props.serverName) {
      filters.serverName = props.serverName;
    }
    // Use filter map name if set, otherwise fall back to prop
    const effectiveMapName = filterMapName.value.trim() || props.mapName;
    if (effectiveMapName) {
      filters.mapName = effectiveMapName;
    }
    if (filterMinParticipants.value !== null && filterMinParticipants.value > 0) {
      filters.minParticipants = filterMinParticipants.value.toString();
    }
    if (filterDateFrom.value) {
      filters.startTimeFrom = new Date(filterDateFrom.value).toISOString();
    }
    if (filterDateTo.value) {
      // Set to end of day for the "to" date
      const toDate = new Date(filterDateTo.value);
      toDate.setHours(23, 59, 59, 999);
      filters.startTimeTo = toDate.toISOString();
    }

    const [response, playerResponse] = await Promise.all([
      fetchSessions(currentPage.value, pageSize.value, filters, 'startTime', 'desc', false),
      props.playerName
        ? fetchSessions(currentPage.value, pageSize.value, filters, 'startTime', 'desc', true)
        : Promise.resolve(null),
    ]);

    rounds.value = response.items as unknown as RoundData[];
    playerInfo.value = response.playerInfo || null;
    totalItems.value = response.totalItems;
    totalPages.value = response.totalPages;

    if (playerResponse) {
      const data: Record<string, TopPlayer> = {};
      for (const round of playerResponse.items as unknown as RoundData[]) {
        if (round.topPlayers && round.topPlayers.length > 0) {
          data[round.roundId] = round.topPlayers[0];
        }
      }
      playerStatsData.value = data;
    } else {
      playerStatsData.value = {};
    }
  } catch (err) {
    console.error('Error fetching sessions:', err);
    error.value = 'Failed to load sessions. Please try again.';
  } finally {
    loading.value = false;
  }
};

const goToPage = (page: number) => {
  if (page >= 1 && page <= totalPages.value) {
    currentPage.value = page;
  }
};

onMounted(() => {
  fetchData();
});

watch(() => pageSize.value, () => {
  currentPage.value = 1;
  fetchData();
});

watch(() => currentPage.value, () => {
  fetchData();
});

// Cleanup
onUnmounted(() => {
  // Cleanup if needed
});
</script>

<template>
  <div class="min-h-screen bg-slate-900">
    <!-- Hero Section -->
    <div class="w-full bg-slate-800 border-b border-slate-700">
      <div class="w-full max-w-screen-2xl mx-auto px-4 sm:px-8 lg:px-12 py-6">
        <div class="flex items-center justify-between gap-4">
          <div class="flex-grow">
            <div class="flex items-center gap-3 mb-2">
              <HeroBackButton :on-click="() => router.back()" />
              <h1 class="text-3xl md:text-4xl font-bold text-cyan-400">
                {{ playerInfo ? `${playerInfo.name}'s Sessions` : 'Game Sessions' }}
              </h1>
            </div>
            <p class="text-slate-400 text-sm">
              {{ totalItems }} session{{ totalItems !== 1 ? 's' : '' }} found
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Filters -->
    <div class="w-full max-w-screen-2xl mx-auto px-4 sm:px-8 lg:px-12 pt-4">
      <div class="bg-slate-800/50 border border-slate-700/50 rounded-lg overflow-hidden">
        <!-- Filter Toggle -->
        <button
          type="button"
          class="w-full flex items-center justify-between px-4 py-3 text-sm text-slate-300 hover:bg-slate-700/30 transition-colors"
          @click="showFilters = !showFilters"
        >
          <div class="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="text-slate-400"
            ><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
            <span class="font-medium">Filters</span>
            <span
              v-if="activeFilterCount > 0"
              class="px-1.5 py-0.5 text-[10px] font-bold bg-cyan-500/20 text-cyan-400 rounded"
            >
              {{ activeFilterCount }}
            </span>
          </div>
          <span
            class="text-xs text-slate-500"
            :class="{ 'rotate-180': showFilters }"
          >▼</span>
        </button>

        <!-- Filter Controls -->
        <form
          v-if="showFilters"
          class="px-4 py-4 border-t border-slate-700/50 space-y-4"
          @submit.prevent="applyFilters"
        >
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <!-- Min Participants -->
            <div>
              <label class="block text-[10px] text-slate-500 font-mono uppercase tracking-wide mb-1.5">Min Players</label>
              <input
                v-model.number="filterMinParticipants"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 4"
                class="w-full px-3 py-2 text-sm bg-slate-900/50 border border-slate-600/50 rounded text-white placeholder-slate-600 focus:ring-1 focus:ring-cyan-400 focus:border-transparent"
              >
            </div>

            <!-- Map Name -->
            <div>
              <label class="block text-[10px] text-slate-500 font-mono uppercase tracking-wide mb-1.5">Map</label>
              <input
                v-model="filterMapName"
                type="text"
                placeholder="e.g. Wake Island"
                class="w-full px-3 py-2 text-sm bg-slate-900/50 border border-slate-600/50 rounded text-white placeholder-slate-600 focus:ring-1 focus:ring-cyan-400 focus:border-transparent"
              >
            </div>

            <!-- Date From -->
            <div>
              <label class="block text-[10px] text-slate-500 font-mono uppercase tracking-wide mb-1.5">From Date</label>
              <input
                v-model="filterDateFrom"
                type="date"
                class="w-full px-3 py-2 text-sm bg-slate-900/50 border border-slate-600/50 rounded text-white focus:ring-1 focus:ring-cyan-400 focus:border-transparent"
              >
            </div>

            <!-- Date To -->
            <div>
              <label class="block text-[10px] text-slate-500 font-mono uppercase tracking-wide mb-1.5">To Date</label>
              <input
                v-model="filterDateTo"
                type="date"
                class="w-full px-3 py-2 text-sm bg-slate-900/50 border border-slate-600/50 rounded text-white focus:ring-1 focus:ring-cyan-400 focus:border-transparent"
              >
            </div>
          </div>

          <!-- Filter Actions -->
          <div class="flex items-center gap-3 pt-2">
            <button
              type="submit"
              class="px-4 py-2 text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white rounded transition-colors"
            >
              Apply Filters
            </button>
            <button
              v-if="hasActiveFilters"
              type="button"
              class="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white border border-slate-600/50 hover:border-slate-500 rounded transition-colors"
              @click="clearFilters"
            >
              Clear All
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Main Content -->
    <div class="w-full max-w-screen-2xl mx-auto px-4 sm:px-8 lg:px-12 py-8">
      <!-- Loading State -->
      <div
        v-if="loading"
        class="flex flex-col items-center justify-center py-20 text-slate-400"
      >
        <div class="w-12 h-12 border-4 border-slate-600 border-t-cyan-400 rounded-full animate-spin mb-4" />
        <p class="text-lg text-slate-300">
          Loading sessions...
        </p>
      </div>

      <!-- Error State -->
      <div
        v-else-if="error"
        class="bg-slate-800/70 backdrop-blur-sm border border-red-800/50 rounded-xl p-8 text-center"
      >
        <div class="text-6xl mb-4">
          ⚠️
        </div>
        <p class="text-red-400 text-lg font-medium">
          {{ error }}
        </p>
      </div>

      <!-- Sessions Table -->
      <div
        v-else-if="rounds.length > 0"
        class="space-y-4"
      >
        <!-- Pagination Info -->
        <div class="bg-slate-800/30 backdrop-blur-sm rounded-lg border border-slate-700/50 p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div class="flex items-center gap-2">
            <span class="text-sm text-slate-400">
              Showing <span class="text-cyan-400 font-medium">{{ (currentPage - 1) * pageSize + 1 }}-{{ Math.min(currentPage * pageSize, totalItems) }}</span>
              of <span class="text-cyan-400 font-medium">{{ totalItems }}</span> sessions
            </span>
          </div>
          <div class="flex items-center gap-2">
            <label
              for="pageSize"
              class="text-xs text-slate-500"
            >Per page:</label>
            <select
              id="pageSize"
              v-model="pageSize"
              class="px-2 py-1 bg-slate-700/50 border border-slate-600/50 rounded text-white text-xs focus:ring-1 focus:ring-cyan-400 focus:border-transparent"
            >
              <option value="10">
                10
              </option>
              <option value="20">
                20
              </option>
              <option value="50">
                50
              </option>
              <option value="100">
                100
              </option>
            </select>
          </div>
        </div>

        <!-- Player Aggregate Stats (player context only) -->
        <div
          v-if="props.playerName && playerAggregate"
          class="grid grid-cols-2 sm:grid-cols-4 gap-3"
        >
          <div class="bg-slate-800/40 border border-slate-700/50 rounded-lg px-4 py-3 text-center">
            <div class="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Avg Kills
            </div>
            <div class="text-xl font-bold text-green-400">
              {{ playerAggregate.avgKills }}
            </div>
          </div>
          <div class="bg-slate-800/40 border border-slate-700/50 rounded-lg px-4 py-3 text-center">
            <div class="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Overall K/D
            </div>
            <div class="text-xl font-bold text-violet-400">
              {{ playerAggregate.kd }}
            </div>
          </div>
          <div class="bg-slate-800/40 border border-slate-700/50 rounded-lg px-4 py-3 text-center">
            <div class="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Best Kills
            </div>
            <div class="text-xl font-bold text-cyan-400">
              {{ playerAggregate.bestKills }}
            </div>
          </div>
          <div class="bg-slate-800/40 border border-slate-700/50 rounded-lg px-4 py-3 text-center">
            <div class="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
              Best Score
            </div>
            <div class="text-xl font-bold text-amber-400">
              {{ playerAggregate.bestScore }}
            </div>
          </div>
        </div>

        <!-- Charts Section -->
        <div
          v-if="rounds.length > 1"
          class="bg-slate-800/30 backdrop-blur-sm rounded-lg border border-slate-700/50 overflow-hidden"
        >
          <button
            type="button"
            class="w-full flex items-center justify-between px-4 py-3 text-sm text-slate-300 hover:bg-slate-700/30 transition-colors"
            @click="showCharts = !showCharts"
          >
            <div class="flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="text-slate-400"
              ><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></svg>
              <span class="font-medium">Charts</span>
            </div>
            <span
              class="text-xs text-slate-500"
              :class="{ 'rotate-180': showCharts }"
            >▼</span>
          </button>

          <div
            v-if="showCharts"
            class="border-t border-slate-700/50 p-4 space-y-6"
          >
            <!-- Player Performance Worm (player context only) -->
            <div v-if="props.playerName && playerPerformanceRounds.length > 1">
              <div class="flex items-center gap-2 mb-3">
                <h4 class="text-xs font-mono uppercase tracking-wider text-slate-400">
                  My Performance
                </h4>
                <span class="text-[10px] text-slate-600 font-mono">{{ playerPerformanceRounds.length }} rounds · oldest → newest</span>
              </div>
              <div class="h-52 sm:h-64">
                <Line
                  :key="`player-perf-${playerPerformanceRounds.length}`"
                  :data="playerPerformanceChartData"
                  :options="playerPerformanceChartOptions"
                />
              </div>
            </div>

            <!-- Score Timeline (hidden on mobile) -->
            <div
              v-if="roundsWithScores.length > 1"
              class="hidden sm:block"
            >
              <h4 class="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3">
                Team Scores Over Time
              </h4>
              <div class="h-48 sm:h-56">
                <Line
                  :key="`scores-${roundsWithScores.length}`"
                  :data="scoreLineChartData"
                  :options="scoreLineChartOptions"
                />
              </div>
            </div>

            <!-- Team Wins + Player Placements side by side (non-player context) -->
            <div
              v-if="!props.playerName"
              class="grid grid-cols-1 lg:grid-cols-2 gap-6"
            >
              <!-- Team Wins -->
              <div v-if="teamWinChartData.labels.length > 0">
                <h4 class="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3">
                  Team Wins
                </h4>
                <div class="h-32">
                  <Bar
                    :key="`teamwins-${rounds.length}`"
                    :data="teamWinChartData"
                    :options="teamWinChartOptions"
                  />
                </div>
              </div>

              <!-- Player Placements -->
              <div v-if="placementChartData.labels.length > 0">
                <h4 class="text-xs font-mono uppercase tracking-wider text-slate-400 mb-3">
                  Top Player Placements
                </h4>
                <div :style="{ height: Math.max(200, placementChartData.labels.length * 28) + 'px' }">
                  <Bar
                    :key="`placements-${rounds.length}`"
                    :data="placementChartData"
                    :options="placementChartOptions"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Top Pagination (only when many rounds) -->
        <div
          v-if="totalPages > 1 && rounds.length > 20"
          class="flex justify-center items-center gap-2"
        >
          <button
            :disabled="currentPage === 1"
            class="px-3 py-2 bg-slate-700/50 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-600/50 rounded-lg transition-colors text-sm text-slate-300"
            @click="goToPage(currentPage - 1)"
          >
            ← Previous
          </button>
          <div class="flex items-center gap-1">
            <button
              v-for="page in Math.min(5, totalPages)"
              :key="page"
              :class="[
                'px-3 py-2 rounded-lg border transition-colors text-sm',
                currentPage === page
                  ? 'bg-cyan-600 border-cyan-500 text-white'
                  : 'bg-slate-700/50 hover:bg-slate-700 border-slate-600/50 text-slate-300'
              ]"
              @click="goToPage(page)"
            >
              {{ page }}
            </button>
            <span
              v-if="totalPages > 5"
              class="text-slate-500"
            >...</span>
          </div>
          <button
            :disabled="currentPage === totalPages"
            class="px-3 py-2 bg-slate-700/50 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-600/50 rounded-lg transition-colors text-sm text-slate-300"
            @click="goToPage(currentPage + 1)"
          >
            Next →
          </button>
        </div>

        <!-- Sessions List -->
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b border-slate-700/50">
                <th class="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Map & Server
                </th>
                <th class="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider hidden md:table-cell">
                  Team Matchup
                </th>
                <th class="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  {{ props.playerName ? 'My Performance' : 'Top Players' }}
                </th>
                <th class="text-center py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider hidden lg:table-cell">
                  Participants
                </th>
                <th class="text-center py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider hidden lg:table-cell">
                  Duration
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(round, index) in rounds"
                :key="round.roundId"
                class="group border-l-4 border-b border-slate-700/30 hover:bg-slate-800/40 transition-all duration-150 cursor-pointer border-l-cyan-400"
                :class="round.isActive && index === 0 ? 'bg-emerald-500/5' : ''"
                @click="navigateToRoundReport(round.roundId)"
              >
                <!-- Map & Server Column -->
                <td class="py-4 px-4">
                  <div class="flex flex-col gap-1">
                    <div class="flex items-center gap-2">
                      <span
                        class="text-sm font-bold"
                        :class="round.isActive && index === 0 ? 'text-emerald-400' : getMapAccentColor(round.mapName)"
                      >
                        {{ round.mapName }}
                      </span>
                      <span
                        v-if="round.isActive && index === 0"
                        class="text-[10px] text-emerald-400 font-semibold uppercase tracking-wide px-1.5 py-0.5 bg-emerald-500/20 rounded"
                      >
                        Live
                      </span>
                    </div>
                    <span class="text-xs text-slate-500 font-medium">
                      {{ round.serverName }} • {{ formatRelativeTime(round.startTime) }} ago
                    </span>
                  </div>
                </td>

                <!-- Team Matchup Column (hidden on mobile) -->
                <td class="py-4 px-4 hidden md:table-cell">
                  <div
                    v-if="round.team1Label && round.team2Label && round.team1Points !== undefined && round.team2Points !== undefined"
                    class="space-y-1"
                  >
                    <div class="flex items-center gap-2">
                      <span
                        class="text-sm font-semibold"
                        :class="getTeamColor(round.team1Label)"
                      >
                        {{ round.team1Label }}
                      </span>
                      <span class="font-mono text-sm font-bold text-slate-200">{{ round.team1Points }}</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <span
                        class="text-sm font-semibold"
                        :class="getTeamColor(round.team2Label)"
                      >
                        {{ round.team2Label }}
                      </span>
                      <span class="font-mono text-sm font-bold text-slate-200">{{ round.team2Points }}</span>
                    </div>
                  </div>
                  <span
                    v-else
                    class="text-sm text-slate-500"
                  >
                    —
                  </span>
                </td>

                <!-- Performance Column -->
                <td class="py-4 px-4">
                  <!-- Player context: show own stats prominently, top 3 below -->
                  <template v-if="props.playerName">
                    <div
                      v-if="playerStatsData[round.roundId]"
                      class="space-y-2"
                    >
                      <!-- Own stats card -->
                      <div class="bg-gradient-to-r from-cyan-500/20 to-blue-500/15 border border-cyan-400/40 rounded-lg px-3 py-2">
                        <div class="flex items-center gap-3 flex-wrap">
                          <div class="flex items-center gap-1.5">
                            <span class="text-[10px] font-mono uppercase text-cyan-500/70">K</span>
                            <span class="text-sm font-bold text-green-400">{{ playerStatsData[round.roundId].kills }}</span>
                          </div>
                          <div class="flex items-center gap-1.5">
                            <span class="text-[10px] font-mono uppercase text-cyan-500/70">D</span>
                            <span class="text-sm font-bold text-red-400">{{ playerStatsData[round.roundId].deaths }}</span>
                          </div>
                          <div class="flex items-center gap-1.5">
                            <span class="text-[10px] font-mono uppercase text-cyan-500/70">K/D</span>
                            <span
                              class="text-sm font-bold font-mono"
                              :class="getKDRColor(playerStatsData[round.roundId].kills, playerStatsData[round.roundId].deaths)"
                            >
                              {{ calculateKDR(playerStatsData[round.roundId].kills, playerStatsData[round.roundId].deaths) }}
                            </span>
                          </div>
                          <div class="flex items-center gap-1.5">
                            <span class="text-[10px] font-mono uppercase text-cyan-500/70">Score</span>
                            <span class="text-sm font-semibold text-amber-300">{{ playerStatsData[round.roundId].score }}</span>
                          </div>
                        </div>
                      </div>
                      <!-- Top 3 context (subtle) -->
                      <div
                        v-if="round.topPlayers && round.topPlayers.length > 0"
                        class="space-y-0.5"
                      >
                        <div
                          v-for="(player, playerIdx) in round.topPlayers.slice(0, 3)"
                          :key="playerIdx"
                          class="flex items-center gap-1.5 text-[11px]"
                        >
                          <span class="text-slate-600 tabular-nums w-3">{{ playerIdx + 1 }}.</span>
                          <span
                            class="truncate max-w-[90px]"
                            :class="player.playerName === props.playerName ? 'text-cyan-400 font-semibold' : 'text-slate-500'"
                          >{{ player.playerName }}</span>
                          <span class="text-slate-700">/</span>
                          <span
                            :class="getKDRColor(player.kills, player.deaths)"
                            class="font-mono"
                          >{{ calculateKDR(player.kills, player.deaths) }}</span>
                        </div>
                      </div>
                    </div>
                    <span
                      v-else
                      class="text-sm text-slate-500"
                    >—</span>
                  </template>

                  <!-- Non-player context: original top 3 display -->
                  <template v-else>
                    <div
                      v-if="round.topPlayers && round.topPlayers.length > 0"
                      class="space-y-1.5"
                    >
                      <div
                        v-for="(player, playerIdx) in round.topPlayers.slice(0, 3)"
                        :key="playerIdx"
                        class="text-xs rounded-lg px-2.5 py-1.5 transition-all duration-200"
                      >
                        <div class="flex items-center gap-2">
                          <span class="font-bold tabular-nums text-slate-400">{{ playerIdx + 1 }}.</span>
                          <span
                            class="font-medium truncate max-w-[100px] text-slate-200"
                            :title="player.playerName"
                          >
                            {{ player.playerName }}
                          </span>
                          <span class="text-slate-600">/</span>
                          <span
                            class="font-mono font-semibold"
                            :class="getKDRColor(player.kills, player.deaths)"
                          >
                            {{ calculateKDR(player.kills, player.deaths) }}
                          </span>
                          <span class="text-slate-600">{{ player.score }}</span>
                        </div>
                      </div>
                    </div>
                    <span
                      v-else
                      class="text-sm text-slate-500"
                    >—</span>
                  </template>
                </td>

                <!-- Participants Column (hidden on mobile/tablet) -->
                <td class="py-4 px-4 text-center hidden lg:table-cell">
                  <span class="text-sm text-slate-400">
                    {{ round.participantCount }}
                  </span>
                </td>

                <!-- Duration Column (hidden on mobile/tablet) -->
                <td class="py-4 px-4 text-center hidden lg:table-cell">
                  <span class="text-sm text-slate-400 font-mono">
                    {{ formatPlayTime(round.durationMinutes) }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Bottom Pagination -->
        <div
          v-if="totalPages > 1"
          class="mt-6 flex justify-center items-center gap-2"
        >
          <button
            :disabled="currentPage === 1"
            class="px-3 py-2 bg-slate-700/50 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-600/50 rounded-lg transition-colors text-sm text-slate-300"
            @click="goToPage(currentPage - 1)"
          >
            ← Previous
          </button>

          <div class="flex items-center gap-1">
            <button
              v-for="page in Math.min(5, totalPages)"
              :key="page"
              :class="[
                'px-3 py-2 rounded-lg border transition-colors text-sm',
                currentPage === page
                  ? 'bg-cyan-600 border-cyan-500 text-white'
                  : 'bg-slate-700/50 hover:bg-slate-700 border-slate-600/50 text-slate-300'
              ]"
              @click="goToPage(page)"
            >
              {{ page }}
            </button>
            <span
              v-if="totalPages > 5"
              class="text-slate-500"
            >...</span>
          </div>

          <button
            :disabled="currentPage === totalPages"
            class="px-3 py-2 bg-slate-700/50 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-600/50 rounded-lg transition-colors text-sm text-slate-300"
            @click="goToPage(currentPage + 1)"
          >
            Next →
          </button>
        </div>
      </div>

      <!-- Empty State -->
      <div
        v-else
        class="flex flex-col items-center justify-center py-12 text-slate-400"
      >
        <div class="text-5xl mb-3 opacity-50">
          🎮
        </div>
        <p class="text-base font-medium">
          No sessions found
        </p>
        <p class="text-sm text-slate-500 mt-1">
          Try adjusting your filters or check back later
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped src="./SessionsPage.vue.css"></style>
