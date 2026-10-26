'use strict';
// The bfstats.io account: the browser sign-in (features/app-sign-in), the
// tokens, and the account's game profiles (features/game-profiles).
//
// Sign-in: a PKCE pair and a random state, a one-shot listener on
// 127.0.0.1:<random port> answering only /callback, the default browser at
// <site>/auth/app?..., the code exchanged at /stats/auth/app/token. The access
// token lives in memory; the refresh token is kept encrypted (Electron
// safeStorage, passed in as `crypt`) in the app's data folder, and rotates on
// every refresh: the new one is on disk before the old one is dropped, since
// replaying an old one revokes the whole sign-in.
//
// The pure parts (PKCE, the authorize URL, the callback check, the token
// store) are exported for test/app.test.js; Account takes `fetch`, `openUrl`
// and the store, so test/account-flow.test.js runs it against a stand-in API.

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { sidecarNameError } = require('./address');

const CLIENT = 'bfstats-sidecar';
const DEFAULT_SITE = 'https://bfstats.io/';
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const REFRESH_MARGIN_MS = 60_000;    // refresh this long before the access token expires
const REQUEST_TIMEOUT_MS = 15_000;
const DEVICE_MAX = 64;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** base64url(SHA-256(verifier)), the S256 challenge. */
function challengeFor(verifier) {
  return b64url(crypto.createHash('sha256').update(verifier, 'ascii').digest());
}

/** A PKCE pair: 32 random bytes base64url as the verifier, and its challenge. */
function makePkce(random = crypto.randomBytes) {
  const verifier = b64url(random(32));
  return { verifier, challenge: challengeFor(verifier) };
}

function makeState(random = crypto.randomBytes) { return b64url(random(24)); }

/** The device name the Allow page shows: the hostname, printable, at most 64 characters. */
function cleanDevice(name) {
  // eslint-disable-next-line no-control-regex
  const t = String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, DEVICE_MAX).trim();
  return t || 'this PC';
}

