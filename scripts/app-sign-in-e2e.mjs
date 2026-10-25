#!/usr/bin/env node
// Plays the tray app's browser sign-in end to end against a running site and
// API (features/app-sign-in, "How it is built"): PKCE, a real loopback
// listener, Chromium on the Allow page signed in as the dev admin, the code
// exchange, a refresh, an authenticated call with the app's token, revoke,
// and a refresh that must then fail.
//
//   node scripts/app-sign-in-e2e.mjs [--site http://127.0.0.1:5173] [--api <origin>] [--headed]
//
// --site is the UI (its dev server proxies /stats to the API); --api defaults
// to it. The API needs its dev sign-in (Development or Auth__AllowDevLogin)
// and Jwt__Issuer/Jwt__Audience set, or its own tokens are refused.
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', 'ui', 'package.json'));
const { chromium } = require('@playwright/test');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const SITE = arg('--site', 'http://127.0.0.1:5173').replace(/\/$/, '');
const API = arg('--api', SITE).replace(/\/$/, '');
const HEADED = args.includes('--headed');

const step = (message) => console.log(`[app-sign-in] ${message}`);
function check(condition, message) {
  if (!condition) throw new Error(`FAILED: ${message}`);
  step(`ok: ${message}`);
}

async function post(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: response.status, json, setCookie: response.headers.get('set-cookie') };
}

// 1. The app's half: PKCE, state, and a one-shot listener on a random port.
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(16).toString('base64url');

let resolveCallback;
const callback = new Promise((resolve) => { resolveCallback = resolve; });
const listener = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/callback') {
    res.writeHead(404).end();
    return;
  }
  const ok = url.searchParams.get('state') === state && url.searchParams.has('code');
  res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(ok ? '<!doctype html><title>bfstats Sidecar</title><p>Signed in, you can close this tab.</p>'
    : '<!doctype html><title>bfstats Sidecar</title><p>Sign-in failed.</p>');
  resolveCallback(url);
});
await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
const redirectUri = `http://127.0.0.1:${port}/callback`;
step(`listening on ${redirectUri}`);

const browser = await chromium.launch({ headless: !HEADED });
try {
  // 2. The browser: signed in on the site as the dev admin, then the Allow page.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${SITE}/v4/servers/bf1942`);
  const login = await page.request.post(`${SITE}/stats/auth/login`, { data: { devBypass: true } });
  check(login.ok(), `dev sign-in answers ${login.status()}`);
  const session = await login.json();
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('authToken', token);
    localStorage.setItem('userProfile', JSON.stringify({ id: user.id, name: user.name, email: user.email, roles: ['User'] }));
  }, { token: session.accessToken, user: session.user });

  const device = `e2e-${randomBytes(3).toString('hex')}`;
  const query = new URLSearchParams({
    client: 'bfstats-sidecar',
    device,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  await page.goto(`${SITE}/auth/app?${query}`);
  await page.getByTestId('app-sign-in-allow').waitFor();
  check((await page.getByTestId('app-sign-in-device').textContent()) === device, `the Allow page names the device ${device}`);
  await page.getByTestId('app-sign-in-allow').click();

  // 3. The listener gets the code; the browser shows the app's page.
  const back = await Promise.race([
    callback,
    new Promise((_, reject) => setTimeout(() => reject(new Error('FAILED: no callback within 15 s')), 15000)),
  ]);
  check(back.searchParams.get('state') === state, 'the callback carries our state');
  const code = back.searchParams.get('code');
  check(/^[A-Za-z0-9_-]{43}$/.test(code ?? ''), 'the callback carries a code');
  await page.waitForURL(`${redirectUri}?**`);
  check((await page.textContent('body')).includes('Signed in'), 'the browser landed on the listener');

  // 4. The exchange: no cookies, the code and verifier in the body.
  const token = await post(`${API}/stats/auth/app/token`, { code, codeVerifier: verifier, redirectUri });
  check(token.status === 200, `token answers ${token.status}`);
  check(!token.setCookie, 'token sets no cookie');
  check(token.json.accessToken && token.json.refreshToken && token.json.user?.id, `signed in as ${token.json.user?.username}`);

  const replay = await post(`${API}/stats/auth/app/token`, { code, codeVerifier: verifier, redirectUri });
  check(replay.status === 400 && replay.json?.error === 'invalid_grant', 'the code is single use');

  // The replayed code revoked what it issued: sign in once more for a live token.
  // (RFC 6749 4.1.2; the app never replays a code, so this only proves the rule.)
  const revokedByReplay = await post(`${API}/stats/auth/app/refresh`, { refreshToken: token.json.refreshToken });
  check(revokedByReplay.status === 401, 'a replayed code revokes the sign-in it issued');

  const verifier2 = randomBytes(32).toString('base64url');
  const challenge2 = createHash('sha256').update(verifier2).digest('base64url');
  const authorize = await post(`${API}/stats/auth/app/authorize`, {
    client: 'bfstats-sidecar', device, redirectUri, state, codeChallenge: challenge2, codeChallengeMethod: 'S256',
  }, { Authorization: `Bearer ${session.accessToken}` });
  check(authorize.status === 200, `authorize (direct) answers ${authorize.status}`);
  const fresh = await post(`${API}/stats/auth/app/token`, { code: authorize.json.code, codeVerifier: verifier2, redirectUri });
  check(fresh.status === 200, 'a second sign-in exchanges');

  // 5. Refresh rotates.
  const refreshed = await post(`${API}/stats/auth/app/refresh`, { refreshToken: fresh.json.refreshToken });
  check(refreshed.status === 200, `refresh answers ${refreshed.status}`);
  check(refreshed.json.refreshToken !== fresh.json.refreshToken, 'the refresh token rotated');

  // 6. The app's access token works on an [Authorize] endpoint.
  const profiles = await fetch(`${API}/stats/account/game-profiles`, {
    headers: { Authorization: `Bearer ${refreshed.json.accessToken}` },
  });
  check(profiles.status === 200, `GET /stats/account/game-profiles with the app token answers ${profiles.status}`);

  const sessions = await fetch(`${API}/stats/auth/app/sessions`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
  const listed = await sessions.json();
  check(listed.some((s) => s.device === device), 'the sessions list shows the app');

  // 7. Revoke, then refresh fails.
  const revoke = await fetch(`${API}/stats/auth/app/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refreshed.json.refreshToken }),
  });
  check(revoke.status === 204, `revoke answers ${revoke.status}`);
  const after = await post(`${API}/stats/auth/app/refresh`, { refreshToken: refreshed.json.refreshToken });
  check(after.status === 401, `refresh after revoke answers ${after.status}`);

  const sessionsAfter = await (await fetch(`${API}/stats/auth/app/sessions`, { headers: { Authorization: `Bearer ${session.accessToken}` } })).json();
  check(!sessionsAfter.some((s) => s.device === device), 'the sessions list no longer shows it');
  step('PASS');
} finally {
  await browser.close();
  listener.close();
}
