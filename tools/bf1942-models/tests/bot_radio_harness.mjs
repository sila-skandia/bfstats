// Headless checks of what the bots do with every radio message they hear,
// of an engineer's wrench on a friendly hull, and of a ship bot answering a
// request for its seat (viewer/bot-radio.js, bot-decision.js,
// bot-behaviours.js, bot-mount.js, bot-vehicle.js, bot-plans.js,
// bot-referee.js). Prints one JSON object; `tests/test_bot_radio.py` reads it.

import { RM, RADIO_MESSAGE_IDS, SUBSCRIBE_DEFAULT, createAIRadio, parseRadioCon, subscriptionsFor, subscriptionsFrom,
         fireRadioFactor, moveRadioFactor, scoutRadioFactor, coverRadioFactor, medicRadioFactors, radioOf }
  from '../viewer/bot-radio.js';
import { urgencyMoveTo, urgencyFire, urgencyScout, urgencyTakeCover, urgencySpecial, friendlyHulls }
  from '../viewer/bot-decision.js';
import { MedicState, ScoutState, MEDIC, QUADRANTS } from '../viewer/bot-behaviours.js';
import { teleportChangeUrgency, TELEPORT } from '../viewer/bot-vehicle.js';
import { urgencyChangeTeleport, planChange } from '../viewer/bot-mount.js';
import { PLAN_ACTION, executeAction, planSpecial, healPlanDone } from '../viewer/bot-plans.js';
import { REPAIR_PACK, repairPackTarget } from '../viewer/healing-packs.js';
import { createBotReferee } from '../viewer/bot-referee.js';
import { World, WORLD_TICK_DT } from '../viewer/world.js';
import { BotController } from '../viewer/bot.js';
import { Armor } from '../viewer/armor.js';

const out = {};
const str = m => id => m[id] ?? 0;
const radio = m => ({ strength: (_bot, id) => m[id] ?? 0 });

// --- the five products ----------------------------------------------------------
out.factors = {
  quiet: [fireRadioFactor(str({})), moveRadioFactor(str({})), scoutRadioFactor(str({})), coverRadioFactor(str({}))],
  fire: fireRadioFactor(str({ [RM.Fire]: 0.8 })),
  coverMe: fireRadioFactor(str({ [RM.CoverMe]: 0.8 })),
  holdFire: fireRadioFactor(str({ [RM.HoldFire]: 0.8 })),
  fireAll: fireRadioFactor(str({ [RM.Fire]: 0.5, [RM.CoverMe]: 0.25, [RM.HoldFire]: 0.2 })),
  // A shout from 35 m: 1.6, and `1 - s` is negative, as the engine's.
  holdFireNear: fireRadioFactor(str({ [RM.HoldFire]: 1.6 })),
  go: moveRadioFactor(str({ [RM.Go]: 0.8 })),
  holdPosition: moveRadioFactor(str({ [RM.HoldPosition]: 0.8 })),
  wait: moveRadioFactor(str({ [RM.Wait]: 0.8 })),
  moveAll: moveRadioFactor(str({ [RM.Go]: 0.5, [RM.HoldPosition]: 0.25, [RM.Wait]: 0.2 })),
  six: scoutRadioFactor(str({ [RM.CheckYourSix]: 0.8 })),
  spotted: [15, 16, 17, 18, 19, 20, 21].map(id => scoutRadioFactor(str({ [id]: 0.8 }))),
  scoutAll: scoutRadioFactor(str({ [RM.CheckYourSix]: 0.5, [RM.ArmorSpotted]: 0.5, [RM.ScoutSpotted]: 0.5 })),
  takeCover: coverRadioFactor(str({ [RM.TakeCover]: 0.8 })),
  medic: medicRadioFactors(str({ [RM.Medic]: 0.8, [RM.NeedRepairs]: 0.4 })),
  // Subscribed and read by nothing.
  fireInHole: [fireRadioFactor, moveRadioFactor, scoutRadioFactor, coverRadioFactor].map(f => f(str({ [RM.FireInHole]: 0.8 }))),
  ids: RM,
};

