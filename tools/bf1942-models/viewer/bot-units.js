// The vehicles the page's bots can see and take: the referee's `units` layer
// (bot-referee.js) over the page's own vehicles.
//
// The Change behaviour (bot-vehicle.js) weighs every free door of every
// enterable unit the level ships AI data for (`vehicle-ai.json`); a bot that
// takes one holds a seat of the hull's one `VehicleInstance` exactly as the
// human does (`vehicle-instance.js`): its drive when it takes the root seat
// of a drivable hull, fed by its input word through `World.#vehicleTick`.
// Without the camera, the HUD or the cockpit -- those are the human's.

import * as THREE from 'three';
import { classifyRoot, surveyVehicle, seatYawLimits } from './seats.js';
import { buildNavMap } from './nav-grid.js';

/** The body radius a land vehicle keeps on its map, and a plane's or ship's
 *  for its arrival circle (INVENTION). */
export const BOT_VEHICLE_RADIUS = 3.0;
export const BOT_VEHICLE_RADIUS_LARGE = 10.0;

/**
 * `env`:
 *  - `world()`, `referee()` (for its clock), `vehicles` (the VehicleRegistry);
 *  - `aiUrl()`: where `vehicle-ai.json` is;
 *  - `entryPoints()`: every door of every vehicle on the level, collected
 *    (the human's own `collectEntryPoints` list), and `recollect()`;
 *  - `currentRoot()`, `vehicleSpawnActive(node)`, `collider()`;
 *  - `localPlayerId`: the human's id, so a hull he drives is not "moved by a bot".
 */
