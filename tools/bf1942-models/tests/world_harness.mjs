// Drives `viewer/world.js` headless under scripted input and prints one JSON
// blob. Same pattern as `flight_harness.mjs`: `tests/test_world.py` stands
// the vendored `three.module.js` up as a one-file package under `node_modules`
// (world.js's seats.js import reaches for `three`), then runs this file.
//
// The scenario is the P1 "done means" in miniature: two players on a fake
// level (no scene graph anywhere - a plain collider mock stands in for the
// page's built one), scripted inputs, 30 Hz world steps from a 60 fps feed,
// and the assertions the Python side re-checks are all computed here into one
// blob: N players stepping together, per-player input isolation, the forward
// walk law (1 s of forward walk ~= directionalSpeed x 1 s), backlog collapse
// at MAX_CATCH_UP_TICKS, and determinism (the same scripted stream twice
// gives identical final state).

import { World, WORLD_TICK_RATE, WORLD_TICK_DT } from './world.mjs';
import { MAX_CATCH_UP_TICKS, DIRECTIONAL_SPEED } from './physics.js';

const DT = 1 / 60;                 // the harness displays at 60 fps
const SECOND = WORLD_TICK_RATE;    // world ticks per second

// A collider mock with the two reads the world's own paths make: the surface
// height for pickSpawn/settle and the water level for HP-5. No triangles, no
// scene graph - the page's real collider is built in buildCollider() and the
// world never walks it.
const collider = {
  waterLevel: null,
  surfaceHeight(x, z) { return 0; },
  heightfield: null,
};

// scene.json-shaped level data: two flags (one per side), each owning a
// group of spawns at known positions.
const EXTRAS = {
  worldSize: 600,
  controlPoints: [
    { name: 'North', spawnGroupId: 1, team: 1, position: [10, 0, 10] },
    { name: 'South', spawnGroupId: 2, team: 2, position: [-10, 0, -10] },
  ],
  soldierSpawns: [
    // rotation [180,0,0] so `spawnYaw` (`PI - rotation[0]`) is 0 — the page
    // yaw that faces +Z on the flat mock ground.
    { name: 'N1', group: 1, team: 1, position: [10, 0, 10], rotation: [180, 0, 0] },
    { name: 'N2', group: 1, team: 1, position: [14, 0, 10], rotation: [180, 0, 0] },
    { name: 'S1', group: 2, team: 2, position: [-10, 0, -10], rotation: [180, 0, 0] },
    { name: 'S2', group: 2, team: 2, position: [-14, 0, -10], rotation: [180, 0, 0] },
  ],
  tickets: { 1: 100, 2: 100 },
};

const walk = { forward: 1, strafe: 0, walk: false, crouch: false, prone: false,
               jump: false, fire: false, altFire: false, roll: 0, pitch: 0, pad: false };

/** One 60 fps frame: newest input in, world steps, and nothing else. */
function frame(world, id, input, look = null) {
  world.setInput(id, input, look);
  return world.step(DT);
}

function makeWorld() {
  return new World({ collider, extras: EXTRAS, groundHeight: (x, z) => 0 });
}

// --- scenario 1: two players stepping together, inputs isolated -------------
// P1 walks forward for one full second; P2 stands still. The world must step
// both on the same 30 Hz clock - P2's stillness cannot bleed into P1 and P1's
// walk must not move P2.

const world = makeWorld();
const p1 = world.addPlayer('P1', { team: 1 });
const p2 = world.addPlayer('P2', { team: 2 });
const p1Spawn = { x: p1.soldier.x, y: p1.soldier.y, z: p1.soldier.z };
const p2Spawn = { x: p2.soldier.x, y: p2.soldier.y, z: p2.soldier.z };

let ticksRun = 0;
for (let i = 0; i < SECOND; i++) {
  frame(world, 'P1', walk);
  frame(world, 'P2', { ...walk, forward: 0 });
  ticksRun += 1;
}

const travelled = Math.hypot(
  p1.soldier.x - p1Spawn.x, p1.soldier.z - p1Spawn.z);
// The ramp (PHY-6) takes the first ~0.35 s to reach full speed, so a full
// second of forward walk travels *less* than 6 m: the pinned law is the
// engine's `directionalSpeed(stand, 1)` = 6 m/s table value reached after
// the ramp, asserted as "roughly directionalSpeed x time" within the
// ramp's own contribution.
const standForward = DIRECTIONAL_SPEED[0]; // [6, 4, 2, 2, 1, 1], forward, standing
const p2Still = Math.hypot(
  p2.soldier.x - p2Spawn.x, p2.soldier.z - p2Spawn.z);

