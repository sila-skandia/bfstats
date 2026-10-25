'use strict';
// A stand-in for bfstats.io's app sign-in and game profiles API
// (features/app-sign-in, features/game-profiles), for test/account.test.js (kept outside test/, which node --test runs whole)
// and for running the dev app against it before the real API exists:
//
//   node scripts/stand-in-api.js [port]        # prints its base URL
//   SIDECAR_DESKTOP_SITE=http://127.0.0.1:<port>/ npm start
//
// /auth/app "allows" at once: it redirects to the app's loopback with a code
// (or `?deny=1` on the stand-in's own URL, set by `deny`, sends
// access_denied). Codes are single use and bound to the challenge and the
// redirect URI; refresh tokens rotate, and replaying a rotated one revokes
// the family, as the real API's RefreshToken machinery does.

const crypto = require('node:crypto');
const http = require('node:http');

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (p) => `${p}_${b64url(crypto.randomBytes(18))}`;
const REDIRECT = /^http:\/\/(127\.0\.0\.1|localhost):(\d{4,5})\/callback$/;

function createStandIn({ username = 'skandia', profiles, accessTtlMs = 15 * 60_000, now = Date.now } = {}) {
  const st = {
    username,
    profiles: profiles ?? [
      { name: 'skandia', playerName: 'skandia', isActive: true },
      { name: 'Big Ben', playerName: 'Big Ben', isActive: false },
      { name: 'clan', playerName: '=SK=skandia', isActive: false },
    ],
    codes: new Map(),        // code -> { challenge, redirectUri, used, device }
    access: new Map(),       // token -> { exp }
    refresh: new Map(),      // token -> { family, used, revoked }
    revokedFamilies: new Set(),
    deny: false,
    calls: [],
    accessTtlMs,
  };

  const issue = (family) => {
    const accessToken = token('at');
    const refreshToken = token('rt');
    const exp = now() + st.accessTtlMs;
    st.access.set(accessToken, { exp, family });
    st.refresh.set(refreshToken, { family, used: false });
    return {
      accessToken, expiresAt: new Date(exp).toISOString(),
      refreshToken, refreshExpiresAt: new Date(now() + 60 * 86400_000).toISOString(),
      user: { id: 7, username: st.username },
    };
  };

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const readBody = (req) => new Promise((r) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch { r(null); } });
  });
  const bearer = (req) => {
    const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
    const a = m && st.access.get(m[1]);
    return a && a.exp > now() && !st.revokedFamilies.has(a.family) ? a : null;
  };

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    st.calls.push(`${req.method} ${u.pathname}`);
    if (req.method === 'GET' && u.pathname === '/auth/app') {
      const q = Object.fromEntries(u.searchParams);
      if (q.client !== 'bfstats-sidecar' || !REDIRECT.test(q.redirect_uri ?? '') || q.code_challenge_method !== 'S256' || !q.state || !q.code_challenge) {
        return json(res, 400, { error: 'invalid_request' });
      }
      const back = new URL(q.redirect_uri);
      if (st.deny) back.searchParams.set('error', 'access_denied');
      else {
        const code = token('code');
        st.codes.set(code, { challenge: q.code_challenge, redirectUri: q.redirect_uri, used: false, device: q.device });
        back.searchParams.set('code', code);
      }
      back.searchParams.set('state', q.state);
      res.writeHead(302, { location: back.href });
      return res.end();
    }
    if (req.method === 'POST' && u.pathname === '/stats/auth/app/token') {
      const b = await readBody(req);
      const c = b && st.codes.get(b.code);
      const ok = c && !c.used && c.redirectUri === b.redirectUri
        && b64url(crypto.createHash('sha256').update(String(b.codeVerifier ?? '')).digest()) === c.challenge;
      if (!ok) return json(res, 400, { error: 'invalid_grant' });
      c.used = true;
      return json(res, 200, issue(token('fam')));
    }
    if (req.method === 'POST' && u.pathname === '/stats/auth/app/refresh') {
      const b = await readBody(req);
      const r = b && st.refresh.get(b.refreshToken);
      if (!r || st.revokedFamilies.has(r.family)) return json(res, 401, { error: 'invalid_token' });
      if (r.used) { st.revokedFamilies.add(r.family); return json(res, 401, { error: 'token_reused' }); }
      r.used = true;
      return json(res, 200, issue(r.family));
    }
    if (req.method === 'POST' && u.pathname === '/stats/auth/app/revoke') {
      const b = await readBody(req);
      const r = b && st.refresh.get(b.refreshToken);
      if (r) st.revokedFamilies.add(r.family);
      return json(res, 204);
    }
    if (u.pathname === '/stats/account/game-profiles' && req.method === 'GET') {
      if (!bearer(req)) return json(res, 401);
      return json(res, 200, st.profiles.map((p) => ({ ...p, updatedAt: '2026-10-25T00:00:00Z', files: {} })));
    }
    const m = /^\/stats\/account\/game-profiles\/([^/]+)\/activate$/.exec(u.pathname);
    if (m && req.method === 'POST') {
      if (!bearer(req)) return json(res, 401);
      const name = decodeURIComponent(m[1]);
      const p = st.profiles.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!p) return json(res, 404, { message: 'No such profile' });
      for (const x of st.profiles) x.isActive = x === p;
      return json(res, 204);
    }
    const pm = /^\/stats\/account\/game-profiles\/([^/]+)$/.exec(u.pathname);
    if (pm && req.method === 'PATCH') {
      if (!bearer(req)) return json(res, 401);
      const name = decodeURIComponent(pm[1]);
      const p = st.profiles.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!p) return json(res, 404, { message: 'Profile not found' });
      const b = await readBody(req);
      if (!b || !('sidecarName' in b)) return json(res, 400, { message: 'sidecarName is required (null clears it)' });
      const v = typeof b.sidecarName === 'string' ? b.sidecarName.trim() : '';
      if (v.includes('"')) return json(res, 400, { message: 'Sidecar name cannot contain a quote' });
      if (v.length > 23) return json(res, 400, { message: 'Sidecar name is at most 23 characters' });
      p.sidecarName = v || null;
      return json(res, 200, { ...p, updatedAt: '2026-10-25T00:00:00Z', files: {} });
    }
    // The stand-in's own controls, for a check driving the app.
    if (req.method === 'POST' && u.pathname === '/__stand-in/revoke-all') { api.revokeAll(); return json(res, 204); }
    if (req.method === 'GET' && u.pathname === '/__stand-in/state') {
      return json(res, 200, { profiles: st.profiles, calls: st.calls, revokedFamilies: st.revokedFamilies.size });
    }
    return json(res, 404, { error: 'not_found' });
  });

  const api = {
    state: st,
    server,
    /** End every sign-in, as an account erasure or a reuse would. */
    revokeAll() { for (const r of st.refresh.values()) st.revokedFamilies.add(r.family); },
    listen(port = 0) {
      return new Promise((r) => server.listen(port, '127.0.0.1', () => r(`http://127.0.0.1:${server.address().port}/`)));
    },
    close() { server.closeAllConnections?.(); return new Promise((r) => server.close(() => r())); },
  };
  return api;
}

module.exports = { createStandIn };

if (require.main === module) {
  const many = process.argv.includes('--many');
  const profiles = many ? [
    { name: 'skandia', playerName: 'skandia', isActive: true },
    { name: 'Big Ben', playerName: 'Big Ben', isActive: false },
    { name: 'clan', playerName: '=SK=skandia', isActive: false },
    { name: 'pilot', playerName: 'Wingnut', isActive: false },
    { name: 'tanker', playerName: 'Panzerfaust Pete', isActive: false },
    { name: 'medic', playerName: 'Doc', isActive: false },
  ] : undefined;
  const ttl = Number(process.env.STAND_IN_ACCESS_TTL_MS) || undefined;
  const s = createStandIn({ profiles, accessTtlMs: ttl });
  s.listen(Number(process.argv[2]) || 0).then((base) => console.log(`stand-in bfstats.io on ${base}`));
}
