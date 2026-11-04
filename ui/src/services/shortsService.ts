import { PLAY_ORIGIN } from '@/services/recordingsService'

/**
 * Replay Shorts (features/replay-shorts): 9:16 kill clips cut from the shared recordings.
 * The strip and the player live on play.bfstats.io; bfstats.io shows a few and links there.
 */

/** ShortDto (api/Shorts/Models/ShortDto.cs). `videoUrl` and `posterUrl` are relative to the API. */
export interface ReplayShort {
  slug: string
  recordingSlug: string
  kind: string
  title: string
  killer: string
  victim: string
  weapon: string
  distance: number
  lengthSeconds: number
  level: string
  mod: string
  createdAt: string
  views: number
  videoUrl: string
  posterUrl: string
  creatorName: string | null
}

/** PagedShortsDto (api/Shorts/Models/PagedShortsDto.cs). */
export interface ShortsPage {
  items: ReplayShort[]
  total: number
  page: number
  pageSize: number
}

export interface ShortsQuery {
  /** How far back, days (the API clamps it). */
  days?: number
  /** `views` for the most watched; otherwise the newest first. */
  sort?: 'views'
  page?: number
  pageSize?: number
}

export async function fetchShorts(query: ShortsQuery = {}, signal?: AbortSignal): Promise<ShortsPage> {
  const params = new URLSearchParams()
  params.set('days', String(query.days ?? 7))
  if (query.sort) params.set('sort', query.sort)
  params.set('page', String(query.page ?? 1))
  params.set('pageSize', String(query.pageSize ?? 8))
  const response = await fetch(`/stats/shorts?${params}`, { signal })
  if (!response.ok) throw new Error(`Shorts request failed: ${response.status}`)
  return response.json()
}

/** The Short open in the REPLAY tab's player. */
export function shortHref(slug: string): string {
  return `${PLAY_ORIGIN}/play/?tab=replay&short=${encodeURIComponent(slug)}`
}

/** The REPLAY tab, scrolled to nothing in particular: the Shorts strip is at its top. */
export const SHORTS_FEED = `${PLAY_ORIGIN}/play/?tab=replay`

/** A Short's kind as the strip's badge says it (play/replay-shorts.js `shortKindLabel`). */
const KINDS: Record<string, string> = {
  'air-to-air': 'Air to air',
  'ground-to-air': 'Ground to air',
  'tank-to-tank': 'Tank to tank',
  'long-shot': 'Long shot',
  'own-goal': 'Own goal',
  'spawn-death': 'Spawn and die',
  streak: 'Streak',
  creator: 'Creator',
  asmr: 'ASMR',
}

export function shortKindLabel(kind: string): string {
  return KINDS[kind] ?? 'Kill'
}
