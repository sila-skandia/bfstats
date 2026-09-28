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
const [THREE, { setReplayPropellerIdle }, recording, kinematics, { Aircraft }, { EngineState }, replayGunfire, replayRound] = await Promise.all([
  imp('vendor/three.module.js'), imp('replay.js'), imp('replay-recording.js'), imp('replay-kinematics.js'),
  imp('aircraft.js'), imp('ground-engine.js'), imp('replay-gunfire.js'), imp('replay-round.js'),
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
  // Parked, nobody aboard, the engine off: idle blade, standing still.
  plane.state.position.set(0, 1.2, 0);
  for (let i = 0; i < 10; i++) plane.presentKinematic(0.1, 0, false);
  const parked = { blade: blade(), disc: disc(), gear: plane.input('c_PILandingGear'),
                   turned: plane.state.propellerAngle };
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

// --- a parked plane's propeller is still until its engine starts --------------
//
// The 2026-09-27 report: on Midway the parked planes' propellers turned over
// slowly. Every replayed plane is presented each frame, crewed or not, and the
// propeller's idle floor (2 rev/s) is a started engine's. A Corsair stands on
// the ground for ten seconds; the recorder's `g` lines have its engine off
// for five, then running at zero revs (a pilot aboard on the deck). Without
// `g` lines at all (a v3 file) nobody holds its root seat, so it stays still.
// Out of range from 3 s with its engine last seen running, it is not being
// updated: met there after a seek, it holds still too.
{
  const { ReplayHull } = await imp('replay-hulls.js');
  const line = o => JSON.stringify(o);
  const corsair = () => {
    const root = new THREE.Group();
    root.name = 'Corsair';
    root.userData = { templateKind: 'PlayerControlObject', control: 'Corsair' };
    const engine = new THREE.Object3D();
    engine.name = 'CorsairEngine';
    engine.userData = {
      templateKind: 'Engine', control: 'Corsair', physics: { engineType: 'c_ETPlane' },
      rig: { control: 'Corsair', axes: { roll: { input: 'c_PIThrottle', driver: 'rate', min: -3000, max: 5000, maxSpeed: 500 } } },
      spinsChildren: ['lodCorsairPropeller'],
    };
    const blade = new THREE.Object3D();
    blade.name = 'lodCorsairPropeller';
    engine.add(blade);
    root.add(engine);
    const scene = new THREE.Group();
    scene.add(root);
    return { scene, blade };
  };
  // An engine record, `[root, revs, throttle servo, flags, gear, engine]`:
  // flags 1 running.
  const g = (t, flags, revs = 0) => line({ k: 'g', t, o: [[792, revs, 0, flags, 1, 296]] });
  const text = extra => [
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'e', t: 0.5, e: 'createObject', tid: 2100, netId: 792, tmpl: 'Corsair', pos: [300, 2, 400], rot: [0, 0, 0] }),
    line({ k: 'o', t: 0.5, id: 792, gid: 1, tmpl: 'Corsair', tid: 2100, team: 2, maxhp: 100, crit: 20 }),
    ...Array.from({ length: 101 }, (_, i) => line({ k: 's', t: +(0.5 + i * 0.1).toFixed(1), o: [[792, 300, 2, 400, 0, 0, 0, 1]] })),
    ...extra,
    line({ k: 'end', t: 11 }),
  ].join('\n');
  const watch = (extra, from = 0.5) => {
    const rec = recording.parseRecording(text(extra));
    const { scene, blade } = corsair();
    const ctx = { scene: new THREE.Scene(), vehicleClasses: { Aircraft }, groundHeight: () => 0 };
    const hull = new ReplayHull({ ctx, rec, showGhosts: true }, rec.lives.find(l => l.nid === 792), scene, null);
    const angles = [];
    for (let i = Math.round((from - 0.5) * 10); i <= 100; i++) {
      const t = +(0.5 + i * 0.1).toFixed(1);
      hull.update(t, 0.1);
      if ([1, 4.5, 8, 10].includes(t)) {
        angles.push({ t, angle: +hull.drive.state.propellerAngle.toFixed(1), rate: Math.round(hull.drive.state.propRpm) });
      }
    }
    return { kind: hull.kind, angles, bladeTurned: 1 - Math.abs(blade.quaternion.w) > 1e-4 };
  };
  results.parkedPropeller = {
    recorded: watch([g(0.5, 0), g(5, 1)]),
    unrecorded: watch([]),
    outOfRange: watch([g(0.5, 1, 0.5), line({ k: 'd', t: 3, id: 792 })], 8),
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
    line({ k: 'e', t: 8, e: 'hitFrom', dir: 4, strength: 15 }),
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
    hits: rec.hitsTaken,
    hitRow: rec.events.find(e => e.kind === 'damage' && e.t === 8)?.text ?? null,
  };
}

// --- a v4 file's parts: every one keyed 0, so none is used -------------------
{
  const line = o => JSON.stringify(o);
  const rec = recording.parseRecording([
    line({ k: 'h', v: 4, start: '', hz: 10 }),
    line({ k: 'jn', t: 4.5, o: [[529, 0, 'DefgunTurret']] }),
    // A v4 file's HitFromPosEvent is still a raw dump.
    line({ k: 'e', t: 275.203, e: 'raw', type: 60, size: 14, raw: '02bf' }),
    line({ k: 'j', t: 4.5, o: [[529, 0, 0, 0.7071, 0, 0.7071], [529, 0, 0, 0, 0.1, 0.995], [532, 0, 0, 1, 0, 0]] }),
  ].join('\n'));
  results.v4Joints = rec.joints.size;
  results.v4Hits = rec.hitsTaken;
}

// --- the replay's rounds and the level's hidden placed vehicles -------------
{
  // A level: its `spawners` group holds a Defgun (no deck) and a carrier (a
  // drivable deck); a bunker is a plain static. One triangle each.
  const level = new THREE.Group();
  const spawners = new THREE.Group();
  spawners.name = 'spawners';
  const defgun = new THREE.Object3D(); defgun.name = 'Defgun';
  const carrier = new THREE.Object3D(); carrier.name = 'Shokaku';
  const bunker = new THREE.Object3D(); bunker.name = 'bunker';
  spawners.add(defgun, carrier);
  level.add(spawners, bunker);
  const makeCollider = () => {
    const disabled = new Set();
    return {
      dynamicCast: null,
      disabled,
      statics: {
        ownerNodes: [defgun, carrier, bunker],
        owners: Int32Array.from([0, 1, 2]),
        drivable: Uint8Array.from([0, 1, 0]),
        disableOwner: id => disabled.add(id),
      },
    };
  };
  const first = makeCollider();
  const player = { hulls: new Map(), ctx: { guns: { collider: null } } };
  const before = replayGunfire.syncReplayCollision(player);   // no level collider yet
  player.ctx.guns.collider = first;
  const taken = replayGunfire.syncReplayCollision(player);
  const again = replayGunfire.syncReplayCollision(player);
  const second = makeCollider();
  player.ctx.guns.collider = second;
  const retaken = replayGunfire.syncReplayCollision(player);
  results.replayCollision = {
    before, taken, again, retaken,
    disabled: [...first.disabled],
    castInstalled: typeof first.dynamicCast === 'function' && second.dynamicCast === first.dynamicCast,
  };
}

// --- the round: flags, tickets ------------------------------------------------
{
  const line = o => JSON.stringify(o);
  // A round seen from its start: PREGAME at 5, PLAYING at 10. Wake's five
  // points, all the Allies' (team 2, 20 each: exactly 100, so the Axis bleed).
  const names = [['Landing_Beach', 'The_Beach'], ['The_Airfield', 'The_Airfield'], ['South_Base', 'ALLIES_southbase'],
    ['North_Base', 'ALLIES_north_base'], ['Village', 'ALLIES_north_village']];
  const text = [
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'e', t: 1, e: 'createPlayer', pid: 1, name: 'axis', team: 1 }),
    line({ k: 'e', t: 1, e: 'createPlayer', pid: 2, name: 'allied', team: 2 }),
    line({ k: 'e', t: 5, e: 'gameStatus', status: 3 }),
    ...names.map(([name, tmpl], i) => line({ k: 'cp', t: 6, id: 100 + i, name, tmpl, pos: [i * 100, 0, 0], team: 2 })),
    line({ k: 'e', t: 10, e: 'gameStatus', status: 1 }),
    line({ k: 'e', t: 12, e: 'score', kind: 4, pid: 1, victim: 1 }),
    line({ k: 'e', t: 15, e: 'score', kind: 4, pid: 2, victim: 2 }),
    line({ k: 'e', t: 20, e: 'score', kind: 4, pid: 1, victim: 1 }),
    line({ k: 's', t: 40, o: [] }),
  ].join('\n');
  const rec = recording.parseRecording(text);
  const entries = names.map(([name, tmpl], i) => ({
    name: i === 0 ? 'The_beach' : tmpl, displayName: name, areaValue: 20, team: 2, position: [i * 100, 0, 0],
  }));
  const matched = replayRound.matchPoints([...rec.controlPoints.values()], entries);
  const byName = new Map([...matched].map(([id, entry]) => [rec.controlPoints.get(id)?.name, entry]));
  const timeline = replayRound.estimateTickets(rec, {
    tickets: { team1: 100, team2: 100 }, rates: { team1: 15, team2: 15 }, maxPlayers: 32,
    areaValueOf: p => Number(byName.get(p.name)?.areaValue) || 0,
  });
  // A join mid-round: PLAYING with no PREGAME before it.
  const midRound = recording.parseRecording([
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'e', t: 3, e: 'gameStatus', status: 1 }),
    line({ k: 'tk', t: 3, v: [140, 190] }),
    line({ k: 'tk', t: 9, v: [139, 190] }),
  ].join('\n'));
  results.round = {
    roundStarted: rec.roundStarted,
    deaths: rec.deaths.map(d => [d.t, d.pid]),
    matched: [...matched].map(([id, entry]) => [id, entry.name]),
    at9: replayRound.ticketsAt(timeline, 9),
    at31: replayRound.ticketsAt(timeline, 31),
    midRoundStarted: midRound.roundStarted,
    midRoundEstimate: replayRound.estimateTickets(midRound, { tickets: { team1: 100, team2: 100 }, areaValueOf: () => 0 }),
    recorded: [replayRound.ticketsAt(midRound.tickets, 2), replayRound.ticketsAt(midRound.tickets, 5), replayRound.ticketsAt(midRound.tickets, 9.5)],
    slots: [replayRound.serverSlots({ settings: { maxplayers: 32 } }, null),
      replayRound.serverSlots({ settings: {}, events: [{ name: 'roundInit', params: { tickets_team1: 200 } }] }, { team1: 100 }),
      replayRound.serverSlots(null, null)],
  };
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

