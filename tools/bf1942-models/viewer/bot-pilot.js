// A bot at an aircraft's controls: the PlaneMoveTo executor and the
// PlaneAttack loop (`BBPFire3d`), flown through bot-vehicle-air.js's laws,
// plus the altitude, ground, map-size and gun-ballistics queries they read.
// Plain functions of the `BotController` (bot.js), which delegates its
// methods here.

import { playerPosition } from './bot-sense.js';
import { GRAVITY } from './point-body.js';
import { aimAtDirection, towardsPoint, attackRunStep, planeAimFor, insideBattleZone, PLANE, PLANE_FIRE } from './bot-vehicle-air.js';

/**
 * `PlaneMoveTo` (`EntryPlaneMoveTo::execute` -> `PlaneControl::towardsPoint`):
 * the point at cruise height, arrival at `4 * radius`.
 */
export function execPlaneMoveTo(bot, target, action, clearance = PLANE.cruiseClearance) {
  const m = bot.vehicle;
  const st = m.drive?.state;
  if (!st) return true;
  const collider = bot.world?.collider;
  const position = [st.position.x, st.position.y, st.position.z];
  const tgy = collider?.surfaceHeight?.(target[0], target[2]);
  const w = st.angularVelocity;
  const r = towardsPoint({
    orientation: st.orientation, position, velocity: [st.velocity.x, st.velocity.y, st.velocity.z],
    angularVelocity: w ? [w.x, w.y, w.z] : [0, 0, 0],
    target: [target[0], target[1] ?? (Number.isFinite(tgy) ? tgy : st.position.y), target[2]],
    clearance, groundAt: (x, z) => bot._groundAt(x, z),
    altitudeAlong: (off) => bot._altitudeAlong(position, off), altitude: bot._altitudeAlong(position, [0, 0, 0]),
    airborne: !!bot._airborne, maxSpeed: m.maxSpeed ?? 100, radius: m.radius ?? 10,
  });
  bot._airborne = r.airborne;
  const cur = m.drive?.input?.('c_PIThrottle') ?? 1;
  r.power = r.throttle > cur + 0.01 ? 1 : (r.throttle < cur - 0.01 ? -1 : 0);
  bot._airInput = r;
  bot._dbgSteer = [target[0], target[2]];
  if (action?.orbit) return false;                        // `ConFalse`: the idle's orbit never ends
  return r.arrived && !r.takeoff;
}

/**
 * `PlaneAttack`: `BBPFire3d`'s loop. Approach with `MoveTo3dObject` (the
 * target's live position, 50 m clearance), aim and fire through
 * `aimAtDirection` inside 0.9 / 0.8 of the guns' range, break 200 m along
 * the heading after a pass, and turn back toward the ordered area when
 * more than 200 m outside it.
 */
