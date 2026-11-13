// Remaster mode's moving shadow casters, drawn as one batch a cascade
// (features/remaster-browser, "Fewer objects").
//
// The statics cast through merged proxies (remaster-shadow-proxies.js).
// What moves cast for itself, part by part: a Sherman is 74 caster meshes
// (every wheel is three), a Priest 67, and each was an object three's WebGPU
// renderer handled in JavaScript in every cascade it fell in, some 5
// microseconds a time. Three tanks near the eye on El Alamein were 400 of the
// frame's 990 objects.
//
// Here every rigid moving caster is an instance of one `BatchedMesh` that
// only the sun's shadow cameras see. The instance's matrix is the part's own
// world matrix, copied each frame, so the shadow is the one the part cast by
// itself: the turret turns, the barrel lifts, a wheel rides its spring. A
// cascade then handles one object and issues the draws natively.
//
// What stays a caster of its own: a skinned mesh (its bones are not a
// matrix), a cut-out (it needs its texture), and a mesh whose material moves
// its vertices.
//
// `THREE` is handed in (three/webgpu on the page, three.core under node), so
// the tests run this module as it is.

export const SHADOW_BATCH_NAME = 'remaster shadow batch';

/** True when `obj` can cast as an instance: rigid, opaque, its vertices its own. */
export function batchable(obj) {
  if (!obj?.isMesh || obj.isSkinnedMesh || obj.isInstancedMesh || obj.isBatchedMesh) return false;
  const g = obj.geometry;
  if (!g?.attributes?.position || g.morphAttributes?.position) return false;
  for (const m of [obj.material].flat()) {
    if (!m) return false;
    // A cut-out casts the shape of its texture, a blend none of this.
    if (m.alphaTest > 0 || m.transparent || m.remasterSprite) return false;
    if (m.positionNode || m.castShadowPositionNode || m.displacementMap) return false;
  }
  return true;
}

/** `geometry`'s positions and index alone, as plain floats: what a shadow needs,
 *  and one layout for every part whatever its file stored. */
