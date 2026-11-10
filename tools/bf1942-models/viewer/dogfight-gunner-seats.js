// A plane's gunners off its model (features/dogfight-doctrine, "The gunners
// from the planes' own data"): the three.js half of `dogfight-gunners.js`.
// Each manned gun seat other than the pilot's, its gun and its arc, read with
// the play front end's own seat survey and aim rig. Nothing here draws.

import * as THREE from 'three';
import { AZ, EL, REACH_TOLERANCE, cellDir } from './dogfight-gunners.js';
import { surveyVehicle, isAimAxis } from './seat-survey.js';
import { TurretRig } from './turret-rig.js';


const DEG = Math.PI / 180;

const _dir = new THREE.Vector3();
const _line = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _rootQ = new THREE.Quaternion();
const _at = new THREE.Vector3();
const _toRoot = new THREE.Matrix4();

/** The guns of `seat` the school fires: on the fire key, firing a bullet,
 *  turned by the seat's aim rig (a Ju 88's rear seat has two, which its
 *  trigger fires together). */
function seatGuns(seat, rig) {
  return seat.fireArms.filter(node => {
    const fa = node.userData?.fireArms;
    const pr = fa?.projectile;
    if (!fa || (fa.input && fa.input !== 'c_PIFire') || pr?.kind !== 'bullet' || !(Number(fa.velocity) > 0)) return false;
    return rig.chainOf(node).length > 0;
  });
}

/**
 * Every gunner of the plane `root` (its model's node tree, as the viewer
 * loads it): one per gun of each manned gun seat other than the pilot's,
 * `[{ seat, weapon, at, arc, rate, speed, life, gravity, tracer, deviation }]`.
 *
 * - `seat` the seat's control, `weapon` the FireArms' template (the name a
 *   recording's rounds carry, `f.w`).
 * - `at` where the gun sits on the plane, its body frame, metres.
 * - `arc` the directions its rig reaches (`inArc`).
 * - `rate` rounds a second, `speed` the muzzle speed, `life` the round's
 *   seconds, `gravity` its drop: the FireArms' and its projectile's own.
 * - `tracer` `{ interval, scaler }` or null; `deviation` the gun's least
 *   cone, hundredths of a radian (DEV-11's `minDev`).
 *
 * The tree is posed through the seat's rig and put back as it was. Empty
 * for a plane with no gunner.
 */
export function gunnersOf(root) {
  if (!root?.traverse) return [];
  const survey = surveyVehicle(root);
  const out = [];
  root.updateMatrixWorld(true);
  root.getWorldQuaternion(_rootQ);
  _toRoot.copy(root.matrixWorld).invert();
  for (const id of survey.order) {
    if (id === survey.rootId) continue;
    const seat = survey.seats.get(id);
    if (!seat || !Object.values(seat.axes).some(a => isAimAxis(a?.spec))) continue;
    const rig = new TurretRig(seat);
    for (const node of seatGuns(seat, rig)) {
      const fa = node.userData.fireArms;
      const pr = fa.projectile ?? {};
      const line = o => o.set(0, 0, -1).applyQuaternion(node.getWorldQuaternion(_q));
      const arc = new Uint8Array(AZ * EL);
      const d = [0, 0, 0];
      for (let e = 0; e < EL; e++) {
        for (let a = 0; a < AZ; a++) {
          cellDir(a, e, d);
          _dir.set(d[0], d[1], d[2]).applyQuaternion(_rootQ);
          rig.pointAlong(_dir, line, node);
          line(_line);
          if (_line.angleTo(_dir) <= REACH_TOLERANCE * DEG) arc[e * AZ + a] = 1;
        }
      }
      for (const axis of rig.axes) axis.hold(0);
      root.updateMatrixWorld(true);
      node.getWorldPosition(_at).applyMatrix4(_toRoot);
      const tracer = fa.tracer ? { interval: Math.max(1, Math.round(Number(fa.tracer.interval) || 1)), scaler: Number(fa.tracer.scaler) || 50 } : null;
      out.push({
        seat: id, weapon: node.name.replace(/_\d+$/, ''),
        at: [_at.x, _at.y, _at.z].map(v => Math.round(v * 1000) / 1000),
        arc,
        rate: Number(fa.roundOfFire) > 0 ? Number(fa.roundOfFire) : 10,
        speed: Number(fa.velocity),
        life: Number(pr.timeToLive) > 0 ? Number(pr.timeToLive) : 1.5,
        gravity: Number.isFinite(Number(pr.gravity)) ? Number(pr.gravity) : 0,
        tracer,
        deviation: Number(fa.deviation?.min) || 0,
      });
    }
  }
  return out;
}

/** How many seats of `gunners` (`gunnersOf`) carry a gun. */
export const gunSeats = gunners => new Set(gunners.map(g => g.seat)).size;

/** Whether `root` carries a gunner (`gunnersOf`), cheaply: a seat other
 *  than the pilot's with a gun its mouse aims. */
export function hasGunner(root) {
  if (!root?.traverse) return false;
  const survey = surveyVehicle(root);
  for (const id of survey.order) {
    if (id === survey.rootId) continue;
    const seat = survey.seats.get(id);
    if (!seat?.fireArms.length || !Object.values(seat.axes).some(a => isAimAxis(a?.spec))) continue;
    const rig = new TurretRig(seat);
    if (seatGuns(seat, rig).length) return true;
  }
  return false;
}

/**
 * The two-seater of `candidates`: each `{ template, root }`, `root()` its
 * model's node tree (or a promise of it, null where it will not load), at
 * most `limit` of them read. The first with one gunner's seat (a pilot and
 * a gunner: a Stuka, a Dauntless, an Albatros C.III), else the first with
 * any (a bomber's turrets). Returns `{ template, root, gunners }`, or null
 * when none carries a gunner.
 */
export async function findTwoSeater(candidates, { limit = 16 } = {}) {
  let first = null;
  for (const c of candidates.slice(0, limit)) {
    let root = null;
    try { root = await c.root(); } catch { root = null; }
    if (!root) continue;
    const gunners = gunnersOf(root.clone(true));
    if (!gunners.length) continue;
    const found = { template: c.template, root, gunners };
    if (gunSeats(gunners) === 1) return found;
    first ??= found;
  }
  return first;
}
