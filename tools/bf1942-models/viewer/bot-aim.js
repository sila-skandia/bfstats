// A bot's aim, look and input: where its eye and gun are, which way its
// unit faces, how an absolute aim becomes the mouse-count pair the world
// reads, and the single writer of its `PlayerInput`. Plain functions of the
// `BotController` (bot.js), which delegates its methods here.
//
// A mounted gunner's aim is the engine's (Brief F, 2026-09-24; the ledger's
// gunner rows, features/bot-gunner-aim): `EntryMouseTurretAimAt::execute`
// 0x08619ac0 asks the aim statement for a firing direction
// (`BAPAAimAtObject::getAimVec` 0x0853b820,
// `Aimer::getFiringDirection` 0x08538ad0: the target's predicted position at
// the round's flight time, and the elevation that drops the round onto it),
// and `mouseControlLookAtDirection` 0x08627b90 turns that direction, taken in
// the gun's own frame, into the two look counts through the seat's
// ControlInfo. The reference is the barrel itself (the muzzle node the round
// leaves from), so a gun whose node is turned on its mount (the Sherman's
// turret Browning rests facing aft) is aimed by where it points.

import { sCurveExact } from './bot-sense.js';
import { weaponGroup, gunBallistics } from './bot-pilot.js';

/** The 55-channel PlayerInputMap indices, from the research document §1.2. */
export const PI = {
  Yaw: 0, Pitch: 1, Roll: 2, Throttle: 3,
  MouseLookX: 4, MouseLookY: 5,
  CameraX: 6, CameraY: 7,
  Fire: 8, Action: 9, Use: 10,
  MouseLook: 11, Walk: 12, Run: 13,
  MenuSelect1: 14, MenuSelect2: 15, MenuSelect3: 16,
  MenuSelect4: 17, MenuSelect5: 18, MenuSelect6: 19,
  MenuSelect7: 20, MenuSelect8: 21, MenuSelect9: 22,
  AltFire: 23, Reload: 24, Drop: 25,
  ToggleCameraMode: 26, ToggleCamera: 27,
  Lie: 28, Crouch: 29,
  CameraMode1: 30, CameraMode2: 31, CameraMode3: 32, CameraMode4: 33,
  Radio1: 34, Radio2: 35, Radio3: 36, Radio4: 37,
  Radio5: 38, Radio6: 39, Radio7: 40, Radio8: 41,
  ScreenShot: 42, ToolHint: 43,
  SayAll: 44, SayTeam: 45,
  NextItem: 46, PrevItem: 47,
  Communication: 48, ShowScoreBoard: 49,
  Map: 50, ZoomMap: 51,
  ShowMapVote: 52, VoteYes: 53, VoteNo: 54,
};

/** Mouse axis conversion (mouse-input.js `soldierLookDegrees`). */
const YAW_GAIN = 3.0;
const PITCH_GAIN = 1.0;
const AXIS_MAX = 16;
const RAD2DEG = 180 / Math.PI;
/** `mouseControlLookAtDirection` caps a tick's mouse counts at 4.0. */
export const AIM_COUNTS_MAX = 4.0;
/** Head/eye offset above the feet, for LOS and fire origins (standing). */
const EYE_HEIGHT = 1.6;
const EYE_BY_STANCE = { stand: 1.6, walk: 1.6, crouch: 1.1, prone: 0.4 };

/** `mouseControlLookAtDirection` 0x08627b90: each count is clamped to
 *  `[-4, 4]` (`ds:0x86c0304` 4.0, `ds:0x86e9be0` -4.0) before it is written. */
export const LOOK_COUNTS_MAX = 4.0;

/**
 * The ControlInfo a seat without extracted numbers aims with: the one 53 of
 * vanilla's 78 ControlInfo plug-ins carry (the Sherman's, every aircraft
 * gunner's). Fixed guns and AA mounts carry `pitchScale` / `rollScale` 1.0,
 * the Defgun 0.1; `vehicle-ai.json` hands each seat its own.
 */
export const DEFAULT_SEAT_CONTROL = Object.freeze({
  pitchSensitivity: 0.21817, rollSensitivity: -0.21817, pitchScale: 5.0, rollScale: 5.0,
});

/** The eye of a mounted bot above the hull's position (INVENTION). */
const VEHICLE_EYE_HEIGHT = 2.0;

/** The sign of `TurretRig.headingRadians()` against the bot's yaw. */
const VEHICLE_TURRET_SIGN = 1;

