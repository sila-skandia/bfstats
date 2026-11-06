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
//     folder (`Settings/Profiles/<name>`) and reads its Controls/*.con. An
//     import is stored the moment it lands.
//     Signed in to bfstats.io, the same foot of the panel is the account's
//     profile picker (`../profile-sync.js`, features/game-profiles): the
//     active profile's name between two arrows that switch it, and an
//     import or a SAVE is saved back to the account.
//   - Pressing a bound key, mouse button or joystick input lights the box of
//     the binding in use (in the game's DEFINE KEY colours), turns the row page
//     to it, and drives the preview under the right-hand panel: the soldier on
//     COMMON and INFANTRY, a Spitfire on AIR, a Sherman on LAND & SEA.
//
// Rebinding is retail's (features/viewer-profile-controls, "DEFINE KEY"):
// clicking a box puts up the DEFINE KEY plate at the pointer and the next
// key, mouse button, wheel step, joystick button or (on a movement row) axis
// fills it; Escape unbinds it, Grave is refused as not mappable. Boxes that
// share an input inside one control map are marked and say so in red under
// the pointer; SAVE refuses while any is, and otherwise writes the four
// files (`../controls-edit.js`) and the account copy. Edits wait for SAVE,
// as in the game: leaving the screen drops them. DEFAULT asks first, then
// refills every box from the shipped maps, also for SAVE to write.
//
// OPTIONS > VIDEO is the row's other button and this screen's other section:
// the game's VIDEO PERFORMANCE and VIDEO OPTIONS plates with the rows the
// viewer has something behind (`../video-options.js`, `../video-settings.js`,
// features/video-options). A change is kept the moment it is made; the level
// page behind the Escape menu applies it live, except anti-aliasing and
// lightmaps, which a level takes when it is built.
//
// OPTIONS > SOUND is the third: the game's SOUND OPTIONS plate with its
// HARDWARE ACCELERATION row, the path a Creative card took, emulated with an
// HRTF head (`../sound-options.js`, `../ds3d-pan.js`,
// features/sound-hardware-path). It takes effect at once, on the voices
// already playing too.

import { createNavStrip } from './nav-strip.js';
import { createMenuPack } from './menu-pack.js';
import { elementVisible, inRect, measureText, paintElement, stageScale } from './menu-screen.js';
import { beginStage, pointerToVirtual } from './stage.js';
import { loadHudPaths, hudPaths as plainHudPaths } from '../hud-pack.js';
import { stored, VANILLA } from '../mods.js';
import { CONTROL_ROWS, TAB_CONTEXT, TAB_OPTIONS } from '../controls-rows.js';
import { CAPTURE_CODES, LAYOUT_CODES } from '../controls.js';
import { conflictText, inputLabel, rowContext, rowId } from '../controls-edit.js';
import { createControlsPreview } from '../controls-preview.js';
import {
  hasVideoPage, performancePanel, placeVideoRows, sliderKnob, sliderPick, VIDEO_ROWS, videoNavButtons, videoPanel,
} from '../video-options.js';
import { chooseAntialias, storeAntialias, storedAntialias } from '../render-antialias.js';
import {
  SOUND_NAV_DX, chooseHardware3d, hardwareRow, hasSoundPage, soundNavButtons, soundPanel,
  storeHardware3d, storedHardware3d,
} from '../sound-options.js';
import { ds3dHardware, setDs3dHardware } from '../ds3d-pan.js';
import { applyPreset, changeVideo, performanceOf, storedVideo } from '../video-settings.js';

const TABS = ['common', 'infantry', 'air', 'landSea'];

/** The screen's sections, by the id of the `menu/OptionsNavigation` button
 *  that picks each. */
const SECTIONS = ['controls', 'video', 'sound'];

/** `menu/ControlsMenu`'s tab heads, left to right — the order the hit
 *  regions come out of the file in. */
const TAB_ORDER = ['common', 'infantry', 'air', 'landSea'];

/** The DEFINE KEY prompt's plate colour (`menu/ControlsMenu`), used for a
 *  box whose binding is held: the game's own "this key" colour. */
const ACTIVE_FILL = [0.5078, 0.5234, 0.4297, 1];
const ACTIVE_TEXT = [0, 0, 0, 1];

/** The conflict bar's red (`menu/ControlsMenu`, on
 *  `Options/Controls/Conflict/MouseOver*`): the bar under the pointer, and
 *  the fill of a box that shares its input. */
const CONFLICT_FILL = [0.6953, 0.2852, 0.2852, 1];

/** `menu/ControlsMenu`'s two pointer plates, for a pack extracted before the
 *  extractor kept them (`layout.popups`): the 120x15 DEFINE KEY plate and the
 *  300x15 conflict bar, each with its text three units down. */
const PLATES = {
  defineKey: [
    { kind: 'fill', rect: [0, 0, 120, 15], color: ACTIVE_FILL, slot: 0 },
    { kind: 'text', rect: [0, 3, 120, 20], color: ACTIVE_TEXT, font: 'standard6', align: 'center',
      text: 'DEFINE KEY', slot: 0 },
    { kind: 'fill', rect: [0, 0, 120, 15], color: ACTIVE_FILL, slot: 1 },
    { kind: 'text', rect: [0, 3, 120, 20], color: ACTIVE_TEXT, font: 'standard6', align: 'center',
      text: 'DEFINE ALTERNATE KEY', slot: 1 },
  ],
  conflict: [
    { kind: 'fill', rect: [0, 0, 300, 15], color: CONFLICT_FILL },
    { kind: 'text', rect: [0, 3, 300, 20], color: ACTIVE_TEXT, font: 'standard6', align: 'center', text: '' },
  ],
};

/** `menu/ConfirmationMenu`'s message line (`Options/ShowConfirmText`): SAVE's
 *  answer, and the refusal of an unmappable key. */
