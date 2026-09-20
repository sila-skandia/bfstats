// `viewer/replay.js` under node: the replayed-aircraft propeller law.
//
// Same pattern as `flight_harness.mjs` — one node run, one JSON report. The
// module under test imports three.js and the vendored SkeletonUtils, so the
// harness stands the vendored files up at their own relative paths and
// publishes `three.module.js` as the `three` package, byte-for-byte the
// viewer's copy.
//
// Why this exists. A `models/<Template>.glb` keeps both of a prop plane's
// meshes as visible siblings under the LodObject wrapper (the blade and the
// blurred disc, assemble.py's `_propeller_blur`), and the playable map picks
// between them from live throttle. A replay has no throttle — the recording
// carries poses and hit points only — so the clone must default to the same
// idle state the level's parked spawners show, or the disc draws straight
// through the blade on every replayed aircraft. That default broke the other
// way once already (the bf109's cockpit LodObject wears the same naming), so
// the cases below pin both the law and its one known false positive.

import * as THREE from 'three';
import { setReplayPropellerIdle } from './replay.js';

const results = {};

function propellerVehicle(rootName, wrapperName, stamp, children) {
  const scene = new THREE.Scene();
  const root = new THREE.Object3D();
  root.name = rootName;
  root.userData = { templateKind: 'PlayerControlObject', control: rootName };
  const wrapper = new THREE.Object3D();
  wrapper.name = wrapperName;
  wrapper.userData = stamp ? { propellerBlur: stamp } : {};
  for (const name of children) {
    const child = new THREE.Object3D();
    child.name = name;
    // The glb exports both alternatives visible; picking one is the
    // viewer's job, never the file's.
    child.visible = true;
    wrapper.add(child);
  }
  root.add(wrapper);
  scene.add(root);
  return scene;
}

const read = scene => {
  const out = {};
  scene.traverse(obj => {
    for (const child of obj.children) out[child.name] = child.visible;
  });
  return out;
};

// A real propeller: the stamp the current exporter writes (Wake's Corsair,
// read straight off the published scene). Idle state after the walk: the
// blade alone — the disc hidden exactly as the level's own parked traverse
// leaves it.
{
  const scene = propellerVehicle('Corsair', 'lodCorsairPropeller', {
    static: 'CorsairPropellerStatic',
    blurred: 'CorsairPropellerBlurred',
    selector: 'CorsairPropSelector',
    selectorKind: 'CompareSelector',
    distances: [],
    comparisons: [0.07],
  }, ['CorsairPropellerStatic', 'CorsairPropellerBlurred']);
  setReplayPropellerIdle(scene);
  const state = read(scene);
  results.corsair = {
    blade: state.CorsairPropellerStatic,
    disc: state.CorsairPropellerBlurred,
  };
}

// The bf109's cockpit LodObject under a `DistCompareSelector`, WITH both
// children — the shape an already-published tree carries. Its "blurred" half
// is the pilot's 1P interior; the walk must leave it exactly as exported.
{
  const scene = propellerVehicle('BF109', 'lodbf109Cockpit', {
    static: 'bf109CockpitStatic',
    blurred: 'bf109CockpitBlurred',
    selector: 'bf109cockpitSelector',
    selectorKind: 'DistCompareSelector',
    distances: [10],
    comparisons: [0.5],
  }, ['bf109CockpitStatic', 'bf109CockpitBlurred']);
  setReplayPropellerIdle(scene);
  const state = read(scene);
  results.bf109CockpitBothHalves = {
    exterior: state.bf109CockpitStatic,
    interior: state.bf109CockpitBlurred,
  };
}

// The fresh-tree shape of the same cockpit: the exporter already excludes the
// 1P interior, so the stamp names a child that is not there. A no-op, and
// never a throw.
{
  const scene = propellerVehicle('BF109', 'lodbf109Cockpit', {
    static: 'bf109CockpitStatic',
    blurred: 'bf109CockpitBlurred',
    selector: 'bf109cockpitSelector',
    selectorKind: 'DistCompareSelector',
    distances: [10],
    comparisons: [0.5],
  }, ['bf109CockpitStatic']);
  setReplayPropellerIdle(scene);
  const state = read(scene);
  results.bf109CockpitFreshTree = {
    exterior: state.bf109CockpitStatic,
    interiorMissing: !('bf109CockpitBlurred' in state),
  };
}

// A wrapper that wears the naming convention with no stamp at all — an asset
// published before the exporter learned the pair. Nothing names it a
// propeller, so nothing may touch it: the level's own load walk has the same
// blind spot, and inventing a name match here would hide a mesh the stamp's
// author never meant to swap.
{
  const scene = propellerVehicle('Mystery', 'lodMysteryPropeller', null,
    ['MysteryPropellerStatic', 'MysteryPropellerBlurred']);
  setReplayPropellerIdle(scene);
  const state = read(scene);
  results.unstampedPair = {
    blade: state.MysteryPropellerStatic,
    disc: state.MysteryPropellerBlurred,
  };
}

// Two propellers on one airframe (the B17 ships four): every stamped wrapper
// is walked, not just the first.
{
  const scene = new THREE.Scene();
  const root = new THREE.Object3D();
  root.name = 'B17';
  root.userData = { templateKind: 'PlayerControlObject', control: 'B17' };
  for (const suffix of ['', '.1', '.2', '.3']) {
    const wrapper = new THREE.Object3D();
    wrapper.name = `lodB17Propeller${suffix}`;
    wrapper.userData = {
      propellerBlur: {
        static: `B17PropellerStatic${suffix}`,
        blurred: `B17PropellerBlurred${suffix}`,
        selector: 'b17propSelector',
        selectorKind: 'CompareSelector',
        distances: [],
        comparisons: [0.07],
      },
    };
    for (const name of [`B17PropellerStatic${suffix}`, `B17PropellerBlurred${suffix}`]) {
      const child = new THREE.Object3D();
      child.name = name;
      child.visible = true;
      wrapper.add(child);
    }
    root.add(wrapper);
  }
  scene.add(root);
  setReplayPropellerIdle(scene);
  const state = {};
  scene.traverse(obj => {
    for (const child of obj.children) state[child.name] = child.visible;
  });
  results.b17AllFour = ['', '.1', '.2', '.3'].map(suffix => ({
    blade: state[`B17PropellerStatic${suffix}`],
    disc: state[`B17PropellerBlurred${suffix}`],
  }));
}

console.log(JSON.stringify(results));
