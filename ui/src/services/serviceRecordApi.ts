import axios from 'axios'
import type { MapDossierKit } from './mapDossierService'

/**
 * A player's time attributed to the armies they fought for. bflist only reports
 * "Axis" / "Allied"; the map turns that into a nation, because each level's own
 * files name the army on each side. See features/service-record.
 *
 * Paths under `figure` and `vehicles` are relative to the mesh root
 * (`/stats/assets/mesh/`); `iconPath` to the HUD root (`/stats/assets/hud/`).
 */

export type ArmySide = 'axis' | 'allied'

export interface ArmyWornPart {
  path: string
  bone: string | null
  slot: string | null
  position: number[]
  rotation: number[]
}

export interface ArmyFigureKit {
  /** Kit template, matching one of the army's `kits`. */
  template: string
  /** The weapon the figure holds: the kit's first item that has a pose. */
  weapon: string
  pose: string
  worn: ArmyWornPart[]
}

export interface ArmyFigure {
  skin: string
  /** The mesh site's static browse render of the soldier, or null. */
  thumb: string | null
  kits: ArmyFigureKit[]
}

export interface ServiceRecordMap {
  gameId: string
  mapName: string
  displayName: string
  minutes: number
  rounds: number
}

export interface ServiceRecordVehicle {
  template: string
  name: string
  category: 'land' | 'air' | 'sea'
  iconPath: string | null
  thumb: string | null
  model: string | null
  /** Player minutes on (map, side) pairs where this machine spawns. Exposure, not use. */
  minutes: number
  maps: number
}

export interface ServiceRecordArmy {
  key: string
  name: string
  nation: string | null
  nationLabel: string
  side: ArmySide
  mod: string
  minutes: number
  rounds: number
  kills: number
  deaths: number
  score: number
  wins: number
  losses: number
  maps: ServiceRecordMap[]
  kits: MapDossierKit[]
  figure: ArmyFigure | null
  vehicles: ServiceRecordVehicle[]
}

export interface ServiceRecordSide {
  side: ArmySide
  minutes: number
  rounds: number
  kills: number
  deaths: number
  wins: number
  losses: number
}

/** Which sessions a record covers: the player's most recent thousand at most. */
export interface ServiceRecordWindow {
  sessions: number
  /** True when older sessions were left out. */
  capped: boolean
  /** When the oldest counted session started (UTC ISO), or null with no sessions. */
  since: string | null
}

export interface ServiceRecord {
  playerName: string
  totalMinutes: number
  attributedMinutes: number
  sides: ServiceRecordSide[]
  armies: ServiceRecordArmy[]
  unattributed: { minutes: number, rounds: number }
  window: ServiceRecordWindow
}

export interface MapArmyTeam {
  index: number
  side: ArmySide
  key: string
  name: string
  nation: string | null
  nationLabel: string
  kits: MapDossierKit[]
  figure: ArmyFigure | null
}

export interface MapArmies {
  mod: string
  map: string
  displayName: string
  teams: MapArmyTeam[]
}

export async function fetchServiceRecord(playerName: string): Promise<ServiceRecord> {
  const response = await axios.get<ServiceRecord>(
    `/stats/players/${encodeURIComponent(playerName)}/service-record`,
  )
  return response.data
}

/** The two armies of a map, or null when the map has no dossier. */
export async function fetchMapArmies(gameId: string, mapName: string): Promise<MapArmies | null> {
  try {
    const response = await axios.get<MapArmies>(
      `/stats/armoury/maps/${encodeURIComponent(gameId)}/${encodeURIComponent(mapName)}`,
    )
    return response.data
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return null
    throw error
  }
}
