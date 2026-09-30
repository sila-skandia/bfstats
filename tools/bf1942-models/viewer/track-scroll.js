// Track belts: `ObjectTemplate.setAnimatedTextureSpeed`, scrolled the way the
// engine scrolls it, for every hull the map page draws.
//
// WHAT WAS READ (2026-09-30). `AnimatedBundle::handleVisualUpdate(float, float)`
// lnxded `0x08265730` ends in a tail jump (`0x082657aa`) to
// `AnimatedBundle::updateAnimations(float)` `0x08266080`; the client's twin is
// `0x0054f580`. Its first block is the whole of the texture scroll:
//
//     speed = template.animatedTextureSpeed        // lnxded tmpl+0x174/+0x178,
//                                                  // client tmpl+0x244/+0x248
//     if (speed != 0 && parent) {
//       rate = 0
//       node = parent+0x60                         // the parent's physics node
//       if (node is a PhysicsEngine, class 0x9476)
//         rate = node.getCurrentRatio()            // 0x0824ca70, TANK-3
//              * node.getCurrentDifferentialRPM(this.getRelativePosition().x)
//                                                  // 0x0824c990, TANK-2
//       offset += rate * speed                     // this+0x154/+0x158
//       geometry->setTextureTransform(this+0x124)  // offset is that Mat4's
//     }                                            // translation row
//
// So a belt scrolls at its own side's EngineGrip target (TANK-9: `ratio *
// diffRPM(side)` is the contact-patch speed in metres per second), picked by
// the sign of the belt node's own x beside its Engine: a tank pivoting on the
// stick scrolls its two belts against each other, a car-engined half-track
// (no differential bit) runs both at the rev state, and a belt whose parent is
// not an Engine never moves. There is no `dt` in it: the offset steps once per
// visual update, which is once per drawn frame (VIEW-11, `ObjectDrawer::
// objectsVisualUpdate`), so retail's belts run faster at a higher frame rate.
//
// WHAT THIS PAGE DOES. The same product, stepped as `rate * speed *
// TRACK_VISUAL_HZ * dt`: a VIEWER CHOICE that pins the engine's per-frame step
// to 60 visual updates a second, the rate the model browser already assumes
// (`model-rig.js` `TICKS_PER_SECOND`), so a 144 Hz display and a headless run
// at 30 frames a second scroll the same belt at the same speed.
//
// A hull the world integrates is stepped per 30 Hz tick and DRAWN per frame
// between its last two ticks (`presentBelts`, from `local-look.js`, beside
// the hull's own pose). Drawn at the tick, an M1A1 at 15 m/s moves its belt
// 0.18 of the texture a tick against a link pattern that repeats every 0.25,
// which reads as the belt running backwards; drawn per frame at 60 Hz it is
// 0.09, the step retail shows at that rate.
//
// Where the rate comes from:
//   - a hull the world integrates (the player's, a bot's): its own
//     `EngineState`, the engine's formula exactly (`engineBeltRate`), stepped
//     per world tick beside the road wheels' spin (`scrollBeltsByEngine`, from
//     `TrackedVehicle`/`GroundVehicle.integrate`);
//   - a hull presented from outside (a round replay, a room's remote):
//     nothing carries its engine, so each belt runs at its side's contact
//     speed measured off the hull's motion (`motionBeltRate`), which is what
//     the engine's target settles to on the ground (TANK-9's `dV = T - Vt`):
//     `scrollBeltsByMotion`, from `presentKinematic` and `netcode-render.js`.
//
// The sign of `speed` is the glb's (`assemble.py` negates the declared U for
// the Z mirror). Measured on the UVs of seven vanilla and DC belts, it moves
// the bottom run's pattern toward the back of the hull when the hull drives
// forward, as a track on the ground does.
//
// The belt geometry itself stays rigid: the engine skins it to its road
// wheels (`features/vehicle-chase-and-tracks`, "Belt articulation"), and the
// exporter does not yet ship that skin.

import { currentDifferentialRPM } from './ground-engine.js';

/** Visual updates a second the engine's per-frame step is pinned to. */
export const TRACK_VISUAL_HZ = 60;

/** A belt's texture offset is kept in [0, 2): one period of a repeating and
 *  of a mirrored-repeat wrap, so a long drive never loses float precision. */
const WRAP = 2;

const beltOf = new WeakMap();

const isEngine = node => node?.userData?.templateKind?.toLowerCase() === 'engine';

