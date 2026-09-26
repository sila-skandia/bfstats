// `viewer/replay.js` and its modules under node: the replayed-aircraft
// propeller law, the recording's players, kits, seats and deaths, and the
// kinematics a replayed hull is presented from.
//
// Same pattern as `hit_indication_harness.mjs` -- one node run, one JSON
// report -- with the modules imported from the viewer tree in place through
// `sim/env.mjs`'s hooks (`three` resolves to the vendored build), so the file
// under test is the file the page loads.
//
// Why the propeller cases exist. A `models/<Template>.glb` keeps both of a
// prop plane's meshes as visible siblings under the LodObject wrapper (the
// blade and the blurred disc, assemble.py's `_propeller_blur`), and the
// playable map picks between them from live throttle. A replayed hull is now
// presented by the map's own drive (`Aircraft.presentKinematic`), so the swap
// is the flight model's; until the drive's first frame the clone must still
// show the same idle state the level's parked spawners show, or the disc
// draws straight through the blade. That default broke the other way once
// already (the bf109's cockpit LodObject wears the same naming), so the cases
// below pin both the law and its one known false positive.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { setReplayPropellerIdle }, recording, kinematics, { Aircraft }, { EngineState }] = await Promise.all([
  imp('vendor/three.module.js'), imp('replay.js'), imp('replay-recording.js'), imp('replay-kinematics.js'),
  imp('aircraft.js'), imp('ground-engine.js'),
]);

const results = {};

function propellerVehicle(rootName, wrapperName, stamp, children) {
  const scene = new THREE.Scene();
  const root = new THREE.Object3D();
  root.name = rootName;
  root.userData = { templateKind: 'PlayerControlObject', control: rootName };
  const wrapper = new THREE.Object3D();
  wrapper.name = wrapperName;
  wrapper.userData = stamp ? { propellerBlur: stamp } : {};
  for (const name of children) {
    const child = new THREE.Object3D();
    child.name = name;
    // The glb exports both alternatives visible; picking one is the
    // viewer's job, never the file's.
    child.visible = true;
    wrapper.add(child);
  }
  root.add(wrapper);
  scene.add(root);
  return scene;
}

const read = scene => {
  const out = {};
  scene.traverse(obj => {
    for (const child of obj.children) out[child.name] = child.visible;
  });
  return out;
};

// A real propeller: the stamp the current exporter writes (Wake's Corsair,
// read straight off the published scene). Idle state after the walk: the
// blade alone — the disc hidden exactly as the level's own parked traverse
// leaves it.
{
  const scene = propellerVehicle('Corsair', 'lodCorsairPropeller', {
    static: 'CorsairPropellerStatic',
    blurred: 'CorsairPropellerBlurred',
    selector: 'CorsairPropSelector',
    selectorKind: 'CompareSelector',
    distances: [],
    comparisons: [0.07],
  }, ['CorsairPropellerStatic', 'CorsairPropellerBlurred']);
  setReplayPropellerIdle(scene);
  const state = read(scene);
  results.corsair = {
    blade: state.CorsairPropellerStatic,
    disc: state.CorsairPropellerBlurred,
  };
}

// The bf109's cockpit LodObject under a `DistCompareSelector`, WITH both
// children — the shape an already-published tree carries. Its "blurred" half
// is the pilot's 1P interior; the walk must leave it exactly as exported.
{
  const scene = propellerVehicle('BF109', 'lodbf109Cockpit', {
    static: 'bf109CockpitStatic',
    blurred: 'bf109CockpitBlurred',
    selector: 'bf109cockpitSelector',
    selectorKind: 'DistCompareSelector',
    distances: [10],
    comparisons: [0.5],
  }, ['bf109CockpitStatic', 'bf109CockpitBlurred']);
  setReplayPropellerIdle(scene);
  const state = read(scene);
  results.bf109CockpitBothHalves = {
    exterior: state.bf109CockpitStatic,
    interior: state.bf109CockpitBlurred,
  };
}