/** Wrap an angle to [-π, π]. */
export function wrapAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Yaw and pitch to face `to` from `from`, radians. */
export function faceTarget(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** The bot's eye, by stance. */
export function eye(bot) {
  if (bot.vehicle) return [bot.position[0], bot.position[1] + VEHICLE_EYE_HEIGHT, bot.position[2]];
  return [bot.position[0], bot.position[1] + (EYE_BY_STANCE[bot.stance] ?? EYE_HEIGHT), bot.position[2]];
}

/** Where the aim is taken from: `AIObjectControlInfo::getCameraBasePos`,
 *  the unit's camera base, which for a gun sits on the gun. The first
 *  driven or manned group's node is that pivot: aiming from it keeps the
 *  rounds on the line the aim was taken along instead of a parallel one
 *  2 m higher. The line of sight still starts at `_eye()`, clear of the
 *  hull's own collision. */
export function aimOrigin(bot) {
  if (bot.vehicle) {
    const frame = barrelFrame(bot);
    if (frame) return frame.origin;
    const g = bot.vehicle.groups?.[0] ?? bot.vehicle.manned?.[0] ?? null;
    const e = g?.node?.matrixWorld?.elements;
    if (e) return [e[12], e[13], e[14]];
  }
  return bot._eye();
}

/** The hull's heading on the ground plane, unit `[x, z]`. */
export function vehicleForward(bot) {
  const q = bot.vehicle?.drive?.state?.orientation;
  if (!q) {
    // A rider: the seat node's world matrix, its -z column.
    const e = bot.vehicle?.node?.matrixWorld?.elements;
    if (e) {
      const fx = -e[8], fz = -e[10];
      const len = Math.hypot(fx, fz) || 1;
      return [fx / len, fz / len];
    }
    return [Math.sin(bot.yaw), Math.cos(bot.yaw)];
  }
  // q * (0, 0, -1)
  const x = q.x, y = q.y, z = q.z, w = q.w;
  const fx = -(2 * (x * z + w * y));
  const fz = -(1 - 2 * (x * x + y * y));
  const len = Math.hypot(fx, fz) || 1;
  return [fx / len, fz / len];
}

/** The unit's velocity: the hull's, or the rider's hull's through the page. */
export function unitVelocity(bot) {
  const v = bot.vehicle?.drive?.state?.velocity ?? bot.vehicle?.hullVelocity?.();
  return v ? [v.x ?? v[0] ?? 0, v.y ?? v[1] ?? 0, v.z ?? v[2] ?? 0] : [0, 0, 0];
}

/** The unit's forward as a 3-vector (the nose for an aircraft). */
export function unitForward3(bot) {
  if (bot.vehicle?.kind === 'air') {
    const n = bot._noseReference();
    return [Math.sin(n.yaw) * Math.cos(n.pitch), Math.sin(n.pitch), Math.cos(n.yaw) * Math.cos(n.pitch)];
  }
  const f = bot._vehicleForward();
  return [f[0], 0, f[1]];
}

/** `validateCameraDirectionYaw` for a fixed weapon: the rig's traverse
 *  reaches the direction (a rig without limits reaches everything). */
export function turretCanPoint(bot, dir) {
  const turret = bot.vehicle?.occupancy?.turret;
  const limits = turret?.yawLimitsRadians?.();
  if (!limits) return true;
  const want = wrapAngle(Math.atan2(dir[0], dir[2]) - bot.yaw);
  return want >= limits[0] && want <= limits[1];
}

export function resetInput(bot) {
  bot.moveForward = 0;
  bot.moveStrafe = 0;
  bot.stanceInput = 'stand';
  bot.jumpRequest = false;
  bot.lookX = 0;
  bot.lookY = 0;
  bot.isFiring = false;
}

/** The single input writer: the named action word plus the mouse pair. */
export function writeInput(bot) {
  // The trigger is the chosen weapon's own `weaponTemplate.weaponFire`
  // (`createMobileLessAttackPlan` 0x085a0080 builds its `BAPATrigger` on the
  // template's +0x44, which `weaponTemplate.weaponFire` writes, ConsoleClass627
  // 0x085129e0): a plane's bombs are PIAltFire.
  const alt = bot.vehicle && bot.weapons?.[bot.weaponIndex]?.weaponFire === 'PIAltFire';
  const input = {
    forward: clamp(bot.moveForward, -1, 1),
    strafe: clamp(bot.moveStrafe, -1, 1),
    walk: bot.stanceInput === 'walk',
    crouch: bot.stanceInput === 'crouch',
    prone: bot.stanceInput === 'prone',
    jump: bot.jumpRequest === true,
    fire: bot.isFiring && !alt,
    altFire: bot.isFiring && !!alt,
  };
  if (bot.vehicle?.kind === 'air') {
    // The world's air branch: `forwardKeys` ramps the latched throttle,
    // `rudder` is the yaw, the pad's `roll` / `pitch` are the stick.
    const a = bot._airInput ?? {};
    input.forwardKeys = a.power ?? 0;
    input.rudder = a.rudder ?? 0;
    input.roll = a.roll ?? 0;
    input.pitch = a.pitch ?? 0;
    input.pad = true;
    input.forward = 0;
    input.strafe = 0;
  }
  bot.input[PI.Throttle] = input.forward;
  bot.input[PI.Yaw] = input.strafe;
  bot.input[PI.Walk] = input.walk ? 1 : 0;
  bot.input[PI.Crouch] = input.crouch ? 1 : 0;
  bot.input[PI.Lie] = input.prone ? 1 : 0;
  bot.input[PI.Fire] = input.fire ? 1 : 0;
  bot.input[PI.MouseLookX] = bot.lookX;
  bot.input[PI.MouseLookY] = bot.lookY;
  bot.world.setInput(bot.playerId, input, { x: bot.lookX, y: bot.lookY });
  bot.jumpRequest = false;
}

/** The camera the senses look through (`AIPlayer::getCameraTransformation`):
 *  an aircraft's airframe, else the look yaw and the soldier's or turret's
 *  pitch. `{ f, r, u }` world unit vectors. */
export function cameraBasis(bot, lookYaw) {
  const q = bot.vehicle?.kind === 'air' ? bot.vehicle.drive?.state?.orientation : null;
  if (q) {
    const rot = (v) => {
      const { x, y, z, w } = q;
      const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2];
      const iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
      return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
    };
    return { f: rot([0, 0, -1]), r: rot([1, 0, 0]), u: rot([0, 1, 0]) };
  }
  const p = bot.vehicle ? (bot._aimReference()?.pitch ?? 0) : (bot.pitch ?? 0);
  const cy = Math.cos(lookYaw), sy = Math.sin(lookYaw), cp = Math.cos(p), sp = Math.sin(p);
  return { f: [sy * cp, sp, cy * cp], r: [cy, 0, -sy], u: [-sy * sp, cp, -cy * sp] };
}

/** A plane's guns point down the nose. */
export function noseReference(bot) {
  const q = bot.vehicle?.drive?.state?.orientation;
  if (!q) return { yaw: bot.yaw, pitch: 0 };
  const x = q.x, y = q.y, z = q.z, w = q.w;
  const fx = -(2 * (x * z + w * y));
  const fy = -(2 * (y * z - w * x));
  const fz = -(1 - 2 * (x * x + y * y));
  return { yaw: Math.atan2(fx, fz), pitch: Math.atan2(fy, Math.hypot(fx, fz)) };
}

