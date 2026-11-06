// Repeated level statics drawn as batches (features/batched-level-statics).
//
// A big FHSW level is a few hundred shapes stamped tens of thousands of
// times: Operation Varsity places 78,744 meshes from 3,002 distinct ones,
// 72,549 of them copies of a mesh placed ten or more times, and the page
// drew every stamp inside the draw distance as its own `Mesh`, with its own
// frustum test, uniform refresh and draw call: 4,700 draws and 11 ms of a
// 20 ms frame (features/mod-level-frame-cost). Retail draws a level's
// statics from vertex buffers it built once.
//
// This module takes every placement whose meshes all qualify and puts the
// meshes into one `THREE.BatchedMesh` per (material, geometry layout): one
// multi-draw per material, the instances' matrices in a texture, and the
// page's per-placement rules kept per instance:
//
//   * the draw-distance cull, `applyVisibility`'s sphere test on the
//     placement, and the frustum test three gives every `Mesh`
//     (`setVisibleAt`);
//   * the small-mesh cull, `buildSmallMeshCull`'s `d^2 > a x fov + b` on the
//     part (`setVisibleAt` again);
//   * a lifted LOD chain's rung (`liftLods`' `lod.update`: `selectLod` on
//     the part's cull spec, or the rungs' authored distances): every rung's
//     meshes are instances, the chosen rung's shown;
//   * the alpha LOD's near/far switch (`bindAlphaLod`): the far state, a cut
//     that needs no order, is the instance; the near state, a blend three
//     sorts mesh by mesh against the trees' cards, stays the mesh itself,
//     shown inside its reach and hidden beyond it;
//   * the terrain's shade on the object (`bindTerrainShade`'s per-mesh
//     TFACTOR): a per-instance colour, which `bindDynamicShading`'s combine
//     multiplies in the same place the uniform went.
//
// The placement's own node stays in the tree: hidden, when nothing of it
// is drawn as a mesh any more (its collision twin is what the collider
// indexed, and `projectObject` skips a hidden subtree), else kept with its
// batched meshes hidden one by one. It leaves the cull list and the
// small-mesh list.
//
// What stays a `Mesh`: a placement that moves (bones, cloth, a rig, a clip's
// target: `freezeStatics` leaves it thawed), a tree (`tree-foliage.js`
// rebinds those by material name), a texture-fade plane, a lightmapped mesh
// (the other combine, no `bfShade`), an envmapped one (its reflection reads
// the mesh's own matrix), an effect, a kinded node (water, a flag cloth, a
// control point), a mesh with a material array, an alpha-LOD mesh inside a
// LOD chain, a rung `liftLods` hid, and a placement any of whose geometries
// fewer than `minShare` meshes share. `?nobatch` leaves everything a
// `Mesh`; `?batch=N` sets the share.

import * as THREE from 'three';
import { isCollision, kindOf, meshCullSpec } from './level-statics.js';
import { TREE_PART } from './tree-foliage.js';
import { GLOBAL_LOD_RADIUS, cullTerms, selectLod } from './mesh-cull.js';

/** The LOD-0 meshes of a part, as `level-statics.js` reads them. */
function lod0Meshes(part) {
  return part.isMesh ? [part] : part.children.filter(
    c => c.isMesh && Object.keys(c.userData || {}).length === 0);
}

/** Why a placement is not batched, counted for the report. */
const SKIP = ['lod', 'moves', 'kind', 'material', 'tree', 'fade', 'env', 'lit', 'effect', 'array', 'share', 'empty', 'alphaChain'];

/** A mesh's reason to stay a `Mesh`, or null when it can be an instance. */
function meshBlocker(o) {
  if (o.userData?.effect) return 'effect';
  const m = o.material;
  if (!m || Array.isArray(m)) return m ? 'array' : 'material';
  if (TREE_PART.test(m.name || '')) return 'tree';
  if (m.userData?.textureFade) return 'fade';
  if (m.userData?.additive) return 'effect';
  if (!m.bfShade) return 'lit';
  if (m.bfEnv) return 'env';
  if (!o.geometry?.attributes?.position) return 'material';
  return null;
}

