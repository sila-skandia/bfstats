// The replay's creator view under node (features/replay-creator-view): the
// camera track's path, picking in screen space, the round cam finding its
// round and running its clock, the shot's slow motion and the round worth
// riding, the clip's file names and the gate. One node run, one JSON report,
// the modules imported from the viewer tree in place through `sim/env.mjs`;
// `test_replay_creator.py` reads it.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, T, P, RC, C, R, S] = await Promise.all([
  imp('vendor/three.module.js'), imp('replay-camtrack.js'), imp('replay-pick.js'), imp('replay-roundcam.js'),
  imp('replay-clip.js'), imp('replay-recording.js'), imp('replay-shot.js'),
]);

const results = {};
const round = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n;
const vec = v => [round(v.x), round(v.y), round(v.z)];

// --- the camera track ---------------------------------------------------------------------------
//
// Three keys: at 10 s the camera at the origin looking down -Z, at 12 s ten
// metres along +X turned a quarter left, at 16 s back at the origin, 20 m up,
// looking the same way as the first. The second key's quaternion is written
// negated, the same rotation from the other hemisphere.
{
  const q = (yaw) => {
    const out = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    return [out.x, out.y, out.z, out.w];
  };
  const neg = a => a.map(v => -v);
  let keys = [];
  keys = T.addKey(keys, { t: 12, pos: [10, 0, 0], quat: neg(q(Math.PI / 2)), fov: 40 });
  keys = T.addKey(keys, { t: 10, pos: [0, 0, 0], quat: q(0), fov: 60 });
  keys = T.addKey(keys, { t: 16, pos: [0, 20, 0], quat: q(0), fov: 60 });
  const at = t => T.poseAt(keys, t);
  const yawOf = quat => {
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
    return round((Math.atan2(-f.x, -f.z) * 180) / Math.PI, 1);
  };
  const sample = [9, 10, 11, 12, 14, 16, 17].map(t => {
    const p = at(t);
    return { t, pos: vec(p.pos), yaw: yawOf(p.quat), fov: round(p.fov ?? -1, 2) };
  });
  // The yaw across the negated key must turn the short way: never past 90.
  let maxYaw = 0;
  for (let t = 10; t <= 12; t += 0.05) maxYaw = Math.max(maxYaw, Math.abs(yawOf(at(t).quat)));
  // Smooth through the middle key: the velocity either side of 12 s matches.
  const v = (a, b) => at(b).pos.clone().sub(at(a).pos).divideScalar(b - a);
  const before = v(11.99, 12);
  const after = v(12, 12.01);
  const merged = T.addKey(keys, { t: 12.03, pos: [5, 5, 5], quat: q(0) });
  results.track = {
    order: keys.map(k => k.t),
    sample,
    maxYaw,
    kink: round(before.distanceTo(after), 3),
    speedAt12: round(before.length(), 2),
    merged: merged.map(k => k.t),
    valid: [
      T.keyValid(keys[0]),
      T.keyValid({ t: 1, pos: [0, NaN, 0], quat: [0, 0, 0, 1] }),
      T.keyValid({ t: 1, pos: [0, 0, 0], quat: [0, 0, 0, 0] }),
      T.keyValid({ t: 1, pos: [0, 0, 0], quat: [0, 0, 0, 1], fov: 500 }),
    ],
    path: T.pathPoints(keys, 5).map(p => p.map(x => round(x, 2))),
    none: T.poseAt([], 5),
    one: vec(T.poseAt([keys[1]], 99).pos),
  };
}

