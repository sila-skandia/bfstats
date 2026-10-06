// A room's hits and blasts: where a round landed, priced and applied on the
// server, the way `GameServer::handleCollisionForProjectile` and
// `handleExplosionOnObject` price them on retail's.
//
// THE DEPARTURE. Retail's server flies every round itself. The room flies
// none: its World has no `GunFire` (the P3 slice-B gap in
// `features/netcode-play-multiplayer/README.md`), and the input word carries
// no weapon slot, so a hand weapon could not be flown there anyway. So the
// shooter's page, in a room, reports each landing of its own rounds
// (`vehicle-hits.js` `applyVehicleHit`, the record `gunfire.js` hands
// `onImpact`) and applies no damage of its own, and this file is where the
// landing is priced, by the page's own law over the room's world:
//
//   * the direct hit: `vehicle-damage.js` `applyHit` on the struck hull or
//     static, scaled by `calcDamage`'s friendly-fire law (`friendly-fire.js`,
//     the shipped `ServerSettings.con` percentages);
//   * the blast (HP-9..HP-10): `applySplash` over every damageable the world
//     holds and every soldier on foot, alive, his exposure from the room's
//     collider (`soldier-exposure.js`), the firer's own hull left out by
//     owner id;
//   * the push (KNOCK-4..KNOCK-9): `knockback.js` `soldierBlastAcceleration`
//     into the soldier's own body (`walking-body.js` `blast`), whose
//     `Knockback` then runs the flight and the landing on the server's tick;
//     his soldier template's `explosionForceMod` / `explosionForceMax` out of
//     the tree's `gaits.json`, the round's `forceOnExplosion` off the record.
//
// What the page trusts the shooter for is what its round computed: the
// direct hit's damage (its distance falloff, the angle term) and the blast's
// own fields (radius, material, Y modifier, force), each clamped to a sane
// range. A modified page could forge them; a room is a game among friends.
//
// The results reach every client the way the rest of the room's state does:
// the hulls' and statics' hit points as `hull` / `object` rows
// (`room-pads.mjs`), a death through the authority's decree (`killed`, its
// `other` the shooter: the Armor's `lastHit` is the seam), and each push as a
// `blast {slot, push}` row, which the victim's page applies to its own body and
// every other page draws as the flight the snapshot's state names.

import { CHARACTER_HEIGHT } from '../viewer/physics.js';
import { FRIENDLY_FIRE_SHIPPED, friendlyDamage } from '../viewer/friendly-fire.js';
import { BLAST_SEPARATION_MIN, Knockback, VANILLA_SOLDIER_FORCE, soldierBlastAcceleration }
  from '../viewer/knockback.js';
import { soldierExposure, worldBlocker } from '../viewer/soldier-exposure.js';
import { soldierTemplateValue } from '../viewer/soldier-death.js';

/** `MaterialManager.material 40`, the soldier's own defending material, the
 *  one a blast's damage mod is looked up against (`vehicle-hits.js`). */
const SOLDIER_SPLASH_MATERIAL = 40;

/** The bounds a reported landing must sit in: a blast no wider than the
 *  widest the trees ship by a margin, a hit no dearer than any hull. */
export const IMPACT_LIMITS = Object.freeze({ radius: 100, damage: 1e5, force: 1e4, yMod: 10 });

const finite3 = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * @param {object} options
 * @param {object} options.room   the Room (`instance`, `levelData`, `authority`)
 * @param {(row) => void} options.onRow   a MSG_EVENT row to everyone
 */