// --- radio.con ------------------------------------------------------------------
{
  const vanilla = ['RMArmorSpotted', 'RMInfantrySpotted', 'RMUnitSpotted', 'RMShipSpotted', 'RMSubmarineSpotted',
                   'RMAirplaneSpotted', 'RMScoutSpotted', 'RMLocalWait', 'RMLocalGo', 'RMLocalFireInHole', 'RMLocalTakeCover',
                   'RMLocalBailOut', 'RMLocalGetIn', 'RMLocalCheckYourSix', 'RMLocalAbandonShip', 'RMLocalCoverMe',
                   'RMLocalHoldPosition', 'RMLocalHoldFire', 'RMLocalFire', 'RMLocalMedic', 'RMLocalNeedRepairs'];
  const text = vanilla.map(n => `aiRadio.subscribeToMessage ${n}\t10\t0.8`).join('\r\n') + '\r\nrem aiRadio.subscribeToMessage RMRoger\r\n';
  const table = parseRadioCon(text);
  const gc = parseRadioCon(['RMFirstRadioSpotted', ...vanilla].map(n => `aiRadio.subscribeToMessage ${n}`).join('\n'));
  const builtIn = subscriptionsFor('bf1942'), builtGc = subscriptionsFor('gcmod');
  out.con = {
    ids: [...table.keys()].sort((a, b) => a - b),
    record: table.get(RM.HoldFire),
    builtIn: [...builtIn.keys()].sort((a, b) => a - b),
    builtRecord: builtIn.get(RM.HoldFire),
    gcIds: [...gc.keys()].sort((a, b) => a - b),
    gcRecord: gc.get(RM.HoldFire),
    builtGc: [...builtGc.keys()].sort((a, b) => a - b),
    builtGcRecord: builtGc.get(RM.HoldFire),
    twoArgs: parseRadioCon('aiRadio.subscribeToMessage RMLocalGo 4').get(RM.Go),
    names: RADIO_MESSAGE_IDS,
    default: SUBSCRIBE_DEFAULT,
    fromRows: [...(subscriptionsFrom([{ id: 37, a: 0.25, b: 0.6 }, { id: 'x', a: 1, b: 1 }]) ?? [])],
    fromNothing: subscriptionsFrom(null),
  };
  // A level's own table replaces the built-in one and keeps what was heard.
  const r = createAIRadio();
  const bots = [{ playerId: 'b', team: 1, position: [70, 0, 0] }];
  r.send(RM.Fire, { team: 1, at: [0, 0, 0], bots });
  const rows = [{ id: RM.HoldFire, a: 0.5, b: 0.25 }];
  const took = r.subscribe(rows);
  r.send(RM.HoldFire, { team: 1, at: [0, 0, 0], bots });
  r.send(RM.Go, { team: 1, at: [0, 0, 0], bots });
  out.subscribe = { took, source: r.source === rows, fireKept: r.strength('b', RM.Fire), holdFire: r.strength('b', RM.HoldFire),
                    goDropped: r.strength('b', RM.Go), refused: createAIRadio().subscribe(null) };
  // "Ship spotted" is never heard: the parser files it under 17.
  const v = createAIRadio();
  v.send(RM.ShipSpotted, { team: 1, at: [0, 0, 0], bots });
  v.send(RM.UnitSpotted, { team: 1, at: [0, 0, 0], bots });
  out.shipSpotted = { ship: v.strength('b', RM.ShipSpotted), unit: v.strength('b', RM.UnitSpotted) };
}

