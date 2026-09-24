// Loading the viewer's own modules under node, unmodified, and making every
// random draw in them come from one seeded stream.
//
// The viewer's modules are plain ES modules in a directory with no
// package.json, and `seats.js` (pulled in by `world.js`) imports the bare
// specifier `three`. `test_bot_ai.py` solves both by copying the module set
// into a temp dir with a `node_modules/three` shim; the runner instead
// registers a resolve hook that maps `three` onto `viewer/vendor/three.module.js`
// and a load hook that reads every viewer `.js` as a module. The modules are
// imported straight out of `viewer/`, so the runner always runs the code the
// page runs.
//
// Randomness: `bot.js` (`_extendRoute`'s search box), `bot-fire.js`
// (`firePlanFor`'s shot count), `bot-behaviours.js` (Scout's jitter) call
// `Math.random` directly, and `BotSenses` / `StrategicAI` default their
// `random` to it. Replacing `Math.random` with a seeded generator before any
// of them runs is what makes a match reproduce for a seed.

import { registerHooks } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { mulberry32 } from './rng.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The viewer directory the runner loads from: `--viewer`, else `../viewer`. */
export function viewerDir(override = null) {
  return path.resolve(override ?? path.join(HERE, '..', 'viewer'));
}

let hooked = null;

/** Map `three` to the vendored build and read viewer `.js` files as ESM. */
export function installModuleHooks(viewer) {
  if (hooked) {
    if (hooked !== viewer) throw new Error(`module hooks already installed for ${hooked}`);
    return;
  }
  hooked = viewer;
  const viewerUrl = pathToFileURL(viewer + path.sep).href;
  const threeUrl = pathToFileURL(path.join(viewer, 'vendor', 'three.module.js')).href;
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === 'three') return { url: threeUrl, format: 'module', shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.startsWith(viewerUrl) && url.endsWith('.js')) {
        const r = next(url, { ...context, format: 'module' });
        return { ...r, format: 'module' };
      }
      return next(url, context);
    },
  });
}

/** Replace `Math.random` with a seeded stream; returns the generator. */
export function seedMathRandom(seed) {
  const rng = mulberry32(seed);
  Math.random = rng;
  return rng;
}

/** Import every viewer module the match needs. */
export async function loadViewerModules(viewer) {
  installModuleHooks(viewer);
  const imp = (name) => import(pathToFileURL(path.join(viewer, name)).href);
  const [world, bot, nav, strategic, strength, armor, heightfield, staticIndex, drivable, collider,
    behaviours, vehicle, three, referee, projectileDamage] = await Promise.all([
    imp('world.js'), imp('bot.js'), imp('nav-grid.js'), imp('strategic.js'), imp('bot-strength.js'),
    imp('armor.js'), imp('heightfield.js'), imp('static-index.js'), imp('drivable-mask.js'),
    imp('world-collider.js'), imp('bot-behaviours.js'), imp('bot-vehicle.js'),
    imp('vendor/three.module.js'), imp('bot-referee.js'), imp('projectile-damage.js'),
  ]);
  return {
    World: world.World, WORLD_TICK_DT: world.WORLD_TICK_DT,
    BotController: bot.BotController, spawnBots: bot.spawnBots, BEHAVIOUR: bot.BEHAVIOUR,
    STANDARD_WEIGHTS: bot.STANDARD_WEIGHTS, URGENCY_CURVE: bot.URGENCY_CURVE,
    buildNavMap: nav.buildNavMap, isWalkable: nav.isWalkable, gridAt: nav.gridAt, CELL_FREE: nav.CELL_FREE,
    readSearchMaps: nav.readSearchMaps,
    StrategicLayer: strategic.StrategicLayer, StrategicAI: strategic.StrategicAI, SAI: strategic.SAI,
    parseDoctrineSpec: strategic.parseDoctrineSpec,
    EnemyStrengthTables: strength.EnemyStrengthTables,
    Armor: armor.Armor,
    Heightfield: heightfield.Heightfield, buildHeightfield: heightfield.buildHeightfield,
    buildCollisionIndex: staticIndex.buildCollisionIndex, buildDrivableMask: drivable.buildDrivableMask,
    WorldCollider: collider.WorldCollider,
    decleiningSlope: behaviours.decleiningSlope,
    TANK: vehicle.TANK,
    // The page's own bot referee (rounds, damage, respawn, capture, seating).
    createBotReferee: referee.createBotReferee,
    BOT_BODY_MATERIAL: referee.BOT_BODY_MATERIAL,
    // A round's falloff over the distance it flew (`Projectile::getDamage`).
    damageFactor: projectileDamage.damageFactor,
    THREE: three,
    mulberry32,
    loadGltfLoader: async () => (await imp('vendor/loaders/GLTFLoader.js')).GLTFLoader,
    // A real level's vehicle path (`stage.mjs`), loaded on demand.
    stage: null,
    loadStage: async function loadStage() {
      if (this.stage) return this.stage;
      const [instance, units, hulls, hits, wrecks, statics, terrain, entry, gunfire, aircraft, wheeled, tracked, ship, modes, seats] =
        await Promise.all([
          imp('vehicle-instance.js'), imp('bot-units.js'), imp('hull-bodies.js'), imp('vehicle-hits.js'),
          imp('vehicle-wrecks.js'), imp('level-statics.js'), imp('level-terrain.js'), imp('vehicle-entry.js'),
          imp('gunfire.js'), imp('aircraft.js'), imp('wheeled-vehicle.js'), imp('tracked-vehicle.js'), imp('ship.js'),
          imp('game-modes.js'), imp('seats.js'),
        ]);
      this.stage = {
        VehicleRegistry: instance.VehicleRegistry, createBotUnits: units.createBotUnits,
        createHullBodies: hulls.createHullBodies, createVehicleHits: hits.createVehicleHits,
        createVehicleWrecks: wrecks.createVehicleWrecks, createLevelStatics: statics.createLevelStatics,
        isCollision: statics.isCollision, createLevelTerrain: terrain.createLevelTerrain,
        createVehicleEntry: entry.createVehicleEntry, GunFire: gunfire.GunFire,
        // The drive classes map.html hands the registry, from their own modules.
        Aircraft: aircraft.Aircraft, GroundVehicle: wheeled.GroundVehicle, TrackedVehicle: tracked.TrackedVehicle,
        Ship: ship.Ship, selectGameMode: modes.selectGameMode, pruneToMode: modes.pruneToMode,
        detachSpawnedCraft: seats.detachSpawnedCraft, chainOnShot: seats.chainOnShot,
        findAllVehicleRoots: seats.findAllVehicleRoots,
      };
      return this.stage;
    },
  };
}

/** The viewer's `console.log` / `console.warn` lines ("[bots] vehicle nav
 *  map ...") go to stderr, and nowhere under `--quiet`: stdout is the
 *  runner's summary. */
export function routeConsole(quiet) {
  const write = (...args) => { if (!quiet) process.stderr.write(args.map(String).join(' ') + '\n'); };
  console.log = write;
  console.info = write;
  console.warn = write;
}
