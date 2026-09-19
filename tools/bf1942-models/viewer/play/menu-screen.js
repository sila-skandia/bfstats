// The Instant Battle screen, drawn from the game's own layout.
//
// `menu-layout.json` (extract_menu_layout.py) is `menu/Background`,
// `menu/SkirmishMenu` and `menu/SkirmishNavigation` flattened to draw lists
// in the engine's 800x600 virtual units, each leaf carrying its rect, its
// plate or fill colour, its font and alignment, its resolved string and the
// `CullNode` conditions the game evaluates before drawing it. This module
// evaluates those conditions against a variable table and paints the leaves
// in file order, which is what the game does.
//
// Everything here is pure: no `three`, no globals, no DOM beyond the 2D
// context it is handed, so `tests/menu_screen_harness.mjs` can run it under
// node against a stub context.

/** The engine's team numbering, as `menu/SkirmishMenu`'s own TEAM rows set
 *  `Campaign/Team`: 1 under AXIS, 2 under ALLIED. */
export const AXIS = 1;
export const ALLIED = 2;

/** The rectangle the level rows are drawn in.
 *
 *  `BfNewListBoxNode` has no rect of its own - it fills the transform it
 *  shares with the scroll arrows - and the engine's own row origin was not
 *  traced. The plate behind it has a recessed well for the rows, which
 *  `extract_menu_layout.list_rows` reads off the shipped art and carries as
 *  `listRows`. Without it the first row is drawn over the LEVELS heading.
 */
export function rowArea(layout, box) {
  const [x, y, w, h] = box.rect;
  // The scroll column - the two arrows and the track between them - is a set
  // of siblings inside the same transform, so the rows stop at its left edge
  // rather than running under it.
  const width = (trackRect(layout)?.[0] ?? x + w) - x;
  const rows = layout.listRows;
  if (!rows) return [x, y, width, h];
  return [x, rows.top, width, rows.bottom - rows.top];
}

/** Rows shown at once. The game shows whole rows only. */
export function visibleRows(layout, box) {
  return Math.max(1, Math.floor(rowArea(layout, box)[3] / box.rowHeight));
}

/** One condition of a `when`, against the variable table. The operators are
 *  the ones `extract_spawn_layout.condition` emits. */
export function condOk(c, vars) {
  if (c.op === 'and') return c.terms.every(t => condOk(t, vars));
  if (c.op === 'or') return c.terms.some(t => condOk(t, vars));
  const v = vars[c.var];
  const want = (c.value && typeof c.value === 'object') ? vars[c.value.var] : c.value;
  switch (c.op) {
    case 'eq': return v === want || Number(v) === Number(want);
    case 'ne': return !(v === want || Number(v) === Number(want));
    case 'lt': return Number(v) < Number(want);
    case 'le': return Number(v) <= Number(want);
    default: return true;
  }
}

export const elementVisible = (el, vars) => (el.when || []).every(c => condOk(c, vars));

/** Virtual-to-stage mapping. The game stretches 800x600 to the display; at
 *  a narrower aspect than 4:3 a uniform, letterboxed scale is used instead
 *  so the panels do not turn to slivers — the same rule `map.html` follows
 *  for the spawn screen. */
export function stageScale(width, height, virtual = [800, 600]) {
  const [vw, vh] = virtual;
  if (width / height < vw / vh) {
    const s = Math.min(width / vw, height / vh);
    return { sx: s, sy: s, ox: (width - vw * s) / 2, oy: (height - vh * s) / 2 };
  }
  return { sx: width / vw, sy: height / vh, ox: 0, oy: 0 };
}

/** Stage pixels back to virtual units, for hit-testing a pointer. */
export function toVirtual(s, px, py) {
  return [(px - s.ox) / s.sx, (py - s.oy) / s.sy];
}

export const inRect = (rect, x, y) =>
  x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3];

/** The state the screen's conditions read. The file's own defaults, with
 *  the player's two choices written over them under the names the layout
 *  uses: `Campaign/Team` for the TEAM list, and the difficulty variables
 *  left at their shipped values because this site runs no bots. */
export function menuVars(layout, state) {
  return { ...(layout.variables || {}), 'Campaign/Team': state.team };
}

/** The row the pointer is over in the list box, or -1. */
export function rowAt(layout, box, scroll, x, y) {
  const area = rowArea(layout, box);
  if (!inRect(area, x, y)) return -1;
  return scroll + Math.floor((y - area[1]) / box.rowHeight);
}

/** Keep `scroll` so that `index` is on screen, the way the arrows and the
 *  keyboard both need. */
