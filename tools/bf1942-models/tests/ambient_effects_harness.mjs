// The bundles an object carries and the engine runs by itself (gap audit
// entry 10): which the engine starts and when (`ambient-effects.js`), and how
// a looping emitter restarts (`effects-core.js` `EmitterClock`). The bundles
// are vanilla's own words, cut to what the gates read. Run by
// `test_ambient_effects.py`; prints one JSON object.
import { EmitterClock, levelBasis } from '../viewer/effects-core.js';
import {
  AmbientEffects, bundleGate, DEFAULT_EMITTER_LOD, GATE_INTERVAL,
} from '../viewer/ambient-effects.js';

const out = {};
const n = v => ['n', v, 0, 0];

// --- the clock --------------------------------------------------------------
function spawns(spec, speed, seconds) {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const clock = new EmitterClock(spec, rand);
  let count = 0;
  for (let i = 0; i < seconds * 60; i++) count += clock.step(1 / 60, speed);
  return count;
}
// `Em_WaterFront`'s shape with a flat intensity: 0.1 s loops.
const bow = { looping: true, timeToLive: n(0.1), intensity: n(10), intensityAtSpeed: 10 };
// `Em_wDust`: one 60 s loop, 30 a second at 20 m/s.
const dust = { looping: true, timeToLive: n(60), intensity: n(30), intensityAtSpeed: 20 };
out.clock = {
  bowAtRest: spawns(bow, 0, 5),
  bowAtThreshold: spawns(bow, 10, 5),
  bowAt20: spawns(bow, 20, 3),
  dustAt5: spawns(dust, 5, 4),
  dustAtRest: spawns(dust, 0, 30),
  // The delay is drawn again on every restart.
  delayedLoop: spawns({ looping: true, delay: n(0.5), timeToLive: n(0.5), intensity: n(10) }, 0, 3),
  plainLoop: spawns({ looping: true, timeToLive: n(0.5), intensity: n(10) }, 0, 3),
};
out.level = levelBasis({ right: [1, 0, 0], up: [0, 0.6, 0.8], dof: [0, -0.8, 0.6] });
out.levelVertical = levelBasis({ right: [1, 0, 0], up: [0, 0, 1], dof: [0, -1, 0] });

// --- the gates --------------------------------------------------------------
const DIRT = [2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15];
const bundle = (name, info, emitters) => ({
  name, node: { userData: { effectBundle: { name, ...info } } },
  emitters: emitters.map(spec => ({ spec })),
});
const LIB = {
  e_wdustpanz: bundle('e_wdustPanz', { workOnMaterials: DIRT },
    [{ looping: true, startAtCreation: true, intensityAtSpeed: 20 }]),
  e_wdustpanzl: bundle('e_wdustPanzL', { workOnMaterials: [13, 10] },
    [{ looping: true, startAtCreation: true, intensityAtSpeed: 20 }]),
  e_wdirtwheel: bundle('e_wdirtWheel', {}, [{ startAtCreation: true, intensityAtSpeed: 20 }]),
  e_watertouchplane: bundle('e_WaterTouchPlane',
    { workOnMaterials: [1], minDistanceUnderwaterSurface: 0, maxDistanceUnderwaterSurface: 0.01 },
    [{ looping: true, startAtCreation: true, intensityAtSpeed: 40, lodDistance: 600 }]),
  e_waterfront: bundle('e_WaterFront', { minDistanceUnderwaterSurface: 0, maxDistanceUnderwaterSurface: 10 },
    [{ looping: true, startAtCreation: true, intensityAtSpeed: 10, lodDistance: 600 }]),
  e_waterboatsvall: bundle('e_WaterBoatSvall', { minDistanceUnderwaterSurface: 0, maxDistanceUnderwaterSurface: 20 },
    [{ looping: true, startAtCreation: true, lodDistance: 800 }]),
  e_exfumefact: bundle('e_ExFumeFact', {}, [{ looping: true, startAtCreation: true, lodDistance: 700 }]),
  e_firesmallyellow: bundle('e_FireSmallYellow', {}, [{ startAtCreation: true, lodDistance: 700 }]),
  e_muzzpanz: bundle('e_MuzzPanz', {}, [{ }, { }]),
};
const gate = (key, onSpring) => {
  const g = bundleGate(LIB[key], onSpring);
  return g && { kind: g.kind, materials: g.materials ? [...g.materials] : null, min: g.min, max: g.max,
                lod: g.lod, loops: g.loops, needsSpeed: g.needsSpeed };
};
out.gates = {
  trackDust: gate('e_wdustpanz', true),
  // A Spring's bundle with no `addWorkOnMaterial` is stopped at init and
  // never started (`Spring::init`, `Spring::handleUpdate`).
  dirtOnSpring: gate('e_wdirtwheel', true),
  // The depth band beats the Spring's messages (`handleMessage` 0x081e148b).
  touchPlane: gate('e_watertouchplane', true),
  bowWave: gate('e_waterfront', false),
  chimney: gate('e_exfumefact', false),
  muzzle: gate('e_muzzpanz', false),
  defaultLod: DEFAULT_EMITTER_LOD,
};

