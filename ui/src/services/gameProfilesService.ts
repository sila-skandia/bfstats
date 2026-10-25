import { apiClient } from './apiClient'

// The account's BF1942 profiles (features/game-profiles, "API contract").

export interface GameProfile {
  name: string
  /** Raw, as the game stores it: decode with `$pn` for display. */
  playerName: string
  isActive: boolean
  /** UTC, ISO-8601 with a Z. */
  updatedAt: string
  files: Record<string, string>
}

export interface UpsertGameProfile {
  playerName?: string | null
  files: Record<string, string>
  makeActive?: boolean
}

const BASE = '/stats/account/game-profiles'
const path = (name: string) => `${BASE}/${encodeURIComponent(name)}`

/** An answer the API refused, with its own message (a 400's reason, the 409 limit). */
export class GameProfileError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function check(response: Response): Promise<Response> {
  if (response.ok) return response
  let message = `Request failed (${response.status})`
  try {
    const body = await response.json()
    if (body?.message) message = body.message
  } catch { /* no JSON body: keep the status */ }
  throw new GameProfileError(response.status, message)
}

export const gameProfilesService = {
  async list(): Promise<GameProfile[]> {
    const response = await check(await apiClient.get(BASE, { requiresAuth: true }))
    return response.json()
  },

  async upsert(name: string, body: UpsertGameProfile): Promise<GameProfile> {
    const response = await check(await apiClient.put(path(name), body, { requiresAuth: true }))
    return response.json()
  },

  async activate(name: string): Promise<void> {
    await check(await apiClient.post(`${path(name)}/activate`, undefined, { requiresAuth: true }))
  },

  async remove(name: string): Promise<void> {
    await check(await apiClient.delete(path(name), { requiresAuth: true }))
  },
}
