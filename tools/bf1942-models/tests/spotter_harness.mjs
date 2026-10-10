// Drives the artillery spotting rules (`viewer/spotter.js`) outside a browser
// and prints one JSON blob. `tests/test_spotter.py` copies the module in, so
// the file under test is the file the page loads.

import {
  EYE_LIFT, LOOK_AHEAD, LOOK_EASE, NO_OWNER, RAY_RANGE, REMOVE_DELAY,
  ScoutCameras, ScoutSelector, ScoutView,
  artSeat, calledLine, fadeAlpha, gazeHeading, isMarkerWeapon, lookAtMatrix, markerPose,
  scoutIconFrame, scoutLine, teamMarkers, wedgeBlinkAlpha,
} from './spotter.js';

const out = {};
out.constants = { RAY_RANGE, EYE_LIFT, REMOVE_DELAY, LOOK_AHEAD, LOOK_EASE, NO_OWNER };

// --- which weapon marks ---------------------------------------------------------

out.markerWeapon = {
  binoculars: isMarkerWeapon({ magType: 2, projectile: { damage: { damageType: 3 } } }),
  medPack: isMarkerWeapon({ magType: 1 }),
  rifle: isMarkerWeapon({ magType: 0 }),
  damageTypeAlone: isMarkerWeapon({ projectile: { damage: { damageType: 3 } } }),
  none: isMarkerWeapon(null),
};

// --- the matrix -----------------------------------------------------------------

out.lookAt = {
  level: lookAtMatrix([0, 30, 0], [0, 30, 100]),
  down: lookAtMatrix([10, 40, 10], [10, 0, 110]),
  straightDown: lookAtMatrix([5, 30, 5], [5, 0, 5]),
};

// --- placing --------------------------------------------------------------------

const hitAt = d => () => d;
const miss = () => null;
out.pose = {
  hit: markerPose([100, 10, 100], [0, 0, 2], hitAt(400)),
  atRange: markerPose([100, 10, 100], [0, 0, 1], hitAt(RAY_RANGE)).hit,
  justInside: markerPose([100, 10, 100], [0, 0, 1], hitAt(RAY_RANGE - 0.5)).hit,
  miss: markerPose([100, 10, 100], [0, 0, 1], miss),
};

{
  const cameras = new ScoutCameras();
  const removed = [];
  cameras.onRemove = m => removed.push(m.id);
  const a = cameras.place({ weapon: 'binoA', owner: 1, team: 1, eye: [0, 2, 0],
    forward: [0, 0, 1], cast: hitAt(200), timeToLive: 120, now: 0 });
  const b = cameras.place({ weapon: 'binoB', owner: 2, team: 2, eye: [50, 2, 0],
    forward: [1, 0, 0], cast: hitAt(100), timeToLive: 120, now: 1 });
  const order1 = cameras.list.map(m => m.id);
  // Player 1 marks again: the old one stays 0.2 s, the new one is in front.
  const c = cameras.place({ weapon: 'binoA', owner: 1, team: 1, eye: [0, 2, 0],
    forward: [1, 0, 0], cast: hitAt(300), timeToLive: 120, now: 10 });
  const order2 = cameras.list.map(m => m.id);
  cameras.step(10.1);
  const during = cameras.list.map(m => m.id);
  cameras.step(10.2);
  const after = cameras.list.map(m => m.id);
  // Firing at the sky removes the old one and lists an unowned marker.
  const sky = cameras.place({ weapon: 'binoA', owner: 1, team: 1, eye: [0, 2, 0],
    forward: [0, 1, 0], cast: miss, timeToLive: 120, now: 20 });
  cameras.step(20.3);
  const afterSky = cameras.list.map(m => m.id);
  const remainingB = cameras.remaining(b, 61);
  cameras.step(120.9);
  const beforeExpiry = cameras.list.map(m => m.id);
  cameras.step(121);
  const afterExpiry = cameras.list.map(m => m.id);
  out.list = {
    ids: [a.id, b.id, c.id, sky.id],
    order1, order2, during, after, afterSky, removed: [...removed],
    sky: { owner: sky.owner, team: sky.team, hit: sky.hit, position: sky.matrix.position },
    a: { owner: a.owner, team: a.team, target: a.target, eye: a.matrix.position },
    remainingB, beforeExpiry, afterExpiry,
  };
}

// --- the view (mode 17) -----------------------------------------------------------

