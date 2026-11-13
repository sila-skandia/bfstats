// The bot plans built from the retail inverse gap audit, wave 2 (entries 18,
// 31, 33, 39): a soldier's Avoid (`BBAvoid` with `BBPAvoidCollisionInfantery`),
// a hull's TakeCover (`BBTakeCover` / `BBPTakeCover`), a hull's Scout
// (`BBPScout`) and the fire plan's throw (`BBPFireInfantery::createPlan`),
// under node, for tests/test_bot_plan_gaps.py. Prints one JSON object.

import { footAvoid, standingBox, BOT_RADIUS } from './bot-route.js';
import { SOLDIER_SMALLEST_RADIUS } from './bot-sense.js';
import { traceLastFree, FOOT_AVOID, footAvoidPlan, planAvoid, planScout, planTakeCover, hullScoutTurns, hullYawAimValid,
         execHullTurnTo, soldierChoseThrownWeapon, fireDecision, FIRE_STATE, FIRE_THROW, PLAN_ACTION } from './bot-plans.js';
import { HULL_TAKE_COVER, HullTakeCoverState, hullQuadrants, SCOUT, sCurve, decleiningSlope } from './bot-behaviours.js';
import { hullTakeCover, urgencyAvoid, BEHAVIOUR } from './bot-decision.js';
import { CELL_FREE, CELL_OBJECT } from './nav-map.js';

const out = { constants: { footAvoid: { ...FOOT_AVOID }, hullTakeCover: { ...HULL_TAKE_COVER }, fireThrow: { ...FIRE_THROW },
                           scoutTurn: SCOUT.hullTurnTolerance } };

// ---------------------------------------------------------------- entry 18
function flatNav(size = 64) {
  const n = size * size;
  return { width: size, height: size, cellSize: 1, blocked: new Uint8Array(n).fill(CELL_FREE),
           heights: new Float32Array(n), normalY: new Float32Array(n).fill(1), maxLevel: 3 };
}
const friend = (id, x, z, vx = 0, vz = 0) => ({ id, x, z, vx, vz, r: SOLDIER_SMALLEST_RADIUS, mass: 100 });
function walker(nav, { x = 32.5, z = -32.5, yaw = 0, speed = 5, vehicle = null } = {}) {
  const bot = {
    playerId: 'me', team: 1, position: [x, 0, z], yaw, obstacles: [], route: null, vehicle,
    changedTarget: {}, currentPlan: [], planBehaviour: null, random: () => 0.5, waypoints: null,
    _nav: () => nav, _radius: () => BOT_RADIUS, _player: () => ({ soldier: { speed, yaw } }),
    _planIdle: () => [],
  };
  return bot;
}
const nav = flatNav();
// Walking +z at 5 m/s; a friend 12 m ahead walking back at 5 m/s: the two
// 2 m circles meet in 1 s. `mass x |relVel| / |rel|` = 100 x 10 / 12.
let b = walker(nav);
out.headOn = { urgency: footAvoid(b, [friend('p:a', 32.5, -20.5, 0, -5)]), best: b._footAvoidBest?.id ?? null,
               t: b._footAvoidBest?.t ?? null, changed: b.changedTarget.Avoid === true };
// The same friend standing still: an obstacle's business, no urgency.
b = walker(nav);
out.standing = footAvoid(b, [friend('p:a', 32.5, -20.5)]);
// Walking beside him the same way: no relative speed, no hit.
b = walker(nav);
out.abreast = footAvoid(b, [friend('p:a', 35.5, -32.5, 0, 5)]);
// 40 m ahead is past 5 s x 5 m/s + the radii.
b = walker(nav);
out.far = footAvoid(b, [friend('p:a', 32.5, 7.5, 0, -0.0)]);
// Crossing 10 m ahead from the left at 4 m/s.
b = walker(nav);
out.crossing = { urgency: footAvoid(b, [friend('p:a', 24.5, -22.5, 4, 0)]), t: b._footAvoidBest?.t ?? null };
// A friend already inside the two radii, walking: left to the contact rule
// (INVENTION, bot-route.js `footAvoid`).
b = walker(nav);
out.touching = footAvoid(b, [friend('p:a', 33.5, -31.5, 0, 3)]);
// A seat that does not drive runs no soldier's avoid.
b = walker(nav, { vehicle: { kind: 'tank', drives: false } });
out.passenger = urgencyAvoid(b, 1, 0);

