/**
 * BF1942 Navigation Grid Generator
 * 
 * Generates a walkability grid from terrain geometry, matching the server's
 * AIPathfinding::createMaps() → createAllSearchMaps() → floodLevelZeroMap()
 * pipeline. The .raw files the server produces at startup are NOT shipped in
 * level archives — this generator recreates them client-side from the same
 * inputs the server uses.
 * 
 * Cell encoding matches the .raw format convention:
 *   non-negative (>= 0) = walkable
 *   negative (< 0)       = blocked
 * 
 * Stage 1: single-level grid (level 0 only) with infantry parameters.
 */

/**
 * Build a navigation grid from the world collider.
 * 
 * @param {WorldCollider} collider - The world collider with heightfield, surfaceHeight, statics
 * @param {number} worldSize - The world map size in world units (from extras.worldSize)
 * @param {object} [options]
 * @param {number} [options.cellSize=64] - World units per cell
 * @param {number} [options.waterLevel] - Water level; falls back to collider.waterLevel
 * @param {number} [options.maxSlope=1.5] - Max rise/run between adjacent cells
 *   (a gradient, not a raw height difference: over a 64 m cell a 1 m drop is a
 *   1.6% grade, and comparing raw metres marks the whole map too steep)
 * @returns {{ grid: Int32Array, width: number, height: number, cellSize: number, worldSize: number }}
 */
export function buildNavGrid(collider, worldSize, { cellSize = 64, waterLevel, maxSlope = 1.5 } = {}) {
  const width = Math.ceil(worldSize / cellSize);
  const height = Math.ceil(worldSize / cellSize);
  const totalCells = width * height;
  const grid = new Int32Array(totalCells);

  const effectiveWater = Number.isFinite(waterLevel)
    ? waterLevel
    : (collider?.waterLevel ?? -Infinity);

  const halfCell = cellSize / 2;

  // --- Pass 1: sample terrain height and mark water-blocked cells ---
  const heights = new Float32Array(totalCells);

  for (let gz = 0; gz < height; gz++) {
    for (let gx = 0; gx < width; gx++) {
      const wx = gx * cellSize + halfCell;
      const wz = -(gz * cellSize + halfCell);
      const idx = gz * width + gx;

      const h = collider?.surfaceHeight
        ? collider.surfaceHeight(wx, wz)
        : NaN;

      heights[idx] = h;

      if (!Number.isFinite(h)) {
        grid[idx] = -2; // no terrain data
        continue;
      }

      if (h <= effectiveWater) {
        grid[idx] = -3; // underwater
        continue;
      }

      grid[idx] = 0; // tentatively walkable
    }
  }

  // --- Pass 2: slope check against 4-neighbors ---
  for (let gz = 0; gz < height; gz++) {
    for (let gx = 0; gx < width; gx++) {
      const idx = gz * width + gx;
      if (grid[idx] < 0) continue; // already blocked

      const h = heights[idx];
      if (!Number.isFinite(h)) continue;

      const neighbors = [
        gx > 0 ? heights[gz * width + (gx - 1)] : null,
        gx < width - 1 ? heights[gz * width + (gx + 1)] : null,
        gz > 0 ? heights[(gz - 1) * width + gx] : null,
        gz < height - 1 ? heights[(gz + 1) * width + gx] : null,
      ];

      for (const nh of neighbors) {
        if (nh === null) continue;
        if (!Number.isFinite(nh)) continue;
        // Rise over run, not raw rise: the cell is `cellSize` wide, so a
        // 1 m step is a 1/64 grade at the default size.
        if (Math.abs(h - nh) / cellSize > maxSlope) {
          grid[idx] = -4; // too steep
          break;
        }
      }
    }
  }

  // --- Pass 3: statics collision check ---
  if (collider?.statics) {
    const castDown = collider.statics.cast.bind(collider.statics);
    const hit = {
      t: 0, x: 0, y: 0, z: 0,
      nx: 0, ny: 1, nz: 0,
      dx: 0, dy: 0, dz: 0,
      material: 0, kind: '', owner: -1, triangle: -1,
    };

    for (let gz = 0; gz < height; gz++) {
      for (let gx = 0; gx < width; gx++) {
        const idx = gz * width + gx;
        if (grid[idx] < 0) continue; // already blocked

        const h = heights[idx];
        if (!Number.isFinite(h)) continue;

        // Cast upward from above the terrain to detect overhead obstructions
        // (building interiors, arches, etc.)
        const probeY = h + 2.0; // 2m above ground — infantry head height
        const probeDist = 3.0;  // 3m clearance check

        const hitResult = castDown(
          gx * cellSize + halfCell,
          probeY,
          -(gz * cellSize + halfCell),
          0, 1, 0, // upward
          probeDist,
          -1, hit
        );

        if (hitResult && hitResult.t < probeDist) {
          // Something solid above the ground within clearance — blocked
          grid[idx] = -5; // obstructed
        }
      }
    }
  }

  return { grid, width, height, cellSize, worldSize };
}

