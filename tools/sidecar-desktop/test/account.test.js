'use strict';
// The bfstats.io sign-in (src/account.js): the pure parts, then the whole
// flow against the stand-in API (scripts/stand-in-api.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  b64url, challengeFor, makePkce, makeState, cleanDevice, cleanBase, authorizeUrl, parseCallback,
  listenForCallback, TokenStore, Account,
} = require('../src/account');
const { createStandIn } = require('../scripts/stand-in-api');
const { accountSection, panelState } = require('../src/panel-state');
const { buildModel, findById } = require('../src/menu-model');
const { Settings } = require('../src/settings');

// A reversible stand-in for safeStorage.
const fakeCrypt = (backend = 'gnome_libsecret') => ({
  available: () => true,
  backend: () => backend,
  encrypt: (t) => Buffer.from(`enc:${Buffer.from(t).toString('base64')}`),
  decrypt: (b) => { const s = b.toString(); assert.ok(s.startsWith('enc:')); return Buffer.from(s.slice(4), 'base64').toString(); },
});
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('PKCE: S256 of a 32-byte verifier, base64url', () => {
  // Worked out with openssl dgst -sha256 -binary | base64, + and / swapped, = dropped.
  assert.equal(challengeFor('abcdefghijklmnopqrstuvwxyz0123456789-._~ABCDEFG'), 'TDp3C-wPo3aKDK1Bg-ukP78nZ9YiqUD2ToRD96HoaHU');
  const { verifier, challenge } = makePkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, b64url(crypto.createHash('sha256').update(verifier).digest()));
  assert.notEqual(makePkce().verifier, verifier);
  assert.match(makeState(), /^[A-Za-z0-9_-]{32}$/);
});

test('the authorize URL', () => {
  const url = new URL(authorizeUrl({ siteBase: 'https://bfstats.io', device: 'my-pc', redirectUri: 'http://127.0.0.1:5555/callback', state: 'S', challenge: 'C' }));
  assert.equal(url.origin + url.pathname, 'https://bfstats.io/auth/app');
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client: 'bfstats-sidecar', device: 'my-pc', redirect_uri: 'http://127.0.0.1:5555/callback', state: 'S', code_challenge: 'C', code_challenge_method: 'S256',
  });
  assert.equal(new URL(authorizeUrl({ siteBase: 'http://localhost:5173/', device: '', redirectUri: 'x', state: 's', challenge: 'c' })).searchParams.get('device'), 'this PC');
  assert.equal(cleanDevice('x'.repeat(100)).length, 64);
  assert.equal(cleanDevice('a\nb'), 'ab');
  assert.equal(cleanBase('http://127.0.0.1:9222'), 'http://127.0.0.1:9222/');
  assert.equal(cleanBase('javascript:alert(1)'), null);
  assert.equal(cleanBase('https://u:p@bfstats.io/'), null);
});

test('the callback: only GET /callback with our state', () => {
  assert.deepEqual(parseCallback('GET', '/callback?code=abc&state=S1', 'S1'), { kind: 'code', code: 'abc' });
  assert.deepEqual(parseCallback('GET', '/callback?error=access_denied&state=S1', 'S1'), { kind: 'error', error: 'access_denied' });
  assert.deepEqual(parseCallback('GET', '/callback?state=S1', 'S1'), { kind: 'error', error: 'no_code' });
  assert.equal(parseCallback('GET', '/callback?code=abc&state=S2', 'S1').kind, 'bad-state');
  assert.equal(parseCallback('GET', '/callback?code=abc', 'S1').kind, 'bad-state');
  assert.equal(parseCallback('GET', '/callback?code=abc&state=', '').kind, 'bad-state');
  assert.equal(parseCallback('POST', '/callback?code=abc&state=S1', 'S1').kind, 'not-found');
  assert.equal(parseCallback('GET', '/other?code=abc&state=S1', 'S1').kind, 'not-found');
  assert.equal(parseCallback('GET', '/callback/x?code=abc&state=S1', 'S1').kind, 'not-found');
});

test('the loopback listener: 127.0.0.1, one shot, ignores strangers', async () => {
  const l = await listenForCallback({ state: 'good' });
  assert.match(l.redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  const base = `http://127.0.0.1:${l.port}`;
  assert.equal((await fetch(`${base}/`)).status, 404);
  assert.equal((await fetch(`${base}/callback?code=x&state=bad`)).status, 400);
  const ok = await fetch(`${base}/callback?code=thecode&state=good`);
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Signed in/);
  assert.deepEqual(await l.result, { code: 'thecode' });
  await assert.rejects(fetch(`${base}/callback?code=again&state=good`));   // closed
  const c = await listenForCallback({ state: 's' });
  c.close();
  assert.deepEqual(await c.result, { error: 'cancelled' });
});