{
  const log = [];
  const view = new ScoutView({ save: () => { log.push('save'); return { mode: 'cockpit', fov: 60 }; },
    restore: saved => log.push(`restore ${saved.mode} ${saved.fov}`) });
  const marker = { id: 7, matrix: lookAtMatrix([0, 30, 0], [0, 0, 300]) };
  const refusedNoCamera = view.turnOn(marker, { externTrace: false });
  const refusedOrigin = view.turnOn({ id: 8, matrix: lookAtMatrix([5, 30, 5], [5, 0, 5]) });
  const on = view.turnOn(marker);
  const seeded = [...view.lookAt];
  const rest = view.step();
  // A shell in flight: the look-at closes a tenth of the gap a call.
  const shell = [100, 50, 100];
  const first = view.step(shell);
  const gapBefore = Math.hypot(shell[0] - rest.target[0], shell[1] - rest.target[1], shell[2] - rest.target[2]);
  const gapAfter = Math.hypot(shell[0] - first.target[0], shell[1] - first.target[1], shell[2] - first.target[2]);
  for (let i = 0; i < 80; i++) view.step(shell);
  const onShell = [...view.lookAt];
  for (let i = 0; i < 120; i++) view.step(null);
  const back = [...view.lookAt];
  // A second marker while on: the mode is not saved again.
  view.turnOn({ id: 9, matrix: lookAtMatrix([50, 30, 0], [50, 0, 300]) });
  const outside = view.turnOff({ inArtPos: false });
  const stillOn = view.on;
  const off = view.turnOff();
  out.view = {
    refusedNoCamera, refusedOrigin, on, seeded, rest, ratio: gapAfter / gapBefore,
    onShell, back, outside, stillOn, off, log, offAgain: view.turnOff(), stepOff: view.step(),
  };
}

// --- the selector ---------------------------------------------------------------

function rig({ artPos = true, externTrace = true, team = 1 } = {}) {
  const state = { artPos, externTrace, team, now: 0, teams: new Map([[1, 1], [2, 1], [3, 2], [4, 2]]) };
  const cameras = new ScoutCameras();
  const view = new ScoutView({ save: () => 'saved', restore: () => { state.restored = (state.restored ?? 0) + 1; } });
  const selector = new ScoutSelector(cameras, view, () => ({
    artPos: state.artPos, externTrace: state.externTrace, team: state.team, now: state.now,
    teamOf: id => state.teams.get(id) ?? null,
  }));
  const mark = (weapon, owner, now, cast = hitAt(100)) => cameras.place({
    weapon, owner, team: state.teams.get(owner), eye: [owner * 10, 2, 0], forward: [0, 0, 1],
    cast, timeToLive: 120, now,
  });
  return { state, cameras, view, selector, mark };
}
const snap = s => ({ selected: s.selector.selected, viewing: s.selector.viewing,
  view: s.view.markerId, line: s.selector.line });

{
  // The gate.
  const noMarkers = rig();
  const enemyOnly = rig();
  enemyOnly.mark('w3', 3, 0);
  const onFoot = rig({ artPos: false });
  onFoot.mark('w1', 1, 0);
  const friendly = rig();
  friendly.mark('w1', 1, 0);
  // The owner changed sides after marking: the gate reads his team now.
  const turncoat = rig();
  turncoat.mark('w1', 1, 0);
  turncoat.state.teams.set(1, 2);
  // An unowned miss never opens it.
  const skyOnly = rig();
  skyOnly.mark('w1', 1, 0, miss);
  out.gate = {
    noMarkers: noMarkers.selector.gate(), enemyOnly: enemyOnly.selector.gate(),
    onFoot: onFoot.selector.gate(), friendly: friendly.selector.gate(),
    turncoat: turncoat.selector.gate(), skyOnly: skyOnly.selector.gate(),
    toggleShut: noMarkers.selector.toggle(), stepShut: noMarkers.selector.step(1),
  };
}

{
  // Alt-fire: on at the first marker of the gunner's team, off again.
  const s = rig();
  const enemy = s.mark('w3', 3, 0);
  const mine = s.mark('w1', 1, 1);
  const newerEnemy = s.mark('w4', 4, 2);
  const took = s.selector.toggle();
  const on = snap(s);
  s.selector.toggle();
  const off = snap(s);
  out.toggle = { ids: { enemy: enemy.id, mine: mine.id, newerEnemy: newerEnemy.id },
    took, on, off, restored: s.state.restored, fades: s.selector.fades };
}