/**
 * Get the cell value at world coordinates (x, z).
 * 
 * @param {{ grid: Int32Array, width: number, height: number, cellSize: number, worldSize: number }} navGrid
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {number} Cell value (non-negative = walkable, negative = blocked)
 */
export function gridAt(navGrid, x, z) {
  const { grid, width, height, cellSize, worldSize } = navGrid;

  const gx = Math.floor(x / cellSize);
  const gz = Math.floor(-z / cellSize);

  if (gx < 0 || gx >= width || gz < 0 || gz >= height) {
    return -1; // out of bounds
  }

  return grid[gz * width + gx];
}

/**
 * Check if a world position is walkable.
 * 
 * @param {{ grid: Int32Array, width: number, height: number, cellSize: number, worldSize: number }} navGrid
 * @param {number} x - World X coordinate
 * @param {number} z - World Z coordinate
 * @returns {boolean}
 */
export function isWalkable(navGrid, x, z) {
  return gridAt(navGrid, x, z) >= 0;
}

/**
 * Find a path between two world positions using A*.
 * 
 * Returns an array of [x, z] waypoints in world coordinates, or null if no
 * path exists. The path includes the start and end points.
 * 
 * @param {{ grid: Int32Array, width: number, height: number, cellSize: number, worldSize: number }} navGrid
 * @param {number} fromX - Start world X
 * @param {number} fromZ - Start world Z
 * @param {number} toX - End world X
 * @param {number} toZ - End world Z
 * @returns {Array<[number, number]>|null} Array of [x, z] waypoints
 */
