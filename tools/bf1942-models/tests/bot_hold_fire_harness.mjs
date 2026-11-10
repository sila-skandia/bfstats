// Headless checks of the bots' hold-fire for a teammate in the line
// (viewer/friendly-fire.js `friendInLine`, bot-plans.js `holdFireFor` and
// `execTrigger`) and of the give-up on a unit a bot cannot reach
// (bot-mount.js `UNIT_VETO`, `execEnterVehicle`). Both are INVENTIONs
// (features/bot-map-generation/hold-fire.md). Prints one JSON object.

import { friendInLine, HOLD_FIRE } from '../viewer/friendly-fire.js';
import { execTrigger, holdFireFor } from '../viewer/bot-plans.js';
import { execEnterVehicle, unitVetoed, UNIT_VETO } from '../viewer/bot-mount.js';
import { faceTarget } from '../viewer/bot-aim.js';

const out = {};

// --- the tube ---------------------------------------------------------------
const origin = [0, 1.65, 0];
const aim = [0, 1.0, 40];            // a standing target 40 m down +z, aimed a metre over its feet
const f = (id, pos, stance = 'stand') => ({ id, pos, stance });
out.tube = {
  inTube: friendInLine(origin, aim, [f('a', [0, 0, 5])]),
  offByHalf: friendInLine(origin, aim, [f('a', [0.5, 0, 5])]),
  beside: friendInLine(origin, aim, [f('a', [1.0, 0, 5])]),
  beyondTarget: friendInLine(origin, aim, [f('a', [0, 0, 45])]),
  atTarget: friendInLine(origin, aim, [f('a', [0.3, 0, 40])]),
  justInFrontOfTarget: friendInLine(origin, aim, [f('a', [0, 0, 39.5])]),
  behindShooter: friendInLine(origin, aim, [f('a', [0, 0, -3])]),
  proneUnderLine: friendInLine(origin, [0, 1.65, 40], [f('a', [0, 0, 5], 'prone')]),
  pastReach: friendInLine(origin, [0, 1.0, 80], [f('a', [0, 0, 50])]),
  nearestOfTwo: friendInLine(origin, aim, [f('far', [0, 0, 20]), f('near', [0.2, 0, 3])]),
  plusX: friendInLine(origin, aim, [f('a', [0.3, 0, 5])]),
  minusX: friendInLine(origin, aim, [f('a', [-0.3, 0, 5])]),
  radius: HOLD_FIRE.radius, reach: HOLD_FIRE.reach,
};

// --- the trigger --------------------------------------------------------------
// A world of three players: the bot (team 1), an enemy 40 m down +z and a
// teammate whose position each case sets.
function world(friendPos, friendTeam = 1) {
  const players = new Map([
    ['bot', { team: 1, soldier: { x: 0, y: 0, z: 0, stance: 'stand' } }],
    ['enemy', { team: 2, soldier: { x: 0, y: 0, z: 40, stance: 'stand' } }],
  ]);
  if (friendPos) players.set('friend', { team: friendTeam, soldier: { x: friendPos[0], y: friendPos[1], z: friendPos[2], stance: 'stand' } });
  return {
    players,
    player: id => players.get(id) ?? null,
    armorOf: () => ({ destroyed: false }),
  };
}
function bot(friendPos, { holdFire = true, friendTeam = 1 } = {}) {
  const eye = [0, 1.65, 0];
  const want = faceTarget(eye, [0, 1.0, 40]);
  return {
    playerId: 'bot', team: 1, position: [0, 0, 0], yaw: 0, pitch: want.pitch, holdFire,
    world: world(friendPos, friendTeam), weapons: [{ name: 'Kar98k' }], weaponIndex: 0,
    weaponAi: { name: 'Kar98k', healing: false, indirect: 0 }, weaponData: {},
    _eye: () => eye, _aimOrigin: () => eye, _aimReference: () => ({ yaw: want.yaw, pitch: want.pitch }),
    _lineClear: () => true, _nav: () => null, navGrid: null, _now: 0,
    isFiring: false, moveStrafe: 0,
  };
}
const trigger = () => ({ type: 'Trigger', targetId: 'enemy', targetPos: [0, 0, 40], tolerance: 0.1 });
function fires(b) { b.isFiring = false; execTrigger(b, trigger(), b._now); return b.isFiring; }
out.trigger = {
  clear: fires(bot(null)),
  friendInLine: fires(bot([0, 0, 6])),
  friendBeside: fires(bot([1.2, 0, 6])),
  friendBeyond: fires(bot([0, 0, 46])),
  enemyInLine: fires(bot([0, 0, 6], { friendTeam: 2 })),
  holdFireOff: fires(bot([0, 0, 6], { holdFire: false })),
};
// It keeps the aim and fires the tick the line clears.
{
  const b = bot([0, 0, 6]);
  const held = fires(b);
  b.world.players.get('friend').soldier.x = 1.5;
  b._now = 0.1;
  out.trigger.clearsThenFires = { held, after: fires(b), stateAfter: b._holdFire };
}
// The step aside: nothing before `stepAfter`, then a strafe away from the
// friend. Looking down +z a soldier's strafe +1 runs toward -x (walking-body.js,
// its right row (-cos yaw, sin yaw)); the friend is at -x, so the step is -1.
{
  const b = bot([-0.3, 0, 6]);
  const seq = [];
  for (let t = 0; t <= 2.0 + 1e-9; t += 0.25) {
    b._now = t; b.moveStrafe = 0;
    seq.push({ t, firing: fires(b), strafe: b.moveStrafe });
  }
  out.step = { seq, stepAfter: HOLD_FIRE.stepAfter, stepSeconds: HOLD_FIRE.stepSeconds, steps: b._holdFireSteps ?? 0 };
}
// A medic's heal (a friend as the target) is never held.
{
  const b = bot([0, 0, 6]);
  out.trigger.healFriend = holdFireFor(b, { targetId: 'friend' }, [0, 0, 6]);
  b.weaponAi.healing = true;
  out.trigger.healingWeapon = holdFireFor(b, trigger(), [0, 0, 40]);
}
// A thrown weapon (a FireArms with a `fireDelay`) arcs over the friend.
{
  const b = bot([0, 0, 6]);
  b.weaponAi = { name: 'StickGrenade' };
  b.weaponData = { StickGrenade: { throw: { fireDelay: 0.5 } } };
  out.trigger.thrown = holdFireFor(b, trigger(), [0, 0, 40]);
}

