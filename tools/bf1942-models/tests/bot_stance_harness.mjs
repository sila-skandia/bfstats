// The soldier pose a bot asks for and gets (features/bot-stance-variety,
// ledger BODY-5 and BODY-10..BODY-13): `BAPAComponentSoldierPose`, the pose
// request and its 10 s poll, the firing pose's eyes and sensed point, the
// attacker strength that feeds the variable pose, and the Fire -> Change ->
// Fire flip that used to stand a prone bot up for a tick.
//
// Run by `tests/test_bot_stance.py` on the module set `test_bot_ai.py`
// stages. Output is one JSON object on stdout.

import { SoldierPoseComponent, PoseRequests, scoutPose, takeCoverPose, movePose, directionPose, fixedPose,
         POSE_EYE, POSE_CHANGE_GATE, waterDepthAt } from './bot-pose.js';
import { BotSenses, sensedPoint, toBodyFrame, fromBodyFrame } from './bot-sense.js';
import { FIRING_POSES, firingPose } from './bot-fire.js';
import { planScout, planTakeCover, execInfantryResetControls, firingPoint, ladderPose } from './bot-plans.js';
import { planChange } from './bot-mount.js';
import { nearShot, fireObjectStrength, NEAR_FIRE } from './bot-perception.js';
import { World, WORLD_TICK_DT } from './world.mjs';
import { BotController } from './bot.js';

const r3 = v => Math.round(v * 1000) / 1000;
const seq = (...values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };

// --- the component -------------------------------------------------------

function componentScenario() {
  const c = new SoldierPoseComponent({ threshold: 4, random: () => 0.5 });
  const threshold = c.fireThreshold;                            // 4 x (1 + 5 x 0.5)
  const decide = (fire, control, water) =>
    new SoldierPoseComponent({ threshold: 4, random: () => 0.5 }).computeCurrentPose(fire, control, 0, water);
  const timeline = [];
  const t = new SoldierPoseComponent({ threshold: 4, random: () => 0.5 });
  for (const [now, fire] of [[0, 0], [4.9, 100], [5.0, 100], [7, 0], [9.99, 0], [10.0, 0]]) {
    timeline.push([now, t.computeCurrentPose(fire, 0, now)]);
  }
  const move = movePose(seq(0.5, 0.5));
  const dir = directionPose(() => 0.2);
  const tc = takeCoverPose(() => 0.2);
  return {
    threshold,
    above: decide(14.01, 0), at: decide(14, 0), below: decide(13, 0),
    incoming: decide(0, -0.5), controlAtThreshold: decide(0, 0), nanFire: decide(NaN, 0), nanControl: decide(0, NaN),
    deepWater: decide(0, 0, 0.5), deepWaterFire: decide(100, 0, 0.5), shallowFire: decide(100, 0, 0.2),
    shallowCalm: decide(0, 0, 0.2), dryEdge: decide(100, 0, 0), crouchInShallow: decide(0, -0.5, 0.2),
    clampHigh: new SoldierPoseComponent({ threshold: 1, control: 3 }).controlThreshold,
    clampLow: new SoldierPoseComponent({ threshold: 1, control: -3 }).controlThreshold,
    timeline,
    scoutHigh: scoutPose(seq(0.999999, 0)).fireThreshold,       // trunc(1 + 9 x 0.999999) = 9
    scoutLow: scoutPose(seq(0.05, 0)).fireThreshold,            // trunc(1.45) = 1
    scoutMid: scoutPose(seq(0.5, 0.5)).fireThreshold,           // trunc(5.5) x 3.5
    takeCover: r3(tc.fireThreshold), takeCoverDuration: tc.duration,
    move: r3(move.fireThreshold), moveDuration: move.duration,
    direction: r3(dir.fireThreshold), directionDuration: dir.duration,
    fixedProneFire: fixedPose('prone').computeCurrentPose(1e9, -1, 0),
    fixedCrouchShallow: fixedPose('prone').computeCurrentPose(0, 0, 0, 0.3),
    water: {
      none: waterDepthAt({ waterLevel: null, heightfield: { height: () => 3 } }, 0, 0),
      under: waterDepthAt({ waterLevel: 5, heightfield: { height: () => 4.7 } }, 0, 0),
      dry: waterDepthAt({ waterLevel: 5, heightfield: { height: () => 7 } }, 0, 0),
    },
  };
}

