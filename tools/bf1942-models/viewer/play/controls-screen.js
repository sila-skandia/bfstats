// OPTIONS > CONTROLS: the retail key-binding screen, painted from the game's
// own pages and filled from the player's profile.
//
// Everything drawn is `controls-layout.json` (`extract_controls_menu_layout.py`):
// the four tabbed plates, the tab heads, the row pages with their label, primary
// box and alternate box per row, the "COMMON 1/3" footer and its arrows, DEFAULT
// and SAVE, and the profile plate. What the engine fills in at runtime — the
// binding text in each box, the sensitivity sliders, the profile name — comes
// from `controls.js`, which holds the shipped maps or an imported profile.
//
// Two departures, both because a browser is not the game:
//
//   - The profile plate imports. In the game it opens the profile picker over
//     the profiles on disk; here there is no disk, so it asks for the profile
//     folder (`Settings/Profiles/<name>`) and reads its Controls/*.con.
//     DEFAULT goes back to the shipped maps. SAVE has nothing left to do — an
//     import is stored the moment it lands — and is drawn without an action.
//   - Pressing a bound key, mouse button or joystick input lights the box of
//     the binding in use (in the game's DEFINE KEY colours), turns the row page
//     to it, and drives the preview under the right-hand panel: the soldier on
//     COMMON and INFANTRY, a Spitfire on AIR, a Sherman on LAND & SEA.

import { createNavStrip } from './nav-strip.js';
import { createMenuPack } from './menu-pack.js';
import { elementVisible, inRect, measureText, paintElement, stageScale } from './menu-screen.js';
import { beginStage, pointerToVirtual } from './stage.js';
import { loadHudPaths, hudPaths as plainHudPaths } from '../hud-pack.js';
import { CONTROL_ROWS, TAB_CONTEXT, TAB_OPTIONS } from '../controls-rows.js';
import { createControlsPreview } from '../controls-preview.js';

const TABS = ['common', 'infantry', 'air', 'landSea'];

/** `menu/ControlsMenu`'s tab heads, left to right — the order the hit
 *  regions come out of the file in. */
const TAB_ORDER = ['common', 'infantry', 'air', 'landSea'];

/** The DEFINE KEY prompt's plate colour (`menu/ControlsMenu`), used for a
 *  box whose binding is held: the game's own "this key" colour. */
const ACTIVE_FILL = [0.5078, 0.5234, 0.4297, 1];
const ACTIVE_TEXT = [0, 0, 0, 1];

/** Where to load a profile from, in the empty foot of the right-hand panel
 *  (below every tab's own rows, which end by y=233). Clicking it opens the
 *  folder picker, the same as the profile plate. */
export const HELP_RECT = [460, 252, 306, 76];
const HELP_TEXT = [0.6289, 0.6172, 0.5664, 1];   // the panel's own "saved" message colour
const PROFILE_PATH = 'Battlefield 1942/Mods/bf1942/Settings/Profiles/<name>';

/** A browser `event.button` as DirectInput numbers it (`IDButton_*`): the
 *  browser has the right button at 2 and the middle at 1, DirectInput the
 *  other way round. */
const DI_BUTTON = { 0: 0, 1: 2, 2: 1 };

/** The frame the preview sits in: under the right-hand panel, level with
 *  the bottom of the tabbed plate, drawn in the boxes' own grey frame. */
export const PREVIEW_RECT = [450, 347, 328, 150];

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {object} options.controls   a `createControls` instance
 * @param {string} [options.root]
 * @param {URLSearchParams} [options.params]
 * @param {Array} [options.tabs]      the nav strip's rows (see nav-strip.js)
 * @param {(id: string) => void} [options.onTab]
 * @param {(text: string) => void} [options.onStatus]
 * @param {boolean} [options.pollPad] poll the gamepad itself: true where no
 *                                    frame loop is doing it (the front end)
 * @param {() => void} [options.onBindingsChanged] an import or a reset
 */
