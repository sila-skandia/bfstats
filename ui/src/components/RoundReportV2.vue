<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { fetchRoundReport, RoundReport } from '../services/serverDetailsService';
import {
  generateBattleReport,
  filterBattleEvents,
  type BattleEvent,
  type BattleHighlight,
  type RoundSummary,
} from '../utils/battleEventGenerator';
import BattleSummary from './round-report/BattleSummary.vue';
import BattleHighlightComponent from './round-report/BattleHighlight.vue';
import BattleVisualizer from './round-report/BattleVisualizer.vue';

// Router
const router = useRouter();

interface Props {
  roundId: string;
  players?: string; // Optional parameter for pinning specific players
}

const props = defineProps<Props>();

const roundReport = ref<RoundReport | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const isPlaying = ref(false);
const playbackInterval = ref<NodeJS.Timeout | null>(null);
const playbackSpeed = ref(800); // milliseconds between events
const battleEvents = ref<BattleEvent[]>([]);
const battleHighlights = ref<BattleHighlight[]>([]);
const roundSummary = ref<RoundSummary | null>(null);
const visibleEventIndex = ref(0);
const autoScrollEnabled = ref(true);
const showLiveLadder = ref(true);
const showGraphicalView = ref(false);
const isFullscreen = ref(false);
const trackedPlayer = ref('');
const newEventIds = ref(new Set<number>());
const batchUpdateEvents = ref<Array<{timestamp: string, events: BattleEvent[]}>>([]);
const consoleElement = ref<HTMLElement | null>(null);
const timeCheckpoints = ref<Array<{
  index: number;
  timestamp: string;
  offset: string;
  minutes: number;
}>>([]);

// Display filter options
const showJoinEvents = ref(false);
const showDeathEvents = ref(true);
const highlightsOnly = ref(false);

// Generate battle narrative from leaderboard snapshots using the new utility
const processBattleReport = () => {
  if (!roundReport.value) return;

  const report = generateBattleReport(roundReport.value);

  battleEvents.value = report.events;
  battleHighlights.value = report.highlights;
  roundSummary.value = report.summary;

  // Group events by timestamp for batch updates
  const eventGroups = report.events.reduce((acc, event) => {
    if (!acc[event.timestamp]) acc[event.timestamp] = [];
    acc[event.timestamp].push(event);
    return acc;
  }, {} as Record<string, BattleEvent[]>);

  batchUpdateEvents.value = Object.entries(eventGroups).map(([timestamp, events]) => ({
    timestamp,
    events
  })).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Generate time-based checkpoints
  generateTimeCheckpoints();
};

// Filtered events based on display preferences
const filteredBattleEvents = computed(() => {
  return filterBattleEvents(battleEvents.value, {
    showJoinEvents: showJoinEvents.value,
    showDeathEvents: showDeathEvents.value,
    highlightsOnly: highlightsOnly.value,
  });
});

// Generate time-based checkpoints (every minute)
const generateTimeCheckpoints = () => {
  if (!batchUpdateEvents.value.length || !roundReport.value) return;
  
  const checkpoints: typeof timeCheckpoints.value = [];
  const startTime = new Date(roundReport.value.round.startTime).getTime();
  const endTime = new Date(batchUpdateEvents.value[batchUpdateEvents.value.length - 1].timestamp).getTime();
  const totalDuration = endTime - startTime;
  const totalMinutes = Math.ceil(totalDuration / (1000 * 60));
  
  // Create checkpoints every minute
  for (let minute = 0; minute <= totalMinutes; minute++) {
    const targetTime = startTime + (minute * 60 * 1000);
    
    // Find closest batch event to this time
    let closestIndex = 0;
    let closestDiff = Math.abs(new Date(batchUpdateEvents.value[0].timestamp).getTime() - targetTime);
    
    for (let i = 1; i < batchUpdateEvents.value.length; i++) {
      const eventTime = new Date(batchUpdateEvents.value[i].timestamp).getTime();
      const diff = Math.abs(eventTime - targetTime);
      
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIndex = i;
      }
    }
    
    // Format the time display
    let timeDisplay;
    if (minute === 0) {
      timeDisplay = 'START';
    } else if (minute < 60) {
      timeDisplay = `${minute}M`;
    } else {
      const hours = Math.floor(minute / 60);
      const mins = minute % 60;
      timeDisplay = `${hours}H${mins > 0 ? mins + 'M' : ''}`;
    }
    
    checkpoints.push({
      index: closestIndex,
      timestamp: batchUpdateEvents.value[closestIndex].timestamp,
      offset: timeDisplay,
      minutes: minute
    });
  }

  // If no checkpoints were generated, create some sample ones for testing
  if (checkpoints.length === 0 && batchUpdateEvents.value.length > 0) {
    const sampleCount = Math.min(10, batchUpdateEvents.value.length);
    for (let i = 0; i < sampleCount; i++) {
      const batchIndex = Math.floor((i / (sampleCount - 1)) * (batchUpdateEvents.value.length - 1));
      checkpoints.push({
        index: batchIndex,
        timestamp: batchUpdateEvents.value[batchIndex].timestamp,
        offset: i === 0 ? 'START' : `${i}M`,
        minutes: i
      });
    }
  }
  
  timeCheckpoints.value = checkpoints;
};