// The fresh-tree shape of the same cockpit: the exporter already excludes the
// 1P interior, so the stamp names a child that is not there. A no-op, and
// never a throw.
{
  const scene = propellerVehicle('BF109', 'lodbf109Cockpit', {
    static: 'bf109CockpitStatic',
    blurred: 'bf109CockpitBlurred',
    selector: 'bf109cockpitSelector',
    selectorKind: 'DistCompareSelector',
    distances: [10],
    comparisons: [0.5],
  }, ['bf109CockpitStatic']);
  setReplayPropellerIdle(scene);
  const state = read(scene);
  results.bf109CockpitFreshTree = {
    exterior: state.bf109CockpitStatic,
    interiorMissing: !('bf109CockpitBlurred' in state),
  };
}

// A wrapper that wears the naming convention with no stamp at all — an asset
// published before the exporter learned the pair. Nothing names it a
// propeller, so nothing may touch it: the level's own load walk has the same
// blind spot, and inventing a name match here would hide a mesh the stamp's
// author never meant to swap.
{
  const scene = propellerVehicle('Mystery', 'lodMysteryPropeller', null,
    ['MysteryPropellerStatic', 'MysteryPropellerBlurred']);
  setReplayPropellerIdle(scene);
  const state = read(scene);
  results.unstampedPair = {
    blade: state.MysteryPropellerStatic,
    disc: state.MysteryPropellerBlurred,
  };
}

// Two propellers on one airframe (the B17 ships four): every stamped wrapper
// is walked, not just the first.
{
  const scene = new THREE.Scene();
  const root = new THREE.Object3D();
  root.name = 'B17';
  root.userData = { templateKind: 'PlayerControlObject', control: 'B17' };
  for (const suffix of ['', '.1', '.2', '.3']) {
    const wrapper = new THREE.Object3D();
    wrapper.name = `lodB17Propeller${suffix}`;
    wrapper.userData = {
      propellerBlur: {
        static: `B17PropellerStatic${suffix}`,
        blurred: `B17PropellerBlurred${suffix}`,
        selector: 'b17propSelector',
        selectorKind: 'CompareSelector',
        distances: [],
        comparisons: [0.07],
      },
    };
    for (const name of [`B17PropellerStatic${suffix}`, `B17PropellerBlurred${suffix}`]) {
      const child = new THREE.Object3D();
      child.name = name;
      child.visible = true;
      wrapper.add(child);
    }
    root.add(wrapper);
  }
  scene.add(root);
  setReplayPropellerIdle(scene);
  const state = {};
  scene.traverse(obj => {
    for (const child of obj.children) state[child.name] = child.visible;
  });
  results.b17AllFour = ['', '.1', '.2', '.3'].map(suffix => ({
    blade: state[`B17PropellerStatic${suffix}`],
    disc: state[`B17PropellerBlurred${suffix}`],
  }));
}

// --- the flown propeller law on a replayed airframe -------------------------
//
// A replayed aircraft is the map's own `Aircraft`, presented from recorded
// motion (`presentKinematic`): the throttle picks blade or disc exactly as
// flying it does, the propeller turns, and the gear folds away on the
// airframe's own altitude thresholds.
{
  const root = new THREE.Object3D();
  root.name = 'Corsair';
  root.userData = { templateKind: 'PlayerControlObject', control: 'Corsair' };
  const engine = new THREE.Object3D();
  engine.name = 'CorsairEngine';
  engine.userData = {
    templateKind: 'Engine',
    rig: { control: 'Corsair', axes: { roll: { input: 'c_PIThrottle', driver: 'rate', min: -3000, max: 5000, maxSpeed: 500 } } },
    spinsChildren: ['lodCorsairPropeller'],
  };
  const wrapper = new THREE.Object3D();
  wrapper.name = 'lodCorsairPropeller';
  wrapper.userData = { propellerBlur: {
    static: 'CorsairPropellerStatic', blurred: 'CorsairPropellerBlurred',
    selectorKind: 'CompareSelector', distances: [], comparisons: [0.07],
  } };
  for (const name of ['CorsairPropellerStatic', 'CorsairPropellerBlurred']) {
    const child = new THREE.Object3D();
    child.name = name;
    wrapper.add(child);
  }
  engine.add(wrapper);
  root.add(engine);
  const scene = new THREE.Scene();
  scene.add(root);
  setReplayPropellerIdle(scene);
  const plane = new Aircraft(root, null, { cockpit: false });
  plane.groundHeight = () => 0;
  const blade = () => wrapper.children[0].visible;
  const disc = () => wrapper.children[1].visible;
  // Parked, nobody aboard: idle blade.
  plane.state.position.set(0, 1.2, 0);
  plane.presentKinematic(0.1, 0);
  const parked = { blade: blade(), disc: disc(), gear: plane.input('c_PILandingGear') };
  // In flight under power: the spooled throttle crosses the 0.07 swap, the
  // propeller has turned, and 300 m up the gear is away.
  const angleBefore = plane.state.propellerAngle;
  plane.state.position.set(0, 300, 0);
  for (let i = 0; i < 40; i++) plane.presentKinematic(0.1, 0.9);
  results.flownPropeller = {
    parked,
    flying: { blade: blade(), disc: disc(), gear: plane.input('c_PILandingGear'),
              throttle: plane.state.throttle, turned: plane.state.propellerAngle - angleBefore,
              wrapperTurned: 1 - Math.abs(wrapper.quaternion.w) > 1e-4 },
    placed: { x: root.position.x, y: root.position.y },
  };
}