export function execPlaneAttack(bot, action, now) {
  const m = bot.vehicle;
  const st = m.drive?.state;
  if (!st) return true;
  const p = bot.world?.players?.get(action.targetId);
  const pos = playerPosition(p) ?? action.targetPos;
  if (!pos) return true;
  const position = [st.position.x, st.position.y, st.position.z];
  const velocity = [st.velocity.x, st.velocity.y, st.velocity.z];
  const collider = bot.world?.collider;
  const gy = collider?.surfaceHeight?.(position[0], position[2]);
  const tv = p?.vehicle?.state?.velocity ?? p?.soldier?.body?.body?.velocity;
  const targetVel = tv ? [tv.x, tv.y, tv.z] : [0, 0, 0];
  // The Aimer's origin is the chosen weapon's own FireArms (a bomb leaves
  // the bomb rack, not the gun's muzzle).
  const gun = bot._gunBallistics();
  const ge = gun.node?.matrixWorld?.elements;
  const eye = ge ? [ge[12], ge[13], ge[14]] : bot._aimOrigin();
  // `BAPConObjectLineOfFire` 0x08551890: the memory record of the target
  // is not lost (its +0x14 byte), i.e. the senses see it now. No ray here.
  const lineOfFire = bot.senses.memory.get(action.targetId)?.seen === true;
  const state = bot._attackState ?? (bot._attackState = { phase: 'approach', breakFrom: null });
  const forward = bot._unitForward3();
  // `EntryPlaneAimAt` 0x0861f610: the Aimer the aim and the trigger's
  // precision test share. Against a ground target the plane's own velocity
  // is left out of it and its speed added to the round's (`planeAimFor`).
  const weapon = bot.weapons?.[bot.weaponIndex] ?? bot.weapons?.[0] ?? null;
  const air = bot._unitInfo(action.targetId)?.air === true || p?.kind === 'air';
  const rel = [pos[0] - eye[0], pos[1] + 1.0 - eye[1], pos[2] - eye[2]];
  const aimer = planeAimFor({ rel, targetVel, velocity, roundSpeed: gun.speed, gravity: gun.gravity,
                              air, indirect: !!weapon?.indirect, forward });
  const step = attackRunStep(state, {
    position, forward, velocity, target: [pos[0], pos[1] + 1.0, pos[2]], targetVel,
    maxRange: action.maxRange, turnRadius: m.turnRadius ?? 25, lineOfFire, mode: action.mode,
    precision: action.radius, muzzle: eye, aimDir: bot.aimRay().dir, roundSpeed: aimer.speed, gravity: gun.gravity,
    relVel: aimer.relVel, burst: weapon ? !!weapon.burst : true,
  });
  bot._attackPhase = step.phase;
  bot._attackDbg = { phase: step.phase, dist: Math.round(step.dist), cosFront: +(forward[0] * step.dir[0] + forward[1] * step.dir[1] + forward[2] * step.dir[2]).toFixed(3),
                      inFront: step.inFront, los: lineOfFire, miss: +step.miss.toFixed(2), precision: action.radius, fire: step.fire,
                      agl: Number.isFinite(gy) ? Math.round(position[1] - gy) : null, air, floor: aimer.throttleFloor };
  // `If(InsideBattleZone(200), ..., MoveTo3d(map centre, 200 m))`: the
  // battle zone is the world map less a margin (0x0854e670), not the
  // ordered area; near an edge the plane heads for the map's centre.
  const mapSize = bot._worldMapSize();
  if (!insideBattleZone(position[0], position[2], PLANE_FIRE.battleZoneReturn, mapSize)) {
    bot._execPlaneMoveTo([mapSize[0] / 2, PLANE_FIRE.battleZoneHeight, -mapSize[1] / 2], null, PLANE_FIRE.battleZoneHeight);
    bot.isFiring = false;
    return false;
  }
  if (step.phase === 'attack') {
    // `EntryPlaneAimAt` 0x0861f610: the Aimer's firing direction
    // (`planeAimFor`: the lead, the drop taken out, levelled for an
    // indirect weapon) and its throttle floor, flown through
    // `aimAtDirection` 0x08629cf0 -> `towardsDirection` 0x08629fa0.
    const w = st.angularVelocity;
    const r = aimAtDirection({
      orientation: st.orientation, velocity, angularVelocity: w ? [w.x, w.y, w.z] : [0, 0, 0], dir: aimer.dir,
      altitudeAlong: (off) => bot._altitudeAlong(position, off), altitude: bot._altitudeAlong(position, [0, 0, 0]),
      clearance: action.mode === 1 ? PLANE_FIRE.aimClearanceVehicle : PLANE_FIRE.aimClearance,
      airborne: !!bot._airborne, throttleFloor: aimer.throttleFloor, maxSpeed: m.maxSpeed ?? 100,
    });
    bot._airborne = r.airborne;
    const cur = m.drive?.input?.('c_PIThrottle') ?? 1;
    r.power = r.throttle > cur + 0.01 ? 1 : (r.throttle < cur - 0.01 ? -1 : 0);
    bot._airInput = r;
    bot._dbgSteer = [pos[0], pos[2]];
    bot.isFiring = step.fire;
    if (step.fire) bot.firingTargetTime = Math.min(bot.firingTargetTime, now);
    return false;
  }
  bot.isFiring = false;
  if (step.phase === 'break') {
    // `MoveTo3dDirection`: 200 m along the heading, level.
    const f = bot._unitForward3();
    // The point's height is the literal 100.0 written into its y
    // (0x0859bda5) and the move's clearance the 100.0 pushed at 0x0859beab;
    // how its x / z are solved (a line-circle construction around
    // 0x0859bc90) is not ported: 200 m along the heading (INVENTION).
    const ahead = [position[0] + f[0] * PLANE_FIRE.breakDistance, PLANE_FIRE.breakHeight,
                   position[2] + f[2] * PLANE_FIRE.breakDistance];
    bot._execPlaneMoveTo(ahead, null, PLANE_FIRE.breakClearance);
    return false;
  }
  // `MoveTo3dObject(target, radius, maxSpeed, maxSpeed, 100 m)`: the
  // target's own position with the 100.0 clearance (+0x44) pushed at
  // 0x0859bfbb, which `towardsPoint` turns into the lift near it and the
  // pull-up probe.
  bot._execPlaneMoveTo([pos[0], pos[1], pos[2]], null, PLANE_FIRE.approachClearance);
  return false;
}