// --- the viewing experience (features/round-replay-ux) -----------------------
//
// The round's chapters and kill lines, the players' states and tallies, the
// page's message log driven from the recording, and the camera's three modes,
// from one small v3 round: a kill with its weapon, a team kill (6 then 4, one
// death), a plain death, two flags taken through neutral, a chat line, a
// player leaving, and the recording player hit once.
{
  const [chapters, { ReplayFeed }, { ReplayCamera }] = await Promise.all([
    imp('replay-chapters.js'), imp('replay-feed.js'), imp('replay-camera.js'),
  ]);
  const line = o => JSON.stringify(o);
  const rec = recording.parseRecording([
    line({ k: 'h', v: 3, start: '', hz: 10 }),
    line({ k: 'e', t: 0.5, e: 'createPlayer', pid: 1, name: 'Axe', team: 1, ai: 1 }),
    line({ k: 'e', t: 0.5, e: 'createPlayer', pid: 2, name: 'Bea', team: 2, ai: 1 }),
    line({ k: 'e', t: 0.5, e: 'createPlayer', pid: 0, name: 'rec', team: 2, ai: 0 }),
    line({ k: 'e', t: 1, e: 'gameStatus', status: 3 }),
    line({ k: 'e', t: 2, e: 'gameStatus', status: 1 }),
    line({ k: 'cp', t: 2, id: 10, name: 'Landing_Beach', tmpl: 'The_Beach', pos: [0, 0, 0], team: -1 }),
    line({ k: 'cp', t: 2, id: 11, name: 'Village', tmpl: 'Village', pos: [50, 0, 0], team: -1 }),
    line({ k: 'cp', t: 2.5, id: 10, team: 2 }),
    line({ k: 'cp', t: 2.5, id: 11, team: 2 }),
    line({ k: 'e', t: 3, e: 'createObject', tid: 100, netId: 600, tmpl: 'USMarineSoldier', pos: [10, 0, 20], rot: [0, 0, 0] }),
    line({ k: 'e', t: 3, e: 'control', pid: 0, netId: 600 }),
    line({ k: 'o', t: 3.1, id: 600, gid: 1, tmpl: 'USMarineSoldier', tid: 100, team: 2, maxhp: 30 }),
    line({ k: 's', t: 3.1, o: [[600, 10, 1, 20, 0, 0, 0, 1]] }),
    line({ k: 's', t: 5.1, o: [[600, 10, 1, 20, 0, 0, 0, 1]] }),
    line({ k: 'e', t: 10, e: 'score', kind: 3, pid: 1, victim: 2, weaponName: 'Type99' }),
    line({ k: 'e', t: 10, e: 'score', kind: 5, pid: 2 }),
    line({ k: 'e', t: 15, e: 'hitFrom', dir: 2, strength: 64 }),
    line({ k: 'e', t: 20, e: 'score', kind: 6, pid: 2, victim: 0 }),
    line({ k: 'e', t: 20, e: 'score', kind: 4, pid: 0 }),
    line({ k: 'e', t: 20.2, e: 'createObject', tid: 102, netId: 700, tmpl: 'MultiPlayerFreeCamera', pos: [10, 30, 20], rot: [0, 0, 0] }),
    line({ k: 'e', t: 20.2, e: 'control', pid: 0, netId: 700 }),
    line({ k: 'e', t: 30, e: 'score', kind: 4, pid: 1 }),
    line({ k: 'cp', t: 40, id: 10, team: 0 }),
    line({ k: 'chat', t: 45, pid: 1, team: 1, text: 'Axe: hello' }),
    line({ k: 'cp', t: 50, id: 10, team: 1 }),
    line({ k: 'cp', t: 55, id: 11, team: 0 }),
    line({ k: 'cp', t: 60, id: 11, team: 1 }),
    line({ k: 'e', t: 70, e: 'destroyPlayer', pid: 2 }),
    line({ k: 'e', t: 80, e: 'gameStatus', status: 2 }),
    line({ k: 'end', t: 90 }),
  ].join('\n'));
  // The server's log fills the team kill's weapon, and knows a hull the
  // client never saw go.
  const serverRows = [
    { t: 20.3, kind: 'scoreEvent', source: 'server', pid: 2, victim: 0, weapon: 'Thompson', vehicle: null },
    { t: 35, kind: 'destroyVehicle', source: 'server', pid: 1, victim: null, weapon: null, vehicle: 'Sherman' },
  ];
  const kills = chapters.killsOf(rec, serverRows);
  const list = chapters.buildChapters(rec, serverRows, kills);
  const lexicon = {
    strings: { DEFAULT_KILL_TEXT: 'killed', TEAM_KILL: 'killed a teammate', DEATH: 'is no more',
               AXIS_CAPTURED: 'Axis captured the control point' },
    names: { Type99: 'Type 99', Landing_Beach: 'Landing Beach' },
  };
  const at = t => chapters.nextChapter(list, t);
  const tally = chapters.tallyAt(kills, 100);
  results.ux = {
    kills: rec.kills.map(k => [k.t, k.kind, k.killer, k.victim, k.weapon]),
    filled: kills.map(k => k.weapon),
    captures: rec.captures.map(c => [c.t, c.name, c.team, c.from]),
    flagRows: rec.events.filter(e => e.kind === 'flag').map(e => e.text),
    roundStarted: rec.roundStarted,
    leftT: rec.players.get(2).leftT,
    recordingPlayer: chapters.recordingPlayer(rec),
    chapters: list.map(ch => [ch.t, ch.kind, ch.lead]),
    texts: list.map(ch => chapters.chapterText(rec, ch, lexicon)),
    next: [at(0)?.kind, at(5)?.kind, at(7.1)?.kind],
    prev: chapters.prevChapter(list, 17.5)?.kind ?? null,
    nextOwn: chapters.nextChapter(list, 0, 0)?.kind ?? null,
    status: [[0, 15], [0, 25], [2, 75], [1, 5]].map(([pid, t]) => {
      const s = chapters.playerStatusAt(rec, pid, t, kills);
      return [s.state, s.killedBy?.kind ?? null];
    }),
    tally: Object.fromEntries([...tally].map(([pid, v]) => [pid, [v.kills, v.deaths]])),
    roster: chapters.rosterOf(rec).map(p => p.name),
    feed: chapters.feedEvents(rec, kills).map(e => [e.t, e.type]),
    pointsAt61: chapters.pointsAt(rec, 61).map(p => [p.name, p.team]),
  };

  // The page's message log, stood in for: every call, in order.
  const calls = [];
  const washes = [];
  let ticked = 0;
  const comms = {
    onKill: (victim, killer, how) => calls.push(['kill', victim.name, killer?.name ?? null, how?.weapon ?? null, victim.local]),
    onCapture: (point, team, points) => calls.push(['capture', point.name, team, points.every(p => p.team === team)]),
    chatLine: (text, team) => calls.push(['chat', text, team]),
    clear: () => calls.push(['clear']),
    tick: dt => { ticked += dt; },
    setRadioShown: on => calls.push(['radio', on]),
  };
  const player = { rec, followPid: 2, ctx: { comms, triggerHitIndicator: (octant, alpha) => washes.push([octant, +alpha.toFixed(3)]) } };
  const feed = new ReplayFeed(player, kills);
  const opened = calls.splice(0);
  feed.update(0);
  feed.update(9);
  feed.update(11);
  const forward = calls.splice(0);
  feed.update(16, false);
  const noWash = washes.length;
  feed.invalidate();
  feed.update(14);
  feed.update(16, true);
  const washed = washes.splice(0);
  calls.length = 0;
  ticked = 0;
  feed.invalidate();
  feed.update(52);
  results.uxFeed = { opened, forward, noWash, washed, rebuilt: calls.splice(0), rebuiltTicks: +ticked.toFixed(2) };

  // The camera's three modes, on the recording player standing at (10, 0,
  // 20) facing the way his identity rotation points, BF1942's +Z and the
  // viewer's -Z (sampled at his origin, a metre up, as the recorder writes a
  // soldier).
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.5, 8000);
  const watcher = { rec, followPid: 0, time: 5, hulls: new Map(), ctx: { camera: cam, groundHeight: () => 0, waterLevel: () => -100 } };
  const camera = new ReplayCamera(watcher);
  watcher.camera = camera;
  const target = new THREE.Vector3(10, 1.2, -20);
  for (let i = 0; i < 30; i++) camera.update(1 / 60, 5);
  const orbit = { distance: +cam.position.distanceTo(target).toFixed(2), behind: cam.position.z > target.z };
  camera.keys.add('KeyW');
  for (let i = 0; i < 60; i++) camera.update(1 / 60, 5);
  camera.keys.clear();
  const zoomedIn = +cam.position.distanceTo(target).toFixed(2);
  camera.wheel(100);
  for (let i = 0; i < 60; i++) camera.update(1 / 60, 5);
  const zoomedOut = +cam.position.distanceTo(target).toFixed(2);
  camera.keys.add('KeyD');
  const yaw0 = camera.yaw;
  for (let i = 0; i < 30; i++) camera.update(1 / 60, 5);
  camera.keys.clear();
  const orbited = +(camera.yaw - yaw0).toFixed(3);
  camera.setMode('pov');
  camera.update(1 / 60, 5);
  const look = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const pov = { eye: cam.position.toArray().map(v => +v.toFixed(2)), look: look.toArray().map(v => +v.toFixed(2)),
                fov: cam.fov, near: cam.near, hides: camera.hidePid };
  camera.setMode('free');
  const from = cam.position.clone();
  camera.keys.add('KeyW');
  for (let i = 0; i < 60; i++) camera.update(1 / 60, 5);
  camera.keys.clear();
  const moved = cam.position.clone().sub(from);
  const free = { moved: +moved.length().toFixed(1), along: +moved.normalize().dot(look).toFixed(3), fov: cam.fov };
  // The thumbstick (a touch screen, replay-ui.js): a second of each push.
  const flown = stick => {
    camera.stick = stick;
    const at = cam.position.clone();
    for (let i = 0; i < 60; i++) camera.update(1 / 60, 5);
    camera.stick = null;
    const d = cam.position.clone().sub(at);
    return { moved: +d.length().toFixed(1), d };
  };
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
  const full = flown({ x: 0, y: 1 });
  const half = flown({ x: 0, y: 0.5 });
  const side = flown({ x: 1, y: 0 });
  const stick = { full: full.moved, along: +full.d.normalize().dot(look).toFixed(3), half: half.moved,
                  side: side.moved, sideAlong: +side.d.normalize().dot(right).toFixed(3) };
  // Fingers apart by e: the free camera flies ahead, as six wheel steps would.
  const pinchedFrom = cam.position.clone();
  camera.pinch(Math.E);
  camera.update(1 / 60, 5);
  const pinched = cam.position.clone().sub(pinchedFrom);
  const pinchFree = { moved: +pinched.length().toFixed(1), along: +pinched.normalize().dot(look).toFixed(3) };
  // Dead at 25: first person has no eyes to look through, the orbit stands in
  // over the body.
  camera.setMode('pov');
  camera.update(1 / 60, 25);
  results.uxCamera = { orbit, zoomedIn, zoomedOut, orbited, pov, free, stick, pinchFree, deadPov: camera.hidePid };
}

// --- when he spawns ------------------------------------------------------------
//
// The 2026-09-27 request: a replay opens on the recording player, who can
// take a while to spawn, so his card counts down to it and the timeline
// marks it. A spawn is the moment a player takes control of a new soldier.
// The recording player spawns at 8.5 s by the Airfield's flag, dies at 20
// and is back at 32 on a carrier far from any flag. Another player's
// control moves to a soldier at 10 that comes into range only at 15. A third
// was already standing when the recording began, and a fourth was in a
// soldier when the recording first listed him, seen only at 12: no spawn
// the recording saw, either of them. While the recording player waits, the
// orbit is over where he will appear, framed as it will frame him there:
// his spectator camera sits at the world's origin until the game places it
// at 4 s (Midway's first wait), and his body lies from 20 until 26.
{
  const [chapters, { markStyle }] = await Promise.all([imp('replay-chapters.js'), imp('replay-timeline.js')]);
  const line = o => JSON.stringify(o);
  const soldier = (t, id, team, [x, z]) => [
    line({ k: 'o', t, id, gid: id, tmpl: team === 1 ? 'JapSoldier' : 'USMarineSoldier', tid: 100 + team, team }),
    line({ k: 's', t, o: [[id, x, 1, z, 0, 0, 0, 1]] }),
  ];
  const rec = recording.parseRecording([
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'roster', t: 0, p: [[0, 2, 0, 'rec', 1], [1, 1, 1, 'far', 0], [2, 1, 1, 'here', 0], [3, 1, 1, 'late', 0]] }),
    line({ k: 'o', t: 0, id: 18, gid: 18, tmpl: 'MultiPlayerFreeCamera', tid: 102, team: 0 }),
    line({ k: 's', t: 0, o: [[18, 0, 0, 0, 0, 0, 0, 1]] }),
    line({ k: 's', t: 4, o: [[18, 100, 60, 100, 0, 0, 0, 1]] }),
    ...soldier(0, 300, 1, [500, 500]),
    line({ k: 'cp', t: 0, id: 900, name: 'Airfield', tmpl: 'The_Airfield', pos: [100, 0, 100], team: 2 }),
    line({ k: 'p', t: 0, p: [[0, 2, 18, 18, 0, 0], [1, 1, 40, 40, 0, 0], [2, 1, 300, 300, 0, 0], [3, 1, 800, 800, 0, 0]] }),
    ...soldier(8.5, 600, 2, [120, 90]),
    line({ k: 'p', t: 8.5, p: [[0, 2, 600, 600, 0, 0]] }),
    line({ k: 'p', t: 10, p: [[1, 1, 700, 700, 0, 0]] }),
    ...soldier(12, 800, 1, [600, 600]),
    ...soldier(15, 700, 1, [400, 300]),
    line({ k: 'e', t: 20, e: 'score', kind: 4, pid: 0 }),
    line({ k: 'p', t: 20.2, p: [[0, 2, 18, 18, 0, 0]] }),
    line({ k: 'e', t: 26, e: 'destroyObject', netId: 600 }),
    ...soldier(32, 610, 2, [1500, 1500]),
    line({ k: 'p', t: 32, p: [[0, 2, 610, 610, 0, 0]] }),
    line({ k: 'end', t: 60 }),
  ].join('\n'));
  const times = pid => chapters.spawnsOf(rec, pid).map(s => s.t);
  const list = chapters.buildChapters(rec);
  const spawns = list.filter(ch => ch.kind === 'spawn');
  results.spawns = {
    rec: times(0),
    far: times(1),
    here: times(2),
    late: times(3),
    next: [0, 9, 25, 33].map(t => chapters.nextSpawn(rec, 0, t)?.t ?? null),
    // Before his spawn at 10, and after it while his soldier is out of range.
    farNext: [5, 12, 16].map(t => chapters.nextSpawn(rec, 1, t)?.t ?? null),
    status: [5, 25].map(t => chapters.playerStatusAt(rec, 0, t).state),
    chapters: spawns.map(ch => [ch.t, ch.lead, ch.pid, ch.at]),
    texts: spawns.map(ch => chapters.chapterText(rec, ch, { strings: null, names: {} })),
    mine: [chapters.involves(spawns[0], 0), chapters.involves(spawns[0], 1)],
    marks: [markStyle(spawns[0], 0), markStyle(spawns[0], 1)],
    nextOwn: chapters.nextChapter(list, 0, 0)?.kind ?? null,
  };

  const { ReplayCamera } = await imp('replay-camera.js');
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.5, 8000);
  const watcher = { rec, followPid: 0, time: 2, hulls: new Map(), ctx: { camera: cam, groundHeight: () => 0, waterLevel: () => -100 } };
  const camera = new ReplayCamera(watcher);
  watcher.camera = camera;
  const r2 = v => v.toArray().map(x => +x.toFixed(2) + 0);
  const aim = t => {
    const g = camera.targetAt(t);
    return g && { kind: g.kind, nid: g.life.nid, point: r2(g.point) };
  };
  camera.setMode('pov');
  camera.update(1 / 60, 2);
  const early = { hides: camera.hidePid, fromSpawn: +cam.position.distanceTo(camera.targetAt(2).point).toFixed(1) };
  camera.update(1 / 60, 5);
  results.spawns.camera = {
    waiting: aim(5), body: aim(24), gone: aim(28), spawned: aim(9),
    povUnplaced: early, povPlaced: r2(cam.position),
  };
}