export function createBotUnits(env) {
  const units = {
    /** Every vehicle's AI plug-in data (`extract_vehicle_ai.py`), by template. */
    ai: null,
    aiLoading: null,
    /** The land vehicles' map, built on first use. */
    navVehicle: null,
    /** The boats' and landing craft's maps, by name, built on first use. */
    navWater: new Map(),
    candidateCache: { at: -1, list: [] },
    entriesCollectedAt: -Infinity,
  };
  const kinds = new Map();
  const seatSurveys = new WeakMap();
  const _entryWorld = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _quat = new THREE.Quaternion();
  const clock = () => env.referee()?.clock ?? 0;

  units.loadAi = () => {
    if (units.ai || units.aiLoading) return units.aiLoading;
    units.aiLoading = fetch(env.aiUrl())
      .then(r => (r.ok ? r.json() : null))
      .then(json => {
        units.ai = new Map();
        for (const [name, info] of Object.entries(json?.vehicles ?? {})) units.ai.set(name.toLowerCase(), { name, ...info });
        return units.ai;
      })
      .catch(() => (units.ai = new Map()));
    return units.aiLoading;
  };

  /** Every object template that names a record: the record's own key and
   *  each seat's PlayerControlObject (`seatsAi` / `seats`), lower case. */
  let objectIndex = null, indexedFrom = null;
  const recordsByObject = () => {
    if (objectIndex && indexedFrom === units.ai) return objectIndex;
    objectIndex = new Map();
    indexedFrom = units.ai;
    for (const [key, rec] of units.ai ?? []) {
      objectIndex.set(key, rec);
      for (const pco of Object.keys(rec.seatsAi ?? rec.seats ?? {})) {
        const k = pco.toLowerCase();
        if (!objectIndex.has(k)) objectIndex.set(k, rec);
      }
    }
    return objectIndex;
  };

  /**
   * The AI record of a vehicle root node, or null when the game ships none.
   * The engine links an object to its AI by the object template's own
   * `ObjectTemplate.aiTemplate` line (`SimpleObject::SimpleObject` 0x081da0d0
   * reads the template's name at +0x10c and asks `AITemplateManager::
   * getTemplate` 0x0848a470 at 0x081da28f), never by the folder the record
   * was extracted from: the node `flak38` is the PCO `flak38` of the record
   * `Flak_38`, whose AI template is `Flak38`.
   */
  units.aiOf = node => {
    if (!units.ai) return null;
    const raw = node?.userData?.template ?? node?.userData?.control ?? node?.name ?? '';
    const key = String(raw).replace(/_\d+$/, '').toLowerCase();
    return recordsByObject().get(key) ?? null;
  };

  /** A vehicle root's drive kind, surveyed once. */
  units.kindOf = node => {
    let kind = kinds.get(node);
    if (kind === undefined) {
      kind = classifyRoot ? classifyRoot(node) : null;
      kinds.set(node, kind ?? null);
    }
    return kind;
  };

  /** The land vehicles' map (`ai.addSearchMap Tank0 ...`), built on first use. */
  units.vehicleNav = () => {
    const world = env.world();
    if (units.navVehicle || !world) return units.navVehicle;
    const worldSize = world.extras?.worldSize || 2048;
    const sm = (world.extras?.ai?.searchMaps ?? []).find(m => /^Tank/i.test(m.name)) ?? null;
    const seeds = [];
    for (const spawn of world.extras?.objectSpawns ?? []) {
      if (spawn?.position) seeds.push([spawn.position[0], spawn.position[2]]);
    }
    for (const flag of world.flags ?? []) {
      for (const spawn of flag.spawns ?? []) if (spawn?.position) seeds.push([spawn.position[0], spawn.position[2]]);
    }
    const started = performance.now();
    units.navVehicle = buildNavMap(world.collider, worldSize, {
      waterLevel: world.collider?.waterLevel,
      waterDepth: sm?.waterDepth ?? 0.0,
      maxSlopeDeg: sm?.maxSlope ?? 30,
      brush: sm?.brush ?? 3.0,
      lowClip: sm?.lowClip ?? 0.3,
      hiClip: sm?.hiClip ?? 2.5,
      seeds,
    });
    console.log(`[bots] vehicle nav map (${sm?.name ?? 'Tank defaults'}): ${(performance.now() - started).toFixed(0)} ms`);
    return units.navVehicle;
  };

  /** The boats' and landing craft's maps (`ai.addSearchMap Boat2 1 ...` /
   *  `LandingCraft3`), built on first use: the water at least the map's depth
   *  deep, the shore kept off by the brush. */
  units.waterNav = (name = 'Boat') => {
    const world = env.world();
    if (!world) return null;
    if (units.navWater.has(name)) return units.navWater.get(name);
    const maps = world.extras?.ai?.searchMaps ?? [];
    const re = new RegExp('^' + name, 'i');
    const sm = maps.find(m => re.test(m.name) && m.waterMap) ?? maps.find(m => re.test(m.name)) ?? null;
    if (!sm) { units.navWater.set(name, null); return null; }
    const worldSize = world.extras?.worldSize || 2048;
    const seeds = [];
    for (const spawn of world.extras?.objectSpawns ?? []) if (spawn?.position) seeds.push([spawn.position[0], spawn.position[2]]);
    const started = performance.now();
    const nav = buildNavMap(world.collider, worldSize, {
      waterLevel: world.collider?.waterLevel,
      waterMap: true,
      waterDepth: sm.waterDepth ?? 5.0,
      maxSlopeDeg: sm.maxSlope ?? 0,
      brush: sm.brush ?? 125.0,
      lowClip: sm.lowClip ?? 0.3,
      hiClip: sm.hiClip ?? 2.5,
      seeds,
    });
    console.log(`[bots] water nav map (${sm.name}): ${(performance.now() - started).toFixed(0)} ms`);
    units.navWater.set(name, nav);
    return nav;
  };

  /** Who holds a seat, human or bot: the hull's instance answers. */
  units.seatHolder = (node, seatId) => env.vehicles.holder(node, seatId);
  units.driverOf = node => env.vehicles.driverOf(node);

  /**
   * A hull's local bounding box, `{ min, max }` in its own frame, measured
   * once over its meshes (`AIObjectPhysical::getLocalBoundingBox`
   * 0x085d6820, the box `BBChange::runwayClear` 0x0855f850 and
   * `BBAvoid::calculateUrgency` 0x0855c650 read). The viewer's node frame
   * has z negated from the engine's; the extents are the same.
   */
  const localBoxes = new WeakMap();
  const _inv = new THREE.Matrix4();
  const _m = new THREE.Matrix4();
  const _b = new THREE.Box3();
  units.localBox = node => {
    let box = localBoxes.get(node);
    if (box) return box;
    node.updateWorldMatrix(true, true);
    _inv.copy(node.matrixWorld).invert();
    const out = new THREE.Box3();
    node.traverse(o => {
      const g = o.isMesh ? o.geometry : null;
      if (!g) return;
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingBox || g.boundingBox.isEmpty()) return;
      _b.copy(g.boundingBox).applyMatrix4(_m.multiplyMatrices(_inv, o.matrixWorld));
      out.union(_b);
    });
    box = out.isEmpty() ? { min: [-2, 0, -3], max: [2, 2, 3] }
      : { min: [out.min.x, out.min.y, out.min.z], max: [out.max.x, out.max.y, out.max.z] };
    localBoxes.set(node, box);
    return box;
  };

  /** Each hull's seat survey, for a seat's traverse limits (static per node). */
  units.seatYawLimits = (node, seatId) => {
    let survey = seatSurveys.get(node);
    if (!survey) { survey = surveyVehicle(node); seatSurveys.set(node, survey); }
    return seatYawLimits(survey.seats.get(seatId));
  };

  /**
   * The seats a bot may take right now (`BBChange`'s environment list): every
   * door of every enterable unit with AI data -- a land vehicle's driver seat,
   * its gunner and passenger seats, a fixed gun -- with the seat's own AI
   * numbers (`vehicle-ai.json` `seatsAi`): the guns it reaches, its strategic
   * strength, and the hull's `maxSpeed` when the seat drives or rides a driven
   * hull. Rebuilt twice a second and shared by every bot (the engine's
   * environment query, INVENTION radius).
   */
  units.candidates = () => {
    const now = clock();
    if (now - units.candidateCache.at < 0.5) return units.candidateCache.list;
    // The vehicles land after the bots do, and respawn later: the door list
    // is recollected while empty and every ten seconds.
    let entryPoints = env.entryPoints(false);
    if (!entryPoints || ((!entryPoints.length || now - units.entriesCollectedAt > 10) && env.currentRoot())) {
      entryPoints = env.entryPoints(true);
      units.entriesCollectedAt = now;
    }
    const list = [];
    const collider = env.collider();
    const world = env.world();
    if (entryPoints && units.ai) {
      const byNode = new Map();
      for (const e of entryPoints) {
        if (!byNode.has(e.vehicle)) byNode.set(e.vehicle, []);
        byNode.get(e.vehicle).push(e);
      }
      for (const [node, doors] of byNode) {
        if (!env.vehicleSpawnActive(node)) continue;
        const kind = units.kindOf(node);
        if (!['ground', 'tank', 'gun', 'air', 'ship'].includes(kind)) continue;
        const ai = units.aiOf(node);
        if (!ai) continue;
        const owner = collider?.statics?.ownerOf(node) ?? -1;
        const damage = world?.vehicleDamage?.get(owner) ?? null;
        if (damage?.destroyed) continue;
        node.getWorldPosition(_entryWorld);
        const pos = [_entryWorld.x, _entryWorld.y, _entryWorld.z];
        _up.set(0, 1, 0).applyQuaternion(node.getWorldQuaternion(_quat));
        const upright = _up.y >= 0.6914;
        // The hull's heading, for a seat's traverse limits (its -z column).
        const hullYaw = Math.atan2(-node.matrixWorld.elements[8], -node.matrixWorld.elements[10]);
        const rootId = node.userData?.control || node.name || 'vehicle';
        const driver = units.driverOf(node);
        const health = damage?.maxHitPoints > 0 ? damage.hitPoints / damage.maxHitPoints : 1;
        const seen = new Set();
        // Every seat of the hull with its table and occupancy: the shares
        // `calculateFireStrength` adds and the seat swap's alternatives.
        const seats = [];
        const entries = [];
        for (const door of doors) {
          if (seen.has(door.seatId)) continue;
          seen.add(door.seatId);
          const isRoot = door.seatId === rootId;
          const seatAi = ai.seatsAi?.[door.seatId] ?? (isRoot ? ai.seatsAi?.[ai.name] : null) ?? null;
          const weapons = Object.entries(seatAi?.aiWeapons ?? (isRoot ? ai.aiWeapons : {}) ?? {})
            .map(([name, w]) => ({ ...w, name }));
          const strengths = {};
          for (const w of weapons) for (const [k, v] of Object.entries(w.strength ?? {})) strengths[k] = Math.max(strengths[k] ?? 0, v ?? 0);
          const drives = isRoot && kind !== 'gun';
          // `BBChange::modifyForDriver` 0x0855f7d0 over the root's type word
          // (`Information+4`, the `aiTemplate.addType` bits: ITAir 0x10,
          // ITGround 0x20, ITNaval 0x40 by the enum's parse at 0x084854eb..):
          // 1 while the root is occupied; else a naval root's seats 1, a
          // ground root's 0.77, an air root's 0.5. It scales the seat's whole
          // `calculateVehicleUrgency` (0x0855e0c0 multiplies the result).
          const holder = units.seatHolder(node, door.seatId);
          const rootTypes = ai.types ?? [];
          const seatFactor = isRoot || driver ? 1
            : rootTypes.includes('ITNaval') ? 1
            : rootTypes.includes('ITGround') ? 0.77
            : rootTypes.includes('ITAir') ? 0.5
            : (kind === 'air' ? 0.5 : kind === 'ship' ? 1 : 0.77);
          door.node.getWorldPosition(_entryWorld);
          seats.push({ seatId: door.seatId, table: strengths, occupied: !!holder, strType: ai.strType ?? 'LightArmour', isRoot });
          entries.push({
            id: `${node.uuid}:${door.seatId}`, vehicleId: node.uuid, node, template: ai.name, kind,
            seatId: door.seatId, isRoot, drives, seats, turnRadius: ai.turnRadius ?? null,
            pos, entry: [_entryWorld.x, _entryWorld.z], entryRadius: door.radius,
            health, upright,
            // `calculateVehicleMoveUrgency`: a driver moves the hull; a passenger
            // moves only when someone drives it (x2.5 of the bot driver's when
            // its order differs -- the driver's order is taken as the same).
            maxSpeed: drives ? (ai.maxSpeed ?? 0) : (driver ? (ai.maxSpeed ?? 0) : 0),
            movedByBot: !drives && !!driver && driver !== env.localPlayerId,
            strengths, weapons,
            // The seat's Armament `setIsAntiAircraft` (`IPIArmamentReal::
            // isAntiAircraft` 0x085e9b00): the fire scoring's AA rules.
            antiAircraft: !!(seatAi?.isAntiAircraft ?? (isRoot && ai.isAntiAircraft)),
            // The seat's ControlInfo aim numbers (`mouseControlLookAtDirection`
            // 0x08627b90; bot-aim.js `lookAtCounts`).
            controlInfo: seatAi?.controlInfo ?? (isRoot ? ai.controlInfo : null) ?? null,
            // `Information+0x14`, which `calculateVehicleUrgency` 0x08583b10
            // adds to the unit's urgency (`fadds 0x14(%esi)` at 0x08583c34):
            // the seat's own `aiTemplate.basicTemp` (ConsoleClass489
            // 0x084ffe60 writes `AITemplate+0x14`; the `InformationReal` ctor
            // 0x085e8730 copies it). Not a strategic strength: those are the
            // SAI's (`AISettings::getNStrategicStrengths` 0x084843e0 = 2).
            value: seatAi?.basicTemp ?? (isRoot ? ai.basicTemp : null) ?? 0,
            seatFactor,
            // `setUseNoPathfindingToGetToObject` (AITemplateUnit +0x15): the
            // Change test is a trace 12 m behind the unit, not its own cell.
            noPathfinding: !!(seatAi?.useNoPathfinding ?? (isRoot && ai.useNoPathfinding)),
            occupiedBy: holder,
            strType: ai.strType ?? 'LightArmour',
            driver,
            // `validateCameraDirection` for this seat: its own traverse.
            hullYaw, yawLimits: units.seatYawLimits(node, door.seatId),
            // The hull's AI type words (`aiTemplate.addType`), its local box
            // and physics mass: the runway and collision tests read them.
            types: seatAi?.types ?? (isRoot ? ai.types : null) ?? [], hullTypes: ai.types ?? [],
            localBox: units.localBox(node), mass: node.userData?.physics?.mass ?? null,
          });
        }
        for (const e of entries) list.push(e);
      }
    }
    units.candidateCache = { at: now, list };
    return list;
  };

  units.invalidate = () => { units.candidateCache.at = -1; };

  /** The controller's record of a seat taken (`BotController.mount`). */
  function mountRecord(cand, seat) {
    const inst = seat.instance;
    const node = inst.root;
    const ai = units.aiOf(node);
    const landingCraft = /lcvp|daihatsu|landing/i.test(ai?.name ?? '');
    const drive = seat.isActiveRoot() ? inst.drive : null;
    const nav = drive && ['ground', 'tank'].includes(inst.rootKind) ? units.vehicleNav()
      : drive && inst.rootKind === 'ship' ? units.waterNav(landingCraft ? 'LandingCraft' : 'Boat') : null;
    return {
      id: cand.id, vehicleId: cand.vehicleId, node, drive, occupancy: seat, kind: inst.rootKind,
      seatId: seat.seatId, drives: !!drive,
      // The seat's groups, live: the instance re-collects them on a seat swap.
      get groups() { return seat.groups.driven; },
      get manned() { return seat.groups.manned; },
      nav,
      // A helm routed on the landing craft's map orders as one (the SAI's
      // `LandingCraft` search type).
      landingCraft: !!nav && nav === units.navWater.get('LandingCraft'),
      turnRadius: ai?.turnRadius ?? null, strType: cand.strType, seats: cand.seats, isRoot: cand.isRoot,
      // The hull's own velocity: its one drive, whoever holds the wheel.
      hullVelocity: () => inst.drive?.state?.velocity ?? null,
      radius: inst.rootKind === 'air' || inst.rootKind === 'ship' ? BOT_VEHICLE_RADIUS_LARGE : BOT_VEHICLE_RADIUS,
      maxSpeed: cand.maxSpeed,
      weapons: cand.weapons, template: cand.template, antiAircraft: !!cand.antiAircraft,
      controlInfo: cand.controlInfo ?? null,
      // A rider's move term follows whoever drives the hull right now.
      hullMaxSpeed: ai?.maxSpeed ?? 0,
      driverOf: () => env.vehicles.driverOf(node),
    };
  }

  /**
   * Seat a bot. The hull's instance does the rest: the drive built when he
   * takes the root seat of a drivable hull (a helm that builds none refuses
   * him), the body adopted, the seat's guns collected, the world's record
   * mounted and the hull sounding, exactly as for the human.
   */
  units.enter = (bot, cand) => {
    const node = cand.node;
    if (!node || !env.currentRoot()) return null;
    if (env.vehicles.holder(node, cand.seatId) != null) return null;
    const seat = env.vehicles.enter(node, cand.seatId, bot.playerId, { requireDrive: !!cand.drives });
    return seat ? mountRecord(cand, seat) : null;
  };

  /** Give the seat back; returns where the body stands up beside: the hull's
   *  own simulated position when it has a drive, else its node's. */
  units.leave = bot => {
    const seat = env.vehicles.seatOf(bot.playerId);
    const drive = seat?.drive ?? null;
    let p;
    if (drive) {
      const s = drive.state.position;
      p = { x: s.x, y: s.y, z: s.z };
    } else {
      bot.vehicle.node.getWorldPosition(_entryWorld);
      p = { x: _entryWorld.x, y: _entryWorld.y, z: _entryWorld.z };
    }
    // The seat goes back to the hull: its guns released, the world's record
    // cleared, the audio claim dropped; the last one out parks the hull where
    // it stands (`vehicle-instance.js`).
    env.vehicles.leave(bot.playerId);
    return p;
  };

  units.switchSeat = (bot, cand) => {
    const seat = env.vehicles.switchSeat(bot.playerId, cand.seatId);
    return seat ? mountRecord(cand, seat) : null;
  };

  /** The hull the world bills damage to for this seat (`nodeOwners`), not the
   *  collider's owner of the node: an aircraft's differs. */
  units.destroyed = bot => !!env.world()?.occupiedDamageable?.(bot.playerId)?.destroyed;

  /** Who killed his hull: the attacker of the lethal hit, whom
   *  `GameServer::_giveDamage` credits with each crewman's death (lnxded
   *  0x0814c122; `vehicle-damage.js` `killedBy`). Null for a hull that died
   *  with nobody behind it, which the referee prints as `is no more`. */
  units.attackerOf = bot => env.world()?.occupiedDamageable?.(bot.playerId)?.killedBy ?? null;

  units.seatOf = playerId => {
    const seat = env.vehicles.seatOf(playerId);
    return seat ? { vehicleId: seat.root.uuid, seatId: seat.seatId } : null;
  };

  /** A seated player's hull with every seat, for `scoreVehicleTargets`. */
  units.unitInfo = playerId => {
    const world = env.world();
    const p = world?.player(playerId);
    const seat = env.vehicles.seatOf(playerId);
    if (!p || !seat) return null;
    const node = seat.root;
    const cands = units.candidates().filter(c => c.vehicleId === node.uuid);
    const ai = units.aiOf(node);
    const kind = units.kindOf(node);
    const c = cands.find(x => x.seatId === seat.seatId) ?? cands[0] ?? null;
    const box = new THREE.Box3().setFromObject(node);
    const ext = box.isEmpty() ? [4, 2, 6] : [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
    return {
      type: c?.strType ?? ai?.strType ?? p.vehicleStrType ?? 'LightArmour', air: kind === 'air',
      table: c?.strengths ?? {}, maxSpeed: ai?.maxSpeed ?? 0,
      seats: c?.seats ?? cands.map(x => ({ seatId: x.seatId, table: x.strengths, occupied: !!x.occupiedBy, strType: x.strType })),
      enemyManned: true, mobile: kind !== 'gun', vehicle: true, large: kind === 'ship', extents: ext,
    };
  };

  /**
   * A level change (`level-load.js` `show()`, through the page's
   * `resetBots`): every map and door goes with the old scene. The maps are
   * the old level's ground and would route the next level's hulls on it; the
   * candidate list holds the old scene's nodes, and its clock is the old
   * referee's, which starts again at 0, so without this the cache would read
   * as fresh until the new clock passed the old one. The drive kinds are
   * keyed by the old nodes. The AI records stay: they are the mod's
   * (`_shared/vehicle-ai.json`), and the mod is fixed for the page.
   */
  units.reset = () => {
    units.navVehicle = null;
    units.navWater.clear();
    units.candidateCache = { at: -1, list: [] };
    units.entriesCollectedAt = -Infinity;
    kinds.clear();
  };

  return units;
}
