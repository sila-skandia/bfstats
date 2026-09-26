// Drives `viewer/parachute.js` and the bail-out path of `viewer/soldier.js`
// and prints one JSON blob. `tests/test_parachute.py` asserts on it.
//
// Three halves. The constants come first, because every one of them is an
// address in `bf1942_lnxded.static` and a wrong one is the whole defect. Then
// the state machine on its own, fed numbers rather than a simulation. Then a
// real `Soldier` on a real `WorldCollider` heightfield, bailed out at altitude
// and flown to the ground, which is the only way to find out what the descent
// and the landing actually come to.

import {
  Parachute, effectiveParachuteDrag, landingImpactSpeed,
  PARACHUTE_ZEROES_IMPACT_SPEED,
  FALL_STATE_SPEED, FALL_STATE_HEIGHT, CHUTE_CLOSE_SPEED,
  PARACHUTE_DRAG, PARACHUTE_SPEED, PARACHUTE_DRAG_RADIUS,
  FALL_SOUND_LAYERS, CHUTE_OPEN_SAMPLES, PARA_CLIPS, FREE_FALL_TRACK_SPEED,
  PARA_NONE, PARA_FALLING, PARA_OPEN, PARA_LANDED,
  OPEN_CLIP_SECONDS, LANDED_CLIP_SECONDS,
} from './parachute.js';
import { Soldier } from './soldier.js';
import {
  GRAVITY, SOLDIER_MASS, SOLDIER_BOUNDING_RADIUS, SOLDIER_DRAG, TICK_DT,
} from './physics.js';
import { Heightfield } from './heightfield.js';
import { WorldCollider } from './world-collider.js';
import { fallDamageFor } from './fall-damage.js';

// What `_shared/damage.json` carries for the pair a falling soldier is: every
// terrain material damages 30 and mods 0.001 against the soldier's own
// material 40, so the product is 0.030. Same stand-in `fall_damage_harness`
// builds, kept here so the landing can be billed without the real file.
const TABLES = (() => {
  const tables = { materials: {}, modifiers: {} };
  for (let id = 0; id <= 15; id++) {
    tables.materials[String(id)] = { attGroup: id, defGroup: id, damage: 30.0 };
    tables.modifiers[String(id)] = { 40: id === 1 ? 1.5e-05 : 0.001 };
  }
  tables.materials['40'] = { attGroup: 40, defGroup: 40, damage: 10.0 };
  return tables;
})();

const results = {};

results.constants = {
  fallStateSpeed: FALL_STATE_SPEED,
  fallStateHeight: FALL_STATE_HEIGHT,
  chuteCloseSpeed: CHUTE_CLOSE_SPEED,
  parachuteDrag: PARACHUTE_DRAG,
  parachuteSpeed: PARACHUTE_SPEED,
  dragRadius: PARACHUTE_DRAG_RADIUS,
  zeroesImpactSpeed: PARACHUTE_ZEROES_IMPACT_SPEED,
  openClipSeconds: OPEN_CLIP_SECONDS,
  landedClipSeconds: LANDED_CLIP_SECONDS,
  openSamples: CHUTE_OPEN_SAMPLES,
  layers: FALL_SOUND_LAYERS.map((l) => ({ id: l.id, at: l.at, loop: !!l.loop })),
  clips: PARA_CLIPS,
};

// The closed forms the descent has to converge on. Only `r^2 * drag` reaches
// the integrator, so both are written against the effective pair the viewer
// actually flies.
const effDrag = effectiveParachuteDrag(SOLDIER_BOUNDING_RADIUS);
const k = Math.PI * SOLDIER_BOUNDING_RADIUS * SOLDIER_BOUNDING_RADIUS
  * effDrag / SOLDIER_MASS;
results.closedForm = {
  effectiveDrag: effDrag,
  // The same k the engine would get from its own pair -- the point of the
  // scaling is that these two agree.
  enginePairK: Math.PI * PARACHUTE_DRAG_RADIUS * PARACHUTE_DRAG_RADIUS
    * PARACHUTE_DRAG / SOLDIER_MASS,
  viewerPairK: k,
  descent: Math.abs(GRAVITY) / k,
  glide: PARACHUTE_SPEED / k,
  // Radius-free: both terms divide by the same k.
  glideRatio: PARACHUTE_SPEED / Math.abs(GRAVITY),
  freeFallTerminal: Math.abs(GRAVITY)
    / (Math.PI * SOLDIER_BOUNDING_RADIUS * SOLDIER_BOUNDING_RADIUS
      * SOLDIER_DRAG / SOLDIER_MASS),
};

