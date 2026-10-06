// The engine's ObjectSpawner, for the two things a soldier meets it through
// on foot: the object a hand weapon's round places (Desert Combat's mortar)
// and the kit a map puts on a pad (DC Final's M82 and Stinger kits). The rules
// only -- no three.js and no DOM, so `tests/deployables_harness.mjs` runs them
// under node; the meshes, the seats and the kits on the ground are
// `deployables-page.js`'s and `kit-drops-page.js`'s. Every number is read out
// of `bf1942_lnxded.static` (addresses are lnxded's);
// `features/dc-mortar-and-kit-pads/README.md` has the derivation and the
// ledger rows (SPAWN-9..SPAWN-16).
//
//   Bomb      `Mortar_weap` fires `mortarbomb` from the camera
//             (`fireInCameraDof`, XHIT-12): `projectilePosition` in the view
//             frame, `velocity` down the view axis. The round carries
//             `mortarspawner3` as a child 0.2 m up its own frame, lives
//             `timeToLive` (1 s), falls (`setHasMobilePhysics`), and dies in
//             water (`DetonateOnWaterCollision`).
//   Spawn     `ObjectSpawner::handleFrameUpdate` 0x083138c0 spawns in its
//             first update (`spawnDelayAtStart 0` leaves the delay at -1).
//             `spawnObject` 0x083140a0 takes the `setObjectTemplate` entry of
//             the spawner's own team (+0x134; a missing key spawns nothing,
//             SPAWN-2), at the spawner's world position plus `spawnOffset` in
//             WORLD axes, turned as the spawner is. `createObjectOnAllClients`
//             0x08133a10 refuses a land PlayerControlObject (VCLand = 0), or
//             an air one whose tooltip type is not 0x24, while any live
//             soldier's origin is within 2 m of that point (d^2 < 4) and the
//             spawner tries again next frame: DC Final's 0/1/0
//             `projectilePosition` ("raised projectile spawn point to stop
//             mortar falling") is what lifts the point clear of the thrower's
//             own head, 2.02 m over his origin.
//   Life      `setTimeToLiveUnused(TimeToLive)` (PCO vt +0x168, 0x0831b000)
//             arms a countdown that `PlayerControlObject::handleFrameUpdate`
//             0x08318d20 runs in 0.5 s steps: while the object is farther than
//             its spawner's `Distance` from the spawner -- or the spawner is
//             gone, which it is a second after the bomb left the hand -- and
//             nobody sits in it and no live soldier on foot stands within its
//             bounding radius, the countdown runs; at 0 each step bills the
//             step times `damageWhenLost` (+0x180), or times 1 with the spawner
//             gone (`giveDamage`, GameServer vt+0x15c). Otherwise it is reset.
//   Pads      A pad filed under a control point (`Object.setOSId` against
//             `objectSpawnerId`) takes the point's team and is switched on by
//             `ControlPoint::CPEnable` 0x082840e0 and off by `CPDisable`
//             0x08284200. A spawned kit is not enabled (`Kit::enable` never
//             runs on it), so it lies until taken; the pad's slot stays full
//             while the kit object lives anywhere -- on the pad, in a soldier's
//             hands, dropped where he died -- and the delay
//             (`calcSpawnDelay` 0x08314430) runs only once it is gone.

import { GRAVITY } from './point-body.js';

/** `createObjectOnAllClients`'s clearance: d^2 < 4.0 against every live
 *  soldier's origin refuses the spawn (0x08133a10). */
export const SPAWN_CLEARANCE = 2.0;

/** `PlayerControlObject::handleFrameUpdate` runs its body once 0.5 s have
 *  accumulated (`+0x19c` against 0.5, 0x08318d20). */
export const LIFE_STEP = 0.5;

/** Hit points a step bills per second of it once the countdown is out and the
 *  spawner is gone: the step is billed unscaled (no template to read
 *  `damageWhenLost` off). */
export const LOST_SPAWNER_RATE = 1.0;

/** `ObjectSpawnerTemplate::ObjectSpawnerTemplate` 0x08314a70: `radius`
 *  (+0x16c) is 5.0 -- how far the last object must be from the pad before the
 *  delay runs while it still lives. */
export const PAD_RADIUS = 5.0;

/** `VehicleCategory`: `operator<<` 0x0829b530 prints 0 VCLand, 1 VCSea,
 *  2 VCAir. */
export const VEHICLE_CATEGORY = Object.freeze({ VCLand: 0, VCSea: 1, VCAir: 2 });

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

/** A vector given in a frame's engine axes (x right, y up, z forward), in
 *  world coordinates. */
export function inFrame({ right, up, forward }, v) {
  return add3(add3(scale3(right, v[0]), scale3(up, v[1])), scale3(forward, v[2]));
}