/** The batchable meshes under `node`, not descending into a lifted part or
 *  a LOD wrapper (those are chains); the first blocker, or null. */
function collect(node, lifted, meshes, chains) {
  let why = null;
  const walk = o => {
    if (why) return;
    if (o.isLOD) return;                       // a chain's wrapper: read through its part
    // A rung of a chain `liftLods` did not lift (an interior, a lightmapped
    // part, one under a spawner): hidden for good, never an instance.
    if (o.userData?.lod) return;
    if (lifted.has(o)) {
      const wrapper = o.parent?.children.find(c => c.isLOD && c.part === o) ?? null;
      if (!wrapper) { why = 'lod'; return; }
      const rungs = [];
      const r0 = [];
      for (const mesh of lod0Meshes(o)) { const b = meshBlocker(mesh); if (b) { why = b; return; } r0.push(mesh); }
      rungs.push(r0);
      for (const level of wrapper.levels) {
        const rung = [];
        level.object.traverse(x => {
          if (why || !x.isMesh || isCollision(x)) return;
          const b = meshBlocker(x); if (b) { why = b; return; } rung.push(x);
        });
        if (why) return;
        rungs.push(rung);
      }
      // The part's other children (what is not LOD 0 nor a rung) go as
      // plain meshes of the placement.
      for (const c of o.children) if (!c.userData?.lod && !r0.includes(c)) walk(c);
      chains.push({ part: o, wrapper, rungs });
      return;
    }
    if (o.isSkinnedMesh || o.isBone || o.userData?.rig) { why = 'moves'; return; }
    if (o.isMesh) {
      if (isCollision(o)) return;
      const b = meshBlocker(o); if (b) { why = b; return; }
      meshes.push(o);
      return;
    }
    for (const c of o.children) { if (kindOf(c)) { why = 'kind'; return; } walk(c); }
  };
  walk(node);
  return why;
}

/** A placement's batchable meshes and chains, or the reason it keeps them. */
function placementUnits(child, lifted) {
  if (child.isLOD) return 'lod';          // the wrapper is read through its part
  if (!Object.hasOwn(child, 'updateMatrixWorld')) return 'moves';
  if (kindOf(child)) return 'kind';
  const meshes = [], chains = [];
  const why = collect(child, lifted, meshes, chains);
  if (why) return why;
  if (!meshes.length && !chains.length) return 'empty';
  return { meshes, chains };
}

/** One batch per material and geometry layout; a material's own key. */
function materialKey(m) {
  const md = m.userData?.materialDiffuse;
  return [
    m.map?.uuid ?? '', m.color?.getHex() ?? 0, m.side, m.alphaTest, m.transparent ? 1 : 0, m.opacity,
    m.depthWrite ? 1 : 0, m.blending, m.name || '', Array.isArray(md) ? md.join(',') : '',
    m.userData?.alphaTestRef ?? '',
  ].join('|');
}
function layoutKey(g) {
  const attrs = Object.keys(g.attributes).sort()
    .map(k => `${k}:${g.attributes[k].itemSize}:${g.attributes[k].normalized ? 1 : 0}`);
  return `${g.index ? 'i' : 'n'}|${attrs.join(',')}`;
}

/** A batch material from a mesh's bound one: the same combine (its
 *  `onBeforeCompile` and cache key), the shade uniform white, and for an
 *  alpha-LOD material the far state fixed: cut at the authored reference,
 *  no blend. */
