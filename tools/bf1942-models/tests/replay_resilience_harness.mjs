// A round replay that rides out what it is handed, under node
// (features/round-replay-resilience).
//
// The owner's report (2026-09-29): "My game play recorder is crashing quite
// frequently, it just freezes and I can't quit it ... if I'm zooking around
// the map and choose to go FPOV on a particular player it often hangs
// there." One pose that is not all numbers did exactly that in the page: the
// audio listener threw on it before the render, every frame, and carried into
// the orbit's angles and the free camera's place it outlived every change of
// mode and of player. So: a recording's damaged lines and entries are left
// out, the camera never keeps or draws a pose that is not all numbers, each
// stage of the replay's frame runs on whatever the others throw, a voice at
// no position writes nothing, the page's frame draws whatever its world
// threw, and Escape reaches the page's own menu whatever the replay's keys
// threw.
//
// Same pattern as `replay_harness.mjs`: the viewer's modules imported in
// place through `sim/env.mjs`'s hooks, one JSON report on stdout.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);

// The guards warn; the report counts what they said.
const warnings = [];
console.warn = (...args) => warnings.push(args.map(a => (a instanceof Error ? a.message : String(a))).join(' '));

const [THREE, recording, { ReplayCamera }, guardMod, { ReplayPlayer }, { EngineAudio }, { ReplayUi }] = await Promise.all([
  imp('vendor/three.module.js'), imp('replay-recording.js'), imp('replay-camera.js'), imp('replay-guard.js'),
  imp('replay.js'), imp('engine-audio.js'), imp('replay-ui.js'),
]);

const results = {};
const line = o => JSON.stringify(o);
const q0 = [0, 0, 0, 1];
const finite = values => values.every(Number.isFinite);

// --- a recording with damaged lines ------------------------------------------------
//
// One soldier (nid 50, pid 3), sampled at 1.0, 1.1 and 1.2 s, the 1.1 s
// sample written after the 1.2 s one. Around them: a line cut short, a line
// that is not a record, two times no round has, three samples that are not a
// place and a rotation, a sample record whose list is not one, a player
// record with an entry that is not a list, a hit point that is not a number,
// a body record whose aim is not one, and a round whose direction is not one.
{
  const text = [
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'e', t: 1, e: 'createPlayer', pid: 3, name: 'rec', team: 2, ai: 0 }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1763, netId: 50, tmpl: 'USSoldier', pos: [0, 1, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'control', pid: 3, netId: 50 }),
    line({ k: 'o', t: 1, id: 50, gid: 1, tmpl: 'USSoldier', tid: 1763, team: 2, maxhp: 30 }),
    line({ k: 's', t: 1.0, o: [[50, 0, 2, 0, ...q0]] }),
    line({ k: 's', t: 1.2, o: [[50, 0, 2, 1, ...q0], [50, 0, 2], [50, 0, null, 2, ...q0], [50, 0, 2, 2, 0, 0, 0, 0]] }),
    line({ k: 's', t: 1.1, o: [[50, 0, 2, 0.5, ...q0]] }),
    '{"k":"s","t":1.3,"o":[[50,0,2,',
    '42',
    line({ k: 's', t: 1e9, o: [[50, 0, 2, 9, ...q0]] }),
    line({ k: 's', t: -3, o: [[50, 0, 2, 9, ...q0]] }),
    line({ k: 's', t: 1.4, o: null }),
    line({ k: 'p', t: 1.4, p: [7, [3, 2, 50]] }),
    line({ k: 'a', t: 1.4, a: [[50, 'x'], [50, 25]] }),
    line({ k: 'st', t: 1.4, o: [[50, 0, 0, null, 'x', 3, 0]] }),
    line({ k: 'f', t: 1.5, id: 50, pid: 3, w: 'Bar1918', p: [0, 2, 0], d: [0, null, 1] }),
    line({ k: 'end', t: 10 }),
  ].join('\n');
  let rec = null;
  let error = null;
  try {
    rec = recording.parseRecording(text);
  } catch (e) {
    error = e.message;
  }
  const life = rec?.lives.find(l => l.nid === 50);
  results.parse = {
    error,
    skipped: rec?.skipped ?? null,
    duration: rec?.duration ?? null,
    keys: life?.keys.map(k => k.t) ?? null,
    finite: life ? life.keys.every(k => finite([...k.p, ...k.q])) : null,
    hp: life?.hp.map(h => h.hp) ?? null,
    aim: rec ? (({ pitch, twist }) => ({ pitch, twist }))(rec.stances.get(50)[0]) : null,
    round: rec?.fires.map(f => ({ pos: f.pos, dir: f.dir })) ?? null,
    control: rec?.control.map(c => c.nid) ?? null,
  };
}

