// The game's bitmap faces as a text renderer, shared by every screen that
// draws the menu's own type: the deploy screen (spawn-layout leaves) and the
// mission-briefing screen. Lifted from `deploy-screen.js`, which had the only
// copy; the glyph math is `bf42/font.py`'s reading of the `.dif` (pen advances
// by left + width + right, each glyph drawn `ascent` above the baseline).
//
// A font is `{ meta, img, tinted: Map }` — the atlas JSON's glyph table plus
// its white-alpha PNG. The atlas is white with the glyph as alpha, so a
// colour is a `source-in` tint made once per (font, colour).

//
// Retail does not draw these faces at the `.dif`'s own metrics on every
// screen (ledger FONT-3): `DifFont::setResolution` (client 0x0069ac00)
// rescales each glyph's left, width, right, ascent and height for the exact
// `game.setGameDisplayMode` width, `m' = roundHalfUp(m * A) * B`, and leaves
// them native at 800, 1600 and every width it does not list. `glyphMetrics`
// is that table for the page's DISPLAY MODE; the quad is drawn at the
// rescaled width and height from the unscaled atlas rect (FONT-4). The list
// and the text field also snap each glyph to a device pixel (FONT-5),
// `snap` below.

import { chosenDisplayMode, displayOf, onVideoChange, storedVideo } from './video-settings.js';

/** Display width -> `[A, B]` (`0x0069a9f0`): A the floats at 0x00959f00..0c
 *  (0.95, 1.25, 1.5, 1.5), B the immediates 1.25, 0.78125, 0.694444
 *  (0x3f31c71c) and 0.625. 800 and 1600 are native, as is any width the
 *  client's index (`0x0069a170`) does not know. */
/** The immediate 0x3f31c71c (client 0x0069aa45): 1/1.44 as a float32. */
const B_1920 = 0.6944444179534912;
export const FONT_RESCALE = Object.freeze({
  640: [0.95, 1.25],
  1024: [1.25, 0.78125],
  1152: [1.5, B_1920],
  1280: [1.5, 0.625],
  1920: [1.5, B_1920],
  2048: [1.5, B_1920],
});

/** The client's round: `floor(x)` plus one when `fmod(x, 1) >= 0.5`
 *  (0x0069a7ac..0x0069a7d7). */
export function roundHalfUp(x) {
  const whole = Math.trunc(x);
  return whole + (x - whole >= 0.5 ? 1 : 0);
}

/** One metric at `[A, B]`. */
export const rescaleMetric = (m, [a, b]) => roundHalfUp(m * a) * b;

let displayWidthNow = null;

/** The width the faces are sized for: the chosen DISPLAY MODE's
 *  (`video-settings.js`), which is this page's `game.setGameDisplayMode`.
 *  Read once and again when the video settings change. 800 with no screen. */
export function displayWidth() {
  if (displayWidthNow === null) {
    let width = 800;
    try {
      const display = displayOf();
      const mode = display ? chosenDisplayMode(display, storedVideo(undefined, display).displayHeight) : null;
      if (mode?.width > 0) width = mode.width;
    } catch { /* no screen, no storage: native */ }
    displayWidthNow = width;
  }
  return displayWidthNow;
}

/** Size the faces for `width` (a test, or the console's
 *  `game.setGameDisplayMode`); null goes back to the DISPLAY MODE's. */
export function setDisplayWidth(width) {
  displayWidthNow = Number.isFinite(width) && width > 0 ? Math.round(width) : null;
}

try { onVideoChange(() => { displayWidthNow = null; }); } catch { /* no settings store */ }

const NATIVE = Object.freeze([1, 1]);
const rescaled = new WeakMap();   // meta.glyphs -> Map(width -> rows)

/**
 * A face's glyph rows for display width `width`: each `[left, width, right,
 * ascent, x0, y0, x1, y1, drawWidth, drawHeight]`, the first four rescaled
 * and the last two the quad's size (the rescaled width and height; a height
 * that rounds to 0 keeps the raw one). At a native width the rows are the
 * file's own with the atlas rect's size appended. Built once per (face,
 * width): a lookup a glyph after that.
 */