// The plan, as a pure function: walking +z (the engine's -z) at 5 m/s.
const box = { min: [0, 0], max: [64, 64], cellSize: 1 };
const base = { position: [32.5, -32.5], velocity: [0, 5], forward: [0, 1], radius: 1, t: 2, box, waypoint: null };
// The body ahead and to the +x side: step to the -x diagonal, at 0.3.
out.planAheadRight = footAvoidPlan({ ...base, other: [34.5, -22.5] });
// The body ahead and to the -x side: the +x diagonal.
out.planAheadLeft = footAvoidPlan({ ...base, other: [30.5, -22.5] });
// The body behind: the full speed.
out.planBehind = footAvoidPlan({ ...base, other: [33.5, -42.5] });
out.planBehindFlag = out.planBehind.behind;
// No room for the step (a 3 m wide lane), the pushed point outside too: the
// order's waypoint, stood still for (the body is ahead).
const lane = { min: [31, 0], max: [34, 64], cellSize: 1 };
out.planLaneAhead = footAvoidPlan({ ...base, box: lane, other: [34.0, -22.5], waypoint: [32.5, 10] });
out.planLaneAheadBranch = out.planLaneAhead.branch;
out.planLaneBehind = footAvoidPlan({ ...base, box: lane, other: [33.0, -42.5], waypoint: [32.5, 10] });
// No box at all (a blocked cell): the same branch, no waypoint, nothing to walk to.
out.planNoBox = footAvoidPlan({ ...base, box: null, other: [34.5, -22.5] });
out.planNoBoxBranch = out.planNoBox.branch;
// The pushed point inside the box (a box off to one side): the step back.
const side = { min: [32, 0], max: [64, 64], cellSize: 1 };
// Body on the -x side: the step is the +x diagonal (inside), so branch A.
out.planSideA = footAvoidPlan({ ...base, box: side, other: [30.5, -22.5] }).branch;
// Body on the +x side: the step is the -x diagonal (outside the box), and
// pushed 3 cells x n (n is 5 long here) further toward -x it is outside too.
out.planSideB = footAvoidPlan({ ...base, box: side, other: [34.5, -22.5] }).branch;
// A slow walker (0.2 m/s): the step leaves the 0.5 m ledge of box to its
// -x side, and the push (3 x 0.2 = 0.6 m toward -x)... stays out: B. With the
// box open the other way the pushed point lands inside: the step back.
const slow = { ...base, velocity: [0, 0.2] };
const ledge = { min: [32.45, 0], max: [64, 64], cellSize: 1 };
out.planSlow = footAvoidPlan({ ...slow, box: ledge, other: [34.5, -30.5] }).branch;

// Through the plan generator: a pose, then the move.
b = walker(nav);
footAvoid(b, [friend('p:a', 34.0, -20.5, 0, -5)]);
b.planBehaviour = null;
const plan = planAvoid(b, 10);
out.planActions = plan.map(a => a.type);
out.planMove = plan.find(a => a.type === PLAN_ACTION.SoldierMoveToDirect);
out.planPose = plan[0]?.component?.normal ?? null;
out.planOther = plan.otherId;
out.planKept = planAvoid({ ...b, currentPlan: plan, planBehaviour: BEHAVIOUR.Avoid }, 10.1) === plan;
out.box = standingBox(b, 32.5, -32.5);
const blocked = flatNav();
blocked.blocked[32 * 64 + 32] = CELL_OBJECT;
out.boxBlocked = standingBox(walker(blocked), 32.5, -32.5);

