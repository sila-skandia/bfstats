// What the camera cannot see, left out of the draw (draw-cull.js)
// (features/replay-performance, "A phone at a full server").
//
// A full server's replay keeps every hull and dropped kit of the round that
// is alive at the clock shown: 73 hulls of 1,800 shown nodes at 900 s of the
// Liberation of Caen round, against a far plane of 177 m on a phone (75 %
// view distance). three walks every shown node's matrix and tests every
// shown mesh against the frustum, each frame, and then draws none of those
// out of view. So, for the length of one draw, a subtree whose bounding
// sphere lies wholly outside the view frustum is hidden, and put back the
// moment the draw is done: nothing outside the render sees `visible` change,
// and the picture is the same, since the frustum would have culled every
// mesh of it. The shadow pass draws first, from everything.
//
// A hidden subtree's matrices are not walked meanwhile, which is the replay's
// rule for any hidden node already: whatever reads one brings its chain up
// to date first (`getWorldPosition`, `updateWorldMatrix`; round-launch.js
// `barrelLaunch`).
//
// Where a subtree is: its `userData.cullAt` node (a hull's group stands at
// the origin and its `root` moves), else itself, read from that node's own
// `position` (or hand-set `matrix`) through its parent's world matrix, which
// does not move. The radius is measured once a subtree has a box (never
// cached empty: a model still loading is measured when it arrives), about
// that point, and never taken under `MIN_RADIUS`, so a turret swung out or a
// wreck thrown clear stays inside it.

import * as THREE from 'three';

let enabled = true;
/** Turn the cull off and on (`?cull=0`, and the probes' before-and-after:
 *  `window.__drawCull` under `?shots`). */
export function setDrawCull(on) { enabled = !!on; }
export function drawCullOn() { return enabled; }
/** How many subtrees the last draw left out. */
export let lastHidden = 0;

/** No subtree is taken as smaller than this, in metres. */
export const MIN_RADIUS = 20;

const _box = new THREE.Box3();
const _part = new THREE.Box3();
const _centre = new THREE.Vector3();
const _size = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _viewProj = new THREE.Matrix4();
const _sphere = new THREE.Sphere();
const RADIUS = Symbol('drawCullRadius');

/** Where `node` is now, into `out`: `{ x, y, z }` or null. */
function placeOf(node, out) {
  const at = node.userData?.cullAt ?? node;
  let px, py, pz;
  if (at.matrixAutoUpdate) ({ x: px, y: py, z: pz } = at.position);
  else { const l = at.matrix.elements; px = l[12]; py = l[13]; pz = l[14]; }
  const parent = at.parent;
  if (!parent) { out.set(px, py, pz); return out; }
  const m = parent.matrixWorld.elements;
  out.set(m[0] * px + m[4] * py + m[8] * pz + m[12],
          m[1] * px + m[5] * py + m[9] * pz + m[13],
          m[2] * px + m[6] * py + m[10] * pz + m[14]);
  return Number.isFinite(out.x + out.y + out.z) ? out : null;
}

/** `node`'s bounding radius about its place, or null with nothing shown
 *  yet. Measured once over its shown meshes (a hull's wreck waits unplaced
 *  until it burns), with its matrices brought current. */
export function radiusOf(node) {
  const known = node[RADIUS];
  if (known !== undefined) return known;
  node.updateWorldMatrix(true, true);
  _box.makeEmpty();
  const expand = obj => {
    if (!obj.visible) return;
    const geometry = obj.geometry;
    if (geometry) {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (geometry.boundingBox && !geometry.boundingBox.isEmpty()) {
        _part.copy(geometry.boundingBox).applyMatrix4(obj.matrixWorld);
        _box.union(_part);
      }
    }
    for (const child of obj.children) expand(child);
  };
  expand(node);
  if (_box.isEmpty()) return null;
  const at = node.userData?.cullAt ?? node;
  const e = at.matrixWorld.elements;
  _box.getCenter(_centre);
  _box.getSize(_size);
  const r = Math.hypot(_centre.x - e[12], _centre.y - e[13], _centre.z - e[14]) + _size.length() / 2;
  if (!Number.isFinite(r)) return null;
  return (node[RADIUS] = Math.max(MIN_RADIUS, r));
}

/**
 * Hide every shown child of `roots` whose bounding sphere lies wholly outside
 * `camera`'s view. Returns a function that shows them again, or null when
 * nothing was hidden.
 */
export function hideOutsideView(camera, roots) {
  if (!enabled || !camera?.projectionMatrix || !roots?.length) { lastHidden = 0; return null; }
  camera.updateMatrixWorld();
  _viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_viewProj);
  let hidden = null;
  for (const root of roots) {
    if (!root?.children) continue;
    for (const child of root.children) {
      if (!child.visible) continue;
      if (!placeOf(child, _sphere.center)) continue;
      // Within the smallest radius taken of the view: no need to measure.
      _sphere.radius = MIN_RADIUS;
      if (_frustum.intersectsSphere(_sphere)) continue;
      const r = radiusOf(child);
      if (r === null) continue;
      _sphere.radius = r;
      if (_frustum.intersectsSphere(_sphere)) continue;
      child.visible = false;
      (hidden ??= []).push(child);
    }
  }
  lastHidden = hidden?.length ?? 0;
  if (!hidden) return null;
  return () => { for (const child of hidden) child.visible = true; };
}
