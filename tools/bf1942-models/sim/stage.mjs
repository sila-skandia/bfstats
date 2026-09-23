// A real level's vehicle path, headless: the page's own modules, wired the
// way `map.html` and `level-load.js show()` wire them, minus the renderer,
// the human and the sound.
//
// What the page builds for a level, and the order it builds it in, is what
// this builds (every factory is the viewer's, imported, not copied):
//
//   World           `new World({ extras, guns, groundHeight, fireStates,
//                   onCrash, isWrecked, onTick })`, `onTick` publishing every
//                   seat's world position (`vehicles.publishSeatPositions`)
//   landing craft   `detachSpawnedCraft` splits a ship's craft off it
//   statics         `level-statics.js indexScene`: the spawners group, the
//                   parked hulls, the static subtrees frozen out of the
//                   matrix walk (a hull is thawed for a ride and frozen where
//                   it is parked, `vehicles.enter` / `leave`)
//   terrain         `level-terrain.js`: `collectTerrain`, the material and
//                   damage tables (`setTables`), then `buildCollider`, which
//                   settles the parked hulls on their springs and floats the
//                   ships at their draft (`hull-bodies.js`), indexes every
//                   placed object (the parked hulls included, one owner
//                   each), registers every Armor (`vehicle-wrecks.js
//                   registerDamageables`) and hands the guns the level
//   bodies          `hull-bodies.js setupVehicleBodies`: `World.setupBodies`
//                   and a parked body per hull
//   hulls           `VehicleRegistry` (vehicle-instance.js) with the real
//                   drive classes (`Aircraft`, `GroundVehicle`,
//                   `TrackedVehicle`, `Ship`), each hull's one drive adopted
//                   into the body world and released back as a parked body
//   guns            `GunFire` headless: a scene nobody draws, the rounds
//                   flown against the collider and the soldiers
//                   (`vehicle-hits.js roundBodyCast`), every landing through
//                   `applyVehicleHit` (the direct hit, the splash, the tier,
//                   the wreck); the magazine and heat on `guns.onShot`
//   wrecks          `vehicle-wrecks.js`: the wreck, its linger and fade, the
//                   spawner's respawn on the pad
//   the bots' units `bot-units.js createBotUnits` over the registry and the
//                   level's doors (`vehicle-entry.js collectEntryPoints`):
//                   the referee's `units`, the page's own
//
// and per tick, after the world's step, the page frame's order:
// `referee.tick`, `syncVehicleSpawnOwnership`, `referee.captureTick`,
// `stepVehicleBodies`, `stepSinkingHulls`, `stepVehicleDamage`, then the
// scene's matrix walk the renderer's `scene.updateMatrixWorld()` does (a
// seat's aim rig is posed after the drive's own transform, and its muzzles
// are read off the walked matrices on the next tick).
//
// SIM, the departures (none of them changes what a hull or a bot does):
//  * `buildHullDrive` is map.html's (a page function, not importable),
//    copied below with the cockpit off: nothing draws a cockpit here, and the
//    cockpit glb is a fetch.
//  * Everything presentational is a stub: `effects` plays nothing, the wreck
//    glb load never resolves (the pad fades the intact hull, the page's own
//    fallback), no audio, no HUD, no local player, and no render
//    interpolation: a driven hull's node keeps the pose its drive wrote.
//  * `unitInfo` is computed once a tick per target instead of once per
//    asking bot (a cache of the same answer; see `units.unitInfo`).

/** The kinds of unit the bots may take (`bot-units.js candidates`' own list). */
export const STAGE_KINDS = ['ground', 'tank', 'gun', 'air', 'ship'];