/**
 * The round leaving the hand: at the eye plus `projectilePosition` in the
 * view frame, `velocity` down the view axis plus what the soldier carries
 * (the page's hand weapons launch every round with the body's velocity). The
 * spawner rides `spawner.position` up the round's own frame, which is the
 * launch frame: nothing turns a round with no response physics.
 */
export function launchBomb({ eye, frame, weapon, platformVelocity = [0, 0, 0] }) {
  const pos = add3(eye, inFrame(frame, weapon.projectilePosition ?? [0, 0, 0]));
  const vel = add3(scale3(frame.forward, weapon.velocity ?? 0), platformVelocity);
  return {
    pos, vel,
    spawnerOffset: inFrame(frame, weapon.spawner?.position ?? [0, 0, 0]),
    frame,
    age: 0,
    ttl: Number.isFinite(weapon.bomb?.timeToLive) ? weapon.bomb.timeToLive : 1,
    mobile: weapon.bomb?.mobile !== false,
    resting: false,
    dead: false,
    spawned: false,
  };
}

/** Where the spawner stands: the round plus the spawner's own offset. */
export function spawnerPoint(bomb) {
  return add3(bomb.pos, bomb.spawnerOffset);
}

/** Where the object appears: the spawner plus `spawnOffset`, world axes
 *  (`spawnObject` adds +0x150..+0x158 to `getAbsolutePosition`). */
export function spawnPoint(bomb, spawnOffset = [0, 0, 0]) {
  return add3(spawnerPoint(bomb), spawnOffset);
}

/**
 * One step of the round: gravity, then the move, then the ground (it has
 * collision physics and no response, so it stops where it meets the ground)
 * and the water (it dies there). `ground(x, z)` is the surface height or null;
 * `waterLevel` a number or null. The round dies `ttl` seconds after it left.
 */
export function stepBomb(bomb, dt, { ground = null, waterLevel = null } = {}) {
  if (bomb.dead || !(dt > 0)) return bomb;
  bomb.age += dt;
  if (!bomb.resting) {
    if (bomb.mobile) bomb.vel[1] += GRAVITY * dt;
    bomb.pos = add3(bomb.pos, scale3(bomb.vel, dt));
    const floor = ground?.(bomb.pos[0], bomb.pos[2]);
    if (Number.isFinite(floor) && bomb.pos[1] <= floor) {
      bomb.pos[1] = floor;
      bomb.vel = [0, 0, 0];
      bomb.resting = true;
    }
  }
  if (Number.isFinite(waterLevel) && bomb.pos[1] < waterLevel) bomb.dead = true;
  if (bomb.age >= bomb.ttl) bomb.dead = true;
  return bomb;
}

/** Whether the category the object's template declares takes the clearance
 *  test: a land hull, or an air hull whose tooltip type is not 0x24. */
export function needsClearance(category, toolTipType = null) {
  const c = typeof category === 'string' ? VEHICLE_CATEGORY[category] : category;
  if (c === 0) return true;
  return c === 2 && toolTipType !== 0x24;
}

/** `createObjectOnAllClients`' gate: no live soldier's origin within 2 m.
 *  `origins` are `[x, y, z]` of the live soldiers on foot (the engine's
 *  `BFPlayer+0x79` alive and his object the soldier, CID 0x9493). */
export function spawnClear(point, origins) {
  for (const o of origins ?? []) {
    const dx = o[0] - point[0], dy = o[1] - point[1], dz = o[2] - point[2];
    if (dx * dx + dy * dy + dz * dz < SPAWN_CLEARANCE * SPAWN_CLEARANCE) return false;
  }
  return true;
}

/**
 * The abandoned object's clock (`PlayerControlObject::handleFrameUpdate`).
 * `step(dt, state)` returns the hit points the object loses this call:
 * `state` is `{ spawnerAlive, spawnerDistance, soldierNear, occupied }`.
 */
export class AbandonClock {
  constructor({ timeToLive = 30, distance = 100, damageWhenLost = 1 } = {}) {
    this.timeToLive = timeToLive;
    this.distance = distance;
    this.damageWhenLost = damageWhenLost;
    this.countdown = timeToLive;
    this.acc = 0;
  }

  step(dt, { spawnerAlive = false, spawnerDistance = Infinity, soldierNear = false,
             occupied = false } = {}) {
    if (!(dt > 0)) return 0;
    this.acc += dt;
    if (this.acc < LIFE_STEP) return 0;
    const step = this.acc;
    this.acc = 0;
    // `999999` is the distance when the spawner is not found (0x08318e1c).
    const far = !spawnerAlive || spawnerDistance > this.distance;
    if (far && !soldierNear && !occupied) {
      if (this.countdown <= 0) {
        return step * (spawnerAlive ? this.damageWhenLost : LOST_SPAWNER_RATE);
      }
      this.countdown = Math.max(0, this.countdown - step);
      return 0;
    }
    this.countdown = this.timeToLive;
    return 0;
  }
}

