/**
 * URLs for the BF1942 map preview images extracted from the game archives and
 * served off the assets volume.
 *
 * Addressing mirrors what bflist reports for a live server, so a server record maps
 * straight onto an image with no lookup table:
 *
 *   { gameId: "fhsw", mapName: "operation coronet-1946" }
 *   -> /stats/assets/maps/fhsw/operation_coronet-1946
 *
 * The API resolves the rest — it lowercases both halves (bflist is inconsistent about
 * case, reporting the same mod as both "bf1942" and "BF1942") and walks the mod's
 * content inheritance chain, so an FHSW server reporting a base-game map still finds
 * the image. Roughly 15% of live servers run community maps that ship no art at all,
 * so every caller needs a graceful miss — see MmMapThumb.vue.
 */

export type MapImageKind = 'thumbnail' | 'minimap'

/** Normalise the way the level folder on disk is named. */
function slugify(mapName: string): string {
  return mapName.trim().toLowerCase().replace(/\s+/g, '_')
}

/**
 * Build the URL for a map image, or null when there is not enough to address one.
 * Returning null rather than a broken URL lets callers skip rendering an <img> at all.
 */
export function mapImageUrl(
  gameId: string | null | undefined,
  mapName: string | null | undefined,
  kind: MapImageKind = 'thumbnail',
): string | null {
  if (!gameId || !mapName) return null

  const mod = encodeURIComponent(gameId.trim().toLowerCase())
  const map = encodeURIComponent(slugify(mapName))
  if (!mod || !map) return null

  const query = kind === 'minimap' ? '?kind=minimap' : ''
  return `/stats/assets/maps/${mod}/${map}${query}`
}

/**
 * Stable identity for a map image, useful as a :key or for memoising which
 * images have already 404'd within a session.
 */
export function mapImageKey(
  gameId: string | null | undefined,
  mapName: string | null | undefined,
): string | null {
  if (!gameId || !mapName) return null
  return `${gameId.trim().toLowerCase()}/${slugify(mapName)}`
}

/**
 * Maps with no art are common and stable — a community map that 404s once will 404
 * for the rest of the session. Remembering them stops repeated <img> mounts (list
 * re-sorts, the 30s live refresh, pagination) from re-requesting known misses.
 */
const missing = new Set<string>()

export function isKnownMissing(key: string | null): boolean {
  return key !== null && missing.has(key)
}

export function rememberMissing(key: string | null): void {
  if (key) missing.add(key)
}
