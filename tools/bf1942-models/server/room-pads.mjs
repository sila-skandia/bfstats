// A room's vehicle pads and wrecks: the engine's ObjectSpawner law run on the
// server, which is where retail runs it, and its answers sent to every
// client the way flags and tickets are.
//
// The page runs the same law for a level it plays alone (`level-statics.js`
// `stepVehiclePads` over `deployables.js` `SpawnerPad`, with the wreck side's
// answers from `vehicle-wrecks.js`); in a room the page draws what these rows
// say instead. What this file runs, each from the module that owns it:
//
//   * one `SpawnerPad` per `objectSpawns` row with a hull in the room's table
//     (`padFromSpawn`): the side holding the pad's flag picks the template
//     (SPAWN-2, SPAWN-12), a flag that opens neutral leaves its pads on their
//     own side (SPAWN-19, `followPadPoint`), the delay runs from the hull's
//     destruction and is drawn by `calcSpawnDelay` over the room's players
//     against its 16 slots (SPAWN-10, SPAWN-11, SPAWN-18), a capture restarts
//     it, and a wreck still on the pad goes before the next hull appears;
//   * the other side's hull for each pad that hands out a different template
//     per side (`padSides`), stood where the baked one stands, as the page's
//     `loadPadVariants` stands it;
//   * a hull's death: everyone in it dies with it (the page's
//     `killOccupantInWreck`), its body stops simulating (`retireBody`), and its
//     wreck goes after the page's wreck life (`WRECK_SECONDS`), whatever pad
//     it came from;
//   * the abandoned hull's clock (SPAWN-13, `AbandonClock`): a pad's hull far
//     from its pad, empty and with no soldier near, counts down `timeToLive`
//     and then loses `damageWhenLost` a second (SPAWN-20's out-of-area bill is
//     not modelled, as on the page);
//   * the round's half (HP-20, SPAWN-19): `clearWorld` destroys every hull,
//     and `restartMap`'s `ObjectSpawner::reset` puts every pad back the way the
//     level started it, so the first frame of the new round stands every hull
//     on its pad again.
//
// The rows: `padSpawn {vehicle, pad, template}` when a pad stands a hull up
// (fresh: full hit points, at the pad), `vehicleGone {vehicle}` when a hull
// leaves the world (its wreck cleared, replaced on its pad, or cleared by the
// round's end), and `hull {vehicle, hp, destroyed}` when a hull's hit points
// move by a whole point or it dies. `vehicle` is the room's table id; HELLO's
// `vehicles` carry each entry's pad, its `scene.glb` node and whether it
// stands, so a client joining mid-round draws the same hulls.

import * as THREE from 'three';

import {
  AbandonClock, calcSpawnDelay, followPadPoint, padControlPoint, padFromSpawn, padSides,
} from '../viewer/deployables.js';
import { CHARACTER_HEIGHT } from '../viewer/soldier-pose.js';
import { MAX_PLAYERS } from '../viewer/netcode.js';
import { bodyPoseOf, bodySpecFor } from './level-bodies.mjs';
import { placeholderEntry } from './vehicle-table.mjs';

/** Seconds a wreck stands before the room clears it: the page's own wreck
 *  life (`vehicle-wrecks.js` `WRECK_LINGER` 10 s, the measured wreck lifetime
 *  of a live round capture, plus its 2.5 s `WRECK_FADE`, a house rule), so a
 *  room's wreck goes as its clients' fades out. */
export const WRECK_SECONDS = 10 + 2.5;

const _home = new THREE.Matrix4();
const _parentInv = new THREE.Matrix4();
const _unit = new THREE.Vector3(1, 1, 1);
const _scale = new THREE.Vector3();

/**
 * @param {object} options
 * @param {object} options.room     the Room (`instance`, `levelData`, `players`)
 * @param {(row) => void} options.onRow   a MSG_EVENT row to everyone
 * @param {(slot) => void} options.unmount  the room's seat exit for a slot
 */
