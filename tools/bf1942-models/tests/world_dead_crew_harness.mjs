// Drives `viewer/world.js` headless and prints one JSON blob. Run by
// `tests/test_world_dead_crew.py`, on `test_world.py`'s own module set.
//
// What is pinned: a seated player whose soldier Armor is destroyed takes no
// part in the seat's input -- no trigger, no throttle, no aim -- whatever the
// page has or has not done about emptying the seat, and whatever the hull's
// own state is. The bug it guards: a Nebelwerfer's own splash killed the man
// at the launcher and left the launcher whole; the seat's input went on
// flowing until the page's one-per-frame release ran, and when it did not
// run (the pilot box unchecked with the seat still held) the dead man kept
// firing it.

import { World } from './world.mjs';

const collider = { waterLevel: null, surfaceHeight() { return 0; }, heightfield: null };
const EXTRAS = {
  worldSize: 600,
  controlPoints: [{ name: 'North', spawnGroupId: 1, team: 1, position: [10, 0, 10] }],
  soldierSpawns: [{ name: 'N1', group: 1, team: 1, position: [10, 0, 10], rotation: [180, 0, 0] }],
  tickets: { 1: 100, 2: 100 },
};
const IDLE = { forward: 0, strafe: 0, forwardKeys: 0, rudder: 0, walk: false,
               crouch: false, prone: false, jump: false, fire: false,
               altFire: false, roll: 0, pitch: 0, pad: false };

class GunStub {
  constructor() { this.groups = []; }
  group() {
    const group = { firing: false, shots: 0, stats: { roundOfFire: 10, input: 'c_PIFire' },
                    node: { userData: { fireArms: {} } } };
    this.groups.push(group);
    return group;
  }
  setFiring(group, on) { group.firing = !!on; return true; }
  advance() {}
}

function makeVehicle() {
  const inputs = new Map();
  return {
    state: { position: { x: 0, y: 0, z: 0 } }, seen: [],
    setInput(name, value) { inputs.set(name, value); },
    input(name) { return inputs.get(name) ?? 0; },
    integrate() { this.seen.push({ throttle: this.input('c_PIThrottle'), fire: this.input('c_PIFire') }); },
  };
}

/** A seat of `kind`: a bare static gun (no drivetrain) or a ground driver. */
function mounted(kind) {
  const guns = new GunStub();
  const world = new World({ collider, extras: EXTRAS, guns, groundHeight: () => 0 });
  world.addPlayer('P', { team: 1 });
  const armor = { destroyed: false, hitPoints: 30, maxHitPoints: 30 };
  world.setPlayerArmor('P', armor);
  const group = guns.group();
  const turret = { inputScale: 1, aimed: [], carriage: [],
                   aim(x, y, strafe) { this.aimed.push([x, y]); this.carriage.push(strafe); },
                   step() {} };
  const occupancy = { root: null, turret, isActiveRoot: () => true, applyTurrets() {},
                      activeFireArmsNodes: () => (kind === 'gun' ? [group.node] : []) };
  const vehicle = kind === 'gun' ? null : makeVehicle();
  world.setPlayerVehicle('P', {
    occupancy, vehicle, kind: kind === 'gun' ? 'gun' : 'ground',
    groups: kind === 'gun' ? [] : [group], manned: kind === 'gun' ? [group] : [],
  });
  return { world, guns, group, armor, turret, vehicle };
}

function run(kind) {
  const m = mounted(kind);
  const word = { ...IDLE, fire: true, forward: 1, strafe: 1 };
  const frame = n => { for (let i = 0; i < n; i++) { m.world.setInput('P', word, { x: 4, y: -2 }); m.world.step(1 / 30); } };
  frame(3);
  const alive = {
    firing: m.group.firing,
    throttle: m.vehicle ? m.vehicle.seen.at(-1).throttle : null,
    carriage: m.turret.carriage.at(-1),
    scale: m.turret.inputScale,
  };
  m.armor.destroyed = true;          // the splash got him; the hull is whole
  m.armor.hitPoints = 0;
  frame(3);
  const dead = {
    firing: m.group.firing,
    throttle: m.vehicle ? m.vehicle.seen.at(-1).throttle : null,
    fire: m.vehicle ? m.vehicle.seen.at(-1).fire : null,
    carriage: m.turret.carriage.at(-1),
    scale: m.turret.inputScale,
    blocked: m.world.players.get('P').gate.blocked,
  };
  return { alive, dead };
}

console.log(JSON.stringify({ gun: run('gun'), driver: run('driver') }));