// --- the camera looks where a soldier looks ---------------------------------
//
// The 2026-09-27 report: first person on foot looked out of the back of his
// head. A soldier's recorded rotation is a hull's, BF1942's +Z forward (95% of
// Midway's running samples move along it); the pose glb's half turn is the
// body model's, and the camera had it too. He runs along BF1942's +X facing
// it, a quarter turn about +Y: first person looks along his run, and the
// orbit starts behind him, as R ("Behind") puts it back.
{
  const { ReplayCamera } = await imp('replay-camera.js');
  const line = o => JSON.stringify(o);
  const q = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
  const rec = recording.parseRecording([
    line({ k: 'h', v: 3, start: '', hz: 10 }),
    line({ k: 'e', t: 0.5, e: 'createPlayer', pid: 0, name: 'rec', team: 2, ai: 0 }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 100, netId: 600, tmpl: 'USMarineSoldier', pos: [0, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'control', pid: 0, netId: 600 }),
    line({ k: 'o', t: 1, id: 600, gid: 1, tmpl: 'USMarineSoldier', tid: 100, team: 2, maxhp: 30 }),
    ...Array.from({ length: 41 }, (_, i) => line({ k: 's', t: +(1 + i * 0.1).toFixed(1), o: [[600, +(i * 0.5).toFixed(2), 1, 0, ...q]] })),
    line({ k: 'end', t: 10 }),
  ].join('\n'));
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.5, 8000);
  const watcher = { rec, followPid: 0, time: 3, hulls: new Map(), ctx: { camera: cam, groundHeight: () => 0, waterLevel: () => -100 } };
  const camera = new ReplayCamera(watcher);
  watcher.camera = camera;
  // Where the camera stands from him, on the ground, as a unit [x, z].
  const from = () => {
    const d = cam.position.clone().sub(new THREE.Vector3(10, 0, 0));
    const n = Math.hypot(d.x, d.z);
    return [+(d.x / n).toFixed(2) + 0, +(d.z / n).toFixed(2) + 0];
  };
  for (let i = 0; i < 30; i++) camera.update(1 / 60, 3);
  const orbit = from();
  camera.setMode('pov');
  camera.update(1 / 60, 3);
  const pov = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).toArray().map(v => +v.toFixed(2) + 0);
  camera.setMode('orbit');
  camera.yaw += 2;
  camera.resetOrbit();
  for (let i = 0; i < 120; i++) camera.update(1 / 60, 3);
  results.soldierView = { orbit, pov, reset: from() };
}

// --- the camera a replayed body is culled against ----------------------------
//
// The 2026-09-27 report: "the model of the player you're viewing can go
// invisible depending on the angle you watch them on. If you pan around them
// they appear again." A replayed soldier is drawn by the bots' own renderer,
// which culls each body against the camera as it stands when it draws him
// (bot-visuals.js `updateBotVisuals`). The replay placed its camera after its
// bodies, and the page's free camera had re-aimed it down -Z first, so from
// half of the orbit the man at its centre was culled. The page is stood in
// for by that same re-aim, every frame before the replay runs, and the orbit
// goes once round him; the renderer and its cull are the page's own, with his
// rig stood in for.
{
  const [{ ReplayPlayer }, { ReplaySoldiers }, { ReplayCamera }, { createBotVisuals }, { bag }, { createLocalPlayer }] = await Promise.all([
    imp('replay.js'), imp('replay-bodies.js'), imp('replay-camera.js'), imp('bot-visuals.js'),
    imp('page-bag.js'), imp('local-player.js'),
  ]);
  const line = o => JSON.stringify(o);
  const rec = recording.parseRecording([
    line({ k: 'h', v: 4, start: '', hz: 10 }),
    line({ k: 'e', t: 0.5, e: 'createPlayer', pid: 0, name: 'rec', team: 2, ai: 0 }),
    line({ k: 'e', t: 3, e: 'createObject', tid: 100, netId: 600, tmpl: 'USMarineSoldier', pos: [10, 0, 20], rot: [0, 0, 0] }),
    line({ k: 'e', t: 3, e: 'control', pid: 0, netId: 600 }),
    line({ k: 'o', t: 3.1, id: 600, gid: 1, tmpl: 'USMarineSoldier', tid: 100, team: 2, maxhp: 30 }),
    line({ k: 's', t: 3.1, o: [[600, 10, 1, 20, 0, 0, 0, 1]] }),
    line({ k: 's', t: 5.1, o: [[600, 10, 1, 20, 0, 0, 0, 1]] }),
    line({ k: 'end', t: 90 }),
  ].join('\n'));
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.5, 8000);
  const pending = () => new Promise(() => {});
  const ctx = {
    scene: new THREE.Scene(), camera: cam, bust: () => '', modelsBase: 'models',
    groundHeight: () => 0, waterLevel: () => -100, loadouts: () => null,
    makeReplayBodies: shim => createBotVisuals(bag({
      footBodyLoader: { loadAsync: pending }, footBodyClips: pending, footStateMachine: () => null,
      disposeFootBodyScene: () => {}, soldierDress: null, bindDynamicShading: () => {},
    }, shim)),
  };
  const player = Object.assign(Object.create(ReplayPlayer.prototype), {
    ctx, rec, time: 5, speed: 1, playing: false, lastFiredTime: 5, followPid: 0, recordingPid: 0,
    hulls: new Map(), entities: [], markers: [], showServer: false,
    props: { update() {} }, feed: { update() {} },
    ui: { timeline: { takeScrub: () => null, plan() {} }, scrubbing: false, logOpen: false, update() {} },
  });
  player.soldiers = new ReplaySoldiers(player);
  player.camera = new ReplayCamera(player);
  const ear = new THREE.Vector3();
  const frame = () => {
    // map.html before the replay: the free camera's look, then the ear read
    // back off the camera, which leaves its matrices on that look.
    cam.lookAt(cam.position.x, cam.position.y, cam.position.z - 1);
    cam.getWorldPosition(ear);
    player.update(1 / 60);
  };
  frame();
  const vis = player.soldiers.bodies.botVisuals.get('replay:0');
  if (vis) vis.rig = { kind: 'still', scene: new THREE.Group(), families: { idle: true }, anim: null, weaponNode: null, step() {} };
  const culled = [];
  for (let i = 0; i < 16; i++) {
    player.camera.yaw = i * Math.PI / 8;
    for (let n = 0; n < 40; n++) frame();
    if (!vis?.rig?.scene.visible) culled.push(i);
  }

  // The page's side: while a replay has the camera, the free camera leaves
  // it alone; without one it flies and looks as it always did.
  const calls = [];
  const page = {
    replayCamera: true, camera: cam, optPilot: { checked: false },
    flyFreeCamera: () => calls.push('fly'), applyLook: () => calls.push('look'),
    followSeat: () => {}, syncFootBody: () => {},
  };
  const local = createLocalPlayer(page);
  local.frameCameras(1 / 60, false, false);
  const underReplay = calls.splice(0);
  page.replayCamera = false;
  local.frameCameras(1 / 60, false, false);
  results.replayCull = { drawn: Boolean(vis), culled, underReplay, withoutReplay: calls.splice(0) };
}

// --- a soldier stands on his feet --------------------------------------------
//
// The report (2026-09-27, replay_20260927-075756): the recording player ran a
// metre above the ground. Every bot did too. A soldier's sample is where the
// engine holds him, his origin, which the template's `setCharacterHeight -1.00`
// puts a metre over the ground he stands on; the renderer, the fallback and
// the camera all stand a man on his feet. A bot and the recording player
// spawn on flat ground at y = 0 (the creation event is the spawn point) and
// run at 6 m/s, sampled a metre up as the recorder writes them; the recording
// player crouches at 5.8 s. A jeep beside them is sampled at its own origin.
{
  const [{ ReplaySoldiers }, { ReplayCamera }, { place }] = await Promise.all([
    imp('replay-bodies.js'), imp('replay-camera.js'), imp('replay-actors.js'),
  ]);
  const line = o => JSON.stringify(o);
  const lines = [
    line({ k: 'h', v: 4, start: '', hz: 10 }),
    line({ k: 'anim', t: 1, states: [[0, 'Lb_Stand', 0], [1, 'Lb_RunForward', 0], [2, 'Lb_CrouchWalkForward', 0x20], [3, 'Ub_Stand', 0]] }),
    line({ k: 'e', t: 1, e: 'createPlayer', pid: 250, name: 'Fred Bailey', team: 2, ai: 1, netId: 501, vehNetId: 502, camNetId: 502, kitNetId: 0 }),
    line({ k: 'e', t: 1, e: 'createPlayer', pid: 0, name: 'skandia', team: 2, ai: 0, netId: 1, vehNetId: 2, camNetId: 2, kitNetId: 0 }),
    line({ k: 'e', t: 2, e: 'createObject', tid: 1760, netId: 520, tmpl: 'Willy', pos: [120, 1.2, 60], rot: [0, 0, 0] }),
    line({ k: 'e', t: 5, e: 'createObject', tid: 1754, netId: 631, tmpl: 'USMarineSoldier', pos: [100, 0, 50], rot: [0, 0, 0] }),
    line({ k: 'e', t: 5, e: 'control', pid: 250, netId: 631 }),
    line({ k: 'e', t: 5, e: 'createObject', tid: 1754, netId: 980, tmpl: 'USMarineSoldier', pos: [110, 0, 50], rot: [0, 0, 0] }),
    line({ k: 'e', t: 5, e: 'control', pid: 0, netId: 980 }),
    line({ k: 'o', t: 5.1, id: 520, gid: 3, tmpl: 'Willy', tid: 1760, team: 2, maxhp: 50, crit: 6 }),
    line({ k: 'o', t: 5.1, id: 631, gid: 1, tmpl: 'USMarineSoldier', tid: 1754, team: 2, maxhp: 30, crit: 0 }),
    line({ k: 'o', t: 5.1, id: 980, gid: 2, tmpl: 'USMarineSoldier', tid: 1754, team: 2, maxhp: 30, crit: 0 }),
    line({ k: 'st', t: 5.1, o: [[631, 1, 3, 0, 0, 3, 0], [980, 1, 3, 0, 0, 3, 0]] }),
    line({ k: 'st', t: 5.8, o: [[980, 2, 3, 0, 0, 3, 0]] }),
  ];
  for (let i = 0; i <= 10; i++) {
    const t = +(5.1 + i * 0.1).toFixed(1);
    const x = 0.6 * i;
    const o = [[631, 100 + x, 1, 50, 0, 0, 0, 1], [980, 110 + x, 1, 50, 0, 0, 0, 1]];
    if (i === 0) o.unshift([520, 120, 1.2, 60, 0, 0, 0, 1]);
    lines.push(line({ k: 's', t, o }));
  }
  const rec = recording.parseRecording(lines.join('\n'));
  const lifeOf = nid => rec.lives.find(l => l.nid === nid);
  const bot = lifeOf(631);
  const mine = lifeOf(980);
  const jeep = lifeOf(520);
  const height = (life, t) => +kinematics.poseAt(life, t).p[1].toFixed(3);
  const times = [5.05, 5.1, 5.35, 5.55, 5.95];

  // The page's renderer is handed each actor's soldier: its feet.
  const drawn = t => {
    const player = { rec, playing: true, ctx: {} };
    const soldiers = new ReplaySoldiers(player);
    soldiers.update(t, 0.1, new Map());
    return Object.fromEntries(soldiers.drawn.map(a => [a.name, +a.state.soldier.y.toFixed(3)]));
  };

  // The plain soldier the page falls back to without its bodies.
  const fallback = t => {
    const player = { showGhosts: true, v1: new THREE.Vector3(), q1: new THREE.Quaternion() };
    const entity = { life: mine, group: new THREE.Group(), normal: new THREE.Group(), wreck: null, meshes: [], anim: null };
    place(player, entity, t);
    return +entity.group.position.y.toFixed(3);
  };

  // His first person and the orbit, over the ground at y = 0.
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.5, 8000);
  const watcher = { rec, followPid: 0, time: 5.5, hulls: new Map(), ctx: { camera: cam, groundHeight: () => 0, waterLevel: () => -100 } };
  const camera = new ReplayCamera(watcher);
  watcher.camera = camera;
  const eye = t => {
    camera.setMode('pov');
    camera.update(1 / 60, t);
    return +cam.position.y.toFixed(3);
  };

  results.feet = {
    spawn: { bot: +bot.pose.p[1].toFixed(3), mine: +mine.pose.p[1].toFixed(3) },
    bot: times.map(t => height(bot, t)),
    mine: times.map(t => height(mine, t)),
    jeep: height(jeep, 5.5),
    drawn: [5.35, 5.95].map(drawn),
    fallback: [5.35, 5.95].map(fallback),
    orbit: +camera.targetAt(5.5).point.y.toFixed(3),
    eye: { standing: eye(5.5), crouched: eye(5.95) },
  };
}

// --- the server log's rings, on the ground -----------------------------------
//
// The server's log places a player where the engine holds him, a metre over
// his feet, as the recording does; a spawn is on the ground and a hull is at
// its own origin. A player's ring lies on the surface under him when he stood
// within a man's height of it; a pilot's stays in the air with him.
{
  const [{ ReplayPlayer }, { serverRows }] = await Promise.all([imp('replay.js'), imp('replay-server-log.js')]);
  const log = { events: [
    { t: 10, name: 'scoreEvent', params: { player_id: 1, victim_id: 2, score_type: 'Kill', weapon: 'Thompson', player_location: [10, 1.02, 20] } },
    { t: 11, name: 'spawnEvent', params: { player_id: 2, player_location: [30, 0, 20] } },
    { t: 12, name: 'scoreEvent', params: { player_id: 3, score_type: 'Kill', player_location: [50, 150, 20] } },
    { t: 13, name: 'destroyVehicle', params: { player_id: 1, vehicle: 'Sherman', vehicle_pos: [70, 1.5, 20] } },
  ] };
  const rows = serverRows({ duration: 100, players: new Map() }, log, { offset: 0 });
  const player = Object.assign(Object.create(ReplayPlayer.prototype), {
    alignment: { offset: 0 }, rows, markers: [], root: new THREE.Group(),
    ctx: { groundHeight: (x, z, fromY) => (fromY >= 0 ? 0 : -Infinity) },
  });
  player.buildMarkers();
  results.serverRings = {
    atPlayer: rows.map(r => r.atPlayer),
    y: player.markers.map(m => +m.marker.position.y.toFixed(2)),
  };
}