// `BFSoldier::handleCollision` 0x0827d470-0x0827d4a5: the speed argument the
// collision handler is given is a zero Vec3 for as long as the chute bit is
// set, and the caller's real vector otherwise.
results.landingImpactSpeed = {
  underCanopy: landingImpactSpeed(true, 13.681),
  freeFall: landingImpactSpeed(false, 13.681),
};

// --- the state machine on its own ------------------------------------------

const down = { x: 0, y: -1, z: 0 };
const level = { x: 0, y: 0, z: 1 };

function gate(velocityY, height) {
  const p = new Parachute();
  p.update({ dt: TICK_DT, velocityY, height, forward: level, bodyForward: level });
  return p.state;
}

results.gate = {
  // Both gates, one at a time, either side of the threshold.
  tooSlow: gate(FALL_STATE_SPEED + 0.01, 50),
  fastEnough: gate(FALL_STATE_SPEED - 0.01, 50),
  tooLow: gate(-30, FALL_STATE_HEIGHT - 0.01),
  highEnough: gate(-30, FALL_STATE_HEIGHT + 0.01),
  noTerrain: gate(-30, null),
};

// The free-fall term can never lift you, and it drives along the LOOK axis.
{
  const p = new Parachute();
  p.update({ dt: TICK_DT, velocityY: -20, height: 100, forward: { x: 0, y: 1, z: 0 } });
  results.upwardLookIsClamped = { ...p.accel };
  p.update({ dt: TICK_DT, velocityY: -20, height: 100, forward: down });
  results.downwardLook = { ...p.accel };
  p.update({ dt: TICK_DT, velocityY: -20, height: 100, forward: level });
  results.levelLook = { ...p.accel };
}

// The sound schedule, read back as the times each layer actually fired.
{
  const p = new Parachute({ random: () => 0 });
  const fired = [];
  let t = 0;
  p.update({ dt: TICK_DT, velocityY: -20, height: 900, forward: down });
  for (const e of p.events) if (e.type === 'sound') fired.push({ id: e.id, t: 0 });
  for (let i = 0; i < 60 * 20; i++) {
    t += TICK_DT;
    p.update({ dt: TICK_DT, velocityY: -20, height: 900, forward: down });
    for (const e of p.events) {
      if (e.type === 'sound') fired.push({ id: e.id, t, sample: e.sample, loop: !!e.loop });
    }
  }
  results.soundSchedule = fired;
}

// Key 9 is only taken while falling -- `BFSoldier::handleMessage` 0x08277b84.
{
  const onGround = new Parachute();
  onGround.update({ dt: TICK_DT, velocityY: 0, height: 0, grounded: true, deploy: true });
  const falling = new Parachute({ random: () => 0 });
  falling.update({ dt: TICK_DT, velocityY: -20, height: 100, forward: down });
  falling.update({ dt: TICK_DT, velocityY: -20, height: 100, forward: down, deploy: true });
  results.deploy = {
    onGround: onGround.state,
    falling: falling.state,
    drag: falling.drag,
    opened: falling.events.filter((e) => e.type === 'sound').map((e) => e.sample),
    clipsAtOpen: falling.clips(),
  };
  // Held is not pressed: a held 9 must not re-open a chute it just closed.
  const held = new Parachute();
  held.update({ dt: TICK_DT, velocityY: -20, height: 100, forward: down, deploy: true });
  const first = held.state;
  held.update({ dt: TICK_DT, velocityY: -20, height: 100, forward: down, deploy: true });
  results.deployIsAPressEdge = { first, second: held.state };
}

// --- a real body, bailed out and flown down --------------------------------

/** Flat ground at y = 0, 512 m square: enough to fall a long way onto. */
function flatWorld(worldSize = 2048, dim = 32, height = 0) {
  const n = dim + 1;
  const heights = new Float32Array(n * n).fill(height);
  const field = new Heightfield(dim, worldSize / dim, heights);
  return new WorldCollider({ heightfield: field, statics: null, waterLevel: null });
}