export function createRoomPads({ room, onRow, unmount }) {
  const instance = room.instance;
  const world = instance.world;
  const extras = instance.extras ?? {};
  const spawns = Array.isArray(extras.objectSpawns) ? extras.objectSpawns : [];
  const points = Array.isArray(extras.controlPoints) ? extras.controlPoints : [];
  const anyOsId = spawns.some(s => Number.isFinite(s?.osId));
  const byOwner = new Map(instance.table.map(entry => [entry.owner, entry]));
  /** One record per pad: `{ index, spawn, pad, point, held, flag, at,
   *  entries: Map(template -> entry), baked, live: Set(entry), firstDraw }`. */
  const records = [];
  /** owner -> the last hit points a `hull` row carried. */
  const sentHp = new Map();
  /** entry -> AbandonClock (SPAWN-13), armed afresh with every spawn. */
  let abandonClocks = new WeakMap();

  // --- the pads -------------------------------------------------------------

  const padded = new Map();
  for (const entry of instance.table) {
    if (entry.pad == null) continue;
    if (!padded.has(entry.pad)) padded.set(entry.pad, []);
    padded.get(entry.pad).push(entry);
  }
  for (const [index, list] of padded) {
    const spawn = spawns[index];
    if (!spawn) continue;
    const baked = list[0];
    const entries = new Map(list.map(entry => [entry.template.toLowerCase(), entry]));
    // The other side's hull, where the baked one stands (`loadPadVariants`):
    // the templates the room loaded (`level-load.mjs`) for the sides that can
    // ever hold the pad.
    for (const team of padSides(spawn, points, anyOsId) ?? []) {
      const name = spawn.templates?.[String(team)];
      if (!name || entries.has(name.toLowerCase())) continue;
      const tree = room.levelData.templates?.get(name.toLowerCase());
      if (!tree) continue;
      const entry = placeholderEntry(instance, instance.table, {
        template: name, tree, window: baked.window, team: Number(team), pad: index, at: baked.home,
      });
      entry.live = false;
      instance.table.push(entry);
      instance.ownerToEntry?.set(entry.owner, entry);
      byOwner.set(entry.owner, entry);
      entries.set(name.toLowerCase(), entry);
    }
    records.push({
      index, spawn, pad: null, point: padControlPoint(spawn, points, anyOsId), held: null,
      flag: undefined, at: baked.home.position.toArray(), entries, baked, live: new Set(),
      firstDraw: true,
    });
  }

  /** The side holding a pad's point now: its flag's live team, else the
   *  level's (a point that is no flag never changes hands); null for none. */
  function pointTeam(record) {
    if (!record.point) return null;
    if (record.flag === undefined) {
      record.flag = world.flags?.find(f => f.controlPointName === record.point) ?? null;
    }
    if (record.flag) return record.flag.team ?? 0;
    const point = points.find(p => p?.name === record.point);
    return point ? (point.team ?? 0) : null;
  }

  /** The entry a pad's spawn of `template` stands up; a template the room has
   *  no model for keeps the baked hull, as the page's `padNode` does. */
  function entryFor(record, template) {
    return record.entries.get(String(template).toLowerCase()) ?? record.baked;
  }

  const destroyed = entry => !!world.vehicleDamage.get(entry.owner)?.destroyed;

  function positionOf(entry) {
    const pose = world.vehiclePose(entry.owner);
    return pose ? [pose.x, pose.y, pose.z] : entry.home.position.toArray();
  }

  /** `ObjectSpawner::reset` (SPAWN-19): every pad as the level starts it, its
   *  first delay drawn on the next tick, and the bake's frame stood up now:
   *  the pad, then the hulls it does not stand taken out of the world. */
  function resetPads() {
    for (const record of records) {
      record.pad = padFromSpawn(record.spawn);
      record.held = null;
      record.flag = undefined;
      record.firstDraw = true;
      record.live.clear();
      record.pad.reset();
      followPadPoint(record, pointTeam(record));
      record.pad.tick(0, {
        alive: entry => record.live.has(entry),
        critical: () => false,
        distance: () => 0,
        spawn: template => {
          const entry = entryFor(record, template);
          record.live.add(entry);
          return entry;
        },
      });
      for (const entry of record.entries.values()) {
        if (record.live.has(entry)) standUp(entry, { announce: false });
        else retire(entry, { announce: false });
      }
    }
  }

  // --- a hull in and out of the world --------------------------------------

  /** A fresh hull on its pad: full hit points, its home pose, a parked body
   *  on its springs, its collision back, its abandon clock new. */
  function standUp(entry, { announce = true } = {}) {
    const vehicle = world.vehicleDamage.get(entry.owner);
    vehicle?.reset();
    entry.live = true;
    entry.wreckAge = null;
    // The home pose is world space; a scene node's is written through its
    // parent (the spawners group), a placeholder's stands bare.
    _home.compose(entry.home.position, entry.home.quaternion, _unit);
    if (entry.root.parent) {
      entry.root.parent.updateWorldMatrix(true, false);
      _home.premultiply(_parentInv.copy(entry.root.parent.matrixWorld).invert());
    }
    _home.decompose(entry.root.position, entry.root.quaternion, _scale);
    entry.root.updateMatrixWorld(true);
    abandonClocks.delete(entry);
    const spec = bodySpecFor(entry.root, room.levelData);
    world.removeBody(entry.owner);
    if (spec && world.bodyWorld) world.addParkedBody(entry.owner, spec, bodyPoseOf(entry.root));
    instance.collider?.clearMovedOwner?.(entry.owner, { enable: false });
    instance.statics?.enableOwner?.(entry.owner);
    sentHp.set(entry.owner, vehicle?.hitPoints ?? null);
    if (announce) {
      onRow({ type: 'padSpawn', vehicle: entry.id, pad: entry.pad, template: entry.template });
    }
  }

  /** The hull leaves the world: whoever is in it out first, its body and its
   *  collision gone. */
  function retire(entry, { announce = true } = {}) {
    for (const [slot, player] of world.players) {
      if (player.occupancy?.root === entry.root) unmount(slot);
    }
    const was = entry.live;
    entry.live = false;
    entry.wreckAge = null;
    world.removeBody(entry.owner);
    instance.collider?.clearMovedOwner?.(entry.owner, { enable: false });
    instance.statics?.disableOwner?.(entry.owner);
    if (announce && was) onRow({ type: 'vehicleGone', vehicle: entry.id });
  }

  /** A hull died this tick (the world's damage pass reports it): its crew
   *  die with it, before the authority's death pass reads their Armors, and
   *  it becomes a wreck that stops simulating. */
  function hullDeaths(step) {
    for (const change of step?.damage ?? []) {
      if (!change.died) continue;
      // The damage pass reports the DamageableVehicle, which knows its owner.
      const entry = byOwner.get(change.vehicle?.owner ?? change.vehicle);
      if (!entry?.live || entry.wreckAge != null) continue;
      for (const [slot, player] of world.players) {
        if (player.occupancy?.root !== entry.root) continue;
        if (player.armor && !player.armor.destroyed) player.armor.applyDamage(player.armor.hitPoints + 1);
        unmount(slot);
      }
      world.retireBody(entry.owner);
      entry.wreckAge = 0;
    }
  }

  // --- one tick ---------------------------------------------------------------

  /** Every soldier on foot and alive, at his origin (feet plus a metre). */
  function footOrigins() {
    const out = [];
    for (const [slot, player] of world.players) {
      const s = player?.soldier;
      if (!s || player.occupancy || player.armor?.destroyed || room.authority?.dead?.has(slot)) continue;
      out.push([s.x, s.y + CHARACTER_HEIGHT, s.z]);
    }
    return out;
  }

  /** SPAWN-13's clock over every pad's standing hull (`vehicle-wrecks.js`
   *  `stepAbandoned`, whose law this is): only a scene that carries the words
   *  arms it. */
  function stepAbandoned(dt) {
    let feet = null;
    for (const record of records) {
      const spec = record.spawn;
      if (!Number.isFinite(spec?.timeToLive)) continue;
      for (const entry of record.live) {
        const vehicle = world.vehicleDamage.get(entry.owner);
        if (!vehicle || vehicle.destroyed || !entry.live) continue;
        let clock = abandonClocks.get(entry);
        if (!clock) {
          clock = new AbandonClock({
            timeToLive: spec.timeToLive,
            distance: Number.isFinite(spec.distance) ? spec.distance : 100,
            damageWhenLost: Number.isFinite(spec.damageWhenLost) ? spec.damageWhenLost : 1,
          });
          abandonClocks.set(entry, clock);
        }
        const at = positionOf(entry);
        const spawnerDistance = Math.hypot(at[0] - record.at[0], at[1] - record.at[1], at[2] - record.at[2]);
        const occupied = entry.seated > 0;
        let soldierNear = false;
        if (spawnerDistance > clock.distance && !occupied) {
          feet ??= footOrigins();
          // His bounding radius: the page's is the drawn sphere
          // (`cullRadius`); the room draws nothing, so its collision parts'.
          entry.radius ??= bodySpecFor(entry.root, room.levelData)?.boundingRadius ?? 0;
          const r = entry.radius;
          soldierNear = feet.some(o =>
            (o[0] - at[0]) ** 2 + (o[1] - at[1]) ** 2 + (o[2] - at[2]) ** 2 < r * r);
        }
        const loss = clock.step(dt, { spawnerAlive: true, spawnerDistance, soldierNear, occupied });
        if (loss > 0) vehicle.damage(loss, null);
      }
    }
  }

  /** The pads, the wrecks and the hulls' hit points, once a tick after the
   *  authority (the page's order: the capture pass, then the damage pass and
   *  its wrecks and pads). */
  function step(dt) {
    if (!(dt > 0)) return;
    stepAbandoned(dt);
    // The wrecks: each goes after its life, wherever it lies.
    for (const entry of instance.table) {
      if (entry.wreckAge == null || !entry.live) continue;
      entry.wreckAge += dt;
      if (entry.wreckAge >= WRECK_SECONDS) {
        for (const record of records) record.live.delete(entry);
        retire(entry);
      }
    }
    const players = room.players?.size ?? world.players.size;
    for (const record of records) {
      const { pad } = record;
      followPadPoint(record, pointTeam(record));
      pad.players = players;
      pad.maxPlayers = MAX_PLAYERS;
      if (record.firstDraw) {
        record.firstDraw = false;
        if (pad.slots[0] != null) pad.delay = calcSpawnDelay(pad.min, pad.max, pad.players, pad.maxPlayers);
      }
      for (const entry of record.live) if (!entry.live) record.live.delete(entry);
      pad.tick(dt, {
        alive: entry => record.live.has(entry),
        critical: entry => destroyed(entry),
        distance: entry => {
          const p = positionOf(entry);
          return Math.hypot(p[0] - record.at[0], p[1] - record.at[1], p[2] - record.at[2]);
        },
        destroy: entry => {
          // A wreck still burning on the pad is replaced, not waited out.
          if (!destroyed(entry) || !entry.live) return;
          record.live.delete(entry);
          retire(entry);
        },
        spawn: template => {
          const entry = entryFor(record, template);
          // One hull per template: an earlier one still standing (its wreck
          // away from the pad) clears first, and nobody may still sit in it.
          if (entry.live || entry.seated > 0) return null;
          standUp(entry);
          record.live.add(entry);
          return entry;
        },
      });
    }
    // The hit points of every hull and of every placed static that has an
    // Armor, to every client, when they move a whole point: a hull by its
    // table id (`hull`), a static by its `scene.glb` node (`object`), the
    // name the page finds its own copy by. The page's own damage pass then
    // draws them: the tiers, the death tier and what it stands up (EMT-10),
    // the wreck and the crew it kills.
    for (const [owner, vehicle] of world.vehicleDamage.byOwner) {
      const entry = byOwner.get(owner);
      if (entry && !entry.live) continue;
      const node = entry ? null : instance.ownerRoots[owner]?.levelNode;
      if (!entry && node == null) continue;
      const hp = vehicle.hitPoints;
      const last = sentHp.get(owner) ?? vehicle.maxHitPoints;
      const dead = vehicle.destroyed;
      if (Math.abs(hp - last) < 1 && !(dead && last > 0)) continue;
      sentHp.set(owner, dead ? 0 : hp);
      const value = Math.max(0, Math.round(hp * 10) / 10);
      onRow(entry ? { type: 'hull', vehicle: entry.id, hp: value, destroyed: dead }
        : { type: 'object', node, hp: value, destroyed: dead });
    }
  }

  /** The hit points of every hull and static that is not at its full count
   *  now, for a client joining mid-round (HELLO's `damage`): `{ hulls: [[id,
   *  hp]], objects: [[node, hp]] }`. */
  function damageState() {
    const hulls = [];
    const objects = [];
    for (const [owner, vehicle] of world.vehicleDamage.byOwner) {
      if (vehicle.hitPoints >= vehicle.maxHitPoints && !vehicle.destroyed) continue;
      const entry = byOwner.get(owner);
      const hp = vehicle.destroyed ? 0 : Math.round(vehicle.hitPoints * 10) / 10;
      if (entry) { if (entry.live) hulls.push([entry.id, hp]); continue; }
      const node = instance.ownerRoots[owner]?.levelNode;
      if (node != null) objects.push([node, hp]);
    }
    return { hulls, objects };
  }

  /** HP-20's `clearWorld` on the hulls: every one leaves the world. */
  function clearWorld() {
    for (const entry of instance.table) {
      for (const record of records) record.live.delete(entry);
      retire(entry);
    }
  }

  /** `restartMap` on the hulls: every one back in its pad's hands, the pads
   *  as the level started them, the bake's frame stood up again. A hull no
   *  pad names (a scene from before `objectSpawns`) comes back where the
   *  level put it. */
  function restart() {
    for (const entry of instance.table) {
      if (entry.pad == null || !records.some(r => r.entries.get(entry.template.toLowerCase()) === entry)) {
        standUp(entry);
      }
    }
    resetPads();
    for (const record of records) {
      for (const entry of record.live) {
        onRow({ type: 'padSpawn', vehicle: entry.id, pad: entry.pad, template: entry.template });
      }
    }
  }

  resetPads();

  return {
    records,
    hullDeaths,
    step,
    clearWorld,
    restart,
    /** Whether the entry stands in the world now (HELLO's `live`). */
    live: entry => !!entry.live,
    damageState,
    WRECK_SECONDS,
  };
}
