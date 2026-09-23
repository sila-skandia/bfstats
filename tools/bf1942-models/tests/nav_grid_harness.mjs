// Pins `viewer/nav-grid.js`: the engine's metre bitmap. A gentle hill stays
// walkable and a 30 deg one does not; water deeper than 1.5 m is blocked; a
// 1 m sandbag wall is an obstacle while a 0.3 m kerb (under the 0.4 m clip)
// is not; the brush is the engine's plus, so a wall's footprint grows by one
// metre each way; a pier deck above the band over deep water is walkable; the
// flood from the seeds closes a walled yard; the 4-connected local search
// routes around the wall's end and the trace refuses to cross it. On a tank
// map (`Tank0`'s numbers), a drivable bridge over a channel joins the two
// banks: its deck is a surface whatever its winding, its ramps and deck
// within 2.5 m of the bank are not walls, the abutments and the pier under
// the deck draw nothing, and a collision face of material 99 draws no
// outline.
//
// Run by `tests/test_nav_grid.py`. One JSON object on stdout.

import {
  buildNavMap, findPath, findLocalPath, gridAt, traceClear, traceValidPoint, brushOffsets,
  CELL_FREE, CELL_WATER, CELL_SLOPE, CELL_OBJECT, CELL_UNREACHABLE,
} from './nav-grid.js';

function box(x0, x1, y0, y1, z0, z1) {
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
             [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const q = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]];
  const out = [];
  for (const [a, b, c, d] of q) out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
  return out;
}

// 128 m world. Terrain: flat at 0, except a 10% grade for x in [10, 30] (a
// 5.7 deg hill), a 45 deg ridge for x in [40, 50] (too steep, and it cuts
// the map in two), and a lake 3 m deep for z in [-20, -10] at x >= 60 with a
// bank that shelves over 8 m.
const collider = {
  waterLevel: 0,
  heightfield: {
    height(x, z) {
      if (x >= 60 && z <= -10 && z >= -20) return -3 * Math.min(1, (x - 60) / 8);
      if (x >= 10 && x < 30) return (x - 10) * 0.1;
      if (x >= 40 && x < 45) return (x - 40) * 1.0;
      if (x >= 45 && x < 50) return 5 - (x - 45) * 1.0;
      return 0;
    },
  },
  surfaceHeight(x, z) { return Math.max(this.heightfield.height(x, z), 0); },
  statics: null,
};

// Statics: a sandbag wall (1 m) at z = -60, x in [70, 100]; a kerb (0.3 m);
// a walled yard with no door (x 100..110, z -100..-90, walls 2 m); a pier
// deck half a metre above the water out over the lake (x 60..70, z -15..-12).
const tris = new Float32Array([
  ...box(70, 100, 0, 1, -60.3, -59.7),
  ...box(80, 82, 0, 0.3, -70, -69),
  ...box(100, 110, 0, 2, -100.3, -99.7),
  ...box(100, 110, 0, 2, -90.3, -89.7),
  ...box(100, 100.6, 0, 2, -100, -90),
  ...box(109.4, 110, 0, 2, -100, -90),
  ...box(60, 70, 0.4, 0.5, -15, -12),
]);
// One owner per object, as `buildCollisionIndex` hands out: the object's
// lowest vertex is the base its clip band sits on.
const owners = new Int32Array(tris.length / 9);
[0, 1, 2, 2, 2, 2, 3].forEach((owner, i) => owners.fill(owner, i * 12, i * 12 + 12));
collider.statics = { tris, count: tris.length / 9, drivable: null, owners };

// Seeds on both sides of the 45 deg band, which no flood crosses.
const nav = buildNavMap(collider, 128, { seeds: [[75, -30], [20, -40]] });

const plus = brushOffsets(1.0);
const around = findLocalPath(nav, 85, -50, 85, -70, { radius: 24 });
const whole = findPath(nav, 75, -20, 85, -70);

