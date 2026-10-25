// The front end `play/index.html` mounts: SINGLEPLAY (Instant Battle),
// MULTIPLAY (the room server's lobby), OPTIONS > CONTROLS (the key bindings),
// CUSTOM GAME (the mod list) and REPLAY (the rounds players have shared,
// features/replay-feed), one canvas each, switched by the nav strip every
// screen draws. A bf42plus recording dropped anywhere on the page plays from
// disk (`../replay-open.js`), as does REPLAY's Watch a file. Moved out of the
// page's inline module script; `window.__menu` is the page's test hook.

import { createSkirmishScreen } from './skirmish.js';
import { createMultiplayScreen } from './multiplay.js';
import { createModPicker } from './mod-picker-screen.js';
import { createControlsScreen } from './controls-screen.js';
import { createControls } from '../controls.js';
import { createProfileSync } from '../profile-sync.js';
import { installRecordingOpener } from '../replay-open.js';
import { createReplayScreen } from './replay-screen.js';

const canvas = document.getElementById('screen');
const canvasMp = document.getElementById('screen-mp');
const canvasCg = document.getElementById('screen-cg');
const canvasOpt = document.getElementById('screen-opt');
const canvasRp = document.getElementById('screen-rp');
const status = document.getElementById('status');

// SINGLEPLAY, MULTIPLAY, OPTIONS and CUSTOM GAME on the main nav, each in
// its own slot; INTRO and CREDITS, which this site does not answer for, are
// not drawn. INTRO's plate is REPLAY's: the feed of shared recordings.
const TABS = [
  { page: 'mainNav',
    items: [{ key: 'MENU_SINGLEPLAY', id: 'singleplay' },
            { key: 'MENU_MULTIPLAY', id: 'multiplay' },
            { key: 'MENU_OPTIONS', id: 'options' },
            { key: 'MENU_CUSTOM_GAME', id: 'customgame' },
            { key: 'MENU_INTRO', id: 'replay', label: 'REPLAY' }] },
];
// OPTIONS' own row: CONTROLS and VIDEO are the two of its four this site
// has, the controls screen's two sections.
const OPTIONS_TABS = [
  ...TABS,
  { page: 'optionsNav',
    items: [{ key: 'MENU_CONTROLS', id: 'controls' }, { key: 'MENU_VIDEO', id: 'video' }] },
];
const MULTIPLAY_TABS = [
  ...TABS,
  { page: 'multiplayerNav',
    items: [{ key: 'MENU_CREATE_GAME', id: 'create', slot: 0,
              enabled: () => multiplay.online }] },
];

const NAME_KEY = 'bf42-mesh-player-name';
const params = new URLSearchParams(location.search);
const playerName = (() => {
  const asked = params.get('name');
  try {
    if (asked) localStorage.setItem(NAME_KEY, asked);
    return asked || localStorage.getItem(NAME_KEY) || 'Player';
  } catch (_) { return asked || 'Player'; }
})();

// SINGLEPLAYER: Instant Battle with bot settings visible, no mod picker.
// Bots are always on — `botCount: 4`, `botSkill: 0.75` by default.
// This is the one Instant Battle screen: `map.html` mounts the same
// controller with the same options as its Esc menu, so Escaping out of a
// level lands on the screen the level was launched from.
const screen = createSkirmishScreen({
  canvas,
  root: '../',
  music: true,
  // `menu/Background`'s movie, behind every tab this page draws: the one
  // controller that follows the active mod starts it for all of them.
  movie: true,
  tabs: TABS,
  onTab: id => show(id),
  onStatus: text => { status.textContent = text; },
  // The mod is picked on the CUSTOM GAME tab now, and that tab hands it
  // here: re-fetch the level list in place rather than reload the page and
  // lose the menu loop with it.
  modChoice: 'inplace',
});

// MULTIPLAY: room server lobby. Built lazily.
const multiplay = createMultiplayScreen({
  canvas: canvasMp,
  root: '../',
  tabs: MULTIPLAY_TABS,
  onTab: id => (id === 'create' ? multiplay.openCreate() : show(id)),
  onStatus: text => { status.textContent = text; },
});
multiplay.setName(playerName);

