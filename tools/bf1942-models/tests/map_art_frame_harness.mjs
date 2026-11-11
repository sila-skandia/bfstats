// Drives `viewer/map-art-frame.js` outside a browser and prints one JSON blob.
//
// Same shape as `bfmap_harness.mjs`: `tests/test_map_art_frame.py` copies the
// viewer module in under its own name, so the file under test is the file the
// page loads, byte for byte. The module imports nothing.
//
// The arts are synthetic, laid out like the real ones the census found
// (`features/authentic-spawn-map` section 19): Tunis 1943's lower-half map
// under a black upper half, a map drawn edge to edge, a band in the middle, a
// map drawn small in a corner, an all-black art, and an edge-to-edge map with
// a one-texel black seam and a stray black DXT block.

import {
  artContentRect, fullMapWindow, surfaceToArt, artToSurface, WHOLE_ART,
  MARGIN_BLACK, MARGIN_SHARE, MIN_TRIM,
} from './map-art-frame.js';

/** A `w` x `h` RGBA art, black wherever `isMap(x, y)` is false, a sandy
 *  colour where it is true. */
function art(w, h, isMap) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const on = isMap(x, y);
      data[i] = on ? 196 : 0;
      data[i + 1] = on ? 170 : 0;
      data[i + 2] = on ? 120 : 0;
      data[i + 3] = 255;
    }
  }
  return data;
}

const W = 512;
const cases = {
  // Tunis 1943: rows 256..511 are map, 0..255 black, with a few dark specks
  // (DXT noise at 8) in the margin that must not count as map.
  tunis: art(W, W, (x, y) => y >= 256),
  // The common case: the map from edge to edge.
  full: art(W, W, () => true),
  // A band across the middle, a quarter tall.
  middleBand: art(W, W, (x, y) => y >= 192 && y < 320),
  // A map drawn in the top-left 256x192, black elsewhere.
  corner: art(W, W, (x, y) => x < 256 && y < 192),
  // A column band on the right: content wider than tall the other way.
  rightColumn: art(W, W, (x) => x >= 320),
  // Nothing but black.
  black: art(W, W, () => false),
  // Edge to edge, with a black top row (a DXT block row's seam) and one
  // black 4x4 block inside: a sliver, not a margin.
  seam: art(W, W, (x, y) => y > 0 && !(x >= 100 && x < 104 && y >= 100 && y < 104)),
};
// DXT noise in Tunis's margin: under the black threshold, so still margin.
for (let x = 0; x < W; x += 7) cases.tunis[(10 * W + x) * 4] = MARGIN_BLACK;
// One bright stray pixel per margin row on Tunis: under 1% of the row.
for (let y = 0; y < 256; y++) cases.tunis[(y * W + (y * 13) % W) * 4] = 255;

const results = { constants: { MARGIN_BLACK, MARGIN_SHARE, MIN_TRIM, WHOLE_ART } };
for (const [name, data] of Object.entries(cases)) {
  const rect = artContentRect(data, W, W);
  results[name] = { rect, window: fullMapWindow(rect) };
}

// A non-square art (none is exported today; the reader must not assume).
const wide = art(256, 128, (x, y) => y >= 64);
results.nonSquare = { rect: artContentRect(wide, 256, 128) };

// Bad input.
results.bad = {
  nullData: artContentRect(null, 4, 4),
  short: artContentRect(new Uint8ClampedArray(8), 4, 4),
  zeroSize: artContentRect(new Uint8ClampedArray(0), 0, 0),
  nullRect: fullMapWindow(null),
  emptyRect: fullMapWindow({ u0: 0.5, v0: 0.5, u1: 0.5, v1: 0.9 }),
};

// The surface <-> art round trip under Tunis's window: the box's centre is
// the content's centre, its top edge the window's top (above the art), and a
// point maps back to itself.
const tw = results.tunis.window;
results.mapping = {
  centre: surfaceToArt(0.5, 0.5, tw),
  topLeft: surfaceToArt(0, 0, tw),
  bottomRight: surfaceToArt(1, 1, tw),
  contentTop: artToSurface(0, 0.5, tw),
  contentBottom: artToSurface(1, 1, tw),
  roundTrip: artToSurface(...Object.values(surfaceToArt(0.3, 0.7, tw)), tw),
  wholeIdentity: surfaceToArt(0.25, 0.75),
};

process.stdout.write(JSON.stringify(results));
