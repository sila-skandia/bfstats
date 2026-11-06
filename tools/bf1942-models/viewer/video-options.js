// OPTIONS > VIDEO: what this site draws of the game's `menu/VideoMenu`.
//
// The retail screen (`controls-layout.json`'s `video` page) is three plates:
// VIDEO PERFORMANCE (CUSTOM / LOW / MEDIUM / HIGH), DISPLAY MODE (the
// resolution list) and VIDEO OPTIONS, a column of rows 30 units apart, each a
// label at x=312 and either a slider with a value box or a 19-unit tick box
// at x=473, one per `Options/Video/*` variable `Video.con` stores. DEFAULT
// and SAVE are `menu/VideoNavigation`'s.
//
// The rows the viewer has something behind are the file's own rows, each
// taken whole from its label to the next one (`videoRow`) and set on the
// plate's lines in the game's order (`placeVideoRows`): the i-th row drawn
// sits on the file's i-th line, so the column keeps the game's own rhythm,
// and the rows the viewer cannot honour (SHADOWS, ALTERNATIVE SPAWN
// INTERFACE) are left out rather than drawn dead, the rule the nav strip
// follows. One row is this site's own and borrows a tick box's shape:
// ANTI-ALIASING. The game has no anti-aliasing row: `Video.con` holds a
// display mode and eight quality settings, and multisampling was the
// driver's to force.
//
// VIDEO PERFORMANCE's plate (`performancePanel`) is drawn too: its four
// radio lines pick a preset. So is DISPLAY MODE's (`displayModePanel`): the
// plate, its heading, its scroll column and the list box
// `Options/Video/DisplayModeList`, whose rows the engine fills at runtime
// (VID-11) and the page fills from the screen (`video-settings.js`
// `displayModes`). It replaced this site's RENDER SCALE row, a percentage
// of the same pixel ratio.
//
// Pure: the elements to paint and the rects to hit-test, out of a layout.

const PANEL_TEXTURE = 'menu_options_512x512';
const PANEL_TITLE = 'VIDEO_OPTIONS';
const FIRST_ROW = 'VIDEO_OPTIONS_GRAPHICS_QUALITY';
const TICK_ROW = 'VIDEO_OPTIONS_ENV_MAPPING';

const elementsOf = (layout, page) => layout?.pages?.[page]?.elements || [];

/** The VIDEO OPTIONS rows this site draws, top to bottom, each the file's
 *  row `key` (the last borrows a row's shape for a setting of the page's
 *  own). `steps` are a slider's values; `fileText` says the file
 *  carries the slider's value texts. SHADOWS and ALTERNATIVE SPAWN
 *  INTERFACE are not drawn: the viewer has nothing behind them. */
export const VIDEO_ROWS = Object.freeze([
  { id: 'graphicsQuality', key: 'VIDEO_OPTIONS_GRAPHICS_QUALITY', steps: [1, 2, 3], fileText: true },
  { id: 'effectsQuality', key: 'VIDEO_OPTIONS_EFFECTS_QUALITY', steps: [1, 2, 3], fileText: true },
  { id: 'environmentMapping', key: 'VIDEO_OPTIONS_ENV_MAPPING' },
  { id: 'lightmaps', key: 'VIDEO_OPTIONS_LIGHTMAPS' },
  { id: 'textureQuality', key: 'VIDEO_OPTIONS_TEXTURE_QUALITY', steps: [1, 2, 3, 4, 5], fileText: true },
  { id: 'viewDistance', key: 'VIDEO_OPTIONS_VIEWDISTANCE',
    steps: [50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100] },
  { id: 'antialias', key: 'VIDEO_OPTIONS_ENV_MAPPING', text: 'ANTI-ALIASING:' },
]);

/** Whether the pack carries the screen at all (one extracted before
 *  `menu/VideoMenu` was read does not). */
export function hasVideoPage(layout) {
  return elementsOf(layout, 'video').some(el => el.key === TICK_ROW);
}

