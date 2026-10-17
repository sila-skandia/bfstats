// What a round's ObjectSpawner puts in the world, on the map page: FH's
// mobile guns' deploy (`Flak18/36mobile_TransformSpawnerProjectile` stands
// `Flak18/36mobilestatic` four seconds after it lands, and the static's own
// deploy round stands the mobile gun again), the artillery's and ships'
// `PenetrateExplosion*Spawner`, the torpedoes' dummy PCOs, FHSW's
// `AdvancedPost_*` posts, the half-tracks' MG-deploy kits. The exporter
// writes the round's spawner children as `projectile.spawners`
// (`bf42/assemble.py` `round_spawner_record`).
//
// The engine builds a template's children with it, so the spawner rides the
// round and runs `ObjectSpawner::handleFrameUpdate` (0x083138c0) every frame
// the round lives, on the server alone (its ctor 0x08312910 registers it for
// frame updates there and destroys it on a client). That is a pad's law
// (`deployables.js` `SpawnerPad`, SPAWN-9..SPAWN-11, SPAWN-24): the delay is
// -1 (spawn on the first frame) unless `spawnDelayAtStart`, then drawn by
// `calcSpawnDelay`; one empty slot a frame; a slot frees when its object is
// gone or destroyed; `nrOfObjectToSpawn` counts down and stops it at 0. The
// object is the `setObjectTemplate` entry of the spawner's own team (the
// template's `team`, 0 unless said; nothing on the fire path sets it), stood
// at the spawner's absolute position plus `spawnOffset` in world axes, turned
// as the spawner is (`spawnObject` 0x083140a0), unless a live human on foot
// has his origin within 2 m of that point (`createObjectOnAllClients`
// 0x08133a10, SPAWN-14). With `teamOnVehicle` the new object's `setTeam`
// is called with the spawner's team and never undone (SEAT-27: the hull's
// team count never returns to 0; `vehicles.stampTeam`). With `holdObject`
// the spawner keeps the object at that same pose, offset and all, every
// frame (`hull-bodies.js` `holdSpawned`, AI-121). The new object's abandon
// clock is the spawner's `TimeToLive` / `Distance` / `damageWhenLost`
// (SPAWN-13), and with the spawner gone the clock bills its step unscaled.
// When the round dies the spawner goes with it (`destroy` 0x08313690): what
// it placed stays, and a held one is let go (`setObjectSpawnerHolding(0)`).
//
// Three kinds of object:
// - a vehicle or a gun with a model: a full vehicle parked out of the world
//   at load (`level-statics.js` `loadRoundSpawnPool`), stood up through the
//   wreck side's own respawn (`vehicle-wrecks.js` `padWorld.spawn`) and put
//   where the spawner says (`hull-bodies.js` `standSpawnedObject`), so a
//   seat, a gun, a blast and a wreck work on it as on any placed hull. When
//   more are out at once than the load parked, the pool grows by a clone of
//   the template's mould (`growRoundNode`), registered here under an owner
//   id of its own with its Armor and body.
// - an object that draws nothing (`drawn: false`: the root created
//   invisible and no geometry under it, PHY-24): its logic node, an empty
//   group with the template's Armor, which the same pool stands and the same
//   abandon clock kills. While it stands, its SupplyDepots work where it is
//   (FH's towed guns' `*_dummyRepairObjRepairObj`, whose depot finishes the
//   towed dummy) and its own spawners run as a round's do (the mine icons'
//   held `*IconPCO`).
// - a Kit: laid as `kit-drops-page.js` lays a pad's kit, never enabled, so
//   it lies until taken (SPAWN-15) and has no abandon clock (a Kit has no
//   PlayerControlObject interface for `spawnObject` to arm).
//
// Room play: nothing here is replicated, so a joined room stands nothing.

import * as THREE from 'three';
import { AbandonClock, SpawnerPad, needsClearance, spawnClear } from './deployables.js';
import { CHARACTER_HEIGHT } from './soldier-pose.js';
import { SupplyDepot } from './supply.js';