test('the token store: encrypted, replaced whole, protection said', () => {
  const dir = tmp('acct-store-');
  const file = path.join(dir, 'account.bin');
  const s = new TokenStore(file, fakeCrypt());
  assert.equal(s.load(), null);
  assert.equal(s.protection(), 'keyring');
  s.save({ refreshToken: 'rt1', refreshExpiresAt: 'x', user: { id: 1, username: 'u', extra: 1 } });
  assert.ok(!fs.readFileSync(file, 'utf8').includes('rt1'), 'not in the clear');
  assert.deepEqual(new TokenStore(file, fakeCrypt()).load(), { refreshToken: 'rt1', refreshExpiresAt: 'x', user: { id: 1, username: 'u' } });
  s.save({ refreshToken: 'rt2' });
  assert.equal(s.load().refreshToken, 'rt2');
  assert.deepEqual(fs.readdirSync(dir), ['account.bin'], 'no temp file left');
  fs.writeFileSync(file, 'garbage');
  assert.equal(s.load(), null);
  s.clear();
  assert.equal(fs.existsSync(file), false);
  assert.equal(new TokenStore(file, fakeCrypt('basic_text')).protection(), 'basic_text');
  const mem = new TokenStore(file, { available: () => false });
  assert.equal(mem.protection(), 'memory');
  mem.save({ refreshToken: 'm' });
  assert.equal(mem.load().refreshToken, 'm');
  assert.equal(fs.existsSync(file), false, 'memory only: nothing on disk');
});

test('settings: the name source migrates page to account', () => {
  const dir = tmp('acct-settings-');
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ nameSource: 'page', playerName: 'Old' }));
  const s = new Settings(dir);
  assert.equal(s.get('nameSource'), 'account');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')).nameSource, 'account', 'written back');
  assert.equal(new Settings(tmp('acct-settings-')).get('nameSource'), 'account', 'the default');
  assert.deepEqual(s.update({ nameSource: 'page' }), {});
  assert.equal(s.get('nameSource'), 'account');
  assert.deepEqual(Object.keys(s.update({ siteBase: 'ftp://x', apiBase: 'nope' })).sort(), ['apiBase', 'siteBase']);
  assert.deepEqual(s.update({ siteBase: 'http://127.0.0.1:5173', apiBase: 'http://127.0.0.1:9222' }), {});
  assert.deepEqual([s.get('siteBase'), s.get('apiBase')], ['http://127.0.0.1:5173/', 'http://127.0.0.1:9222/']);
  assert.deepEqual(s.update({ apiBase: '' }), {});
  assert.equal(s.get('apiBase'), '');
});

test('the panel and the brief menu: signed out, waiting, signed in', () => {
  const calls = [];
  const actions = new Proxy({}, { get: (_t, k) => (...a) => calls.push([k, ...a]) });
  const base = { session: null, servers: [], settings: { recent: [] }, actions };
  const out = buildModel({ ...base, account: { status: 'signedOut', profiles: null } });
  findById(out, 'account-sign-in').click();
  assert.deepEqual(calls.at(-1), ['signIn']);
  assert.equal(findById(out, 'account-sign-in').label, 'Sign in...');
  const waiting = buildModel({ ...base, account: { status: 'waiting' } });
  assert.equal(findById(waiting, 'account-waiting').enabled, false);
  findById(waiting, 'account-cancel').click();
  assert.deepEqual(calls.at(-1), ['cancelSignIn']);
  const account = {
    status: 'signedIn', username: 'skandia', protection: 'basic_text', importUrl: 'https://bfstats.io/v4/dashboard?tab=profiles',
    profiles: [
      { name: 'Skandia', playerName: 'skandia', active: true },
      { name: 'alt', playerName: 'Big & Ben', active: false },
      { name: 'ru', playerName: 'Ïðèâåò', active: false },   // cp1251 read as cp1252
    ],
  };
  const inn = buildModel({ ...base, account });
  const prof = findById(inn, 'account-profile');
  assert.equal(prof.label, 'Profile: skandia');
  const radios = prof.submenu.filter((i) => i.type === 'radio');
  assert.deepEqual(radios.map((r) => [r.label, r.checked]), [['skandia', true], ['Big && Ben  (alt)', false], ['Привет  (ru)', false]]);
  radios[1].click();
  assert.deepEqual(calls.at(-1), ['activateProfile', 'alt']);
  const before = calls.length;
  radios[0].click();
  assert.equal(calls.length, before, 'the active one does nothing');
  findById(inn, 'profile-import').click();
  assert.deepEqual(calls.at(-1), ['openImport']);
  const ids = inn.map((i) => i.id);
  assert.ok(ids.indexOf('account-profile') < ids.indexOf('open-panel'));
  const none = buildModel({ ...base, account: { ...account, profiles: [] } });
  assert.equal(findById(none, 'profile-none').label, 'No profiles yet');

  const sec = accountSection(account);
  assert.equal(sec.active.playerName, 'skandia');
  assert.equal(sec.profiles[2].playerName, 'Привет');
  assert.equal(sec.profiles[2].name, 'ru', 'activate gets the raw name');
  assert.equal(sec.protection, 'basic_text');
  const p = panelState({ ...base, account, nameInfo: { name: 'skandia', source: 'account', profile: 'Skandia' } });
  assert.deepEqual([p.name.label, p.name.name, p.name.fromPage, p.name.profile], ['bfstats.io profile', 'skandia', false, 'Skandia']);
  assert.equal(panelState({ ...base }).account, null);
});

