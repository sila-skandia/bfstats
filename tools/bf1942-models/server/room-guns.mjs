// A room's guns: the seat guns of every hull in the room, and the
// bots' launchers and thrown weapons, flown on the server and decided there.
//
// RETAIL'S RULE. The server flies every projectile and decides every hit:
// `FireArms::Fire` (lnxded 0x0828a090) runs its barrel loop on the server and
// the client's copy skips it for a networked round (NET-15, the client's
// `0x0053db29`..`0x0053db61`), `Projectile::handleCollision` hands the
// contact to `GameServer::handleCollisionForProjectile`, and the damage is
// `GameServer::giveDamage` / `handleExplosion` on the server's own objects
// (HP-9, HP-10, DMG-3). A client is sent the result.
//
// WHAT THIS IS. The page's own `GunFire` (`viewer/gunfire.js`, the code the
// page and the headless runner `sim/stage.mjs` fly rounds with) in the room's
// World, with nothing drawn: a scene nobody renders, no effect library, no
// sound. `world-vehicle-tick.js` already ran every seated player's FireArms
// on the server (the trigger, the heat, the reload) and asked `world.guns`
// to fire, and until 2026-11-13 the room had no guns to answer, so a seat's
// trigger did nothing there and the shooter's page reported its own landings
// (`room-hits.mjs`, "THE DEPARTURE"). Now:
//
//   * a seat gun's round, a human's or a bot's, leaves the server's copy of
//     the barrel on the tick the server's FireArms fires, flies against the
//     room's collider and its soldiers, and lands in `room-hits.mjs`
//     `onRound`: the direct hit on a hull or a soldier, the blast, the push;
//   * the page of a human in a seat still flies its own copy of the round,
//     for the picture and the sound, and reports nothing for it (HELLO's
//     `rounds: { seats: true }`, `viewer/vehicle-hits.js`);
//   * a bot's rocket, rifle grenade or hand grenade is a round here too
//     (`launchBotRound`, the referee's `env.launchRound`; the page's
//     `bot-rounds.js` law), where it was a resolved ray that met soldiers
//     only and had no blast;
//   * the magazine is the server's: `FireState.registerShot` per pull, so a
//     hull's rounds are what its crews have spent, whoever sits in it next,
//     and a pad's fresh hull is full again (`resetHull`). The holder's page
//     is sent it (`syncGuns`, `gun` rows; `viewer/gun-sync.js` puts the
//     page's own count right), as retail sends a player their own weapon's
//     state with the control object.
//
// WHAT STAYS A DEPARTURE, each for a stated reason:
//
//   * a human's hand weapon is still the page's round, reported
//     (`room-hits.mjs` `onImpact`): the input word carries no weapon slot,
//     so the server cannot know which of a kit's weapons a pull fires;
//   * a soldier on foot is met on the capsules of his stance
//     (`soldier-capsules.mjs`: the engine's table on his skeleton, standing,
//     crouched or lying, still), so a human's round on a head is priced as
//     the head, and so is a bot's, flown or resolved (`room-bots.mjs`
//     hands the referee `capsulesOf` and the bots' senses the skeleton's
//     bones to aim at). The walk cycle, the aim's pitch and a seat's body
//     are not posed here; a seated man and a tree without the pose files
//     keep the stand-in body (a sphere `STAND_IN_RADIUS` about
//     `STAND_IN_HEIGHT` over the feet, priced as the torso);
//   * the hull's own recoil (`fireingForce`, FA-19) goes into the server's
//     body of the hull, once a pull (`recoilOnHull`).
//
// COST. Per tick: one pass over the room's gun groups (a handful, each a
// timer) and one collider sweep per round in the air. Measured with
// `tests/room_bots_cost.mjs`; the figures are in the gap report's entry 13.

import * as THREE from 'three';

import { GunFire } from '../viewer/gunfire.js';
import { SEAT_GUN_OPTIONS } from '../viewer/vehicle-instance.js';
import { seatConeOf } from '../viewer/seat-cone.js';
import { chainOnShot } from '../viewer/fire-state.js';
import { roundPasses } from '../viewer/friendly-fire.js';
import { seatAnchor } from '../viewer/seat-body.js';
import { botDeviate, botInputIndex, declaredBarrels, deviationIndex } from '../viewer/bot-deviation.js';
import { loadVehicleTree } from './glb-tree.mjs';
import { encodeJsonMsg, eventRow } from './room-wire.mjs';
import { createStanceBodies } from './soldier-capsules.mjs';
import { skeletonHit } from '../viewer/skeleton-hit.js';

