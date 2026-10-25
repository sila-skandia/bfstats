'use strict';
// A profile's sidecar name (features/game-profiles, "Sidecar name"): the name
// a join through the sidecar uses when it should not be the game's. The rule,
// the panel and menu models, and the PATCH against the stand-in API.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Account, TokenStore, profileView } = require('../src/account');
const { sidecarNameError, cleanProfileName } = require('../src/address');
const { createStandIn } = require('../scripts/stand-in-api');
const { accountSection } = require('../src/panel-state');
const { buildModel, findById } = require('../src/menu-model');

const fakeCrypt = () => ({
  available: () => true,
  backend: () => 'gnome_libsecret',
  encrypt: (t) => Buffer.from(`enc:${Buffer.from(t).toString('base64')}`),
  decrypt: (b) => Buffer.from(b.toString().slice(4), 'base64').toString(),
});
const browser = () => async (url) => { const r = await fetch(url); await r.text(); };

test('the rule is the sidecar\'s, refusing what it would cut', () => {
  for (const ok of ['Sidecar', 'Jörg Müller', '[CLAN]x-y.z!', '12345678901234567890123', '', '   ']) {
    assert.equal(sidecarNameError(ok), null, ok);
  }
  assert.match(sidecarNameError('say "hi"'), /quote/i);
  assert.match(sidecarNameError('tab\there'), /control/i);
  assert.match(sidecarNameError('c1\u0085'), /control/i);
  assert.match(sidecarNameError('Иван'), /Latin-1/);
  assert.match(sidecarNameError('x'.repeat(24)), /23/);
  // Whatever the rule passes, the join's own clean-up passes unchanged.
  assert.equal(cleanProfileName('  Jörg Müller '), 'Jörg Müller');
});

test('profileView: the join name is the sidecar name, else the game\'s', () => {
  assert.deepEqual(
    [profileView({ name: 'a', playerName: 'Game', sidecarName: 'Side' }).joinName,
      profileView({ name: 'a', playerName: 'Game', sidecarName: null }).joinName,
      profileView({ name: 'a', playerName: 'Game', sidecarName: '  ' }).joinName,
      profileView({ name: 'a', playerName: 'Game' }).joinName],
    ['Side', 'Game', 'Game', 'Game']);
  assert.equal(profileView({ name: 'a', playerName: 'Game', sidecarName: '  ' }).sidecarName, null);
});

test('the panel and the menu show the name a join uses, the game name beside it', () => {
  const account = {
    status: 'signedIn', username: 'skandia',
    profiles: [
      { name: 'skandia', playerName: 'skandia', sidecarName: 'Sidecar', active: true },
      { name: 'alt', playerName: 'Alt', sidecarName: null, active: false },
      { name: 'ru', playerName: 'game', sidecarName: 'Ïðèâåò', active: false },  // cp1251 read as cp1252
    ],
  };
  const sec = accountSection(account);
  assert.deepEqual(sec.profiles.map((p) => [p.playsAs, p.playerName, p.renamed, p.sidecarName]), [
    ['Sidecar', 'skandia', true, 'Sidecar'],
    ['Alt', 'Alt', false, null],
    ['Привет', 'game', true, 'Ïðèâåò'],
  ]);
  assert.equal(sec.active.playsAs, 'Sidecar');

  const calls = [];
  const actions = new Proxy({}, { get: (_t, k) => (...a) => calls.push([k, ...a]) });
  const menu = buildModel({ session: null, servers: [], settings: { recent: [] }, actions, account });
  const prof = findById(menu, 'account-profile');
  assert.equal(prof.label, 'Profile: Sidecar');
  assert.deepEqual(prof.submenu.filter((i) => i.type === 'radio').map((r) => r.label),
    ['Sidecar  (skandia)', 'Alt', 'Привет  (ru)']);
});

test('setSidecarName: PATCH, kept by a reload, cleared, refused before sending', async () => {
  const api = createStandIn({
    profiles: [
      { name: 'skandia', playerName: 'skandia', isActive: true },
      { name: 'clan', playerName: '=SK=skandia', isActive: false },
    ],
  });
  const base = await api.listen();
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-sidecar-'));
    const logs = [];
    const a = new Account({ siteBase: base, store: new TokenStore(path.join(dir, 'a.bin'), fakeCrypt()), openUrl: browser(), log: (l) => logs.push(l) });
    a.start();
    assert.equal(await a.signIn(), true);
    await a.loadProfiles();
    assert.equal(a.activeProfile().joinName, 'skandia');

    const saved = await a.setSidecarName('skandia', '  Sidecar Ace ');
    assert.equal(saved.sidecarName, 'Sidecar Ace');
    assert.equal(a.activeProfile().joinName, 'Sidecar Ace');
    assert.equal(a.activeProfile().playerName, 'skandia', 'the game name stays');
    assert.equal(api.state.profiles[0].sidecarName, 'Sidecar Ace');
    assert.ok(api.state.calls.includes('PATCH /stats/account/game-profiles/skandia'));
    assert.ok(logs.some((l) => /plays through the sidecar as Sidecar Ace/.test(l)));

    await a.loadProfiles();
    assert.equal(a.activeProfile().joinName, 'Sidecar Ace', 'read back from the API');
    assert.equal(a.activeProfile().active, true);

    const patches = () => api.state.calls.filter((c) => c.startsWith('PATCH')).length;
    const before = patches();
    await assert.rejects(a.setSidecarName('skandia', 'a"b'), (e) => e.status === 400 && /quote/i.test(e.message));
    await assert.rejects(a.setSidecarName('nobody', 'x'), (e) => e.status === 404);
    assert.equal(patches(), before, 'nothing sent for a refused name');

    await a.setSidecarName('skandia', '');
    assert.equal(a.activeProfile().sidecarName, null);
    assert.equal(a.activeProfile().joinName, 'skandia');
    assert.equal(api.state.profiles[0].sidecarName, null);

    // A switch keeps each profile's own sidecar name.
    await a.setSidecarName('clan', 'ClanSide');
    await a.activate('clan');
    assert.equal(a.activeProfile().joinName, 'ClanSide');
  } finally {
    await api.close();
  }
});