// Fetch round report
const fetchData = async () => {
  if (!props.roundId) return;

  loading.value = true;
  error.value = null;

  try {
    const data = await fetchRoundReport(props.roundId);
    roundReport.value = data;

    // Check if round is empty (no participants)
    if (!data.leaderboardSnapshots || data.leaderboardSnapshots.length === 0 ||
        (data.leaderboardSnapshots.length === 1 && data.leaderboardSnapshots[0].entries.length === 0)) {
      error.value = 'This round was empty - no players participated';
      return;
    }

    processBattleReport();
    visibleEventIndex.value = batchUpdateEvents.value.length - 1;

    // Update page title with round data
    updatePageTitle();

    // Handle player pinning from query parameter
    if (props.players) {
      trackedPlayer.value = props.players;
    }
  } catch (err) {
    console.error('Error fetching round report:', err);
    error.value = 'Failed to fetch round report';
  } finally {
    loading.value = false;
  }
};



// Playback controls
const startPlayback = () => {
  if (!batchUpdateEvents.value.length) return;
  
  // If we're at the end, start from the beginning, otherwise start from current position
  if (visibleEventIndex.value >= batchUpdateEvents.value.length - 1) {
    visibleEventIndex.value = 0;
  }
  
  isPlaying.value = true;
  newEventIds.value.clear();
  autoScrollEnabled.value = true;
  
  playbackInterval.value = setInterval(() => {
    if (visibleEventIndex.value < batchUpdateEvents.value.length - 1) {
      visibleEventIndex.value++;
      
      // Add new event IDs for animation
      const currentBatch = batchUpdateEvents.value[visibleEventIndex.value];
      const startIndex = battleEvents.value.findIndex(e => e.timestamp === currentBatch.timestamp);
      if (startIndex >= 0) {
        for (let i = 0; i < currentBatch.events.length; i++) {
          newEventIds.value.add(startIndex + i);
        }
        // Remove animation class after a delay
        setTimeout(() => {
          for (let i = 0; i < currentBatch.events.length; i++) {
            newEventIds.value.delete(startIndex + i);
          }
        }, 1000);
      }
      
      // Auto-scroll to top
      if (autoScrollEnabled.value) {
        scrollToTop();
      }
    } else {
      stopPlayback();
    }
  }, playbackSpeed.value);
};

const stopPlayback = () => {
  isPlaying.value = false;
  if (playbackInterval.value) {
    clearInterval(playbackInterval.value);
    playbackInterval.value = null;
  }
};

const resetPlayback = () => {
  stopPlayback();
  visibleEventIndex.value = 0;
  newEventIds.value.clear();
  autoScrollEnabled.value = true;
};

const togglePlayback = () => {
  if (isPlaying.value) {
    stopPlayback();
  } else {
    startPlayback();
  }
};

const jumpToEnd = () => {
  stopPlayback();
  visibleEventIndex.value = batchUpdateEvents.value.length - 1;
  newEventIds.value.clear();
  autoScrollEnabled.value = true;
  scrollToTop();
};

