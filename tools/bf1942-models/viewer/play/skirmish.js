// The Instant Battle screen, as a thing a page can mount.
//
// `play/index.html` is this screen as the way in to the site. `map.html`
// mounts the same controller on a canvas over the running level and calls it
// the Esc menu — the game's own way back: pick a level and it loads, or leave
// the game you are in. It is the same screen either way, because in the game
// it is the same screen: pressing Escape puts the front end back up over the
// battle, with `menu/ExitMenu`'s END CURRENT GAME button in the top right
// corner that the front end does not otherwise show.
//
// Everything the two mounts differ by is an option: where the viewer root is
// from the page, whether the menu loop plays, what START does, and whether
// there is a game to leave. Nothing here knows about either page.
//
// The painting, the hit-testing and the layout arithmetic are all
// `menu-screen.js` and `mod-picker.js`; this is the part that fetches the
// pack, holds the selection and turns a pointer into a choice.

import {
  AXIS, ALLIED, hitTest, inRect, listBox, paintMenu, scrollTo, stageScale,
  toVirtual, visibleRows,
} from './menu-screen.js';
import { loadMods, remember, servable, stored, VANILLA, withMod } from '../mods.js';
import { createLoadingAudioController } from '../audio.js';
import { loadHudPaths, hudPaths as plainHudPaths } from '../hud-pack.js';
import {
  hitTestPanel, paintPanel, panelBounds, placeInColumn,
  scrollBy as pickerScrollBy,
} from './mod-picker.js';

export { AXIS, ALLIED };

/** Where the menu's own speaker toggle is remembered. Scoped to the menu:
 *  the level's loading music and everything the game itself plays have
 *  their own switches, and this one does not reach them. */
const MUTE_KEY = 'bf42-mesh-menu-muted';

const menuMuted = () => {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (_) { return false; }
};

const rememberMute = muted => {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (_) { /* private mode */ }
};

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas  the screen
 * @param {string} [options.root]     the viewer root from the mounting page:
 *                                    `../` from `play/`, `./` from `map.html`
 * @param {URLSearchParams} [options.params]  the page's own query
 * @param {boolean} [options.music]   play the menu loop
 * @param {boolean} [options.inGame]  there is a level running behind this,
 *                                    so draw `menu/ExitMenu`'s button
 * @param {(url: string) => void} [options.onStart]  START
 * @param {() => void} [options.onDisconnect]        END CURRENT GAME
 * @param {(text: string) => void} [options.onStatus]
 * @param {'reload'|'inplace'} [options.modChoice]   what picking a mod does
 */
