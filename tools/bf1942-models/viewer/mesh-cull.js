// Which LOD of a static mesh the client draws, and when it draws none:
// `StandardMesh_selectLod` (client 0x005adfd0), the colour pass's own call
// from `StandardMesh_drawLod` (0x005aef19, which skips the mesh on -1 at
// 0x005aef1e). `features/mesh-lod-chains/README.md`, "Retail's small-mesh
// cull".
//
//   e = d^2 / m - r^2
//   k = globalLodPercent x sizeFactor x fovModifier
//   lod = the highest i with dist[i]^2 x k < e, else 0
//   culled when r < globalLodRadius, lod is the last, and
//               (dist[last]^2 + 2500) x k < e
//
// `d` is the camera's distance from the mesh's origin (its node, +0xa8, world
// translation). `r` is the mesh's `+0x4c`: the largest distance of its
// bounding box's eight corners from that origin (`0x005ae9a0`, kept by
// `setScale` 0x005af6c0), after `GeometryTemplate.scale`. `m` is the mesh's
// `+0x60`, the largest component of that scale (`setScale`). `dist[]` is the
// template's table at `+0xd8`, cut to the levels the client keeps (SM-11).
// `sizeFactor` is `r / (globalLodRadiusScaleFactor x cullFactor)` below
// `globalLodRadius` and 1 otherwise (0x005ae07d..0x005ae0af); `cullFactor`
// is the template's `+0x11c` (0.03, ctor 0x005b5c5c). `fovModifier` is the
// render view's `+0x1c` (vt +0x20, 0x00836030): `setFieldOfView`
// (0x005b7b40) keeps cot(fov/2) / cot(first fov/2), and the first
// `setFieldOfView` is VideoDefault.con's `renderer.fieldOfView 1`, so 1 at
// the 1 rad lens and more zoomed in.

/** `renderer.globalLodRadius`: 5 from the renderer's constructor
 *  (0x0064033d), 1 from `Settings/VideoDefault.con`, which the client runs. */
export const GLOBAL_LOD_RADIUS = 1;
/** `renderer.globalLodRadiusScaleFactor` (renderer `+0x13c`): 5, the
 *  constructor's and VideoDefault.con's. */
export const GLOBAL_LOD_RADIUS_SCALE = 5;
/** `renderer.globalLodPercent` (renderer `+0x130`) at GRAPHICS QUALITY high:
 *  the video settings' apply (0x006b0e19..0x006b0e82) sets 1, 0.8 and 0.6 for
 *  high, medium and low. */
export const GLOBAL_LOD_PERCENT = 1;
/** `GeometryTemplate.cullFactor` until a script sets one (0x005b5c5c). */
export const DEFAULT_CULL_FACTOR = 0.03;
/** The constant the cull adds to the last LOD's squared distance (0x009057b8). */
export const CULL_PAD = 2500;
/** The first `setFieldOfView`, 1 rad (VideoDefault.con), as half a tangent. */
const START_HALF_TAN = Math.tan(0.5);

/** The render view's FOV modifier for a three camera: vertical `fov` in
 *  degrees, narrowed by `zoom` the way three's projection narrows it. */
export function fovModifier(fovDeg, zoom = 1) {
  const halfTan = Math.tan((fovDeg * Math.PI) / 360) / (zoom || 1);
  return halfTan > 0 ? START_HALF_TAN / halfTan : 1;
}

/** `sizeFactor`: the small-mesh term, 1 at and above `globalLodRadius`. */
export function sizeFactor(r, cullFactor = DEFAULT_CULL_FACTOR) {
  return r < GLOBAL_LOD_RADIUS ? r / (GLOBAL_LOD_RADIUS_SCALE * cullFactor) : 1;
}

/** `r`: the largest distance of a box's corners from the origin. */
export function originRadius(box) {
  const x = Math.max(Math.abs(box.min.x), Math.abs(box.max.x));
  const y = Math.max(Math.abs(box.min.y), Math.abs(box.max.y));
  const z = Math.max(Math.abs(box.min.z), Math.abs(box.max.z));
  return Math.sqrt(x * x + y * y + z * z);
}

/**
 * The client's choice for one mesh: the index into `dists` it draws, or -1
 * for none. `spec` is `{ r, m, cullFactor, dists }`, `dists` ascending with
 * `dists[0]` the mesh's own LOD 0; `d2` the squared camera distance;
 * `fov` the FOV modifier.
 */
export function selectLod(spec, d2, fov = 1, percent = GLOBAL_LOD_PERCENT) {
  const { r, m = 1, dists } = spec;
  const e = d2 / m - r * r;
  const k = percent * sizeFactor(r, spec.cullFactor ?? DEFAULT_CULL_FACTOR) * fov;
  const last = dists.length - 1;
  let i = last;
  while (i >= 0 && !(dists[i] * dists[i] * k < e)) i--;
  if (i < 0) i = 0;
  if (r < GLOBAL_LOD_RADIUS && i === last && (dists[i] * dists[i] + CULL_PAD) * k < e) return -1;
  return i;
}

/**
 * The squared camera distance past which a mesh is culled, at FOV modifier
 * `fov`; Infinity for a mesh at or above `globalLodRadius`. Past it the last
 * LOD is always the one selected (the pad only adds), so the test needs no
 * selection: `selectLod(spec, d2, fov) === -1` exactly when `d2 > this`.
 */
export function cullDistanceSq(spec, fov = 1, percent = GLOBAL_LOD_PERCENT) {
  const { a, b } = cullTerms(spec, percent);
  return a * fov + b;
}

/** `cullDistanceSq` as `a x fov + b`, so a list of meshes can hold `a` and
 *  `b` and take the camera's FOV modifier once a frame. */
export function cullTerms(spec, percent = GLOBAL_LOD_PERCENT) {
  const { r, m = 1, dists } = spec;
  if (!(r < GLOBAL_LOD_RADIUS)) return { a: Infinity, b: Infinity };
  const last = dists[dists.length - 1];
  const k = percent * sizeFactor(r, spec.cullFactor ?? DEFAULT_CULL_FACTOR);
  return { a: m * (last * last + CULL_PAD) * k, b: m * r * r };
}
