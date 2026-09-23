// Pins `viewer/nav-grid.js`: the engine's metre bitmap. A gentle hill stays
// walkable and a 30 deg one does not; water deeper than 1.5 m is blocked; a
// 1 m sandbag wall is an obstacle while a 0.3 m kerb (under the 0.4 m clip)
// is not; the brush is the engine's plus, so a wall's footprint grows by one
// metre each way; a pier deck above the band over deep water is walkable; the
// flood from the seeds closes a walled yard; the 4-connected local search
// routes around the wall's end and the trace refuses to cross it.
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

process.stdout.write(JSON.stringify({
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
  codes: { CELL_FREE, CELL_WATER, CELL_SLOPE, CELL_OBJECT, CELL_UNREACHABLE },
}));
