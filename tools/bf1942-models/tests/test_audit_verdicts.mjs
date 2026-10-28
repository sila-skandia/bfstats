// The behaviour audit's verdicts (`audit_verdicts.mjs`): a hull still swinging
// left from a knock when D goes down is not a reversed steer; an aim axis its
// own data holds still is not a dead one.
//
//   node tests/test_audit_verdicts.mjs
import assert from 'node:assert/strict';
import { rightTurn, steerVerdict, SETTLE_RATE, heldByData, deployVerdict, rigFamilies, weldDeviation,
  weldVerdict, padGroundVerdict, rollsFreely, botHolding, roundEnded } from '../audit_verdicts.mjs';

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`ok - ${name}`); } catch (e) { failures++; console.log(`not ok - ${name}\n  ${e.message}`); }
};

// Axes of a hull heading `yaw` radians, nose -z at yaw 0 and right +x, turning
// right as yaw grows (the page's frame: `__hull().axes`).
const axes = yaw => ({
  forward: [Math.sin(yaw), 0, -Math.cos(yaw)],
  right: [Math.cos(yaw), 0, Math.sin(yaw)],
});

test('rightTurn is signed: right positive, left negative', () => {
  assert.ok(Math.abs(rightTurn(axes(0), axes(0.3)) - 0.3) < 1e-9);
  assert.ok(Math.abs(rightTurn(axes(1), axes(0.8)) + 0.2) < 1e-9);
});

test('a hull at rest on its heading that turns right under D is ok', () => {
  const v = steerVerdict({ preRate: 0, turnA: 0.25, dtA: 0.5, turned: 0.9, speed: 8 });
  assert.equal(v.verdict, 'ok');
});

test('a hull that turns left under D from a steady heading is reversed', () => {
  const v = steerVerdict({ preRate: 0, turnA: -0.25, dtA: 0.5, turned: 0.9, speed: 8 });
  assert.equal(v.verdict, 'reversed');
});

// The Prokhorovka Cavalry_Nagant: struck something, slewing left with no key
// down; D's right turn is smaller than the slew, so the nose still goes left.
test('a left slew that outlasts the press, with D turning right, is not reversed', () => {
  const preRate = -0.6;                      // rad/s left before D
  const turnA = preRate * 0.5 + 0.12;        // the slew plus D's own right turn
  const v = steerVerdict({ preRate, turnA, dtA: 0.5, turned: 0.3, speed: 4 });
  assert.notEqual(v.verdict, 'reversed');
  assert.ok(v.induced > 0, `D's share ${v.induced} should be rightward`);
});

test('a slow residual left drift is taken off, and a real reversal still shows', () => {
  const small = -SETTLE_RATE / 2;
  const right = steerVerdict({ preRate: small, turnA: small * 0.5 + 0.2, dtA: 0.5, turned: 0.5, speed: 6 });
  assert.equal(right.verdict, 'ok');
  const left = steerVerdict({ preRate: small, turnA: small * 0.5 - 0.25, dtA: 0.5, turned: 0.5, speed: 6 });
  assert.equal(left.verdict, 'reversed');
});

test('a hull still slewing hard left whose press adds left is unsettled, not reversed', () => {
  const v = steerVerdict({ preRate: -0.5, turnA: -0.5, dtA: 0.5, turned: 0.6, speed: 5 });
  assert.equal(v.verdict, 'unsettled');
});

test('a hull at speed whose heading never moves does not steer', () => {
  assert.equal(steerVerdict({ preRate: 0, turnA: 0, dtA: 0.5, turned: 0.005, speed: 7 }).verdict, 'no-steer');
});

test('a hull too slow to judge gets no verdict', () => {
  assert.equal(steerVerdict({ preRate: 0, turnA: -0.01, dtA: 0.5, turned: 0.01, speed: 0.4 }).verdict, 'slow');
});

test('an axis with no maxSpeed is held by its data', () => {
  assert.match(heldByData({ axis: 'pitch', maxSpeed: 0, continuous: 0, free: true, min: 0, max: 0 }), /maxSpeed 0/);
});

test('a free axis with speed is not held, a zero-width fixed range is', () => {
  assert.equal(heldByData({ axis: 'yaw', maxSpeed: 70, continuous: 0, free: true, min: 0, max: 0 }), null);
  assert.equal(heldByData({ axis: 'yaw', maxSpeed: 70, continuous: 0, free: false, min: -120, max: 120 }), null);
  assert.match(heldByData({ axis: 'yaw', maxSpeed: 70, continuous: 0, free: false, min: 45, max: 45 }), /range 45..45/);
});