/** The stand-in body a round meets where nothing draws a skeleton: the
 *  referee's (`bot-referee.js` `BOT_BODY_RADIUS`, `BOT_BODY_HEIGHT`,
 *  `BOT_BODY_MATERIAL`; `tests/test_room_guns.py` holds them equal). */
export const STAND_IN_RADIUS = 0.6;
export const STAND_IN_HEIGHT = 1.0;
export const STAND_IN_MATERIAL = 41;

/**
 * A seat gun's pulls as rows, at most one every this many ticks a gun: the
 * `shot` row another page lights the gun and flies its copy of the round
 * from (`viewer/net-server-rounds.js` `shot`, the row a relay page is handed
 * for a retail server's vehicle rounds). 5 ticks is six a second: a cannon's
 * every round, an MG42's every third, which is about its tracers.
 */
export const SHOT_ROW_TICKS = 5;

/**
 * A held gun's magazine, to the player who holds it, at most once every this
 * many ticks while only its round count moves (a reload starting or ending, a
 * spare magazine gone or back, and a seat just taken go at once).
 */
export const GUN_ROW_TICKS = 10;
/** And every this many ticks whatever has moved, so a page whose own copy
 *  has drifted with nothing changing here is put right within two seconds. */
export const GUN_HEARTBEAT_TICKS = 60;

/** Every FireArms node under a hull root, in the tree's own order: a gun's
 *  place in this list names it on the wire (`gun` rows), and the page walks
 *  its own copy of the hull the same way (`viewer/net-room.js`). */
export function fireArmsNodes(root) {
  const out = [];
  root?.traverse?.(node => { if (node.userData?.fireArms) out.push(node); });
  return out;
}

const _minusZ = new THREE.Vector3(0, 0, -1);
const _gunAt = new THREE.Vector3();
const _gunQuat = new THREE.Quaternion();
const _gunDir = new THREE.Vector3();
/** What a server node is 'drawn' with: nothing renders here. */
const NO_MATERIAL = new THREE.MeshBasicMaterial();

/**
 * @param {object} options
 * @param {object} options.room  the Room (`instance`, `world`, `levelData`,
 *   `hits`, `authority`, `bots`)
 */
