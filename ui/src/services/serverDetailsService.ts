import axios from 'axios';
import { ServerSummary } from '../types/server';
import { ServerRank } from '../types/playerStatsTypes';

// Define interfaces for the API response

export interface MostActivePlayer {
  kdRatio: number;
  minutesPlayed: number;
  playerName: string;
  totalDeaths: number;
  totalKills: number;
}

export interface PopularMap {
  mapName: string;
  averagePlayerCount: number;
  peakPlayerCount: number;
  totalPlayTime: number;
  playTimePercentage: number;
}

export interface TopScore {
  deaths: number;
  kills: number;
  mapName: string;
  playerName: string;
  score: number;
  killRate?: number;
  kdRatio?: number;
  totalRounds?: number;
  sessionId: number;
  timestamp: string; // ISO date string
}

export interface TopPlacement {
  rank: number;
  playerName: string;
  firstPlaces: number;
  secondPlaces: number;
  thirdPlaces: number;
  totalPlacements: number;
  placementPoints: number;
}

export interface ServerPlayerRankingItem {
  rank: number;
  playerName: string;
  minutesPlayed: number;
  totalKills: number;
  totalDeaths: number;
  kdRatio: number;
  killRate: number;
  totalScore: number;
  totalRounds: number;
  firstPlaces: number;
  secondPlaces: number;
  thirdPlaces: number;
  totalPlacements: number;
  placementPoints: number;
}

export interface ServerPlayerRankingsResponse {
  serverGuid: string;
  serverName: string;
  days: number;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  sortBy: string;
  minRounds: number;
  rankings: ServerPlayerRankingItem[];
}

export interface DistributionBand {
  label: string;
  minValue: number;
  maxValue: number | null;
  count: number;
  percentage: number;
}

export interface MetricDistribution {
  metricName: string;
  average: number;
  median: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  bands: DistributionBand[];
}

export interface ServerRankDistributionResponse {
  serverGuid: string;
  serverName: string;
  days: number;
  minRounds: number;
  totalPlayers: number;
  kdDistribution: MetricDistribution;
  scoreDistribution: MetricDistribution;
  killsDistribution: MetricDistribution;
  playTimeDistribution: MetricDistribution;
  killRateDistribution: MetricDistribution;
}

// New interfaces for server insights
export interface PingByHourData {
  timePeriod: string; // ISO date string
  averagePing: number;
  medianPing: number;
  p95Ping: number;
  hour: number;
}

export interface PingByHour {
  data: PingByHourData[];
}

export interface PlayerCountHistoryData {
  timestamp: string; // ISO date string
  playerCount: number;
  uniquePlayersStarted: number;
}

export interface PlayerCountSummary {
  averagePlayerCount: number;
  peakPlayerCount: number;
  peakTimestamp: string; // ISO date string
  changePercentFromPreviousPeriod: number;
  totalUniquePlayersInPeriod: number;
}

export interface ServerInsights {
  serverGuid: string;
  serverName: string;
  startPeriod: string; // ISO date string
  endPeriod: string; // ISO date string
  pingByHour: PingByHour;
  playerCountHistory: PlayerCountHistoryData[];
  playerCountSummary: PlayerCountSummary;
  playerCountHistoryComparison?: PlayerCountHistoryData[];
  playersOnlineHistory?: {
    dataPoints: { timestamp: string; totalPlayers: number; }[];
    insights: {
      overallAverage: number;
      rollingAverage: { timestamp: string; average: number; }[];
      trendDirection: 'increasing' | 'decreasing' | 'stable';
      percentageChange: number;
      peakPlayers: number;
      peakTimestamp: string;
      lowestPlayers: number;
      lowestTimestamp: string;
      calculationMethod?: string;
    };
    period: string;
    game: string;
    lastUpdated: string;
  };
}

export interface LeaderboardEntry {
  rank: number;
  playerName: string;
  score: number;
  kills: number;
  deaths: number;
  ping: number;
  teamLabel: string;
}

export interface LeaderboardSnapshot {
  timestamp: string; // ISO date string
  entries: LeaderboardEntry[];
}