test('an automaticReset axis is held only when its max is 0', () => {
  assert.equal(heldByData({ axis: 'pitch', maxSpeed: 0, automaticReset: true, max: 20 }), null);
  assert.ok(heldByData({ axis: 'pitch', maxSpeed: 30, automaticReset: true, max: 0 }));
});

test('a row without the servo words (an old page) gives no verdict', () => {
  assert.equal(heldByData({ axis: 'yaw', angle: 0 }), null);
});

// FH's mobile guns' deploy seat (FHX-24): the static stands at 4 s, the killer
// takes the hull at 3 s and the seated tester with it (AI-76).
test('the deploy sequence run in full is one info row', () => {
  const f = deployVerdict({ stoodAt: 4.07, hullDiedAt: 3.0, testerDiedAt: 3.0, seatedAtDeath: true }, [2]);
  assert.equal(f.length, 1);
  assert.equal(f[0].cause_key, 'veh.deploy-sequence');
  assert.equal(f[0].severity, 'info');
  assert.match(f[0].evidence, /seats 2 not tested/);
});

test('a deploy that stands nothing, or a hull its killer spares, is a major', () => {
  const none = deployVerdict({ stoodAt: null, hullDiedAt: 3, testerDiedAt: 3, seatedAtDeath: true });
  assert.deepEqual(none.map(x => x.cause_key), ['veh.deploy-nothing-stood']);
  const spared = deployVerdict({ stoodAt: 4, hullDiedAt: null, testerDiedAt: null, seatedAtDeath: null });
  assert.deepEqual(spared.map(x => x.cause_key), ['veh.deploy-hull-survived']);
});

test('a seated tester who outlives his hull is a major; one who got out is not', () => {
  const lived = deployVerdict({ stoodAt: 4, hullDiedAt: 3, testerDiedAt: null, seatedAtDeath: true });
  assert.deepEqual(lived.map(x => x.cause_key), ['veh.deploy-crew-survived']);
  const out = deployVerdict({ stoodAt: 4, hullDiedAt: 3, testerDiedAt: null, seatedAtDeath: false });
  assert.deepEqual(out.map(x => x.cause_key), ['veh.deploy-sequence']);
});

// Kits. Shapes from the shipped rigs' extras (2026-10-27): a stick grenade
// and a satchel carry a `throw` block; the satchel's reload family is an
// error row (its state machine has no reload state with a 1p clip).
const grenade = rigFamilies(
  { fire: { upperClip: 'a/1PFireStick.baf', returnTo: 'Ub_StandResetRaiseWeaponStick' },
    reload: { error: 'no Ub_StandReloadStick state with a 1P clip' } },
  { throw: { fireDelay: 1.0, hideDuringFireTime: 0.4 } });
const satchel = rigFamilies(
  { fire: { upperClip: 'a/1PFireLandmine.baf', returnTo: '_POSE_' },
    reload: { error: 'no Ub_StandReloadSatchel state with a 1P clip' } },
  { throw: { fireDelay: 0.5, hideDuringFireTime: 0.2 } });
const rifle = rigFamilies(
  { fire: { upperClip: 'a/1PFireRifle.baf', returnTo: '_POSE_' },
    reload: { upperClip: 'a/1PReloadRifle.baf' } },
  { magazine: { size: 5 } });

test('a thrown or placed weapon is a thrower whichever state it returns to', () => {
  assert.equal(grenade.thrower, true);
  assert.equal(satchel.thrower, true);
  assert.equal(rifle.thrower, false);
});

test('a reload family with no 1p clip is absent; a baked one is not', () => {
  assert.equal(satchel.reloadAbsent, true);
  assert.equal(rifle.reloadAbsent, false);
  assert.equal(rigFamilies({ reload1: { upperClip: 'x' } }, null).reloadAbsent, false);
});

const hand = (p, q = [0, 0, 0, 1]) => ({ p, q });
test('a sample of another weapon is not this weapon\'s weld', () => {
  const rest = { id: 'a', R: hand([0, 0, 0]) };
  const same = { id: 'a', R: hand([0.01, 0, 0]) };
  const next = { id: 'b', R: hand([0.09, 0, 0], [0, 0.26, 0, 0.966]) };
  const d = weldDeviation(rest, [same, next, null]);
  assert.equal(d.samples, 1);
  assert.ok(Math.abs(d.pos_m - 0.01) < 1e-9);
  assert.equal(d.rot_rad, 0);
});

