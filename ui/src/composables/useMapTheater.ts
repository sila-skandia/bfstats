import { computed, unref, type MaybeRef } from 'vue'
import rawTheaterData from '@/data/mapTheaters.json'

export interface TheaterData {
  key: string
  title: string
  category: string
  image: string
  imageUrl: string
  pngUrl: string
}

export interface MapTheaterData {
  slug: string
  mapName: string
  theaterKey: string
  theaterCategory: string
  theaterTitle: string
  image: string
  imageUrl: string
  pngUrl: string
  aliases?: string[]
  dcTheaterKey?: string
  dcImageUrl?: string
  dcTheaterTitle?: string
  loadPicture?: string
}

export interface MapTheaterInfo {
  slug: string
  mapName: string
  theaterKey: string
  theaterCategory: string
  theaterTitle: string
  image: string
  imageUrl: string
  pngUrl: string
  isDesertCombat: boolean
  backgroundStyle: {
    backgroundImage: string
    backgroundSize: string
    backgroundPosition: string
    backgroundRepeat: string
  }
}

interface TheatersJsonStructure {
  version: number
  theaters: Record<string, TheaterData>
  maps: Record<string, MapTheaterData>
}

const data = rawTheaterData as unknown as TheatersJsonStructure
const theatersMap = data.theaters
const mapsMap = data.maps

/**
 * Normalise map strings to match mapTheaters keys.
 */
