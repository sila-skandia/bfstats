/**
 * The vehicle audio rack: one sounding hull per occupied vehicle, claimed by
 * the seats aboard it. The FPOV gap this closes is the whole point of the
 * suite — a bot's drivetrain used to build nothing — so the first assertion
 * is that a claim with a drive produces an engine graph at all.
 *
 * Stub Web Audio, no browser. Run by `tests/test_vehicle_audio.py`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
  assert.equal(snap.vehicles[0].engine.released, false,
    'a live graph, not the released one the last crewman left behind');
  rack.dispose();
}

// --- re-crewed inside the tail, the hull sounds: engine and guns -----------
// The released graph used to stay built for the new crew: its loops faded on
// `timerelease` and `trigger()` refused every round, so a bot boarding a tank
// another had just left drove it in silence, MG and main gun included.

{
  // A gun's report is its one-shots, which is what `trigger()` replays.
  const shot = { ...LAYER('brown.wav'), loop: false };
  const sherman = { ...SHERMAN, weapons: [{ ...SHERMAN.weapons[0], layers: [shot] }] };
  const ctx = stubCtx();
  const rack = makeRack(ctx, report([sherman]));
  const node = sceneNode('sherman', 0);
  childNode(node, 'ShermanEngine');
  const gun = childNode(node, 'Coaxial_browning');
  rack.claim({ seatKey: 'bot:1', node, template: 'sherman', drive: drive(0), groups: [{ node: gun }] });
  await settle();
  rack.releaseClaim('bot:1', node);
  rack.claim({ seatKey: 'bot:2', node, template: 'sherman', drive: drive(0), groups: [{ node: gun }] });
  await settle();
  const v = rack.snapshot().vehicles[0];
  assert.ok(v.built && v.engine && !v.engine.released, 'the new crew gets a running engine');
  assert.ok(v.weapons.every(w => !w.released), 'and live gun patches');
  assert.ok(rack.weaponFor(gun).audio.trigger() > 0, 'which a round actually sounds');
  rack.dispose();
}

// --- a wreck cuts its own hull, and nobody else's ---------------------------
// The local player's wreck used to dispose the whole rack, so every
// bot-crewed hull on the map went silent until its crew changed seats.

{
  const ctx = stubCtx();
  const rack = makeRack(ctx, report([SHERMAN, WILLY]));
  const mine = sceneNode('sherman', 0);
  childNode(mine, 'ShermanEngine');
  const bots = sceneNode('willy', 20);
  childNode(bots, 'WillyEngine');
  rack.claim({ seatKey: 'local', node: mine, template: 'sherman', drive: drive(0), groups: [] });
  rack.claim({ seatKey: 'bot:1', node: bots, template: 'willy', drive: drive(20), groups: [] });
  await settle();
  rack.cut(mine);
  const snap = rack.snapshot();
  assert.deepEqual(snap.vehicles.map(v => v.key), ['willy'], 'only the wrecked hull goes');
  assert.ok(snap.vehicles[0].built && !snap.vehicles[0].engine.released,
    'and the bot\'s hull keeps sounding');
  rack.releaseClaim('local', mine);   // his seat, emptied after the cut: a no-op
  assert.equal(rack.snapshot().vehicles.length, 1);
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

// --- a looped gun sounds while any of its mounts fires, or a replay says so ---
//
// A machine gun's patch is loops, gated on its group firing. A replayed gun
// has no trigger, only recorded rounds, so the replay holds `sounding` up
// while they leave (replay-hulls.js `holdSound`): El Zilcho's Zero fired 22
// rounds at 6:20 of replay_20260927-203459 in silence before it. And a
// destroyer's four same-named mounts share one patch: a gunner on the second
// used to leave it shut, because only the first group was asked.

{
  const ctx = stubCtx();
  const rack = makeRack(ctx, report([SHERMAN]));
  const node = sceneNode('sherman', 5);
  childNode(node, 'ShermanEngine');
  const first = childNode(node, 'Coaxial_browning');
  const second = childNode(node, 'Coaxial_browning_1');
  const groups = [{ node: first, firing: false }, { node: second, firing: false }];
  rack.claim({ seatKey: 'replay:1', node, template: 'sherman', drive: null, groups });
  await settle();
  const gun = () => rack.snapshot().vehicles[0].weapons.find(w => w.fireArms === 'Coaxial_browning');
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  assert.equal(gun().master, 0, 'a looped gun nobody fires is shut');
  groups[0].sounding = true;
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  assert.ok(gun().master > 0, "a replayed gun's recorded rounds open it (`sounding`)");
  groups[0].sounding = false;
  groups[1].firing = true;
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  assert.ok(gun().master > 0, 'the second mount of the name opens the shared patch too');
  groups[1].firing = false;
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  assert.equal(gun().master, 0, 'and it shuts when neither fires');
  rack.dispose();
}

// --- a template the level does not place sounds from the tree's table --------
//
// A round replay's server can spawn anything: MoonGamers' Midway adds Elco80
// PT boats, which midway/scene.json has no sound for. The rack asks the
// tree's `_shared/vehicle-sounds.json` (same shape) when the level's report
// lacks the template, and only then.

{
  const ctx = stubCtx();
  const listener = fakeListener(ctx);
  let asked = 0;
  const ELCO = {
    template: 'Elco80', level: 'high', engine: 'Elco80_Engine', layers: [LAYER('elco.wav')],
    weapons: [{ fireArms: 'Elco80_SideGunner', script: 'Gun.ssc', layers: [LAYER('mg.wav')] }],
  };
  const rack = new VehicleAudioRack({
    listener: () => listener,
    getBuffer: async () => fakeBuffer(),
    report: () => report([SHERMAN]),
    shared: async () => { asked++; return report([ELCO]); },
    dir: () => 'midway',
    master: () => 1,
  });
  const boat = sceneNode('Elco80', 5);
  childNode(boat, 'Elco80_Engine');
  childNode(boat, 'Elco80_SideGunner');
  rack.claim({ seatKey: 'replay:524', node: boat, template: 'Elco80', drive: drive(5), groups: [] });
  const tank = sceneNode('sherman', 9);
  childNode(tank, 'ShermanEngine');
  rack.claim({ seatKey: 'replay:782', node: tank, template: 'sherman', drive: drive(9), groups: [] });
  await settle();
  const snap = rack.snapshot();
  const elco = snap.vehicles.find(v => v.template === 'Elco80');
  assert.ok(elco?.engine, "a template the level does not place takes its engine from the tree's table");
  assert.deepEqual(elco.weapons.map(w => w.fireArms), ['Elco80_SideGunner'], 'and its guns');
  assert.ok(snap.vehicles.find(v => v.template === 'sherman')?.engine, "the level's own template still sounds");
  assert.equal(asked, 1, "the table is asked for only the template the level's report lacks");
  rack.dispose();
}

// --- the car horn between patches (2026-09-29, the fourth route) -------------
//
// `EngineAudio` settles the twins inside one patch, and a hull is several
// patches. The PanzerIV's coaxial MG42 and its cupola MG42 are two FireArms,
// both playing `MG42_fire`: fired together (Bocage, replay_20260928-133433 at
// 3:04) the two loops summed into the horn, one patch never seeing the other's
// voice. The rack settles them between `evaluate` and `apply`
// (`ssc-coherent.js` `resolveAcross`).

/** A rack whose loader decodes each file once, as the page's cache does: two
 *  patches of one sample share one buffer, which is what makes them twins. */