// ---- the whole flow against the stand-in ------------------------------------

async function withStandIn(opts, fn) {
  const api = createStandIn(opts);
  const base = await api.listen();
  try { await fn(api, base); } finally { await api.close(); }
}

/** The browser: follow the Allow page's redirect to the app's loopback. */
const browser = (seen = []) => async (url) => { seen.push(url); const r = await fetch(url); await r.text(); };

test('sign in, list, switch, refresh with rotation, a 401, sign out', async () => {
  let clock = Date.now();
  await withStandIn({ now: () => clock, accessTtlMs: 10 * 60_000 }, async (api, base) => {
    const dir = tmp('acct-flow-');
    const file = path.join(dir, 'account.bin');
    const seen = [];
    const changes = [];
    const a = new Account({ siteBase: base, store: new TokenStore(file, fakeCrypt()), openUrl: browser(seen), device: 'test-pc', now: () => clock });
    a.on('change', (v) => changes.push(v.status));
    a.start();
    assert.equal(a.status, 'signedOut');

    assert.equal(await a.signIn(), true);
    assert.ok(changes.includes('waiting'));
    const q = new URL(seen[0]).searchParams;
    assert.equal(q.get('device'), 'test-pc');
    assert.equal(q.get('code_challenge_method'), 'S256');
    assert.equal(a.status, 'signedIn');
    assert.equal(a.view().username, 'skandia');
    assert.deepEqual(a.profiles.map((p) => [p.name, p.playerName, p.active]),
      [['Big Ben', 'Big Ben', false], ['clan', '=SK=skandia', false], ['skandia', 'skandia', true]]);
    assert.equal(a.activeProfile().playerName, 'skandia');
    const firstRefresh = new TokenStore(file, fakeCrypt()).load().refreshToken;
    assert.ok(firstRefresh);

    // Switch.
    await a.activate('clan');
    assert.equal(a.activeProfile().playerName, '=SK=skandia');
    assert.equal(api.state.profiles.find((p) => p.isActive).name, 'clan');

    // The access token near its end: refreshed before the call, rotated, saved.
    clock += 9.5 * 60_000;
    await a.loadProfiles();
    const second = new TokenStore(file, fakeCrypt()).load().refreshToken;
    assert.notEqual(second, firstRefresh, 'rotated and saved');
    assert.ok(api.state.calls.includes('POST /stats/auth/app/refresh'));

    // Two calls at once refresh once (a second refresh would replay a token).
    clock += 11 * 60_000;
    const refreshesBefore = api.state.calls.filter((c) => c.endsWith('/refresh')).length;
    await Promise.all([a.loadProfiles(), a.activate('skandia'), a.accessToken()]);
    assert.equal(api.state.calls.filter((c) => c.endsWith('/refresh')).length, refreshesBefore + 1);
    assert.equal(a.status, 'signedIn');

    // A fresh start: back from the store, and a refresh to get an access token.
    const b = new Account({ siteBase: base, store: new TokenStore(file, fakeCrypt()), openUrl: browser(), now: () => clock });
    b.start();
    assert.equal(b.status, 'signedIn');
    assert.equal(b.view().username, 'skandia');
    await b.loadProfiles();
    assert.equal(b.profiles.length, 3);
    // `a` still holds a token `b` has rotated away: replaying it is a 401, and
    // (as the real API) revokes the family, so `b` is signed out on its next refresh too.
    a.access = null;
    const ended = [];
    a.on('signed-out', (why) => ended.push(why));
    await a.loadProfiles();
    assert.equal(a.status, 'signedOut');
    assert.equal(ended.length, 1, 'said once');
    assert.match(a.view().notice, /sign-in ended/);
    assert.equal(fs.existsSync(file), false, 'the token is cleared');
    await a.loadProfiles();
    assert.equal(ended.length, 1, 'still once');
    a.dismissNotice();
    assert.equal(a.view().notice, null);
  });
});