/** Build the stage. `data` is `realLevel`'s: the scene root and the tables. */
export function createStage(M, level, { vehicles = true, kinds = STAGE_KINDS, seed = 1 } = {}) {
  const S = M.stage;
  const { THREE } = M;
  const data = level.stage;
  const root = data.root;
  const extras = level.extras;
  const noop = () => {};
  const unchecked = { checked: false };
  // The presentation a page would have: nothing is drawn or heard.
  const effects = { play: () => null, flush: noop, advance: noop, library: null, firstPerson: false };
  const loader = { loadAsync: () => new Promise(noop) };
  const camera = new THREE.PerspectiveCamera();
  const seatWorldPos = new THREE.Vector3();

  const stage = {
    root, world: null, guns: null, vehicles: null, units: null, terrain: null, statics: null,
    hullBodies: null, wrecks: null, vehicleHits: null, entry: null,
    /** The hooks the match sets: `onWreck(owner, vehicle, attackerId)`,
     *  `onRespawn(owner)`, `onRounds(group, rounds, firerId)`. */
    hooks: {},
    referee: null,
  };

  // --- the World (level-load.js show) ---------------------------------------
  const guns = new S.GunFire({ scene: new THREE.Scene(), camera, viewportHeight: () => 720 });
  // The gun's own dice, seeded apart from `Math.random` (gunfire.js's own
  // note: a headless check seeds these and nothing else).
  guns.rand = M.mulberry32((seed ^ 0x5eed9a75) >>> 0);
  stage.guns = guns;
  let world = null;
  const statics = S.createLevelStatics({
    get camera() { return camera; }, drawDistance: () => Infinity, get extras() { return extras; },
    get levelClips() { return data.levelClips; }, optEntire: unchecked, optVehicles: unchecked,
    templateNameOf: node => wrecks.templateNameOf(node), get world() { return world; },
  });
  stage.statics = statics;
  const terrain = S.createLevelTerrain({
    bust: () => '', get effects() { return effects; }, get extras() { return extras; },
    get floatPlacedVehicles() { return hullBodies.floatPlacedVehicles; }, get guns() { return guns; },
    loadEffectLibrary: noop, MAPS_BASE: '', get rebaseDeckSpawns() { return hullBodies.rebaseDeckSpawns; },
    get registerDamageables() { return wrecks.registerDamageables; },
    get settlePlacedVehicles() { return hullBodies.settlePlacedVehicles; },
    get spawnersRoot() { return statics.spawnersRoot; }, get world() { return world; },
  });
  stage.terrain = terrain;
  const registry = new S.VehicleRegistry({
    classes: { Aircraft: S.Aircraft, GroundVehicle: S.GroundVehicle, TrackedVehicle: S.TrackedVehicle, Ship: S.Ship },
    buildDrive: instance => buildHullDrive(instance),
    world: () => world,
    guns,
    adopt: drive => hullBodies.adoptDrivenBody(drive),
    release: drive => hullBodies.releaseDrivenBody(drive),
    thaw: node => statics.thawVehicle(node),
    freeze: node => statics.freezeVehicle(node),
    onChange: () => units?.invalidate(),
  });
  stage.vehicles = registry;
  const wrecks = S.createVehicleWrecks({
    bindDynamicShading: noop, bust: () => '', clearHitIndicator: noop, get collider() { return terrain.collider; },
    dieInWreck: noop, disposeEngineAudio: noop, get effects() { return effects; }, exitPoseManned: () => null,
    get extras() { return extras; }, get fireStates() { return world?.fireStates; }, hud: {},
    isCollision: S.isCollision, leaveSeat: noop, get loader() { return loader; }, markPilot: noop,
    MODELS_BASE: '', occupancy: null, optOnFoot: unchecked, placeCamera: noop, resetMobileControls: noop,
    respawnVehicleBody: owner => { hullBodies.respawnVehicleBody(owner); stage.hooks.onRespawn?.(owner); },
    retireVehicleBody: owner => hullBodies.retireVehicleBody(owner),
    soldier: null, soldierDead: true, standUp: noop, updateHud: noop, useLens: noop,
    get vehicleDamage() { return world?.vehicleDamage; }, get vehicles() { return registry; },
    get world() { return world; },
  });
  stage.wrecks = wrecks;
  const entry = S.createVehicleEntry({
    get currentRoot() { return root; }, vehicleSpawnActive: node => statics.vehicleSpawnActive(node),
  });
  stage.entry = entry;
  const hullBodies = S.createHullBodies({
    bust: () => '', get collider() { return terrain.collider; }, get damageTables() { return terrain.damageTables; },
    get damageVisuals() { return wrecks.damageVisuals; },
    get DEFAULT_SURFACE_FRICTION() { return terrain.DEFAULT_SURFACE_FRICTION; },
    dropEntryPoints: () => entry.dropEntryPoints(), get effects() { return effects; },
    get extras() { return extras; }, forgetEntryPoints: () => entry.forgetEntryPoints(), MAPS_BASE: '',
    get materialFrictionById() { return terrain.materialFrictionById; },
    get vehicleDamage() { return world?.vehicleDamage; },
    // The page's render interpolation draws every occupied hull (local-look.js
    // `drawsHull`), so `stepVehicleBodies` leaves a driven hull's node alone;
    // here nothing draws, and the node keeps the pose its drive's own
    // `integrate` wrote this tick (the contact push reaches it on the next).
    drawsHull: () => true,
    get vehicles() { return registry; }, vehicleSpawnActive: node => statics.vehicleSpawnActive(node),
    get world() { return world; },
  });
  // `loadCollisionMeshes` is a fetch; the sidecar is already read.
  hullBodies.collisionMeshes = data.collisionMeshes;
  stage.hullBodies = hullBodies;
  const vehicleHits = S.createVehicleHits({
    applyDamage: (...a) => stage.referee.applyDamage(...a), applyDamageToPlayer: noop,
    get bots() { return stage.referee?.bots ?? []; }, get camera() { return camera; },
    get collider() { return terrain.collider; }, get currentRoot() { return root; },
    damageLanded: (...a) => stage.referee.damageLanded(...a), get damageVisuals() { return wrecks.damageVisuals; },
    feedVehicleHud: noop, get guns() { return guns; }, LOCAL_PLAYER: 'local', occupancy: null,
    optOnFoot: unchecked, optPilot: unchecked, showDamageTier: (v, t) => wrecks.showDamageTier(v, t),
    soldier: null, soldierArmor: null, soldierDead: true, stepWrecks: dt => wrecks.stepWrecks(dt),
    get vehicleDamage() { return world?.vehicleDamage; }, get vehicles() { return registry; },
    get world() { return world; },
    // Every wreck, whatever killed it: the page's, plus the runner's record
    // (the hull's `killedBy`, the attacker of the lethal hit).
    wreckVehicle: vehicle => {
      const visual = wrecks.damageVisuals.get(vehicle.owner);
      if (visual && !visual.wrecked) stage.hooks.onWreck?.(vehicle.owner, visual.node, vehicle.killedBy ?? null);
      return wrecks.wreckVehicle(vehicle);
    },
  });
  stage.vehicleHits = vehicleHits;

  // The guns (map.html): every round that lands goes through the page's hit
  // path, a round meets the soldiers on its way, a proximity fuse sees every
  // hull, and the seat's magazine and heat are charged per pull
  // (hand-fire.js's `chainOnShot` pair).
  guns.onImpact = record => vehicleHits.applyVehicleHit(record);
  guns.bodyCast = vehicleHits.roundBodyCast;
  guns.nearObjects = vehicleHits.proximityObjects;
  S.chainOnShot(guns, (group, rounds) => world?.fireStates.get(group.node)?.registerShot(rounds));
  // The runner's count is projectiles: a pull charges an unlimited gun
  // (`magSize -1`, the AA guns) nothing, but it still fires its barrels
  // (`bomb-release.js salvo`).
  S.chainOnShot(guns, (group, rounds) => {
    const state = world?.fireStates.get(group.node);
    const barrels = group.stats?.asynchronyFire ? 1 : Math.max(1, group.muzzles?.length ?? 1);
    const shots = !state || state.unlimited ? barrels : rounds;
    stage.hooks.onRounds?.(group, shots, registry.firerOf(group));
  });
  guns.roundsLeft = group => {
    const state = world?.fireStates.get(group.node);
    return state && !state.unlimited ? state.ammo : Infinity;
  };

  world = new M.World({
    extras, guns, groundHeight: terrain.groundHeight, fireStates: new WeakMap(),
    onCrash: (...a) => hullBodies.onCrashDamage(...a),
    isWrecked: owner => {
      const visual = wrecks.damageVisuals.get(owner);
      return !!(visual?.wrecked || visual?.removed);
    },
    onTick: () => registry.publishSeatPositions(seatWorldPos),
  });
  stage.world = world;

  // --- the scene (show) -------------------------------------------------------
  if (!vehicles) {
    // `--no-vehicles`: the spawners group (every placed vehicle and gun) goes
    // before anything indexes the scene.
    let spawners = null;
    root.traverse(o => { if (!spawners && (o.userData?.kind === 'spawners' || o.name === 'spawners')) spawners = o; });
    spawners?.parent?.remove(spawners);
  }
  S.detachSpawnedCraft(root);
  statics.indexScene(root);
  terrain.collectTerrain(root);
  terrain.setTables(data.terrainMaterials, data.damageTables);
  terrain.buildCollider(root);
  hullBodies.setupVehicleBodies();
  stage.collider = terrain.collider;

  /** map.html `buildHullDrive`, copied (SIM: the cockpit off). */
  function buildHullDrive(instance) {
    const occ = instance.occupancy;
    const drive = occ.ensureDrive(root, {
      groundHeight: terrain.groundHeight, surfaceFriction: terrain.surfaceFriction, deckNormal: terrain.deckNormal,
      collider: hullBodies.bodyAwareCollider(),
      waterLevel: terrain.collider?.waterLevel ?? extras?.waterLevel,
      cockpit: false,
    });
    if (!drive) return null;
    if (occ.rootKind === 'air') {
      drive.groundHeight = terrain.groundHeight;
      drive.state.position.y += 0.2;
    } else if (occ.rootKind === 'ship') {
      drive.groundHeight = (x, z) => {
        const h = terrain.collider?.heightfield?.height(x, z);
        return Number.isFinite(h) ? h : -Infinity;
      };
      drive.groundNormal = (x, z, out) => {
        const n = terrain.collider?.heightfield?.normal;
        if (!n) { out.set(0, 1, 0); return out; }
        n.call(terrain.collider.heightfield, x, z, hullBodies._shipNormal);
        out.set(hullBodies._shipNormal[0], hullBodies._shipNormal[1], hullBodies._shipNormal[2]);
        return out;
      };
      drive.seabedFriction = hullBodies.seabedFriction;
    }
    drive.autoFirstPerson = false;
    drive.setFirstPerson?.(false);
    return drive;
  }

  // --- the bots' units (map.html botUnits) -----------------------------------
  let units = null;
  if (vehicles) {
    const botUnits = S.createBotUnits({
      world: () => world,
      referee: () => stage.referee,
      vehicles: registry,
      aiUrl: () => null,
      entryPoints: recollect => {
        if (recollect) entry.collectEntryPoints();
        return entry.entryPoints;
      },
      currentRoot: () => root,
      vehicleSpawnActive: node => statics.vehicleSpawnActive(node),
      collider: () => terrain.collider,
      localPlayerId: 'local',
    });
    // `loadAi` is a fetch; the sidecar is already read.
    botUnits.ai = new Map(Object.entries(data.vehicleAi ?? {}).map(([k, v]) => [k.toLowerCase(), { name: k, ...v }]));
    const allowed = new Set(kinds);
    units = Object.create(botUnits);
    units.candidates = () => botUnits.candidates().filter(c => allowed.has(c.kind));
    // A target's description, once a tick per target rather than once per
    // asking bot: `unitInfo` measures the hull's box (`Box3.setFromObject`
    // over its whole tree), and nothing a bot's tick does moves a hull or
    // changes a seat, so the answer is the same for every bot in the tick
    // (SIM: the page asks it per bot; this is a cache, not a change).
    const infoMemo = { at: -1, byId: new Map() };
    units.unitInfo = id => {
      const now = stage.referee?.clock ?? 0;
      if (infoMemo.at !== now) { infoMemo.at = now; infoMemo.byId.clear(); }
      if (infoMemo.byId.has(id)) return infoMemo.byId.get(id);
      const info = botUnits.unitInfo(id);
      infoMemo.byId.set(id, info);
      return info;
    };
    stage.botUnits = botUnits;
    entry.collectEntryPoints();
  }
  stage.units = units;

  /** The units the bots can take on this level: every vehicle root of an
   *  allowed kind with AI data, live or waiting on a neutral flag. */
  const unitTotal = units
    ? S.findAllVehicleRoots(root).filter(n => kinds.includes(stage.botUnits.kindOf(n)) && stage.botUnits.aiOf(n)).length
    : 0;
  stage.countVehicles = () => unitTotal;

  /** A hand-weapon round a seated bot took: his hull pays, and remembers
   *  who (map.html's `damageHull`). */
  stage.damageHull = (bot, dmg, { attackerId = null } = {}) => {
    const hull = world.occupiedDamageable(bot.playerId);
    if (!hull) return false;
    hull.damage(dmg, attackerId);
    return true;
  };

  /** Between the referee's tick and the capture pass (map.html frame()). */
  stage.afterBots = () => {
    hullBodies.syncVehicleSpawnOwnership();
  };

  /** After the capture pass: the bodies drawn back onto their nodes, the
   *  sinking hulls, the damage tiers and wrecks, then the renderer's walk. */
  stage.afterCapture = (step, dt) => {
    hullBodies.stepVehicleBodies(step);
    hullBodies.stepSinkingHulls(step);
    vehicleHits.stepVehicleDamage(step, dt);
    // The renderer's `scene.updateMatrixWorld()`, where anything reads it
    // raw: a seat's guns, whose aim rig was posed after the drive wrote the
    // hull (`applyTurrets`, the gunner's servo) -- the bot's aim origin and
    // the next tick's muzzles. Every static subtree is frozen and a parked
    // body is written through its own `updateMatrixWorld(true)`; every other
    // read of a hull goes through `getWorldPosition`, which walks its own
    // chain.
    for (const inst of registry.instances.values()) {
      for (const groups of inst.guns.values()) {
        for (const group of groups.driven) group.node.updateWorldMatrix(true, false);
        for (const group of groups.manned) group.node.updateWorldMatrix(true, false);
      }
    }
  };

  /** The level's owner id of a hull root node (`ownerOf` walks the owner
   *  list; a hull's is fixed for the level). */
  const owners = new WeakMap();
  stage.ownerOf = node => {
    let owner = owners.get(node);
    if (owner === undefined) {
      owner = terrain.collider?.statics?.ownerOf(node) ?? -1;
      owners.set(node, owner);
    }
    return owner;
  };

  return stage;
}
