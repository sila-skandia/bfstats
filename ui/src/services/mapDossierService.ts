import axios from 'axios'

/**
 * The battle intel the game's own level files carry about a map — which armies fight,
 * what they start with, where the flags are, and what each side can field.
 *
 * None of this is in the live server feed: bflist only ever reports "Axis" and "Allied".
 * It is extracted from the .con configuration inside each level's .rfa archive and
 * served off the assets volume, addressed exactly like the map images.
 *
 * Roughly 15% of live servers run community maps that ship no level archive, so a miss
 * is ordinary. Callers should render nothing rather than surface an error.
 */

export interface MapDossierKit {
  /** Kit template the level names, e.g. "Iraq_Sniper", "1Auss_CloseQuartersOwenSmoke". */
  template: string
  name: string
  /** One of the base game's five roles, or null for a kit outside them. */
  role: 'scout' | 'assault' | 'at' | 'medic' | 'engineer' | null
  /** Path under the hud asset route, or null when nothing matches. */
  iconPath: string | null
}

export interface MapDossierTeam {
  index: number
  /** Nation code ("us", "ger", "jp", "rus", "brit", "can"), or null for an unplaceable mod skin. */
  nation: string | null
  label: string
  skin: string | null
  tickets: number | null
  ticketLossPerMin: number | null
  /** True when the level designates this side the attacker. */
  isAssault: boolean
  /**
   * Kits this side can spawn with, as the level declares them. Mods field their own
   * class systems, so this is not limited to the base game's five roles.
   */
  kits: MapDossierKit[]
}

export interface MapDossierControlPoint {
  name: string
  id: string
  /** Team holding the flag at round start; 0 when it starts neutral. */
  team: number
  /** Position as a fraction of the minimap, or null when the level declares no world size. */
  x: number | null
  y: number | null
}

export interface MapDossierArsenalEntry {
  team: number
  template: string
  name: string
  key: string
  category: 'land' | 'air' | 'sea' | 'emplacement' | 'unknown'
  /** Spawn points supplying this machine, not the number alive at once. */
  spawnPoints: number
  /** Path under the hud asset route, or null when the game ships no art for it. */
  iconPath: string | null
}

export interface MapDossier {
  mod: string
  map: string
  displayName: string
  worldSize: number | null
  teams: MapDossierTeam[]
  controlPoints: MapDossierControlPoint[]
  /**
   * False when the map's minimap texture is framed differently from its terrain, which
   * would scatter the flags over unrelated ground. List them instead of plotting them.
   */
  controlPointsPlottable: boolean
  arsenal: MapDossierArsenalEntry[]
}

/** Normalise the way the level folder on disk is named, matching mapImage.ts. */
function slugify(mapName: string): string {
  return mapName.trim().toLowerCase().replace(/\s+/g, '_')
}

/** URL for one of the in-game icons a dossier's arsenal points at. */
export function hudIconUrl(iconPath: string | null | undefined): string | null {
  return iconPath ? `/stats/assets/hud/${iconPath}` : null
}

/**
 * Fetch a map's dossier, or null when it has none.
 *
 * A 404 is the expected outcome for community maps, so it resolves to null rather than
 * throwing — the caller has nothing to report to the user in that case.
 */
export async function fetchMapDossier(
  gameId: string | null | undefined,
  mapName: string | null | undefined,
): Promise<MapDossier | null> {
  if (!gameId || !mapName) return null

  const mod = encodeURIComponent(gameId.trim().toLowerCase())
  const map = encodeURIComponent(slugify(mapName))
  if (!mod || !map) return null

  try {
    const { data } = await axios.get<MapDossier>(`/stats/maps/${mod}/${map}/dossier`)
    return data
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null
    throw err
  }
}
