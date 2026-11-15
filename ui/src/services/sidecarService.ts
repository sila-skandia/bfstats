// The bfstats Sidecar early access page's API (features/early-access-sidecar).
import { apiClient } from './apiClient'
import { authService } from './authService'

export type SidecarPlatform = 'windows' | 'mac' | 'linux'

export interface SidecarFile {
  file: string
  platform: SidecarPlatform
  arch: string | null
  size: number
  sha256: string | null
  /** A signed link that downloads the file; it works until linksExpireAt. */
  url: string
}

export interface SidecarRelease {
  version: string
  releasedAt: string | null
  linksExpireAt: string
  files: SidecarFile[]
}

/** What the page shows: the release, or why there is none for this visitor. */
export type SidecarAccess =
  | { state: 'ok'; release: SidecarRelease }
  | { state: 'signed-out' }
  | { state: 'no-access' }
  | { state: 'no-release' }
  | { state: 'error'; message: string }

async function get() {
  return apiClient.get('/stats/sidecar/release', { requiresAuth: true })
}

export async function fetchSidecarRelease(): Promise<SidecarAccess> {
  if (!authService.getStoredAuthState().isAuthenticated) return { state: 'signed-out' }
  try {
    let response = await get()
    // The role is in the sign-in token: one given since the token was made only
    // shows once it is refreshed, so a refusal is asked again after a refresh.
    if (response.status === 403 && (await authService.refreshToken())) response = await get()
    if (response.status === 401) return { state: 'signed-out' }
    if (response.status === 403) return { state: 'no-access' }
    if (response.status === 404) return { state: 'no-release' }
    if (!response.ok) return { state: 'error', message: `The downloads did not load (${response.status}).` }
    return { state: 'ok', release: (await response.json()) as SidecarRelease }
  } catch (e) {
    if (e instanceof Error && /Authentication required|Session expired/.test(e.message)) return { state: 'signed-out' }
    return { state: 'error', message: e instanceof Error ? e.message : 'The downloads did not load.' }
  }
}

/** The visitor's own OS, for the tab the page opens on. */
export function detectPlatform(ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): SidecarPlatform {
  if (/Macintosh|Mac OS X/i.test(ua) && !/iPhone|iPad/i.test(ua)) return 'mac'
  if (/Linux|X11|CrOS/i.test(ua) && !/Android/i.test(ua)) return 'linux'
  return 'windows'
}

/** 123063646 -> "117 MB". */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  const mb = bytes / (1024 * 1024)
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`
}
