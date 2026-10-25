// Reads BF1942 profiles out of a folder picked with <input webkitdirectory>
// (features/game-profiles). A profile is `<Profiles>/<name>/` holding
// GeneralOptions.con and Controls/{Common,Infantry,Air,Land}.con; nothing else
// in the folder (server lists, buddy lists, video settings) is read.

/** The file keys the API accepts, as the game lays them out under the profile folder. */
export const GAME_PROFILE_FILES = [
  'Controls/Common.con',
  'Controls/Infantry.con',
  'Controls/Air.con',
  'Controls/Land.con',
  'GeneralOptions.con',
] as const

export type GameProfileFileKey = (typeof GAME_PROFILE_FILES)[number]

/** Must match `GameProfileRules.MaxFileBytes` / `MaxProfiles` on the API. */
export const GAME_PROFILE_MAX_FILE_BYTES = 64 * 1024
export const GAME_PROFILE_MAX_PROFILES = 10

export interface FoundGameProfile {
  /** The profile folder's name. */
  name: string
  /** The mod folder it came from (`bf1942`, `xpack1`), when the path shows one. */
  mod: string | null
  /** Raw `game.setPlayerName`, or null when GeneralOptions.con has none. */
  playerName: string | null
  files: Partial<Record<GameProfileFileKey, string>>
  /** Files that were left out, and why (too large). */
  skipped: string[]
}

export interface GameProfileScan {
  profiles: FoundGameProfile[]
  /** Profiles found twice (one name in two mods): the first one is kept. */
  duplicates: string[]
}

const canonicalKey = (rest: string): GameProfileFileKey | null =>
  GAME_PROFILE_FILES.find(key => key.toLowerCase() === rest.toLowerCase()) ?? null

/** Where in a picked path the profile folder sits: just under `Profiles` when the
 *  path passes through one, else the picked folder itself. */
function locate(relativePath: string): { name: string; mod: string | null; key: GameProfileFileKey } | null {
  const parts = relativePath.split(/[\\/]/).filter(Boolean)
  const profilesAt = parts.map(p => p.toLowerCase()).lastIndexOf('profiles')
  const nameAt = profilesAt >= 0 ? profilesAt + 1 : 0
  if (nameAt >= parts.length - 1) return null
  const key = canonicalKey(parts.slice(nameAt + 1).join('/'))
  if (!key) return null
  // `Mods/<mod>/Settings/Profiles/<name>`.
  const mod = profilesAt >= 2 && parts[profilesAt - 1].toLowerCase() === 'settings' ? parts[profilesAt - 2] : null
  return { name: parts[nameAt], mod, key }
}

/** The name in `game.setPlayerName "..."`; the same rule as the API's. */
export function readPlayerName(generalOptions: string | undefined): string | null {
  if (!generalOptions) return null
  let name: string | null = null
  const pattern = /^[ \t]*game\.setPlayerName[ \t]+(?:"([^"\r\n]*)"|([^\s"]+))/gim
  for (const match of generalOptions.matchAll(pattern)) {
    const value = (match[1] ?? match[2] ?? '').trim()
    if (value) name = value
  }
  return name
}

/** The game writes its .con files in the Windows code page: decoded as cp1252 they
 *  carry a name the way the stats store it (decode for display with `$pn`). */
async function readText(file: File): Promise<string> {
  const bytes = await file.arrayBuffer()
  return new TextDecoder('windows-1252').decode(bytes)
}

const byteLength = (text: string) => new TextEncoder().encode(text).length

/** Every profile in the picked files, by name (case-insensitive), in name order. */
export async function scanGameProfiles(files: ArrayLike<File>): Promise<GameProfileScan> {
  const found = new Map<string, FoundGameProfile & { origin: string }>()
  const duplicates = new Set<string>()

  for (const file of Array.from(files)) {
    const path = file.webkitRelativePath || file.name
    const where = locate(path)
    if (!where) continue
    const id = where.name.toLowerCase()
    const origin = `${where.mod ?? ''}/${where.name}`
    let profile = found.get(id)
    if (!profile) {
      profile = { name: where.name, mod: where.mod, playerName: null, files: {}, skipped: [], origin }
      found.set(id, profile)
    } else if (profile.origin !== origin) {
      duplicates.add(where.mod ? `${where.name} (${where.mod})` : where.name)
      continue
    }
    if (file.size > GAME_PROFILE_MAX_FILE_BYTES * 2) {
      profile.skipped.push(`${where.key} (over 64 KB)`)
      continue
    }
    const text = await readText(file)
    if (byteLength(text) > GAME_PROFILE_MAX_FILE_BYTES) {
      profile.skipped.push(`${where.key} (over 64 KB)`)
      continue
    }
    profile.files[where.key] = text
  }

  const profiles = [...found.values()]
    .map(({ origin: _origin, ...profile }) => ({ ...profile, playerName: readPlayerName(profile.files['GeneralOptions.con']) }))
    .filter(p => Object.keys(p.files).length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return { profiles, duplicates: [...duplicates] }
}

/** The short label for a file key in the import preview and the list. */
export const fileLabel = (key: string): string =>
  key === 'GeneralOptions.con' ? 'General' : key.replace(/^Controls\//, '').replace(/\.con$/, '')
