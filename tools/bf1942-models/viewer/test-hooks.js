// The page's headless hooks (`?shots`): the `window.__*` functions the
// screenshot, perf and parity tooling drive the page through -- a sized
// deterministic frame (`__renderOnce`), the scene handles, the bots, the
// vehicles, the soldier, the HUD, the deploy screen. Lifted out of map.html
// (features/vehicle-instance-refactor Part 2); installed where the block sat,
// and only under `?shots`, as before.

import * as THREE from 'three';
import { installBotHooks } from './test-hooks-bots.js';
import { installVehicleHooks } from './test-hooks-vehicles.js';
import { installSoldierHooks } from './test-hooks-soldier.js';
import { installWorldHooks } from './test-hooks-world.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `activeAreaAudios`, `aimHeld`, `altFireDemolitions`, `ambientAudio`,
 * `announceCapture`, `applyDamageToPlayer`, `applyVehicleHit`,
 * `audioLimiter`, `audioListener`, `bfmap`, `bodyScene`, `bodyWorld`,
 * `botBodies`, `botUnits`, `camera`, `cancelDeploy`, `canopySpan`,
 * `captureVoiceDirs`, `captureVoiceKind`, `CHASE_OPTION`, `chaseRig`,
 * `chooseKit`, `chooseTeam`, `collectEntryPoints`, `collider`, `combatArea`, `comms`,
 * `combatFrame`, `crosshairAim`, `crosshairEl`, `currentDir`,
 * `cycleKitWeapon`, `damageVisuals`, `deployActive`, `deployKit`,
 * `deploySpawn`, `deployTeamId`, `deployUnchosen`, `detonatorTemplate`,
 * `effectAudio`, `effects`, `effectSoundsLoad`, `enterVehicle`,
 * `entryPoints`, `exitSeat`, `exitVehicle`, `explosivesTemplate`, `extras`,
 * `fireStateFor`, `flags`, `floatHosts`, `foot3pRel`, `footBody`,
 * `footCanopy`, `footView3p`, `forceHideFootBody`, `frame`,
 * `friendlyMapUnits`, `friendlyVehicleNodes`, `frozenCount`, `gameHud`,
 * `groundHeight`, `guns`, `handSlot`, `handWeapon`, `holdDeploy`, `hud`,
 * `isZoomed`, `itemsLocked`, `KBLOCK`, `KBLOCK_KEYS`, `kbLockState`,
 * `kbSession`, `keys`, `kitLoadout`, `KITS`, `kitWeaponSlots`,
 * `lastCaptureVoice`, `loadouts`, `loadoutsLoad`, `LOCAL_PLAYER`,
 * `localMapTeam`, `localPlayer`, `look`, `lookDelta`, `mannedActive`,
 * `mapGate`, `MINIMAP_TEAM_TINT`, `modeNote`, `mouseInput`, `nearEntry`,
 * `occupiedVehicleDamage`, `optOnFoot`, `packAmmo`, `packsLeft`,
 * `paintScoreboard`, `parachuteLog`, `params`, `playCaptureVoice`,
 * `pressTrigger`, `recordCrashes`, `referee`, `renderer`, `roomClient`,
 * `roomJoined`, `scene`, `scoreboardOpen`, `scoreboardPlayers`,
 * `scoreFromSpawn`, `scoreLayout`, `seatAltFire`, `seatFire`,
 * `seatIkChains`, `seatSoldier`, `selectDeployFlag`, `selectKitWeapon`,
 * `setAim`, `setFly`, `setMapGate`, `setScoreboard`, `setSeatTriggers`,
 * `shipFlagInactive`, `showDamageTier`, `showView`, `snapPresentation`,
 * `soldier`, `soldier3pOnFoot`, `soldierArmor`, `soldierDead`,
 * `soldierExposureFor`, `soldierTemplateFor`, `spawnersRoot`,
 * `spawnFlagSelect`, `splashPos`, `splashTargets`, `stage`,
 * `stepVehicleBodies`, `supplyField`, `supplyTarget`, `surfaceFriction`,
 * `switchSeat`, `thrownPackGroup`, `triggerHeld`, `vehicleAudio`,
 * `vehicleDamage`, `vehicleInput`, `vehicleSpawnActive`, `view`,
 * `viewmodelRigFor`, `vmCamera`, `vmRoot`, `vmScene`, `warmups`,
 * `weaponBarUntil`, `weaponTemplateFor`, `world`, `worldFire`,
 * `wreckVehicle`.
 */
