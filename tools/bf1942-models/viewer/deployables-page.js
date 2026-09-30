// What a map's and a hand's ObjectSpawners put in the world, on the map page:
// Desert Combat's mortar, placed by the Support kit's `Mortar_weap` round, and
// the kits DC Final lays on pads (the M82, Stinger, SA-7 and VSS kits). The
// rules -- where the round goes, when the spawner may place its object, how an
// abandoned object dies, when a pad hands out its next kit -- are
// `deployables.js`'s, read out of the engine; this module is the three.js half
// and the wiring. `features/dc-mortar-and-kit-pads/README.md` has the whole.
//
// The mortar. `deployables.json` (extract_deployables.py) names the weapons
// whose round carries an ObjectSpawner and what it places. When such a round
// leaves the human's hand (`guns.onShot` on his hand weapon's group) the bomb
// is followed here, the spawner asks every world tick whether the thrower
// stands clear (2 m from his origin; a bot never blocks it, the engine skips
// AI players), and the object is the model tree's own glb (`Mortar.glb`),
// cloned under the level's `spawners` group: every door, seat, turret and gun
// the page already runs for a placed emplacement runs for it, E and all. It
// falls to the ground under where it appeared, facing the way the round flew,
// upright on the surface (the engine lets its springs settle it: a viewer
// simplification). Its abandoned clock is `AbandonClock`; at 0 hit points it
// plays its armour's death effects and is gone (`timeToLiveAfterDeath 0`).
// Rounds and blasts do not reach it: it is in no collision index the page
// builds at load.
//
// The kit pads. Each `objectSpawns` entry of the active mode whose object is a
// kit the tree's loadouts know is a `SpawnerPad`; the level's baked copy of the
// kit (an inert node that also drew the helmet and packs at the pad) is taken
// out, and the pad's kit lies as a `kit-drops-page.js` record, its own pickup
// mesh turning in place, taken with G like any dropped kit. A pad filed under
// a control point (`osId`) is the point's: its team and whether it is on
// follow the flag (`CPEnable` / `CPDisable`).
//
// Room play: nothing here is replicated, so a joined room neither deploys nor
// runs pads.

import * as THREE from 'three';
import {
  AbandonClock, SpawnerPad, launchBomb, needsClearance, spawnClear, spawnPoint,
  spawnerPoint, stepBomb,
} from './deployables.js';
import { GRAVITY } from './point-body.js';
import { CHARACTER_HEIGHT } from './soldier-pose.js';
import { chainOnShot } from './fire-state.js';

/**
 * Built once by the page, after the hand weapon (its `guns.onShot` is chained
 * onto the one `hand-fire.js` assigns). `page` hands in, as getters:
 * `bindDynamicShading`, `bust`, `camera`, `collider`, `currentKit`,
 * `currentRoot`, `dropEntryPoints`, `effects`, `extras`, `groundHeight`,
 * `guns`, `handWeapon`, `isCollision`, `kitDrops`, `loader`, `loadouts`,
 * `LOCAL_PLAYER`, `MODELS_BASE`, `optOnFoot`, `optPilot`, `params`,
 * `roomJoined`, `soldier`, `soldierDead`, `spawnersRoot`, `vehicles`, `world`.
 */
