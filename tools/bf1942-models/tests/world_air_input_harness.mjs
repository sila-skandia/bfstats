// Drives `viewer/world.js` headless with a mocked aircraft to pin the pilot
// seat's tick law (`world-vehicle-tick.js`'s air branch): the rudder and the
// stick are the control map's channels written straight onto the hull, with
// no spring of the viewer's in front of them, and a mouse rate past 1 reaches
// every airframe whole (its parts clip themselves).
//
// Run by `tests/test_world_air_input.py`, which stands the modules up exactly
// as `test_world.py` does. The drivetrain is a stub recording what each
// `integrate` saw (the shape of `world_ship_pitch_harness.mjs`'s).

import { World, WORLD_TICK_RATE, WORLD_TICK_DT } from './world.mjs';

const collider = {
  waterLevel: null,
  surfaceHeight() { return 0; },
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

/** An aircraft's input surface; `vectored` is the helicopter/Harrier flag. */
function makeVehicle(vectored) {
  const inputs = new Map();
  return {
    vectored,
    state: { position: { x: 0, y: 0, z: 0 } },
    seen: [],
    setInput(name, value) { inputs.set(name, value); },
    input(name) { return inputs.get(name) ?? 0; },
    integrate() {
      this.seen.push({ yaw: this.input('c_PIYaw'),
                       roll: this.input('c_PIRoll'),
                       pitch: this.input('c_PIPitch'),
                       throttle: this.input('c_PIThrottle') });
    },
  };
}

function makeOccupancy() {
  return {
    root: null, turret: null,
    isActiveRoot: () => true,
    applyTurrets() {},
    activeFireArmsNodes: () => [],
  };
}

/** Feed one word per 30 Hz tick, exactly the way the page feeds the world. */
function fly(vectored, words) {
  const world = new World({ collider, extras: EXTRAS, groundHeight: () => 0 });
  world.addPlayer('P', { team: 1 });
  const vehicle = makeVehicle(vectored);
  world.setPlayerVehicle('P', { occupancy: makeOccupancy(), vehicle, kind: 'air',
                                groups: [], manned: [] });
  for (const w of words) {
    world.setInput('P', { ...IDLE, ...w });
    world.step(1 / 30);
  }
  return { world, vehicle };
}

const rep = (n, word) => Array.from({ length: n }, () => ({ ...word }));

const out = { tickRate: WORLD_TICK_RATE, tickDt: WORLD_TICK_DT };

// A key held for five ticks, then let go: full on the first tick, rest on the
// first tick after, on both kinds of airframe.
const keys = [...rep(5, { rudder: 1, roll: -1, pitch: 1 }), ...rep(3, {})];
for (const [name, vectored] of [['plane', false], ['heli', true]]) {
  const { vehicle } = fly(vectored, keys);
  out[`${name}Keys`] = { first: vehicle.seen[0], held: vehicle.seen[4], released: vehicle.seen[5] };
}

// One frame of mouse: 900 counts a second on the Air profile is 3.46 of roll
// and -3.47 of pitch (mouse_look_key_harness pins the arithmetic).
const hand = rep(3, { roll: 3.46, pitch: -3.47 });
out.planeMouse = fly(false, hand).vehicle.seen[0];
const heli = fly(true, hand);
out.heliMouse = heli.vehicle.seen[0];
out.heliStick = { ...heli.world.player('P').stick };

// The wire's own ceiling, +-16 (`PlayerAction::set`'s `floatToFixed(v, 12, 16)`).
out.wire = fly(true, [{ roll: 40, pitch: -40, rudder: 99 }]).vehicle.seen[0];

// A bot's word (the pad flag set, its law's own values) takes the same path.
out.botPad = fly(true, [{ roll: 0.4, pitch: -0.2, rudder: 0.7, pad: true }]).vehicle.seen[0];

console.log(JSON.stringify(out));
