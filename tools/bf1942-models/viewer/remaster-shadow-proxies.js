// Remaster mode's shadow proxies (features/remaster-browser, "Shadows").
//
// three's WebGPU renderer pays, in JavaScript, for every object in every
// shadow cascade: Wake's few thousand separate static meshes (each palm is a
// trunk, branch cards and leaf sprites) cost 6 to 10 ms a frame at a 70 m
// foliage reach and twice that out to the fog. Nothing about a static mesh's
// shadow changes after the level loads, so at load the static casters are
// merged, by 128 m tile and by texture, into a few dozen meshes that only
// the shadow pass draws (layer SHADOW_LAYER, which the sun's shadow cameras
// see and the main camera does not), and the originals stop casting.
//
// - Opaque parts merge into one mesh a tile, drawn with no texture.
// - Cut-outs (branch cards, wire, nets) merge per texture and keep their
//   alpha cut.
// - Leaf sprites, which face the eye in the main pass, are baked facing the
//   sun: in the sun's shadow camera that is the face that shadows. Their
//   wind sway is left out of the shadow (a few centimetres at 100 m).
// - Moving things (vehicles, soldiers, flags, effects) keep casting
//   themselves, on both layers, culled by reach.
//
// A static that is later removed (a destroyed bridge span) is dropped from
// its tile's proxy: `refresh` rebuilds a tile when one of its sources is
// detached from the scene or hidden for good.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from './vendor/utils/BufferGeometryUtils.js';

export const SHADOW_LAYER = 1;
const TILE = 128;
const CUT = 0.42;

/** True when `obj` sits under something that moves: a vehicle, a flag, a soldier. */
export function isMoving(obj) {
  for (let p = obj; p; p = p.parent) {
    const k = p.userData?.kind;
    if (k === 'controlPoints' || k === 'flagCloth' || k === 'flagClothAlt' || k === 'effects') return true;
    if (p.isSkinnedMesh || p.isBone) return true;
  }
  return false;
}

/** True when `obj` is part of a vehicle: parked it is static, driven it moves. */
export function isVehicle(obj) {
  for (let p = obj; p; p = p.parent) if (p.userData?.kind === 'spawners') return true;
  return false;
}

const moved = (o, snap) => {
  const e = o.matrixWorld.elements;
  for (let i = 0; i < 16; i++) if (Math.abs(e[i] - snap[i]) > 1e-3) return true;
  return false;
};

/** World-space copy of `mesh`'s geometry for one shadow proxy, or null. */
function worldGeometry(mesh, sunRight, sunUp) {
  const src = mesh.geometry;
  const pos = src.getAttribute('position');
  if (!pos) return null;
  const g = new THREE.BufferGeometry();
  const n = pos.count;
  const out = new Float32Array(n * 3);
  const m = mesh.matrixWorld;
  const v = new THREE.Vector3();
  const center = src.getAttribute('treeCenter');
  const offset = src.getAttribute('treeOffset');
  if (center && offset) {
    // A leaf sprite: rebuilt around its centre facing the sun, scaled by the
    // mesh's own scale (remaster-foliage.js `spriteNodes`).
    const s = new THREE.Vector3();
    m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(center, i).applyMatrix4(m);
      v.addScaledVector(sunRight, offset.getX(i) * s.x).addScaledVector(sunUp, offset.getY(i) * s.y);
      out.set([v.x, v.y, v.z], i * 3);
    }
  } else {
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      out.set([v.x, v.y, v.z], i * 3);
    }
  }
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  // UVs as plain floats: glTF may store them normalized and narrower, and
  // parts of differing types do not merge.
  const uv = src.getAttribute('uv');
  const uvs = new Float32Array(n * 2);
  if (uv) for (let i = 0; i < n; i++) { uvs[i * 2] = uv.getX(i); uvs[i * 2 + 1] = uv.getY(i); }
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  // Every proxy part indexed, so parts with and without an index merge.
  if (src.index) g.setIndex(src.index.clone());
  else g.setIndex([...Array(n).keys()]);
  // A mirrored placement turns its triangles inside out; the proxy is drawn
  // double-sided, so the winding does not matter.
  return g;
}

/**
 * The proxies for one scene. `build(casters, sunDir)` at load, `refresh()`
 * every second or so. `casters` are the caster records the renderer keeps
 * (`{ obj }`); the static ones are taken over and their `castShadow` cleared.
 */
