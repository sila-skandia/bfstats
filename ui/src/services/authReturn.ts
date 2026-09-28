/**
 * Signing in for another bfstats site. play.bfstats.io's REPLAY feed sends a
 * visitor to `/auth/discord/start?returnTo=<its page>`; after Discord they
 * land back on that page, where the sign-in cookie (Domain=bfstats.io) is
 * theirs too. Only bfstats.io's own hosts are taken as a place to go back to,
 * so the route is no open redirect. See features/replay-feed.
 */

export const RETURN_URL_KEY = 'discord_auth_return_url'

/** A return address is honoured this long after the sign-in began: one left
 *  behind by an abandoned sign-in must not hijack a later one. */
const RETURN_URL_MAX_AGE_MS = 15 * 60 * 1000

const BFSTATS_HOST = /^(?:[a-z0-9-]+\.)*bfstats\.io$/i
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])$/i

/**
 * `value` as a URL this site may send a visitor back to, or null: this origin,
 * any https bfstats.io host, or (from a local development server) another
 * local port.
 */
export function safeReturnUrl(
  value: string | null | undefined,
  here: { origin: string; hostname: string } = window.location,
): string | null {
  if (!value) return null
  let url: URL
  try {
    url = new URL(value, here.origin)
  } catch {
    return null
  }
  if (url.origin === here.origin) return url.href
  if (url.protocol === 'https:' && BFSTATS_HOST.test(url.hostname)) return url.href
  if (url.protocol === 'http:' && LOCAL_HOST.test(url.hostname) && LOCAL_HOST.test(here.hostname)) return url.href
  return null
}

export function rememberReturnUrl(url: string | null): void {
  try {
    if (url) localStorage.setItem(RETURN_URL_KEY, JSON.stringify({ url, at: Date.now() }))
    else localStorage.removeItem(RETURN_URL_KEY)
  } catch {
    // Private mode: the visitor lands on the dashboard instead.
  }
}

/** The address a sign-in that just finished goes back to, once. */
export function takeReturnUrl(): string | null {
  try {
    const kept = JSON.parse(localStorage.getItem(RETURN_URL_KEY) ?? 'null') as { url?: string; at?: number } | null
    localStorage.removeItem(RETURN_URL_KEY)
    if (!kept?.url || !kept.at || Date.now() - kept.at > RETURN_URL_MAX_AGE_MS) return null
    return safeReturnUrl(kept.url)
  } catch {
    return null
  }
}
