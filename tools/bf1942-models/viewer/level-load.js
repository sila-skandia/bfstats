// The level: its scene loaded and bound (terrain detail, lightmaps, the
// engine's own shading and texture fade, sky, clouds, water, fog and draw
// distance, lens flare), indexed and frozen for the matrix walk, its collider
// and material tables, its sounds and textures, the vehicles' bodies and
// damage sets, the world built on it, the bots spawned onto it -- `show()` --
// and the terrain queries every other part asks (`groundHeight`,
// `surfaceFriction`, `deckNormal`). Lifted out of map.html (features/
// vehicle-instance-refactor Part 2); the rest of the page takes `level`.

import * as THREE from 'three';
import { createLevelSky } from './level-sky.js';
import { createLevelFlare } from './level-flare.js';
import { createLevelShading } from './level-shading.js';
import { createLevelStatics, isCollision, kindOf } from './level-statics.js';
import { bareFireArmsName } from './vehicle-audio.js';
import { idleFirePose } from './idle-vehicle.js';
import { buildHeightfield, buildCollisionIndex, buildDrivableMask, WorldCollider } from './collision.js';
import { SupplyDepot } from './supply.js';
import { World } from './world.js';
import { modeNames, modeProblem, pruneToMode, selectGameMode } from './game-modes.js';
import { detachSpawnedCraft } from './seats.js';
import { bindTreeFoliage } from './tree-foliage.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `activeMod`, `botRoot`, `bust`, `camera`, `capture`,
 * `capturePresentationTick`, `combatArea`, `combatFrame`, `cubeLoader`,
 * `damageVisuals`, `DEFAULT_DRAW`, `disposeSounds`, `effects`,
 * `entryPoints`, `fireStates`, `floatPlacedVehicles`, `forgetSoldier`,
 * `fullmapMeta`, `fullmapName`, `guns`, `gunSubject`, `hemi`,
 * `loadCollisionMeshes`, `loadEffectLibrary`, `loader`, `loadMapArt`,
 * `logToConsole`, `MAPS_BASE`, `nearEntry`, `onCrashDamage`, `openDeploy`,
 * `optEntire`, `optGameFog`, `optOnFoot`, `optPilot`, `optVehicles`,
 * `optWire`, `overlay`, `params`, `placeCamera`, `rebaseDeckSpawns`,
 * `rebuildVehicleInterp`, `registerDamageables`, `renderer`, `scene`,
 * `seatWorldPos`, `setOnFoot`, `setPilot`, `settlePlacedVehicles`,
 * `setupSounds`, `setupVehicleBodies`, `spawnBotsForLevel`,
 * `spawnFlagSelect`, `sun`, `syncDeployReady`, `templateNameOf`,
 * `texLoader`, `texManager`, `toggleFullMap`, `unitRectOf`, `vehicleDamage`,
 * `vehicles`, `view`, `viewFor`, `vmScene`, `world`.
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
    get world() { return page.world; },
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
  // What `?mode=` could not give this level, for the console band. Null
  // whenever the URL got exactly what it asked for, which is every load
  // with no `?mode=` at all.
  level.modeNote = null;

  /**
   * Ground height under a world (x, z).
   *
   * One answer for the camera clamp, the flown aircraft, the view rig and every
   * round in the air (gap C-5): `collision.js` rebuilds the level's own height
   * lattice from the terrain tiles at load, and a bilinear sample off that is
   * both exact — it is the grid the engine collides against — and some three
   * orders cheaper than the raycast this used to be, which mattered the moment
   * a burst of tracers started asking sixty times a second.
   *
   * The raycast stays as the fallback for a level whose lattice would not
   * rebuild (a mod with an irregular terrain export); `collider` is null then.
   *
   * `fromY` is the driven-vehicle opt-in and nothing else passes it: with a
   * reference height the answer also includes a drivable deck at or below it (a
   * bridge span, a repair bay's apron), so a tank's wheels ride the deck while a
   * soldier, a plane's ground check, a boat and the cameras keep seeing terrain
   * and sea alone. See `WorldCollider.surfaceHeight`.
   */
  const groundRay = new THREE.Raycaster();
  const DOWN = new THREE.Vector3(0, -1, 0);
  const rayOrigin = new THREE.Vector3();
  level.terrainMeshes = [];
  const terrainBBox = new THREE.Box3();
  level.collider = null;

  function groundHeight(x, z, fromY) {
    const sea = level.extras?.waterLevel ?? -Infinity;
    if (level.collider) {
      const h = level.collider.surfaceHeight(x, z, fromY);
      if (Number.isFinite(h)) return h;
    }
    if (!level.terrainMeshes.length) return sea;
    rayOrigin.set(x, 2000, z);
    groundRay.set(rayOrigin, DOWN);
    groundRay.far = 4000;
    const hit = groundRay.intersectObjects(level.terrainMeshes, false)[0];
    return hit ? Math.max(hit.point.y, sea) : sea;
  }

  /**
   * `MaterialManager.materialFriction` of the ground at a world (x, z) — what
   * `ground.js` spends its Coulomb budget out of (PHY-2).
   *
   * Both halves already existed and were never joined up: the heightfield
   * carries the level's own per-sample material id out of `terrain/materials.png`
   * (the projectile impact path has been reading it for a while), and
   * `damage.json`'s materials table now carries `materialFriction` beside
   * `materialDamage`. This is the whole of the join.
   *
   * Below the water line the answer is water's 0.1 regardless of what the
   * material map says the bed is made of, because that is the material the
   * engine's own terrain pass hands a submerged contact.
   *
   * Fallback is `DEFAULT_MATERIAL_FRICTION`: a level with no material map, a
   * mod with no `Game.rfa`, or an id the define file never mentions all resolve
   * to material 0, which vanilla authors at 1.0.
   */
  // `surfaceFriction` runs once per wheel per sub-step — up to sixteen times a
  // tick for a half-track — so it walks a flat numeric array rather than
  // re-deriving a string key and two property lookups each time. The array is
  // built once per level, when the tables land.
  level.materialFrictionById = null;

  function buildMaterialFrictionTable(tables) {
    const materials = tables?.materials;
    if (!materials) return null;
    let top = -1;
    for (const key of Object.keys(materials)) {
      const id = Number(key);
      if (Number.isInteger(id) && id >= 0 && id > top) top = id;
    }
    if (top < 0) return null;
    const out = new Float64Array(top + 1).fill(DEFAULT_SURFACE_FRICTION);
    for (const [key, entry] of Object.entries(materials)) {
      const id = Number(key);
      if (!Number.isInteger(id) || id < 0) continue;
      if (typeof entry?.friction === 'number') out[id] = entry.friction;
    }
    return out;
  }

  const DEFAULT_SURFACE_FRICTION = 1.0;

  function surfaceFriction(x, z, fromY) {
    const table = level.materialFrictionById;
    if (!table) return DEFAULT_SURFACE_FRICTION;
    const sea = level.extras?.waterLevel;
    // A wheel on a drivable deck spends the DECK's material, not the riverbed's
    // under it. `fromY` is the same vehicle opt-in `groundHeight` takes, so this
    // costs one extra deck ray per wheel and only while actually on a deck — and
    // without it a tank crossing a bridge over water was gripping at water's 0.1
    // because the surface it was standing on read as being at the sea line.
    const deck = fromY !== undefined ? level.collider?.deckSurface?.(x, z, fromY) : null;
    let id = deck ? deck.material : level.collider?.heightfield?.material(x, z);
    if (!deck && Number.isFinite(sea) && groundHeight(x, z, fromY) <= sea) id = 1;
    if (!Number.isInteger(id) || id < 0 || id >= table.length) {
      return DEFAULT_SURFACE_FRICTION;
    }
    return table[id];
  }

  /**
   * The contact normal of a drivable deck under (x, z), when a deck is what the
   * wheel there is standing on: `ground.js` takes the deck triangle's own normal
   * rather than a finite difference of the height, so a tank pitches up the repair
   * bay's incline and levels on its pad. False elsewhere, and the vehicle then
   * uses the heightfield gradient it has always used.
   */
  function deckNormal(x, z, fromY, out) {
    return level.collider?.deckNormal ? level.collider.deckNormal(x, z, fromY, out) : false;
  }

  function collectTerrain(root) {
    level.terrainMeshes = [];
    terrainBBox.makeEmpty();
    root.traverse(obj => {
      if (obj.isMesh && kindOf(obj) === 'terrain') {
        level.terrainMeshes.push(obj);
        if (obj.geometry) {
          if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
          terrainBBox.union(obj.geometry.boundingBox);
        }
      }
    });
  }

  function getFloorAltitude(x, z) {
    const gh = groundHeight(x, z);
    if (Number.isFinite(gh) && gh > -1000) return gh + 1.5;
    if (Number.isFinite(terrainBBox.min.y) && terrainBBox.min.y > -1000) {
      const base = Number.isFinite(level.extras?.waterLevel) ? Math.max(terrainBBox.min.y, level.extras.waterLevel) : terrainBBox.min.y;
      return base + 1.5;
    }
    if (Number.isFinite(level.extras?.waterLevel)) return level.extras.waterLevel + 1.5;
    return -50;
  }

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

  // --- what the rounds run into ----------------------------------------------
  //
  // Gaps C-1, C-5, C-6 and M-2 of `parity-audit/projectiles-collision.md`, all
  // behind one object. `collision.js` owns the arithmetic; this is the wiring.
  //
  // Three inputs, all already shipped and none of them new:
  //   - the terrain tiles in the scene, snapped back onto the level's own height
  //     lattice (4 m on every vanilla map);
  //   - `waterLevel` out of `scene.json`, one horizontal plane;
  //   - every node the assembler tagged `extras.collision`, which the map export
  //     now carries (Wake 20,911 triangles, Bocage 21,661) and which `indexScene`
  //     already hides from the render pass.
  //
  // Plus two tables that decide what a hit *means* rather than where it is:
  // `terrain/materials.png` (one byte per heightmap sample, straight out of
  // `Materialmap.raw`) and `_shared/damage.json`'s `effects` matrix.
  level.terrainMaterials = null;
  level.damageTables = null;

  async function loadDamageTables(dir) {
    const ref = level.extras?.damage;
    if (!ref?.path) return null;
    try {
      return await fetch(`${page.MAPS_BASE}/${dir}/${ref.path}${page.bust()}`)
        .then(r => r.ok ? r.json() : null);
    } catch { return null; }
  }

  /**
   * `terrain/materials.png` back into the byte array it was written from.
   *
   * The exporter puts the raw id in all three colour channels so the file is
   * legible to a human; only red is read here, and nothing is filtered — a
   * bilinear read between id 10 (dry sand) and id 12 (rock) would invent id 11.
   */
  async function loadTerrainMaterials(dir) {
    const spec = level.extras?.terrain?.materials;
    if (!spec?.image) return null;
    try {
      const blob = await fetch(`${page.MAPS_BASE}/${dir}/${spec.image}${page.bust()}`)
        .then(r => r.ok ? r.blob() : null);
      if (!blob) return null;
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      const ids = new Uint8Array(bitmap.width * bitmap.height);
      for (let i = 0; i < ids.length; i++) ids[i] = rgba[i * 4];
      return { ids, dim: bitmap.width, spacing: spec.spacing || 0 };
    } catch { return null; }
  }

  /** Rebuild the collider for the level now in `currentRoot`. */
  function buildCollider(root) {
    const worldSize = level.extras?.worldSize || 0;
    const heightfield = buildHeightfield(level.terrainMeshes, {
      worldSize,
      dim: level.extras?.terrain?.materials?.dim || 0,
    });
    if (heightfield && level.terrainMaterials) {
      heightfield.setMaterials(level.terrainMaterials.ids, level.terrainMaterials.dim,
                               level.terrainMaterials.spacing || heightfield.spacing);
    }
    // One owner per placed object, and one per spawned vehicle rather than one
    // for the whole spawner group — otherwise a Sherman's round would pass
    // through the Willy parked next to it.
    const ownerRoots = [];
    for (const child of root.children) {
      if (child === level.spawnersRoot) ownerRoots.push(...child.children);
      else ownerRoots.push(child);
    }
    // Before the index: it bakes every hull where it stands, so the vehicles
    // have to be standing where they will rest. A ship rests at its own draft,
    // which is a closed form rather than a settle, and its deck spawns move with
    // it.
    page.settlePlacedVehicles(ownerRoots, heightfield);
    page.floatPlacedVehicles(ownerRoots, level.extras?.waterLevel);
    page.rebaseDeckSpawns();
    const statics = buildCollisionIndex(root, { ownerRoots });
    // Every damageable thing in the level, keyed by the same owner id the
    // collision index just handed out — which is what a hit record names, so a
    // round that lands resolves to the vehicle it landed on with one lookup and
    // no scene walk. `ownerRoots[i]` is owner `i` by construction.
    page.registerDamageables(ownerRoots);
    // Raised decks a ground vehicle drives on top of (bridges, repair/reload
    // bays). The level's heightfield is the ground under them; their deck tops
    // are static collision meshes. This is only the broadphase gate — the ride
    // surface itself comes out of `WorldCollider.deckHeight`, a ray against the
    // deck's own triangles, so an incline is an incline and not a raster step.
    const drivableMask = buildDrivableMask(root);
    level.collider = (heightfield || statics || Number.isFinite(level.extras?.waterLevel))
      ? new WorldCollider({ heightfield, statics, waterLevel: level.extras?.waterLevel,
                            drivableMask })
      : null;
    page.world.setCollider(level.collider);
    page.world.damageTables = level.damageTables;
    page.guns.collider = level.collider;
    page.guns.damageEffects = level.damageTables?.effects || null;
    page.guns.projectileMaterials = level.damageTables?.projectiles || null;
    page.guns.materials = level.damageTables?.materials || null;
    // The `damageMod` matrix. Without it a round's damage is only its material's
    // base times the distance falloff, which is the same number for a rifle
    // shooting a Tiger as for a Panzerfaust — the modifier is the whole reason
    // small arms do not kill armour.
    page.guns.modifiers = level.damageTables?.modifiers || null;
    // Pools and all: a mesh particle's materials are built under the level's
    // lighting, and show() warms a fresh set once this level's fog is up.
    page.effects.flush();
    page.loadEffectLibrary();
    return { heightfield, statics };
  }

  // Rule 6's warm-up (features/mesh-viewer-performance): nothing play can draw
  // is linked, uploaded or first used by the frame that draws it. Three links
  // a material's program on the first frame that draws it, uploads a texture on
  // the first frame that binds it and builds a skinned mesh's bone texture on
  // its first draw, and the link blocks that frame on the driver: on this Iris
  // Xe's system GL the perf harness watched one block for 8-9.5 s and take the
  // WebGL context with it.
  //
  // A subtree is compiled against the scene and camera of the pass that draws
  // it — the canvas (no render target), that scene's fog and lights: all a
  // program key reads that the material and the object do not — then every
  // texture its materials can bind goes to the GPU, and every program the
  // compile linked has its first use taken (`WebGLProgram.getUniforms`: the log
  // and uniform queries three otherwise runs inside the first draw, and the
  // point where a link still in flight would block). `compile` walks hidden
  // nodes too, so a pooled particle or a parked gun's flash is warmed like a
  // wall.

  /** Put `texture` on the GPU if its pixels have arrived; a no-op before. */
  function uploadTexture(texture) {
    if (!texture?.isTexture || texture.version === 0) return;
    page.renderer.initTexture(texture);
  }

  /** Every texture `root` can draw with: the material's slots, a shader's
   *  uniforms and the renderer's copy of them (where the ones `onBeforeCompile`
   *  adds live, once compiled), and each skinned mesh's bone texture, built
   *  here rather than on its first draw (`WebGLRenderer.setProgram`). */
  function uploadTextures(root) {
    root.traverse(obj => {
      if (obj.isSkinnedMesh && obj.skeleton) {
        if (!obj.skeleton.boneTexture) obj.skeleton.computeBoneTexture();
        uploadTexture(obj.skeleton.boneTexture);
      }
      for (const m of [obj.material].flat()) {
        if (!m) continue;
        for (const value of Object.values(m)) uploadTexture(value);
        for (const uniform of Object.values(m.uniforms ?? {})) uploadTexture(uniform?.value);
        const compiled = page.renderer.properties.get(m).uniforms;
        for (const uniform of Object.values(compiled ?? {})) uploadTexture(uniform?.value);
      }
    });
    // A scene's own two textures hang off no material: the skybox cube three
    // draws the background with, and an environment map.
    if (root.isScene) {
      uploadTexture(root.background);
      uploadTexture(root.environment);
    }
  }

  /** Compile `root` for the pass that draws it, upload its textures and take
   *  the first use of every program the compile linked. The programs are taken
   *  as the compile returns, before anything swaps a material out from under
   *  them: `GunFire.collect` clones a rig's flash materials right after the
   *  rig's compile starts, and the clones reuse these programs by key. */
  function warmSubtree(root, cam = page.camera, target = page.scene) {
    const compiled = page.renderer.compileAsync(root, cam, target);
    const programs = new Set();
    root.traverse(obj => {
      for (const m of [obj.material].flat()) {
        const linked = m && page.renderer.properties.get(m).programs;
        if (linked) for (const program of linked.values()) programs.add(program);
      }
    });
    return compiled.catch(() => {}).then(() => {
      uploadTextures(root);
      // A program released since (its last material disposed) has no GL
      // program left to ask.
      for (const program of programs) if (program.program) program.getUniforms();
    });
  }

  /** The level's warm-up, after applyFog() so the programs are the fogged ones
   *  the frame asks for, and again on every level switch. The effect pool and
   *  the gun stand-ins are built first; then the whole scene — terrain,
   *  statics, the level's LOD interiors and flags, parked vehicles and their
   *  hidden gun payloads, sky, water, the effect pool — is warmed for the main
   *  pass. */
  function warmLevel(library) {
    if (library) page.effects.warm();
    const stand = page.guns.warm();
    return Promise.all([warmSubtree(page.scene), warmSubtree(stand)]);
  }
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
    uploadTextures(page.scene);
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
    tex.baseTotal = tex.total;
    tex.baseLoaded = tex.loaded;
    tex.load = load;

    let report;
    let gltf;
    try {
      report = await fetch(`${page.MAPS_BASE}/${entry.report}${page.bust()}`).then(r => r.json());
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
    // Before the old root is disposed: every gun is indexed off a node in it, and
    // the rounds in the air are clones of nodes it owns.
    // Every hull's seats go with the scene: nobody is carried across a level
    // switch, and the seat's view rig holds nodes of the old one.
    page.vehicles.clear();
    page.view = null;
    page.viewFor = null;
    page.gunSubject = null;
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
    page.combatArea = null;
    page.combatFrame = null;
    // The world is the simulation core of frame() from here: built from the
    // level data in hand (the collider lands a few lines down via buildCollider,
    // the parked hulls via setupVehicleBodies), fed the local player's input
    // per frame, and stepped at the engine's fixed 30 Hz (world.js, the tick
    // law in its header). The page keeps the scene graph, the cameras, the HUD,
    // the audio, the deploy flow and the effects; the world owns nothing that
    // paints. `combatArea`, `bodyWorld`, `vehicleDamage` and `supplyField`
    // below stay page-side aliases of the world's instances, so every HUD feed,
    // console hook and debug readout that always reached them reaches them
    // still.
    page.world = new World({
      extras: level.extras,
      guns: page.guns,
      groundHeight,
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
    page.combatArea = page.world.combatArea;
    page.vehicleDamage = page.world.vehicleDamage;
    // Bot visuals: create the root group now that `scene` exists.
    if (!page.botRoot) {
      page.botRoot = new THREE.Group();
      page.botRoot.name = 'bot-renderers';
      page.scene.add(page.botRoot);
    }
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
    collectTerrain(level.currentRoot);
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
    [level.terrainMaterials, level.damageTables] = await Promise.all([
      loadTerrainMaterials(dir), loadDamageTables(dir), page.loadCollisionMeshes(dir),
    ]);
    level.materialFrictionById = buildMaterialFrictionTable(level.damageTables);
    const collision = buildCollider(level.currentRoot);
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
    page.spawnFlagSelect.selectedIndex = -1;
    page.entryPoints = null;
    page.nearEntry = null;
    if (page.optPilot.checked) page.setPilot(true);
    // Joining is the spawn screen, not an instant teleport — clear a leftover
    // on-foot tick from the previous level so openDeploy owns the join.
    if (page.optOnFoot.checked) {
      page.optOnFoot.checked = false;
      page.setOnFoot(false);
    }
    sky.applyFar();
    if (!sky.skyRoot) await sky.loadSky(entry);
    sky.applyFog();
    page.placeCamera();
    wireframe(page.optWire.checked);
    statics.applyVisibility();
    // The fog is up, so the programs this links are the ones the frame wants.
    timing.warmStart = performance.now();
    Promise.resolve(page.loadEffectLibrary())
      .then(library => warmLevel(library))
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
    DEFAULT_SURFACE_FRICTION,
    advanceSim,
    applyVisibility: statics.applyVisibility,
    bindDynamicShading: shading.bindDynamicShading,
    collectSupplyDepots,
    cull: statics.cull,
    deckNormal,
    flattenCull: statics.flattenCull,
    freezeVehicle: statics.freezeVehicle,
    getFloorAltitude,
    groundHeight,
    isCollision,
    paintLensFlare: flare.paintLensFlare,
    show,
    surfaceFriction,
    tagCull: statics.tagCull,
    thaw: statics.thaw,
    thawVehicle: statics.thawVehicle,
    unlitCockpit: shading.unlitCockpit,
    updateSky: sky.updateSky,
    updateTextureFade: shading.updateTextureFade,
    vehicleSpawnActive: statics.vehicleSpawnActive,
    warmSubtree,
    warmups,
  });
  // What the rest of the page reads of the level's parts, read live.
  Object.defineProperties(level, {
    frozenCount: { get: () => statics.frozenCount, enumerable: true },
    mapVehicles: { get: () => statics.mapVehicles, enumerable: true },
    spawnersRoot: { get: () => statics.spawnersRoot, enumerable: true },
  });
  return level;
}
