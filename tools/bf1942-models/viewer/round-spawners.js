// What a round's ObjectSpawner puts in the world, on the map page: FH's
// mobile guns' deploy (`Flak18/36mobile_TransformSpawnerProjectile` stands
// `Flak18/36mobilestatic` four seconds after it lands, and the static's own
// deploy round stands the mobile gun again), the artillery's and ships'
// `PenetrateExplosion*Spawner`, the torpedoes' dummy PCOs, FHSW's
// `AdvancedPost_*` posts. The exporter writes the round's spawner children as
// `projectile.spawners` (`bf42/assemble.py` `round_spawner_record`).
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
// 0x08133a10, SPAWN-14). The new object's abandon clock is the spawner's
// `TimeToLive` / `Distance` / `damageWhenLost` (SPAWN-13), and with the
// spawner gone the clock bills its step unscaled. When the round dies the
// spawner goes with it (`destroy` 0x08313690): what it placed stays, and a
// held one is let go (`setObjectSpawnerHolding(0)`).
//
// The objects are full vehicles parked out of the world at load
// (`level-statics.js` `loadRoundSpawnPool`), stood up through the wreck
// side's own respawn (`vehicle-wrecks.js` `padWorld.spawn`) and put where the
// spawner says (`hull-bodies.js` `standSpawnedObject`), so a seat, a gun, a
// blast and a wreck work on them as on any placed hull. A round whose object
// has no free node (more out at once than the level's guns can throw) stands
// nothing; the console says so once per template.
//
// Room play: nothing here is replicated, so a joined room stands nothing.

import * as THREE from 'three';
import { AbandonClock, SpawnerPad, needsClearance, spawnClear } from './deployables.js';
import { CHARACTER_HEIGHT } from './soldier-pose.js';

const _local = new THREE.Matrix4();
const _spawner = new THREE.Matrix4();
const _stand = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const _at = new THREE.Vector3();

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

/**
 * Built once by the page. `page` hands in, as getters: `collider`,
 * `hullBodies` (`holdSpawned releaseSpawned standSpawnedObject
 * syncVehicleSpawnOwnership`), `LOCAL_PLAYER`, `maxPlayers`, `optOnFoot`,
 * `optPilot`, `roomJoined`, `soldier`, `soldierDead`, `vehicleDamage`,
 * `vehiclePads` (`roundRecords takeRoundNode setRoundLive retagCull`),
 * `vehicles`, `world`, `wrecks` (`padWorld`).
 */
export function createRoundSpawners(page) {
  const spawners = {};
  // { shot, entries: [{ spec, pad, local }], ended }
  const rounds = [];
  // record -> { clock, entry } for every object a round stood up.
  const standing = new Map();
  const warned = new Set();

  function counts() {
    return { players: page.world?.players?.size ?? 0, maxPlayers: page.maxPlayers ?? 0 };
  }

  /** `guns.onRoundSpawners`: a round that carries spawners has left a gun. */
  spawners.onRound = (group, specs, shot) => {
    if (page.roomJoined || group?.replay || !Array.isArray(specs) || !specs.length) return null;
    const round = {
      shot, ended: false,
      entries: specs.map(spec => ({ spec, pad: roundSpawnerPad(spec, counts()), local: spawnerLocal(spec) })),
    };
    rounds.push(round);
    return { end() { round.ended = true; } };
  };

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

  /** `spawnObject` for one entry: the node, or null when nothing stood. */
  function stand(round, entry, template) {
    const pads = page.vehiclePads;
    const padWorld = page.wrecks?.padWorld;
    if (!pads?.takeRoundNode || !padWorld) return null;
    const matrix = standMatrix(spawnerWorld(round, entry, _spawner), entry.spec, _stand);
    const category = entry.spec.objects?.[template]?.vehicleCategory ?? null;
    if (needsClearance(category)) {
      const e = matrix.elements;
      if (!spawnClear([e[12], e[13], e[14]], humanOrigins())) return null;
    }
    // A parked node is in the wreck side's books from the load (alive, not
    // destroyed) and free; one whose wreck still lingers is not.
    const record = pads.takeRoundNode(template, node => padWorld.alive(node) && padWorld.destroyed(node));
    if (!record) {
      // A template the level parked no node for is not this page's to stand:
      // a hand weapon's round (Desert Combat's mortar) is `deployables-page.js`'s.
      const parked = (pads.roundRecords ?? []).some(r => r.template.toLowerCase() === template.toLowerCase());
      if (parked && !warned.has(template)) {
        warned.add(template);
        console.warn(`[round spawns] no free ${template}: a round stood nothing`);
      }
      return null;
    }
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
    const spec = entry.spec;
    standing.set(record, {
      entry, round,
      clock: new AbandonClock({
        timeToLive: spec.timeToLive, distance: spec.distance, damageWhenLost: spec.damageWhenLost,
      }),
    });
    if (spec.holdObject) page.hullBodies?.holdSpawned?.(node, round.shot.mesh, entry.local);
    return node;
  }

  function tickRound(round, dt) {
    const padWorld = page.wrecks?.padWorld;
    for (const entry of round.entries) {
      const e = spawnerWorld(round, entry, _spawner).elements;
      const at = [e[12], e[13], e[14]];
      entry.pad.players = page.world?.players?.size ?? 0;
      entry.pad.maxPlayers = page.maxPlayers ?? 0;
      entry.pad.tick(dt, {
        alive: node => !!padWorld?.alive(node) && standing.has(recordOf(node)),
        critical: node => !!padWorld?.destroyed(node),
        distance: node => {
          const p = positionOf(node);
          return Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]);
        },
        destroy: node => padWorld?.destroy(node),
        spawn: template => stand(round, entry, template),
      });
    }
  }

  function recordOf(node) {
    for (const record of standing.keys()) if (record.baked === node) return record;
    return null;
  }

  /** The objects rounds stood: gone ones free their node, and the abandon
   *  clock runs on the rest (`PlayerControlObject::handleFrameUpdate`). */
  function tickStanding(dt) {
    const padWorld = page.wrecks?.padWorld;
    let feet = null;
    for (const [record, life] of standing) {
      const node = record.baked;
      if (!padWorld?.alive(node)) {
        page.hullBodies?.releaseSpawned?.(node);
        page.vehiclePads?.setRoundLive?.(record, false);
        standing.delete(record);
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
  };

  /** Headless hooks. */
  spawners.state = () => ({
    rounds: rounds.map(r => ({
      ended: r.ended,
      entries: r.entries.map(e => ({ spawner: e.spec.template, delay: +e.pad.delay.toFixed(3),
                                     nrToSpawn: e.pad.nrToSpawn, slots: [...e.pad.slots].map(n => n?.name ?? null) })),
    })),
    standing: [...standing.entries()].map(([record, life]) => {
      const p = positionOf(record.baked);
      return { template: record.template, at: p.map(v => +v.toFixed(3)),
               countdown: +life.clock.countdown.toFixed(3) };
    }),
  });

  return spawners;
}
