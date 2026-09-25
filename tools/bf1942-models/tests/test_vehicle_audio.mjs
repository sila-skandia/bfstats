/**
 * The vehicle audio rack: one sounding hull per occupied vehicle, claimed by
 * the seats aboard it. The FPOV gap this closes is the whole point of the
 * suite — a bot's drivetrain used to build nothing — so the first assertion
 * is that a claim with a drive produces an engine graph at all.
 *
 * Stub Web Audio, no browser. Run by `tests/test_vehicle_audio.py`.
 */
import assert from 'node:assert/strict';
import { VehicleAudioRack, bareFireArmsName, MAX_LIVE_VEHICLES } from '../viewer/vehicle-audio.js';

function stubCtx() {
  const param = (initial = 0) => ({
    value: initial,
    setTargetAtTime(v) { this.value = v; },
    setValueAtTime(v) { this.value = v; },
    linearRampToValueAtTime(v) { this.value = v; },
  });
  const node = (extra = {}) => ({ connect() { return this; }, disconnect() {}, ...extra });
  const ctx = {
    started: [],
    currentTime: 0,
    state: 'running',
    resume() { this.state = 'running'; return Promise.resolve(); },
    createGain() { return node({ gain: param(0) }); },
    createPanner() {
      return node({
        panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1,
        maxDistance: 10000, rolloffFactor: 0,
        positionX: param(0), positionY: param(0), positionZ: param(0),
        orientationX: param(0), orientationY: param(0), orientationZ: param(-1),
      });
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

function fakeListener(ctx) {
  return {
    context: ctx,
    getInput() { return ctx.createGain(); },
    position: { x: 0, y: 0, z: 0 },
  };
}

function fakeBuffer() {
  return {
    duration: 1, sampleRate: 44100, length: 44100, numberOfChannels: 1,
    getChannelData() { return new Float32Array(1); },
  };
}

/** A scene node with just enough of THREE's surface for the rack. */
function sceneNode(name, x = 0) {
  const node = {
    name,
    uuid: name,
    userData: { control: name.replace(/_\d+$/, '') },
    matrixWorld: { elements: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      x, 0, 0, 1,
    ] },
    children: [],
    updateWorldMatrix() {},
    getObjectByName(n) {
      if (node.name === n) return node;
      for (const child of node.children) {
        const found = child.getObjectByName?.(n);
        if (found) return found;
      }
      return null;
    },
    traverse(fn) {
      fn(node);
      for (const child of node.children) child.traverse?.(fn);
    },
    getWorldQuaternion() { return { x: 0, y: 0, z: 0, w: 1 }; },
  };
  return node;
}

function childNode(parent, name) {
  const node = sceneNode(name);
  node.userData.fireArms = true;
  parent.children.push(node);
  return node;
}

const LAYER = (file) => ({
  file, loop: true, volume: 1, modulators: [],
  randomStartPitch: [0, 0], relativePosition: [0, 0, 0], doppler: true,
});

/** `extras`, the shape `findEngineSpec` reads (`report.sounds.vehicles`). */
function report(vehicles) {
  return { sounds: { vehicles } };
}

const SHERMAN = {
  template: 'sherman',
  level: 'aberdeen',
  engine: 'ShermanEngine',
  layers: [LAYER('sherm.wav')],
  weapons: [{
    fireArms: 'Coaxial_browning',
    script: 'High.ssc',
    layers: [LAYER('brown.wav')],
  }],
};

const WILLY = {
  template: 'willy',
  level: 'aberdeen',
  engine: 'WillyEngine',
  layers: [LAYER('willy.wav')],
  weapons: [],
};

function drive(x = 0) {
  return {
    state: {
      throttle: 0.5,
      airspeed: 0,
      velocity: { x: 0, y: 0, z: 0, length() { return 0; } },
      position: { x, y: 0, z: 0 },
    },
  };
}

function makeRack(ctx, extras) {
  const listener = fakeListener(ctx);
  return new VehicleAudioRack({
    listener: () => listener,
    getBuffer: async () => fakeBuffer(),
    report: () => extras,
    dir: () => 'aberdeen',
    master: () => 1,
  });
}

const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await tick(); };

// --- a bot's drivetrain sounds, which is the whole bug ----------------------

{
  const ctx = stubCtx();
  const rack = makeRack(ctx, report([SHERMAN]));
  const node = sceneNode('sherman', 10);
  childNode(node, 'ShermanEngine');
  childNode(node, 'Coaxial_browning');
  rack.claim({
    seatKey: 'bot:1', node, template: 'sherman',
    drive: drive(10), groups: [{ node: node.children[1], firing: true }],
  });
  await settle();
  const snap = rack.snapshot();
  assert.equal(snap.vehicles.length, 1, 'one claimed hull');
  assert.ok(snap.vehicles[0].built, 'the hull built its patches');
  assert.ok(snap.vehicles[0].engine,
    'a bot-driven hull must carry an engine graph (the FPOV gap)');
  assert.ok(snap.vehicles[0].engine.started, 'and it is running');
  assert.ok(snap.vehicles[0].engine.voices > 0, 'with its layers up');
  rack.dispose();
}

// --- two hulls are two notes; one hull with two seats is one ---------------

{
  const ctx = stubCtx();
  const rack = makeRack(ctx, report([SHERMAN]));
  const a = sceneNode('sherman', 5);
  childNode(a, 'ShermanEngine');
  childNode(a, 'Coaxial_browning');
  const b = sceneNode('sherman_1', 20);
  childNode(b, 'ShermanEngine');
  childNode(b, 'Coaxial_browning_1');
  rack.claim({ seatKey: 'bot:1', node: a, template: 'sherman', drive: drive(5), groups: [] });
  rack.claim({ seatKey: 'bot:2', node: b, template: 'sherman', drive: drive(20), groups: [] });
  // A gunner boards the first hull: same uuid, so one entry, not a third.
  rack.claim({ seatKey: 'bot:3', node: a, template: 'sherman', drive: null, groups: [] });
  await settle();
  const snap = rack.snapshot();
  assert.equal(snap.vehicles.length, 2,
    `two hulls are two entries and a shared hull is one, got ${snap.vehicles.length}`);
  assert.equal(snap.vehicles.filter(v => v.engine).length, 2, 'both drivers carry a note');
  assert.equal(snap.vehicles.find(v => v.key === 'sherman').claims, 2,
    'the shared hull holds both claims');
  rack.dispose();
}

// --- gunFor matches by node identity, not by bare name ---------------------

{
  const ctx = stubCtx();
  const rack = makeRack(ctx, report([SHERMAN]));
  const a = sceneNode('sherman', 5);
  const gunA = childNode(a, 'Coaxial_browning');
  childNode(a, 'ShermanEngine');
  const b = sceneNode('sherman_1', 20);
  const gunB = childNode(b, 'Coaxial_browning_1');
  childNode(b, 'ShermanEngine');
  rack.claim({ seatKey: 'bot:1', node: a, template: 'sherman', drive: drive(5), groups: [{ node: gunA }] });
  rack.claim({ seatKey: 'bot:2', node: b, template: 'sherman', drive: drive(20), groups: [{ node: gunB }] });
  await settle();
  assert.equal(bareFireArmsName(gunB.name), 'Coaxial_browning',
    'the two guns share a bare name, which is the trap');
  const wa = rack.weaponFor(gunA);
  const wb = rack.weaponFor(gunB);
  assert.ok(wa && wb, 'both hulls carry a coax patch');
  assert.equal(wa.node, gunA, 'the first patch hangs on the first gun node');
  assert.equal(wb.node, gunB, 'and the second on the second — not the first');
  rack.trigger(gunB);
  assert.equal(wb.audio.snapshot().started, true, 'the trigger reaches the second hull');
  rack.dispose();
}

// --- the cap keeps the nearest hulls ---------------------------------------

{
  const ctx = stubCtx();
  const rack = makeRack(ctx, report([WILLY]));
  const nodes = [];
  for (let i = 0; i < MAX_LIVE_VEHICLES + 3; i++) {
    const node = sceneNode(i === 0 ? 'willy' : `willy_${i}`, i * 50);
    childNode(node, 'WillyEngine');
    nodes.push(node);
    rack.claim({ seatKey: `bot:${i}`, node, template: 'willy', drive: drive(i * 50), groups: [] });
  }
  await settle();
  const snap = rack.snapshot();
  assert.equal(snap.vehicles.length, MAX_LIVE_VEHICLES + 3, 'every claim is tracked');
  const built = snap.vehicles.filter(v => v.built);
  assert.equal(built.length, MAX_LIVE_VEHICLES,
    `only the nearest ${MAX_LIVE_VEHICLES} keep a graph, got ${built.length}`);
  assert.ok(built.every(v => {
    const x = v.key === 'willy' ? 0 : Number(v.key.split('_')[1]) * 50;
    return x < 50 * MAX_LIVE_VEHICLES;
  }), 'and they are the near ones');
  rack.dispose();
}

// --- a far hull is held at master 0, the near one is not -------------------

{
  const ctx = stubCtx();
  const rack = makeRack(ctx, report([WILLY]));
  const near = sceneNode('willy', 5);
  childNode(near, 'WillyEngine');
  const far = sceneNode('willy_1', 500);
  childNode(far, 'WillyEngine');
  rack.claim({ seatKey: 'a', node: near, template: 'willy', drive: drive(5), groups: [] });
  rack.claim({ seatKey: 'b', node: far, template: 'willy', drive: drive(500), groups: [] });
  await settle();
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  const snap = rack.snapshot();
  const nearV = snap.vehicles.find(v => v.key === 'willy');
  const farV = snap.vehicles.find(v => v.key === 'willy_1');
  assert.ok(nearV.engine.master > 0, 'the near hull sounds');
  assert.equal(farV.engine.master, 0,
    'a hull past AUDIBLE_RANGE is held at master 0, not torn down');
  rack.dispose();
}

// --- the last crewman off releases; a re-claim inside the tail keeps it ----

{
  const ctx = stubCtx();
  const rack = makeRack(ctx, report([WILLY]));
  const node = sceneNode('willy', 0);
  childNode(node, 'WillyEngine');
  rack.claim({ seatKey: 'a', node, template: 'willy', drive: drive(0), groups: [] });
  await settle();
  assert.ok(rack.snapshot().vehicles[0].built, 'built while claimed');
  rack.releaseClaim('a', node);
  assert.equal(rack.snapshot().vehicles[0].want, false, 'released, pending teardown');
  rack.claim({ seatKey: 'a', node, template: 'willy', drive: drive(0), groups: [] });
  await settle(200);
  const snap = rack.snapshot();
  assert.equal(snap.vehicles.length, 1, 'a re-claim inside the shut-down tail keeps the hull');
  assert.ok(snap.vehicles[0].built, 'and its graph');
  rack.dispose();
}

// --- dispose kills everything ----------------------------------------------

{
  const ctx = stubCtx();
  const rack = makeRack(ctx, report([SHERMAN]));
  const node = sceneNode('sherman', 0);
  childNode(node, 'ShermanEngine');
  childNode(node, 'Coaxial_browning');
  rack.claim({ seatKey: 'a', node, template: 'sherman', drive: drive(0), groups: [] });
  await settle();
  rack.dispose();
  assert.equal(rack.snapshot().vehicles.length, 0, 'a level change empties the rack');
  assert.ok(ctx.started.every(s => s.stopped), 'and stops every source');
}

// --- bug B: `setAttachToListener` -- the driver's own engine, inside only ---
//
// SND-2: attached while the listener's camera is Inside (mode 3) in the
// PlayerControlObject the part belongs to. An old scene.json has no field, so
// a land engine's script path answers (every land Engine carries the flag,
// no aircraft or ship one does).

{
  const T34 = { template: 'T34', engine: 'T34Engine', script: 'Objects/Vehicles/Land/T34/Sounds/T34Engine.ssc',
                layers: [LAYER('t34.wav')], weapons: [] };
  const PLANE = { template: 'bf109', engine: 'BF109Engine', script: 'Objects/Vehicles/Air/BF109/Sounds/BF109Engine.ssc',
                  layers: [LAYER('bf.wav')], weapons: [] };
  const ctx = stubCtx();
  const rack = makeRack(ctx, report([T34, PLANE]));
  const own = sceneNode('T34', 3);
  childNode(own, 'T34Engine').userData = { control: 'T34' };
  const other = sceneNode('T34_1', 30);
  childNode(other, 'T34Engine_1').userData = { control: 'T34' };
  const plane = sceneNode('bf109', 60);
  childNode(plane, 'BF109Engine').userData = { control: 'bf109' };
  rack.claim({ seatKey: 'me', node: own, template: 'T34', drive: drive(3), groups: [] });
  rack.claim({ seatKey: 'bot', node: other, template: 'T34', drive: drive(30), groups: [] });
  rack.claim({ seatKey: 'pilot', node: plane, template: 'bf109', drive: drive(60), groups: [] });
  await settle();
  const attached = () => Object.fromEntries(rack.snapshot().vehicles.map(v => [v.key, v.engine?.attached]));
  const forward = { x: 0, y: 0, z: -1 };
  rack.listenerSeat = { root: own, rootId: 'T34', seatId: 'T34', inside: true };
  rack.update(1 / 30, { x: 0, y: 0, z: 0 }, forward);
  assert.deepEqual(attached(), { T34: true, T34_1: false, bf109: false },
    'only the listener\'s own hull attaches, inside');
  const panner = [...rack.vehicles.get('T34').engineAudio.groups.values()][0].panner;
  assert.deepEqual([panner.positionX.value, panner.positionY.value, panner.positionZ.value], [0, 0, -10],
    'and its voices stand dead ahead of the listener, not at the engine');
  rack.listenerSeat = { root: own, rootId: 'T34', seatId: 'T34', inside: false };
  rack.update(1 / 30, { x: 0, y: 0, z: 0 }, forward);
  assert.equal(attached().T34, false, 'the chase view hears the hull from outside');
  rack.listenerSeat = { root: own, rootId: 'T34', seatId: 'T34_PCO_MG', inside: true };
  rack.update(1 / 30, { x: 0, y: 0, z: 0 }, forward);
  assert.equal(attached().T34, false, 'a nested seat is another PlayerControlObject');
  rack.listenerSeat = { root: plane, rootId: 'bf109', seatId: 'bf109', inside: true };
  rack.update(1 / 30, { x: 0, y: 0, z: 0 }, forward);
  assert.equal(attached().bf109, false, 'no aircraft engine carries the flag');
  rack.dispose();
}

// --- churn keeps live graphs within the budget ------------------------------
// Twelve bots boarding and leaving hulls all over the map used to pile up
// live graphs past `MAX_LIVE_VEHICLES`: the cap only gated *new* builds, and
// a hull built while near kept its graph forever while its crew stayed
// aboard (measured at nine live hulls on Bocage). A built hull that churns
// out of the front of the queue is demoted now: shut-down tail, then the
// graph goes away, and the next rebalance re-arms it if it comes near again.

{
  const ctx = stubCtx();
  const rack = makeRack(ctx, report([WILLY]));
  const nodes = [];
  for (let i = 0; i < 3; i++) {
    const node = sceneNode(i === 0 ? 'willy' : `willy_${i}`, i * 10);
    childNode(node, 'WillyEngine');
    nodes.push(node);
    rack.claim({ seatKey: `a:${i}`, node, template: 'willy', drive: drive(i * 10), groups: [] });
  }
  await settle();
  assert.equal(rack.snapshot().vehicles.filter(v => v.built).length, 3,
    'the first crew builds within the budget');
  // Those hulls drive away; three fresh hulls arrive near and claim.
  nodes.forEach((n, i) => { n.matrixWorld.elements[12] = 4000 + i * 50; });
  for (let i = 0; i < 3; i++) {
    const node = sceneNode(`willy_n${i}`, 5 + i * 10);
    childNode(node, 'WillyEngine');
    nodes.push(node);
    rack.claim({ seatKey: `b:${i}`, node, template: 'willy', drive: drive(5 + i * 10), groups: [] });
  }
  await settle();
  assert.equal(rack.snapshot().live, MAX_LIVE_VEHICLES + 1,
    'churn has pushed one hull past the budget, demote pending');
  // The rebalance beat and the demote tails run off `update`.
  for (let i = 0; i < 8; i++) rack.update(0.1, { x: 0, y: 0, z: 0 });
  const after = rack.snapshot();
  assert.equal(after.live, MAX_LIVE_VEHICLES,
    `live graphs come back inside the budget, got ${after.live}`);
  const near = after.vehicles.filter(v => v.built && v.key.startsWith('willy_n'));
  assert.equal(near.length, 3, 'the fresh near hulls all sound');
  rack.dispose();
}

console.log('vehicle-audio: all assertions passed');
