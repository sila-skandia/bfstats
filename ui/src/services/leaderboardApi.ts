import axios from 'axios'

export interface LeaderboardPlayerServer {
  guid: string
  name: string
  shortName: string
  country: string
  flag: string
  kills: number
  deaths: number
  kd: number
  score: number
  kpm: number
  playMin: number
  rounds: number
}

export interface LeaderboardPlayer {
  rank: number
  name: string
  tag: string
  kills: number
  deaths: number
  kd: number
  score: number
  kpm: number
  playMin: number
  rounds: number
  lastSeen?: string
  favServer?: string
  favServerGuid?: string
  favServerCountry?: string
  favServerFlag?: string
  favMap?: string
  isActive?: boolean
  currentServer?: string
  servers?: LeaderboardPlayerServer[]
}

export interface LeaderboardServer {
  guid: string
  name: string
  shortName: string
  country: string
  flag: string
  playerCount: number
  avgPlayers?: number
  isPopulated?: boolean
}

export interface LeaderboardMap {
  name: string
  displayName: string
  playerCount: number
}

export interface LeaderboardParams {
  page?: number
  pageSize?: number
  sortBy?: string
  sortDir?: 'asc' | 'desc'
  q?: string
  server?: string
  exclude?: string
  populatedOnly?: boolean
  map?: string
  player?: string
  days?: number
  minRounds?: number
  minPlay?: number
  game?: string
  groupBy?: string
}

export interface LeaderboardResponse {
  days: number
  minRounds: number
  minPlay: number
  server?: string
  exclude?: string
  populatedOnly?: boolean
  map?: string
  player?: string
  searchQuery?: string
  groupBy?: string
  sortBy: string
  sortDir: string
  page: number
  pageSize: number
  totalPages: number
  totalPlayers: number
  players: LeaderboardPlayer[]
  servers: LeaderboardServer[]
  maps: LeaderboardMap[]
  generatedAt: string
}

/**
 * Fetches the global player leaderboard with server-side pagination, sorting, search, and filters.
 */
export async function fetchLeaderboard(params: LeaderboardParams = {}): Promise<LeaderboardResponse> {
  try {
    const response = await axios.get<LeaderboardResponse>('/stats/leaderboard', {
      params: {
        page: params.page ?? 1,
        pageSize: params.pageSize ?? 25,
        sortBy: params.sortBy ?? 'score',
        sortDir: params.sortDir ?? 'desc',
        q: params.q?.trim() || undefined,
        server: params.server?.trim() || undefined,
        exclude: params.exclude?.trim() || undefined,
        populatedOnly: params.populatedOnly ? true : undefined,
        map: params.map?.trim() || undefined,
        player: params.player?.trim() || undefined,
        days: params.days ?? 30,
        minRounds: params.minRounds ?? 1,
        minPlay: params.minPlay ?? 0,
        game: params.game ?? 'bf1942',
        groupBy: params.groupBy?.trim() || undefined
      }
    })
    return response.data
  } catch (err) {
    console.error('Error fetching leaderboard data:', err)
    throw new Error('Failed to load leaderboard data')
  }
}

/**
 * Searches available maps for the leaderboard map picker on the fly.
 */
export async function fetchLeaderboardMaps(query?: string, limit = 50): Promise<string[]> {
  try {
    const response = await axios.get<string[]>('/stats/leaderboard/maps', {
      params: {
        q: query?.trim() || undefined,
        limit
      }
    })
    return response.data || []
  } catch (err) {
    console.error('Error fetching leaderboard maps:', err)
    return []
  }
}

/**
 * Searches available player names for the leaderboard player picker on the fly.
 */
export async function fetchLeaderboardPlayers(query?: string, limit = 50): Promise<string[]> {
  try {
    const response = await axios.get<string[]>('/stats/leaderboard/players', {
      params: {
        q: query?.trim() || undefined,
        limit
      }
    })
    return response.data || []
  } catch (err) {
    console.error('Error fetching leaderboard players:', err)
    return []
  }
}