// --- the give-up --------------------------------------------------------------
// A gun 16.5 m up, the bot standing under it: never inside the Use key's
// 12.375 m. `walk` moves the bot toward it at `speed` m/s (0: standing).
function chase({ speed = 0, start = [0, 0, 0], gunAt = [0, 16.5, 0], until = 400, routeFailedAt = null } = {}) {
  const gun = { id: 'gun:0', vehicleId: 'gun', pos: gunAt, seatPos: gunAt };
  const b = { playerId: 'b', position: [...start], vehicle: null, vehicleCandidates: [gun], _now: 0,
              currentPlan: [{}], route: null, _pathFailures: 0, changedTarget: {}, enterRequest: null };
  const action = { vehicleId: 'gun:0', seatId: null, seatPos: gunAt };
  let vetoAt = null;
  for (let t = 0; t <= until; t += 0.5) {
    b._now = t;
    if (speed > 0) {
      const dx = gunAt[0] - b.position[0], dz = gunAt[2] - b.position[2], d = Math.hypot(dx, dz);
      if (d > 0.5) { b.position[0] += dx / d * speed * 0.5; b.position[2] += dz / d * speed * 0.5; }
    }
    if (routeFailedAt !== null && t >= routeFailedAt) { b.route = { failed: true }; b._pathFailures = UNIT_VETO.failures; }
    if (vetoAt === null && execEnterVehicle(b, action)) vetoAt = t;
    if (vetoAt !== null) break;
  }
  return { b, gun, vetoAt };
}
{
  const r = chase();
  out.veto = {
    patience: UNIT_VETO.patience, seconds: UNIT_VETO.seconds,
    standingVetoAt: r.vetoAt, planDropped: r.b.currentPlan.length === 0,
    vetoedJustAfter: unitVetoed(r.b, r.gun, r.vetoAt + 1),
    vetoedBeforeTimeout: unitVetoed(r.b, r.gun, r.vetoAt + UNIT_VETO.seconds - 1),
    vetoedAfterTimeout: unitVetoed(r.b, r.gun, r.vetoAt + UNIT_VETO.seconds + 1),
    otherSeatOfHull: (() => { const x = chase(); return unitVetoed(x.b, { id: 'gun:1', vehicleId: 'gun' }, x.vetoAt + 1); })(),
  };
  // A bot walking in from 45 m gains on the gun and is not vetoed on the way.
  const w = chase({ speed: 3, start: [0, 0, 45], gunAt: [0, 0, 0], until: 30 });
  out.veto.walkingIn = { vetoAt: w.vetoAt };
  // The route to it failing three times vetoes it at once.
  const f2 = chase({ speed: 0, routeFailedAt: 4 });
  out.veto.routeFailedVetoAt = f2.vetoAt;
}

process.stdout.write(JSON.stringify(out));