// CUSTOM GAME: the mod list — which game Instant Battle is a battle in.
// Picking one switches the mod the way it always did; the level list on the
// Instant Battle tab follows it.
const customGame = createModPicker({
  canvas: canvasCg,
  root: '../',
  tabs: TABS,
  onTab: id => show(id),
  onMod: id => screen.chooseMod(id),
  onStatus: text => { status.textContent = text; },
});

// OPTIONS > CONTROLS: the profile's bindings, over the shipped maps, and a
// preview to try them on. Its own control map, fed by the same stored
// profile the viewer loads.
const controls = createControls({ keys: new Set() });
// The account's profiles (features/game-profiles): the front end shows and
// switches them as the level page does.
const profileSync = createProfileSync({ controls });
window.__profileSync = profileSync;
const options = createControlsScreen({
  canvas: canvasOpt,
  controls,
  profileSync,
  root: '../',
  tabs: OPTIONS_TABS,
  onTab: id => show(id),
  onStatus: text => { status.textContent = text; },
  pollPad: true,
});

// A recording from disk, from REPLAY's Watch a file or dropped on the page,
// plays on its own level: `map.html?replay=local:<name>` behind that level's
// loading screen. One whose server named no mod plays in the menu's. An
// extra: one that cannot be installed leaves the menu without it, not a menu
// that does not start.
let recordings = null;
try {
  recordings = installRecordingOpener({
    mod: () => { try { return screen.mod.active; } catch { return 'bf1942'; } },
  });
} catch (error) {
  console.warn('front-end: Open recording left out', error);
}

// REPLAY: the rounds players have shared, newest or most watched first, their
// comments, and sharing one (features/replay-feed). Built lazily.
const replay = createReplayScreen({
  canvas: canvasRp,
  root: '../',
  tabs: TABS,
  onTab: id => show(id),
  onStatus: text => { status.textContent = text; },
  onWatchFile: recordings ? () => recordings.pick() : null,
  playerName: () => playerName,
});

let tab = 'singleplay';

const CANVASES = {
  singleplay: canvas,
  multiplay: canvasMp,
  customgame: canvasCg,
  options: canvasOpt,
  replay: canvasRp,
};

// Each tab but SINGLEPLAY's, loaded once: its layout, faces and plates. The
// extractor that writes a tab's pack is named if it cannot load. MULTIPLAY's
// load starts its server and room polls; they stop again unless it is the tab
// up by the time it finishes (loaded ahead, or left before it was ready), and
// the rows they fetched are kept.
const LOADERS = {
  multiplay: { load: () => multiplay.load().then(() => { if (tab !== 'multiplay') multiplay.stop(); }),
               name: 'Multiplayer', fix: 'python3 extract_main_menu_layout.py' },
  customgame: { load: () => customGame.load(), name: 'Custom Game',
                fix: 'python3 extract_custom_game_layout.py' },
  replay: { load: () => replay.load(), name: 'Replay',
            fix: 'python3 extract_main_menu_layout.py' },
  options: { load: () => options.load(), name: 'Controls',
             fix: 'python3 extract_controls_menu_layout.py' },
};
const loading = {};

/** A tab's load, once. One that fails is forgotten, so the next ask (the
 *  click, after a background load) tries again rather than revealing a
 *  screen with nothing in it; it reports only for the tab that is up. */
function loadTab(id) {
  const loader = LOADERS[id];
  if (!loader) return Promise.resolve(true);
  loading[id] ??= loader.load().then(() => true, error => {
    loading[id] = null;
    if (tab === id) {
      status.textContent = `${loader.name} screen unavailable: ${error.message}. `
        + `From tools/bf1942-models run: ${loader.fix}`;
      console.error(error);
    } else {
      console.warn(`front-end: ${loader.name} not loaded ahead`, error);
    }
    return false;
  });
  return loading[id];
}

/** The tab in the address (`?tab=`, which the page opens on), so a reload
 *  comes back to it; REPLAY's with the recording whose page is up, or what
 *  the feed is narrowed to. */
function addressFor(id) {
  const url = new URL(location.href);
  if (id === 'singleplay') url.searchParams.delete('tab');
  else url.searchParams.set('tab', id);
  if (id !== 'replay') for (const key of ['rec', 'server', 'uploader']) url.searchParams.delete(key);
  if (url.href !== location.href) history.replaceState(history.state, '', url);
}

