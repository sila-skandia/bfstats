import axios from 'axios';

export interface HeatmapCell {
  dayOfWeek: number;
  hourOfDay: number;
  avgPlayers: number;
}

export interface MapTopPlacement {
  playerName: string;
  firstPlaceCount: number;
}

export interface MapRotation {
  mapName: string;
  roundsPlayed: number;
  playTimeMinutes: number;
  playTimePercentage: number;
  topPlacements: MapTopPlacement[];
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
  roundId: string;
  winningTeam: string;
}

export interface PrestigiousMilestone {
  achievementId: string;
  playerName: string;
  achievementName: string;
  description: string;
}

export interface LegendAchievement {
  achievementId: string;
  playerName: string;
  achievementName: string;
  description: string;
  value: number;
  tier: string;
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
    eliteWarriorGold: PlayerVolume | null;
    eliteWarriorLegend: PlayerVolume | null;
    mostLegendAchievements: LegendAchievement | null;
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
  killsRank: number;
  placementsRank: number;
  roundsPercentile: number;
  killsPercentile: number;
  playTimePercentile: number;
  kdPercentile: number;
}

export interface PlayerMapRank {
  metricName: string;
  mapName: string;
  metricValue: string;
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
  playerKPM: number;
  globalKPM: number;
  kpmMultiplier: number;
  totalKills: number;
  totalDeaths: number;
  kdRatio: number;
  totalScore: number;
  playTimeMinutes: number;
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
  type: string;
  value: number;
  mapName: string;
  date: string;
  estimatedDurationMinutes: number;
  serverStreakRank: number;
  roundId?: string | null;
}

export interface PlayerTeammate {
  name: string;
  sharedRounds: number;
}

export interface PlayerServerRanking {
  serverGuid: string;
  serverName: string;
  rank: number;
  totalScore: number;
  totalRankedPlayers: number;
  averagePing: number;
}

export interface PlayerRelations {
  luckyCharmName: string | null;
  luckyCharmWins: number | null;
  archNemesisName: string | null;
  archNemesisLosses: number | null;
  twoFaceName: string | null;
  twoFaceWins: number | null;
  twoFaceLosses: number | null;
}

export interface DishonourMap {
  mapName: string;
  rounds: number;
  value: number;
  playerAvg: number;
  playerBest: number;
  delta: number;
  metricLabel: string;
}

export interface PlayerDishonours {
  leastFavoriteMapByKd: DishonourMap | null;
  lowestKillRateMap: DishonourMap | null;
  mostLossesMap: DishonourMap | null;
  lowestScoreRateMap: DishonourMap | null;
  maxDeathsMap: DishonourMap | null;
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
  bestMoments: PlayerBestMoment[];
  squad: PlayerTeammate[];
  serverRankings: PlayerServerRanking[];
  relations: PlayerRelations;
  dishonours: PlayerDishonours | null;
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

export interface ProfileBestAliases {
  bestKdAliasName: string;
  bestKdValue: number;
  bestKillRateAliasName: string;
  bestKillRateValue: number;
  bestMapKdMapName: string;
  bestMapKdValue: number;
}

export interface ProfileAliasCredit {
  playerName: string;
  roundsPlayed: number;
  totalKills: number;
  totalDeaths: number;
  hoursInCombat: number;
  kdRatio: number;
}

export interface ProfileWrappedData {
  userId: number;
  year: number;
  yearInNumbers: PlayerYearInNumbers;
  trend: PlayerTrend;
  favouriteMap: PlayerFavouriteMap;
  medals: PlayerMedals;
  bestMoments: PlayerBestMoment[];
  squad: PlayerTeammate[];
  serverRankings: PlayerServerRanking[];
  relations: PlayerRelations;
  bestAliases: ProfileBestAliases;
  aliasCredits: ProfileAliasCredit[];
  dishonours: PlayerDishonours | null;
}

/**
 * Fetch the combined "Your Year in Review" Wrapped across all of a user's registered aliases.
 */
/**
 * Shape used by the shared PlayerWrappedV4 view/slides — a normal Player Wrapped response,
 * optionally carrying the profile-only fields (populated only in "Your Year in Review" mode).
 */
export type WrappedViewData = PlayerWrappedData & Partial<Pick<ProfileWrappedData, 'bestAliases' | 'aliasCredits'>>

export async function fetchProfileWrapped(userId: number, year = 2026): Promise<ProfileWrappedData> {
  const API_URL = import.meta.env.VITE_API_URL || '';
  const token = localStorage.getItem('authToken');
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await axios.get(`${API_URL}/stats/wrapped/profile/${userId}`, {
    params: { year },
    headers
  });
  return response.data;
}
