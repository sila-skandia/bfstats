// OPTIONS > CUSTOMIZE: the game's general options screen
// (`menu/GeneralOptionsMenu`), as the controls screen lays its fourth
// section out (gap audit 2026-11-12, entry 56).
//
// The file's rows (`general-options-layout.json`,
// `extract_general_options_layout.py`), each bound to a word of the profile's
// `GeneralOptions.con`, with the shipped Default profile's value:
//
//   TOOLTIP                a tick box   game.setToolTip 0
//   RADIO TOOLTIP          a tick box   game.setRadioToolTip 1
//   STATIC MINIMAP         a tick box   game.setStaticMinimap 1
//   MINIMAP TRANSPARENCY   a slider     game.setMinimapTransparency 20  (0..100 %)
//   CROSSHAIR COLOR        three        game.setCrossHairColor 255 255 0 (0..255 each)
//                          sliders, RED GREEN BLUE
//
// PLAYERNAME is the row above them: the profile's name, shown and not edited
// here (the name is the account's or the room's). The shipped menu has no row
// for the radio tooltip's colour (`game.setRadioToolTipColor`): the client
// registers `Options/General/Radio/Color/*` and no page of any pack binds it.
//
// Pure: the rows out of the layout, where a click lands, and the knob.

/** The rows, in the file's order. `key` is the label's lexicon key; `verb`
 *  the profile word; `channel` the crosshair colour's index. */
export const GENERAL_ROWS = Object.freeze([
  { id: 'toolTip', kind: 'tick', key: 'GENERAL_OPTIONS_TOOLTIP', verb: 'game.setToolTip',
    variable: 'Options/General/ToolTip' },
  { id: 'radioToolTip', kind: 'tick', key: 'GENERAL_OPTIONS_RADIO_TOOLTIP', verb: 'game.setRadioToolTip',
    variable: 'Options/General/RadioToolTip' },
  { id: 'staticMinimap', kind: 'tick', key: 'GENERAL_OPTIONS_MINIMAP_STATIC', verb: 'game.setStaticMinimap',
    variable: 'Options/General/StaticMinimap' },
  { id: 'minimapTransparency', kind: 'slider', key: 'GENERAL_OPTIONS_MINIMAP_TRANSPARENCY',
    verb: 'game.setMinimapTransparency', min: 0, max: 100 },
  { id: 'crossHairRed', kind: 'slider', key: 'GENERAL_OPTIONS_CROSSHAIR_COLOR_RED',
    verb: 'game.setCrossHairColor', channel: 0, min: 0, max: 255 },
  { id: 'crossHairGreen', kind: 'slider', key: 'GENERAL_OPTIONS_CROSSHAIR_COLOR_GREEN',
    verb: 'game.setCrossHairColor', channel: 1, min: 0, max: 255 },
  { id: 'crossHairBlue', kind: 'slider', key: 'GENERAL_OPTIONS_CROSSHAIR_COLOR_BLUE',
    verb: 'game.setCrossHairColor', channel: 2, min: 0, max: 255 },
]);

/** The shipped Default profile's values (`Profiles/Default/GeneralOptions.con`). */
export const GENERAL_DEFAULTS = Object.freeze({
  toolTip: false, radioToolTip: true, staticMinimap: true, minimapTransparency: 20,
  crossHairRed: 255, crossHairGreen: 255, crossHairBlue: 0,
});

const PLAYERNAME_KEY = 'GENERAL_OPTIONS_PLAYERNAME';
const sameY = (a, b, slack = 0.5) => Math.abs(a - b) <= slack;

/** Whether the pack carries the screen. */
export function hasGeneralPage(general) {
  const els = general?.pages?.general?.elements;
  return Array.isArray(els) && GENERAL_ROWS.every(row => els.some(el => el.key === row.key));
}

/**
 * The section out of the layout: `{ elements, rows, name, nav }`.
 * `elements` is everything drawn whatever the values are (the plate, the
 * heading, the labels, the frames); each row adds `mark` (a tick's fill) or
 * `track` and `value` (a slider's inner frame and its number's text leaf),
 * and `hit`, the rect a click answers in. `name` is the PLAYERNAME row's text
 * leaf. `nav` is DEFAULT and SAVE: `{ default: {rect, elements}, save }`.
 */