// ---------------------------------------------------------------- entry 31
out.quadrants = [hullQuadrants(1, 10), hullQuadrants(-1, 10), hullQuadrants(10, -1), hullQuadrants(-10, -1)];
const ctx = (over = {}) => ({
  now: 100, position: [0, 0, 0], incoming: [], spotted: [], covers: [],
  traceValidPoint: (from, to) => to, myWidth: 6, myHeight: 2.5, radio: 1, mod: 2.0, ...over,
});
const house = { id: 7, pos: [0, 0, -30], value: 60, width: 12, height: 6, radius: 6 };
const wall = { id: 8, pos: [10, 0, -10], value: 20, width: 4, height: 1, radius: 2 };
const enemyTank = { id: 'e1', pos: [0, 0, 80], strength: 8 };
let st = new HullTakeCoverState();
// A spotted enemy tank and no cover in reach: no urgency.
out.noCover = st.evaluate(ctx({ spotted: [enemyTank] })).urgency;
// With a house behind the hull: urgency, the point 3 R behind the house.
st = new HullTakeCoverState();
let r = st.evaluate(ctx({ spotted: [enemyTank], covers: [house] }));
out.house = { urgency: r.urgency, goal: r.goal, dangerId: r.dangerId, cover: r.cover?.id, scale: r.cover?.scale,
              score: r.cover?.score, hull: r.hull, changed: r.changed };
// The figure by hand: danger 8 / 80 = 0.1, one cover found x 1.3.
out.houseByHand = (sCurve(Math.max(80, 10) * HULL_TAKE_COVER.dangerScale) * decleiningSlope(0.1 * HULL_TAKE_COVER.newBest)
  - HULL_TAKE_COVER.urgencyOffset) * 2.0;
// The same call again: the choice held, not "changed".
out.houseAgain = st.evaluate(ctx({ spotted: [enemyTank], covers: [house] })).changed;
// A low wall near by outscores the house: the base divides.
st = new HullTakeCoverState();
r = st.evaluate(ctx({ spotted: [enemyTank], covers: [house, wall] }));
out.pair = { cover: r.cover?.id, scale: r.cover?.scale, wallScore: r.cover?.score };
// An enemy inside 5 m counts at 5 m.
st = new HullTakeCoverState();
const near = st.evaluate(ctx({ spotted: [{ id: 'e2', pos: [0, 0, 2], strength: 2 }], covers: [house] }));
st = new HullTakeCoverState();
const at5 = st.evaluate(ctx({ spotted: [{ id: 'e2', pos: [0, 0, 5], strength: 2 }], covers: [house] }));
out.nearClamp = [near.urgency, at5.urgency];
// Fire from a point: an aimed round against one that was not (x 0.8), a second old.
const fire = aimed => ({ pos: [0, 0, 60], time: 99, rate: 1, strength: 0.6, aimed, attacker: 'e3' });
st = new HullTakeCoverState();
const aimedU = st.evaluate(ctx({ incoming: [fire(true)], covers: [house] }));
st = new HullTakeCoverState();
const looseU = st.evaluate(ctx({ incoming: [fire(false)], covers: [house] }));
out.fire = { aimed: aimedU.urgency, loose: looseU.urgency, dangerId: aimedU.dangerId, object: aimedU.dangerIsObject };
const f32 = Math.fround;
out.fireByHand = [(sCurve(6) * decleiningSlope(0.6 / 2 * f32(1.3)) - HULL_TAKE_COVER.urgencyOffset) * 2.0,
                  (sCurve(6) * decleiningSlope(0.6 / 2 * f32(0.8) * f32(1.3)) - HULL_TAKE_COVER.urgencyOffset) * 2.0];
out.nearByHand = (sCurve(1) * decleiningSlope(2 / 5 * f32(1.3)) - HULL_TAKE_COVER.urgencyOffset) * 2.0;
// A cover whose trace finds no point is no cover.
st = new HullTakeCoverState();
out.noTrace = st.evaluate(ctx({ spotted: [enemyTank], covers: [house], traceValidPoint: () => null })).urgency;
// A cover with portals: the divisor x 0.1.
st = new HullTakeCoverState();
out.portalScore = st.evaluate(ctx({ spotted: [enemyTank], covers: [{ ...house, portals: 2 }] })).cover?.score;
// `1 + Take cover` on the radio.
st = new HullTakeCoverState();
out.radio = st.evaluate(ctx({ spotted: [enemyTank], covers: [house], radio: 2 })).urgency;

