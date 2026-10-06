// Where a hand weapon's round leaves from, and which way (ledger XHIT-12).
//
// Every armed hand weapon declares `fireInCameraDof 1`, so `FireArms::Fire`
// (lnxded 0x0828a090) builds the launch from the player's camera, and
// `fireBarrel` (0x0828aba0) then turns that frame by the barrel's own
// `addFireArmsPosition` rotation (the template's array at +0x21c) and adds the
// barrel's offset and `projectilePosition` in it. The round goes down the
// turned frame's forward, and each barrel draws its own deviation.
//
// A rifle's one barrel sits at the FireArms' origin with no turn, so its round
// leaves the eye down the view axis. A shotgun's do not: Desert Combat's
// Remington and Saiga12k declare eight barrels at the origin, each turned up to
// 1.5 degrees, and those turns are the pellet pattern. Fired down the view axis
// with the 0.25 degree `setMinDev` cone the eight pellets flew as one slug.
//
// The law is the vehicle coax's (`gun-groups.js` `cameraLaunch`, the seat
// camera in place of the eye) and is that function; this module only hands it
// the player's eye and the FireArms node a barrel belongs to. Split out of
// hand-weapon.js so it loads under node (`tests/hand_aim_harness.mjs`).

import * as THREE from 'three';
import { cameraLaunch } from './gun-groups.js';

const _eyeQuat = new THREE.Quaternion();
const _release = new THREE.Vector3();

/** The FireArms node `muzzle` belongs to: itself for a gun that declares no
 *  barrels (`collectGroups` then fires from the node), else its nearest
 *  ancestor carrying `fireArms`. Null when it has none. */
function fireArmsOf(muzzle) {
  for (let n = muzzle; n; n = n.parent) {
    if (n.userData?.fireArms) return n;
  }
  return null;
}

/**
 * The `aimRay` of a `fireInCameraDof` hand weapon (`GunFire.collect`): handed
 * the barrel a round leaves from, it answers `{ origin, dir }` in world space.
 *
 * `eye()` is the camera the player looks through, asked per shot because the
 * page may swap it. `release`, when given, is a camera-space offset added to
 * the origin only: a thrown weapon's round first appears where the fire clip
 * has the fist at its release frame, up-right of centre and an arm's length
 * out. That is presentation, and it is named as such: the engine's origin is
 * the eye, and the direction stays the turned view axis, so a grenade still
 * lands where the crosshair says to within the hand's own 0.4 m.
 *
 * The ray is the shared `cameraLaunch` scratch for its FireArms node: read it
 * before the next shot, as `round-launch.js` does.
 */
export function handAimRay(eye, { release = null } = {}) {
  // One launch per FireArms node and camera: `cameraLaunch` binds both.
  const launches = new WeakMap();
  return muzzle => {
    const camera = eye();
    const node = fireArmsOf(muzzle) ?? muzzle;
    let entry = launches.get(node);
    if (!entry || entry.camera !== camera) {
      entry = { camera, launch: cameraLaunch(node, camera) };
      launches.set(node, entry);
    }
    const ray = entry.launch(muzzle);
    if (release) {
      camera.getWorldQuaternion(_eyeQuat);
      ray.origin.add(_release.copy(release).applyQuaternion(_eyeQuat));
    }
    return ray;
  };
}
