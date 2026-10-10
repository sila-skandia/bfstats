// What the engine draws past the edge of the heightmap: the terrain again.
//
// The client's terrain renderer never stops at `worldSize`. Its visible-cell
// walk (`0x00682ed0`, ledger TERR-5) runs over every 16-sample cell inside the
// camera's far-plane square, masks the cell index by `cellsPerRow - 1` to find
// the cell's data, and shifts the cell's bounding sphere back out to where the
// unmasked index lies. So the level repeats, edge to edge, in both axes, out to
// the view distance; each outside patch is the in-world patch it wraps to, with
// that patch's own Tx tile (or the default texture) and its own lightmap. The
// height source agrees: `HeightMap::getSample` `0x0062f9f0` is
// `data[((z & mask) << log2) + (x & mask)]`, a pure wrap. Statics, vehicles and
// everything else are not repeated; only the ground and (level-sky.js) the sea.
//
// The bake draws the heightmap's last row and column from the last sample
// (`Heightmap.height_at` clamps), where the engine's last strip runs on into
// sample 0. `stitch` moves those vertices to the wrapped sample, so the copy
// meets the original with no crack; on Wake and the other sea levels the two are
// identical, on a land level the border step is metres (Berlin: 9.5 m mean).
//
// Nothing here is baked: a copy is a Mesh sharing the original's geometry and
// material, placed at a multiple of `worldSize`, and three's own frustum test
// drops the patches the camera cannot see. A copy whose square is further than
// the far plane from the camera is not visited at all.

import * as THREE from 'three';

/** Copies drawn on either side of the world, a ring of `+-RING` worlds. */
export const RING = 2;

/**
 * Which (i, k) world copies a camera at (cx, cz) with a far plane at `far` can
 * see, `(0, 0)` excluded. A copy (i, k) covers x in [i W, (i + 1) W] and z in
 * [(k - 1) W, k W], the original being x in [0, W], z in [-W, 0]. Pure.
 */
export function visibleCopies(cx, cz, far, W, ring = RING) {
  const out = [];
  if (!(W > 0) || !(far > 0)) return out;
  const i0 = Math.max(-ring, Math.floor((cx - far) / W));
  const i1 = Math.min(ring, Math.floor((cx + far) / W));
  const k0 = Math.max(-ring, Math.ceil((cz - far) / W));
  const k1 = Math.min(ring, Math.ceil((cz + far) / W));
  for (let i = i0; i <= i1; i++) {
    for (let k = k0; k <= k1; k++) {
      if (i === 0 && k === 0) continue;
      const minX = i * W, maxX = minX + W, minZ = (k - 1) * W, maxZ = minZ + W;
      const dx = Math.max(minX - cx, 0, cx - maxX);
      const dz = Math.max(minZ - cz, 0, cz - maxZ);
      if (dx * dx + dz * dz <= far * far) out.push([i, k]);
    }
  }
  return out;
}

/**
 * Move the vertices on the world's far edges to the heights the wrap gives
 * them: the vertex at sample `dim` takes the height of sample 0 on that axis.
 * `meshes` are the terrain meshes with their world matrices current. Returns
 * the number of vertices moved.
 */
export function stitch(meshes, W, dim) {
  if (!(W > 0) || !(dim > 0)) return 0;
  const s = W / dim;
  const eps = s * 0.01;
  const key = (xi, zi) => xi * 65536 + zi;
  const first = new Map();
  const v = new THREE.Vector3();
  const touches = (box, fn) => fn(box.min.x, box.max.x, box.min.z, box.max.z);
  const box = new THREE.Box3();
  const worldBox = mesh => {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    return box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
  };
  // Pass 1: the first column and row (x = 0 or z = 0), whose heights the far
  // edge borrows.
  for (const mesh of meshes) {
    const b = worldBox(mesh);
    if (!touches(b, (x0, x1, z0, z1) => x0 <= eps || z1 >= -eps)) continue;
    const pos = mesh.geometry.getAttribute('position');
    for (let n = 0; n < pos.count; n++) {
      v.fromBufferAttribute(pos, n).applyMatrix4(mesh.matrixWorld);
      const xi = Math.round(v.x / s), zi = Math.round(-v.z / s);
      if (xi === 0 || zi === 0) first.set(key(xi, zi), v.y);
    }
  }
  // Pass 2: the vertices at x = W or z = -W, written back through the inverse
  // of the mesh's world matrix (only y changes).
  let moved = 0;
  const inv = new THREE.Matrix4();
  for (const mesh of meshes) {
    const b = worldBox(mesh);
    if (!touches(b, (x0, x1, z0, z1) => x1 >= W - eps || z0 <= -W + eps)) continue;
    const pos = mesh.geometry.getAttribute('position');
    inv.copy(mesh.matrixWorld).invert();
    let dirty = false;
    for (let n = 0; n < pos.count; n++) {
      v.fromBufferAttribute(pos, n).applyMatrix4(mesh.matrixWorld);
      const xi = Math.round(v.x / s), zi = Math.round(-v.z / s);
      if (xi !== dim && zi !== dim) continue;
      const y = first.get(key(xi === dim ? 0 : xi, zi === dim ? 0 : zi));
      if (y === undefined || Math.abs(y - v.y) < 1e-4) continue;
      v.y = y;
      v.applyMatrix4(inv);
      pos.setY(n, v.y);
      dirty = true;
      moved++;
    }
    if (dirty) {
      pos.needsUpdate = true;
      mesh.geometry.computeBoundingBox();
      mesh.geometry.computeBoundingSphere();
    }
  }
  return moved;
}