export function createShadowProxies(scene) {
  const root = new THREE.Group();
  root.name = 'remaster shadow proxies';
  root.matrixAutoUpdate = false;
  scene.add(root);
  const opaque = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  opaque.name = 'shadow proxy';
  const cutByMap = new Map();
  const cutMaterial = map => {
    let m = cutByMap.get(map);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ map, alphaTest: CUT, side: THREE.DoubleSide });
      m.name = 'shadow proxy (cut)';
      cutByMap.set(map, m);
    }
    return m;
  };
  // tile key -> { sources: [mesh], meshes: [proxy] }
  const tiles = new Map();
  const taken = new Set();
  const records = new Map();   // source mesh -> caster record
  const watch = new Map();     // vehicle part -> world matrix when proxied
  let sunRight = new THREE.Vector3(1, 0, 0);
  let sunUp = new THREE.Vector3(0, 0, 1);

  function tileOf(mesh) {
    const p = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
    return `${Math.floor(p.x / TILE)},${Math.floor(p.z / TILE)}`;
  }

  function buildTile(key, tile) {
    for (const m of tile.meshes) { root.remove(m); m.geometry.dispose(); }
    tile.meshes = [];
    tile.sources = tile.sources.filter(s => s.parent && !s.userData.destroyed);
    const groups = new Map();   // material -> [geometry]
    for (const s of tile.sources) {
      s.updateWorldMatrix(true, false);
      const mats = [s.material].flat();
      const m = mats[0];
      const cut = m && (m.alphaTest > 0 || m.transparent || m.remasterSprite) && m.map;
      const mat = cut ? cutMaterial(m.map) : opaque;
      const g = worldGeometry(s, sunRight, sunUp);
      if (!g) continue;
      if (!groups.has(mat)) groups.set(mat, []);
      groups.get(mat).push(g);
    }
    for (const [mat, list] of groups) {
      const merged = mergeGeometries(list, false);
      list.forEach(g => g.dispose());
      if (!merged) continue;
      merged.computeBoundingSphere();
      const proxy = new THREE.Mesh(merged, mat);
      proxy.name = `shadow proxy ${key}`;
      proxy.castShadow = true;
      proxy.receiveShadow = false;
      proxy.layers.set(SHADOW_LAYER);
      proxy.matrixAutoUpdate = false;
      proxy.userData.shadowProxy = true;
      proxy.userData.rmShadow = true;
      root.add(proxy);
      tile.meshes.push(proxy);
    }
  }

  function clear() {
    for (const tile of tiles.values()) for (const m of tile.meshes) { root.remove(m); m.geometry.dispose(); }
    tiles.clear();
    taken.clear();
    records.clear();
    watch.clear();
  }

  /** `o` casts for itself again; its tile is rebuilt without it. */
  function release(o) {
    const c = records.get(o);
    if (c) c.proxied = false;
    taken.delete(o);
    records.delete(o);
    watch.delete(o);
    for (const [key, tile] of tiles) {
      const i = tile.sources.indexOf(o);
      if (i >= 0) { tile.sources.splice(i, 1); tile.dirty = true; }
    }
  }

  return {
    root,
    /** Take the static casters over; returns how many meshes became how many proxies. */
    build(casters, toward) {
      clear();
      // A basis across the sun's beam for the leaf cards.
      const d = toward.clone().normalize();
      sunRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), d);
      if (sunRight.lengthSq() < 1e-6) sunRight.set(1, 0, 0);
      sunRight.normalize();
      sunUp = new THREE.Vector3().crossVectors(d, sunRight).normalize();
      for (const c of casters) {
        const o = c.obj;
        if (c.dynamic || o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh || isMoving(o)) continue;
        // A mesh made of several materials keeps casting itself.
        if (Array.isArray(o.material) && o.material.length > 1) continue;
        // A vehicle part hidden now (another seat's gun, a damage state) is
        // left to cast for itself when it shows.
        if (isVehicle(o)) {
          let shown = true;
          for (let p = o; p && shown; p = p.parent) if (!p.visible) shown = false;
          if (!shown) continue;
        }
        const key = tileOf(o);
        if (!tiles.has(key)) tiles.set(key, { sources: [], meshes: [] });
        tiles.get(key).sources.push(o);
        taken.add(o);
        records.set(o, c);
        // A parked vehicle's part: watched, and handed back to cast for
        // itself the moment it moves or hides (driven, turned, wrecked).
        if (isVehicle(o)) { o.updateWorldMatrix(true, false); watch.set(o, o.matrixWorld.elements.slice()); }
        c.proxied = true;
        o.castShadow = false;
      }
      let proxies = 0;
      for (const [key, tile] of tiles) { buildTile(key, tile); proxies += tile.meshes.length; }
      return { sources: taken.size, proxies };
    },
    /** A tile one of whose sources left the scene or hid for good is rebuilt. */
    refresh(casters = []) {
      // A vehicle part that shows and has stood still since the last look
      // joins its tile's proxy (it was hidden, or moving, when the level
      // built them).
      for (const c of casters) {
        const o = c.obj;
        if (c.proxied || !o.parent || !isVehicle(o) || o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh) continue;
        if (Array.isArray(o.material) && o.material.length > 1) continue;
        let shown = true;
        for (let p = o; p && shown; p = p.parent) if (!p.visible) shown = false;
        if (!shown) { c.still = null; continue; }
        o.updateWorldMatrix(true, false);
        if (!c.still || moved(o, c.still)) { c.still = o.matrixWorld.elements.slice(); continue; }
        const key = tileOf(o);
        if (!tiles.has(key)) tiles.set(key, { sources: [], meshes: [] });
        const tile = tiles.get(key);
        tile.sources.push(o);
        tile.dirty = true;
        taken.add(o);
        records.set(o, c);
        watch.set(o, c.still);
        c.proxied = true;
        o.castShadow = false;
      }
      for (const [o, snap] of watch) {
        let shown = !!o.parent;
        for (let p = o; p && shown; p = p.parent) if (!p.visible) shown = false;
        if (!shown || moved(o, snap)) release(o);
      }
      // One tile a look: a rebuild merges a tile's geometry again (a few
      // milliseconds), and spread out it never stacks into a hitch.
      for (const [key, tile] of tiles) {
        if (tile.dirty || tile.sources.some(s => !s.parent || s.userData.destroyed)) {
          tile.dirty = false;
          buildTile(key, tile);
          break;
        }
      }
    },
    taken: o => taken.has(o),
    get count() { return root.children.length; },
  };
}
