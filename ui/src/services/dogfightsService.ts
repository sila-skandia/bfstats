import { PLAY_ORIGIN, readableQuery } from '@/services/recordingsService'
import { decodePlayerName } from '@/utils/playerName'

/**
 * Recorded dogfights (features/dogfights-on-stats-pages): the fights the dogfight school finds
 * in the shared recordings (features/dogfight-recordings), narrowed by the API to a server or a
 * pilot. The school and the 3D replay live on play.bfstats.io; bfstats.io lists and links there.
 */

/** DogfightSideDto (api/Dogfights/Models). `name` is the recording's bytes. */
export interface DogfightSide {
  name: string
  team: number
  tmpl: string | null
  aimed: number
  hits: number
  turned: number
  gunner?: number | null
}

export interface DogfightEnd {
  why: string
  t: number | null
  side: number | null
  by?: { name: string | null; weapon: string | null } | null
}

/** DogfightDto (api/Dogfights/Models/DogfightDto.cs). */
export interface Dogfight {
  id: string
  slug: string
  mod: string
  level: string
  /** `yyyy-mm-dd`, the recording's date. */
  recorded: string | null
  serverName: string
  source: string | null
  duration: number
  kind: 'dogfight' | 'bounce' | string
  mutual: boolean
  closest: number | null
  kill: { side: number; t: number; weapon: string | null } | null
  end: DogfightEnd | null
  sides: DogfightSide[]
  clip: boolean
}

/** PagedDogfightsDto. `dogfights` and `kills` count every match, whatever `kind` narrowed. */
export interface DogfightsPage {
  items: Dogfight[]
  total: number
  page: number
  pageSize: number
  dogfights: number
  kills: number
}

export interface DogfightsQuery {
  server?: string
  player?: string
  kind?: 'dogfight' | 'bounce'
  page?: number
  pageSize?: number
}

export async function fetchDogfights(query: DogfightsQuery, signal?: AbortSignal): Promise<DogfightsPage> {
  const params = new URLSearchParams()
  if (query.server) params.set('server', query.server)
  if (query.player) params.set('player', query.player)
  if (query.kind) params.set('kind', query.kind)
  params.set('page', String(query.page ?? 1))
  params.set('pageSize', String(query.pageSize ?? 6))
  const response = await fetch(`/stats/dogfights?${params}`, { signal })
  if (!response.ok) throw new Error(`Dogfights request failed: ${response.status}`)
  return response.json()
}

/** The fight in the dogfight school's theatre: both paths, the shots, the energy, the words. */
export function schoolHref(id: string): string {
  return `${PLAY_ORIGIN}/dogfight.html?fight=${encodeURIComponent(id)}`
}

/** The fight's own slice of the recording in the 3D replay, where it was kept (`clip`). */
export function fightReplayHref(f: Dogfight): string {
  return `${PLAY_ORIGIN}/map.html?${readableQuery([
    ['mod', f.mod],
    ['map', f.level],
    ['replay', `/replays/dogfights/${f.id}.ndjson`],
    ['clip', '1'],
    ['school', f.id],
  ])}`
}

/** A plane template as people say it (viewer/dogfight-lines.js `planeName`). */
export function planeName(tmpl: string | null | undefined): string {
  return String(tmpl || 'plane').replace(/_/g, ' ')
}

/** The two pilots, the kill's maker first: who downed whom, or who met whom. */
export function fightTitle(f: Dogfight): string {
  const first = f.kill?.side ?? 0
  const a = f.sides[first]
  const b = f.sides[1 - first]
  const pilot = (s: DogfightSide) => `${decodePlayerName(s.name)} (${planeName(s.tmpl)})`
  return `${pilot(a)} ${f.kill ? 'downs' : 'v'} ${pilot(b)}`
}

/** Why the fight stopped, in a list's words (viewer/dogfight-lines.js `endingWords().short`). */
export function endingShort(f: Dogfight): string | null {
  const end = f.end
  if (!end) return null
  const names = f.sides.map(s => decodePlayerName(s.name))
  const side = end.side ?? 0
  const who = names[side] ?? 'pilot'
  const other = names[1 - side] ?? 'pilot'
  const at = Number.isFinite(end.t) ? ` at ${(end.t as number).toFixed(1)} s` : ''
  switch (end.why) {
    case 'shot down': return `${other} shot ${who} down${at}`
    case 'downed by another': {
      const by = decodePlayerName(end.by?.name ?? '') || 'someone else'
      const gun = end.by?.weapon ? ` with the ${planeName(end.by.weapon)}` : ''
      return `${who} shot down by ${by}${gun}${at}`
    }
    case 'died': return `${who} went down${at}`
    case 'left his plane': return `${who} left their plane${at}`
    case 'out of range': return `${who} flew out of the recorder's range${at}`
    case 'apart': return `They broke off${at}`
    case 'quiet': return `Circling, nobody firing${at}`
    default: return null
  }
}

/** A fight's length: `13.6 s` under a minute, `1:04` over. */
export function fightLength(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const s = Math.round(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// --- the landing page ---------------------------------------------------------

/** ServerMediaItemDto (api/ServerMedia/Models). `imageUrl` is relative to the API, or null. */
export interface ServerMediaItem {
  kind: 'short' | 'replay' | 'dogfight'
  id: string
  title: string
  imageUrl: string | null
  mod: string
  level: string
  seconds: number
  at: string | null
}

/** ServerMediaDto: `serverName` is the site's form, as the server list has it. */
export interface ServerMedia {
  serverName: string
  shorts: number
  replays: number
  dogfights: number
  items: ServerMediaItem[]
}

export async function fetchServerMedia(perServer = 3, signal?: AbortSignal): Promise<ServerMedia[]> {
  const response = await fetch(`/stats/server-media?perServer=${perServer}`, { signal })
  if (!response.ok) throw new Error(`Server media request failed: ${response.status}`)
  const body: { servers: ServerMedia[] } = await response.json()
  return body.servers ?? []
}