// --- the camera never keeps a pose that is not all numbers -------------------------
//
// A soldier (pid 3) standing still from 1 s to 20 s. The report's path, as the
// page took it: a first-person frame that came out as no rotation, then the
// orbit (which read its heading off that rotation), then the free camera
// (which starts where the camera is), then another player. Before, every
// one of them stayed at no position.
{
  const lines = [
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'e', t: 1, e: 'createPlayer', pid: 3, name: 'rec', team: 2, ai: 0 }),
    line({ k: 'e', t: 1, e: 'createPlayer', pid: 4, name: 'other', team: 2, ai: 0 }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1763, netId: 50, tmpl: 'USSoldier', pos: [0, 1, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'control', pid: 3, netId: 50 }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1763, netId: 60, tmpl: 'USSoldier', pos: [30, 1, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'control', pid: 4, netId: 60 }),
    line({ k: 'o', t: 1, id: 50, gid: 1, tmpl: 'USSoldier', tid: 1763, team: 2, maxhp: 30 }),
    line({ k: 'o', t: 1, id: 60, gid: 2, tmpl: 'USSoldier', tid: 1763, team: 2, maxhp: 30 }),
  ];
  for (let i = 0; i <= 190; i++) {
    const t = +(1 + i * 0.1).toFixed(1);
    lines.push(line({ k: 's', t, o: [[50, 0, 2, 0, ...q0], [60, 30, 2, 0, ...q0]] }));
  }
  lines.push(line({ k: 'end', t: 20 }));
  const rec = recording.parseRecording(lines.join('\n'));
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.5, 8000);
  cam.position.set(0, 50, 20);
  const player = { rec, followPid: 3, time: 5, hulls: new Map(), ctx: { camera: cam, groundHeight: () => 0, waterLevel: () => -100 } };
  const camera = new ReplayCamera(player);
  player.camera = camera;
  const drawable = () => finite([...cam.matrixWorld.elements, cam.fov, cam.near])
    && finite([camera.yaw, camera.pitch, camera.zoom, camera.eased.yaw, camera.eased.pitch, camera.eased.zoom])
    && finite([camera.free.pos.x, camera.free.pos.y, camera.free.pos.z]);
  const step = (t, n = 3) => { for (let i = 0; i < n; i++) camera.update(1 / 60, t + i / 60); };
  step(5);
  const out = { orbitFirst: drawable() };

  // First person, then his eyes come out as no rotation.
  camera.setMode('pov');
  step(5.1);
  out.povSight = camera.sight?.kind ?? null;
  cam.quaternion.set(NaN, NaN, NaN, NaN);
  camera.setMode('orbit');
  out.orbitPoisoned = !Number.isFinite(camera.eased.yaw);
  step(5.2);
  out.orbitAfter = drawable();
  // The free camera, taken from a camera at no position.
  cam.position.set(NaN, 3, NaN);
  camera.setMode('free');
  step(5.3);
  out.freeAfter = drawable();
  // Another player in first person.
  player.followPid = 4;
  camera.followChanged();
  camera.setMode('pov');
  step(5.4);
  out.otherPov = { drawable: drawable(), sight: camera.sight?.kind ?? null, x: +cam.position.x.toFixed(2) };

  // A first person whose eyes come out as no rotation, and one that throws:
  // the orbit stands in, nothing of the first person is left set, and it
  // comes back when his eyes do.
  const broken = [];
  for (const viewOf of [() => ({ yaw: NaN, pitch: 0 }), () => { throw new Error('his eyes threw'); }]) {
    camera.viewOf = viewOf;
    step(6);
    broken.push({ mode: camera.mode, drawable: drawable(), sight: camera.sight, hidePid: camera.hidePid });
  }
  delete camera.viewOf;
  step(6.5);
  out.broken = broken;
  out.backAgain = { sight: camera.sight?.kind ?? null, hidePid: camera.hidePid, drawable: drawable() };

  // Input that is not a number moves nothing.
  camera.setMode('orbit');
  const yaw = camera.yaw;
  camera.drag(NaN, 4);
  camera.wheel(NaN);
  camera.wheel(Infinity);
  out.input = { yaw: camera.yaw === yaw, zoom: camera.zoom };
  out.cameraWarnings = warnings.filter(w => w.startsWith('replay camera:')).length;
  results.camera = out;
}

