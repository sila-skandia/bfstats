// The CUSTOM GAME tab: the game list, on its own screen.
//
// This used to be a column of the Instant Battle screen — the mod picker sat
// in the space `menu-screen.js`'s `SHOW_BOT_SETTINGS = false` left blank,
// next to the level list. The bot settings want that column, so the picker
// moved out to where the game puts it: its own tab on `menu/MainMenuNavigation`,
// one along from MULTIPLAY.
//
// What it draws is what the front end draws behind every tab — `menu/Background`
// out of `main-menu-layout.json`, the navigation strip over it — with
// `menu/CustomGameMenu` (`custom-game-layout.json`, via `mod-picker.js`) in the
// middle, at the place the file itself puts it. Picking a row is still the whole
// interaction: it switches the mod, and `onMod` hands that to the Instant Battle
// screen so its level list follows. There is no confirm step, because a mod here
// is which game you are playing, not a thing to launch.

import { createNavStrip } from './nav-strip.js';
import { elementVisible, paintElement } from './menu-screen.js';
import { beginStage, pointerToVirtual } from './stage.js';
import { loadMods, remember, servable, stored, VANILLA } from '../mods.js';
import { loadHudPaths, hudPaths as plainHudPaths } from '../hud-pack.js';
import {
  hitTestPanel, paintPanel, scrollBy as pickerScrollBy,
} from './mod-picker.js';

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {string} [options.root]
 * @param {URLSearchParams} [options.params]
 * @param {(text: string) => void} [options.onStatus]
 * @param {Array} [options.tabs]  the front end's navigation rows (`nav-strip.js`)
 * @param {(id: string) => void} [options.onTab]
 * @param {(id: string) => void} [options.onMod]  a mod was picked; the rest of
 *                                the front end follows it
 */
