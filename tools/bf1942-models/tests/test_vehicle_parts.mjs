/**
 * A hull's part sounds in the rack: a turret's servo, its tracks, a landing
 * gear and a flap, each by its class's rule (`vehicle-audio.js` `PART_RULES`,
 * ledger SND-19..SND-23).
 *
 * The M1A1 here carries DC's own `M1A1Tower.ssc` (`m1turretservo`, Volume and
 * Pitch on `Default`, the tower's turning rate) and its two tracks
 * (`moderntreads`, Volume on `Speed`, Pitch on a `Default` nothing ever
 * writes, so both tracks run one sample at one rate: the twin
 * `resolveAcross` exists for). The A-10's front leg carries
 * `Common/Sounds/LandingGear.ssc`'s two patches and its outer flap
 * `HullLeft.ssc`'s creak.
 *
 * Stub Web Audio, no browser. Run by `tests/test_vehicle_parts.py`.
 */
import assert from 'node:assert/strict';
import { VehicleAudioRack, PART_RULES } from '../viewer/vehicle-audio.js';

function stubCtx() {
  const param = (initial = 0) => ({
    value: initial,
    setTargetAtTime(v) { this.value = v; },
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
    cancelScheduledValues() {},
  });
  const node = (extra = {}) => ({ connect() { return this; }, disconnect() {}, ...extra });
  const ctx = {
    started: [],
    currentTime: 0,
    state: 'running',
    createGain() { return node({ gain: param(0) }); },
    createPanner() {
      return node({ positionX: param(0), positionY: param(0), positionZ: param(0),
                    refDistance: 1, rolloffFactor: 0 });
    },
    createBufferSource() {
      return node({
        buffer: null, loop: false, playbackRate: param(1),
        start() { ctx.started.push(this); },
        stop() { this.stopped = true; },
        onended: null,
      });
    },
  };
  return ctx;
}

/** A scene node with a local rotation the rack can read the turn off. */
function sceneNode(name, x = 0) {
  const node = {
    name,
    uuid: name,
    userData: { control: name },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1] },
    children: [],
    updateWorldMatrix() {},
    getObjectByName(n) {
      if (node.name === n) return node;
      for (const child of node.children) {
        const found = child.getObjectByName(n);
        if (found) return found;
      }
      return null;
    },
    traverse(fn) {
      fn(node);
      for (const child of node.children) child.traverse(fn);
    },
  };
  return node;
}

