// Where the armoury's files are, and the small labels drawn around them.
//
// The mesh tree is the one mesh.bfstats.io serves, mounted into the API too, so
// the main site reads it same-origin and needs no CORS.

import type { ArmyFigure, ArmyFigureKit, ServiceRecord, ServiceRecordArmy } from '@/services/serviceRecordApi'
import type { FigureSpec } from './stage'

export const MESH_BASE = '/stats/assets/mesh/'
export const HUD_BASE = '/stats/assets/hud/'
export const MESH_SITE = 'https://mesh.bfstats.io/'

export const meshUrl = (path: string) => MESH_BASE + path
export const hudUrl = (path: string) => HUD_BASE + path

/** The kit the stage opens on: the rifleman, as the spawn screen does. */
export function defaultKit(figure: ArmyFigure | null): ArmyFigureKit | null {
  if (!figure?.kits.length) return null
  return figure.kits.find(kit => /assault/i.test(kit.template)) ?? figure.kits[0]
}

export function figureSpec(kit: ArmyFigureKit | null): FigureSpec | null {
  return kit ? { pose: kit.pose, worn: kit.worn } : null
}

/** Below this share of a player's attributed time, a dressed army does not open ahead of their real primary. */
const DRESSED_OPENING_SHARE = 0.1

/**
 * The army a player's record opens on: the longest-served one the armoury can
 * dress, unless that is a footnote next to one it cannot (a Desert Combat
 * regular's two minutes as a Commando). Then the truth and an empty stage beat
 * the showpiece.
 */
export function openingArmy(record: ServiceRecord | null): ServiceRecordArmy | null {
  const armies = record?.armies ?? []
  const dressed = armies.find(army => army.figure?.kits.length)
  if (dressed && record && dressed.minutes >= DRESSED_OPENING_SHARE * record.attributedMinutes) return dressed
  return armies[0] ?? null
}

/**
 * `models/mods/xpack2/Flakpanzer.glb` -> the mesh site's model page for it.
 * The page matches the hash against its manifest by name, and `?mod=` picks the tree.
 */
export function meshSiteModelUrl(modelPath: string | null): string | null {
  if (!modelPath) return null
  const match = /^models\/(?:mods\/([^/]+)\/)?([^/]+)\.glb$/i.exec(modelPath)
  if (!match) return null
  const [, mod, name] = match
  return `${MESH_SITE}${mod ? `?mod=${encodeURIComponent(mod)}` : ''}#${encodeURIComponent(name)}`
}

// Dossier nation codes (the flag meshes' own spelling) to the badge the page prints.
const NATION_BADGE: Record<string, string> = {
  us: 'US', ger: 'DE', jp: 'JP', rus: 'SU', brit: 'GB', can: 'CA', ita: 'IT', fra: 'FR',
  aus: 'AU', pol: 'PL', fin: 'FI', nl: 'NL', hun: 'HU', nz: 'NZ', bel: 'BE',
}

// Mod armies whose level names no flag the game ships art for.
const LABEL_BADGE: Record<string, string> = {
  iraq: 'IQ', nva: 'VN', vietcong: 'VC', vcfemale: 'VC', civilvc: 'VC', pathetlaos: 'LA',
  arvnforces: 'SV', specialforces: 'US', navyseals: 'US', fmgerman: 'DE', volkssturm: 'DE',
}

export function nationBadge(nation: string | null, label: string): string {
  if (nation && NATION_BADGE[nation]) return NATION_BADGE[nation]
  const key = label.toLowerCase().replace(/[^a-z]/g, '')
  return LABEL_BADGE[key] ?? label.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase()
}

const MOD_LABEL: Record<string, string> = {
  eod: 'Eve of Destruction',
  dc_final: 'Desert Combat Final',
  desertcombat: 'Desert Combat',
  fh: 'Forgotten Hope',
  fhsw: 'FH Secret Weapon',
  fhsweurope: 'FHSW Europe',
  bf1918: 'Battlefield 1918',
  bg42: 'Battlegroup 42',
  gcmod: 'Galactic Conquest',
  interstate: "Interstate '82",
  finnwars: 'Finn Wars',
  pirates: 'Pirates',
  warfront: 'Warfront',
  bfheroes: 'Heroes',
}

/** The mod an army belongs to, or null for the base game and its two expansions. */
export function modLabel(mod: string): string | null {
  if (mod === 'bf1942' || mod === 'xpack1' || mod === 'xpack2') return null
  return MOD_LABEL[mod] ?? mod.toUpperCase()
}
