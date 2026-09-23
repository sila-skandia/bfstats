/**
 * The in-game console's view: the wash it lays over the scene, the band's
 * height, the line layout and the game's own bitmap font, painted to a 2D
 * canvas. Split out of `console.js` (the model: parse, dispatch, history,
 * scrollback), which re-exports it. `paintConsole` reads the model through
 * `getLines` and `viewLines` and nothing else.
 */

/** The wash the console lays over the scene. `FUN_004649f0` — run by the
 *  show/hide setter `FUN_00464af0` every time the console is opened —
 *  loads `"texture/white.tga"`, builds the quad with alpha `0x3f000000`
 *  (0.5f) and blend mode 2, then immediately overrides both:
 *  `FUN_006084c0(quad, 1)` sets blend mode 1 and `FUN_006084e0(quad, 0x3f4ccccd)`
 *  sets alpha 0.8f. Mode 1 is `SetRenderState(D3DRS_SRCBLEND=0x13, 5)` /
 *  `(D3DRS_DESTBLEND=0x14, 6)` — SRCALPHA / INVSRCALPHA, ordinary alpha
 *  blending (`FUN_00608560` `0x006085e8`, `FUN_0045ff10`). The vertex colour
 *  is `(int)(alpha * 255.0f) << 24` (`0x006085b4`, the 255.0f at
 *  `0x008d1a70`), so the RGB comes from the white texture and the alpha from
 *  the quad: a flat white wash at 0.8. */
export const WASH = 'rgba(255, 255, 255, 0.8)';

/** Text colour. Not read out of the binary — the text object at
 *  `Setup+0x2d8 + 0x08` is drawn through its own vtable slot `+0x10` and its
 *  colour is set somewhere this pass did not reach. Black is what the user's
 *  reference capture shows. */
export const TEXT_COLOR = '#000000';

/** Left inset and first-line offset, straight out of the drawer:
 *  `0x00465078` pushes `0x40000000` (2.0f) as x, and the y of line `i` is
 *  `(lineHeight + 1) * i + 2` (`0x00465063`-`0x00465067`). The band is
 *  `(lineHeight + 1) * lineCount + 4` px (`0x00464fca`-`0x00464fce`). */
export const TEXT_X = 2;
export const TEXT_Y0 = 2;
export const LINE_GAP = 1;
export const BAND_PAD = 4;

// ----------------------------------------------------------------- the view

/**
 * The band's height in CSS pixels, by the drawer's own arithmetic:
 * `(lineHeight + 1) * lineCount + 4` (client `0x00464fca`-`0x00464fce`),
 * where `lineCount` is however many strings `getLines(20)` actually handed
 * back and `lineHeight` is what the text object reports for a line.
 *
 * At the user's capture resolution (2000x1124) with the installed
 * `Font.rfa` — a 256x256 atlas whose header `Height` is 20 — that is
 * 21 * 20 + 4 = 424 px, or 37.7% of the screen. The capture measures 442 px
 * (39.3%), i.e. a pitch of 22 rather than 21, so the text object's reported
 * height is one more than the font header's `Height`. `bandHeight` takes the
 * pitch it is given rather than deriving it, so the page can use the
 * measured 22 and the arithmetic stays the engine's.
 */
export function bandHeight(lineCount, lineHeight) {
  return (lineHeight + LINE_GAP) * lineCount + BAND_PAD;
}

/**
 * A `Font/BF1942.font` glyph table, as `extract_console_font.py` writes it.
 * `Font::buildQuads` (client `0x0065ce10`) advances by `width + betweenWidth`
 * per glyph, except a space, which draws nothing and advances `spaceWidth`.
 */
export class BitmapFont {
  constructor(meta, image) {
    this.meta = meta;
    this.image = image;
    this.tinted = new Map();
  }

  get height() { return this.meta.height; }

  glyph(code) {
    const row = this.meta.glyphs[String(code)];
    return row ? { x0: row[0], y: row[1], x1: row[2], width: row[3] } : null;
  }

  advance(code) {
    if (code === 0x20) return this.meta.spaceWidth;
    const g = this.glyph(code);
    return g ? g.width + this.meta.betweenWidth : 0;
  }

  measure(text) {
    let w = 0;
    for (const ch of String(text)) w += this.advance(ch.charCodeAt(0));
    return w;
  }
}

/**
 * Draw one console frame into a 2D context sized `width` x `height` CSS px.
 *
 * `font` may be a `BitmapFont` (the game's own glyphs) or null, in which case
 * the text falls back to the platform monospace face at the same pitch. The
 * geometry is the drawer's either way: full width, `bandHeight` tall, the
 * wash first, then line `i` at `x = 2`, `y = (pitch) * i + 2`.
 */
export function paintConsole(ctx, consoleModel, {
  width, height, font = null, pitch = null,
  wash = WASH, color = TEXT_COLOR,
} = {}) {
  const lines = consoleModel.getLines(consoleModel.viewLines);
  const lineHeight = font ? font.height : 20;
  const step = pitch === null ? lineHeight + LINE_GAP : pitch;
  const band = Math.min(height, step * lines.length + BAND_PAD);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, band);

  if (font && font.image) {
    const atlas = tintedAtlas(font, color);
    for (let i = 0; i < lines.length; i++) {
      drawBitmapLine(ctx, font, atlas, lines[i], TEXT_X, step * i + TEXT_Y0);
    }
  } else {
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    ctx.font = `${Math.round(lineHeight * 0.8)}px ui-monospace, "DejaVu Sans Mono", monospace`;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], TEXT_X, step * i + TEXT_Y0);
    }
  }
  return band;
}

/** The atlas ships white with the glyph in its alpha channel
 *  (`decode_alpha_tga`), so a colour is a `source-in` fill of a copy. */
function tintedAtlas(font, color) {
  let c = font.tinted.get(color);
  if (c) return c;
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc) return font.image;
  c = doc.createElement('canvas');
  c.width = font.image.width;
  c.height = font.image.height;
  const g = c.getContext('2d');
  g.drawImage(font.image, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  font.tinted.set(color, c);
  return c;
}

function drawBitmapLine(ctx, font, atlas, text, x, y) {
  let pen = x;
  for (const ch of String(text)) {
    const code = ch.charCodeAt(0);
    if (code === 0x20) { pen += font.meta.spaceWidth; continue; }
    const g = font.glyph(code);
    if (!g) continue;
    if (g.width > 0) {
      ctx.drawImage(atlas, g.x0, g.y, g.width, font.meta.height,
                    pen, y, g.width, font.meta.height);
    }
    pen += g.width + font.meta.betweenWidth;
  }
  return pen - x;
}

/** Load the atlas pair `extract_console_font.py` writes. Browser only;
 *  resolves to null if either half is missing, and the caller falls back to
 *  the platform monospace face. */
export async function loadConsoleFont(base = './fonts/bf1942') {
  try {
    const meta = await fetch(`${base}.json`).then(r => r.ok ? r.json() : null);
    if (!meta) return null;
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `${base}.png`;
    });
    return new BitmapFont(meta, image);
  } catch {
    return null;
  }
}