// --- the request and its poll ---------------------------------------------

function requestScenario() {
  const r = new PoseRequests();
  const log = [];
  const step = (now, current, ask) => {
    if (ask) r.request(ask);
    const held = r.poll(now, current);
    log.push([now, ask ?? null, held, r.inFlight]);
    return held;
  };
  step(0, 'stand', 'prone');          // prone at once
  step(0.033, 'prone', 'prone');      // reached
  step(2, 'prone', 'stand');          // held back by the gate
  step(9.99, 'prone', 'stand');
  step(10.0, 'prone', 'stand');       // 0 + 10 > 10 is false: pressed
  step(10.033, 'stand', 'prone');     // in flight: the prone request is dropped
  step(10.066, 'stand', 'prone');     // taken, prone never waits
  step(10.1, 'prone', null);
  step(12, 'prone', 'crouch');        // 10.066 + 10 > 12: held
  step(20.07, 'prone', 'crouch');     // pressed
  step(20.1, 'crouch', null);
  const odd = new PoseRequests();
  odd.request('prone');
  const oddHeld = odd.poll(0, 'swim');
  return { log, gate: POSE_CHANGE_GATE, odd: [odd.requested, oddHeld, odd.inFlight] };
}

// --- the firing pose ---------------------------------------------------------

function firingScenario() {
  // A wall halfway along a flat 20 m line: the line from eye e to a point at
  // height p crosses it at (e + p) / 2.
  const wall = top => (from, to) => (from[1] + to[1]) / 2 > top;
  const at = (top, p) => firingPose([0, 0, 0], [20, p, 0], wall(top));
  return {
    eyes: FIRING_POSES.map(f => [f.pose, r3(f.eye)]),
    poseEye: [r3(POSE_EYE.stand), r3(POSE_EYE.crouch), r3(POSE_EYE.prone)],
    open: at(-1, 1.0),
    // 0.37 m cover to a point 0.40 m up (a prone man's lowest sense height):
    // the old 0.40 m eye saw over it, the engine's 0.30 m does not.
    lowCover: at(0.37, 0.40),
    // A 1 m wall to his chest point: the crouching eye clears it.
    chestWall: at(1.0, 1.2),
    highWall: at(1.5, 1.2),
    blind: at(5, 1.0),
    forced: firingPose([0, 0, 0], [20, 1, 0], () => false, true),
  };
}

// --- the sensed point --------------------------------------------------------

function sensedScenario() {
  const soldier = { x: 10, y: 2, z: -5, yaw: Math.PI / 2, stance: 'stand' };
  const player = { soldier, team: 1 };
  const rec = { pos: [10, 2, -5], offset: [0.2, 1.2, 0.1], local: null };
  const turned = sensedPoint(null, rec, player);
  const bare = sensedPoint(null, { pos: [10, 2, -5], offset: null, local: null }, player);
  const round = fromBodyFrame(0.7, ...toBodyFrame(0.7, 0.3, -0.2));
  // `_rays` keeps the offset in the target's frame.
  const s = new BotSenses({ viewDistance: 300, random: seq(0.5, 1.0, 0.5) });
  const ray = s._rays(null, [0, 1.65, 0], { soldier }, [10, 2, -5], 11);
  // `firingPoint`: the plan's point from the bot's record of its target.
  const world = { players: new Map([['t', player]]), collider: null };
  const bot = { firingTarget: 't', targetPosition: [10, 2, -5], world,
                senses: { memory: new Map([['t', rec]]), unitOwnerOf: () => -1 } };
  const bot2 = { ...bot, senses: { memory: new Map(), unitOwnerOf: () => -1 } };
  return {
    turned: turned.map(r3), bare: bare.map(r3), round: round.map(r3),
    rayOffset: ray?.offset?.map(r3) ?? null,
    firingPoint: firingPoint(bot).map(r3), firingPointNoRecord: firingPoint(bot2).map(r3),
  };
}

// --- the attacker strength ----------------------------------------------------