test('sign out revokes; deny, timeout and cancel leave it signed out', async () => {
  await withStandIn({}, async (api, base) => {
    const dir = tmp('acct-flow2-');
    const file = path.join(dir, 'account.bin');
    const a = new Account({ siteBase: base, store: new TokenStore(file, fakeCrypt()), openUrl: browser() });
    a.start();
    await a.signIn();
    const rt = a.record.refreshToken;
    await a.signOut();
    assert.equal(a.status, 'signedOut');
    assert.equal(fs.existsSync(file), false);
    assert.ok(api.state.revokedFamilies.has(api.state.refresh.get(rt).family), 'revoked on the server');

    api.state.deny = true;
    assert.equal(await a.signIn(), false);
    assert.equal(a.status, 'signedOut');
    assert.match(a.view().notice, /denied/);
    api.state.deny = false;

    const slow = new Account({ siteBase: base, store: new TokenStore(path.join(dir, 'b.bin'), fakeCrypt()), openUrl: async () => {}, signInTimeoutMs: 100 });
    assert.equal(await slow.signIn(), false);
    assert.match(slow.view().notice, /timed out/);

    const cancelled = new Account({ siteBase: base, store: new TokenStore(path.join(dir, 'c.bin'), fakeCrypt()), openUrl: async () => {} });
    const p = cancelled.signIn();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(cancelled.status, 'waiting');
    cancelled.cancelSignIn();
    assert.equal(await p, false);
    assert.equal(cancelled.status, 'signedOut');
    assert.equal(cancelled.view().notice, null);
  });
});

test('a code is bound to its verifier and used once', async () => {
  await withStandIn({}, async (_api, base) => {
    // Catch the redirect instead of following it, and replay the code.
    let captured;
    const a = new Account({
      siteBase: base, store: new TokenStore(path.join(tmp('acct-code-'), 'x.bin'), fakeCrypt()),
      openUrl: async (url) => {
        const r = await fetch(url, { redirect: 'manual' });
        captured = new URL(r.headers.get('location'));
        await fetch(captured);
      },
    });
    assert.equal(await a.signIn(), true);
    const replay = await fetch(new URL('stats/auth/app/token', base), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: captured.searchParams.get('code'), codeVerifier: 'wrong', redirectUri: `${captured.origin}/callback` }),
    });
    assert.equal(replay.status, 400);
  });
});

test('the sidecar says a given name, and the status keeps where it came from', () => {
  const { parseLine } = require('../src/sidecar-status');
  assert.deepEqual(parseLine('[sidecar] player name: =SK=skandia (given)'), { playerName: '=SK=skandia' });
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'bf1942-models', 'sidecar', 'sidecar.mjs'), 'utf8');
  assert.ok(src.includes('[sidecar] player name: ${name} (given)'));
});

test('a profile load that times out is logged, and so is the next one that works', async () => {
  const dir = tmp('acct-recover-');
  const store = new TokenStore(path.join(dir, 'account.bin'), fakeCrypt());
  store.save({ refreshToken: 'r1', refreshExpiresAt: null, user: { id: 1, username: 'skandia' } });
  let profileCalls = 0;
  const json = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  const fetch = async (url) => {
    if (url.endsWith('stats/auth/app/refresh')) {
      return json({ accessToken: 'a1', refreshToken: 'r2', expiresAt: new Date(Date.now() + 600_000).toISOString() });
    }
    if (url.endsWith('stats/account/game-profiles')) {
      profileCalls++;
      if (profileCalls === 1) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
      return json([{ name: 'skandia', playerName: 'skandia', active: true }]);
    }
    throw new Error(`unexpected ${url}`);
  };
  const lines = [];
  const a = new Account({ siteBase: 'https://bfstats.test/', store, openUrl: () => {}, fetch, log: (l) => lines.push(l) }).start();
  assert.equal(await a.loadProfiles(), null);
  assert.equal(a.view().profilesError, 'bfstats.io did not answer in time');
  assert.equal((await a.loadProfiles()).length, 1);
  assert.equal(a.view().profilesError, null);
  assert.deepEqual(lines.filter((l) => l.includes('profiles')), [
    'account: profiles: bfstats.io did not answer in time',
    'account: profiles: loaded 1 again',
  ]);
  // A load that works after one that worked says nothing.
  await a.loadProfiles();
  assert.equal(lines.filter((l) => l.includes('loaded')).length, 1);
});