// --- picking --------------------------------------------------------------------------------
//
// A camera at the origin looking down -Z, 90 degrees high, on an 800 x 600
// view. A soldier 20 m ahead, a round 10 m ahead in front of him and a hand
// to the side, a tank 60 m ahead to the left, a man behind the camera.
{
  const camera = new THREE.PerspectiveCamera(90, 800 / 600, 0.1, 5000);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const soldier = { kind: 'soldier', pid: 1, pos: new THREE.Vector3(0, 0, -20), radius: 0.8 };
  const roundCand = { kind: 'round', pos: new THREE.Vector3(0.3, 0, -10), radius: 0.4 };
  const tank = { kind: 'hull', pos: new THREE.Vector3(-30, 0, -60), radius: 4 };
  const behind = { kind: 'soldier', pid: 2, pos: new THREE.Vector3(0, 0, 10), radius: 0.8 };
  const far = { kind: 'soldier', pid: 3, pos: new THREE.Vector3(200, 0, -1000), radius: 0.8 };
  const all = [soldier, roundCand, tank, behind, far];
  const pick = (x, y) => {
    const hit = P.pickAt(all, camera, x, y, 800, 600);
    return hit ? { kind: hit.cand.kind, pid: hit.cand.pid ?? null, x: round(hit.x, 1), y: round(hit.y, 1), r: round(hit.r, 1) } : null;
  };
  const farAt = P.project(far.pos, camera, 800, 600);
  results.pick = {
    centre: pick(400, 300),
    onTheRound: pick(409, 300),
    offCentre: pick(400, 285),
    tank: pick(400 - (30 / 60) * 300, 300),
    nothing: pick(700, 100),
    behind: P.project(behind.pos, camera, 800, 600),
    farExact: pick(farAt.x, farAt.y),
    farNear: pick(farAt.x + 8, farAt.y),
    farMiss: pick(farAt.x + 14, farAt.y),
    ppm: round(P.pixelsPerMetre(camera, 600, 10), 2),
  };
  // A candidate's own bonus asks for it ahead of a nearer one: the round of
  // a burst that kills, among the rounds around it.
  const near = { kind: 'round', pos: new THREE.Vector3(0.3, 0, -10), radius: 0.4 };
  const killing = { kind: 'round', pos: new THREE.Vector3(0, 0, -10), radius: 0.4, bonus: 0.8 };
  results.bonus = {
    without: P.pickAt([near, { ...killing, bonus: 0 }], camera, 407, 300, 800, 600)?.cand === near,
    with: P.pickAt([near, killing], camera, 407, 300, 800, 600)?.cand === killing,
  };
  // The shot a live round came from: its origin and heading against the
  // recording's (BF1942 frame, z negated).
  const fires = [
    { t: 4, pid: 7, pos: [0, 1, 5], dir: [0, 0, 1] },
    { t: 5, pid: 8, pos: [0, 1, 5], dir: [1, 0, 0] },
    { t: 5.5, pid: 9, pos: [50, 1, 5], dir: [0, 0, 1] },
  ];
  const obj = { origin: [0, 1, -5], velocity: new THREE.Vector3(0, 0, -300) };
  results.shotOfRound = {
    found: P.shotOfRound(fires, obj, 6)?.pid ?? null,
    tooOld: P.shotOfRound(fires, obj, 20)?.pid ?? null,
  };
}