/**
 * The chosen weapon's barrel, as the round leaves it: the muzzle node of the
 * seat's gun group for that weapon (`weaponGroup`, keyed by its `weaponFire`
 * input), `-z` its direction (`round-launch.js muzzleVelocity`). `{ origin,
 * f, r, u, group }`: world position, and the gun's forward, right and up in
 * the engine's sense (right = f x world up, level; up = r x f). Null on foot,
 * in an aircraft (the nose is its reference) or before the seat's guns are
 * collected.
 */
export function barrelFrame(bot) {
  const v = bot.vehicle;
  if (!v || v.kind === 'air') return null;
  const group = weaponGroup(bot) ?? v.manned?.[0] ?? null;
  const node = group?.muzzles?.[0] ?? group?.node;
  if (!node?.matrixWorld) return null;
  node.updateWorldMatrix?.(true, false);
  const e = node.matrixWorld.elements;
  const f = unit3([-e[8], -e[9], -e[10]]);
  if (!f) return null;
  // Right is level: the world's up, not the node's, whose own axes a mount
  // may carry turned over (AA_Allies' muzzle node is), which read the
  // target's height with the wrong sign and drove the barrel to its stop.
  const r = unit3(cross3(f, [0, 1, 0])) ?? unit3(cross3(f, [e[4], e[5], e[6]])) ?? [1, 0, 0];
  const u = cross3(r, f);
  return { origin: [e[12], e[13], e[14]], f, r, u, group };
}

function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function unit3(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  return n > 1e-9 ? [v[0] / n, v[1] / n, v[2] / n] : null;
}

/** Does the seat's rig elevate at all? */
function rigHasPitch(bot) {
  const axes = bot.vehicle?.occupancy?.turret?.axes;
  return !axes || axes.some(a => a.axisName === 'pitch' || a.axisName === 'roll');
}

/** What the look input turns: the soldier, or the mounted unit's gun (the
 *  barrel's own direction; hull heading plus the rig's azimuth when the
 *  seat's guns are not collected yet). */
export function aimReference(bot) {
  if (bot.vehicle) {
    const frame = barrelFrame(bot);
    if (frame) {
      const { f } = frame;
      return { yaw: Math.atan2(f[0], f[2]),
               pitch: rigHasPitch(bot) ? Math.asin(clamp(f[1], -1, 1)) : null };
    }
    const turret = bot.vehicle.occupancy?.turret;
    const heading = turret?.headingRadians?.() ?? 0;
    const elevation = turret?.elevationRadians?.() ?? null;
    // A rig without an elevation axis aims flat: its pitch is taken as
    // whatever the plan wants (INVENTION), so the trigger's alignment test
    // is the traverse alone.
    return { yaw: wrapAngle(bot.yaw + VEHICLE_TURRET_SIGN * heading),
             pitch: elevation === null ? null : VEHICLE_TURRET_SIGN * elevation };
  }
  return bot._player()?.soldier ?? null;
}

/**
 * Aim at an absolute yaw/pitch by writing the mouse axis pair. `lookX/Y`
 * are mouse counts (`soldierLookDegrees`: 3 deg and 1 deg a count), the
 * world applies them negated, and the axis saturates at 16. A rate cap
 * (`AIM_COUNTS_MAX`, `mouseControlLookAtDirection`'s 4.0) keeps a bot's
 * turn to 12 deg a tick, the engine's own pace.
 */
export function aimLook(bot, desiredYaw, desiredPitch = null, maxCounts = AXIS_MAX) {
  if (bot.vehicle && bot.vehicle.kind !== 'air') {
    const frame = barrelFrame(bot);
    if (frame) {
      const pitch = desiredPitch ?? Math.asin(clamp(frame.f[1], -1, 1));
      const cp = Math.cos(pitch);
      aimAlong(bot, [Math.sin(desiredYaw) * cp, Math.sin(pitch), Math.cos(desiredYaw) * cp], frame);
      return;
    }
  }
  const s = bot._aimReference();
  if (!s) return;
  const dYaw = wrapAngle(desiredYaw - s.yaw);
  const livePitch = s.pitch ?? 0;
  const targetPitch = desiredPitch === null ? livePitch : desiredPitch;
  const dPitch = s.pitch === null ? 0 : targetPitch - livePitch;
  // A mounted gun's servo multiplies its input by the axis's `direction`
  // (`sign(acceleration)`, seats.js `TurretAxis.step`), and the reading
  // above is the axis's angle through the rig's own sign: the command has
  // to go through the same sign or the loop runs the wrong way. The
  // Sherman's hull Browning declares a negative elevation acceleration,
  // and a bot in that seat drove its barrel to the stop and never fired.
  const sign = bot.vehicle ? bot._turretInputSigns() : null;
  bot.lookX = clamp(-(dYaw * RAD2DEG) / YAW_GAIN, -maxCounts, maxCounts) * (sign?.yaw ?? 1);
  bot.lookY = clamp(-(dPitch * RAD2DEG) / PITCH_GAIN, -maxCounts, maxCounts) * (sign?.pitch ?? 1);
}