// The dispatch by the row's generator, and the plan.
const tankRow = { name: 'Tank', behaviours: { TakeCover: 'TakeCover' } };
out.dispatch = {
  foot: hullTakeCover({ vehicle: null }),
  tank: hullTakeCover({ vehicle: { row: tankRow } }),
  noRow: hullTakeCover({ vehicle: {} }),
  infantryRow: hullTakeCover({ vehicle: { row: { behaviours: { TakeCover: 'TakeCoverInfantry' } } } }),
};
function tanker({ maxSpeed = 12, drives = true } = {}) {
  return { position: [0, 0, 0], currentPlan: [], planBehaviour: null, random: () => 0.5,
           vehicle: { kind: 'tank', drives, hullMaxSpeed: maxSpeed }, _planIdle: () => ['idle'] };
}
let t = tanker();
t._coverResult = { urgency: 1, hull: true, goal: [0, -48], dangerPos: [0, 0, 80], dangerId: 'e1', cover: { id: 7 } };
const coverPlan = planTakeCover(t, 0);
out.coverPlan = { types: coverPlan.map(a => a.type), arrive: coverPlan[0].arrive, waypoint: coverPlan[0].waypoint,
                  look: coverPlan[1].target, hull: coverPlan.hull, poses: coverPlan.filter(a => a.type === PLAN_ACTION.SoldierPose).length };
// Kept while the unit has moved under 1 m; rebuilt past it.
t.currentPlan = coverPlan; t.planBehaviour = BEHAVIOUR.TakeCover;
t._coverResult = { ...t._coverResult, dangerPos: [0.5, 0, 80] };
out.coverKept = planTakeCover(t, 1) === coverPlan;
t._coverResult = { ...t._coverResult, dangerPos: [1.5, 0, 80] };
out.coverRebuilt = planTakeCover(t, 1) !== coverPlan;
// A point danger (fire) is kept to 3 m.
t = tanker();
t._coverResult = { urgency: 1, hull: true, goal: [0, -48], dangerPos: [0, 0, 60], dangerId: null, cover: { id: 7 } };
const firePlan = planTakeCover(t, 0);
t.currentPlan = firePlan; t.planBehaviour = BEHAVIOUR.TakeCover;
t._coverResult = { ...t._coverResult, dangerPos: [2.5, 0, 60] };
out.firePlanKept = planTakeCover(t, 1) === firePlan;
// A hull slower than 4 m/s arrives inside 4 m; a gunner only looks.
t = tanker({ maxSpeed: 3 });
t._coverResult = { urgency: 1, hull: true, goal: [0, -48], dangerPos: [0, 0, 80], dangerId: 'e1' };
out.slowArrive = planTakeCover(t, 0)[0].arrive;
t = tanker({ drives: false });
t._coverResult = { urgency: 1, hull: true, goal: [0, -48], dangerPos: [0, 0, 80], dangerId: 'e1' };
out.gunnerPlan = planTakeCover(t, 0).map(a => a.type);

// The plan's point is traced from behind the cover toward the cover (its
// footprint stands in for the sense position): the last free cell before
// the cover's own paint. A wall of blocked cells at z = -40 (grid row 40).
const coverNav = flatNav();
for (let gx = 0; gx < 64; gx++) coverNav.blocked[40 * 64 + gx] = CELL_OBJECT;
out.traceToWall = traceLastFree(coverNav, [20.5, -48.5], [20.5, -30.5]);
out.traceFree = traceLastFree(flatNav(), [20.5, -48.5], [20.5, -30.5]);
t = tanker();
t._nav = () => coverNav;
t._coverResult = { urgency: 1, hull: true, goal: [20.5, -48.5], dangerPos: [20.5, 0, 30], dangerId: 'e1',
                   cover: { id: 7, footprint: [18, -38, 23, -32] } };