function sharedBufferRack(extras) {
  const ctx = stubCtx();
  const listener = fakeListener(ctx);
  const decoded = new Map();
  const rack = new VehicleAudioRack({
    listener: () => listener,
    getBuffer: async (dir, file) => {
      if (!decoded.has(file)) decoded.set(file, fakeBuffer());
      return decoded.get(file);
    },
    report: () => extras,
    dir: () => 'bocage',
    master: () => 1,
  });
  return { ctx, rack };
}

/** Every gun layer of hull `key` the listener would hear this frame. */
function heardGuns(rack, key) {
  const vehicle = rack.snapshot().vehicles.find(v => v.key === key);
  return vehicle.weapons.flatMap(w => w.layers
    .filter(l => w.master > 0 && l.output > 0)
    .map(l => ({ fireArms: w.fireArms, ...l })));
}

const at = (node, x) => { node.matrixWorld.elements[12] = x; };

const PANZER = {
  template: 'panzeriv',
  level: 'bocage',
  engine: 'PanzerIVEngine',
  layers: [LAYER('panzngn.mp3')],
  weapons: [
    { fireArms: 'Coaxial_MG42', script: 'mg42.ssc', layers: [{ ...LAYER('MG42_fire.mp3'), doppler: false }] },
    { fireArms: 'MG42', script: 'mg42.ssc', layers: [{ ...LAYER('MG42_fire.mp3'), doppler: false }] },
  ],
};