// --- the generators --------------------------------------------------------------
{
  const mover = (strengths, vehicle = null) => ({
    playerId: 'me', position: [0, 0, 0], changedTarget: {}, vehicle, radio: radio(strengths),
    waypoints: { urgency: () => 1.5 }, _pathRadius: () => 1, _pathFailures: 0, route: null,
  });
  const move = (strengths, vehicle) => { const b = mover(strengths, vehicle); return [urgencyMoveTo(b, 2), b._orderUrgency]; };
  out.moveTo = {
    quiet: move({}),
    go: move({ [RM.Go]: 0.8 }),
    holdPosition: move({ [RM.HoldPosition]: 0.8 }),
    wait: move({ [RM.Wait]: 0.8 }),
    near: move({ [RM.HoldPosition]: 1.6 }),
    // A seat that does not drive (`BBMoveToFixed`): 0, the product published.
    fixed: move({ [RM.HoldPosition]: 0.8 }, { drives: false }),
    noRadio: (() => { const b = mover({}); b.radio = null; return urgencyMoveTo(b, 2); })(),
  };
  const shooter = (strengths, t) => ({
    playerId: 'me', changedTarget: {}, firingTarget: null, radio: radio(strengths),
    _chooseFiringTarget: () => t,
  });
  const armed = { targetId: 'foe', targetPos: [1, 0, 0], visible: true, score: 3, weaponIndex: 0, urgency: 2 };
  const unarmed = { targetId: 'foe', targetPos: [1, 0, 0], visible: true, score: 3, weaponIndex: 0, urgency: 0, inclination: 2 };
  const fire = (strengths, t = armed) => { const b = shooter(strengths, t); return [urgencyFire(b, 1.5, 0), b._fireInclinationAdd]; };
  out.fire = {
    quiet: fire({}),
    fire: fire({ [RM.Fire]: 0.8 }),
    coverMe: fire({ [RM.CoverMe]: 0.8 }),
    holdFire: fire({ [RM.HoldFire]: 0.8 }),
    // `BBFireUnarmed`: urgency 0, the threat it adds to the inclination scaled.
    unarmedHold: fire({ [RM.HoldFire]: 0.8 }, unarmed),
  };
  // Scout and TakeCover hand the product to their state.
  const seen = {};
  const scout = {
    playerId: 'me', position: [0, 0, 0], yaw: 0, pitch: 0, quadInertia: new Float32Array(QUADRANTS), changedTarget: {},
    world: { players: new Map() }, radio: radio({ [RM.CheckYourSix]: 0.8, [RM.InfantrySpotted]: 0.5 }),
    senses: { attackers: new Map(), heard: new Map(), incoming: [], spottedEnemies: () => [] },
    scout: { evaluate: ctx => { seen.scout = ctx.radio; return { urgency: 0.5, dir: null, changed: false }; } },
    cover: { evaluate: ctx => { seen.cover = ctx.radio; return { urgency: 0.25 }; } },
    _nav: () => null, _coverCandidates: () => [], _lineClear: () => true,
  };
  urgencyScout(scout, 1, 0, 0.1);
  scout.radio = radio({ [RM.TakeCover]: 0.8 });
  urgencyTakeCover(scout, 1, 0);
  out.handed = seen;
  // The Scout state itself: the same look with and without a call.
  // (The look's direction is jittered by `Math.random`, and a look the bot
  // already faces scores 0: pinned at no jitter, facing away.)
  const look = (factor) => {
    const s = new ScoutState();
    s.accum = 1;
    const random = Math.random;
    Math.random = () => 0.5;
    try {
      return Math.max(...[0, Math.PI].map(yaw => s.evaluate({
        now: 0, dt: 0.1, position: [0, 0, 0], yaw, pitch: 0, quadInertia: new Float32Array(QUADRANTS).fill(0.5),
        incoming: [], heard: [], spotted: [], attackers: [], isScouting: false, coverActive: false,
        radio: factor }).urgency));
    } finally { Math.random = random; }
  };
  out.scoutState = { quiet: look(undefined), one: look(1), called: look(1.8) };
}

// --- MedicAssist: the wrench and the bag --------------------------------------------
const WRENCH = { name: 'RepairPack', healing: true, maxRange: 2.5, ammo: -1,
                 strength: { Infantry: 0, LightArmour: 2, HeavyArmour: 2, NavalArmour: 2, Submarine: 2, Air: 2 } };