export function normalizeMapSlug(mapName: string): string {
  return mapName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/**
 * Check whether gameId refers to Desert Combat.
 */
function isDcMod(gameId?: string | null): boolean {
  if (!gameId) return false
  const g = gameId.toLowerCase()
  return g.startsWith('dc') || g.includes('desertcombat')
}

/**
 * Default fallback theater when no specific theater can be matched.
 */
export const DEFAULT_THEATER: TheaterData = theatersMap['western'] || {
  key: 'western',
  title: 'Western Europe — Atlantic Wall',
  category: 'Western Europe',
  image: 'western.webp',
  imageUrl: '/stats/assets/theaters/western.webp',
  pngUrl: '/stats/assets/theaters/western.png',
}

/**
 * Resolve theater artwork, titles, and lore for a given map and mod.
 *
 * @param mapName Display name, slug, or bflist mapName (e.g. "Wake Island", "wake", "El Alamein")
 * @param gameId Mod identifier (e.g. "bf1942", "dc_final", "desertcombat")
 * @returns MapTheaterInfo containing image URLs, title, lore description, and CSS backgroundStyle
 */
export function getMapTheater(
  mapName?: string | null,
  gameId?: string | null,
): MapTheaterInfo | null {
  if (!mapName || !mapName.trim()) {
    return null
  }

  const slug = normalizeMapSlug(mapName)
  const isDc = isDcMod(gameId)

  // 1. Direct slug match in maps catalog
  let mapEntry: MapTheaterData | undefined = mapsMap[slug]

  // 2. Search aliases if not found directly
  if (!mapEntry) {
    for (const key of Object.keys(mapsMap)) {
      const candidate = mapsMap[key]
      if (
        candidate.slug === slug ||
        (candidate.aliases && candidate.aliases.includes(slug)) ||
        candidate.mapName.toLowerCase() === mapName.trim().toLowerCase()
      ) {
        mapEntry = candidate
        break
      }
    }
  }

  // 3. Keyword matching for community / variant maps
  if (!mapEntry) {
    const rawLower = mapName.toLowerCase()
    const keywordMap: Record<string, string> = {
      wake: 'wake',
      alamein: 'el_alamein',
      stalingrad: 'stalingrad',
      kursk: 'kursk',
      berlin: 'berlin',
      omaha: 'omaha_beach',
      bocage: 'bocage',
      midway: 'midway',
      guadalcanal: 'guadalcanal',
      tobruk: 'tobruk',
      gazala: 'gazala',
      battleaxe: 'battleaxe',
      aberdeen: 'aberdeen',
      kharkov: 'kharkov',
      bulge: 'battle_of_the_bulge',
      britain: 'battle_of_britain',
      caen: 'liberation_of_caen',
      philippines: 'invasion_of_the_philippines',
      iwo: 'iwo_jima',
      coral: 'coral_sea',
      anzio: 'anzio',
      salerno: 'salerno',
      cassino: 'cassino',
      baytown: 'baytown',
      husky: 'husky',
      eagles: 'eagles_nest',
      telemark: 'telemark',
      peenemunde: 'peenemunde',
      hellendoorn: 'hellendoorn',
      mimoyecques: 'mimoyecques',
    }
    for (const [kw, targetSlug] of Object.entries(keywordMap)) {
      if (rawLower.includes(kw) && mapsMap[targetSlug]) {
        mapEntry = mapsMap[targetSlug]
        break
      }
    }
  }

  // If a map entry is found, handle DC overrides if applicable
  if (mapEntry) {
    let theaterKey = mapEntry.theaterKey
    let theaterTitle = mapEntry.theaterTitle
    let theaterCategory = mapEntry.theaterCategory
    let image = mapEntry.image
    let imageUrl = mapEntry.imageUrl
    let pngUrl = mapEntry.pngUrl

    // If running under Desert Combat and has DC theater art
    if (isDc && mapEntry.dcTheaterKey && theatersMap[mapEntry.dcTheaterKey]) {
      const dcArt = theatersMap[mapEntry.dcTheaterKey]
      theaterKey = dcArt.key
      theaterTitle = dcArt.title
      theaterCategory = dcArt.category
      image = dcArt.image
      imageUrl = dcArt.imageUrl
      pngUrl = dcArt.pngUrl
    }

    return {
      slug: mapEntry.slug,
      mapName: mapEntry.mapName,
      theaterKey,
      theaterCategory,
      theaterTitle,
      image,
      imageUrl,
      pngUrl,
      isDesertCombat: isDc,
      backgroundStyle: {
        backgroundImage: `url(${imageUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      },
    }
  }

  // 4. Direct theater key lookup (e.g. if caller passed "pacific", "desert", "eastern")
  if (theatersMap[slug]) {
    const t = theatersMap[slug]
    return {
      slug,
      mapName: t.title,
      theaterKey: t.key,
      theaterCategory: t.category,
      theaterTitle: t.title,
      image: t.image,
      imageUrl: t.imageUrl,
      pngUrl: t.pngUrl,
      isDesertCombat: isDc,
      backgroundStyle: {
        backgroundImage: `url(${t.imageUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      },
    }
  }

  // 5. Environmental keyword guessing for unknown maps
  const lower = mapName.toLowerCase()
  let guessedTheater: TheaterData = DEFAULT_THEATER
  if (isDc) {
    guessedTheater = theatersMap['dc_tanks'] || DEFAULT_THEATER
  } else if (lower.includes('pacific') || lower.includes('island') || lower.includes('atoll')) {
    guessedTheater = theatersMap['pacific2'] || DEFAULT_THEATER
  } else if (lower.includes('desert') || lower.includes('sand') || lower.includes('africa')) {
    guessedTheater = theatersMap['desert'] || DEFAULT_THEATER
  } else if (lower.includes('snow') || lower.includes('winter') || lower.includes('frost')) {
    guessedTheater = theatersMap['eastern'] || DEFAULT_THEATER
  } else if (lower.includes('city') || lower.includes('urban') || lower.includes('street')) {
    guessedTheater = theatersMap['eastern'] || DEFAULT_THEATER
  } else if (lower.includes('bocage') || lower.includes('normand') || lower.includes('france')) {
    guessedTheater = theatersMap['western2'] || DEFAULT_THEATER
  }

  return {
    slug,
    mapName: mapName.trim(),
    theaterKey: guessedTheater.key,
    theaterCategory: guessedTheater.category,
    theaterTitle: guessedTheater.title,
    image: guessedTheater.image,
    imageUrl: guessedTheater.imageUrl,
    pngUrl: guessedTheater.pngUrl,
    isDesertCombat: isDc,
    backgroundStyle: {
      backgroundImage: `url(${guessedTheater.imageUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    },
  }
}

/**
 * Retrieve theater metadata by theater key.
 */
export function getTheaterByKey(key: string): TheaterData | null {
  return theatersMap[key] || null
}

/**
 * Return all registered theater categories and artwork.
 */
export function getAllTheaters(): Record<string, TheaterData> {
  return theatersMap
}

/**
 * Return all mapped levels and their theater metadata.
 */
export function getAllMapTheaters(): Record<string, MapTheaterData> {
  return mapsMap
}

/**
 * Vue Composable for reactive map theater lookup.
 */
export function useMapTheater(
  mapNameRef?: MaybeRef<string | null | undefined>,
  gameIdRef?: MaybeRef<string | null | undefined>,
) {
  const theater = computed(() => {
    const m = unref(mapNameRef)
    const g = unref(gameIdRef)
    return getMapTheater(m, g)
  })

  const backgroundStyle = computed(() => {
    return (
      theater.value?.backgroundStyle || {
        backgroundImage: 'none',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    )
  })

  const theaterTitle = computed(() => theater.value?.theaterTitle || '')
  const theaterCategory = computed(() => theater.value?.theaterCategory || '')
  const theaterImage = computed(() => theater.value?.imageUrl || '')

  return {
    theater,
    backgroundStyle,
    theaterTitle,
    theaterCategory,
    theaterImage,
    getMapTheater,
    getTheaterByKey,
    getAllTheaters,
    getAllMapTheaters,
  }
}