test('weldDeviation takes the steadier hand', () => {
  const rest = { id: 'a', R: hand([0, 0, 0]), L: hand([0, 0, 0]) };
  const d = weldDeviation(rest, [{ id: 'a', R: hand([0.2, 0, 0]), L: hand([0.05, 0, 0]) }]);
  assert.equal(d.hand, 'L');
});

const TOL = { pos_m: 0.04, rot_rad: 0.5 };
test('a slide the fire clip authors is the game\'s; past it is the page\'s', () => {
  const dev = { pos_m: 0.1, rot_rad: 0.03, hand: 'R' };
  assert.ok(weldVerdict(dev, null, TOL), 'no authored slide: 10 cm is a finding');
  assert.equal(weldVerdict(dev, { pos_m: 0.099, rot_rad: 0.02 }, TOL), null);
  const past = weldVerdict({ pos_m: 0.2, rot_rad: 0.03, hand: 'R' }, { pos_m: 0.099, rot_rad: 0.02 }, TOL);
  assert.ok(past && past.authored);
  assert.equal(weldVerdict({ pos_m: 0.03, rot_rad: 0.1, hand: 'R' }, null, TOL), null);
});

// FHX-30: a towing tractor's deploy seat unhitches its gun and its re-hook
// killer has no cell against the tractor's own material: the tractor lives.
test('a hull no dropped killer can kill is owed no death', () => {
  const towed = deployVerdict({ stoodAt: 2.1, hullDiedAt: null, testerDiedAt: null, seatedAtDeath: null,
    owedDeath: false, killerHp: 0, hp: 109 });
  assert.deepEqual(towed.map(x => x.cause_key), ['veh.deploy-sequence']);
  assert.match(towed[0].evidence, /killer 0 hp on a 109 hp hull/);
  const killed = deployVerdict({ stoodAt: 2.1, hullDiedAt: 0.1, testerDiedAt: 0.1, seatedAtDeath: true,
    owedDeath: false, killerHp: 0, hp: 109 });
  assert.deepEqual(killed.map(x => x.cause_key), ['veh.deploy-hull-destroyed']);
  const owed = deployVerdict({ stoodAt: 4, hullDiedAt: null, testerDiedAt: null, seatedAtDeath: null,
    owedDeath: true, killerHp: 9990, hp: 99 });
  assert.deepEqual(owed.map(x => x.cause_key), ['veh.deploy-hull-survived']);
});

// FHSWEurope El Alamein's DEF_HeavyBomber_Spawner stands 6.6 m over the
// apron: its Ju88A is born there and falls 4.5 m onto its wheels (SPAWN-28).
test('a hull fallen straight down from a pad in the air is the level\'s, not a fault', () => {
  assert.equal(padGroundVerdict({ padY: 46.78, padGround: 40.2, hullY: 42.3, hullGround: 40.2, dh: 0.2, dy: -4.5 }),
    'over-ground');
});
// Operation Rattrap's RatteSpawner: 16 m over the ground, no static under it.
test('the Ratte dropped 15 m from its pad in the air is the level\'s too', () => {
  assert.equal(padGroundVerdict({ padY: 55, padGround: 39, hullY: 39.86, hullGround: 39, dh: 0.0, dy: -15.1 }),
    'over-ground');
});
test('a buried pad lifts its hull onto the ground beside it', () => {
  assert.equal(padGroundVerdict({ padY: 106.5, padGround: 112.2, hullY: 112.2, hullGround: 112.1, dh: 0.1, dy: 5.7 }),
    'under-ground');
});
// The SdKfz251-Pak38 on a pad level with the ground, flipped 4.3 m off it by
// its own towed gun's collision (FHX-31): the page's fault, reported.
test('a hull the load moved off a pad that stands on the ground is a fault', () => {
  assert.equal(padGroundVerdict({ padY: 40.19, padGround: 40.19, hullY: 40.8, hullGround: 40.2, dh: 4.3, dy: 0.6 }), null);
  assert.equal(padGroundVerdict({ padY: 46.78, padGround: 40.2, hullY: 42.3, hullGround: 40.2, dh: 3, dy: -4.5 }), null);
});