const BAG = { name: 'MedPack', healing: true, maxRange: 2.5, ammo: -1,
              strength: { Infantry: 2, LightArmour: 0, HeavyArmour: 0, NavalArmour: 0, Submarine: 0, Air: 0 } };
{
  const hull = (id, d, extra = {}) => ({ id, hull: true, pos: [d, 0, 0], health: 0.5, upright: true, inVehicle: false,
                                         radius: 4, type: 'HeavyArmour', value: 12, reach: REPAIR_PACK.radius, ...extra });
  const mate = { id: 'mate', pos: [0, 0, 10], health: 0.5, upright: true, inVehicle: false, radius: 0.5, type: 'Infantry' };
  const ev = (weapons, friends, extra = {}) => new MedicState().evaluate({ now: 0, position: [0, 0, 0], weapons, friends, mod: 1, ...extra });
  const engineer = ev([WRENCH], [mate, hull('hull:t', 20)]);
  const medic = ev([BAG], [mate, hull('hull:t', 20)]);
  const lone = ev([WRENCH], [mate]);
  const two = [hull('hull:near', 10, { value: 6 }), hull('hull:far', 20, { value: 6 })];
  out.medicState = {
    engineer, medic, lone,
    // value / (d x SCurve(h)): a Sherman's 12 at 20 m against a soldier's 1.
    engineerTerm: engineer.urgency, medicTerm: medic.urgency,
    whole: ev([WRENCH], [hull('hull:t', 20, { health: 0.96 })]).targetId,
    wreck: ev([WRENCH], [hull('hull:t', 20, { health: 0 })]).targetId,
    tipped: ev([WRENCH], [hull('hull:t', 20, { upright: false })]).targetId,
    // Beyond the wrench's range: its own cell, or the trace behind it.
    offMap: ev([WRENCH], [hull('hull:t', 20)], { isWalkable: () => false }).targetId,
    offMapInReach: ev([WRENCH], [hull('hull:t', 2)], { isWalkable: () => false }).targetId,
    traced: ev([WRENCH], [hull('hull:t', 20, { reachable: () => true })], { isWalkable: () => false }).targetId,
    untraced: ev([WRENCH], [hull('hull:t', 20, { reachable: () => false })], { isWalkable: () => true }).targetId,
    // The radio weighs the choice, not the sum.
    nearer: ev([WRENCH], two),
    // "Need repairs!" cannot reorder two hulls (both take it); "Medic!" lifts a soldier over a hull for a bot with both.
    both: ev([WRENCH, BAG], [mate, hull('hull:t', 60, { value: 6 })]).targetId,
    bothMedic: ev([WRENCH, BAG], [mate, hull('hull:t', 60, { value: 6 })], { radio: { soldier: 1.8, other: 1 } }),
    bothQuiet: ev([WRENCH, BAG], [mate, hull('hull:t', 60, { value: 6 })]),
    bothRepairs: ev([WRENCH, BAG], [{ ...mate, pos: [0, 0, 8] }, hull('hull:t', 60, { value: 6 })], { radio: { soldier: 1, other: 1.8 } }).targetId,
    bothRepairsQuiet: ev([WRENCH, BAG], [{ ...mate, pos: [0, 0, 8] }, hull('hull:t', 60, { value: 6 })]).targetId,
    arriveNoReach: ev([WRENCH], [hull('hull:t', 20, { reach: undefined })]).arrive,
    constants: { rangeFraction: MEDIC.rangeFraction, reachFraction: MEDIC.reachFraction, unitValue: MEDIC.unitValue,
                 healthBelow: MEDIC.healthBelow, repairReach: REPAIR_PACK.radius },
  };
}

// --- friendlyHulls ---------------------------------------------------------------
{
  const cand = (vehicleId, extra = {}) => ({
    vehicleId, node: { id: vehicleId }, pos: [10, 0, 0], health: 0.4, upright: true, hullTeam: 1, strType: 'HeavyArmour',
    seats: [{ isRoot: true, value: 12 }, { isRoot: false, value: 5 }], value: 5, localBox: { min: [-1.5, 0, -3], max: [1.5, 2, 3] },
    noPathfinding: false, hullYaw: 0, ...extra,
  });
  const bot = {
    team: 1, position: [0, 0, 0], world: { nodeOwners: new Map() },
    vehicleCandidates: [
      cand('mine'), cand('mine', { value: 99 }),             // two seats of one hull: one record
      cand('theirs', { hullTeam: 2 }), cand('nobodys', { hullTeam: 0 }),
      cand('far', { pos: [200, 0, 0] }),
      cand('willy', { strType: 'LightArmour', seats: [{ isRoot: true, value: 6 }] }),
    ],
  };
  out.friendlyHulls = friendlyHulls(bot).map(h => ({ id: h.id, type: h.type, value: h.value, health: h.health, radius: h.radius, hull: h.hull }));
  out.friendlyHullsNone = friendlyHulls({ team: 1, position: [0, 0, 0], vehicleCandidates: null }).length;
}