/** Turn `node` about its vertical axis to `degrees`. */
function yaw(node, degrees) {
  const half = degrees * Math.PI / 360;
  node.quaternion = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

const ramp = (source, params, dest = 'volume') => ({ dest, source, envelope: 'ramp', params });
const loop = (file, modulators, extra = {}) => ({
  file, loop: true, volume: 1, minDistance: 10, modulators, relativePosition: null, doppler: false, ...extra,
});
const oneShot = (file, extra = {}) => ({
  file, loop: false, volume: 1, minDistance: 2, modulators: [], relativePosition: null, doppler: false, ...extra,
});

const M1A1 = {
  template: 'M1A1', engine: null, layers: [], weapons: [],
  parts: [
    { node: 'M1A1Tower', kind: 'RotationalBundle', script: 'M1A1Tower.ssc', attachToListener: false,
      patches: [[loop('m1turretservo.mp3', [ramp('default', [0.1, 20, 0, 1]),
                                            ramp('default', [0, 10, 0.5, 0.1], 'pitch')])]] },
    { node: 'M1A1TrackL', kind: 'AnimatedBundle', script: 'M1A1TrackL.ssc', attachToListener: false,
      patches: [[loop('moderntreads.mp3', [ramp('default', [0, 1, 0.8, 0.1], 'pitch'),
                                           ramp('speed', [0, 10, 0, 1])])]] },
    { node: 'M1A1TrackR', kind: 'AnimatedBundle', script: 'M1A1TrackR.ssc', attachToListener: false,
      patches: [[loop('moderntreads.mp3', [ramp('default', [0, 1, 0.8, 0.1], 'pitch'),
                                           ramp('speed', [0, 10, 0, 1])])]] },
  ],
};

const fade = [ramp('timerelease', [0, 0.4, 1, -1])];
const A10 = {
  template: 'A10', engine: null, layers: [], weapons: [],
  parts: [
    { node: 'A10_Gear_Front', kind: 'LandingGear', script: 'LandingGear.ssc', attachToListener: false,
      patches: [
        [oneShot('lg3.mp3'), loop('lghi.mp3', fade), oneShot('LG2.mp3', { trigger: 'release' })],
        [oneShot('lg5.mp3'), loop('lghi_down.mp3', fade), oneShot('lg1.mp3', { trigger: 'release' })],
      ] },
    { node: 'A10FlapLeftOuter', kind: 'Wing', script: 'HullLeft.ssc', attachToListener: false,
      patches: [[loop('arplcrnk.mp3', [ramp('acceleration', [10, 30, 0, 1]), ramp('speed', [20, 40, 0, 1])]),
                 oneShot('creak_once.mp3')]] },
  ],
};

async function rig(spec, partNames, x = 5) {
  const ctx = stubCtx();
  const listener = { context: ctx, getInput: () => ctx.createGain(), position: { x: 0, y: 0, z: 0 } };
  const decoded = new Map();
  const rack = new VehicleAudioRack({
    listener: () => listener,
    getBuffer: async (_dir, file) => {
      if (!decoded.has(file)) decoded.set(file, { file, duration: 1 });
      return decoded.get(file);
    },
    report: () => ({ sounds: { vehicles: [spec] } }),
    dir: () => 'dc_medina_ridge',
    master: () => 1,
  });
  const hull = sceneNode(spec.template, x);
  const parts = {};
  for (const name of partNames) {
    parts[name] = sceneNode(name, x);
    hull.children.push(parts[name]);
  }
  const inputs = new Map();
  const drive = {
    state: { throttle: 0, airspeed: 0, velocity: { x: 0, y: 0, z: 0 } },
    input: name => inputs.get(name) ?? 0,
  };
  rack.claim({ seatKey: 'crew', node: hull, template: spec.template, drive, groups: [] });
  for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
  const tick = () => rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  const part = name => rack.snapshot().vehicles[0].parts.find(p => p.node === name);
  // What sounds: a loop the patch lets through, a one-shot that is playing.
  const heard = name => part(name).patches.flatMap(p => (p ? p.layers : []))
    .filter(l => l.output > 0 && (l.loop || l.playing));
  return { ctx, rack, parts, drive, inputs, tick, part, heard };
}

assert.deepEqual(Object.keys(PART_RULES).sort(),
  ['animatedbundle', 'landinggear', 'playercontrolobject', 'rotationalbundle', 'wing']);

{
  // The M1A1's tower: silent standing still, its servo up while it turns at
  // the rate it turns, gone the frame it stops, and back on the next turn.
  const { parts, tick, part, heard } = await rig(M1A1, ['M1A1Tower', 'M1A1TrackL', 'M1A1TrackR']);
  tick();
  assert.equal(heard('M1A1Tower').length, 0, 'a still tower is silent');
  let angle = 0;
  const turn = (degreesPerSecond, frames) => {
    for (let i = 0; i < frames; i++) {
      angle += degreesPerSecond / 30;
      yaw(parts.M1A1Tower, angle);
      tick();
    }
  };
  turn(20, 3);
  const [servo] = heard('M1A1Tower');
  assert.ok(servo, 'a turning tower plays its servo');
  assert.ok(Math.abs(part('M1A1Tower').rate - 20) < 0.01, `at its own rate (${part('M1A1Tower').rate} deg/s)`);
  assert.ok(Math.abs(servo.gain - (20 - 0.1) / (20 - 0.1)) < 1e-6, `Volume <- Default at 20 deg/s is full (${servo.gain})`);
  assert.ok(Math.abs(servo.playbackRate - 0.6) < 1e-6, `Pitch <- Default at 20 deg/s is 0.6 (${servo.playbackRate})`);
  turn(5, 2);
  const slow = heard('M1A1Tower')[0];
  assert.ok(Math.abs(slow.gain - (5 - 0.1) / 19.9) < 1e-6, 'a slower turn, a quieter servo');
  assert.ok(Math.abs(slow.playbackRate - 0.55) < 1e-6, 'and a lower one');
  turn(0, 1);
  assert.equal(heard('M1A1Tower').length, 0, 'it stops the frame the tower stops: no TimeRelease to fade on');
  assert.equal(part('M1A1Tower').patches[0].active, false, 'let go');
  turn(10, 2);
  assert.equal(heard('M1A1Tower').length, 1, 'the next turn starts it again');
}

{
  // The tracks: silent at rest, up with the hull's speed, and the two of them
  // one voice -- one `moderntreads` at one rate in two patches is the comb.
  const { tick, heard, drive } = await rig(M1A1, ['M1A1Tower', 'M1A1TrackL', 'M1A1TrackR']);
  tick();
  assert.equal(heard('M1A1TrackL').length + heard('M1A1TrackR').length, 0, 'tracks at rest are silent');
  drive.state.velocity = { x: 5, y: 0, z: 0 };
  tick();
  const left = heard('M1A1TrackL');
  const right = heard('M1A1TrackR');
  assert.equal(left.length + right.length, 1, 'two tracks of one sample at one rate are one voice');
  const [track] = [...left, ...right];
  assert.ok(Math.abs(track.gain - 0.5) < 1e-6, `Volume <- Speed at 5 m/s (${track.gain})`);
  assert.ok(Math.abs(track.playbackRate - 0.8) < 1e-6, 'Pitch <- a Default nobody writes: 0.8');
}

{
  // DC's right-hand tracks as they ship: `M1A1TrackR.ssc`'s `moderntreads`
  // is a `trigger Volume` loop that fades in on `Time` after the creation
  // trigger (0.15..0.25 s), then on Speed. It waits on that gate and starts
  // once, then runs on: a tank that stops and goes again does not stack a
  // second copy (the orphan would comb against the first for good). It used
  // to never start at all, on all five of DC's tracked IFVs and tanks.
  const TRACK_R = {
    template: 'T72', engine: null, layers: [], weapons: [],
    parts: [{ node: 'T72TrackR', kind: 'AnimatedBundle', script: 'T72TrackR.ssc', attachToListener: false,
              patches: [[loop('moderntreads.mp3', [ramp('time', [0.15, 0.25, 0, 1]),
                                                   ramp('default', [0, 1, 0.8, 0.1], 'pitch'),
                                                   ramp('speed', [0, 10, 0, 1])],
                              { trigger: 'volume' })]] }],
  };
  const { ctx, tick, drive } = await rig(TRACK_R, ['T72TrackR']);
  const sources = () => ctx.started.filter(s => s.buffer.file === 'moderntreads.mp3');
  for (let i = 0; i < 15; i++) tick();
  assert.equal(sources().length, 0, 'at rest the gate stays shut: nothing starts');
  drive.state.velocity = { x: 5, y: 0, z: 0 };
  tick();
  assert.equal(sources().length, 1, 'moving, the right track starts');
  assert.equal(sources()[0].loop, true, 'as the loop it is');
  drive.state.velocity = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 10; i++) tick();
  drive.state.velocity = { x: 5, y: 0, z: 0 };
  for (let i = 0; i < 10; i++) tick();
  assert.equal(sources().length, 1, 'stopping and going again starts no second copy');
}

