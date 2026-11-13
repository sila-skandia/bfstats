// The terrain's detail by distance, and the sea bed nobody sees (ledger TERR-8).
//
// The client draws the ground in cells of 16 x 16 heightmap samples. Its
// visible-cell walk (0x00682ed0) does two things to each cell before it is
// drawn:
//
//   * skips it when the level has a water level other than 0 and the cell lies
//     wholly more than 10 m under it (0x006830e6..0x0068310b: the water
//     object's level, terrain +0x18 +0x1c, less the 10.0 at 0x008dbe18,
//     against the cell's +0x10);
//   * picks one of four vertex blocks for it by distance,
//     `int(3 * d^2 * fov / lodDistance^2)` clamped to 0..3
//     (0x00683190..0x006831e3, the 3.0 at 0x008eaf04), `d` from the camera to
//     the centre of the cell's sphere, `fov` the view's field of view in
//     radians (vt +0x18) and `lodDistance` the terrain template's +0xf4:
//     `GeometryTemplate.lodDistance` in the level's `Init/Terrain.con`
//     (handler 0x005d2e40), 1050 from the constructor (0x005b5d22) where the
//     level says nothing. Vanilla's levels say 350 to 500.
//
// The four blocks hold 289, 97, 33 and 13 vertices and 512, 144, 40 and 12
// triangles (the tables at 0x0091c6f8 and 0x0091c708, built by 0x00699320):
// the 16 x 16 grid and its 8 x 8, 4 x 4 and 2 x 2 thinnings, each with a few
// extra edge vertices. How the engine's coarse blocks meet a finer neighbour
// was not read, so a thinned cell here keeps every vertex of its border: the
// inside is thinned to the level's stride and a ring of triangles joins it to
// the full border. Any two cells then meet on the same vertices whatever
// their levels, at 512, 160, 80 and 64 triangles a cell.
//
// The bake's patches are whole multiples of a cell (64 samples, 4 x 4 cells).
// Nothing is re-baked: a patch's vertices stay as they are and only its index
// buffer is rebuilt, per mesh, when a cell changes level. The copies drawn
// past the world's edge (`level-edge.js`) share their source's vertices and
// get an index of their own, since each stands at its own distance.
import * as THREE from 'three';
import { viewFieldOfView } from './tree-foliage.js';

export const TERRAIN_LOD = Object.freeze({
  cellSamples: 16,          // 0x00681c05 `push 0x10`
  levels: 4,                // builders at terrain +0x104..+0x110
  scale: 3,                 // 0x008eaf04
  defaultLodDistance: 1050, // 0x44834000 at 0x005b5d22
  seaSkipDepth: 10,         // 0x008dbe18
});

/** The cell's detail level, 0 (every sample) to 3. */
export function terrainLodLevel(d2, fovRad, lodDistance) {
  const range = lodDistance > 0 ? lodDistance : TERRAIN_LOD.defaultLodDistance;
  const v = Math.trunc(TERRAIN_LOD.scale * d2 * fovRad / (range * range));
  return v < 0 ? 0 : v > 3 ? 3 : v;
}

/** Whether a cell whose highest point is `top` is never drawn. */
export function cellUnderSea(top, waterLevel) {
  return waterLevel !== 0 && top < waterLevel - TERRAIN_LOD.seaSkipDepth;
}

/**
 * The lattice a patch's vertices lie on: `side` vertices a side, and the
 * vertex at each (ix, iz). Null when the positions are not a square lattice
 * of whole cells (a mesh this module then leaves alone).
 */
export function patchGrid(position) {
  const count = position.count;
  const side = Math.round(Math.sqrt(count));
  const n = side - 1;
  if (side * side !== count || n < TERRAIN_LOD.cellSamples || n % TERRAIN_LOD.cellSamples) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let v = 0; v < count; v++) {
    const x = position.getX(v), z = position.getZ(v);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!(maxX > minX) || !(maxZ > minZ)) return null;
  const at = new Int32Array(count).fill(-1);
  const sx = n / (maxX - minX), sz = n / (maxZ - minZ);
  for (let v = 0; v < count; v++) {
    const ix = Math.round((position.getX(v) - minX) * sx);
    const iz = Math.round((position.getZ(v) - minZ) * sz);
    const k = iz * side + ix;
    if (at[k] !== -1) return null;
    at[k] = v;
  }
  return { side, n, at };
}