// `buildHeightfield`'s lattice covers x in [0, worldSize] and z in
// [-worldSize, 0], so the drop starts in the middle of it and glides along +x.
const WORLD = 2048;
const MID_X = WORLD / 2, MID_Z = -WORLD / 2;

function bail({ from = 400, deployAt = null, pitch = -Math.PI / 2, vz = 0 } = {}) {
  const collider = flatWorld(WORLD);
  const soldier = new Soldier({ collider, worldSize: WORLD });
  soldier.bailOut(MID_X, from, MID_Z, Math.PI / 2, 0, 0, vz);
  soldier.pitch = pitch;
  const trace = { fallFiredAt: null, openedAt: null, landedAt: null };
  let t = 0;
  let peakFall = 0;
  let descent = null;
  let glide = null;
  let landing = null;
  let hp = 0;
  let deploy = false;
  const dt = TICK_DT;
  let after = -1;             // ticks run since the feet touched down
  let lastDescent = 0, lastGlide = 0;
  for (let i = 0; i < 60 * 120; i++) {
    t += dt;
    deploy = deployAt != null && soldier.parachuteState === 'falling'
      && t >= deployAt && soldier.parachuteState !== 'open';
    soldier.step(dt, { deploy });
    for (const e of soldier.drainParachuteEvents()) {
      if (e.type === 'state' && e.state === 'falling' && trace.fallFiredAt == null) {
        trace.fallFiredAt = { t, y: soldier.y, height: soldier.y };
      }
      if (e.type === 'sound' && e.id === 'open') trace.openedAt = { t, y: soldier.y };
      if (e.type === 'sound' && e.id === 'land') {
        trace.landedAt = { t, y: soldier.y, impact: soldier.landing?.impactSpeed ?? null };
      }
    }
    const vy = soldier.velocityY;
    if (vy < peakFall) peakFall = vy;
    if (soldier.landing) {
      landing = soldier.landing;
      hp = fallDamageFor(landing, TABLES);
    }
    if (!soldier.grounded) {
      lastDescent = Math.abs(vy);
      lastGlide = Math.hypot(soldier.body.body.velocity.x, soldier.body.body.velocity.z);
      if (soldier.parachuteState === 'open') { descent = lastDescent; glide = lastGlide; }
    }
    // Keep stepping for a beat after touchdown: the chute closes on the tick
    // AFTER the one that grounds the body (the parachute runs before the body
    // step), and `Lb_ParachuteHitGround` is what that tick emits.
    if (soldier.grounded && t > 0.5) { if (after < 0) after = 0; }
    if (after >= 0 && ++after > 30) break;
  }
  return {
    t, y: soldier.y, x: soldier.x - MID_X, z: soldier.z - MID_Z,
    state: soldier.parachuteState,
    peakFall, descent, glide,
    landing: landing
      ? {
        impactSpeed: landing.impactSpeed, fallHeight: landing.fallHeight,
        bodyImpactSpeed: landing.bodyImpactSpeed,
        underCanopy: landing.underCanopy,
        cosTheta: landing.cosTheta, hp,
      }
      : null,
    trace,
  };
}

// Straight down, no chute: free fall the whole way, and it is lethal.
results.freeFall = bail({ from: 120, deployAt: null, pitch: -Math.PI / 2 });
// Chute opened two seconds in, looking level so the glide is measurable.
results.chute = bail({ from: 400, deployAt: 2.0, pitch: 0 });
// And opened promptly, from a lower altitude -- the ordinary bail-out.
results.lowChute = bail({ from: 120, deployAt: 0.8, pitch: 0 });

// --- free fall looking level: steered, not flung --------------------------