/** The VIDEO OPTIONS plate and its heading. */
export function videoPanel(layout) {
  return elementsOf(layout, 'video').filter(el =>
    (el.kind === 'picture' && el.texture === PANEL_TEXTURE)
    || (el.kind === 'text' && el.key === PANEL_TITLE));
}

/**
 * A tick-box row reading `text`, `index` rows down the panel: the file's own
 * tick-box row moved there.
 *
 * `elements` are the label and the box's frame, `mark` the square drawn
 * when it is ticked, and `hit` the label and the box together: what a click
 * toggles. Null when the page has no tick-box row to copy.
 */
export function tickRow(layout, { text, index = 0 }) {
  const all = elementsOf(layout, 'video');
  const at = all.findIndex(el => el.kind === 'text' && el.key === TICK_ROW);
  const first = all.find(el => el.kind === 'text' && el.key === FIRST_ROW);
  if (at < 0 || !first) return null;
  // The row runs to the next labelled line.
  let end = at + 1;
  while (end < all.length && !(all[end].kind === 'text' && all[end].key)) end++;
  const label = all[at];
  const fills = all.slice(at + 1, end).filter(el => el.kind === 'fill');
  const mark = fills.find(el => el.when?.length);
  const frame = fills.filter(el => el !== mark);
  if (!mark || !frame.length) return null;
  const step = 30;
  const dy = first.rect[1] - label.rect[1] + index * step;
  const moved = el => ({ ...el, rect: [el.rect[0], el.rect[1] + dy, el.rect[2], el.rect[3]] });
  const box = moved(frame[0]).rect;
  const { key: _key, ...plain } = moved(label);
  const { when: _when, ...ticked } = moved(mark);
  return {
    elements: [{ ...plain, text }, ...frame.map(moved)],
    mark: ticked,
    box,
    hit: [plain.rect[0], box[1], box[0] + box[2] - plain.rect[0], box[3]],
  };
}

/** `menu/VideoNavigation`'s DEFAULT and SAVE: each one's plate (the copy
 *  painted last, so the mouse-over art shows) by what it does. */
export function videoNavButtons(layout) {
  const all = elementsOf(layout, 'videoNav');
  const out = {};
  for (const [action, key] of [['default', 'MENU_DEFAULT'], ['save', 'MENU_SAVE']]) {
    const label = all.find(el => el.kind === 'text' && el.key === key);
    if (!label) continue;
    const plates = all.filter(el => el.kind === 'button'
      && label.rect[0] >= el.rect[0] && label.rect[0] < el.rect[0] + el.rect[2]);
    if (plates.length) out[action] = plates[plates.length - 1];
  }
  return out;
}

const isLineLabel = el => el.kind === 'text' && typeof el.key === 'string'
  && el.key.startsWith('VIDEO_OPTIONS_') && el.rect[0] === 312 && el.rect[1] > 140;

/** The file's labels down the VIDEO OPTIONS column, top to bottom: the
 *  lines a row can be set on (165, 195, 230 ... 375 in the vanilla pack). */
export function videoLines(layout) {
  return elementsOf(layout, 'video').filter(isLineLabel).map(el => el.rect[1]);
}

/**
 * One row of the file, from its label (`key`) to the next labelled line:
 * `{ kind, label, frame, track, box, values, unit, edit, mark }`.
 *
 * `kind` is `tick` (a 19-unit box and its mark) or `slider` (a 76x11 track,
 * a value box, and the file's own value texts, `values`, by the value each
 * shows, or an edit box, `edit`). `frame` is every unconditional fill,
 * painted as is; `track` the slider's 74x9 inside; `box` the value box's
 * (or the tick box's) outer rect; `unit` the `%` the file draws after a
 * value. Null when the file has no such row.
 */
