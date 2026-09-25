// The level: `show()` loads a level's scene and binds it, builds the world on
// it and spawns the bots onto it; `level` is what the rest of the page reads
// of it. Lifted out of map.html (features/vehicle-instance-refactor Part 2),
// then split along its seams, each part taking only the values it reads:
//
//   level-sky.js      sky, clouds, water, envmap, light rig, fog, far plane
//   level-shading.js  terrain detail, lightmaps, the engine's shading, fade
//   level-flare.js    the sun's lens flare
//   level-statics.js  the scene index, the frozen statics, the distance cull
//   level-terrain.js  `groundHeight`, `surfaceFriction`, `deckNormal`, the
//                     material and damage tables, the collider
//   level-warmup.js   programs and textures warmed before they are drawn
//
// The world (`level.world`), its combat area and its vehicle damage set are
// the level's: it builds them, and every other reader gets them from here.

import * as THREE from 'three';
import { createLevelSky } from './level-sky.js';
import { createLevelFlare } from './level-flare.js';
import { createLevelShading } from './level-shading.js';
import { createLevelStatics, isCollision } from './level-statics.js';
import { createLevelTerrain } from './level-terrain.js';
import { createLevelWarmup } from './level-warmup.js';
import { bareFireArmsName } from './vehicle-audio.js';
import { idleFirePose } from './idle-vehicle.js';
import { SupplyDepot } from './supply.js';
import { World } from './world.js';
import { CombatArea } from './combat-area.js';
import { VehicleDamageSet } from './vehicle-damage.js';
import { modeNames, modeProblem, pruneToMode, selectGameMode } from './game-modes.js';
import { detachSpawnedCraft } from './seats.js';
import { bindTreeFoliage } from './tree-foliage.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `activeMod`, `bust`, `camera`, `capture`, `capturePresentationTick`,
 * `cubeLoader`, `damageVisuals`, `DEFAULT_DRAW`, `disposeSounds`, `effects`,
 * `ensureBotRoot`, `fireStates`, `floatPlacedVehicles`, `forgetEntryPoints`,
 * `forgetFlagChoice`, `forgetSeatViews`, `forgetSoldier`, `fullmapMeta`,
 * `fullmapName`, `guns`, `hemi`, `leaveOnFoot`, `loadCollisionMeshes`,
 * `loadEffectLibrary`, `loader`, `loadMapArt`, `logToConsole`, `MAPS_BASE`,
 * `onCrashDamage`, `openDeploy`, `optEntire`, `optGameFog`, `optPilot`,
 * `optVehicles`, `optWire`, `overlay`, `params`, `placeCamera`,
 * `rebaseDeckSpawns`, `rebuildVehicleInterp`, `registerDamageables`,
 * `renderer`, `resetBots`, `scene`, `seatWorldPos`, `setPilot`, `settlePlacedVehicles`,
 * `setupSounds`, `setupVehicleBodies`, `spawnBotsForLevel`, `sun`,
 * `syncDeployReady`, `templateNameOf`, `texLoader`, `texManager`,
 * `toggleFullMap`, `unitRectOf`, `vehicles`, `vmScene`.
 */
