// Drives `viewer/level-edge.js` outside a browser and prints one JSON blob:
// which world copies a camera reaches (`visibleCopies`) and what the border
// stitch does to a lattice (`stitch`). The module imports three, which resolves
// from tools/bf1942-models/node_modules, so plain node loads it in place.
//
//   node level_edge_harness.mjs
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const viewer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../viewer');
const { visibleCopies, stitch, RING } = await import(pathToFileURL(path.join(viewer, 'level-edge.js')).href);
const THREE = await import('three');

const W = 2048, far = 525;
const copies = (x, z, f = far, ring) => visibleCopies(x, z, f, W, ring).map(c => c.join(','));

// A (dim+1)^2 lattice of a world W' = dim * s wide, glTF-style: local z positive,
// the mesh mirrored so the world z is negative. y encodes the sample: 10 * xi + zi.
function lattice(dim, s, mirrored) {
  const pos = [];
  for (let zi = 0; zi <= dim; zi++) for (let xi = 0; xi <= dim; xi++) pos.push(xi * s, 10 * xi + zi, zi * s);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g);
  if (mirrored) m.scale.z = -1;
  m.updateMatrixWorld(true);
  return m;
}
const heightsOf = m => {
  const p = m.geometry.getAttribute('position');
  const out = {};
  for (let n = 0; n < p.count; n++) out[`${Math.round(p.getX(n) / 4)},${Math.round(p.getZ(n) / 4)}`] = p.getY(n);
  return out;
};

const flat = lattice(2, 4, true);
const movedFlat = stitch([flat], 8, 2);
const mirrored = heightsOf(flat);
// A sea level: every sample 0, so the border already meets its wrap.
const sea = lattice(2, 4, true);
{
  const p = sea.geometry.getAttribute('position');
  for (let n = 0; n < p.count; n++) p.setY(n, 0);
}
const movedSea = stitch([sea], 8, 2);

console.log(JSON.stringify({
  ring: RING,
  centre: copies(1000, -1000),
  westEdge: copies(30, -1000),
  corner: copies(40, -2000),
  eastOutside: copies(3000, -1000),
  noFar: copies(30, -1000, 0),
  ringCap: copies(30, -1000, 100000),
  mirrored: { moved: movedFlat, y: mirrored },
  sea: { moved: movedSea },
}));
