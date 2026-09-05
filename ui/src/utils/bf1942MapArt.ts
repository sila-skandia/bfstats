import catalog from '@/data/bf1942MapArt.json'

export const THEATER_PLACEHOLDER = 'this theater'

export type Bf1942MapArt = {
  slug: string
  folder: string
  displayName: string
  ingame: string
  aliases: string[]
}

type CatalogFile = {
  maps: Bf1942MapArt[]
}

const maps = (catalog as CatalogFile).maps

const byKey = new Map<string, Bf1942MapArt>()

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_\-]+/g, ' ')
}

function compact(value: string): string {
  return normalize(value).replace(/[^a-z0-9]+/g, '')
}

function indexKey(key: string, art: Bf1942MapArt) {
  if (!key) return
  if (!byKey.has(key)) {
    byKey.set(key, art)
  }
}

for (const art of maps) {
  indexKey(art.slug, art)
  indexKey(normalize(art.slug), art)
  indexKey(compact(art.slug), art)
  indexKey(normalize(art.displayName), art)
  indexKey(compact(art.displayName), art)
  indexKey(normalize(art.folder), art)
  indexKey(compact(art.folder), art)
  for (const alias of art.aliases) {
    indexKey(normalize(alias), art)
    indexKey(compact(alias), art)
  }
}

function lookupKeys(name: string): string[] {
  const spaced = normalize(name)
  const packed = compact(name)
  const keys = [spaced, packed]
  if (spaced.startsWith('dc ')) {
    const rest = spaced.slice(3)
    keys.push(rest, compact(rest))
  } else {
    keys.push(`dc ${spaced}`, compact(`dc ${spaced}`))
  }
  return keys
}

export function volumeMapArtUrl(slug: string): string {
  return `/stats/assets/arcade/maps/${slug}/ingame.webp`
}

export function resolveMapArt(name?: string | null): Bf1942MapArt | null {
  if (!name?.trim()) return null
  for (const key of lookupKeys(name)) {
    const hit = byKey.get(key)
    if (hit) return { ...hit, ingame: volumeMapArtUrl(hit.slug) }
  }
  return null
}

export function hideBrokenTheaterImg(event: Event) {
  const img = event.target as HTMLImageElement | null
  if (!img) return
  img.hidden = true
  img.removeAttribute('src')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function concealMapName(text: string, mapName?: string | null): string {
  if (!text) return text
  const art = resolveMapArt(mapName)
  if (!art) return text

  const aliases = [...art.aliases, art.displayName, art.folder]
    .map(alias => alias.trim())
    .filter(alias => alias.length >= 3)
    .sort((a, b) => b.length - a.length)

  let result = text
  for (const alias of aliases) {
    const pattern = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'ig')
    result = result.replace(pattern, THEATER_PLACEHOLDER)
  }
  return result
}

export function theaterOptionArts(options: string[]): Array<Bf1942MapArt | null> {
  return options.map(option => resolveMapArt(option))
}

export function shouldUseTheaterTiles(options: string[]): boolean {
  if (options.length < 2) return false
  const found = theaterOptionArts(options).filter(Boolean).length
  return found >= 3 && found >= Math.ceil(options.length * 0.75)
}

export function stripMapHighlights(
  highlights: Array<string | null | undefined> | undefined
): string[] {
  return (highlights ?? []).filter((term): term is string => {
    if (!term?.trim()) return false
    return resolveMapArt(term) == null
  })
}
