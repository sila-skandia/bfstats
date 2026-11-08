// The dogfight school's sphere (features/dogfight-school, "The sphere"): the
// fight's geometry as one instrument, bottom right of the live fight. You at
// the centre of a sphere big enough to hold the two of you, them where they
// are against you with their nose and a drop line to your level, the last
// seconds of both paths, the horizon through the middle (it tilts as your
// silhouette banks), the ground when it is near, and, with the guide on, the
// next seconds the guide would fly, drawn inside the sphere instead of across
// the sky. The camera sits behind you along your heading and above, with the
// world's up kept up, so "behind" reads as below the centre and "ahead" as
// above it, the way the edge arrow reads (`dogfight-live.js` `markHim`).
//
// The page's own renderer draws it into its window after the main render
// (`dogfight-live.js` `renderInset`). Nothing here touches the DOM, so the
// tests fly it under node (`tests/test_dogfight_sphere.py`).

import * as THREE from 'three';
import { basis, len, sub, clamp } from './dogfight-flight.js';

export const SPHERE = {
  /** The radius is the range times `fit`, between `min` and `max` metres. */
  fit: 1.35, min: 150, max: 2500,
  /** Seconds the radius takes to settle when the range closes; it grows at
   *  once when they would otherwise leave the sphere. */
  tau: 0.8,
  /** The camera, in radii: behind you along your heading, and above. */
  back: 2.3, up: 1.1, fov: 50,
  /** Seconds the heading frame takes to follow your nose round. */
  headTau: 0.35,
  /** Past this much of the nose pointing up or down the heading is held. */
  vertical: 0.92,
  /** Samples of each trail kept (the live fight keeps about four seconds). */
  trail: 240,
  /** Samples of each guide path kept. */
  path: 400,
  /** Marker size, nose line and shot ring, in radii. */
  mark: 0.075, nose: 0.26, shot: 0.035,
};

/** A plane seen from above, nose up the page, a metre long: the markers. */
function planeShape() {
  const s = new THREE.Shape();
  const pts = [[0, 1], [0.1, 0.45], [0.1, 0.15], [1, 0], [1, -0.2], [0.1, -0.3], [0.1, -0.7], [0.42, -0.86], [0.42, -1], [0, -0.94],
               [-0.42, -1], [-0.42, -0.86], [-0.1, -0.7], [-0.1, -0.3], [-1, -0.2], [-1, 0], [-0.1, 0.15], [-0.1, 0.45]];
  s.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) s.lineTo(x, y);
  s.closePath();
  // The shape's +y is the nose; the airframe flies down -z.
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
}

/** A circle of `n` points, radius 1, in the xz plane at height `y`. */
function circle(n, y = 0, r = 1) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(Math.cos(i / n * Math.PI * 2) * r, y, Math.sin(i / n * Math.PI * 2) * r));
  return new THREE.BufferGeometry().setFromPoints(pts);
}

/** A line whose points are set every frame, up to `n` of them. */
function dynamicLine(n, material) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setDrawRange(0, 0);
  const line = new THREE.Line(geo, material);
  line.frustumCulled = false;
  return line;
}

/** `pts` (world points) written into `line` relative to `origin`. */
function setLine(line, pts, origin, step = 1) {
  const attr = line.geometry.attributes.position;
  let n = 0;
  for (let i = 0; i < pts.length && n < attr.count; i += step) {
    const p = pts[i];
    attr.setXYZ(n++, p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]);
  }
  attr.needsUpdate = true;
  line.geometry.setDrawRange(0, n);
  line.visible = n > 1;
  return n;
}

/**
 * The sphere. `colors` are css values for you, him, the hit (the shot ring),
 * the ink (the cage) and the warn (the ground). `update` takes both states
 * (`stateOf`), the frame's `dt`, both trails (world points, oldest first),
 * the guide's flight (`runDuel`'s result, or null), the ground's height
 * under you and whether the guide is on. `project` turns a world point into
 * the window's normalised coordinates, for labels over it.
 */