export function scrollTo(layout, box, scroll, index, count) {
  const rows = visibleRows(layout, box);
  const max = Math.max(0, count - rows);
  let next = scroll;
  if (index < scroll) next = index;
  else if (index >= scroll + rows) next = index - rows + 1;
  return Math.min(max, Math.max(0, next));
}

/** The scroll thumb in the track, as a fraction of it: the share of the
 *  list on screen, offset by how far down it is. The reference shows a
 *  thumb about half the track tall, which is 11 rows of 23. */
export function thumbSpan(layout, box, scroll, count) {
  const rows = visibleRows(layout, box);
  if (count <= rows) return null;
  const size = Math.max(0.08, rows / count);
  const offset = (scroll / (count - rows)) * (1 - size);
  return [offset, size];
}

const rgb = c => `rgb(${c.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`;

/** Width of a string in a bitmap face, by the `.dif` metrics: each glyph
 *  advances the pen by left + width + right. */
export function measureText(font, text) {
  let w = 0;
  for (const ch of text) {
    const g = font.meta.glyphs[ch.charCodeAt(0)];
    if (g) w += g[0] + g[1] + g[2];
  }
  return w;
}

/** One line of bitmap text, its top at `y`. The atlas is white with the
 *  coverage as alpha, so a tinted copy is made per colour — `tint(font,
 *  rgbTriple)` returns it. */
export function drawBitmapText(ctx, font, tint, text, x, y, color) {
  const atlas = tint(font, color.slice(0, 3));
  if (!atlas) return;
  const base = font.meta.baseline;
  let pen = x;
  for (const ch of text) {
    const g = font.meta.glyphs[ch.charCodeAt(0)];
    if (!g) continue;
    const [left, width, right, ascent, x0, y0, x1, y1] = g;
    // The space glyph's rectangle is an opaque corner texel; it only
    // advances the pen.
    if (ch !== ' ' && width > 0 && y1 > y0) {
      ctx.drawImage(atlas, x0, y0, x1 - x0, y1 - y0,
                    pen + left, y + base - ascent, x1 - x0, y1 - y0);
    }
    pen += left + width + right;
  }
}

/**
 * Paint the whole screen.
 *
 * `env` supplies what the module will not reach for itself:
 *   texture(name)  -> an image, or null
 *   font(id)       -> {meta, img}, or null
 *   tint(font,rgb) -> the atlas in that colour
 *   level          -> the selected level record from menu-levels.json
 *   levels         -> every level record, in list order
 *   hover          -> {kind, index} under the pointer, or null
 */
export function paintMenu(ctx, layout, state, env) {
  const vars = menuVars(layout, state);
  for (const page of ['background', 'skirmish', 'navigation']) {
    for (const el of layout.pages[page]?.elements || []) {
      if (!elementVisible(el, vars)) continue;
      paintElement(ctx, el, layout, state, env);
    }
  }
  paintPreviewFlags(ctx, layout, state, env);
  paintRows(ctx, layout, state, env);
  ctx.globalAlpha = 1;
}

function paintElement(ctx, el, layout, state, env) {
  const [x, y, w, h] = el.rect;
  const color = el.color || [1, 1, 1, 1];
  ctx.globalAlpha = color[3];
  switch (el.kind) {
    case 'fill':
      ctx.fillStyle = rgb(color);
      ctx.fillRect(x, y, w, h);
      break;
    case 'picture': {
      // The preview slot is a VariablePictureNode: the engine swaps the
      // selected level's own menu thumbnail into it.
      const name = el.var === 'Skirmish/SkirmishMap' ? null : el.texture;
      const img = name ? env.texture(name) : env.thumbnail(state.level);
      if (!img) break;
      ctx.imageSmoothingEnabled = !(img.width <= 16 && img.height <= 16);
      ctx.drawImage(img, x, y, w, h);
      break;
    }
    case 'button': {
      // MEME-7: a button plate draws at its texture's own size; the node's
      // Width/Height is the pointer region, not a scale.
      const over = env.hover?.kind === 'button' && env.hover.rect === el.rect;
      const img = env.texture(over ? el.hover : el.texture);
      if (!img) break;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, x, y, img.width, img.height);
      break;
    }
    case 'text': {
      const font = env.font(el.font);
      if (!font) break;
      const text = el.text || '';
      const width = measureText(font, text);
      const tx = el.align === 'center' ? x + (w - width) / 2
        : el.align === 'right' ? x + w - width : x;
      ctx.imageSmoothingEnabled = false;
      drawBitmapText(ctx, font, env.tint, text, Math.round(tx), y, color);
      break;
    }
    case 'listbox':
    case 'hit':
    default:
      break;
  }
}