/**
 * `mouseControlLookAtDirection` 0x08627b90, the two look counts that turn a
 * camera toward the world direction `dir`. `basis` is the camera's `{ f, r,
 * u }` (world unit vectors, `r` the camera's right); `ctrl` the unit's
 * ControlInfo. Read 2026-09-24 from the decompile, the offsets and constants
 * confirmed in the disassembly:
 *
 *   up, right, ahead = dot(dir, u), dot(dir, r), dot(dir, f), each clamped
 *     to [-1, 1]
 *   shape(c) = sign(c) log10(9 |c| + 1)               (`ds:0x86c08cc` 9.0)
 *   pitch = acos(clamp(shape(up))) - pi/2,  yaw = acos(clamp(shape(right))) - pi/2
 *   both within `tolerance` -> both counts 0, aligned (EntryMouseTurretAimAt
 *     passes 0.0, so only an exact hit zeroes them)
 *   ahead < 0 -> yaw = sign(yaw) pi/2                 (a target behind: a full turn)
 *   Y = clamp(sign(pitchSensitivity) sign(pitch) SCurve(|pitch|) pitchScale, -4, 4)
 *   X = clamp(sign(rollSensitivity)  sign(yaw)   SCurve(|yaw|)   rollScale,  -4, 4)
 *
 * `Y` goes to the template's +0x60 channel (`lookVerticalControl`) and `X`
 * to +0x64 (`lookHorizontalControl`); the template offsets are the console
 * setters' (extract_vehicle_ai.py `control_info`). `SCurve::calculate`
 * 0x08658420 is the 101-entry table (`sCurveExact`). The counts are a RATE: a
 * turret's servo turns `count x maxSpeed` deg/s (turret-rig.js), so the pull
 * shrinks with the error and the aim settles instead of swinging through the
 * target.
 *
 * `window` is the camera's yaw window (Brief L, ledger AI-106), read from
 * 0x08627c69..0x08627e09 with the two branch tails at 0x08629350 and
 * 0x086290cd checked in the disassembly: `{ min, max, rel }`, radians, the
 * ControlInfo's `setCameraRelativeMin/MaxRotationDeg` x (template +0x68 /
 * +0x74, `AITemplateControlInfo` 0x085de770 / 0x085de870, clamped to +-pi) and
 * the camera's own yaw from its base now (`getCameraRelativeRotation`
 * 0x085d4680, x), all positive to the camera's right. Only when the window is
 * not the full circle (`min > -pi || max < pi`):
 *
 *   a = asin-like angle of `right` (`-(acos(right) - pi/2)`); behind
 *     (ahead < 0): a = sign(a) pi - a
 *   a + rel inside [min - 0.001, max + 0.001]: the law as below
 *   a + rel > max + 0.001: unreachable when `rel - 2 pi + a < min`, else
 *     `right` is taken as -1 (a full turn to the left, the long way round)
 *   a + rel < min - 0.001: unreachable when `max < rel + 2 pi - a` (the
 *     engine's own arithmetic, `fsubrp` at 0x08627df8: not `a + rel + 2 pi`),
 *     else `right` is taken as +1
 *   unreachable: both channels 0, nothing else (`unreachable: true`)
 *
 * Returns `{ x, y, aligned, pitch, yaw, unreachable }`.
 */
export function lookAtCounts(dir, basis, ctrl = DEFAULT_SEAT_CONTROL, tolerance = 0, window = null) {
  const dot = v => clamp(dir[0] * v[0] + dir[1] * v[1] + dir[2] * v[2], -1, 1);
  const up = dot(basis.u), ahead = dot(basis.f);
  let right = dot(basis.r);
  if (window && (window.min > -Math.PI || window.max < Math.PI)) {
    let a = -(Math.acos(right) - Math.PI / 2);
    if (ahead < 0) a = Math.sign(a) * Math.PI - a;
    const rel = window.rel ?? 0;
    const t = a + rel;
    if (window.min - 0.001 <= t) {
      if (window.max + 0.001 < t) {
        if (rel - 2 * Math.PI + a < window.min) return { x: 0, y: 0, aligned: false, pitch: 0, yaw: 0, unreachable: true };
        right = -1;
      }
    } else {
      if (window.max < rel + 2 * Math.PI - a) return { x: 0, y: 0, aligned: false, pitch: 0, yaw: 0, unreachable: true };
      right = 1;
    }
  }
  const shape = c => clamp(Math.sign(c) * Math.log10(Math.abs(c) * 9 + 1), -1, 1);
  const pitch = Math.acos(shape(up)) - Math.PI / 2;
  let yaw = Math.acos(shape(right)) - Math.PI / 2;
  if (Math.abs(pitch) <= tolerance && Math.abs(yaw) <= tolerance) {
    return { x: 0, y: 0, aligned: true, pitch, yaw };
  }
  if (ahead < 0) yaw = Math.sign(yaw) * (Math.PI / 2);
  const c = { ...DEFAULT_SEAT_CONTROL, ...(ctrl ?? {}) };
  const y = clamp(Math.sign(c.pitchSensitivity) * Math.sign(pitch) * sCurveExact(Math.abs(pitch)) * c.pitchScale,
    -LOOK_COUNTS_MAX, LOOK_COUNTS_MAX);
  const x = clamp(Math.sign(c.rollSensitivity) * Math.sign(yaw) * sCurveExact(Math.abs(yaw)) * c.rollScale,
    -LOOK_COUNTS_MAX, LOOK_COUNTS_MAX);
  return { x: x || 0, y: y || 0, aligned: false, pitch, yaw, unreachable: false };
}

/**
 * The seat's camera yaw window for `lookAtCounts`, or null: the ControlInfo's
 * `cameraMinDeg` / `cameraMaxDeg` x (extract_vehicle_ai.py `control_info`),
 * and the rig's traverse from rest, positive to the right
 * (`TurretRig.turretYawRadians`, the engine's sign), as the camera's yaw from
 * its base. A window of zero width (`0` / `0`: the M3A1, Priest and Wespe,
 * whose look turns the hull, `lookHorizontalControl PIYaw`) is not applied:
 * read literally it would zero every count off the exact nose, and which
 * entry aims those three was not read (INVENTION).
 */
export function seatYawWindow(bot) {
  const c = bot.vehicle?.controlInfo;
  const lo = c?.cameraMinDeg?.[0], hi = c?.cameraMaxDeg?.[0];
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return null;
  const min = clamp(lo * Math.PI / 180, -Math.PI, Math.PI), max = clamp(hi * Math.PI / 180, -Math.PI, Math.PI);
  if (!(min > -Math.PI || max < Math.PI)) return null;
  const rel = bot.vehicle?.occupancy?.turret?.turretYawRadians?.() ?? 0;
  return { min, max, rel };
}

/** Write the seat's look counts toward the world direction `dir`, taken in
 *  the barrel's frame, through the seat's ControlInfo and its yaw window. */
