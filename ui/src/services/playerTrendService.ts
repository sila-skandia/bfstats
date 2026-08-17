import axios from 'axios'

export interface PlayerTrendPoint {
  timestamp: string
  avgPlayers: number
  peakPlayers: number
}

export interface PlayerTrendResponse {
  scope: 'network' | 'server' | string
  game: string | null
  serverGuid: string | null
  start: string
  end: string
  serverCount: number
  points: PlayerTrendPoint[]
}

const TREND_DAYS = 60

export async function fetchNetworkPlayerTrend(
  game: string = 'bf1942',
  days: number = TREND_DAYS,
): Promise<PlayerTrendResponse> {
  const response = await axios.get<PlayerTrendResponse>('/stats/v2/game-trends/player-trend', {
    params: { game, days },
  })
  return response.data
}

export async function fetchServerPlayerTrend(
  serverGuid: string,
  days: number = TREND_DAYS,
): Promise<PlayerTrendResponse> {
  const response = await axios.get<PlayerTrendResponse>(
    `/stats/v2/game-trends/player-trend/server/${encodeURIComponent(serverGuid)}`,
    { params: { days } },
  )
  return response.data
}