/** The two nation flags over the preview. Not in the layout: their
 *  rectangle is `previewFlags`, which `extract_menu_layout.py` marks
 *  `fromCapture`. Allied left, Axis right, as the reference shows. */
function paintPreviewFlags(ctx, layout, state, env) {
  const slots = layout.previewFlags;
  const level = state.level;
  if (!slots || !level) return;
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;
  for (const side of ['allied', 'axis']) {
    const flag = level[side]?.flag;
    const img = flag && env.texture(flag);
    if (!img) continue;
    const [x, y, w, h] = slots[side];
    ctx.drawImage(img, x, y, w, h);
  }
}

/** The level titles inside the list box.
 *
 *  The rows are the one part of this screen that is not in the file: the
 *  engine fills `Skirmish/SkirmishLevelsList` at runtime from the level
 *  archives. They are drawn here in the box's own font at its own row
 *  height, with the selected row filled in the box's own "Select color".
 */
function paintRows(ctx, layout, state, env) {
  const box = listBox(layout);
  if (!box) return;
  const font = env.font(box.font);
  const [bx, by, width] = rowArea(layout, box);
  const rows = visibleRows(layout, box);
  const levels = env.levels;
  for (let i = 0; i < rows; i++) {
    const index = state.scroll + i;
    const level = levels[index];
    if (!level) break;
    const y = by + i * box.rowHeight;
    if (index === state.index) {
      ctx.globalAlpha = box.select[3];
      ctx.fillStyle = rgb(box.select);
      ctx.fillRect(bx, y, width, box.rowHeight);
    } else if (env.hover?.kind === 'row' && env.hover.index === index) {
      ctx.globalAlpha = box.select[3] * 0.4;
      ctx.fillStyle = rgb(box.select);
      ctx.fillRect(bx, y, width, box.rowHeight);
    }
    if (!font) continue;
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    // The rows are indented off the box's left edge by the inset the box
    // carries for its scrollbar.
    drawBitmapText(ctx, font, env.tint, level.title,
                   Math.round(bx + box.scrollbarOffset), y + 1, [0.78, 0.78, 0.78]);
  }
  paintThumb(ctx, layout, box, state, levels.length);
}

/** The scroll track: the black 0.8-alpha quad beside the list box. */
export function trackRect(layout) {
  const page = layout.pages.skirmish?.elements || [];
  const box = listBox(layout);
  if (!box) return null;
  const [bx, , bw] = box.rect;
  for (const el of page) {
    if (el.kind !== 'fill' || !el.color) continue;
    const [x, , w, h] = el.rect;
    if (h > 40 && w < 20 && x > bx && x < bx + bw) return el.rect;
  }
  return null;
}

function paintThumb(ctx, layout, box, state, count) {
  const track = trackRect(layout);
  const span = track && thumbSpan(layout, box, state.scroll, count);
  if (!span) return;
  const [tx, ty, tw, th] = track;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(tx, ty + span[0] * th, tw, span[1] * th);
}

export function listBox(layout) {
  for (const page of Object.values(layout.pages || {})) {
    for (const el of page.elements) if (el.kind === 'listbox') return el;
  }
  return null;
}

/** What the pointer is over, in virtual units: a list row, a TEAM row, a
 *  scroll arrow or the START button. */
export function hitTest(layout, state, x, y, count) {
  const box = listBox(layout);
  if (box && inRect(rowArea(layout, box), x, y)) {
    const index = rowAt(layout, box, state.scroll, x, y);
    if (index >= 0 && index < count) return { kind: 'row', index };
    return null;
  }
  for (const page of ['skirmish', 'navigation']) {
    for (const el of layout.pages[page]?.elements || []) {
      if (el.kind === 'hit' && el.sets?.some(s => s.var === 'Campaign/Team')
          && inRect(el.rect, x, y)) {
        return { kind: 'team', team: el.sets.find(s => s.var === 'Campaign/Team').value };
      }
      if (el.kind === 'button' && inRect(el.rect, x, y)) {
        if (el.calls?.includes('Skirmish/StartSkirmish')) {
          return { kind: 'button', action: 'start', rect: el.rect };
        }
        const scroll = el.texture.includes('upp') ? -1
          : el.texture.includes('ner') ? 1 : 0;
        if (scroll) return { kind: 'button', action: 'scroll', by: scroll, rect: el.rect };
      }
    }
  }
  return null;
}
