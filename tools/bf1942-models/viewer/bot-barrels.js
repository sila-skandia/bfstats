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
 * The FireArms nodes of a hand weapon's glb, by the button each is fired on
 * (its `setInputFire`, the exporter's `fireArms.input`; a FireArms that names
 * none is on `c_PIFire`): `{ fire, alt }`, indices into `json.nodes`, -1 for
 * none. Of two on one button the node named after the weapon wins.
 *
 * A bayonet rifle carries its stab as a child FireArms on `c_PIAltFire`
 * (ledger SWB-4, SWB-12), and the exporter can write the child first: FHSW's
 * `M1GarandBay` lists `BayonetM1Garand` before itself, XPack1's `No4Bayonet`
 * its `No4BayonetStabFireArm`. Taking the first FireArms node gave a bot
 * holding the rifle the bayonet's round (its material, its 0.065 s life) and
 * the bayonet's barrels.
 */
export function fireArmsNodes(json, name = null) {
  const nodes = json?.nodes ?? [];
  const want = name ? String(name).toLowerCase() : null;
  const out = { fire: -1, alt: -1 };
  for (let i = 0; i < nodes.length; i++) {
    const fa = nodes[i]?.extras?.fireArms;
    if (!fa) continue;
    const key = String(fa.input || 'c_PIFire').toLowerCase() === 'c_pialtfire' ? 'alt' : 'fire';
    const named = want !== null && String(nodes[i]?.name ?? '').toLowerCase() === want;
    if (out[key] < 0 || (named && String(nodes[out[key]]?.name ?? '').toLowerCase() !== want)) out[key] = i;
  }
  return out;
}

/**
 * How far a round of `fireArms` can fly before it dies: its `velocity` over
 * its projectile's `timeToLive` (`Projectile` is removed when its life is
 * out). A knife's round (50 m/s for 0.0665 s) reaches 3.3 m, a bayonet's
 * the same order; a rifle's reaches hundreds of metres. Null when either
 * word is missing.
 */
export function roundReach(fireArms) {
  const v = Number(fireArms?.velocity), ttl = Number(fireArms?.projectile?.timeToLive);
  return v > 0 && ttl > 0 ? v * ttl : null;
}

/**
 * A bot's fire data for hand weapon `name` out of its glb's JSON chunk: the
 * weapon block (`extras.weapon`), the round its `c_PIFire` FireArms flies
 * (`round`, the projectile spec `botRoundDamage` prices), that FireArms'
 * barrels and heat words and its round's `reach`, and `alt`, the FireArms on
 * `c_PIAltFire` when the weapon has one: `{ name, roundOfFire, fireDelay,
 * velocity, round, reach, barrels }`, what a bot whose AI weapon fires on
 * `PIAltFire` pulls (`BBPFireInfantery::createFirePlan` 0x085ac240 builds its
 * trigger on the AI template's +0x44, `weaponTemplate.weaponFire`). Null
 * without a weapon block. `fireArms` is the primary's FireArms block.
 */
export function botWeaponData(json, name = null) {
  const weapon = json?.extras?.weapon ?? null;
  if (!weapon) return null;
  const nodes = json?.nodes ?? [];
  const at = fireArmsNodes(json, name);
  const fireArms = at.fire >= 0 ? nodes[at.fire].extras.fireArms : null;
  const round = fireArms?.projectile;
  const out = {
    ...weapon,
    ...(round && typeof round === 'object' ? { round } : {}),
    barrels: fireArmsBarrels(json, at.fire),
    heat: weapon.heat ?? fireArmsHeat(fireArms),
    reach: roundReach(fireArms),
  };
  if (at.alt >= 0) {
    const fa = nodes[at.alt].extras.fireArms;
    out.alt = {
      name: nodes[at.alt].name ?? null,
      roundOfFire: fa.roundOfFire ?? null,
      // The exporter files a FireArms' `fireDelay` under `throw`
      // (hand-alt-fire.js `createAlt` reads it from there).
      fireDelay: fa.throw?.fireDelay ?? 0,
      velocity: fa.velocity ?? null,
      round: fa.projectile && typeof fa.projectile === 'object' ? fa.projectile : null,
      reach: roundReach(fa),
      barrels: fireArmsBarrels(json, at.alt),
    };
  }
  return { data: out, fireArms };
}

/**
 * The barrels of a weapon glb's FireArms node, out of its JSON chunk: every
 * node under it marked `extras.muzzle` (`collectGroups` reads the same mark),
 * in the order of its `index`, each as `{ position, rotation }` relative to
 * the FireArms node (the transforms down the path composed). Empty when the
 * gun declares no barrels: it fires from the node itself. `root` is the
 * FireArms node's index; by default the one on `c_PIFire` (`fireArmsNodes`).
 */
export function fireArmsBarrels(json, root = fireArmsNodes(json).fire) {
  const nodes = json?.nodes ?? [];
  if (!(root >= 0) || !nodes[root]?.extras?.fireArms) return [];
  const out = [];
  const m = new THREE.Matrix4();
  const walk = (i, parent) => {
    const node = nodes[i];
    // A FireArms under this one (a bayonet's stab under its rifle) is its
    // own gun: its muzzles are its barrels, not these.
    if (node?.extras?.fireArms) return;
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

/** A FireArms block's heat words (`heatAddWhenFire`, `coolDownPerSec`,
 *  `timeDelayOnOverheat`, `velocityDependentOnHeat`, `roundOfFire`), the
 *  ones `fire-state.js` runs its law on; null for a gun with no heat. */
export function fireArmsHeat(fireArms) {
  if (!fireArms || fireArms.heatAddWhenFire == null) return null;
  const out = {};
  for (const k of ['heatAddWhenFire', 'coolDownPerSec', 'timeDelayOnOverheat', 'velocityDependentOnHeat', 'roundOfFire']) {
    if (fireArms[k] != null) out[k] = fireArms[k];
  }
  return out;
}