export function videoRow(layout, key) {
  const all = elementsOf(layout, 'video');
  const at = all.findIndex(el => el.kind === 'text' && el.key === key);
  if (at < 0) return null;
  let end = at + 1;
  while (end < all.length && !isLineLabel(all[end])) end++;
  const label = all[at];
  const body = all.slice(at + 1, end);
  const fills = body.filter(el => el.kind === 'fill');
  const frame = fills.filter(el => !el.when?.length);
  const widest = list => list.reduce((a, el) => (!a || el.rect[2] > a.rect[2] ? el : a), null);
  const track = frame.find(el => el.rect[2] === 74 && el.rect[3] === 9) || null;
  if (track) {
    const boxes = frame.filter(el => el !== track && !(el.rect[2] === 76 && el.rect[3] === 11));
    const values = {};
    for (const el of body) {
      const eq = el.kind === 'text' ? el.when?.find(c => c.op === 'eq') : null;
      if (eq) values[String(eq.value)] = el;
    }
    return {
      kind: 'slider', label, frame, track: track.rect, box: widest(boxes)?.rect || null, values,
      unit: body.find(el => el.kind === 'text' && !el.when?.length && el.text === '%') || null,
      edit: body.find(el => el.kind === 'edit') || null,
      mark: null,
    };
  }
  const mark = fills.find(el => el.when?.length) || null;
  if (!mark) return null;
  return { kind: 'tick', label, frame, track: null, box: widest(frame)?.rect || null, values: {}, unit: null, edit: null, mark };
}

const shiftRect = (rect, dy) => (rect ? [rect[0], rect[1] + dy, rect[2], rect[3]] : rect);
const shiftEl = (el, dy) => (el ? { ...el, rect: shiftRect(el.rect, dy) } : el);
/** A moved element with its conditions dropped: the page paints the value. */
const plainAt = (el, dy) => {
  if (!el) return el;
  const { when: _when, key: _key, ...rest } = shiftEl(el, dy);
  return rest;
};

/** `row` moved so its label sits at `y`, relabelled `text` when given. The
 *  moved row also carries `hit`, the label through the control: where a
 *  click lands. */
export function placeRow(row, y, text = null) {
  if (!row) return null;
  const dy = y - row.label.rect[1];
  const label = plainAt(row.label, dy);
  if (text) label.text = text;
  const box = shiftRect(row.box, dy);
  const track = shiftRect(row.track, dy);
  const rects = [box, track].filter(Boolean);
  const right = Math.max(...rects.map(r => r[0] + r[2]));
  const top = Math.min(...rects.map(r => r[1]));
  const bottom = Math.max(...rects.map(r => r[1] + r[3]));
  return {
    ...row,
    label,
    frame: row.frame.map(el => shiftEl(el, dy)),
    track,
    box,
    values: Object.fromEntries(Object.entries(row.values).map(([v, el]) => [v, plainAt(el, dy)])),
    unit: plainAt(row.unit, dy),
    edit: plainAt(row.edit, dy),
    mark: plainAt(row.mark, dy),
    hit: [label.rect[0], top, right - label.rect[0], bottom - top],
  };
}

/**
 * The rows to draw: `specs` in order (`{ id, key, text? }`), each the
 * file's row `key`, set on the next free line of the column. A spec whose
 * row the file lacks is skipped, and so is one past the last line.
 */
export function placeVideoRows(layout, specs) {
  const lines = videoLines(layout);
  const out = [];
  for (const spec of specs) {
    if (out.length >= lines.length) break;
    const row = videoRow(layout, spec.key);
    if (!row) continue;
    out.push({ id: spec.id, ...placeRow(row, lines[out.length], spec.text || null) });
  }
  return out;
}

/** The step of `values` (ascending) a click at `x` along `track` picks:
 *  the track shared evenly between them. */
export function sliderPick(track, values, x) {
  if (!values.length) return null;
  const t = Math.max(0, Math.min(1, (x - track[0]) / Math.max(1, track[2])));
  return values[Math.round(t * (values.length - 1))];
}

/** Where a slider's knob sits for `value` among `values`: a 7-unit rect
 *  inside `track` (the controls screen's knob). */
export function sliderKnob(track, values, value) {
  const knob = 7;
  const i = Math.max(0, values.indexOf(value));
  const t = values.length > 1 ? i / (values.length - 1) : 0;
  return [track[0] + t * (track[2] - knob), track[1] + 1, knob, track[3] - 2];
}

