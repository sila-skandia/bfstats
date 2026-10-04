// A round replay's crosshair hit marks and an aircraft's nose cam, under node.
//
// The owner's asks (2026-10-04): "In our replay of a gameplay recording, do
// you think it would be possible to show cross hair hit indicators? ... Not
// sure if that's something we capture, or can recreate from the data", and
// "when you're in a vehicle we can go POV, which is the default camera, but
// most players will switch to the second camera which is the full screen
// view with just the cross hair ... Could we add that as a camera when we're
// cycling through with C".
//
// No recording holds the marks (the server sends them as one bool the
// recorder does not read, ledger XHIT-6), so replay-hitmarks.js works them
// out from the rounds and the hit points. The second view is retail's nose
// cam, which only an aircraft's Camera has (seat-view.js).
//
// Same pattern as `replay_hud_harness.mjs`: the viewer's modules imported in
// place through `sim/env.mjs`'s hooks, one JSON report on stdout.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, recording, marksModule, { ReplayCamera }, hud] = await Promise.all([
  imp('vendor/three.module.js'), imp('replay-recording.js'), imp('replay-hitmarks.js'),
  imp('replay-camera.js'), imp('replay-hud.js'),
]);
const { inferHitMarks, hitMarkAt } = marksModule;

const results = {};
const line = o => JSON.stringify(o);
const r3 = v => +v.toFixed(3) + 0;