/** Horizontal speed after `seconds` of free fall from 2 km, looking level. */
function levelFall(vz, seconds) {
  const soldier = new Soldier({ collider: flatWorld(WORLD), worldSize: WORLD });
  soldier.bailOut(MID_X, 2000, MID_Z, 0, 0, 0, vz);
  soldier.pitch = 0;
  let peak = 0;
  for (let t = 0; t < seconds; t += TICK_DT) {
    soldier.step(TICK_DT, {});
    const v = soldier.body.body.velocity;
    peak = Math.max(peak, Math.hypot(v.x, v.z));
  }
  const v = soldier.body.body.velocity;
  return { state: soldier.parachuteState, speed: Math.hypot(v.x, v.z), peak, vy: v.y };
}
results.trackSpeed = FREE_FALL_TRACK_SPEED;
// From rest the look steers him up to the canopy's glide and no further.
results.levelFallFromRest = levelFall(0, 8);
// Out of a plane doing 50 m/s the same look adds nothing: he keeps the 50.
results.levelFallFromPlane = levelFall(50, 8);

// --- stepping out of something moving ------------------------------------

/**
 * Flat ground at y = 0 with a stand-in hull: a flat deck at `deckY` owned by
 * `owner`, answered by the collider's own two queries the soldier's resolve
 * asks (`sweepSphere` and the downward `cast`) unless the caller skips that
 * owner. Enough to stand a bailing man on the wing he stepped out onto.
 */
function hullWorld(owner, deckY) {
  const world = flatWorld(WORLD);
  const sweep = world.sweepSphere.bind(world);
  const cast = world.cast.bind(world);
  world.sweepSphere = (ox, oy, oz, dx, dy, dz, maxDist, radius, skipOwner = -1, ...rest) => {
    if (skipOwner !== owner && dy < 0 && oy - radius >= deckY - 1e-6) {
      const t = (oy - radius - deckY) / -dy;
      if (t <= maxDist) {
        return {
          t, nx: 0, ny: 1, nz: 0, x: ox + dx * t, y: deckY, z: oz + dz * t,
          px: ox + dx * t, py: deckY, pz: oz + dz * t, material: 3, owner,
        };
      }
    }
    return sweep(ox, oy, oz, dx, dy, dz, maxDist, radius, skipOwner, ...rest);
  };
  world.cast = (ox, oy, oz, dx, dy, dz, maxDist, skipOwner = -1) => {
    if (skipOwner !== owner && dy < 0 && oy >= deckY && oy - deckY <= maxDist) {
      return {
        t: oy - deckY, x: ox, y: deckY, z: oz, nx: 0, ny: 1, nz: 0,
        material: 3, owner, kind: 'object',
      };
    }
    return cast(ox, oy, oz, dx, dy, dz, maxDist, skipOwner);
  };
  return world;
}

/** Bail out onto a hull at 300 m doing 50 m/s and sinking at 2; half a second. */
function bailOntoHull(options) {
  const owner = 7;
  const soldier = new Soldier({ collider: hullWorld(owner, 300), worldSize: WORLD });
  soldier.bailOut(MID_X, 300, MID_Z, 0, 0, -2, 50, options);
  for (let t = 0; t < 0.5; t += TICK_DT) soldier.step(TICK_DT, {});
  const v = soldier.body.body.velocity;
  return { speed: Math.hypot(v.x, v.z), vy: v.y, y: soldier.y, grounded: soldier.grounded };
}
results.bailOntoHull = {
  // The old exit: the wing under his boots stops him dead.
  held: bailOntoHull({}),
  // Through the airframe he left, with the aircraft's speed.
  through: bailOntoHull({ hull: 7, hullGrace: 1.5 }),
};

// Out of a jeep at 20 m/s onto flat ground: the speed comes with him and the
// soldier's own friction takes it off.
{
  const soldier = new Soldier({ collider: flatWorld(WORLD), worldSize: WORLD });
  soldier.spawn(MID_X, 0, MID_Z, 0);
  soldier.carry(0, 0, 20);
  const z0 = soldier.z;
  let stoppedAt = null;
  for (let t = 0; t < 2; t += TICK_DT) {
    soldier.step(TICK_DT, {});
    if (stoppedAt == null && Math.hypot(soldier.body.body.velocity.x, soldier.body.body.velocity.z) < 1e-9) {
      stoppedAt = t + TICK_DT;
    }
  }
  results.carryFromJeep = { slid: soldier.z - z0, stoppedAt, grounded: soldier.grounded };
}

process.stdout.write(JSON.stringify(results, null, 1));