export function createControlsScreen({
  canvas,
  controls,
  root = '../',
  params = new URLSearchParams(location.search),
  tabs = null,
  onTab = () => {},
  onStatus = () => {},
  pollPad = false,
  onBindingsChanged = () => {},
} = {}) {
  const qs = params;
  const bust = () => (qs.has('nocache') ? `?t=${Date.now()}` : '');
  let hudPaths = plainHudPaths('bf1942', null, { root });
  const SCRATCH_PACK = qs.get('pack');
  const packUrl = rel => (SCRATCH_PACK ? `${SCRATCH_PACK}/${rel}` : hudPaths.menuUrl(rel));
  const ctx = canvas.getContext('2d');

  let layout = null;
  let strip = null;
  let hover = null;
  const state = { tab: 'common', page: { common: 0, infantry: 0, air: 0, landSea: 0 } };
  const keys = new Set();
  const mouse = new Set();
  // A key tapped between two frames must still be seen: its release is
  // held back until the frame after the press has run.
  const releasing = new Set();
  let wheel = 0;
  let wheelUntil = 0;

  const pack = createMenuPack({
    url: packUrl,
    bust,
    onImage: () => paintSoon(),
    env: {
      text: name => (name === 'Profile/ProfileName'
        ? (controls.describe().profileName || 'DEFAULT') : ''),
      get hover() { return hover; },
    },
  });
  const { env, json } = pack;

  // --- preview ---------------------------------------------------------------

  const preview = createControlsPreview({ root });
  const previewCanvas = preview.canvas;
  previewCanvas.style.position = 'fixed';
  previewCanvas.style.pointerEvents = 'none';
  previewCanvas.hidden = true;
  canvas.after(previewCanvas);
  // Over the screen it sits in, wherever the host stacks that screen (the
  // in-game Escape menu is a layer over the battle).
  const stackPreview = () => {
    const z = getComputedStyle(canvas).zIndex;
    previewCanvas.style.zIndex = z === 'auto' ? '1' : String(Number(z) + 1);
  };

  function placePreview() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height || canvas.hidden) { previewCanvas.hidden = true; return; }
    const s = stageScale(r.width, r.height, layout?.virtual || [800, 600]);
    const [x, y, w, h] = PREVIEW_RECT;
    // Inside the frame's one-unit border.
    const left = r.left + s.ox + (x + 1) * s.sx;
    const top = r.top + s.oy + (y + 1) * s.sy;
    const width = (w - 2) * s.sx;
    const height = (h - 2) * s.sy;
    Object.assign(previewCanvas.style, {
      left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
    });
    previewCanvas.hidden = false;
    stackPreview();
    preview.resize(width, height);
  }

  // --- loading ---------------------------------------------------------------

  async function load(modId = 'bf1942') {
    hudPaths = await loadHudPaths(modId, { bust, root }).catch(() => hudPaths);
    layout = await json(packUrl('controls-layout.json'));
    pack.use(layout);
    if (tabs) {
      strip = createNavStrip({ layout, env, rows: tabs, active: 'options', onPick: onTab });
    }
    await pack.load(layout);
    onStatus('');
    preview.setMode(state.tab);
    paint();
  }

  // --- the rows --------------------------------------------------------------

  const tabPages = tab => layout?.tabs?.[tab]?.pages || [];
  const currentPage = () => tabPages(state.tab)[state.page[state.tab]] || null;
  const context = () => TAB_CONTEXT[state.tab];

  /** The rows of the page up, each with its bindings and whether each is
   *  held right now. */
  function rowStates(page = currentPage()) {
    if (!page) return [];
    const w = performance.now() < wheelUntil ? wheel : 0;
    return page.rows.map(row => {
      const spec = CONTROL_ROWS[row.key];
      const entries = spec ? controls.rowEntries(spec, context()) : [];
      return {
        row,
        entries: entries.slice(0, 2).map(e => ({ label: e.label, on: e.active(keys, mouse, w) })),
      };
    });
  }

  const pageLit = page => rowStates(page).some(r => r.entries.some(e => e.on));

  /** Turn to the page carrying a row the player just pressed, when the page
   *  up has none — the way to find where a key lives is to press it. */
  function followPress() {
    if (pageLit(currentPage())) return;
    const index = tabPages(state.tab).findIndex(pageLit);
    if (index >= 0) state.page[state.tab] = index;
  }

  /** What is held, over every page of the tab: the signature a repaint and a
   *  page turn key off. */
  const litSignature = () => JSON.stringify(tabPages(state.tab)
    .map(page => rowStates(page).map(r => r.entries.map(e => e.on))));

  // --- painting --------------------------------------------------------------

  let pending = false;
  function paintSoon() {
    if (pending || !layout) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; paint(); });
  }

  function vars() {
    const out = { ...(layout.variables || {}), 'Options/Controls/Tab': layout.tabs[state.tab].id };
    const profile = controls.describe().vars;
    for (const opts of Object.values(TAB_OPTIONS)) {
      if (opts.invert) out[opts.invert[1]] = profile[opts.invert[0]] === 1;
    }
    return out;
  }

  const paintPage = (name, table) => {
    for (const el of layout.pages[name]?.elements || []) {
      if (!elementVisible(el, table)) continue;
      // The value slots the engine fills with a binding; this paints its own.
      if (el.kind === 'text' && el.text === 'None' && !el.key) continue;
      paintElement(ctx, el, layout, null, env);
    }
  };

  function paintBox(rect, label, on) {
    const [x, y, w, h] = rect;
    if (on) {
      paintElement(ctx, { kind: 'fill', rect: [x + 1, y + 1, w - 2, h - 2], color: ACTIVE_FILL },
                   layout, null, env);
    }
    if (!label) return;
    const font = env.font('standard6');
    if (!font) return;
    const text = { kind: 'text', rect: [x, y + 4, w, 20], font: 'standard6', align: 'center',
                   text: label, color: on ? ACTIVE_TEXT : [1, 1, 1, 1] };
    // A long binding ("JOYSTICK AXIS 4+") is narrowed into the box, the way
    // the game clips it to the frame rather than spilling past it.
    const width = measureText(font, label);
    if (width <= w - 4) { paintElement(ctx, text, layout, null, env); return; }
    const k = (w - 4) / width;
    ctx.save();
    ctx.translate(x + 2, 0);
    ctx.scale(k, 1);
    paintElement(ctx, { ...text, rect: [0, y + 4, width, 20], align: 'left' }, layout, null, env);
    ctx.restore();
  }

  /** The right-hand panel's sliders: the profile's value as the knob's
   *  place along the track (the files store the slider's own 0..1). */
  function paintSliders() {
    const opts = TAB_OPTIONS[state.tab];
    const profile = controls.describe().vars;
    const tracks = (layout.pages[`plate.${state.tab}`]?.elements || [])
      .filter(el => el.kind === 'fill' && el.rect[2] === 74 && el.rect[3] === 9);
    const values = [profile[opts.mouse], profile[opts.keyboard]];
    tracks.forEach((track, i) => {
      const v = values[i];
      if (v == null) return;
      const [x, y, w, h] = track.rect;
      const knob = 7;
      const at = x + Math.max(0, Math.min(1, v)) * (w - knob);
      paintElement(ctx, { kind: 'fill', rect: [at, y + 1, knob, h - 2], color: [1, 1, 1, 1] },
                   layout, null, env);
    });
  }

  /** How to load a profile, until one is loaded; then which one is. */
  function paintHelp() {
    const name = controls.describe().profileName;
    const lines = [
      [name ? `${name.toUpperCase()} IS LOADED. TO CHANGE IT, CLICK` : 'TO USE YOUR OWN CONTROLS, CLICK', HELP_TEXT],
      ['THE PROFILE BUTTON AND CHOOSE YOUR FOLDER', HELP_TEXT],
      ['BATTLEFIELD 1942/MODS/BF1942/', [1, 1, 1, 1]],
      ['SETTINGS/PROFILES/<YOUR NAME>', [1, 1, 1, 1]],
    ];
    const [x, y] = HELP_RECT;
    lines.forEach(([text, color], i) => {
      paintElement(ctx, { kind: 'text', rect: [x + 5, y + 8 + i * 15, 296, 20], font: 'standard6',
                          align: 'left', text, color }, layout, null, env);
    });
  }

  function paint() {
    if (!layout) return;
    if (!beginStage(canvas, ctx, layout.virtual)) return;
    const table = vars();
    paintPage('background', table);
    paintPage(`plate.${state.tab}`, table);
    paintSliders();
    paintHelp();
    paintPage('tabs', table);
    const page = currentPage();
    if (page) {
      paintPage(page.page, table);
      for (const { row, entries } of rowStates(page)) {
        paintBox(row.primary, entries[0]?.label, entries[0]?.on);
        paintBox(row.alternate, entries[1]?.label, entries[1]?.on);
      }
    }
    // The preview's frame, in the boxes' grey.
    const [x, y, w, h] = PREVIEW_RECT;
    paintElement(ctx, { kind: 'fill', rect: [x, y, w, h], color: [0.5468, 0.5468, 0.5468, 1] },
                 layout, null, env);
    paintElement(ctx, { kind: 'fill', rect: [x + 1, y + 1, w - 2, h - 2], color: [0, 0, 0, 1] },
                 layout, null, env);
    paintPage('controlsNav', table);
    paintPage('profile', table);
    strip?.paint(ctx);
    ctx.globalAlpha = 1;
  }

  // --- the live loop: rows lit and the preview driven while the screen is up

  let running = false;
  let lastLit = '';
  function frame(now) {
    if (!running) return;
    if (pollPad) controls.pollGamepad();
    const lit = litSignature();
    if (lit !== lastLit) {
      if (lit.includes('true')) followPress();
      lastLit = lit;
      paint();
    }
    preview.frame(controls.probe(context(), keys, mouse), now);
    for (const code of releasing) keys.delete(code);
    releasing.clear();
    requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    placePreview();
    requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    keys.clear();
    mouse.clear();
    previewCanvas.hidden = true;
  }

  const observer = new ResizeObserver(() => { paint(); if (running) placePreview(); });
  observer.observe(canvas);

  // --- input -----------------------------------------------------------------

  const at = event => pointerToVirtual(canvas, event, layout.virtual);

  /** What the pointer is over: a nav button, a tab head, a page arrow,
   *  DEFAULT, or the profile plate. */
  function hitTest(x, y) {
    const nav = strip?.hover(x, y);
    if (nav) return nav;
    const heads = (layout.pages.tabs?.elements || []).filter(el => el.kind === 'hit');
    const head = heads.findIndex(el => inRect(el.rect, x, y));
    if (head >= 0) return { kind: 'tab', tab: TAB_ORDER[head] };
    const pager = currentPage()?.pager || {};
    for (const dir of ['prev', 'next']) {
      if (pager[dir] && inRect(pager[dir], x, y)) {
        const plate = (layout.pages[currentPage().page]?.elements || [])
          .find(el => el.kind === 'button' && el.rect[1] === pager[dir][1]
                && el.rect[0] === pager[dir][0]);
        return { kind: 'button', action: dir, rect: plate?.rect };
      }
    }
    for (const el of layout.pages.controlsNav?.elements || []) {
      if (el.kind !== 'button' || !inRect(el.rect, x, y)) continue;
      const isDefault = el.sets?.some(s => s.var === 'Options/Controls/ShowControlsConfirmation');
      const isSave = el.calls?.includes('Options/Controls/SaveAllControls');
      if (isDefault) return { kind: 'button', action: 'default', rect: el.rect };
      if (isSave) return { kind: 'button', action: 'save', rect: el.rect };
    }
    const plate = (layout.pages.profile?.elements || []).find(el => el.kind === 'button');
    if (plate && inRect(plate.rect, x, y)) return { kind: 'button', action: 'profile', rect: plate.rect };
    if (inRect(HELP_RECT, x, y)) return { kind: 'help', action: 'profile' };
    if (inRect(PREVIEW_RECT, x, y)) return { kind: 'preview' };
    return null;
  }

  canvas.addEventListener('pointermove', event => {
    if (!layout) return;
    const [x, y] = at(event);
    const next = hitTest(x, y);
    const changed = JSON.stringify(next) !== JSON.stringify(hover);
    hover = next?.kind === 'preview' ? null : next;
    canvas.style.cursor = next && next.kind !== 'preview' && next.action !== 'save'
      ? 'pointer' : 'default';
    canvas.title = next?.action === 'profile' ? `Choose your profile folder: ${PROFILE_PATH}` : '';
    if (changed) paintSoon();
  });

  canvas.addEventListener('pointerleave', () => { hover = null; mouse.clear(); paintSoon(); });

  // A mouse binding is tried in the preview's frame; everywhere else a click
  // is the menu's.
  canvas.addEventListener('pointerdown', event => {
    if (!layout) return;
    const [x, y] = at(event);
    if (hitTest(x, y)?.kind === 'preview') {
      mouse.add(DI_BUTTON[event.button] ?? event.button);
      event.preventDefault();
    }
  });
  addEventListener('pointerup', event => { mouse.delete(DI_BUTTON[event.button] ?? event.button); });
  canvas.addEventListener('contextmenu', event => {
    if (!layout) return;
    if (hitTest(...at(event))?.kind === 'preview') event.preventDefault();
  });

  canvas.addEventListener('click', event => {
    if (!layout) return;
    const [x, y] = at(event);
    canvas.focus();
    if (strip?.click(x, y)) return;
    const hit = hitTest(x, y);
    if (!hit) return;
    if (hit.kind === 'tab') setTab(hit.tab);
    else if (hit.action === 'prev' || hit.action === 'next') turnPage(hit.action === 'next' ? 1 : -1);
    else if (hit.action === 'default') resetDefaults();
    else if (hit.action === 'profile') pickProfile();
  });

  canvas.addEventListener('wheel', event => {
    if (!layout) return;
    event.preventDefault();
    wheel = event.deltaY < 0 ? 1 : -1;
    wheelUntil = performance.now() + 250;
  }, { passive: false });

  // Drop a profile folder (or its .con files) anywhere on the screen.
  canvas.addEventListener('dragover', event => { event.preventDefault(); });
  canvas.addEventListener('drop', event => {
    event.preventDefault();
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) importFiles(files);
  });

  function setTab(tab) {
    if (!TABS.includes(tab) || tab === state.tab) return;
    for (const code of releasing) keys.delete(code);
    releasing.clear();
    state.tab = tab;
    preview.setMode(tab);
    lastLit = '';
    paint();
  }

  function turnPage(by) {
    const count = tabPages(state.tab).length;
    state.page[state.tab] = Math.max(0, Math.min(count - 1, state.page[state.tab] + by));
    lastLit = '';
    paint();
  }

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.multiple = true;
  picker.webkitdirectory = true;
  picker.hidden = true;
  canvas.after(picker);
  picker.addEventListener('change', () => {
    if (picker.files?.length) importFiles([...picker.files]);
    picker.value = '';
  });

  function pickProfile() { picker.click(); }

  async function importFiles(files) {
    const { applied } = await controls.importFiles(files);
    onStatus(applied.length ? '' : 'That folder holds no Controls/*.con files.');
    onBindingsChanged();
    lastLit = '';
    paint();
  }

  function resetDefaults() {
    controls.resetDefaults();
    onBindingsChanged();
    lastLit = '';
    paint();
  }

  /** A key down. Every key reaches the rows; a key the page would lose
   *  (Tab moves focus, Alt raises Firefox's menu bar, the F-keys are the
   *  browser's) is kept. Escape is the host's. */
  function keydown(event) {
    if (!layout || event.code === 'Escape') return false;
    keys.add(event.code);
    releasing.delete(event.code);
    return true;
  }

  function keyup(event) {
    if (running) releasing.add(event.code);
    else keys.delete(event.code);
    return Boolean(layout) && event.code !== 'Escape';
  }

  canvas.addEventListener('blur', () => keys.clear());

  return {
    load,
    paint,
    paintSoon,
    start,
    stop,
    keydown,
    keyup,
    setTab,
    turnPage,
    importFiles,
    resetDefaults,
    preview,
    get strip() { return strip; },
    get state() {
      return {
        tab: state.tab,
        page: state.page[state.tab],
        pages: tabPages(state.tab).length,
        rows: rowStates().map(r => ({ text: r.row.text, labels: r.entries.map(e => e.label),
                                      on: r.entries.map(e => e.on) })),
        preview: preview.state,
      };
    },
    setActive(id) { strip?.setActive(id); },
  };
}