// --- the round cam --------------------------------------------------------------------------
//
// A recorded round: A1 at the origin fires along BF1942's +Z (the view's -Z)
// at 10 s and kills B1, 30 m off, at 10.3 s. The page's guns are stood in and
// rounds laid in them by hand as the page would fire them: one of an earlier
// burst on the same line at 9.95 s, then the shot's own, then a stray. The
// page's round need not strike B1's drawn body: the chase ends at him.
{
  const lines = [];
  const L = o => lines.push(JSON.stringify(o));
  L({ k: 'h', v: 5 });
  L({ k: 'e', t: 0.2, e: 'createPlayer', pid: 4, name: 'A1', team: 1, ai: 1 });
  L({ k: 'e', t: 0.2, e: 'createPlayer', pid: 9, name: 'B1', team: 2, ai: 1 });
  for (const [nid, pid, team, pos] of [[400, 4, 1, [0, 0, 0]], [900, 9, 2, [0, 0, 30]]]) {
    L({ k: 'e', t: 1, e: 'createObject', netId: nid, tmpl: team === 1 ? 'GermanSoldier' : 'USSoldier', tid: 1700 + team, pos, rot: [0, 0, 0] });
    L({ k: 'o', t: 1, id: nid, tmpl: team === 1 ? 'GermanSoldier' : 'USSoldier', tid: 1700 + team, team, maxhp: 30 });
    L({ k: 's', t: 1, o: [[nid, pos[0], pos[1] + 1, pos[2], 0, 0, 0, 1]] });
    L({ k: 'p', t: 1, p: [[pid, team, nid]] });
  }
  L({ k: 'f', t: 10, pid: 4, id: 400, w: 'K98Sniper', p: [0, 1.6, 0], d: [0, 0, 1] });
  L({ k: 'e', t: 10.3, e: 'score', kind: 3, pid: 4, victim: 9, weaponName: 'K98Sniper' });
  L({ k: 's', t: 20, o: [] });
  const rec = R.parseRecording(lines.join('\n'));
  const f = rec.fires[0];
  const kill = rec.kills.find(k => k.kind === 'kill');
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
  const guns = { tracers: [], projectiles: [] };
  const followed = [];
  const player = {
    time: 0, speed: 1, playing: true, followPid: 4, kills: rec.kills, rec,
    ctx: { camera, guns, scene: new THREE.Scene(), groundHeight: () => 0, waterLevel: () => null },
    camera: { rig: null, setRig(r) { this.rig = r; } },
  };
  const cam = new RC.RoundCam(player, { follow: pid => followed.push(pid), changed: () => {} });
  cam.bulletTime = RC.BULLET_TIME.strong;
  const tracer = (origin, dir, speed = 800) => ({
    mesh: { position: new THREE.Vector3(...origin), visible: true },
    velocity: new THREE.Vector3(...dir).multiplyScalar(speed),
    origin: [...origin], lead: 0, age: 0,
  });
  const frame = (dt = 1 / 60) => {
    player.time += dt * player.speed;
    cam.step(player.time, dt);
    // The page flies what is in the air: straight on, no gravity.
    for (const obj of guns.tracers) obj.mesh.position.addScaledVector(obj.velocity, dt * player.speed);
    return cam.place(camera, dt, player.time);
  };
  player.time = 6;
  const armed = cam.arm(f, { kill });
  const victimAt = cam.target.victimAt ? vec(cam.target.victimAt) : null;
  const victimDist = round(cam.target.victimDist ?? -1, 2);
  const early = frame();
  const burst = tracer([0, 1.6, 0], [0, 0, -1]);
  while (player.time < 10) {
    if (player.time >= 9.95 && !guns.tracers.includes(burst)) guns.tracers.push(burst);
    frame();
  }
  const speedAtShot = player.speed;
  const own = tracer([0.1, 1.62, 0], [0, 0.002, -1]);
  const stray = tracer([30, 1, -3], [0, 0, -1]);
  guns.tracers.push(own, stray);
  frame();
  const claimed = cam.target?.obj === own ? 'own' : cam.target?.obj === burst ? 'burst' : cam.target?.obj === stray ? 'stray' : null;
  const state1 = cam.state;
  for (let i = 0; i < 20; i++) frame();
  const behindBy = round(camera.position.z - own.mesh.position.z, 2);
  const speedInFlight = round(player.speed, 4);
  const streakHidden = own.mesh.visible === false;
  // On to the man it killed, without the page's round ever striking him.
  let realFlight = 21 / 60;
  while (cam.state === 'flying' && realFlight < 20) {
    frame();
    realFlight += 1 / 60;
  }
  const state2 = cam.state;
  const impactAt = cam.impact ? vec(cam.impact.at) : null;
  let frames = 0;
  while (cam.state !== 'idle' && frames < 2000) {
    frame();
    frames++;
  }
  results.roundcam = {
    armed, victimAt, victimDist, early, speedAtShot: round(speedAtShot, 3), claimed, state1, behindBy, speedInFlight,
    streakHidden, realFlight: round(realFlight, 2), state2, impactAt, endState: cam.state, speedAfter: player.speed, followed,
    rigReleased: player.camera.rig === null, heldPastKill: round(player.time - 10.3, 2) >= 0.9,
    endsAtCamera: vec(camera.position),
  };
  // A round with no known end (a click on it, a shot that killed nobody): at
  // the preset's pace, and let go after a while.
  player.time = 11.5;
  player.speed = 1;
  guns.tracers.length = 0;
  const loose = tracer([0, 1.6, 0], [1, 0, 0]);
  guns.tracers.push(loose);
  cam.chaseObject(loose);
  let looseReal = 0;
  while (cam.state === 'flying' && looseReal < 20) {
    frame();
    looseReal += 1 / 60;
  }
  results.roundcam.loose = { realFlight: round(looseReal, 1), state: cam.state };
  while (cam.state !== 'idle') frame();
  // A seek while a round flies: nothing to chase any more.
  player.time = 20;
  player.speed = 1;
  guns.tracers.length = 0;
  const f2 = { ...f, t: 21 };
  cam.arm(f2);
  while (player.time < 21) frame();
  const round2 = tracer([0, 1.6, 0], [0, 0, -1]);
  guns.tracers.push(round2);
  frame();
  const flying = cam.state;
  player.time = 40;
  frame();
  results.roundcam.seek = { flying, after: cam.state, speed: player.speed };
  // A shot with no round of its own: it gives up after GIVE_UP.
  player.time = 29;
  player.speed = 1;
  const f3 = { ...f, t: 30 };
  cam.arm(f3);
  let missed = 0;
  cam.hooks.missed = () => missed++;
  while (player.time < 31 && cam.state !== 'idle') frame();
  results.roundcam.missed = { state: cam.state, missed, at: round(player.time, 2), speed: round(player.speed, 3) };
  // Taken past an armed shot by hand (a seek): let go without a word.
  player.time = 34;
  player.speed = 1;
  cam.arm({ ...f, t: 36 });
  frame();
  player.time = 50;
  frame();
  results.roundcam.seekPast = { state: cam.state, missed, speed: player.speed };
  results.roundcam.helpers = {
    slow: [[800, 'strong', null], [75, 'strong', null], [20, 'strong', null], [800, 'off', null], [2000, 'strong', 340],
      [2000, 'strong', 20], [75, 'extreme', 60]].map(([s, p, d]) => round(RC.slowFor(s, RC.BULLET_TIME[p], d), 4)),
    guess: ['Bazooka', 'Panzershreck', 'GrenadeAllies', 'MustangBombDummy', 'TigerGunBarrel', 'Thompson'].map(RC.guessSpeed),
    ray: (() => {
      const pos = new THREE.Vector3();
      const dir = new THREE.Vector3();
      const ok = RC.shotRay({ pos: [1, 2, 3], dir: [0, 0, 2] }, pos, dir);
      return { ok, pos: vec(pos), dir: vec(dir), none: RC.shotRay({ pos: [0, 0, 0], dir: [0, 0, 0] }, pos, dir) };
    })(),
    next: (() => {
      const fires = [
        { t: 1, pid: 1, dir: [0, 0, 1], press: false },
        { t: 2, pid: 2, dir: [0, 0, 1], press: false },
        { t: 3, pid: 1, dir: [0, 0, 1], press: true },
        { t: 4, pid: 1, dir: [0, 0, 1], press: false, feedOnly: true },
        { t: 5, pid: 1, dir: [0, 0, 1], press: false },
      ];
      return [0, 1.5, 6].map(t => RC.nextShotOf({ fires }, 1, t)?.t ?? null);
    })(),
    heavy: ['Bazooka', 'TigerGunBarrel', 'GrenadeAllies', 'MustangBombDummy', 'Thompson', 'No4Sniper', ''].map(RC.heavyRound),
    nextHeavy: (() => {
      const fires = [
        { t: 1, pid: 1, dir: [0, 0, 1], weapon: 'Thompson' },
        { t: 2, pid: 2, dir: [0, 0, 1], weapon: 'Bazooka' },
        { t: 3, pid: 1, dir: [0, 0, 1], weapon: 'GrenadeAllies' },
      ];
      const rec = { fires };
      return [RC.nextShotOf(rec, 1, 0, { heavy: true })?.t ?? null, RC.nextShotOf(rec, null, 0, { heavy: true })?.t ?? null,
        RC.nextShotOf(rec, null, 0)?.t ?? null];
    })(),
  };
}