const _spawner = new THREE.Matrix4();
const _stand = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const _at = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/** The spawner in its round's frame: `translation` and `rotation` (xyzw), in
 *  the glb's axes as the exporter writes them. */
export function spawnerLocal(spec, out = new THREE.Matrix4()) {
  const t = spec?.translation ?? [0, 0, 0];
  const r = spec?.rotation ?? [0, 0, 0, 1];
  return out.compose(_pos.set(t[0], t[1], t[2]), _quat.set(r[0], r[1], r[2], r[3]), _one);
}

/** Where `spawnObject` puts the object: the spawner's world position plus
 *  `spawnOffset` (world axes, glb frame), with the spawner's rotation. */
export function standMatrix(spawnerWorld, spec, out = new THREE.Matrix4()) {
  spawnerWorld.decompose(_pos, _quat, _at);
  const o = spec?.spawnOffset ?? [0, 0, 0];
  _pos.x += o[0]; _pos.y += o[1]; _pos.z += o[2];
  return out.compose(_pos, _quat, _one);
}

/** The pad law for one spawner of one round, ready for its first frame. */
export function roundSpawnerPad(spec, { players = 0, maxPlayers = 0 } = {}) {
  const pad = new SpawnerPad({
    templates: spec.templates ?? {}, team: spec.team ?? 0,
    minSpawnDelay: spec.minSpawnDelay, maxSpawnDelay: spec.maxSpawnDelay,
    spawnDelayAtStart: spec.spawnDelayAtStart ? 1 : 0,
    maxNr: spec.maxNrOfObjectSpawned ?? 1, nrToSpawn: spec.nrOfObjectToSpawn ?? -1,
    radius: spec.radius,
  });
  pad.reset({ players, maxPlayers });
  return pad;
}

/** `spec.objects[template]`, whatever the case either is spelled in. */
export function objectEntry(spec, template) {
  const objects = spec?.objects;
  if (!objects || !template) return null;
  if (objects[template]) return objects[template];
  const want = String(template).toLowerCase();
  for (const [name, entry] of Object.entries(objects)) if (name.toLowerCase() === want) return entry;
  return null;
}

const isKitId = id => typeof id === 'string';

/**
 * Built once by the page. `page` hands in, as getters: `collider`,
 * `hullBodies` (`adoptSpawnedBody holdSpawned releaseSpawned
 * standSpawnedObject syncVehicleSpawnOwnership`), `kitDrops` (`placeKit
 * objectAlive objectPosition`), `loadouts`, `LOCAL_PLAYER`, `maxPlayers`,
 * `optOnFoot`, `optPilot`, `roomJoined`, `soldier`, `soldierDead`,
 * `vehicleDamage`, `vehiclePads` (`roundRecords takeRoundNode growRoundNode
 * setRoundLive retagCull`), `vehicles` (`instanceOf seatOf stampTeam
 * clearStamp`), `world`, `wrecks` (`padWorld registerDamageable`).
 */
