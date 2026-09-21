// Drives `viewer/world.js` headless at display rates BELOW the 30 Hz tick and
// prints one JSON blob. Run by `tests/test_world_held_input.py`, which stands
// the modules up exactly as `test_world.py` does.
//
// What is pinned: a frame longer than 33 ms owes several world ticks, and the
// page feeds ONE un-sequenced input word for all of them -- the device state
// the frame sampled. Every one of that frame's ticks must run against that
// word (the client's `InputManager::update` 0x0049cff7 samples once for
// `nTicks`, and mouse-input.js's pump divides the counts by `nTicks / 30` on
// the promise that each of the n ticks applies the axis). The catch-up ticks
// used to get the engine's zeroed idle word instead, which ended every slow
// frame with `guns.setFiring(group, false)`: `group.firing` read false at
// draw time, so map.html's `updateAudio` closed a vehicle MG's fire-loop gate
// every frame, and the gun fired on one tick in n.
//
// The server's law is untouched and pinned beside it: a SEQUENCED buffer that
// runs dry still yields the idle word, and so does a frame the page fed
// nothing for.

import { World, WORLD_TICK_RATE, WORLD_TICK_DT } from './world.mjs';

const collider = {
  waterLevel: null,
  surfaceHeight(x, z) { return 0; },
  heightfield: null,
};

const EXTRAS = {
  worldSize: 600,
  controlPoints: [
    { name: 'North', spawnGroupId: 1, team: 1, position: [10, 0, 10] },
  ],
  soldierSpawns: [
    { name: 'N1', group: 1, team: 1, position: [10, 0, 10], rotation: [180, 0, 0] },
  ],
  tickets: { 1: 100, 2: 100 },
};

const IDLE = { forward: 0, strafe: 0, forwardKeys: 0, rudder: 0, walk: false,
               crouch: false, prone: false, jump: false, fire: false,
               altFire: false, roll: 0, pitch: 0, pad: false };

/**
 * The trigger half of gunfire.js's `GunFire`, law for law: `setFiring` is the
 * idempotent latch, and `advance` runs the `roundOfFire` timer -- held, it
 * fires a round each time the timer crosses zero and keeps the remainder;
 * released, it runs down and floors at zero. Every `advance` also records
 * whether the trigger was held for that tick, which is the thing under test.
 */
class GunStub {
  constructor() {
    this.groups = [];
    this.heldTicks = 0;
    this.releasedTicks = 0;
  }
  group(roundOfFire) {
    const group = { firing: false, cooldown: 0, shots: 0,
                    stats: { roundOfFire, input: 'c_PIFire' },
                    node: { userData: { fireArms: {} } } };
    this.groups.push(group);
    return group;
  }
  setFiring(group, on) {
    if (!group || group.firing === !!on) return false;
    group.firing = !!on;
    return true;
  }
  advance(dt) {
    for (const group of this.groups) {
      if (group.firing) {
        this.heldTicks += 1;
        group.cooldown -= dt;
        const period = 1 / (group.stats.roundOfFire || 1);
        while (group.cooldown <= 0) {
          group.shots += 1;
          group.cooldown += period;
        }
      } else {
        this.releasedTicks += 1;
        if (group.cooldown > 0) group.cooldown = Math.max(0, group.cooldown - dt);
      }
    }
  }
}

/** The drive model's input surface, and a record of what each integrate saw. */
function makeVehicle() {
  const inputs = new Map();
  return {
    state: { position: { x: 0, y: 0, z: 0 } },
    seen: [],
    setInput(name, value) { inputs.set(name, value); },
    input(name) { return inputs.get(name) ?? 0; },
    integrate() {
      this.seen.push({ throttle: this.input('c_PIThrottle'),
                       yaw: this.input('c_PIYaw') });
    },
  };
}

function makeOccupancy() {
  const turret = { inputScale: 1, aimed: [],
                   aim(x, y) { this.aimed.push([x, y]); }, step() {} };
  return {
    root: null, turret,
    isActiveRoot: () => true,
    applyTurrets() {},
    activeFireArmsNodes: () => [],
  };
}

