// Drives `viewer/soldier-face.js` outside a browser and prints one JSON blob.
// `tests/test_soldier_face.py` hands in the viewer directory and the face
// states the vanilla scripts declare (`extract_pose.face_manifest`), so the
// module under test is the one the page loads, on the game's own data.

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const VIEWER = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const F = await import(pathToFileURL(path.join(VIEWER, 'soldier-face.js')).href);

const out = {};
out.constants = {
  lodDistance: F.SOLDIER_LOD_DISTANCE, lodValue: F.FACE_LOD_VALUE, base: F.FACE_BASE_STATE,
  viseme: F.VISEME_SECONDS, rest: F.SPEAK_REST_SECONDS, idleBase: F.IDLE_BASE_SECONDS,
};
out.lipSync = F.LIP_SYNC;
out.lipSyncFor = {
  germanSoldier29: F.lipSync('GermanSoldier', 29),
  german29: F.lipSync('German', 29),
  usSoldier40: F.lipSync('USSoldier', 40),
  none33: F.lipSync('USSoldier', 33),
  proto: F.lipSync('constructor', 29),
};
out.gate = {
  at5: F.faceDrawn(5, 1), at5_01: F.faceDrawn(5.01, 1), at4: F.faceDrawn(4, 1),
  zoomed9: F.faceDrawn(9, 0.5), zoomed11: F.faceDrawn(11, 0.5),
  lod250: F.soldierLod(250, 1), lodFar: F.soldierLod(9000, 1),
  fov1rad: F.viewFieldOfView(180 / Math.PI, 1),
};
const B = manifest.bodyStates;
out.body = {
  fireThompson: F.bodyFaceState(B, 'stand.lower', 'Ub_Fire', 'Thompson'),
  fireKnife: F.bodyFaceState(B, 'stand.lower', 'Ub_Fire', 'KnifeAllies'),
  fireKnifeAxis: F.bodyFaceState(B, 'stand.lower', 'Ub_Fire', 'KnifeAxis'),
  fireK98: F.bodyFaceState(B, 'stand.lower', 'Ub_Fire', 'K98'),
  lieFireK98: F.bodyFaceState(B, 'lie.lower', 'Ub_LieFire', 'K98'),
  fireMedPack: F.bodyFaceState(B, 'stand.lower', 'Ub_Fire', 'MedPack'),
  fireExpPack: F.bodyFaceState(B, 'stand.lower', 'Ub_Fire', 'ExpPack'),
  fireNoWeapon: F.bodyFaceState(B, 'stand.lower', 'Ub_Fire', ''),
  die: F.bodyFaceState(B, 'Lb_DieChestStand', 'Ub_DieChestStand', 'K98'),
  dieHead: F.bodyFaceState(B, 'Lb_DieHead', null, 'K98'),
  hit: F.bodyFaceState(B, 'stand.lower', 'Ub_HitChestStand', 'Thompson'),
  blast: F.bodyFaceState(B, 'Lb_ExplosionForward', 'Ub_ExplosionForward', 'Thompson'),
  landed: F.bodyFaceState(B, 'Lb_ExplosionLandFront', 'Ub_ExplosionForward', 'Thompson'),
  jump: F.bodyFaceState(B, 'Lb_StandJump', 'Ub_StandJump', 'Thompson'),
  draw: F.bodyFaceState(B, 'stand.lower', 'Ub_StandRaiseWeapon', 'Colt'),
  stand: F.bodyFaceState(B, 'stand.lower', 'stand.upper', 'Thompson'),
};

// The head a soldier wears: even over the three, the same for the same id.
{
  const tally = [0, 0, 0];
  for (let i = 0; i < 300; i++) tally[F.headVariant(`bot_${i}`, 3) - 1] += 1;
  out.heads = { tally, again: [F.headVariant('bot_7', 3), F.headVariant('bot_7', 3)],
                one: F.headVariant('bot_7', 1), anonymous: F.headVariant(null, 3),
                slots: [0, 1, 2, 3, 4, 5].map(n => F.headVariant(`slot:${n}`, 3)) };
}

// A seeded `random`, so the idle draws are the test's.
const seq = values => { let i = 0; return () => values[i++ % values.length]; };
const machine = (random = () => 0) => new F.FaceMachine({
  states: manifest.states, symbols: manifest.symbols, base: manifest.base, random });