/** Switch tabs. The screen that is up stays up until the new one has loaded
 *  and painted, and the two canvases swap in one task, so a tab never shows
 *  as an empty black canvas while its plates arrive. They are normally
 *  there already: `prewarm` loads every tab behind the first one. */
function show(id) {
  // The tab up is a no-op; one picked but not up yet (still loading, or its
  // load failed) is asked for again.
  if (id === tab && !CANVASES[id].hidden) return;
  tab = id;
  // The replay feed is replay.bfstats.io's landing page; the rest is the game.
  document.title = id === 'replay' ? 'BattleView | bfstats.io' : 'BF1942.exe';
  screen.strip?.setActive(id);
  multiplay.strip?.setActive(id);
  customGame.strip?.setActive(id);
  options.strip?.setActive(id);
  replay.strip?.setActive(id);
  if (id !== 'options') options.stop();
  if (id !== 'replay') replay.hide();
  if (id !== 'multiplay') multiplay.stop();
  addressFor(id);
  status.textContent = '';
  loadTab(id).then(loaded => { if (loaded && tab === id) reveal(id); });
}

function reveal(id) {
  const next = CANVASES[id];
  next.hidden = false;
  if (id === 'singleplay') screen.paint();
  else if (id === 'multiplay') { multiplay.start(); multiplay.paint(); }
  else if (id === 'customgame') customGame.paint();
  else if (id === 'options') { options.paint(); options.start(); }
  else if (id === 'replay') replay.show();
  for (const [other, c] of Object.entries(CANVASES)) if (other !== id) c.hidden = true;
  next.focus();
}

/** Load every tab behind the one that is up, once the page is idle, so the
 *  first click on one is as quick as every click after it. CONTROLS last: its
 *  preview loads a soldier. */
function prewarm() {
  const idle = globalThis.requestIdleCallback ?? (fn => setTimeout(fn, 200));
  idle(async () => {
    for (const id of ['customgame', 'multiplay', 'replay', 'options']) await loadTab(id);
  }, { timeout: 2000 });
}

canvas.addEventListener('keydown', event => {
  if (screen.keydown(event)) event.preventDefault();
});
canvasMp.addEventListener('keydown', event => {
  if (multiplay.keydown(event)) event.preventDefault();
});
canvasCg.addEventListener('keydown', event => {
  if (customGame.keydown(event)) event.preventDefault();
});
canvasOpt.addEventListener('keydown', event => {
  if (options.keydown(event)) event.preventDefault();
});
canvasOpt.addEventListener('keyup', event => {
  if (options.keyup(event)) event.preventDefault();
});

if (params.get('tab') === 'multiplay') queueMicrotask(() => show('multiplay'));
if (params.get('tab') === 'customgame') queueMicrotask(() => show('customgame'));
if (params.get('tab') === 'options') queueMicrotask(() => show('options'));
// `?tab=replay&rec=<slug>` is a shared recording's page: where its links and
// the replay's own way back to the menu lead (map.html `MENU_URL`).
if (params.get('tab') === 'replay') queueMicrotask(() => show('replay'));

window.__menu = {
  get state() { return screen.state; },
  get levels() { return screen.levels; },
  select: screen.select,
  setTeam: screen.setTeam,
  start: screen.start,
  scrollBy: screen.scrollBy,
  launchUrl: screen.launchUrl,
  get mod() { return screen.mod; },
  get audio() { return screen.audio; },
  get movie() { return screen.movie; },
  get muted() { return screen.muted; },
  setMuted: screen.setMuted,
  unlockAudio: screen.unlockAudio,
  chooseMod: screen.chooseMod,
  paint: screen.paint,
  get tab() { return tab; },
  get customGame() { return customGame.mod; },
  chooseCustomGame: id => customGame.chooseMod(id),
  get options() { return options.state; },
  optionsScreen: options,
  replay,
  multiplay,
  show,
};

screen.load().catch(error => {
  status.textContent = `Instant Battle screen unavailable: ${error.message}. `
    + 'From tools/bf1942-models run: python3 extract_map.py Wake';
  console.error(error);
}).then(prewarm);
canvas.focus();