// --- a grenade the recording carries -----------------------------------------------------------
{
  const lines = [];
  const L = o => lines.push(JSON.stringify(o));
  L({ k: 'h', v: 5 });
  L({ k: 'e', t: 0.2, e: 'createPlayer', pid: 1, name: 'A1', team: 1, ai: 1 });
  L({ k: 'e', t: 1, e: 'createObject', netId: 900, tmpl: 'GrenadeAxisProjectile', tid: 50, pos: [0, 0, 0], rot: [0, 0, 0] });
  L({ k: 'o', t: 1, id: 900, tmpl: 'GrenadeAxisProjectile', tid: 50, team: 1 });
  for (let i = 0; i <= 20; i++) {
    const t = 5.8 + i * 0.1;
    L({ k: 's', t: +t.toFixed(2), o: [[900, 10 + i * 0.9, 2 + i * 0.1 - 0.02 * i * i, 20, 0, 0, 0, 1]] });
  }
  L({ k: 'f', t: 5, pid: 1, id: 100, w: 'GrenadeAxis', p: [10, 2, 20], d: [1, 0.3, 0] });
  const rec = R.parseRecording(lines.join('\n'));
  R.markRounds(rec, tmpl => /Projectile$/.test(tmpl));
  const f = rec.fires[0];
  const found = RC.thrownLifeOf(rec, f);
  results.thrown = { found: found?.life.nid ?? null, from: found ? round(found.from, 2) : null, far: RC.thrownLifeOf(rec, { ...f, pos: [90, 2, 20] }) };
}

