// Bolting a kit's worn parts (helmet, packs, radio) onto a posed soldier.
//
// A copy of `tools/bf1942-models/viewer/kit-graft.js`, which is the source of
// truth. A KitPart hangs off one of three bones of the wearer's skeleton -- `A`
// (under Bip01 Head), `backpack`, `HipPack` -- and needs a half-turn on a
// different axis per slot. Those rotations were settled by eye in the mesh
// site's kit inspector after three automated checks passed a graft with every
// helmet upside down, so they are pinned here, not derived. Change them there
// first.

export type Quat = [number, number, number, number]

/** `world(part) = world(bone) * SLOT_ROTATION[slot]`, as `[x, y, z, w]`. */
const SLOT_ROTATION: Record<string, Quat> = {
  head: [0, 1, 0, 0],
  back: [0, 0, -1, 0],
  hip: [0, 0, 0, 1],
}

const IDENTITY: Quat = [0, 0, 0, 1]

/** `a * b`: b applied first. */
export function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

/** A KitPart's `setRotation` (yaw, pitch, roll in degrees) as a quaternion, Ry * Rx * Rz. */
function kitPartRotation(rotation: number[]): Quat {
  const [yawDeg = 0, pitchDeg = 0, rollDeg = 0] = rotation
  const y = (yawDeg * Math.PI) / 360
  const p = (pitchDeg * Math.PI) / 360
  const r = (rollDeg * Math.PI) / 360
  return quatMul(quatMul([0, Math.sin(y), 0, Math.cos(y)], [Math.sin(p), 0, 0, Math.cos(p)]), [0, 0, Math.sin(r), Math.cos(r)])
}

/** The local rotation a worn part gets under its bone. */
export function graftRotation(slot: string, rotation: number[] = []): Quat {
  const base = SLOT_ROTATION[slot] ?? IDENTITY
  return rotation.some(v => v) ? quatMul(base, kitPartRotation(rotation)) : base
}

/** Bone names arrive underscored from GLTFLoader and the manifests spell them in either case. */
export function bonePattern(want: string): RegExp {
  return new RegExp(`^${want.replace(/[ _]/g, '[_ ]')}$`, 'i')
}