// --- an engineer walks to a damaged tank and holds the wrench on it ---------------------
{
  const HOME = [100, 0, -100], ENEMY = [100, 0, -220];
  const collider = { waterLevel: null, surfaceHeight() { return 0; }, heightfield: null };
  const extras = {
    worldSize: 256,
    controlPoints: [{ name: 'Home', spawnGroupId: 1, team: 2, position: HOME }, { name: 'Enemy', spawnGroupId: 2, team: 1, position: ENEMY }],
    soldierSpawns: [{ name: 'H1', group: 1, team: 2, position: HOME, rotation: [0, 0, 0] },
                    { name: 'E1', group: 2, team: 1, position: ENEMY, rotation: [0, 0, 0] }],
    tickets: { 1: 100, 2: 100 },
  };
  const run = (weapons, hullTeam = 2) => {
    const world = new World({ collider, extras });
    world.addBotPlayer('bot_0', { team: 2, flag: world.flags[0] });
    world.setPlayerArmor('bot_0', new Armor(30));
    const bot = new BotController({ playerId: 'bot_0', world, botSkill: 0.75, weapons });
    bot.navGrid = null;
    const tank = {
      id: 'tank:Sherman', vehicleId: 'tank', node: { id: 'tank' }, pos: [HOME[0], 1.0, HOME[2] - 20], health: 0.5, upright: true,
      hullTeam, strType: 'HeavyArmour', seats: [{ isRoot: true, value: 12, occupied: true }], value: 12, kind: 'ground',
      // A Sherman-sized box: half diagonal 3.9 m.
      localBox: { min: [-1.5, 0, -3.5], max: [1.5, 2, 3.5] }, noPathfinding: false, hullYaw: 0, occupiedBy: 'crew', isRoot: true,
    };
    bot.vehicleCandidates = [tank];
    let chosen = false, fired = false, weapon = null, firingDist = null, firing3d = null, stance = null, urgency = 0, target = null;
    for (let i = 0; i < 360; i++) {
      bot.vehicleCandidates = [tank];
      bot.tick(WORLD_TICK_DT, i * WORLD_TICK_DT);
      world.step(WORLD_TICK_DT);
      const s = world.player('bot_0').soldier;
      urgency = Math.max(urgency, bot.urgency.Special ?? 0);
      if (bot.currentBehaviour === 'Special') { chosen = true; target = bot._medicResult?.targetId ?? null; }
      if (bot.isFiring && !fired) {
        fired = true; weapon = bot.weaponAi?.name ?? null; stance = s.stance;
        firingDist = Math.hypot(s.x - tank.pos[0], s.z - tank.pos[2]);
        firing3d = Math.hypot(s.x - tank.pos[0], s.y - tank.pos[1], s.z - tank.pos[2]);
      }
    }
    const radius = bot._medicHulls?.[0]?.radius ?? null;
    const s = world.player('bot_0').soldier;
    // The wrench's own law, from where the bot ended up.
    const reached = radius == null ? null : !!repairPackTarget(
      { x: s.x, y: s.y, z: s.z, team: 2, crouched: s.stance === 'crouch' },
      [{ x: tank.pos[0], y: tank.pos[1], z: tank.pos[2], radius, team: hullTeam, armor: { hitPoints: 5, maxHitPoints: 10, destroyed: false } }],
      { radius: REPAIR_PACK.radius });
    return { chosen, fired, weapon, firingDist, firing3d, stance, urgency, target, radius, reached,
             arrive: bot._medicResult?.arrive ?? null, planHull: !!bot.currentPlan?.hull,
             statements: (bot.currentPlan ?? []).map(a => a.type) };
  };
  const pistol = { name: 'Colt', burst: 0, minRange: 0, maxRange: 60, strength: { Infantry: 2 }, ammo: -1 };
  out.engineer = {
    wrench: run([pistol, { ...WRENCH }]),
    bag: run([pistol, { ...BAG }]),
    enemyHull: run([pistol, { ...WRENCH }], 1),
  };
  // The plan ends when the hull is whole, gone or left behind.
  const plan = Object.assign([], { hull: true, targetId: 'hull:t', arrive: 5.5, weaponIndex: 0 });
  const mender = (h, at = [0, 0, 0], ammo = -1) => ({ world: {}, position: at, weapons: [{ ammo }], _medicHulls: h ? [h] : [] });
  out.healPlanDone = {
    mending: healPlanDone(mender({ id: 'hull:t', health: 0.5, pos: [5, 0, 0] }), plan, 0),
    mended: healPlanDone(mender({ id: 'hull:t', health: 0.95, pos: [5, 0, 0] }), plan, 0),
    gone: healPlanDone(mender(null), plan, 0),
    left: healPlanDone(mender({ id: 'hull:t', health: 0.5, pos: [8, 0, 0] }), plan, 0),
    dry: healPlanDone(mender({ id: 'hull:t', health: 0.5, pos: [5, 0, 0] }, [0, 0, 0], 0), plan, 0),
  };
  const planned = planSpecial({ _medicResult: { targetId: 'hull:t', urgency: 1, weaponIndex: 0, arrive: 5.5, hull: true, targetPos: [5, 1, 0] },
                                currentPlan: [], planBehaviour: null, weapons: [{ name: 'RepairPack' }], vehicle: null, random: Math.random,
                                _planIdle: () => [] }, 0);
  out.hullPlan = { types: planned.map(a => a.type), hull: planned.hull, targetPos: planned[0].targetPos,
                   live: planned[0].targetPos === planned[2].targetPos, triggerHull: planned[2].hull === true, heal: planned[2].heal };
}