/** VIDEO PERFORMANCE: its plate and heading, and its radio lines by the
 *  value each sets (`Options/Video/Performance`): `{ elements, lines:
 *  [{ value, hit, fill, text }] }`, null where the file has none. */
export function performancePanel(layout) {
  const all = elementsOf(layout, 'video');
  const plate = all.find(el => el.kind === 'picture' && el.texture === 'menu_videoperf_256x128');
  const heading = all.find(el => el.kind === 'text' && el.key === 'VIDEO_OPTIONS_VIDEO_PERF');
  if (!plate || !heading) return null;
  const lines = [];
  all.forEach((el, i) => {
    const set = el.kind === 'hit' ? el.sets?.find(s => s.var === 'Options/Video/Performance') : null;
    if (!set) return;
    const fill = all.find(f => f.kind === 'fill'
      && f.when?.some(w => w.var === 'Options/Video/Performance' && w.value === set.value));
    const text = all.slice(i + 1).find(t => t.kind === 'text');
    if (!fill || !text) return;
    lines.push({ value: set.value, hit: el.rect, fill: plainAt(fill, 0), text: plainAt(text, 0) });
  });
  return lines.length ? { elements: [plate, heading], lines } : null;
}

/**
 * DISPLAY MODE: `menu_videodispl_256x256` at (65,230), its heading, the
 * scroll arrows and track, and the list box `Options/Video/DisplayModeList`
 * (69,242,177,200; 14-unit rows). `{ elements, box, rows: [x, y, w, h],
 * count }`: `elements` the plate's own leaves in file order, `rows` the
 * area the entries are drawn in, `count` how many show at once. Null where
 * the file has no such list.
 *
 * The list box has no rect of its own in the engine (it fills the transform
 * it shares with the scroll column, `extract_menu_layout.py` `list_rows`),
 * so the rows run from the up arrow's top to the down arrow's foot, and
 * from the box's left to the scroll track: 257..426 in the vanilla pack,
 * twelve rows, the plate art's own well (257..438).
 */
export function displayModePanel(layout) {
  const all = elementsOf(layout, 'video');
  const at = all.findIndex(el => el.kind === 'listbox' && el.data === 'Options/Video/DisplayModeList');
  if (at < 0) return null;
  const box = all[at];
  const [bx, by, bw, bh] = box.rect;
  const plate = all.find(el => el.kind === 'picture' && el.texture === 'menu_videodispl_256x256')
    || all.filter(el => el.kind === 'picture' && el.rect[0] <= bx && el.rect[1] <= by
      && el.rect[0] + el.rect[2] >= bx + bw).pop();
  const heading = all.find(el => el.kind === 'text' && el.key === 'VIDEO_OPTIONS_DISPLAY_MODE');
  const inside = el => el.rect[0] >= bx && el.rect[0] < bx + bw && el.rect[1] >= by - 20 && el.rect[1] < by + bh;
  const arrows = all.filter(el => el.kind === 'button' && inside(el)).sort((a, b) => a.rect[1] - b.rect[1]);
  const track = all.find(el => el.kind === 'fill' && inside(el) && el.rect[3] > 40 && el.rect[2] < 20) || null;
  const top = arrows.length ? arrows[0].rect[1] : by;
  const foot = arrows.length > 1 ? arrows[arrows.length - 1].rect[1] + arrows[arrows.length - 1].rect[3] : by + bh;
  const right = track ? track.rect[0] : bx + bw;
  const count = Math.max(1, Math.floor((foot - top) / box.rowHeight));
  const elements = [plate, heading, arrows[0], track, ...arrows.slice(1)].filter(Boolean);
  return { elements, box, rows: [bx, top, right - bx, count * box.rowHeight], count };
}

/** The entry of a list of `count` under the pointer at `y` in `rows`
 *  (`displayModePanel`), scrolled by `scroll`; -1 off the list. */
export function displayModeAt(panel, count, x, y, scroll = 0) {
  const [rx, ry, rw, rh] = panel.rows;
  if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return -1;
  const index = scroll + Math.floor((y - ry) / panel.box.rowHeight);
  return index < count ? index : -1;
}