/**
 * One material, cloned so its map can scroll on its own: the exporter's cache
 * and the loader's share one material (and one texture) between every belt of
 * a template. `clone()` drops the shading hooks a page installs on the
 * instance (`onBeforeCompile`, `customProgramCacheKey`), so they are carried
 * over by hand, as `tree-foliage.js` does for its card material.
 */
function cloneForScroll(material, maps) {
  const clone = material.clone();
  for (const key of ['onBeforeCompile', 'customProgramCacheKey']) {
    if (Object.prototype.hasOwnProperty.call(material, key)) clone[key] = material[key];
  }
  if (clone.map) {
    clone.map = clone.map.clone();
    clone.map.needsUpdate = true;
    maps.push({ map: clone.map, base: [clone.map.offset.x, clone.map.offset.y] });
  }
  return clone;
}

function makeBelt(carrier, speed) {
  // A multi-material part arrives as a Group whose own primitives are its
  // untagged Mesh children; a child carrying `templateKind` is a separate part
  // (the road wheels hang off the belt), whose texture must not crawl with it.
  const own = [carrier, ...carrier.children.filter(c => !c.userData?.templateKind)];
  const maps = [];
  for (const obj of own) {
    if (!obj.isMesh || !obj.material) continue;
    const cloned = [obj.material].flat().map(m => cloneForScroll(m, maps));
    obj.material = Array.isArray(obj.material) ? cloned : cloned[0];
  }
  // The engine's side is the belt node's own x beside its Engine. The belt's
  // lateral place is where its wheels are: a Sherman authors its belt nodes at
  // x = -/+0.01 and the geometry and wheels a metre out.
  const x = carrier.position?.x ?? 0;
  const wheels = carrier.children.filter(c => c.userData?.templateKind);
  const lateral = wheels.length
    ? x + wheels.reduce((sum, w) => sum + (w.position?.x ?? 0), 0) / wheels.length
    : x;
  return {
    node: carrier,
    speed: [Number(speed[0]) || 0, Number(speed[1]) || 0],
    side: x,
    lateral,
    /** The offset at the last step, kept in [0, WRAP). */
    offset: [0, 0],
    /** What the last step added, for drawing between it and the one before. */
    step: [0, 0],
    maps,
  };
}

/**
 * Every scrolling belt under `root`: an `AnimatedBundle` declaring
 * `animatedTextureSpeed` directly under an `Engine` (every one shipped in
 * vanilla, the two packs and every installed mod is). Materials are cloned the
 * first time a node is seen and kept with it, so a hull re-entered, or a drive
 * rebuilt, carries on from the offset it had.
 */
export function trackBelts(root) {
  const out = [];
  if (!root?.traverse) return out;
  root.traverse(carrier => {
    const speed = carrier.userData?.animatedTextureSpeed;
    if (!Array.isArray(speed) || !(speed[0] || speed[1])) return;
    if (!isEngine(carrier.parent)) return;
    let belt = beltOf.get(carrier);
    if (!belt) {
      belt = makeBelt(carrier, speed);
      beltOf.set(carrier, belt);
    }
    out.push(belt);
  });
  return out;
}

/**
 * The engine's rate for a belt on `side`: `getCurrentRatio() *
 * getCurrentDifferentialRPM(side)`, metres per second of contact speed.
 *
 * @param {{ratio: number, revs: number, steer: number, bits: number}} engine
 *   `ground-engine.js`'s `EngineState`
 * @param {number} side the belt node's x beside its Engine
 */
export function engineBeltRate(engine, side) {
  if (!engine) return 0;
  const rate = engine.ratio * currentDifferentialRPM(engine.revs, engine.steer, side, engine.bits);
  return Number.isFinite(rate) ? rate : 0;
}

/**
 * A presented hull's belt rate: the contact speed along the hull's forward at
 * the belt's lateral place, `forward + yawRate * lateral` (a yaw to the left
 * speeds the right belt), in the body frame `bodyMotion` gives.
 */
export function motionBeltRate(forward, yawRate, lateral) {
  const rate = forward + yawRate * lateral;
  return Number.isFinite(rate) ? rate : 0;
}

/** `v` turned by the inverse of unit quaternion `q`: world into body frame. */
function toBody(q, v, out) {
  // q* v q for the conjugate: t = 2 (-q.xyz x v), v' = v + w t + (-q.xyz) x t.
  const qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  out.x = v.x + qw * tx + (qy * tz - qz * ty);
  out.y = v.y + qw * ty + (qz * tx - qx * tz);
  out.z = v.z + qw * tz + (qx * ty - qy * tx);
  return out;
}

