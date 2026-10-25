import { apiClient } from './apiClient'

// An app's browser sign-in (features/app-sign-in, "API contract"): the site's
// half, signed in with its own Bearer token.

export interface AuthorizeAppBody {
  client: string
  device: string
  redirectUri: string
  state: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
}

export interface SignedInApp {
  /** The sign-in's id, stable across refreshes. */
  id: string
  client: string
  device: string
  /** UTC, ISO-8601 with a Z. */
  createdAt: string
  lastUsedAt: string
  expiresAt: string
}

const BASE = '/stats/auth/app'

export class AppSignInError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function check(response: Response): Promise<Response> {
  if (response.ok) return response
  let message = response.status === 429 ? 'Too many sign-in attempts. Wait a few minutes and try again.' : `Request failed (${response.status})`
  try {
    const body = await response.json()
    if (body?.message) message = body.message
  } catch { /* no JSON body: keep the status */ }
  throw new AppSignInError(response.status, message)
}

export const appSignInService = {
  async authorize(body: AuthorizeAppBody): Promise<{ code: string; redirectUri: string }> {
    const response = await check(await apiClient.post(`${BASE}/authorize`, body, { requiresAuth: true }))
    return response.json()
  },

  async sessions(): Promise<SignedInApp[]> {
    const response = await check(await apiClient.get(`${BASE}/sessions`, { requiresAuth: true }))
    return response.json()
  },

  async signOut(id: string): Promise<void> {
    await check(await apiClient.delete(`${BASE}/sessions/${encodeURIComponent(id)}`, { requiresAuth: true }))
  },
}
