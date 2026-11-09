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
  // A man under the water's level is aimed at over it (a PT boat's driver,
  // whose hull's origin is under the surface).
  player.ctx.waterLevel = () => 5;
  cam.aimVictim();
  const overWater = round(cam.target.victimAt.y, 2);
  player.ctx.waterLevel = () => null;
  cam.aimVictim();
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
    armed, victimAt, victimDist, overWater, early, speedAtShot: round(speedAtShot, 3), claimed, state1, behindBy, speedInFlight,
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
  // A stand-in laid out with no page round (`modelAt`, the strip's preview):
  // over his shoulder before the shot, behind the round 60% of the way, the
  // hold drawing back, beside the victim from the victim; a shot style for
  // one placement (`placeAs`) leaves the take's own alone.
  const ghost = new RC.RoundCam(player, {});
  const model = (t, style, { real = 0, armed = false } = {}) => {
    ghost.modelAt(t, f, kill, { hit: 10.15, real, armed });
    const c = new THREE.PerspectiveCamera();
    const ok = ghost.placeAs(c, 0, t, style);
    return { ok, state: ghost.state, pos: vec(c.position), hero: Boolean(ghost.hero?.visible) };
  };
  results.roundcam.model = {
    armed: model(8, 'chase'),
    flying: model(10.09, 'chase'),
    reverse: model(10.09, 'reverse'),
    hold: [model(10.3, 'chase'), model(10.3, 'chase', { real: 2 })],
    shoulderAfter: model(12, 'chase', { armed: true }),
    style: ghost.style,
    victimAt: vec(ghost.target.victimAt),
    none: ghost.modelAt(5, null, null),
    kinds: ['K98Sniper', 'Bazooka', 'GrenadeAllies', 'MustangBombDummy', 'TigerGunBarrel'].map(RC.kindOfWeapon),
    landing: [
      // A shell 0.1 s before the death with 0.3 s to fly: fired 0.2 s early.
      RC.landingOf({ t: 10, weapon: 'TigerGunBarrel' }, { t: 10.1 }, 0.3),
      // A rifle round arriving early leaves later.
      RC.landingOf({ t: 10, weapon: 'K98Sniper' }, { t: 10.5 }, 0.2),
      // Not a bomb, a rocket, a server's flown shell, nor 2 s off.
      RC.landingOf({ t: 10, weapon: 'MustangBombDummy' }, { t: 10.1 }, 0.3),
      RC.landingOf({ t: 10, weapon: 'Bazooka' }, { t: 10.1 }, 0.3),
      RC.landingOf({ t: 10, weapon: 'TigerGunBarrel', flight: { drawn: true } }, { t: 10.1 }, 0.3),
      RC.landingOf({ t: 10, weapon: 'TigerGunBarrel' }, { t: 12.5 }, 0.3),
    ].map(x => x && { fireAt: +x.fireAt.toFixed(3), landAt: x.landAt }),
    // 100 m ahead in 0.5 s under 9.81 of drop: aimed 2.45 m/s up.
    landingVelocity: vec(RC.landingVelocity(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -100), 0.5, 9.81, new THREE.Vector3())),
  };
  // A man in a hull: over his shoulder is behind and above the hull, in its
  // bounding radii, not a soldier's 2.4 m off its muzzle (inside a tank).
  {
    const hullLife = { tmpl: 'Sherman', nid: 99 };
    const root = new THREE.Object3D();
    root.position.set(0, 0, 3);
    root.add(new THREE.Mesh(new THREE.BoxGeometry(4, 4, 4)));
    root.updateMatrixWorld(true);
    const kept = player.hulls;
    player.hulls = new Map([[hullLife, { root }]]);
    const inHull = new RC.RoundCam(player, {});
    inHull.modelAt(8, f, kill, { hit: 10.15, armed: true });
    inHull.target.hullLife = hullLife;
    const c = new THREE.PerspectiveCamera();
    const shots = ['chase', 'side'].map(style => {
      inHull.placeAs(c, 0, 8, style);
      return vec(c.position);
    });
    results.roundcam.model.hull = { radius: round(inHull.target.hullRadius, 3), chase: shots[0], side: shots[1] };
    player.hulls = kept;
  }
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
    bulletSpan: [RC.bulletTimeSpan({ t: 10 }, { t: 10.4 }), RC.bulletTimeSpan({ t: 10 }), RC.bulletTimeSpan(null)],
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
    // The chased bullet out of the drawn muzzle, joining its line.
    drawn: (() => {
      const eye = new THREE.Vector3(0, 1.6, 0);
      const off = new THREE.Vector3(0.3, -0.4, 0);
      const at = (z, dist = null, o = off) => vec(RC.drawnRoundAt(new THREE.Vector3(0, 1.6, -z), eye, o, dist, new THREE.Vector3()));
      return { start: at(0), half: at(10), joined: at(20), past: at(40), near: at(2, 4), none: at(0, null, null) };
    })(),
    muzzle: (() => {
      const shots = { gun: { pid: 7, t: 12 }, far: { pid: 8, t: 12 }, unseen: { pid: 9, t: 12 }, nest: { pid: 6, t: 12 } };
      const shotMuzzles = new WeakMap([[shots.gun, [0.3, 1.2, -0.5]], [shots.far, [5, 1.6, 0]], [shots.nest, [0, 1.6, -2.3]]]);
      const c = new RC.RoundCam({ ...player, shotMuzzles }, {});
      c.shotPos.set(0, 1.6, 0);
      const of = (f, kind) => {
        const o = c.muzzleOffset({ f, kind });
        return o ? vec(o) : null;
      };
      // A gun whose round already left nearer its barrel: the offset is from that start.
      const placed = (() => {
        const o = c.muzzleOffset({ f: shots.gun, kind: 'tracer', obj: { origin: [0.3, 1.5, -0.5] } });
        return o ? vec(o) : null;
      })();
      return { gun: of(shots.gun, 'tracer'), nest: of(shots.nest, 'tracer'), placed, far: of(shots.far, 'tracer'),
        rocket: of(shots.gun, 'rocket'), later: of({ pid: 7, t: 12 }, 'tracer'), body: of(shots.unseen, 'tracer') };
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

// --- the move from view A to view B ---------------------------------------------------------
//
// A at 10 s 10 m east of the origin looking at it, B at 14 s 10 m north
// looking at it (both 2 m up): a quarter turn round the origin.
{
  const look = (pos, at) => {
    const c = new THREE.PerspectiveCamera();
    c.position.set(...pos);
    c.lookAt(new THREE.Vector3(...at));
    return [c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w];
  };
  const A = { t: 10, pos: [10, 2, 0], quat: look([10, 2, 0], [0, 2, 0]), role: 'a' };
  const B = { t: 14, pos: [0, 2, -10], quat: look([0, 2, -10], [0, 2, 0]), role: 'b' };
  const at = (mode, t, centre = null) => {
    const rig = new T.TrackRig([A, B], { mode, centre });
    const cam = new THREE.PerspectiveCamera();
    rig.place(cam, 0, t);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const toCentre = new THREE.Vector3(0, 2, 0).sub(cam.position).normalize();
    return { pos: vec(cam.position), dist: round(Math.hypot(cam.position.x, cam.position.z), 2), facing: round(fwd.dot(toCentre), 3) };
  };
  results.move = {
    glide: [9, 12, 15].map(t => at('glide', t)),
    orbit: [9, 11, 12, 13, 15].map(t => at('orbit', t, [0, 2, 0])),
    orbitMeet: at('orbit', 12),
    cut: [11, 13.99, 14].map(t => at('cut', t)),
    meet: T.meetingPoint(A, B).map(v => round(v, 2)),
    styles: ['glide', 'orbit', 'cut', 'nope', undefined].map(T.moveStyleOf),
  };
  // A move on each keyframe, and after the last to the clip's end (20 s).
  const pose = (keys, t, { end = 20, mode = 'glide' } = {}) => {
    const rig = new T.TrackRig(keys, { mode, centre: [0, 2, 0], end });
    const cam = new THREE.PerspectiveCamera();
    rig.place(cam, 0, t);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const toCentre = new THREE.Vector3(0, 2, 0).sub(cam.position).normalize();
    return { pos: vec(cam.position), facing: round(fwd.dot(toCentre), 3) };
  };
  const withMove = (k, move) => ({ ...k, move });
  results.keyMoves = {
    full: [12, 14].map(t => pose([withMove(A, 'orbit360'), B], t)),
    whip: [11.6, 13.2].map(t => pose([withMove(A, 'whip'), B], t)),
    spin: pose([withMove(A, 'spin')], 15),
    push: pose([withMove(A, 'push')], 20),
    pull: pose([withMove(A, 'pull')], 20),
    crane: pose([withMove(A, 'crane')], 20),
    hold: pose([withMove(A, 'hold')], 20),
    noEnd: pose([withMove(A, 'spin')], 15, { end: null }),
    // A crane left on a keyframe that is no longer the last is no move to
    // the next: the clip's own (glide) runs.
    stale: pose([withMove(A, 'crane'), B], 12),
    ids: ['glide', 'orbit360', 'whip', 'crane', 'hold', 'nope', null].map(T.keyMoveOf),
    labels: ['orbit360', 'whip', 'push', 'nope'].map(T.moveLabel),
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
    endLane: CB.camLane([
      { i: 0, cam: 'placed', t0: 100, t1: 104, view: {}, end: {}, move: 'glide', endAt: { ev: 'shot', dt: -1 }, tEnd: 102 },
      { i: 1, cam: 'placed', t0: 104, t1: 106, view: {}, end: {}, move: 'orbit', tEnd: 106 },
    ]).map(c => [c.sub, c.tEnd, round(CB.endShare(c, t => t), 3)]),
    endWords: [{ ev: 'shot', dt: -0.5 }, { ev: 'flight', p: 0.3 }, null].map(CB.endWords),
    lane: CB.camLane([
      { i: 0, cam: 'placed', t0: 100, t1: 103, motion: 'push', view: {} },
      { i: 1, cam: 'chase', t0: 103, t1: 103.06, at: { ev: 'shot', dt: 0 }, into: 'cut' },
      { i: 2, cam: 'incoming', t0: 103.06, t1: 104, at: { ev: 'flight', p: 0.6 }, into: 'glide' },
    ]).map(c => [c.label, c.sub, c.glyph, c.into]),
    words: [{ ev: 'shot', dt: 0 }, { ev: 'shot', dt: -0.5 }, { ev: 'flight', p: 0.6 }, { ev: 'hit', dt: 0 }, { ev: 'hit', dt: 0.25 }, { ev: 'down', dt: 0 },
      { ev: 'time', t: 3 }, null].map(CB.handOverWords),
    icons: Object.keys(CB.MOVE_ICONS).length,
    cameraGlyphs: (await imp('replay-cuts.js')).CAMS.every(([, , , glyph]) => Boolean(CB.MOVE_ICONS[glyph])),
    frames: CB.EXPORT_FRAMES.map(([id]) => id),
  };
}

// --- the clip's cameras (replay-cuts.js) -----------------------------------------------------------
{
  const CU = await imp('replay-cuts.js');
  const take = { f: { t: 10 }, kill: { t: 10.1, victim: 9 } };
  const ev = { start: 7, end: 15, shot: 10, hit: 10.2, down: 11 };
  const plainEv = { start: 7, end: 15, shot: null, hit: null, down: null };
  const brief = list => list.map(c => [c.cam, round(c.t0, 3), round(c.t1, 3)]);
  const def = CU.defaultCams(take);
  results.cuts = {
    defaults: {
      take: def.map(c => [c.cam, c.at ?? null, c.into ?? null]), plain: CU.defaultCams(null).map(c => c.cam),
      noVictim: CU.defaultCams({ f: { t: 10 }, kill: null }).map(c => c.cam),
    },
    resolved: brief(CU.resolveCams(def, ev)),
    times: [{ ev: 'shot', dt: -1 }, { ev: 'flight', p: 0.5 }, { ev: 'hit', dt: 0.3 }, { ev: 'down', dt: 0.5 }, { ev: 'time', t: 8 }, null]
      .map(a => round(CU.timeOf(a, ev), 3)),
    anchors: [9, 10, 10.05, 10.2, 10.5, 11, 12].map(t => {
      const a = CU.anchorAt(t, ev);
      return a.ev === 'flight' ? [a.ev, round(a.p, 3)] : [a.ev, round(a.dt, 3)];
    }),
    plainAnchor: CU.anchorAt(9, plainEv),
    // From the victim dropped 60% into the round's flight: the chase cut there.
    inserted: brief(CU.resolveCams(CU.insertCam(def, 10.12, 'incoming', ev), ev)),
    insertedAt: (() => {
      const at = CU.insertCam(def, 10.12, 'incoming', ev)[2].at;
      return [at.ev, round(at.p, 3)];
    })(),
    // Dropped on a hand-over: that camera swapped.
    swapped: CU.insertCam(def, 10.0, 'orbit', ev).map(c => c.cam),
    removedFirst: CU.removeCam(def, 0).map(c => [c.cam, c.at ?? null]),
    removedMid: brief(CU.resolveCams(CU.removeCam(def, 1), ev)),
    last: CU.removeCam([{ cam: 'free' }], 0).length,
    moved: [CU.moveCut(def, 1, 9.4, ev)[1].at, CU.moveCut(def, 2, 10.1, ev)[2].at, CU.moveCut(def, 1, 20, ev)[1].at].map(a =>
      a.ev === 'flight' ? [a.ev, round(a.p, 3)] : [a.ev, round(a.dt, 3)]),
    handOver: CU.setHandOver(def, 1, 'whip')[1].into,
    placed: CU.setPlaced(def, 0, { view: { pos: [1, 2, 3], quat: [0, 0, 0, 1], fov: 40 }, motion: 'push' })[0],
    // Read back: broken ones dropped, a take's cameras off a clip with none.
    read: [
      CU.camsOf([{ cam: 'chase' }, { cam: 'bogus', at: { ev: 'shot', dt: 0 } }, { cam: 'victim', at: { ev: 'down', dt: 0 }, into: 'nope' }], take),
      CU.camsOf([{ cam: 'chase' }], null),
      CU.camsOf([{ cam: 'placed', view: { pos: [0, 0, 0], quat: [0, 0, 0, 0] } }, { cam: 'free', at: { ev: 'time', t: 3 } }], null),
      CU.camsOf('nope', take),
      CU.camsOf([{ cam: 'chase', at: { ev: 'flight', p: 1.5 } }, { cam: 'side', at: { ev: 'flight', p: 1.5 } }], take),
    ],
    usable: [CU.camsFor(take).length, CU.camsFor(null), CU.camsFor({ f: { t: 1 }, kill: null }).includes('incoming')],
    recipes: CU.CAM_RECIPES.map(([id, , , cams]) => [id, CU.camsOf(cams, take)?.length === cams.length]),
    keys: CU.camsFromKeys([{ t: 8, pos: [1, 1, 1], quat: [0, 0, 0, 1], move: 'push' }, { t: 12, pos: [2, 2, 2], quat: [0, 0, 0, 1], move: 'crane' }], take, ev)
      .map(c => [c.cam, c.motion ?? null, c.into ?? null]),
    // A camera of yours with an end camera, and the move to it.
    ends: (() => {
      const A = { pos: [0, 0, 0], quat: [0, 0, 0, 1] };
      const B = { pos: [10, 0, 0], quat: [0, 0, 0, 1], fov: 40 };
      const withEnd = CU.setPlaced(def, 0, { view: A, end: B, move: 'orbit' })[0];
      const noEnd = CU.setPlaced([withEnd], 0, { end: null })[0];
      const swapped = CU.setCam([withEnd], 0, 'chase', {})[0];
      const read = CU.camsOf([{ cam: 'placed', view: A, end: B, move: 'nope' }, { cam: 'placed', at: { ev: 'shot', dt: 0 }, view: A, end: { pos: [1] } }], take);
      // Its end camera dragged: before the shot, into the flight, back to
      // its part's end; past its start it is held to it.
      const two = [withEnd, { cam: 'chase', at: { ev: 'shot', dt: 0 }, into: 'cut' }];
      const dragged = CU.moveEnd(two, 0, 9, ev);
      const tEnd = list => round(CU.resolveCams(list, ev)[0].tEnd, 3);
      const drags = {
        early: [dragged[0].endAt, tEnd(dragged), CU.holdsEnd(CU.resolveCams(dragged, ev)[0])],
        back: [CU.moveEnd(dragged, 0, 10, ev)[0].endAt ?? null, tEnd(CU.moveEnd(dragged, 0, 10, ev))],
        tooEarly: tEnd(CU.moveEnd(two, 0, 2, ev)),
        // The next hand-over moved before it: it gets there as its part ends.
        cutBefore: tEnd(CU.moveCut(dragged, 1, 8.5, ev)),
        // Read back with it, and without the end camera it goes too.
        read: CU.camsOf(dragged, take)[0].endAt,
        noEnd: 'endAt' in CU.setPlaced(dragged, 0, { end: null })[0],
        swapped: 'endAt' in CU.setCam(dragged, 0, 'shoulder')[0],
        noEndCam: CU.moveEnd(def, 0, 9, ev) === def,
        // A new camera after it: the chase again from 9.5 s.
        after: brief(CU.resolveCams(CU.insertCam(dragged, 9.5, 'shoulder', ev), ev)),
      };
      return { withEnd, noEnd, swapped, read, drags, intos: ['placed', 'chase', 'eyes', 'victim'].map(cam => CU.insertCam(def, 9, cam, ev)[1].into) };
    })(),
  };
}

// --- the clip as it plays (replay-clipclock.js) ---------------------------------------------------
//
// An 8 s clip, 100-108 s; a kill shot whose round leaves at 103 s and lands
// 0.1 s later, 70 m off, its kill line at 103 s.
{
  const CC = await imp('replay-clipclock.js');
  const span = { t0: 100, t1: 108 };
  const plain = CC.clipClock({ span });
  const preset = RC.BULLET_TIME.strong;
  const bullet = {
    shot: 103, hit: 103.1, kill: 103, preset, melee: false, orbitHold: false,
    armedSlow: RC.slowFor(650, preset, 70), flightSlow: RC.slowFor(700, preset, 70),
  };
  const kill = CC.clipClock({ span, bullet });
  const S = kill.toScreen;
  const turn = CC.clipClock({ span, bullet: { ...bullet, orbitHold: true } });
  const hullHold = CC.clipClock({ span, bullet: { ...bullet, hull: true } });
  const off = CC.clipClock({ span, bullet: { ...bullet, preset: null } });
  const own = CC.clipClock({ span, ramp: { in: 104, out: 106, speed: 0.25, ease: 0.35 }, bullet });
  const frozen = CC.clipClock({ span, bullet, freeze: { at: 103.1, real: 1 } });
  let monotone = true;
  for (let t = 99; t < 109; t += 0.003) if (!(S(t + 0.003) > S(t))) monotone = false;
  const flightSpeed = round(kill.speedAt(103.05), 4);
  results.clock = {
    speedAt: [kill.speedAt(101), flightSpeed, round(kill.speedAt(103.5), 3), kill.speedAt(99), round(frozen.speedAt(103.1), 4)],
    plain: [plain.length, plain.toScreen(104), plain.toRound(4), plain.toScreen(99), plain.toScreen(110), plain.down].map(v => (v === null ? null : round(v, 3))),
    lead: round(S(102.5), 2),
    flight: round(S(103.1) - S(103), 2),
    hold: round(S(kill.down) - S(103.1), 2),
    down: round(kill.down, 2),
    turnHold: round(turn.toScreen(turn.down) - turn.toScreen(103.1), 2),
    hullHold: [round(hullHold.toScreen(hullHold.down) - hullHold.toScreen(103.1), 2), round(hullHold.down - 103.1, 2)],
    manHold: [round(kill.toScreen(kill.down) - kill.toScreen(103.1), 2), round(kill.down - 103.1, 2)],
    offFlight: round(off.toScreen(103.1) - off.toScreen(103), 3),
    offDown: round(off.down, 2),
    length: round(kill.length, 2),
    inverse: [100.5, 103.05, 103.5, 107].map(t => round(kill.toRound(S(t)), 4)),
    own: { flight: round(own.toScreen(103.1) - own.toScreen(103), 3), slow: round(own.toScreen(106) - own.toScreen(104), 2) },
    frozen: [round(frozen.toScreen(103.2) - S(103.2), 2), round(frozen.toRound(frozen.toScreen(103.1) + 0.5), 2)],
    monotone,
  };
}

// --- the clip's cameras as a rig (replay-camtrack.js CutRig) ------------------------------------
//
// Your camera from 7 s, the chase from the shot at 10 s, From the victim 60%
// of the way, Circle the victim once he is down at 11 s. The round cameras
// stand in: the take's round cam places each style at its own x (y 1), the
// stand-in at the same x (y 2). The clip's clock is the round's.
{
  const take = { f: { t: 10, pid: 1 }, kill: { t: 10, victim: 2 } };
  const ev = { start: 7, end: 15, shot: 10, hit: 10.2, down: 11 };
  const STYLE_X = { chase: 100, orbit: 200, side: 300, reverse: 400 };
  const put = (c, x, y) => {
    c.position.set(x, y, 0);
    c.quaternion.set(0, 0, 0, 1);
    return true;
  };
  const live = {
    state: 'idle', target: { f: take.f, progress: 0 }, impact: null, from: { w: 1 }, orbit: { yaw: 0, pitch: 0, dist: 1 },
    camPos: new THREE.Vector3(), placeHero() {}, placeAs: (c, dt, t, style) => put(c, STYLE_X[style], 1), drag: () => 'live',
    wheel: () => 'live', nearPlaneAs: style => (style === 'chase' ? 0.1 : null),
  };
  const ghost = { orbit: null, hideHero() {}, modelAt: () => true, placeAs: (c, dt, t, style) => put(c, STYLE_X[style], 2), drag: () => 'ghost', nearPlaneAs: () => null };
  let eyes = true;
  const scene = {
    live, ghost, take, moments: () => ev, screen: t => t, real: () => 0, victimAt: () => [0, 0, -50], subjectAt: t => [t - 10, 0, 0],
    line: [0, 0, -1], centre: [0, 0, -50], eyes: () => eyes, keepAbove() {}, baseFov: () => 60,
  };
  const view = (pos, motion = 'still') => ({ cam: 'placed', view: { pos, quat: [0, 0, 0, 1], fov: 30 }, motion });
  const cams = [
    view([5, 5, 5]),
    { cam: 'chase', at: { ev: 'shot', dt: 0 }, into: 'cut' },
    { cam: 'incoming', at: { ev: 'flight', p: 0.6 }, into: 'cut' },
    { cam: 'victim', at: { ev: 'down', dt: 0 }, into: 'cut' },
  ];
  const cam = new THREE.PerspectiveCamera();
  const shot = (rig, t, state = 'idle', progress = 0, impactT = null) => {
    live.state = state;
    if (live.target) live.target.progress = progress;
    live.impact = impactT === null ? null : { t: impactT };
    const placed = rig.place(cam, 1 / 60, t);
    return [rig.active.cam, placed ? round(cam.position.x, 2) : null, placed ? round(cam.position.y, 2) : null];
  };
  // Paused and scrubbed, out of order: by the moments laid out, the
  // stand-in filming the round cameras.
  const paused = new T.CutRig(scene, cams);
  const scrub = [8, 10.05, 10.15, 10.5, 12].map(t => shot(paused, t));
  // Played: the take's round cam riding. From the victim comes when the
  // round is 60% along whatever the clock says; the circle waits for the
  // page's round to be down, not the laid-out moment.
  const played = new T.CutRig(scene, cams);
  const play = [
    shot(played, 9.9, 'armed'), shot(played, 10.0, 'flying', 0), shot(played, 10.1, 'flying', 0.59), shot(played, 10.105, 'flying', 0.61),
    shot(played, 10.25, 'flying', 0.95), shot(played, 10.3, 'impact', 1, 10.3), shot(played, 11.1, 'impact', 1, 10.3), shot(played, 11.2, 'idle', 1),
  ];
  const fromReset = live.from.w;
  // The round cam lets go of its target in the frame it stops: the man is
  // down then, a little before the laid-out moment.
  const early = new T.CutRig(scene, cams);
  const letGo = [shot(early, 10.0, 'flying', 0.1), shot(early, 10.3, 'impact', 1, 10.3)];
  live.target = null;
  letGo.push(shot(early, 10.9, 'idle'));
  live.target = { f: take.f, progress: 0 };
  // A glide into the chase: 0.8 s of the video from where it took over.
  const glider = new T.CutRig(scene, [view([4, 0, 0]), { cam: 'chase', at: { ev: 'shot', dt: 0 }, into: 'glide' }]);
  const glide = [shot(glider, 9.9, 'armed'), shot(glider, 10.0, 'flying'), shot(glider, 10.4, 'flying'), shot(glider, 10.8, 'flying')].map(s => s[1]);
  // His eyes is the page's own camera; out of them, a glide from where they
  // left the view.
  const eyed = new T.CutRig(scene, [{ cam: 'eyes' }, { cam: 'chase', at: { ev: 'shot', dt: 0 }, into: 'glide' }]);
  const eyesFrames = [shot(eyed, 9.9, 'armed')];
  cam.position.set(7, 7, 7);
  eyesFrames.push(shot(eyed, 10.0, 'flying'), shot(eyed, 10.4, 'flying'));
  eyes = false;
  const noEyes = shot(new T.CutRig(scene, [{ cam: 'eyes' }]), 8);
  eyes = true;
  // Your camera's moves: following the action from the framing kept, and a
  // push in over its stretch.
  const yaw = q => round((Math.atan2(-new THREE.Vector3(0, 0, -1).applyQuaternion(q).x, -new THREE.Vector3(0, 0, -1).applyQuaternion(q).z) * 180) / Math.PI, 1);
  const tracker = new T.CutRig(scene, [view([0, 0, 10], 'track')]);
  const track = [7, 10].map(t => {
    shot(tracker, t);
    return yaw(cam.quaternion);
  });
  const pusher = new T.CutRig(scene, [view([0, 0, 10], 'push')]);
  const push = [7, 11, 15].map(t => {
    shot(pusher, t);
    return round(cam.position.z, 2);
  });
  // Your camera from its start camera to its end camera over its stretch,
  // 7 to 15 s: on the start, half way at 11 s, on the end.
  const ab = new T.CutRig(scene, [{ cam: 'placed', view: { pos: [0, 0, 0], quat: [0, 0, 0, 1], fov: 60 }, end: { pos: [10, 0, 0], quat: [0, 0, 0, 1], fov: 30 },
    move: 'glide' }]);
  const abMove = [7, 11, 15].map(t => {
    shot(ab, t);
    return [round(cam.position.x, 2), ab.fovAt(t)];
  });
  // Its end camera dragged to 2 s before the shot (8 s): there by 8 s and
  // held to the end of its part.
  const abEarly = new T.CutRig(scene, [{ cam: 'placed', view: { pos: [0, 0, 0], quat: [0, 0, 0, 1], fov: 60 }, end: { pos: [10, 0, 0], quat: [0, 0, 0, 1], fov: 30 },
    move: 'glide', endAt: { ev: 'shot', dt: -2 } }]);
  const abHeld = [7, 7.5, 8, 9, 15].map(t => {
    shot(abEarly, t);
    return [round(cam.position.x, 2), abEarly.fovAt(t)];
  });
  // Circle the victim: off the round's line on the shooter's side.
  const circler = new T.CutRig(scene, [{ cam: 'victim' }]);
  shot(circler, 7);
  const circle = vec(cam.position);
  const lens = (() => {
    const r = new T.CutRig(scene, [view([0, 0, 0])]);
    shot(r, 8);
    return r.fovAt(8);
  })();
  // A drag swings a round camera's round cam; your camera takes it.
  live.state = 'flying';
  played.place(cam, 1 / 60, 10.05);
  const dragRound = played.drag(1, 1);
  const near = played.nearPlane();
  const dragYours = paused.place(cam, 0, 8) && paused.drag(1, 1);
  results.cutRig = { scrub, play, fromReset, letGo, abMove, abHeld, glide, eyes: eyesFrames, noEyes, track, push, circle, lens, dragRound, near, dragYours };
}

// --- the studio's edits ---------------------------------------------------------------------------
{
  const FX = await imp('replay-studio-fx.js');
  const ST = await imp('replay-studio.js');
  const span = { t0: 100, t1: 108 };
  const e = FX.editsOf({
    grade: 'cinematic', vignette: 0.4, fadeIn: 1, fadeOut: 0.5, flash: true, punch: true, shake: true, freeze: 1,
    title: { on: true, text: 'Ace', t: 0.5, dur: 2 }, lower: { on: true, text: '', t: null, dur: 3 }, tag: { on: true, text: 'skandia' },
  });
  const at = t => {
    const o = FX.overlayAt(e, span, t, { kill: 104, shotT: 103.6, lowerLines: ['Him', 'MG 42 · kills them · 72 m'] });
    return { black: round(o.black, 3), white: round(o.white, 3), title: o.title ? round(o.title.a, 3) : 0, lower: o.lower ? round(o.lower.a, 3) : 0, tag: o.tag };
  };
  results.studio = {
    at: [100, 100.5, 100.8, 101.5, 102.5, 103.2, 104, 104.2, 107.75, 108].map(at),
    lowerLines: FX.overlayAt(e, span, 104, { kill: 104, shotT: 103.6, lowerLines: ['Him', 'MG 42'] }).lower?.lines ?? null,
    typed: FX.overlayAt(FX.editsOf({ ...e, lower: { ...e.lower, text: 'My words' } }), span, 104, { lowerLines: ['Him'], shotT: 103.6 }).lower?.lines ?? null,
    punch: [103.9, 104, 104.04, 104.08, 104.3, 106].map(t => round(FX.punchAt(e, 104, t), 3)),
    shake: [103.9, 104.1, 105.5].map(t => (FX.shakeAt(e, 104, t) ? 'on' : null)),
    noPunch: FX.punchAt(FX.defaultEdits(), 104, 104.04),
    clean: FX.editsOf({ grade: 'nope', vignette: 7, fadeIn: 3, freeze: 9, title: { on: 1, text: 42 }, extra: 1 }),
    shows: [FX.editsShow(FX.defaultEdits()), FX.editsShow(e), FX.editsShow({ ...FX.defaultEdits(), punch: true })],
    grades: FX.GRADES.map(([id]) => id),
    feed: (() => {
      const kills = [{ t: 101, killer: 'A', victim: 'B' }, { t: 104, killer: 'C', victim: 'D' }, { t: 99, killer: 'E', victim: 'F' }];
      const on = FX.editsOf({ ...FX.defaultEdits(), feed: true });
      const at = t => (FX.overlayAt(on, span, t, { kills }).feed ?? []).map(k => `${k.killer}>${k.victim}:${round(k.a, 2)}`);
      return { at: [100, 101.5, 104.5, 107.9].map(at), off: FX.overlayAt(FX.defaultEdits(), span, 104.5, { kills }).feed, shows: FX.editsShow(on) };
    })(),
    recipe: (() => {
      const r = ST.applyRecipe({ ...FX.defaultEdits(), lower: { on: false, text: 'Mine', t: 1, dur: 3 } }, ST.RECIPES.find(([id]) => id === 'frag')[3]);
      return { grade: r.grade, flash: r.flash, lower: r.lower, title: r.title.on };
    })(),
    cinemaTitle: ST.applyRecipe(FX.defaultEdits(), ST.RECIPES.find(([id]) => id === 'cinema')[3]).title.text,
    boxes: [['169', 1000, 700], ['916', 1000, 700], ['11', 600, 900], ['none', 800, 600]].map(([f, w, h]) => ST.monitorBox({ x: 10, y: 20, w, h }, f)),
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
  const { creatorAccess, templateWords, gunWords } = await imp('replay-creator.js');
  results.gunWords = ['Radar_AA_Allies_GunBarrel', 'AA_Allies_GunBarrel', 'AA_POW_GunBarrel2', 'Oerlikon20mm_single_GunBarrel',
    'Carrier_AA_GunBarrel', 'PrinceOW_CannonPipes4', 'MG42', 'Tiger'].map(gunWords);
  results.templateWords = ['MustangBombDummy', 'K98Sniper', 'No4Sniper', 'Bazooka', 'MG42', 'Panzer_IV', 'BARProjectile', 'SBDGuns'].map(templateWords);
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

// --- the studio's tour ---------------------------------------------------------------------------
//
// The kill it picks, the facts it reads off a creator, and each step's
// state from made-up facts: what moves it on, what it waits for, what it
// shows as read-and-go-on because it was done when it began.
{
  const TT = await imp('replay-studio-tour.js');
  const m = (t, distance, extra = {}) => ({ t, distance, score: distance, killerName: 'A', victimName: 'B', weapon: 'K98', from: 'foot', ...extra });
  const moments = [m(10, 8), m(20, 60), m(30, 140, { from: 'vehicle', score: 150 }), m(40, 400), m(50, 90)];
  results.tourPick = {
    best: TT.pickTourKill(moments).t,
    current: TT.pickTourKill(moments, 30).t,
    unknownCurrent: TT.pickTourKill(moments, 33).t,
    fallback: TT.pickTourKill([m(1, 5), m(2, 9)]).t,
    none: TT.pickTourKill([]),
  };
  const creator = {
    take: { kill: { t: 50 } }, span: { t0: 40, t1: 60 },
    camList: () => [{ cam: 'shoulder' }, { cam: 'placed', at: { ev: 'shot', dt: 0 }, into: 'glide', view: { pos: [1, 2, 3.456] } }],
    edits: { grade: 'vivid', vignette: 0.25, lower: { on: true } }, prefs: { frame: '169' }, ramp: { in: 41, out: 42, speed: 0.25 },
    ownSlow: () => true, lowerLines: () => ['A', 'K98  ·  kills B'], placing: null, part: { label: 'camera 2' }, recorder: null,
  };
  const facts = TT.tourFacts(creator, { open: true, tab: 'kills' });
  const base = {
    open: true, tab: 'kills', killT: null, placing: null, part: null, recording: false, lowerOn: false, lower: '', look: 'none|0',
    slow: { own: false, sig: 'null|null|1' },
    cams: [{ cam: 'shoulder', at: null, into: null, view: null, end: null }, { cam: 'chase', at: '{"ev":"shot","dt":0}', into: 'glide', view: null, end: null },
      { cam: 'victim', at: '{"ev":"down","dt":0}', into: 'glide', view: null, end: null }],
  };
  const ctx = { kill: m(50, 90) };
  const step = id => TT.TOUR_STEPS.find(s => s.id === id);
  const state = (id, now, start = base) => TT.stepState(step(id), { ...base, ...now }, { ...base, ...start }, ctx);
  const swapped = base.cams.map((c, k) => (k === 1 ? { ...c, cam: 'incoming' } : c));
  const moved = base.cams.map((c, k) => (k === 1 ? { ...c, at: '{"ev":"flight","p":0.6}' } : c));
  const glided = base.cams.map((c, k) => (k === 2 ? { ...c, into: 'whip' } : c));
  const placed = base.cams.map((c, k) => (k === 0 ? { ...c, cam: 'placed', view: '1.00,2.00,3.00' } : c));
  results.tourSteps = {
    ids: TT.TOUR_STEPS.map(s => s.id),
    facts,
    kill: { before: state('kill', {}), opened: state('kill', { killT: 50 }), other: state('kill', { killT: 20 }), already: state('kill', { killT: 50 }, { killT: 50 }) },
    cameras: state('cameras', {}),
    swap: { same: state('swap', {}), swapped: state('swap', { cams: swapped }) },
    handover: { same: state('handover', {}), moved: state('handover', { cams: moved }), glided: state('handover', { cams: glided }) },
    place: { flying: state('place', { placing: { i: 0, which: 'start' }, cams: placed }), used: state('place', { cams: placed }), none: state('place', {}) },
    slow: { none: state('slow', {}), own: state('slow', { slow: { own: true, sig: '41|42|0.25' } }),
      already: state('slow', { slow: { own: true, sig: '41|42|0.25' } }, { slow: { own: true, sig: '41|42|0.25' } }) },
    look: { same: state('look', {}), changed: state('look', { look: 'vivid|0.25' }) },
    text: { off: state('text', {}), ticked: state('text', { lowerOn: true }), already: state('text', { lowerOn: true }, { lowerOn: true }) },
    record: { idle: state('record', {}), rolling: state('record', { recording: true }) },
    end: state('end', {}),
    placeWords: [step('place').words(base, ctx), step('place').words({ ...base, placing: { i: 0 } }, ctx)],
    killWords: step('kill').words(base, ctx),
    camerasWords: step('cameras').words(base, ctx),
    skipOne: TT.nextStep(2, { ...base, cams: [base.cams[0]] }),
    skipNone: TT.nextStep(2, base),
    back: TT.nextStep(4, { ...base, cams: [base.cams[0]] }, -1),
    pastEnd: TT.nextStep(TT.TOUR_STEPS.length - 1, base),
    // Every selector a step lights, with the facts each could be read with.
    selectors: [...new Set(TT.TOUR_STEPS.flatMap(s => [base, { ...base, placing: { i: 0 }, lowerOn: true }, { ...base, cams: [base.cams[0]] }]
      .flatMap(f => s.target(f, ctx))))],
  };
}

console.log(JSON.stringify(results));