export function createRoundSpawners(page) {
  const spawners = {};
  // { shot, entries: [{ spec, pad, local }], ended }
  const rounds = [];
  // record -> { clock, entry, round, depots, own } for every object a round stood up.
  const standing = new Map();
  const warned = new Set();
  let nextKit = 1;
  let grownCount = 0;

  function counts() {
    return { players: page.world?.players?.size ?? 0, maxPlayers: page.maxPlayers ?? 0 };
  }

  function startRound(specs, shot) {
    const round = {
      shot, ended: false,
      entries: specs.map(spec => ({ spec, pad: roundSpawnerPad(spec, counts()), local: spawnerLocal(spec) })),
    };
    rounds.push(round);
    return { end() { round.ended = true; } };
  }

  /** `guns.onRoundSpawners`: a round that carries spawners has left a gun. */
  spawners.onRound = (group, specs, shot) => {
    if (page.roomJoined || group?.replay || !Array.isArray(specs) || !specs.length) return null;
    return startRound(specs, shot);
  };

  function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    console.warn(message);
  }

  /** The human's origin while he lives on foot: the only soldier
   *  `createObjectOnAllClients` measures (it skips every `getIsAIPlayer`). */
  function humanOrigins() {
    const s = page.soldier;
    if (!s || page.soldierDead || !page.optOnFoot?.checked || page.optPilot?.checked) return [];
    return [[s.x, s.y + CHARACTER_HEIGHT, s.z]];
  }

  /** Every live soldier on foot, bots too: the abandon clock's "near" test. */
  function footOrigins() {
    const out = [];
    const world = page.world;
    for (const [id, player] of world?.players ?? []) {
      const s = player?.soldier;
      if (!s || world.armorOf?.(id)?.destroyed || page.vehicles?.seatOf?.(id)) continue;
      if (id === page.LOCAL_PLAYER && (page.soldierDead || !page.optOnFoot?.checked
                                       || page.optPilot?.checked)) continue;
      out.push([s.x, s.y + CHARACTER_HEIGHT, s.z]);
    }
    return out;
  }

  function spawnerWorld(round, entry, out) {
    const mesh = round.shot.mesh;
    mesh.updateWorldMatrix(true, false);
    return out.multiplyMatrices(mesh.matrixWorld, entry.local);
  }

  function positionOf(node) {
    node.updateWorldMatrix(true, false);
    const e = node.matrixWorld.elements;
    return [e[12], e[13], e[14]];
  }

  /** The loadouts' own spelling of `name`, or null for a kit it lists not. */
  function loadoutKit(name) {
    const kits = page.loadouts?.kits;
    if (!kits || !name) return null;
    if (kits[name]) return name;
    const want = String(name).toLowerCase();
    for (const key of Object.keys(kits)) if (key.toLowerCase() === want) return key;
    return null;
  }

  /** A Kit entry: laid where the spawner puts it, facing its way, up. */
  function layKit(template, matrix) {
    const kit = loadoutKit(template);
    if (!kit || !page.kitDrops?.placeKit) {
      warnOnce(`kit:${template}`, `[round spawns] ${template}: no kit row for it, a round laid nothing`);
      return null;
    }
    matrix.decompose(_pos, _quat, _at);
    // The kit record's heading is where its -Z points (`kit-drops-page.js`).
    _fwd.set(0, 0, -1).applyQuaternion(_quat);
    const place = { x: _pos.x, y: _pos.y, z: _pos.z, yaw: Math.atan2(_fwd.x, _fwd.z), normal: [0, 1, 0] };
    const objectId = `round:${nextKit++}`;
    return page.kitDrops.placeKit(kit, place, { objectId }) ? objectId : null;
  }

  /** A node the pool grew into the level's books: an owner id (one with no
   *  triangle for a logic node), its Armor, its body. */
  function adoptGrown(record) {
    const node = record.baked;
    const owner = page.collider?.addOwner?.(node, { empty: true }) ?? -1;
    if (owner < 0) return false;
    page.wrecks?.registerDamageable?.(owner, node);
    page.hullBodies?.adoptSpawnedBody?.(owner);
    grownCount++;
    return true;
  }

  /** A parked node for `template`, the pool grown by one when none is free. */
  function nodeFor(template) {
    const pads = page.vehiclePads;
    const padWorld = page.wrecks?.padWorld;
    // A parked node is in the wreck side's books from the load (alive, not
    // destroyed) and free; one whose wreck still lingers is not.
    const busy = node => padWorld.alive(node) && padWorld.destroyed(node);
    let record = pads.takeRoundNode(template, busy);
    if (record) return record;
    record = pads.growRoundNode?.(template) ?? null;
    if (record && adoptGrown(record)) return record;
    // A template the level parked no node for is not this page's to stand:
    // a hand weapon's round (Desert Combat's mortar) is `deployables-page.js`'s.
    const parked = (pads.roundRecords ?? []).some(r => r.template.toLowerCase() === template.toLowerCase());
    if (parked) warnOnce(`node:${template}`, `[round spawns] no free ${template}: a round stood nothing`);
    return null;
  }

  /** A logic node's SupplyDepots, each where it rides on the object, for as
   *  long as the object stands (`world-fields.js` drops a gone one). */
  function startDepots(node, depots, gone) {
    const field = page.world?.supplyField;
    if (!field || !Array.isArray(depots) || !depots.length) return;
    for (const data of depots) {
      const t = data.translation ?? [0, 0, 0];
      const locate = () => {
        node.updateWorldMatrix(true, false);
        _at.set(t[0], t[1], t[2]).applyMatrix4(node.matrixWorld);
        return { x: _at.x, y: _at.y, z: _at.z };
      };
      field.add(new SupplyDepot(locate(), data, data.template ?? null, { root: node, locate, gone }));
    }
  }

  /** `spawnObject` for one entry: the node or kit id, or null when nothing stood. */
  function stand(round, entry, template) {
    const pads = page.vehiclePads;
    const padWorld = page.wrecks?.padWorld;
    const spec = entry.spec;
    const object = objectEntry(spec, template);
    const matrix = standMatrix(spawnerWorld(round, entry, _spawner), spec, _stand);
    if (needsClearance(object?.vehicleCategory ?? null)) {
      const e = matrix.elements;
      if (!spawnClear([e[12], e[13], e[14]], humanOrigins())) return null;
    }
    if (object?.kind?.toLowerCase?.() === 'kit') return layKit(template, matrix);
    if (!pads?.takeRoundNode || !padWorld) return null;
    const record = nodeFor(template);
    if (!record) return null;
    const node = record.baked;
    pads.setRoundLive(record, true);
    // A fresh object: full hit points, the wreck and the moved frame gone.
    if (!padWorld.spawn(node)) {
      pads.setRoundLive(record, false);
      return null;
    }
    page.hullBodies?.syncVehicleSpawnOwnership?.();
    page.hullBodies?.standSpawnedObject?.(node, matrix);
    pads.retagCull?.(node);
    // `teamOnVehicle`: the spawner's team on the fresh object, for good.
    if (spec.teamOnVehicle) page.vehicles?.stampTeam?.(node, spec.team ?? 0);
    else page.vehicles?.clearStamp?.(node);
    const life = {
      entry, round, own: null,
      clock: new AbandonClock({
        timeToLive: spec.timeToLive, distance: spec.distance, damageWhenLost: spec.damageWhenLost,
      }),
    };
    standing.set(record, life);
    if (spec.holdObject) page.hullBodies?.holdSpawned?.(node, round.shot.mesh, entry.local, spec.spawnOffset);
    const logic = node.userData?.logicObject;
    if (logic) {
      startDepots(node, logic.depots, () => standing.get(record) !== life);
      if (Array.isArray(logic.spawners) && logic.spawners.length) {
        life.own = startRound(logic.spawners, { mesh: node });
      }
    }
    return node;
  }

  function tickRound(round, dt) {
    const padWorld = page.wrecks?.padWorld;
    const kits = page.kitDrops;
    for (const entry of round.entries) {
      const e = spawnerWorld(round, entry, _spawner).elements;
      const at = [e[12], e[13], e[14]];
      entry.pad.players = page.world?.players?.size ?? 0;
      entry.pad.maxPlayers = page.maxPlayers ?? 0;
      entry.pad.tick(dt, {
        alive: id => (isKitId(id) ? !!kits?.objectAlive?.(id)
                                  : !!padWorld?.alive(id) && !!recordOf(id)),
        critical: id => (isKitId(id) ? false : !!padWorld?.destroyed(id)),
        distance: id => {
          const p = isKitId(id) ? kits?.objectPosition?.(id) : positionOf(id);
          return p ? Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]) : Infinity;
        },
        destroy: id => { if (!isKitId(id)) padWorld?.destroy(id); },
        spawn: template => stand(round, entry, template),
      });
    }
  }

  function recordOf(node) {
    for (const record of standing.keys()) if (record.baked === node) return record;
    return null;
  }

  function gone(record, life) {
    page.hullBodies?.releaseSpawned?.(record.baked);
    page.vehiclePads?.setRoundLive?.(record, false);
    life.own?.end();
    standing.delete(record);
  }

  /** The objects rounds stood: gone ones free their node, and the abandon
   *  clock runs on the rest (`PlayerControlObject::handleFrameUpdate`). */
  function tickStanding(dt) {
    const padWorld = page.wrecks?.padWorld;
    let feet = null;
    for (const [record, life] of standing) {
      const node = record.baked;
      if (!padWorld?.alive(node)) {
        gone(record, life);
        continue;
      }
      const owner = page.collider?.statics?.ownerOf?.(node) ?? -1;
      const vehicle = owner >= 0 ? page.vehicleDamage?.get(owner) : null;
      if (!vehicle || vehicle.destroyed || padWorld.destroyed(node)) continue;
      const spawnerAlive = !life.round.ended && rounds.includes(life.round);
      let spawnerDistance = Infinity;
      if (spawnerAlive) {
        const e = spawnerWorld(life.round, life.entry, _spawner).elements;
        const p = positionOf(node);
        spawnerDistance = Math.hypot(p[0] - e[12], p[1] - e[13], p[2] - e[14]);
      }
      const inst = page.vehicles?.instanceOf?.(node);
      const occupied = !!(inst && !inst.empty);
      let soldierNear = false;
      if (!occupied && (!spawnerAlive || spawnerDistance > life.clock.distance)) {
        feet ??= footOrigins();
        const r = node.userData?.cullRadius ?? 0;
        const p = positionOf(node);
        soldierNear = feet.some(o =>
          (o[0] - p[0]) ** 2 + (o[1] - p[1]) ** 2 + (o[2] - p[2]) ** 2 < r * r);
      }
      const loss = life.clock.step(dt, { spawnerAlive, spawnerDistance, soldierNear, occupied });
      if (loss > 0) vehicle.damage(loss, null);
    }
  }

  /** `dt` seconds of world time. */
  spawners.tick = dt => {
    if (!(dt > 0) || page.roomJoined) return;
    for (let i = rounds.length - 1; i >= 0; i--) {
      const round = rounds[i];
      if (round.ended) {
        // The spawner goes with its round: a held object is let go.
        for (const [record, life] of standing) {
          if (life.round === round) page.hullBodies?.releaseSpawned?.(record.baked);
        }
        rounds.splice(i, 1);
        continue;
      }
      tickRound(round, dt);
    }
    tickStanding(dt);
  };

  /** A level change or a restart: the rounds and what they stood are gone. */
  spawners.reset = () => {
    for (const record of standing.keys()) page.vehiclePads?.setRoundLive?.(record, false);
    standing.clear();
    rounds.length = 0;
    warned.clear();
    grownCount = 0;
  };

  /** Headless hooks. */
  spawners.state = () => ({
    rounds: rounds.map(r => ({
      ended: r.ended,
      entries: r.entries.map(e => ({ spawner: e.spec.template, delay: +e.pad.delay.toFixed(3),
                                     nrToSpawn: e.pad.nrToSpawn,
                                     slots: [...e.pad.slots].map(n => (isKitId(n) ? n : n?.name ?? null)) })),
    })),
    standing: [...standing.entries()].map(([record, life]) => {
      const p = positionOf(record.baked);
      return { template: record.template, at: p.map(v => +v.toFixed(3)),
               countdown: +life.clock.countdown.toFixed(3),
               logic: !!record.baked.userData?.logicObject,
               team: page.vehicles?.teamOf?.(record.baked) ?? null };
    }),
    grown: grownCount,
  });

  return spawners;
}