const scrollToTop = () => {
  if (consoleElement.value) {
    consoleElement.value.scrollTop = 0;
  }
};

// Time navigation state
const selectedTimeIndex = ref(0);

// Jump to time checkpoint
const jumpToTimeCheckpoint = (checkpointIndex: number) => {
  const checkpoint = timeCheckpoints.value[checkpointIndex];
  if (!checkpoint) return;
  
  // Stop current playback
  stopPlayback();
  
  // Jump to the checkpoint batch index
  visibleEventIndex.value = checkpoint.index;
  selectedTimeIndex.value = checkpointIndex;
  newEventIds.value.clear();
  autoScrollEnabled.value = true;
  
  // Scroll to top to show the checkpoint
  scrollToTop();
};

// Update selected index based on current position
const updateSelectedTimeIndex = () => {
  if (timeCheckpoints.value.length > 0) {
    let closestIndex = 0;
    let closestDiff = Math.abs(timeCheckpoints.value[0].index - visibleEventIndex.value);
    
    for (let i = 1; i < timeCheckpoints.value.length; i++) {
      const diff = Math.abs(timeCheckpoints.value[i].index - visibleEventIndex.value);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestIndex = i;
      }
    }
    
    selectedTimeIndex.value = closestIndex;
  }
};

// Handle keyboard navigation
const handleKeydown = (event: KeyboardEvent) => {
  const activeElement = document.activeElement;
  const isInputFocused = activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT');
  
  if (isInputFocused) return;
  
  switch (event.key) {
    case 'Escape':
      if (isFullscreen.value) {
        isFullscreen.value = false;
        event.preventDefault();
      }
      break;
    case ' ':
      event.preventDefault();
      togglePlayback();
      break;
    case 'ArrowUp':
      event.preventDefault();
      if (selectedTimeIndex.value > 0) jumpToTimeCheckpoint(selectedTimeIndex.value - 1);
      break;
    case 'ArrowDown':
      event.preventDefault();
      if (selectedTimeIndex.value < timeCheckpoints.value.length - 1) jumpToTimeCheckpoint(selectedTimeIndex.value + 1);
      break;
  }
};

// Get current time offset for display
const getCurrentTimeOffset = () => {
  if (timeCheckpoints.value.length === 0) return '00:00';
  return timeCheckpoints.value[selectedTimeIndex.value]?.offset || '00:00';
};

// Visible events for display (using filtered events)
const visibleEvents = computed(() => {
  const filtered = filteredBattleEvents.value;
  if (visibleEventIndex.value >= batchUpdateEvents.value.length) {
    return filtered;
  }

  const currentBatch = batchUpdateEvents.value[visibleEventIndex.value];
  if (!currentBatch) return [];

  const cutoffTime = new Date(currentBatch.timestamp).getTime();
  return filtered.filter(e => new Date(e.timestamp).getTime() <= cutoffTime);
});

// Reversed visible events (newest first)
const visibleEventsReversed = computed(() => {
  return [...visibleEvents.value].reverse();
});

// Current leaderboard (live or final)
const currentLeaderboard = computed(() => {
  if (!roundReport.value || !roundReport.value.leaderboardSnapshots.length) return [];
  
  if (showLiveLadder.value) {
    let currentTime;
    if (visibleEventIndex.value > 0 && visibleEventIndex.value < batchUpdateEvents.value.length) {
      currentTime = batchUpdateEvents.value[visibleEventIndex.value].timestamp;
    } else if (visibleEventIndex.value === 0) {
      currentTime = roundReport.value.round.startTime;
    } else {
      currentTime = batchUpdateEvents.value[batchUpdateEvents.value.length - 1]?.timestamp || roundReport.value.round.startTime;
    }
    
    let targetSnapshot = roundReport.value.leaderboardSnapshots[0];
    for (const snapshot of roundReport.value.leaderboardSnapshots) {
      if (new Date(snapshot.timestamp).getTime() <= new Date(currentTime).getTime()) {
        targetSnapshot = snapshot;
      } else {
        break;
      }
    }
    return targetSnapshot.entries;
  } else {
    const finalSnapshot = roundReport.value.leaderboardSnapshots[roundReport.value.leaderboardSnapshots.length - 1];
    return finalSnapshot.entries;
  }
});

