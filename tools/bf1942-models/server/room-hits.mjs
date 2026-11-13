// A room's hits and blasts: where a round landed, priced and applied on the
// server, the way `GameServer::handleCollisionForProjectile` and
// `handleExplosionOnObject` price them on retail's.
//
// Retail's server flies every round itself. The room flies its seat guns
// and its bots' launchers and thrown weapons (`room-guns.mjs`, 2026-11-13:
// the page's own `GunFire` in the room's World), and each of those landings
// is priced here by `onRound`, from nothing but the server's own flight.
//
// THE DEPARTURE that is left: a human's hand weapon. The input word carries
// no weapon slot, so the server cannot know which of a kit's weapons a pull
// fires, and the shooter's page, in a room, still reports each landing of
// its own hand-weapon rounds (`vehicle-hits.js` `applyVehicleHit`, the
// record `gunfire.js` hands `onImpact`; `hand-fire.js` for a bullet on a
// soldier) and applies no damage of its own. `onImpact` prices those. Both
// run the page's own law over the room's world:
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
// What `onImpact` trusts the shooter for is what its round computed: the
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
import { BLAST_SEPARATION_MIN, Knockback, VANILLA_SOLDIER_FORCE, soldierBlastAcceleration,
  objectBlastAcceleration, blastPushPoint } from '../viewer/knockback.js';
import { armorExplosion, deathBlastRecord } from '../viewer/vehicle-damage.js';
import { seatAnchor } from '../viewer/seat-body.js';
import { soldierExposure, worldBlocker } from '../viewer/soldier-exposure.js';
import { soldierTemplateValue } from '../viewer/soldier-death.js';
import { encodeJsonMsg, eventRow } from './room-wire.mjs';

/** `MaterialManager.material 40`, the soldier's own defending material, the
 *  one a blast's damage mod is looked up against (`vehicle-hits.js`). */
const SOLDIER_SPLASH_MATERIAL = 40;

/** The bounds a reported landing must sit in: a blast no wider than the
 *  widest the trees ship by a margin, a hit no dearer than any hull. */
