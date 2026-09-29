// The replay's creator view under node (features/replay-creator-view): the
// camera track's path, picking in screen space, the round cam finding its
// round and running its clock, the clip's file names and the gate. One node
// run, one JSON report, the modules imported from the viewer tree in place
// through `sim/env.mjs`; `test_replay_creator.py` reads it.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, T, P, RC, C, R] = await Promise.all([
  imp('vendor/three.module.js'), imp('replay-camtrack.js'), imp('replay-pick.js'), imp('replay-roundcam.js'),
  imp('replay-clip.js'), imp('replay-recording.js'),
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

// --- the clip's file name -------------------------------------------------------------------------
results.clip = {
  mp4: C.clipName('Battle of Kursk', 161.2, 172.9, 'video/mp4;codecs=avc1'),
  webm: C.clipName('wake', 5, 65, 'video/webm;codecs=vp9'),
  none: C.clipName('', 0, 1, null),
  mime: C.recorderMime(true),
};

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