export function aimAlong(bot, dir, frame = barrelFrame(bot)) {
  if (!frame) return null;
  const counts = lookAtCounts(dir, frame, bot.vehicle?.controlInfo ?? DEFAULT_SEAT_CONTROL, 0, seatYawWindow(bot));
  bot.lookX = counts.x;
  bot.lookY = rigHasPitch(bot) ? counts.y : 0;
  bot._aimCounts = counts;
  return counts;
}

/**
 * `Aimer::getFiringDirection` 0x08538ad0: the direction to fire now so the
 * round meets a target moving at a constant relative velocity. `rel` is the
 * target less the muzzle, `relVel` the target's velocity less the shooter's
 * (`BAPAAimAtObject::getAimVec` 0x0853b820 samples both through
 * `Aimer::addTargetSample` 0x085389a0, and `getPredictedTargetPosition`
 * 0x08539280 is `rel + relVel t`). `speed` is the weapon's exit velocity
 * (`Weapon::getExitVelocity` 0x085ecb50, template +0x28), `gravity` the
 * world's times its modifier (`BFEnvironment::getGravity` 0x085e5500 is the
 * physics system's; template +0x2c), negative. `drag` is the Aimer's +0, the
 * projectile's `pi r^2 drag / mass` (`WeaponFireArm::init` 0x085ee220); the
 * viewer passes 0. `precision` is the 0.5 `EntryMouseTurretAimAt` hands it.
 *
 * A search over the elevation: start on the line to the target now (half
 * way to 86.4 deg for an `indirect` weapon), step `pi / (60 precision + 5)`,
 * each step's flight time `(1 - drag) h / (v cos a)` to the predicted
 * target's horizontal distance `h`, its height against the round's
 * `v sin a t + g t^2 / 2`; reverse and halve once it has crossed, and stop
 * after `round(8 precision + 2)` halvings (1024 steps at most). The elevation
 * is held inside +-1.5393804 (88.2 deg); leaving it, or never crossing, is
 * no solution. The direction is the last predicted position's bearing at the
 * found elevation. Returns `{ dir, time }` or null.
 */
export function firingDirection({ rel, relVel = [0, 0, 0], speed, gravity = 0, drag = 0,
                                  precision = 0.5, indirect = false }) {
  if (!(speed > 0)) return null;
  const LIMIT = 1.5393804;
  const at = t => [rel[0] + relVel[0] * t, rel[1] + relVel[1] * t, rel[2] + relVel[2] * t];
  let p = at(0);
  let horiz = Math.hypot(p[0], p[2]);
  let angle = Math.atan2(p[1], horiz);
  if (indirect) angle = (angle + 1.5079645) * 0.5;
  let stepSize = Math.PI / (precision * 60 + 5);
  const halvings = Math.round(precision * 8 + 2);
  let side = 0, crossed = false, counted = 0, time = 0;
  for (let i = 0; counted < halvings; ) {
    const c = Math.cos(clamp(angle, -1000, 1000)), sn = Math.sin(clamp(angle, -1000, 1000));
    let height;
    if (drag !== 0) {
      time = (1 - drag) * (horiz / (c * speed));
      height = sn * speed * time + time * time * ((drag * sn * speed + gravity) * 0.5 / (1 - drag));
    } else {
      time = horiz / (c * speed);
      height = sn * speed * time + gravity * time * time * 0.5;
    }
    p = at(time);
    horiz = Math.hypot(p[0], p[2]);
    if (!Number.isFinite(horiz) || !Number.isFinite(p[1])) return null;
    if (height - p[1] >= 0) {
      if (angle <= -LIMIT) return null;
      if (side === 0) side = -1; else if (side > 0) crossed = true;
      if (crossed) stepSize *= 0.5;
      angle = Math.max(angle - stepSize, -LIMIT);
    } else {
      if (angle >= LIMIT) return null;
      if (side === 0) side = 1; else if (side < 0) crossed = true;
      if (crossed) stepSize *= 0.5;
      angle = Math.min(angle + stepSize, LIMIT);
    }
    if (++i > 1024) break;
    if (crossed) counted++;
  }
  if (!crossed || !(horiz > 0)) return null;
  const c = Math.cos(angle);
  const dir = [p[0] * (c / horiz), Math.sin(angle), p[2] * (c / horiz)];
  if (dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2] < 0.9) return null;
  return { dir, time };
}

/**
 * A mounted gunner's `MouseTurretAimAt` (`EntryMouseTurretAimAt::execute`
 * 0x08619ac0): the lead for the chosen weapon's round (`firingDirection`,
 * through `BAPAAimAtObject::getAimVec` 0x0853b820), from its muzzle, at the
 * target moving at `targetVel`, less the gunner's own hull velocity; the
 * straight line when the search finds none (`getVectorToTarget` 0x0853c1e0,
 * the fallback 0x08619eee takes, which leaves the aim invalid); then the look
 * counts toward it (`aimAlong`). The result is kept on the bot for the
 * trigger's precision test this tick (`turretMiss`). Null when the seat's
 * guns are not collected.
 */