// --- the marks: rounds against hit points ------------------------------------------
//
// BF1942's axes, +Z forward. The shooter (pid 3) stands at the origin; the
// victim (pid 5) 30 m ahead; a second shooter (pid 4) 5 m to the side; a
// Sherman 60 m ahead; a soldier (pid 7) the recording has no hit points for.
const ahead = [0, 0, 1];
const toward = (from, to) => {
  const d = to.map((v, i) => v - from[i]);
  const n = Math.hypot(...d);
  return d.map(v => v / n);
};
const lines = [
  line({ k: 'h', v: 5, start: '', hz: 10 }),
  line({ k: 'e', t: 1, e: 'gameRules', extViews: 1, noseCam: 1, soldierFF: 1, ticketRatio: 1, timeLimit: 0, worldTime: 0, crosshair: 1 }),
];
const soldier = (pid, nid, team, pos, hp = true) => {
  lines.push(line({ k: 'e', t: 1, e: 'createObject', tid: 1763, netId: nid, tmpl: 'USSoldier', pos, rot: [0, 0, 0] }));
  lines.push(line({ k: 'e', t: 1, e: 'control', pid, netId: nid }));
  lines.push(line({ k: 'o', t: 1, id: nid, gid: 1, tmpl: 'USSoldier', tid: 1763, team, maxhp: 30 }));
  if (hp) lines.push(line({ k: 'a', t: 1, a: [[nid, 30, -1]] }));
  for (let i = 0; i <= 500; i++) lines.push(line({ k: 's', t: +(1 + i * 0.1).toFixed(1), o: [[nid, ...pos, 0, 0, 0, 1]] }));
};
soldier(3, 10, 2, [0, 1, 0]);
soldier(4, 11, 2, [5, 1, 0]);
soldier(5, 20, 1, [0, 1, 30]);
soldier(7, 40, 1, [20, 1, 30], false);
soldier(8, 45, 1, [-10, 1, 30]);
lines.push(line({ k: 'e', t: 1, e: 'createObject', tid: 900, netId: 30, tmpl: 'Sherman', pos: [0, 1, 60], rot: [0, 0, 0] }));
lines.push(line({ k: 'o', t: 1, id: 30, gid: 1, tmpl: 'Sherman', tid: 900, team: 0, maxhp: 900 }));
lines.push(line({ k: 'a', t: 1, a: [[30, 900, -1]] }));
for (let i = 0; i <= 500; i++) lines.push(line({ k: 's', t: +(1 + i * 0.1).toFixed(1), o: [[30, 0, 1, 60, 0, 0, 0, 1]] }));
const eye3 = [0, 1.65, 0];
const eye4 = [5, 1.65, 0];
const round = (t, pid, nid, w, p, d) => lines.push(line({ k: 'f', t, id: nid, pid, w, p, d }));
// 5.0: his round through the victim, whose hit points drop at 5.2; the other
// shooter's passes 14 m wide.
round(5, 3, 10, 'Bar1918', eye3, ahead);
round(5, 4, 11, 'Thompson', eye4, toward(eye4, [14, 1.65, 30]));
lines.push(line({ k: 'a', t: 5.2, a: [[20, 20, -1]] }));
// 8.0: through him again, and his hit points do not move: a miss as far as
// anyone can tell.
round(8, 3, 10, 'Bar1918', eye3, ahead);
// 12.0: a drop with no round near it (a fall, a blast).
lines.push(line({ k: 'a', t: 12, a: [[20, 15, -1]] }));
// 15.0: a grenade straight at him, and a drop: a blast, which never marks.
round(15, 3, 10, 'GrenadeAllies', eye3, ahead);
lines.push(line({ k: 'a', t: 15.3, a: [[20, 10, -1]] }));
// 19.9: both fire; his round passes dead centre, the other's 2 m off. The
// kill log names the other, so the killing drop is the other's.
round(19.9, 3, 10, 'Bar1918', eye3, ahead);
round(19.9, 4, 11, 'Thompson', eye4, toward(eye4, [2, 1.65, 30]));
lines.push(line({ k: 'a', t: 20.05, a: [[20, 0, -1]] }));
lines.push(line({ k: 'e', t: 20.1, e: 'score', kind: 3, pid: 4, victim: 5, weaponName: 'Thompson' }));
// 25.0: the empty Sherman, hit: an empty hull has no team and never marks.
round(25, 3, 10, 'Bar1918', eye3, toward(eye3, [0, 1, 60]));
lines.push(line({ k: 'a', t: 25.3, a: [[30, 800, -1]] }));
// 27: pid 6 climbs in; 28.0 the same shot marks.
lines.push(line({ k: 'p', t: 27, p: [[6, 1, 30, 30, 0, 0]] }));
round(28, 3, 10, 'Bar1918', eye3, toward(eye3, [0, 1, 60]));
lines.push(line({ k: 'a', t: 28.3, a: [[30, 700, -1]] }));
// 32.0: a kill the hit points never show (no `a` for pid 7): his last round
// of the weapon that killed, as long before the kill as a drop follows a
// hit.
round(31.6, 3, 10, 'Bar1918', eye3, toward(eye3, [20, 1.3, 30]));
round(32, 3, 10, 'Bar1918', eye3, toward(eye3, [20, 1.3, 30]));
lines.push(line({ k: 'e', t: 32.2, e: 'score', kind: 3, pid: 3, victim: 7, weaponName: 'Bar1918' }));
// 36.0: a bazooka rocket at the manned Sherman, 85 m/s over 60 m: it lands
// 0.7 s after it leaves, and the mark goes up then, not at the shot.
round(36, 3, 10, 'Bazooka', eye3, toward(eye3, [0, 1, 60]));
lines.push(line({ k: 'a', t: 36.8, a: [[30, 600, -1]] }));
// 40.0-40.7: an Mp40 burst through pid 8, every round dead centre, and one
// drop at 40.75: the round whose arrival explains it, not the first.
const eyeTo8 = toward(eye3, [-10, 1.3, 30]);
for (let i = 0; i < 8; i++) round(+(40 + i * 0.1).toFixed(1), 3, 10, 'Mp40', eye3, eyeTo8);
lines.push(line({ k: 'a', t: 40.75, a: [[45, 22, -1]] }));
// 45.0: a Bofors shell (300 m/s, a 10 m proximity fuse) at a manned BF109
// crossing at 50 m/s: it bursts beside the plane, and the drop is the
// burst's, which never marks. 47.0: the same gun at pid 8, whom the fuse
// ignores: a direct hit, which marks.
lines.push(line({ k: 'e', t: 1, e: 'createObject', tid: 901, netId: 60, tmpl: 'BF109', pos: [0, 50, 100], rot: [0, 0, 0] }));
lines.push(line({ k: 'o', t: 1, id: 60, gid: 1, tmpl: 'BF109', tid: 901, team: 0, maxhp: 130 }));
lines.push(line({ k: 'a', t: 1, a: [[60, 130, -1]] }));
lines.push(line({ k: 'p', t: 1, p: [[9, 1, 60, 60, 0, 0]] }));
for (let i = 0; i <= 500; i++) {
  const t = +(1 + i * 0.1).toFixed(1);
  lines.push(line({ k: 's', t, o: [[60, (t - 45.37) * 50, 50, 100, 0, 0, 0, 1]] }));
}
round(45, 3, 10, 'AA_Allies_GunBarrel', eye3, toward(eye3, [0, 50, 100]));
lines.push(line({ k: 'a', t: 45.6, a: [[60, 110, -1]] }));
round(47, 3, 10, 'AA_Allies_GunBarrel', eye3, eyeTo8);
lines.push(line({ k: 'a', t: 47.3, a: [[45, 10, -1]] }));
lines.push(line({ k: 'end', t: 52 }));
const rec = recording.parseRecording(lines.join('\n'));

