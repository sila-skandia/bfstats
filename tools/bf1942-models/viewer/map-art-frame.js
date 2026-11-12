/* The open map's framing of a level's map art: the part of `InGameMap` that is
 * a map, and the square window of art the deploy screen and the M map show so
 * that part fills the pane, centred.
 *
 * Some levels' art is not a map edge to edge. FHSW's Tunis 1943 ships a
 * 512x512 `ingamemap.dds` whose upper half is solid black: its artists drew
 * the playable ground (columns A-H, rows 5-8 of the world's 8x8 grid) into the
 * lower half and left rows 1-4 out of the picture, under a combat area of the
 * whole 1024 m world (`game.setActiveCombatArea 0 0 1024 1024`). Retail draws
 * the texture whole into the spawn map's square (MEME-13, the 512x512 rect),
 * so the screen shows a black band over a map that hangs off the pane's
 * bottom edge; `features/authentic-spawn-map` section 19 has the census of
 * every exported level that carries such a margin.
 *
 * INVENTION (DELIBERATE, keep): the open map is framed on the art's content instead. The black
 * margin is trimmed, and the window is the content's longer side, square,
 * centred on the content, so a band-shaped map sits in the middle of the pane
 * with the dim backdrop above and below it, and a map drawn small in a corner
 * fills the pane. Retail was not seen doing this; the owner asked for the
 * map centred and whole (2026-11-11). The HUD widget keeps the engine's own
 * window and clamp (`bfmap.js`, MMAP-6): it is a moving window on the art in
 * retail, not a picture of the whole map.
 *
 * Pure and DOM-free so `tests/map_art_frame_harness.mjs` runs it under node.
 */

/** A channel value at or under this reads as black: the margin is authored
 *  as 0,0,0, and DXT1 blocks that touch the map's edge leave a few levels of
 *  noise in it. */
export const MARGIN_BLACK = 12;

/** A row or column is margin when at least this share of its pixels is
 *  black. Not 1: a stray DXT block or a grid line drawn a pixel too far must
 *  not make a line count as map. */
export const MARGIN_SHARE = 0.99;

/** Below this much of the art trimmed (as a fraction of a side) the frame is
 *  left whole: a sliver of black along an edge (a DXT block row, a grid line's
 *  shadow) is part of a map drawn edge to edge, not a margin, and leaving
 *  those levels exactly as they were drawn is worth more than a few texels. */
export const MIN_TRIM = 1 / 32;

/**
 * The bounding box of the art's map content, in art fractions (0..1 from the
 * top left): `{ u0, v0, u1, v1 }`. `rgba` is the decoded image (`ImageData`'s
 * `data`, four bytes a pixel), `w` x `h` pixels. Rows and columns that are
 * margin (`MARGIN_SHARE` black) are trimmed from each edge; nothing is
 * trimmed from the inside. Null when every line is margin (an art that is all
 * black, or failed to decode into zeros).
 */
export function artContentRect(rgba, w, h, { black = MARGIN_BLACK, share = MARGIN_SHARE } = {}) {
  if (!rgba || !(w > 0) || !(h > 0) || rgba.length < w * h * 4) return null;
  const rowDark = new Uint32Array(h);
  const colDark = new Uint32Array(w);
  for (let y = 0; y < h; y++) {
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      if (rgba[i] <= black && rgba[i + 1] <= black && rgba[i + 2] <= black) {
        rowDark[y]++;
        colDark[x]++;
      }
    }
  }
  const isMargin = (count, n) => count / n >= share;
  let top = 0;
  while (top < h && isMargin(rowDark[top], w)) top++;
  if (top === h) return null;
  let bottom = h;
  while (bottom > top && isMargin(rowDark[bottom - 1], w)) bottom--;
  let left = 0;
  while (left < w && isMargin(colDark[left], h)) left++;
  let right = w;
  while (right > left && isMargin(colDark[right - 1], h)) right--;
  return { u0: left / w, v0: top / h, u1: right / w, v1: bottom / h };
}

/** The whole art, the window retail's open map shows. */
export const WHOLE_ART = Object.freeze({ u0: 0, v0: 0, span: 1 });

/**
 * The square window of art (`{ u0, v0, span }`, art fractions) the open map
 * shows for a content rect: the content's longer side, centred on it. The
 * window may hang past the art (Tunis: `v0` -0.25 for a content rect of the
 * lower half), and the surface paints the backdrop there, not another copy of
 * the art. A null rect, or one that trims less than `MIN_TRIM` off every
 * edge, is the whole art.
 */
export function fullMapWindow(rect, minTrim = MIN_TRIM) {
  if (!rect) return WHOLE_ART;
  const { u0, v0, u1, v1 } = rect;
  if (!(u1 > u0) || !(v1 > v0)) return WHOLE_ART;
  if (u0 < minTrim && v0 < minTrim && 1 - u1 < minTrim && 1 - v1 < minTrim) return WHOLE_ART;
  const span = Math.max(u1 - u0, v1 - v0);
  return { u0: (u0 + u1) / 2 - span / 2, v0: (v0 + v1) / 2 - span / 2, span };
}

/** A point of the open map's surface, as fractions of its box (`fx`, `fy`
 *  in 0..1 from the top left), to art coordinates under `win`. */
export function surfaceToArt(fx, fy, win = WHOLE_ART) {
  return { u: win.u0 + fx * win.span, v: win.v0 + fy * win.span };
}

/** An art point to fractions of the open map's box under `win`: the inverse
 *  of `surfaceToArt`. */
export function artToSurface(u, v, win = WHOLE_ART) {
  return { fx: (u - win.u0) / win.span, fy: (v - win.v0) / win.span };
}