// --- scenario 2: the 60 fps local-player mapping ---------------------------
// The page feeds setInput every display frame, the world consumes one input
// per 30 Hz tick. Over one second of forward walk at 60 fps the motion must
// equal the fixed-tick motion of scenario 1 (the deterministic body), which
// is the "same World code, same behavior" invariant in miniature.
const worldA = makeWorld();
const a = worldA.addPlayer('A', { team: 1 });
const aSpawn = { x: a.soldier.x, y: a.soldier.y, z: a.soldier.z };
for (let i = 0; i < SECOND * 2; i++) frame(worldA, 'A', walk);
const aTravelled = Math.hypot(
  a.soldier.x - aSpawn.x, a.soldier.z - aSpawn.z);

// --- scenario 3: backlog collapse -------------------------------------------
// The world clock is a FixedStep at MAX_CATCH_UP_TICKS: one giant dt (a
// backgrounded tab) must not replay a minute of accumulated motion; it runs
// at most MAX_CATCH_UP_TICKS world ticks and drops the rest. The soldier's
// own 60 Hz FixedStep applies its own cap the same way, so the whole
// pipeline is bounded.
const worldB = makeWorld();
const b = worldB.addPlayer('B', { team: 1 });
const bSpawn = { x: b.soldier.x, y: b.soldier.y, z: b.soldier.z };
worldB.setInput('B', walk);
worldB.step(3.0);                 // 90 world ticks owed; 12 may run
const bTicks = worldB.clock.ticks;
const bTravelled = Math.hypot(
  b.soldier.x - bSpawn.x, b.soldier.z - bSpawn.z);
// One input for the one tick that had anything buffered; the remaining
// catch-up ticks run the engine's zeroed word, exactly as a client that
// missed a second has its ship coasted to a stop rather than "helped".

// --- scenario 4: determinism -------------------------------------------------
// The same scripted stream twice => identical final state, byte for byte.
function runScripted(seedYaw) {
  const w = makeWorld();
  const p = w.addPlayer('P', { team: 1 });
  p.soldier.look(seedYaw, 0);
  for (let i = 0; i < SECOND; i++) {
    const yawPhase = (i % 4) === 0 ? 0.02 : 0;
    const look = yawPhase ? { x: 8, y: 0 } : null;
    frame(w, 'P', { ...walk, strafe: (i % 3) === 0 ? 1 : 0 }, look);
  }
  const s = p.soldier;
  return { x: s.x, y: s.y, z: s.z, yaw: s.body.yaw,
           hp: p.armor ? p.armor.hitPoints : null };
}
const scriptA = runScripted(0.3);
const scriptB = runScripted(0.3);
const same = JSON.stringify(scriptA) === JSON.stringify(scriptB);

// --- scenario 5: per-player look isolation ---------------------------------
// P1 looks right with the mouse while P2 looks left: each player's applied
// look must come out of his own axis pair, and only his own.
const worldC = makeWorld();
const c1 = worldC.addPlayer('C1', { team: 1 });
const c2 = worldC.addPlayer('C2', { team: 2 });
const yaw0 = { yaw: c1.soldier.body.yaw, pitch: c1.soldier.pitch };
for (let i = 0; i < SECOND / 2; i++) {
  frame(worldC, 'C1', walk, { x: 16, y: 0 });
  frame(worldC, 'C2', walk, { x: -16, y: 0 });
}
const lookC1 = worldC.report.players.C1.look;
const lookC2 = worldC.report.players.C2.look;

// --- scenario 6: the 30 fps per-tick cadence --------------------------------
// A true 30 fps display owes exactly one world tick per frame and feeds it
// the same way the page feeds 60 fps. The FixedStep + FIFO design must move
// the body the SAME distance in all three: the 60 fps feed (scenario 1),
// this 30 fps per-tick feed, and the deterministic body's own pinned result
// (scenario 1's 5.413 m -- the walk law, directionalSpeed x time minus the
// ramp).
const worldF = makeWorld();
const f = worldF.addPlayer('F', { team: 1 });
const fSpawn = { x: f.soldier.x, y: f.soldier.y, z: f.soldier.z };
for (let i = 0; i < SECOND; i++) {
  worldF.setInput('F', walk);
  worldF.step(1 / 30);
}
const fTravelled = Math.hypot(
  f.soldier.x - fSpawn.x, f.soldier.z - fSpawn.z);

