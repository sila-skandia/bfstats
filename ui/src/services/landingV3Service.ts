import axios from 'axios'

export interface LiveRoundTopPlayer {
  playerName: string
  score: number
  kills: number
  deaths: number
  team: number
}

export interface LiveRoundSummary {
  roundId: string
  serverGuid: string
  serverName: string
  serverCountry?: string | null
  mapName: string
  gameType: string
  game: string
  startTime: string
  minutesElapsed: number
  roundTimeRemain?: number | null
  currentPlayers: number
  maxPlayers: number
  tickets1?: number | null
  tickets2?: number | null
  team1Label?: string | null
  team2Label?: string | null
  dramaScore: number
  topPlayers: LiveRoundTopPlayer[]
}

export interface RecentRoundMvp {
  playerName: string
  score: number
  kills: number
  deaths: number
}

export interface RecentRoundSummary {
  roundId: string
  serverGuid: string
  serverName: string
  mapName: string
  gameType: string
  game: string
  startTime: string
  endTime: string
  durationMinutes: number
  participantCount: number
  tickets1?: number | null
  tickets2?: number | null
  team1Label?: string | null
  team2Label?: string | null
  winnerLabel?: string | null
  ticketMargin?: number | null
  mvp?: RecentRoundMvp | null
}

export interface NetworkPulseHourlyPoint {
  hourUtc: string
  avgPlayers: number
  peakPlayers: number
}

export interface NetworkPulseHeatmapCell {
  dayOfWeek: number
  hourOfDay: number
  avgPlayers: number
}

export interface NetworkPulsePeakInfo {
  avgPlayers: number
  peakPlayers: number
  hourUtc: string
}

export interface NetworkPulseResponse {
  game: string | null
  generatedAt: string
  recentTrend: NetworkPulseHourlyPoint[]
  weeklyHeatmap: NetworkPulseHeatmapCell[]
  peakToday?: NetworkPulsePeakInfo | null
  peakWeek?: NetworkPulsePeakInfo | null
}

export async function fetchLiveRounds(game?: string, limit: number = 12): Promise<LiveRoundSummary[]> {
  const params: Record<string, string> = { limit: String(limit) }
  if (game) params.game = game
  const response = await axios.get<LiveRoundSummary[]>('/stats/rounds/live', { params })
  return response.data
}

export async function fetchRecentRoundSummaries(game?: string, limit: number = 10, hoursBack: number = 6, minPlayers: number = 1): Promise<RecentRoundSummary[]> {
  const params: Record<string, string> = { limit: String(limit), hoursBack: String(hoursBack), minPlayers: String(minPlayers) }
  if (game) params.game = game
  const response = await axios.get<RecentRoundSummary[]>('/stats/rounds/recent-summaries', { params })
  return response.data
}

export async function fetchNetworkPulse(game?: string, trendHours: number = 12): Promise<NetworkPulseResponse> {
  const params: Record<string, string> = { trendHours: String(trendHours) }
  if (game) params.game = game
  const response = await axios.get<NetworkPulseResponse>('/stats/landing/network-pulse', { params })
  return response.data
}