// --- a ship bot and a request for its seat -------------------------------------------
{
  const t = o => teleportChangeUrgency({ where: 'seatShip', rootU: 0, selfU: 8, seats: [], ...o });
  out.teleport = {
    quiet: t({}),
    requested: t({ requested: true }),
    // The older name of the same test.
    pending: t({ pending: true }),
    // A better seat free: the ordinary swap, never the re-deploy.
    requestedSwap: t({ requested: true, selfU: 0, seats: [{ id: 'aa', u: 6 }] }),
    // The 2.0 branch needs a bot off LOD 0, which the viewer has none of.
    noOrder: t({ attackSplit: 0.01 }),
    noOrderLod: t({ attackSplit: 0.01, lod: 1 }),
    noOrderAttacking: t({ attackSplit: 0.2, lod: 1 }),
    landing: t({ landing: true, requested: true }),
    landingSwap: t({ landing: true, requested: true, where: 'root', selfU: 1, seats: [{ id: 'mg', u: 40 }] }),
    landingSwapQuiet: t({ landing: true, where: 'root', selfU: 1, seats: [{ id: 'mg', u: 40 }] }),
    constants: { request: TELEPORT.requestUrgency, noOrder: TELEPORT.noOrderUrgency, split: TELEPORT.noOrderSplit, wait: TELEPORT.redeployWait },
  };
  const gunner = (row, kind = 'ship', template = 'Fletcher') => ({
    playerId: 'me', team: 1, botSkill: 0.75, waypoints: null, enterRequest: null,
    vehicle: { id: 'ship:gun', vehicleId: 'ship', seatId: 'gun', drives: false, kind, template, row, seats: [{ isRoot: true }] },
    vehicleCandidates: [
      { id: 'ship:helm', vehicleId: 'ship', seatId: 'helm', isRoot: true, occupiedBy: 'captain', drives: true },
      { id: 'ship:gun', vehicleId: 'ship', seatId: 'gun', isRoot: false, occupiedBy: 'me' },
    ],
    _candidateFire: () => 0, _hasPlan: () => true,
  });
  const ask = (row, requestAge, kind, template) => {
    const bot = gunner(row, kind, template);
    const mine = bot.vehicleCandidates[1];
    const r = urgencyChangeTeleport(bot, { mine, selfU: 4, split: [0.5, 0.5], driver: 'captain', health: 1, requestAge });
    return r ? { urgency: r.urgency, best: r.best.id, redeploy: !!r.redeploy, teleport: !!r.teleport } : null;
  };
  const shipRow = { name: 'BoatFixed', behaviours: { Change: 'ChangeTeleport' } };
  const tankRow = { name: 'Fixed', behaviours: { Change: 'Change' } };
  out.shipSeat = {
    asked: ask(shipRow, 0),
    late: ask(shipRow, 14.9),
    stale: ask(shipRow, 15),
    never: ask(shipRow, Infinity),
    // A tank gunner answers through `BBChange`, by climbing out.
    tank: ask(tankRow, 0, 'ground', 'Sherman'),
    noRowShip: ask(null, 0),
    noRowTank: ask(null, 0, 'ground', 'Sherman'),
  };
  // The plan: registered once, then only the wait.
  const bot = { vehicle: { id: 'ship:gun' }, currentPlan: [], planBehaviour: null, teleportRequest: false,
                _changeResult: { urgency: 6, best: { id: 'ship:gun' }, teleport: true, redeploy: true }, _planIdle: () => [] };
  const plan = planChange(bot, 100);
  const first = bot.teleportRequest;
  bot.teleportRequest = false;
  bot.currentPlan = plan; bot.planBehaviour = 'Change';
  const again = planChange(bot, 100.5);
  out.redeployPlan = {
    first, kept: again === plan, registeredAgain: bot.teleportRequest, types: plan.map(a => a.type), until: plan[0].until,
    waiting: executeAction(bot, plan[0], 0.03, 101.9), over: executeAction(bot, plan[0], 0.03, 102),
    wait: PLAN_ACTION.Wait,
  };
}