/**
 * The triangles of one cell at one level, as lattice vertex indices.
 * `cx`, `cz` are the cell's column and row; `flip` turns the winding (the
 * patch's own, read off its first triangle).
 */
export function cellTriangles(grid, cx, cz, level, flip = false) {
  const C = TERRAIN_LOD.cellSamples;
  const { side, at } = grid;
  const x0 = cx * C, z0 = cz * C;
  const out = [];
  // Every triangle is wound by its lattice coordinates, so the strips below
  // need no care about which way round they walk.
  const tri = (ax, az, bx, bz, px, pz) => {
    let cross = (bx - ax) * (pz - az) - (bz - az) * (px - ax);
    if (flip) cross = -cross;
    const a = at[(z0 + az) * side + x0 + ax];
    const b = at[(z0 + bz) * side + x0 + bx];
    const c = at[(z0 + pz) * side + x0 + px];
    if (cross > 0) out.push(a, b, c); else out.push(a, c, b);
  };
  if (level <= 0) {
    for (let z = 0; z < C; z++) {
      for (let x = 0; x < C; x++) {
        tri(x, z, x + 1, z + 1, x + 1, z);
        tri(x, z, x, z + 1, x + 1, z + 1);
      }
    }
    return out;
  }
  const s = 1 << level;
  // The inside, at the level's stride.
  for (let z = s; z < C - s; z += s) {
    for (let x = s; x < C - s; x += s) {
      tri(x, z, x + s, z + s, x + s, z);
      tri(x, z, x, z + s, x + s, z + s);
    }
  }
  // The ring: each side's full border zipped to the inside's edge.
  const inner = [];
  for (let p = s; p <= C - s; p += s) inner.push(p);
  // point(t, depth): the lattice point `t` along a side, on the border
  // (depth 0) or on the inside's edge (depth s).
  const sides = [
    (t, d) => [t, d],
    (t, d) => [C - d, t],
    (t, d) => [C - t, C - d],
    (t, d) => [d, C - t],
  ];
  for (const point of sides) {
    let i = 0;
    for (let j = 0; j < inner.length; j++) {
      const last = j === inner.length - 1;
      const [qx, qz] = point(inner[j], s);
      while (i < C && (last || i + 1 <= inner[j] + s / 2)) {
        const [ax, az] = point(i, 0), [bx, bz] = point(i + 1, 0);
        tri(ax, az, bx, bz, qx, qz);
        i++;
      }
      if (!last) {
        const [ax, az] = point(i, 0), [nx, nz] = point(inner[j + 1], s);
        tri(ax, az, nx, nz, qx, qz);
      }
    }
  }
  return out;
}

/** Whether a patch's own triangles are wound against `cellTriangles`' default. */
function windingFlipped(geometry, grid) {
  const index = geometry.getIndex();
  if (!index || index.count < 3) return false;
  const where = new Map();
  for (let k = 0; k < grid.at.length; k++) where.set(grid.at[k], k);
  const p = [0, 1, 2].map(i => {
    const k = where.get(index.getX(i));
    return [k % grid.side, Math.floor(k / grid.side)];
  });
  const cross = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
  return cross < 0;
}

