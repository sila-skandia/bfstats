// The sphere (`viewer/dogfight-sphere.js`, features/dogfight-school "The
// sphere") under node: two states fed to it, where they land in its window.
// Prints one JSON blob; `test_dogfight_sphere.py` reads it.
import * as THREE from 'three';
import { createTacticalSphere, SPHERE } from './dogfight-sphere.js';

const out = { rules: SPHERE };
const quat = (pitch = 0, yaw = 0, roll = 0) => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
  return { x: q.x, y: q.y, z: q.z, w: q.w };
};
// Level, nose along -z (the airframe's own forward), 60 m/s, at 400 m.
const state = (p, q = quat(), v = [0, 0, -60]) => ({ position: p, velocity: v, orientation: q, angularVelocity: [0, 0, 0] });
const you = state([0, 400, 0]);

// The radius holds him with room, within its bounds.
{
  const S = createTacticalSphere();
  out.radius = {};
  for (const [name, range] of [['near', 50], ['mid', 400], ['far', 3000]]) {
    S.reset();
    out.radius[name] = S.update({ you, him: state([0, 400, -range]) }).radius;
  }
  // It grows at once, and eases back in over seconds.
  S.reset();
  S.update({ you, him: state([0, 400, -400]) });
  const r0 = S.radius;
  S.update({ you, him: state([0, 400, -100]), dt: 1 / 60 });
  const r1 = S.radius;
  for (let i = 0; i < 300; i++) S.update({ you, him: state([0, 400, -100]), dt: 1 / 60 });
  const r2 = S.radius;
  S.update({ you, him: state([0, 400, -1500]), dt: 1 / 60 });
  out.radius.ease = { r0, r1, r2, r3: S.radius };
}

// Where he lands in the window: behind reads below the centre, ahead above,
// right to the right; always inside the window.
{
  const S = createTacticalSphere();
  out.where = {};
  for (const [name, p] of [['behind', [0, 400, 300]], ['ahead', [0, 400, -300]], ['right', [300, 400, 0]], ['left', [-300, 400, 0]],
                           ['behindAbove', [0, 600, 250]], ['behindBelow', [0, 200, 250]], ['high', [0, 700, -20]]]) {
    S.reset();
    const s = S.update({ you, him: state(p) });
    out.where[name] = { him: s.him, behind: s.behind };
  }
  // Heading east (nose +x) with him behind (to the west) reads below too.
  S.reset();
  const east = state([0, 400, 0], quat(0, -Math.PI / 2));
  out.where.eastBehind = S.update({ you: east, him: state([-300, 400, 0]) }).him;
}

// Through a loop the heading frame holds: the camera does not swing round
// as the nose goes through the vertical.
{
  const S = createTacticalSphere();
  S.update({ you, him: state([0, 400, 300]) });
  const c0 = S.camera.position.toArray();
  for (let i = 0; i < 30; i++) S.update({ you: state([0, 400, 0], quat(88 * Math.PI / 180)), him: state([0, 400, 300]), dt: 1 / 60 });
  const c1 = S.camera.position.toArray();
  out.loop = { c0: c0.map(Math.round), c1: c1.map(Math.round) };
}

// The guide's seconds, drawn when on; the ground when near.
{
  const S = createTacticalSphere();
  const tracks = [[], []];
  for (let i = 0; i < 120; i++) {
    const t = i / 60;
    tracks[1].push({ t, p: [0, 400 + t * 5, -t * 60], q: [0, 0, 0, 1], o: t > 1.5 });
    tracks[0].push({ t, p: [0, 400, -300 - t * 60], q: [0, 0, 0, 1], o: false });
  }
  const lines = { tracks, dt: 1 / 60 };
  const trails = { you: [[0, 400, 60], [0, 400, 30], [0, 400, 0]], him: [[0, 400, -240], [0, 400, -270], [0, 400, -300]] };
  const on = S.update({ you, him: state([0, 400, -300]), lines, trails, groundY: 300, guideOn: true });
  const off = S.update({ you, him: state([0, 400, -300]), lines, trails, groundY: 300, guideOn: false });
  const high = S.update({ you: state([0, 3000, 0]), him: state([0, 3000, -300]), lines: null, trails: null, groundY: 0 });
  out.lines = { on: { paths: on.paths, ground: on.ground }, off: { paths: off.paths, ground: off.ground }, high: { paths: high.paths, ground: high.ground } };
  out.lines.shotVisible = S.scene.children.some(o => o.geometry?.type === 'TorusGeometry' && o.visible);
  S.update({ you, him: state([0, 400, -300]), lines, trails, groundY: 300, guideOn: true });
  out.lines.shotVisibleOn = S.scene.children.some(o => o.geometry?.type === 'TorusGeometry' && o.visible);
}

process.stdout.write(JSON.stringify(out));