out.coverPlanTraced = planTakeCover(t, 0)[0].waypoint;

// ---------------------------------------------------------------- entry 39
function spg({ isTurnable = true, window = [0, 0], forward = [0, 1], limits = null } = {}) {
  const bot = {
    position: [0, 0, 0], yaw: Math.atan2(forward[0], forward[1]), currentPlan: [], planBehaviour: null, random: () => 0.5,
    moveForward: 0, moveStrafe: 0, sensed: 0, looked: 0,
    vehicle: { kind: 'tank', drives: true, isTurnable,
               controlInfo: window ? { cameraMinDeg: [window[0], -20], cameraMaxDeg: [window[1], 20] } : null,
               occupancy: limits ? { turret: { yawLimitsRadians: () => limits } } : null,
               drive: { state: { velocity: { x: 0, y: 0, z: 0 } } } },
    _vehicleForward: () => forward, _planIdle: () => [], _unitForward3: () => [forward[0], 0, forward[1]],
    _turretCanPoint(dir) {
      const want = Math.atan2(dir[0], dir[2]) - this.yaw;
      return want >= limits[0] && want <= limits[1];
    },
    _aimLook() { this.looked++; }, _execSense() { this.sensed++; return true; },
    _eye: () => [0, 2, 0], senses: null, firingTarget: null,
  };
  return bot;
}
// A Wespe (the look turns the hull: a window of no width) scouting to its
// right: the plan is the hull's turn.
let g = spg();
g._scoutDir = [1, 0, 0];
const scoutPlan = planScout(g, 0);
out.scout = { turns: hullScoutTurns(g), types: scoutPlan.map(a => a.type), tolerance: scoutPlan[0].tolerance,
              valid: hullYawAimValid(g, [1, 0, 0]) };
execHullTurnTo(g, scoutPlan[0]);
out.scoutTurning = { throttle: g.moveForward, steer: Math.sign(g.moveStrafe), turning: scoutPlan[0].turning, sensed: g.sensed };
// Facing the direction: the look and the sense, the drive at rest.
g = spg({ forward: [1, 0] });
g._scoutDir = [1, 0, 0];
const facing = planScout(g, 0);
execHullTurnTo(g, facing[0]);
out.scoutFacing = { throttle: g.moveForward, steer: g.moveStrafe, sensed: g.sensed, looked: g.looked, turning: facing[0].turning };
// 4 deg off is inside the 5 deg tolerance; 6 deg is not.
out.scoutTolerance = [hullYawAimValid(spg(), [Math.sin(4 * Math.PI / 180), 0, Math.cos(4 * Math.PI / 180)]),
                      hullYawAimValid(spg(), [Math.sin(6 * Math.PI / 180), 0, Math.cos(6 * Math.PI / 180)])];
// A camera window of +-25 deg (a seat whose gun traverses): 20 in, 30 out.
out.scoutWindow = [hullYawAimValid(spg({ window: [-25, 25] }), [Math.sin(20 * Math.PI / 180), 0, Math.cos(20 * Math.PI / 180)]),
                   hullYawAimValid(spg({ window: [-25, 25] }), [Math.sin(30 * Math.PI / 180), 0, Math.cos(30 * Math.PI / 180)])];
// A turret rig's own limits win over the window.
out.scoutRig = hullYawAimValid(spg({ limits: [-Math.PI, Math.PI] }), [-1, 0, 0]);
// A hull that is not `isTurnable` (a Sherman) keeps the look-only plan.
g = spg({ isTurnable: false });
g._scoutDir = [1, 0, 0];
out.scoutSherman = { turns: hullScoutTurns(g), types: planScout(g, 0).map(a => a.type) };
// A soldier's is untouched.
const s = { position: [0, 0, 0], yaw: 0, currentPlan: [], planBehaviour: null, random: () => 0.5, vehicle: null,
            _scoutDir: [1, 0, 0], _planIdle: () => [] };
out.scoutSoldier = planScout(s, 0).map(a => a.type);