export function installTestHooks(page) {
  const testHooks = {};

  if (page.params.has('shots')) {
    // Screenshot tooling in a hidden tab gets no requestAnimationFrame ticks
    // and reports a 0x0 window; let it force a sized, deterministic frame
    // before reading the canvas back.
    // `dt` is the frame time to simulate, under the animation loop's own 0.1 s
    // clamp: 1/15 is a 15 fps machine, whose every frame owes two world ticks.
    window.__renderOnce = (w = 1280, h = 800, dt = 1 / 60) => {
      page.renderer.setSize(w, h, false);
      page.camera.aspect = w / h;
      page.camera.updateProjectionMatrix();
      page.frame(Math.min(Math.max(dt, 0), 0.1));
      return true;
    };
    // Scene handles for offline inspection: isolating one shader term is the
    // only practical way to attribute an artefact to it.
    window.__scene = page.scene;
    window.__camera = page.camera;
    window.__renderer = page.renderer;
    window.__THREE = THREE;
    // Flight state for headless checks: the sim is deterministic under
    // __renderOnce, so a test can step it frame by frame and read the result.
    Object.defineProperty(window, '__aircraft', { get: () => page.localPlayer.aircraft });
    // The driven car, its dashboard numbers included, for the same reason.
    Object.defineProperty(window, '__car', { get: () => page.localPlayer.car });
    // The stick the world springs in its occupied-vehicle tick (world.js),
    // reported through the local player's record.
    Object.defineProperty(window, '__stick', {
      get: () => page.world?.player(page.LOCAL_PLAYER)?.stick ?? { roll: 0, pitch: 0 },
    });
    // Bot state for headless checks: one row per controller, with what the plan
    // chose and what the world last consumed. `__bots()` reads the same objects
    // the AI tick writes.
    window.__terrain = (x, z) => page.world?.collider?.surfaceHeight?.(x, z) ?? null;
    window.__worldExtras = () => ({ worldSize: page.world?.extras?.worldSize, water: page.world?.collider?.waterLevel });
    // The bot navigation map itself (nav-grid.js), for a headless check to
    // count or draw its cells.
    // The rest, by subject.
    installBotHooks(page);
    installVehicleHooks(page);
    installSoldierHooks(page);
    installWorldHooks(page);
    window.__look = page.look;
    // The view rig, which the mouse and the C key drive and a headless run cannot.
    // `__view.turn()` is the pilot's head in the cockpit — a Corsair's guns sit 40
    // degrees off the nose, so framing them means looking at them — and the orbit
    // outside it. `__setView(mode)` selects a mode without walking the cycle.
    Object.defineProperty(window, '__view', { get: () => page.view });
    // The external view's law as mounted: which law and frame `?chase=` chose,
    // the root's bounding radius, and the carried offset from the seat Camera.
    window.__chase = () => ({
      option: page.CHASE_OPTION, law: page.chaseRig.law, radius: page.chaseRig.radius,
      rel: [...page.chaseRig.rel], camera: page.chaseRig.camera?.name ?? null,
      active: !!page.view?.externalLaw,
    });
    window.__setView = mode => {
      if (!page.view) return null;
      const set = page.view.setMode(mode);
      page.showView(set);
      return set;
    };
    // Headless checks fly through the real input path rather than poking the
    // aircraft: add key codes to __keys and open the gate with __setFly(true).
    window.__keys = page.keys;
    window.__setFly = page.setFly;
    // Gun state, for headless checks. Muzzle world positions are what settles the
    // question the moving-vehicle port exists to answer: a tracer's position must
    // diverge from the muzzle it left, not travel with it.
    window.__effects = () => page.effects.stats();
    // The sound pool: budget, live sources, what was played, dropped, stolen or
    // ruled inaudible. A voice-count check reads this beside its own patched
    // `AudioBufferSourceNode.start` counter, and the two must agree.
    window.__effectAudio = () => (page.effectAudio.listener
      ? page.effectAudio.snapshot() : { loaded: false });
    window.__effectSoundsReady = async () => {
      await page.effectSoundsLoad;
      return page.effectAudio.listener ? page.effectAudio.bundles.size : 0;
    };
    // Decode a bundle's samples ahead of a check, so the first round is not the
    // silent one a cold pool gives.
    window.__primeEffectSound = name => page.effectAudio.prime(name);
    // Rule 6's resolve signal (features/mesh-viewer-performance): every warm-up
    // the page has started for this level and for the weapon in hand, awaited,
    // then show()'s clock readings. A check snapshots `renderer.info.programs`
    // after this and can then assert that play links nothing new.
    window.__warmup = async () => {
      await Promise.all([page.warmups.level, page.warmups.rig]);
      return { ...page.warmups.timing };
    };
    // Any bundle in the library, played at a point: a check has to reach every
    // impact, trail and explosion a level could ask for, not only the surfaces
    // one rifle can hit from one spawn. The looping ones (the trails) run until
    // stopped, so the handles are kept for `__stopEffects`.
    const playedEffects = [];
    window.__effectNames = () => page.effects.library?.names ?? [];
    window.__playEffect = (name, position, normal = [0, 1, 0]) => {
      const handle = page.effects.play(name, { position, normal });
      if (handle) playedEffects.push(handle);
      return !!handle;
    };
    window.__stopEffects = () => {
      for (const handle of playedEffects.splice(0)) handle.stop();
    };
    window.__getAudioState = () => ({
      audioListener: page.audioListener,
      // The master limiter, and how hard it is working right now: `reduction`
      // is the dB it is taking off the sum this instant, so a test can assert
      // that an idling engine is untouched and a cannon is only just caught.
      limiter: page.audioLimiter ? {
        threshold: page.audioLimiter.threshold.value,
        ratio: page.audioLimiter.ratio.value,
        reduction: page.audioLimiter.reduction,
      } : null,
      ambientAudio: page.ambientAudio,
      activeAreaAudios: page.activeAreaAudios,
      // Headless Chromium will not let anyone listen, so the engine crossfade has
      // to be asserted on the graph: per-layer gain and playback rate, and the
      // voice count, which is the number the hall-echo bug moved. One entry per
      // claimed hull — the player's own and every bot-driven one — so a test can
      // assert that a bot's Sherman is sounding at all.
      vehicles: page.vehicleAudio ? page.vehicleAudio.snapshot() : null,
      engine: page.vehicleAudio?.vehicles.size
        ? [...page.vehicleAudio.vehicles.values()].find(v => v.engineAudio)?.engineAudio?.snapshot() ?? null
        : null,
      // Bots' gunfire, pooled per weapon. `fallback: true` on a weapon means
      // the tree's `weapons.json` predates `layers` and is playing the
      // first-person pick under a stand-in Distance ramp.
      worldFire: page.worldFire ? page.worldFire.snapshot() : null,
    });
  }
  return testHooks;
}
