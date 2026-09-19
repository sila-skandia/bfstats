/**
 * What a soldier wears: bolting a kit's worn meshes onto a wearer's bones.
 *
 * A `BFSoldier` template declares a body, a head and two hands and nothing
 * else, so every soldier the extractor produces is bare-headed. The helmet
 * belongs to the **kit**, a separate object tree, and the engine hangs it off
 * one of exactly three bones of the wearer's own skeleton: `A` (a child of
 * `Bip01 Head`), `backpack` and `HipPack`. Parenting to the bone rather than
 * baking is what makes the part follow a pose — when the mixer moves
 * `Bip01 Head`, the helmet on `A` goes with it.
 *
 * Plain numbers throughout, no `three` import, so `tests/kit_graft_harness.mjs`
 * can exercise it under node. The caller turns the answers into nodes.
 *
 * ## The rotation, and why it is not derived
 *
 * A `KitPart` is authored in *bone* space — the hip pack proves it, needing no
 * rotation at all — so the bone's 3ds Max Biped frame stays in. What the other
 * two need is a 180-degree flip, on a different axis each:
 *
 *     head  180 about Y     back  180 about Z     hip  none
 *
 * Half-turns are the signature of a mirror, not of an up-axis conversion:
 * `ske.py` records that a `.ske` is stored mirrored in Z against the `.sm` it
 * poses, and `gltf.py` applies the Refractor-to-glTF mirror on the way out;
 * two mirrors on different axes compose to exactly a half-turn. The hip pack
 * escapes because its bone frame already agrees.
 *
 * These came off `kits.html`'s `?tune` panel — a human rotating the thing 90
 * degrees at a time and looking. **Three automated checks passed this graft
 * while every helmet was upside down** (see `features/bf1942-3d-models/
 * kits.md`), so the eye stayed the instrument of record and these constants
 * are pinned rather than computed.
 */

/** `world(part) = world(bone) * SLOT_ROTATION[slot]`, as `[x, y, z, w]`. */
export const SLOT_ROTATION = {
  head: [0, 1, 0, 0],
  back: [0, 0, -1, 0],
  hip: [0, 0, 0, 1],
};

const IDENTITY = [0, 0, 0, 1];

export const slotRotation = slot => SLOT_ROTATION[slot] || IDENTITY;

/** `a * b`: b applied first — three.js / glTF column-vector order. */
export function quatMul(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/**
 * A `setRotation` triple on a KitPart, as a quaternion.
 *
 * `kits.html` composes these with `THREE.Euler(pitch, yaw, roll, 'YXZ')`,
 * which is Ry * Rx * Rz — the same order `quat_from_ypr` uses, without the
 * mirror, because a KitPart's offsets are already expressed in the bone space
 * the graft works in. Vanilla and EoD declare none; FH and FHSW do.
 */
export function kitPartRotation(rotation) {
  const [yawDeg = 0, pitchDeg = 0, rollDeg = 0] = rotation || [];
  const y = (yawDeg * Math.PI) / 360;
  const p = (pitchDeg * Math.PI) / 360;
  const r = (rollDeg * Math.PI) / 360;
  const qy = [0, Math.sin(y), 0, Math.cos(y)];
  const qx = [Math.sin(p), 0, 0, Math.cos(p)];
  const qz = [0, 0, Math.sin(r), Math.cos(r)];
  return quatMul(quatMul(qy, qx), qz);
}

/**
 * One kit's worn parts as graft instructions.
 *
 * `hidden` is a set of slot names to leave off. A part with no `glb` has no
 * mesh to hang — a mod that declares a worn template the extractor could not
 * resolve — and is dropped rather than producing a bone with nothing on it.
 */
export function wornGrafts(kit, hidden = null) {
  const out = [];
  for (const part of kit?.worn || []) {
    if (!part?.glb) continue;
    if (hidden && hidden.has(part.slot)) continue;
    const [px = 0, py = 0, pz = 0] = part.position || [];
    let quaternion = slotRotation(part.slot);
    const [ry = 0, rp = 0, rr = 0] = part.rotation || [];
    if (ry || rp || rr) {
      quaternion = quatMul(quaternion, kitPartRotation(part.rotation));
    }
    out.push({
      glb: part.glb, bone: part.bone, slot: part.slot,
      position: [px, py, pz], quaternion,
    });
  }
  return out;
}

/**
 * The regex that matches a bone the manifest names.
 *
 * `HipPack` survives sanitization intact, but match loosely anyway: the
 * manifest spells bones the way the `.con` files do, and those are
 * inconsistent in case (`hippack` / `HipPack`).
 */
export function bonePattern(want) {
  return new RegExp(`^${String(want).replace(/[ _]/g, '[_ ]')}$`, 'i');
}

/** Index `kits.json` by kit template name, for a caller holding a kit name. */
export function kitsByTemplate(manifest) {
  const index = new Map();
  for (const kit of manifest?.kits || []) {
    if (kit?.template) index.set(String(kit.template).toLowerCase(), kit);
  }
  return index;
}