/** What is known of one baked patch: its lattice, its cells, their triangles. */
function analysePatch(geometry) {
  const position = geometry.getAttribute('position');
  if (!position || geometry.groups?.length > 1) return null;
  const grid = patchGrid(position);
  if (!grid) return null;
  const C = TERRAIN_LOD.cellSamples;
  const per = grid.n / C;
  const cells = [];
  for (let cz = 0; cz < per; cz++) {
    for (let cx = 0; cx < per; cx++) {
      let minY = Infinity, maxY = -Infinity;
      for (let z = 0; z <= C; z++) {
        for (let x = 0; x <= C; x++) {
          const y = position.getY(grid.at[(cz * C + z) * grid.side + cx * C + x]);
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      const mid = grid.at[(cz * C + C / 2) * grid.side + cx * C + C / 2];
      cells.push({
        cx, cz, top: maxY,
        x: position.getX(mid), y: (minY + maxY) / 2, z: position.getZ(mid),
        triangles: [null, null, null, null],
      });
    }
  }
  return { base: geometry, grid, cells, flip: windingFlipped(geometry, grid), wide: position.count > 65535 };
}

const SKIP = 255;

/**
 * Built once by `createLevelTerrain`. `page` hands in, as getters: `camera`,
 * `extras`, `scene`.
 */
export function createTerrainLod(page) {
  const lod = { enabled: true };
  let sources = [];
  const patches = new Map();   // base geometry -> patch (or null: leave alone)
  const records = new Map();   // mesh -> { patch, geometry, lods, capacity }
  const last = { x: NaN, y: NaN, z: NaN, fov: NaN, range: NaN, meshes: -1, water: NaN };
  const center = new THREE.Vector3();

  function patchOf(geometry) {
    let patch = patches.get(geometry);
    if (patch === undefined) {
      patch = analysePatch(geometry);
      patches.set(geometry, patch);
    }
    return patch;
  }

  function indexOf(patch, capacity) {
    const array = patch.wide ? new Uint32Array(capacity) : new Uint16Array(capacity);
    const index = new THREE.BufferAttribute(array, 1);
    index.setUsage(THREE.DynamicDrawUsage);
    return index;
  }

  /** A geometry over the patch's own vertices with an index of its own. */
  function ownGeometry(patch, capacity) {
    const g = new THREE.BufferGeometry();
    // The same attribute table, not a copy: a pass that adds an attribute to
    // the patch later (a lightmap's second UV set) reaches every index.
    g.attributes = patch.base.attributes;
    g.morphAttributes = patch.base.morphAttributes;
    g.boundingBox = patch.base.boundingBox;
    g.boundingSphere = patch.base.boundingSphere;
    g.userData = { terrainLodOf: patch.base };
    g.setIndex(indexOf(patch, capacity));
    return g;
  }

  function recordOf(mesh) {
    let rec = records.get(mesh);
    if (rec !== undefined) return rec;
    const base = mesh.geometry?.userData?.terrainLodOf || mesh.geometry;
    const patch = base ? patchOf(base) : null;
    rec = patch ? { patch, geometry: null, capacity: 0, lods: new Uint8Array(patch.cells.length).fill(254) } : null;
    records.set(mesh, rec);
    return rec;
  }

  function trianglesOf(patch, cell, level) {
    let t = cell.triangles[level];
    if (!t) t = cell.triangles[level] = cellTriangles(patch.grid, cell.cx, cell.cz, level, patch.flip);
    return t;
  }

  function writeIndex(mesh, rec) {
    const { patch, lods } = rec;
    let need = 0;
    for (let c = 0; c < lods.length; c++) {
      if (lods[c] !== SKIP) need += trianglesOf(patch, patch.cells[c], lods[c]).length;
    }
    if (!rec.geometry || need > rec.capacity) {
      // A patch of the level itself takes room for every sample at once. A
      // copy past the edge is mostly far off, so it starts at twice what it
      // needs and grows. The geometry is kept when it grows (disposing it
      // would drop the vertex buffers the other indices are bound to).
      const full = patch.base.getIndex()?.count || need;
      rec.capacity = mesh.userData?.edgeOf ? Math.max(need, Math.min(full, need * 2)) : Math.max(need, full);
      if (rec.geometry) rec.geometry.setIndex(indexOf(patch, rec.capacity));
      else rec.geometry = ownGeometry(patch, rec.capacity);
    }
    const index = rec.geometry.getIndex();
    let o = 0;
    for (let c = 0; c < lods.length; c++) {
      if (lods[c] === SKIP) continue;
      const t = trianglesOf(patch, patch.cells[c], lods[c]);
      index.array.set(t, o);
      o += t.length;
    }
    index.needsUpdate = true;
    rec.geometry.setDrawRange(0, o);
    rec.geometry.boundingBox = patch.base.boundingBox;
    rec.geometry.boundingSphere = patch.base.boundingSphere;
    if (mesh.geometry !== rec.geometry) mesh.geometry = rec.geometry;
  }

  function judge(mesh, cam, fov, range, water) {
    const rec = recordOf(mesh);
    if (!rec) return;
    const { patch, lods } = rec;
    const e = mesh.matrixWorld.elements;
    let changed = false;
    for (let c = 0; c < lods.length; c++) {
      const cell = patch.cells[c];
      let level;
      // The patches stand unrotated and unscaled; the world's y is the
      // cell's own plus the mesh's.
      if (cellUnderSea(cell.top + e[13], water)) level = SKIP;
      else {
        center.set(cell.x, cell.y, cell.z).applyMatrix4(mesh.matrixWorld);
        level = terrainLodLevel(center.distanceToSquared(cam), fov, range);
      }
      if (level !== lods[c]) { lods[c] = level; changed = true; }
    }
    if (changed || mesh.geometry !== rec.geometry) writeIndex(mesh, rec);
  }

  function copies() {
    const out = [];
    const group = page.scene?.children.find(o => o.name === 'terrainEdge');
    if (group) {
      for (const g of group.children) {
        if (g.visible) for (const m of g.children) if (m.isMesh) out.push(m);
      }
    }
    return out;
  }

  const camPos = new THREE.Vector3();
  /** Per render: re-judge every patch when the camera has moved 2 m, its
   *  lens changed, or a copy of the world came into reach. */
  function update(camera) {
    if (!lod.enabled || !sources.length || !camera) return;
    const meshes = sources.concat(copies());
    camPos.setFromMatrixPosition(camera.matrixWorld);
    const fov = camera.isPerspectiveCamera ? viewFieldOfView(camera.fov, camera.zoom) : 1;
    const range = page.extras?.terrainLodDistance > 0 ? page.extras.terrainLodDistance : TERRAIN_LOD.defaultLodDistance;
    const water = page.extras?.waterLevel ?? 0;
    const dx = camPos.x - last.x, dy = camPos.y - last.y, dz = camPos.z - last.z;
    if (dx * dx + dy * dy + dz * dz < 4 && fov === last.fov && range === last.range
        && meshes.length === last.meshes && water === last.water) return;
    last.x = camPos.x; last.y = camPos.y; last.z = camPos.z;
    last.fov = fov; last.range = range; last.meshes = meshes.length; last.water = water;
    for (const mesh of meshes) judge(mesh, camPos, fov, range, water);
  }

  function restore() {
    for (const [mesh, rec] of records) {
      if (rec?.geometry && mesh.geometry === rec.geometry) mesh.geometry = rec.patch.base;
    }
  }

  function dispose() {
    restore();
    for (const rec of records.values()) rec?.geometry?.dispose();
    records.clear();
    patches.clear();
    sources = [];
    last.meshes = -1;
  }

  /** The level's terrain meshes. The index buffers are built from the first
   *  render on, after the edge stitch and the shading passes have run. */
  function bind(meshes) {
    dispose();
    sources = meshes.slice();
    const scene = page.scene;
    if (!scene?.userData || scene.userData.terrainLod) return;
    scene.userData.terrainLod = lod;
    const previous = scene.onBeforeRender;
    scene.onBeforeRender = function (renderer, sceneArg, camera, target) {
      if (typeof previous === 'function') previous.call(this, renderer, sceneArg, camera, target);
      update(camera);
    };
  }

  /** `?noterrainlod`, and the before of a before/after: every sample drawn. */
  function setEnabled(on) {
    lod.enabled = !!on;
    if (!lod.enabled) restore();
    last.meshes = -1;
  }

  /** What is drawn now: cells by level, cells skipped, triangles. */
  function stats() {
    const cells = [0, 0, 0, 0];
    let skipped = 0, triangles = 0, meshes = 0, full = 0;
    for (const [mesh, rec] of records) {
      if (!rec?.geometry || mesh.geometry !== rec.geometry) continue;
      meshes++;
      for (const l of rec.lods) { if (l === SKIP) skipped++; else if (l < 4) cells[l]++; }
      triangles += rec.geometry.drawRange.count / 3;
      full += (rec.patch.base.getIndex()?.count || 0) / 3;
    }
    return { enabled: lod.enabled, meshes, cells, skipped, triangles, full };
  }

  lod.bind = bind;
  lod.dispose = dispose;
  lod.update = update;
  lod.setEnabled = setEnabled;
  lod.stats = stats;
  return lod;
}
