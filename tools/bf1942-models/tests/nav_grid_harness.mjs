// Pins `viewer/nav-grid.js`: the slope test is a gradient (rise/run), and a
// query whose endpoint sits in a blocked cell snaps to the nearest walkable
// one instead of failing. Both were live bugs — the raw-metre slope test marked
// every cell `-4` at the default 64 m size (a 1 m step is a 1/64 grade), and a
// blocked start cell returned no path at all, which is why bots walked straight
// into sandbags with an empty nav path.
//
// Run by `tests/test_nav_grid.py`. One JSON object on stdout.

import { buildNavGrid, findPath, gridAt } from './nav-grid.js';

// 256 m square, 64 m cells -> 4x4. Height rises 0.02 per metre of x, so a cell
// spans 1.28 m: more than 1.0 raw, far less than a 1.0 gradient. One cell
// (x 64..128, z -128..-64) has no terrain, the blocked-cell case.
const collider = {
  waterLevel: -Infinity,
  surfaceHeight(x, z) {
    if (x >= 64 && x < 128 && z <= -64 && z > -128) return NaN;
    return x * 0.02;
  },
};

const grid = buildNavGrid(collider, 256, { cellSize: 64, maxSlope: 1.0 });

const around = findPath(grid, 32, -32, 224, -224);
const fromBlocked = findPath(grid, 96, -96, 224, -224);

process.stdout.write(JSON.stringify({
  width: grid.width,
  height: grid.height,
  slopeWalkable: gridAt(grid, 32, -32) >= 0,
  slopeCellValue: gridAt(grid, 32, -32),
  blockedCell: gridAt(grid, 96, -96),
  pathAround: around ? around.length : null,
  snapFromBlocked: fromBlocked ? fromBlocked.length : null,
  startSnapped: fromBlocked ? fromBlocked[0] : null,
}));