export function findPath(navGrid, fromX, fromZ, toX, toZ) {
  const { grid, width, height, cellSize } = navGrid;

  const startGx = Math.floor(fromX / cellSize);
  const startGz = Math.floor(-fromZ / cellSize);
  const endGx = Math.floor(toX / cellSize);
  const endGz = Math.floor(-toZ / cellSize);

  // Clamp to grid
  let sgx = Math.max(0, Math.min(width - 1, startGx));
  let sgz = Math.max(0, Math.min(height - 1, startGz));
  let egx = Math.max(0, Math.min(width - 1, endGx));
  let egz = Math.max(0, Math.min(height - 1, endGz));

  // A body can end up in a cell the grid marks blocked (a spawn at a slope or
  // water edge, a pushed-out step). Snap the endpoint to the nearest walkable
  // cell rather than failing the whole query, which is what left bots with no
  // path and walking straight into obstacles.
  if (grid[sgz * width + sgx] < 0) {
    const s = nearestWalkable(grid, width, height, sgx, sgz);
    if (!s) return null;
    [sgx, sgz] = s;
  }
  if (grid[egz * width + egx] < 0) {
    const e = nearestWalkable(grid, width, height, egx, egz);
    if (!e) return null;
    [egx, egz] = e;
  }

  // Start == end
  if (sgx === egx && sgz === egz) {
    return [[fromX, fromZ]];
  }

  // Validate endpoints
  if (grid[sgz * width + sgx] < 0 || grid[egz * width + egx] < 0) {
    return null;
  }

  // A* with 8-directional movement
  const totalCells = width * height;
  const gScore = new Float32Array(totalCells).fill(Infinity);
  const fScore = new Float32Array(totalCells).fill(Infinity);
  const cameFrom = new Int32Array(totalCells).fill(-1);
  const openSet = new Uint8Array(totalCells); // 0 = closed, 1 = open

  const startIdx = sgz * width + sgx;
  const endIdx = egz * width + egx;

  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(sgx, sgz, egx, egz);
  openSet[startIdx] = 1;

  // Simple priority queue using a sorted array (fine for nav grid sizes)
  const pq = [{ idx: startIdx, f: fScore[startIdx] }];

  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],       // cardinal
    [1, 1], [1, -1], [-1, 1], [-1, -1],      // diagonal
  ];

  while (pq.length > 0) {
    // Pop lowest f-score
    let bestIdx = 0;
    let bestF = pq[0].f;
    for (let i = 1; i < pq.length; i++) {
      if (pq[i].f < bestF) {
        bestF = pq[i].f;
        bestIdx = i;
      }
    }
    const current = pq.splice(bestIdx, 1)[0].idx;

    if (current === endIdx) {
      // Reconstruct path
      const path = [];
      let idx = endIdx;
      while (idx !== -1) {
        const gx = idx % width;
        const gz = (idx - gx) / width;
        // Convert grid coords back to world coords (cell center)
        const wx = gx * cellSize + cellSize / 2;
        const wz = -(gz * cellSize + cellSize / 2);
        path.push([wx, wz]);
        idx = cameFrom[idx];
      }
      path.reverse();

      // Replace endpoints with exact requested positions
      path[0] = [fromX, fromZ];
      path[path.length - 1] = [toX, toZ];

      return path;
    }

    openSet[current] = 0; // mark closed

    const cx = current % width;
    const cz = (current - cx) / width;
    const currentG = gScore[current];

    for (const [dx, dz] of dirs) {
      const nx = cx + dx;
      const nz = cz + dz;

      if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;

      const nIdx = nz * width + nx;
      if (grid[nIdx] < 0) continue; // blocked

      // Diagonal movement: check that we can actually pass between the two
      // cardinal neighbors (no cutting corners through walls)
      if (dx !== 0 && dz !== 0) {
        if (grid[cz * width + nx] < 0 || grid[nz * width + cx] < 0) {
          continue; // corner cutting blocked
        }
      }

      const moveCost = (dx !== 0 && dz !== 0) ? 1.414 : 1.0;
      const tentativeG = currentG + moveCost;

      if (tentativeG < gScore[nIdx]) {
        cameFrom[nIdx] = current;
        gScore[nIdx] = tentativeG;
        fScore[nIdx] = tentativeG + heuristic(nx, nz, egx, egz);

        if (!openSet[nIdx]) {
          openSet[nIdx] = 1;
          pq.push({ idx: nIdx, f: fScore[nIdx] });
        }
      }
    }
  }

  return null; // no path
}

/**
 * Octile distance heuristic for 8-directional grid.
 */
function heuristic(x1, z1, x2, z2) {
  const dx = Math.abs(x1 - x2);
  const dz = Math.abs(z1 - z2);
  return Math.min(dx, dz) * 1.414 + Math.abs(dx - dz);
}

/**
 * The nearest walkable cell to `(gx, gz)`, searched outward in square rings,
 * or null when none is within `radius` cells.
 */
function nearestWalkable(grid, width, height, gx, gz, radius = 8) {
  for (let r = 0; r <= radius; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = gx + dx;
        const z = gz + dz;
        if (x < 0 || x >= width || z < 0 || z >= height) continue;
        if (grid[z * width + x] >= 0) return [x, z];
      }
    }
  }
  return null;
}