export const MESSAGE_RECT = [45, 113, 500, 20];
const MESSAGES = {
  saved: ['KEY ASSIGNMENT HAS BEEN SAVED', [0.6289, 0.6172, 0.5664, 1]],
  conflict: ['FAILED TO SAVE CONTROLS! THERE IS A CONFLICT!', [0.6289, 0, 0, 1]],
  unmappable: ['THIS KEY IS NOT MAPPABLE!', [0.6289, 0, 0, 1]],
};
const MESSAGE_MS = 4000;

/** DEFAULT's question (`CONFIRMATION_DEFAULT`), on a plate of the boxes'
 *  frame with OK and CANCEL on DEFAULT's own button art. */
export const CONFIRM_RECT = [250, 245, 300, 80];
export const CONFIRM_OK_RECT = [270, 285, 109, 25];
export const CONFIRM_CANCEL_RECT = [421, 285, 109, 25];

/** How far the mouse must travel while a movement row waits for it to be
 *  taken as that axis (retail: past 0.2 of its range in one read). */
const MOUSE_AXIS_PX = 40;
/** A joystick axis taken past this from where it rested when the box was
 *  clicked (retail's 0.2). */
const PAD_AXIS_DELTA = 0.2;

/** Where to load a profile from, in the empty foot of the right-hand panel
 *  (below every tab's own rows, which end by y=233). Clicking it opens the
 *  folder picker, the same as the profile plate. */