// --- the shot: its slow motion, its keys, the round worth riding -------------------------------
//
// A clip from 10 s to 16 s slowed to a quarter, eased over half a second at
// each end. A1 (pid 4) kills at 12 s with the third round of a burst and at
// 30 s with a bazooka; B1 (pid 5) kills at 20 s with no round the recording
// could name; A1's team kill at 33 s is never offered.
{
  const span = { t0: 10, t1: 16 };
  const ramp = { in: null, out: null, speed: 0.25, ease: 0.5 };
  const at = t => {
    const v = S.rampSpeedAt(ramp, span, t, 1);
    return v === null ? null : round(v, 4);
  };
  const fires = [
    { t: 11, pid: 4, weapon: 'Thompson', dir: [0, 0, 1] },
    { t: 11.1, pid: 4, weapon: 'Thompson', dir: [0, 0, 1] },
    { t: 11.2, pid: 4, weapon: 'Thompson', dir: [0, 0, 1] },
    { t: 29.5, pid: 4, weapon: 'Bazooka', dir: [0, 0, 1] },
  ];
  const kills = [
    { t: 12, kind: 'kill', killer: 4, victim: 9 },
    { t: 20, kind: 'kill', killer: 5, victim: 4 },
    { t: 30, kind: 'kill', killer: 4, victim: 7 },
    { t: 33, kind: 'teamkill', killer: 4, victim: 3 },
  ];
  const facts = new Map([
    [kills[0], { round: { f: fires[2] } }],
    [kills[1], { round: null }],
    [kills[2], { round: { f: fires[3] } }],
    [kills[3], { round: { f: fires[0] } }],
  ]);
  const nk = (pid, t) => {
    const n = S.nextKillShot(facts, pid, t);
    return n ? [n.f.t, n.kill.victim] : null;
  };
  results.shot = {
    ramp: [9.9, 10, 10.25, 10.5, 13, 15.5, 15.75, 16, 16.2].map(at),
    off: S.rampSpeedAt({ ...ramp, speed: 1 }, span, 13, 1),
    noSpan: S.rampSpeedAt(ramp, null, 13, 1),
    slower: round(S.rampSpeedAt(ramp, span, 13, 0.5), 4),
    inside: S.rampSpanOf({ in: 2, out: 99, speed: 0.5 }, span),
    part: S.rampSpanOf({ in: 12, out: null, speed: 0.5 }, span),
    collapsed: S.rampSpanOf({ in: 2, out: 4, speed: 0.5 }, span),
    words: [1, 0.5, 0.25, 0.1].map(S.speedWord),
    kept: S.rampOf({ speed: 0.3, in: 'x', out: 12, ease: 99 }),
    keysIn: S.keysIn([{ t: 5 }, { t: 10 }, { t: 12 }, { t: 16 }, { t: 20 }], span).map(k => k.t),
    between: S.rampBetweenKeys([{ t: 5 }, { t: 10.5 }, { t: 13 }, { t: 15 }, { t: 20 }], span),
    betweenOne: S.rampBetweenKeys([{ t: 5 }, { t: 12 }, { t: 20 }], span),
    betweenNone: S.rampBetweenKeys([{ t: 10.5 }, { t: 15 }], null),
    byFire: [...S.killByFire(facts).values()].map(k => k.t),
    next: [nk(4, 0), nk(4, 11.15), nk(4, 11.5), nk(null, 0), nk(5, 0), nk(4, 31)],
  };
}

// --- the action inside a clip, and the move fitted to it ----------------------------------------
//
// The owner's 2026-10-18 report: a bazooka clipped round its kill. RuppoPeaGame
// fires at 224.058 and the tank blows up at 224.958; the clip is marked with a
// 3 s lead-in and a 2.5 s tail, so it runs 221.058 to 227.458. A move keyed at
// those ends spreads 6.4 s of camera over 0.9 s of action.
{
  const fire = 224.058;
  const hit = 224.958;
  const clip = { t0: fire - 3, t1: hit + 2.5 };
  const action = S.actionOf(fire, hit, clip);
  const pose = t => ({ t, pos: [t, 0, 0], quat: [0, 0, 0, 1] });
  // The move as A and B used to stamp it: at the clip's own ends.
  const wide = [pose(clip.t0), pose(clip.t1)];
  const fitted = S.fitKeys(wide, clip, action);
  // Three keys: the middle one keeps its place proportionally.
  const three = [pose(clip.t0), pose(clip.t0 + 1.6), pose(clip.t1)];
  const ramp = { in: action.t0, out: action.t1, speed: 0.25, ease: S.RAMP_EASE };
  results.action = {
    action: [round(action.t0), round(action.t1)],
    // A sniper's round kills 0.16 s after the trigger: grown to ACTION_MIN.
    sniper: (a => [round(a.t0), round(a.t1)])(S.actionOf(41.991, 42.152, { t0: 38.991, t1: 44.652 })),
    // A moment with no hit of its own still gets a stretch to move over.
    moment: (a => round(a.t1 - a.t0))(S.actionOf(100, 100, { t0: 97, t1: 102.5 })),
    // Held inside the clip: an action the clip has no room for is nothing.
    clamped: (a => a && [round(a.t0), round(a.t1)])(S.actionOf(10, 40, { t0: 9, t1: 11 })),
    none: S.actionOf(10, 40, { t0: 10, t1: 10 }),
    notATime: S.actionOf(null, 5, clip),
    fitted: fitted?.map(k => round(k.t)) ?? null,
    fittedKeepsPose: fitted ? fitted.map(k => round(k.pos[0])) : null,
    fitThree: S.fitKeys(three, clip, action)?.map(k => round(k.t)) ?? null,
    fitAlready: S.fitKeys([pose(action.t0), pose(action.t1)], clip, action),
    fitOne: S.fitKeys([pose(action.t0)], clip, action),
    fitNoBeat: S.fitKeys(wide, clip, null),
    // A key outside the clip is left where it is.
    fitOutside: S.fitKeys([pose(10), ...wide], clip, action)?.map(k => round(k.t)) ?? null,
    // What the viewer waits. The wide move is 6.4 s of the round; at a
    // quarter over the action alone it is longer still, and almost all of it
    // runs after the tank has gone up.
    wideWatch: round(S.screenSeconds(ramp, clip, clip.t0, clip.t1), 2),
    wideToHit: round(S.screenSeconds(ramp, clip, clip.t0, hit), 2),
    fittedWatch: round(S.screenSeconds(ramp, clip, action.t0, action.t1), 2),
    atSpeed: round(S.screenSeconds({ ...ramp, speed: 1 }, clip, action.t0, action.t1), 2),
    backwards: S.screenSeconds(ramp, clip, action.t1, action.t0),
  };
}