{
  const speedOf = w => ({ bazooka: 85, mp40: 1000, aa_allies_gunbarrel: 300 })[w] ?? null;
  const fuseOf = w => (w === 'aa_allies_gunbarrel' ? 10 : null);
  const marks = inferHitMarks(rec, { thrown: new Set(['grenadeallies']), speedOf, fuseOf });
  const unfused = inferHitMarks(rec, { thrown: new Set(['grenadeallies']), speedOf });
  const of = pid => (marks.get(pid) ?? []).map(r3);
  results.marks = { shooter: of(3), other: of(4), crew: of(6), victim: of(5) };
  results.unfused = (unfused.get(3) ?? []).map(r3);
  const times = [5, 7];
  results.timer = [4.9, 5, 5.5, 5.999, 6.5, 7, 7.25, 9].map(t => r3(hitMarkAt(times, t)));
  results.timerNone = hitMarkAt([], 5);
  results.noseRule = rec.noseCam;
}

// --- the HUD: the marks' variables -----------------------------------------------
{
  const life = rec.lives.find(l => l.nid === 10);
  const cam = new THREE.PerspectiveCamera();
  const player = {
    rec, followPid: 3, recordingPid: 3, soldiers: null, networkedRounds: new Set(['grenadealliesprojectile']),
    ctx: { loadouts: () => null, camera: cam }, camera: { sight: { kind: 'foot', life } },
  };
  const replayHud = new hud.ReplayHud(player);
  const at = (t, art = {}) => {
    const vars = { 'CrossHair/ShowCrossHair': false, 'CrossHair/HitIndicationTime': 0 };
    replayHud.update(t);
    replayHud.feed(vars, art);
    return [vars['CrossHair/ShowCrossHair'], r3(vars['CrossHair/HitIndicationTime'])];
  };
  replayHud.hitMarkOf(3, 0);
  const mark = replayHud.hitMarks.get(3)[0];
  results.hud = {
    atMark: at(mark),
    half: at(mark + 0.5),
    gone: at(mark + 1.5),
    oldLayout: at(mark, { hitMarks: () => false }),
  };
  player.camera.sight.looking = true;
  results.hud.looking = at(mark);

  // The speeds: the models tree's damage.json, fetched once; the marks are
  // timed again when it lands. With the bazooka's 85 m/s unknown, its mark
  // sits at a stock speed's arrival; with it, at the rocket's.
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async url => {
    asked.push(url);
    return { ok: true, json: async () => ({ weapons: [{ name: 'Bazooka', velocity: 85 }, { name: 'Mp40', velocity: 1000 }] }) };
  };
  const fetched = new hud.ReplayHud({ ...player, ctx: { ...player.ctx, modelsBase: 'models/mods/xpack1', bust: () => '?v=1' } });
  const rocket = list => r3(list.find(m => m > 36 && m < 38));
  fetched.hitMarkOf(3, 0);
  const before = rocket(fetched.hitMarks.get(3));
  await new Promise(resolve => setTimeout(resolve, 0));
  fetched.hitMarkOf(3, 0);
  results.speeds = { asked, before, after: rocket(fetched.hitMarks.get(3)) };
  globalThis.fetch = realFetch;
}

