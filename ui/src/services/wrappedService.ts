import axios from 'axios';

export interface HeatmapCell {
  dayOfWeek: number;
  hourOfDay: number;
  avgPlayers: number;
}

export interface MapRotation {
  mapName: string;
  roundsPlayed: number;
  playTimeMinutes: number;
  playTimePercentage: number;
}

export interface PlayerKDRatio {
  playerName: string;
  rounds: number;
  kills: number;
  deaths: number;
  kdRatio: number;
  rank: number;
}

export interface PlayerKillRate {
  playerName: string;
  rounds: number;
  kills: number;
  playTimeMinutes: number;
  killRate: number;
  rank: number;
}

export interface PlayerVolume {
  playerName: string;
  value: number;
}

export interface StreakOfTheYear {
  playerName: string;
  streak: number;
  mapName: string;
  date: string;
}

export interface PlayerLossRate {
  playerName: string;
  rounds: number;
  losses: number;
  lossRate: number;
}

export interface PlayerAvgPing {
  playerName: string;
  sessions: number;
  avgPing: number;
}

export interface ClosestBattle {
  mapName: string;
  date: string;
  playersCount: number;
  ticketsMargin: number;
  durationMinutes: number;
}

export interface PrestigiousMilestone {
  achievementId: string;
  playerName: string;
  achievementName: string;
  description: string;
}

export interface ServerWrappedData {
  serverGuid: string;
  serverName: string;
  year: number;
  yearInNumbers: {
    roundsFought: number;
    uniqueSoldiers: number;
    hoursInCombat: number;
    peakPopulation: number;
    peakTimestamp: string;
    totalDecorations: number;
  };
  busiestHours: {
    heatmapCells: HeatmapCell[];
    hourlyAverages: number[];
  };
  rotation: {
    maps: MapRotation[];
    mostPlayedMapName: string;
    mostPlayedRounds: number;
    mostPlayedPercentage: number;
  };
  honours: {
    topKDRatios: PlayerKDRatio[];
    topKillRates: PlayerKillRate[];
    volumeBoards: {
      topScore: PlayerVolume;
      topKills: PlayerVolume;
      topHours: PlayerVolume;
    };
  };
  decorations: {
    mostStreaksOf25: PlayerVolume;
    streakOfTheYear: StreakOfTheYear | null;
    mostPodiumFinishes: PlayerVolume;
    milestonesCrossed: number;
    prestigiousMilestone: PrestigiousMilestone | null;
  };
  dishonours: {
    cannonFodder: PlayerVolume;
    hardLuck: PlayerLossRate | null;
    dialUp: PlayerAvgPing | null;
    statTourist: PlayerKDRatio | null;
  };
  closestBattles: ClosestBattle[];
}

/**
 * Fetch Server Wrapped data for a given server GUID.
 * Access is restricted to users with the Admin role on the backend, so we attach the token.
 */
export async function fetchServerWrapped(serverGuid: string, year = 2026): Promise<ServerWrappedData> {
  const API_URL = import.meta.env.VITE_API_URL || '';
  const token = localStorage.getItem('authToken');
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await axios.get(`${API_URL}/stats/wrapped/server/${serverGuid}`, {
    params: { year },
    headers
  });
  return response.data;
}

export interface PlayerYearInNumbers {
  roundsPlayed: number;
  totalKills: number;
  totalDeaths: number;
  hoursInCombat: number;
  kdRatio: number;
  serverRank: number;
}

export interface PlayerMapRank {
  rank: number;
  mapName: string;
  totalRounds: number;
}

export interface PlayerTrend {
  monthlyKDs: number[];
  monthlyKillRates: number[];
  topMaps: PlayerMapRank[];
}

export interface PlayerMapProgress {
  mapName: string;
  rounds: number;
  playTimePercentage: number;
  barColor: string;
}

export interface PlayerFavouriteMap {
  mapName: string;
  rounds: number;
  winRate: number;
  topMaps5: PlayerMapProgress[];
  homeServerName: string;
  homeServerLocation: string;
}

export interface PlayerAchievementTypeCount {
  type: string;
  count: number;
}

export interface PlayerAchievementCount {
  achievementId: string;
  name: string;
  type: string;
  tier: string;
  count: number;
}

export interface PlayerMedals {
  killStreaks25: number;
  podiumFinishes: number;
  eliteWarriorBadgeName: string;
  eliteWarriorTier: string;
  bestStreak: number;
  lifetimeMilestoneText: string;
  achievementTypes?: PlayerAchievementTypeCount[];
  achievementsBreakdown?: PlayerAchievementCount[];
}

export interface PlayerBestMoment {
  streak: number;
  mapName: string;
  date: string;
  estimatedDurationMinutes: number;
  serverStreakRank: number;
}

export interface PlayerTeammate {
  name: string;
  sharedRounds: number;
}

export interface PlayerWrappedData {
  playerName: string;
  serverGuid: string;
  serverName: string;
  year: number;
  yearInNumbers: PlayerYearInNumbers;
  trend: PlayerTrend;
  favouriteMap: PlayerFavouriteMap;
  medals: PlayerMedals;
  bestMoment: PlayerBestMoment;
  squad: PlayerTeammate[];
}

/**
 * Fetch Player Wrapped data for a given player name and optional server GUID.
 * If serverGuid is omitted or set to 'global', it fetches the cross-server wrapped.
 */
export async function fetchPlayerWrapped(playerName: string, serverGuid = 'global', year = 2026): Promise<PlayerWrappedData> {
  const API_URL = import.meta.env.VITE_API_URL || '';
  const token = localStorage.getItem('authToken');
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const endpoint = serverGuid === 'global' 
    ? `${API_URL}/stats/wrapped/player/${playerName}` 
    : `${API_URL}/stats/wrapped/player/${playerName}/${serverGuid}`;

  const response = await axios.get(endpoint, {
    params: { year },
    headers
  });
  return response.data;
}