export function createRoomGuns({ room, capsuleRays = true }) {
  const instance = room.instance;
  const world = room.world;
  const collider = instance.collider;
  // A fake descriptor's mock (the unit harnesses' flat world) casts nothing:
  // no rounds there, and the room is what it was.
  if (typeof collider?.cast !== 'function') return null;

  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();
  const guns = new GunFire({ scene, camera, viewportHeight: () => 720 });
  guns.rand = room.random;
  guns.useLevel(collider, room.levelData.damageTables ?? null);
  // The hull's own recoil (`fireingForce`, FA-19): the gun's shove goes into the
  // server's body of the hull it is bolted to, once a pull, as `FireArms::Fire`
  // posts it (0x0828a43f..0x0828a4cf; `viewer/hull-bodies.js recoilOnHull` on
  // the page). The root's body is woken first (`setIsAwake`, 0x0828a44e).
  const recoilAt = [0, 0, 0];
  const recoilAccel = [0, 0, 0];
  function recoilOnHull(owner, push) {
    if (!(owner >= 0) || !push) return false;
    const held = world.bodyWorld?.get(owner);
    const body = held?.driven ?? held?.parked?.body;
    if (!body) return false;
    body.wake?.();
    recoilAt[0] = push.px; recoilAt[1] = push.py; recoilAt[2] = push.pz;
    recoilAccel[0] = push.ax; recoilAccel[1] = push.ay; recoilAccel[2] = push.az;
    body.addAccelerationAt(recoilAt, recoilAccel);
    return true;
  }
  guns.hullRecoil = (group, push) => { recoilOnHull(group.owner, push); };

  /** FireArms node -> its gun group, and each hull's groups by entry. */
  const groupOf = new Map();
  const collected = new Map();

  /** The slot whose seat fires `group` now, or the slot a bot's hand-weapon
   *  group was made for; null for a gun nobody holds. */
  function firerOf(group) {
    if (group?.firer != null) return group.firer;
    for (const [slot, player] of world.players) {
      if (player.groups?.includes(group) || player.manned?.includes(group)) return slot;
    }
    return null;
  }

  /** Every FireArms of a hull, indexed once: `vehicle-instance.js`
   *  `#collectGuns`' options, the platform's velocity its driver's drive's. */
  function collect(entry) {
    let groups = collected.get(entry);
    if (groups) return groups;
    entry.root.updateMatrixWorld(true);
    // The level tree marks its collision parts `isMesh` with nothing to draw
    // them with (`glb-scene.mjs`); `collect` clones an emitter's materials.
    entry.root.traverse(node => { if (node.isMesh && !node.material) node.material = NO_MATERIAL; });
    groups = guns.collect(entry.root, {
      ...SEAT_GUN_OPTIONS,
      platformVelocity: () => (entry.driver != null
        ? world.player(entry.driver)?.vehicle?.state?.velocity ?? null : null),
    });
    for (const group of groups) {
      // Its own hull's collision is not in its rounds' way (`gunOwner`).
      group.owner = entry.owner;
      group.ownerFor = collider;
      group.weapon = entry.template ?? null;
      group.entry = entry;
      groupOf.set(group.node, group);
    }
    collected.set(entry, groups);
    return groups;
  }

  /** `LevelInstance.gunGroupOf`: the group a mounted seat's FireArms node
   *  fires through. */
  function gunGroupOf(node, entry) {
    if (!groupOf.has(node) && entry?.root) collect(entry);
    return groupOf.get(node) ?? null;
  }

  /** A seat was left or changed: its triggers are off, and what its guns
   *  still owe (a `fireDelay` round) goes with the gunner (FA-13). */
  function quiet(groups) {
    for (const group of groups ?? []) {
      if (!group?.muzzles) continue;
      guns.setFiring(group, false);
      group.delayPending = false;
    }
  }

  /** A pad's fresh hull (`room-pads.mjs` `standUp`): the object is new, so
   *  its magazines are (`FireState.reset`). */
  function resetHull(entry) {
    for (const group of collected.get(entry) ?? []) {
      world.fireStates.get(group.node)?.reset();
      group.cooldown = 0;
    }
  }

  // --- what a round meets -----------------------------------------------------

  /** Where a slot's body is for a round: on foot its soldier, in a seat that
   *  reaches a SeatObject the seat's anchor (SEAT-37; `room-hits.mjs`
   *  `splashTargets`' own test), else nothing: the hull has him. */
  function bodyAt(slot, player) {
    const occ = player.occupancy;
    if (!occ) {
      const s = player.soldier;
      return s ? { x: s.x, y: s.y, z: s.z, seated: false } : null;
    }
    const seat = occ.seatInfo?.(occ.activeSeatId);
    const anchor = seat?.seatObjects?.length ? seatAnchor(seat) : null;
    if (!anchor?.matrixWorld) return null;
    occ.root?.updateMatrixWorld?.(true);
    const e = anchor.matrixWorld.elements;
    return { x: e[12], y: e[13] - STAND_IN_HEIGHT, z: e[14], seated: true };
  }

  /** The soldiers' bodies (`soldier-capsules.mjs` `createStanceBodies`, the
   *  module the headless runner builds too): each side's capsules and bones
   *  in each stance, or nothing where the tree has no pose files: the
   *  stand-in sphere then. Read once a level and side. */
  const level = room.levelData;
  const bodies = createStanceBodies({
    modelsDirs: level.paths?.modelsDirs ?? [], glbsDir: level.paths?.glbsDir ?? null,
    table: level.soldierBody?.collisionBones ?? null,
    soldierOf: team => level.loadouts?.levels?.[level.name]?.[team]?.soldier
      ?? level.loadouts?.levels?.[String(level.name).toLowerCase()]?.[team]?.soldier ?? null,
    cache: (level.stanceCapsules ??= new Map()),
  });
  const capsulesFor = player => bodies.capsulesFor(player);

  /** A soldier on foot's skeleton bones in his stance, in his body frame
   *  (right, up, ahead of his feet): `BotSenses.soldierBones`, the points a
   *  bot's sense rays and then its aim pick among (AI-123). Null where a
   *  bot's own round is kept on the stand-in body (`capsuleRays` false), so
   *  its aim keeps the stand-in's points too, and on a tree with no poses. */
  function soldierBones(player) {
    return capsuleRays ? bodies.bonesFor(player) : null;
  }

  /** A soldier on foot's capsules where he stands now, in the world: the
   *  referee's `capsulesOf` for a bot's own round (`room-bots.mjs`). Null for
   *  a seat, the dead, and a tree without the pose files. */
  function capsulesOf(slot) {
    return bodies.capsulesAt(world.player(slot));
  }

  const _lo = [0, 0, 0];
  const _ld = [0, 0, 0];

  /** `guns.bodyCast` (`vehicle-hits.js` `roundBodyCast`'s law on the room's
   *  players): the first living soldier the segment meets, friend or foe
   *  (FF-1), the firer and his own hull's crew passed (`roundPasses`). A
   *  soldier on foot is met on his capsules, the struck one's material the
   *  one the round is priced against; in a seat, or with no pose files, on
   *  the stand-in sphere. */
  function bodyCast(ox, oy, oz, dx, dy, dz, maxDist, group) {
    const firer = firerOf(group);
    const botFirer = firer != null && !!room.bots?.has?.(firer);
    const r2 = STAND_IN_RADIUS * STAND_IN_RADIUS;
    let best = null;
    let bestT = maxDist;
    for (const [slot, player] of world.players) {
      if (firer != null && roundPasses(world, firer, slot)) continue;
      if (!player.armor || player.armor.destroyed || room.authority.dead.has(slot)) continue;
      const s = bodyAt(slot, player);
      if (!s) continue;
      // A bot's round meets the same body a human's does (`capsuleRays`
      // false keeps a bot's on the stand-in, for a measurement:
      // `room-bots.mjs` has the figures).
      const caps = s.seated || (botFirer && !capsuleRays) ? null : capsulesFor(player);
      if (caps) {
        // The round into the body's frame (feet at the origin, forward +Z,
        // the world's by his yaw about the up axis).
        const yaw = player.soldier.yaw ?? 0;
        const c = Math.cos(yaw), n = Math.sin(yaw);
        const rx = ox - s.x, rz = oz - s.z;
        _lo[0] = rx * c - rz * n; _lo[1] = oy - s.y; _lo[2] = rx * n + rz * c;
        _ld[0] = dx * c - dz * n; _ld[1] = dy; _ld[2] = dx * n + dz * c;
        const met = skeletonHit(_lo, _ld, bestT, caps);
        if (!met) continue;
        bestT = met.t;
        best = {
          kind: 'soldier', t: met.t, x: ox + dx * met.t, y: oy + dy * met.t, z: oz + dz * met.t,
          // A capsule has no entry face worth the name: the impact faces the round.
          nx: -dx, ny: -dy, nz: -dz,
          material: met.material, owner: -1, target: slot,
          travel: [dx, dy, dz], feetY: s.y, seated: false, bone: met.bone,
        };
        continue;
      }
      const cx = s.x - ox, cy = s.y + STAND_IN_HEIGHT - oy, cz = s.z - oz;
      const along = cx * dx + cy * dy + cz * dz;
      const miss2 = cx * cx + cy * cy + cz * cz - along * along;
      if (miss2 > r2) continue;
      const t = along - Math.sqrt(r2 - miss2);
      if (t < 0 || t >= bestT) continue;
      const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
      bestT = t;
      best = {
        kind: 'soldier', t, x, y, z,
        nx: (x - s.x) / STAND_IN_RADIUS, ny: (y - s.y - STAND_IN_HEIGHT) / STAND_IN_RADIUS,
        nz: (z - s.z) / STAND_IN_RADIUS,
        material: STAND_IN_MATERIAL, owner: -1, target: slot,
        travel: [dx, dy, dz], feetY: s.y, seated: s.seated, bone: null,
      };
    }
    return best;
  }

  /** `guns.nearObjects` (`vehicle-hits.js` `proximityObjects`): every live
   *  hull a proximity fuse could burst on, from the server's bodies. */
  function nearObjects(x, y, z, radius) {
    const out = [];
    for (const entry of instance.table) {
      if (!entry.live || !(entry.owner >= 0)) continue;
      const held = world.bodyWorld?.get(entry.owner) ?? null;
      const body = held ? (held.driven ?? held.parked?.body ?? null) : null;
      const pose = body ? null : world.vehiclePose(entry.owner);
      const px = body ? body.pos[0] : pose?.x, py = body ? body.pos[1] : pose?.y, pz = body ? body.pos[2] : pose?.z;
      if (!Number.isFinite(px)) continue;
      const reach = radius + (held?.spec?.boundingRadius ?? body?.boundingRadius ?? 0);
      const ddx = px - x, ddy = py - y, ddz = pz - z;
      if (ddx * ddx + ddy * ddy + ddz * ddz > reach * reach) continue;
      const mass = Number(entry.root?.userData?.physics?.mass);
      out.push({
        owner: entry.owner, x: px, y: py, z: pz,
        mass: Number.isFinite(mass) && mass > 0 ? mass : 1.0,
        vx: body?.v?.[0] ?? 0, vy: body?.v?.[1] ?? 0, vz: body?.v?.[2] ?? 0,
      });
    }
    return out;
  }

  guns.bodyCast = bodyCast;
  guns.nearObjects = nearObjects;
  guns.angleModOf = owner => {
    const value = Number(instance.ownerRoots[owner]?.userData?.physics?.angleMod ?? NaN);
    return Number.isFinite(value) ? value : null;
  };
  // Whose round, fixed at the barrel (KILLSTAMP-1): the slot and its side
  // as they were when it left, so a shell still flying when its gunner bails
  // or dies is still theirs.
  guns.stampOf = group => {
    const firer = firerOf(group);
    return firer == null ? null
      : { firer, weapon: group.weapon ?? null, team: world.player(firer)?.team ?? null,
          hull: group.firer != null ? -1 : group.owner ?? -1 };
  };
  guns.onImpact = record => room.hits.onRound(record);
  chainOnShot(guns, (group, rounds) => world.fireStates.get(group.node)?.registerShot(rounds));
  chainOnShot(guns, group => { stats.shots++; if (group.firer == null) stats.seatShots++; });
  // The pull, to every page: which gun of which hull, where it stood and
  // which way it pointed (BF1942's frame, z negated, as the relay's `f` row
  // carries a retail server's; `replay-hulls.js` `recordedLaunch` turns it
  // back). The firer's own page drew it from its own prediction.
  const shotDue = new WeakMap();
  chainOnShot(guns, group => {
    const entry = group.entry;
    if (!entry || group.firer != null) return;
    if (room.tick < (shotDue.get(group) ?? 0)) return;
    shotDue.set(group, room.tick + SHOT_ROW_TICKS);
    const node = group.node;
    node.updateWorldMatrix(true, false);
    node.getWorldPosition(_gunAt);
    _gunDir.set(0, 0, -1).applyQuaternion(node.getWorldQuaternion(_gunQuat));
    const r = v => Math.round(v * 1000) / 1000;
    const slot = firerOf(group);
    room.broadcast(eventRow('shot', room.tick, {
      slot, vehicle: entry.id, seat: true, alt: group.stats?.input === 'c_PIAltFire',
      gun: node.name || null, weapon: node.name || null,
      pos: [r(_gunAt.x), r(_gunAt.y), r(-_gunAt.z)], dir: [r(_gunDir.x), r(_gunDir.y), r(-_gunDir.z)],
    }), slot != null ? room.players.get(slot) ?? null : null);
    stats.shotRows++;
  });
  guns.roundsLeft = group => {
    const state = world.fireStates.get(group.node);
    return state && !state.unlimited ? state.ammo : Infinity;
  };
  guns.coneOf = seatConeOf({
    stateOf: node => world.fireStates.get(node),
    firerOf: group => (group.firer != null ? null : firerOf(group)),
    botOf: slot => room.bots?.slots?.get(slot)?.bot ?? null,
  });

  const stats = { shots: 0, seatShots: 0, botRounds: 0, shotRows: 0, gunRows: 0 };

  // --- a bot's launcher or thrown weapon (`viewer/bot-rounds.js`) ---------------

  /** weapon name -> `{ tree, launches, throws, fireArms }` or null. */
  const weapons = new Map();
  /** `${slot}\0${weapon}` -> `{ root, group, ray }`. */
  const held = new Map();
  let botLaw = null;

  /** The page's own tests of which rounds are flown and which thrown
   *  (`bot-rounds.js`), loaded with the bot code: a room without bots never
   *  imports it. */
  async function loadBotLaw() {
    botLaw ??= await import('../viewer/bot-rounds.js').then(m => ({
      launchesDrawnRound: m.launchesDrawnRound, throwsRound: m.throwsRound, thrownAim: m.thrownAim,
    })).then(async law => {
      const plans = await import('../viewer/bot-plans.js');
      return { ...law, firingPoint: plans.firingPoint };
    }).catch(() => null);
    return botLaw;
  }

  function weaponOf(name, fileOf) {
    if (weapons.has(name)) return weapons.get(name);
    let entry = null;
    try {
      const file = fileOf(name);
      const tree = file ? loadVehicleTree(file) : null;
      let fireArms = null;
      tree?.traverse(node => { fireArms ??= node.userData?.fireArms ?? null; });
      if (tree && fireArms && botLaw?.launchesDrawnRound(fireArms)) {
        entry = { tree, fireArms, throws: botLaw.throwsRound(fireArms) };
      }
    } catch { entry = null; }
    weapons.set(name, entry);
    return entry;
  }

  function botGroup(bot, name, entry) {
    const key = `${bot.playerId}\u0000${name}`;
    let h = held.get(key);
    if (h) return h;
    const root = entry.tree.clone(true);
    const ray = { origin: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1) };
    const slot = bot.playerId;
    const [group] = guns.collect(root, {
      replace: false, speedScale: 1, maxRange: 1200, roundLifetime: 'data',
      aimRay: () => ray,
      platformVelocity: () => world.player(slot)?.soldier?.body?.velocity ?? null,
    });
    if (!group) return null;
    group.firer = slot;
    group.weapon = name;
    group.owner = -1;
    group.ownerFor = collider;
    scene.add(root);
    h = { root, group, ray };
    held.set(key, h);
    return h;
  }

  /**
   * The referee's `env.launchRound` (`bot-rounds.js` `launch`, the page's):
   * true when the bot's held weapon's round is now in flight here (a rocket,
   * a rifle grenade, a thrown weapon), false to leave it the referee's ray.
   * `fileOf(name)` is the weapon's model glb (`room-bots.mjs` `botDataFor`).
   */
  function launchBotRound(bot, stats_, fileOf) {
    if (!botLaw) return false;
    const name = bot.weaponAi?.name ?? null;
    const entry = name ? weaponOf(name, fileOf) : null;
    if (!entry) return false;
    const h = botGroup(bot, name, entry);
    if (!h) return false;
    const { origin, dir: eyeDir } = bot.aimRay();
    let dir = eyeDir;
    if (entry.throws && bot.firingTarget != null && bot.targetPosition) {
      dir = botLaw.thrownAim({
        origin, target: botLaw.firingPoint(bot), speed: entry.fireArms.velocity ?? stats_?.velocity ?? 0,
        gravity: entry.fireArms.projectile?.gravity ?? 1, indirect: !!bot.weaponAi?.indirect,
      });
    }
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const barrels = declaredBarrels(stats_?.barrels);
    const [x, y, z] = botDeviate([dir[0] / len, dir[1] / len, dir[2] / len], bot.aimDeviation ?? 0,
                                 deviationIndex(botInputIndex(bot), barrels, 0));
    h.ray.origin.set(origin[0], origin[1], origin[2]);
    h.ray.dir.set(x, y, z);
    h.root.position.copy(h.ray.origin);
    h.root.quaternion.setFromUnitVectors(_minusZ, h.ray.dir);
    h.root.updateMatrixWorld(true);
    guns.fireShot(h.group);
    stats.botRounds++;
    return true;
  }

  /** A bot left the room: its groups go; a round in the air keeps its stamp. */
  function forgetBot(slot) {
    for (const [key, h] of held) {
      if (h.group.firer !== slot) continue;
      guns.release(h.group);
      scene.remove(h.root);
      held.delete(key);
    }
  }

  /** The round is over or the world cleared: nothing stays in the air and no
   *  trigger stays held. */
  function clear() {
    guns.clear();
    for (const group of guns.groups) { group.firing = false; group.delayPending = false; }
  }

  // --- the magazine, to the gunner's page ---------------------------------------
  //
  // The server's FireArms is the one that fires, so its magazine is the
  // truth: retail sends a player their own weapon's state with the control
  // object (`GhostManager::writeControlObjectState`; the relay's `control`
  // record carries the FireArms counter a client reconciles its predicted gun
  // against). The page predicts the same law on its own copy, so what it is
  // sent is a correction: the loaded rounds, the spare magazines, the reload
  // left and the heat of each gun of the seat, named by its place among the
  // hull's FireArms.

  /** slot -> { root, sent: Map(node -> { key, ammo, at }) }. */
  const gunRows = new Map();
  const hullGuns = new WeakMap();

  function syncGuns() {
    for (const [slot, connection] of room.players) {
      const player = world.player(slot);
      const root = player?.occupancy?.root ?? null;
      if (!root) { gunRows.delete(slot); continue; }
      let mine = gunRows.get(slot);
      if (!mine || mine.root !== root) {
        mine = { root, sent: new Map() };
        gunRows.set(slot, mine);
      }
      let order = hullGuns.get(root);
      if (!order) hullGuns.set(root, order = fireArmsNodes(root));
      const entry = instance.table.find(v => v.root === root);
      if (!entry) continue;
      let rows = null;
      for (const group of [...(player.groups ?? []), ...(player.manned ?? [])]) {
        const state = world.fireStates.get(group.node);
        if (!state || state.unlimited) continue;
        const reloading = state.reloadRemaining > 0;
        const key = `${state.magsLeft}|${reloading ? 1 : 0}|${state.overheatRemaining > 0 ? 1 : 0}`;
        const last = mine.sent.get(group.node);
        // A seat switch re-sends: `manned` is the new seat's.
        if (last && last.key === key && room.tick - last.at < GUN_HEARTBEAT_TICKS
            && (last.ammo === state.ammo || room.tick - last.at < GUN_ROW_TICKS)) continue;
        mine.sent.set(group.node, { key, ammo: state.ammo, at: room.tick });
        const r = v => Math.round(v * 1000) / 1000;
        (rows ??= []).push([order.indexOf(group.node), state.ammo,
          Number.isFinite(state.magsLeft) ? state.magsLeft : -1,
          r(state.reloadRemaining), r(state.heat ?? 0), r(state.overheatRemaining ?? 0)]);
      }
      if (rows) {
        connection.peer.send(encodeJsonMsg(eventRow('gun', room.tick, { slot, vehicle: entry.id, guns: rows })));
        stats.gunRows++;
      }
    }
  }

  /**
   * After the world's step: every crewed hull's matrices walked, as the
   * page's renderer walks its scene once a frame (`sim/stage.mjs`
   * `afterCapture` does the same for the runner). A seat's aim rig is posed
   * after its drive wrote the hull, and nothing draws here, so without this a
   * bot aimed its turret from, and the next tick's rounds left, the matrices
   * of whenever something last asked for them.
   */
  function afterStep() {
    const walked = new Set();
    for (const [slot, player] of world.players) {
      const root = player.occupancy?.root;
      if (!root) continue;
      if (!walked.has(root)) {
        walked.add(root);
        root.updateMatrixWorld(true);
      }
      // A seat with no drive of its own rides its hull: where it is now.
      // The room's tick feeds a human's (`room.mjs` `#tick`); a bot is not
      // a connection, and its gunner's seat stayed where it was boarded
      // while the tank drove off, so it sensed and aimed from the base.
      if (!player.vehicle && player.position && !room.players.has(slot)) {
        const e = root.matrixWorld.elements;
        world.setPlayerPosition(slot, [e[12], e[13], e[14]]);
      }
    }
    syncGuns();
  }

  world.guns = guns;
  instance.gunGroupOf = gunGroupOf;
  instance.quietGuns = quiet;

  return {
    guns, stats, firerOf, gunGroupOf, quiet, resetHull, bodyCast, capsulesOf, soldierBones, recoilOnHull,
    loadBotLaw, launchBotRound, forgetBot, clear, afterStep,
    /** What a page may know (HELLO's `rounds`). */
    publicState: () => ({ seats: true }),
  };
}
