// Drives `viewer/track-scroll.js` `followBogies` under node and prints one
// JSON blob for `tests/test_track_belts.py`.
//
// The belt is the Sherman's left one as `bf42/assemble.py` `_bind_belt` bakes
// it: an `AnimatedBundle` SkinnedMesh under the Engine, one joint per
// `useAsBone` child resting at the `.skn`'s bind (0.15 m above its spring),
// and the springs marked with the bone each drives.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { followBogies, restBelts }] = await Promise.all([
  imp('vendor/three.module.js'), imp('track-scroll.js'),
]);

const r = (v, p = 1e5) => Math.round(v * p) / p;
const SPRINGS = [-2.05, -1.2, 0.449, -0.3, 1.249, 2.049];   // the con's order
const SPRING_Y = 0.12;
const BIND_Y = 0.27;

function belt({ skinned = true } = {}) {
  const root = new THREE.Group();
  root.name = 'Sherman';
  root.position.set(100, 20, -50);
  root.quaternion.setFromEuler(new THREE.Euler(0.1, 0.7, -0.05));
  const engine = new THREE.Object3D();
  engine.userData = { templateKind: 'Engine' };
  root.add(engine);
  // One vertex under each bone, on the bottom run, weighted to it alone.
  const positions = [], skinIndex = [], skinWeight = [];
  SPRINGS.forEach((z, k) => {
    positions.push(-1.245, 0.056, z);
    skinIndex.push(k, 0, 0, 0);
    skinWeight.push(1, 0, 0, 0);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  const track = skinned
    ? new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial())
    : new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  track.name = 'ShermanTrackL';
  track.position.set(-0.009, -0.799, 0);
  track.userData = { templateKind: 'AnimatedBundle', animatedTextureSpeed: [0.006, 0] };
  engine.add(track);
  const bogies = SPRINGS.map((z, k) => {
    const node = new THREE.Object3D();
    node.name = 'ShermanWheelL3';
    node.position.set(-0.999, SPRING_Y, z);
    node.userData = { templateKind: 'Spring' };
    if (skinned) node.userData.trackBogie = k;
    track.add(node);
    return node;
  });
  let joints = [];
  if (skinned) {
    track.userData.trackBones = SPRINGS.length;
    joints = SPRINGS.map((z, k) => {
      const bone = new THREE.Bone();
      bone.name = `ShermanTrackL_bone${k}`;
      bone.position.set(-1, BIND_Y, z);
      bone.userData = { trackBone: k };
      track.add(bone);
      return bone;
    });
    const inverses = SPRINGS.map(z => new THREE.Matrix4().makeTranslation(1, -BIND_Y, -z));
    // As GLTFLoader binds a skinned node: identity bind matrix, attached.
    track.bind(new THREE.Skeleton(joints, inverses), new THREE.Matrix4());
  }
  root.updateMatrixWorld(true);
  return { root, track, bogies, joints };
}

/** Vertex k of the belt in the belt node's own frame, as it is drawn. */
function drawn(track, k) {
  track.parent.parent.updateMatrixWorld(true);
  track.skeleton.update();
  const v = new THREE.Vector3();
  track.getVertexPosition(k, v);
  return [r(v.x), r(v.y), r(v.z)];
}

const results = {};
{
  // Nothing drives it: the joints rest at the bind and the belt is the mesh.
  const { track } = belt();
  results.rest = SPRINGS.map((_, k) => drawn(track, k));
}
{
  const { root, track, bogies, joints } = belt();
  // The springs as a drive leaves them: each lifted its own way, and spun.
  const lifts = [0.0, 0.05, 0.21, 0.15, 0.1, 0.3];
  bogies.forEach((node, k) => {
    node.position.y = SPRING_Y + lifts[k];
    node.quaternion.setFromEuler(new THREE.Euler(-1.3 * (k + 1), 0, 0));
  });
  results.posed = followBogies(root);
  results.joints = joints.map(j => [r(j.position.x), r(j.position.y), r(j.position.z)]);
  results.jointTurned = joints.some(j => Math.abs(j.quaternion.w - 1) > 1e-9);
  results.driven = SPRINGS.map((_, k) => drawn(track, k));
  results.lifts = lifts;
  // The bounds a load-time measurement left are dropped for a fresh one.
  results.boundsCleared = track.boundingBox === null && track.boundingSphere === null;
  // A second call is the same poses, no new walk.
  bogies[2].position.y = SPRING_Y;
  followBogies(root);
  results.again = r(joints[2].position.y);
}
{
  // A glb baked before the skin: no joints, nothing posed, nothing thrown.
  const { root, bogies } = belt({ skinned: false });
  bogies[0].position.y += 0.2;
  results.unskinned = followBogies(root);
  results.nothing = [followBogies(null), followBogies({})];
}
{
  // A bone whose bogie the bake dropped keeps its rest.
  const { root, track, bogies, joints } = belt();
  delete bogies[3].userData.trackBogie;
  bogies.forEach(node => { node.position.y = SPRING_Y + 0.2; });
  results.partial = followBogies(root);
  results.orphan = r(joints[3].position.y);
  results.partialDrawn = drawn(track, 3);
}

{
  // A hull handed to a presenter: the belt goes back as the mesh has it.
  const { root, track, bogies, joints } = belt();
  results.restBeforePose = restBelts(root);
  bogies.forEach((node, k) => { node.position.y = SPRING_Y + 0.05 * k; });
  followBogies(root);
  results.restored = restBelts(root);
  results.restoredJoints = joints.map(j => r(j.position.y));
  results.restoredDrawn = SPRINGS.map((_, k) => drawn(track, k)[1]);
  results.restAgain = restBelts(root);
  results.restNothing = [restBelts(null), restBelts(belt({ skinned: false }).root)];
}

process.stdout.write(JSON.stringify(results));