// Both ends buried in an 8-cell disc: each is moved out to open paint, and
// the search box must be sized around where they land. Sized before, a
// start moved out of the box aliased another cell and the walk-back looped
// until the array overflowed ('Invalid array length').
const W = 64;
const discBlocked = new Uint8Array(W * W);
for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) if (Math.hypot(x - 32, z - 32) <= 8) discBlocked[z * W + x] = 1;
const disc = { width: W, height: W, cellSize: 1, blocked: discBlocked,
               heights: new Float32Array(W * W), normalY: new Float32Array(W * W).fill(1) };
const buried = [2, 20].map(radius => {
  try {
    const p = findLocalPath(disc, 32.5, -32.5, 35.5, -32.5, { radius });
    return p ? p.length : null;
  } catch (e) {
    return `throws: ${e.message}`;
  }
});

// --- a bridge over a channel, on the tank map --------------------------------
// 128 m world, water at 0. Banks at 2 m; a channel for x in [50, 78], its bed
// 4 m under the water, with 56 deg sides for x in [46, 50] and [78, 82] (the
// slope test blocks them). A drivable stone bridge along x at z in [-66, -54]:
// a deck 0.4 m thick at 2.8..3.2 m from x 44 to 84 (1.2 m over the banks, so
// inside the tank map's 0.3..2.5 m band above the terrain), ramps from the
// banks (x 38..44 and 84..90) up to it, parapets 1 m high along both edges,
// abutments on the channel's sides and a pier mid-channel, all under the
// deck. The deck, ramps and parapets are wound face-down, as most of a real
// level's collision faces are (Bocage: 5,934 of 8,267 flat faces).
const TANK_MAP = { waterDepth: 0, maxSlopeDeg: 25, brush: 3.0, lowClip: 0.3, hiClip: 2.5 };
function channelHeight(x) {
  if (x < 46) return 2;
  if (x < 50) return 2 - (x - 46) * 1.5;
  if (x < 78) return -4;
  if (x < 82) return -4 + (x - 78) * 1.5;
  return 2;
}
function ramp(x0, x1, y0, y1, z0, z1) {
  // One sloped quad, wound face-up.
  return [x0, y0, z1, x1, y1, z0, x0, y0, z0, x0, y0, z1, x1, y1, z1, x1, y1, z0];
}
function flip(arr) {
  const out = arr.slice();
  for (let o = 0; o < out.length; o += 9) {
    for (let k = 0; k < 3; k++) [out[o + 3 + k], out[o + 6 + k]] = [out[o + 6 + k], out[o + 3 + k]];
  }
  return out;
}
const bridgeParts = [
  flip(ramp(44, 84, 3.2, 3.2, -66, -54)),             // the deck
  ramp(44, 84, 2.8, 2.8, -66, -54),                   // its underside
  flip(ramp(38, 44, 2.0, 3.2, -66, -54)),             // the west ramp
  flip(ramp(90, 84, 2.0, 3.2, -66, -54)),             // the east ramp
  flip(box(38, 90, 3.2, 4.2, -66, -65.6)),            // the parapets
  flip(box(38, 90, 3.2, 4.2, -54.4, -54)),
  box(46.2, 49.8, -4, 2.8, -66, -54),                  // the abutments
  box(78.2, 81.8, -4, 2.8, -66, -54),
  box(63, 65, -4, 2.8, -66, -54),                      // the pier
];
// Two 2 m walls on the west bank, one of material 99 (no outline) and one not.
const wallNo = box(10, 30, 2, 4, -100.3, -99.7);
const wallYes = box(10, 30, 2, 4, -110.3, -109.7);
const btris = new Float32Array([...bridgeParts.flat(), ...wallNo, ...wallYes]);
const bcount = btris.length / 9;
const bridgeTris = bridgeParts.flat().length / 9;
const bowners = new Int32Array(bcount);
bowners.fill(1, bridgeTris, bridgeTris + 12);
bowners.fill(2, bridgeTris + 12);
const bdrivable = new Uint8Array(bcount);
bdrivable.fill(1, 0, bridgeTris);
const bmaterials = new Uint16Array(bcount);
bmaterials.fill(99, bridgeTris, bridgeTris + 12);
const channel = {
  waterLevel: 0,
  heightfield: { height: (x, z) => channelHeight(x) },
  surfaceHeight(x, z) { return Math.max(channelHeight(x), 0); },
  statics: { tris: btris, count: bcount, drivable: bdrivable, owners: bowners, materials: bmaterials },
};
const bridgeSeeds = [[20, -40], [110, -40]];
const tank = buildNavMap(channel, 128, { ...TANK_MAP, seeds: bridgeSeeds });
// The same bridge with the drivable mask off: the old reading's failure.
const plain = buildNavMap({ ...channel, statics: { ...channel.statics, drivable: null } }, 128,
                          { ...TANK_MAP, seeds: bridgeSeeds });