// --- a manned gun laid where the recording says it pointed -------------------
//
// The report (2026-09-27, `replay_20260927-075756`, v4): "in the defgun I can
// see the rounds impacting at the correct location, but the defgun points to
// a random spot". The rounds fly the recorded ray; nothing turned the gun, so
// it sat at the rig's rest. A Defgun (the model's own nodes and rig, a yaw
// turret over a pitch gun base) turned by a v4 file's parts, by its rounds
// alone, and by a v5 file's parts, which win.
{
  const [{ ReplayHull }, aim, { GunFire }] = await Promise.all([
    imp('replay-hulls.js'), imp('replay-aim.js'), imp('gunfire.js'),
  ]);
  const line = o => JSON.stringify(o);
  const rad = d => d * Math.PI / 180;
  const qmul = (a, b) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  const round4 = q => q.map(v => +v.toFixed(4));
  // A part turned `yaw` degrees and raised `up` degrees, relative to its
  // hull, as the recorder writes it (BF1942's frame: yaw about +Y, then
  // pitch about X, +Z forward).
  const part = (yaw, up = 0) => round4(qmul([0, Math.sin(rad(yaw) / 2), 0, Math.cos(rad(yaw) / 2)],
                                            [Math.sin(rad(-up) / 2), 0, 0, Math.cos(rad(-up) / 2)]));
  const HULL_YAW = 30;
  const hullQ = [0, Math.sin(rad(HULL_YAW) / 2), 0, Math.cos(rad(HULL_YAW) / 2)];
  const turn = (q, v) => {
    const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), [-q[0], -q[1], -q[2], q[3]]);
    return [r[0], r[1], r[2]];
  };
  // A round leaving a gun laid at (yaw, up) on the hull: its world ray.
  const round = (t, yaw, up) => line({ k: 'f', t, id: 523, pid: 0, w: 'DefgunGunBarrel', p: [100, 17, 200],
                                       d: turn(hullQ, turn(part(yaw, up), [0, 0, 1])).map(v => +v.toFixed(5)) });
  const head = v => [
    line({ k: 'h', v, start: '', hz: 10 }),
    line({ k: 'e', t: 0.2, e: 'createObject', tid: 1200, netId: 522, tmpl: 'Defgun', pos: [0, 10, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 0.2, e: 'createObject', tid: 1200, netId: 523, tmpl: 'Defgun', pos: [100, 10, 200], rot: [HULL_YAW, 0, 0] }),
    line({ k: 'o', t: 0.5, id: 523, tmpl: 'Defgun', tid: 1200, team: 2 }),
  ];
  // The v4 recorder's own writing of it (keyed 0, a part left out when it
  // equals the entry before it): the Defgun at 522 at rest ahead of 523 in
  // the walk; 523's turret back at rest at 1.1 left out (it equals 522's),
  // its gun base level at 1.3 left out (it equals the turret).
  const I = [0, 0, 0, 1];
  const j = (t, ...entries) => line({ k: 'j', t, o: entries.map(([root, q]) => [root, 0, ...q]) });
  const v4 = [
    ...head(4),
    line({ k: 'jn', t: 1.0, o: [[522, 0, 'DefgunTurret']] }),
    j(1.0, [522, I], [523, part(10)], [523, part(10, 10)]),
    j(1.1, [522, I], [523, part(0, 10)]),
    round(1.1, 0, 10),
    j(1.2, [522, I], [523, part(25)], [523, part(25, 5)]),
    j(1.3, [522, I], [523, part(40)]),
    j(1.4, [522, I], [523, part(60)], [523, part(60, 5)]),
    round(1.4, 60, 5),
    j(3.0, [522, I], [523, part(60)], [523, part(60, 5)]),
    line({ k: 'end', t: 10 }),
  ].join('\n');
  // The same rounds and nothing else, plus one laid above the gun's
  // elevation limit (30 degrees up).
  const roundsOnly = [...head(4), round(1.1, 0, 10), round(1.4, 60, 5), round(4, -20, 50), line({ k: 'end', t: 10 })].join('\n');
  // A v5 file: the parts, numbered and placed, turn the gun one way; a
  // round says another. The parts are the truth.
  const v5 = [
    ...head(5),
    line({ k: 'jn', t: 1.0, o: [[523, 1, 'DefgunTurret', 0, 5.13, -0.4], [523, 2, 'DefgunGunBase', 0, 6.83, 0.7]] }),
    line({ k: 'j', t: 1.0, o: [[523, 1, ...part(-45)], [523, 2, ...part(-45, 20)]] }),
    round(1.05, 60, 5),
    line({ k: 'end', t: 10 }),
  ].join('\n');

  // The Defgun as models/Defgun.glb has it: the turret's traverse and the gun
  // base's elevation with their own limits, the barrel and its muzzle.
  const defgun = () => {
    const node = (name, data, at = [0, 0, 0]) => {
      const n = new THREE.Object3D();
      n.name = name;
      n.userData = { control: 'Defgun', ...data };
      n.position.fromArray(at);
      return n;
    };
    const rig = axes => ({ axes, automaticReset: false, control: 'Defgun' });
    const root = node('Defgun', { templateKind: 'PlayerControlObject' });
    const turret = node('DefgunTurret', { templateKind: 'RotationalBundle', rig: rig({ yaw: {
      input: 'c_PIMouseLookX', min: -90, max: 90, free: false, driver: 'position', maxSpeed: 90, direction: 1, acceleration: 50,
    } }) }, [0, 5.13, 0.4]);
    const base = node('DefgunGunBase', { templateKind: 'RotationalBundle', rig: rig({ pitch: {
      input: 'c_PIMouseLookY', min: -30, max: 10, free: false, driver: 'position', maxSpeed: 50, direction: 1, acceleration: 75,
    } }) }, [0, 1.7, -1.1]);
    const barrel = node('DefgunGunBarrel', { templateKind: 'FireArms', fireArms: {
      input: 'c_PIFire', roundOfFire: 0.2, velocity: 125, muzzles: 1, projectile: { kind: 'shell' },
    } });
    const muzzle = node('DefgunGunBarrel_muzzle_1', { templateKind: 'Muzzle', muzzle: { index: 0 } }, [0, 0, -9.7]);
    const camera = node('DefgunCamera', { templateKind: 'Camera' }, [-1, 0.6, -0.2]);
    barrel.add(muzzle);
    base.add(barrel, camera);
    turret.add(base);
    root.add(turret);
    const scene = new THREE.Group();
    scene.add(root);
    return { scene, muzzle };
  };
  const _q = new THREE.Quaternion();
  const deg = r => +(r * 180 / Math.PI).toFixed(2);
  // The drawn barrel's angle to a gun laid at (yaw, up) on the hull, degrees.
  const replay = text => {
    const rec = recording.parseRecording(text);
    const { scene, muzzle } = defgun();
    const guns = new GunFire({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), viewportHeight: () => 800 });
    const player = { rec, showGhosts: true, ctx: { guns } };
    const hull = new ReplayHull(player, rec.lives.find(l => l.nid === 523), scene, null);
    hull.ownerTag = -1523;
    const off = (t, yaw, up) => {
      hull.update(t, 0);
      const drawn = new THREE.Vector3(0, 0, -1).applyQuaternion(muzzle.getWorldQuaternion(_q));
      const [x, y, z] = turn(hullQ, turn(part(yaw, up), [0, 0, 1]));
      return deg(drawn.angleTo(new THREE.Vector3(x, y, -z)));
    };
    const angles = t => {
      hull.update(t, 0);
      const rig = hull.occupancy.rigFor('Defgun');
      return rig.axes.map(axis => +axis.angle.toFixed(2));
    };
    return { rec, hull, off, angles };
  };

  const decoded = (() => {
    const rec = recording.parseRecording(v4);
    const runs = rec.keyedParts?.get(523) ?? [];
    const tracks = aim.decodeKeyedParts(runs);
    return {
      joints: rec.joints.size,
      runs: runs.map(r => [r.t, r.parts.length, r.before]),
      tracks: tracks.map(track => track.map(({ t, q }) => [t, q])),
    };
  })();
  // A v5 traverse between two samples a tenth of a second apart: eased
  // across it by the recording's own law (`sampleAt`), not held and stepped.
  const v5Swing = [
    ...head(5),
    line({ k: 'jn', t: 1.0, o: [[523, 1, 'DefgunTurret', 0, 5.13, -0.4], [523, 2, 'DefgunGunBase', 0, 6.83, 0.7]] }),
    line({ k: 'j', t: 1.0, o: [[523, 1, ...part(-40)], [523, 2, ...part(-40, 10)]] }),
    line({ k: 'j', t: 1.1, o: [[523, 1, ...part(40)], [523, 2, ...part(40, 10)]] }),
    line({ k: 'end', t: 10 }),
  ].join('\n');
  const partsRun = replay(v4);
  const roundsRun = replay(roundsOnly);
  const v5Run = replay(v5);
  const swingRun = replay(v5Swing);
  const sources = run => {
    run.hull.update(0.5, 0);
    return run.hull.aims?.map(a => (a.dense ? 'parts' : 'rounds')) ?? null;
  };
  results.gunAim = {
    decoded,
    expected: {
      turret: [[1.0, part(10)], [1.1, I], [1.2, part(25)], [1.3, part(40)], [1.4, part(60)], [3.0, part(60)]],
      base: [[1.0, part(10, 10)], [1.1, part(0, 10)], [1.2, part(25, 5)], [1.3, part(40)], [1.4, part(60, 5)],
             [3.0, part(60, 5)]],
    },
    parts: {
      source: sources(partsRun),
      atRounds: [partsRun.off(1.1, 0, 10), partsRun.off(1.4, 60, 5)],
      // Between the rounds, the recorded parts: raised at 1.0, level at 1.3.
      between: [partsRun.off(1.0, 10, 10), partsRun.off(1.3, 40, 0)],
      beforeParts: partsRun.off(0.7, 0, 0),
      held: partsRun.off(8, 60, 5),
    },
    rounds: {
      source: sources(roundsRun),
      atRounds: [roundsRun.off(1.1, 0, 10), roundsRun.off(1.4, 60, 5)],
      // Traverse and elevation (the rig's own degrees, up is negative): at
      // rest long before the first round, raised into it at the gun base's
      // own 50 deg/s, held, turned as late as the next round allows (faster
      // than the turret's own 90 deg/s where the recorded rounds say so),
      // and never past the elevation limit.
      rest: roundsRun.angles(0.6),
      laying: roundsRun.angles(1.0),
      turning: roundsRun.angles(1.3),
      held: roundsRun.angles(2.0),
      overLimit: roundsRun.angles(4),
      after: roundsRun.angles(9),
    },
    v5: {
      toParts: v5Run.off(1.05, -45, 20),
      toRound: v5Run.off(1.05, 60, 5),
      swing: [swingRun.off(1.0, -40, 10), swingRun.off(1.05, 0, 10), swingRun.off(1.1, 40, 10)],
    },
    lateTurn: [
      aim.lateTurn(0, 40, 0, 1, 90),
      aim.lateTurn(0, 40, 0.8, 1, 90),
      aim.lateTurn(0, 40, 0.95, 1, 90, { start: 0.9 }),
      aim.lateTurn(170, -170, 0.9, 1, 90, { free: true }),
    ].map(v => +v.toFixed(2)),
  };
}