/** A PanzerIV at `x` with both MG42s, crewed, and which of them are firing. */
async function panzer(x = 10) {
  const { ctx, rack } = sharedBufferRack(report([PANZER]));
  const node = sceneNode('panzeriv', x);
  const coax = childNode(node, 'Coaxial_MG42');
  const cupola = childNode(node, 'MG42');
  at(coax, x);
  at(cupola, x);
  const groups = [{ node: coax, firing: true }, { node: cupola, firing: true }];
  rack.claim({ seatKey: 'replay:1', node, template: 'panzeriv', drive: null, groups });
  await settle();
  return { ctx, rack, coax, cupola, groups };
}

{
  // The route itself: both guns firing, one sample, one rate.
  const { rack } = await panzer();
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  const heard = heardGuns(rack, 'panzeriv');
  assert.equal(heard.length, 1,
    `two MG42s of one hull firing together must sound one MG42_fire, not ${heard.length}: `
    + 'two copies of one loop at one rate are the car horn');
  const lost = rack.snapshot().vehicles[0].weapons.flatMap(w => w.layers).filter(l => l.suppressed);
  assert.equal(lost.length, 1, 'and the other is reported as arbitrated away');
  rack.dispose();
}

{
  // A gun nobody fires runs its loop at master 0. It must never mute one that
  // is firing, or the coax would go quiet whenever the cupola MG was built.
  const { rack, groups } = await panzer();
  groups[0].firing = false;
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  const heard = heardGuns(rack, 'panzeriv');
  assert.deepEqual(heard.map(l => l.fireArms), ['MG42'], 'the firing gun is the one heard');
  assert.equal(heard[0].suppressed, false);
  rack.dispose();
}

{
  // Detuned copies beat instead of combing, between patches as inside one:
  // the MG42's own `randomStartPitch` usually sets two guns 1% apart.
  const { rack, cupola } = await panzer();
  rack.weaponFor(cupola).audio.voices[0].jitter = 1.01;
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  assert.equal(heardGuns(rack, 'panzeriv').length, 2, 'two guns 1% apart both sound');
  rack.dispose();
}

{
  // The louder copy keeps the voice, and holds it until the other is clearly
  // louder, or two guns at one distance hand it back and forth as the camera
  // moves (a crossfade each time, with both partly up).
  const { rack, coax, cupola } = await panzer();
  const winner = () => heardGuns(rack, 'panzeriv').map(l => l.fireArms).join();
  at(coax, 10);
  at(cupola, 10.5);
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  assert.equal(winner(), 'Coaxial_MG42', 'the nearer gun is the one heard');
  at(cupola, 9.6);
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  assert.equal(winner(), 'Coaxial_MG42', 'a rival 4% louder does not take the voice');
  at(cupola, 7);
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  assert.equal(winner(), 'MG42', 'one 3 dB louder does');
  at(cupola, 9.6);
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  assert.equal(winner(), 'MG42', 'and then holds it the same way');
  rack.dispose();
}

{
  // One-shots are events, not a standing comb: a patch starts one at the head
  // of its buffer, so two guns' shots are two bangs and both are heard.
  const shot = { ...LAYER('shrmfire.mp3'), loop: false };
  const TANKS = {
    template: 'panzeriv', level: 'bocage', engine: 'PanzerIVEngine', layers: [],
    weapons: [
      { fireArms: 'PanzerIVGunBarrel', script: 'Cannon.ssc', layers: [shot] },
      { fireArms: 'MG42', script: 'Cannon.ssc', layers: [shot] },
    ],
  };
  const { ctx, rack } = sharedBufferRack(report([TANKS]));
  const node = sceneNode('panzeriv', 10);
  const gun = childNode(node, 'PanzerIVGunBarrel');
  const other = childNode(node, 'MG42');
  at(gun, 10);
  at(other, 10);
  rack.claim({ seatKey: 'replay:1', node, template: 'panzeriv', drive: null,
               groups: [{ node: gun }, { node: other }] });
  await settle();
  rack.trigger(gun);
  rack.trigger(other);
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  assert.equal(ctx.started.filter(s => !s.loop).length, 2, 'both shots start');
  assert.equal(heardGuns(rack, 'panzeriv').length, 2, 'and both are heard');
  rack.dispose();
}