export function createModPicker({
  canvas,
  root = '../',
  params = new URLSearchParams(location.search),
  onStatus = () => {},
  tabs = null,
  onTab = () => {},
  onMod = () => {},
} = {}) {
  const qs = params;
  const bust = () => (qs.has('nocache') ? `?t=${Date.now()}` : '');
  let hudPaths = plainHudPaths('bf1942', null, { root });
  const SCRATCH_PACK = qs.get('pack');
  const packUrl = rel => (SCRATCH_PACK ? `${SCRATCH_PACK}/${rel}` : hudPaths.menuUrl(rel));

  const ctx = canvas.getContext('2d');
  const images = new Map();
  const fonts = new Map();
  const tints = new Map();

  let layout = null;
  let navLayout = null;
  let modLayout = null;
  let hover = null;
  let activeMod = VANILLA;
  let picker = { mods: [VANILLA], activeId: VANILLA.id, scroll: 0, hover: null };
  let strip = null;

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
  const loaded = img => (img.complete ? Promise.resolve() : new Promise(resolve => {
    img.addEventListener('load', resolve, { once: true });
    img.addEventListener('error', resolve, { once: true });
  }));

  const env = {
    texture: name => {
      const entry = layout?.textures?.[name];
      return entry ? ready(image(packUrl(entry.file))) : null;
    },
    // The dialog has no VariablePictureNode of its own; `paintElement` only
    // reaches for a thumbnail on the Instant Battle screen's preview slot.
    thumbnail: () => null,
    icon: mod => (mod?.icon ? ready(image(`${root}${mod.icon}`)) : null),
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
    get hover() { return hover; },
  };

  /** The mod list, and the pack the screen paints out of.
   *
   *  The pack follows the active mod the way every other screen's does: a mod
   *  that ships its own menu art gets its own plates and faces. That is why a
   *  pick re-runs this rather than only re-sorting the rows. */
  async function load(wantedMod = null) {
    const available = servable(await loadMods(), 'maps');
    const wanted = (wantedMod || qs.get('mod') || stored() || VANILLA.id).toLowerCase();
    activeMod = available.find(mod => mod.id === wanted) || available[0];
    if (activeMod.id === wanted) remember(activeMod.id);
    picker = { mods: available, activeId: activeMod.id, scroll: 0, hover: null };
    hudPaths = await loadHudPaths(activeMod.id, { bust, root });

    const [rawModLayout, rawNavLayout] = await Promise.all([
      json(packUrl('custom-game-layout.json')),
      json(packUrl('main-menu-layout.json')),
    ]);
    // No `placeInColumn` here: on its own screen the dialog sits where
    // `menu/CustomGameMenu` puts it.
    modLayout = rawModLayout;
    navLayout = rawNavLayout;
    layout = {
      virtual: modLayout.virtual || [800, 600],
      textures: { ...navLayout.textures, ...modLayout.textures },
      fontFiles: { ...navLayout.fontFiles, ...modLayout.fontFiles },
    };
    if (tabs) {
      strip = createNavStrip({ layout: navLayout, env, rows: tabs,
                               active: 'customgame', onPick: onTab });
    }
    await Promise.all(Object.entries(layout.fontFiles).map(async ([id, entry]) => {
      const meta = await json(packUrl(entry.glyphs));
      const img = image(packUrl(entry.file));
      await loaded(img);
      fonts.set(id, { id, meta, img });
    }));
    for (const entry of Object.values(layout.textures)) image(packUrl(entry.file));
    for (const mod of available) if (mod.icon) image(`${root}${mod.icon}`);
    onStatus('');
    paint();
  }

  function chooseMod(id) {
    if (id === activeMod.id) return;
    remember(id);
    load(id)
      .then(() => onMod(id))
      .catch(error => {
        onStatus(`Custom Game unavailable: ${error.message}`);
        console.error(error);
      });
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

  let pending = false;
  function paintSoon() {
    if (pending || !layout) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; paint(); });
  }

  function paint() {
    if (!layout) return;
    if (!beginStage(canvas, ctx, layout.virtual)) return;
    // `menu/Background` — the black field and the camouflaged plate every tab
    // of the front end is drawn on.
    const table = navLayout?.variables || {};
    for (const el of navLayout?.pages?.background?.elements || []) {
      if (!elementVisible(el, table)) continue;
      paintElement(ctx, el, navLayout, null, env);
    }
    paintPanel(ctx, modLayout, picker, env);
    strip?.paint(ctx);
    ctx.globalAlpha = 1;
  }

  const observer = new ResizeObserver(() => paint());
  observer.observe(canvas);

  function at(event) {
    return pointerToVirtual(canvas, event, layout.virtual);
  }

  canvas.addEventListener('pointermove', event => {
    if (!layout) return;
    const [x, y] = at(event);
    const nav = strip?.hover(x, y) || null;
    const next = nav ? null : hitTestPanel(modLayout, picker, x, y);
    const changed = JSON.stringify(next) !== JSON.stringify(picker.hover)
      || JSON.stringify(nav) !== JSON.stringify(hover);
    picker.hover = next;
    hover = nav;
    canvas.style.cursor = nav || next ? 'pointer' : 'default';
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
    if (strip?.click(x, y)) return;
    handlePanelHit(hitTestPanel(modLayout, picker, x, y));
  });

  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    if (!layout) return;
    picker.scroll = pickerScrollBy(modLayout, picker, Math.sign(event.deltaY));
    paintSoon();
  }, { passive: false });

  function keydown(event) {
    if (!layout) return false;
    switch (event.key) {
      case 'ArrowDown': picker.scroll = pickerScrollBy(modLayout, picker, 1); paintSoon(); break;
      case 'ArrowUp': picker.scroll = pickerScrollBy(modLayout, picker, -1); paintSoon(); break;
      default: return false;
    }
    return true;
  }

  return {
    load,
    paint,
    paintSoon,
    chooseMod,
    keydown,
    get mod() {
      return { active: activeMod.id, available: picker.mods.map(m => m.id) };
    },
    get strip() { return strip; },
    setActive(id) { strip?.setActive(id); },
  };
}