// --- the idle: FaceLook, the timer, the draw, the return ---------------------
{
  // random 0 -> a 4 s timer, and idle 0 of 9; 0.99 -> 7 s, idle 8.
  const log = [];
  // The draws in order: FaceLook's timer (4 s), its idle (1 of 9, FaceBlink),
  // the blink's own timer, FaceLook's again (7 s), its idle (8, FaceAngry1).
  const m = machine(seq([0, 1 / 9 + 0.01, 0.99, 0.99, 0.99]));
  const dt = 1 / 60;
  let last = m.name;
  log.push([0, last]);
  for (let t = dt; t < 12; t += dt) {
    const s = m.update(dt);
    if (s.name !== last) { last = s.name; log.push([+t.toFixed(2), last]); }
  }
  out.idle = { log, blinkSeconds: 1 / Math.abs(manifest.states.FaceBlink.speed) };
}

// --- a shout: 0.1 s a symbol, 0.5 s, then FaceLook ---------------------------
{
  const m = machine();
  const dt = 0.01;
  m.update(dt);
  m.speak('i_e;');
  const log = [];
  let last = m.name;
  for (let k = 1; k <= 200; k++) {
    const s = m.update(dt);
    if (s.name !== last) { last = s.name; log.push([+(k * dt).toFixed(2), last]); }
  }
  out.shout = { log };
  // A symbol no state answers takes no time; the body's state waits for the line.
  const n = machine();
  n.update(dt);
  n.speak('?o');
  n.update(dt);                       // pops '?': no state, no time
  const afterUnknown = n.name;
  n.update(dt);                       // pops 'o'; the list is empty: 0.5 s
  const afterO = n.name;
  n.speak('mm');
  n.update(dt, 'FaceHit');            // a line is queued: the body's face waits
  const gated = n.name;
  let sawM = false;
  for (let k = 0; k < 60; k++) { n.update(dt, 'FaceHit'); sawM ||= n.name === 'Face_normal_m'; }
  out.shoutRules = { afterUnknown, afterO, gated, sawM, afterLine: n.name };
}

// --- the body: a one-shot the body still names is entered again -------------
{
  const m = machine();
  const dt = 0.05;
  const log = [];
  for (let k = 0; k < 50; k++) {
    const s = m.update(dt, 'FaceHit');
    log.push(s.name);
  }
  const enters = log.filter((n, i) => n === 'FaceHit' && log[i - 1] !== 'FaceHit').length;
  // Dead: no return, the last frame held.
  const d = machine();
  let s = null;
  for (let k = 0; k < 100; k++) s = d.update(dt, 'FaceDead1');
  out.bodyRules = { hitEnters: enters, looks: log.filter(n => n === 'FaceLook').length,
                    dead: s.name, deadPhase: s.time / s.seconds, deadW: s.w };
}

// --- the overlay on bones: morph from where the bone stands ------------------
{
  const q = { x: 0, y: 0, z: 0, w: 1 };
  const p = { x: 0, y: 0, z: 0 };
  const half = Math.SQRT1_2;
  const track = (name, values) => ({ name, createInterpolant: () => ({ evaluate: () => values }) });
  const clips = [
    { name: 'FaceLook', duration: 2, tracks: [track('Face_Bone07.quaternion', [0, 0, 0, 1]),
                                              track('Face_Bone07.position', [0, 0, 0])] },
    { name: 'Face_normal_o', duration: 33.3333, tracks: [track('Face_Bone07.quaternion', [half, 0, 0, half]),
                                                         track('Face_Bone07.position', [0, 0.02, 0])] },
  ];
  const overlay = new F.FaceOverlay({
    clips, findBone: name => (name === 'Face_Bone07' ? { quaternion: q, position: p } : null),
    states: manifest.states, symbols: manifest.symbols, base: manifest.base, random: () => 0 });
  overlay.update(0.01);
  overlay.speak('o');
  const frames = [];
  for (let k = 0; k < 12; k++) {
    overlay.update(0.01);
    frames.push({ state: overlay.playing, angle: +(2 * Math.asin(Math.min(1, Math.abs(q.x))) * 180 / Math.PI).toFixed(2), y: +p.y.toFixed(5) });
  }
  out.overlay = { frames };
}

console.log(JSON.stringify(out));
