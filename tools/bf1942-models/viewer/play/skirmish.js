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
// The left column is the bot settings, on both mounts. The mod list used to
// share it — pick a game here, and the level list below follows — and now
// has the front end's own CUSTOM GAME tab (`mod-picker-screen.js`) to itself,
// which hands its pick back through `chooseMod`. This screen still holds
// which mod is active, because the level list and every pack URL are the
// mod's; it just does not draw the list any more.
//
// The painting, the hit-testing and the layout arithmetic are all
// `menu-screen.js`; this is the part that fetches the pack, holds the
// selection and turns a pointer into a choice.

import {
  AXIS, ALLIED, hitTest, listBox, paintMenu, scrollTo, visibleRows,
} from './menu-screen.js';
import { beginStage, pointerToVirtual } from './stage.js';
import { createNavStrip } from './nav-strip.js';
import { createMenuPack } from './menu-pack.js';
import { loadMods, remember, servable, stored, VANILLA, withMod } from '../mods.js';
import { createLoadingAudioController } from '../audio.js';
import { loadHudPaths, hudPaths as plainHudPaths } from '../hud-pack.js';

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
 * @param {Array} [options.tabs]  the front end's navigation rows
 *                                (`nav-strip.js`), drawn over this screen
 *                                the way the game draws them over its own.
 *                                Null on the Esc menu: there is no front end
 *                                behind a running level to navigate.
 * @param {(id: string) => void} [options.onTab]
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
  tabs = null,
  onTab = () => {},
} = {}) {
  const qs = params;
  const bust = () => (qs.has('nocache') ? `?t=${Date.now()}` : '');
  let hudPaths = plainHudPaths('bf1942', null, { root });
  const SCRATCH_PACK = qs.get('pack');
  const packUrl = rel => (SCRATCH_PACK ? `${SCRATCH_PACK}/${rel}`
                                       : hudPaths.menuUrl(rel));
  const MAPS_OVERRIDE = qs.get('maps');

  const ctx = canvas.getContext('2d');

  // `disconnect` is the exit page's own switch (`menu-screen.js` `livePages`):
  // the button is drawn, and clickable, only over a running level.
  const state = {
    team: ALLIED, index: 0, scroll: 0, level: null,
    disconnect: Boolean(inGame && onDisconnect),
    // Bot settings: always on. The retail AI SKILL slider is proven inert
    // (§5.3 of the AI research doc); wiring it is a deliberate departure.
    botSkill: 0.75,   // 0.25 EASY, 0.5 NORMAL, 0.75 HARD, 1.0 IMPOSSIBLE
    botCount: 4,      // number of bots to spawn (default on)
  };
  let layout = null;
  let levels = [];
  let hover = null;

  // Which game this is a battle in. Not drawn here — the CUSTOM GAME tab is
  // the list — but every pack URL, the level list and the menu loop are the
  // active mod's, so the screen holds it.
  let strip = null;
  let activeMod = VANILLA;
  let mods = [VANILLA];
  let MAPS = `${root}maps`;

  const menuAudio = createLoadingAudioController();
  /** The track the loop is already on. `load` runs again on every mod
   *  change, and `menuAudio.start` always starts from the top — so the
   *  loop is only (re)started when the mod actually brings its own. */
  let menuTrack = null;

  // The image, font and tint caches (`menu-pack.js`), with this screen's own
  // lookups laid over the pack's: the level thumbnail, the mod icon, and the
  // live level list and hover.
  const pack = createMenuPack({
    url: packUrl,
    bust,
    onImage: () => paintSoon(),
    env: {
      thumbnail: level => {
        if (level?.thumbnail) return ready(image(packUrl(level.thumbnail)));
        if (level?.previewBg) return ready(image(`${MAPS}/${level.previewBg}`));
        return null;
      },
      icon: mod => (mod?.icon ? ready(image(`${root}${mod.icon}`)) : null),
      text: () => '',
      get levels() { return levels; },
      get hover() { return hover; },
    },
  });
  const { env, json, image, ready } = pack;

  // --- loading ---------------------------------------------------------------

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
    if (activeMod.id === wanted) remember(activeMod.id);
    mods = available;
    MAPS = MAPS_OVERRIDE || `${root}${activeMod.paths.maps}`;
    hudPaths = await loadHudPaths(activeMod.id, { bust, root });
    if (music) {
      menuAudio.setMuted(menuMuted());
      menuAudio.attachMuteToggle(document.body, { onChange: rememberMute });
      const track = `${MAPS}/_shared/music/menu.mp3`;
      if (track !== menuTrack) {
        menuTrack = track;
        menuAudio.start(track, `${root}maps/_shared/music/menu.mp3`);
      }
    }

    const [skirmishLayout, navLayout] = await Promise.all([
      json(packUrl('menu-layout.json')),
      tabs ? json(packUrl('main-menu-layout.json')).catch(() => null) : null,
    ]);
    layout = skirmishLayout;
    pack.use(layout);
    if (navLayout) {
      layout.textures = { ...layout.textures, ...navLayout.textures };
      layout.fontFiles = { ...layout.fontFiles, ...navLayout.fontFiles };
      strip = createNavStrip({ layout: navLayout, env, rows: tabs,
                               active: 'singleplay', onPick: onTab });
    }
    const hasMenuLevels = activeMod.id === VANILLA.id
      || Boolean(SCRATCH_PACK) || hudPaths.owns('menu/menu-levels.json');
    const [menuLevels, manifest] = await Promise.all([
      json(packUrl('menu-levels.json')),
      json(`${MAPS}/maps.json`).catch(() => []),
    ]);
    levels = buildLevels(menuLevels, manifest, hasMenuLevels);
    await pack.load(layout);
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

  /** Apply a bot slider click. The layout's `sets` array carries the variable
   *  name and the value to set. For the four-step sliders (AiSkill, BotRatio,
   *  NrOfLives) the value is 1-4; for the percentage sliders it's the authored
   *  value. We map the 1-4 values to actual botSkill/botCount state.
   *
   *  The retail AI SKILL slider is proven inert (§5.3); wiring it is a
   *  deliberate departure from the game. */
  function applyBotSlider(sets) {
    for (const s of sets) {
      if (s.var === 'Skirmish/SkirmishAiSkill') {
        // 1→0.25, 2→0.5, 3→0.75, 4→1.0 (§5.2 table)
        state.botSkill = [0.25, 0.5, 0.75, 1.0][s.value - 1] ?? 0.75;
      } else if (s.var === 'Options/General/SkirmishPercentageOfBots') {
        // 50-400% scale on max bot count. Map to botCount: 50%→2, 100%→4,
        // 200%→8, 400%→16. Linear interpolation.
        state.botCount = Math.max(1, Math.round((s.value / 100) * 4));
      }
    }
    paintSoon();
  }

  function start() {
    if (!state.level) return;
    onStart(launchUrl());
  }

  function launchUrl() {
    if (!state.level) return null;
    const url = new URL(`${root}map.html`, location.href);
    url.searchParams.set('map', state.level.map);
    url.searchParams.set('team', String(state.team));
    if (state.level.singlePlayer !== undefined) {
      url.searchParams.set('mode', state.level.singlePlayer ? 'CoOp' : 'Conquest');
    }
    if (activeMod.id !== VANILLA.id) url.searchParams.set('mod', activeMod.id);
    // Bot parameters: always passed when bots are enabled.
    url.searchParams.set('botCount', String(state.botCount));
    url.searchParams.set('botSkill', String(state.botSkill));
    return url.toString();
  }

  // --- the active mod --------------------------------------------------------

  /** Called by the CUSTOM GAME tab when a game is picked, and by nothing on
   *  this screen: there is no list here to pick from. */
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

  // --- painting --------------------------------------------------------------

  let pending = false;
  function paintSoon() {
    if (pending || !layout) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; paint(); });
  }

  function paint() {
    if (!layout) return;
    if (!beginStage(canvas, ctx, layout.virtual)) return;
    // The left column is the bot settings, which `SHOW_BOT_SETTINGS` has off
    // by default because the retail screen leaves it blank.
    paintMenu(ctx, layout, state, env, true);
    strip?.paint(ctx);
  }

  const observer = new ResizeObserver(() => paint());
  observer.observe(canvas);

  // --- input -----------------------------------------------------------------

  function at(event) {
    return pointerToVirtual(canvas, event, layout.virtual);
  }

  canvas.addEventListener('pointermove', event => {
    if (!layout) return;
    const [x, y] = at(event);
    const next = strip?.hover(x, y)
      || hitTest(layout, state, x, y, levels.length, true);
    const changed = JSON.stringify(next) !== JSON.stringify(hover);
    hover = next;
    canvas.style.cursor = next ? 'pointer' : 'default';
    if (changed) paintSoon();
  });

  canvas.addEventListener('pointerleave', () => {
    hover = null;
    paintSoon();
  });

  canvas.addEventListener('click', event => {
    if (!layout) return;
    const [x, y] = at(event);
    canvas.focus();
    if (strip?.click(x, y)) return;
    const hit = hitTest(layout, state, x, y, levels.length, true);
    if (!hit) return;
    if (hit.kind === 'row') select(hit.index);
    else if (hit.kind === 'team') setTeam(hit.team);
    else if (hit.kind === 'botSlider') applyBotSlider(hit.sets);
    else if (hit.action === 'scroll') scrollBy(hit.by);
    else if (hit.action === 'start') start();
    else if (hit.action === 'disconnect') onDisconnect?.();
  });

  canvas.addEventListener('dblclick', event => {
    if (!layout) return;
    const [x, y] = at(event);
    if (hitTest(layout, state, x, y, levels.length, true)?.kind === 'row') start();
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
    scrollBy(Math.sign(event.deltaY));
  }, { passive: false });

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
      return { active: activeMod.id, available: mods.map(m => m.id) };
    },
    get strip() { return strip; },
    get audio() { return menuAudio.state; },
    get muted() { return menuAudio.muted; },
    setMuted: on => { menuAudio.setMuted(on); rememberMute(menuAudio.muted); },
    unlockAudio: () => menuAudio.unlock(),
  };
}