// --- the nose cam: C from the cockpit, in an aircraft only --------------------------
{
  const planeLines = [
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1, netId: 80, tmpl: 'Corsair', pos: [0, 100, 0], rot: [0, 0, 0] }),
    line({ k: 'o', t: 1, id: 80, gid: 1, tmpl: 'Corsair', tid: 1, team: 2, maxhp: 130 }),
    line({ k: 'p', t: 1, p: [[1, 2, 80, 80, 0, 0]] }),
  ];
  for (let i = 0; i <= 100; i++) planeLines.push(line({ k: 's', t: +(1 + i * 0.1).toFixed(1), o: [[80, 0, 100, 0, 0, 0, 0, 1]] }));
  planeLines.push(line({ k: 'end', t: 11 }));
  const build = (lines, cameraName) => {
    const prec = recording.parseRecording(lines.join('\n'));
    const life = prec.lives.find(l => l.nid === 80);
    const group = new THREE.Group();
    group.position.set(0, 100, 0);
    const eye = new THREE.Object3D();
    eye.name = cameraName;
    eye.position.set(0, 1.2, 0);
    group.add(eye);
    group.updateMatrixWorld(true);
    const hull = {
      group, root: group, drive: null,
      occupancy: { rootId: 'root', cameraNodeOf: () => eye },
      seatIdAt: () => 'root',
    };
    const cam = new THREE.PerspectiveCamera(60, 1.6, 0.5, 8000);
    const player = { rec: prec, followPid: 1, time: 5, hulls: new Map([[life, hull]]),
                     ctx: { camera: cam, groundHeight: () => 0, waterLevel: () => -100 } };
    const camera = new ReplayCamera(player);
    player.camera = camera;
    camera.setMode('pov');
    camera.update(1 / 60, 5);
    return { camera, cam, eye, hull };
  };
  const { camera, cam, eye, hull } = build(planeLines, 'CorsairCamera');
  const eyeAt = eye.getWorldPosition(new THREE.Vector3());
  const cockpit = { view: camera.sight?.view, nose: camera.sight?.nose, hull: camera.povHull === hull,
                    offset: r3(cam.position.distanceTo(eyeAt)) };
  const went = camera.toggleNose();
  // The glide eases a change of view in; let it finish before measuring.
  for (let i = 0; i < 60; i++) camera.update(1 / 60, 5);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  const off = cam.position.clone().sub(eyeAt);
  const nose = {
    went, view: camera.sight?.view, hull: camera.povHull === hull, kind: camera.sight?.kind,
    offset: r3(off.length()), ahead: r3(off.dot(fwd)), below: r3(-off.y),
  };
  const back = camera.toggleNose();
  camera.toggleNose();
  camera.setMode('free');
  const afterFree = camera.povView;
  camera.setMode('pov');
  camera.update(1 / 60, 5);
  // A tank's Camera has no nose cam, and neither has an aircraft on a server
  // that switched it off.
  const tank = build(planeLines, 'ShermanCamera').camera;
  const shut = line({ k: 'e', t: 1, e: 'gameRules', extViews: 1, noseCam: 0, soldierFF: 1, ticketRatio: 1, timeLimit: 0, worldTime: 0, crosshair: 1 });
  const closed = build([...planeLines, shut], 'CorsairCamera').camera;
  results.nose = {
    cockpit, nose, back, afterFree, again: camera.sight?.view,
    tank: { nose: tank.sight?.nose, toggled: tank.toggleNose() },
    closed: { nose: closed.sight?.nose, toggled: closed.toggleNose() },
  };
}

process.stdout.write(JSON.stringify(results));