// --- the player's frame: every stage on its own ------------------------------------
//
// Three hulls (one that throws, one placed at no position, one that works),
// a camera and a HUD that throw, a round that throws beside one that fires,
// and a frame step and a clock that are not numbers.
{
  const { ReplayGuard, FAULT_STREAK } = guardMod;
  const calls = [];
  const hull = (name, update) => ({
    life: { tmpl: name, nid: name.length },
    group: { visible: false },
    root: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() },
    updates: 0, hidden: 0,
    update(t, step) { this.updates += 1; update(this, t, step); },
    hide() { this.hidden += 1; this.group.visible = false; },
  });
  const thrower = hull('Thrower', () => { throw new Error('a rig broke'); });
  const nowhere = hull('Nowhere', h => { h.group.visible = true; h.root.position.set(NaN, 0, 0); });
  const fine = hull('Fine', h => { h.group.visible = true; h.root.position.set(1, 2, 3); });
  const fired = [];
  const player = Object.assign(Object.create(ReplayPlayer.prototype), {
    ctx: { scene: new THREE.Scene() },
    rec: {
      duration: 100,
      fires: [{ t: 5.01, bad: true }, { t: 5.02 }, { t: 5.2 }],
      refills: [],
    },
    time: 5, speed: 1, playing: true, lastFiredTime: 5, followPid: 3, recordingPids: [3],
    hulls: new Map([[thrower.life, thrower], [nowhere.life, nowhere], [fine.life, fine]]),
    entities: [], markers: [], showServer: false, soldiers: null, highlights: null,
    props: { update() { calls.push('props'); } },
    round: { update() { calls.push('round'); } },
    feed: { update() { calls.push('feed'); } },
    hud: { state: 'stale', update() { throw new Error('the HUD broke'); } },
    camera: { mode: 'pov', hidePid: 3, sight: { kind: 'foot' }, update() { throw new Error('the camera broke'); } },
    ui: {
      scrubbing: false, logOpen: false, status() {},
      timeline: { takeScrub: () => null, plan() { calls.push('plan'); } },
      update() { calls.push('ui'); },
    },
    fireShot(f) {
      if (f.bad) throw new Error('a round broke');
      fired.push(f.t);
    },
  });
  const frames = [];
  for (let i = 0; i < 4; i++) {
    const before = player.lastFiredTime;
    player.update(1 / 30);
    frames.push({ from: before, to: player.lastFiredTime });
  }
  const perFrame = calls.length / 4;
  // A step and a clock that are not numbers.
  player.update(NaN);
  const afterNaNStep = player.time;
  player.time = NaN;
  player.update(1 / 30);
  const afterNaNClock = player.time;
  player.seek(NaN);
  const afterNaNSeek = player.time;
  results.frame = {
    streak: FAULT_STREAK,
    frames,
    stagesEachFrame: [...new Set(calls)].sort(),
    perFrame,
    thrower: { updates: thrower.updates, hidden: thrower.hidden, faulted: Boolean(thrower.faulted) },
    nowhere: { updates: nowhere.updates, hidden: nowhere.hidden, visible: nowhere.group.visible },
    fine: { updates: fine.updates, visible: fine.group.visible },
    fired,
    hudState: player.hud.state,
    ownBody: player.camera.hidePid,
    report: Object.fromEntries(Object.entries(player.guard.report()).map(([k, v]) => [k, v.total])),
    afterNaNStep: +afterNaNStep.toFixed(3),
    afterNaNClock: Number.isFinite(afterNaNClock),
    afterNaNSeek: Number.isFinite(afterNaNSeek),
    guardType: player.guard instanceof ReplayGuard,
  };
  // A seek gives a hull put away another go.
  player.seek(10);
  player.update(1 / 30);
  results.frame.afterSeek = { faulted: Boolean(thrower.faulted), updates: thrower.updates };
}