/** A mounted ground vehicle with one 600 rpm machine gun on c_PIFire. */
function mounted() {
  const guns = new GunStub();
  const world = new World({ collider, extras: EXTRAS, guns,
                            groundHeight: () => 0 });
  world.addPlayer('P', { team: 1 });
  const vehicle = makeVehicle();
  const occupancy = makeOccupancy();
  const group = guns.group(10);
  world.setPlayerVehicle('P', { occupancy, vehicle, kind: 'ground',
                                groups: [group], manned: [] });
  return { world, guns, vehicle, occupancy, group };
}

/**
 * One second of a held trigger, full throttle, full right steer and a steady
 * mouse axis at `fps`, fed the way map.html's frame() feeds it: one
 * un-sequenced word, then one step of the frame's dt. `firingAtDraw` is what
 * `updateAudio` reads -- `group.firing` after the step.
 */
function heldSecond(fps) {
  const m = mounted();
  const word = { ...IDLE, forward: 1, strafe: 1, fire: true };
  let ticks = 0;
  let framesWithTicks = 0;
  let firingAtDraw = 0;
  for (let i = 0; i < fps; i++) {
    m.world.setInput('P', word, { x: 4, y: -2 });
    const report = m.world.step(1 / fps);
    ticks += report.ticks;
    if (report.ticks > 0) {
      framesWithTicks += 1;
      if (m.group.firing) firingAtDraw += 1;
    }
  }
  const seen = m.vehicle.seen;
  return {
    fps, ticks, framesWithTicks, firingAtDraw,
    shots: m.group.shots,
    heldTicks: m.guns.heldTicks,
    releasedTicks: m.guns.releasedTicks,
    throttleTicks: seen.filter(s => s.throttle === 1).length,
    steerTicks: seen.filter(s => s.yaw === 1).length,
    aimedTicks: m.occupancy.turret.aimed
      .filter(([x, y]) => x === 4 && y === -2).length,
  };
}

const rates = [60, 30, 20, 15, 10].map(heldSecond);

// --- the trigger's release still lands the tick it is fed --------------------
// Held at 15 fps, then one frame with the trigger up: every tick of THAT
// frame runs released, none of them replays the held word of the frame before.
const rel = mounted();
for (let i = 0; i < 15; i++) {
  rel.world.setInput('P', { ...IDLE, fire: true });
  rel.world.step(1 / 15);
}
const relHeldBefore = rel.guns.releasedTicks;
rel.world.setInput('P', IDLE);
const relReport = rel.world.step(1 / 15);
const release = {
  ticks: relReport.ticks,
  releasedTicks: rel.guns.releasedTicks - relHeldBefore,
  firingAtDraw: rel.group.firing,
};

// --- a frame the page fed nothing for idles -----------------------------------
// The held word belongs to the frame that fed it. A later step with no
// setInput at all (a free-camera frame, a stalled feed) gets the idle word on
// every tick: the trigger drops and the throttle is zeroed.
const stale = mounted();
stale.world.setInput('P', { ...IDLE, forward: 1, fire: true });
stale.world.step(1 / 15);
const staleSeenBefore = stale.vehicle.seen.length;
const staleReport = stale.world.step(1 / 15);     // nothing fed
const unfed = {
  ticks: staleReport.ticks,
  firingAtDraw: stale.group.firing,
  throttles: stale.vehicle.seen.slice(staleSeenBefore).map(s => s.throttle),
  lastIdle: stale.world.players.get('P').last.idle === true,
};

// --- the wire's law is untouched ----------------------------------------------
// One SEQUENCED word and a two-tick step: the first tick consumes it, the
// second finds the buffer dry and must get the engine's zeroed word
// (`simulatePlayerUpdate` 0x0815bd00), never a replay.
const wire = mounted();
wire.world.setInput('P', { ...IDLE, forward: 1, fire: true }, null, 1);
const wireReport = wire.world.step(2 / 30);
const sequenced = {
  ticks: wireReport.ticks,
  throttles: wire.vehicle.seen.map(s => s.throttle),
  heldTicks: wire.guns.heldTicks,
  firingAtDraw: wire.group.firing,
  lastIdle: wire.world.players.get('P').last.idle === true,
};

