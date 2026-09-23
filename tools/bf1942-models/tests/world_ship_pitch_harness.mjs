// Drives `viewer/world.js` headless with mocked drivetrains to pin the Issue 2
// input routing: a ship's `c_PIPitch` consumers (landing-craft ramps,
// Gato/Sub7C dive planes + float trim) are fed from the pitch axis, while
// ground/tank hulls -- which bind no `c_PIPitch` anywhere in the corpus --
// never see it, and the air branch is unchanged.
//
// Run by `tests/test_world_ship_pitch.py`, which stands the modules up
// exactly as `test_world.py` does. The drivetrains here are stubs recording
// what each `integrate` saw (the same shape as
// `world_held_input_harness.mjs`'s `makeVehicle`); the rig data proving the
// consumers exist lives in `viewer/models/*.report.json` (`riggedParts`).

import { World, WORLD_TICK_RATE, WORLD_TICK_DT, STICK_RATE, STICK_RETURN } from './world.mjs';

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
                       yaw: this.input('c_PIYaw'),
                       pitch: this.input('c_PIPitch'),
                       roll: this.input('c_PIRoll'),
                       fire: this.input('c_PIFire'),
                       altFire: this.input('c_PIAltFire') });
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

function mounted(kind) {
  const world = new World({ collider, extras: EXTRAS,
                            groundHeight: () => 0 });
  world.addPlayer('P', { team: 1 });
  const vehicle = makeVehicle();
  const occupancy = makeOccupancy();
  world.setPlayerVehicle('P', { occupancy, vehicle, kind,
                                groups: [], manned: [] });
  return { world, vehicle, occupancy };
}

/** Feed one word per 30 Hz tick, exactly the way the page feeds the world. */
function drive(kind, words) {
  const m = mounted(kind);
  for (const w of words) {
    m.world.setInput('P', { ...IDLE, ...w });
    m.world.step(1 / 30);
  }
  return m;
}

const rep = (n, word) => Array.from({ length: n }, () => ({ ...word }));

// A ship holding ArrowUp for a full second: the pitch spring (the air
// branch's own STICK_RATE) ramps c_PIPitch to full deflection, while the
// throttle never moves -- W/S is c_PIThrottle, arrows are c_PIPitch, and the
// two never meet.
const shipHeld = drive('ship', rep(30, { pitch: 1 }));
const ship = {
  ticks: shipHeld.vehicle.seen.length,
  pitchFirst: shipHeld.vehicle.seen[0].pitch,
  pitchLast: shipHeld.vehicle.seen[29].pitch,
  pitches: shipHeld.vehicle.seen.map(s => s.pitch),
  throttles: shipHeld.vehicle.seen.map(s => s.throttle),
  yaws: shipHeld.vehicle.seen.map(s => s.yaw),
  stickRate: STICK_RATE,
  tickDt: WORLD_TICK_DT,
};

// W/S drives the ship's throttle and nothing else: full forward with no pitch
// word leaves c_PIPitch at rest, and the raw W/S pair alone (forwardKeys,
// which the air branch spends on its latching throttle) moves neither the
// throttle -- the ship reads `forward`, pad folded in, as the ground branch
// always did -- nor the pitch.
const shipThrottle = drive('ship', rep(10, { forward: 1 }));
const shipKeysOnly = drive('ship', rep(5, { forwardKeys: 1 }));
const decouple = {
  throttles: shipThrottle.vehicle.seen.map(s => s.throttle),
  pitches: shipThrottle.vehicle.seen.map(s => s.pitch),
  keysThrottles: shipKeysOnly.vehicle.seen.map(s => s.throttle),
  keysPitches: shipKeysOnly.vehicle.seen.map(s => s.pitch),
};

// The mobile pad bypasses the spring, exactly as the air branch does: full
// deflection lands on the first tick.
const shipPad = drive('ship', [{ pitch: 0.7, pad: true }]);
const pad = { pitchFirst: shipPad.vehicle.seen[0].pitch };

// Release springs back to rest at STICK_RETURN: thirty held ticks, then ten
// released ones, end at zero.
const shipRelease = drive('ship', [...rep(30, { pitch: 1 }), ...rep(10, {})]);
const release = {
  ticks: shipRelease.vehicle.seen.length,
  pitchLast: shipRelease.vehicle.seen[39].pitch,
  stickReturn: STICK_RETURN,
};

// Ground and tank hulls bind no c_PIPitch anywhere in the corpus, so a held
// pitch word must never reach their drivetrains -- while their own throttle
// and steer keep working.
const groundHeld = drive('ground', rep(10, { forward: 1, pitch: 1 }));
const tankHeld = drive('tank', rep(10, { forward: 1, pitch: 1 }));
const ground = {
  pitches: groundHeld.vehicle.seen.map(s => s.pitch),
  throttles: groundHeld.vehicle.seen.map(s => s.throttle),
};
const tank = {
  pitches: tankHeld.vehicle.seen.map(s => s.pitch),
  throttles: tankHeld.vehicle.seen.map(s => s.throttle),
};

// The air branch is untouched: arrows still spring c_PIPitch to full, and the
// latching throttle still ignores a zero power word.
const airHeld = drive('air', rep(30, { pitch: 1 }));
const air = {
  pitchFirst: airHeld.vehicle.seen[0].pitch,
  pitchLast: airHeld.vehicle.seen[29].pitch,
  throttles: airHeld.vehicle.seen.map(s => s.throttle),
};

console.log(JSON.stringify({
  tickRate: WORLD_TICK_RATE,
  tickDt: WORLD_TICK_DT,
  ship,
  decouple,
  pad,
  release,
  ground,
  tank,
  air,
}));
