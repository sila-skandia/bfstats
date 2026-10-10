// OPTIONS > VIDEO: what this site draws of the game's `menu/VideoMenu`.
//
// The retail screen (`controls-layout.json`'s `video` page) is three plates:
// VIDEO PERFORMANCE (CUSTOM / LOW / MEDIUM / HIGH), DISPLAY MODE (the
// resolution list) and VIDEO OPTIONS, a column of rows 30 units apart, each a
// label at x=312 and either a slider with a value box or a 19-unit tick box
// at x=473, one per `Options/Video/*` variable `Video.con` stores. DEFAULT
// and SAVE are `menu/VideoNavigation`'s.
//
// The game has no anti-aliasing row: `Video.con` holds a display mode and
// eight quality settings, and multisampling was the driver's to force. A
// browser page has to ask for it, so it is the one row here, drawn as the
// file draws a tick box (its ENVIRONMENT MAPPING row, moved to the first
// row's place) on the file's own VIDEO OPTIONS plate. The rows the viewer
// has nothing behind are not drawn, the rule the nav strip follows.
//
// Pure: the elements to paint and the rects to hit-test, out of a layout.

const PANEL_TEXTURE = 'menu_options_512x512';
const PANEL_TITLE = 'VIDEO_OPTIONS';
const FIRST_ROW = 'VIDEO_OPTIONS_GRAPHICS_QUALITY';
const TICK_ROW = 'VIDEO_OPTIONS_ENV_MAPPING';

const elementsOf = (layout, page) => layout?.pages?.[page]?.elements || [];

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