const across = findPath(tank, 20, -60, 110, -60);
const acrossPlain = findPath(plain, 20, -60, 110, -60);
const bridge = {
  channel: gridAt(tank, 64, -30),
  bank: gridAt(tank, 20, -60),
  ramp: gridAt(tank, 40, -60),
  deckOverBank: gridAt(tank, 45, -60),
  abutment: gridAt(tank, 48, -60),
  deck: gridAt(tank, 60, -60),
  overPier: gridAt(tank, 64, -60),
  farBank: gridAt(tank, 110, -60),
  parapetOverBank: gridAt(tank, 42, -65.8),
  deckEdgeOverWater: gridAt(tank, 60, -65),
  across: across ? across.length : null,
  acrossEndsAtGoal: across
    ? Math.hypot(across[across.length - 1][0] - 110, across[across.length - 1][1] + 60) < 1e-6
    : null,
  deckLineClear: traceClear(tank, 30, -60, 100, -60),
  channelLineClear: traceClear(tank, 30, -30, 100, -30),
  acrossPlain: acrossPlain ? acrossPlain.length : null,
  noOutlineWall: gridAt(tank, 20, -100),
  outlineWall: gridAt(tank, 20, -110),
};

process.stdout.write(JSON.stringify({
  bridge,
  width: nav.width,
  height: nav.height,
  cellSize: nav.cellSize,
  brushCells: plus.length,
  brushHasCorner: plus.some(([dx, dz]) => dx !== 0 && dz !== 0),
  gentleHill: gridAt(nav, 20, -40),
  steepHill: gridAt(nav, 45, -40),
  lake: gridAt(nav, 90, -15),
  wall: gridAt(nav, 85, -60),
  wallBrush: gridAt(nav, 85, -61.5),
  besideWall: gridAt(nav, 85, -63.5),
  kerb: gridAt(nav, 81, -69.5),
  yardInside: gridAt(nav, 105, -95),
  pierDeck: gridAt(nav, 68, -13.5),
  traceThroughWall: traceClear(nav, 85, -50, 85, -70),
  // `traceValidPoint`: a free start is itself; a start inside the wall is
  // pushed along the line to the first free cell past the brush.
  validFromFree: traceValidPoint(nav, 85, -50, 85, -70),
  validFromWall: traceValidPoint(nav, 85, -60, 85, -70),
  validAllBlocked: traceValidPoint(nav, 85, -60, 85, -61),
  traceClear: traceClear(nav, 20, -50, 20, -70),
  pathAround: around ? around.length : null,
  pathAroundClearsWall: around
    ? around.every(([x, z]) => !(Math.abs(z + 60) < 1.6 && x > 69 && x < 101))
    : null,
  pathAroundEndsAtGoal: around
    ? Math.hypot(around[around.length - 1][0] - 85, around[around.length - 1][1] + 70) < 1e-6
    : null,
  wholePath: whole ? whole.length : null,
  buried,
  codes: { CELL_FREE, CELL_WATER, CELL_SLOPE, CELL_OBJECT, CELL_UNREACHABLE },
}));
