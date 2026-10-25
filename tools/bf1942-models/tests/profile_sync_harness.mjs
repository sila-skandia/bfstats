// `viewer/profile-sync.js` under node, through the real API client
// (`viewer/recordings-api.js`, same-origin mode: the site's refresh cookie)
// against the contract's stand-in (`game_profiles_standin.mjs`). Each case
// is a fresh page: its own localStorage, its own client. Prints one JSON
// object; `test_profile_sync.py` reads it.
import { readFileSync } from 'node:fs';
import { createControls } from '../viewer/controls.js';
import { CONTROLS_DEFAULTS } from '../viewer/controls-defaults.js';
import { createRecordingsApi } from '../viewer/recordings-api.js';
import { createProfileSync } from '../viewer/profile-sync.js';
import { startStandin } from './game_profiles_standin.mjs';

const FIX = new URL('./fixtures/controls-profile-skandia/', import.meta.url);
const fixture = (name) => readFileSync(new URL(name, FIX), 'utf8');
const GENERAL = 'rem *** Generated ***\ngame.setPlayerName "skandia"\ngame.setCrossHairColor 255.000000 0.000000 0.000000\n';
const ACCOUNT_FILES = {
  'Controls/Common.con': fixture('Common.con'), 'Controls/Infantry.con': fixture('Infantry.con'),
  'Controls/Air.con': fixture('Air.con'), 'Controls/Land.con': fixture('Land.con'), 'GeneralOptions.con': GENERAL,
};
// A folder picked in the browser: `Profiles/<name>/...` relative paths.
const folder = (name, player) => [
  { name: 'GeneralOptions.con', webkitRelativePath: `${name}/GeneralOptions.con`, text: `game.setPlayerName "${player}"\n` },
  { name: 'Air.con', webkitRelativePath: `${name}/Controls/Air.con`, text: fixture('Air.con') },
  { name: 'Common.con', webkitRelativePath: `${name}/Controls/Common.con`, text: fixture('Common.con') },
  { name: 'Video.con', webkitRelativePath: `${name}/Video.con`, text: 'renderer.setViewDistanceScale 1.0\n' },
];

function freshStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
  return m;
}
const page = () => ({ keys: new Set(), captured: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const puts = (s) => s.log.filter((r) => r.method === 'PUT').map((r) => r.path);
const out = {};

async function open(standin, { debounceMs = 60 } = {}) {
  const warnings = [];
  const controls = createControls(page());
  const api = createRecordingsApi({ base: standin.url, mode: 'same' });
  const sync = createProfileSync({ controls, api, debounceMs, warn: (t) => warnings.push(t) });
  await sync.ready;
  return { controls, sync, warnings };
}

// 1. Signed out: localStorage only, said once, the local name still the identity.
{
  const s = await startStandin({ signedIn: false });
  freshStorage();
  const { controls, sync, warnings } = await open(s);
  await controls.importFiles(folder('local', 'LocalName'));
  await controls.importFiles(folder('local', 'LocalName'));
  await sleep(150);
  out.signedOut = { state: sync.state, warnings, puts: puts(s), identity: await sync.identity(), profileName: controls.describe().profileName };
  await s.close();
}

// 2. Signed in with an active profile: it replaces what localStorage held.
{
  const s = await startStandin();
  s.state.profiles.push({ name: 'skandia', isActive: true, playerName: 'skandia', files: ACCOUNT_FILES, updatedAt: '2026-10-25T00:00:00Z' });
  const store = freshStorage();
  // An older import in this browser, which the account must win over.
  store.set('viewer.controls.profile', JSON.stringify({ source: 'profile', files: { common: CONTROLS_DEFAULTS.files.common }, profileName: 'stale', playerName: 'stale' }));
  const { controls, sync, warnings } = await open(s);
  out.loaded = {
    state: sync.state, active: sync.active, warnings,
    profileName: controls.describe().profileName,
    mapOnF: controls.codeTriggers('KeyF').includes('c_PIMap'),
    crossHair: controls.crossHairColor(),
    identity: await sync.identity(),
    origin: controls.profileOrigin(),
    stored: JSON.parse(store.get('viewer.controls.profile')).account,
    puts: puts(s),
  };

  // 3. An import of another folder: saved under that folder's name, made
  //    active, once for two quick changes.
  await controls.importFiles(folder('Other', 'OtherName'));
  await controls.importFiles(folder('Other', 'OtherName'));
  await sleep(250);
  const other = s.profiles.find((p) => p.name === 'Other');
  out.imported = {
    puts: puts(s),
    active: s.profiles.filter((p) => p.isActive).map((p) => p.name),
    files: other ? Object.keys(other.files).sort() : null,
    playerName: other?.playerName ?? null,
    general: other?.files['GeneralOptions.con'] ?? null,
    syncActive: sync.active,
    identity: await sync.identity(),
  };

  // 4. DEFAULT: the active profile takes the shipped maps, keeps its name.
  s.log.length = 0;
  controls.resetDefaults();
  await sleep(250);
  const afterReset = s.profiles.find((p) => p.name === 'Other');
  out.reset = {
    puts: puts(s),
    defaultsSent: afterReset?.files['Controls/Common.con'] === CONTROLS_DEFAULTS.files.common,
    active: s.profiles.filter((p) => p.isActive).map((p) => p.name),
    profileName: controls.describe().profileName,
  };

  // 5. The picker: back to skandia.
  s.log.length = 0;
  const switched = await sync.activate('SKANDIA');
  out.activate = {
    ok: switched,
    calls: s.log.map((r) => `${r.method} ${r.path}`),
    active: s.profiles.filter((p) => p.isActive).map((p) => p.name),
    profileName: controls.describe().profileName,
    mapOnF: controls.codeTriggers('KeyF').includes('c_PIMap'),
    view: sync.view(),
  };
  out.missing = await sync.activate('nobody');
  await s.close();
}

// 5b. A sidecar name on the account (features/game-profiles, "Sidecar name"):
//     the identity is it, a DEFAULT's save keeps it, and with it cleared the
//     identity is the game's name again.
{
  const s = await startStandin();
  s.state.profiles.push({ name: 'skandia', isActive: true, playerName: 'skandia', sidecarName: 'Sidecar Ace', files: ACCOUNT_FILES, updatedAt: '2026-10-25T00:00:00Z' });
  freshStorage();
  const { controls, sync } = await open(s);
  const identity = await sync.identity();
  controls.resetDefaults();
  await sleep(250);
  const stored = s.profiles.find((p) => p.name === 'skandia');
  const afterSave = {
    puts: puts(s),
    storedSidecar: stored.sidecarName,
    defaultsSent: stored.files['Controls/Common.con'] === CONTROLS_DEFAULTS.files.common,
    viewSidecar: sync.view().profiles.find((p) => p.name === 'skandia')?.sidecarName ?? null,
    identity: await sync.identity(),
  };
  stored.sidecarName = null;
  freshStorage();
  const again = await open(s);
  out.sidecarName = { identity, afterSave, cleared: await again.sync.identity() };
  await s.close();
}

// 6. The list fails: localStorage, said once, nothing sent after.
{
  const s = await startStandin({ failList: true });
  freshStorage();
  const { controls, sync, warnings } = await open(s);
  await controls.importFiles(folder('x', 'X'));
  await sleep(150);
  out.failed = { state: sync.state, warnings, puts: puts(s) };
  await s.close();
}

// 7. No API at all (the port closed): the same.
{
  const s = await startStandin();
  const url = s.url;
  await s.close();
  freshStorage();
  const warnings = [];
  const controls = createControls(page());
  const sync = createProfileSync({ controls, api: createRecordingsApi({ base: url, mode: 'same' }), debounceMs: 60, warn: (t) => warnings.push(t) });
  await sync.ready;
  out.offline = { state: sync.state, warnings: warnings.length };
}

// 8. An empty account takes this browser's earlier import.
{
  const s = await startStandin();
  const store = freshStorage();
  {
    const before = createControls(page());
    await before.importFiles(folder('Mine', 'MineName'));
  }
  const { sync } = await open(s);
  await sleep(250);
  out.seeded = { profiles: s.profiles.map((p) => [p.name, p.isActive, p.playerName]), active: sync.active, stored: !!store.get('viewer.controls.profile') };
  await s.close();
}

// 9. The eleventh profile is refused: said, kept here.
{
  const s = await startStandin();
  for (let i = 0; i < 10; i++) s.state.profiles.push({ name: `p${i}`, isActive: i === 0, playerName: `p${i}`, files: ACCOUNT_FILES, updatedAt: '2026-10-25T00:00:00Z' });
  freshStorage();
  const { controls, sync, warnings } = await open(s);
  await controls.importFiles(folder('Eleventh', 'E'));
  await sleep(250);
  out.full = { count: s.profiles.length, warnings, state: sync.state, local: controls.describe().profileName };
  await s.close();
}

console.log(JSON.stringify(out));