export function createTacticalSphere(colors = {}) {
  const C = { you: '#7da34c', him: '#d65a5a', hit: '#c5a23a', ink: '#9a9a9a', warn: '#c5a23a', ...colors };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(SPHERE.fov, 1, 1, 50000);
  const lineMat = (color, opacity, extra = {}) => new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false, ...extra });
  const meshMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false, side: THREE.DoubleSide });

  // The cage: the horizon, latitude rings above and below it. World-aligned,
  // scaled to the radius.
  const cage = new THREE.Group();
  cage.add(new THREE.LineLoop(circle(96), lineMat(C.ink, 0.55)));
  for (const deg of [30, 60, -30, -60]) {
    const a = deg * Math.PI / 180;
    cage.add(new THREE.LineLoop(circle(72, Math.sin(a), Math.cos(a)), lineMat(C.ink, 0.16)));
  }
  // The ground, when it is inside the sphere: a ring at its height.
  const ground = new THREE.LineLoop(circle(96, 0, 0.98), lineMat(C.warn, 0.5));
  ground.visible = false;
  // The two of you.
  const shape = planeShape();
  const me = new THREE.Mesh(shape, meshMat(C.you, 0.95));
  const them = new THREE.Mesh(shape, meshMat(C.him, 0.95));
  const myNose = dynamicLine(2, lineMat(C.you, 0.7));
  const theirNose = dynamicLine(2, lineMat(C.him, 0.7));
  const drop = dynamicLine(2, lineMat(C.him, 0.35));
  const foot = new THREE.LineLoop(circle(24), lineMat(C.him, 0.45));
  const los = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
                             new THREE.LineDashedMaterial({ color: C.ink, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false, dashSize: 10, gapSize: 8 }));
  los.frustumCulled = false;
  const myTrail = dynamicLine(SPHERE.trail, lineMat(C.you, 0.8));
  const theirTrail = dynamicLine(SPHERE.trail, lineMat(C.him, 0.8));
  // The guide's next seconds, and where its shot comes.
  const myPath = dynamicLine(SPHERE.path, lineMat(C.you, 0.55));
  const theirPath = dynamicLine(SPHERE.path, lineMat(C.him, 0.4));
  const shot = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 6, 32), meshMat(C.hit, 0.95));
  shot.visible = false;
  for (const o of [cage, ground, me, them, myNose, theirNose, drop, foot, los, myTrail, theirTrail, myPath, theirPath, shot]) {
    o.frustumCulled = false;
    scene.add(o);
  }
  me.renderOrder = them.renderOrder = 3;
  shot.renderOrder = 4;

  const S = { radius: null, head: null, him: null, range: 0, behind: false, paths: 0, ground: false };
  const _v = new THREE.Vector3();

  /** The heading frame: your nose on the horizontal, smoothed, held when the
   *  nose is near vertical. */
  function heading(you, dt) {
    const F = basis(you.orientation).F;
    const flat = Math.hypot(F[0], F[2]);
    const target = flat > 1e-6 && Math.abs(F[1]) < SPHERE.vertical ? [F[0] / flat, F[2] / flat] : S.head;
    if (!S.head) S.head = target ?? [0, -1];
    else if (target) {
      const a = 1 - Math.exp(-dt / SPHERE.headTau);
      // The short way round, so a heading through the seam never spins.
      let dx = target[0] - S.head[0], dz = target[1] - S.head[1];
      S.head = [S.head[0] + dx * a, S.head[1] + dz * a];
      const l = Math.hypot(S.head[0], S.head[1]);
      if (l < 1e-3) S.head = target; else S.head = [S.head[0] / l, S.head[1] / l];
    }
    return S.head;
  }

  function update({ you, him, dt = 1 / 60, trails = null, lines = null, groundY = null, guideOn = true }) {
    const rel = sub(him.position, you.position);
    const range = len(rel);
    S.range = range;
    // The radius: snapped out when they would leave the sphere, eased in.
    const want = clamp(range * SPHERE.fit, SPHERE.min, SPHERE.max);
    if (S.radius == null || want > S.radius) S.radius = want;
    else S.radius += (want - S.radius) * (1 - Math.exp(-dt / SPHERE.tau));
    const R = S.radius;
    const h = heading(you, dt);
    camera.position.set(-h[0] * SPHERE.back * R, SPHERE.up * R, -h[1] * SPHERE.back * R);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.near = R * 0.05;
    camera.far = R * 8;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();

    cage.scale.setScalar(R);
    const gy = groundY == null ? null : groundY - you.position[1];
    ground.visible = gy != null && Math.abs(gy) < R;
    if (ground.visible) { ground.position.set(0, gy, 0); ground.scale.setScalar(R); }
    S.ground = ground.visible;

    const m = SPHERE.mark * R;
    me.quaternion.set(you.orientation.x, you.orientation.y, you.orientation.z, you.orientation.w);
    me.scale.setScalar(m);
    them.position.set(rel[0], rel[1], rel[2]);
    them.quaternion.set(him.orientation.x, him.orientation.y, him.orientation.z, him.orientation.w);
    them.scale.setScalar(m);
    const n = SPHERE.nose * R;
    const Fy = basis(you.orientation).F, Fh = basis(him.orientation).F;
    setLine(myNose, [[0, 0, 0], [Fy[0] * n, Fy[1] * n, Fy[2] * n]], [0, 0, 0]);
    setLine(theirNose, [rel, [rel[0] + Fh[0] * n, rel[1] + Fh[1] * n, rel[2] + Fh[2] * n]], [0, 0, 0]);
    setLine(drop, [rel, [rel[0], 0, rel[2]]], [0, 0, 0]);
    foot.position.set(rel[0], 0, rel[2]);
    foot.scale.setScalar(m * 0.5);
    const lp = los.geometry.attributes.position;
    lp.setXYZ(1, rel[0], rel[1], rel[2]);
    lp.needsUpdate = true;
    los.material.dashSize = R * 0.03;
    los.material.gapSize = R * 0.025;
    los.computeLineDistances();

    if (trails) {
      setLine(myTrail, trails.you ?? [], you.position);
      setLine(theirTrail, trails.him ?? [], you.position);
    } else myTrail.visible = theirTrail.visible = false;

    // The guide's flight, from where it was flown (world points), so a path
    // you have left stays where it was and the gap shows.
    const show = guideOn && lines?.tracks?.[1]?.length > 1;
    if (show) {
      const step = Math.max(1, Math.ceil(lines.tracks[1].length / SPHERE.path));
      S.paths = setLine(myPath, lines.tracks[1].map(k => k.p), you.position, step);
      setLine(theirPath, lines.tracks[0].map(k => k.p), you.position, step);
      const first = lines.tracks[1].find(k => k.o);
      shot.visible = !!first;
      if (first) {
        shot.position.set(first.p[0] - you.position[0], first.p[1] - you.position[1], first.p[2] - you.position[2]);
        shot.quaternion.set(...first.q);
        shot.scale.setScalar(SPHERE.shot * R);
      }
    } else {
      myPath.visible = theirPath.visible = shot.visible = false;
      S.paths = 0;
    }
    const ndc = project(him.position, you.position);
    S.him = ndc;
    _v.set(rel[0], rel[1], rel[2]);
    S.behind = Fy[0] * rel[0] + Fy[1] * rel[1] + Fy[2] * rel[2] < 0;
    return { ...S };
  }

  /** A world point in the window's normalised coordinates (x right, y up,
   *  -1..1), or null behind the camera. `origin` is your position. */
  function project(p, origin) {
    _v.set(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]).project(camera);
    return _v.z > 1 ? null : [_v.x, _v.y];
  }

  function reset() { S.radius = null; S.head = null; S.him = null; S.paths = 0; }

  return {
    scene, camera, update, project, reset,
    get radius() { return S.radius; },
    get state() {
      return S.radius == null ? null : { radius: Math.round(S.radius), range: Math.round(S.range), behind: S.behind,
                                         him: S.him ? S.him.map(v => +v.toFixed(2)) : null, paths: S.paths, ground: S.ground };
    },
  };
}