export function createDeployablesPage(page) {
  const deployables = {};

  // --- deployables.json --------------------------------------------------------

  let tableBase = null;
  let table = null;
  function loadTable() {
    const base = page.MODELS_BASE;
    if (!base || tableBase === base) return;
    tableBase = base;
    table = null;
    fetch(`${base}/deployables.json${page.bust?.() ?? ''}`)
      .then(res => (res.ok ? res.json() : null))
      .then(json => { if (tableBase === base) table = json ?? { weapons: {}, objects: {} }; })
      .catch(() => { if (tableBase === base) table = { weapons: {}, objects: {} }; });
  }
  loadTable();

  const byName = (map, name) => {
    if (!map || !name) return null;
    if (map[name]) return map[name];
    const want = String(name).toLowerCase();
    for (const [key, value] of Object.entries(map)) if (key.toLowerCase() === want) return value;
    return null;
  };

  // --- who stands where ----------------------------------------------------------

  /** The human's origin while he lives on foot: the only soldier
   *  `createObjectOnAllClients` measures (it skips every `getIsAIPlayer`). */
  function humanOrigins() {
    const s = page.soldier;
    if (!s || page.soldierDead || !page.optOnFoot?.checked || page.optPilot?.checked) return [];
    return [[s.x, s.y + CHARACTER_HEIGHT, s.z]];
  }

  /** Every live soldier on foot, bots too: the abandoned clock's "near" test
   *  (`PlayerControlObject::handleFrameUpdate` walks every alive BFPlayer
   *  whose object is a soldier). */
  function footOrigins() {
    const out = [];
    const world = page.world;
    if (!world) return humanOrigins();
    for (const [id, player] of world.players ?? []) {
      const s = player.soldier;
      if (!s || world.armorOf?.(id)?.destroyed) continue;
      if (page.vehicles?.seatOf?.(id)) continue;
      if (id === page.LOCAL_PLAYER && (page.soldierDead || !page.optOnFoot?.checked
                                       || page.optPilot?.checked)) continue;
      out.push([s.x, s.y + CHARACTER_HEIGHT, s.z]);
    }
    return out;
  }

  // --- the bombs ---------------------------------------------------------------------

  const bombs = [];      // { bomb, weapon, objects: [placed...] }
  const placed = [];     // the objects the bombs put down
  let nextObject = 1;
  const glbCache = new Map();

  const camPos = new THREE.Vector3();
  const camQuat = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const toArray = v => [v.x, v.y, v.z];

  /** A round left the human's hand: follow it when it carries a spawner. */
  function onHandShot(group) {
    if (page.roomJoined) return;
    const hw = page.handWeapon;
    if (!hw || group !== hw.group || !table) return;
    const weapon = byName(table.weapons, hw.name);
    if (!weapon?.spawner) return;
    const camera = page.camera;
    camera.getWorldPosition(camPos);
    camera.getWorldQuaternion(camQuat);
    // The view frame in the engine's axes: x right, y up, z forward (a three
    // camera looks down its -Z).
    const frame = {
      right: toArray(axis.set(1, 0, 0).applyQuaternion(camQuat)),
      up: toArray(axis.set(0, 1, 0).applyQuaternion(camQuat)),
      forward: toArray(axis.set(0, 0, -1).applyQuaternion(camQuat)),
    };
    const v = page.soldier?.body?.velocity;
    const bomb = launchBomb({
      eye: toArray(camPos), frame, weapon,
      platformVelocity: v ? [v.x ?? 0, v.y ?? 0, v.z ?? 0] : [0, 0, 0],
    });
    bombs.push({ bomb, weapon, objects: [], by: page.LOCAL_PLAYER });
  }
  chainOnShot(page.guns, group => onHandShot(group));

  /** The surface under (x, z), searched from `fromY` down. */
  function surfaceAt(x, z, fromY) {
    const y = page.groundHeight?.(x, z, fromY);
    return Number.isFinite(y) ? y : null;
  }

  function loadObject(spec) {
    const url = `${page.MODELS_BASE}/${spec.glb}`;
    if (!glbCache.has(url)) {
      glbCache.set(url, page.loader.loadAsync(`${url}${page.bust?.() ?? ''}`)
        .then(gltf => gltf.scene, err => { console.warn(`deployable ${spec.glb}:`, err); return null; }));
    }
    return glbCache.get(url);
  }

  const upAxis = new THREE.Vector3();
  const fwdAxis = new THREE.Vector3();
  const sideAxis = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const normalScratch = [0, 1, 0];

  /** Stand `node` at `record`'s landing: up the surface normal, its -Z (the
   *  engine's forward, through `bf42/gltf.py`'s Z mirror) down the round's
   *  heading. */
  function poseObject(node, record) {
    const field = page.collider?.heightfield;
    if (field) {
      field.normal(record.x, record.z, normalScratch);
      upAxis.set(normalScratch[0], normalScratch[1], normalScratch[2]).normalize();
    } else {
      upAxis.set(0, 1, 0);
    }
    fwdAxis.set(record.heading[0], 0, record.heading[2]);
    if (fwdAxis.lengthSq() < 1e-8) fwdAxis.set(0, 0, 1);
    fwdAxis.addScaledVector(upAxis, -fwdAxis.dot(upAxis)).normalize();
    // +Z of the node is the engine's backward.
    fwdAxis.negate();
    sideAxis.crossVectors(upAxis, fwdAxis).normalize();
    basis.makeBasis(sideAxis, upAxis, fwdAxis);
    node.quaternion.setFromRotationMatrix(basis);
    node.position.set(record.x, record.y, record.z);
    node.updateMatrixWorld(true);
  }

  /** The spawner put `template` at `at`: the glb, cloned, under `spawners`. */
  function placeObject(entry, template, at) {
    const spec = byName(table?.objects, template);
    if (!spec?.glb) return null;
    const spawner = entry.weapon.spawner;
    const f = entry.bomb.frame.forward;
    const record = {
      id: nextObject++, template, spec, entry,
      x: at[0], y: at[1], z: at[2], fallSpeed: 0,
      heading: [f[0], 0, f[2]],
      ground: surfaceAt(at[0], at[2], at[1] + 0.5),
      clock: new AbandonClock({
        timeToLive: spawner.timeToLive, distance: spawner.distance,
        damageWhenLost: spawner.damageWhenLost,
      }),
      hp: spec.hitpoints ?? spec.maxHitpoints ?? 10,
      maxHp: spec.maxHitpoints ?? spec.hitpoints ?? 10,
      radius: spec.radius ?? 1,
      node: null, gone: false, bornAt: tickClock,
    };
    placed.push(record);
    const root = page.currentRoot;
    loadObject(spec).then(source => {
      if (!source || record.gone || page.currentRoot !== root) return;
      const clone = source.clone(true);
      // The PCO root the glb carries: the thing a door, a seat and a gun hang off.
      let node = null;
      clone.traverse(obj => {
        if (!node && obj.userData?.templateKind?.toLowerCase?.() === 'playercontrolobject') node = obj;
      });
      node ??= clone;
      node.removeFromParent();
      node.traverse(obj => { if (page.isCollision?.(obj)) obj.visible = false; });
      node.name = spec.template ?? template;
      node.userData.deployed = record.id;
      page.bindDynamicShading?.(node);
      (page.spawnersRoot ?? root)?.add(node);
      record.node = node;
      poseObject(node, record);
      page.dropEntryPoints?.();
    });
    return record;
  }

  /** The object's end: its armour's last effects where it stood, and gone. */
  function removeObject(record, { effects = true } = {}) {
    if (record.gone) return;
    record.gone = true;
    const node = record.node;
    if (node) {
      if (effects && page.effects) {
        node.updateMatrixWorld(true);
        const at = node.getWorldPosition(new THREE.Vector3());
        for (const e of node.userData?.armor?.effects ?? []) {
          if (!(e.hp <= 0) || !e.effect) continue;
          const o = e.offset ?? [0, 0, 0];
          page.effects.play(e.effect, { position: [at.x + o[0], at.y + o[1], at.z + o[2]], normal: [0, 1, 0] });
        }
      }
      node.removeFromParent();
      page.dropEntryPoints?.();
    }
    const i = placed.indexOf(record);
    if (i >= 0) placed.splice(i, 1);
  }

  let tickClock = 0;

  /** One world tick of the bombs and what they placed. */
  function tickObjects(dt) {
    const water = page.extras?.waterLevel;
    for (let i = bombs.length - 1; i >= 0; i--) {
      const entry = bombs[i];
      const { bomb, weapon } = entry;
      const spawner = weapon.spawner;
      if (!bomb.dead && entry.objects.length < (spawner.maxNrOfObjectSpawned ?? 1)) {
        // The spawner's frame, ahead of the round's physics: the first one
        // runs on the tick the round is born.
        const template = spawner.templates?.[String(spawner.team ?? 0)] ?? null;
        const spec = byName(table?.objects, template);
        const at = spawnPoint(bomb, spawner.spawnOffset);
        if (template && spec
            && (!needsClearance(spec.vehicleCategory) || spawnClear(at, humanOrigins()))) {
          const record = placeObject(entry, template, at);
          if (record) entry.objects.push(record);
        }
      }
      const prevY = bomb.pos[1];
      stepBomb(bomb, dt, {
        ground: (x, z) => surfaceAt(x, z, prevY + 0.5),
        waterLevel: Number.isFinite(water) ? water : null,
      });
      // The spawner goes with its round: every object it placed has lost it.
      if (bomb.dead) bombs.splice(i, 1);
    }
    const feet = footOrigins();
    for (const record of [...placed]) {
      // The fall: mobile physics, straight down onto what is under it.
      if (record.ground != null && record.y > record.ground) {
        record.fallSpeed -= GRAVITY * dt;
        record.y = Math.max(record.ground, record.y - record.fallSpeed * dt);
        if (record.node) poseObject(record.node, record);
      }
      const live = bombs.includes(record.entry);
      let spawnerDistance = Infinity;
      if (live) {
        const s = spawnerPoint(record.entry.bomb);
        spawnerDistance = Math.hypot(s[0] - record.x, s[1] - record.y, s[2] - record.z);
      }
      const r2 = record.radius * record.radius;
      const soldierNear = feet.some(o =>
        (o[0] - record.x) ** 2 + (o[1] - record.y) ** 2 + (o[2] - record.z) ** 2 < r2);
      const occupied = !!(record.node && page.vehicles?.instanceOf?.(record.node));
      const loss = record.clock.step(dt, { spawnerAlive: live, spawnerDistance, soldierNear, occupied });
      if (loss > 0) {
        record.hp -= loss;
        if (record.hp <= 0.001) removeObject(record);
      }
    }
  }

  // --- the kit pads ------------------------------------------------------------------

  let pads = [];
  let padsFor = null;         // the objectSpawns array the pads were built from
  let padRoot = null;

  function loadoutKit(name) {
    const kits = page.loadouts?.kits;
    if (!kits || !name) return null;
    if (kits[name]) return name;
    const want = String(name).toLowerCase();
    for (const key of Object.keys(kits)) if (key.toLowerCase() === want) return key;
    return null;
  }

  /** The control point a pad is filed under: `osId` against the points'
   *  `objectSpawnerId`, or, for a scene written before the exporter carried
   *  `osId`, the nearest point it guessed (`controlPointName`). */
  function padPoint(spawn, anyOsId) {
    const points = page.extras?.controlPoints ?? [];
    if (Number.isFinite(spawn.osId)) {
      return points.find(p => p.objectSpawnerId === spawn.osId)?.name ?? null;
    }
    return anyOsId ? null : (spawn.controlPointName ?? null);
  }

  function flagTeam(pointName) {
    if (!pointName) return null;
    const flag = page.world?.flags?.find(f => f.controlPointName === pointName);
    return flag ? (flag.team ?? 0) : null;
  }

  /** The baked copy of a pad's kit: the spawners child standing on it. */
  function bakedKitAt(position) {
    const root = page.spawnersRoot;
    if (!root || !position) return null;
    const at = new THREE.Vector3();
    let best = null;
    let bestD = 1.0;
    for (const child of root.children) {
      if (child.userData?.templateKind?.toLowerCase?.() !== 'kit') continue;
      child.getWorldPosition(at);
      const d = Math.hypot(at.x - position[0], at.y - position[1], at.z - position[2]);
      if (d < bestD) { best = child; bestD = d; }
    }
    return best;
  }

  const padQuat = new THREE.Quaternion();
  const padAxis = new THREE.Vector3();

  function buildPads() {
    for (const pad of pads) pad.baked && !pad.baked.parent && padRoot?.add?.(pad.baked);
    pads = [];
    const spawns = page.extras?.objectSpawns;
    padsFor = spawns ?? null;
    padRoot = page.spawnersRoot ?? null;
    if (!Array.isArray(spawns) || page.roomJoined) return;
    const anyOsId = spawns.some(s => Number.isFinite(s?.osId));
    for (const spawn of spawns) {
      const templates = spawn.templates ?? { 1: spawn.vehicle, 2: spawn.vehicle };
      const kits = {};
      for (const [team, name] of Object.entries(templates)) {
        const kit = loadoutKit(name);
        if (kit) kits[team] = kit;
      }
      if (!Object.keys(kits).length) continue;
      const baked = bakedKitAt(spawn.position);
      const place = { x: spawn.position[0], y: spawn.position[1], z: spawn.position[2],
                      yaw: 0, normal: [0, 1, 0] };
      if (baked) {
        baked.getWorldPosition(padAxis);
        place.x = padAxis.x; place.y = padAxis.y; place.z = padAxis.z;
        baked.getWorldQuaternion(padQuat);
        // The kit record's heading is where its -Z points (`kit-drops-page.js`).
        padAxis.set(0, 0, -1).applyQuaternion(padQuat);
        place.yaw = Math.atan2(padAxis.x, padAxis.z);
        padAxis.set(0, 1, 0).applyQuaternion(padQuat);
        place.normal = [padAxis.x, padAxis.y, padAxis.z];
        // The level's inert copy goes: the pad's own kit is drawn by the kit drops.
        baked.removeFromParent();
      }
      const pad = new SpawnerPad({
        templates: kits, team: spawn.team ?? 0,
        minSpawnDelay: spawn.minSpawnDelay, maxSpawnDelay: spawn.maxSpawnDelay,
        spawnDelayAtStart: spawn.spawnDelayAtStart,
      });
      pad.reset();
      const record = { pad, spawn, place, baked, point: padPoint(spawn, anyOsId), held: null };
      pads.push(record);
    }
  }

  function tickPads(dt) {
    const kitDrops = page.kitDrops;
    if (!kitDrops) return;
    if (page.extras?.objectSpawns !== padsFor || page.spawnersRoot !== padRoot) buildPads();
    for (const record of pads) {
      const { pad, place } = record;
      // `CPEnable` / `CPDisable` on the flag's changes, and once at the start
      // for a point that opens held (`ControlPoint::init` runs `control(0)`).
      const team = flagTeam(record.point);
      if (team != null && team !== record.held) {
        if (team === 1 || team === 2) pad.enable(team);
        else if (record.held != null) pad.disable(team);
        record.held = team;
      }
      pad.tick(dt, {
        alive: id => kitDrops.objectAlive(id),
        distance: id => {
          const at = kitDrops.objectPosition(id);
          return at ? Math.hypot(at[0] - place.x, at[1] - place.y, at[2] - place.z) : Infinity;
        },
        critical: () => false,
        spawn: kit => {
          const objectId = `pad${pads.indexOf(record)}:${nextObject++}`;
          return kitDrops.placeKit(kit, place, { objectId }) ? objectId : null;
        },
      });
    }
  }

  // --- time and level ----------------------------------------------------------------

  let tickRoot = null;
  /** `dt` seconds of world time (the page hands in `ticks / 30`). */
  deployables.tick = dt => {
    if (!(dt > 0)) return;
    loadTable();
    if (page.currentRoot !== tickRoot) {
      deployables.reset();
      tickRoot = page.currentRoot;
    }
    tickClock += dt;
    if (page.roomJoined) return;
    tickObjects(dt);
    tickPads(dt);
  };

  /** A level change: every bomb, object and pad is the old level's. The kit
   *  drops clear their own records (`kitDrops.reset`). */
  deployables.reset = () => {
    for (const record of [...placed]) removeObject(record, { effects: false });
    placed.length = 0;
    bombs.length = 0;
    pads = [];
    padsFor = null;
    padRoot = null;
  };

  if (page.params?.has?.('shots')) {
    // Headless hooks: the bombs in the air, the objects they placed and the pads.
    window.__deployables = {
      table: () => table,
      bombs: () => bombs.map(e => ({ weapon: e.weapon.projectile, pos: e.bomb.pos.map(v => +v.toFixed(3)),
                                     age: +e.bomb.age.toFixed(3), resting: e.bomb.resting,
                                     placed: e.objects.map(o => o.id) })),
      placed: () => placed.map(r => ({
        id: r.id, template: r.template, loaded: !!r.node,
        at: [+r.x.toFixed(3), +r.y.toFixed(3), +r.z.toFixed(3)],
        ground: r.ground == null ? null : +r.ground.toFixed(3),
        hp: +r.hp.toFixed(3), countdown: +r.clock.countdown.toFixed(3),
        occupied: !!(r.node && page.vehicles?.instanceOf?.(r.node)),
        age: +(tickClock - r.bornAt).toFixed(3),
      })),
      pads: () => pads.map(({ pad, spawn, place, point, held }) => ({
        spawner: spawn.spawner, osId: spawn.osId ?? null, point, flagTeam: held,
        team: pad.team, active: pad.active, templates: pad.templates,
        delay: +pad.delay.toFixed(3), slot: pad.slots[0], place: [place.x, place.y, place.z].map(v => +v.toFixed(3)),
      })),
      advance: seconds => {
        const steps = Math.round((Number(seconds) || 0) * 30);
        for (let i = 0; i < steps; i++) deployables.tick(1 / 30);
        return window.__deployables.placed();
      },
    };
  }

  return deployables;
}
