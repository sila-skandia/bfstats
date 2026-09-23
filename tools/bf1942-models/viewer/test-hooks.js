// The page's headless hooks (`?shots`): the `window.__*` functions the
// screenshot, perf and parity tooling drive the page through -- a sized
// deterministic frame (`__renderOnce`), the scene handles, the bots, the
// vehicles, the soldier, the HUD, the deploy screen. Lifted out of map.html
// (features/vehicle-instance-refactor Part 2); installed where the block sat,
// and only under `?shots`, as before.

import * as THREE from 'three';
import { equilibriumRootY, floatNodesOf } from './body-float.js';
import { ikTarget } from './seat-ik.js';
import { combatAreaRect } from './combat-area.js';
import { modeNames } from './game-modes.js';
import { boardRows } from './scoreboard.js';
import { findPath, gridAt } from './nav-grid.js';

/**
 * Built once by the page, where this code used to sit. `page` hands in
 * what it reads of the rest of the page, as getters (a binding the page
 * reassigns is read live):
 * `activeAreaAudios`, `aimHeld`, `altFireDemolitions`, `ambientAudio`,
 * `announceCapture`, `applyDamageToPlayer`, `applyVehicleHit`,
 * `audioLimiter`, `audioListener`, `bfmap`, `bodyScene`, `bodyWorld`,
 * `botBodies`, `botUnits`, `camera`, `cancelDeploy`, `canopySpan`,
 * `captureVoiceDirs`, `captureVoiceKind`, `CHASE_OPTION`, `chaseRig`,
 * `chooseKit`, `chooseTeam`, `collectEntryPoints`, `collider`, `combatArea`,
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
 * `vehicleDamage`, `vehicleInput`, `vehicleSpawnActive`, `viewmodelRigFor`,
 * `vmCamera`, `vmRoot`, `vmScene`, `warmups`, `weaponBarUntil`,
 * `weaponTemplateFor`, `world`, `worldFire`, `wreckVehicle`.
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
    window.__botCtl = id => page.referee.bots.find(b => b.playerId === id) ?? null;
    window.__botVehicleDebug = () => {
      if (!page.entryPoints) page.collectEntryPoints();
      const roots = [...new Set((page.entryPoints ?? []).map(e => e.vehicle))];
      return {
        aiLoaded: page.botUnits.ai?.size ?? null, entries: page.entryPoints?.length ?? null, roots: roots.length,
        sample: roots.slice(0, 12).map(n => ({ name: n.name, template: n.userData?.template ?? null, control: n.userData?.control ?? null,
          kind: page.botUnits.kindOf(n), active: page.vehicleSpawnActive(n), ai: page.botUnits.aiOf(n)?.name ?? null })),
      };
    };
    window.__botVehicles = () => page.botUnits.candidates().map(c => ({ template: c.template, seat: c.seatId, root: c.isRoot, kind: c.kind, pos: c.pos.map(v => +v.toFixed(0)), entry: c.entry.map(v => +v.toFixed(0)), r: c.entryRadius, health: c.health, maxSpeed: c.maxSpeed, occupiedBy: c.occupiedBy, driver: c.driver, upright: c.upright, strengths: c.strengths, value: c.value }));
    window.__botMount = (id, template = null, seat = 'driver') => {
      const bot = page.referee.bots.find(b => b.playerId === id);
      const cands = page.botUnits.candidates().filter(c => !c.occupiedBy && (!template || c.template === template)
        && (seat === 'any' || (seat === 'driver' ? c.isRoot : c.seatId === seat)));
      if (!bot || !cands.length) return false;
      const p = bot.getPosition();
      cands.sort((a, b) => Math.hypot(a.pos[0] - p[0], a.pos[2] - p[2]) - Math.hypot(b.pos[0] - p[0], b.pos[2] - p[2]));
      return page.referee.enterVehicle(bot, cands[0]);
    };
    window.__botDismount = id => { const bot = page.referee.bots.find(b => b.playerId === id); if (bot?.vehicle) page.referee.leaveVehicle(bot); return !bot?.vehicle; };
    window.__navMap = () => page.referee.navGrid;
    window.__navProbe = (fx, fz, tx, tz) => {
      if (!page.referee.navGrid) return null;
      const path = findPath(page.referee.navGrid, fx, fz, tx, tz);
      return {
        startCell: gridAt(page.referee.navGrid, fx, fz),
        endCell: gridAt(page.referee.navGrid, tx, tz),
        pathLen: path ? path.length : null,
        path,
        width: page.referee.navGrid.width,
        height: page.referee.navGrid.height,
        cellSize: page.referee.navGrid.cellSize,
      };
    };
    window.__bots = () => page.referee.bots.map(b => ({
      id: b.playerId, name: b.name,
      pos: b.getPosition(), yaw: b.yaw,
      behaviour: b.currentBehaviour, forward: b.moveForward, strafe: b.moveStrafe,
      firing: b.isFiring, target: b.firingTarget,
      objective: b.objective?.name ?? null,
      waypoint: b.waypoint,
      goal: b.objectiveGoal,
      goalReached: b.goalReached,
      routePoints: b.route?.points?.length ?? 0,
      routeIndex: b.route?.index ?? 0,
      routeCoarse: b.route?.coarse?.length ?? 0,
      routeFailed: b.route?.failed ?? null,
      steer: b._dbgSteer ?? null,
      obstacles: b.obstacles?.length ?? 0,
      stalledTicks: b._stalledTicks ?? 0,
      pathFailures: b._pathFailures ?? 0,
      urgency: Object.fromEntries(Object.entries(b.urgency ?? {}).map(([k, v]) => [k, +v.toFixed(3)])),
      order: b.waypoints ? { area: b.waypoints.area?.name ?? null, radius: b.waypoints.radius } : null,
      kit: b.kit ?? null,
      weapon: b.weaponAi?.name ?? null,
      memory: b.senses?.memory?.size ?? 0,
      candidates: b.senses?.lastCandidates ?? 0,
      heal: b._medicResult?.targetId ?? null,
      vehicle: b.vehicle?.template ?? null,
      change: b._changeResult?.best ? { id: b._changeResult.best.cand?.template, seat: b._changeResult.best.cand?.seatId ?? null, u: +b._changeResult.best.u.toFixed(2), d: +b._changeResult.best.dist.toFixed(1), teleport: !!b._changeResult.teleport, bail: !!b._changeResult.bail } : null,
      attackPhase: b._attackPhase ?? null,
      attack: b._attackDbg ?? null,
      enemyTypes: b.enemyTables ? Object.fromEntries(Object.entries(b.enemyTables.types).filter(([, v]) => v > 0).map(([k, v]) => [k, +v.toFixed(2)])) : null,
      steerAngle: b._dbgSteerAngle ?? null,
      ammo: b.weaponAi?.ammo ?? null, reload: +((b._mags?.get(b.weaponAi?.name)?.reloadLeft) ?? 0).toFixed(2),
      aimDev: +(b.aimDeviation ?? 0).toFixed(2), rof: page.referee.weaponDataOf(b)?.roundOfFire ?? null,
      senseSub: b.senses?.substate ?? 0,
      plan: (b.currentPlan ?? []).map(a => `${a.type}${a.done ? '*' : ''}`),
      heard: b.senses?.heard?.size ?? 0,
      strategy: page.referee.strategy ? (page.referee.strategy.sides[b.team]?.active?.strategy?.name ?? null) : null,
      speed: +((page.world?.player(b.playerId)?.soldier?.speed ?? 0)).toFixed(2),
      team: b.team,
      hp: page.world?.armorOf(b.playerId)?.hitPoints ?? null,
      dead: !!page.world?.armorOf(b.playerId)?.destroyed,
      respawnIn: +((b._respawnIn ?? 0)).toFixed(2),
      lookX: b.lookX, lookY: b.lookY,
      blockedSpawn: page.world?.player(b.playerId)?.spawn?.blockedReason ?? null,
      rigFamilies: Object.keys(page.botBodies.botVisuals.get(b.playerId)?.rig?.families ?? {}),
      clipFamily: page.botBodies.botVisuals.get(b.playerId)?.want ?? null,
      mixerTime: +(page.botBodies.botVisuals.get(b.playerId)?.rig?.mixer?.time ?? 0).toFixed(2),
      lastInput: page.world?.player(b.playerId)?.last?.input ?? null,
      lookApplied: page.world?.player(b.playerId)?.lookApplied ?? null,
      soldier: page.world?.player(b.playerId)?.soldier
        ? {
            pos: [page.world.player(b.playerId).soldier.x, page.world.player(b.playerId).soldier.y,
                  page.world.player(b.playerId).soldier.z],
            gait: page.world.player(b.playerId).soldier.gait,
            grounded: page.world.player(b.playerId).soldier.grounded,
            v: page.world.player(b.playerId).soldier.body?.velocity ?? null,
          }
        : null,
    }));
    // Free-fly heading. Setting `camera.rotation` directly is pointless here —
    // `applyLook` rewrites it from `look` on every frame — so a headless check
    // that wants to face the camera somewhere has to move this instead.
    window.__look = page.look;
    // The view rig, which the mouse and the C key drive and a headless run cannot.
    // `__view.turn()` is the pilot's head in the cockpit — a Corsair's guns sit 40
    // degrees off the nose, so framing them means looking at them — and the orbit
    // outside it. `__setView(mode)` selects a mode without walking the cycle.
    Object.defineProperty(window, '__view', { get: () => page.localPlayer.view });
    // The external view's law as mounted: which law and frame `?chase=` chose,
    // the root's bounding radius, and the carried offset from the seat Camera.
    window.__chase = () => ({
      option: page.CHASE_OPTION, law: page.chaseRig.law, radius: page.chaseRig.radius,
      rel: [...page.chaseRig.rel], camera: page.chaseRig.camera?.name ?? null,
      active: !!page.localPlayer.view?.externalLaw,
    });
    window.__setView = mode => {
      if (!page.localPlayer.view) return null;
      const set = page.localPlayer.view.setMode(mode);
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
    window.__getFire = () => ({
      groups: page.localPlayer.vehicleGuns.map(group => ({
        name: group.node.name,
        input: group.stats.input,
        roundOfFire: group.stats.roundOfFire,
        velocity: group.stats.velocity,
        tracerInterval: group.stats.tracer?.interval ?? null,
        firing: group.firing,
        shots: group.shots,
        muzzles: group.muzzles.map(node => {
          node.updateWorldMatrix(true, false);
          return {
            name: node.name,
            world: node.getWorldPosition(new THREE.Vector3()).toArray(),
          };
        }),
        flashes: group.emitters.map(emitter => ({
          name: emitter.node.name,
          muzzle: emitter.muzzle?.name ?? null,
          visible: emitter.node.visible,
          additive: [emitter.node.material].flat()
            .every(m => m.blending === THREE.AdditiveBlending),
        })),
      })),
      tracers: page.guns.tracers.map(tracer => ({
        position: tracer.mesh.position.toArray(),
        velocity: tracer.velocity.toArray(),
        bright: tracer.bright,
        age: tracer.age,
        ttl: tracer.ttl,
        // What the width floor settled on this frame, against the streak's own
        // length scale: equal means the real mesh was already wide enough.
        scale: tracer.mesh.scale.toArray(),
        lengthScale: tracer.lengthScale,
        parent: tracer.mesh.parent === page.scene ? 'scene' : (tracer.mesh.parent?.name ?? null),
      })),
      // Where rounds stopped, newest first, each carrying the surface it struck
      // and the EffectBundle the MaterialManager names for that pairing. The
      // selection is assertable even though the drawing is a stand-in.
      hits: page.guns.hits,
      impacts: page.guns.impacts.length,
      projectiles: page.guns.projectiles.length,
      // HP-9d, for a headless check: a **fuse** round is one the engine gives an
      // end-of-life explosion but no impact explosion, and `resting` says it has
      // met a surface and is running its fuse down where it landed rather than
      // having detonated there.
      inFlight: page.guns.projectiles.map(shot => ({
        gun: shot.group.node.name,
        age: shot.age,
        ttl: shot.ttl,
        fuse: shot.fuse,
        resting: shot.resting,
        position: shot.mesh.position.toArray(),
        // COL-2, and the three numbers a bounce check needs: where it is going,
        // how many contacts it has resolved, and which material pair it is
        // resolving them against. A rest position alone cannot tell a round
        // that skidded from one that was teleported.
        velocity: shot.velocity.toArray(),
        contacts: shot.body?.contacts ?? 0,
        contactMaterial: shot.body?.material ?? null,
        surface: shot.body?.contact?.material ?? null,
        pair: shot.body?.contact
          ? shot.body.pairWith(shot.body.contact.material) : null,
      })),
      pooled: page.guns.tracerPool.length,
      // Baked streaks recycle into their own group's pool, not the shared
      // cylinder pool, so a leak there is invisible to `pooled` alone.
      meshPooled: page.localPlayer.vehicleGuns.reduce((n, g) => n + g.tracerMeshPool.length, 0),
    });
    // Seat/manned-gun state for headless checks (P2,
    // features/bf1942-3d-models/seats-and-manned-guns.md): which seat is
    // active, its turret's own angles, and the active seat's own FireArms
    // (ammo/heat/mags) -- `__getFire`/`vehicleGuns` above never see these, since
    // a gun/seat occupancy's own FireArms live in `mannedGuns`, not there.
    Object.defineProperty(window, '__occupancy', {
      get: () => page.localPlayer.occupancy && {
        rootId: page.localPlayer.occupancy.rootId,
        rootKind: page.localPlayer.occupancy.rootKind,
        order: page.localPlayer.occupancy.order,
        activeSeatId: page.localPlayer.occupancy.activeSeatId,
        activeKind: page.localPlayer.occupancy.seatKind(page.localPlayer.occupancy.activeSeatId),
        mannedActive: page.mannedActive(),
        turretAxes: page.localPlayer.occupancy.turret?.axes.map(a => ({ axis: a.axisName, angle: a.angle })) ?? null,
        fireArms: page.localPlayer.occupancy.activeFireArmsNodes().map(n => {
          const s = page.fireStateFor(n);
          return {
            name: n.name, ammo: s.unlimited ? -1 : s.ammo, magsLeft: s.magsLeft,
            heat: s.heat, hasHeat: s.hasHeat, canFire: s.canFire,
          };
        }),
      },
    });
    window.__nearEntry = () => page.nearEntry
      && { control: page.nearEntry.control, seatId: page.nearEntry.seatId };
    // The seated occupant and the arms the IK is driving this frame: which bone
    // is pinned to which node, and how far it actually is from where the
    // declared offset puts it. A headless check has no other way to tell a hand
    // that is on the wheel from one that is merely near it.
    window.__seatIk = () => {
      const v = new THREE.Vector3();
      const want = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      return page.seatIkChains.map(chain => {
        chain.target.updateWorldMatrix(true, false);
        chain.target.matrixWorld.decompose(want, q, s);
        const t = ikTarget(chain.entry, [want.x, want.y, want.z],
                           [q.x, q.y, q.z, q.w]);
        chain.end.getWorldPosition(v);
        return {
          bone: chain.bone, node: chain.node.name, target: chain.target.name,
          want: t.position.map(n => +n.toFixed(4)),
          got: [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)],
          error: +Math.hypot(t.position[0] - v.x, t.position[1] - v.y,
                             t.position[2] - v.z).toFixed(5),
        };
      });
    };
    // The seated soldier itself, for the same reason.
    window.__seatSoldier = () => (page.seatSoldier ? {
      visible: page.seatSoldier.visible,
      firstPerson: !!page.localPlayer.view?.firstPerson,
    } : null);
    window.__switchSeat = page.switchSeat;
    // Group-index bookkeeping, independent of `occupancy` (which reads null the
    // instant a seat is vacated) so a headless enter/exit cycle can check the
    // *count* left behind afterwards, not just while still seated: a group
    // `releaseGuns()` failed to splice out of `guns.groups` would otherwise be
    // invisible until a second entry's own `collect()` piled a duplicate on top
    // of it — this is `guns.groups.length` itself, so a leak shows up as soon
    // as the first exit leaves it above 0 with nobody occupying anything.
    window.__gunGroups = () => ({
      vehicle: page.localPlayer.vehicleGuns.length, manned: page.localPlayer.mannedGuns.length, total: page.guns.groups.length,
    });
    window.__hudVars = () => (window.__hud && window.__hud.vars) || null;
    // Turning, for the screenshot harness. It calls the same `lookDelta` a
    // pointer-lock `pointermove` calls, so it exercises the real routing rather
    // than writing yaw behind it — headless Chromium does not reliably grant
    // pointer lock, and without this a harness can only ever walk one way.
    //
    // Named `__lookDelta` and not `__look`: `window.__look` is already the
    // free-fly `look` object above, and an assignment here would silently take it
    // away from every check that steers the free camera by writing yaw into it.
    window.__lookDelta = (dx, dy) => { page.lookDelta(dx, dy); return window.__soldier(); };
    // `__setOnFoot` drives the real checkbox so the pilot/on-foot exclusion, the
    // flag list and the FOV swap all run exactly as a click would run them.
    // `__setWalk` is the same thing under the name the walk checks use.
    //
    // Since the deploy screen, the checkbox's on-edge parks the join on that
    // screen rather than in the world — `__deploy.spawn()` below is the button
    // press that completes it — so `Boolean(soldier)` here reports false until
    // it is pressed, exactly as the page reports it.
    window.__setOnFoot = on => {
      page.optOnFoot.checked = Boolean(on);
      page.optOnFoot.dispatchEvent(new Event('change'));
      return Boolean(page.soldier);
    };
    window.__setWalk = window.__setOnFoot;
    // The deploy screen, drivable without a pointer: state to read, verbs to
    // press. `select` is the click on a flag marker (by name or by index),
    // `spawn` is the button, and both refuse politely — false — when the
    // screen is not up or the name is not a flag.
    window.__captureVoice = {
      kind: page.captureVoiceKind, dirs: page.captureVoiceDirs, announce: page.announceCapture,
      play: page.playCaptureVoice, last: () => page.lastCaptureVoice,
    };
    window.__deploy = {
      get open() { return page.deployActive(); },
      // Nothing chosen: a click on open ground unselects, and the commit then
      // takes the free camera instead of spawning (`enterFreeCam`).
      get unchosen() { return page.deployUnchosen; },
      get flags() {
        const chosen = page.deployUnchosen ? -1
          : Math.min(Number(page.spawnFlagSelect.value) || 0, page.flags.length - 1);
        return page.flags.map((flag, index) => ({
          name: flag.name,
          team: flag.team,
          spawns: flag.spawns.length,
          selected: index === chosen,
          // A burning ship: `BFSpawnPoint::getActive`'s Armor gate.
          inactive: page.shipFlagInactive(flag),
        }));
      },
      get team() { return page.deployTeamId; },
      // The kit row, and what pressing SPAWN with it would put in hand: the
      // level's kit for that row, its primary, the soldier whose sleeves it
      // gets — readable without spawning, so a check can assert the table
      // before it waits on a glb.
      get kit() { return page.deployKit; },
      get loadout() {
        const chosen = Math.min(Number(page.spawnFlagSelect.value) || 0, page.flags.length - 1);
        const flag = page.flags[chosen] || { team: page.deployTeamId };
        return {
          kit: page.deployKit,
          team: flag.team,
          ...page.kitLoadout(flag.team),
          weapon: page.weaponTemplateFor(flag),
          rig: page.viewmodelRigFor(page.weaponTemplateFor(flag), page.soldierTemplateFor(flag)),
          fromFile: !!page.loadouts?.levels?.[page.currentDir],
        };
      },
      select(name) {
        const index = typeof name === 'number' ? name
          : page.flags.findIndex(flag => flag.name === name);
        return page.selectDeployFlag(index);
      },
      setTeam(team) {
        if (!page.deployActive() || (team !== 1 && team !== 2)) return false;
        // The tab click itself: switching teams kills the current soldier.
        page.chooseTeam(team);
        return true;
      },
      // The click on a kit row, by the row's name (`scout` .. `engineer`).
      setKit(name) {
        if (!page.deployActive() || !page.KITS.includes(name)) return false;
        page.chooseKit(name);
        return true;
      },
      spawn() { return page.deploySpawn(); },
      cancel() { if (!page.deployActive()) return false; page.cancelDeploy(); return true; },
    };
    // The man on the ground, for the same reason: his pose has to be readable
    // from outside to assert that a wall stopped him where the capsule says.
    //
    // Both halves are reported — the presentation state this page consumes
    // (stance, gait, bob, eye) and the body state `physics.js` integrates
    // (position, velocity, pose index, contacts, ticks) — because a walk check
    // asserting 6 m/s has to read the velocity the integrator produced, not the
    // distance a frame happened to cover.
    window.__soldier = () => page.soldier && ({
      x: page.soldier.x, y: page.soldier.y, z: page.soldier.z,
      eyeY: page.soldier.eyeY, yaw: page.soldier.yaw, pitch: page.soldier.pitch,
      stance: page.soldier.stance, gait: page.soldier.gait, speed: page.soldier.speed,
      grounded: page.soldier.grounded, blocked: page.soldier.blocked, onWater: page.soldier.onWater,
      steps: page.soldier.steps, casts: page.soldier.casts,
      // The swim state: `c_AsmIsSwimming`, the depth it was decided on, the state
      // the animation machine is in, and how long the water has before it starts
      // taking HP. `onWater` above is now the same bit as `swimming`.
      swimming: page.soldier.swim.swimming, swimDepth: page.soldier.swim.depth,
      swimState: page.soldier.swim.family, swimTime: page.soldier.swim.swimTime,
      // `getCurrentStateFlags()` of the lower machine, and the item gate it
      // drives: `itemsLocked` true means the engine has left him nothing to fire,
      // reload, throw or select. See `itemsLocked()` in this file.
      stateFlags: page.soldier.stateFlags, itemsLocked: page.soldier.itemsLocked,
      drownGrace: page.soldier.drownGrace, drowned: page.soldier.drown.lost,
      waterLevel: page.collider?.waterLevel ?? null,
      // Hit points (verify-r4.md) and the current deploy team (verify-r3.md's
      // depot team gate reads this) — null hp/maxHp is itself informative: it
      // means `soldierArmor` was never created, not that HP is zero.
      hp: page.soldierArmor?.hitPoints ?? null, maxHp: page.soldierArmor?.maxHitPoints ?? null,
      destroyed: page.soldierArmor?.destroyed ?? null, team: page.deployTeamId,
      bobUp: page.soldier.bobUp, bobSide: page.soldier.bobSide,
      ground: page.groundHeight(page.soldier.x, page.soldier.z),
      fov: page.camera.fov, near: page.camera.near,
      flag: page.flags[Number(page.spawnFlagSelect.value) || 0]?.name || null,
      flags: page.flags.map(f => ({ name: f.name, team: f.team, spawns: f.spawns.length })),
      position: { ...page.soldier.body.position },
      velocity: { ...page.soldier.body.velocity },
      pose: page.soldier.body.pose,
      contacts: page.soldier.body.contacts,
      material: page.soldier.body.material,
      ticks: page.soldier.clock.ticks,
      dropped: page.soldier.clock.dropped,
    });
    window.__walkState = window.__soldier;
    // The live soldier, the way `__aircraft` and `__car` are live: a headless
    // check that has to hold one thing still and change exactly one other thing
    // needs the object, not a snapshot of it. The A/B the item gate is proved by
    // is "the same tick, the same camera, the same sea, `swim.family` moved off
    // the flag table for one frame" — with a snapshot there is no such A/B and the
    // measurement becomes two different scenes compared to each other.
    Object.defineProperty(window, '__soldierObject', { get: () => page.soldier });
    // The weapon in hand, for the same reason as the soldier: the magazine,
    // the cone and the trigger have to be readable to assert a burst emptied
    // what it should and bloomed what it should. `__setTrigger`/`__setAim`
    // stand in for mouse buttons the way `__lookDelta` stands in for pointer
    // lock, which headless Chromium does not reliably grant.
    // The live rig object, for bisecting a rendering fault from the console.
    window.__rig = () => page.handWeapon?.rig;
    // The kit table, once fetched, so a check can await it before it reads
    // `__deploy.loadout` and know the answer came from the file.
    window.__loadouts = () => page.loadoutsLoad;
    // The engineer's demolitions state: which pair this kit carries, how many
    // charges are left in the pouch, and how many are live in the world for the
    // plunger to reach. `__altFire` stands in for the right mouse button the
    // way `__setTrigger` stands in for the left.
    window.__demolitions = () => {
      const pouch = page.packAmmo();
      const sized = Number.isFinite(pouch?.size);
      return {
        pack: page.explosivesTemplate,
        detonator: page.detonatorTemplate,
        inHand: page.handWeapon?.name ?? null,
        capacity: sized ? pouch.size : 0,
        down: sized ? pouch.size - pouch.rounds : 0,
        left: page.packsLeft(),
        live: page.thrownPackGroup ? page.guns.liveProjectiles(page.thrownPackGroup) : 0,
      };
    };
    window.__altFire = () => page.altFireDemolitions();
    window.__handWeapon = () => page.handWeapon && ({
      name: page.handWeapon.name,
      soldier: page.handWeapon.soldier,
      rig: page.handWeapon.rigFile,
      hasGroup: !!page.handWeapon.group,
      // The arms rig, when the weapon has one: which clip owns the arms, so a
      // headless check can walk, fire and reload and read the machine back.
      viewmodel: !!page.handWeapon.mixer,
      clip: page.handWeapon.active,
      rounds: page.handWeapon.rounds,
      mags: page.handWeapon.mags,
      reloading: page.handWeapon.reload > 0,
      deviationDeg: page.handWeapon.model.current(),
      zoomed: page.isZoomed(),
      fovFactor: page.handWeapon.fovCur,
      worldFov: page.handWeapon.worldFov,
      fov1p: page.handWeapon.fov1p,          // `set1pFov`, radians, from the rig extras
      nearPassFov: page.vmCamera.fov,        // degrees the near pass last drew with
      rezoom: page.handWeapon.rezoom,
      firing: !!page.handWeapon.group?.firing,
      shots: page.handWeapon.group?.shots ?? 0,
      // The item gate, and whether the rig is drawn at all: a swimmer has no
      // active item, so `locked` is true and `rigVisible` is false.
      locked: page.itemsLocked(),
      rigVisible: page.handWeapon.rig.visible,
      crosshairHidden: page.crosshairEl.hidden,
      crosshairStyle: page.crosshairAim().style,
      crosshairIcon: page.crosshairEl.classList.contains('ch-icon'),
      crosshairArt: page.crosshairEl.classList.contains('ch-art'),
      crosshairGap: page.crosshairEl.style.getPropertyValue('--ch-gap') || null,
      fov: page.camera.fov,
      // The idle-fidget state, so a headless check can step past the 4-7 s
      // dwell and read which one-shot owns the arms.
      fidget: page.handWeapon.fidget,
      fidgetTimer: page.handWeapon.fidgetTimer,
      fidgetNames: [...page.handWeapon.fidgetNames],
    });
    // The kit-rotation inventory: the spawned kit's slots, the slot in hand,
    // and the verbs a check needs — the same `selectKitWeapon` the number keys
    // and the wheel run (headless Chromium grants neither reliably).
    window.__kitRotation = () => ({
      slots: page.kitWeaponSlots?.map(w => ({ ...w })) ?? null,
      handSlot: page.handSlot,
      weaponBarUp: performance.now() < page.weaponBarUntil,
    });
    window.__selectKitWeapon = page.selectKitWeapon;
    window.__cycleKitWeapon = page.cycleKitWeapon;
    // Stand the man somewhere exact — in front of a known wall — so a burst can
    // be fired at a surface the assertion names rather than wherever a flag
    // happened to put him.
    window.__teleport = (x, y, z, yaw = 0) => {
      if (!page.soldier) return false;
      page.soldier.spawn(x, y, z, yaw);
      page.snapPresentation();
      return true;
    };
    window.__setTrigger = on => {
      page.pressTrigger(on);
    };
    // Bailing out, for a headless check. `__bailOut` puts the man in the air
    // with a velocity the way stepping out of a flying plane does (no floor
    // probe, unlike `__teleport`); `__parachute()` reads the state machine and
    // the numbers a check wants to assert on, and drains the sound and
    // animation events the last frame produced.
    window.__bailOut = (x, y, z, yaw = 0, vx = 0, vy = 0, vz = 0) => {
      if (!page.soldier) return false;
      page.soldier.collider = page.collider;
      page.soldier.bailOut(x, y, z, yaw, vx, vy, vz);
      page.snapPresentation();
      return true;
    };
    window.__parachute = () => {
      if (!page.soldier) return null;
      const v = page.soldier.body.body.velocity;
      const ground = page.collider?.surfaceHeight
        ? page.collider.surfaceHeight(page.soldier.x, page.soldier.z) : NaN;
      const drained = page.parachuteLog.slice();
      page.parachuteLog.length = 0;
      return {
        state: page.soldier.parachuteState,
        fallTime: page.soldier.chute.fallTime,
        open: page.soldier.chute.open,
        clips: page.soldier.chute.clips(page.soldierDead),
        y: page.soldier.y, x: page.soldier.x, z: page.soldier.z,
        height: Number.isFinite(ground) ? page.soldier.y - ground : null,
        velocity: { x: v.x, y: v.y, z: v.z },
        descent: Math.abs(v.y),
        glide: Math.hypot(v.x, v.z),
        drag: page.soldier.body.body.drag,
        grounded: page.soldier.grounded,
        hitPoints: page.soldierArmor?.hitPoints ?? null,
        landing: page.soldier.landing,
        events: drained,
      };
    };
    window.__setDeploy = on => page.holdDeploy(on);
    // The soldier's camera view, for a headless check: read it with no argument,
    // press C with `__footView('cycle')`, or name a mode. `modes` is what
    // `soldier-camera.js` allows this frame -- one on foot, three under a canopy.
    window.__footView = arg => {
      if (arg === 'cycle') page.footView3p.cycle();
      else if (typeof arg === 'string') page.footView3p.setMode(arg);
      return {
        mode: page.footView3p.mode,
        modeId: page.footView3p.modeId,
        modes: page.footView3p.modes,
        firstPerson: page.footView3p.firstPerson,
        // Why `setMode('chase')` may have done nothing. On foot the engine's
        // cycle is a set of ONE (CAM-1: `SoldierCamera` writes `CVMChase 0` and
        // `BFSoldier::nextCamera` is empty), and the server's soldier switch
        // (on by default, `?foot3p=0` off) is the marked departure that widens
        // it. Reported here because a check that asks for a
        // chase view and is refused otherwise reads the refusal as "the body is
        // not being drawn" — which is how W8-B's swim body came to be called
        // missing when it was only invisible.
        cycleOnFoot: page.soldier3pOnFoot(),
        rel: [...page.foot3pRel],
        eye: { x: page.camera.position.x, y: page.camera.position.y, z: page.camera.position.z },
      };
    };
    // What the player's own third-person body is drawing, for a headless check:
    // the clip family `syncFootBody` settled on, the families its rig actually
    // bound, and where the two scenes are. There is nothing else on the page that
    // can tell a crouch from a crawl on the local soldier.
    // Force the body and its canopy out of the frame for one render, so a
    // headless check can read the same box with and without them and attribute
    // the difference to the body alone. Nothing else in the scene moves between
    // the two reads, which is what makes it evidence rather than a screenshot.
    window.__footBodyHide = on => page.forceHideFootBody(on);
    // The subject height the external view frames itself against: feet to canopy
    // top, measured off the drawn canopy.
    window.__canopySpan = () => +page.canopySpan().toFixed(3);
    window.__footBody = () => (page.footBody ? {
      soldier: page.footBody.soldier,
      weapon: page.footBody.weapon,
      want: page.footBody.want,
      bound: Object.keys(page.footBody.families),
      // What the MIXER is actually playing, not what was asked for: every family
      // whose two actions carry weight, with the lower half's clock. `want` is a
      // record of the last switch; this is read back off the actions, so a family
      // that was asked for and never applied shows up as a disagreement between
      // the two instead of having to be inferred from pixels.
      playing: Object.entries(page.footBody.families)
        .filter(([, actions]) => actions.some(a => a.getEffectiveWeight() > 0))
        .map(([family, actions]) => ({
          family,
          weight: +actions[0].getEffectiveWeight().toFixed(3),
          time: +actions[0].time.toFixed(4),
        })),
      weaponNode: page.footBody.weaponNode?.name ?? null,
      weaponVisible: page.footBody.weaponNode ? page.footBody.weaponNode.visible : null,
      visible: page.footBody.scene.visible,
      at: page.footBody.scene.position.toArray().map(v => +v.toFixed(3)),
      gait: page.soldier?.gait ?? null,
      stance: page.soldier?.stance ?? null,
      parachute: page.soldier?.parachuteState ?? null,
      canopy: page.footCanopy ? {
        clip: page.footCanopy.want,
        visible: page.footCanopy.scene.visible,
        attach: page.footCanopy.attach,
        clips: Object.keys(page.footCanopy.actions),
        at: page.footCanopy.scene.position.toArray().map(v => +v.toFixed(3)),
      } : null,
    } : null);
    // The seated player's two mouse triggers, for a headless check: left is the
    // vehicle's `c_PIFire`, right its `c_PIAltFire`. Named apart from
    // `__setTrigger` because that one is the soldier's, and a seated player's
    // is a different input on a different object.
    // Counts per browser pixel, live: call with no argument to read it, with a
    // number to try one. Same knob as `?turret=`, and the only unproven unit in
    // the mouse path.
    window.__turretScale = value => {
      const n = Number(value);
      if (value !== undefined && Number.isFinite(n) && n > 0) {
        page.mouseInput.countsPerPixel = n;
      }
      return page.mouseInput.countsPerPixel;
    };
    // The whole input stage, for a headless check: `__mouseLook()` reads the
    // held axis pair and the live profile, `__mouseLook(dx, dy)` feeds pointer
    // counts in the way a `mousemove` would.
    window.__mouseLook = (dx, dy) => {
      if (dx !== undefined || dy !== undefined) {
        page.mouseInput.accumulate(Number(dx) || 0, Number(dy) || 0);
      }
      return {
        x: page.mouseInput.x,
        y: page.mouseInput.y,
        profile: page.mouseInput.profile,
        scale: page.mouseInput.scaleFor(),
        sensitivity: { ...page.mouseInput.sensitivity },
        countsPerPixel: page.mouseInput.countsPerPixel,
        pendingPixels: page.mouseInput.pendingPixels,
      };
    };
    window.__setSeatFire = (main, alt = false) => {
      page.setSeatTriggers(main, alt);
      return { seatFire: page.seatFire, seatAltFire: page.seatAltFire };
    };
    // A full pouch again, for the perf harness: a Thompson carries 150 rounds
    // and a several-minute burst phase would otherwise fall silent at 15 s.
    window.__refill = () => {
      const hw = page.handWeapon;
      const magazine = hw?.data?.magazine;
      if (!magazine) return false;
      hw.rounds = magazine.size;
      hw.mags = magazine.magazines ?? hw.mags;
      hw.reload = 0;
      return true;
    };
    // `SimpleObject::handleDamage`'s own sign dispatch (R4-19): positive
    // damages, zero or negative heals — the hook the round-2 briefing asks
    // for, so a test can take the soldier's HP down without waiting on fall
    // damage's own approximate trigger.
    window.__damage = n => {
      if (!page.soldierArmor) return false;
      page.applyDamageToPlayer(Number(n) || 0);
      return true;
    };
    // Exercise the fall-damage integration itself (the `onFoot` hook above),
    // not just `Armor.applyDamage` in isolation — `__teleport` cannot stand in
    // for this because `Soldier.spawn` ends in `settle()`, which raycasts down
    // and places the body back on the ground with `grounded=true` and zero
    // velocity every time (`soldier.js`'s own `place()`/`settle()`). This
    // hook instead lifts the *already-settled* body by `extraHeight` metres,
    // zeroes vertical speed and marks it airborne, so the very next
    // `soldier.step()` calls fall under real gravity (`physics.js`,
    // `GRAVITY = -14.73`) into the same landing-edge detection a walked-off
    // ledge would trigger. A headless check reads `window.__soldier().hp`
    // before and after stepping frames until `grounded` is true again.
    window.__dropFromHeight = extraHeight => {
      if (!page.soldier) return false;
      const lift = Number(extraHeight) || 0;
      page.soldier.body.position.y += lift;
      page.soldier.body.velocity.y = 0;
      page.soldier.body.grounded = false;
      // HP-14's `F` is `getLastCollisionHeight() - pos.y`, so the body has to
      // believe it last touched ground at the height it is being dropped from.
      // Without this the lift is free: the fall would be billed a drop of zero
      // and every height would cost the same nothing.
      page.soldier.body.lastCollisionHeight += lift;
      return true;
    };
    // Drive a low-ammo state directly, the same way `__damage(n)` drives a
    // low-HP one: a fresh `handWeapon` spawns full (`ensureHandWeapon`), and
    // driving it dry by actually holding the trigger is `gunfire.js`'s own
    // fire-rate/rate-of-fire-gate territory, not this track's — a headless
    // check that wants to see `supplyTarget.refillAmmo` (this file, above)
    // actually fire should set the "before" state directly instead.
    window.__setAmmo = (rounds, mags) => {
      if (!page.handWeapon) return false;
      page.handWeapon.rounds = Number(rounds) || 0;
      page.handWeapon.mags = Number(mags) || 0;
      page.handWeapon.reload = 0;
      return true;
    };
    // The depot field and this soldier's current standing against it, for a
    // headless check to read without reaching into module-private state.
    window.__supply = () => {
      if (!page.supplyField || !page.soldierArmor) return null;
      const nearest = page.supplyField.nearest(page.supplyTarget);
      return {
        depots: page.supplyField.depots.length,
        hp: page.soldierArmor.hitPoints, maxHp: page.soldierArmor.maxHitPoints,
        destroyed: page.soldierArmor.destroyed,
        canHeal: page.supplyField.canHeal(page.supplyTarget),
        canRearm: page.supplyField.canRearm(page.supplyTarget),
        nearest: nearest && {
          name: nearest.depot.name, distance: nearest.distance,
          radius: nearest.depot.radius, team: nearest.depot.team,
          ammoEnabled: nearest.depot.ammoEnabled, healEnabled: nearest.depot.healEnabled,
        },
      };
    };
    // Seed every random draw the shot path makes — the spread cone, the
    // flash roll, the recoil, the emitters' distributions — so two captures
    // of the same stepped frames are the same picture and a pixel diff
    // between builds measures the build, not the dice. The guns and the
    // effects each hold their own `rand` for exactly this; `Math.random`
    // itself is left alone, because three draws it for every uuid and a build
    // that allocates one object more would otherwise fire a different burst.
    window.__seedRandom = (seed = 1) => {
      let s = seed >>> 0;
      const lcg = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
      page.guns.rand = lcg;
      page.effects.rand = lcg;
      return true;
    };
    // Zoom is a press-toggle on every vanilla weapon (`altFireOnce`), so the
    // harness verb sets the latch directly rather than faking a held button.
    window.__setAim = on => {
      const hw = page.handWeapon;
      if (hw?.data?.zoom?.toggle) {
        hw.zoomed = !!on;
        hw.rezoom = 0;
      } else {
        page.setAim(on);
      }
    };
    // Fires a real pointerdown/pointerup/pointermove at the real listeners --
    // pointerdown, pointerup and a chorded pointermove all resolve through
    // `buttonChange` -- so a check exercises the actual wiring instead of
    // a re-implementation of it. `pointerLocked()` stands `?shots` in for
    // real pointer lock (headless Chromium never grants it), the same way
    // `__setTrigger` already stands in for the mouse. `kind` is 'down' | 'up'
    // | 'move'; a 'move' carries `movementX/Y` so a check can assert
    // `lookDelta` was, or was not, applied from a chorded event.
    window.__chordEvent = (kind, button, buttons, movementX = 0, movementY = 0) => {
      const type = kind === 'down' ? 'pointerdown' : kind === 'up' ? 'pointerup' : 'pointermove';
      const ev = new PointerEvent(type, {
        button, buttons, movementX, movementY,
        pointerId: 1, pointerType: 'mouse', bubbles: true, cancelable: true,
      });
      (type === 'pointermove' ? document : page.renderer.domElement).dispatchEvent(ev);
      return { triggerHeld: page.triggerHeld, aimHeld: page.aimHeld, zoomed: page.isZoomed(), yaw: page.soldier?.yaw ?? null };
    };
    // The `?kblock` prototype, for headless checks. `lock` is only what the last
    // lock() promise said, which is that the browser registered the request --
    // never that a key is reserved: the lock is live only in fullscreen, and no
    // CDP key event can show it holding Ctrl+W (CDP injects below the view that
    // marks locked keys).
    window.__kblock = () => ({
      enabled: page.KBLOCK, session: page.kbSession, lock: page.kbLockState, keys: page.KBLOCK_KEYS,
      fullscreen: document.fullscreenElement === page.stage,
      hud: page.hud.textContent,
    });
    // The collider itself, for measuring rather than for asserting: `__collision()`
    // drains the accumulated cast cost, so calling it once a second gives the real
    // microseconds-per-query number the feature doc quotes.
    window.__collision = () => page.collider && ({
      heightfield: page.collider.heightfield && {
        dim: page.collider.heightfield.dim,
        spacing: page.collider.heightfield.spacing,
        coverage: page.collider.heightfield.coverage,
        materials: Boolean(page.collider.heightfield.materials),
      },
      waterLevel: page.collider.waterLevel,
      statics: page.collider.statics && {
        triangles: page.collider.statics.count,
        cells: page.collider.statics.cols * page.collider.statics.rows,
        cellSize: page.collider.statics.cellSize,
        entries: page.collider.statics.cellItems.length,
      },
      cost: page.collider.drainCost(),
    });
    // The collider itself, for batch timing: `__castRay` allocates a point array
    // and a result object per call, which is most of what a per-cast number
    // measures if you time it through the wrapper.
    window.__colliderRef = () => page.collider;
    window.__castRay = (from, dir, dist) => {
      const length = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const hit = page.collider?.cast(from[0], from[1], from[2],
                                 dir[0] / length, dir[1] / length, dir[2] / length,
                                 dist, -1);
      return hit && { t: hit.t, point: [hit.x, hit.y, hit.z], kind: hit.kind,
                      material: hit.material, owner: hit.owner };
    };
    // Every world matrix in the scene checked against a fresh recompute, for
    // the perf harness: static subtrees opt out of three's per-frame matrix
    // walk (freezeStatics), and this is the proof that nothing frozen has
    // moved since. Returns the worst absolute element difference, the object
    // it was found on, how many objects were checked and how many are frozen.
    // The map surfaces' repaint gate (features/mesh-viewer-performance, rule
    // 7), switchable so a bench can set every-frame repaints -- the page before
    // dd165c5 -- against it without a reload. No argument reads it back.
    window.__mapGate = on => {
      if (on !== undefined) page.setMapGate(on);
      return page.mapGate;
    };
    // The minimap's zoom and rotation state (bfmap.js), so a headless check can
    // step the level, settle the ease and read the span without a key event.
    window.__bfmap = page.bfmap;
    // What the map surfaces mark as friendly this frame: the side they are
    // drawn for, the on-foot teammates that get an arrow (with the heading it
    // is drawn at) and the hulls a teammate is riding. A screenshot cannot say
    // whether a missing arrow is a culled marker or an empty list; this can.
    window.__mapMarks = () => ({
      team: page.localMapTeam(),
      tint: page.MINIMAP_TEAM_TINT[page.localMapTeam()] || null,
      onFoot: page.friendlyMapUnits(),
      crewed: [...page.friendlyVehicleNodes()].map(node => node.name),
    });
    // The score board: open/close it, and read back what it lists.
    window.__scoreboard = {
      open: (fromSpawn = false) => page.setScoreboard(true, fromSpawn),
      close: () => page.setScoreboard(false),
      get isOpen() { return page.scoreboardOpen(); },
      get fromSpawn() { return page.scoreFromSpawn; },
      ready: () => !!page.scoreLayout.data,
      rows: () => boardRows(page.scoreboardPlayers(), page.roomJoined && page.roomClient ? page.roomClient.feed : []),
      paint: () => page.paintScoreboard(true),
    };
    // Which gameplay layer `?mode=` landed on, and what else the level ships —
    // enough for a headless check to prove the flags, spawns and vehicles it is
    // looking at belong to the mode it asked for.
    window.__gameMode = () => ({
      active: page.extras?.gameplayMode || null,
      requested: page.params.get('mode'),
      note: page.modeNote,
      available: modeNames(page.extras),
      gameTypes: Object.fromEntries(
        Object.entries(page.extras?.gameTypes || {}).map(([k, v]) => [k, v?.mode])),
      controlPoints: (page.extras?.controlPoints || []).map(
        cp => ({ name: cp.name, team: cp.team, position: cp.position })),
      soldierSpawns: (page.extras?.soldierSpawns || []).length,
      spawnTeams: (page.extras?.soldierSpawns || []).reduce((acc, s) => {
        const key = String(s.team);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      objectSpawns: (page.extras?.objectSpawns || []).length,
      tickets: page.extras?.tickets || null,
      vehicles: page.spawnersRoot
        ? page.spawnersRoot.children.map(v => v.name).sort()
        : [],
    });

    // The combat area and what it is doing to the body this frame: the rect the
    // level declared, the engine's two constants, and the live accumulator. A
    // headless check teleports out, steps frames and reads the countdown and
    // the HP down the same path a walk would take.
    //
    // The two constants are settable here for the same reason `__setAmmo` and
    // `__damage` exist: the engine's real allowance is 10 seconds, and under
    // `__renderOnce` a frame is a capped 0.1 s of sim, so reaching the damage
    // honestly costs 100 forced frames — more than SwiftShader survives in one
    // session. Overriding them exercises the identical code path on a shorter
    // clock; the engine's own values are what the module defaults to and what
    // `tests/test_combat_area.py` pins.
    const combatAreaState = () => ({
      active: page.combatArea.active,
      hasRect: page.combatArea.hasRect,
      rect: page.combatArea.rect,
      timeAllowed: page.combatArea.timeAllowed,
      damagePerSecond: page.combatArea.damagePerSecond,
      // CA-5. Null switches the painted half off; the engine's own value is 7.
      materialToGiveDamage: page.combatArea.materialToGiveDamage,
      // What the level actually paints, so a check can find a painted patch
      // rather than hunt for one: the histogram the extractor already writes.
      materialHistogram: page.extras?.terrain?.materials?.histogram ?? null,
      outsideFor: page.combatArea.outsideFor,
      frame: page.combatFrame,
      hud: {
        time: page.gameHud.vars['Outside/OutsideTime'],
        text: page.gameHud.vars['Outside/OutsideText'],
      },
    });
    window.__combatArea = (options) => {
      if (options && Number.isFinite(options.timeAllowed)) {
        page.combatArea.timeAllowed = options.timeAllowed;
      }
      if (options && Number.isFinite(options.damagePerSecond)) {
        page.combatArea.damagePerSecond = options.damagePerSecond;
      }
      // The rect is settable for the same reason the two constants are, and
      // specifically so the SEATED case can be checked: a vehicle with a
      // drivetrain writes its own `state.position` into its scene node every
      // frame, so a check cannot drive one out of the area by moving the node,
      // and flying 400 m under `__renderOnce` costs more forced frames than a
      // browser session survives. Moving the boundary instead exercises the
      // identical path on a shorter clock. `null` restores the level's own.
      if (options && 'rect' in options) {
        page.combatArea.rect = options.rect ? { ...options.rect } : combatAreaRect(page.extras);
        page.combatArea.reset();
      }
      // Same reasoning for the painted half: a check that wants to prove CA-5
      // fires would otherwise have to walk to a patch of material 7, and one
      // that wants to prove it is OFF on an unpainted level has nothing to
      // switch. `null` runs the rectangle alone; an integer names another id.
      if (options && 'materialToGiveDamage' in options) {
        const id = options.materialToGiveDamage;
        page.combatArea.materialToGiveDamage = Number.isInteger(id) ? id : null;
        page.combatArea.reset();
      }
      return combatAreaState();
    };
    // Set a blast off at an exact point, through the page's own splash path.
    //
    // The same shape as `__damage` and `__damageVehicle`: the thing a headless
    // check cannot otherwise do is place an explosion where it can do the
    // arithmetic. A fired round lands where the ballistics put it, and its
    // centre is `hitPos + 0.1 * normal` (HP-9) which nothing reports — so the
    // distance term, which is the whole point of the assertion, would have to
    // be guessed. This builds the record `effects-core.js`'s `splashSpec` builds
    // and hands it to `applyVehicleHit`, so `splashTargets()`,
    // `soldierExposureFor` and `VehicleDamageSet.applySplash` all run exactly as
    // a shell's do; only the ballistics are skipped.
    //
    // There is no damage argument, and that is the engine: how much a blast is
    // worth is `materialDamage(material2) * damageMod(material2, victim)`, out
    // of the MaterialManager tables (DMG-1). Only the geometry is passed in.
    // Defaults are a hand grenade's — material2 205, radius 10,
    // `YModOnExplosion` 1.0.
    window.__blast = (point, {
      radius = 10, material2 = 205, yMod = 1, firer = -1,
    } = {}) => {
      if (!Array.isArray(point) || point.length !== 3) return null;
      const before = page.splashTargets().filter(t => t.soldier)
        .map(t => t.armor.hitPoints);
      page.applyVehicleHit({
        splashPoint: point, splashRadius: radius,
        splashMaterial2: material2, splashYMod: yMod, firer,
      });
      const after = window.__soldiers(point);
      return after.map((row, i) => ({ ...row, lost: before[i] - row.hp }));
    };
    // Every soldier a blast can reach, and what HP-10 would give him from a
    // given point. The exposure is the thing worth reading back: it is the one
    // term in the splash product that a screenshot cannot show, and a check that
    // wants to prove a wall works needs the same number from both sides of it.
    window.__soldiers = (blast) => {
      const from = Array.isArray(blast) && blast.length === 3 ? blast : null;
      return page.splashTargets().filter(t => t.soldier).map(t => ({
        player: !t.node,
        pose: t.pose,
        hp: Math.round(t.armor.hitPoints * 1000) / 1000,
        max: t.armor.maxHitPoints,
        destroyed: t.armor.destroyed,
        visible: t.node ? t.node.visible : true,
        origin: [Math.round(t.x * 100) / 100, Math.round(t.y * 100) / 100,
                 Math.round(t.z * 100) / 100],
        exposure: from ? page.soldierExposureFor(t, from) : null,
      }));
    };
    // Every floating hull, where it is and where the closed form says it should
    // be: the one readout that says whether a ship is at its own draft. A check
    // asserting the fleet's eight predicted `y` values needs the target beside
    // the measurement, or it is asserting the viewer against itself.
    window.__ships = () => page.floatHosts.map(host => {
      const floats = floatNodesOf(host.node);
      host.node.updateWorldMatrix(true, false);
      return {
        control: host.node.userData?.control ?? host.node.name,
        y: +host.node.matrixWorld.elements[13].toFixed(4),
        target: +equilibriumRootY(floats, page.collider?.waterLevel ?? page.extras?.waterLevel)
          .toFixed(4),
        authoredY: +host.authored[1].toFixed(4),
        nodes: floats.length,
        hullHeight: floats[0]?.hullHeight ?? null,
        relY: +(floats[0]?.offsetY ?? 0).toFixed(3),
        maxLift: floats[0]?.floatMaxLift ?? null,
        minLift: floats[0]?.floatMinLift ?? null,
        x: +host.node.matrixWorld.elements[12].toFixed(3),
        z: +host.node.matrixWorld.elements[14].toFixed(3),
        sinking: !!host.sinking,
      };
    });
    // The helm of whatever ship is occupied: the state that decides how fast she
    // goes and whether she is stuck. `throttle` is the pedal, `revs` is
    // `PhysicsEngine+0xa0` — the value the thrust law actually reads.
    window.__helm = () => {
      if (!page.localPlayer.aircraft || !('revs' in page.localPlayer.aircraft)) return null;
      const s = page.localPlayer.aircraft.state;
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.orientation);
      return {
        throttle: +s.throttle.toFixed(4), revs: +page.localPlayer.aircraft.revs.toFixed(4),
        load: +page.localPlayer.aircraft.load.toFixed(4),
        speed: +s.velocity.length().toFixed(4),
        along: +s.velocity.dot(fwd).toFixed(4),
        heading: +(Math.atan2(fwd.x, fwd.z) * 180 / Math.PI).toFixed(3),
        yawRate: +(s.angularVelocity.y * 180 / Math.PI).toFixed(4),
        x: +s.position.x.toFixed(3), y: +s.position.y.toFixed(3),
        z: +s.position.z.toFixed(3),
        keel: +page.localPlayer.aircraft.keel.toFixed(3), underWater: +page.localPlayer.aircraft.underWater().toFixed(3),
        aground: !!page.localPlayer.aircraft.aground,
        // The RAW bed under her origin. `Ship.groundHeight` now answers the
        // footprint's floor (a synthetic number the clamp reads), so a trace that
        // wants "what is under her" has to ask `bedHeight`.
        seaBed: +(page.localPlayer.aircraft.bedHeight
          ? page.localPlayer.aircraft.bedHeight(s.position.x, s.position.z)
          : page.localPlayer.aircraft.groundHeight(s.position.x, s.position.z)).toFixed(3),
        // The deepest part of her hull that is still under the bed, which after
        // `pushOutOfBed` should be zero on any grounded hull.
        buried: +((page.localPlayer.aircraft.deepestContact?.()?.depth) ?? 0).toFixed(4),
        size: page.localPlayer.aircraft.spec.size.map(n => +n.toFixed(3)),
        inertia: [page.localPlayer.aircraft.inertia.x, page.localPlayer.aircraft.inertia.y, page.localPlayer.aircraft.inertia.z],
        staticContacts: page.bodyWorld?.staticContacts ?? null,
      };
    };
    // The level's deck spawns as the page now holds them: `rebaseDeckSpawns` has
    // moved each one with its hull, and `deckBake` is the extractor's own value
    // beside it. Both, because the whole question is whether the point sits over
    // its ship.
    window.__deckSpawns = () => (page.extras?.vehicleSoldierSpawns || []).map(s => ({
      vehicle: s.vehicle, name: s.name, pad: s.pad, group: s.group, team: s.team,
      position: s.position, bake: s.deckBake ?? null,
    }));
    // Every seat of whatever is occupied, not just the active one: what each is
    // classified as and what it is wired to. `__occupancy` above reports the
    // active seat; this reports the row the number keys walk, which is what a
    // check of seat cycling has to name -- a gun count that changes says
    // something moved, not which seat it moved to.
    window.__seatTable = () => page.localPlayer.occupancy && ({
      control: page.localPlayer.occupancy.root?.userData?.control ?? null,
      rootKind: page.localPlayer.occupancy.rootKind,
      drive: page.localPlayer.occupancy.drive ? page.localPlayer.occupancy.drive.constructor.name : null,
      active: page.localPlayer.occupancy.order.indexOf(page.localPlayer.occupancy.activeSeatId),
      seats: page.localPlayer.occupancy.order.map((id, index) => ({
        index, kind: page.localPlayer.occupancy.seatKind(id),
        node: page.localPlayer.occupancy.seatInfo(id)?.node?.name ?? null,
        fireArms: page.localPlayer.occupancy.seatInfo(id)?.fireArms.length ?? 0,
        engine: page.localPlayer.occupancy.seatInfo(id)?.engineType ?? null,
        axes: Object.keys(page.localPlayer.occupancy.seatInfo(id)?.axes || {}),
      })),
    });
    // Every damageable thing in the level and what it is currently showing, for a
    // headless check: shoot a tank, step frames, read the tier back.
    window.__vehicles = () => [...page.vehicleDamage.byOwner.entries()].map(([owner, v]) => ({
      owner, name: v.name, hp: Math.round(v.hitPoints * 100) / 100,
      max: v.maxHitPoints, critical: v.critical, destroyed: v.destroyed,
      criticalDamage: v.criticalDamage,
      // Where it stands, which is also the point a blast measures its distance
      // to (HP-9: the transform origin, not a bounding box). A check that wants
      // to stand a man beside one, or to know which neighbour a shell should
      // have caught, needs this and has had to guess at it until now.
      pos: page.damageVisuals.get(owner)?.node
        ? page.damageVisuals.get(owner).node.getWorldPosition(page.splashPos).toArray()
          .map(n => Math.round(n * 100) / 100)
        : null,
      tier: v.shown ? { threshold: v.shown.threshold, names: v.shown.names } : null,
      running: page.damageVisuals.get(owner)?.handles.length ?? 0,
      tiers: v.effects.map(e => ({ hp: e.hp, effect: e.effect })),
    }));
    // The land vehicle the player is currently driving, for a headless drive.
    // Reading its state is not enough to *test* one: the renderer manages a
    // couple of frames a second on a real level under SwiftShader, which pins
    // `dt` at the page's 0.1 s clamp and makes a real-time drive meaningless.
    // So this also hands back the two calls `frame()` makes — the same object,
    // the same level collider, the same material map — and a check can step
    // them synchronously at whatever rate it wants.
    window.__drive = () => (page.localPlayer.car ? {
      state: () => ({
        speed: page.localPlayer.car.state.velocity.length(),
        along: page.localPlayer.car.state.velocity.dot(
          new THREE.Vector3(0, 0, -1).applyQuaternion(page.localPlayer.car.state.orientation)),
        position: { ...page.localPlayer.car.state.position },
        velocity: { ...page.localPlayer.car.state.velocity },
        grounded: page.localPlayer.car.state.grounded,
        // Attitude, in degrees: a deck trace has to see the hull pitch up an
        // incline and level off on the pad, and reading that off the orientation
        // quaternion outside the page is needless work.
        pitch: THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1,
          new THREE.Vector3(0, 0, -1).applyQuaternion(page.localPlayer.car.state.orientation).y)))),
        roll: THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1,
          new THREE.Vector3(1, 0, 0).applyQuaternion(page.localPlayer.car.state.orientation).y)))),
        gear: page.localPlayer.car.gear ?? null,
        revs: page.localPlayer.car.revs ?? null,
        wheels: page.localPlayer.car.wheels.map(w => ({
          compression: w.compression, load: w.load,
          friction: w.friction, latched: w.staticGrip, driven: w.driven,
        })),
        // This tick's resolved hull contacts (`body-statics.js` found them, the
        // solver pushed them, `DrivenBody.noteContact` handed them over). The
        // only observable that says "the building answered as a body" rather
        // than "the sweep stopped me", and `normalY` is the whole of why a
        // side-on one brings no friction.
        hullSolved: page.localPlayer.car.hullSolved,
        hullContacts: page.localPlayer.car.hullContacts.map(c => ({
          normalY: c.normalY, friction: c.friction, count: c.count,
          at: [c.x, c.y, c.z],
        })),
      }),
      setInput: (name, value) => page.localPlayer.car.setInput(name, value),
      integrate: dt => page.localPlayer.car.integrate(dt),
      // Stand it somewhere exact, stopped and pointing at a heading — the same
      // job `__teleport` does for the soldier, and needed for the same reason.
      // A measured top speed or brake distance is only a measurement if the
      // run had room: every land spawn on Wake is a few tens of metres from a
      // building or the sea, so a 40-second full-throttle run from one reads
      // the collision sweep rather than the drivetrain. Drops it a little clear
      // of the ground and lets the springs take it, exactly as a spawn does.
      place: (x, y, z, yaw = 0) => {
        page.localPlayer.car.state.position.set(x, y, z);
        page.localPlayer.car.state.velocity.set(0, 0, 0);
        page.localPlayer.car.state.angularVelocity.set(0, 0, 0);
        page.localPlayer.car.state.orientation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        return { ...page.localPlayer.car.state.position };
      },
      // Where the level's heightfield and material map put the ground under a
      // world (x, z): the two functions the drivetrain itself is handed. `fromY`
      // is the drivable-deck reference the wheels pass (their axle plus the step
      // they can mount), so a trace can read the deck a vehicle is riding and the
      // terrain under it separately.
      ground: (x, z, fromY) => ({
        height: page.groundHeight(x, z, fromY),
        friction: page.surfaceFriction(x, z, fromY),
        deck: page.collider?.deckHeight ? page.collider.deckHeight(x, z, fromY) : null,
      }),
      // What the hull sweep meets on a move, and the triangle it meets — the
      // question "why did the tank stop here" has no other answer from outside
      // the page, and a deck that reads as a wall is exactly that question.
      // `deckStepTop`/`deckFloorCos` are the gate; omit them for the ungated view.
      sweep: (dx, dy, dz, dist, deckStepTop = -Infinity, deckFloorCos = 2) => {
        if (!page.collider) return null;
        const len = Math.hypot(dx, dy, dz) || 1;
        const s = page.localPlayer.car.state.position;
        const hit = page.collider.sweepSphere(s.x, s.y, s.z, dx / len, dy / len, dz / len,
          dist, page.localPlayer.car._hullRadius, page.localPlayer.car._collisionOwner, true, deckStepTop, deckFloorCos);
        if (!hit) return null;
        const tris = page.collider.statics?.tris;
        const j = hit.triangle * 9;
        return {
          t: hit.t, owner: hit.owner, triangle: hit.triangle,
          drivable: page.collider.statics?.drivable?.[hit.triangle] === 1,
          name: page.collider.statics?.ownerNodes?.[hit.owner]?.name ?? null,
          point: [hit.px, hit.py, hit.pz],
          normal: [hit.nx, hit.ny, hit.nz],
          vertices: tris && hit.triangle >= 0
            ? [[tris[j], tris[j + 1], tris[j + 2]],
               [tris[j + 3], tris[j + 4], tris[j + 5]],
               [tris[j + 6], tris[j + 7], tris[j + 8]]]
            : null,
          radius: page.localPlayer.car._hullRadius,
        };
      },
    } : null);
    // HP-15, for a headless check: what the occupied hull's damage state is
    // letting through this frame, and what the aim rig is actually scaling by.
    window.__inputGate = () => ({
      blocked: page.vehicleInput.blocked,
      rotationalScale: page.vehicleInput.rotationalScale,
      turretInputScale: page.localPlayer.occupancy?.turret?.inputScale ?? null,
      occupied: page.occupiedVehicleDamage()
        ? { hp: page.occupiedVehicleDamage().hitPoints,
            critical: page.occupiedVehicleDamage().critical,
            destroyed: page.occupiedVehicleDamage().destroyed }
        : null,
    });
    // Hurt one by owner id without having to hit it with a round — the same
    // generic entry point `window.__damage(n)` is for the soldier. Negative heals,
    // the way `SimpleObject::handleDamage` dispatches on the sign of its argument
    // (ledger HP-7).
    // The rigid-body world: one row per simulated vehicle, and a way to step it
    // in a hidden tab the way `__renderOnce` steps everything else.
    window.__bodies = () => (page.bodyWorld ? [...page.bodyWorld.entries.values()].map(e => {
      const b = e.parked ? e.parked.body : e.driven;
      return {
        owner: e.owner, name: page.bodyScene.get(e.owner)?.node?.name, driven: !!e.driven,
        pos: [...b.pos], v: [...b.v], w: [...b.w], sleepiness: b.sleepiness ?? null,
        moved: !!page.bodyScene.get(e.owner)?.moved, hp: page.vehicleDamage.get(e.owner)?.hitPoints ?? null,
      };
    }) : null);
    // Turn the hull-vs-static path off and on, which is the only honest A/B for
    // it: `false` takes the static contacts out of the solver AND puts the drive
    // model back on its own swept sphere, exactly the pair of behaviours that
    // used to be the only one. Called with no argument it just reports.
    window.__hullSolver = on => {
      if (!page.bodyWorld) return null;
      if (on !== undefined) {
        page.bodyWorld.statics = on && page.collider?.statics ? page.collider.staticProbe() : null;
        const driven = page.localPlayer.car || page.localPlayer.aircraft;
        if (driven && 'hullSolved' in driven) driven.hullSolved = !!page.bodyWorld.statics;
      }
      return { solver: !!page.bodyWorld.statics, sweep: !((page.localPlayer.car || page.localPlayer.aircraft)?.hullSolved) };
    };
    // Static-world contacts the last body tick found, for any driven vehicle —
    // the one number that says the hull met the level, for an aircraft as well
    // as a car (an aircraft's drive model has no friction mean to hand them to,
    // so `__drive().hullContacts` cannot answer for it).
    window.__staticContacts = () => page.bodyWorld?.staticContacts ?? null;
    window.__stepBodies = dt => page.stepVehicleBodies(dt);
    // One whole simulation tick for a headless drive: the drive model, then the
    // rigid-body world, in `world.js`'s own order (forces and integration, then
    // contacts detected and resolved — spec section 2). `__drive().integrate`
    // alone steps half of it, and since a driven hull's collisions with the
    // static world moved into the solver that half no longer includes hitting a
    // building. Returns the body world's tick count so a trace can prove the
    // second half actually ran.
    window.__stepSim = (ticks = 1, dt = 1 / 30) => {
      for (let i = 0; i < ticks; i++) {
        (page.localPlayer.car || page.localPlayer.aircraft)?.integrate(dt);
        page.bodyWorld?.tick();
      }
      (page.localPlayer.car || page.localPlayer.aircraft)?.applyTransform();
      return page.bodyWorld?.ticks ?? 0;
    };
    window.__crashLog = () => page.recordCrashes();
    // The aircraft under the player, for a stepped test: inputs, state, a pose.
    window.__plane = () => (page.localPlayer.aircraft ? {
      setInput: (name, value) => page.localPlayer.aircraft.setInput(name, value),
      state: () => ({ position: { ...page.localPlayer.aircraft.state.position }, velocity: { ...page.localPlayer.aircraft.state.velocity },
        grounded: page.localPlayer.aircraft.state.grounded, throttle: page.localPlayer.aircraft.state.throttle }),
      place: (x, y, z, vx, vy, vz) => {
        page.localPlayer.aircraft.state.position.set(x, y, z);
        page.localPlayer.aircraft.state.velocity.set(vx, vy, vz);
        page.localPlayer.aircraft.applyTransform();
        page.snapPresentation();
      },
      integrate: dt => page.localPlayer.aircraft.integrate(dt),
    } : null);
    // The E key. Not the same thing as `__setOnFoot(false)`: the debug toggle
    // calls `Vehicle.reset()`, which teleports the hull back to its spawn pose,
    // while stepping out leaves it standing where its driver left it. A check on
    // anything that depends on where a driven vehicle ENDED UP has to use this.
    window.__exitVehicle = () => {
      if (!(page.localPlayer.aircraft || page.localPlayer.car) || !page.localPlayer.occupancy) return false;
      page.exitVehicle();
      return !page.localPlayer.occupancy;
    };
    window.__wakeBody = owner => { const e = page.bodyWorld?.get(owner); e?.parked?.body.wake(); return !!e?.parked; };
    // Climb into a placed vehicle by owner id, and put the driven one somewhere
    // facing something: what a ramming test needs and a keyboard cannot give.
    window.__enterOwner = owner => {
      const node = page.damageVisuals.get(owner)?.node;
      if (!node) return false;
      page.enterVehicle({ vehicle: node, seatId: null });
      return !!(page.localPlayer.car || page.localPlayer.aircraft);
    };
    // Into a given seat of a given hull through the page's own `enterVehicle`
    // (the E key's path): `node` a hull root, `seatId` one of its seats (null:
    // the root seat). A seat someone holds refuses, as the E key does.
    window.__enterSeat = (node, seatId = null) => {
      if (!node) return false;
      page.enterVehicle({ vehicle: node, seatId });
      return page.localPlayer.occupancy?.root === node
        && (seatId == null || page.localPlayer.occupancy.seatId === seatId);
    };
    // E from whatever seat the player holds, through the page's own exit.
    window.__exitSeat = () => {
      if (!page.localPlayer.occupancy) return false;
      page.exitSeat();
      return !page.localPlayer.occupancy;
    };
    // The hull the local player rides, as its instance sees it: who holds
    // which seat, and the one drive's state.
    window.__hull = () => {
      const seat = page.localPlayer.occupancy;
      if (!seat) return null;
      const s = seat.drive?.state;
      return {
        template: seat.root.userData?.control ?? seat.root.name, seat: seat.seatId,
        seats: Object.fromEntries(seat.instance.seats),
        drive: seat.drive ? seat.drive.constructor.name : null,
        pos: s ? [s.position.x, s.position.y, s.position.z] : null,
        speed: s ? Math.hypot(s.velocity.x, s.velocity.z) : null,
        guns: [...seat.groups.driven, ...seat.groups.manned]
          .map(g => ({ name: g.node.name, firing: g.firing, shots: g.shots })),
      };
    };
    // The occupied vehicle's interior, settled: true once it is grafted, false
    // for a vehicle that has none. A check counting what an entry costs the GPU
    // has to sample after this, or the glb lands in whichever cycle it likes.
    window.__cockpitReady = () =>
      ((page.localPlayer.aircraft || page.localPlayer.car)?.cockpitReady ?? Promise.resolve(null)).then(Boolean);
    // The same for a ship, and it needs its own: a hull is placed at her DRAFT
    // rather than on the ground, and the yaw is what a beaching run needs (thrust
    // runs along the hull's forward axis, so a test that cannot point her cannot
    // aim her at a shore).
    window.__placeShip = (x, z, yaw, speed = 0) => {
      if (!page.localPlayer.aircraft || !('revs' in page.localPlayer.aircraft)) return null;
      const s = page.localPlayer.aircraft.state;
      const floats = floatNodesOf(page.localPlayer.aircraft.node);
      const water = page.collider?.waterLevel ?? page.extras?.waterLevel;
      const y = floats.length && Number.isFinite(water)
        ? equilibriumRootY(floats, water) : s.position.y;
      s.position.set(x, Number.isFinite(y) ? y : s.position.y, z);
      s.orientation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.orientation);
      s.velocity.copy(fwd).multiplyScalar(speed);
      s.angularVelocity.set(0, 0, 0);
      page.localPlayer.aircraft.revs = 0;
      page.localPlayer.aircraft.load = 0;
      page.localPlayer.aircraft.loadCount = 0;
      page.localPlayer.aircraft.applyTransform();
      page.snapPresentation();
      return window.__helm();
    };
    window.__placeCar = (x, z, yaw, speed = 0) => {
      if (!page.localPlayer.car) return null;
      const s = page.localPlayer.car.state;
      s.position.set(x, page.groundHeight(x, z) + 0.6, z);
      s.orientation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(s.orientation);
      s.velocity.copy(fwd).multiplyScalar(speed);
      s.angularVelocity.set(0, 0, 0);
      page.localPlayer.car.applyTransform();
      page.snapPresentation();
      return { forward: [fwd.x, fwd.y, fwd.z] };
    };
    window.__damageVehicle = (owner, amount) => {
      const vehicle = page.vehicleDamage.get(owner);
      if (!vehicle) return null;
      if (amount > 0) vehicle.damage(amount);
      else vehicle.heal(-amount);
      const result = vehicle.update(0);
      if (result.changed) page.showDamageTier(vehicle, result.tier);
      if (result.died) page.wreckVehicle(vehicle);
      return { hp: vehicle.hitPoints, destroyed: vehicle.destroyed,
               tier: vehicle.shown };
    };
    window.__matrixDrift = () => {
      const local = new THREE.Matrix4();
      const expect = new THREE.Matrix4();
      let worst = 0, checked = 0, worstName = null;
      const walk = (obj, parentWorld) => {
        if (obj.matrixAutoUpdate) local.compose(obj.position, obj.quaternion, obj.scale);
        else local.copy(obj.matrix);
        if (obj === page.vmRoot) expect.copy(page.camera.matrixWorld);
        else if (parentWorld) expect.multiplyMatrices(parentWorld, local);
        else expect.copy(local);
        const a = expect.elements, b = obj.matrixWorld.elements;
        for (let i = 0; i < 16; i++) {
          const d = Math.abs(a[i] - b[i]);
          if (d > worst) { worst = d; worstName = obj.name || obj.type; }
        }
        checked++;
        const here = expect.clone();
        for (const child of obj.children) walk(child, here);
      };
      walk(page.scene, null);
      walk(page.vmScene, null);
      return { worst, checked, worstName, frozen: page.frozenCount };
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