export interface RoundInfo {
  mapName: string;
  gameType: string;
  serverName: string;
  startTime: string; // ISO date string
  endTime: string; // ISO date string
  totalParticipants: number;
  isActive: boolean;
  tickets1?: number;
  tickets2?: number;
  team1Label?: string;
  team2Label?: string;
  /** Mod the server runs (bf1942, fhsw, dc_final, ...). Addresses the map preview image. */
  gameId?: string | null;
}

export interface SessionInfo {
  sessionId: number;
  playerName: string;
  serverName: string;
  serverGuid: string;
  serverIp: string;
  serverPort: number;
  gameId: string;
  kills: number;
  deaths: number;
  score: number;
}

export interface RoundReport {
  round: RoundInfo;
  leaderboardSnapshots: LeaderboardSnapshot[];
}

export interface LeaderboardsData {
  serverGuid: string;
  serverName: string;
  timePeriod: string; // "week", "month", or "alltime"
  startPeriod: string; // ISO date string
  endPeriod: string; // ISO date string
  mostActivePlayersByTime: MostActivePlayer[];
  topScores: TopScore[];
  topKDRatios: TopScore[];
  topKillRates: TopScore[];
  topPlacements: TopPlacement[];
  weightedTopPlacements?: TopPlacement[];
  minPlayersForWeighting?: number;
}

export interface ServerDetails {
  endPeriod: string; // ISO date string
  popularMaps: PopularMap[];
  serverGuid: string;
  serverName: string;
  startPeriod: string; // ISO date string
  region?: string;
  country?: string;
  countryCode?: string;
  timezone?: string;
  serverIp?: string;
  serverPort?: number;
  gameId?: string;
}

/**
 * Fetches server details from the API
 * @param serverName The name of the server to fetch details for
 * @returns Server details
 */
export async function fetchServerDetails(
  serverName: string
): Promise<ServerDetails> {
  try {
    const url = `/stats/servers/${encodeURIComponent(serverName)}`;
    const response = await axios.get<ServerDetails>(url);
    return response.data;
  } catch (err) {
    console.error('Error fetching server details:', err);
    throw new Error('Failed to get server details');
  }
}

export interface ServerMapsInsightsResponse {
  serverGuid?: string;
  serverName: string;
  startPeriod: string;
  endPeriod: string;
  maps: PopularMap[];
}

/**
 * Fetches aggregated map popularity for a server over the given window.
 * Backed by the SQLite `ServerMapStats` table, summed across months within
 * the period. Sorted by total playtime descending.
 *
 * Note: `ServerDetails.popularMaps` is a dead field — the backend never
 * populated it. Use this endpoint instead.
 */
export async function fetchServerMapsInsights(
  serverName: string,
  days: number = 30,
): Promise<ServerMapsInsightsResponse> {
  try {
    const url = `/stats/servers/${encodeURIComponent(serverName)}/maps-insights`;
    const response = await axios.get<ServerMapsInsightsResponse>(url, { params: { days } });
    return response.data;
  } catch (err) {
    console.error('Error fetching server maps insights:', err);
    throw new Error('Failed to get server maps insights');
  }
}

/**
 * Fetches server leaderboards from the API
 * @param serverName The name of the server to fetch leaderboards for
 * @param timePeriod The time period: 'week', 'month', or 'alltime'
 * @param minPlayersForWeighting Optional minimum players required for weighted placements
 * @param minRoundsForKillBoards Optional minimum rounds required for kill rate and K/D ratio leaderboards
 * @returns Server leaderboards data
 */
