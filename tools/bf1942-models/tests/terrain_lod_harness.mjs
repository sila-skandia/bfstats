// Drives `viewer/terrain-lod.js` outside a browser and prints one JSON blob:
// the detail law, the sea-bed skip, the triangles of a cell at each level and
// a patch re-indexed from a scene's per-render hook.
//
//   node terrain_lod_harness.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const viewer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../viewer');
const THREE = await import('three');
const {
  TERRAIN_LOD, cellTriangles, cellUnderSea, createTerrainLod, patchGrid, terrainLodLevel,
} = await import(pathToFileURL(path.join(viewer, 'terrain-lod.js')).href);

const out = { constants: { ...TERRAIN_LOD } };

out.level = {
  // Battle of Britain says lodDistance 425; a 1 rad lens.
  d245: terrainLodLevel(245 * 245, 1, 425),
  d246: terrainLodLevel(246 * 246, 1, 425),
  d347: terrainLodLevel(347 * 347, 1, 425),
  d348: terrainLodLevel(348 * 348, 1, 425),
  d424: terrainLodLevel(424 * 424, 1, 425),
  d425: terrainLodLevel(425 * 425, 1, 425),
  d5000: terrainLodLevel(5000 * 5000, 1, 425),
  // A zoomed lens (0.25 rad) keeps the detail out to twice the distance.
  zoom490: terrainLodLevel(490 * 490, 0.25, 425),
  zoom492: terrainLodLevel(492 * 492, 0.25, 425),
  // No word in the level: the constructor's 1050.
  unset606: terrainLodLevel(606 * 606, 1, undefined),
  unset607: terrainLodLevel(607 * 607, 1, 0),
};

out.sea = {
  noWater: cellUnderSea(-500, 0),
  justIn: cellUnderSea(85, 95),
  justUnder: cellUnderSea(84.99, 95),
  shore: cellUnderSea(96, 95),
  negativeLevel: cellUnderSea(-60, -40),
};

// A 65 x 65 patch as the bake writes it, its vertices then shuffled the way a
// mesh optimiser may leave them.
function patch(n, shuffle, heights = () => 0) {
  const side = n + 1;
  const order = [...Array(side * side).keys()];
  if (shuffle) for (let i = order.length - 1; i > 0; i--) { const j = (i * 7919 + 13) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
  const slot = new Int32Array(side * side);
  order.forEach((k, v) => { slot[k] = v; });
  const pos = new Float32Array(side * side * 3);
  for (let iz = 0; iz < side; iz++) {
    for (let ix = 0; ix < side; ix++) {
      const v = slot[iz * side + ix];
      pos[v * 3] = ix * 4; pos[v * 3 + 1] = heights(ix, iz); pos[v * 3 + 2] = -iz * 4;
    }
  }
  const index = [];
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * side + ix;
      index.push(slot[i], slot[i + side + 1], slot[i + 1], slot[i], slot[i + side], slot[i + side + 1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

const g64 = patch(64, true);
const grid = patchGrid(g64.getAttribute('position'));
out.grid = {
  side: grid?.side, n: grid?.n,
  odd: patchGrid(patch(40, false).getAttribute('position')) === null,
  small: patchGrid(patch(8, false).getAttribute('position')) === null,
};

// Where each lattice vertex of the cell is, to measure the triangles.
const where = new Map();
grid.at.forEach((v, k) => where.set(v, [k % grid.side, Math.floor(k / grid.side)]));
function measure(level, cx = 1, cz = 2) {
  const t = cellTriangles(grid, cx, cz, level);
  let area = 0, back = 0;
  const edges = new Set();
  const x0 = cx * 16, z0 = cz * 16;
  for (let i = 0; i < t.length; i += 3) {
    const p = [where.get(t[i]), where.get(t[i + 1]), where.get(t[i + 2])];
    const cross = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
    area += Math.abs(cross) / 2;
    if (cross < 0) back++;
    for (let k = 0; k < 3; k++) {
      const a = p[k], b = p[(k + 1) % 3];
      const onBorder = q => q[0] === x0 || q[0] === x0 + 16 || q[1] === z0 || q[1] === z0 + 16;
      if (onBorder(a) && onBorder(b) && Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1) {
        edges.add([a, b].map(q => q.join(':')).sort().join('|'));
      }
    }
  }
  const inside = t.every(v => { const q = where.get(v); return q[0] >= x0 && q[0] <= x0 + 16 && q[1] >= z0 && q[1] <= z0 + 16; });
  return { triangles: t.length / 3, area, back, borderSegments: edges.size, inside, vertices: new Set(t).size };
}
out.cells = [0, 1, 2, 3].map(l => measure(l));
out.flipped = (() => {
  const t = cellTriangles(grid, 0, 0, 2, true);
  const p = [where.get(t[0]), where.get(t[1]), where.get(t[2])];
  return (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]) < 0;
})();

// A bound scene: one patch 256 m square, sloping from a hill in one corner
// to deep sea in the other, re-indexed from the scene's per-render hook.
const scene = new THREE.Scene();
const extras = { terrainLodDistance: 425, waterLevel: 0 };
const geometry = patch(64, true, (ix, iz) => 60 - (ix + iz) * 0.9);
const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
scene.add(mesh);
scene.updateMatrixWorld(true);
const lod = createTerrainLod({ get scene() { return scene; }, get extras() { return extras; } });
lod.bind([mesh]);
const camera = new THREE.PerspectiveCamera(57.2958, 1.6, 0.1, 2000);
const render = (x, y, z) => {
  camera.position.set(x, y, z);
  camera.updateMatrixWorld(true);
  scene.onBeforeRender(null, scene, camera, null);
  return lod.stats();
};
const full = geometry.getIndex().count / 3;
const near = render(128, 40, -128);
out.scene = { full, near, sharesVertices: mesh.geometry.getAttribute('position') === geometry.getAttribute('position'),
  ownIndex: mesh.geometry !== geometry };
out.scene.far = render(128, 40, 3000);
out.scene.middle = render(-200, 40, 100);
extras.waterLevel = 20;
out.scene.sea = render(128, 40, -128);
// Triangles of the drawn index all name real vertices.
out.scene.indexInRange = (() => {
  const idx = mesh.geometry.getIndex();
  for (let i = 0; i < mesh.geometry.drawRange.count; i++) if (idx.array[i] >= 65 * 65) return false;
  return true;
})();
// Remaster mode draws the sun's shadow cascades from the same scene, each
// with an orthographic camera far up the sun, in the middle of the main
// pass: they leave the index as the view's camera judged it. The retail
// renderer's other cameras still judge, each for its own draw.
out.scene.cascade = (() => {
  const view = render(128, 40, -128).triangles;
  const sun = new THREE.OrthographicCamera(-200, 200, 200, -200, 1, 4000);
  sun.position.set(900, 1200, 700);
  sun.updateMatrixWorld(true);
  scene.onBeforeRender({ isRemaster: true }, scene, sun, null);
  const afterCascade = lod.stats().triangles;
  scene.onBeforeRender({}, scene, sun, null);
  const retailOrtho = lod.stats().triangles;
  return { view, afterCascade, retailOrtho };
})();
lod.setEnabled(false);
out.scene.offRestores = mesh.geometry === geometry;
lod.setEnabled(true);
out.scene.onAgain = render(128, 40, -128).meshes;

console.log(JSON.stringify(out));
