// The /auth/app request's checks (features/app-sign-in, "Rules"). The API runs
// the same ones (api/AppSignIn/AppSignInRules.cs); the page runs them first so
// it never shows Allow for a request the API would refuse, and never sends the
// browser to an address that is not the app's loopback listener.

export const APP_CLIENTS: Record<string, string> = {
  'bfstats-sidecar': 'bfstats Sidecar',
}

export const MAX_DEVICE_LENGTH = 64
export const UNNAMED_DEVICE = 'Unnamed device'

const REDIRECT_URI = /^http:\/\/(?:127\.0\.0\.1|localhost):([1-9][0-9]{3,4})\/callback$/
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/
const STATE = /^[A-Za-z0-9._~-]{1,256}$/

/** `http://127.0.0.1:<port>/callback` or `http://localhost:<port>/callback`, port 1024-65535, nothing else. */
export function isValidRedirectUri(value: string | null | undefined): value is string {
  if (!value) return false
  // `$` in a JS regex without the m flag does not match before a trailing newline, unlike .NET's.
  const match = REDIRECT_URI.exec(value)
  if (!match) return false
  const port = Number(match[1])
  return port >= 1024 && port <= 65535
}

/** The device name as shown: control characters dropped, whitespace collapsed, cut to 64. */
export function normalizeDevice(value: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex
  const text = (value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return UNNAMED_DEVICE
  return Array.from(text).slice(0, MAX_DEVICE_LENGTH).join('').trim()
}

export interface AppSignInRequest {
  client: string
  clientName: string
  device: string
  redirectUri: string
  state: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
  /** host:port the browser goes back to, for the page to name. */
  returnsTo: string
}

export type AppSignInParse =
  | { ok: true; request: AppSignInRequest }
  | { ok: false; reason: string }

type Query = Record<string, unknown>

function one(query: Query, key: string): string | null {
  const value = query[key]
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.length === 1 && typeof value[0] === 'string' ? value[0] : null
  return null
}

/** The page's query (`client`, `device`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method`). */
export function parseAppSignIn(query: Query): AppSignInParse {
  const client = one(query, 'client')
  if (!client || !(client in APP_CLIENTS)) return { ok: false, reason: 'The app that sent you here is not one bfstats.io knows.' }

  const redirectUri = one(query, 'redirect_uri')
  if (!isValidRedirectUri(redirectUri)) {
    return { ok: false, reason: 'The address this would send you back to is not the app on this computer.' }
  }

  const state = one(query, 'state')
  if (!state || !STATE.test(state)) return { ok: false, reason: 'The request is missing its state, or it is malformed.' }

  if (one(query, 'code_challenge_method') !== 'S256') {
    return { ok: false, reason: 'The request does not use the S256 code challenge.' }
  }
  const codeChallenge = one(query, 'code_challenge')
  if (!codeChallenge || !CHALLENGE.test(codeChallenge)) {
    return { ok: false, reason: 'The request is missing its code challenge, or it is malformed.' }
  }

  const url = new URL(redirectUri)
  return {
    ok: true,
    request: {
      client,
      clientName: APP_CLIENTS[client],
      device: normalizeDevice(one(query, 'device')),
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod: 'S256',
      returnsTo: url.host,
    },
  }
}

/** Where Allow sends the browser: the app's listener, with the code and the state. */
export function allowUrl(redirectUri: string, code: string, state: string): string {
  const url = new URL(redirectUri)
  url.searchParams.set('code', code)
  url.searchParams.set('state', state)
  return url.href
}

/** Where Deny sends the browser. */
export function denyUrl(redirectUri: string, state: string): string {
  const url = new URL(redirectUri)
  url.searchParams.set('error', 'access_denied')
  url.searchParams.set('state', state)
  return url.href
}