export function glyphTable(font, width = displayWidth()) {
  const glyphs = font?.meta?.glyphs;
  if (!glyphs) return null;
  let byWidth = rescaled.get(glyphs);
  if (!byWidth) rescaled.set(glyphs, byWidth = new Map());
  let table = byWidth.get(width);
  if (table) return table;
  const scale = FONT_RESCALE[width] ?? null;
  table = {};
  for (const code of Object.keys(glyphs)) {
    const g = glyphs[code];
    const [left, w, right, ascent, x0, y0, x1, y1] = g;
    const rawH = y1 - y0;
    if (!scale) {
      table[code] = [left, w, right, ascent, x0, y0, x1, y1, x1 - x0, rawH];
      continue;
    }
    const height = rescaleMetric(rawH, scale);
    table[code] = [rescaleMetric(left, scale), rescaleMetric(w, scale), rescaleMetric(right, scale),
                   rescaleMetric(ascent, scale), x0, y0, x1, y1,
                   // The quad is `width'` wide; the atlas rect is the file's
                   // width, so the picture stretches with the cell.
                   (x1 - x0) * (w > 0 ? rescaleMetric(w, scale) / w : 1),
                   height > 0 ? height : rawH];
  }
  byWidth.set(width, table);
  return table;
}

/** FONT-5's snap: `x` on the device pixel grid of a screen `width` wide,
 *  `roundHalfUp(x * s) / s` with `s = width / 800`; unchanged at 800. */
export function snapToPixel(x, width = displayWidth()) {
  const s = width / 800;
  return s === 1 ? x : roundHalfUp(x * s) / s;
}

/** The outline's copies: the eight 1-unit neighbours, drawn in the outline
 *  colour under the fill. This is the one text outline read on the client:
 *  the chat list's (`chatOutline`, list data +0x1E, on at 0x0045F190;
 *  `comms.js` `OUTLINE`). `BfOutlineStyle::onPaint` (Mac 0x00605750), for
 *  all its name, draws each glyph once: it only centres each line in the
 *  rect and steps 1.5 line heights. */
export const OUTLINE_COPIES = Object.freeze([
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
]);

/** The glyph atlas in one colour, made once per (font, colour). */
export function tintedAtlas(font, rgb) {
  const key = rgb.join(',');
  let c = font.tinted.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = font.img.width;
  c.height = font.img.height;
  const ctx = c.getContext('2d');
  ctx.drawImage(font.img, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = `rgb(${rgb.map(v => Math.round(v * 255)).join(',')})`;
  ctx.fillRect(0, 0, c.width, c.height);
  font.tinted.set(key, c);
  return c;
}

/** advance width of `text` at `scale`, with `tracking` virtual px added
 *  between glyphs. */
export function measureBitmapText(font, text, scale = 1, tracking = 0) {
  let w = 0;
  let n = 0;
  const table = glyphTable(font);
  for (const ch of text) {
    const g = table[ch.charCodeAt(0)];
    if (g) { w += g[0] + g[1] + g[2]; n += 1; }
  }
  return w * scale + Math.max(0, n - 1) * tracking;
}

/** Text in a bitmap font at virtual (x, y), the line's top at y: each glyph
 *  drawn at `left` past the pen and `ascent` above the baseline, the pen
 *  advancing by left + width + right. `scale` sizes the glyphs (the menu
 *  scales faces; the briefing screen's title runs the 18 px face larger),
 *  `tracking` adds virtual px between glyphs, `align` centers/right-aligns
 *  the measured line on x, and `outline` paints the eight 1 px neighbour
 *  copies in that colour under the fill (`OUTLINE_COPIES`). `snap`
 *  puts each glyph on a device pixel, as the game's list and text field do
 *  (FONT-5); the other draws leave it off, as retail's other styles do. */
export function drawBitmapText(ctx, font, text, x, y, {
  rgb = [1, 1, 1], scale = 1, tracking = 0, align = 'left', outline = null, snap = false,
} = {}) {
  if (!font) return;
  const table = glyphTable(font);
  if (align !== 'left') {
    const w = measureBitmapText(font, text, scale, tracking);
    if (align === 'center') x -= w / 2;
    else if (align === 'right') x -= w;
  }
  const paint = (atlas, ox, oy) => {
    // A face whose picture never arrived has an empty atlas: nothing to draw.
    if (!atlas.width || !atlas.height) return;
    let pen = x + ox;
    for (const ch of text) {
      const g = table[ch.charCodeAt(0)];
      if (!g) continue;
      const [left, width, right, ascent, x0, y0, x1, y1, drawW, drawH] = g;
      // The space glyph's rectangle is an opaque corner texel; it only
      // advances the pen.
      if (ch !== ' ' && width > 0 && y1 > y0) {
        const gx = pen + left * scale;
        const gy = y + oy + (font.meta.baseline - ascent) * scale;
        ctx.drawImage(atlas, x0, y0, x1 - x0, y1 - y0,
                      snap ? snapToPixel(gx) : gx, snap ? snapToPixel(gy) : gy,
                      drawW * scale, drawH * scale);
      }
      pen += (left + width + right) * scale + tracking;
    }
  };
  if (outline) {
    const edge = tintedAtlas(font, outline);
    for (const [ox, oy] of OUTLINE_COPIES) paint(edge, ox, oy);
  }
  paint(tintedAtlas(font, rgb), 0, 0);
}
