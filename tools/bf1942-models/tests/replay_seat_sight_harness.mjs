// A replayed tank's distance-selected sight is drawn where the view's eye
// reaches it, and nowhere else. The owner's report (2026-10-27, FHSWEurope
// Meuse River Line, Chief-H.E.M.P in an M36B1): the gunner's sight, a black
// panel with the round scope, drawn over the scene in a view outside the
// sight. FHSW hangs the M36B1's sight on `lodM36Cockpit`, a DistanceSelector
// of 0.1 m 1.4 m ahead of M36Camera, where the Camera's `OutsideHudOffset`
// puts the nose view's eye (ledger LOD-3). The replay's camera gave the
// hull's drive no eye, so the swap followed the view alone: the sight was up
// in the cockpit view and down in the nose view, the page's own rule
// (f0861286) inverted.
//
// The real `graftCockpitInto` / `applyCockpitSwaps` (vehicle-base.js) and
// `ReplayCamera` (replay-camera.js) under node; the drive is the `Vehicle`'s
// own `setFirstPerson` over them. One JSON report on stdout;
// `tests/test_replay_seat_sight.py` asserts on it.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, recording, { ReplayCamera }, { graftCockpitInto, applyCockpitSwaps }] = await Promise.all([
  imp('vendor/three.module.js'), imp('replay-recording.js'), imp('replay-camera.js'), imp('vehicle-base.js'),
]);

const line = o => JSON.stringify(o);
const node = (name, userData = {}, children = []) => {
  const obj = new THREE.Group();
  obj.name = name;
  obj.userData = userData;
  for (const child of children) obj.add(child);
  return obj;
};

// The tank, driven by pid 1 from 1 s to 11 s.
const lines = [
  line({ k: 'h', v: 5, start: '', hz: 10 }),
  line({ k: 'e', t: 1, e: 'gameRules', extViews: 1, noseCam: 1, soldierFF: 1, ticketRatio: 1, timeLimit: 0, worldTime: 0, crosshair: 1 }),
  line({ k: 'e', t: 1, e: 'createObject', tid: 1, netId: 80, tmpl: 'M36B1', pos: [0, 0, 0], rot: [0, 0, 0] }),
  line({ k: 'o', t: 1, id: 80, gid: 1, tmpl: 'M36B1', tid: 1, team: 2, maxhp: 119 }),
  line({ k: 'p', t: 1, p: [[1, 2, 80, 80, 0, 0]] }),
];
for (let i = 0; i <= 100; i++) lines.push(line({ k: 's', t: +(1 + i * 0.1).toFixed(1), o: [[80, 0, 0, 0, 0, 0, 0, 1]] }));
lines.push(line({ k: 'end', t: 11 }));
const rec = recording.parseRecording(lines.join('\n'));
const life = rec.lives.find(l => l.nid === 80);

/** FHSW's M36B1 as exported: M36Camera with its OutsideHudOffset (glTF
 *  axes, -Z ahead), and the sight's LodObject where that offset puts the
 *  eye, its exterior alternative in place. */
function tank() {
  const eye = node('M36Camera', { templateKind: 'Camera', control: 'M36B1',
    cameraView: { control: 'M36B1', outsideHudOffset: [0, 0, -1.4] } });
  eye.position.set(0.57, 2.0, 1.07);
  const external = node('M36CockpitExternal', { control: 'M36B1' });
  const host = node('lodM36Cockpit', { control: 'M36B1' }, [external]);
  host.position.set(0.57, 2.0, 1.07 - 1.4);
  const root = node('M36B1', { control: 'M36B1', physics: { vehicleCategory: 'VCLand' } }, [eye, host]);
  root.updateMatrixWorld(true);
  return { root, eye, host, external };
}

/** `M36B1.cockpit.glb`: the same walk pruned to the interior, the 0.1 m
 *  DistanceSelector the exporter stamps. */
function cockpit() {
  const internal = node('M36CockpitInternal', { control: 'M36B1' });
  const scene = node('scene', {}, [node('M36B1', { control: 'M36B1' }, [
    node('lodM36Cockpit', {
      control: 'M36B1',
      lodAlternative: { selected: 'M36CockpitInternal', replaces: ['M36CockpitExternal'],
        selectorKind: 'DistanceSelector', distances: [0.1], comparisons: [] },
    }, [internal]),
  ])]);
  return { internal, scene };
}

const { root, eye, host, external } = tank();
const { internal, scene } = cockpit();
// The `Vehicle`'s own swap call (vehicle-base.js `setFirstPerson`).
const drive = {
  control: 'M36B1', seatControl: null, viewEye: null, firstPerson: false, swaps: [],
  setFirstPerson(on) {
    this.firstPerson = !!on;
    applyCockpitSwaps(this.swaps, this.firstPerson, this.seatControl ?? this.control, this.viewEye?.() ?? null);
    return this.firstPerson;
  },
  loadCockpit(modelsBase, prepare) {
    this.swaps = graftCockpitInto(root, scene);
    this.setFirstPerson(this.firstPerson);
    return Promise.resolve(this);
  },
};
const hull = {
  group: root, root, drive, kind: 'ground',
  occupancy: { rootId: 'M36B1', cameraNodeOf: () => eye },
  seatIdAt: () => 'M36B1',
};
const cam = new THREE.PerspectiveCamera(60, 1.6, 0.5, 8000);
const player = { rec, followPid: 1, time: 5, hulls: new Map([[life, hull]]),
                 ctx: { camera: cam, groundHeight: () => -10, waterLevel: () => -100 } };
const camera = new ReplayCamera(player);
player.camera = camera;

const settle = async () => {
  for (let i = 0; i < 90; i++) camera.update(1 / 60, 5);
  await new Promise(r => setTimeout(r, 0));
  camera.update(1 / 60, 5);
};
const eyeAt = eye.getWorldPosition(new THREE.Vector3());
const hostAt = host.getWorldPosition(new THREE.Vector3());
const state = () => ({
  mode: camera.mode, view: camera.sight?.view ?? null,
  sight: internal.visible, exterior: external.visible,
  eyeToSight: +cam.position.distanceTo(hostAt).toFixed(3),
  driveEye: Boolean(drive.viewEye),
});

const results = { grafted: false };
camera.setMode('pov');
await settle();
results.grafted = internal.parent === host;
results.cockpit = state();
results.toggled = camera.toggleNose();
await settle();
results.nose = state();
camera.setMode('orbit');
await settle();
results.orbit = state();
camera.setMode('pov');
await settle();
results.cockpitAgain = state();
camera.toggleNose();
await settle();
camera.setMode('free');
await settle();
results.freeFromNose = state();
results.eyeToSight = +eyeAt.distanceTo(hostAt).toFixed(3);

process.stdout.write(JSON.stringify(results));