export const HELP_RECT = [460, 252, 306, 76];
const HELP_TEXT = [0.6289, 0.6172, 0.5664, 1];   // the panel's own "saved" message colour
const PROFILE_PATH = 'Battlefield 1942/Mods/bf1942/Settings/Profiles/<name>';
/** The account picker's arrows, on the help text's second line. */
export const PROFILE_PREV_RECT = [HELP_RECT[0] + 3, HELP_RECT[1] + 21, 24, 17];
export const PROFILE_NEXT_RECT = [HELP_RECT[0] + HELP_RECT[2] - 27, HELP_RECT[1] + 21, 24, 17];

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
 * @param {object} [options.profileSync] a `createProfileSync` instance: the
 *                                    account's profiles, for the picker
 * @param {() => (boolean|null)} [options.antialiasInEffect] whether the
 *                                    renderer behind the screen was built
 *                                    with anti-aliasing: a level's has, the
 *                                    front end has none yet (null)
 * @param {() => (boolean|null)} [options.lightmapsInEffect] whether the
 *                                    level behind the screen was built with
 *                                    its lightmaps (null: no level)
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
  antialiasInEffect = () => null,
  lightmapsInEffect = () => null,
  profileSync = null,
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
  const state = {
    section: 'controls',
    tab: 'common',
    page: { common: 0, infantry: 0, air: 0, landSea: 0 },
  };
  let video = null;
  let sound = null;
  const keys = new Set();
  const mouse = new Set();
  // A key tapped between two frames must still be seen: its release is
  // held back until the frame after the press has run.
  const releasing = new Set();
  let wheel = 0;
  let wheelUntil = 0;

  // --- rebinding state ---------------------------------------------------
  // The boxes being edited (`controls.editor()`), made on first need and
  // dropped when the screen is left or the maps change under it.
  let draft = null;
  const edits = () => (draft ??= controls.editor());
  // The box waiting for an input: `{ context, id, key, spec, slot, started,
  // rest, moved }`, or null.
  let capture = null;
  // The pointer, in the screen's 800x600: where the plates are drawn.
  let pointer = [0, 0];
  // SAVE's answer or a refusal, on the message line until `until`.
  let message = null;
  // DEFAULT's question is up.
  let confirming = false;
  // The click that follows a mouse button taken by DEFINE KEY is not a click.
  let swallowClick = false;
  // Windows' AltGr arrives as ControlLeft then AltRight: a ControlLeft is
  // held back a moment so the AltRight can replace it.
  let ctrlTimer = null;
  // The keyboard layout's legends, by `event.code`.
  const keyNames = new Map();
  try {
    navigator.keyboard?.getLayoutMap?.().then(map => {
      for (const code of LAYOUT_CODES) {
        const key = map.get(code);
        if (key && !keyNames.has(code)) keyNames.set(code, key);
      }
      controls.setKeyNames?.(keyNames);
      paintSoon();
    }).catch(() => {});
  } catch { /* no Keyboard API: the keys seen pressed, else the US legends */ }

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
    if (!r.width || !r.height || canvas.hidden || state.section !== 'controls') {
      previewCanvas.hidden = true;
      return;
    }
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

  /** `modId` defaults to the active mod the other tabs follow (`?mod=`, else
   *  the one CUSTOM GAME last picked): its pack carries its own background
   *  plate, so Desert Combat's OPTIONS is Desert Combat's. The profile folder
   *  the help text names stays `Mods/BF1942/Settings/Profiles` under every
   *  mod: `settingsPath` starts as `mods/BF1942/` (BF1942.exe 0x00456f63) and
   *  switching mods moves only the mod path (0x004560d6), so a mod reads the
   *  same profiles vanilla does. */
  async function load(modId = (qs.get('mod') || stored() || VANILLA.id).toLowerCase()) {
    hudPaths = await loadHudPaths(modId, { bust, root }).catch(() => hudPaths);
    layout = await json(packUrl('controls-layout.json'));
    pack.use(layout);
    // The pieces of the VIDEO section, or none where the pack predates it:
    // the row's VIDEO button is then not drawn either.
    const rows = hasVideoPage(layout) ? placeVideoRows(layout, VIDEO_ROWS) : [];
    video = rows.length ? {
      panel: videoPanel(layout),
      rows: rows.map(r => ({ ...r, spec: VIDEO_ROWS.find(s => s.id === r.id) })),
      perf: performancePanel(layout),
      nav: videoNavButtons(layout),
    } : null;
    // SOUND borrows VIDEO's plate and tick box, so it needs the same page.
    sound = video && hasSoundPage(layout)
      ? { panel: soundPanel(layout), row: hardwareRow(layout), nav: soundNavButtons(layout) }
      : null;
    if ((state.section === 'video' && !video) || (state.section === 'sound' && !sound)) {
      state.section = 'controls';
    }
    if (tabs) {
      const rows = tabs.map(r => ({
        ...r,
        items: r.items.filter(item => (video || item.id !== 'video') && (sound || item.id !== 'sound')),
      }));
      strip = createNavStrip({
        layout, env, rows, active: 'options',
        onPick: id => (SECTIONS.includes(id) ? setSection(id) : onTab(id)),
      });
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

  /** The rows of the page up, each with its two boxes as the edits stand:
   *  the text, whether its input is held right now, whether it shares its
   *  input with another box of its map, and whether it waits for one. */
  function rowStates(page = currentPage()) {
    if (!page) return [];
    const w = performance.now() < wheelUntil ? wheel : 0;
    const d = edits();
    const marks = d.conflicts();
    return page.rows.map(row => {
      const spec = CONTROL_ROWS[row.key];
      if (!spec) return { row, entries: [] };
      const ctx = rowContext(row.key) ?? TAB_CONTEXT[state.tab] ?? 'common';
      const id = rowId(spec);
      const cells = controls.rowCells(spec, ctx, d.boxes);
      return {
        row, spec, context: ctx, id,
        entries: cells.map((cell, slot) => ({
          label: cell ? inputLabel(cell, keyNames) : '',
          plain: cell ? inputLabel(cell, null) : '',
          on: Boolean(cell) && !capture && controls.cellActive(cell)(keys, mouse, w),
          conflict: cell ? marks.get(`${ctx}|${id}|${slot}`) ?? null : null,
          defining: capture?.context === ctx && capture.id === id && capture.slot === slot,
        })),
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

  const paintPage = (name, table, dx = 0) => {
    for (const el of layout.pages[name]?.elements || []) {
      if (!elementVisible(el, table)) continue;
      // The value slots the engine fills with a binding; this paints its own.
      if (el.kind === 'text' && el.text === 'None' && !el.key) continue;
      const placed = dx ? { ...el, rect: [el.rect[0] + dx, ...el.rect.slice(1)] } : el;
      paintElement(ctx, placed, layout, null, env);
    }
  };

  /** One box: its text, lit in the DEFINE KEY colour while its input is
   *  held or while it waits for one, red while it conflicts. */
  function paintBox(rect, entry = {}) {
    const [x, y, w, h] = rect;
    const { on, conflict, defining } = entry;
    const fill = defining || on ? ACTIVE_FILL : conflict ? CONFLICT_FILL : null;
    if (fill) {
      paintElement(ctx, { kind: 'fill', rect: [x + 1, y + 1, w - 2, h - 2], color: fill },
                   layout, null, env);
    }
    const font = env.font('standard6');
    if (!entry.label || !font) return;
    // A layout legend the font has no glyph for reads as the US one.
    const drawable = [...entry.label].every(ch => font.meta.glyphs[ch.charCodeAt(0)]);
    const label = drawable ? entry.label : entry.plain;
    const text = { kind: 'text', rect: [x, y + 4, w, 20], font: 'standard6', align: 'center',
                   text: label, color: fill ? ACTIVE_TEXT : [1, 1, 1, 1] };
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

  /** The account's profiles, when the picker has any to show: `{ list,
   *  index }` with `index` the active one's, or null. */
  function accountPicker() {
    const v = profileSync?.view?.();
    if (!v || !['synced', 'saving'].includes(v.state)) return null;
    const list = v.profiles;
    return { list, index: list.findIndex(p => p.isActive), saving: v.state === 'saving' };
  }

  /** Switch the account's active profile by `step` along its list. */
  async function stepProfile(step) {
    const picker = accountPicker();
    if (!picker || picker.list.length < 2) return;
    const at = picker.index < 0 ? 0 : (picker.index + step + picker.list.length) % picker.list.length;
    await selectProfile(picker.list[at].name);
  }

  async function selectProfile(name) {
    const ok = await profileSync?.activate(name);
    draft = null;
    cancelCapture(false);
    onStatus(ok ? '' : 'Could not switch the profile.');
    onBindingsChanged();
    lastLit = '';
    paint();
    return !!ok;
  }

  /** How to load a profile, until one is loaded; then which one is. Signed
   *  in, the account's picker. */
  function paintHelp() {
    const picker = accountPicker();
    if (picker) { paintPicker(picker); return; }
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

  function paintPicker({ list, index, saving }) {
    const [x, y] = HELP_RECT;
    const text = (t, rect, color = HELP_TEXT, align = 'left') => paintElement(ctx,
      { kind: 'text', rect, font: 'standard6', align, text: t, color }, layout, null, env);
    text(saving ? 'YOUR BFSTATS.IO PROFILE (SAVING...)' : 'YOUR BFSTATS.IO PROFILE', [x + 5, y + 8, 296, 20]);
    const active = list[index];
    const label = active ? `${active.name.toUpperCase()}${list.length > 1 ? `  ${index + 1}/${list.length}` : ''}`
      : (list.length ? 'NONE ACTIVE' : 'NONE YET: CLICK THE PROFILE BUTTON');
    text(label, [x + 30, y + 23, 246, 20], [1, 1, 1, 1], 'center');
    if (list.length > 1) {
      const lit = rect => (hover?.rect === rect ? [1, 1, 1, 1] : HELP_TEXT);
      text('<', [PROFILE_PREV_RECT[0], PROFILE_PREV_RECT[1] + 2, PROFILE_PREV_RECT[2], 20], lit(PROFILE_PREV_RECT), 'center');
      text('>', [PROFILE_NEXT_RECT[0], PROFILE_NEXT_RECT[1] + 2, PROFILE_NEXT_RECT[2], 20], lit(PROFILE_NEXT_RECT), 'center');
    }
    text('THE PROFILE BUTTON IMPORTS A FOLDER FROM', [x + 5, y + 38, 296, 20]);
    text('BATTLEFIELD 1942/MODS/BF1942/SETTINGS/PROFILES', [x + 5, y + 53, 296, 20], [1, 1, 1, 1]);
  }

  // --- OPTIONS > VIDEO --------------------------------------------------------

  /** What this GPU gets when the player has chosen nothing. Asked once: on
   *  Linux it opens a throwaway context to read the GPU's name. */
  let gpuDefault = null;
  const antialiasDefault = () => (gpuDefault ??= chooseAntialias({ userAgent: navigator.userAgent }));

  /** Every row's value, which VIDEO PERFORMANCE line that mix is, and the
   *  rows a level takes only when it is built and was built the other way
   *  (`pendingRows`). Anti-aliasing keeps its own key and GPU default. */
  function videoState() {
    const stored = storedAntialias();
    const settings = storedVideo();
    const antialias = stored ?? antialiasDefault().antialias;
    const liveAa = antialiasInEffect();
    const liveLm = lightmapsInEffect();
    const pendingRows = [];
    if (typeof liveLm === 'boolean' && liveLm !== settings.lightmaps) pendingRows.push('lightmaps');
    if (typeof liveAa === 'boolean' && liveAa !== antialias) pendingRows.push('antialias');
    const { custom: _custom, ...values } = settings;
    return {
      ...values,
      antialias,
      chosen: stored !== null,
      performance: performanceOf(settings),
      pending: pendingRows.length > 0,
      pendingRows,
    };
  }

  function videoNotes(v = videoState()) {
    const notes = [];
    if (v.pending) notes.push('TAKES EFFECT ON THE NEXT LEVEL');
    return notes;
  }

  const text = (t, rect, color = [1, 1, 1, 1], align = 'left') => paintElement(ctx,
    { kind: 'text', rect, font: 'standard6', align, text: t, color }, layout, null, env);

  /** What a slider's value box reads: the file's own text for the value
   *  where it carries one, else the number. */
  function sliderText(row, value) {
    if (row.spec.fileText && row.values[String(value)]) return row.values[String(value)];
    const template = row.edit || Object.values(row.values)[0];
    if (!template) return null;
    return { kind: 'text', font: template.font || 'standard6', align: template.align || 'center',
             color: template.color || [1, 1, 1, 1], rect: template.rect, text: String(value) };
  }

  function paintVideoRow(row, v) {
    paintElement(ctx, row.label, layout, null, env);
    for (const el of row.frame) paintElement(ctx, el, layout, null, env);
    const value = v[row.id];
    if (row.kind === 'tick') {
      if (value) paintElement(ctx, row.mark, layout, null, env);
    } else {
      paintElement(ctx, { kind: 'fill', rect: sliderKnob(row.track, row.spec.steps, value),
                          color: [1, 1, 1, 1] }, layout, null, env);
      const label = sliderText(row, value);
      if (label) paintElement(ctx, label, layout, null, env);
      if (row.unit) paintElement(ctx, row.unit, layout, null, env);
    }
    if (v.pendingRows.includes(row.id)) {
      text('NEXT LEVEL', [row.hit[0] + row.hit[2] + 12, row.label.rect[1], 120, 20], HELP_TEXT);
    }
  }

  function paintVideo(table) {
    const v = videoState();
    if (video.perf) {
      for (const el of video.perf.elements) paintElement(ctx, el, layout, null, env);
      for (const line of video.perf.lines) {
        if (line.value === v.performance) paintElement(ctx, line.fill, layout, null, env);
        paintElement(ctx, line.text, layout, null, env);
      }
    }
    for (const el of video.panel) paintElement(ctx, el, layout, null, env);
    for (const row of video.rows) paintVideoRow(row, v);
    const last = video.rows[video.rows.length - 1];
    videoNotes(v).forEach((note, i) => {
      text(note, [last.label.rect[0], last.label.rect[1] + 30 + i * 15, 320, 20], HELP_TEXT);
    });
    paintPage('videoNav', table);
  }

  // --- OPTIONS > SOUND --------------------------------------------------------

  /** The HARDWARE ACCELERATION row: ticked or not, and whether that is the
   *  player's own choice or the retail default (off). */
  function soundState() {
    const stored = storedHardware3d();
    const { hardware } = chooseHardware3d({ stored });
    return { hardware, chosen: stored !== null, live: ds3dHardware() };
  }

  function soundNotes(s = soundState()) {
    return s.hardware ? ['3D VOICES ARE PLACED BY AN HRTF HEAD, AS A SOUND CARD DID'] : [];
  }

  function paintSound(table) {
    const s = soundState();
    for (const el of sound.panel) paintElement(ctx, el, layout, null, env);
    for (const el of sound.row.elements) paintElement(ctx, el, layout, null, env);
    if (s.hardware) paintElement(ctx, sound.row.mark, layout, null, env);
    const [x, y] = sound.row.elements[0].rect;
    soundNotes(s).forEach((text, i) => {
      paintElement(ctx, { kind: 'text', rect: [x, y + 22 + i * 15, 420, 20], font: 'standard6',
                          align: 'left', text, color: HELP_TEXT }, layout, null, env);
    });
    paintPage('videoNav', table, SOUND_NAV_DX);
  }

  /** A click on row `row` at `x`: a tick box toggles, a slider's track picks
   *  the step under the pointer, its value box steps on to the next. */
  function clickVideoRow(row, x) {
    const v = videoState();
    if (row.kind === 'tick') {
      setVideo(row.id, !v[row.id]);
      return;
    }
    const steps = row.spec.steps;
    const onTrack = x >= row.track[0] - 2 && x <= row.track[0] + row.track[2] + 2;
    const next = onTrack ? sliderPick(row.track, steps, x)
      : steps[(steps.indexOf(v[row.id]) + 1) % steps.length];
    setVideo(row.id, next);
  }

  /** The section that is up reads as chosen on the row that picks it: its
   *  button on the file's own clicked plate. Only where there is a choice. */
  function paintSection() {
    if (!video && !sound) return;
    const button = strip?.buttons.find(b => b.id === state.section);
    for (const el of button?.elements || []) {
      if (el.kind === 'button') {
        paintElement(ctx, { ...el, texture: el.pressed || el.texture }, layout, null, env);
      } else if (el.kind === 'text') {
        paintElement(ctx, el, layout, null, env);
      }
    }
  }

  function paint() {
    if (!layout) return;
    if (!beginStage(canvas, ctx, layout.virtual)) return;
    const table = vars();
    paintPage('background', table);
    if (state.section === 'video' || state.section === 'sound') {
      if (state.section === 'video') paintVideo(table);
      else paintSound(table);
      strip?.paint(ctx);
      paintSection();
      ctx.globalAlpha = 1;
      return;
    }
    paintPage(`plate.${state.tab}`, table);
    paintSliders();
    paintHelp();
    paintPage('tabs', table);
    const page = currentPage();
    if (page) {
      paintPage(page.page, table);
      for (const { row, entries } of rowStates(page)) {
        paintBox(row.primary, entries[0]);
        paintBox(row.alternate, entries[1]);
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
    paintSection();
    paintMessage();
    paintPlates();
    if (confirming) paintConfirm();
    ctx.globalAlpha = 1;
  }

  /** SAVE's answer, or a refused key, on the confirmation line. */
  function paintMessage() {
    if (!message || performance.now() > message.until) return;
    paintElement(ctx, { kind: 'text', rect: MESSAGE_RECT, font: 'standard6', align: 'center',
                        text: message.text, color: message.color }, layout, null, env);
  }

  /** The pointer's plates: DEFINE KEY while a box waits, and the red
   *  conflict bar over a conflicting box. Placed at the pointer, kept on
   *  the screen. */
  function paintPlates() {
    const popups = layout.popups || PLATES;
    let els = null;
    let text = null;
    if (capture) {
      els = (popups.defineKey || PLATES.defineKey).filter(el => plateFor(el, capture.slot));
    } else if (!confirming && hover?.kind === 'box' && hover.conflict) {
      // The file has the bar twice, one per box (`MouseOverPrimary` /
      // `MouseOverAlternate`): the hovered box's.
      els = (popups.conflict || PLATES.conflict).filter(el => {
        const on = (el.when || []).find(c => /MouseOver(Primary|Alternate)$/.test(c.var || ''));
        return !on || on.var.endsWith(hover.slot === 1 ? 'Alternate' : 'Primary');
      });
      text = conflictText(hover.conflict, hover.context);
    }
    if (!els?.length) return;
    const width = Math.max(...els.map(el => el.rect[0] + el.rect[2]));
    const height = Math.max(...els.filter(el => el.kind === 'fill').map(el => el.rect[1] + el.rect[3]));
    const [vw, vh] = layout.virtual || [800, 600];
    const ox = Math.max(0, Math.min(vw - width, pointer[0]));
    const oy = Math.max(0, Math.min(vh - height, pointer[1]));
    for (const el of els) {
      const placed = { ...el, rect: [el.rect[0] + ox, el.rect[1] + oy, el.rect[2], el.rect[3]] };
      if (el.kind === 'text' && text !== null) { placed.text = text; delete placed.var; }
      paintElement(ctx, placed, layout, null, env);
    }
  }

  /** Whether a DEFINE KEY plate element is the primary's or the
   *  alternate's: the extracted ones say by `Options/Controls/Alternate`. */
  function plateFor(el, slot) {
    if (el.slot !== undefined) return el.slot === slot;
    const alt = (el.when || []).find(c => c.var === 'Options/Controls/Alternate');
    if (!alt) return true;
    return (alt.op === 'eq') === Boolean(alt.value) ? slot === 1 : slot === 0;
  }

  /** DEFAULT's question over the screen. */
  function paintConfirm() {
    const fill = (rect, color) => paintElement(ctx, { kind: 'fill', rect, color }, layout, null, env);
    fill([0, 0, 800, 600], [0.2, 0.2, 0.2, 0.4]);
    const [x, y, w, h] = CONFIRM_RECT;
    fill([x, y, w, h], [0.5468, 0.5468, 0.5468, 1]);
    fill([x + 1, y + 1, w - 2, h - 2], [0, 0, 0, 1]);
    paintElement(ctx, { kind: 'text', rect: [x, y + 14, w, 20], font: 'standard6', align: 'center',
                        text: 'THIS WILL REVERT TO DEFAULT SETTINGS', color: [1, 1, 1, 1] }, layout, null, env);
    const art = (layout.pages.controlsNav?.elements || []).find(el => el.kind === 'button');
    for (const [rect, label] of [[CONFIRM_OK_RECT, 'OK'], [CONFIRM_CANCEL_RECT, 'CANCEL']]) {
      if (art) paintElement(ctx, { ...art, rect }, layout, null, env);
      else fill(rect, [0.5468, 0.5468, 0.5468, 1]);
      paintElement(ctx, { kind: 'text', rect: [rect[0] + 6, rect[1] + 9, rect[2] - 12, 18], font: 'standard6',
                          align: 'center', text: label, color: [1, 1, 1, 1] }, layout, null, env);
    }
  }

  // --- the live loop: rows lit and the preview driven while the screen is up

  let running = false;
  let lastLit = '';
  function frame(now) {
    if (!running) return;
    if (state.section !== 'controls') { requestAnimationFrame(frame); return; }
    if (pollPad) controls.pollGamepad();
    if (capture) pollCapture();
    if (message && now > message.until) { message = null; paint(); }
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
    // Leaving the screen drops what SAVE did not write, as the game's
    // LoadAllControls does on the way back in.
    cancelCapture(false);
    confirming = false;
    draft = null;
    message = null;
  }

  // --- DEFINE KEY ----------------------------------------------------------

  /** A box clicked: it waits for an input. */
  function startCapture(hit) {
    const pad = controls.padState?.() ?? { buttons: [], axes: [] };
    capture = {
      context: hit.context, id: hit.id, spec: hit.spec, slot: hit.slot, key: hit.rowKey,
      started: performance.now(),
      // What the stick was doing when the box was clicked: a button already
      // down, or an axis off centre, is not an answer.
      rest: { buttons: pad.buttons.slice(), axes: pad.axes.slice() },
      moved: [0, 0],
    };
    message = null;
    lastLit = '';
    paint();
  }

  function cancelCapture(repaint = true) {
    clearTimeout(ctrlTimer);
    ctrlTimer = null;
    if (!capture) return;
    capture = null;
    lastLit = '';
    if (repaint) paint();
  }

  /** The input the waiting box takes. A button row takes no axis (it keeps
   *  waiting); a movement row takes the wheel as the wheel axis. */
  function take(input) {
    const c = capture;
    if (!c) return false;
    clearTimeout(ctrlTimer);
    ctrlTimer = null;
    const axis = input.type === 'mouseAxis' || input.type === 'padAxis';
    if (axis && !c.spec.axis) return false;
    const given = input.type === 'wheel' && c.spec.axis ? { type: 'mouseAxis', axis: 2, dir: input.dir } : input;
    edits().set(c.context, c.id, c.slot, given);
    capture = null;
    lastLit = '';
    paint();
    return true;
  }

  /** Escape: the waiting box is unbound. */
  function unbind() {
    const c = capture;
    if (!c) return;
    edits().clear(c.context, c.id, c.slot);
    cancelCapture();
  }

  function say(kind) {
    const [text, color] = MESSAGES[kind];
    message = { kind, text, color, until: performance.now() + MESSAGE_MS };
    paint();
  }

  /** A key while a box waits. */
  function captureKey(event) {
    if (event.repeat) return;
    if (ctrlTimer) {
      clearTimeout(ctrlTimer);
      ctrlTimer = null;
      // AltGr's own key replaces the ControlLeft Windows sent ahead of it;
      // any other key came after a real Ctrl, which wins.
      takeKey(event.code === 'AltRight' ? event : { code: 'ControlLeft', key: 'Control' });
      return;
    }
    if (event.code === 'Escape') { unbind(); return; }
    if (event.code === 'ControlLeft') {
      ctrlTimer = setTimeout(() => { ctrlTimer = null; takeKey({ code: 'ControlLeft', key: 'Control' }); }, 40);
      return;
    }
    takeKey(event);
  }

  function takeKey(event) {
    if (!capture) return;
    if (!CAPTURE_CODES.has(event.code)) {
      // Grave is the console's (retail refuses scancode 0x29, 0x006c7678),
      // and a key the engine has no name for cannot be written.
      cancelCapture(false);
      say('unmappable');
      return;
    }
    // The legend this board prints on the key, when the Keyboard API gave
    // none: what the key typed.
    const typed = typeof event.key === 'string' && [...event.key].length === 1 && event.key !== ' ';
    if (LAYOUT_CODES.has(event.code) && typed && !keyNames.has(event.code)) {
      keyNames.set(event.code, event.key);
      controls.setKeyNames?.(keyNames);
    }
    take({ type: 'key', code: event.code });
  }

  /** The stick while a box waits: a button pressed since the click, or (on
   *  a movement row) one of the first four axes moved past retail's 0.2
   *  from where it rested. The hat counts as the four buttons after the
   *  physical ones, as the engine numbers it. */
  function pollCapture() {
    const pad = controls.padState?.() ?? { buttons: [], axes: [] };
    const rest = capture.rest;
    if (!rest.axes.length && pad.axes.length) rest.axes = pad.axes.slice();
    for (let i = 0; i < Math.min(32, pad.buttons.length); i++) {
      if (!pad.buttons[i]) { rest.buttons[i] = false; continue; }
      if (!rest.buttons[i]) { take({ type: 'pad', button: i }); return; }
    }
    if (!capture.spec.axis) return;
    for (let i = 0; i < Math.min(4, pad.axes.length); i++) {
      const from = rest.axes[i] ?? 0;
      if (Math.abs(from) > 1.05) continue;   // a hat axis at rest
      const d = pad.axes[i] - from;
      if (Math.abs(d) > PAD_AXIS_DELTA) { take({ type: 'padAxis', axis: i, dir: Math.sign(d) }); return; }
    }
  }

  /** SAVE: refused while any box conflicts; otherwise the four files are
   *  rewritten and kept (and the account's copy follows). */
  function saveEdits() {
    cancelCapture(false);
    const d = edits();
    if (d.hasConflicts()) { say('conflict'); return false; }
    if (d.dirty) {
      controls.commitFiles(d.files());
      draft = null;
      onBindingsChanged();
    }
    lastLit = '';
    say('saved');
    return true;
  }

  /** DEFAULT: asks first. */
  function askDefault() {
    cancelCapture(false);
    confirming = true;
    paint();
  }

  /** DEFAULT answered OK: every box from the shipped maps, for SAVE. */
  function applyDefault() {
    confirming = false;
    edits().reset();
    lastLit = '';
    paint();
  }

  const observer = new ResizeObserver(() => { paint(); if (running) placePreview(); });
  observer.observe(canvas);

  // --- input -----------------------------------------------------------------

  const at = event => pointerToVirtual(canvas, event, layout.virtual);

  /** What the pointer is over: a nav button, a tab head, a page arrow,
   *  DEFAULT, or the profile plate. */
  function hitTest(x, y) {
    if (confirming && state.section === 'controls') {
      if (inRect(CONFIRM_OK_RECT, x, y)) return { kind: 'button', action: 'confirm-ok', rect: CONFIRM_OK_RECT };
      if (inRect(CONFIRM_CANCEL_RECT, x, y)) return { kind: 'button', action: 'confirm-cancel', rect: CONFIRM_CANCEL_RECT };
      return { kind: 'modal' };
    }
    const nav = strip?.hover(x, y);
    if (nav) return nav;
    if (state.section === 'video') {
      for (const [action, plate] of Object.entries(video.nav)) {
        if (inRect(plate.rect, x, y)) return { kind: 'button', action: `video-${action}`, rect: plate.rect };
      }
      for (const line of video.perf?.lines || []) {
        if (inRect(line.hit, x, y)) return { kind: 'perf', action: `perf-${line.value}`, value: line.value };
      }
      for (const row of video.rows) {
        if (inRect(row.hit, x, y)) return { kind: row.kind, action: row.id, row };
      }
      return null;
    }
    if (state.section === 'sound') {
      for (const [action, plate] of Object.entries(sound.nav)) {
        if (inRect(plate.rect, x, y)) return { kind: 'button', action: `sound-${action}`, rect: plate.rect };
      }
      if (inRect(sound.row.hit, x, y)) return { kind: 'tick', action: 'hardware' };
      return null;
    }
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
    for (const row of currentPage()?.rows || []) {
      const spec = CONTROL_ROWS[row.key];
      if (!spec) continue;
      for (const [slot, rect] of [[0, row.primary], [1, row.alternate]]) {
        if (!inRect(rect, x, y)) continue;
        const context = rowContext(row.key) ?? TAB_CONTEXT[state.tab] ?? 'common';
        const id = rowId(spec);
        const maps = edits().conflicts().get(`${context}|${id}|${slot}`);
        return { kind: 'box', rowKey: row.key, spec, context, id, slot, rect,
                 conflict: maps ? [...maps] : null };
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
    const picker = accountPicker();
    if (picker && picker.list.length > 1) {
      if (inRect(PROFILE_PREV_RECT, x, y)) return { kind: 'button', action: 'profile-prev', rect: PROFILE_PREV_RECT };
      if (inRect(PROFILE_NEXT_RECT, x, y)) return { kind: 'button', action: 'profile-next', rect: PROFILE_NEXT_RECT };
    }
    if (inRect(HELP_RECT, x, y)) return { kind: 'help', action: 'profile' };
    if (inRect(PREVIEW_RECT, x, y)) return { kind: 'preview' };
    return null;
  }

  canvas.addEventListener('pointermove', event => {
    if (!layout) return;
    const [x, y] = at(event);
    pointer = [x, y];
    // A movement row waiting for its input takes the mouse moved far enough
    // one way (not the jitter of the click that opened it).
    if (capture?.spec.axis && performance.now() - capture.started > 150) {
      capture.moved[0] += event.movementX || 0;
      capture.moved[1] += event.movementY || 0;
      const [mx, my] = capture.moved;
      const along = Math.abs(mx) >= Math.abs(my) ? 0 : 1;
      const d = along === 0 ? mx : my;
      if (Math.abs(d) > MOUSE_AXIS_PX) take({ type: 'mouseAxis', axis: along, dir: Math.sign(d) });
    }
    const next = hitTest(x, y);
    const changed = JSON.stringify(next) !== JSON.stringify(hover);
    hover = next?.kind === 'preview' || next?.kind === 'modal' ? null : next;
    canvas.style.cursor = next && next.kind !== 'preview' && next.kind !== 'modal' ? 'pointer' : 'default';
    canvas.title = next?.action === 'profile' ? `Choose your profile folder: ${PROFILE_PATH}` : '';
    // The plates follow the pointer.
    if (changed || capture || hover?.conflict) paintSoon();
  });

  canvas.addEventListener('pointerleave', () => { hover = null; mouse.clear(); paintSoon(); });

  // A mouse binding is tried in the preview's frame; everywhere else a click
  // is the menu's.
  canvas.addEventListener('pointerdown', event => {
    if (!layout) return;
    const [x, y] = at(event);
    pointer = [x, y];
    swallowClick = false;
    // The side buttons are the browser's back and forward: never on this
    // screen, where they are MOUSE 4 and 5.
    if (event.button === 3 || event.button === 4) event.preventDefault();
    if (capture && state.section === 'controls') {
      // A tab, a page arrow or a button lets the box go (retail's tab heads
      // clear `WaitForKey`); anywhere else the button is the answer, the
      // left one too (`PrimaryMouseButton` 0x006c63c0).
      const hit = hitTest(x, y);
      if (hit && hit.kind !== 'box' && hit.kind !== 'preview') { cancelCapture(); return; }
      event.preventDefault();
      if (event.button === 0) swallowClick = true;
      take({ type: 'mouse', button: DI_BUTTON[event.button] ?? event.button });
      return;
    }
    if (hitTest(x, y)?.kind === 'preview') {
      mouse.add(DI_BUTTON[event.button] ?? event.button);
      event.preventDefault();
    }
  });
  addEventListener('pointerup', event => { mouse.delete(DI_BUTTON[event.button] ?? event.button); });
  for (const type of ['mouseup', 'auxclick']) {
    canvas.addEventListener(type, event => {
      if (event.button === 3 || event.button === 4 || capture) event.preventDefault();
    });
  }
  // The right button is MOUSE 2 here: no browser menu over the screen.
  canvas.addEventListener('contextmenu', event => {
    if (!layout) return;
    if (state.section === 'controls' || hitTest(...at(event))?.kind === 'preview') event.preventDefault();
  });

  canvas.addEventListener('click', event => {
    if (!layout) return;
    const [x, y] = at(event);
    canvas.focus();
    if (swallowClick) { swallowClick = false; return; }
    if (confirming && state.section === 'controls') {
      const answer = hitTest(x, y)?.action;
      if (answer === 'confirm-ok') applyDefault();
      else if (answer === 'confirm-cancel') { confirming = false; paint(); }
      return;
    }
    if (strip?.click(x, y)) return;
    const hit = hitTest(x, y);
    if (!hit) return;
    if (hit.kind === 'box') startCapture(hit);
    else if (hit.action === 'save') saveEdits();
    else if (hit.kind === 'tab') setTab(hit.tab);
    else if (hit.action === 'prev' || hit.action === 'next') turnPage(hit.action === 'next' ? 1 : -1);
    else if (hit.action === 'default') askDefault();
    else if (hit.action === 'profile') pickProfile();
    else if (hit.action === 'profile-prev' || hit.action === 'profile-next') stepProfile(hit.action === 'profile-next' ? 1 : -1);
    else if (hit.kind === 'perf') setPerformance(hit.value);
    else if (hit.row) clickVideoRow(hit.row, x);
    else if (hit.action === 'video-default') resetVideo();
    else if (hit.action === 'hardware') setHardware3d(!soundState().hardware);
    else if (hit.action === 'sound-default') setHardware3d(null);
  });

  canvas.addEventListener('wheel', event => {
    if (!layout) return;
    event.preventDefault();
    if (capture) {
      if (event.deltaY) take({ type: 'wheel', dir: event.deltaY < 0 ? 1 : -1 });
      return;
    }
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

  /** CONTROLS or VIDEO. The preview and the lit rows are CONTROLS' own. */
  function setSection(section) {
    if (!SECTIONS.includes(section) || section === state.section) return;
    if (section === 'video' && !video) return;
    if (section === 'sound' && !sound) return;
    state.section = section;
    cancelCapture(false);
    confirming = false;
    keys.clear();
    mouse.clear();
    releasing.clear();
    hover = null;
    lastLit = '';
    paint();
    if (running) placePreview();
  }

  /** Tick HARDWARE ACCELERATION, clear it, or go back to the default (off)
   *  with null. The page's voices change path at once. */
  function setHardware3d(value) {
    storeHardware3d(value);
    setDs3dHardware(chooseHardware3d({ stored: storedHardware3d() }).hardware);
    paint();
  }

  /** Tick the box, clear it, or go back to this GPU's default with null. */
  function setAntialias(value) {
    storeAntialias(value);
    paint();
  }

  /** One row's new value, kept at once (anti-aliasing under its own key). */
  function setVideo(id, value) {
    if (id === 'antialias') { setAntialias(value); return; }
    changeVideo({ [id]: value });
    paint();
  }

  /** A VIDEO PERFORMANCE line: LOW, MEDIUM or HIGH writes its preset's
   *  rows; CUSTOM brings back the last mix that matched none. */
  function setPerformance(level) {
    const { custom: _custom, ...next } = applyPreset(storedVideo(), level);
    changeVideo(next);
    paint();
  }

  /** DEFAULT: every row back to what this page draws with no choice. */
  function resetVideo() {
    storeAntialias(null);
    changeVideo(null);
    paint();
  }

  function setTab(tab) {
    if (!TABS.includes(tab) || tab === state.tab) return;
    for (const code of releasing) keys.delete(code);
    releasing.clear();
    cancelCapture(false);
    state.tab = tab;
    preview.setMode(tab);
    lastLit = '';
    paint();
  }

  function turnPage(by) {
    const count = tabPages(state.tab).length;
    cancelCapture(false);
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
    // An import is the maps from here on: the boxes start over from it.
    if (applied.length) { draft = null; cancelCapture(false); }
    onBindingsChanged();
    lastLit = '';
    paint();
  }

  /** DEFAULT, answered: the boxes from the shipped maps, for SAVE to write. */
  function resetDefaults() { applyDefault(); }

  // The account's answer lands after the screen is up (a profile loaded, a
  // save done): repaint the plate and the rows.
  profileSync?.onChange?.(() => { lastLit = ''; paintSoon(); });
  controls.onChange?.(({ reason }) => {
    if (reason !== 'account') return;
    // The account's copy landed: the boxes follow it unless there are edits
    // the player has not saved.
    if (!draft?.dirty) draft = null;
    lastLit = '';
    paintSoon();
  });

  /** A key down. Every key reaches the rows; a key the page would lose
   *  (Tab moves focus, Alt raises Firefox's menu bar, the F-keys are the
   *  browser's) is kept. Escape is the host's, except while a box waits
   *  (it unbinds the box) or DEFAULT's question is up (it is CANCEL): then
   *  this returns true and the host leaves the menu up. */
  function keydown(event) {
    if (!layout || state.section !== 'controls') return false;
    if (confirming) {
      if (event.code === 'Escape') { confirming = false; paint(); }
      else if ((event.code === 'Enter' || event.code === 'NumpadEnter') && !event.repeat) applyDefault();
      return true;
    }
    if (capture) { captureKey(event); return true; }
    if (event.code === 'Escape') return false;
    keys.add(event.code);
    releasing.delete(event.code);
    return true;
  }

  function keyup(event) {
    if (running) releasing.add(event.code);
    else keys.delete(event.code);
    return Boolean(layout) && event.code !== 'Escape' && state.section === 'controls';
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
    setSection,
    setAntialias,
    setHardware3d,
    setVideo,
    setPerformance,
    resetVideo,
    get videoRows() { return video?.rows.map(({ spec: _spec, ...r }) => r) ?? null; },
    get videoPerformance() { return video?.perf ?? null; },
    turnPage,
    importFiles,
    resetDefaults,
    /** DEFINE KEY on a row's box, by its lexicon key (as a click would). */
    define(rowKey, slot = 0) {
      const spec = CONTROL_ROWS[rowKey];
      if (!spec) return false;
      startCapture({ rowKey, spec, slot, context: rowContext(rowKey), id: rowId(spec) });
      return true;
    },
    save: saveEdits,
    askDefault,
    pointer: (x, y) => { pointer = [x, y]; },
    selectProfile,
    stepProfile,
    preview,
    get strip() { return strip; },
    get state() {
      return {
        section: state.section,
        video: video ? { ...videoState(), notes: videoNotes() } : null,
        sound: sound ? { ...soundState(), notes: soundNotes() } : null,
        tab: state.tab,
        page: state.page[state.tab],
        pages: tabPages(state.tab).length,
        rows: rowStates().map(r => ({ text: r.row.text, labels: r.entries.map(e => e.label),
                                      on: r.entries.map(e => e.on) })),
        preview: preview.state,
        account: profileSync?.view?.() ?? null,
        profileName: controls.describe().profileName,
        defining: capture ? { key: capture.key, slot: capture.slot } : null,
        confirming,
        message: message && performance.now() <= message.until ? message.text : null,
        dirty: Boolean(draft?.dirty),
        conflicts: draft ? [...draft.conflicts().keys()] : [],
      };
    },
    setActive(id) { strip?.setActive(id); },
  };
}