// --- the referee re-deploys the bot ----------------------------------------------
{
  const armor = { destroyed: false, hitPoints: 12, maxHitPoints: 30 };
  const soldier = { x: 0, y: 0, z: 0 };
  const flags = [{ name: 'ours', team: 1, spawns: [{ position: [50, 0, 60] }] }, { name: 'theirs', team: 2, spawns: [{ position: [900, 0, 900] }] },
                 { name: 'ring', team: 1, captureOnly: true }];
  const calls = [];
  const world = {
    flags, armorOf: () => armor, player: () => ({ team: 1, soldier, flag: flags[0] }),
    spawnPlayer: (id, opts) => { calls.push({ id, flag: opts.flag.name, advance: opts.advance }); soldier.x = 50; soldier.z = 60; return { flag: opts.flag, spawn: opts.flag.spawns[0] }; },
  };
  const redeployed = [];
  const referee = createBotReferee({ world: () => world, onRedeploy: (bot, flag) => redeployed.push(flag.name) });
  let left = 0;
  referee.leaveVehicle = bot => { left++; bot.vehicle = null; };
  const bot = { playerId: 'b', team: 1, vehicle: { id: 'ship:gun' }, seatRequest: { id: 'ship:gun', at: 1 }, route: {}, position: [0, 0, 0],
                setPosition(x, y, z) { this.position = [x, y, z]; } };
  const moved = referee.handleTeleportingBot(bot);
  const dead = { ...bot, vehicle: { id: 'x' } };
  armor.destroyed = true;
  const deadMoved = referee.handleTeleportingBot(dead);
  armor.destroyed = false;
  flags[0].team = 2;
  const nowhere = referee.handleTeleportingBot({ ...bot, vehicle: { id: 'x' } });
  out.redeploy = { moved, left, calls, position: bot.position, seated: !!bot.vehicle, request: bot.seatRequest, route: bot.route,
                   hitPoints: armor.hitPoints, redeployed, deadMoved, nowhere };
}

// --- a bot's own strengths --------------------------------------------------------
out.radioOf = { none: radioOf({ playerId: 'a' })(RM.Fire), some: radioOf({ playerId: 'a', radio: radio({ [RM.Fire]: 0.3 }) })(RM.Fire) };

process.stdout.write(JSON.stringify(out));