// --- a respawn in another kit, a wrench's fire, a reload and a death ----------
//
// The 2026-09-27 report on replay_20260927-140921 (Kursk): a medic killed with
// his Mp18 was drawn with a bazooka, the AT kit he had died in, until a seek
// put the Mp18 back in his hands; and an engineer's wrench never turned while
// he repaired. Playback runs forward from the first frame, never seeking: an
// AT soldier dies at 10 s by a head shot (his body's recorded die state), his
// body goes at 12 s and he is back as a medic at 15 s. An engineer holds his
// wrench (item 6) and repairs from 3.0 to 5.1 s, which the recording has only
// as his torso state: a wrench fires no round. A German medic changes his
// Mp40's magazine from 6.0 to 8.2 s, which is also only a torso state.
{
  const [{ ReplaySoldiers }, { createBotVisuals }, { bag }, { SoldierActions }] = await Promise.all([
    imp('replay-bodies.js'), imp('bot-visuals.js'), imp('page-bag.js'), imp('soldier-actions.js'),
  ]);
  const line = o => JSON.stringify(o);
  const lines = [
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'anim', t: 1, states: [[0, 'Lb_Stand', 0], [1, 'Ub_StandAim', 0], [2, 'Ub_FireRepairPack', 0],
                                     [3, 'Ub_StandAimRepairPack', 0], [4, 'Ub_StandAimMp40', 0],
                                     [5, 'Ub_StandReloadMp40', 0], [6, 'Lb_DieHead', 0], [7, 'Ub_DieHead', 0]] }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1742, netId: 600, tmpl: 'RussianSoldier', pos: [0, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1498, netId: 604, tmpl: 'Rus_AT', pos: [0, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1742, netId: 800, tmpl: 'RussianSoldier', pos: [20, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1510, netId: 804, tmpl: 'Rus_Engineer', pos: [20, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1740, netId: 810, tmpl: 'GermanSoldier', pos: [40, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1511, netId: 814, tmpl: 'German_Medic', pos: [40, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'createPlayer', pid: 24, name: 'medic', team: 2, ai: 0, netId: 49, vehNetId: 600, camNetId: 50, kitNetId: 604 }),
    line({ k: 'e', t: 1, e: 'createPlayer', pid: 30, name: 'engineer', team: 2, ai: 0, netId: 51, vehNetId: 800, camNetId: 52, kitNetId: 804 }),
    line({ k: 'e', t: 1, e: 'createPlayer', pid: 31, name: 'sanitater', team: 1, ai: 0, netId: 53, vehNetId: 810, camNetId: 54, kitNetId: 814 }),
    line({ k: 'e', t: 1.05, e: 'dbComplete' }),
    line({ k: 'o', t: 1.1, id: 600, gid: 1, tmpl: 'RussianSoldier', tid: 1742, team: 2, maxhp: 30 }),
    line({ k: 'o', t: 1.1, id: 800, gid: 2, tmpl: 'RussianSoldier', tid: 1742, team: 2, maxhp: 30 }),
    line({ k: 'o', t: 1.1, id: 810, gid: 4, tmpl: 'GermanSoldier', tid: 1740, team: 1, maxhp: 30 }),
    line({ k: 's', t: 1.1, o: [[600, 0, 1, 0, 0, 0, 0, 1], [800, 20, 1, 0, 0, 0, 0, 1], [810, 40, 1, 0, 0, 0, 0, 1]] }),
    line({ k: 'st', t: 1.1, o: [[600, 0, 1, 0, 0, 3, 0], [800, 0, 3, 0, 0, 6, 0], [810, 0, 4, 0, 0, 3, 0]] }),
    line({ k: 'st', t: 3.0, o: [[800, 0, 2, 0, 0, 6, 0]] }),
    line({ k: 'st', t: 5.1, o: [[800, 0, 3, 0, 0, 6, 0]] }),
    line({ k: 'st', t: 6.0, o: [[810, 0, 5, 0, 0, 3, 0]] }),
    line({ k: 'st', t: 8.2, o: [[810, 0, 4, 0, 0, 3, 0]] }),
    line({ k: 'e', t: 10, e: 'score', kind: 3, pid: 30, victim: 24, weapon: 1, bodypart: 1 }),
    line({ k: 'e', t: 10, e: 'control', pid: 24, netId: 50 }),
    line({ k: 'st', t: 10.07, o: [[600, 6, 7, 0, 0, 3, 0]] }),
    line({ k: 'e', t: 12, e: 'destroyObject', netId: 600 }),
    line({ k: 'e', t: 15, e: 'createObject', tid: 1742, netId: 700, tmpl: 'RussianSoldier', pos: [5, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 15, e: 'control', pid: 24, netId: 700 }),
    line({ k: 'e', t: 15, e: 'createObject', tid: 1508, netId: 704, tmpl: 'Rus_Medic', pos: [5, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 15, e: 'pickupKit', pid: 24, netId: 704 }),
    line({ k: 'o', t: 15.1, id: 700, gid: 3, tmpl: 'RussianSoldier', tid: 1742, team: 2, maxhp: 30 }),
    line({ k: 's', t: 15.1, o: [[700, 5, 1, 0, 0, 0, 0, 1]] }),
    line({ k: 'st', t: 15.1, o: [[700, 0, 1, 0, 0, 3, 0]] }),
    // His Mp18's round: the recording writes that weapon's rounds.
    line({ k: 'f', t: 16, id: 700, pid: 24, w: 'Mp18', p: [5, 1, 0], d: [0, 0, 1] }),
    line({ k: 'end', t: 20 }),
  ];
  const rec = recording.parseRecording(lines.join('\n'));
  const loadouts = { kits: {
    Rus_AT: { primary: 'Bazooka', weapons: [{ slot: 3, weapon: 'Bazooka' }] },
    Rus_Medic: { primary: 'Mp18', weapons: [{ slot: 3, weapon: 'Mp18' }] },
    Rus_Engineer: { primary: 'No4', weapons: [{ slot: 3, weapon: 'No4' }, { slot: 6, weapon: 'RepairPack' }] },
    German_Medic: { primary: 'Mp40', weapons: [{ slot: 3, weapon: 'Mp40' }] },
  } };
  const pending = () => new Promise(() => {});
  const ctx = {
    scene: new THREE.Scene(), bust: () => '', modelsBase: 'models', loadouts: () => loadouts,
    makeReplayBodies: shim => createBotVisuals(bag({
      footBodyLoader: { loadAsync: pending }, footBodyClips: pending, footStateMachine: () => null,
      disposeFootBodyScene: () => {}, soldierDress: null, bindDynamicShading: () => {},
    }, shim)),
  };
  const soldiers = new ReplaySoldiers({ rec, ctx, playing: true });
  const visuals = soldiers.bodies.botVisuals;
  const kills = [];
  const killBot = soldiers.bodies.killBot;
  soldiers.bodies.killBot = (bot, opts) => {
    const family = killBot(bot, opts);
    kills.push({ pid: bot.pid, family });
    return family;
  };
  // A body: the engine's own two-half machine over a rig with the two
  // one-shots in question -- the wrench's fire (`Ub_FireRepairPack`, 13
  // frames at speed 1: a second) and a magazine change (two seconds) -- each
  // handing back to the pose.
  let now = 0;
  const entered = { 30: [], 31: [] };
  const CLIPS = { Ub_Fire: 1, Ub_StandReload: 2 };
  const rigFor = pid => {
    const anim = new SoldierActions({
      has: name => name in CLIPS,
      info: name => (name in CLIPS ? { loop: false, then: '_POSE_', morph: 10000 } : null),
      duration: name => CLIPS[name] ?? 0,
    });
    return {
      kind: 'halves', scene: new THREE.Group(), families: { stand: true, walk: true, run: true },
      anim, weaponNode: null,
      step: (input, dt) => {
        for (const e of anim.update(input, dt)) {
          if (e.half === 'upper' && e.name in CLIPS) entered[pid].push([e.name, +now.toFixed(2)]);
        }
      },
    };
  };
  const kit = {};
  for (let i = 0; i <= 380; i++) {
    now = +(1 + i * 0.05).toFixed(2);
    for (const [pid, weapon] of [[30, 'RepairPack'], [31, 'Mp40']]) {
      const vis = visuals.get(`replay:${pid}`);
      if (vis && !vis.rig && vis.bot?.weaponAi?.name === weapon) {
        vis.rig = rigFor(pid);
        vis.weapon = weapon;
      }
    }
    soldiers.update(now, 0.05, new Map());
    if (now === 5 || now === 16) {
      kit[now] = { body: visuals.get('replay:24')?.kit ?? null, primary: soldiers.actors.get(24)?.kitPrimary ?? null };
    }
  }
  results.respawnKit = {
    kit,
    engineer: soldiers.actors.get(30)?.weaponAi?.name ?? null,
    fires: entered[30].filter(([name]) => name === 'Ub_Fire').map(([, t]) => t),
    reloads: entered[31].filter(([name]) => name === 'Ub_StandReload').map(([, t]) => t),
    kills,
    recordedDeath: recording.recordedDeath?.(rec, 600, 10) ?? null,
    recordsRounds: { Mp18: soldiers.recordsRounds?.('Mp18') ?? null, RepairPack: soldiers.recordsRounds?.('RepairPack') ?? null },
  };
}

// --- a bomb rack's barrels, and the hull's own velocity under its rounds ------
//
// The same report: a replayed Stuka dropped one bomb, and it fell nose-down
// from a standstill where the game's inclined with the plane. The rack has two
// barrels, one under each wing (+-3.3 m, the shipped Stuka.glb's), and a bomb
// leaves at the rack's `velocity 0` plus the aircraft's own. The Stuka flies
// level at 60 m/s along BF1942's +Z, 100 m up, and releases at 5 s.
{
  const [{ ReplayHull }, { GunFire }] = await Promise.all([imp('replay-hulls.js'), imp('gunfire.js')]);
  const line = o => JSON.stringify(o);
  const lines = [
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 2641, netId: 900, tmpl: 'Stuka', pos: [0, 100, 0], rot: [0, 0, 0] }),
    line({ k: 'o', t: 1, id: 900, gid: 1, tmpl: 'Stuka', tid: 2641, team: 1, maxhp: 130, crit: 20 }),
  ];
  for (let i = 0; i <= 90; i++) {
    const t = +(1 + i * 0.1).toFixed(1);
    lines.push(line({ k: 's', t, o: [[900, 0, 100, +(60 * (t - 1)).toFixed(2), 0, 0, 0, 1]] }));
  }
  lines.push(line({ k: 'f', t: 5, id: 900, pid: 26, w: 'StukaBombRack', p: [0, 100, 240], d: [0, 0, 1] }));
  const rec = recording.parseRecording(lines.join('\n'));
  const life = rec.lives.find(l => l.nid === 900);

  const root = new THREE.Group();
  root.name = 'Stuka';
  root.userData = { templateKind: 'PlayerControlObject' };
  const rack = new THREE.Group();
  rack.name = 'StukaBombRack';
  rack.userData.fireArms = {
    projectile: { template: 'DiveBomberBomb', kind: 'shell', trail: null, timeToLive: 20, mass: 250, drag: 0.08,
                  damage: { radius: 20, hasCollisionEffect: true } },
    roundOfFire: 0.2, magSize: 30, numOfMag: 1, velocity: 0, input: 'c_PIAltFire', muzzles: 2,
  };
  for (const [i, x] of [3.3, -3.3].entries()) {
    const muzzle = new THREE.Object3D();
    muzzle.name = `StukaBombRack muzzle ${i + 1}`;
    muzzle.userData.muzzle = { index: i };
    muzzle.position.set(x, -0.199, 0);
    rack.add(muzzle);
  }
  const bomb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 2), new THREE.MeshBasicMaterial());
  bomb.name = 'StukaBombRack projectile';
  bomb.userData.projectileMesh = { template: 'DiveBomberBomb', geometry: 'Big_Bomb_M1' };
  rack.add(bomb);
  root.add(rack);
  const model = new THREE.Group();
  model.add(root);

  const scene = new THREE.Scene();
  const guns = new GunFire({ scene, viewportHeight: () => 800 });
  const hull = new ReplayHull({ ctx: { guns, scene }, rec, showGhosts: true }, life, model, null);
  hull.update(4.95, 0.05);
  hull.update(5, 0.05);
  const shot = rec.fires[0];
  hull.fire(0, shot.kind, shot);
  const r2 = v => v.toArray().map(x => +x.toFixed(2) + 0);
  const nose = mesh => r2(new THREE.Vector3(0, 0, -1).applyQuaternion(mesh.quaternion));
  const dropped = guns.projectiles.map(p => ({ at: r2(p.mesh.position), v: r2(p.velocity), nose: nose(p.mesh) }));
  for (let i = 0; i < 20; i++) guns.advance(0.05);
  const afterOneSecond = guns.projectiles.map(p => nose(p.mesh));

  // A destroyer's three mounts share one FireArms name (the scene suffixes
  // the repeats). One recorded round is one mount's: the one nearest where
  // it left, not all three at once.
  const ship = new THREE.Group();
  ship.name = 'Hatsuzuki';
  ship.userData = { templateKind: 'PlayerControlObject' };
  for (const [i, z] of [-30, 0, 30].entries()) {
    const gun = new THREE.Group();
    gun.name = i ? `HatsuzukiGun_${i}` : 'HatsuzukiGun';
    gun.position.set(0, 5, z);
    gun.userData.fireArms = {
      projectile: { template: 'HatsuzukiShell', kind: 'shell', trail: null, timeToLive: 10, damage: { radius: 5 } },
      roundOfFire: 0.5, magSize: -1, velocity: 150, input: 'c_PIFire', muzzles: 1,
    };
    const muzzle = new THREE.Object3D();
    muzzle.name = `${gun.name} muzzle 1`;
    muzzle.userData.muzzle = { index: 0 };
    muzzle.position.set(0, 0, -4);
    gun.add(muzzle);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.6), new THREE.MeshBasicMaterial());
    shell.name = `${gun.name} projectile`;
    shell.userData.projectileMesh = { template: 'HatsuzukiShell' };
    gun.add(shell);
    ship.add(gun);
  }
  const shipModel = new THREE.Group();
  shipModel.add(ship);
  const shipRec = recording.parseRecording([
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1900, netId: 950, tmpl: 'Hatsuzuki', pos: [500, 0, 500], rot: [0, 0, 0] }),
    line({ k: 'o', t: 1, id: 950, gid: 2, tmpl: 'Hatsuzuki', tid: 1900, team: 1, maxhp: 1000, crit: 100 }),
    line({ k: 's', t: 1, o: [[950, 500, 0, 500, 0, 0, 0, 1]] }),
    // Left from the mount 30 m aft of the hull's origin: the viewer's +Z,
    // BF1942's -Z.
    line({ k: 'f', t: 3, id: 950, pid: 7, w: 'HatsuzukiGun', p: [500, 5, 470], d: [0, 0, 1] }),
  ].join('\n'));
  const shipGuns = new GunFire({ scene, viewportHeight: () => 800 });
  const destroyer = new ReplayHull({ ctx: { guns: shipGuns, scene }, rec: shipRec, showGhosts: true },
    shipRec.lives.find(l => l.nid === 950), shipModel, null);
  destroyer.update(3, 0.05);
  destroyer.fire(0, 1, shipRec.fires[0]);
  results.bombRack = {
    dropped,
    afterOneSecond,
    mounts: shipGuns.projectiles.map(p => r2(p.mesh.position)),
  };

  // The rounds keep the replay's clock. The page advances its guns and its
  // effects on its own clock, so in a paused replay the Stuka's bombs went on
  // falling and burst. The replay hands both its playback rate each frame:
  // nothing moves at 0, twice as far at 2.
  const [{ ReplayPlayer }] = await Promise.all([imp('replay.js')]);
  const height = () => +guns.projectiles[0].mesh.position.y.toFixed(3);
  const clock = [];
  guns.timeScale = 0;
  const held = height();
  for (let i = 0; i < 10; i++) guns.advance(0.05);
  clock.push(+(height() - held).toFixed(3));
  const effects = { timeScale: 1 };
  const player = Object.assign(Object.create(ReplayPlayer.prototype), {
    ctx: { guns, effects, scene: new THREE.Scene() }, rec: { duration: 100, fires: [] },
    time: 5, speed: 4, playing: true, lastFiredTime: 5, hulls: new Map(), entities: [], markers: [],
    soldiers: null, round: null, props: { update() {}, dispose() {} }, feed: { update() {}, dispose() {} },
    camera: { update() {}, dispose() {}, hidePid: null, mode: 'orbit' },
    ui: { timeline: { takeScrub: () => null, plan() {} }, scrubbing: false, logOpen: false, update() {}, dispose() {} },
  });
  player.update(1 / 60);
  clock.push([guns.timeScale, effects.timeScale]);
  player.playing = false;
  player.update(1 / 60);
  clock.push([guns.timeScale, effects.timeScale]);
  player.dispose();
  clock.push([guns.timeScale, effects.timeScale]);
  results.replayClock = clock;
}