// --- the manager ------------------------------------------------------------
function node(name, parent, at, userData = {}) {
  const self = {
    name, parent, userData, children: [], visible: true,
    matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, at[0], at[1], at[2], 1] },
    updateWorldMatrix() {},
    move(x, y, z) { const e = self.matrixWorld.elements; e[12] = x; e[13] = y; e[14] = z; },
  };
  parent?.children.push(self);
  return self;
}
function world() {
  const plays = [];
  const effects = {
    library: { get: name => LIB[String(name).toLowerCase()] },
    play(name, options) {
      const handle = { name, options, run: { alive: true }, stopped: false,
                       stop() { handle.stopped = true; } };
      plays.push(handle);
      return handle;
    },
  };
  const ground = { waterLevel: 40, material: 3, heightfield: null };
  ground.heightfield = { height: () => ground.floor, material: () => ground.material };
  ground.floor = 50;
  const eye = [0, 52, 0];
  const ambient = new AmbientEffects({ effects, ground: () => ground, eye: () => eye });
  return { ambient, plays, ground, eye, effects };
}
const running = w => w.ambient.hosts.filter(h => h.handle).map(h => h.name);
const bundleNode = (name, parent, at) => node(name, parent, at, { effect: { kind: 'bundle' } });

// A tank on its tracks: one dummy Spring carrying both dust bundles.
{
  const w = world();
  const root = node('level', null, [0, 0, 0]);
  const hull = node('Sherman', node('spawners', root, [0, 0, 0]), [0, 51, 0]);
  const spring = node('ShermanWheelL3DummyMiddle', hull, [0, 50.4, 0], { templateKind: 'Spring' });
  const dark = bundleNode('e_wdustPanz', spring, [0, 50.4, 0]);
  const light = bundleNode('e_wdustPanzL', spring, [0, 50.4, 0]);
  // The bundle's parked emitter quad: not a host.
  node('Em_wDust', dark, [0, 50.4, 0], { effect: { kind: 'sprite' } });
  const adopted = w.ambient.adoptLevel(root);
  const again = w.ambient.adopt(root);
  const steps = {};
  const drive = (x, y = 50.4) => { for (const m of [spring, dark, light]) m.move(x, y, 0); w.ambient.lookAll(); };
  w.ambient.lookAll();
  w.ambient.lookAll();
  steps.parked = running(w);
  drive(1); steps.onGrass = running(w);
  w.ground.material = 13; drive(2); steps.onSand = running(w);
  w.ground.material = 100; drive(3); steps.onConcrete = running(w);
  w.ground.material = 3; drive(4, 52.5); steps.airborne = running(w);
  drive(5); steps.landed = running(w);
  // The sea over the ground: the wheel is in the water, material 1.
  w.ground.floor = 30; w.ground.waterLevel = 50.2; drive(6); steps.inTheSea = running(w);
  w.ground.floor = 50; w.ground.waterLevel = 40; drive(7); steps.ashore = running(w);
  hull.visible = false; drive(8); steps.wrecked = running(w);
  hull.visible = true; drive(9); steps.respawned = running(w);
  w.eye[0] = 1000; drive(10); steps.farAway = running(w);
  out.tank = { adopted, again, steps, plays: w.plays.length,
               attached: w.plays[0]?.options.attach.object === dark, ambient: w.plays[0]?.options.ambient };
}
// A landing craft: the bow wave needs the hull under way and in the water.
{
  const w = world();
  const root = node('level', null, [0, 0, 0]);
  const hull = node('Lcvp', root, [0, 40, 0], { templateKind: 'PlayerControlObject' });
  const bowNode = bundleNode('e_WaterFront', hull, [0, 38, 4]);
  const ring = bundleNode('e_WaterBoatSvall', hull, [0, 39, 0]);
  w.eye[1] = 45;
  w.ambient.adoptLevel(root);
  const steps = {};
  const sail = (x, lift = 0) => { bowNode.move(x, 38 + lift, 4); ring.move(x, 39 + lift, 0); w.ambient.lookAll(); };
  w.ambient.lookAll(); w.ambient.lookAll();
  steps.moored = running(w);
  sail(1); steps.underWay = running(w);
  sail(2, 5); steps.liftedOut = running(w);       // both over the water
  sail(3, -12); steps.sunk = running(w);          // the bow 14 m down, past its 10
  out.boat = steps;
}
// Placed statics: a chimney loops from level start; a one-shot fire plays once.
{
  const w = world();
  const root = node('level', null, [0, 0, 0]);
  const factory = node('factory_m1', root, [100, 50, 0]);
  // The level switches a static off past its own draw distance. Its smoke
  // keeps its own (`lodDistance`).
  factory.visible = false;
  bundleNode('e_ExFumeFact', factory, [100, 70, 0]);
  const fire = bundleNode('e_FireSmallYellow', factory, [100, 51, 0]);
  bundleNode('e_MuzzPanz', factory, [100, 51, 0]);
  bundleNode('e_NotInTheLibrary', factory, [100, 51, 0]);
  w.ambient.adoptLevel(root);
  const steps = {};
  w.ambient.lookAll(); steps.levelStart = running(w);
  // The fire's emitter ran out: `EffectPlayer` drops the run.
  w.ambient.hosts.find(h => h.node === fire).handle.run.alive = false;
  w.ambient.lookAll(); w.ambient.lookAll(); steps.fireOver = running(w);
  w.eye[0] = 100 + 700 * 1.05; w.ambient.lookAll(); steps.insideHysteresis = running(w);
  w.eye[0] = 100 + 700 * 1.2; w.ambient.lookAll(); steps.pastLod = running(w);
  w.eye[0] = 100 + 690; w.ambient.lookAll(); steps.backInside = running(w);
  // A level's particles swept away (`EffectPlayer.clear`): the loop comes back.
  for (const h of w.ambient.hosts) if (h.handle) h.handle.run.alive = false;
  w.ambient.lookAll(); steps.afterFlush = running(w);
  w.ambient.enabled = false; w.ambient.lookAll(); steps.switchedOff = running(w);
  out.statics = { steps, stats: w.ambient.stats() };
  w.ambient.clear();
  out.statics.cleared = w.ambient.hosts.length;
}
// The per-frame share: every host is looked at once per GATE_INTERVAL.
{
  const w = world();
  const root = node('level', null, [0, 0, 0]);
  for (let i = 0; i < 120; i++) bundleNode('e_ExFumeFact', root, [i, 60, 0]);
  w.ambient.adoptLevel(root);
  w.ambient.update(1 / 60);
  const first = w.ambient.looks;
  for (let i = 1; i < 6; i++) w.ambient.update(1 / 60);
  out.share = { hosts: 120, firstFrame: first, afterSixFrames: w.ambient.looks, interval: GATE_INTERVAL };
}
process.stdout.write(JSON.stringify(out) + '\n');