/**
 * Built once by `createLevel` (level-load.js). `page` hands in, as getters:
 * `camera`, `extras`, `scene`.
 */
export function createLevelEdge(page) {
  const edge = { group: null, sources: [], copies: new Map(), worldSize: 0, stitched: 0 };

  function dispose() {
    if (edge.group) page.scene.remove(edge.group);
    // Geometry and materials are the level's, disposed with its root.
    edge.group = null;
    edge.sources = [];
    edge.copies.clear();
    edge.worldSize = 0;
    edge.stitched = 0;
  }

  /** Collect the terrain meshes of a loaded level. After the shading passes
   *  have replaced their materials, and after the collider is built (the
   *  stitch moves vertices the collider must not see move). */
  function setup(root) {
    dispose();
    const W = page.extras?.worldSize;
    const dim = page.extras?.heightmap?.dim;
    if (!(W > 0)) return;
    root.updateMatrixWorld(true);
    const seen = new Set();
    root.traverse(node => {
      if (node.userData?.kind !== 'terrain') return;
      node.traverse(obj => {
        if (obj.isMesh && obj.geometry && !seen.has(obj)) {
          seen.add(obj);
          edge.sources.push(obj);
        }
      });
    });
    if (!edge.sources.length) return;
    edge.worldSize = W;
    if (dim > 0) edge.stitched = stitch(edge.sources, W, dim);
    edge.group = new THREE.Group();
    edge.group.name = 'terrainEdge';
    page.scene.add(edge.group);
  }

  function build(i, k) {
    const W = edge.worldSize;
    const g = new THREE.Group();
    g.name = `terrainEdge ${i},${k}`;
    g.userData = {};
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scale = new THREE.Vector3();
    for (const src of edge.sources) {
      const m = new THREE.Mesh(src.geometry, src.material);
      src.matrixWorld.decompose(pos, quat, scale);
      m.position.set(pos.x + i * W, pos.y, pos.z + k * W);
      m.quaternion.copy(quat);
      m.scale.copy(scale);
      m.renderOrder = src.renderOrder;
      m.layers.mask = src.layers.mask;
      m.matrixAutoUpdate = true;
      m.userData = { edgeOf: src };
      g.add(m);
    }
    edge.group.add(g);
    return g;
  }

  /** Per frame: show the copies the camera's far plane reaches, hide the rest. */
  function update() {
    if (!edge.group) return;
    const cam = page.camera;
    const want = new Set();
    for (const [i, k] of visibleCopies(cam.position.x, cam.position.z, cam.far, edge.worldSize)) {
      const id = `${i},${k}`;
      want.add(id);
      let g = edge.copies.get(id);
      if (!g) {
        g = build(i, k);
        edge.copies.set(id, g);
      }
      g.visible = true;
      // A pass that swaps a source's material after setup (a texture fade, a
      // quality change) reaches the copies here. The source's `visible` is NOT
      // copied: `applyVisibility` (level-statics.js) distance-culls the terrain
      // patches around the camera, so a patch's flag says whether the original
      // is near the camera, which a copy at the other side of the world is not.
      // three's frustum test (the far plane included) does that job for a copy.
      for (const m of g.children) {
        const src = m.userData.edgeOf;
        if (m.material !== src.material) m.material = src.material;
      }
    }
    for (const [id, g] of edge.copies) if (!want.has(id)) g.visible = false;
  }

  edge.dispose = dispose;
  edge.setup = setup;
  edge.update = update;
  return edge;
}