// --- a replayed swimmer swims --------------------------------------------------
//
// A soldier in the water was drawn walking on the seabed: the replay's
// stand-in soldier had no swim state for the renderer. A v4 file records the
// state his body entered; a v3 file has none, and there the engine's own test
// on his origin decides (swim.js): a swimmer's is pinned 0.4 m under the
// surface, a wader's is a metre over the seabed. Water at y = 0. In the v3
// file a man swims forward (his heading is BF1942's +Z), one floats, one wades
// 1.2 m deep and one stands on the beach; in the v4 file one is recorded
// swimming backward, then dies in the water.
{
  const { ReplaySoldiers } = await imp('replay-bodies.js');
  const line = o => JSON.stringify(o);
  const man = (pid, nid) => [
    line({ k: 'e', t: 1, e: 'createPlayer', pid, name: `p${pid}`, team: 2, ai: 1 }),
    line({ k: 'e', t: 5, e: 'createObject', tid: 1754, netId: nid, tmpl: 'USMarineSoldier', pos: [0, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 5, e: 'control', pid, netId: nid }),
    line({ k: 'o', t: 5.1, id: nid, gid: pid, tmpl: 'USMarineSoldier', tid: 1754, team: 2, maxhp: 30, crit: 0 }),
  ];
  const samples = rows => {
    const out = [];
    for (let i = 0; i <= 10; i++) {
      const t = +(5.1 + i * 0.1).toFixed(1);
      out.push(line({ k: 's', t, o: rows.map(([nid, x, y, z, dz]) => [nid, x, y, z + dz * i * 0.1, 0, 0, 0, 1]) }));
    }
    return out;
  };
  const v3 = recording.parseRecording([
    line({ k: 'h', v: 3, start: '', hz: 10 }),
    ...man(1, 701), ...man(2, 702), ...man(3, 703), ...man(4, 704),
    ...samples([[701, 0, -0.45, 50, 1.5], [702, 10, -0.45, 50, 0], [703, 20, -0.2, 50, 1.5], [704, 30, 1, 50, 1.5]]),
  ].join('\n'));
  const v4 = recording.parseRecording([
    line({ k: 'h', v: 4, start: '', hz: 10 }),
    line({ k: 'anim', t: 1, states: [[0, 'Lb_Stand', 0], [1, 'Lb_SwimBackward', 0x0a], [2, 'Ub_SwimBackward', 0], [3, 'Ub_Stand', 0]] }),
    ...man(5, 705),
    line({ k: 'st', t: 5.1, o: [[705, 1, 2, 0, 0, 3, 0]] }),
    ...samples([[705, 0, -0.45, 80, -1]]),
  ].join('\n'));
  const at = (rec, t) => {
    const soldiers = new ReplaySoldiers({ rec, playing: true, ctx: { waterLevel: () => 0 } });
    soldiers.update(t, 0.1, new Map());
    const of = pid => soldiers.soldiers.get(`replay:${pid}`)?.soldier;
    return { of, soldiers };
  };
  const pair = s => s?.swimClips()?.lower ?? null;
  const v3At = at(v3, 5.55);
  const v4At = at(v4, 5.55);
  results.swim = {
    v3: [1, 2, 3, 4].map(pid => pair(v3At.of(pid))),
    swimming: [1, 2, 3, 4].map(pid => v3At.of(pid)?.swim?.swimming ?? null),
    v4: pair(v4At.of(5)),
    v4Death: v4At.of(5)?.swimClips(true)?.lower ?? null,
    dryDeath: v3At.of(4)?.swimClips(true) ?? null,
  };
}

// --- out of the recording's range ------------------------------------------
//
// The owner's question on replay_20260927-140921: the yellow shells. The
// server stops sending an object beyond the map's view distance from the
// recording player, and the replay draws a ghost at its last pose; the
// followed player's card now says so. A pilot's plane leaves range at 10 s
// and is back at 20; a soldier on foot leaves at 8 s and never returns.
{
  const [chapters] = await Promise.all([imp('replay-chapters.js')]);
  const line = o => JSON.stringify(o);
  const rec = recording.parseRecording([
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 2108, netId: 900, tmpl: 'Ilyushin', pos: [0, 200, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1742, netId: 910, tmpl: 'RussianSoldier', pos: [50, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'createPlayer', pid: 5, name: 'pilot', team: 2, ai: 0, netId: 60, vehNetId: 900, camNetId: 61, kitNetId: 0 }),
    line({ k: 'e', t: 1, e: 'createPlayer', pid: 6, name: 'walker', team: 2, ai: 0, netId: 62, vehNetId: 910, camNetId: 63, kitNetId: 0 }),
    line({ k: 'o', t: 1.5, id: 900, gid: 1, tmpl: 'Ilyushin', tid: 2108, team: 2, maxhp: 130 }),
    line({ k: 'o', t: 1.5, id: 910, gid: 2, tmpl: 'RussianSoldier', tid: 1742, team: 2, maxhp: 30 }),
    line({ k: 's', t: 1.5, o: [[900, 0, 200, 0, 0, 0, 0, 1], [910, 50, 1, 0, 0, 0, 0, 1]] }),
    line({ k: 'd', t: 8, id: 910 }),
    line({ k: 'd', t: 10, id: 900 }),
    line({ k: 'o', t: 20, id: 900, gid: 1, tmpl: 'Ilyushin', tid: 2108, team: 2, maxhp: 130 }),
    line({ k: 's', t: 20, o: [[900, 300, 250, 100, 0, 0, 0, 1]] }),
    line({ k: 'end', t: 30 }),
  ].join('\n'));
  results.outOfRange = [[5, 5], [5, 12], [5, 21], [6, 9]].map(([pid, t]) => {
    const s = chapters.playerStatusAt(rec, pid, t, []);
    return [s.state, s.outOfRange ? s.outOfRange.since : null];
  });
}

// --- a man blown off his feet, and a pilot who bails out -----------------------
//
// A soldier a blast throws goes into the engine's explosion states, living or
// dead (knockback.js), and a pilot who bails out into its parachute states;
// the body renderer drew neither. A v5 file records both halves' states and
// the soldier's state bits (`0x10`: the chute is open). Four men, the table
// as the game writes it (flags 0x6 on the explosion legs):
//
//   A (pid 51) thrown at 6.0, killed at 7.0 in the air, lands dead at 7.3; his
//     torso holds a hit, then his aim, while his legs fly
//   B (pid 52) thrown backward at 6.0, lands alive at 7.0, gets up at 8.0,
//     stands at 10.0
//   C (pid 53) falls from 5.1, opens at 7.0, glides from 8.7 and fires at
//     9.0, lands at 11.0, stands at 11.5
//   D (pid 54) glides, is killed at 8.0, rides the canopy down dead and lands
//     at 10.5
//   E (pid 55) is first on the record already pulling his ripcord,
//     `Lb_ParachuteOpen` with no fall before it (replay_20260927-075756's
//     nid 775), glides from 6.8 and stands at 8.5
//
// Their bodies are the bots' own renderer over a rig stood in for (the
// engine's two-half machine, logging what each half enters), with a canopy
// asset stood in for the published one. A page bot of the map's own, falling
// out of the sky with the page's `Parachute`, goes through the same path.
{
  const [{ ReplaySoldiers }, { createBotVisuals }, { bag }, { SoldierActions }, { Parachute }] = await Promise.all([
    imp('replay-bodies.js'), imp('bot-visuals.js'), imp('page-bag.js'), imp('soldier-actions.js'),
    imp('parachute.js'),
  ]);
  const line = o => JSON.stringify(o);
  const STATES = [
    [0, 'Lb_Stand', 0], [1, 'Ub_StandAimNo4', 0],
    [2, 'Lb_ExplosionForward', 0x6], [3, 'Ub_ExplosionForward', 0],
    [4, 'Lb_ExplosionLandFront', 0x6], [5, 'Ub_ExplosionLandFront', 0], [6, 'Ub_HitChestStand', 0],
    [7, 'Lb_ExplosionBackward', 0x6], [8, 'Ub_ExplosionBackward', 0],
    [9, 'Lb_ExplosionLandBackSurvive', 0x6], [10, 'Ub_ExplosionLandBackSurvive', 0],
    [11, 'Lb_ExplosionLandBackSurviveStandUp', 0x6], [12, 'Ub_ExplosionLandBackSurviveStandUp', 0],
    [13, 'Lb_ParachuteFall', 0x2], [14, 'Ub_ParachuteHitGround', 0],
    [15, 'Lb_ParachuteOpen', 0x6], [16, 'Ub_ParachuteOpen', 0], [17, 'Lb_ParachuteIdle', 0],
    [18, 'Ub_FireNo4', 0], [19, 'Lb_ParachuteHitGround', 0],
    [20, 'Lb_ParachuteDie', 0x4], [21, 'Ub_ParachuteDie', 0],
    [22, 'Lb_ParachuteDeadHitGround', 0x4], [23, 'Ub_ParachuteDeadHitGround', 0],
  ];
  const man = (pid, nid) => [
    line({ k: 'e', t: 1, e: 'createPlayer', pid, name: `p${pid}`, team: 2, ai: 1 }),
    line({ k: 'e', t: 5, e: 'createObject', tid: 1742, netId: nid, tmpl: 'RussianSoldier', pos: [0, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'e', t: 5, e: 'control', pid, netId: nid }),
    line({ k: 'o', t: 5.1, id: nid, gid: pid, tmpl: 'RussianSoldier', tid: 1742, team: 2, maxhp: 30, crit: 0 }),
  ];
  const st = (t, nid, lower, upper, bits) => line({ k: 'st', t, o: [[nid, lower, upper, 0, 0, 3, bits]] });
  // Where each is, BF1942's frame, at his origin (a metre over his feet).
  // A flies 10 m/s along +x from 6.0 to 7.3, a metre and a half up at the
  // top; B 6 m/s back from 6.0 to 7.0; C falls from 200 m, fast to 7.0 and
  // then 5 m/s under the canopy onto the ground at 11.0; D from 60 m at 5 m/s
  // onto the ground at 10.5; E from 30 m at 8.5 m/s onto the ground at 8.5.
  const at = {
    851: t => (t <= 6 ? [0, 1, 0] : t >= 7.3 ? [13, 1, 0] : [10 * (t - 6), 1 + 1.5 * Math.sin(Math.PI * (t - 6) / 1.3), 0]),
    852: t => (t <= 6 ? [20, 1, 0] : t >= 7 ? [14, 1, 0] : [20 - 6 * (t - 6), 1 + Math.sin(Math.PI * (t - 6)), 0]),
    853: t => [40, t <= 7 ? 200 - 20 * (t - 5.1) : Math.max(1, 162 - 40.25 * (t - 7)), 0],
    854: t => [60, Math.max(1, 60 - 5 * (t - 5.1) - 25.5 * Math.max(0, t - 10.4)), 0],
    855: t => [80, Math.max(1, 30 - 8.5 * (t - 5.1)), 0],
  };
  const timed = [
    st(5.1, 851, 0, 1, 0x4040), st(5.1, 852, 0, 1, 0x4040), st(5.1, 853, 13, 14, 0x6000),
    st(5.1, 854, 17, 1, 0x4010),
    st(6.1, 851, 2, 6, 0x4000), st(6.5, 851, 2, 1, 0x4000), st(7.3, 851, 4, 5, 0x4040),
    st(6.1, 852, 7, 8, 0x4000), st(7.0, 852, 9, 10, 0x40), st(8.0, 852, 11, 12, 0x40), st(10.0, 852, 0, 1, 0x41),
    st(7.0, 853, 15, 16, 0x4010), st(8.7, 853, 17, 1, 0x4010), st(9.0, 853, 17, 18, 0x4010),
    st(9.3, 853, 17, 1, 0x4010), st(11.0, 853, 19, 14, 0x40), st(11.5, 853, 0, 1, 0x41),
    st(8.1, 854, 20, 21, 0x4010), st(10.5, 854, 22, 23, 0x40),
    st(5.1, 855, 15, 16, 0x4011), st(6.8, 855, 17, 1, 0x4010), st(8.5, 855, 0, 1, 0xc0),
    line({ k: 'e', t: 7.0, e: 'score', kind: 3, pid: 52, victim: 51, weapon: 1, bodypart: 1 }),
    line({ k: 'e', t: 8.0, e: 'score', kind: 3, pid: 52, victim: 54, weapon: 1, bodypart: 1 }),
    line({ k: 'f', t: 9.0, id: 853, pid: 53, w: 'No4', p: [40, 150, 0], d: [0, 0, 1] }),
  ];
  for (let i = 0; i <= 80; i++) {
    const t = +(5.1 + i * 0.1).toFixed(1);
    timed.push(line({ k: 's', t, o: [851, 852, 853, 854, 855].map(nid => [nid, ...at[nid](t), 0, 0, 0, 1]) }));
  }
  timed.sort((a, b) => JSON.parse(a).t - JSON.parse(b).t);
  const rec = recording.parseRecording([
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'anim', t: 1, states: STATES }),
    ...man(51, 851), ...man(52, 852), ...man(53, 853), ...man(54, 854), ...man(55, 855),
    ...timed,
    line({ k: 'end', t: 20 }),
  ].join('\n'));

  // The canopy as `parachute.canopy.glb` carries it: its two clips and the
  // soldier template's `addTemplate Parachute` offset.
  const canopyAsset = () => {
    const scene = new THREE.Group();
    scene.name = 'canopy';
    return Promise.resolve({
      scene, attach: [0, 0.3, 0],
      animations: [new THREE.AnimationClip('open', 2.5, []), new THREE.AnimationClip('idle', 2, [])],
    });
  };
  // What the published bundles bind: the gaits, the parachute's eleven, the
  // explosion's twenty, the torso's fire, the deaths played here.
  const BOUND = new Set([
    'stand.lower', 'stand.upper', 'walk.lower', 'walk.upper', 'run.lower', 'run.upper', 'Ub_Fire',
    'Lb_DieChestStand', 'Ub_DieChestStand',
    'Lb_ParachuteFall', 'Ub_ParachuteFall', 'Lb_ParachuteOpen', 'Ub_ParachuteOpen', 'Lb_ParachuteIdle',
    'Lb_ParachuteHitGround', 'Ub_ParachuteHitGround', 'Lb_ParachuteDie', 'Ub_ParachuteDie',
    'Lb_ParachuteDeadHitGround', 'Ub_ParachuteDeadHitGround',
    ...STATES.map(([, name]) => name).filter(name => /Explosion/.test(name)),
    'Lb_ExplosionBackward', 'Ub_ExplosionBackward', 'Lb_ExplosionLandBack', 'Ub_ExplosionLandBack',
  ]);
  const INFO = {
    Lb_ExplosionForward: { loop: true, morph: 50 }, Lb_ExplosionBackward: { loop: true, morph: 50 },
    Lb_ParachuteFall: { loop: true, morph: 1 }, Lb_ParachuteIdle: { loop: true, morph: 1 },
    Ub_Fire: { loop: false, morph: 10000, then: '_POSE_' },
  };
  let now = 0;
  const logs = new Map();       // pid -> { lower: [[name, t]], upper: [[name, t]] }
  const rigFor = pid => {
    const log = logs.get(pid) ?? { lower: [], upper: [] };
    logs.set(pid, log);
    const anim = new SoldierActions({
      has: name => BOUND.has(name),
      info: name => INFO[name] ?? (BOUND.has(name) ? { loop: /\.(lower|upper)$/.test(name), morph: 10 } : null),
      duration: name => (name === 'Ub_Fire' ? 1 : 1),
    });
    const deaths = { dieChestStand: 1, explosionLandFront: 1, explosionLandBack: 1, parachuteDeadLanded: 1 };
    return {
      kind: 'halves', scene: new THREE.Group(), families: { stand: true, walk: true, run: true },
      actions: new Map([...BOUND].map(name => [name, {}])), anim, weaponNode: new THREE.Object3D(),
      mixer: { stopAllAction() {} }, hasDeath: family => family in deaths,
      step: (input, dt) => {
        log.held = input?.held ?? null;
        for (const e of anim.update(input, dt)) {
          const list = log[e.half];
          if (list.at(-1)?.[0] !== e.name) list.push([e.name, +now.toFixed(2)]);
        }
      },
    };
  };
  const pending = () => new Promise(() => {});
  const kills = [];
  const cries = [];
  const steps = new Map();
  const ctx = {
    scene: new THREE.Scene(), bust: () => '', modelsBase: 'models', loadouts: () => null,
    waterLevel: () => -100,
    playSoldierDeathSound: () => cries.push(+now.toFixed(2)),
    footstepTick: actor => steps.set(actor.pid, [...(steps.get(actor.pid) ?? []), +now.toFixed(2)]),
    makeReplayBodies: shim => createBotVisuals(bag({
      footBodyLoader: { loadAsync: pending }, footBodyClips: pending, footStateMachine: () => null,
      disposeFootBodyScene: () => {}, soldierDress: null, bindDynamicShading: () => {}, canopyAsset,
    }, shim)),
  };
  const soldiers = new ReplaySoldiers({ rec, ctx, playing: true });
  const visuals = soldiers.bodies.botVisuals;
  const killBot = soldiers.bodies.killBot;
  soldiers.bodies.killBot = (bot, opts) => {
    const family = killBot(bot, opts);
    kills.push({ pid: bot.pid, family, t: +now.toFixed(2) });
    return family;
  };
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const sample = {};
  const look = (pid, key) => {
    const vis = visuals.get(`replay:${pid}`);
    const s = soldiers.soldiers.get(`replay:${pid}`)?.soldier;
    const canopy = vis?.canopy ?? null;
    const pair = p => (p ? { lower: p.lower, upper: p.upper } : null);
    sample[`${pid}@${key}`] = {
      drawn: Boolean(vis?.group.visible),
      x: vis ? +vis.group.position.x.toFixed(2) : null,
      weapon: vis?.rig?.weaponNode ? vis.rig.weaponNode.visible : null,
      held: logs.get(pid)?.held ? { lower: logs.get(pid).held.lower, upper: logs.get(pid).held.upper ?? null } : null,
      blast: pair(s?.explosionClips?.()),
      chute: pair(s?.chute?.clips?.(false)),
      open: s?.chute?.open ?? null,
      canopy: canopy ? { visible: canopy.scene.visible, clip: canopy.want,
                         over: +(canopy.scene.position.y - vis.group.position.y).toFixed(2) } : null,
    };
  };
  const probes = {
    6.3: [51, 52], 7.1: [51], 7.5: [53, 55], 8.5: [52, 54], 9.1: [53, 55], 9.5: [54], 10.5: [52], 11.2: [53],
    11.8: [53], 5.15: [55], 5.2: [55], 5.5: [53, 55],
  };
  for (let i = 0; i <= 150; i++) {
    now = +(5.1 + i * 0.05).toFixed(2);
    for (const pid of [51, 52, 53, 54, 55]) {
      const vis = visuals.get(`replay:${pid}`);
      if (vis && !vis.rig) vis.rig = rigFor(pid);
    }
    if (now === 9) soldiers.fire(53, { weapon: 'No4', dir: [0, 0, 1] }, now);
    soldiers.update(now, 0.05, new Map());
    await tick();
    for (const pid of probes[now] ?? []) look(pid, now);
  }

  // A bot of the page's own: his soldier's `Parachute` in free fall, then
  // open -- the same renderer, reading `soldier.chute` as it reads a
  // recorded man's.
  const chute = new Parachute({ random: () => 0 });
  const soldier = { x: 5, y: 150, z: 5, yaw: 0, stance: 'stand', body: { stateSpeed: 1 }, chute, swimClips: () => null };
  const bot = { playerId: 'bot:7', name: 'b7', stance: 'stand', isFiring: false, vehicle: null, weaponAi: null,
                kit: null, getPosition: () => [soldier.x, soldier.y, soldier.z] };
  const scene = new THREE.Scene();
  const pageBodies = createBotVisuals(bag({
    footBodyLoader: { loadAsync: pending }, footBodyClips: pending, footStateMachine: () => null,
    disposeFootBodyScene: () => {}, soldierDress: null, bindDynamicShading: () => {}, canopyAsset,
    bots: [bot], world: { player: () => ({ soldier, team: 2 }), armorOf: () => ({ destroyed: false }) },
    presentAlpha: 1, scene, camera: null, bust: () => '', MODELS_BASE: 'models',
    soldierTemplateFor: () => 'USMarineSoldier', vehicles: null,
  }));
  pageBodies.ensureRoot();
  pageBodies.ensureBotVisual(bot);
  const pageVis = pageBodies.botVisuals.get('bot:7');
  pageVis.rig = rigFor(7);
  const pageFrame = async input => {
    chute.update({ dt: 1 / 30, velocityY: -20, height: 100, ...input });
    pageBodies.captureBotPresentationTick(false);
    pageBodies.updateBotVisuals(1 / 30);
    await tick();
    const log = logs.get(7);
    return {
      state: chute.state, held: log.held ? { lower: log.held.lower, upper: log.held.upper ?? null } : null,
      weapon: pageVis.rig.weaponNode.visible,
      canopy: pageVis.canopy ? { visible: pageVis.canopy.scene.visible, clip: pageVis.canopy.want } : null,
    };
  };
  const pageBot = { falling: await pageFrame({}), opening: null };
  await pageFrame({ deploy: true });
  pageBot.opening = await pageFrame({});
  pageBot.lower = logs.get(7).lower.map(([name]) => name);

  const byName = log => log.map(([name, t]) => [name, t]);
  results.knockback = {
    sample,
    lower: Object.fromEntries([51, 52, 53, 54, 55].map(pid => [pid, byName(logs.get(pid)?.lower ?? [])])),
    upper: Object.fromEntries([51, 52, 53, 54, 55].map(pid => [pid, byName(logs.get(pid)?.upper ?? [])])),
    kills,
    cries,
    steps: Object.fromEntries([...steps].map(([pid, ts]) => [pid, ts])),
    flight: {
      A: recording.recordedFlight?.(rec, 851, 7.0) ?? null,
      D: recording.recordedFlight?.(rec, 854, 8.0) ?? null,
      B: recording.recordedFlight?.(rec, 852, 9.0) ?? null,
    },
    pageBot,
  };
}