function attackerScenario() {
  const s = new BotSenses({ viewDistance: 300 });
  s.onIncomingFire(0, 'a', 4, true, [5, 0, 0]);
  s.onNearFire(1, 4, [30, 0, 0]);
  const at1 = s.attackerStrength(1);
  const at3 = s.attackerStrength(3);
  s.onNearFire(5, 2, [30, 0, 0]);                 // the one shared entry, newest
  const at5 = s.attackerStrength(5);
  const listed = s.incoming.length;
  const at200 = s.attackerStrength(200);          // max(300 / 2, 10) = 150 s
  const t = new BotSenses({ viewDistance: 300 });
  for (let i = 0; i < 40; i++) t.onIncomingFire(0, `x${i}`, 1, false);
  const crowded = [r3(t.attackerStrength(9.9)), r3(t.attackerStrength(10.1))];   // max(300 / 40, 10) = 10 s
  return { at1: r3(at1), at3: r3(at3), at5: r3(at5), listed, at200, crowded };
}

// --- the near shots ------------------------------------------------------------

function nearShotScenario() {
  const players = new Map();
  const armors = new Map();
  const add = (id, team, x, z, yaw, hp = 100) => {
    players.set(id, { id, team, soldier: { x, y: 0, z, yaw, stance: 'stand' } });
    armors.set(id, { hitPoints: hp, maxHitPoints: 100, destroyed: false });
  };
  const world = { players, armorOf: id => armors.get(id), collider: null };
  add('me', 1, 0, 0, 0);
  const towardMe = Math.atan2(-1, 0);                 // forward (sin, cos) = (-1, 0)
  add('close', 2, 30, 0, 0);
  add('farFacing', 2, 80, 0, towardMe);
  add('farAway', 2, 80, 0, -towardMe);
  add('farOffset5', 2, 80, 5, towardMe);
  add('farOffset15', 2, 80, 15, towardMe);
  add('mate', 1, 20, 0, towardMe);
  add('hurt', 2, 30, 0, 0, 50);
  const bot = new BotController({ playerId: 'me', world: { ...world, player: id => players.get(id) } });
  bot.position = [0, 0, 0];
  bot.team = 1;
  const count = (id) => {
    bot.senses = new BotSenses({ viewDistance: 300 });
    nearShot(bot, id, players.get(id).team, [players.get(id).soldier.x, 0, players.get(id).soldier.z], 1);
    return { n: bot.senses.incoming.length, near: !!bot.senses.nearFire, strength: r3(bot.senses.nearFire?.strength ?? 0) };
  };
  return {
    radius: NEAR_FIRE.radius, lineRadius: NEAR_FIRE.lineRadius,
    close: count('close'), farFacing: count('farFacing'), farAway: count('farAway'),
    farOffset5: count('farOffset5'), farOffset15: count('farOffset15'), mate: count('mate'),
    hurt: r3(fireObjectStrength(bot, 'hurt')), full: r3(fireObjectStrength(bot, 'close')),
    unknown: fireObjectStrength(bot, 'nobody', 1),
  };
}

// --- the plans ------------------------------------------------------------------

function planScenario() {
  const bot = { _scoutDir: [0, 0, 1], currentPlan: [], planBehaviour: null, random: () => 0.5, _planIdle: () => [] };
  const scout = planScout(bot, 0);
  const coverBot = (goal) => ({
    _coverResult: { urgency: 1, goal, dangerPos: [0, 0, 30], dangerId: null }, currentPlan: [], planBehaviour: null,
    position: [0, 0, 0], random: () => 0.5, navGrid: null, world: null, _planIdle: () => [],
    cover: { lowestGround: () => [5, -5] },
  });
  const cover = planTakeCover(coverBot([2, -2]), 0);
  const open = planTakeCover(coverBot(null), 0);
  const changeBot = {
    _changeResult: { best: { cand: { id: 'v', entry: [5, -5], entryRadius: 3, kind: 'ground', node: null, pos: [5, 0, -5] } } },
    vehicle: null, planBehaviour: null, currentPlan: [], position: [0, 0, 0], _planIdle: () => [],
  };
  const change = planChange(changeBot, 0);
  const describe = plan => plan.map(a => [a.type, a.component ? 'component' : (a.ladder ? 'ladder' : (a.pose ?? null)),
                                          !!a.afterMove, !!a.afterPose, !!a.whileMoving, !!a.serial]);
  // `InfanteryResetControls` leaves the pose alone.
  const reset = { moveForward: 1, moveStrafe: 1, stanceInput: 'prone', walkInput: true, isFiring: true };
  execInfantryResetControls(reset);
  // The ladder from where the bot stands.
  const ladderBot = (clear) => ({ position: [0, 0, 0], _lineClear: (a) => clear(a[1]) });
  return {
    scout: describe(scout), scoutThreshold: scout[0].component.fireThreshold,
    cover: describe(cover), open: describe(open), change: describe(change),
    resetKeepsPose: reset.stanceInput, resetWalk: reset.walkInput,
    ladder: [ladderPose(ladderBot(() => true), [0, 0, 20]), ladderPose(ladderBot(y => y < 1.5), [0, 0, 20]),
             ladderPose(ladderBot(() => false), [0, 0, 20]), ladderPose(ladderBot(() => true), null)],
  };
}