// --- a voice at no position writes nothing -------------------------------------------
//
// Web Audio throws on a value that is not a number; this stand-in does too.
// An engine at no position, and a listener at none, update without throwing.
{
  const strict = v => {
    if (!Number.isFinite(v)) throw new TypeError('The provided float value is non-finite.');
  };
  const param = (initial = 0) => ({
    value: initial,
    setTargetAtTime(v) { strict(v); this.value = v; },
    setValueAtTime(v) { strict(v); this.value = v; },
    linearRampToValueAtTime(v) { strict(v); this.value = v; },
    cancelScheduledValues() {},
  });
  const node = extra => ({ connect() { return this; }, disconnect() {}, ...extra });
  const ctx = {
    currentTime: 0, state: 'running',
    resume() { return Promise.resolve(); },
    createGain() { return node({ gain: param(0) }); },
    createPanner() {
      return node({
        panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1, maxDistance: 10000, rolloffFactor: 0,
        positionX: param(0), positionY: param(0), positionZ: param(0),
        orientationX: param(0), orientationY: param(0), orientationZ: param(-1),
      });
    },
    createBufferSource() {
      return node({ buffer: null, loop: false, playbackRate: param(1), start() {}, stop() {}, onended: null });
    },
  };
  const layer = {
    file: 'main.wav', loop: true, volume: 1, randomStartPitch: [0, 0], relativePosition: [0, 0, 0], doppler: true,
    modulators: [{ dest: 'pitch', source: 'default', envelope: 'linear', params: [0.45, 0.55] }],
  };
  const buffer = { duration: 1, sampleRate: 44100, length: 44100, numberOfChannels: 1, getChannelData: () => new Float32Array(1) };
  const audio = new EngineAudio({ template: 'Willy', engine: 'WillyEngine', layers: [layer] }, [layer],
    new Map([['main.wav', buffer]]), { context: ctx, getInput: () => ctx.createGain() });
  audio.start();
  audio.setMaster(1);
  const at = (position, listenerPosition) => {
    try {
      audio.update({
        dt: 1 / 30, rpm: 0.5, speed: 0, acceleration: 0, diveAngle: 0,
        position, quaternion: { x: 0, y: 0, z: 0, w: 1 }, listenerPosition,
      });
      return null;
    } catch (error) {
      return error.message;
    }
  };
  const origin = { x: 0, y: 0, z: 0 };
  results.engineAudio = {
    placed: at({ x: 5, y: 0, z: 0 }, origin),
    sourceNowhere: at({ x: NaN, y: 0, z: 0 }, origin),
    listenerNowhere: at(origin, { x: NaN, y: NaN, z: NaN }),
    placedAgain: at({ x: 5, y: 0, z: 0 }, origin),
  };
}

// --- Escape is always the page's way out ---------------------------------------------
//
// The replay's keys, with every one of its actions throwing: the replay still
// takes the keys it takes (the page never sees them), and Escape goes on to
// the page's own menu.
{
  const listeners = {};
  globalThis.window ??= {};
  const saved = globalThis.window.addEventListener;
  globalThis.window.addEventListener = (type, fn) => { listeners[type] = fn; };
  const ui = Object.assign(Object.create(ReplayUi.prototype), {
    disposed: false,
    ctx: { keyboardTaken: () => false },
    player: { camera: { keys: new Set() } },
    activity() {},
    key() { throw new Error('a key broke'); },
  });
  ui.bindKeys();
  globalThis.window.addEventListener = saved;
  const press = code => {
    const e = { code, key: code, repeat: false, target: { tagName: 'CANVAS' }, stopped: false, prevented: false,
                stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
    let threw = null;
    try {
      listeners.keydown(e);
    } catch (error) {
      threw = error.message;
    }
    return { threw, stopped: e.stopped, prevented: e.prevented };
  };
  results.keys = { space: press('Space'), escape: press('Escape') };
}

results.warnings = warnings.length;
process.stdout.write(JSON.stringify(results));