export function turretAimAt(bot, targetPoint, targetVel = [0, 0, 0]) {
  const frame = barrelFrame(bot);
  if (!frame) return null;
  const origin = frame.origin;
  const now = bot._now ?? 0;
  // The fire correction first (ledger AI-105): the tracked round's fate since
  // the last tick, then `correctAim` as `getAimVec` 0x0853b820 calls it,
  // before the sample. The correction is added to the target's position
  // relative to the muzzle.
  trackOwnRounds(bot, now);
  const corr = correctAim(bot, now);
  const rel = [targetPoint[0] - origin[0] + corr[0], targetPoint[1] - origin[1] + corr[1],
               targetPoint[2] - origin[2] + corr[2]];
  const own = unitVelocity(bot);
  const relVel = [targetVel[0] - own[0], targetVel[1] - own[1], targetVel[2] - own[2]];
  const gun = gunBallistics(bot);
  const weapon = bot.weapons?.[bot.weaponIndex];
  const lead = firingDirection({ rel, relVel, speed: gun.speed, gravity: gun.gravity,
                                 indirect: !!weapon?.indirect });
  const dir = lead?.dir ?? unit3(rel) ?? frame.f;
  aimAlong(bot, dir, frame);
  const t = lead?.time ?? 0;
  const aim = {
    valid: !!lead, dir, time: t, speed: gun.speed, gravity: gun.gravity,
    // `Aimer::getPredictedTargetPosition` 0x08539280 at the impact time,
    // relative to the muzzle, with the correction taken back out: `getAimVec`
    // writes +0x144 as the muzzle plus the corrected prediction less the
    // correction, and `getPredictedPosition` 0x0853c2e0 hands that to the
    // trigger's precision test and the round tracker alike.
    predicted: [rel[0] + relVel[0] * t - corr[0], rel[1] + relVel[1] * t - corr[1],
                rel[2] + relVel[2] * t - corr[2]],
    correction: [...corr],
  };
  bot._turretAim = aim;
  // `EntryMouseTurretAimAt::execute` 0x08619d2b..0x08619d5b: while the record
  // is armed (+6) a valid aim writes the predicted position into +0x38 (and
  // the firing direction into +0x20): the point the next tracked round is
  // measured against.
  const rec = fireCorrection(bot);
  if (lead && rec.armed) {
    rec.aimPoint = [origin[0] + aim.predicted[0], origin[1] + aim.predicted[1], origin[2] + aim.predicted[2]];
  }
  return aim;
}

// --- The fire correction: `FireCorrectionData`, BotMain +0x138 --------------
//
// Read 2026-09-24 (Brief L; ledger AI-105). The engine watches one of a
// bot's rounds at a time and feeds its miss back into the aim:
//
//  * `BotMain::event_firing` 0x0852cd90 (vt+0x1b0), from
//    `AICollisionHandler::handleProjectileFire` 0x08464820 for every round a
//    bot's player fires: stamps the bot's last-fire time (+0x118). When the
//    last watched round is resolved (+5) and its miss consumed (+0x50 clear)
//    it takes this one: +5 cleared, the round's id (+0), armed (+6), the
//    firing position (+8), and `addBotProjectile` 0x084651c0 starts tracking
//    it against the record's +0x38 (the predicted target at that moment).
//    Otherwise it disarms (+6 = 0), which freezes +0x38 until the next take.
//  * `AICollisionHandler::updateBotProjectiles` 0x084650e0: the round's
//    highest point, and its position as the pre point (+8) until its
//    horizontal distance from the start reaches the target's, then the post
//    point (+0x14) and `passed`.
//  * `BotMain::planExecution` 0x085202c0 (0x08520560..0x08520608): a passed
//    round is observed: pre, post and target points, the height, resolved
//    (+5), fresh (+0x50), passed (+0x51); the tracking dropped.
//  * `event_shotMissed` 0x08526a90 (vt+0x150): a round that struck the
//    ground (`GameServer::handleCollisionForProjectile` 0x08153ba0 ->
//    `handleProjectileMiss` 0x08465080) or anything but the target
//    (`event_shotHit` 0x08526a40 passes it on) is observed the same way,
//    `passed` whatever the tracker had. A hit on the target: resolved, not
//    fresh, no correction. A round that bursts or expires (`Projectile::
//    detonate` 0x0831e680 -> `handleProjectileTimeout` 0x08464450 ->
//    `event_shotTimeOut` 0x08526bc0) only drops the tracking: the record
//    stays unresolved and no further round is watched until the target
//    changes.
//  * `BotMain::setFiringTarget` 0x0852ce20 -> `FireCorrectionData::newTarget`
//    0x08534810 on a new target: resolved, armed, the correction zeroed.
//  * `BAPAAimAt::correctAim` 0x0853a6d0, first in every `getAimVec`: a fresh
//    observation adds 0.8 x (target - the round abreast of it) when it passed
//    (abreast: the start plus the unit shot line to the post point, scaled to
//    the target's distance over the cosine of their horizontal angle), else
//    0.1 x its horizontal shortfall to the height; either way consumed. With
//    nothing fresh and no round fired for 10 s, the sum decays by 0.99 a call.
//
// The viewer: rounds are `GunFire`'s (`bot.world.guns`, tracers and
// projectiles), a bot's own the ones its seat's weapon group fires; a round
// is taken the tick it is first seen, its fate read off the page's hit list
// (`guns.hits`, the record nearest its last position). INVENTION: the
// tracker runs on the bot's tick while it aims (the engine's is a frame
// update whose caller was not found); a soldier's round is the page's hit
// scan, so only a mounted gunner is corrected.

/** `correctAim` 0x0853a6d0: the gain on an observed miss. */
export const CORRECTION_GAIN = 0.8;
/** ...on a round that came down short: the lift per metre of shortfall. */
export const CORRECTION_SHORT_LIFT = 0.1;
/** ...and the decay a call after `CORRECTION_IDLE` s without a round. */
export const CORRECTION_DECAY = 0.99;
export const CORRECTION_IDLE = 10.0;

/** The bot's `FireCorrectionData` (its ctor 0x08532690: resolved, all zero). */
export function fireCorrection(bot) {
  if (!bot._fireCorrection) {
    bot._fireCorrection = {
      targetId: undefined, resolved: true, fresh: false, passed: false, armed: false,
      origin: null, pre: null, post: null, target: null, maxHeight: 0,
      sum: [0, 0, 0], lastFire: -Infinity, aimPoint: null,
      round: null, seen: new WeakSet(), hitsHead: undefined,
      observed: 0, hits: 0, timeouts: 0,
    };
  }
  return bot._fireCorrection;
}

/** `FireCorrectionData::newTarget` 0x08534810, as `setFiringTarget` calls it. */
export function newCorrectionTarget(rec, targetId) {
  rec.targetId = targetId;
  rec.resolved = true;
  rec.armed = true;
  rec.fresh = false;
  rec.sum = [0, 0, 0];
  rec.round = null;
}

function roundPosition(shot) {
  const p = shot.mesh?.position;
  if (!p) return null;
  const lead = shot.lead ?? 0;
  if (lead && shot.velocity) {
    const v = shot.velocity, n = Math.hypot(v.x, v.y, v.z) || 1;
    return [p.x + v.x / n * lead, p.y + v.y / n * lead, p.z + v.z / n * lead];
  }
  return [p.x, p.y, p.z];
}