// --- the clip's file name -------------------------------------------------------------------------
results.clip = {
  mp4: C.clipName('Battle of Kursk', 161.2, 172.9, 'video/mp4;codecs=avc1'),
  webm: C.clipName('wake', 5, 65, 'video/webm;codecs=vp9'),
  none: C.clipName('', 0, 1, null),
  mime: C.recorderMime(true),
};

// --- shot styles, and a knife's kill ----------------------------------------------------------
//
// The same two men: A1 at the origin, B1 30 m down the view's -Z. One take
// of each style on a rifle round at 10 s that kills him at 10.3 s, the page's
// round flown straight on; then a knife's swing at 10 s that kills a man 2 m
// off, with the page's own knife round in the air beside it.
{
  const SS = await imp('replay-shotstyle.js');
  const D = await imp('replay-dossier.js');
  const build = (weapon, victimZ) => {
    const lines = [];
    const L = o => lines.push(JSON.stringify(o));
    L({ k: 'h', v: 5 });
    L({ k: 'e', t: 0.2, e: 'createPlayer', pid: 4, name: 'A1', team: 1, ai: 1 });
    L({ k: 'e', t: 0.2, e: 'createPlayer', pid: 9, name: 'B1', team: 2, ai: 1 });
    for (const [nid, pid, team, pos] of [[400, 4, 1, [0, 0, 0]], [900, 9, 2, [0, 0, victimZ]]]) {
      L({ k: 'e', t: 1, e: 'createObject', netId: nid, tmpl: team === 1 ? 'GermanSoldier' : 'USSoldier', tid: 1700 + team, pos, rot: [0, 0, 0] });
      L({ k: 'o', t: 1, id: nid, tmpl: team === 1 ? 'GermanSoldier' : 'USSoldier', tid: 1700 + team, team, maxhp: 30 });
      L({ k: 's', t: 1, o: [[nid, pos[0], pos[1] + 1, pos[2], 0, 0, 0, 1]] });
      L({ k: 'p', t: 1, p: [[pid, team, nid]] });
    }
    L({ k: 'f', t: 10, pid: 4, id: 400, w: weapon, p: [0, 1.6, 0], d: [0, 0, 1] });
    L({ k: 'e', t: 10.3, e: 'score', kind: 3, pid: 4, victim: 9, weaponName: weapon });
    L({ k: 's', t: 20, o: [] });
    return R.parseRecording(lines.join('\n'));
  };
  const rig = (rec, style, angle = null) => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 5000);
    const guns = { tracers: [], projectiles: [] };
    const player = {
      time: 0, speed: 1, playing: true, followPid: 4, kills: rec.kills, rec,
      ctx: { camera, guns, scene: new THREE.Scene(), groundHeight: () => 0, waterLevel: () => null },
      camera: { rig: null, setRig(r) { this.rig = r; } },
    };
    const freed = [];
    const cam = new RC.RoundCam(player, { follow: () => {}, free: p => freed.push(p.toArray()), changed: () => {} });
    cam.bulletTime = RC.BULLET_TIME.strong;
    cam.style = style;
    cam.angle = angle;
    const frame = (dt = 1 / 60) => {
      player.time += dt * player.speed;
      cam.step(player.time, dt);
      for (const obj of guns.tracers) obj.mesh.position.addScaledVector(obj.velocity, dt * player.speed);
      return cam.place(camera, dt, player.time);
    };
    const tracer = (origin, dir, speed = 800) => ({
      mesh: { position: new THREE.Vector3(...origin), visible: true },
      velocity: new THREE.Vector3(...dir).multiplyScalar(speed), origin: [...origin], lead: 0, age: 0,
    });
    return { cam, camera, guns, player, frame, tracer, freed };
  };
  // A rifle take in `style`: the camera against the round early in its
  // flight and late, and against the man after.
  const take = (style, angle = null) => {
    const rec = build('K98Sniper', 30);
    const kill = rec.kills.find(k => k.kind === 'kill');
    const r = rig(rec, style, angle);
    r.player.time = 7;
    r.cam.arm(rec.fires[0], { kill });
    while (r.player.time < 10) r.frame();
    const armedCam = vec(r.camera.position);
    const own = r.tracer([0, 1.6, 0], [0, 0, -1]);
    r.guns.tracers.push(own);
    r.frame();
    const claimed = r.cam.state;
    const samples = [];
    for (let i = 0; i < 4000 && r.cam.state === 'flying'; i++) {
      r.frame();
      // Past the glide in from the shoulder.
      if (r.cam.target?.real > 0.3) samples.push({ p: round(r.cam.target.progress, 2), cam: vec(r.camera.position), round: vec(own.mesh.position) });
    }
    const hold = [];
    for (let i = 0; i < 4000 && r.cam.state === 'impact'; i++) {
      r.frame();
      hold.push(vec(r.camera.position));
    }
    const early = samples.find(s => s.p >= 0.15) ?? samples[0];
    const late = [...samples].reverse().find(s => s.p <= 0.97) ?? samples[samples.length - 1];
    const ahead = s => round(s.round[2] - s.cam[2], 2); // > 0: the camera in front of a round going -Z
    const abreast = s => round(Math.abs(s.cam[0] - s.round[0]), 2);
    return {
      armedCam, claimed, early: { ahead: ahead(early), abreast: abreast(early), cam: early.cam },
      late: { ahead: ahead(late), abreast: abreast(late) },
      holdStart: hold[0] ?? null, holdEnd: hold[hold.length - 1] ?? null, holdFrames: hold.length,
      endState: r.cam.state, freed: r.freed.length, heroShown: Boolean(r.cam.hero),
    };
  };
  const fixedAngle = { pos: [12, 4, -10], look: [0, 1, -15], aim: 'track' };
  const locked = { ...fixedAngle, aim: 'lock' };
  results.styles = {
    chase: take('chase'),
    orbit: take('orbit'),
    side: take('side'),
    reverse: take('reverse'),
    fixed: take('fixed', fixedAngle),
    locked: take('fixed', locked),
    fixedNoAngle: take('fixed', null),
  };
  // The placed camera looks along the round, then at the man (track), or
  // where it was kept looking (lock).
  {
    const rec = build('K98Sniper', 30);
    const kill = rec.kills.find(k => k.kind === 'kill');
    const look = angle => {
      const r = rig(rec, 'fixed', angle);
      r.player.time = 9;
      r.cam.arm(rec.fires[0], { kill });
      while (r.player.time < 10) r.frame();
      const own = r.tracer([0, 1.6, 0], [0, 0, -1]);
      r.guns.tracers.push(own);
      r.frame();
      while (r.cam.state === 'flying') r.frame();
      r.frame();
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(r.camera.quaternion);
      const toMan = new THREE.Vector3(0, 2.3, -30).sub(r.camera.position).normalize();
      const toKept = new THREE.Vector3(...angle.look).sub(r.camera.position).normalize();
      return { atMan: round(fwd.dot(toMan), 3), atKept: round(fwd.dot(toKept), 3) };
    };
    results.styles.aim = { track: look(fixedAngle), lock: look(locked) };
  }
  // A knife: the dossier's round is its swing, and nothing is chased.
  {
    const rec = build('KnifeAxis', 2);
    const kill = rec.kills.find(k => k.kind === 'kill');
    const found = D.killingRound(rec, kill);
    const r = rig(rec, 'chase');
    r.player.time = 8;
    r.cam.arm(rec.fires[0], { kill });
    const knifeRound = r.tracer([0, 1.6, 0], [0, 0, -1], 60);
    let claimed = false;
    let slowest = 1;
    let heroSeen = false;
    const states = new Set();
    for (let i = 0; i < 6000 && r.cam.state !== 'idle'; i++) {
      if (r.player.time >= 10 && !r.guns.tracers.includes(knifeRound)) r.guns.tracers.push(knifeRound);
      r.frame();
      states.add(r.cam.state);
      if (r.cam.target?.obj) claimed = true;
      if (r.cam.hero?.visible) heroSeen = true;
      slowest = Math.min(slowest, r.player.speed);
    }
    results.melee = {
      kind: found?.kind ?? null, weapon: found?.f?.weapon ?? null,
      claimed, heroSeen, states: [...states], slowest: round(slowest, 3), end: r.cam.state, speedAfter: r.player.speed,
      fixedStyle: (() => {
        const q = rig(rec, 'fixed', fixedAngle);
        q.player.time = 9;
        q.cam.arm(rec.fires[0], { kill });
        while (q.player.time < 10.2) q.frame();
        return { state: q.cam.state, style: q.cam.shotStyle(), cam: vec(q.camera.position) };
      })(),
      melee: ['KnifeAxis', 'KnifeAllies', 'Bayonet', 'K98', 'Thompson'].map(SS.isMelee),
    };
  }
  // The pure parts: the turn, the suggestions, a stored angle.
  const hill = (x, z) => (x > 2 ? 30 : 0);
  results.shotstyle = {
    yaw: [0, 0.3, 0.65, 1].map(p => round(SS.orbitYaw(p), 3)),
    hold: [0, 0.5, 1].map(k => round(SS.holdYaw(k), 3)),
    flat: SS.suggestAngles({ from: [0, 1.6, 0], to: [0, 1, -30], ground: () => 0 }).map(a => ({ id: a.id, clear: a.clear, pos: a.pos.map(v => round(v, 1)) })),
    hill: SS.suggestAngles({ from: [0, 1.6, 0], to: [0, 1, -30], ground: hill }).map(a => ({ id: a.id, clear: a.clear, x: round(a.pos[0], 1) })),
    // A street 8 m wide: the walls stand at x = +-4.
    street: SS.suggestAngles({ from: [0, 1.6, 0], to: [0, 1, -30], ground: () => 0,
      sees: (p, q) => Math.abs(p[0]) <= 4 && Math.abs(q[0]) <= 4 }).map(a => ({ id: a.id, clear: a.clear, x: round(a.pos[0], 1) })),
    walled: SS.suggestAngles({ from: [0, 1.6, 0], to: [0, 1, -30], ground: () => 0, sees: () => false }).map(a => a.clear),
    knife: SS.suggestAngles({ from: [0, 1.6, 0], to: [0, 1.3, -2], ground: () => 0 }).map(a => round(Math.hypot(a.pos[0] - 0, a.pos[2] + 1), 1)),
    clear: [SS.clearOfGround([0, 5, 0], [0, 5, -10], () => 0), SS.clearOfGround([0, 1, 0], [0, 1, -10], (x, z) => (z < -4 ? 3 : 0))],
    angle: [SS.angleOf({ pos: [1, 2, 3], look: [4, 5, 6], aim: 'lock' }), SS.angleOf({ pos: [1, 2], look: [4, 5, 6] }), SS.angleOf(null)],
    styleOf: ['orbit', 'nonsense', undefined].map(SS.styleOf),
  };
}

