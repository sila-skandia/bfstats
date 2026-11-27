// How the Replay Shorts job and its tools sign in (features/replay-shorts,
// "Signing in"): an app sign-in of the bfstats-shorts client, the relay's
// loopback hand-off (features/app-sign-in), made once in a browser by
// scripts/shorts-sign-in.mjs. Its access token carries the account's own role,
// so an Admin account's writes every game's Shorts and a BfvAdmin's only
// Battlefield Vietnam's, exactly as a signed-in browser would.
//
// The sign-in lives in ~/.config/bfstats/shorts-sign-in.json (mode 600), or
// wherever SHORTS_SIGN_IN names. An access token lasts a week; one with less
// than a day left is refreshed before it is used, so a night's filming or a
// long 4K upload never runs out half way. The refresh token rotates on every
// refresh and the API revokes the whole sign-in when a used one comes back,
// so a refresh holds a lock and reads the file again inside it: two tools
// started together refresh once.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const SHORTS_CLIENT = 'bfstats-shorts';
export const SIGN_IN_FILE = process.env.SHORTS_SIGN_IN
  || path.join(os.homedir(), '.config', 'bfstats', 'shorts-sign-in.json');
const LOCK = `${SIGN_IN_FILE}.lock`;
const FRESH_FOR_MS = 24 * 3600 * 1000;
const HOW = 'run `node scripts/shorts-sign-in.mjs` once, signed in on bfstats.io as an admin';

export class SignInError extends Error {}

export function readSignIn() {
  try {
    return JSON.parse(fs.readFileSync(SIGN_IN_FILE, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new SignInError(`${SIGN_IN_FILE} is not readable (${e.message}); ${HOW}`);
  }
}

/** Writes the sign-in so a reader never sees half a file, readable by this user only. */
export function writeSignIn(signIn) {
  fs.mkdirSync(path.dirname(SIGN_IN_FILE), { recursive: true, mode: 0o700 });
  const tmp = `${SIGN_IN_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(signIn, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, SIGN_IN_FILE);
}

/** The sign-in as the API's token and refresh answers give it, with the API it came from. */
export function signInFrom(api, answer) {
  return {
    api,
    client: SHORTS_CLIENT,
    user: answer.user,
    accessToken: answer.accessToken,
    expiresAt: answer.expiresAt,
    refreshToken: answer.refreshToken,
    refreshExpiresAt: answer.refreshExpiresAt,
  };
}

const fresh = s => s?.accessToken && Date.parse(s.expiresAt) - Date.now() > FRESH_FOR_MS;

async function withLock(fn) {
  const until = Date.now() + 60_000;
  for (;;) {
    try {
      fs.mkdirSync(LOCK);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // A lock left by a killed process is let go after five minutes.
      try {
        if (Date.now() - fs.statSync(LOCK).mtimeMs > 5 * 60_000) fs.rmSync(LOCK, { recursive: true, force: true });
      } catch { /* gone already */ }
      if (Date.now() > until) throw new SignInError(`another tool holds ${LOCK}; try again`);
      await new Promise(r => setTimeout(r, 500));
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(LOCK, { recursive: true, force: true });
  }
}

async function refresh() {
  return withLock(async () => {
    const signIn = readSignIn();
    if (!signIn) throw new SignInError(`no Shorts sign-in at ${SIGN_IN_FILE}; ${HOW}`);
    if (fresh(signIn)) return signIn;
    const res = await fetch(`${signIn.api}/stats/auth/app/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: signIn.refreshToken }),
    });
    if (res.status === 401) {
      throw new SignInError(`the Shorts sign-in was signed out or has lapsed (refresh answered 401); ${HOW}`);
    }
    if (!res.ok) throw new Error(`refreshing the Shorts sign-in: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const next = signInFrom(signIn.api, await res.json());
    writeSignIn(next);
    return next;
  });
}

let cached = null;

/**
 * The headers that make a request the signed-in account's: `{ Authorization }`.
 * Throws a SignInError, which names the way to fix it, when there is no usable sign-in.
 */
export async function shortsAuth() {
  if (!fresh(cached)) {
    const signIn = readSignIn();
    cached = fresh(signIn) ? signIn : await refresh();
  }
  return { Authorization: `Bearer ${cached.accessToken}` };
}

/** For a tool's start: stop at once, with the fix, rather than after an hour of filming. */
export async function requireShortsAuth(what) {
  try {
    return await shortsAuth();
  } catch (e) {
    if (!(e instanceof SignInError)) throw e;
    console.error(`${what}: ${e.message}`);
    process.exit(2);
  }
}