/** `InformationReal::getAltitude(Vec3)` 0x085e8950: the least height over
 *  the ground (and water) at the position and at 0.2 .. 0.9 of `offset`
 *  along it (the loop's last sample is computed but not returned). */
export function altitudeAlong(bot, position, offset) {
  let best = Infinity;
  for (const t of [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
    const floor = bot._groundAt(position[0] + offset[0] * t, position[2] + offset[2] * t);
    if (Number.isFinite(floor)) best = Math.min(best, position[1] + offset[1] * t - floor);
  }
  return best;
}

/** The higher of the terrain and the water at (x, z) (`IAIEnvironment`
 *  +0xb4 / +0x9c, the pair `towardsPoint` takes the max of). */
export function groundAt(bot, x, z) {
  const col = bot.world?.collider;
  const water = col?.waterLevel ?? bot.world?.extras?.waterLevel;
  const g = col?.surfaceHeight?.(x, z);
  return Math.max(Number.isFinite(g) ? g : -Infinity, Number.isFinite(water) ? water : -Infinity);
}

/** `AISettings::getWorldMapSizeX / Z` (the level's `worldMapSize`). */
export function worldMapSize(bot) {
  const ex = bot.world?.extras;
  const s = ex?.ai?.settings?.worldMapSize;
  return Array.isArray(s) && s.length >= 2 ? s : [ex?.worldSize ?? 2048, ex?.worldSize ?? 2048];
}

/** The FireArms group that fires the chosen weapon: the one whose input is
 *  the AI template's `weaponFire` (`SpitfireGuns` on c_PIFire, the
 *  `SpitfireBombDummy` on c_PIAltFire), else the first. */
export function weaponGroup(bot) {
  const groups = bot.vehicle?.groups?.length ? bot.vehicle.groups : (bot.vehicle?.manned ?? []);
  const w = bot.weapons?.[bot.weaponIndex] ?? bot.weapons?.[0];
  const input = w?.weaponFire ? `c_${w.weaponFire}` : null;
  return (input && groups.find(g => (g.stats?.input ?? g.input) === input)) ?? groups[0] ?? null;
}

/** The chosen weapon's exit velocity and gravity (`Aimer` +0xc / +0x8,
 *  `Weapon::getExitVelocity` / `getGravityModifier` x the world's gravity),
 *  from its FireArms group's projectile; 600 m/s and none until it loads.
 *  A bomb's `velocity 0` is kept (the plane's own speed is added by
 *  `planeAimFor`), and the gravity is the engine's 14.73, not 9.81. */
export function gunBallistics(bot) {
  const g = weaponGroup(bot);
  const st = g?.stats ?? {};
  const v = st.velocity ?? st.projectile?.velocity;
  const speed = Number.isFinite(v) ? v : (bot.weaponData?.[bot.weaponAi?.name]?.velocity ?? 600);
  // `gravityModifier` as the extractor names it (`projectile.gravity`); a
  // tracer round's is 0, a shell's defaults to 1 (gunfire.js).
  const gm = Number.isFinite(st.projectile?.gravity) ? st.projectile.gravity : (st.projectile?.kind === 'shell' ? 1 : 0);
  return { speed, gravity: GRAVITY * gm, node: g?.node ?? null };
}