{
  // And beside its twin: the M1A1's left track runs `moderntreads` at the
  // same rate from the claim. The frame the right one's latch fires it must
  // already contest (`resolveAcross` runs before `apply` starts it), or that
  // frame sounds both copies.
  const M1A1_SHIPPED = {
    ...M1A1,
    parts: [M1A1.parts[1], {
      ...M1A1.parts[2],
      patches: [[loop('moderntreads.mp3', [ramp('time', [0.15, 0.25, 0, 1]),
                                           ramp('default', [0, 1, 0.8, 0.1], 'pitch'),
                                           ramp('speed', [0, 10, 0, 1])],
                      { trigger: 'volume', relativePosition: [1, 0, 0] })]],
    }],
  };
  const { tick, drive, part } = await rig(M1A1_SHIPPED, ['M1A1TrackL', 'M1A1TrackR']);
  const sounding = () => ['M1A1TrackL', 'M1A1TrackR']
    .flatMap(name => part(name).patches[0].layers)
    .filter(l => l.nodeRate !== null && l.output > 0);
  for (let i = 0; i < 15; i++) tick();
  let most = 0;
  for (const speed of [5, 5, 5, 0, 0, 5, 5, 8, 8, 8]) {
    drive.state.velocity = { x: speed, y: 0, z: 0 };
    tick();
    most = Math.max(most, sounding().length);
  }
  assert.equal(most, 1, 'two tracks of one sample at one rate: never two voices, not even for a frame');
}