{
  // Two hulls are two patches too: two Kubelwagens idling side by side run
  // one engine loop at one rate. Driven apart in revs they are two engines.
  const KUBEL = {
    template: 'kubelwagen', level: 'bocage', engine: 'KubelwagenEngine', weapons: [],
    layers: [{ ...LAYER('kblwgnngn2.mp3'), doppler: false,
               modulators: [{ dest: 'pitch', source: 'default', envelope: 'linear', params: [0.5, 1] }] }],
  };
  const { rack } = sharedBufferRack(report([KUBEL]));
  const a = sceneNode('kubelwagen', 8);
  childNode(a, 'KubelwagenEngine');
  const b = sceneNode('kubelwagen_1', 9);
  childNode(b, 'KubelwagenEngine');
  const driveA = drive(8);
  const driveB = drive(9);
  rack.claim({ seatKey: 'a', node: a, template: 'kubelwagen', drive: driveA, groups: [] });
  rack.claim({ seatKey: 'b', node: b, template: 'kubelwagen', drive: driveB, groups: [] });
  await settle();
  const engines = () => rack.snapshot().vehicles
    .filter(v => v.engine.master > 0 && v.engine.layers.some(l => l.output > 0)).length;
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  assert.equal(engines(), 1, 'two idling engines at one rate are one voice');
  driveB.state.throttle = 0.9;
  rack.update(1 / 30, { x: 0, y: 0, z: 0 });
  assert.equal(engines(), 2, 'at different revs both are heard');
  rack.dispose();
}

// --- and over the real shipped data ------------------------------------------
//
// Every extracted level's hulls, every gun firing and the engine running, the
// guns stood at one point (the worst case: nothing tells them apart), heard
// from where heads are: inside, in the coax overlap, beside, and down the
// field. Skips without a `viewer/maps` tree (CI, a fresh worktree).
// `VEHICLE_AUDIO_MAPS` points the sweep at another tree (a mod's, or a scratch
// tree a sounds-layer patch was written to):
//   VEHICLE_AUDIO_MAPS=viewer/maps/mods/desertcombat node tests/test_vehicle_audio.mjs

{
  const mapsDir = process.env.VEHICLE_AUDIO_MAPS
    ? pathToFileURL(`${path.resolve(process.env.VEHICLE_AUDIO_MAPS)}/`)
    : new URL('../viewer/maps/', import.meta.url);
  let levels = [];
  try {
    levels = fs.readdirSync(mapsDir).filter(
      name => fs.existsSync(new URL(`${name}/scene.json`, mapsDir)));
  } catch (_) { levels = []; }
  // `randomStartPitch` draws each loop's own rate; hold every draw at the
  // middle so every pair that can meet at one rate does.
  const random = Math.random;
  Math.random = () => 0.5;
  const offences = [];
  let contested = 0;
  try {
    for (const level of levels) {
      const scene = JSON.parse(fs.readFileSync(new URL(`${level}/scene.json`, mapsDir), 'utf8'));
      for (const vehicle of scene.sounds?.vehicles ?? []) {
        const loops = (vehicle.weapons ?? []).filter(w => w.layers?.some(l => l.loop));
        if (loops.length < 2) continue;
        const { rack } = sharedBufferRack(report([vehicle]));
        const node = sceneNode(vehicle.template, 0);
        if (vehicle.engine) childNode(node, vehicle.engine);
        const groups = loops.map(w => ({ node: childNode(node, w.fireArms), firing: true }));
        rack.claim({ seatKey: 'sweep', node, template: vehicle.template,
                     drive: vehicle.layers?.length ? drive(0) : null, groups });
        await settle();
        for (const distance of [0.3, 1.4, 3, 16, 60]) {
          rack.update(1 / 30, { x: distance, y: 0, z: 0 });
          const snap = rack.snapshot().vehicles[0];
          const patches = [snap.engine, ...snap.weapons].filter(Boolean);
          const heard = patches.flatMap((p, patch) => (p.master > 0 ? p.layers : [])
            .filter(l => l.loop && l.output > 0.02).map(l => ({ ...l, patch })));
          contested += patches.flatMap(p => p.layers).filter(l => l.suppressed).length;
          // Between patches only: a spread one patch authors at two offsets
          // is its own business (test_engine_audio_default.mjs).
          heard.forEach((a, i) => heard.slice(i + 1).forEach(b => {
            if (a.patch !== b.patch && a.file === b.file
                && Math.abs(a.playbackRate - b.playbackRate) <= 0.004 * Math.max(a.playbackRate, b.playbackRate)) {
              offences.push(`${level} ${vehicle.template} ${a.file} at ${distance} m`);
            }
          }));
        }
        rack.dispose();
      }
    }
  } finally {
    Math.random = random;
  }
  assert.equal(offences.length, 0,
    `coherent duplicates between one hull's patches:\n  ${offences.slice(0, 12).join('\n  ')}`);
  if (levels.length) {
    assert.ok(contested > 0, 'the sweep met no twins at all, so it proved nothing');
  }
  console.log(`  swept ${levels.length} extracted level(s) for twins between patches`
    + (levels.length ? ` (${contested} arbitrated)` : ' (none extracted)'));
}

console.log('vehicle-audio: all assertions passed');