// --- a round a hull lays: the PT boats' floating mines ------------------------
//
// The Midway report (replay_20260927-203459): `models/FloatingMine.glb` 404'd.
// An Elco80 spawned at 613 s with its `FloatingMineLauncher`'s pool of five
// `FloatingMine`, a round no `...Projectile` suffix names, so the five were
// read as hulls and each asked for a model no tree has. A pool's rounds are
// rounds whatever their name, and one lying in the water is drawn from its
// launcher on the recording's own hull: the mine, not the torpedo beside it.
{
  const { ReplayProps, roundIn, weaponOfProjectile } = await imp('replay-props.js');
  const line = o => JSON.stringify(o);
  const rec = recording.parseRecording([
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 3168, netId: 1524, tmpl: 'Elco80', pos: [10, 20, 10], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'projPool', tid: 3220, tmpl: 'FloatingMine', netId: 1519, count: 5 }),
    // A mine from a pool made before the recording began, met only as itself.
    line({ k: 'o', t: 2, id: 1600, gid: 1, tmpl: 'FloatingMine', tid: 3220, team: 1 }),
    line({ k: 's', t: 2, o: [[1600, 30, 20, 30, 0, 0, 0, 1], [1519, 0, 0, 0, 0, 0, 0, 1]] }),
    // A depth charge no pool of this recording made.
    line({ k: 'o', t: 3, id: 1700, gid: 2, tmpl: 'DepthCharge', tid: 3300, team: 2 }),
    line({ k: 's', t: 3, o: [[1700, 40, 10, 40, 0, 0, 0, 1]] }),
  ].join('\n'));
  const hullTemplates = () => [...new Set(rec.lives
    .filter(l => l.tmpl && !l.soldier && !l.kit && !l.controlPoint && !l.camera && !l.projectile)
    .map(l => l.tmpl))];
  const mines = rec.lives.filter(l => l.tmpl === 'FloatingMine')
    .map(l => ({ nid: l.nid, pooled: Boolean(l.pooled), projectile: l.projectile }));
  const hullsParsed = hullTemplates();
  // What replay.js asks of the level's projectile table (`_shared/damage.json`).
  const marked = recording.markRounds(rec, tmpl => ['depthcharge', 'floatingmine'].includes(tmpl.toLowerCase()));
  const hullsMarked = hullTemplates();

  // The Elco80 as `models/Elco80.glb` loads: the torpedo tubes first, each
  // FireArms with its round's mesh under it, hidden as the model hides it.
  const launcher = (name, round, mesh, endEffect) => {
    const fireArms = new THREE.Object3D();
    fireArms.name = name;
    fireArms.userData = { templateKind: 'FireArms',
                          fireArms: { projectile: { template: round, kind: 'shell', endEffect } } };
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    body.name = `${name} projectile`;
    body.visible = false;
    body.position.set(1, 2, 3);
    body.userData = { templateKind: 'SimpleObject', projectileMesh: { template: mesh, geometry: mesh } };
    fireArms.add(body);
    return fireArms;
  };
  const elco = new THREE.Group();
  elco.name = 'Elco80';
  elco.add(launcher('Elco80_Torpedos', 'PTBoatTorpedo', 'PT_Dummy_Torpedo', null),
           launcher('FloatingMineLauncher', 'FloatingMine', 'FloatingMineLauncherDummy', 'e_ExplMine'));
  const grenade = new THREE.Group();
  grenade.add(launcher('GrenadeAllies', 'GrenadeAlliesProjectile', 'GrenadeAlliesProjectile', 'e_ExplGranade'));
  const requested = [];
  const ctx = {
    modelsBase: 'models',
    bust: () => '',
    loader: {
      loadAsync: async url => {
        requested.push(url);
        if (url === 'models/GrenadeAllies.glb') return { scene: grenade };
        throw new Error(`404 ${url}`);
      },
    },
  };
  const props = new ReplayProps({ ctx, root: new THREE.Group() });
  const thrown = { nid: 1075, tmpl: 'GrenadeAlliesProjectile', projectile: true, kit: false,
                   keys: [{ t: 2, p: [5, 0, 5], q: [0, 0, 0, 1] }] };
  const placed = await props.load([...rec.lives, thrown], [elco]);
  results.hullRounds = {
    mines,
    hullsParsed,
    marked,
    hullsMarked,
    weapons: ['GrenadeAlliesProjectile', 'FloatingMine', 'Projectile'].map(weaponOfProjectile),
    torpedo: roundIn(elco, 'ptboattorpedo')?.mesh.name ?? null,
    placed,
    requested,
    props: props.props.map(p => ({
      tmpl: p.life.tmpl,
      nid: p.life.nid,
      mesh: p.node.userData?.projectileMesh?.template ?? null,
      endEffect: p.endEffect,
      at: p.node.position.toArray(),
    })).sort((a, b) => a.nid - b.nid),
  };
}

