/**
 * The REPLAY feed's recordings, as bfstats.io's server and player pages list them
 * (features/replay-on-stats-pages). The feed itself, and watching, live on
 * play.bfstats.io; these cards link there.
 */

/** Where the feed and the replay viewer are served. */
export const PLAY_ORIGIN = 'https://play.bfstats.io'

export interface RecordingRoundMember {
  slug: string
  uploaderName: string
  recordingUrl: string
  serverLogUrl: string | null
}

export interface RecordingRoundCard {
  recordings: number
  durationSeconds: number
  uploaders: string[]
  viewCount: number
  commentCount: number
  createdAt: string
  thumbnailUrl: string | null
  weak: boolean
}

/** RecordingSummaryDto (api/Recordings/Models/RecordingSummaryDto.cs). */
export interface RecordingSummary {
  slug: string
  title: string
  uploaderName: string
  level: string
  mod: string
  gameMode: string
  serverName: string
  recordedLocal: string
  durationSeconds: number
  playerCount: number
  viewCount: number
  commentCount: number
  createdAt: string
  recordingUrl: string
  serverLogUrl: string | null
  thumbnailUrl: string | null
  uploaderPlayer: string | null
  round: RecordingRoundMember[] | null
  roundCard: RecordingRoundCard | null
}

/** PagedRecordingsDto: `totalCount` counts cards, a round of several recordings being one. */
export interface RecordingsPage {
  items: RecordingSummary[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
}

export interface RecordingsQuery {
  /** Recorded on this server, by its name on bfstats.io. */
  server?: string
  /** Shared by this player. */
  uploader?: string
  /** This player is in the round. */
  player?: string
  page?: number
  pageSize?: number
}

export async function fetchRecordings(query: RecordingsQuery, signal?: AbortSignal): Promise<RecordingsPage> {
  const params = new URLSearchParams()
  if (query.server) params.set('server', query.server)
  if (query.uploader) params.set('uploader', query.uploader)
  if (query.player) params.set('player', query.player)
  params.set('page', String(query.page ?? 1))
  params.set('pageSize', String(query.pageSize ?? 6))
  const response = await fetch(`/stats/recordings?${params}`, { signal })
  if (!response.ok) throw new Error(`Recordings request failed: ${response.status}`)
  return response.json()
}

/** A query string whose paths keep their slashes, as the replay page writes its own. */
function readableQuery(pairs: [string, string | null | undefined][]): string {
  return pairs
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string).replace(/%2F/g, '/')}`)
    .join('&')
}

/**
 * The replay of a card: the recording, or for a round of several every recording of it
 * merged, the card's own first (as the feed's cover plays it; recordings-api.js
 * `watchHref` / `watchRoundHref`).
 */
export function watchHref(r: RecordingSummary): string {
  const lead = r.round?.find(m => m.slug === r.slug) ?? r
  const order = r.round && r.round.length > 1 ? [lead, ...r.round.filter(m => m.slug !== lead.slug)] : [lead]
  const query = readableQuery([
    ['mod', r.mod],
    ['map', r.level],
    ...order.map((m): [string, string] => ['replay', m.recordingUrl]),
    ['serverlog', lead.serverLogUrl],
  ])
  return `${PLAY_ORIGIN}/map.html?${query}`
}

/** The recording's page in the feed: its round, comments and details. */
export function recordingPageHref(slug: string): string {
  return `${PLAY_ORIGIN}/play/?tab=replay&rec=${encodeURIComponent(slug)}`
}

/** The feed narrowed to a server or an uploader. */
export function feedHref(filter: { server?: string; uploader?: string }): string {
  return `${PLAY_ORIGIN}/play/?${readableQuery([['tab', 'replay'], ['server', filter.server], ['uploader', filter.uploader]])}`
}

/** cp1252 at 0x80 to 0x9F; undefined bytes stay as they are. */
const CP1252_HIGH = '\u20AC\u0081\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u008D\u017D\u008F'
  + '\u0090\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u009D\u017E\u0178'

/**
 * A server name as a recording wrote it (each byte as U+0000 to U+00FF), in the form
 * bfstats.io has it: the bytes read as cp1252 (api/Utils/PlayerNameDecoder.FromRecording).
 * For a link to the server's page; the two differ only for a cp1252 symbol.
 */
export function serverNameFromRecording(name: string): string {
  return name.replace(/[\u0080-\u009F]/g, c => CP1252_HIGH[c.charCodeAt(0) - 0x80])
}

/** `h:mm:ss` or `m:ss`. */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

const SMALL_WORDS = new Set(['of', 'the', 'on', 'at', 'to', 'in', 'and'])

/** A level's folder as a name: `liberation_of_caen` is Liberation of Caen. */
export function levelName(level: string): string {
  return level
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word, i) => (i > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')
}

const MOD_LABELS: Record<string, string> = {
  bf1942: 'BF1942',
  xpack1: 'Road to Rome',
  xpack2: 'Secret Weapons',
  fhsw: 'FHSW',
  fhsweurope: 'FHSW',
  fh: 'FH',
  dc: 'DC',
  dc_final: 'DC Final',
  eod: 'EoD',
}

export function modLabel(mod: string): string {
  return MOD_LABELS[mod.toLowerCase()] ?? mod.toUpperCase()
}
