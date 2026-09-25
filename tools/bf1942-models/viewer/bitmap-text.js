// The game's bitmap faces as a text renderer, shared by every screen that
// draws the menu's own type: the deploy screen (spawn-layout leaves) and the
// mission-briefing screen. Lifted from `deploy-screen.js`, which had the only
// copy; the glyph math is `bf42/font.py`'s reading of the `.dif` (pen advances
// by left + width + right, each glyph drawn `ascent` above the baseline).
//
// A font is `{ meta, img, tinted: Map }` — the atlas JSON's glyph table plus
// its white-alpha PNG. The atlas is white with the glyph as alpha, so a
// colour is a `source-in` tint made once per (font, colour).

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
  for (const ch of text) {
    const g = font.meta.glyphs[ch.charCodeAt(0)];
    if (g) { w += g[0] + g[1] + g[2]; n += 1; }
  }
  return w * scale + Math.max(0, n - 1) * tracking;
}

/** Text in a bitmap font at virtual (x, y), the line's top at y: each glyph
 *  drawn at `left` past the pen and `ascent` above the baseline, the pen
 *  advancing by left + width + right. `scale` sizes the glyphs (the menu
 *  scales faces; the briefing screen's title runs the 18 px face larger),
 *  `tracking` adds virtual px between glyphs, `align` centers/right-aligns
 *  the measured line on x, and `outline` paints a 1 px four-way copy in that
 *  colour under the fill — the game's read-over-anything text edge. */
export function drawBitmapText(ctx, font, text, x, y, {
  rgb = [1, 1, 1], scale = 1, tracking = 0, align = 'left', outline = null,
} = {}) {
  if (!font) return;
  if (align !== 'left') {
    const w = measureBitmapText(font, text, scale, tracking);
    if (align === 'center') x -= w / 2;
    else if (align === 'right') x -= w;
  }
  const paint = (atlas, ox, oy) => {
    let pen = x + ox;
    for (const ch of text) {
      const g = font.meta.glyphs[ch.charCodeAt(0)];
      if (!g) continue;
      const [left, width, right, ascent, x0, y0, x1, y1] = g;
      // The space glyph's rectangle is an opaque corner texel; it only
      // advances the pen.
      if (ch !== ' ' && width > 0 && y1 > y0) {
        ctx.drawImage(atlas, x0, y0, x1 - x0, y1 - y0,
                      pen + left * scale, y + (font.meta.baseline - ascent) * scale,
                      (x1 - x0) * scale, (y1 - y0) * scale);
      }
      pen += (left + width + right) * scale + tracking;
    }
  };
  if (outline) {
    paint(tintedAtlas(font, outline), 1, 0);
    paint(tintedAtlas(font, outline), -1, 0);
    paint(tintedAtlas(font, outline), 0, 1);
    paint(tintedAtlas(font, outline), 0, -1);
  }
  paint(tintedAtlas(font, rgb), 0, 0);
}
