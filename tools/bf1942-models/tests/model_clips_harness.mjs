// Drives `viewer/model-clips.js` (the model browser's engine switch) outside a
// browser: the pairs that hang under an Engine turn on its revs (PHY-30).
import * as THREE from 'three';
import { createEngineClips } from './model-clips.js';

const DT = 1 / 30;
const lodPair = (prefix, comparison, tilt = 0) => {
  const lod = new THREE.Object3D();
  lod.name = `lod${prefix}`;
  lod.quaternion.setFromEuler(new THREE.Euler(tilt, 0, 0.3));
  lod.userData = { templateKind: 'LodObject', propellerBlur: {
    static: `${prefix}Static`, blurred: `${prefix}Blurred`, selectorKind: 'CompareSelector',
    distances: [], comparisons: [comparison] } };
  const a = new THREE.Object3D(); a.name = `${prefix}Static`;
  const b = new THREE.Object3D(); b.name = `${prefix}Blurred`;
  lod.add(a, b);
  return lod;
};
const engine = (name, extras, lod) => {
  const node = new THREE.Object3D();
  node.name = name;
  node.userData = { templateKind: 'Engine', control: 'Veh', ...extras };
  node.add(lod);
  return node;
};

const make = (nodes, animations = []) => {
  const scene = new THREE.Group();
  for (const n of nodes) scene.add(n);
  const inputs = new Map();
  const calls = { animating: 0, invalidate: 0, refresh: 0 };
  const clips = createEngineClips({
    inputValues: inputs,
    invalidate: () => { calls.invalidate++; },
    refreshCrew: () => { calls.refresh++; },
    startAnimating: () => { calls.animating++; },
  });
  clips.collectAnimations({ scene, animations });
  return { clips, inputs, calls, scene };
};
const state = clips => clips.propellerBlurPairs.map(pair => ({
  revs: +(pair.revs ?? NaN).toFixed(4), disc: pair.blurred.visible && !pair.static.visible,
  blade: pair.static.visible && !pair.blurred.visible,
  discTurn: +pair.blurredAngle.toFixed(2), bladeTurn: +pair.staticAngle.toFixed(2) }));
const run = (clips, seconds) => { for (let i = 0; i < Math.round(seconds / DT); i++) clips.advanceLods(DT); };

const out = {};

{
  // The Flettner's rotors: no input, pinned span. No lever, no clip.
  const rotor = (name, sign) => engine(name, {
    physics: { engineType: 'c_ETPlane', maxRotation: [0, 0, 150 * sign], minRotation: [0, 0, 150 * sign],
               maxSpeed: [0, 0, 1000], acceleration: [0, 0, 500 * sign], automaticReset: true } },
    lodPair(`${name}Rotary`, 0.5));
  const { clips, calls } = make([rotor('LeftRotor', 1), rotor('RightRotor', -1)]);
  const before = { hasEngine: clips.hasEngine, mixer: clips.mixer !== null, ...{ state: state(clips) } };
  clips.setEngine(true);
  run(clips, 0.1);
  const early = state(clips);
  run(clips, 2);
  const running = state(clips);
  clips.setEngine(false);
  const off = state(clips);
  out.rotors = { before, early, running, off, animating: calls.animating };
}

{
  // A bound engine follows the throttle lever; the baked `spin` clip does not
  // play for it (it would swing the gear hatches listed under the Engine too).
  const lod = lodPair('Prop', 0.07);
  const hatch = new THREE.Object3D(); hatch.name = 'GearHatch';
  const eng = engine('Engine', {
    physics: { engineType: 'c_ETPlane', maxRotation: [0, 0, 5000] },
    rig: { control: 'Veh', automaticReset: true, axes: { roll: {
      input: 'c_PIThrottle', min: -3000, max: 5000, free: false, driver: 'rate', maxSpeed: 500 } } },
  }, lod);
  eng.add(hatch);
  const spin = new THREE.AnimationClip('spin', 1, [
    new THREE.QuaternionKeyframeTrack('GearHatch.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 1, 0])]);
  const { clips, inputs } = make([eng], [spin]);
  clips.setEngine(true);
  run(clips, 1);
  const leverAtRest = state(clips);
  inputs.set('Veh/c_PIThrottle', 1);
  run(clips, 5);
  const leverFull = state(clips);
  out.bound = {
    leverAtRest, leverFull, clipActions: clips.clipActions.length, hasEngine: clips.hasEngine,
    hatch: +hatch.quaternion.w.toFixed(4),
  };
}

{
  // An asset with no engine pairs: the old behaviour, a bare swap and its clips.
  const lod = lodPair('Legacy', 0.07);
  const holder = new THREE.Object3D(); holder.name = 'NotAnEngine'; holder.userData = { templateKind: 'Bundle' };
  holder.add(lod);
  const spin = new THREE.AnimationClip('spin', 1, [
    new THREE.QuaternionKeyframeTrack('NotAnEngine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 1, 0])]);
  const { clips } = make([holder], [spin]);
  clips.setEngine(true);
  out.legacy = { hasEngine: clips.hasEngine, state: state(clips), clipActions: clips.clipActions.length,
                 pairEngine: clips.propellerBlurPairs[0].engine };
}

console.log(JSON.stringify(out));