// Team groups for current leaderboard
const teamGroups = computed(() => {
  if (!currentLeaderboard.value.length) return [];
  
  const groups = currentLeaderboard.value.reduce((acc, entry) => {
    if (!acc[entry.teamLabel]) acc[entry.teamLabel] = [];
    acc[entry.teamLabel].push(entry);
    return acc;
  }, {} as Record<string, typeof currentLeaderboard.value>);
  
  return Object.entries(groups).map(([teamName, players]) => ({
    teamName,
    players: players.sort((a, b) => a.rank - b.rank),
    totalScore: players.reduce((sum, player) => sum + player.score, 0),
    totalKills: players.reduce((sum, player) => sum + player.kills, 0),
    totalDeaths: players.reduce((sum, player) => sum + player.deaths, 0)
  })).sort((a, b) => b.totalScore - a.totalScore);
});

// Format date
const formatDate = (dateString: string | null): string => {
  if (!dateString) return 'N/A';
  const date = new Date(dateString.endsWith('Z') ? dateString : dateString + 'Z');
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

// Update selected index when playback changes
watch(visibleEventIndex, () => {
  updateSelectedTimeIndex();
});

// Watch for roundId changes to fetch new data
watch(() => props.roundId, (newRoundId) => {
  if (newRoundId) {
    fetchData();
  }
}, { immediate: true });

// Cleanup
onUnmounted(() => {
  stopPlayback();
  document.removeEventListener('keydown', handleKeydown);
});

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
});

const goBack = () => {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    router.push('/servers');
  }
};

const navigateToPlayerProfile = (playerName: string) => {
  router.push(`/players/${encodeURIComponent(playerName)}`);
};

