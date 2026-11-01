// The replay's outside views (features/replay-feature-sweep-2026-11-01, entry
// 8): the game's chase, front chase and fly-by of a recorded hull, gated on
// the seat Camera's `CVM*` words, and the soldier's chase on foot, reached by
// F9-F12 (`ReplayCamera.cameraKey`).
//
// The real `ReplayCamera` (replay-camera.js) over a parsed recording under
// node: a tank driven forward at 5 m/s by pid 1, a second whose Camera says
// `CVMChase 0` driven by pid 2, and a rifleman, pid 3, on foot. The hulls are
// stand-ins carrying what the camera reads (root, Camera node, seat ids). One
// JSON report on stdout; `tests/test_replay_outside_views.py` asserts on it.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, recording, cameraMod] = await Promise.all([
  imp('vendor/three.module.js'), imp('replay-recording.js'), imp('replay-camera.js'),
]);
const { ReplayCamera } = cameraMod;

const line = o => JSON.stringify(o);
const q = yaw => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
const lines = [
  line({ k: 'h', v: 5, start: '', hz: 10 }),
  line({ k: 'roster', t: 0.5, p: [[1, 2, 0, 'driver', 0], [2, 2, 0, 'locked', 0], [3, 2, 0, 'rifleman', 1]] }),
  line({ k: 'e', t: 1, e: 'gameRules', extViews: 1, noseCam: 1, soldierFF: 1, ticketRatio: 1, timeLimit: 0, worldTime: 0, crosshair: 1 }),
  line({ k: 'e', t: 1, e: 'createObject', tid: 1, netId: 80, tmpl: 'Sherman', pos: [0, 0, 0], rot: [0, 0, 0] }),
  line({ k: 'o', t: 1, id: 80, gid: 1, tmpl: 'Sherman', tid: 1, team: 2, maxhp: 100 }),
  line({ k: 'e', t: 1, e: 'createObject', tid: 1, netId: 81, tmpl: 'Sherman', pos: [100, 0, 0], rot: [0, 0, 0] }),
  line({ k: 'o', t: 1, id: 81, gid: 1, tmpl: 'Sherman', tid: 1, team: 2, maxhp: 100 }),
  line({ k: 'p', t: 1, p: [[1, 2, 80, 80, 0, 0], [2, 2, 81, 81, 0, 0]] }),
  line({ k: 'e', t: 1, e: 'createObject', tid: 1763, netId: 50, tmpl: 'USSoldier', pos: [-50, 1, 0], rot: [0, 0, 0] }),
  line({ k: 'e', t: 1, e: 'control', pid: 3, netId: 50 }),
  line({ k: 'o', t: 1, id: 50, gid: 1, tmpl: 'USSoldier', tid: 1763, team: 2, maxhp: 30 }),
];
for (let i = 0; i <= 100; i++) {
  const t = +(1 + i * 0.1).toFixed(1);
  lines.push(line({ k: 's', t, o: [[80, 0, 0, 5 * (t - 1), ...q(0)], [81, 100, 0, 0, ...q(0)], [50, -50, 2, 0, ...q(0)]] }));
}
lines.push(line({ k: 'end', t: 11 }));
const rec = recording.parseRecording(lines.join('\n'));
const lifeOf = nid => rec.lives.find(l => l.nid === nid);

/** A hull as the camera reads it: its root (a 3 x 2 x 6 m box, so CVM-2's R
 *  is the box's 3.5 m reach), and its one seat's Camera 2 m over the root. */
function hull(name, cameraView) {
  const root = new THREE.Group();
  root.name = name;
  root.add(new THREE.Mesh(new THREE.BoxGeometry(3, 2, 6)));
  const eye = new THREE.Group();
  eye.name = `${name}Camera`;
  eye.userData = { templateKind: 'Camera', cameraView };
  eye.position.set(0, 2, 0);
  root.add(eye);
  root.updateMatrixWorld(true);
  return { root, group: root, eye, kind: 'ground', drive: null, occupancy: { rootId: name, cameraNodeOf: () => eye }, seatIdAt: () => name };
}
const tank = hull('Sherman', { cvm: {} });
const locked = hull('ShermanLocked', { cvm: { CVMChase: 0 } });
const hulls = new Map([[lifeOf(80), tank], [lifeOf(81), locked]]);

const cam = new THREE.PerspectiveCamera(60, 1.6, 0.5, 8000);
const player = { rec, followPid: 1, time: 2, hulls, kills: rec.kills,
                 ctx: { camera: cam, groundHeight: () => -10, waterLevel: () => -100 } };
const camera = new ReplayCamera(player);
player.camera = camera;

/** The hulls where the recording has them at `t`, as replay.js draws them. */
function placeHulls(t) {
  for (const [life, h] of hulls) {
    const p = recording.positionAt(life, t, [0, 0, 0]);
    h.root.position.set(p[0], p[1], -p[2]);
    h.root.updateMatrixWorld(true);
  }
}
/** Play the round from `t0` to `t1` at 60 frames a second. */
function play(t0, t1) {
  let t = t0;
  for (; t <= t1 + 1e-9; t += 1 / 60) {
    player.time = t;
    placeHulls(t);
    camera.update(1 / 60, t);
  }
  return t1;
}
const r3 = v => v.map(x => +x.toFixed(3));
const fwdOf = () => new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
/** Degrees between the camera's forward and the line to `p`. */
const offAxis = p => +THREE.MathUtils.radToDeg(fwdOf().angleTo(p.clone().sub(cam.position))).toFixed(3);
const shot = () => {
  const o = camera.outsideShot;
  return o ? { kind: o.kind, mode: o.mode, rel: r3(o.rel), anchor: r3(o.anchor), radius: o.radius ?? null, law: o.law ?? null } : null;
};
const eyeWorld = h => h.eye.getWorldPosition(new THREE.Vector3());