{
  // A seat with no ExternTrace camera: the line shows, the view does not.
  const s = rig({ externTrace: false });
  s.mark('w1', 1, 0);
  s.selector.toggle();
  out.noCamera = snap(s);
}

{
  // Next / previous.
  const s = rig();
  const m1 = s.mark('w1', 1, 0);         // oldest, mine
  const e3 = s.mark('w3', 3, 1);         // enemy
  const m2 = s.mark('w2', 2, 2);         // newest, mine
  const ids = { m1: m1.id, e3: e3.id, m2: m2.id };
  s.selector.step(1);
  const nextFromNone = snap(s);          // the newest
  s.selector.step(1);
  const ontoEnemy = snap(s);             // steps onto the enemy's, view stays
  s.selector.step(1);
  const stalled = snap(s);               // the keys stall
  s.selector.toggle();
  const cleared = snap(s);               // alt-fire: was viewing, so off
  s.selector.step(-1);
  const prevFromNone = snap(s);          // the oldest
  s.selector.step(1);
  const wrapped = snap(s);               // past the end: wraps to the newest
  out.steps = { ids, nextFromNone, ontoEnemy, stalled, cleared, prevFromNone, wrapped };

  // Nothing selected and the end of the list is an enemy's: the key does nothing.
  const t = rig();
  t.mark('w1', 1, 0);
  t.mark('w3', 3, 1);                    // newest is the enemy's
  t.selector.step(1);
  const enemyNewest = snap(t);
  // A list of one.
  const u = rig();
  u.mark('w1', 1, 0);
  u.selector.toggle();
  const before = snap(u);
  u.selector.step(1);
  out.steps.enemyNewest = enemyNewest;
  out.steps.listOfOne = { before, after: snap(u) };
}

{
  // The endings: the marker is re-marked, and the marker times out.
  const s = rig();
  s.mark('w1', 1, 0);
  s.selector.toggle();
  const on = snap(s);
  s.state.now = 5;
  const second = s.mark('w1', 1, 5);
  s.cameras.step(5.1);
  const stillOld = snap(s);
  s.cameras.step(5.2);
  const removed = snap(s);               // the view is off, the selection not yet
  const secondsAfter = s.selector.frame();
  const framed = snap(s);
  s.state.now = 6;
  s.selector.toggle();
  const onSecond = snap(s);
  s.state.now = 123.9;
  const lastSecond = s.selector.frame();
  const beforeExpiry = snap(s);
  s.state.now = 124.5;
  const zero = s.selector.frame();
  out.endings = { on, second: second.id, stillOld, removed, secondsAfter, framed, onSecond,
    lastSecond, beforeExpiry, zero, expired: snap(s), restored: s.state.restored };

  // Leaving the seat with the view on: nothing is restored.
  const t = rig();
  t.mark('w1', 1, 0);
  t.selector.toggle();
  t.selector.leaveSeat();
  out.endings.left = { ...snap(t), restored: t.state.restored ?? 0 };
}

// --- the HUD --------------------------------------------------------------------

{
  const s = rig();
  s.mark('w1', 1, 0);
  s.mark('w3', 3, 1);
  s.mark('w2', 2, 2, miss);
  const live = teamMarkers(s.cameras, 1, 60).map(m => m.id);
  const dead = teamMarkers(s.cameras, 1, 120).map(m => m.id);
  out.hud = {
    live, dead,
    icon: [0, 1.4, 1.5, 2.9, 3.0].map(scoutIconFrame),
    blink: [0, 0.74, 0.75, 1.49, 1.5, 2.25].map(t => wedgeBlinkAlpha(t)),
    fade: [0, 0.5, 1.75, 3, 4].map(fadeAlpha),
    heading: { north: gazeHeading(0, 1), east: gazeHeading(1, 0), south: gazeHeading(0, -1) },
    scoutLine: scoutLine('Sgt. Rock', { SCOUT: 'Scout' }),
    calledLine: calledLine('Sgt. Rock', 118.7, { CALLED_FOR_ARTILLERY: 'called for artillery (timeleft' }),
  };
}

const table = { seats: [{ seat: 'Priest_Gunner_PCO1', externTrace: true }] };
out.seat = {
  hit: artSeat(table, 'priest_gunner_pco1')?.seat ?? null,
  miss: artSeat(table, 'Priest'),
  noTable: artSeat(null, 'Priest_Gunner_PCO1'),
};

process.stdout.write(JSON.stringify(out));