// --- a recording's players, kits, seats and deaths ---------------------------
//
// Two players spawn with different kits: each soldier keeps his own (the
// report that started this: the recording player spawned as assault and was
// drawn with a bazooka, because the last kit anyone picked up was given to
// every soldier). A bot rides a Sherman's hull gun (the seat id after the
// hull's own) and another dies.
{
  const line = o => JSON.stringify(o);
  const lines = [
    line({ k: 'h', v: 3, start: '2026-09-27T00:00:00', hz: 10 }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 2916, netId: 532, tmpl: 'Sherman', pos: [10, 0, 10], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 100, netId: 600, tmpl: 'USMarineSoldier', pos: [0, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 101, netId: 604, tmpl: 'UsMarine_AT', pos: [0, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 102, netId: 700, tmpl: 'MultiPlayerFreeCamera', pos: [0, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 2, e: 'createPlayer', pid: 250, name: 'Bot', team: 2, ai: 1, netId: 1, vehNetId: 600, camNetId: 700, kitNetId: 604 }),
    line({ k: 'e', t: 2, e: 'createPlayer', pid: 0, name: 'skandia', team: 2, ai: 0, netId: 2, vehNetId: 2, camNetId: 2, kitNetId: 0 }),
    line({ k: 'e', t: 2.5, e: 'dbComplete' }),
    line({ k: 'e', t: 5, e: 'createObject', tid: 100, netId: 1074, tmpl: 'USMarineSoldier', pos: [5, 0, 5], rot: [0, 0, 0] }),
    line({ k: 'e', t: 5, e: 'createObject', tid: 103, netId: 1078, tmpl: 'UsMarine_Assault', pos: [0, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 5, e: 'control', pid: 0, netId: 1074 }),
    line({ k: 'e', t: 5, e: 'pickupKit', pid: 0, netId: 1078 }),
    line({ k: 'o', t: 5.1, id: 1074, gid: 1, tmpl: 'USMarineSoldier', tid: 100, team: 2 }),
    line({ k: 's', t: 5.1, o: [[1074, 5, 0, 5, 0, 0, 0, 1]] }),
    line({ k: 'e', t: 6, e: 'enterVehicle', pid: 250, netId: 533 }),
    line({ k: 'p', t: 6.05, p: [[250, 2, 533], [0, 2, 1074]] }),
    line({ k: 'e', t: 8, e: 'fire', pid: 0, kind: 1, weapon: 'USMarineSoldier', pos: [5, 0, 5], dir: [0, 0, 1] }),
    line({ k: 'e', t: 9, e: 'exitVehicle', pid: 250 }),
    line({ k: 'p', t: 9.05, p: [[250, 2, 600]] }),
    line({ k: 'e', t: 12, e: 'score', kind: 3, pid: 0, victim: 250, weapon: 1223, bodypart: 1 }),
    line({ k: 'e', t: 12, e: 'control', pid: 250, netId: 700 }),
    line({ k: 'e', t: 20, e: 'destroyObject', netId: 600 }),
    line({ k: 'e', t: 25, e: 'raw', type: 49, size: 74, raw: '0000cf0400000000000000000000000000000000000000000000000000000000000000000000000000001f000000000000000000000000000000000000000000000000' }),
    line({ k: 'end', t: 30 }),
  ];
  const rec = recording.parseRecording(lines.join('\n'));
  const loadouts = { kits: {
    UsMarine_Assault: { primary: 'Bar1918' }, UsMarine_AT: { primary: 'Bazooka' },
  } };
  const soldier = nid => rec.lives.find(l => l.nid === nid);
  const mine = soldier(1074);
  const bots = soldier(600);
  const sherman = rec.lives.find(l => l.nid === 532);
  results.recording = {
    mine: { pid: mine.pid, kit: mine.kitTemplate, weapon: recording.primaryWeaponFor(mine, loadouts) },
    bot: { pid: bots.pid, kit: bots.kitTemplate, weapon: recording.primaryWeaponFor(bots, loadouts),
           diedAt: bots.diedAt ?? null, killer: bots.killer ?? null },
    // Without the loadouts file: the vanilla primary for the kit's nation and
    // row, never another player's.
    fallback: { mine: recording.primaryWeaponFor(mine, null), bot: recording.primaryWeaponFor(bots, null) },
    seat: (() => { const r = recording.rootOf(rec, 533, 7, 250); return r ? { root: r.life.tmpl, seat: r.seat } : null; })(),
    crewAt7: recording.crewOf(rec, sherman, 7),
    crewAt10: recording.crewOf(rec, sherman, 10),
    controlledAt13: recording.controlledAt(rec, 250, 13),
    stats: [...rec.roundStats].map(([pid, e]) => ({ pid, fired: e.fired.map(r => [r.tid, r.n]) })),
    fire: rec.fires.map(f => ({ t: f.t, soldier: f.soldier, kit: f.kitTemplate ?? null })),
  };
}

// --- a v5 recording's own records (v4's, with the parts numbered) ----------
{
  const line = o => JSON.stringify(o);
  const rec = recording.parseRecording([
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 2916, netId: 532, tmpl: 'Sherman', pos: [0, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'p', t: 2, p: [[251, 2, 533, 532, 1]] }),
    line({ k: 'e', t: 3, e: 'projPool', tid: 1288, tmpl: 'GrenadeAlliesProjectile', netId: 1075, count: 3 }),
    line({ k: 'e', t: 4, e: 'simStart', running: 1, worldTime: 288.5 }),
    line({ k: 'e', t: 5, e: 'roundStats', stat: 'destroyed', pid: 249, rows: [{ tid: 1941, tmpl: 'AichiVal', n: 3 }] }),
    line({ k: 'f', t: 6, id: 532, w: 'ShermanCannon', pid: 251, p: [0, 2, 0], d: [0, 0, 1] }),
    line({ k: 'g', t: 6, o: [[532, 0.8, 1, 1, 2, 535]] }),
    line({ k: 'g', t: 8, o: [[532, 0.1, 0, 0, 1, 535]] }),
    line({ k: 'jn', t: 6, o: [[532, 7, 'ShermanTower', 0.1, 1.8, 0.5]] }),
    line({ k: 'j', t: 6, o: [[532, 7, 0, 0.7071, 0, 0.7071]] }),
    line({ k: 'o', t: 6, id: 600, gid: 1, tmpl: 'USMarineSoldier', tid: 100, team: 2 }),
    line({ k: 'anim', t: 6, states: [[0, 'Lb_Stand', 0], [1, 'Lb_Crouch', 0x20], [2, 'Ub_Fire', 0], [3, 'Lb_Lie', 0x40]] }),
    line({ k: 'st', t: 6, o: [[600, 1, 2, -12.5, 3, 2, 0]] }),
    line({ k: 'st', t: 7, o: [[600, 3, 0, 0, 0, 3, 0]] }),
  ].join('\n'));
  const sherman = rec.lives.find(l => l.nid === 532);
  results.v5 = {
    seat: (() => { const r = recording.rootOf(rec, 533, 2.5, 251); return r ? { root: r.life.tmpl, seat: r.seat } : null; })(),
    pooled: rec.lives.filter(l => l.pooled).map(l => `${l.tmpl}#${l.nid}`),
    clock: recording.roundClock(rec, 5),
    stats: rec.roundStats.get(249)?.destroyed ?? null,
    shot: rec.fires.map(f => ({ nid: f.nid, weapon: f.weapon, kind: f.kind })),
    engine: [recording.engineAt(rec, 532, 7), recording.engineAt(rec, 532, 9)],
    joint: (() => { const p = rec.joints.get(532)?.get(7); return p ? { name: p.name, q: p.keys[0].q, pos: p.pos, since: p.since } : null; })(),
    body: [recording.bodyAt(rec, 600, 6.5), recording.bodyAt(rec, 600, 7.5)],
    crew: recording.crewOf(rec, sherman, 3),
  };
}

// --- a v4 file's parts: every one keyed 0, so none is used -------------------
{
  const line = o => JSON.stringify(o);
  const rec = recording.parseRecording([
    line({ k: 'h', v: 4, start: '', hz: 10 }),
    line({ k: 'jn', t: 4.5, o: [[529, 0, 'DefgunTurret']] }),
    line({ k: 'j', t: 4.5, o: [[529, 0, 0, 0.7071, 0, 0.7071], [529, 0, 0, 0, 0.1, 0.995], [532, 0, 0, 1, 0, 0]] }),
  ].join('\n'));
  results.v4Joints = rec.joints.size;
}

// --- kinematics from recorded motion -----------------------------------------
{
  // A hull moving 10 m/s along BF1942's +Z (the viewer's -Z: forward for a
  // hull facing the identity), turning left at 0.5 rad/s about +Y.
  const keys = [];
  for (let i = 0; i <= 30; i++) {
    const t = i * 0.1;
    const yaw = 0.5 * t;   // viewer frame: +Y is a left turn
    // A viewer quaternion (x, y, z, w) is (-x, -y, z, w) recorded.
    keys.push({ t, p: [0, 0, 10 * t], q: [0, -Math.sin(yaw / 2), 0, Math.cos(yaw / 2)] });
  }
  const life = { keys, pose: null, created: 0, destroyed: Infinity };
  const m = kinematics.motionAt(life, 1.5);
  const engine = new EngineState({ differential: 5, numberOfGears: 4 });
  const revs = [2, 6, 10, 14, 6, 2].map(v => ({ v, revs: +kinematics.groundRevs(engine, v, true).toFixed(3), gear: engine.gear }));
  results.kinematics = {
    velocity: m.velocity.map(v => +v.toFixed(3)),
    forward: +m.forward.toFixed(3),
    yawRate: +m.angular[1].toFixed(3),
    // A nose-up pitch (positive rate about the hull's +X) is a NEGATIVE
    // c_PIPitch (positive is nose down), a left turn a negative c_PIYaw.
    stickNoseUp: kinematics.aircraftStick([0.6, 0, 0]),
    stickLeft: kinematics.aircraftStick([0, 0.3, 0]),
    stickRightWingDown: kinematics.aircraftStick([0, 0, -1.75]),
    steerLeft: +kinematics.groundSteer(0.5, 10).toFixed(3),
    revs,
    throttleParked: kinematics.aircraftThrottle({ crewed: true, airborne: false, speed: 0 }),
    throttleEmpty: kinematics.aircraftThrottle({ crewed: false, airborne: true, speed: 50 }),
    throttleFlying: +kinematics.aircraftThrottle({ crewed: true, airborne: true, speed: 50, vmax: 60 }).toFixed(3),
  };
  // A ship's three identical AA guns and a tower, in the root's frame.
  const nodes = [
    { name: 'aagun', pos: [-3, 2, 10] }, { name: 'aagun', pos: [3, 2, 10] }, { name: 'aagun', pos: [0, 4, -20] },
    { name: 'tower', pos: [0, 1, 0] },
  ];
  const match = parts => Object.fromEntries(kinematics.matchJointNodes(parts, nodes));
  results.kinematics.matchPlaced = match([
    { key: 11, name: 'aagun', pos: [0.2, 4, -19] },
    { key: 12, name: 'aagun', pos: [2.9, 2, 10.2] },
    { key: 13, name: 'aagun', pos: [-3.1, 2, 9.7] },
  ]);
  results.kinematics.matchUnplaced = match([
    { key: 21, name: 'aagun', pos: null }, { key: 22, name: 'aagun', pos: null },
    { key: 23, name: 'tower', pos: null }, { key: 24, name: 'tower', pos: null },
    { key: 25, name: 'nothing', pos: null },
  ]);
  results.kinematics.matchMixed = match([
    { key: 32, name: 'aagun', pos: null },
    { key: 31, name: 'aagun', pos: [3, 2, 10] },
  ]);
}

console.log(JSON.stringify(results));