export async function fetchServerLeaderboards(
  serverName: string,
  timePeriod: 'week' | 'month' | 'alltime',
  minPlayersForWeighting?: number,
  minRoundsForKillBoards?: number
): Promise<LeaderboardsData> {
  try {
    const params = new URLSearchParams();

    // Map time period to API parameter
    if (timePeriod === 'alltime') {
      // Calculate days from current date back to Jan 1, 2025
      const startDate = new Date('2025-01-01');
      const today = new Date();
      const diffTime = Math.abs(today.getTime() - startDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      params.set('days', diffDays.toString());
    } else if (timePeriod === 'week') {
      params.set('days', '7');
    } else if (timePeriod === 'month') {
      params.set('days', '30');
    }

    if (minPlayersForWeighting !== undefined) {
      params.set('minPlayersForWeighting', minPlayersForWeighting.toString());
    }

    if (minRoundsForKillBoards !== undefined) {
      params.set('minRoundsForKillBoards', minRoundsForKillBoards.toString());
    }

    const url = `/stats/v2/servers/${encodeURIComponent(serverName)}/leaderboards?${params.toString()}`;
    const response = await axios.get<LeaderboardsData>(url);
    return response.data;
  } catch (err) {
    console.error('Error fetching server leaderboards:', err);
    throw new Error('Failed to get server leaderboards');
  }
}

/**
 * Fetches paged player rankings for a server with customizable sorting, search, and min rounds.
 */
export async function fetchServerPlayerRankings(
  serverName: string,
  page: number = 1,
  pageSize: number = 20,
  sortBy: string = 'active',
  days: number = 30,
  minRounds: number = 1,
  searchQuery?: string
): Promise<ServerPlayerRankingsResponse> {
  try {
    const params = new URLSearchParams({
      page: page.toString(),
      pageSize: pageSize.toString(),
      sortBy,
      days: days.toString(),
      minRounds: minRounds.toString(),
    });
    if (searchQuery) {
      params.set('searchQuery', searchQuery);
    }
    const url = `/stats/v2/servers/${encodeURIComponent(serverName)}/player-rankings?${params.toString()}`;
    const response = await axios.get<ServerPlayerRankingsResponse>(url);
    return response.data;
  } catch (err) {
    console.error('Error fetching server player rankings:', err);
    throw new Error('Failed to get server player rankings');
  }
}

/**
 * Fetches rank distributions across K/D, Score, Kills, Hours, and Kill rate with server averages and P95s.
 */
export async function fetchServerRankDistribution(
  serverName: string,
  days: number = 30,
  minRounds: number = 1
): Promise<ServerRankDistributionResponse> {
  try {
    const params = new URLSearchParams({
      days: days.toString(),
      minRounds: minRounds.toString(),
    });
    const url = `/stats/v2/servers/${encodeURIComponent(serverName)}/rank-distribution?${params.toString()}`;
    const response = await axios.get<ServerRankDistributionResponse>(url);
    return response.data;
  } catch (err) {
    console.error('Error fetching server rank distribution:', err);
    throw new Error('Failed to get server rank distribution');
  }
}

/**
 * Fetches server insights from the API
 * @param serverName The name of the server to fetch insights for
 * @param period The time period for insights (7d, 1m, 3m, 6m, 1y)
 * @returns Server insights including ping data
 */
export async function fetchServerInsights(
  serverName: string,
  period: number = 1,
  rollingWindow: string = '7d'
): Promise<ServerInsights> {
  try {
    // Convert rolling window to days (e.g., '7d' -> 7)
    const rollingWindowDays = parseInt(rollingWindow.replace('d', ''));
    
    // Make the request to the API endpoint
    const response = await axios.get<ServerInsights>(`/stats/servers/${encodeURIComponent(serverName)}/insights`, {
      params: { 
        days: period,
        rollingWindowDays: rollingWindowDays
      }
    });

    // Return the response data
    return response.data;
  } catch (err) {
    console.error('Error fetching server insights:', err);
    throw new Error('Failed to get server insights');
  }
}

/**
 * Fetches round report for a specific round
 * @param roundId The ID of the round
 * @returns Round report with leaderboard snapshots and achievements
 */
export async function fetchRoundReport(roundId: string): Promise<RoundReport> {
  try {
    // Make the request to the API endpoint
    const response = await axios.get<RoundReport>(`/stats/rounds/${encodeURIComponent(roundId)}/report`);

    // Return the response data
    return response.data;
  } catch (err) {
    console.error('Error fetching round report:', err);
    throw new Error('Failed to get round report');
  }
}

/**
 * Fetches server rankings by total playtime for the last N days
 * @param serverGuids List of server GUIDs to get rankings for
 * @param days Number of days to look back (default: 30)
 * @returns List of server rankings
 */
export async function fetchServerRankings(
  serverGuids: string[],
  days: number = 30
): Promise<ServerRank[]> {
  try {
    const params = new URLSearchParams();
    serverGuids.forEach(guid => params.append('serverGuids', guid));
    params.set('days', days.toString());

    const response = await axios.get<ServerRank[]>(
      `/stats/servers/rankings?${params.toString()}`
    );

    return response.data;
  } catch (err) {
    console.error('Error fetching server rankings:', err);
    throw new Error('Failed to get server rankings');
  }
}

// API response interface for servers endpoint
interface ServersResponse {
  servers: ServerSummary[];
  lastUpdated: string;
}

// What the landing page actually needs to know: the servers, and how old that data
// really is. lastUpdated comes from the API's own fetch timestamp against BFList — not
// "when this request happened" — so it reflects the underlying data's true age even when
// served from cache or a last-known-good fallback.
export interface LiveServersResult {
  servers: ServerSummary[];
  lastUpdated: string;
}

// Last successful live-server snapshot. Survives SPA navigations so the
// landing page can paint immediately, then this function always revalidates.
let cachedLiveServers: LiveServersResult | null = null

export function peekCachedLiveServers(): LiveServersResult | null {
  return cachedLiveServers
}

function rememberLiveServers(result: LiveServersResult): LiveServersResult {
  cachedLiveServers = result
  return result
}

/**
 * Fetches all servers from the live-server feed.
 * Always revalidates with the network (Cloudflare may still HIT via s-maxage).
 * The in-memory snapshot from {@link peekCachedLiveServers} is for instant
 * paint only — it is never returned in place of a request.
 */
export async function fetchAllServers(
  game: 'bf1942'
): Promise<LiveServersResult> {
  try {
    // index.html kicks this request off during HTML parse for the landing route,
    // well before this module has even been downloaded. Consume that response if
    // it's there. Cleared after the first read so the 30s refresh timer and any
    // later navigation go to the network as normal.
    if (game === 'bf1942' && typeof window !== 'undefined' && window.__bfLiveServersPreload) {
      const preload = window.__bfLiveServersPreload;
      window.__bfLiveServersPreload = undefined;
      const preloaded = await preload;
      if (preloaded?.servers) {
        return rememberLiveServers({
          servers: preloaded.servers,
          lastUpdated: preloaded.lastUpdated ?? new Date().toISOString(),
        });
      }
    }

    // cache: 'no-cache' forces a revalidation. Axios/XHR will happily return
    // a browser-cached body when the response carries stale-while-revalidate,
    // which is why banner-back showed frozen player counts until a reload.
    const response = await fetch(`/stats/liveservers/${game}/servers`, {
      cache: 'no-cache',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error('Failed to get all servers');
    }
    const body = (await response.json()) as ServersResponse;
    return rememberLiveServers({ servers: body.servers, lastUpdated: body.lastUpdated });
  } catch (err) {
    console.error('Error fetching all servers:', err);
    throw new Error('Failed to get all servers');
  }
}

// A single server row from /stats/servers/search (ServerBasicInfo). Covers
// every tracked server (online or not), unlike the live-only fetchAllServers.
export interface ServerSearchItem {
  serverGuid: string;
  serverName: string;
  gameId: string;
  serverIp: string;
  serverPort: number;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  timezone?: string | null;
  totalActivePlayersLast24h: number;
  totalPlayersAllTime: number;
  currentMap?: string | null;
  hasActivePlayers: boolean;
  lastActivity?: string | null;
}

export interface PagedServers {
  items: ServerSearchItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/**
 * Search all tracked servers by name (paginated). Backs the /v4/servers/search
 * page — mirrors the players search but over the server registry, so it finds
 * offline / historical servers too.
 */
export async function searchServers(
  query: string,
  page = 1,
  pageSize = 25,
  game: 'bf1942' = 'bf1942'
): Promise<PagedServers> {
  const response = await axios.get<PagedServers>('/stats/servers/search', {
    params: { query: query.trim(), game, page, pageSize },
  });
  return response.data;
}

/**
 * Fetches live server data from backend API using cached endpoint
 * @param serverIp The IP address of the server
 * @param serverPort The port of the server
 * @returns Live server information including current leaderboard
 */
export async function fetchLiveServerData(
  serverIp: string,
  serverPort: number
): Promise<ServerSummary> {
  try {
    const game = 'bf1942';

    // cache: 'no-cache' forces a revalidation so the browser does not return a stale
    // cached body when navigating across pages or refreshing.
    const response = await fetch(`/stats/liveservers/${game}/${serverIp}/${serverPort}`, {
      cache: 'no-cache',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error('Failed to get live server data');
    }
    return (await response.json()) as ServerSummary;
  } catch (err) {
    console.error('Error fetching live server data:', err);
    throw new Error('Failed to get live server data');
  }
}

// === Server Busy Indicator / Trends (per-server) ===

export type BusyLevel = 'very_busy' | 'busy' | 'moderate' | 'quiet' | 'very_quiet';

export interface ServerBusyHistoricalRange {
  min: number;
  q25: number;
  median: number;
  q75: number;
  q90: number;
  max: number;
  average: number;
}

export interface ServerBusyIndicator {
  busyLevel: BusyLevel;
  busyText: string;
  currentPlayers: number;
  typicalPlayers: number;
  percentile: number;
  historicalRange: ServerBusyHistoricalRange;
  generatedAt: string; // ISO datetime
}

export interface ServerHourlyTimelineEntry {
  hour: number; // UTC hour 0-23
  typicalPlayers: number;
  busyLevel: BusyLevel;
  isCurrentHour: boolean;
}

export interface ServerBusyIndicatorResult {
  serverGuid: string;
  serverName: string;
  game: string;
  busyIndicator: ServerBusyIndicator;
  hourlyTimeline: ServerHourlyTimelineEntry[];
}

export interface ServerBusyIndicatorResponse {
  serverResults: ServerBusyIndicatorResult[];
  generatedAt: string;
}

/**
 * Fetch busy indicators and hourly timelines for a list of server GUIDs.
 * The API expects repeated serverGuids query params (no [] array notation).
 */
export async function fetchServerBusyIndicators(serverGuids: string[]): Promise<ServerBusyIndicatorResponse> {
  if (!serverGuids || serverGuids.length === 0) {
    return { serverResults: [], generatedAt: new Date().toISOString() };
  }

  // Build query string with repeated keys
  const query = serverGuids.map(g => `serverGuids=${encodeURIComponent(g)}`).join('&');
  const url = `/stats/v2/game-trends/busy-indicator?${query}`;

  try {
    const response = await axios.get<ServerBusyIndicatorResponse>(url);
    return response.data;
  } catch (err) {
    console.error('Error fetching server busy indicators:', err);
    throw new Error('Failed to get server busy indicators');
  }
}

export interface ServerWeeklyPatternSlot {
  dayOfWeek: number;
  hourOfDay: number;
  avgPlayers: number;
  maxPlayers: number;
  medianPlayers: number;
  dataPoints: number;
}

export interface ServerWeeklyPatternResponse {
  serverGuid: string;
  serverName?: string;
  peakDayOfWeek?: number;
  peakHourOfDay?: number;
  peakAvgPlayers: number;
  overallAvgPlayers: number;
  totalDataPoints: number;
  slots: ServerWeeklyPatternSlot[];
}

export async function fetchServerWeeklyPattern(serverGuid: string): Promise<ServerWeeklyPatternResponse> {
  const url = `/stats/v2/game-trends/servers/${encodeURIComponent(serverGuid)}/weekly-pattern`;
  try {
    const response = await axios.get<ServerWeeklyPatternResponse>(url);
    return response.data;
  } catch (err) {
    console.error('Error fetching server weekly pattern:', err);
    throw new Error('Failed to get server weekly pattern');
  }
}