const results = {};

// --- the tank: chase, front chase, fly-by -----------------------------------------------
play(2, 2.5);
results.orbitFirst = { mode: camera.mode, toEye: +cam.position.distanceTo(eyeWorld(tank)).toFixed(2) };
results.keyChase = camera.cameraKey(2);
// The swoop: the first frame starts from the orbit's view, then eases.
play(2.5 + 1 / 60, 2.5 + 1 / 60);
results.chaseFirst = { toEye: +cam.position.distanceTo(eyeWorld(tank)).toFixed(2) };
play(2.6, 8);
results.chase = { ...shot(), offAxis: offAxis(eyeWorld(tank)), lens: [cam.fov, cam.near], sight: camera.sight?.kind ?? null,
                  firstPersonHull: Boolean(camera.firstPersonHull) };
results.keyFront = camera.cameraKey(3);
play(8, 13);
results.front = { ...shot(), offAxis: offAxis(eyeWorld(tank)) };
// A seek settles it where it rests at once.
results.seekBack = (() => {
  play(4, 4);
  return shot();
})();
results.keyFlyby = camera.cameraKey(4);
play(4.1, 5);
results.flyby = { ...shot(), toHull: +cam.position.distanceTo(tank.root.position).toFixed(1),
                  offAxis: offAxis(tank.root.position) };
// The page's own cameras are unchanged: F9 is his eyes, 1 the orbit.
results.keyInside = camera.cameraKey(1);
play(5.1, 5.2);
results.inside = { mode: camera.mode, sight: camera.sight?.kind ?? null, toEye: +cam.position.distanceTo(eyeWorld(tank)).toFixed(3),
                   outside: shot() };
camera.setMode('orbit');
play(5.3, 5.5);
results.orbitAfter = { mode: camera.mode, outside: shot(), toEye: +cam.position.distanceTo(eyeWorld(tank)).toFixed(1) };

// --- a seat whose Camera says CVMChase 0 ------------------------------------------------
player.followPid = 2;
camera.followChanged();
play(5.6, 5.8);
results.lockedModes = camera.outsideModesAt(5.8);
results.lockedChase = camera.cameraKey(2);
results.lockedFront = camera.cameraKey(3);
play(5.9, 6.5);
results.lockedFrontShot = shot();
// Put in the chase anyway (a kept clip, a mode carried from another seat):
// the seat's own inside, as `setViewMode` keeps a seat in mode 3.
camera.setMode('chase');
play(6.6, 6.8);
results.lockedForced = { mode: camera.mode, sight: camera.sight?.kind ?? null, outside: shot(),
                         toEye: +cam.position.distanceTo(eyeWorld(locked)).toFixed(3) };

// --- on foot ------------------------------------------------------------------------------
player.followPid = 3;
camera.followChanged();
camera.setMode('pov');
play(6.9, 7);
const footEye = cam.position.clone();
results.footPov = r3(footEye.toArray());
results.footChase = camera.cameraKey(2);
results.footFront = camera.cameraKey(3);
results.footFlyby = camera.cameraKey(4);
play(7.1, 9);
results.foot = { ...shot(), mode: camera.mode, aim: camera.footChase.aim, hidePid: camera.hidePid,
                 lookAt: r3(camera.footChase.aimAt.toArray()), offAxis: offAxis(camera.footChase.aimAt) };

// --- the creator's cameras: the game's three, filmed by the replay's camera ---------------
{
  const [{ CutRig }, cuts] = await Promise.all([imp('replay-camtrack.js'), imp('replay-cuts.js')]);
  const asked = [];
  const scene = { gameView: mode => { asked.push(mode); return true; } };
  const rig = new CutRig(scene, []);
  const scratch = new THREE.PerspectiveCamera();
  const take = { f: { pid: 1 }, kill: { victim: 2 } };
  results.creator = {
    filmed: ['gamechase', 'gamefront', 'gameflyby'].map(id => rig.poseOf({ cam: id }, 5, scratch, 0)),
    asked,
    drag: (rig.active = { cam: 'gamechase' }, rig.drag(1, 1)),
    usable: ['gamechase', 'gamefront', 'gameflyby'].map(id => cuts.camsFor(take).includes(id)),
    noTake: ['gamechase', 'gamefront', 'gameflyby'].some(id => cuts.camsFor(null).includes(id)),
    recipes: cuts.CAM_RECIPES.filter(([id]) => id.startsWith('game')).map(([id, , , cams]) => [id, cuts.camsOf(cams, take)?.[0]?.cam ?? null]),
    labels: ['gamechase', 'gamefront', 'gameflyby'].map(cuts.camLabel),
  };
}

process.stdout.write(JSON.stringify(results));