// --- Midway (replay_20260927-203459): who a pid is, a gun's report, a soldier
// --- first seen late, the radio, the refills, and what the file never names --
//
// A public server's round, recorded from 41 s after the join. Its pid 4 was
// 3star, then Niconan; its pid 11 Omen, killed by Rut's bazooka in the tick he
// switched to Rut's side, then another Niconan. Waldo's soldier was his from
// the file's first record and first seen 8.7 s in. The ships out of range
// all round are only parts and engines; the Fletcher2 is seen at 405 s on the
// level's Fletcher pad; the Enterprise is removed at 389 s and made again at
// its place at 499 s; a deck Zero's engine starts at 9.5 s.
{
  const [{ ReplayHull }, { GunFire }, chapters, { addStandIns }, { spawnedCraftUnder }] = await Promise.all([
    imp('replay-hulls.js'), imp('gunfire.js'), imp('replay-chapters.js'), imp('replay-standins.js'),
    imp('spawned-craft.js'),
  ]);
  const line = o => JSON.stringify(o);
  const rec = recording.parseRecording([
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'e', t: 0, e: 'serverInfo', mapId: 'BF1942', mod: 'bf1942', gameId: 'BF1942', ago: 41 }),
    // The recording player joined the Axis and switched sides before the file
    // began: the held createPlayer has the side joined on, the roster the new.
    line({ k: 'e', t: 0, e: 'createPlayer', pid: 8, name: 'skandia', team: 1, ai: 0, netId: 17, vehNetId: 18, camNetId: 18, kitNetId: 0, ago: 30 }),
    line({ k: 'roster', t: 0, p: [[0, 2, 0, 'Rut', 0], [4, 1, 0, '3star', 0], [9, 1, 0, 'waldo', 0], [8, 2, 0, 'skandia', 1]] }),
    line({ k: 'p', t: 0, p: [[9, 1, 740, 740, 0, 0], [0, 2, 700, 700, 0, 0]] }),
    line({ k: 'jn', t: 0, o: [[541, 1, 'HatsuzukiCannon', 0, 5, -20], [545, 2, 'HatsuzukiCannon', 0, 5, -20],
                              [553, 3, 'Carrier_AA_Cannon', 10, 15, 5], [571, 4, 'Carrier_AA_Cannon', 10, 15, 5],
                              [563, 5, 'Fletcher_cannon', 0, 6, 30], [559, 6, 'Fletcher_cannon', 0, 6, 30]] }),
    line({ k: 'g', t: 0, o: [[541, 0, 0, 0, 0, 7], [559, 0, 0, 0, 0, 8], [558, 0, 0, 0, 0, 9], [613, 0, 0, 0, 0, 10]] }),
    // The server repeats the status whenever someone joins.
    line({ k: 'e', t: 1, e: 'gameStatus', status: 1 }),
    line({ k: 'chat', t: 5, pid: 4, team: 1, text: '3star: :O' }),
    line({ k: 'chat', t: 6, pid: -1, team: 0, text: '*Do\u0080not\u0080steal.' }),
    line({ k: 'o', t: 8.7, id: 740, gid: 1, tmpl: 'JapaneseSoldier', tid: 1732, team: 1, maxhp: 30, crit: 0 }),
    line({ k: 's', t: 8.7, o: [[740, 100, 11, 100, 0, 0, 0, 1]] }),
    line({ k: 'g', t: 9.5, o: [[613, 0.8, 0, 1, 0, 10]] }),
    line({ k: 'e', t: 10, e: 'destroyPlayer', pid: 4 }),
    line({ k: 'e', t: 12, e: 'createPlayer', pid: 11, name: 'Omen', team: 1, ai: 0, netId: 23, vehNetId: 24, camNetId: 24, kitNetId: 0 }),
    line({ k: 'e', t: 12.001, e: 'gameStatus', status: 1 }),
    line({ k: 'p', t: 13, p: [[11, 1, 24, -1, 0, 0]] }),
    line({ k: 'e', t: 15, e: 'radio', pid: 0, msg: 15, global: 1 }),
    line({ k: 'e', t: 16, e: 'special', action: 0 }),
    line({ k: 'e', t: 16.5, e: 'special', action: 0 }),
    line({ k: 'e', t: 17, e: 'special', action: 0 }),
    line({ k: 'e', t: 20, e: 'score', kind: 3, pid: 0, victim: 9, weapon: 1, bodypart: 1, weaponName: 'Thompson' }),
    line({ k: 'e', t: 20, e: 'createPlayer', pid: 4, name: 'Niconan', team: 2, ai: 0, netId: 9, vehNetId: 10, camNetId: 10, kitNetId: 0 }),
    line({ k: 'chat', t: 25, pid: 4, team: 2, text: 'Niconan: yo' }),
    line({ k: 'e', t: 30, e: 'score', kind: 3, pid: 0, victim: 11, weapon: 1, bodypart: 1, weaponName: 'Bazooka' }),
    line({ k: 'e', t: 30, e: 'score', kind: 5, pid: 11, victim: 1, weapon: 0, bodypart: 0 }),
    line({ k: 'e', t: 30.001, e: 'setTeam', pid: 11, team: 2 }),
    line({ k: 'e', t: 32, e: 'destroyPlayer', pid: 11 }),
    line({ k: 'e', t: 40, e: 'createPlayer', pid: 11, name: 'Niconan', team: 2, ai: 0, netId: 23, vehNetId: 24, camNetId: 24, kitNetId: 0 }),
    line({ k: 'o', t: 66, id: 613, gid: 3, tmpl: 'Zero', tid: 1, team: 1, maxhp: 100, crit: 20 }),
    line({ k: 's', t: 66, o: [[613, 900, 200, 900, 0, 0, 0, 1]] }),
    line({ k: 'e', t: 389, e: 'destroyObject', netId: 571 }),
    line({ k: 'o', t: 405, id: 559, gid: 2, tmpl: 'Fletcher2', tid: 2, team: 0, maxhp: 200, crit: 50 }),
    line({ k: 's', t: 405, o: [[559, 3174, 20, 2260, 0, 0, 0, 1]] }),
    line({ k: 'e', t: 499, e: 'createObject', tid: 3, netId: 1325, tmpl: 'Enterprise', pos: [3399, 19, 2856], rot: [0, 0, 0] }),
    line({ k: 'end', t: 600 }),
  ].join('\n'));
  const kill = rec.kills.find(k => k.victim === 11);
  const soldier = rec.lives.find(l => l.nid === 740);
  const q = [0, 0, 0, 1];
  const place = (template, p, ...names) => ({ template, p, q, names: new Set([template.toLowerCase(), ...names]) });
  const traced = addStandIns(rec, [
    place('Hatsuzuki', [371, 14, 1749], 'hatsuzukicannon'),
    place('Hatsuzuki2', [1235, 14, 1934], 'hatsuzukicannon'),
    place('Shokaku', [682, 20, 1592], 'carrier_aa_cannon'),
    place('Enterprise', [3399, 19, 2856], 'carrier_aa_cannon'),
    place('Fletcher', [3174, 20, 2260], 'fletcher_cannon'),
    place('Fletcher2', [3781, 20, 2978], 'fletcher_cannon'),
    place('Zero', [634, 34, 1590]),
  ]);

  // A looped gun's report is held up by its rounds, and nothing else.
  const zero = new THREE.Group();
  zero.name = 'Zero';
  zero.userData = { templateKind: 'PlayerControlObject' };
  const zeroGuns = new THREE.Group();
  zeroGuns.name = 'ZeroGuns';
  zeroGuns.userData.fireArms = {
    projectile: { template: 'Tracer_Projectile', kind: 'bullet', trail: null, timeToLive: 3, damage: {} },
    roundOfFire: 10, magSize: -1, velocity: 400, input: 'c_PIFire', muzzles: 1,
  };
  zero.add(zeroGuns);
  const zeroModel = new THREE.Group();
  zeroModel.add(zero);
  const zeroRec = recording.parseRecording([
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1, netId: 892, tmpl: 'Zero', pos: [0, 100, 0], rot: [0, 0, 0] }),
    line({ k: 'o', t: 1, id: 892, gid: 1, tmpl: 'Zero', tid: 1, team: 1, maxhp: 100, crit: 20 }),
    line({ k: 's', t: 1, o: [[892, 0, 100, 0, 0, 0, 0, 1]] }),
    line({ k: 'f', t: 2, id: 892, pid: 2, w: 'ZeroGuns', p: [0, 100, 1], d: [0, 0, 1] }),
  ].join('\n'));
  let rate = 1;
  const scene = new THREE.Scene();
  const zeroHull = new ReplayHull({ ctx: { guns: new GunFire({ scene, viewportHeight: () => 800 }), scene },
    rec: zeroRec, showGhosts: true, time: 0, feedRate: () => rate }, zeroRec.lives.find(l => l.nid === 892), zeroModel, null);
  const gun = zeroHull.groups[0];
  const sounding = [];
  zeroHull.update(1.9, 0.05);
  sounding.push(Boolean(gun.sounding));
  zeroHull.fire(0, 1, zeroRec.fires[0]);
  zeroHull.update(2.05, 0.05);
  sounding.push(Boolean(gun.sounding));
  rate = 0;
  zeroHull.update(2.1, 0.05);
  sounding.push(Boolean(gun.sounding));
  rate = 1;
  zeroHull.update(2.5, 0.05);
  sounding.push(Boolean(gun.sounding));
  zeroHull.fire(0, 1, zeroRec.fires[0]);
  zeroHull.resetSound();
  zeroHull.update(2.05, 0.05);
  sounding.push(Boolean(gun.sounding));

  // A carrier's model carries a deck Corsair (a PCO with a body) beside an AA
  // seat (a PCO without one): only the Corsair is craft, and a replayed
  // carrier drops it.
  const carrier = new THREE.Group();
  carrier.name = 'Enterprise';
  carrier.userData = { templateKind: 'PlayerControlObject', physics: { mass: 50000, vehicleCategory: 'VCSea' } };
  const corsair = new THREE.Group();
  corsair.name = 'Corsair';
  corsair.userData = { templateKind: 'PlayerControlObject', physics: { mass: 4000, vehicleCategory: 'VCAir' } };
  const aaSeat = new THREE.Group();
  aaSeat.name = 'Carrier_AA_Base';
  aaSeat.userData = { templateKind: 'PlayerControlObject' };
  carrier.add(corsair, aaSeat);
  const carrierModel = new THREE.Group();
  carrierModel.add(carrier);
  const craft = spawnedCraftUnder(carrier).map(o => o.name);
  const carrierRec = recording.parseRecording([
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 3, netId: 1325, tmpl: 'Enterprise', pos: [3399, 19, 2856], rot: [0, 0, 0] }),
  ].join('\n'));
  // eslint-disable-next-line no-new
  new ReplayHull({ ctx: { scene }, rec: carrierRec, showGhosts: true }, carrierRec.lives[0], carrierModel, null);

  results.midway = {
    names: [recording.nameAt(rec, 4, 5), recording.nameAt(rec, 4, 25), recording.nameAt(rec, 11, 20), recording.nameAt(rec, 11, 45)],
    teams: [recording.teamAt(rec, 11, 29.9), recording.teamAt(rec, 11, 30.5)],
    kill: { killerTeam: kill.killerTeam, victimTeam: kill.victimTeam, text: chapters.chapterText(rec, { ...kill, lead: 0 }) },
    feedKill: chapters.feedEvents(rec).filter(e => e.type === 'kill').map(e => [e.killer, e.victim, e.killerTeam, e.victimTeam]),
    chat: rec.events.filter(r => r.kind === 'chat').map(r => r.text),
    status: rec.events.filter(r => r.kind === 'round').map(r => r.text),
    radio: rec.radio,
    radioRow: rec.events.find(r => r.kind === 'radio')?.text ?? null,
    radioFeed: chapters.feedEvents(rec).filter(e => e.type === 'radio').length,
    refills: rec.refills.length,
    supplyRows: rec.events.filter(r => r.kind === 'supply').length,
    lateSoldier: { pid: soldier.pid ?? null, diedAt: soldier.diedAt ?? null },
    left: [chapters.playerStatusAt(rec, 4, 15).state, chapters.playerStatusAt(rec, 11, 35).state],
    tally: {
      omenAt35: chapters.tallyAt(rec.kills, 35, rec).get(11) ?? null,
      niconanAt45: chapters.tallyAt(rec.kills, 45, rec).get(11) ?? null,
      withoutSessions: chapters.tallyAt(rec.kills, 45).get(11) ?? null,
    },
    roster45: chapters.rosterOf(rec, 45).map(p => [p.pid, p.name, p.team]),
    recordingPid: chapters.recordingPlayer(rec),
    heldSwitch: {
      sides: [recording.teamAt(rec, 8, 0), recording.teamAt(rec, 8, 5)],
      local: Boolean(recording.playerAt(rec, 8, 0)?.local),
      joinedRow: rec.events.some(r => r.kind === 'player' && r.text.startsWith('skandia joined')),
    },
    extended: traced.extended.map(l => [l.nid, l.tmpl, l.created]),
    standIns: traced.added.map(l => [l.nid, l.tmpl, l.created, Number.isFinite(l.destroyed) ? l.destroyed : null]),
    sounding,
    craft,
    corsairLeft: corsair.parent?.name ?? null,
    aaSeatKept: aaSeat.parent?.name ?? null,
  };
}

console.log(JSON.stringify(results));
