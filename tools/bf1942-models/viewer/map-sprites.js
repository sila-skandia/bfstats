// The map surfaces' sprite painter: a HUD-pack sprite drawn centred, turned,
// faded and — for the unit icons — modulated by the side's colour, with the
// tinted copies memoised here. Built by `map-surfaces.js`, which hands in the
// one thing it reads of the page: `sprite(name)`, the pack's image lookup.

export function createMapSprites(page) {
  /** A pack sprite modulated by a colour, the way the engine draws its unit
   *  icons: `out = src * tint`, so white becomes the tint outright, the black
   *  outline stays black, and the grey antialiasing lands in between. Alpha is
   *  untouched.
   *
   *  Memoised per (sprite, colour). There are two colours and a handful of
   *  icons, so the cache is a dozen 16x16 canvases at most, built once —
   *  tinting per marker per frame would be a `getImageData` on the frame path,
   *  which is the one thing the map surfaces are careful not to do
   *  (features/mesh-viewer-performance, rule 7). */
  const tintedSprites = new Map();
  function tintedSprite(name, rgb) {
    const key = `${name}|${rgb}`;
    const cached = tintedSprites.get(key);
    if (cached !== undefined) return cached;
    const img = page.sprite(name);
    // Not cached as a miss: the pack is still landing and the next frame may
    // have it.
    if (!img) return null;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (!px[i + 3]) continue;
      px[i] = (px[i] * rgb[0]) / 255;
      px[i + 1] = (px[i + 1] * rgb[1]) / 255;
      px[i + 2] = (px[i + 2] * rgb[2]) / 255;
    }
    ctx.putImageData(data, 0, 0);
    tintedSprites.set(key, c);
    return c;
  }

  /** Draw a sprite centred on (x, y) at `sc` times its own pixels. Returns
   *  false when the pack has not delivered it yet, so callers can fall back.
   *  `tint` modulates it by a colour first (`tintedSprite`). */
  function drawSprite(ctx, name, x, y, sc, { angle = 0, alpha = 1, tint = null } = {}) {
    const img = tint ? tintedSprite(name, tint) : page.sprite(name);
    if (!img) return false;
    const w = img.width * sc;
    const h = img.height * sc;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (angle) ctx.rotate(angle);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    ctx.restore();
    return true;
  }

  return { tintedSprite, drawSprite };
}