/** `ObjectSpawner::calcSpawnDelay` 0x08314430: the full window with no
 *  players, the minimum with the server full. */
export function calcSpawnDelay(min, max, players = 0, maxPlayers = 0) {
  const fill = maxPlayers > 0 ? Math.min(1, Math.max(0, players / maxPlayers)) : 0;
  return min + (max - min) * (1 - fill);
}

/**
 * One map-placed ObjectSpawner. `spec`: `{ templates: { "1": name, "2":
 * name }, team, minSpawnDelay, maxSpawnDelay, spawnDelayAtStart, maxNr,
 * nrToSpawn, radius }`. The slot holds the id of the object it spawned while
 * that object lives; the page answers `alive(id)` and `distance(id)`.
 */
export class SpawnerPad {
  constructor(spec = {}) {
    this.templates = { ...(spec.templates ?? {}) };
    this.team = spec.team ?? 0;
    this.min = Number.isFinite(spec.minSpawnDelay) ? spec.minSpawnDelay : 30;
    this.max = Number.isFinite(spec.maxSpawnDelay) ? spec.maxSpawnDelay : 60;
    this.atStart = !!spec.spawnDelayAtStart;
    this.radius = Number.isFinite(spec.radius) ? spec.radius : PAD_RADIUS;
    this.nrToSpawn = Number.isFinite(spec.nrToSpawn) ? spec.nrToSpawn : -1;
    this.slots = new Array(Math.max(1, spec.maxNr ?? 1)).fill(null);
    this.lastSpawned = null;
    this.active = spec.active ?? true;
    // -1 until something spawns, unless `spawnDelayAtStart` (the ctor,
    // 0x08312910; the page passes its player count to `reset`).
    this.delay = -1;
    this.players = 0;
    this.maxPlayers = 0;
  }

  /** The object template this pad hands out for `team`, or null. */
  templateFor(team = this.team) {
    return this.templates[String(team)] ?? null;
  }

  reset({ players = 0, maxPlayers = 0 } = {}) {
    this.players = players;
    this.maxPlayers = maxPlayers;
    this.slots.fill(null);
    this.lastSpawned = null;
    this.delay = this.atStart ? calcSpawnDelay(this.min, this.max, players, maxPlayers) : -1;
  }

  /** `ObjectSpawner::setActive` 0x083143f0: a delay already running is
   *  drawn again. */
  setActive(on) {
    this.active = !!on;
    if (this.delay !== -1) {
      this.delay = calcSpawnDelay(this.min, this.max, this.players, this.maxPlayers);
    }
  }

  /** `CPEnable` / `CPDisable`: the point's team, and on / off. */
  enable(team) { this.team = team; this.setActive(true); }
  disable(team) { this.team = team; this.setActive(false); }

  /**
   * One frame of `ObjectSpawner::handleFrameUpdate`. `world`: `alive(id)`,
   * `distance(id)` (from the pad), `critical(id)` (its Armor reports
   * `isDestroyed`, vt+0xc8, SPAWN-11; a kit has no Armor and answers false), `destroy(id)`,
   * `spawn(template)` -> id or null. Returns the id spawned this frame, or
   * null.
   */
  tick(dt, world) {
    if (!this.active || this.nrToSpawn === 0) return null;
    let spawned = null;
    let firstEmpty = true;
    for (let i = 0; i < this.slots.length; i++) {
      const held = this.slots[i];
      if (held == null) {
        // Only one empty slot is looked at a frame.
        if (!firstEmpty) continue;
        firstEmpty = false;
        if (this.delay > 0) {
          const last = this.lastSpawned;
          if (last == null) {
            this.delay -= dt;
          } else if (!world.alive(last)) {
            this.lastSpawned = null;
            this.delay -= dt;
          } else if (!world.critical?.(last)) {
            if (world.distance(last) > this.radius) this.delay -= dt;
          } else {
            this.delay -= dt;
          }
          continue;
        }
        // A wreck still on the pad goes before the next one appears.
        const last = this.lastSpawned;
        if (last != null && world.alive(last) && world.critical?.(last)
            && world.distance(last) <= this.radius) {
          world.destroy?.(last);
        }
        const template = this.templateFor();
        const id = template ? world.spawn(template) : null;
        this.slots[i] = id ?? null;
        this.lastSpawned = id ?? null;
        if (id != null) {
          if (this.nrToSpawn > 0) this.nrToSpawn -= 1;
          this.delay = calcSpawnDelay(this.min, this.max, this.players, this.maxPlayers);
          spawned = id;
        }
      } else if (!world.alive(held) || world.critical?.(held)) {
        this.slots[i] = null;
      }
    }
    return spawned;
  }
}