// ---------------------------------------------------------------- entry 33
const rifle = { name: 'K98', strength: { Infantry: 5, HeavyArmour: 0 }, minRange: 0, maxRange: 150, ammo: 5, isThrown: false };
const grenade = { name: 'GrenadeAxis', strength: { Infantry: 2, LightArmour: 2, HeavyArmour: 1 }, minRange: 5, maxRange: 20,
                  ammo: 3, indirect: 1, isThrown: true };
const kit = [rifle, grenade];
out.thrown = {
  at12: soldierChoseThrownWeapon(kit, 12, 'Infantry'),
  at5: soldierChoseThrownWeapon(kit, 5, 'Infantry'),
  at4_9: soldierChoseThrownWeapon(kit, 4.9, 'Infantry'),
  // No maxRange test: the plan walks into range.
  at60: soldierChoseThrownWeapon(kit, 60, 'Infantry'),
  noAmmo: soldierChoseThrownWeapon([rifle, { ...grenade, ammo: 0 }], 12, 'Infantry'),
  // Strength is the whole number the engine keeps: 0.9 is 0.
  weak: soldierChoseThrownWeapon([rifle, { ...grenade, strength: { Infantry: 0.9 } }], 12, 'Infantry'),
  air: soldierChoseThrownWeapon(kit, 12, 'Air'),
  // An ExpPack is indirect and not thrown.
  expPack: soldierChoseThrownWeapon([rifle, { ...grenade, name: 'ExpPack', isThrown: false }], 12, 'Infantry'),
  // Data older than the word: the FireArms' wind-up stands in.
  oldData: soldierChoseThrownWeapon([rifle, { ...grenade, isThrown: null }], 12, 'Infantry', w => (w.name === 'GrenadeAxis' ? 0.6 : 0)),
  oldDataRifle: soldierChoseThrownWeapon([{ ...rifle, isThrown: null }], 12, 'Infantry', () => 0),
};
function shooter(weapons, rolls = [0.5]) {
  let i = 0;
  return { weapons, firingTarget: 'e1', weaponData: {}, position: [0, 0, 0], targetPosition: [12, 0, 0],
           random: () => rolls[Math.min(i++, rolls.length - 1)] };
}
// A direct weapon: direct fire, whatever the distance.
let sh = shooter(kit);
out.decideDirect = fireDecision(sh, { now: 10, direct: 0, dist: 12, type: 'Infantry' });
// A tank, the rifle useless: the throw, then nothing until the clock runs
// (5 + 5 x 0.5 = 7.5 s), then the throw again.
sh = shooter(kit);
const d1 = fireDecision(sh, { now: 10, direct: -1, dist: 12, type: 'HeavyArmour' });
const d2 = fireDecision(sh, { now: 14, direct: -1, dist: 12, type: 'HeavyArmour' });
const d3 = fireDecision(sh, { now: 17.4, direct: -1, dist: 12, type: 'HeavyArmour' });
const d4 = fireDecision(sh, { now: 17.6, direct: -1, dist: 12, type: 'HeavyArmour' });
out.decideThrow = [d1, d2, d3, d4];
out.decideWait = sh._fireData.throwWait;
out.decideHistory = [...sh._fireData.history];
// Inside the grenade's 5 m there is no thrown weapon: no plan.
sh = shooter(kit);
out.decideInside = fireDecision(sh, { now: 10, direct: -1, dist: 3, type: 'HeavyArmour' });
// 5 s without a plan, or a new target, starts the data over.
sh = shooter(kit);
fireDecision(sh, { now: 10, direct: -1, dist: 12, type: 'HeavyArmour' });
out.decideAfterGap = fireDecision(sh, { now: 15.5, direct: -1, dist: 12, type: 'HeavyArmour' }).state;
sh = shooter(kit);
fireDecision(sh, { now: 10, direct: -1, dist: 12, type: 'HeavyArmour' });
sh.firingTarget = 'e2';
out.decideNewTarget = fireDecision(sh, { now: 11, direct: -1, dist: 12, type: 'HeavyArmour' }).state;
out.states = { ...FIRE_STATE };

console.log(JSON.stringify(out));
