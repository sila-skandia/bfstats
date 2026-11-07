// The theatre's planes drawn the game's way (features/dogfight-school,
// "The planes' own propellers and tracers"). Run after the head of
// `dogfight_school_harness.mjs`, as `test_dogfight_plane_look.py` joins
// them (the head brings THREE). Prints one JSON blob.

import { makeTracer, poseTracer, propellersOf, tracerGunOf, tracerRounds, turnPropellers } from './dogfight-plane-look.js';

const look = {};

// The revs a flight records, tick by tick.
{
  const L = LESSONS[0];
  const r = runDuel({ makePlane, seconds: 6, groundAt: () => 0, sides: demoSides(L, L.demos[0]) });
  const rv = r.tracks.flatMap(tr => tr.map(k => k.rv));
  look.revs = { n: rv.length, finite: rv.filter(v => Number.isFinite(v)).length, min: Math.min(...rv), max: Math.max(...rv) };
}

// The tracer cadence: 30 duel rounds a second, a gun of 12 a second with a
// tracer every third.
{
  const rounds = [];
  for (let n = 0; n < 30; n++) for (const side of [0, 1]) rounds.push({ side, t: n / 30 });
  const gun = { rate: 12, interval: 3 };
  const set = tracerRounds(rounds, [gun, { rate: 12, interval: 1 }]);
  look.cadence = [0, 1].map(side => [...set].filter(r => r.side === side).length);
}

// A propeller pair under an Engine: the blades turn on the revs and give
// way to the disc past comparison^2.
{
  const engine = new THREE.Group();
  engine.userData = { templateKind: 'Engine' };
  const lod = new THREE.Group();
  lod.userData = { propellerBlur: { static: 'PropStatic', blurred: 'PropBlurred', comparisons: [0.08] } };
  const st = new THREE.Group(); st.name = 'PropStatic';
  const bl = new THREE.Group(); bl.name = 'PropBlurred';
  lod.add(st, bl);
  engine.add(lod);
  const pairs = propellersOf(engine);
  const angle = q => Math.round(2 * Math.acos(Math.min(1, Math.abs(q.w))) * 180 / Math.PI);
  turnPropellers(pairs, 0.005, 0.1);
  const slow = { disc: bl.visible, blades: st.visible, turned: angle(st.quaternion) };
  turnPropellers(pairs, 1, 0.1);
  const fast = { disc: bl.visible, blades: st.visible, turned: angle(bl.quaternion) };
  turnPropellers(pairs, 1, 0);
  const paused = angle(bl.quaternion);
  look.props = { pairs: pairs.length, slow, fast, paused };
}

// The gun's own streak, sized the engine's way.
{
  const root = new THREE.Group();
  const guns = new THREE.Group();
  guns.userData = { fireArms: { roundOfFire: 12, velocity: 400, tracer: { interval: 3, scaler: 50 } } };
  const geo = new THREE.BoxGeometry(0.0061, 0.0061, 1);
  geo.translate(0, 0, 0.5);
  const streak = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 }));
  streak.userData = { tracerMesh: true };
  streak.visible = false;
  guns.add(streak);
  root.add(guns);
  const gun = tracerGunOf(root);
  const mesh = makeTracer(gun);
  const dir = new THREE.Vector3(0, 0, -1);
  poseTracer(mesh, gun, new THREE.Vector3(0, 100, 0), dir, 4, 1, 0);
  const young = mesh.scale.toArray().map(v => +v.toFixed(3));
  poseTracer(mesh, gun, new THREE.Vector3(0, 100, -200), dir, 200, 1, 0);
  const grown = mesh.scale.toArray().map(v => +v.toFixed(3));
  // Its tail (+Z) trails behind the round, back toward the gun.
  mesh.updateMatrixWorld(true);
  const tail = new THREE.Vector3(0, 0, 1).applyMatrix4(mesh.matrixWorld);
  poseTracer(mesh, gun, new THREE.Vector3(0, 100, -200), dir, 200, 1, 0.5);
  const far = { across: +mesh.scale.x.toFixed(2), opacity: +mesh.material.opacity.toFixed(3) };
  look.tracer = { rate: gun.rate, interval: gun.interval, length: gun.length, tail: gun.tail, visible: mesh.visible,
                  young, grown, tailZ: +tail.z.toFixed(2), far, standIn: !tracerGunOf(new THREE.Group()).template };
}

console.log(JSON.stringify(look));