// --- scenario 7: the engine-FIFO input semantics -----------------------------
// The page's un-sequenced feed never exercises these -- it stays at 0-1
// entries -- so here is the P2 wire in miniature: (D-2) the buffer trims to
// FOUR dropping the oldest (`clearPlayerActions` 0x0815bb90); (D-4) exactly
// ONE entry is consumed per tick, and a drained buffer yields the engine's
// zeroed idle word instead of a replay of the last input
// (`simulatePlayerUpdate` 0x0815bd00); (D-3) a duplicate sequence is ignored
// on the wire (`processRcvdPlayerActions` 0x08148470).
const worldD = makeWorld();
const d = worldD.addPlayer('D', { team: 1 });
const dSpawn = { x: d.soldier.x, y: d.soldier.y, z: d.soldier.z };
for (let seq = 1; seq <= 5; seq++) worldD.setInput('D', walk, null, seq);
const dPlayer = () => worldD.players.get('D');
const dCap = {
  lengthAfterFive: dPlayer().buffer.length,   // 4: seq 1 was dropped
  oldestAfterCap: dPlayer().buffer[0]?.seq,   // 2
  lastSeen: dPlayer().lastSeen,               // 5
};
worldD.step(1 / 30);
const consumed1 = dPlayer().last.seq;         // 2
worldD.step(1 / 30);
const consumed2 = dPlayer().last.seq;         // 3
const dOnePerTick = {
  consumed1,
  consumed2,
  remaining: dPlayer().buffer.length,         // 2
};
worldD.step(1 / 30);
worldD.step(1 / 30);
const consumed4 = dPlayer().last.seq;         // 5
worldD.step(1 / 30);                          // buffer empty -> idle word
const dIdle = {
  consumed4,
  idleOnEmpty: dPlayer().last.idle === true,
};
const dMoved = Math.hypot(
  d.soldier.x - dSpawn.x, d.soldier.z - dSpawn.z);
const dDedupe = [
  worldD.setInput('D', walk, null, 40),
  worldD.setInput('D', walk, null, 40),       // duplicate: ignored
  worldD.setInput('D', walk, null, 41),
];
const dDedupeState = {
  length: dPlayer().buffer.length,            // 2
  seqs: dPlayer().buffer.map(e => e.seq),     // [40, 41]
};

console.log(JSON.stringify({
  tickRate: WORLD_TICK_RATE,
  tickDt: WORLD_TICK_DT,
  maxCatchUpTicks: MAX_CATCH_UP_TICKS,
  scenario1: {
    ticksRun,
    p1Spawn, p2Spawn,
    p1Travelled: travelled,
    p2Still,
    standForward,
    p1Final: { x: p1.soldier.x, y: p1.soldier.y, z: p1.soldier.z,
               yaw: p1.soldier.body.yaw },
    p2Final: { x: p2.soldier.x, y: p2.soldier.y, z: p2.soldier.z,
               yaw: p2.soldier.body.yaw },
    p2LookApplied: world.report.players.P2.look,
  },
  scenario2: {
    frames: SECOND * 2,
    aTravelled,
    aFinal: { x: a.soldier.x, y: a.soldier.y, z: a.soldier.z,
              yaw: a.soldier.body.yaw },
    matchesFixedTick: Math.abs(aTravelled - travelled) < 1e-9,
  },
  scenario3: {
    owedTicks: 90,
    ranTicks: bTicks,
    maxTicks: MAX_CATCH_UP_TICKS,
    bTravelled,
    collapsed: bTicks === MAX_CATCH_UP_TICKS,
  },
  scenario4: { same, scriptA },
  scenario5: {
    c1Look: lookC1,
    c2Look: lookC2,
    c1Turned: Math.abs(c1.soldier.body.yaw - yaw0.yaw) > 0.1,
    c2Turned: Math.abs(c2.soldier.body.yaw - yaw0.yaw) > 0.1,
    c2Opposite: Math.sign(c1.soldier.body.yaw - yaw0.yaw)
      === -Math.sign(c2.soldier.body.yaw - yaw0.yaw),
  },
  scenario6: {
    frames: SECOND,
    fTravelled,
    matches60fps: Math.abs(fTravelled - travelled) < 1e-9,
    matchesPinned: Math.abs(fTravelled - 5.413) < 0.01,
  },
  scenario7: {
    cap: dCap,
    onePerTick: dOnePerTick,
    idle: dIdle,
    dedupe: dDedupeState,
    movedOverTheSqueeze: dMoved,
  },
}));