function distXZ2(a, b) {
  const dx = a[0] - b[0], dz = a[2] - b[2];
  return dx * dx + dz * dz;
}

/** The observation `planExecution` / `event_shotMissed` record. */
function observe(rec, round, passed) {
  rec.pre = round.pre; rec.post = round.post ?? round.pre; rec.target = round.target;
  rec.maxHeight = round.maxHeight;
  rec.origin = round.start;
  rec.resolved = true;
  rec.fresh = true;
  rec.passed = passed;
  rec.round = null;
  rec.observed++;
}

/**
 * One tick of the round watch for a mounted bot: a new target resets the
 * record; each of the seat's rounds first seen is an `event_firing`; the
 * watched round is stepped (`updateBotProjectiles`), observed once it has
 * passed the target (`planExecution`), and resolved by its fate when it is
 * gone (hit, miss, burst). Returns the record.
 */
export function trackOwnRounds(bot, now) {
  const rec = fireCorrection(bot);
  const targetId = bot.firingTarget ?? null;
  if (rec.targetId !== targetId) newCorrectionTarget(rec, targetId);
  const guns = bot.world?.guns;
  const group = guns ? weaponGroup(bot) : null;
  if (!guns || !group) return rec;
  const live = [];
  for (const list of [guns.tracers, guns.projectiles]) {
    for (const shot of list ?? []) if (shot.group === group) live.push(shot);
  }
  // New rounds: `event_firing` for each, the first one taken when resolved.
  // They left during the world step before this tick, so before anything
  // this tick observes.
  for (const shot of live) {
    if (rec.seen.has(shot)) continue;
    rec.seen.add(shot);
    rec.lastFire = now;
    if (!(rec.resolved && !rec.fresh)) { rec.armed = false; continue; }
    const pos = roundPosition(shot);
    if (!pos) continue;
    // The firing position: the round's own, walked back along its flight.
    const v = shot.velocity, n = v ? Math.hypot(v.x, v.y, v.z) : 0;
    const back = n > 0 ? (shot.travelled ?? 0) / n : 0;
    const start = n > 0 ? [pos[0] - v.x * back, pos[1] - v.y * back, pos[2] - v.z * back] : pos;
    const target = rec.aimPoint ?? pos;
    rec.resolved = false;
    rec.armed = true;
    rec.round = { shot, start, target, dist2: distXZ2(start, target), pre: start, post: null,
                  passed: false, maxHeight: start[1], last: start };
  }
  // The watched round: stepped while it flies, resolved when it is gone.
  const round = rec.round;
  if (round) {
    if (live.includes(round.shot)) {
      const pos = roundPosition(round.shot);
      if (pos) {
        round.maxHeight = Math.max(round.maxHeight, pos[1]);
        if (distXZ2(round.start, pos) >= round.dist2) { round.passed = true; round.post = pos; }
        else round.pre = pos;
        round.last = pos;
      }
    } else {
      const hit = roundFate(bot, guns, group, round, rec.hitsHead);
      if (!hit || hit.kind === 'endOfLife') {
        rec.round = null; rec.timeouts++;                 // event_shotTimeOut: stays unresolved
      } else if (hitsTarget(bot, hit, targetId)) {
        rec.round = null; rec.resolved = true; rec.fresh = false; rec.hits++;   // event_shotHit on the target
      } else {
        observe(rec, round, round.passed);                // event_shotMissed
      }
    }
  }
  if (rec.round?.passed) observe(rec, rec.round, true);  // planExecution
  rec.hitsHead = guns.hits?.[0];
  return rec;
}

/** The page's record of the watched round's end: the newest hits since the
 *  last tick from the same gun group, the one nearest the round's last
 *  position; null when there is none (it expired). */