export function createLevel(page) {
  const level = {};

  // level-sky.js: the sky, clouds, water, light rig, fog and far plane.
  const sky = createLevelSky({
    get bust() { return page.bust; },
    get camera() { return page.camera; },
    get cubeLoader() { return page.cubeLoader; },
    get DEFAULT_DRAW() { return page.DEFAULT_DRAW; },
    get extras() { return level.extras; },
    get hemi() { return page.hemi; },
    get MAPS_BASE() { return page.MAPS_BASE; },
    get optEntire() { return page.optEntire; },
    get optGameFog() { return page.optGameFog; },
    get scene() { return page.scene; },
    get simTime() { return level.simTime; },
    get sun() { return page.sun; },
    get texLoader() { return page.texLoader; },
    get vmScene() { return page.vmScene; },
  });
  // level-flare.js: the sun's lens flare.
  const flare = createLevelFlare({
    get bust() { return page.bust; },
    get camera() { return page.camera; },
    get extras() { return level.extras; },
    get MAPS_BASE() { return page.MAPS_BASE; },
    get renderer() { return page.renderer; },
  });
  // level-shading.js: the engine's shading passes and the doorway fade.
  const shading = createLevelShading({
    get bust() { return page.bust; },
    get camera() { return page.camera; },
    get extras() { return level.extras; },
    get levelEnvCube() { return sky.levelEnvCube; },
    get MAPS_BASE() { return page.MAPS_BASE; },
    get renderer() { return page.renderer; },
    get texLoader() { return page.texLoader; },
  });
  // level-statics.js: the scene index, the frozen statics and the distance cull.
  const statics = createLevelStatics({
    get camera() { return page.camera; },
    get drawDistance() { return sky.drawDistance; },
    get extras() { return level.extras; },
    get levelClips() { return level.levelClips; },
    get optEntire() { return page.optEntire; },
    get optVehicles() { return page.optVehicles; },
    get templateNameOf() { return page.templateNameOf; },
    get world() { return level.world; },
  });
  // level-terrain.js: the terrain queries, the material and damage tables, the collider.
  const terrain = createLevelTerrain({
    get bust() { return page.bust; },
    get effects() { return page.effects; },
    get extras() { return level.extras; },
    get floatPlacedVehicles() { return page.floatPlacedVehicles; },
    get guns() { return page.guns; },
    get loadEffectLibrary() { return page.loadEffectLibrary; },
    get MAPS_BASE() { return page.MAPS_BASE; },
    get rebaseDeckSpawns() { return page.rebaseDeckSpawns; },
    get registerDamageables() { return page.registerDamageables; },
    get settlePlacedVehicles() { return page.settlePlacedVehicles; },
    get spawnersRoot() { return statics.spawnersRoot; },
    get world() { return level.world; },
  });
  // level-warmup.js: programs linked and textures uploaded before the frame that draws them.
  const warm = createLevelWarmup({
    get camera() { return page.camera; },
    get effects() { return page.effects; },
    get guns() { return page.guns; },
    get renderer() { return page.renderer; },
    get scene() { return page.scene; },
  });

  level.currentRoot = null;
  // The game never lets you deploy into a level that has not finished loading;
  // the browser must not either. False from the moment show() starts streaming
  // a scene until its collider and bindings are up — deploySpawn refuses while
  // it is false, or a fast SPAWN drops the soldier into an empty fog-coloured
  // void that reads as "the map is broken".
  level.worldReady = false;
  level.extras = {};
  level.simTime = 0;
  // Drives everything the level glb animates. One mixer over the level root
  // plays every clip it carries: `FlagBlow <name>` per control point, over that
  // flag's own joints, which is the animation state `AnimatedFlag` declares —
  // and `spin`/`spin.N`, the `setContinousRotationSpeed` parts grouped by period.
  // The clips the mixer plays are kept for `freezeStatics`, which must leave
  // every node they drive in three's matrix walk.
  level.levelClips = [];
  level.flagMixer = null;
  /** The level's flag-cloth mixer, made on first use (a capture that raises a
   *  flag on a level whose cloths declared no clip). */
  level.ensureFlagMixer = () => (level.flagMixer ??= new THREE.AnimationMixer(level.currentRoot));
  // What `?mode=` could not give this level, for the console band. Null
  // whenever the URL got exactly what it asked for, which is every load
  // with no `?mode=` at all.
  level.modeNote = null;
  // The level's headless simulation core (world.js): N soldiers, the vehicle
  // bodies, guns, combat area, supply depots, tickets and the collider, stepped
  // at the engine's 30 Hz from one buffered input per player per tick. Built
  // once per level in show(); the page feeds it the local player's input every
  // frame (frame() in map.html) and keeps everything presentational. The one
  // player the page owns is always `LOCAL_PLAYER`; `world` is the same object a
  // P2 server would run for every remote one. Null until the first level.
  level.world = null;
  // `game.setActiveCombatArea` — the warning, its countdown and the damage
  // after it. All the engine reading is in `combat-area.js`; the page steps it
  // with the body's position and hands the result to the HUD and to the
  // soldier's Armor. The world's own from the first level on (show()); an
  // inert one before it.
  //
  // It has TWO halves, and the second one is why it is no longer inert on the
  // twelve levels that declare no rectangle: `GameServer::gameStatusPlaying`
  // also counts you as outside when the terrain material under you equals
  // `materialToGiveDamage` (CA-5, default 7, "Reserved (Outside map)"). Eleven
  // of the 23 vanilla levels paint that id, three of them without declaring any
  // rectangle at all. `heightfield.material(x, z)` is the channel — the same one
  // `surfaceFriction` already reads per wheel.
  level.combatArea = new CombatArea(null);
  // The world's `VehicleDamageSet` from the first level on (show()), so every
  // HUD feed, splash pass and console hook that reaches `level.vehicleDamage`
  // reaches the same object the world steps.
  level.vehicleDamage = new VehicleDamageSet();

  function dispose(root) {
    shading.disposeLightmaps();
    if (!root) return;
    root.traverse(obj => {
      obj.geometry?.dispose();
      for (const m of [obj.material].flat().filter(Boolean)) {
        m.map?.dispose();
        m.dispose();
      }
    });
    page.scene.remove(root);
  }

  function advanceSim(dt) {
    level.simTime += dt;
    if (level.flagMixer) level.flagMixer.update(dt);
    sky.advanceSky();
  }

  // --- engine audio -----------------------------------------------------------
  //
  // Every occupied hull's own engine and guns, played from the `.ssc` the
  // extractor shipped in `scene.json`. `engine-audio.js` owns the graph and the
  // curve evaluation, `vehicle-audio.js` owns the rack — one entry per vehicle,
  // claimed by the seats occupied on it — and everything here is the seam:
  // which hull is claimed when someone boards, what the control channels are
  // worth this frame, and the lifecycle rules the ambient path already
  // established (nothing starts inside an async gap, nothing survives a map
  // change).
  //
  // The FPOV assumption is gone. A bot in the driver's seat of a Sherman is a
  // claimed hull like the player's own: its Engine `.ssc` runs off its own
  // `state.throttle`, its guns gate on the groups its crew fires, and the
  // listener is the camera wherever it is. Two Shermans are two notes; a
  // driver and a hull gunner in one Sherman are one.

  level.currentDir = '';

  // The ammo/heat bookkeeping this track's `FireState` needs is spliced onto
  // `guns.onShot` in hand-weapon.js (search `chainOnShot(page.guns,` — right
  // after the hand weapon's own `guns.onShot = ...` assignment), not here: a
  // plain reassignment there would otherwise clobber whatever a `chainOnShot`
  // called this early had already wrapped, silently dropping every manned-gun
  // shot's ammo/heat update. See that call site's own comment.

  // What the `?shots` hook `__warmup` waits on: the level's warm-up (show()) and
  // the weapon in hand's (loadHandWeapon), plus the clock readings a check needs
  // to say how long the level's took. Neither promise gates anything the page
  // itself does.
  const warmups = { level: Promise.resolve(null), rig: Promise.resolve(), timing: {} };

  /** Wake's (or any level's) `SupplyDepot` nodes, world position resolved
   *  through the scene graph — a depot is usually parented under a `Bundle`
   *  (`extract_map.py`'s own placement) and does not carry its own world
   *  translation, only the chain above it does. Run once per level load, from
   *  `onFoot` (below), never per frame. */
  function collectSupplyDepots(root) {
    const depots = [];
    if (!root) return depots;
    const pos = new THREE.Vector3();
    root.traverse(obj => {
      const data = obj.userData?.supply;
      if (!data || obj.userData.templateKind !== 'SupplyDepot') return;
      obj.updateWorldMatrix(true, false);
      obj.getWorldPosition(pos);
      depots.push(new SupplyDepot({ x: pos.x, y: pos.y, z: pos.z }, data, obj.name));
    });
    return depots;
  }

  function wireframe(on) {
    if (!level.currentRoot) return;
    level.currentRoot.traverse(obj => {
      if (!obj.isMesh || isCollision(obj)) return;
      for (const m of [obj.material].flat()) m.wireframe = on;
    });
  }

  // LoadingManager counters are cumulative for the life of the page and never
  // reset, so a per-load view has to be taken against a baseline captured when
  // that load starts.
  const tex = { total: 0, loaded: 0, baseTotal: 0, baseLoaded: 0, load: null };

  function texReport() {
    if (!tex.load) return;
    const total = tex.total - tex.baseTotal;
    const done = tex.loaded - tex.baseLoaded;
    tex.load.count('textures', done, total);
    if (total > 0 && done >= total) {
      tex.load.end();
      tex.load = null;
    }
  }

  page.texManager.onStart = (url, loaded, total) => {
    tex.loaded = loaded;
    tex.total = total;
    texReport();
  };
  page.texManager.onProgress = (url, loaded, total) => {
    tex.loaded = loaded;
    tex.total = total;
    texReport();
  };
  // Loose textures — lightmap atlases, the terrain detail map, sky and water —
  // can land after show() has warmed the level. Each drained queue puts what
  // arrived on the GPU there and then, between frames, so the frame that first
  // binds one is not also its upload (rule 6).
  const textureQueueWaiters = [];
  page.texManager.onLoad = () => {
    warm.uploadTextures(page.scene);
    for (const resolve of textureQueueWaiters.splice(0)) resolve();
  };
  function textureQueueDrained() {
    return tex.loaded >= tex.total
      ? Promise.resolve()
      : new Promise(resolve => textureQueueWaiters.push(resolve));
  }

  async function show(entry) {
    level.worldReady = false;
    page.syncDeployReady();
    const timing = warmups.timing = { showStart: performance.now() };
    let settleLevelWarmup;
    warmups.level = new Promise(resolve => { settleLevelWarmup = resolve; });
    const loading = entry.loading || {};
    const load = page.overlay.begin(entry.name, {
      title: loading.title,
      background: loading.background,
      music: loading.music,
      theme: loading.theme,
      assetBase: page.MAPS_BASE,
    });
    load.step('report', { label: 'level report', weight: 1 });
    // Weighted by what the bytes actually are: one ~70 MB scene against a couple
    // of MB of loose textures and a 2 KB report.
    load.step('scene', { label: 'scene geometry', weight: 88 });
    load.step('textures', { label: 'textures', weight: 11 });
    // The last level's briefing must not survive into this one's load screen;
    // the report below puts this level's own text up when it lands.
    load.briefing(null);
    tex.baseTotal = tex.total;
    tex.baseLoaded = tex.loaded;
    tex.load = load;

    let report;
    let gltf;
    try {
      report = await fetch(`${page.MAPS_BASE}/${entry.report}${page.bust()}`).then(r => r.json());
      // The mission-briefing text rides in the report's `game` layer
      // (`scene.json` top-level `briefing`, from Menu/Init.con). Shown while
      // the geometry streams; absent on a report written before it.
      load.briefing(report.briefing);
      load.finish('report');
      gltf = await page.loader.loadAsync(
        `${page.MAPS_BASE}/${entry.glb}${page.bust()}`,
        e => load.bytes('scene', e.loaded, e.lengthComputable ? e.total : 0),
      );
      load.finish('scene');
    } catch (error) {
      if (tex.load === load) tex.load = null;
      load.fail(`could not load ${entry.name}: ${error.message}`);
      settleLevelWarmup(null);
      throw error;
    }
    // `?mode=` picks one of the level's gameplay layers; with no parameter this
    // resolves to the default layer, whose arrays are the top-level ones, so the
    // page is unchanged. A report from before `modes` existed passes straight
    // through. See `viewer/game-modes.js`.
    const wantedMode = page.params.get('mode');
    level.extras = selectGameMode(report, wantedMode);
    // A `?mode=` that did not land says so, and says it where a player can read
    // it: the dev panel is hidden for everyone but a developer, so the message
    // goes to the game's own console band as well (`logToConsole`, below, once
    // the level header has been written). Silence is the one wrong answer —
    // falling back to the default layer without a word is a page that looks
    // right and is showing something else.
    const modeIssue = modeProblem(report, wantedMode);
    level.modeNote = modeIssue
      ? (modeIssue === 'missing'
        ? `"${wantedMode}" is a game type ${report.level} offers but ships no `
          + `layer for; showing ${level.extras.gameplayMode}. `
          + `Has: ${modeNames(report).join(', ')}`
        : `no "${wantedMode}" layer on ${report.level}; `
          + `showing ${level.extras.gameplayMode}. Has: ${modeNames(report).join(', ')}`)
      : null;
    if (level.modeNote) console.warn(level.modeNote);
    // The bot side goes first: its bots, maps and door list are the old
    // level's, and the frames until `spawnBotsForLevel` below keep ticking the
    // referee -- against the new World once it is built.
    page.resetBots();
    // Before the old root is disposed: every gun is indexed off a node in it, and
    // the rounds in the air are clones of nodes it owns.
    // Every hull's seats go with the scene: nobody is carried across a level
    // switch, and the seat's view rig holds nodes of the old one.
    page.vehicles.clear();
    page.forgetSeatViews();
    // A level switch is not surgical, so the rounds in the air go back to their
    // pools here and every group goes with them.
    page.guns.clear();
    page.guns.groups.length = 0;
    dispose(level.currentRoot);
    sky.disposeSky();
    page.disposeSounds();
    level.currentRoot = gltf.scene;
    // The glb holds every mode's vehicles and flags; drop the ones this mode
    // does not park. Before anything indexes the scene, so the vehicle list, the
    // occupancy roots and the cull set never see them.
    pruneToMode(level.currentRoot, level.extras.gameplayMode);
    // Baked fire-effect payloads (muzzle flashes, projectile bodies, trail
    // quads) ride every assembled vehicle; only the model viewer animates
    // them, so here they must stay hidden or they render parked on the guns.
    //
    // `extras.propellerBlur` (see `_propeller_blur` in assemble.py) keeps both
    // the blade mesh and the blurred disc as real siblings, because the one
    // aircraft that should ever show the disc is the flown one — `applyRig` in
    // flight.js toggles it from live throttle. Every parked spawner here has no
    // throttle at all, so it gets the engine-off state the comment above already
    // establishes: blades visible, disc hidden.
    //
    // The stamp spells the authored child name; the scene document renames
    // every second instance (`MustangPropellerBlurred_1`), and an exact compare
    // left a parked second aircraft drawing blade and disc stacked. Same bare
    // name law as `bareFireArmsName` below.
    // `idleFirePose` is the same sweep this loop used to spell out inline, plus
    // the one payload it left out: `tracerMesh`, the baked streak template. It
    // is a real mesh parked on the barrel, and `GunFire.collect` hides it — so
    // it went dark the moment anybody climbed in and drew from the first frame
    // of the level on every gun nobody had touched yet. Fifteen of them on
    // Battle of Britain, four Spitfires and eleven Brownings.
    idleFirePose(level.currentRoot);
    level.currentRoot.traverse(obj => {
      const blur = obj.userData?.propellerBlur;
      if (blur) {
        const key = bareFireArmsName(blur.blurred);
        const blurred = obj.children.find(child => bareFireArmsName(child.name) === key);
        if (blurred) blurred.visible = false;
      }
    });
    page.scene.add(level.currentRoot);
    // The flags, and the level's always-on rotators — windmills, watermills,
    // radar dishes — which the extractor bakes as `ambient`/`ambient.N`.
    // `spin*` is deliberately NOT played: that is throttle-gated rotation, and
    // a parked aircraft's propeller is stationary in the game. The one aircraft
    // that should turn is the flown one, whose propeller `advancePropeller` in
    // flight.js already accumulates from its rate axes — playing the baked clip
    // here as well would drive it twice.
    level.flagMixer = null;
    const ambient = (gltf.animations || [])
      .filter(c => !/^spin(\.\d+)?$/.test(c.name))
      // The glb bakes a flag's cloth clip for every mode's pole, and
      // `pruneToMode` has just detached the ones this mode does not fly. A
      // track whose node has gone is a `THREE.PropertyBinding: No target node
      // found` warning per bone per frame's worth of setup — 88 of them on
      // Wake's Conquest layer alone — so the tracks are dropped here, the same
      // test three itself applies when it gives up on one.
      .map(clip => {
        const live = clip.tracks.filter(track => THREE.PropertyBinding.findNode(
          level.currentRoot, THREE.PropertyBinding.parseTrackName(track.name).nodeName));
        if (live.length === clip.tracks.length) return clip;
        if (!live.length) return null;
        const trimmed = clip.clone();
        trimmed.tracks = live;
        return trimmed;
      })
      .filter(Boolean);
    level.levelClips = ambient;
    if (ambient.length) {
      level.flagMixer = new THREE.AnimationMixer(level.currentRoot);
      for (const clip of ambient) {
        const action = level.flagMixer.clipAction(clip);
        // The engine gives each flag a random start phase so a row of them does
        // not beat in unison; `randomStartPitch` in `flag.ssc` does the same for
        // the sound. Without it five flags on one map flap as one object.
        action.time = Math.random() * clip.duration;
        action.play();
      }
    }
    const dir = entry.glb.replace(/\/[^/]+$/, '');
    level.currentDir = dir;
    shading.bindLightmaps(level.currentRoot, dir);
    shading.unlightTerrain(level.currentRoot);
    shading.bindTerrainDetail(level.currentRoot, dir);
    sky.setupSky(level.currentRoot, dir);
    // Before setupWater and bindDynamicShading: both read `levelEnvCube`.
    sky.setupEnvCube(dir);
    flare.setupLensFlare(dir);
    level.combatArea = null;
    // The world is the simulation core of frame() from here: built from the
    // level data in hand (the collider lands a few lines down via buildCollider,
    // the parked hulls via setupVehicleBodies), fed the local player's input
    // per frame, and stepped at the engine's fixed 30 Hz (world.js, the tick
    // law in its header). The page keeps the scene graph, the cameras, the HUD,
    // the audio, the deploy flow and the effects; the world owns nothing that
    // paints. `level.combatArea` and `level.vehicleDamage` below are aliases of
    // the world's instances, so every HUD feed, console hook and debug readout
    // that always reached them reaches them still.
    level.world = new World({
      extras: level.extras,
      guns: page.guns,
      groundHeight: terrain.groundHeight,
      fireStates: page.fireStates,
      onCrash: page.onCrashDamage,
      isWrecked: owner => {
        const visual = page.damageVisuals.get(owner);
        return !!(visual?.wrecked || visual?.removed);
      },
      // Per tick, with every piece of the tick final: every seat's world
      // position into its occupant's record (a rider senses from his seat, the
      // combat area finds a bare gun's gunner there), then the one snapshot per
      // tick render interpolation needs (the render-interpolation block, beside
      // `footLookPending`).
      onTick: () => {
        page.vehicles.publishSeatPositions(page.seatWorldPos);
        page.capturePresentationTick();
      },
    });
    // A fresh level: none of the old one's nodes or poses survive it.
    page.rebuildVehicleInterp();
    level.combatArea = level.world.combatArea;
    level.vehicleDamage = level.world.vehicleDamage;
    // Bot visuals: create the root group now that `scene` exists.
    page.ensureBotRoot();
    // Bots spawn on the player's team. The call waits for `buildCollider`
    // below: `spawnBotsForLevel` builds the nav grid from `world.collider` and
    // `pickSpawn` runs its spawn-safety probes against it, and both are empty
    // before the collider lands — which is what left the grid all `-2` (no
    // terrain) and every bot with no path.
    sky.setupWater(level.currentRoot, dir);
    page.setupSounds(level.extras, dir);
    page.loadMapArt(dir);
    // A map held open across a level switch would be showing the old level.
    page.toggleFullMap(false);
    page.fullmapName.textContent = level.extras.level || entry.name;
    const cps = (level.extras.controlPoints || []).length;
    page.fullmapMeta.textContent = cps
      ? `${cps} control point${cps === 1 ? '' : 's'} · ${(level.extras.soldierSpawns || []).length} spawns`
      : '';
    // After the baked paths and the sky/water shaders have claimed their
    // meshes, everything still on a lit glTF material is the engine's
    // fixed-function path: vehicles and non-lightmapped statics.
    shading.bindDynamicShading(level.currentRoot);
    shading.bindTextureFade(level.currentRoot);
    sky.applyLighting();
    if (level.extras.sunDirection) {
      // The sun light points along -sunLightDirectionVec toward the origin.
      page.sun.position.set(
        level.extras.sunDirection[0] * -400,
        level.extras.sunDirection[1] * 400,
        level.extras.sunDirection[2] * -400,
      );
    }
    // A ship's landing craft are spawned objects of their own in the engine.
    const craft = detachSpawnedCraft(level.currentRoot);
    if (craft.length) console.log(`[vehicles] ${craft.length} landing craft split from their ships`);
    statics.indexScene(level.currentRoot);
    terrain.collectTerrain(level.currentRoot);
    // Leaf sprites face the camera and each tree past its billboardDistance
    // becomes the engine's pre-rendered card (`tree-foliage.js`). After the
    // material passes above, which rebuild materials, and after `indexScene`
    // froze the statics.
    bindTreeFoliage(level.currentRoot, {
      scene: page.scene, mapsBase: page.MAPS_BASE, bust: page.bust, texLoader: page.texLoader,
      maxAnisotropy: page.renderer.capabilities.getMaxAnisotropy(),
    }).then(r => console.log(`trees: ${r.trees} placed, ${r.sprites} sprite parts, ${r.impostors} billboards`));
    // A fresh extract starts every pole in its authored colours; a capture
    // rewrites cloth UVs in place, so seed the cache the swap reads (the
    // geometry's own baked cell) before anything can take a point.
    level.currentRoot.traverse(obj => {
      if (obj.userData?.kind === 'flagCloth') {
        const uv = obj.geometry?.getAttribute('uv');
        if (uv && !obj.geometry.userData.flagUvCell) {
          obj.geometry.userData.flagUvCell = page.unitRectOf(uv);
        }
      }
    });
    // Both tables are small (damage.json 154 KB shared across every level,
    // materials.png a couple of KB) and both are needed before the first shot,
    // not before the first frame.
    // The level's baked search maps too (`pathfinding/`, under a megabyte a
    // level), which the bots' nav maps are taken from (`nav-baked.js`).
    const [terrainMaterials, damageTables, , searchMaps] = await Promise.all([
      terrain.loadTerrainMaterials(dir), terrain.loadDamageTables(dir), page.loadCollisionMeshes(dir),
      terrain.loadSearchMaps(dir),
    ]);
    if (level.extras) {
      Object.defineProperty(level.extras, 'bakedSearchMaps',
        { value: searchMaps, configurable: true, writable: true, enumerable: false });
    }
    terrain.setTables(terrainMaterials, damageTables);
    const collision = terrain.buildCollider(level.currentRoot);
    // After the collider: a body is keyed by the owner id the index handed out.
    page.setupVehicleBodies();
    // Now that the collider exists, spawn the bots so their nav grid and spawn
    // probes see it.
    page.spawnBotsForLevel();
    // A new level means a new scene graph (the hulls' instances went with the
    // old one, above), and so are every cached door.
    page.forgetSoldier();
    // A new level starts the flag choice over; without this the rebuilt select
    // would keep the old map's index through `buildSpawnFlags`.
    page.forgetFlagChoice();
    page.forgetEntryPoints();
    if (page.optPilot.checked) page.setPilot(true);
    // Joining is the spawn screen, not an instant teleport — clear a leftover
    // on-foot tick from the previous level so openDeploy owns the join.
    page.leaveOnFoot();
    sky.applyFar();
    if (!sky.skyRoot) await sky.loadSky(entry);
    sky.applyFog();
    page.placeCamera();
    wireframe(page.optWire.checked);
    statics.applyVisibility();
    // The fog is up, so the programs this links are the ones the frame wants.
    timing.warmStart = performance.now();
    Promise.resolve(page.loadEffectLibrary())
      .then(library => warm.warmLevel(library))
      .then(() => {
        timing.warmCompiled = performance.now();
        return textureQueueDrained();
      })
      .finally(() => {
        timing.warmResolved = performance.now();
        settleLevelWarmup(timing);
      });
    const t = level.extras.terrain || {};
    const o = level.extras.objects || {};
    // `objects` counts what the glb holds, and the glb holds every mode's
    // vehicles; what is standing in this level is what survived `pruneToMode`.
    const vehiclesHere = statics.spawnersRoot ? statics.spawnersRoot.children.length
                                      : (o.spawners || 0);
    document.getElementById('stats').innerHTML =
      `<strong>${level.extras.level || entry.name}</strong><br>` +
      `world ${level.extras.worldSize || '?'} m<br>` +
      `terrain ${t.triangles || 0} tris / ${t.tiles || 0} tiles` +
      (t.defaultTiles ? ` + ${t.defaultTiles} default` : '') +
      (t.detail ? ' + detail' : '') + `<br>` +
      `objects ${o.placed || 0} placed` +
      (vehiclesHere ? ` / ${vehiclesHere} vehicles` : '') +
      (o.lightmaps ? ` / ${o.lightmaps} lightmaps` : '') +
      (o.skipped?.length ? ` / ${o.skipped.length} skipped` : '') + `<br>` +
      `sky ${level.extras.sky ? level.extras.sky.mesh + (level.extras.sky.clouds ? ' + clouds' : '') :
          (level.extras.skybox ? 'env cubemap' : 'fog colour')} / ` +
      `water ${level.extras.water ? 'shader' : 'flat'}<br>` +
      // A level exported before the collision flip has a heightfield and a sea
      // and no hulls; saying so beats a silent half-working collider.
      `collision ${collision.statics
      ? `${collision.statics.count} tris` : 'hulls not exported'}` +
      (collision.heightfield
        ? ` / heightfield ${collision.heightfield.dim}^2 @ ${collision.heightfield.spacing} m`
        : ' / no heightfield') +
      (t.materials ? ` / ${Object.keys(t.materials.labels || {}).length} surfaces` : '');

    // The same facts into the console, because that is what a console is for:
    // the retail client fills `io::mainConsole` while it loads, which is why
    // the band in the user's capture is full-height on a session that had only
    // executed two lines. `getLines(20)` returns what the scrollback has, so a
    // console nobody has written to opens as a thin strip — in the game and
    // here alike.
    page.logToConsole(`level ${level.extras.level || entry.name} (${page.activeMod.id || 'bf1942'})`);
    page.logToConsole(`world ${level.extras.worldSize || '?'} m, ` +
                 `${t.triangles || 0} terrain tris over ${t.tiles || 0} tiles`);
    page.logToConsole(`${o.placed || 0} objects placed, ${vehiclesHere} vehicle spawners, ` +
                 `${o.lightmaps || 0} object lightmaps`);
    // The one line a player who typed a `?mode=` needs and would otherwise only
    // find in a browser console they never open.
    if (level.modeNote) page.logToConsole(level.modeNote);
    if (o.skipped?.length) page.logToConsole(`${o.skipped.length} objects skipped`);
    page.logToConsole(collision.statics
      ? `collision ${collision.statics.count} tris` + (collision.heightfield
          ? `, heightfield ${collision.heightfield.dim}^2 @ ${collision.heightfield.spacing} m`
          : ', no heightfield')
      : 'collision hulls not exported');

    // Geometry, collider and bindings are all up; only loose textures may still
    // be streaming, and the game deploys over those too.
    level.worldReady = true;
    timing.worldReady = performance.now();
    page.syncDeployReady();
    // Direct-to-spawn: skip the briefing dialog and land on the deploy screen.
    // A level that declares no soldier spawn has no screen to open, and with
    // the "click to fly" plate gone there would be nothing to tell the player
    // the controls are live — so free roam starts armed instead.
    if (!page.optPilot.checked && !page.openDeploy()) page.capture();

    // Every texture this level needs has been queued by now, so a queue that is
    // already drained (or was never filled) means the load is done — texReport
    // alone would sit waiting for a callback that is not coming.
    if (tex.total - tex.baseTotal <= tex.loaded - tex.baseLoaded) {
      load.end();
      if (tex.load === load) tex.load = null;
    } else {
      texReport();
    }
  }

  page.optGameFog.addEventListener('change', sky.applyFog);
  page.optWire.addEventListener('change', e => wireframe(e.target.checked));
  page.optVehicles.addEventListener('change', statics.applyVisibility);
  page.optEntire.addEventListener('change', () => {
    sky.applyFar();
    sky.applyFog();
    statics.applyVisibility();
  });

  Object.assign(level, {
    DEFAULT_SURFACE_FRICTION: terrain.DEFAULT_SURFACE_FRICTION,
    advanceSim,
    applyVisibility: statics.applyVisibility,
    bindDynamicShading: shading.bindDynamicShading,
    collectSupplyDepots,
    cull: statics.cull,
    deckNormal: terrain.deckNormal,
    flattenCull: statics.flattenCull,
    freezeVehicle: statics.freezeVehicle,
    getFloorAltitude: terrain.getFloorAltitude,
    groundHeight: terrain.groundHeight,
    isCollision,
    paintLensFlare: flare.paintLensFlare,
    show,
    surfaceFriction: terrain.surfaceFriction,
    tagCull: statics.tagCull,
    thaw: statics.thaw,
    thawVehicle: statics.thawVehicle,
    unlitCockpit: shading.unlitCockpit,
    updateSky: sky.updateSky,
    updateTextureFade: shading.updateTextureFade,
    vehicleSpawnActive: statics.vehicleSpawnActive,
    warmSubtree: warm.warmSubtree,
    warmups,
  });
  // What the rest of the page reads of the level's parts, read live.
  Object.defineProperties(level, {
    collider: { get: () => terrain.collider, enumerable: true },
    damageTables: { get: () => terrain.damageTables, enumerable: true },
    frozenCount: { get: () => statics.frozenCount, enumerable: true },
    mapVehicles: { get: () => statics.mapVehicles, enumerable: true },
    materialFrictionById: { get: () => terrain.materialFrictionById, enumerable: true },
    spawnersRoot: { get: () => statics.spawnersRoot, enumerable: true },
  });
  return level;
}
