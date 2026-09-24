// The front end `play/index.html` mounts: SINGLEPLAY (Instant Battle),
// MULTIPLAY (the room server's lobby), OPTIONS > CONTROLS (the key bindings)
// and CUSTOM GAME (the mod list), one canvas each, switched by the nav strip
// every screen draws. Moved out of the
// page's inline module script; `window.__menu` is the page's test hook.

import { createSkirmishScreen } from './skirmish.js';
import { createMultiplayScreen } from './multiplay.js';
import { createModPicker } from './mod-picker-screen.js';
import { createControlsScreen } from './controls-screen.js';
import { createControls } from '../controls.js';

const canvas = document.getElementById('screen');
const canvasMp = document.getElementById('screen-mp');
const canvasCg = document.getElementById('screen-cg');
const canvasOpt = document.getElementById('screen-opt');
const status = document.getElementById('status');

// SINGLEPLAY, MULTIPLAY, OPTIONS and CUSTOM GAME on the main nav, each in
// its own slot; INTRO and CREDITS, which this site does not answer for, are
// not drawn.
const TABS = [
  { page: 'mainNav',
    items: [{ key: 'MENU_SINGLEPLAY', id: 'singleplay' },
            { key: 'MENU_MULTIPLAY', id: 'multiplay' },
            { key: 'MENU_OPTIONS', id: 'options' },
            { key: 'MENU_CUSTOM_GAME', id: 'customgame' }] },
];
// OPTIONS' own row: CONTROLS is the one of its four this site has.
const OPTIONS_TABS = [
  ...TABS,
  { page: 'optionsNav', items: [{ key: 'MENU_CONTROLS', id: 'options' }] },
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
const options = createControlsScreen({
  canvas: canvasOpt,
  controls,
  root: '../',
  tabs: OPTIONS_TABS,
  onTab: id => show(id),
  onStatus: text => { status.textContent = text; },
  pollPad: true,
});

let tab = 'singleplay';
let multiplayLoaded = null;
let customGameLoaded = null;
let optionsLoaded = null;

function show(id) {
  if (id === tab) return;
  tab = id;
  canvas.hidden = id !== 'singleplay';
  canvasMp.hidden = id !== 'multiplay';
  canvasCg.hidden = id !== 'customgame';
  canvasOpt.hidden = id !== 'options';
  screen.strip?.setActive(id);
  multiplay.strip?.setActive(id);
  customGame.strip?.setActive(id);
  options.strip?.setActive(id);
  if (id !== 'options') options.stop();
  if (id === 'singleplay') {
    multiplay.stop();
    screen.paint();
    canvas.focus();
    return;
  }
  if (id === 'multiplay') {
    status.textContent = '';
    multiplayLoaded ??= multiplay.load().catch(error => {
      status.textContent = `Multiplayer screen unavailable: ${error.message}. `
        + 'From tools/bf1942-models run: python3 extract_main_menu_layout.py';
      console.error(error);
    });
    multiplayLoaded.then(() => { multiplay.start(); multiplay.paint(); });
    canvasMp.focus();
    return;
  }
  if (id === 'customgame') {
    status.textContent = '';
    customGameLoaded ??= customGame.load().catch(error => {
      status.textContent = `Custom Game screen unavailable: ${error.message}. `
        + 'From tools/bf1942-models run: python3 extract_custom_game_layout.py';
      console.error(error);
    });
    customGameLoaded.then(() => { customGame.paint(); });
    canvasCg.focus();
    return;
  }
  if (id === 'options') {
    status.textContent = '';
    optionsLoaded ??= options.load().catch(error => {
      status.textContent = `Controls screen unavailable: ${error.message}. `
        + 'From tools/bf1942-models run: python3 extract_controls_menu_layout.py';
      console.error(error);
    });
    optionsLoaded.then(() => { options.paint(); options.start(); });
    canvasOpt.focus();
  }
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
  show,
};

screen.load().catch(error => {
  status.textContent = `Instant Battle screen unavailable: ${error.message}. `
    + 'From tools/bf1942-models run: python3 extract_map.py Wake';
  console.error(error);
});
canvas.focus();