// --- the flip that stood a prone bot up -----------------------------------------------

const WORLD = 256;
const EXTRAS = {
  worldSize: WORLD,
  controlPoints: [
    { name: 'Home', spawnGroupId: 1, team: 2, position: [100, 0, -100] },
    { name: 'Enemy', spawnGroupId: 2, team: 1, position: [100, 0, -220] },
  ],
  soldierSpawns: [
    { name: 'H1', group: 1, team: 2, position: [100, 0, -100], rotation: [0, 0, 0] },
    { name: 'E1', group: 2, team: 1, position: [100, 0, -220], rotation: [0, 0, 0] },
  ],
  tickets: { 1: 100, 2: 100 },
};

/**
 * A bot fighting an enemy 20 m off on open ground lies down (the prone eye
 * sees). Every 90 ticks Change is made to win one tick (its urgency forced
 * high with a vehicle door 6 m away), as the Fire urge curve hands the
 * contest over in a real fight. The soldier's stance is read every tick.
 */
function flipScenario() {
  const world = new World({ collider: { waterLevel: null, surfaceHeight() { return 0; }, heightfield: null }, extras: EXTRAS });
  world.addBotPlayer('bot_0', { team: 2, flag: world.flags[0] });
  const local = world.addPlayer('local', { team: 1, flag: world.flags[1] });
  local.soldier.spawn(100, 0, -120, 0);
  const bot = new BotController({ playerId: 'bot_0', world, botSkill: 0.75 });
  bot.navGrid = null;
  const urgencyChange = bot._urgencyChange.bind(bot);
  let forceAt = -1;
  bot._urgencyChange = (mod, now) => {
    if (Math.abs(now - forceAt) < 1e-6) {
      bot._changeResult = { urgency: 50, best: { id: 'v', u: 50, dist: 6, cand: {
        id: 'v', vehicleId: 'v', entry: [106, -100], entryRadius: 3, kind: 'ground', node: null, pos: [106, 0, -100] } } };
      bot.changedTarget.Change = true;
      return 50;
    }
    return urgencyChange(mod, now);
  };
  const stances = [], behaviours = [], inputs = [];
  let flips = 0;
  for (let i = 0; i < 900; i++) {
    const now = i * WORLD_TICK_DT;
    if (i >= 300 && i % 90 === 0) { forceAt = now; flips++; }
    bot.tick(WORLD_TICK_DT, now);
    world.step(WORLD_TICK_DT);
    stances.push(world.player('bot_0').soldier.stance);
    behaviours.push(bot.currentBehaviour);
    inputs.push(bot.stanceInput);
  }
  const changeTicks = behaviours.map((b, i) => (b === 'Change' ? i : -1)).filter(i => i >= 0);
  let oneTick = 0;
  for (let i = 1; i + 1 < stances.length; i++) {
    if (stances[i] !== stances[i - 1] && stances[i + 1] === stances[i - 1]) oneTick++;
  }
  const after = stances.slice(300);
  return {
    flips, changeTicks: changeTicks.length,
    stanceBeforeFlips: stances[299], proneAfter: after.filter(s => s === 'prone').length, samplesAfter: after.length,
    oneTickFlickers: oneTick, standDuringChange: changeTicks.filter(i => stances[i] === 'stand').length,
    firstChange: changeTicks[0] ?? null,
  };
}

const results = {
  component: componentScenario(),
  requests: requestScenario(),
  firing: firingScenario(),
  sensed: sensedScenario(),
  attacker: attackerScenario(),
  nearShot: nearShotScenario(),
  plans: planScenario(),
  flip: flipScenario(),
};

process.stdout.write(JSON.stringify(results));