export function createSkirmishScreen({
  canvas,
  root = '../',
  params = new URLSearchParams(location.search),
  music = false,
  inGame = false,
  onStart = url => { location.href = url; },
  onDisconnect = null,
  onStatus = () => {},
  modChoice = 'reload',
} = {}) {
  const qs = params;
  const bust = () => (qs.has('nocache') ? `?t=${Date.now()}` : '');
  // Which game's Instant Battle screen this is is `activeMod`, resolved in
  // `load()` by `mods.js`'s own precedence (`?mod=`, then the remembered
  // one). A mod lists its own levels and draws whatever chrome it ships of
  // its own; everything it did not repaint still comes from the vanilla pack
  // (`../hud-pack.js`). The screen itself is vanilla's on every installed mod
  // -- only Secret Weapons ships a menu page at all, and not one of these
  // three -- so in practice what a mod changes here is the level list, its
  // thumbnails, the background plate and the nation flags on the preview.
  // Until `load()` knows the mod this resolves everything to vanilla's pack.
  let hudPaths = plainHudPaths('bf1942', null, { root });
  // `?pack=` still points a checkout at a scratch build of the menu pack
  // without moving anything; it wins over the resolver, whole. `?maps=` does
  // the same for the level tree.
  const SCRATCH_PACK = qs.get('pack');
  const packUrl = rel => (SCRATCH_PACK ? `${SCRATCH_PACK}/${rel}`
                                       : hudPaths.menuUrl(rel));
  const MAPS_OVERRIDE = qs.get('maps');

  const ctx = canvas.getContext('2d');

  const images = new Map();
  const fonts = new Map();
  const tints = new Map();

  // `disconnect` is the exit page's own switch (`menu-screen.js` `livePages`):
  // the button is drawn, and clickable, only over a running level.
  const state = {
    team: ALLIED, index: 0, scroll: 0, level: null,
    disconnect: Boolean(inGame && onDisconnect),
  };
  let layout = null;
  let levels = [];
  let hover = null;

  // The mod list: permanently drawn in the column `SHOW_BOT_SETTINGS = false`
  // leaves blank, not a modal - clicking a row applies it immediately (it
  // filters the level list below, it doesn't launch anything). `modLayout` is
  // `menu/CustomGameMenu` flattened by `extract_custom_game_layout.py` and
  // shifted into that column by `placeInColumn`; `activeMod` the record
  // `mods.js` resolved (its `?mod=`/localStorage precedence, unchanged - see
  // `mods.js`'s own header comment); `picker` the panel's own
  // selection/scroll/hover state.
  let modLayout = null;
  let activeMod = VANILLA;
  let picker = { mods: [VANILLA], activeId: VANILLA.id, scroll: 0, hover: null };
  // The active mod's own maps root - `<root>maps` for vanilla, `<root>maps/
  // mods/<id>` otherwise. Resolved in `load()`, before the level manifest
  // fetch.
  let MAPS = `${root}maps`;

  // The main menu's own loop - not the loading screen's `vehicle4.mp3`
  // (`progress.js`'s own controller, on `map.html`) and not the well-known
  // battle theme, but whatever a mod's `Game.setMenuMusicFilename` names
  // (`extract_menu_music.py`). Vanilla, RtR and SWoWWII all point at the same
  // file; EoD's is its own recording - `${MAPS}/_shared/music/menu.mp3`
  // already resolves to the right one because `MAPS` already does.
  //
  // The Esc menu plays none of it. The engine stops the front end's own Bink
  // movie the moment there is a game to go back to (`menu/Background`'s
  // `PlayBink` is cleared while `Join/Disconnect/ShowDisconnect` is set), and
  // a menu loop starting over a battle already in your ears would be the
  // same mistake in the other medium.
  const menuAudio = createLoadingAudioController();

  const json = url => fetch(url + bust()).then(r => {
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  });

  function image(url) {
    if (images.has(url)) return images.get(url);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => paintSoon();
    img.onerror = () => images.set(url, null);
    img.src = url + bust();
    images.set(url, img);
    return img;
  }

  const ready = img => (img && img.complete && img.naturalWidth ? img : null);

  /** Settles when an image's bytes are in, either way.
   *
   *  Not `decode()`, which is what this used to await: a background tab does
   *  not decode, so in one the promise never settles and the screen never
   *  finishes loading. `load` fires there as it does anywhere, the bytes are
   *  what the first paint is waiting on, and `drawImage` decodes on its own. */
  const loaded = img => (img.complete ? Promise.resolve() : new Promise(resolve => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  }));

  const env = {
    texture: name => {
      const entry = layout?.textures?.[name];
      return entry ? ready(image(packUrl(entry.file))) : null;
    },
    thumbnail: level => {
      // The game's own menu thumbnail when the pack has one (vanilla's, or a
      // mod's own through `hud-pack.js`); otherwise - a mod with no pack, see
      // `buildLevels` - the level's own loading-screen background, which every
      // `maps.json` entry carries.
      if (level?.thumbnail) return ready(image(packUrl(level.thumbnail)));
      if (level?.previewBg) return ready(image(`${MAPS}/${level.previewBg}`));
      return null;
    },
    icon: mod => (mod?.icon ? ready(image(`${root}${mod.icon}`)) : null),
    // The dialog's own `CustomGame/CustomGameUrl` / `...Info` var nodes: the
    // file's shipped value is a placeholder (see `mod-picker.js`'s header
    // comment), so the highlighted row's own facts stand in for it.
    text: name => {
      const mod = picker.mods.find(m => m.id === picker.activeId);
      if (name === 'CustomGame/CustomGameUrl') return mod?.url || '';
      if (name === 'CustomGame/CustomGameInfo') return mod?.info || 'No description available.';
      return '';
    },
    font: id => fonts.get(id) || null,
    tint: (font, rgb) => {
      const key = `${font.id}|${rgb.join(',')}`;
      let c = tints.get(key);
      if (c) return c;
      const img = ready(font.img);
      if (!img) return null;
      c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = `rgb(${rgb.map(v => Math.round(v * 255)).join(',')})`;
      g.fillRect(0, 0, c.width, c.height);
      tints.set(key, c);
      return c;
    },
    get levels() { return levels; },
    get hover() { return hover; },
  };

  // --- loading ---------------------------------------------------------------

  /** The level list: what the extractor read out of the game, narrowed to the
   *  levels this viewer actually has a scene for, in the order the game's own
   *  list is in - alphabetical by the title it shows.
   *
   *  The title is the level's own `lexiconAll.dat` record, which is what the
   *  game's list shows ("BATTLE OF MIDWAY", "OPERATION MARKET GARDEN"), not
   *  the loading screen's table in `maps.json` - the two differ on four
   *  levels and this is the game's screen.
   *
   *  Every extracted level is listed. The real game lists only the levels
   *  with bot support (`level.singlePlayer`); this site has no bots, and the
   *  levels without that layout launch Conquest instead, so hiding them would
   *  only lose them.
   *
   *  `menuLevels` is the active game's own list: vanilla's, or the one a
   *  mod's pack carries (`hud-pack.js`). A mod with no pack has none - what
   *  `packUrl` hands back then is vanilla's list, which never held its levels
   *  - so `joined` is false, the join is skipped and its `maps.json` is listed
   *  outright: no bot-support flag or nation flags to carry over, and no menu
   *  thumbnail (`env.thumbnail` falls back to the loading-screen background
   *  for those). Those records carry no `singlePlayer` either, which is what
   *  `launchUrl` keys on - see its comment. */
  function buildLevels(menuLevels, manifest, joined) {
    if (!joined) {
      return manifest
        .map(entry => ({
          map: entry.name,
          title: entry.loading?.title || entry.name,
          previewBg: entry.loading?.background || null,
        }))
        .sort((a, b) => a.title.localeCompare(b.title));
    }
    const have = new Map();
    for (const entry of manifest) {
      // `maps.json` names a level the way its directory does; the extractor
      // keys on the same lowercased name.
      have.set(entry.name.toLowerCase(), entry);
    }
    const out = [];
    for (const level of menuLevels.levels) {
      const entry = have.get(level.dir) || have.get(level.level.toLowerCase());
      if (!entry) continue;
      out.push({
        ...level,
        map: entry.name,
        title: level.title || entry.loading?.title || entry.name,
      });
    }
    out.sort((a, b) => a.title.localeCompare(b.title));
    return out;
  }

  async function load(wantedMod = null) {
    const available = servable(await loadMods(), 'maps');
    const wanted = (wantedMod || qs.get('mod') || stored() || VANILLA.id).toLowerCase();
    activeMod = available.find(mod => mod.id === wanted) || available[0];
    // A `?mod=` this tab cannot serve (no maps uploaded yet) must not stick.
    if (activeMod.id === wanted) remember(activeMod.id);
    picker = { mods: available, activeId: activeMod.id, scroll: 0, hover: null };
    MAPS = MAPS_OVERRIDE || `${root}${activeMod.paths.maps}`;
    // One `pack.json` fetch; a mod without a pack resolves to vanilla's.
    hudPaths = await loadHudPaths(activeMod.id, { bust, root });
    if (music) {
      // The speaker in the corner, not the loading screen's "click to
      // enable" badge: this screen stays up, so the player needs the other
      // direction too. Off is remembered — a mod switch reloads the page
      // and the loop would otherwise start again over a player who turned
      // it off ten seconds ago.
      menuAudio.setMuted(menuMuted());
      menuAudio.attachMuteToggle(document.body, { onChange: rememberMute });
      menuAudio.start(`${MAPS}/_shared/music/menu.mp3`,
                      `${root}maps/_shared/music/menu.mp3`);
    }

    const [skirmishLayout, rawModLayout] = await Promise.all([
      json(packUrl('menu-layout.json')),
      // Absent on a checkout that hasn't run extract_custom_game_layout.py -
      // the panel just doesn't draw, same fallback shape as a mod with no
      // maps.json.
      json(packUrl('custom-game-layout.json')).catch(() => null),
    ]);
    layout = skirmishLayout;
    // Into the column `SHOW_BOT_SETTINGS = false` leaves blank - the file
    // places this dialog centered for a modal it is not being used as here.
    modLayout = rawModLayout && placeInColumn(rawModLayout, 14, 100);
    if (modLayout) {
      layout.textures = { ...layout.textures, ...modLayout.textures };
      layout.fontFiles = { ...layout.fontFiles, ...modLayout.fontFiles };
    }
    // The game's own list for this mod: vanilla's always, and a mod's when its
    // pack carries one (`extract_hud_mods.py` writes it beside the thumbnails).
    // A mod with no pack of its own lists its `maps.json` outright instead.
    const hasMenuLevels = activeMod.id === VANILLA.id
      || Boolean(SCRATCH_PACK) || hudPaths.owns('menu/menu-levels.json');
    const [menuLevels, manifest] = await Promise.all([
      json(packUrl('menu-levels.json')),
      json(`${MAPS}/maps.json`).catch(() => []),
    ]);
    levels = buildLevels(menuLevels, manifest, hasMenuLevels);
    await Promise.all(Object.entries(layout.fontFiles || {}).map(async ([id, entry]) => {
      const meta = await json(packUrl(entry.glyphs));
      const img = image(packUrl(entry.file));
      await loaded(img);
      fonts.set(id, { id, meta, img });
    }));
    // Every plate up front: the screen is a couple dozen small textures and
    // paints once.
    for (const entry of Object.values(layout.textures || {})) image(packUrl(entry.file));
    for (const mod of available) if (mod.icon) image(`${root}${mod.icon}`);
    state.scroll = 0;
    select(0);
    onStatus(levels.length ? ''
      : 'No levels. From tools/bf1942-models run: python3 extract_map.py Wake');
    paint();
  }

  // --- selection -------------------------------------------------------------

  function select(index) {
    if (!levels.length) return;
    state.index = Math.min(levels.length - 1, Math.max(0, index));
    state.level = levels[state.index];
    const box = listBox(layout);
    if (box) state.scroll = scrollTo(layout, box, state.scroll, state.index, levels.length);
    for (const level of [state.level]) {
      if (level?.thumbnail) image(packUrl(level.thumbnail));
    }
    paintSoon();
  }

  /** Select a level by the name `?map=` spells, if the list has it. The Esc
   *  menu opens on the level you are in, the way the game's own list is
   *  already sitting on the one it last started. */
  function selectMap(name) {
    if (!name) return false;
    const wanted = String(name).toLowerCase();
    const index = levels.findIndex(level => level.map?.toLowerCase() === wanted
                                         || level.dir?.toLowerCase() === wanted);
    if (index < 0) return false;
    select(index);
    return true;
  }

  function setTeam(team) {
    state.team = team === AXIS ? AXIS : ALLIED;
    paintSoon();
  }

  /** START. The map page is the mesh site's own file; only the launch
   *  parameters are ours. */
  function start() {
    if (!state.level) return;
    onStart(launchUrl());
  }

  /** Where START goes. Two things travel with the level and the team.
   *
   *  The mod: without it an Anzio launched from Road to Rome's screen would be
   *  looked for in vanilla's level tree whenever the remembered mod and the
   *  link's disagree.
   *
   *  The game mode. Instant Battle is a singleplayer screen, and in the game it
   *  runs the level's **CoOp** game type — `GameTypes/CoOp.con`, which is the
   *  script `bf1942_lnxded`'s `Setup::setNextLevel` names for GamePlayMode 4.
   *  That is a game type, not a directory: on every vanilla level it loads the
   *  `SinglePlayer/` layout, and on Road to Rome and Secret Weapons it loads
   *  SinglePlayer's spawns under Conquest's flags, which is no directory's
   *  layout at all. So the game type is what travels, and `map.html` resolves
   *  it — asking for `SinglePlayer` by name is right on most of those levels
   *  only because the two directories happen to agree, and wrong on Cassino and
   *  Gothic Line, both published. Across all 18 installed mods 35 game-type
   *  scripts straddle two directories and 7 of them resolve to a different
   *  layout that way; asking for the game type is right on all 35 by
   *  construction.
   *
   *  `menu-levels.json` records which levels have that layout as `singlePlayer`
   *  (19 of vanilla's 23; the four that do not are Aberdeen, Coral Sea,
   *  Invasion of the Philippines and Liberation of Caen, and they get Conquest,
   *  which is what the game falls back to for them as well). A mod with no menu
   *  pack has no such list and its records carry no flag at all — `undefined`,
   *  not `false` — so nothing is asked for and `map.html` plays the level's own
   *  default layer, exactly as it did before `?mode=` existed. Naming Conquest
   *  there would be a guess, and a wrong one on the 27 FHSW levels that ship no
   *  Conquest layer. See `features/bf1942-3d-models/game-modes.md`. */
  function launchUrl() {
    if (!state.level) return null;
    const url = new URL(`${root}map.html`, location.href);
    url.searchParams.set('map', state.level.map);
    url.searchParams.set('team', String(state.team));
    if (state.level.singlePlayer !== undefined) {
      url.searchParams.set('mode', state.level.singlePlayer ? 'CoOp' : 'Conquest');
    }
    if (activeMod.id !== VANILLA.id) url.searchParams.set('mod', activeMod.id);
    return url.toString();
  }

  // --- mod list --------------------------------------------------------------

  /** Clicking a row. On the way in, this carries the choice the way the
   *  shell-mods `<select>` on every other viewer page does - `remember()`
   *  then a reload, because every page here resolves its mod once at module
   *  scope with top-level await (`mods.js`'s own header comment).
   *
   *  Over a running level there is nothing to reload: the level behind the
   *  screen is the one you are playing, and switching mods must not throw it
   *  away. The pack and the level list are re-fetched in place instead, and
   *  the mod travels on the next START like any other. */
  function chooseMod(id) {
    if (id === activeMod.id) return;
    remember(id);
    if (modChoice === 'inplace') {
      load(id).catch(error => {
        onStatus(`Instant Battle screen unavailable: ${error.message}`);
        console.error(error);
      });
      return;
    }
    location.href = withMod(location.href, id);
  }

  function handlePanelHit(hit) {
    if (!hit) return;
    if (hit.kind === 'row') { chooseMod(picker.mods[hit.index].id); return; }
    if (hit.kind === 'arrow') {
      picker.scroll = pickerScrollBy(modLayout, picker, hit.by);
      paintSoon();
      return;
    }
    if (hit.kind === 'button' && hit.action === 'website') {
      const url = picker.mods.find(m => m.id === picker.activeId)?.url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  // --- painting --------------------------------------------------------------

  let pending = false;
  function paintSoon() {
    if (pending || !layout) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; paint(); });
  }

  function paint() {
    if (!layout) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // A hidden canvas has no box: `stageScale` would divide by it. The Esc
    // menu spends most of a session down, and paints on the way up.
    if (!w || !h) return;
    const cw = Math.round(w * dpr);
    const chh = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== chh) {
      canvas.width = cw;
      canvas.height = chh;
    }
    const s = stageScale(w, h, layout.virtual);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, chh);
    ctx.setTransform(s.sx * dpr, 0, 0, s.sy * dpr, s.ox * dpr, s.oy * dpr);
    paintMenu(ctx, layout, state, env);
    if (modLayout) paintPanel(ctx, modLayout, picker, env);
  }

  const observer = new ResizeObserver(() => paint());
  observer.observe(canvas);

  // --- input -----------------------------------------------------------------

  function at(event) {
    const r = canvas.getBoundingClientRect();
    const s = stageScale(r.width, r.height, layout.virtual);
    return toVirtual(s, event.clientX - r.left, event.clientY - r.top);
  }

  /** The mod panel and the Skirmish screen are both live on the same canvas
   *  at once - there is no modal to gate input on, just whether the pointer
   *  is inside the panel's own bounds. */
  const overPanel = (x, y) => !!(modLayout && inRect(panelBounds(modLayout), x, y));

  canvas.addEventListener('pointermove', event => {
    if (!layout) return;
    const [x, y] = at(event);
    if (overPanel(x, y)) {
      if (hover) { hover = null; paintSoon(); }
      const next = hitTestPanel(modLayout, picker, x, y);
      const changed = JSON.stringify(next) !== JSON.stringify(picker.hover);
      picker.hover = next;
      canvas.style.cursor = next ? 'pointer' : 'default';
      if (changed) paintSoon();
      return;
    }
    if (picker.hover) { picker.hover = null; paintSoon(); }
    const next = hitTest(layout, state, x, y, levels.length);
    const changed = JSON.stringify(next) !== JSON.stringify(hover);
    hover = next;
    canvas.style.cursor = next ? 'pointer' : 'default';
    if (changed) paintSoon();
  });

  canvas.addEventListener('pointerleave', () => {
    hover = null;
    picker.hover = null;
    paintSoon();
  });

  canvas.addEventListener('click', event => {
    if (!layout) return;
    const [x, y] = at(event);
    canvas.focus();
    if (overPanel(x, y)) { handlePanelHit(hitTestPanel(modLayout, picker, x, y)); return; }
    const hit = hitTest(layout, state, x, y, levels.length);
    if (!hit) return;
    if (hit.kind === 'row') select(hit.index);
    else if (hit.kind === 'team') setTeam(hit.team);
    else if (hit.action === 'scroll') scrollBy(hit.by);
    else if (hit.action === 'start') start();
    else if (hit.action === 'disconnect') onDisconnect?.();
  });

  canvas.addEventListener('dblclick', event => {
    if (!layout) return;
    const [x, y] = at(event);
    if (overPanel(x, y)) return;
    // The list box's "Select action" is `Skirmish/StartSkirmish`: committing
    // a row starts the level.
    if (hitTest(layout, state, x, y, levels.length)?.kind === 'row') start();
  });

  function scrollBy(by) {
    const box = listBox(layout);
    if (!box) return;
    const max = Math.max(0, levels.length - visibleRows(layout, box));
    state.scroll = Math.min(max, Math.max(0, state.scroll + by));
    paintSoon();
  }

  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    if (!layout) return;
    const [x, y] = at(event);
    if (overPanel(x, y)) {
      picker.scroll = pickerScrollBy(modLayout, picker, Math.sign(event.deltaY));
      paintSoon();
      return;
    }
    scrollBy(Math.sign(event.deltaY));
  }, { passive: false });

  /** The keyboard, for whoever owns it. `play/index.html` hands over what the
   *  canvas gets; `map.html` hands over what the page gets while the Esc menu
   *  is up, because there the keyboard is the game's the rest of the time.
   *  Returns whether the key was the screen's. */
  function keydown(event) {
    if (!layout) return false;
    const box = listBox(layout);
    switch (event.key) {
      case 'ArrowDown': select(state.index + 1); break;
      case 'ArrowUp': select(state.index - 1); break;
      case 'PageDown': select(state.index + (box ? visibleRows(layout, box) : 5)); break;
      case 'PageUp': select(state.index - (box ? visibleRows(layout, box) : 5)); break;
      case 'Home': select(0); break;
      case 'End': select(levels.length - 1); break;
      case 'Enter': start(); break;
      default: return false;
    }
    return true;
  }

  return {
    load,
    paint,
    paintSoon,
    select,
    selectMap,
    setTeam,
    start,
    scrollBy,
    keydown,
    chooseMod,
    launchUrl,
    get state() { return { ...state, levels: levels.length }; },
    get levels() { return levels.map(l => l.title); },
    get mod() {
      return { active: activeMod.id, available: picker.mods.map(m => m.id) };
    },
    get audio() { return menuAudio.state; },
    get muted() { return menuAudio.muted; },
    setMuted: on => { menuAudio.setMuted(on); rememberMute(menuAudio.muted); },
    unlockAudio: () => menuAudio.unlock(),
  };
}
