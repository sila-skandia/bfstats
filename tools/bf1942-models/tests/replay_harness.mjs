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
  // 20) facing the way his identity rotation points (sampled at his origin, a
  // metre up, as the recorder writes a soldier).
  const cam = new THREE.PerspectiveCamera(60, 1.6, 0.5, 8000);
  const watcher = { rec, followPid: 0, time: 5, hulls: new Map(), ctx: { camera: cam, groundHeight: () => 0, waterLevel: () => -100 } };
  const camera = new ReplayCamera(watcher);
  watcher.camera = camera;
  const target = new THREE.Vector3(10, 1.2, -20);
  for (let i = 0; i < 30; i++) camera.update(1 / 60, 5);
  const orbit = { distance: +cam.position.distanceTo(target).toFixed(2), behind: cam.position.z < target.z };
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
  // Dead at 25: first person has no eyes to look through, the orbit stands in
  // over the body.
  camera.setMode('pov');
  camera.update(1 / 60, 25);
  results.uxCamera = { orbit, zoomedIn, zoomedOut, orbited, pov, free, deadPov: camera.hidePid };
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
  const partsRun = replay(v4);
  const roundsRun = replay(roundsOnly);
  const v5Run = replay(v5);
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
    },
    lateTurn: [
      aim.lateTurn(0, 40, 0, 1, 90),
      aim.lateTurn(0, 40, 0.8, 1, 90),
      aim.lateTurn(0, 40, 0.95, 1, 90, { start: 0.9 }),
      aim.lateTurn(170, -170, 0.9, 1, 90, { free: true }),
    ].map(v => +v.toFixed(2)),
  };
}

console.log(JSON.stringify(results));