function shadowGeometry(THREE, geometry) {
  const pos = geometry.getAttribute('position');
  const n = pos.count;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { out[i * 3] = pos.getX(i); out[i * 3 + 1] = pos.getY(i); out[i * 3 + 2] = pos.getZ(i); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  const index = geometry.getIndex();
  if (index) g.setIndex(Array.from(index.array));
  else g.setIndex(Array.from({ length: n }, (_, i) => i));
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  g.boundingSphere = geometry.boundingSphere.clone();
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  g.boundingBox = geometry.boundingBox.clone();
  return g;
}

/**
 * The batch for one scene. `addAll(records)` takes caster records (`{ obj }`,
 * the renderer's own; `record.on` is its reach judgement, `record.proxied`
 * the proxies' claim on it), `sync(scene)` once a frame before the first
 * cascade, `remove(record)` when its mesh has gone.
 *
 * The batch never grows in place. `BatchedMesh.setInstanceCount` and
 * `setGeometrySize` replace the instance textures and the geometry, and a
 * cascade's draw record, compiled against the old ones, is not rebuilt for
 * it: the shadow pass went on reading matrices nobody wrote any more, and
 * every moving caster lost its shadow. Out of room, a new batch is built at
 * twice the need and the old one let go.
 */
export function createShadowBatch(THREE, root, { layer = 1, instances = 256, vertices = 32768, indices = 98304 } = {}) {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  material.name = 'shadow batch';
  let batch = null;
  let capInstances = 0, capVertices = 0, capIndices = 0;
  let usedVertices = 0, usedIndices = 0;
  let builds = 0;
  /** geometry -> { id, vertices, indices } in the batch. */
  const geometries = new Map();
  /** The records batched, in no order. */
  const records = new Set();

  const sizeOf = geometry => {
    const n = geometry.getAttribute('position').count;
    return { vertices: n, indices: geometry.getIndex()?.count ?? n };
  };

  function addGeometry(geometry, entry) {
    const g = shadowGeometry(THREE, geometry);
    entry.id = batch.addGeometry(g);
    g.dispose();
  }

  /** A batch with room for `need`, holding everything the last one held. */
  function build(need) {
    if (batch) { batch.removeFromParent(); batch.dispose(); }
    capInstances = Math.max(instances, need.instances * 2);
    capVertices = Math.max(vertices, need.vertices * 2);
    capIndices = Math.max(indices, need.indices * 2);
    batch = new THREE.BatchedMesh(capInstances, capVertices, capIndices, material);
    batch.name = SHADOW_BATCH_NAME;
    batch.castShadow = true;
    batch.receiveShadow = false;
    batch.frustumCulled = false;
    // Each cascade draws the instances inside its own box.
    batch.perObjectFrustumCulled = true;
    batch.sortObjects = false;
    batch.matrixAutoUpdate = false;
    batch.layers.set(layer);
    batch.userData.rmShadow = true;
    batch.userData.shadowProxy = true;
    root.add(batch);
    builds++;
    for (const [geometry, entry] of geometries) addGeometry(geometry, entry);
    for (const record of records) {
      record.batchId = batch.addInstance(geometries.get(record.obj.geometry).id);
      record.batchShown = true;
    }
  }

  return {
    get mesh() { return batch; },
    get count() { return records.size; },
    get capacity() {
      return { instances: capInstances, vertices: capVertices, indices: capIndices, usedVertices, usedIndices, builds };
    },
    /**
     * Take each record's mesh as an instance. A record that has to cast for
     * itself gets `batchId` -1; one taken gets its instance's id, and its
     * mesh stops casting.
     */
    addAll(list) {
      const take = [];
      const fresh = new Map();
      let nv = usedVertices, ni = usedIndices;
      for (const record of list) {
        if (record.batchId != null) continue;
        if (!batchable(record.obj)) { record.batchId = -1; continue; }
        take.push(record);
        const geometry = record.obj.geometry;
        if (geometries.has(geometry) || fresh.has(geometry)) continue;
        const size = sizeOf(geometry);
        fresh.set(geometry, { id: -1, ...size });
        nv += size.vertices; ni += size.indices;
      }
      if (!take.length) return 0;
      const count = records.size + take.length;
      const grow = !batch || count > capInstances || nv > capVertices || ni > capIndices;
      for (const [geometry, entry] of fresh) geometries.set(geometry, entry);
      for (const record of take) records.add(record);
      usedVertices = nv; usedIndices = ni;
      if (grow) {
        build({ instances: count, vertices: nv, indices: ni });
      } else {
        for (const [geometry, entry] of fresh) addGeometry(geometry, entry);
        for (const record of take) {
          record.batchId = batch.addInstance(geometries.get(record.obj.geometry).id);
          record.batchShown = true;
        }
      }
      // The mesh itself stops casting: its instance does.
      for (const record of take) record.obj.castShadow = false;
      return take.length;
    },
    remove(record) {
      if (!records.delete(record)) return;
      batch.deleteInstance(record.batchId);
      record.batchId = null;
    },
    /**
     * This frame's instances: each shown where its mesh would have cast
     * (judged in reach, not handed to a proxy, shown in `scene` through
     * every ancestor), at the mesh's own world matrix.
     */
    sync(scene) {
      if (!batch || !records.size) return 0;
      const data = batch._matricesTexture.image.data;
      let shown = 0;
      // The matrices go to the GPU only when one of them moved.
      let dirty = false;
      for (const record of records) {
        const obj = record.obj;
        let on = !!record.on && !record.proxied;
        if (on) {
          let top = obj;
          for (let a = obj; a; a = a.parent) { if (!a.visible) { on = false; break; } top = a; }
          if (on && top !== scene) on = false;
        }
        if (on !== record.batchShown) { record.batchShown = on; batch.setVisibleAt(record.batchId, on); }
        if (!on) continue;
        const e = obj.matrixWorld.elements;
        for (let i = 0, o = record.batchId * 16; i < 16; i++) {
          // Compared as the texture holds them, in single precision.
          const v = Math.fround(e[i]);
          if (data[o + i] !== v) { data[o + i] = v; dirty = true; }
        }
        shown++;
      }
      if (dirty) batch._matricesTexture.needsUpdate = true;
      return shown;
    },
    /** A new level: every instance and geometry let go. */
    reset() {
      for (const record of records) record.batchId = null;
      records.clear();
      geometries.clear();
      usedVertices = 0; usedIndices = 0;
      if (batch) { batch.removeFromParent(); batch.dispose(); batch = null; }
      capInstances = 0; capVertices = 0; capIndices = 0;
    },
  };
}