/** An http(s) origin-ish base that ends in a slash, or null. */
function cleanBase(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  let u;
  try { u = new URL(v.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  u.search = ''; u.hash = '';
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u.href;
}

const redirectUriFor = (port) => `http://127.0.0.1:${port}/callback`;

/** The site's Allow page for this sign-in. */
function authorizeUrl({ siteBase = DEFAULT_SITE, device, redirectUri, state, challenge }) {
  const u = new URL('auth/app', cleanBase(siteBase) ?? DEFAULT_SITE);
  u.searchParams.set('client', CLIENT);
  u.searchParams.set('device', cleanDevice(device));
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.href;
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

/**
 * What a request to the loopback listener means. `{ kind: 'code', code }`,
 * `{ kind: 'error', error }` (the site said no), `{ kind: 'bad-state' }` (not
 * the sign-in we are waiting for: ignored), `{ kind: 'not-found' }`.
 */
function parseCallback(method, reqUrl, expectedState) {
  let u;
  try { u = new URL(reqUrl, 'http://127.0.0.1'); } catch { return { kind: 'not-found' }; }
  if (method !== 'GET' || u.pathname !== '/callback') return { kind: 'not-found' };
  if (!sameSecret(u.searchParams.get('state'), expectedState)) return { kind: 'bad-state' };
  const error = u.searchParams.get('error');
  if (error) return { kind: 'error', error: error.slice(0, 64) };
  const code = u.searchParams.get('code');
  if (!code || code.length > 512) return { kind: 'error', error: 'no_code' };
  return { kind: 'code', code };
}

const ERROR_WORDS = {
  access_denied: 'You chose Deny on bfstats.io.',
  no_code: 'bfstats.io did not send a sign-in code.',
};

function callbackPage(ok, text) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>bfstats Sidecar</title>
<meta name="color-scheme" content="dark"><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#131313;color:#fff;font:15px/1.5 system-ui,sans-serif}
main{max-width:420px;padding:28px 30px;border:1px solid #2d2d2d;border-left:3px solid ${ok ? '#7d8849' : '#d65a5a'};border-radius:10px;background:#1a1a1a}
h1{margin:0 0 6px;font-size:17px;font-weight:600}p{margin:0;color:#c8c8c8}small{display:block;margin-top:14px;color:#8a8a8a;font:11px ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase}
</style></head><body><main><h1>${ok ? 'Signed in' : 'Not signed in'}</h1><p>${esc(text)}</p><small>bfstats Sidecar</small></main></body></html>`;
}

/**
 * The one-shot listener. Resolves `{ port, redirectUri, result, close }`
 * once it listens; `result` settles with `{ code }` or `{ error }` on the
 * first /callback carrying our state, and the listener closes then.
 */
function listenForCallback({ state, host = '127.0.0.1' }) {
  return new Promise((resolve, reject) => {
    let settle;
    const result = new Promise((r) => { settle = r; });
    let done = false;
    const server = http.createServer((req, res) => {
      const r = done ? { kind: 'not-found' } : parseCallback(req.method, req.url, state);
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', connection: 'close' });
        res.end(body);
      };
      if (r.kind === 'not-found') return send(404, callbackPage(false, 'Nothing here.'));
      if (r.kind === 'bad-state') return send(400, callbackPage(false, 'This is not the sign-in the app is waiting for. Start again from the app.'));
      done = true;
      if (r.kind === 'error') send(200, callbackPage(false, ERROR_WORDS[r.error] ?? `bfstats.io said: ${r.error}`));
      else send(200, callbackPage(true, 'You can close this tab and go back to bfstats Sidecar.'));
      settle(r.kind === 'code' ? { code: r.code } : { error: r.error });
      close();
    });
    const close = () => {
      server.close();
      server.closeIdleConnections?.();
    };
    server.once('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      resolve({ port, redirectUri: redirectUriFor(port), result, close: () => { if (!done) { done = true; settle({ error: 'cancelled' }); } close(); } });
    });
  });
}

// ---- the token store --------------------------------------------------------

/**
 * The refresh token on disk, encrypted. `crypt`: { available(), encrypt(text)
 * -> Buffer, decrypt(Buffer) -> text, backend() } (Electron safeStorage). With
 * no encryption at all the token is kept in memory only.
 */
class TokenStore {
  constructor(file, crypt) {
    this.file = file;
    this.crypt = crypt;
    this.memory = null;
  }

  /** 'keyring' | 'basic_text' (Linux without a keyring: saved, not keyring-protected) | 'memory' (not saved). */
  protection() {
    if (!this.crypt?.available?.()) return 'memory';
    return this.crypt.backend?.() === 'basic_text' ? 'basic_text' : 'keyring';
  }

  load() {
    if (this.protection() === 'memory') return this.memory;
    try {
      const text = this.crypt.decrypt(fs.readFileSync(this.file));
      const v = JSON.parse(text);
      return typeof v?.refreshToken === 'string' && v.refreshToken ? v : null;
    } catch { return null; }
  }

  /** The new token is written beside the old file and renamed over it: there is always one on disk. */
  save(record) {
    const v = {
      refreshToken: record.refreshToken,
      refreshExpiresAt: record.refreshExpiresAt ?? null,
      user: record.user ? { id: record.user.id ?? null, username: record.user.username ?? null } : null,
    };
    if (this.protection() === 'memory') { this.memory = v; return; }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, this.crypt.encrypt(JSON.stringify(v)), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  clear() {
    this.memory = null;
    try { fs.rmSync(this.file, { force: true }); } catch { /* gone */ }
  }
}

// ---- the account ------------------------------------------------------------

class AccountError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

/**
 * A profile as the panel and the menu use it. `playerName` is the game's (the
 * profile's GeneralOptions.con), `sidecarName` the one set for the sidecar
 * (features/game-profiles, "Sidecar name"), and `joinName` the one a join
 * uses: the sidecar name when set, else the game's. All raw (cp1252 text).
 */
function profileView(p) {
  const playerName = typeof p?.playerName === 'string' ? p.playerName : '';
  const sidecarName = typeof p?.sidecarName === 'string' && p.sidecarName.trim() ? p.sidecarName : null;
  return {
    name: String(p?.name ?? ''),
    playerName,
    sidecarName,
    joinName: sidecarName ?? playerName,
    active: !!p?.isActive,
    updatedAt: p?.updatedAt ?? null,
  };
}

/**
 * opts: { siteBase, apiBase (default: the site), store, openUrl(url), device,
 * fetch, log, now, signInTimeoutMs }. Emits 'change' with view(), and
 * 'signed-out' with the reason once when the API ends the sign-in.
 */
class Account extends EventEmitter {
  constructor(opts) {
    super();
    this.siteBase = cleanBase(opts.siteBase) ?? DEFAULT_SITE;
    this.apiBase = cleanBase(opts.apiBase) ?? this.siteBase;
    this.store = opts.store;
    this.openUrl = opts.openUrl;
    this.device = cleanDevice(opts.device);
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.log = opts.log ?? (() => {});
    this.now = opts.now ?? Date.now;
    this.signInTimeoutMs = opts.signInTimeoutMs ?? SIGN_IN_TIMEOUT_MS;
    this.status = 'signedOut';     // 'signedOut' | 'waiting' | 'signedIn'
    this.user = null;
    this.access = null;            // { token, expiresAt (ms) }
    this.record = null;            // what the store holds
    this.profiles = null;          // null until loaded
    this.profilesError = null;
    this.notice = null;            // shown once in the panel: why the app signed out, a failed sign-in
    this.pending = null;           // the sign-in under way: { close, cancel }
    this.refreshing = null;
    this.loadingProfiles = null;
  }

  /** Back from the store: signed in when a refresh token is saved (checked on first use). */
  start() {
    const rec = this.store.load();
    if (rec) {
      this.record = rec;
      this.user = rec.user ?? null;
      this.status = 'signedIn';
      this.log(`account: signed in as ${this.user?.username ?? 'unknown'} (saved, ${this.store.protection()})`);
    }
    this.changed();
    return this;
  }

  view() {
    return {
      status: this.status,
      username: this.user?.username ?? null,
      profiles: this.profiles,
      profilesError: this.profilesError,
      notice: this.notice,
      protection: this.store.protection(),
      importUrl: new URL('v4/dashboard?tab=profiles', this.siteBase).href,
      site: this.siteBase,
    };
  }

  changed() { this.emit('change', this.view()); }

  get signedIn() { return this.status === 'signedIn'; }

  activeProfile() { return this.profiles?.find((p) => p.active) ?? null; }

  dismissNotice() { if (this.notice) { this.notice = null; this.changed(); } }

  // ---- HTTP -----------------------------------------------------------------

  async call(method, rel, { body, token } = {}) {
    const url = new URL(rel.replace(/^\//, ''), this.apiBase).href;
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await this.fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal, credentials: 'omit', redirect: 'error' });
    } catch (e) {
      throw new AccountError(e.name === 'AbortError' ? 'bfstats.io did not answer in time' : `bfstats.io unreachable (${e.cause?.code ?? e.message})`, 0);
    } finally { clearTimeout(timer); }
    const text = await res.text().catch(() => '');
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch { /* not JSON */ } }
    if (!res.ok) {
      const what = json?.error ?? json?.message ?? json?.title ?? `HTTP ${res.status}`;
      throw new AccountError(String(what).slice(0, 200), res.status, json);
    }
    return json;
  }

  /** Take a token answer: the refresh token is saved before anything else drops the old one. */
  applyTokens(t) {
    if (typeof t?.accessToken !== 'string' || typeof t?.refreshToken !== 'string') throw new AccountError('bfstats.io sent no tokens', 0);
    const user = t.user ? { id: t.user.id ?? null, username: t.user.username ?? null } : this.user;
    const record = { refreshToken: t.refreshToken, refreshExpiresAt: t.refreshExpiresAt ?? null, user };
    this.store.save(record);
    this.record = record;
    this.user = user;
    const exp = Date.parse(t.expiresAt);
    this.access = { token: t.accessToken, expiresAt: Number.isFinite(exp) ? exp : this.now() + 5 * 60_000 };
    this.status = 'signedIn';
  }

  // ---- signing in and out -----------------------------------------------------

  /** The browser sign-in. Resolves true when signed in, false when cancelled, timed out or denied. */
  async signIn() {
    if (this.status === 'waiting') return false;
    const { verifier, challenge } = makePkce();
    const state = makeState();
    const listener = await listenForCallback({ state });
    let timer;
    let cancel;
    const stopped = new Promise((r) => {
      cancel = (why) => r({ error: why });
      timer = setTimeout(() => r({ error: 'timeout' }), this.signInTimeoutMs);
    });
    this.pending = { cancel };
    this.status = 'waiting';
    this.notice = null;
    this.changed();
    const url = authorizeUrl({ siteBase: this.siteBase, device: this.device, redirectUri: listener.redirectUri, state, challenge });
    this.log(`account: sign-in started, listening on ${listener.redirectUri}`);
    try {
      await this.openUrl(url);
    } catch (e) {
      this.log(`account: could not open the browser: ${e.message}`);
    }
    const r = await Promise.race([listener.result, stopped]);
    clearTimeout(timer);
    listener.close();
    this.pending = null;
    if (r.error) {
      this.status = this.record ? 'signedIn' : 'signedOut';
      this.notice = r.error === 'cancelled' ? null
        : r.error === 'timeout' ? 'Sign-in timed out after 5 minutes.'
          : r.error === 'access_denied' ? 'Sign-in denied on bfstats.io.' : `Sign-in failed: ${r.error}`;
      this.log(`account: sign-in ended: ${r.error}`);
      this.changed();
      return false;
    }
    try {
      const t = await this.call('POST', 'stats/auth/app/token', { body: { code: r.code, codeVerifier: verifier, redirectUri: listener.redirectUri } });
      this.applyTokens(t);
      this.log(`account: signed in as ${this.user?.username ?? 'unknown'}`);
    } catch (e) {
      this.status = this.record ? 'signedIn' : 'signedOut';
      this.notice = `Sign-in failed: ${e.message}`;
      this.log(`account: code exchange failed: ${e.message}`);
      this.changed();
      return false;
    }
    this.changed();
    await this.loadProfiles().catch(() => {});
    return true;
  }

  cancelSignIn() { this.pending?.cancel('cancelled'); }

  /** Revoke this sign-in on bfstats.io (best effort) and forget it here. */
  async signOut() {
    const rec = this.record;
    this.forget();
    this.log('account: signed out');
    this.changed();
    if (rec?.refreshToken) {
      try { await this.call('POST', 'stats/auth/app/revoke', { body: { refreshToken: rec.refreshToken } }); } catch (e) { this.log(`account: revoke failed: ${e.message}`); }
    }
  }

  forget() {
    this.store.clear();
    this.record = null;
    this.access = null;
    this.user = null;
    this.profiles = null;
    this.profilesError = null;
    this.status = 'signedOut';
  }

  /** The API ended the sign-in (a 401 on refresh): signed out, said once. */
  endedByServer(why) {
    if (this.status !== 'signedIn') return;
    this.forget();
    this.notice = 'Your bfstats.io sign-in ended. Sign in again to use your profiles.';
    this.log(`account: signed out by bfstats.io (${why})`);
    this.emit('signed-out', why);
    this.changed();
  }

  // ---- tokens -----------------------------------------------------------------

  /** One refresh at a time: two would replay the same token and revoke the family. */
  refresh() {
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const rec = this.record;
        if (!rec?.refreshToken) throw new AccountError('not signed in', 401);
        try {
          const t = await this.call('POST', 'stats/auth/app/refresh', { body: { refreshToken: rec.refreshToken } });
          this.applyTokens(t);
          this.log('account: tokens refreshed');
        } catch (e) {
          // 401 is the contract's "signed out"; a 400 invalid_grant (an expired or
          // revoked token) means the same. Anything else (offline, 5xx) keeps it.
          if (e.status === 401 || (e.status === 400 && /invalid_grant/i.test(e.message))) this.endedByServer(`${e.status} ${e.message}`);
          throw e;
        }
      })().finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }

  async accessToken() {
    if (!this.signedIn) throw new AccountError('not signed in', 401);
    if (!this.access || this.access.expiresAt - this.now() < REFRESH_MARGIN_MS) await this.refresh();
    return this.access.token;
  }

  /** A signed-in call; a 401 refreshes once and tries again. */
  async authed(method, rel, opts = {}) {
    const token = await this.accessToken();
    try {
      return await this.call(method, rel, { ...opts, token });
    } catch (e) {
      if (e.status !== 401) throw e;
      this.access = null;
      const again = await this.accessToken();
      try {
        return await this.call(method, rel, { ...opts, token: again });
      } catch (e2) {
        if (e2.status === 401) this.endedByServer('401 after a refresh');
        throw e2;
      }
    }
  }

  // ---- game profiles ----------------------------------------------------------

  /** GET the profiles (one load at a time). Keeps the last list when offline. */
  loadProfiles() {
    if (!this.signedIn) return Promise.resolve(null);
    if (!this.loadingProfiles) {
      this.loadingProfiles = (async () => {
        try {
          const list = await this.authed('GET', 'stats/account/game-profiles');
          this.profiles = (Array.isArray(list) ? list : []).map(profileView).filter((p) => p.name)
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
          // Only failures were logged, so a log ended on "did not answer in
          // time" even when the next reload worked a minute later.
          if (this.profilesError) this.log(`account: profiles: loaded ${this.profiles.length} again`);
          this.profilesError = null;
        } catch (e) {
          if (this.signedIn) this.profilesError = e.message;
          this.log(`account: profiles: ${e.message}`);
        }
        this.changed();
        return this.profiles;
      })().finally(() => { this.loadingProfiles = null; });
    }
    return this.loadingProfiles;
  }

  /** Make `name` the active profile, then read the list back. */
  async activate(name) {
    const p = this.profiles?.find((x) => x.name === name);
    if (!p) throw new AccountError(`no profile ${name}`, 404);
    await this.authed('POST', `stats/account/game-profiles/${encodeURIComponent(name)}/activate`);
    this.profiles = this.profiles.map((x) => ({ ...x, active: x.name === name }));
    this.log(`account: active profile ${name} (${p.joinName})`);
    this.changed();
    await this.loadProfiles();
    return true;
  }

  /**
   * Set (or, with null or a blank, clear) the name `name` plays as through
   * the sidecar: `PATCH stats/account/game-profiles/{name}`. The rule is the
   * sidecar's (address.js sidecarNameError); a refused name throws before
   * anything is sent, and the API's own 400 comes back as its message.
   */
  async setSidecarName(name, sidecarName) {
    const p = this.profiles?.find((x) => x.name === name);
    if (!p) throw new AccountError(`no profile ${name}`, 404);
    const wanted = typeof sidecarName === 'string' && sidecarName.trim() ? sidecarName.trim() : null;
    const why = wanted ? sidecarNameError(wanted) : null;
    if (why) throw new AccountError(why, 400);
    const answer = await this.authed('PATCH', `stats/account/game-profiles/${encodeURIComponent(name)}`, { body: { sidecarName: wanted } });
    const saved = answer && typeof answer === 'object' ? profileView({ ...answer, isActive: p.active }) : { ...p, sidecarName: wanted, joinName: wanted ?? p.playerName };
    this.profiles = this.profiles.map((x) => (x.name === name ? { ...x, sidecarName: saved.sidecarName, joinName: saved.joinName } : x));
    this.log(`account: profile ${name} plays through the sidecar as ${saved.joinName}${saved.sidecarName ? '' : ' (its game name)'}`);
    this.changed();
    return saved;
  }
}

module.exports = {
  CLIENT, DEFAULT_SITE, SIGN_IN_TIMEOUT_MS, REFRESH_MARGIN_MS,
  b64url, challengeFor, makePkce, makeState, cleanDevice, cleanBase, redirectUriFor, authorizeUrl,
  parseCallback, listenForCallback, callbackPage, TokenStore, Account, AccountError, profileView,
};