function roundFate(bot, guns, group, round, head) {
  const hits = guns.hits ?? [];
  let best = null, bestD = Infinity;
  for (const h of hits) {
    if (h === head) break;
    if (h.firerGroup !== group || !h.point) continue;
    const d = Math.hypot(h.point[0] - round.last[0], h.point[1] - round.last[1], h.point[2] - round.last[2]);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

/** `event_shotHit` 0x08526a40 compares the struck object with the record's
 *  target object (+0x4c): the target soldier, or his unit. */
function hitsTarget(bot, hit, targetId) {
  if (targetId === null || targetId === undefined) return false;
  if (hit.target === targetId) return true;
  const player = bot.world?.players?.get?.(targetId) ?? null;
  const owner = player ? bot.senses?.unitOwnerOf?.(player) : null;
  return owner !== null && owner !== undefined && owner !== -1 && hit.owner === owner;
}

/**
 * `BAPAAimAt::correctAim` 0x0853a6d0: consume a fresh observation into the
 * running correction, or decay it after 10 s without a round. Returns the
 * correction `[x, y, z]` (the record's +0x2c), metres, added to the target.
 */
export function correctAim(bot, now) {
  const rec = fireCorrection(bot);
  const c = rec.sum;
  if (!rec.fresh) {
    if (now - rec.lastFire > CORRECTION_IDLE) {
      c[0] *= CORRECTION_DECAY; c[1] *= CORRECTION_DECAY; c[2] *= CORRECTION_DECAY;
    }
    return c;
  }
  const o = rec.origin, t = rec.target;
  if (!rec.passed) {
    c[1] += Math.sqrt(distXZ2(rec.pre, t)) * CORRECTION_SHORT_LIFT;
  } else {
    // The shot line (origin -> post) and the target line (origin -> target):
    // the round abreast of the target is the shot line's unit vector times
    // |target - origin| / cos(angle between them on the ground).
    const a = [rec.post[0] - o[0], rec.post[1] - o[1], rec.post[2] - o[2]];
    const b = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];
    const bn = Math.hypot(b[0], b[2]);
    const bx = bn > 0 ? b[0] / bn : 0, bz = bn > 0 ? b[2] / bn : 0;
    const dotAB = a[0] * bx + a[2] * bz, crossAB = a[2] * bx - a[0] * bz;
    const cn = Math.hypot(dotAB, crossAB);
    const cos = cn > 0 ? dotAB / cn : 0;
    // A shot at right angles to the target line (or with no ground track)
    // divides by zero in the engine; the viewer skips it (INVENTION).
    if (cos > 1e-6) {
      const reach = Math.hypot(b[0], b[1], b[2]) / cos;
      const an = Math.hypot(a[0], a[1], a[2]);
      const u = an > 0 ? [a[0] / an, a[1] / an, a[2] / an] : [0, 0, 0];
      for (let i = 0; i < 3; i++) c[i] += (t[i] - (u[i] * reach + o[i])) * CORRECTION_GAIN;
    }
  }
  rec.fresh = false;
  return c;
}

/**
 * `BAPCConPrecision::evaluate` 0x0854b570's miss: the predicted target at the
 * impact time (`getPredictedPosition` 0x0853c2e0) against where a round fired
 * down the barrel now is then (`getImpactPosition` 0x0853c360 ->
 * `Aimer::getImpactPosition` 0x08539300, no drag: `f v t + (0, g t^2 / 2, 0)`
 * from the muzzle). Metres; Infinity without a valid aim (`isAimingValid`
 * 0x0853c280 is the Aimer's success, and the condition fails without it).
 */
export function turretMiss(bot, aim = bot._turretAim) {
  if (!aim?.valid) return Infinity;
  const frame = barrelFrame(bot);
  if (!frame) return Infinity;
  const t = aim.time, v = aim.speed, g = aim.gravity;
  const ix = frame.f[0] * v * t, iy = frame.f[1] * v * t + 0.5 * g * t * t, iz = frame.f[2] * v * t;
  return Math.hypot(aim.predicted[0] - ix, aim.predicted[1] - iy, aim.predicted[2] - iz);
}

/**
 * The precision `BBPFireInfantery::createFirePlan` 0x085ac240 builds its
 * `BAPCConPrecision` with (0x085ac93c..0x085ac9c0): against a target whose
 * information carries the air flag (+4 & 0x10) its largest extent, at least
 * 1.0; else a quarter of the three extents' sum, at least 0.4. The ground
 * fire plan is the soldier's and every turret's alike. `extents` are the
 * target's box, `[x, y, z]` metres.
 */
export function precisionFor(extents, air = false) {
  const [x, y, z] = extents;
  if (air) return Math.max(1.0, x, y, z);
  const p = 0.25 * (x + y + z);
  return p <= 0.4 ? 0.4 : p;
}

/**
 * The condition itself, per tick. The plan builds it with `!burst`
 * (`*weapon.template ^ 1`, 0x085ac9f8): a burst weapon fires while the miss is
 * inside the precision (`miss^2 < p^2`, `p^2` at least 0.01, ctor 0x0854b4c0);
 * a single-shot one waits for the closest approach, holding the smallest miss
 * seen (`state.best`, from FLT_MAX) and firing on the tick it grows again
 * while that minimum was inside. Returns whether the trigger may go down.
 */
export function precisionHolds(miss, precision, burst, state) {
  const p2 = Math.max(0.01, precision * precision);
  const m2 = miss * miss;
  if (burst) return m2 < p2;
  const best = state.best ?? Number.MAX_VALUE;
  if (best > 0.01 && m2 <= best) { state.best = m2; return false; }
  state.best = Number.MAX_VALUE;
  return best <= p2;
}

/** The `direction` each aim axis of the seat's rig multiplies its input by.
 *  No longer applied: a gunner aims by the barrel's own frame, which already
 *  answers for how the rig is mounted. Kept for callers that ask. */
export function turretInputSigns(bot) {
  const axes = bot.vehicle?.occupancy?.turret?.axes;
  if (!axes) return null;
  const out = { yaw: 1, pitch: 1 };
  for (const axis of axes) {
    if (axis.axisName === 'yaw' || axis.axisName === 'pitch') out[axis.axisName] = axis.spec?.direction < 0 ? -1 : 1;
  }
  return out;
}

/** The bot's eye pose for the page's fire path. */
export function aimRay(bot) {
  if (bot.vehicle) {
    // From the gun, along the turret (or the nose for an aircraft).
    const r = bot.vehicle.kind === 'air' ? bot._noseReference() : bot._aimReference();
    const yaw = r?.yaw ?? bot.yaw, pitch = r?.pitch ?? 0;
    const cosP = Math.cos(pitch);
    return { origin: bot._aimOrigin(), dir: [Math.sin(yaw) * cosP, Math.sin(pitch), Math.cos(yaw) * cosP] };
  }
  const cosP = Math.cos(bot.pitch);
  return {
    origin: bot._eye(),
    dir: [Math.sin(bot.yaw) * cosP, Math.sin(bot.pitch), Math.cos(bot.yaw) * cosP],
  };
}

/**
 * What the precision needs of a target: whether its information carries the
 * air flag (a player seated in an aircraft) and its box. A soldier's is the
 * fire plan's own `[0.6, 1.8, 0.6]` (bot-fire.js `aimToleranceRad`); a hull's
 * is its drive's geometry box (`aircraftSpec` / `shipSpec` `size`) where the
 * drive carries one, else 10 x 3 x 9 m for an aircraft and 3 x 2.5 x 6 m for
 * anything else (INVENTION: the engine asks the object's own bounding box).
 */
export function targetShape(player) {
  const occ = player?.occupancy ?? null;
  const air = occ?.rootKind === 'air';
  const size = player?.vehicle?.spec?.size;
  let extents = size ? (Array.isArray(size) ? [...size] : [size.x, size.y, size.z]) : null;
  if (!extents || !extents.every(v => Number.isFinite(v) && v > 0)) {
    extents = occ ? (air ? [10, 3, 9] : [3, 2.5, 6]) : [0.6, 1.8, 0.6];
  }
  return { air, extents };
}