// --- a driver's cannon is one gun ---------------------------------------------
// The driver's seat IS the drivetrain's root, so `activeFireArmsNodes()` names
// the same FireArms node the driver loop's `groups` already carry. A second
// group on that node (map.html's `collectMannedGuns` used to build one) was
// triggered by the active-seat loop as well: one pull of a Sherman's trigger
// was two shells in the air and two rounds off the HUD, and the FireState's
// reload and heat timers were stepped twice a tick.
function drivenCannon() {
  const m = mounted();
  const twin = m.guns.group(10);
  twin.node = m.group.node;                       // same FireArms node
  m.occupancy.activeFireArmsNodes = () => [m.group.node];
  m.world.refreshMount('P', { groups: [m.group], manned: [twin] });
  const state = m.world.fireStateFor(m.group.node);
  let steps = 0;
  const step = state.step.bind(state);
  state.step = dt => { steps += 1; return step(dt); };
  let ticks = 0;
  for (let i = 0; i < 30; i++) {
    m.world.setInput('P', { ...IDLE, fire: true });
    ticks += m.world.step(1 / 30).ticks;
  }
  return { ticks, steps, driverFiring: m.group.firing, twinFiring: twin.firing };
}

/** The hull gunner's seat: a different node, nobody driving. Still fires. */
function nestedGunner() {
  const m = mounted();
  const gunner = m.guns.group(10);
  m.occupancy.isActiveRoot = () => false;
  m.occupancy.activeFireArmsNodes = () => [gunner.node];
  m.world.refreshMount('P', { groups: [m.group], manned: [gunner] });
  m.world.setInput('P', { ...IDLE, fire: true });
  m.world.step(1 / 30);
  return { driverFiring: m.group.firing, gunnerFiring: gunner.firing };
}

// --- on foot -------------------------------------------------------------------
// The same second of forward walk at 60 fps and at 15 fps covers the same
// ground: the body's trajectory is frame-rate independent only if every
// tick of a slow frame is walked. And a HELD jump is one jump: the soldier
// derives the press edge from the level itself, so an idle word between two
// held ticks used to read as a release and re-press (a bunny hop per frame).
function walked(fps) {
  const world = new World({ collider, extras: EXTRAS, groundHeight: () => 0 });
  const p = world.addPlayer('W', { team: 1 });
  const from = { x: p.soldier.x, z: p.soldier.z };
  for (let i = 0; i < fps; i++) {
    world.setInput('W', { ...IDLE, forward: 1 });
    world.step(1 / fps);
  }
  return Math.hypot(p.soldier.x - from.x, p.soldier.z - from.z);
}

function turned(fps) {
  const world = new World({ collider, extras: EXTRAS, groundHeight: () => 0 });
  const p = world.addPlayer('T', { team: 1 });
  const yaw0 = p.soldier.body.yaw;
  let ticks = 0;
  for (let i = 0; i < fps; i++) {
    world.setInput('T', IDLE, { x: 2, y: 0 });
    ticks += world.step(1 / fps).ticks;
  }
  return { ticks, yaw: p.soldier.body.yaw - yaw0 };
}

function heldJumps(fps) {
  const world = new World({ collider, extras: EXTRAS, groundHeight: () => 0 });
  const p = world.addPlayer('J', { team: 1 });
  const body = p.soldier.body;
  const jump = body.jump.bind(body);
  let jumps = 0;
  body.jump = () => { jumps += 1; return jump(); };
  for (let i = 0; i < fps * 3; i++) {
    world.setInput('J', { ...IDLE, jump: true });
    world.step(1 / fps);
  }
  return jumps;
}

console.log(JSON.stringify({
  tickRate: WORLD_TICK_RATE,
  tickDt: WORLD_TICK_DT,
  rates,
  release,
  unfed,
  sequenced,
  drivenCannon: drivenCannon(),
  nestedGunner: nestedGunner(),
  foot: {
    walked60: walked(60),
    walked15: walked(15),
    turned60: turned(60),
    turned15: turned(15),
    heldJumps60: heldJumps(60),
    heldJumps15: heldJumps(15),
  },
}));