// FHSWEurope Ural Mountains' IS4: its pad 1.0 m over `hangar1_m1`'s floor
// (66.4), the terrain 39 m under that. Dropped through the floor to the
// terrain it read as a pad in the air until the check asked the statics too.
test('a hull fallen through the static floor under its pad is a fault', () => {
  assert.equal(padGroundVerdict({ padY: 67.42, padGround: 27.3, hullY: 27.6, hullGround: 27.3, dh: 0.1, dy: -39.8,
    padFloor: 66.42, hullFloor: null }), null);
  // The same pad without the floor read is the old verdict.
  assert.equal(padGroundVerdict({ padY: 67.42, padGround: 27.3, hullY: 27.6, hullGround: 27.3, dh: 0.1, dy: -39.8 }),
    'over-ground');
});
test('a hull let down onto the static floor under its pad rests on its pad', () => {
  // A metre over the floor and on it: no drop past the 1 m slack, no verdict.
  assert.equal(padGroundVerdict({ padY: 67.42, padGround: 27.3, hullY: 66.9, hullGround: 27.3, dh: 0.1, dy: -0.5,
    padFloor: 66.42, hullFloor: 66.42 }), null);
  // Stood 3 m over a bridge deck, it falls onto the deck: the level's.
  assert.equal(padGroundVerdict({ padY: 113.9, padGround: 93, hullY: 111.3, hullGround: 93, dh: 0.2, dy: -2.6,
    padFloor: 110.9, hullFloor: 110.9 }), 'over-ground');
  // ... and through it onto the river bed: the page's.
  assert.equal(padGroundVerdict({ padY: 113.9, padGround: 93, hullY: 93.5, hullGround: 93, dh: 0.2, dy: -20.4,
    padFloor: 110.9, hullFloor: null }), null);
});
test('a static top above the hull or under the terrain is no floor', () => {
  // A roof 5 m over a hull fallen from a pad in the air changes nothing.
  assert.equal(padGroundVerdict({ padY: 46.78, padGround: 40.2, hullY: 42.3, hullGround: 40.2, dh: 0.2, dy: -4.5,
    padFloor: null, hullFloor: 47.3 }), 'over-ground');
  // A foundation buried under the ground is not what the hull stands on.
  assert.equal(padGroundVerdict({ padY: 46.78, padGround: 40.2, hullY: 42.3, hullGround: 40.2, dh: 0.2, dy: -4.5,
    padFloor: 39.5, hullFloor: 39.5 }), 'over-ground');
});

// FHSWEurope The Storm's NKL26 aerosan: four ski Springs, all c_PGFRollGrip
// (2). A jeep's RollGripWhenOccupied (10) wheels and a tank's EngineGrip hold.
test('a hull on RollGrip wheels alone rolls; one with a parked grip does not', () => {
  assert.equal(rollsFreely([2, 2, 2, 2]), true);
  assert.equal(rollsFreely([10, 10, 2]), false);
  assert.equal(rollsFreely([4, 36, 2]), false);
  assert.equal(rollsFreely([]), false);
  assert.equal(rollsFreely(null), false);
});

// FHSWEurope Rheinuebung-1941, 2026-10-28: the Hood's deck bots want to move
// (MoveTo, Change) and stand on the deck, as the lab's AI LOD 0 bots do.
test('a bot on a ship deck holds; one that wants to move on land is stalled', () => {
  assert.equal(botHolding({ behaviour: 'MoveTo', goalReached: false, vehicle: null, deck: 'Hoodbots' }), true);
  assert.equal(botHolding({ behaviour: 'Change', goalReached: false, vehicle: null, deck: 'Bismarckbots' }), true);
  assert.equal(botHolding({ behaviour: 'MoveTo', goalReached: false, vehicle: null, deck: null }), false);
  assert.equal(botHolding({ behaviour: 'Scout', goalReached: false, vehicle: null, deck: null }), false);
  assert.equal(botHolding({ behaviour: 'Scout', goalReached: true, vehicle: null, deck: null }), true);
  assert.equal(botHolding({ behaviour: 'Fire', goalReached: false, vehicle: 'Flak38', deck: null }), true);
});

// FHSWEurope operation_kikusui_day2, 2026-10-28: the CoOp round ended under
// the medic's Katana select; the end game took the soldier ("nothing in hand",
// soldier false, round endGame), which is not a kit fault.
test('a round in EndGame, or restarted since the mark, ended under the test', () => {
  const playing = { status: 'playing', over: false, restarts: 0, tickets: { 1: 40, 2: 12 } };
  assert.equal(roundEnded(playing, { restarts: 0 }), null);
  assert.equal(roundEnded(null, { restarts: 0 }), null);
  assert.match(roundEnded({ status: 'endGame', over: true, restarts: 0, endReason: 'tickets', winner: 2,
    tickets: { 1: 0, 2: 12 } }, { restarts: 0 }), /^tickets, winner 2/);
  assert.match(roundEnded({ ...playing, restarts: 1 }, { restarts: 0 }), /restarted since \(1\)/);
  assert.equal(roundEnded({ ...playing, restarts: 1 }, null), null);
});

if (failures) { console.log(`${failures} failed`); process.exit(1); }
