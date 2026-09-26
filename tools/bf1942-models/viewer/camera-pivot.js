// A seat Camera's `setPivotPosition`: where retail actually puts the eye.
//
// Imports nothing, so the node harnesses load it as is.
//
// `Camera::handleUpdate` (lnxded `0x081aa940`) rebuilds the camera's own
// transform, on its first update and before the `maxSpeed == 0` early return
// every gunner camera takes, as `T(pivotPosition) * R(angles) *
// getBundleTransformation()` -- the same product `RotationalBundle::setState`
// (`0x081d8110`, GUN-3) builds, with the pivot read from template `+0x168`.
// Refractor multiplies row vectors, so the camera's origin lands at the
// bundle's `setPosition` plus the pivot turned by the bundle's `setRotation`:
// the pivot is the eye's offset in the Camera's own frame, not a hinge.
//
// Vanilla, XPack1 and XPack2 declare a non-zero pivot on 13 Cameras. Eleven
// are a ~0.25 m head nudge on open-top jeeps, the Lynx, the Katyusha and the
// Wasserfall (`0/0.25/0.3`, `0/0.25/0.2`). The other two are the half-tracks'
// ring-mount Browning, `M3A1Camera2` and XPack1's `M3GMCCamera2`, both
// `0/0.3/-1`: their Camera node sits 0.15 m up the barrel from the gun's own
// origin, and the pivot is what backs the eye out 1 m and up 0.3 m so the
// gunner looks along the receiver from behind the spade grips. Without it the
// view was taken from inside the barrel, the flash hider filling the screen.
//
// The exporter ships the pivot in Refractor's frame (z forward) as
// `extras.physics.pivotPosition` on the Camera node (`bf42/con.py`
// `_pivot()`), while the glTF node tree has had its z negated. `applyCameraPivot`
// folds it into the node's local translation once, so every reader of the
// Camera node's world pose -- the seat view, the chase anchor, the manned
// fallback, the model browser -- sees retail's eye point at rest. The look
// swing (`R(angles)` turns the pivot with the head: the jeeps and the Lynx
// free-look at 90 deg/s) is `VehicleCamera`'s, in `vehicle-camera.js`.

/**
 * The declared pivot in glTF axes (z negated), or null when the node has none.
 * @param {{physics?: {pivotPosition?: number[]}} | null | undefined} data
 * @returns {number[] | null}
 */
export function cameraPivotOffset(data) {
  const p = data?.physics?.pivotPosition;
  if (data?.templateKind !== 'Camera' || !Array.isArray(p) || p.length !== 3) return null;
  if (!p.some(v => v)) return null;
  return [p[0], p[1], -p[2]];
}

/**
 * Move a Camera node's local position onto its retail eye point, once.
 *
 * Idempotent: the node is stamped `userData.pivotApplied`, and because
 * `Object3D.copy` deep-copies `userData` alongside the already-moved position,
 * a clone of an adjusted node is left alone too.
 *
 * @param {{userData?: object, position: {x: number, y: number, z: number},
 *   quaternion: {x: number, y: number, z: number, w: number},
 *   updateMatrix?: () => void}} node a three.js Object3D (duck-typed)
 * @returns {boolean} true when this call moved the node
 */
export function applyCameraPivot(node) {
  const data = node?.userData;
  if (!data || data.pivotApplied) return false;
  const offset = cameraPivotOffset(data);
  if (!offset) return false;
  const [x, y, z] = rotate(node.quaternion, offset);
  node.position.x += x;
  node.position.y += y;
  node.position.z += z;
  data.pivotApplied = true;
  node.updateMatrix?.();
  return true;
}

/** Apply `applyCameraPivot` to every Camera node under `root`. */
export function applyCameraPivots(root) {
  let moved = 0;
  root?.traverse?.(obj => { if (applyCameraPivot(obj)) moved += 1; });
  return moved;
}

/** Rotate vector `v` by unit quaternion `q` (q v q*). */
function rotate(q, v) {
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const [vx, vy, vz] = v;
  // t = 2 (q.xyz x v); v' = v + w t + q.xyz x t
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}