export function createRoomHits({ room, onRow }) {
  const instance = room.instance;
  const world = instance.world;
  const tables = room.levelData.damageTables ?? null;
  const soldierBody = room.levelData.soldierBody ?? null;
  /** A `scene.glb` node index -> its owner id (the page names a static so). */
  const ownerByNode = new Map();
  instance.ownerRoots.forEach((node, owner) => {
    if (node?.levelNode != null) ownerByNode.set(node.levelNode, owner);
  });

  /** The owner a report names: a room vehicle by its table id, else a
   *  placed object by its `scene.glb` node; null for the ground. */
  function ownerOf(hit) {
    if (Number.isInteger(hit?.vehicle)) {
      const entry = instance.table.find(e => e.id === hit.vehicle);
      return entry?.live ? entry.owner : null;
    }
    if (Number.isInteger(hit?.node)) return ownerByNode.get(hit.node) ?? null;
    return null;
  }

  /** The owner of the hull a slot sits in, or -1 on foot. */
  function hullOf(slot) {
    const root = world.player(slot)?.occupancy?.root;
    return root ? (instance.ownerOf(root) ?? -1) : -1;
  }

  /** A hull's side: its crew's, 0 empty (`clearTeam`, XHIT-5). */
  function hullTeam(owner) {
    for (const player of world.players.values()) {
      const root = player.occupancy?.root;
      if (root && instance.ownerOf(root) === owner && (player.team === 1 || player.team === 2)) {
        return player.team;
      }
    }
    return 0;
  }

  /** The soldier template a side's men wear on this level (the page's
   *  `soldierTemplateFor`, out of `_shared/loadouts.json`). */
  function soldierTemplateOf(team) {
    return room.levelData.loadouts?.levels?.[room.levelData.name]?.[team]?.soldier ?? null;
  }

  /** Every damageable the world holds, where it stands, and every living
   *  soldier on foot at his object origin (feet plus a metre), as
   *  `applySplash` takes them (`vehicle-hits.js` `splashTargets`). */
  function splashTargets() {
    const targets = [];
    for (const [owner, vehicle] of world.vehicleDamage.byOwner) {
      if (vehicle.destroyed) continue;
      const entry = instance.ownerToEntry?.get(owner);
      if (entry && !entry.live) continue;
      const pose = world.vehiclePose(owner);
      if (!pose) continue;
      targets.push({ owner, x: pose.x, y: pose.y, z: pose.z });
    }
    for (const [slot, player] of world.players) {
      const s = player.soldier;
      if (!s || player.occupancy || !player.armor || player.armor.destroyed) continue;
      if (room.authority.dead.has(slot)) continue;
      targets.push({
        owner: -1, armor: player.armor, soldier: true, pose: s.pose ?? 0,
        playerId: slot, splashMaterial: SOLDIER_SPLASH_MATERIAL,
        x: s.x, y: s.y + CHARACTER_HEIGHT, z: s.z,
      });
    }
    return targets;
  }

  /** The push the blast that just priced him gives him (KNOCK-4..KNOCK-7),
   *  into his body on the server, and the row that tells the others. */
  function throwSoldier(hit, record) {
    const slot = hit.target.playerId;
    const player = world.player(slot);
    const body = player?.soldier?.body;
    if (!body?.blast) return;
    body.knockback ??= new Knockback();
    const [bx, by, bz] = record.splashPoint;
    const yMod = record.splashYMod > 0 ? record.splashYMod : 1;
    const template = soldierTemplateOf(player.team);
    const force = soldierTemplateValue(soldierBody, template, 'explosionForceMod');
    const ceiling = soldierTemplateValue(soldierBody, template, 'explosionForceMax');
    let terrainNormal = null;
    if (hit.distance < BLAST_SEPARATION_MIN) {
      const n = [0, 1, 0];
      instance.collider?.heightfield?.normal?.(bx, bz, n);
      terrainNormal = { x: n[0], y: n[1], z: n[2] };
    }
    const push = soldierBlastAcceleration({
      force: record.splashForce ?? undefined,
      radius: record.splashRadius,
      distance: hit.distance,
      offset: [hit.target.x - bx, (hit.target.y - by) * yMod, hit.target.z - bz],
      yaw: player.soldier.yaw,
      exposure: hit.exposure ?? 1,
      damageRatio: hit.raw > 0 ? hit.amount / hit.raw : 0,
      underWater: body.underWater,
      forceMod: Number.isFinite(force) ? force : VANILLA_SOLDIER_FORCE.mod,
      forceMax: Number.isFinite(ceiling) ? ceiling : VANILLA_SOLDIER_FORCE.max,
      terrainNormal,
    });
    body.blast(push.x, push.y, push.z, { ai: false });
    onRow({ type: 'blast', slot, push: [push.x, push.y, push.z] });
  }

  /**
   * One landing a slot's page reported (`MSG_ACTION {type: 'impact'}`):
   * `{ point, splashPoint?, hit: { vehicle? | node? }, damage, splash: {
   * radius, material2, yMod, force } | null }`. Dropped from the dead, and
   * for anything off the shape. Returns what it did, for a check.
   */
  function onImpact(connection, row) {
    const slot = connection.slot;
    if (!room.authority.mayInput(slot) || !row || typeof row !== 'object') return null;
    if (!finite3(row.point)) return null;
    const attackerTeam = connection.team === 1 || connection.team === 2 ? connection.team : null;
    const record = {
      point: row.point.slice(),
      splashPoint: finite3(row.splashPoint) ? row.splashPoint.slice() : row.point.slice(),
      owner: ownerOf(row.hit),
      damage: Number.isFinite(row.damage) ? clamp(row.damage, 0, IMPACT_LIMITS.damage) : 0,
      firer: hullOf(slot),
    };
    const done = { direct: null, splashed: [] };
    // The direct hit, on the object the round met.
    if (record.owner != null && record.damage > 0 && record.owner !== record.firer) {
      const landed = world.vehicleDamage.applyHit(record, slot, (damage, owner) =>
        friendlyDamage(damage, { attackerTeam, victimTeam: hullTeam(owner), soldier: false,
                                 settings: FRIENDLY_FIRE_SHIPPED }));
      if (landed) done.direct = { owner: record.owner, lost: landed.lost };
    }
    // The blast, on everything in its reach.
    const splash = row.splash;
    if (splash && Number.isFinite(splash.radius) && splash.radius > 0
        && Number.isFinite(splash.material2) && splash.material2 >= 0) {
      record.splashRadius = clamp(splash.radius, 0, IMPACT_LIMITS.radius);
      record.splashMaterial2 = Math.trunc(splash.material2);
      record.splashYMod = Number.isFinite(splash.yMod) ? clamp(splash.yMod, 0, IMPACT_LIMITS.yMod) : undefined;
      record.splashForce = Number.isFinite(splash.force) ? clamp(splash.force, 0, IMPACT_LIMITS.force) : undefined;
      const blocked = worldBlocker(instance.collider, { skipOwner: -1 });
      const splashed = world.vehicleDamage.applySplash(record, splashTargets(), {
        materials: tables?.materials ?? null,
        modifiers: tables?.modifiers ?? null,
        exposure: (target, blast) => soldierExposure({ x: blast[0], y: blast[1], z: blast[2] },
                                                     target, target.pose ?? 0, blocked),
        attacker: slot,
        scale: (amount, target) => friendlyDamage(amount, {
          attackerTeam, splash: true, soldier: !!target.soldier,
          victimTeam: target.soldier ? world.player(target.playerId)?.team ?? null : hullTeam(target.owner),
          settings: FRIENDLY_FIRE_SHIPPED,
        }),
      });
      for (const hit of splashed) {
        if (hit.target?.soldier) {
          // Who to name if it kills him: the death decree reads `lastHit`.
          hit.target.armor.lastHit = slot;
          throwSoldier(hit, record);
          done.splashed.push({ slot: hit.target.playerId, lost: hit.lost });
        } else {
          done.splashed.push({ owner: hit.target.owner, lost: hit.lost });
        }
      }
    }
    return done;
  }

  return { onImpact };
}
