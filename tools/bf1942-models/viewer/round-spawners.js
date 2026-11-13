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
import { burstsAtEndOfLife, splashDamage, splashSpec } from './projectile-damage.js';
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

/** A Refractor yaw / pitch / roll (degrees) as a glb quaternion:
 *  `bf42/gltf.py` `quat_from_ypr`, Ry(-yaw) Rx(-pitch) Rz(roll). */
function yprQuaternion(ypr, out) {
  const y = THREE.MathUtils.degToRad(-ypr[0]) / 2;
  const p = THREE.MathUtils.degToRad(-ypr[1]) / 2;
  const r = THREE.MathUtils.degToRad(ypr[2]) / 2;
  _qy.set(0, Math.sin(y), 0, Math.cos(y));
  _qx.set(Math.sin(p), 0, 0, Math.cos(p));
  _qz.set(0, 0, Math.sin(r), Math.cos(r));
  return out.copy(_qy).multiply(_qx).multiply(_qz);
}
const _qy = new THREE.Quaternion();
const _qx = new THREE.Quaternion();
const _qz = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qacc = new THREE.Quaternion();
const _vacc = new THREE.Vector3();
const _vstep = new THREE.Vector3();
const _angles = [0, 0, 0];

/**
 * Where a logic object's depot is `t` seconds after the object was made, in
 * its frame (glb axes), into `out`: its `sweep` links composed with every
 * self-turning bundle at its angle then, or its fixed `translation`. An
 * unmanned `RotationalBundle`'s angle is `continousRotationSpeed x t`, clipped
 * into `[min, max]`, or wrapped at 180 when both are 0 (GUN-2; an axis whose
 * `maxSpeed` is 0 is not stepped, GUN-20, and the exporter leaves its rate
 * out). `bf42/assemble.py` `depot_offset_at` is the same arithmetic. BF1918's
 * gas grenade: 50 m up a rotator 50 m ahead at 0, on the object's origin from
 * 0.9 s (SUP-23).
 */