const scratch = { x: 0, y: 0, z: 0 };

/**
 * The hull's speed along its own forward (-Z) and its yaw rate about its own
 * up, from a world-frame velocity and angular velocity.
 *
 * @param {{x,y,z,w}} orientation
 * @param {{x,y,z}} velocity world, m/s
 * @param {{x,y,z}} [angularVelocity] world, rad/s
 */
export function bodyMotion(orientation, velocity, angularVelocity = null) {
  const forward = -toBody(orientation, velocity, scratch).z;
  const yawRate = angularVelocity ? toBody(orientation, angularVelocity, scratch).y : 0;
  return { forward, yawRate };
}

/**
 * The same pair from two poses `dt` apart, for a hull whose motion is only
 * ever written as a pose (a room's remote replica).
 */
export function motionBetween(prevPos, prevQuat, pos, quat, dt) {
  if (!(dt > 0)) return { forward: 0, yawRate: 0 };
  const velocity = {
    x: (pos.x - prevPos.x) / dt, y: (pos.y - prevPos.y) / dt, z: (pos.z - prevPos.z) / dt,
  };
  // The yaw the hull turned through: its previous forward, seen from its
  // current body frame, lies that far round to the right of its forward.
  const f0 = toBody(quat, rotate(prevQuat, { x: 0, y: 0, z: -1 }), { x: 0, y: 0, z: 0 });
  const yawRate = Math.atan2(f0.x, -f0.z) / dt;
  return { forward: bodyMotion(quat, velocity).forward, yawRate };
}

function rotate(q, v) {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

const wrap = n => n - WRAP * Math.floor(n / WRAP);

/**
 * Step every belt by `dt` seconds at the rate `rateOf(belt)` gives it:
 * `offset += rate * speed * TRACK_VISUAL_HZ * dt`, onto each cloned map.
 */
export function advanceBelts(belts, dt, rateOf) {
  if (!belts?.length || !(dt > 0)) return;
  for (const belt of belts) {
    const d = (rateOf(belt) || 0) * TRACK_VISUAL_HZ * dt;
    belt.step[0] = d * belt.speed[0];
    belt.step[1] = d * belt.speed[1];
    if (!d) continue;
    belt.offset[0] = wrap(belt.offset[0] + belt.step[0]);
    belt.offset[1] = wrap(belt.offset[1] + belt.step[1]);
    drawBelt(belt, 1);
  }
}

/** The belt's maps at `alpha` of the way through its last step. */
function drawBelt(belt, alpha) {
  const back = 1 - alpha;
  for (const { map, base } of belt.maps) {
    map.offset.x = base[0] + belt.offset[0] - belt.step[0] * back;
    map.offset.y = base[1] + belt.offset[1] - belt.step[1] * back;
  }
}

/**
 * Draw every belt under `root` at `alpha` of the way from its previous step
 * to its last, the instant the page draws the hull at (`local-look.js`
 * `applyVehicleInterp`). Only belts a step has already collected: drawing
 * never clones a material.
 */
export function presentBelts(root, alpha) {
  const belts = root ? beltsUnder.get(root) : null;
  if (!belts?.length) return;
  const a = Math.max(0, Math.min(1, alpha));
  for (const belt of belts) {
    if (belt.step[0] || belt.step[1]) drawBelt(belt, a);
  }
}

const beltsUnder = new WeakMap();

/** `trackBelts(root)`, walked once per root and kept with it. */
export function beltsOf(root) {
  if (!root) return [];
  let list = beltsUnder.get(root);
  if (!list) {
    list = trackBelts(root);
    beltsUnder.set(root, list);
  }
  return list;
}

/** A hull the world integrates: every belt under `root` at its engine's rate. */
export function scrollBeltsByEngine(root, engine, dt) {
  const belts = beltsOf(root);
  if (!belts.length || !engine) return;
  advanceBelts(belts, dt, belt => engineBeltRate(engine, belt.side));
}

/** A hull presented from outside: every belt under `root` at its side's
 *  contact speed, from `bodyMotion` or `motionBetween`. */
export function scrollBeltsByMotion(root, motion, dt) {
  const belts = beltsOf(root);
  if (!belts.length || !motion) return;
  advanceBelts(belts, dt, belt => motionBeltRate(motion.forward, motion.yawRate, belt.lateral));
}