export const IMPACT_LIMITS = Object.freeze({ radius: 100, damage: 1e5, force: 1e4, yMod: 10,
  // One round on a soldier: no vanilla round prices over a few hundred.
  soldier: 1000 });

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
    for (const [owner] of world.vehicleDamage.byOwner) {
      // A wreck too, until it is retired: `applySplash` hands it on only for
      // its push (`wrecks`), its own death blast's included (HP-21, KNOCK-4).
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
    // The seated crews (HFD-12; `vehicle-hits.js` `crewTargets` has the
    // addresses): a man in a seat that reaches a `SeatObject` is splashed as
    // a soldier from that seat, one in a seat with none (a tank's driver,
    // object flag bit 0, SEAT-37) is not.
    for (const [slot, player] of world.players) {
      const occ = player.occupancy;
      if (!occ || !player.armor || player.armor.destroyed) continue;
      if (room.authority.dead.has(slot)) continue;
      const seat = occ.seatInfo?.(occ.activeSeatId);
      if (!seat?.seatObjects?.length) continue;
      const anchor = seatAnchor(seat);
      if (!anchor?.matrixWorld) continue;
      occ.root?.updateMatrixWorld?.(true);
      const e = anchor.matrixWorld.elements;
      targets.push({
        owner: -1, armor: player.armor, soldier: true, seated: true, pose: player.soldier?.pose ?? 0,
        playerId: slot, splashMaterial: SOLDIER_SPLASH_MATERIAL,
        x: e[12], y: e[13], z: e[14],
      });
    }
    return targets;
  }

  /** The push a blast gives a hull it priced above zero (KNOCK-4, KNOCK-5;
   *  `vehicle-hits.js` `pushHull` has the addresses), into the server's own
   *  body for it, whose pose every page is sent. */
  function pushHull(hit, record) {
    const owner = hit.target?.owner;
    if (!(owner >= 0)) return null;
    const entry = world.bodyWorld?.get(owner);
    const body = entry?.driven ?? entry?.parked?.body;
    if (!body?.addAccelerationAt) return null;
    const spec = armorExplosion(tables, hit.vehicle?.template ?? hit.vehicle?.name);
    if (!spec) return null;
    const [bx, by, bz] = record.splashPoint;
    const yMod = record.splashYMod > 0 ? record.splashYMod : 1;
    const t = hit.target;
    let terrainNormal = null;
    if (hit.distance < BLAST_SEPARATION_MIN) {
      const n = [0, 1, 0];
      instance.collider?.heightfield?.normal?.(bx, bz, n);
      terrainNormal = { x: n[0], y: n[1], z: n[2] };
    }
    const push = objectBlastAcceleration({
      force: record.splashForce ?? undefined,
      radius: record.splashRadius,
      distance: hit.distance,
      offset: [t.x - bx, (t.y - by) * yMod, t.z - bz],
      axes: body.axes,
      forceMod: spec.explosionForceMod,
      forceMax: spec.explosionForceMax,
      terrainNormal,
    });
    if (!(push.force > 0)) return null;
    const at = blastPushPoint([bx, by, bz], [t.x, t.y, t.z], body.boundingRadius);
    body.wake?.();
    body.addAccelerationAt(at, [push.x, push.y, push.z]);
    return push;
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
                                 settings: room.host?.friendlyFire() ?? FRIENDLY_FIRE_SHIPPED }));
      if (landed) done.direct = { owner: record.owner, lost: landed.lost };
    }
    // The direct hit on a soldier (`hit.slot`: a human's or a bot's): the
    // round's own price as the page computed it against the capsule it met,
    // under `calcDamage` (FF-1). The page reports it because the room flies
    // no rounds; with bots in the room this is how a human's rifle reaches
    // one (`room-bots.mjs` `hurt`, which also tells the bot it was hit).
    const struck = row.hit?.slot;
    if (Number.isInteger(struck) && struck !== slot && record.damage > 0) {
      const victim = world.player(struck);
      if (victim?.armor && !victim.armor.destroyed) {
        const amount = friendlyDamage(Math.min(record.damage, IMPACT_LIMITS.soldier), {
          attackerTeam, victimTeam: victim.team ?? null, soldier: true,
          settings: room.host?.friendlyFire() ?? FRIENDLY_FIRE_SHIPPED });
        const lost = room.bots ? room.bots.hurt(struck, amount, slot, record.point) : 0;
        if (lost > 0) done.direct = { slot: struck, lost };
      }
    }
    // The blast, on everything in its reach but the one it struck (HP-9g).
    if (Number.isInteger(struck)) record.target = struck;
    const splash = row.splash;
    if (splash && Number.isFinite(splash.radius) && splash.radius > 0
        && Number.isFinite(splash.material2) && splash.material2 >= 0) {
      record.splashRadius = clamp(splash.radius, 0, IMPACT_LIMITS.radius);
      record.splashMaterial2 = Math.trunc(splash.material2);
      record.splashYMod = Number.isFinite(splash.yMod) ? clamp(splash.yMod, 0, IMPACT_LIMITS.yMod) : undefined;
      record.splashForce = Number.isFinite(splash.force) ? clamp(splash.force, 0, IMPACT_LIMITS.force) : undefined;
      done.splashed = applyBlast(record, slot, (amount, target) => friendlyDamage(amount, {
        attackerTeam, splash: true, soldier: !!target.soldier,
        victimTeam: target.soldier ? world.player(target.playerId)?.team ?? null : hullTeam(target.owner),
        settings: room.host?.friendlyFire() ?? FRIENDLY_FIRE_SHIPPED,
      }));
    }
    return done;
  }

  /**
   * One landing of a round the room flew itself (`room-guns.mjs`: a seat
   * gun's, a bot's launcher's or grenade's), as `GunFire` reports it: the
   * record `round-impact.js` builds, priced by nothing but the server's own
   * flight. The direct hit on a soldier (`record.target`, a slot: DMG-3 on
   * the stand-in body's material) or on a hull or static (`record.owner`),
   * then the blast (HP-9, HP-10) and its pushes, each under `calcDamage` at
   * the side the round was stamped with when it left (FF-1, KILLSTAMP-1).
   * Returns what it did, for a check.
   */
  function onRound(record) {
    if (!record) return null;
    const slot = record.stamp?.firer ?? null;
    const team = record.stamp?.team;
    const attackerTeam = team === 1 || team === 2 ? team : null;
    const settings = room.host?.friendlyFire() ?? FRIENDLY_FIRE_SHIPPED;
    const done = { direct: null, splashed: [] };
    // The crosshair's marks are the server's word for a round the server
    // flew (XHIT-4, XHIT-5; `GameServer::giveDamage` 0x0814b2e0 raises them
    // before it prices anything): the direct hit met a soldier, or a hull
    // with a crew, whatever its side and whatever it cost. To the firer's
    // page alone, which raises them on the row (`net-room.js` `hitMark`).
    const marks = record.target != null
      ? !!world.player(record.target)
      : record.kind === 'object' && record.owner >= 0 && hullTeam(record.owner) !== 0
        && !world.vehicleDamage.get(record.owner)?.destroyed;
    if (marks && slot != null) {
      room.players.get(slot)?.peer.send(encodeJsonMsg(eventRow('hitMark', room.tick, { slot })));
    }
    if (record.target != null && record.damage > 0) {
      const victim = world.player(record.target);
      if (victim?.armor && !victim.armor.destroyed) {
        // A man in a seat has the hull for his root: the vehicle ratio.
        const amount = friendlyDamage(Math.min(record.damage, IMPACT_LIMITS.soldier), {
          attackerTeam, victimTeam: victim.team ?? null, soldier: !record.seated, settings });
        const lost = room.bots.hurt(record.target, amount, slot, record.origin ?? record.point,
                                    { weapon: record.stamp?.weapon ?? null, dist: record.travelled });
        if (lost > 0) done.direct = { slot: record.target, lost };
      }
    } else if (record.owner != null && record.owner >= 0 && record.damage > 0) {
      const landed = world.vehicleDamage.applyHit(record, slot, (damage, owner) =>
        friendlyDamage(damage, { attackerTeam, victimTeam: hullTeam(owner), soldier: false, settings }));
      if (landed) done.direct = { owner: record.owner, lost: landed.lost };
    }
    if (record.splashRadius > 0 && Number.isFinite(record.splashMaterial2)) {
      // The object the round struck is out of its own blast (`applySplash`,
      // HP-9g: its Armor is the explosion's source); the hull that fired it
      // is not.
      const blast = { ...record, splashPoint: record.splashPoint ?? record.point };
      done.splashed = applyBlast(blast, slot, (amount, target) => friendlyDamage(amount, {
        attackerTeam, splash: true, soldier: !!target.soldier,
        victimTeam: target.soldier ? world.player(target.playerId)?.team ?? null : hullTeam(target.owner),
        settings,
      }));
    }
    return done;
  }

  /**
   * One `handleExplosion` on the room's world: the splash (HP-9, HP-10) on
   * every hull, soldier on foot and seated crew (HFD-12) in reach, each
   * hull's push (KNOCK-4) and each soldier on foot's (seated men are not
   * pushed: they have a parent). `scale` is `calcDamage`, null for team -1.
   * Returns `[{ slot | owner, lost }]`; `deaths`, when given, collects every
   * hull it priced, for the caller to settle.
   */
  function applyBlast(record, attacker, scale, deaths = null) {
    const blocked = worldBlocker(instance.collider, { skipOwner: -1 });
    const splashed = world.vehicleDamage.applySplash(record, splashTargets(), {
      materials: tables?.materials ?? null,
      modifiers: tables?.modifiers ?? null,
      exposure: (target, blast) => soldierExposure({ x: blast[0], y: blast[1], z: blast[2] },
                                                   target, target.pose ?? 0, blocked),
      attacker, scale, wrecks: true,
    });
    const out = [];
    for (const hit of splashed) {
      if (hit.wreck) {
        pushHull(hit, record);
        continue;
      }
      if (hit.target?.soldier) {
        // Who to name if it kills him: the death decree reads `lastHit`.
        hit.target.armor.lastHit = attacker ?? null;
        // A bot it hurt is told (`room-bots.mjs` `landed`): the HP is off.
        room.bots?.landed?.(hit.target.playerId, hit.lost, attacker ?? null,
                            record.splashPoint ?? record.point ?? null);
        if (!hit.target.seated) throwSoldier(hit, record);
        out.push({ slot: hit.target.playerId, lost: hit.lost });
      } else {
        pushHull(hit, record);
        deaths?.push(hit.vehicle);
        out.push({ owner: hit.target.owner, lost: hit.lost });
      }
    }
    return out;
  }

  /**
   * The destroyed Armors' own blasts (gap audit entry 3; `vehicle-damage.js`
   * `deathBlastRecord` has `Armor::status`'s call): for every hull or static
   * the world's damage pass reports dead this tick, its blast at its origin,
   * credited to its last hitter and never scaled (team -1). A hull that blast
   * kills is reported into `step.damage` as the world's own pass would, and
   * blows in its turn, the same tick, as retail's recursion through `status`
   * does. Run before `hullDeaths`, which reads that list.
   */
  function deathBlasts(step) {
    const changes = step?.damage;
    if (!Array.isArray(changes) || !tables?.armors) return 0;
    let blasts = 0;
    for (let i = 0; i < changes.length; i++) {
      const vehicle = changes[i]?.died ? changes[i].vehicle : null;
      if (!vehicle) continue;
      const spec = armorExplosion(tables, vehicle.template ?? vehicle.name);
      const pose = world.vehiclePose(vehicle.owner);
      const record = pose ? deathBlastRecord(spec, [pose.x, pose.y, pose.z]) : null;
      if (!record) continue;
      blasts++;
      const priced = [];
      applyBlast(record, vehicle.lastHitPlayer ?? null, null, priced);
      for (const hull of priced) {
        const change = world.reconcile(hull);
        if (change?.died) changes.push(change);
      }
    }
    return blasts;
  }

  return { onImpact, onRound, deathBlasts };
}