{
  // The A-10's gear: up and travelling plays patch 0 and lets patch 1 go;
  // stopped up, patch 0 lets go: its loop fades on TimeRelease and its
  // `trigger Release` clunk plays once. Coming down plays patch 1.
  const { ctx, parts, inputs, tick, part, heard } = await rig(A10, ['A10_Gear_Front', 'A10FlapLeftOuter']);
  const plays = file => ctx.started.filter(s => s.buffer.file === file).length;
  tick();
  assert.equal(heard('A10_Gear_Front').length, 0, 'a parked gear is silent');
  assert.equal(plays('lg1.mp3') + plays('LG2.mp3'), 0, 'and clunks nothing at build');
  inputs.set('c_PILandingGear', 1);
  let angle = 0;
  for (let i = 0; i < 20; i++) {
    angle += 3;
    yaw(parts.A10_Gear_Front, angle);
    tick();
  }
  const [up, down] = part('A10_Gear_Front').patches;
  assert.equal(up.active, true, 'retracting presses the up patch');
  assert.equal(down.active, false, 'and not the down one');
  assert.equal(plays('lg3.mp3'), 1, 'its start one-shot plays once a travel, not every frame');
  assert.ok(heard('A10_Gear_Front').some(l => l.file === 'lghi.mp3'), 'its motor loop runs');
  assert.ok(!heard('A10_Gear_Front').some(l => l.file === 'lghi_down.mp3'), 'the down motor does not');
  tick();
  assert.equal(plays('LG2.mp3'), 1, 'stopping up plays the up patch\'s end clunk');
  assert.ok(heard('A10_Gear_Front').some(l => l.file === 'lghi.mp3'), 'the motor fades on TimeRelease');
  for (let i = 0; i < 15; i++) tick();
  assert.ok(!heard('A10_Gear_Front').some(l => l.file === 'lghi.mp3'), 'and is gone 0.4 s on');
  assert.equal(plays('LG2.mp3'), 1, 'the clunk once, however long it stands');
  inputs.set('c_PILandingGear', 0);
  for (let i = 0; i < 20; i++) {
    angle -= 3;
    yaw(parts.A10_Gear_Front, angle);
    tick();
  }
  assert.equal(part('A10_Gear_Front').patches[1].active, true, 'coming down presses the down patch');
  assert.equal(plays('lg5.mp3'), 1, 'and plays its start one-shot');
  assert.equal(plays('lg3.mp3'), 1, 'and not the up one again');
}

{
  // A leg the page re-poses in one frame (a replay's seek, a hull put back
  // at its spawn) has not travelled: faster than twice its `setMaxSpeed` is
  // a snap, and plays nothing.
  const { ctx, parts, tick, part } = await rig(A10, ['A10_Gear_Front', 'A10FlapLeftOuter']);
  parts.A10_Gear_Front.userData.rig = { axes: { roll: { maxSpeed: 30 } } };
  tick();
  yaw(parts.A10_Gear_Front, 40);
  tick();
  tick();
  assert.equal(ctx.started.filter(s => !s.loop && /^lg/i.test(s.buffer.file)).length, 0,
    'a 40 degree jump in one frame clunks nothing');
  assert.equal(part('A10_Gear_Front').patches.some(p => p.active), false, 'and presses nothing');
  yaw(parts.A10_Gear_Front, 41);
  tick();
  assert.equal(part('A10_Gear_Front').patches[1].active, true, 'travel at 30 deg/s still does');
}

{
  // The flap never touches its sound (SND-22): the creak runs from the claim,
  // on the hull's own acceleration and speed, and its one-shot -- which went
  // off when the plane was made -- is not built.
  const { ctx, tick, heard, drive, rack } = await rig(A10, ['A10_Gear_Front', 'A10FlapLeftOuter']);
  tick();
  assert.equal(heard('A10FlapLeftOuter').length, 0, 'still and slow: no creak');
  assert.equal(ctx.started.filter(s => s.buffer.file === 'creak_once.mp3').length, 0,
    'no creation one-shot at the claim');
  drive.state.airspeed = 40;
  rack.vehicles.get('A10').accel = 30;
  tick();
  const [creak] = heard('A10FlapLeftOuter');
  assert.ok(creak && Math.abs(creak.gain - 1) < 1e-6, 'pulling hard at speed: the full creak');
}

console.log('vehicle-parts: all assertions passed');