function batchMaterial(template, far) {
  const m = template.clone();
  m.onBeforeCompile = template.onBeforeCompile;
  m.customProgramCacheKey = template.customProgramCacheKey;
  m.userData = template.userData;
  m.bfShade = template.bfShade;
  m.bfEnv = template.bfEnv;
  if (far) {
    m.blending = THREE.NoBlending;
    m.alphaTest = template.userData?.alphaTestRef ?? template.alphaTest;
    // A transparent two-sided material is drawn by three in two passes,
    // back faces then front, each pass marking the material changed
    // (`renderBufferDirect`, `material.needsUpdate = true` twice a draw) and
    // so re-resolving its program. A cut with no blend needs no order
    // between its faces: one pass.
    m.forceSinglePass = true;
  }
  m.needsUpdate = true;
  return m;
}

/**
 * Build the batches for `root`'s placements (`cull`, the level root's static
 * children with their cull spheres tagged) and hide what they draw.
 * Returns the batching, with `update()` for the frame and `report()` for
 * the record, or null when nothing qualified.
 */
export function buildBatches({ root, cull, lifted, shading, meshCull, minShare = 10, freeze = null }) {
  const skipped = Object.fromEntries(SKIP.map(k => [k, 0]));
  // The alpha-LOD entries by material: the instance's near/far switch.
  const alphaOf = new Map();
  for (const entry of shading.alphaLodMeshes ?? []) for (const m of entry.mats) alphaOf.set(m, entry);
  // Pass 1: the placements that qualify, and how many meshes share each geometry.
  const candidates = [];
  const shares = new Map();
  const eachMesh = (units, fn) => {
    for (const mesh of units.meshes) fn(mesh, null, 0);
    for (const chain of units.chains) chain.rungs.forEach((rung, i) => { for (const mesh of rung) fn(mesh, chain, i); });
  };
  for (const child of cull) {
    const units = placementUnits(child, lifted);
    if (typeof units === 'string') { skipped[units]++; continue; }
    // An alpha-LOD mesh inside a chain would need its rung and its reach at
    // once; the placement keeps its meshes.
    let alphaChain = false;
    eachMesh(units, (mesh, chain) => { if (chain && alphaOf.has(mesh.material)) alphaChain = true; });
    if (alphaChain) { skipped.alphaChain++; continue; }
    candidates.push({ child, units });
    eachMesh(units, mesh => shares.set(mesh.geometry, (shares.get(mesh.geometry) || 0) + 1));
  }
  // Pass 2: a placement is batched only when every mesh of it is shared enough.
  const placements = candidates.filter(({ units }) => {
    let ok = true;
    eachMesh(units, mesh => { if (shares.get(mesh.geometry) < minShare) ok = false; });
    if (!ok) skipped.share++;
    return ok;
  });
  if (!placements.length) return null;

  // Pass 3: group the meshes into batches by material and layout.
  const groups = new Map();
  const records = [];   // one per instance: what the frame tests
  const chainRecords = [];
  const chainIndex = new Map();
  const v = new THREE.Vector3();
  for (const { child, units } of placements) {
    eachMesh(units, (mesh, chain, rung) => {
      const m = mesh.material;
      const alpha = alphaOf.get(m) ?? null;
      const key = `${materialKey(m)}#${layoutKey(mesh.geometry)}${alpha ? '#alpha' : ''}`;
      let group = groups.get(key);
      if (!group) {
        group = { key, template: m, alpha: !!alpha, meshes: [], geometries: new Map() };
        groups.set(key, group);
      }
      group.meshes.push(mesh);
      group.geometries.set(mesh.geometry, (group.geometries.get(mesh.geometry) || 0) + 1);
      let ci = -1;
      if (chain) {
        ci = chainIndex.get(chain) ?? -1;
        if (ci < 0) {
          // The chain's selection, as `liftLods`' `lod.update` makes it: the
          // part's cull spec with the rungs' distances appended, else the
          // rungs' distances alone; the distance from the wrapper's origin.
          const spec = meshCull ? meshCullSpec(chain.part, meshCull) : null;
          if (spec) spec.dists.push(...chain.wrapper.levels.map(level => level.distance));
          chain.wrapper.getWorldPosition(v);
          ci = chainRecords.length;
          chainRecords.push({ spec, dists: chain.wrapper.levels.map(level => level.distance),
                              x: v.x, y: v.y, z: v.z, level: -2 });
          chainIndex.set(chain, ci);
        }
      }
      records.push({ child, mesh, group, alpha, chain: ci, rung });
    });
  }

  // The batches: one `BatchedMesh` per group; an alpha-LOD group's holds the far state.
  const batches = [];
  const colour = new THREE.Color();
  for (const group of groups.values()) {
    let vertices = 0, indices = 0;
    for (const g of group.geometries.keys()) {
      vertices += g.attributes.position.count;
      indices += g.index ? g.index.count : 0;
    }
    const batch = new THREE.BatchedMesh(group.meshes.length, vertices, Math.max(indices, 1), batchMaterial(group.template, group.alpha));
    batch.name = `batch ${group.template.name || ''}${group.alpha ? ' far' : ''}`;
    batch.frustumCulled = false;
    batch.perObjectFrustumCulled = false;
    batch.sortObjects = false;
    batch.matrixAutoUpdate = false;
    batch.userData.batch = true;
    // three r169's `setProgram` asks a batched mesh for `colorTexture`
    // (`object.colorTexture !== null` on a material compiled without
    // instance colours), which `BatchedMesh` never defines, so every
    // colourless batch re-resolved its program every frame:
    // `getProgram` + `getProgramCacheKey` 0.65 ms a frame over 235
    // batches on Varsity. The property it meant, answered.
    Object.defineProperty(batch, 'colorTexture', { get() { return this._colorsTexture; } });
    const ids = new Map();
    for (const g of group.geometries.keys()) ids.set(g, batch.addGeometry(g));
    batch.geometryIds = ids;
    batches.push(batch);
    group.batch = batch;
  }

  // The instances, and the flat arrays the frame reads.
  const n = records.length;
  const px = new Float64Array(n), py = new Float64Array(n), pz = new Float64Array(n), pr = new Float64Array(n);
  const sx = new Float64Array(n), sy = new Float64Array(n), sz = new Float64Array(n);
  const sa = new Float64Array(n).fill(-1), sb = new Float64Array(n);
  const ax = new Float64Array(n), ay = new Float64Array(n), az = new Float64Array(n), ar2 = new Float64Array(n).fill(-1);
  const chainOf = new Int32Array(n).fill(-1), rungOf = new Int32Array(n);
  const ids = new Int32Array(n);
  const batchOf = new Array(n);
  const nearMesh = new Array(n);       // an alpha-LOD mesh, drawn itself when near
  const vis = new Uint8Array(n).fill(1), visNear = new Uint8Array(n);
  const p = new THREE.Vector3();
  const batchedPlacements = new Set();
  const keptVisible = new Set();       // placements a near mesh may still draw under
  let shaded = 0;
  for (let i = 0; i < n; i++) {
    const { child, mesh, group, alpha, chain, rung } = records[i];
    batchedPlacements.add(child);
    const c = child.userData.cullCenter;
    px[i] = c?.x ?? 0; py[i] = c?.y ?? 0; pz[i] = c?.z ?? 0;
    pr[i] = c ? (child.userData.cullRadius || 0) : Infinity;
    chainOf[i] = chain; rungOf[i] = rung;
    // The small-mesh cull's part: the mesh's parent when the mesh is one of
    // its LOD-0 children, else the mesh itself. A chain's part takes the
    // same test inside its selection instead.
    if (meshCull && chain < 0) {
      const parent = mesh.parent;
      const part = parent && parent !== root && lod0Meshes(parent).includes(mesh) && meshCullSpec(parent, meshCull)
        ? parent : (meshCullSpec(mesh, meshCull) ? mesh : null);
      const spec = part ? meshCullSpec(part, meshCull) : null;
      if (spec && spec.r < GLOBAL_LOD_RADIUS) {
        const terms = cullTerms(spec);
        part.getWorldPosition(p);
        sx[i] = p.x; sy[i] = p.y; sz[i] = p.z; sa[i] = terms.a; sb[i] = terms.b;
      }
    }
    if (alpha) {
      ax[i] = alpha.at.x; ay[i] = alpha.at.y; az[i] = alpha.at.z; ar2[i] = alpha.reach2;
      nearMesh[i] = mesh;
      mesh.visible = false;
      keptVisible.add(child);
    }
    batchOf[i] = group.batch;
    ids[i] = group.batch.addInstance(group.batch.geometryIds.get(mesh.geometry));
    group.batch.setMatrixAt(ids[i], mesh.matrixWorld);
    // The shade the terrain pass gave the mesh already, or will give it
    // (`bindTerrainShade` writes a batched mesh's shade through this record).
    const record = {
      setShade: f => { colour.setRGB(f[0], f[1], f[2]); group.batch.setColorAt(ids[i], colour); },
    };
    mesh.userData.batchInstance = record;
    const sv = mesh.material.bfShade?.value;
    if (sv && sv.w >= 0.5) { record.setShade([sv.x, sv.y, sv.z]); shaded++; }
    mesh.material.bfBatched = true;
  }
  // The batch materials' own shade uniform stays white: the instances carry
  // theirs. (A near alpha-LOD mesh keeps its own material and its own
  // uniform; the terrain pass writes both through the record.)
  for (const group of groups.values()) if (!group.alpha) group.template.bfShade?.value.set(1, 1, 1, 0);
  // Hide what the batches draw: a placement whole, or, where a near mesh
  // may still draw under it, its batched meshes one by one. A chain's
  // wrapper is hidden with its part and leaves the cull list with it:
  // shown again by the draw-distance test, three would run its `update` and
  // draw its rungs over the instances.
  const placementCount = batchedPlacements.size;
  for (const child of batchedPlacements) {
    if (!keptVisible.has(child)) { child.visible = false; continue; }
    child.visible = true;
  }
  for (let i = 0; i < n; i++) if (keptVisible.has(records[i].child)) records[i].mesh.visible = false;
  for (const chain of chainIndex.keys()) { chain.wrapper.visible = false; batchedPlacements.add(chain.wrapper); }
  for (const batch of batches) {
    root.add(batch);
    batch.updateMatrixWorld(true);
    freeze?.(batch);
  }

  // What the last frame tested against, so a still camera costs nothing.
  let lastLimit = NaN, lastEntire = null, lastFov = NaN, lastPercent = NaN, lastZoom = NaN;
  const lastView = new Float64Array(16).fill(NaN);
  const viewProj = new THREE.Matrix4();
  const frustum = new THREE.Frustum();
  const planes = new Float64Array(24);
  const chains = chainRecords;
  /** The margin a sphere is tested with: the camera the draw uses may be a
   *  shake's few centimetres from the one tested here. */
  const FRUSTUM_PAD = 1;
  return {
    placements: batchedPlacements,
    batches,
    /** The frame's instance visibility: the placement's draw-distance sphere,
     *  its frustum test (three culls a `Mesh` by its sphere; a batch has no
     *  per-instance cull of its own here, `perObjectFrustumCulled` being a
     *  scan of every instance a frame), the part's small-mesh test, a
     *  chain's rung, and the alpha LOD's near/far switch. `fov` is the
     *  camera's FOV modifier, `percent` the GRAPHICS QUALITY LOD percent. */
    update(camera, limit, entire, fov, percent) {
      camera.updateMatrixWorld();
      viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const e = viewProj.elements;
      let same = limit === lastLimit && entire === lastEntire && fov === lastFov && percent === lastPercent && camera.zoom === lastZoom;
      for (let i = 0; same && i < 16; i++) same = e[i] === lastView[i];
      if (same) return;
      for (let i = 0; i < 16; i++) lastView[i] = e[i];
      lastLimit = limit; lastEntire = entire; lastFov = fov; lastPercent = percent; lastZoom = camera.zoom;
      frustum.setFromProjectionMatrix(viewProj);
      for (let k = 0; k < 6; k++) {
        const pl = frustum.planes[k];
        planes[k * 4] = pl.normal.x; planes[k * 4 + 1] = pl.normal.y; planes[k * 4 + 2] = pl.normal.z; planes[k * 4 + 3] = pl.constant;
      }
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      const zoom = camera.zoom;
      const fovTerm = fov * percent;
      for (const ch of chains) {
        const dx = ch.x - cx, dy = ch.y - cy, dz = ch.z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (ch.spec) {
          ch.level = Math.max(-1, selectLod(ch.spec, d2, fov, percent));
        } else {
          const distance = Math.sqrt(d2) / zoom;
          let showing = -1;
          for (let i = 0; i < ch.dists.length; i++) { if (distance >= ch.dists[i]) showing = i; else break; }
          ch.level = showing + 1;
        }
      }
      for (let i = 0; i < n; i++) {
        // What the placement's own tests say, before the frustum: the near
        // mesh takes three's own frustum test.
        let shown = entire;
        if (!shown) {
          const dx = px[i] - cx, dy = py[i] - cy, dz = pz[i] - cz;
          const reach = limit + pr[i];
          shown = dx * dx + dy * dy + dz * dz <= reach * reach;
        }
        if (shown && !entire && sa[i] >= 0) {
          const dx = sx[i] - cx, dy = sy[i] - cy, dz = sz[i] - cz;
          if (dx * dx + dy * dy + dz * dz > sa[i] * fovTerm + sb[i]) shown = false;
        }
        if (shown && chainOf[i] >= 0 && chains[chainOf[i]].level !== rungOf[i]) shown = false;
        let near = false;
        if (ar2[i] >= 0) {
          const dx = ax[i] - cx, dy = ay[i] - cy, dz = az[i] - cz;
          near = dx * dx + dy * dy + dz * dz <= ar2[i];
          const vn = shown && near ? 1 : 0;
          if (vn !== visNear[i]) { visNear[i] = vn; nearMesh[i].visible = !!vn; }
        }
        let inst = shown && !near;
        if (inst) {
          // The sphere against the six planes, as `Frustum.intersectsSphere`.
          const x = px[i], y = py[i], z = pz[i], r = -(pr[i] + FRUSTUM_PAD);
          for (let k = 0; k < 24; k += 4) {
            if (planes[k] * x + planes[k + 1] * y + planes[k + 2] * z + planes[k + 3] < r) { inst = false; break; }
          }
        }
        const vi = inst ? 1 : 0;
        if (vi !== vis[i]) { vis[i] = vi; batchOf[i].setVisibleAt(ids[i], inst); }
      }
    },
    /** The instances within `radius` of `(x, z)` and what the last update
     *  decided for each: for `?shots` checks against the unbatched page. */
    debug(x, z, radius = 40) {
      const out = [];
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(px[i] - x, pz[i] - z);
        if (d > radius) continue;
        const { child, mesh, group, chain, rung } = records[i];
        out.push({
          name: (child.name || '').slice(0, 40), mesh: (mesh.name || '').slice(0, 30), d: +d.toFixed(1),
          r: +pr[i].toFixed(2), rung, level: chain >= 0 ? chains[chain].level : null,
          small: sa[i] >= 0, alpha: ar2[i] >= 0, instance: vis[i], nearMesh: ar2[i] >= 0 ? visNear[i] : null,
          batch: group.batch.name.slice(0, 40),
        });
      }
      return out.sort((a, b) => a.d - b.d);
    },
    report() {
      let visible = 0, nearShown = 0;
      for (let i = 0; i < n; i++) { visible += vis[i]; nearShown += visNear[i]; }
      return {
        minShare, placements: placementCount, instances: n, batches: batches.length,
        groups: groups.size, chains: chains.length, shaded, visible, nearShown,
        skipped: { ...skipped }, candidates: candidates.length,
      };
    },
    dispose() {
      for (const batch of batches) {
        batch.removeFromParent();
        batch.dispose();
        batch.material.dispose();
      }
      batches.length = 0;
    },
  };
}