// Format time offset from round start
const formatTimeOffset = (eventTimestamp: string) => {
  if (!roundReport.value) return '00:00';
  const roundStartTime = new Date(roundReport.value.round.startTime).getTime();
  const eventTime = new Date(eventTimestamp).getTime();
  const offsetMs = eventTime - roundStartTime;
  if (offsetMs < 0) return '00:00';
  const totalSeconds = Math.floor(offsetMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const isTrackedPlayerEvent = (event: typeof battleEvents.value[0]) => {
  if (!trackedPlayer.value.trim()) return false;
  return event.player.toLowerCase().includes(trackedPlayer.value.toLowerCase()) ||
         event.message.toLowerCase().includes(trackedPlayer.value.toLowerCase());
};

const getEventStyling = (event: typeof battleEvents.value[0], eventIndex: number) => {
  const isNew = newEventIds.value.has(eventIndex);
  const isTracked = isTrackedPlayerEvent(event);
  
  let classes = 'console-line font-mono text-xs ';
  if (isNew) classes += 'bg-cyan-500/10 ';
  if (isTracked) classes += 'bg-yellow-500/10 border-l-yellow-400 ';
  if (event.isHighlight) classes += 'highlight ';
  
  return classes;
};

const getKDClass = (kills: number, deaths: number) => {
  const kd = deaths > 0 ? kills / deaths : kills;
  if (kd >= 2) return 'text-emerald-400';
  if (kd >= 1) return 'text-yellow-400';
  return 'text-red-400';
};

// SEO & Title
const updatePageTitle = () => {
  if (!roundReport.value?.round) return;
  const { round } = roundReport.value;
  document.title = `${round.mapName} | ${round.serverName} | Battle Report`;
};

const shouldShowTickets = computed(() => {
  if (!roundReport.value?.round) return false;
  const { tickets1, tickets2 } = roundReport.value.round;
  return tickets1 !== null && tickets1 !== undefined && tickets1 >= 0;
});
</script>

<template>
  <div class="min-h-screen bg-[#0a0a0f] text-slate-300 font-sans selection:bg-cyan-500/30">
    <!-- Fullscreen War Room Overlay -->
    <Transition name="fade">
      <div v-if="isFullscreen" class="fixed top-0 left-0 bottom-0 right-0 md:right-20 z-[9999] bg-[#05050a]/98 backdrop-blur-2xl flex flex-col p-4 md:p-8">
        <div class="flex flex-col md:flex-row items-start md:items-center justify-between mb-6 md:mb-8 border-b border-white/5 pb-4 gap-4">
          <div class="flex items-center gap-4">
            <div class="hidden md:block w-1 h-6 bg-cyan-500 shadow-[0_0_12px_rgba(0,229,255,0.6)]" />
            <h2 class="text-xl md:text-2xl font-black text-white uppercase tracking-[0.2em] md:tracking-[0.4em] italic">War Room</h2>
            <div v-if="roundReport" class="hidden sm:block px-3 py-1 bg-cyan-500/10 border border-cyan-500/30 text-[8px] md:text-[10px] font-mono text-cyan-400 uppercase tracking-widest truncate max-w-[150px] md:max-w-none">{{ roundReport.round.mapName }}</div>
          </div>
          
          <div class="flex items-center justify-between w-full md:w-auto gap-4 md:gap-6">
            <!-- Playback in Fullscreen -->
            <div class="flex items-center gap-1 md:gap-2 bg-black/40 rounded p-1 border border-white/10 flex-1 md:flex-none justify-center">
              <button @click="resetPlayback" class="p-1 md:p-2 hover:text-white transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/></svg></button>
              <button @click="togglePlayback" class="px-3 md:px-6 py-1.5 md:py-2 bg-cyan-500 text-black text-[10px] md:text-xs font-black uppercase tracking-widest hover:bg-white transition-all rounded">
                {{ isPlaying ? 'PAUSE' : 'RESUME' }}
              </button>
              <button @click="jumpToEnd" class="p-1 md:p-2 hover:text-white transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 17 5-5-5-5M13 17l5-5-5-5"/></svg></button>
            </div>

            <button @click="isFullscreen = false" class="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/50 transition-all text-slate-400 hover:text-red-400 shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" md:width="24" md:height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        <div class="flex-1 overflow-hidden relative">
          <BattleVisualizer 
            v-if="roundReport"
            :round-report="roundReport" 
            :battle-events="battleEvents" 
            :current-time-index="visibleEventIndex"
            :batch-update-events="batchUpdateEvents"
            :tracked-player="trackedPlayer"
            :round-summary="roundSummary"
          />
        </div>

        <div class="mt-8 flex justify-between items-center px-4 opacity-40">
           <div class="text-[10px] font-mono tracking-[0.5em] text-slate-500">TACTICAL_STRATEGIC_VIEWPORT_v1.0</div>
           <div class="text-[10px] font-mono text-slate-500 uppercase">PRESS [ESC] TO DISENGAGE</div>
        </div>
      </div>
    </Transition>

    <!-- Background FX -->
    <div class="fixed inset-0 pointer-events-none overflow-hidden">
      <div class="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-cyan-500/5 rounded-full blur-[120px]" />
      <div class="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/5 rounded-full blur-[120px]" />
    </div>

    <div v-if="loading" class="flex flex-col items-center justify-center min-h-screen">
      <div class="w-16 h-16 border-2 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mb-4" />
      <div class="font-mono text-cyan-400 animate-pulse tracking-widest uppercase text-sm">Initializing Link...</div>
    </div>

    <div v-else-if="error" class="flex flex-col items-center justify-center min-h-screen p-6">
      <div class="rr-card p-12 text-center max-w-lg">
        <div class="text-6xl mb-6">⚠️</div>
        <h2 class="text-2xl font-bold text-white mb-2 uppercase tracking-tight">Data Sync Error</h2>
        <p class="text-slate-400 mb-8 font-mono text-sm">{{ error }}</p>
        <button @click="goBack" class="px-8 py-3 bg-cyan-500/10 border border-cyan-500/50 text-cyan-400 font-mono text-sm uppercase tracking-widest hover:bg-cyan-500/20 transition-all">
          Return to Base
        </button>
      </div>
    </div>

    <div v-else-if="roundReport" class="relative z-10 px-4 py-6 lg:px-8 max-w-[1600px] mx-auto">
      <!-- Header Section -->
      <header class="rr-header-card mb-8 p-6 lg:p-8 rounded-xl relative overflow-hidden">
        <div class="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
          <svg width="200" height="200" viewBox="0 0 100 100" class="text-cyan-400">
            <path d="M0 0 L100 0 L100 10 L0 10 Z" fill="currentColor" />
            <path d="M0 20 L80 20 L80 30 L0 30 Z" fill="currentColor" />
            <path d="M0 40 L60 40 L60 50 L0 50 Z" fill="currentColor" />
          </svg>
        </div>

        <div class="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
          <div class="flex items-center gap-6">
            <button @click="goBack" class="w-12 h-12 flex items-center justify-center rounded-full border border-slate-700 hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all group">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="group-hover:text-cyan-400 transition-colors"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <div>
              <div class="flex items-center gap-3 mb-1">
                <span class="px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/30 text-[10px] font-mono text-cyan-400 uppercase tracking-widest">Archive.DAT</span>
                <span class="text-xs text-slate-500 font-mono">{{ formatDate(roundReport.round.startTime) }}</span>
              </div>
              <h1 class="text-3xl lg:text-5xl font-black text-white uppercase tracking-tighter italic">
                {{ roundReport.round.mapName }}
              </h1>
              <div class="flex items-center gap-2 mt-2">
                <div class="w-2 h-2 bg-emerald-500 rounded-full" />
                <span class="text-xs font-mono text-emerald-500/80 uppercase tracking-widest">{{ roundReport.round.serverName }}</span>
              </div>
            </div>
          </div>

          <!-- Ticket Counter -->
          <div v-if="shouldShowTickets" class="flex items-center gap-8 lg:gap-16 bg-black/40 px-8 py-4 rounded-xl border border-white/5 backdrop-blur-md">
            <div class="text-center">
              <div class="text-[10px] font-mono text-blue-400 uppercase mb-1 tracking-widest">{{ roundReport.round.team1Label || 'ALPHA' }}</div>
              <div class="text-4xl font-black text-white font-mono">{{ roundReport.round.tickets1 }}</div>
            </div>
            <div class="h-12 w-px bg-white/10" />
            <div class="text-center">
              <div class="text-[10px] font-mono text-red-400 uppercase mb-1 tracking-widest">{{ roundReport.round.team2Label || 'BRAVO' }}</div>
              <div class="text-4xl font-black text-white font-mono">{{ roundReport.round.tickets2 }}</div>
            </div>
          </div>
        </div>
      </header>

      <!-- Main Dashboard Grid -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        
        <!-- Left Column: Combat Feed (Col 8) -->
        <div class="lg:col-span-8 flex flex-col gap-8 h-[800px]">
          
          <!-- Summary Stats Row -->
          <div v-if="roundSummary">
            <BattleSummary :summary="roundSummary" />
          </div>

          <!-- Console & Timeline Container -->
          <div class="flex-1 rr-card overflow-hidden flex flex-row">
            
            <!-- Vertical Time Navigator -->
            <div class="time-navigator custom-scrollbar overflow-y-auto">
              <div class="p-3 border-b border-white/5 text-center">
                <div class="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Time</div>
              </div>
              <div 
                v-for="(cp, idx) in timeCheckpoints" 
                :key="idx" 
                class="time-checkpoint font-mono"
                :class="{ 'active': idx === selectedTimeIndex }"
                @click="jumpToTimeCheckpoint(idx)"
              >
                {{ cp.offset }}
              </div>
            </div>

            <!-- Main Console -->
            <div class="flex-1 flex flex-col console-wrapper">
              <!-- Console Header/Controls -->
              <div class="console-header flex items-center justify-between">
                <div class="flex items-center gap-4">
                  <div class="flex items-center gap-2">
                    <div :class="['live-indicator', { 'opacity-0': !isPlaying }]" />
                    <span class="text-[10px] font-mono text-cyan-400 uppercase tracking-widest">{{ showGraphicalView ? 'Strategic Visualization' : 'Battle Feed' }}</span>
                  </div>

                  <!-- View Mode Toggle -->
                  <div class="flex items-center gap-1 bg-black/60 rounded p-0.5 border border-white/10 ml-2">
                    <button 
                      @click="showGraphicalView = false" 
                      class="px-2 py-1 text-[8px] font-mono tracking-tighter uppercase transition-all"
                      :class="!showGraphicalView ? 'bg-cyan-500 text-black font-bold' : 'text-slate-500 hover:text-slate-300'"
                    >LOG</button>
                    <button 
                      @click="showGraphicalView = true" 
                      class="px-2 py-1 text-[8px] font-mono tracking-tighter uppercase transition-all"
                      :class="showGraphicalView ? 'bg-cyan-500 text-black font-bold' : 'text-slate-500 hover:text-slate-300'"
                    >GFX</button>
                    <button 
                      v-if="showGraphicalView"
                      @click="isFullscreen = true" 
                      class="px-2 py-1 text-[8px] font-mono tracking-tighter uppercase text-slate-500 hover:text-cyan-400 border-l border-white/5"
                    >MAX</button>
                  </div>

                  <div class="flex items-center gap-1 bg-black/40 rounded p-0.5 border border-white/5">
                    <button @click="resetPlayback" class="p-1 hover:text-white transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m11 17-5-5 5-5M18 17l-5-5 5-5"/></svg></button>
                    <button @click="togglePlayback" class="px-3 py-1 bg-cyan-500 text-black text-[10px] font-bold uppercase tracking-widest hover:bg-white transition-all">
                      {{ isPlaying ? 'PAUSE' : 'PLAY' }}
                    </button>
                    <button @click="jumpToEnd" class="p-1 hover:text-white transition-colors"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 17 5-5-5-5M13 17l5-5-5-5"/></svg></button>
                  </div>
                  <select v-model="playbackSpeed" class="bg-black/40 border border-white/10 rounded px-2 py-1 text-[10px] font-mono text-slate-400 focus:outline-none focus:border-cyan-500/50">
                    <option :value="1600">0.5X</option>
                    <option :value="800">1.0X</option>
                    <option :value="400">2.0X</option>
                  </select>
                </div>

                <div class="hidden md:flex items-center gap-4">
                  <div v-if="!showGraphicalView" class="flex items-center gap-3">
                    <label v-for="opt in [
                      { label: 'JOIN', model: 'showJoinEvents' },
                      { label: 'DEATH', model: 'showDeathEvents' },
                      { label: 'CRIT', model: 'highlightsOnly' }
                    ]" :key="opt.label" class="flex items-center gap-1.5 cursor-pointer group">
                      <input type="checkbox" v-model="(this as any)[opt.model]" class="sr-only peer">
                      <div class="w-2 h-2 rounded-full border border-slate-600 peer-checked:bg-cyan-500 peer-checked:border-cyan-500 transition-all" />
                      <span class="text-[9px] font-mono text-slate-500 group-hover:text-slate-300 uppercase tracking-widest">{{ opt.label }}</span>
                    </label>
                  </div>
                  <input v-model="trackedPlayer" type="text" placeholder="TRACK_PLAYER_" class="bg-black/60 border border-white/10 rounded px-3 py-1 text-[10px] font-mono text-cyan-400 placeholder:text-slate-700 w-32 focus:outline-none focus:border-cyan-500/50">
                </div>
              </div>

              <!-- Content Area: Switch between Console and Visualizer -->
              <div v-if="showGraphicalView" class="flex-1 overflow-hidden">
                <BattleVisualizer 
                  :round-report="roundReport" 
                  :battle-events="battleEvents" 
                  :current-time-index="visibleEventIndex"
                  :batch-update-events="batchUpdateEvents"
                  :tracked-player="trackedPlayer"
                />
              </div>

              <!-- Console Lines -->
              <div v-else ref="consoleElement" class="flex-1 overflow-y-auto p-4 custom-scrollbar">
                <div v-if="visibleEvents.length === 0" class="h-full flex flex-col items-center justify-center opacity-20 pointer-events-none">
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" class="mb-4"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                  <div class="font-mono text-xs uppercase tracking-[0.4em]">Ready for Playback</div>
                </div>
                
                <div v-for="(event, index) in visibleEventsReversed" :key="index" :class="getEventStyling(event, visibleEvents.length - 1 - index)">
                  <div class="flex items-start gap-4 animate-slide-in">
                    <span class="text-slate-600 w-12 shrink-0 font-mono text-[10px]">{{ formatTimeOffset(event.timestamp) }}</span>
                    <span class="shrink-0">{{ event.icon }}</span>
                    <span :class="[event.color, 'flex-1']">{{ event.message }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right Column: Ladder (Col 4) -->
        <div class="lg:col-span-4 flex flex-col h-[800px]">
          <div class="rr-card flex-1 overflow-hidden flex flex-col">
            <div class="p-5 border-b border-white/5 flex items-center justify-between bg-white/5">
              <h3 class="font-black text-white uppercase tracking-widest text-sm italic">Ladder</h3>
              <label class="flex items-center gap-2 cursor-pointer">
                <span class="text-[9px] font-mono text-slate-500 uppercase tracking-widest">Live Mode</span>
                <input type="checkbox" v-model="showLiveLadder" class="sr-only peer">
                <div class="w-8 h-4 bg-slate-800 rounded-full relative peer peer-checked:bg-cyan-500 transition-all after:content-[''] after:absolute after:top-1 after:left-1 after:w-2 after:h-2 after:bg-white after:rounded-full after:transition-all peer-checked:after:translate-x-4" />
              </label>
            </div>

            <div class="flex-1 overflow-y-auto custom-scrollbar">
              <div v-for="team in teamGroups" :key="team.teamName" class="mb-2">
                <div class="team-header flex items-center justify-between">
                  <span>{{ team.teamName }}</span>
                  <div class="flex items-center gap-4 text-[10px]">
                    <span class="text-slate-500">{{ team.totalKills }} KILLS</span>
                    <span class="text-cyan-400">{{ team.totalScore }} PTS</span>
                  </div>
                </div>
                <table class="leaderboard-table">
                  <thead>
                    <tr class="font-mono">
                      <th class="w-10 text-center">#</th>
                      <th>OPERATIVE</th>
                      <th class="text-center">PTS</th>
                      <th class="text-center">K/D</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="player in team.players" :key="player.playerName" @click="navigateToPlayerProfile(player.playerName)" class="leaderboard-row cursor-pointer group">
                      <td class="text-center font-mono text-slate-500 text-[10px]">{{ player.rank }}</td>
                      <td>
                        <div class="font-bold text-slate-200 group-hover:text-cyan-400 transition-colors truncate max-w-[120px]">
                          {{ player.playerName }}
                        </div>
                      </td>
                      <td class="text-center font-mono font-bold text-white">{{ player.score }}</td>
                      <td class="text-center">
                        <div class="flex flex-col items-center">
                          <span :class="[getKDClass(player.kills, player.deaths), 'font-mono font-bold']">{{ player.kills }} / {{ player.deaths }}</span>
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

        </div>

      </div>

      <!-- Full Width Tactical Intelligence (Key Events) -->
      <div v-if="battleHighlights.length > 0" class="mt-8 rr-card p-6 overflow-hidden flex flex-col min-h-[500px]">
        <div class="flex items-center justify-between mb-6">
          <h4 class="text-[10px] font-mono text-cyan-400 uppercase tracking-[0.4em] flex items-center gap-2">
            <div class="w-2 h-2 bg-cyan-400 animate-pulse" />
            TACTICAL_HIGHLIGHT_REEL_v4.2
          </h4>
          <div class="text-[9px] font-mono text-slate-500 uppercase tracking-widest">
            Total Critical Events: {{ battleHighlights.length }}
          </div>
        </div>
        
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 overflow-y-auto custom-scrollbar pr-2">
          <BattleHighlightComponent
            v-for="(h, i) in battleHighlights"
            :key="i"
            :highlight="h"
            :format-time-offset="formatTimeOffset"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="./RoundReportV2.vue.css"></style>