// --- the clip editor's strip ---------------------------------------------------------------
{
  const CB = await imp('replay-clipbar.js');
  results.clipbar = {
    windows: [[100, 106, 600], [1, 4, 600], [100, 140, 600], [595, 599, 600]].map(([a, b, d]) => CB.clipWindow(a, b, d)),
    steps: [5, 12, 20, 60].map(CB.tickStep),
    crossed: [[105.9, 106.02, 106], [106.5, 106.6, 106], [null, 106.1, 106], [90, 106.1, 106], [105, 105.9, 106]]
      .map(([p, t, o]) => CB.crossedOut(p, t, o)),
  };
}

// --- the gate -----------------------------------------------------------------------------------
{
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
  const { creatorAccess } = await imp('replay-creator.js');
  // Each page names its API (`?api=`), so each gets a client of its own.
  const page = host => ({ hostname: host, origin: `https://${host}`, search: `?api=https://${host}` });
  const token = role => {
    const b64 = s => Buffer.from(JSON.stringify(s)).toString('base64').replace(/=+$/, '');
    return `${b64({ alg: 'RS256' })}.${b64({ sub: '1', role })}.sig`;
  };
  const keep = (host, role) => store.set(`bf42-mesh-auth:https://${host}`,
    JSON.stringify({ token: token(role), expiresAt: new Date(Date.now() + 3600e3).toISOString() }));
  keep('admin.example', 'Admin');
  keep('user.example', 'User');
  results.gate = {
    local: await creatorAccess({ page: { hostname: 'localhost', origin: 'http://localhost:5273', search: '' } }),
    anonymous: await creatorAccess({ page: page('play.bfstats.io') }),
    admin: await creatorAccess({ page: page('admin.example') }),
    user: await creatorAccess({ page: page('user.example') }),
  };
}

console.log(JSON.stringify(results));