export function depotOffsetAt(data, t, out = [0, 0, 0]) {
  const links = data?.sweep;
  if (!Array.isArray(links) || !links.length) {
    const tr = data?.translation ?? [0, 0, 0];
    out[0] = tr[0]; out[1] = tr[1]; out[2] = tr[2];
    return out;
  }
  _vacc.set(0, 0, 0);
  _qacc.identity();
  for (const link of links) {
    const tr = link.translation ?? [0, 0, 0];
    _vacc.add(_vstep.set(tr[0], tr[1], tr[2]).applyQuaternion(_qacc));
    if (link.rotation) _qacc.multiply(_qa.set(link.rotation[0], link.rotation[1], link.rotation[2], link.rotation[3]));
    const spin = link.spin;
    if (spin) {
      if (spin.pivot) _vacc.add(_vstep.set(spin.pivot[0], spin.pivot[1], spin.pivot[2]).applyQuaternion(_qacc));
      for (let i = 0; i < 3; i++) {
        const lo = spin.min?.[i] ?? 0;
        const hi = spin.max?.[i] ?? 0;
        let a = (spin.rate?.[i] ?? 0) * t;
        if (lo === 0 && hi === 0) a = ((a + 180) % 360 + 360) % 360 - 180;
        else a = Math.min(Math.max(a, lo), hi);
        _angles[i] = a;
      }
      _qacc.multiply(yprQuaternion(_angles, _qa));
    }
  }
  out[0] = _vacc.x; out[1] = _vacc.y; out[2] = _vacc.z;
  return out;
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

/** Under this muzzle speed (m/s) a FireArms drops its round rather than
 *  shoots it. FH's deploy rounds leave at 1 (`*_TransformSpawnerGunBarrel`,
 *  the towing tractors' `*_SpawnerGunBarrel`) and its killer charges at 0 or
 *  1; the slowest shooting gun (a mortar) is past 50. */
export const DROP_SPEED = 10;

/**
 * What one FireArms does to the hull it rides, read from its data (FHX-24,
 * FHX-30): `deploys` when it drops a round whose ObjectSpawner stands, and
 * lets go, a drawn PlayerControlObject (a mobile gun's static, a tractor's
 * towed gun), and
 * `killerHp`, the hit points its end-of-life burst takes off this hull when
 * it bursts where it was dropped (its speed times its life inside its
 * radius), by the material table (`splashDamage`, DMG-1: a pair with no
 * cell is 0). A killer charge that destroys the gun it was thrown from is
 * `material2 613` against the gun's `material 32` (999x); the towing
 * tractors' re-hook killer is the same 613 against the tractor's 30 or 34,
 * which has no cell, so the tractor lives and only the towed gun within 8 m
 * dies. `stands` names the objects a deploy round stands.
 * `stats` is the group's `{ velocity, projectile }`; `hull` is
 * `{ splashMaterial, materials, modifiers }`.
 */
export function deployRole(stats, hull = {}) {
  const spec = stats?.projectile;
  if (!spec || typeof spec !== 'object') return { deploys: false, stands: [], killerHp: 0 };
  // A round no physics node moves (`setHasMobilePhysics 0`) stays where it
  // was dropped, whatever its `velocity`.
  const speed = spec.hasMobilePhysics === false ? 0 : Math.abs(Number(stats.velocity) || 0);
  const dropped = speed < DROP_SPEED;
  // Let go where it stands (`holdObject 0`): a held object rides its round,
  // as an AP shell's or a bomb's PenetrateExplosion does.
  const stands = [];
  if (dropped) {
    for (const sp of spec.spawners ?? []) {
      if (sp?.holdObject) continue;
      for (const [name, o] of Object.entries(sp?.objects ?? {})) {
        if (o?.kind === 'PlayerControlObject' && o.drawn !== false) stands.push(name);
      }
    }
  }
  const deploys = stands.length > 0;
  let killerHp = 0;
  const splash = burstsAtEndOfLife(spec) ? splashSpec(spec.damage) : null;
  if (splash && dropped && Number.isFinite(hull.splashMaterial)) {
    const reach = speed * (Number(spec.timeToLive) || 0);
    if (reach < splash.radius) {
      killerHp = splashDamage(splash.material2, hull.splashMaterial, reach, splash.radius,
                              hull.materials, hull.modifiers);
    }
  }
  return { deploys, stands, killerHp };
}

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
  // Every round a gun has launched with spawners, and every object they
  // stood, since the level loaded: a check that samples `rounds` now and
  // then misses a round that strikes a wall in a frame or two (FHX-30).
  let launched = 0;
  let stoodCount = 0;

  function counts() {
    return { players: page.world?.players?.size ?? 0, maxPlayers: page.maxPlayers ?? 0 };
  }

  // Seconds of world time this page has ticked: the age a depot's sweep is
  // read at (`startDepots`).
  let clock = 0;

  function startRound(specs, shot, { life = Infinity } = {}) {
    const round = {
      shot, ended: false, life,
      entries: specs.map(spec => ({ spec, pad: roundSpawnerPad(spec, counts()), local: spawnerLocal(spec) })),
    };
    rounds.push(round);
    return { end() { round.ended = true; } };
  }

  /** `guns.onRoundSpawners`: a round that carries spawners has left a gun. */
  spawners.onRound = (group, specs, shot) => {
    if (page.roomJoined || group?.replay || !Array.isArray(specs) || !specs.length) return null;
    launched++;
    return startRound(specs, shot);
  };

  /**
   * An effect bundle that carries ObjectSpawners has played (`round-impact.js`,
   * a live round's hit): its spawners run where it stands, in its frame
   * (`frame` = `{ position, quaternion }`, the bundle's root as
   * `playCollisionEffect` stands it on the surface, IMP-1), for `life`
   * seconds, the bundle's own `timeToLive` (EMT-14), as a round's run for the
   * round's life. BF1918's flamethrower: `e_BurningFlameEffect` (6 s) stands
   * `FireDamage` a second in, whose depot burns what is within 5 m of it.
   */
  spawners.onEffect = (specs, frame, life = Infinity) => {
    if (page.roomJoined || !Array.isArray(specs) || !specs.length || !frame?.position) return null;
    const mesh = new THREE.Object3D();
    const p = frame.position;
    mesh.position.set(p[0], p[1], p[2]);
    if (frame.quaternion) mesh.quaternion.copy(frame.quaternion);
    mesh.updateMatrixWorld(true);
    launched++;
    return startRound(specs, { mesh }, { life });
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

  /** A parked node for `template`, the pool grown by one when none is free.
   *  `entry` is the spawner's `objects` row: one that draws nothing grows
   *  from a mould made on the spot when no level parked one (a hand
   *  weapon's round, an effect's spawner; `level-statics.js` `logicMould`). */
  function nodeFor(template, entry = null) {
    const pads = page.vehiclePads;
    const padWorld = page.wrecks?.padWorld;
    // A parked node is in the wreck side's books from the load (alive, not
    // destroyed) and free; one whose wreck still lingers is not.
    const busy = node => padWorld.alive(node) && padWorld.destroyed(node);
    let record = pads.takeRoundNode(template, busy);
    if (record) return record;
    record = pads.growRoundNode?.(template, entry) ?? null;
    if (record && adoptGrown(record)) return record;
    // A template the level parked no node for is not this page's to stand:
    // a hand weapon's round (Desert Combat's mortar) is `deployables-page.js`'s.
    const parked = (pads.roundRecords ?? []).some(r => r.template.toLowerCase() === template.toLowerCase());
    if (parked) warnOnce(`node:${template}`, `[round spawns] no free ${template}: a round stood nothing`);
    return null;
  }

  /** A logic node's SupplyDepots, each where it rides on the object, for as
   *  long as the object stands (`world-fields.js` drops a gone one). A depot
   *  under a bundle that turns by itself (`sweep`) is where the turning tree
   *  has it at the object's age (`depotOffsetAt`), read at every cycle. */
  function startDepots(node, depots, gone) {
    const field = page.world?.supplyField;
    if (!field || !Array.isArray(depots) || !depots.length) return;
    const born = clock;
    for (const data of depots) {
      const t = data.translation ?? [0, 0, 0];
      const off = [t[0], t[1], t[2]];
      const locate = () => {
        if (data.sweep) depotOffsetAt(data, clock - born, off);
        node.updateWorldMatrix(true, false);
        _at.set(off[0], off[1], off[2]).applyMatrix4(node.matrixWorld);
        return { x: _at.x, y: _at.y, z: _at.z };
      };
      field.add(new SupplyDepot(locate(), data, data.template ?? null, { root: node, locate, gone }));
    }
  }

  /** `spawnObject` for one entry: the node or kit id, or null when nothing stood. */
  // Why each recent stand came to nothing (the audit's evidence when a
  // deploy stands nothing): the last few refusals, newest last.
  const refusals = [];
  function refuse(template, why) {
    refusals.push(`${template}: ${why}`);
    if (refusals.length > 12) refusals.shift();
    return null;
  }

  function stand(round, entry, template) {
    const pads = page.vehiclePads;
    const padWorld = page.wrecks?.padWorld;
    const spec = entry.spec;
    const object = objectEntry(spec, template);
    const matrix = standMatrix(spawnerWorld(round, entry, _spawner), spec, _stand);
    if (needsClearance(object?.vehicleCategory ?? null)) {
      const e = matrix.elements;
      if (!spawnClear([e[12], e[13], e[14]], humanOrigins())) return refuse(template, 'a human within 2 m');
    }
    if (object?.kind?.toLowerCase?.() === 'kit') return layKit(template, matrix);
    if (!pads?.takeRoundNode || !padWorld) return refuse(template, 'no pool');
    const record = nodeFor(template, object);
    if (!record) return refuse(template, 'no free node');
    const node = record.baked;
    pads.setRoundLive(record, true);
    // A fresh object: full hit points, the wreck and the moved frame gone.
    if (!padWorld.spawn(node)) {
      pads.setRoundLive(record, false);
      return refuse(template, 'the wreck side would not stand it');
    }
    page.hullBodies?.syncVehicleSpawnOwnership?.();
    page.hullBodies?.standSpawnedObject?.(node, matrix);
    pads.retagCull?.(node);
    // `teamOnVehicle`: the spawner's team on the fresh object, for good.
    if (spec.teamOnVehicle) page.vehicles?.stampTeam?.(node, spec.team ?? 0);
    else page.vehicles?.clearStamp?.(node);
    const life = {
      entry, round, own: null,
      // Which standing this is: a node freed and stood again is a new one
      // (the audit tells a deploy's static from one left by an earlier test).
      serial: stoodCount + 1,
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
    round.ticked = true;
    round.age = (round.age ?? 0) + dt;
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
        spawn: template => {
          const stood = stand(round, entry, template);
          if (stood) stoodCount++;
          return stood;
        },
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

  // record -> node for every vehicle a gun fired as its round (`standVehicle`).
  const fired = new Map();

  /**
   * A round that is itself a vehicle (FA-29): `FireArms::fireBarrel`
   * 0x0828aba0, for a projectile template that is a PlayerControlObject,
   * has the game spawn it (`Game` vt+0x50, on the server `GameServer::
   * spawnObject` 0x08132440 -> `createObjectOnAllClients` 0x08133a10) at the
   * barrel and sets its matrix to the barrel's. No ObjectSpawner made it, so
   * it has no abandon clock and nothing holds it; the pool's node goes back
   * when its wreck is gone. `createObjectOnAllClients` makes the same 2 m
   * test it makes for a pad (SPAWN-14), which is where the tooltip type
   * matters: the Wasserfall's rocket is an air hull of type 0x24, the one
   * the test lets through, so a soldier standing by the launcher cannot
   * hold the missile on its rail. `category` and `toolTipType` are the
   * round's own (`extras.physics.vehicleCategory`; the type from the node's
   * `extras.hud.toolTipType` or the pack's tooltip table, `spawn-safety.js`
   * `toolTipTypeOf`), read off the parked node when not given.
   *
   * Returns the node stood at `matrix`, or null when there is none to
   * stand (no model in the tree, the pool spent, a human in the way).
   */
  spawners.standVehicle = (template, matrix, { category = null, toolTipType = null, node: wanted = null } = {}) => {
    const pads = page.vehiclePads;
    const padWorld = page.wrecks?.padWorld;
    // In a room the round is the room's: its own pooled copy (`wanted`,
    // `net-room.js` `roundVehicleFor`), stood here as the firer's prediction.
    if ((page.roomJoined && !wanted) || !template || !pads?.takeRoundNode || !padWorld) return null;
    const record = wanted
      ? (pads.roundRecords ?? []).find(r => r.baked === wanted && !r.mould) ?? null
      : nodeFor(template, null);
    if (!record) return refuse(template, 'no free node for a fired vehicle');
    const node = record.baked;
    const cat = category ?? node.userData?.physics?.vehicleCategory ?? null;
    const tip = toolTipType ?? padWorld.toolTipTypeOf?.(node) ?? node.userData?.hud?.toolTipType ?? null;
    if (needsClearance(cat, tip)) {
      const e = matrix.elements;
      if (!spawnClear([e[12], e[13], e[14]], humanOrigins())) return refuse(template, 'a human within 2 m');
    }
    pads.setRoundLive(record, true);
    if (!padWorld.spawn(node)) {
      pads.setRoundLive(record, false);
      return refuse(template, 'the wreck side would not stand it');
    }
    page.hullBodies?.syncVehicleSpawnOwnership?.();
    page.hullBodies?.standSpawnedObject?.(node, matrix);
    pads.retagCull?.(node);
    page.vehicles?.clearStamp?.(node);
    fired.set(record, node);
    stoodCount++;
    return node;
  };

  /** A fired vehicle whose wreck is gone gives its node back to the pool. */
  function tickFired() {
    const padWorld = page.wrecks?.padWorld;
    for (const [record, node] of fired) {
      if (padWorld?.alive(node)) continue;
      page.vehiclePads?.setRoundLive?.(record, false);
      fired.delete(record);
    }
  }

  /** `dt` seconds of world time. */
  spawners.tick = dt => {
    if (!(dt > 0) || page.roomJoined) return;
    clock += dt;
    for (let i = rounds.length - 1; i >= 0; i--) {
      const round = rounds[i];
      // An effect's spawners go with its bundle (`onEffect`).
      if (!round.ended && round.ticked && round.age >= round.life) round.ended = true;
      // A round born and gone inside one world tick still had its spawner for
      // that tick: the engine builds the spawner with the round and registers
      // it for frame updates in its ctor (0x08312910). FH's towing tractors'
      // killer rounds live 0.05 to 0.1 s (`timeToLive CRD_UNIFORM/0.05/0.1`),
      // and their spawner stands its `*_dummyRepairObjRepairObj` on its first
      // frame (no `spawnDelayAtStart`).
      // So does a round that went in this tick (`guns.advance` runs before
      // this): BF1918's gas grenade lives 4.05 s and its spawners stand at
      // 4 s, which the pad law (a delay that reaches 0 spawns on the next
      // frame, SPAWN-11) meets 4.067 s in, the frame the round dies. That
      // the dying round's spawner still gets that frame is inferred from
      // the mod's own timing, not read (`features/bf1918-extraction`).
      if (round.ended && !round.finalTick) {
        round.finalTick = true;
        tickRound(round, dt);
      }
      if (round.ended) {
        for (const entry of round.entries) {
          if (entry.pad.nrToSpawn !== 0 && entry.pad.delay > 0 && !entry.pad.lastSpawned) {
            refuse(entry.spec.template, `its round went at ${(round.age ?? 0).toFixed(2)} s with ${entry.pad.delay.toFixed(2)} s to wait`);
          }
        }
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
    if (fired.size) tickFired();
  };

  /** A level change or a restart: the rounds and what they stood are gone. */
  spawners.reset = () => {
    for (const record of standing.keys()) page.vehiclePads?.setRoundLive?.(record, false);
    standing.clear();
    for (const record of fired.keys()) page.vehiclePads?.setRoundLive?.(record, false);
    fired.clear();
    rounds.length = 0;
    warned.clear();
    grownCount = 0;
    launched = 0;
    stoodCount = 0;
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
      return { template: record.template, id: record.baked.uuid, serial: life.serial, at: p.map(v => +v.toFixed(3)),
               countdown: +life.clock.countdown.toFixed(3),
               logic: !!record.baked.userData?.logicObject,
               team: page.vehicles?.teamOf?.(record.baked) ?? null };
    }),
    grown: grownCount,
    fired: [...fired.keys()].map(record => record.template),
    launched, stood: stoodCount, refusals: [...refusals],
  });

  return spawners;
}