export function generalPanel(general) {
  if (!hasGeneralPage(general)) return null;
  const all = general.pages.general.elements;
  const bound = el => (el.when || []).length > 0;
  const rows = [];
  const dynamic = new Set();
  for (const spec of GENERAL_ROWS) {
    const label = all.find(el => el.kind === 'text' && el.key === spec.key);
    if (spec.kind === 'tick') {
      const mark = all.find(el => el.kind === 'fill'
        && (el.when || []).some(w => w.var === spec.variable));
      const hit = all.find(el => el.kind === 'hit' && mark && sameY(el.rect[1], mark.rect[1] - 4, 1));
      if (!mark || !hit) return null;
      dynamic.add(mark);
      rows.push({ ...spec, label, mark: { ...mark, when: [] }, hit: hit.rect });
    } else {
      // The inner frame of the row's track: the 74x9 fill on the label's line
      // (the crosshair rows) or two units under it (the transparency row).
      const track = all.find(el => el.kind === 'fill' && el.rect[2] === 74 && el.rect[3] === 9
        && (sameY(el.rect[1], label.rect[1]) || sameY(el.rect[1], label.rect[1] + 2)));
      if (!track) return null;
      const value = all.find(el => el.kind === 'text' && el.var && sameY(el.rect[1], track.rect[1]));
      if (value) dynamic.add(value);
      rows.push({ ...spec, label, track: track.rect, value: value ?? null,
                  hit: [track.rect[0] - 2, track.rect[1] - 3, track.rect[2] + 4, track.rect[3] + 6] });
    }
  }
  const nameLabel = all.find(el => el.kind === 'text' && el.key === PLAYERNAME_KEY);
  const edit = all.find(el => el.kind === 'edit');
  const elements = all.filter(el => !dynamic.has(el) && !bound(el)
    && el.kind !== 'hit' && el.kind !== 'edit');
  const nav = {};
  const navEls = general.pages.generalNav?.elements || [];
  for (const [action, key] of [['default', 'MENU_DEFAULT'], ['save', 'MENU_SAVE']]) {
    const text = navEls.find(el => el.kind === 'text' && el.key === key);
    const plate = text && navEls.filter(el => el.kind === 'button'
      && el.rect[0] <= text.rect[0] && text.rect[0] < el.rect[0] + el.rect[2]).pop();
    if (text && plate) nav[action] = { rect: plate.rect, elements: [plate, text] };
  }
  return {
    elements, rows, nav,
    name: nameLabel && edit ? { kind: 'text', rect: edit.rect, font: edit.font || 'standard6',
                                align: 'left', color: [1, 1, 1, 1] } : null,
  };
}

/** A slider's knob for `value`: a 7-unit rect inside `track` (the controls
 *  screen's knob). */
export function generalKnob(track, row, value) {
  const knob = 7;
  const t = Math.max(0, Math.min(1, (Number(value) - row.min) / (row.max - row.min)));
  return [track[0] + t * (track[2] - knob), track[1] + 1, knob, track[3] - 2];
}

/** The whole value a click at `x` along the row's track picks. */
export function generalPick(row, x) {
  const t = Math.max(0, Math.min(1, (x - row.track[0]) / Math.max(1, row.track[2])));
  return Math.round(row.min + t * (row.max - row.min));
}

/** The seven values out of the profile's words: `options` the
 *  `GeneralOptions.con` verbs (`controls.generalOptions()`), `color` the
 *  crosshair colour. */
export function generalValues(options = {}, color = null) {
  const num = (verb, fallback) => (Number.isFinite(Number(options[verb])) && options[verb] !== null
    && options[verb] !== undefined ? Number(options[verb]) : fallback);
  const d = GENERAL_DEFAULTS;
  const rgb = Array.isArray(color) && color.length === 3 ? color : [d.crossHairRed, d.crossHairGreen, d.crossHairBlue];
  return {
    toolTip: num('game.setToolTip', d.toolTip ? 1 : 0) !== 0,
    radioToolTip: num('game.setRadioToolTip', d.radioToolTip ? 1 : 0) !== 0,
    staticMinimap: num('game.setStaticMinimap', d.staticMinimap ? 1 : 0) !== 0,
    minimapTransparency: Math.max(0, Math.min(100, Math.round(num('game.setMinimapTransparency', d.minimapTransparency)))),
    crossHairRed: Math.round(rgb[0]), crossHairGreen: Math.round(rgb[1]), crossHairBlue: Math.round(rgb[2]),
  };
}
