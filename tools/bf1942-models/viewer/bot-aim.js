// A bot's aim, look and input: where its eye and gun are, which way its
// unit faces, how an absolute aim becomes the mouse-count pair the world
// reads, and the single writer of its `PlayerInput`. Plain functions of the
// `BotController` (bot.js), which delegates its methods here.

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
  const input = {
    forward: clamp(bot.moveForward, -1, 1),
    strafe: clamp(bot.moveStrafe, -1, 1),
    walk: bot.stanceInput === 'walk',
    crouch: bot.stanceInput === 'crouch',
    prone: bot.stanceInput === 'prone',
    jump: bot.jumpRequest === true,
    fire: bot.isFiring,
    altFire: false,
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

/** What the look input turns: the soldier, or the mounted unit's turret
 *  (hull heading plus the rig's own azimuth). */
export function aimReference(bot) {
  if (bot.vehicle) {
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

/** The `direction` each aim axis of the seat's rig multiplies its input by. */
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
