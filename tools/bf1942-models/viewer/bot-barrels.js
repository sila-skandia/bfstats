// A bot's hand weapon fires every barrel it has, each along its own turn
// (ledger XHIT-12, XHIT-16).
//
// Retail's server runs the one barrel loop for every player: `FireArms::Fire`
// (lnxded 0x0828a090) builds the launch from the player's camera for a
// `fireInCameraDof` gun, and `fireBarrel` (0x0828aba0) fires each
// `addFireArmsPosition` barrel down that frame turned by the barrel's own
// rotation, its offset added in the frame, its own deviation drawn. Desert
// Combat's Remington and Saiga12k declare eight barrels at the origin turned
// up to 1.5 degrees: the pellet pattern. The bots fired one ray down the eye
// per pull, one pellet with an eighth of the damage.
//
// The law is the human's (`hand-aim.js`) and the vehicle coax's:
// `gun-groups.js` `cameraLaunch`, handed the bot's eye as the camera and the
// weapon's FireArms node, with its barrels, as the gun. The bots have no
// scene of their weapon, so the node is rebuilt from the glb's JSON chunk
// (`fireArmsBarrels`): the barrels' own transforms relative to it.

import * as THREE from 'three';
import { cameraLaunch } from './gun-groups.js';

/** A node's local transform as a matrix (glTF `matrix`, else TRS). */
function localMatrix(node, out) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return out.fromArray(node.matrix);
  const t = node.translation ?? [0, 0, 0], r = node.rotation ?? [0, 0, 0, 1], s = node.scale ?? [1, 1, 1];
  return out.compose(new THREE.Vector3(...t), new THREE.Quaternion(...r), new THREE.Vector3(...s));
}

/**
 * The barrels of a weapon glb's FireArms node, out of its JSON chunk: every
 * node under it marked `extras.muzzle` (`collectGroups` reads the same mark),
 * in the order of its `index`, each as `{ position, rotation }` relative to
 * the FireArms node (the transforms down the path composed). Empty when the
 * gun declares no barrels: it fires from the node itself.
 */
export function fireArmsBarrels(json) {
  const nodes = json?.nodes ?? [];
  const root = nodes.findIndex(n => n?.extras?.fireArms);
  if (root < 0) return [];
  const out = [];
  const m = new THREE.Matrix4();
  const walk = (i, parent) => {
    const node = nodes[i];
    const here = new THREE.Matrix4().multiplyMatrices(parent, localMatrix(node, m));
    const mark = node?.extras?.muzzle;
    if (mark && i !== root) {
      const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
      here.decompose(position, rotation, scale);
      out.push({ index: Number.isFinite(mark?.index) ? mark.index : out.length,
                 position: position.toArray(), rotation: rotation.toArray() });
    }
    for (const c of node?.children ?? []) walk(c, here);
  };
  for (const c of nodes[root].children ?? []) walk(c, new THREE.Matrix4());
  return out.sort((a, b) => a.index - b.index).map(({ position, rotation }) => ({ position, rotation }));
}

/** The FireArms node and its barrels built once per barrel list. */
const rigs = new WeakMap();
function rigOf(barrels) {
  let rig = rigs.get(barrels);
  if (!rig) {
    const node = new THREE.Object3D();
    const muzzles = barrels.map(b => {
      const muzzle = new THREE.Object3D();
      muzzle.position.fromArray(b.position);
      muzzle.quaternion.fromArray(b.rotation);
      node.add(muzzle);
      return muzzle;
    });
    node.updateMatrixWorld(true);
    rig = { node, muzzles };
    rigs.set(barrels, rig);
  }
  return rig;
}

const _eye = new THREE.Object3D();
_eye.rotation.order = 'YXZ';

/** A barrel at the FireArms' origin with no turn: a rifle's. */
function plainBarrel(b) {
  const [x, y, z] = b.position, [qx, qy, qz, qw] = b.rotation;
  return Math.hypot(x, y, z) < 1e-6 && Math.hypot(qx, qy, qz) < 1e-9 && qw > 0;
}

/**
 * One pull's rays: `{ origin, dir }` per barrel, through `cameraLaunch` with
 * the bot's eye (`origin`, looking along `dir`, no roll) for the camera. Null
 * for a weapon with no barrels or one plain barrel: its one round leaves the
 * eye down the view axis, as the referee already fires it.
 */
export function barrelRays(origin, dir, barrels) {
  if (!Array.isArray(barrels) || !barrels.length || (barrels.length === 1 && plainBarrel(barrels[0]))) return null;
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const yaw = Math.atan2(dir[0] / len, dir[2] / len);
  const pitch = Math.asin(Math.max(-1, Math.min(1, dir[1] / len)));
  // A camera looks down its -z: turned by yaw + pi about y, then by pitch
  // about its own x, its -z is `dir`.
  _eye.position.set(origin[0], origin[1], origin[2]);
  _eye.rotation.set(pitch, yaw + Math.PI, 0);
  _eye.updateMatrixWorld(true);
  const rig = rigOf(barrels);
  const launch = cameraLaunch(rig.node, _eye);
  return rig.muzzles.map(muzzle => {
    const ray = launch(muzzle);
    return { origin: ray.origin.toArray(), dir: ray.dir.toArray() };
  });
}
