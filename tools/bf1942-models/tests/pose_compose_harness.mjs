// Drives `viewer/pose-compose.js` outside a browser and prints one JSON blob.
// `tests/test_pose_compose.py` copies the module and its three imports in under
// their own names, and stands the vendored three.js up as a package.
//
// No glb is parsed here: the loader is a stub that hands back a rig built out
// of three.js objects, and `fetch` is a stub that hands back a recipe. What is
// under test is the composition -- that the recipe's numbers land on the rig's
// own nodes, that the weapon hangs off the hand bone at the recipe's
// transform, and that the clips drive those nodes through a real
// `AnimationMixer`, which is what a viewer does with them.

import * as THREE from 'three';
import {
  GRAFT, RECIPE_FORMAT_PREFIX, applyJoints, createPoseComposer, findBone, hideUnlit,
  isGraft, jointNodes, recipeClips, ungraft,
} from './pose-compose.js';

const out = {};
const round = (n, places = 6) => Math.round(n * 10 ** places) / 10 ** places;
const vec = array => [...array].map(v => round(v));

/** A rig: a pitched root, a three-bone skeleton, a skinned body. */
function rigScene() {
  const root = new THREE.Group();
  root.name = 'USSoldier';
  root.userData.rigRoot = true;

  const hip = new THREE.Bone();
  hip.name = 'Bip01';
  hip.userData.joint = true;
  const pelvis = new THREE.Bone();
  pelvis.name = 'Bip01 Pelvis';
  pelvis.userData.joint = true;
  pelvis.position.set(0, 0.3, 0);
  const hand = new THREE.Bone();
  hand.name = 'Bip01 R Hand';
  hand.userData.joint = true;
  hand.position.set(0.1, 0.4, 0.2);
  hip.add(pelvis);
  pelvis.add(hand);

  const body = new THREE.SkinnedMesh(new THREE.BufferGeometry(),
                                     new THREE.MeshBasicMaterial());
  body.name = 'USSoldier3PBody';
  body.add(hip);
  root.add(body);
  body.bind(new THREE.Skeleton([hip, pelvis, hand]), new THREE.Matrix4());

  // The page never draws these: a muzzle effect and a collision hull.
  const muzzle = new THREE.Object3D();
  muzzle.name = 'e_MuzzGun';
  muzzle.userData.effect = true;
  root.add(muzzle);
  const hull = new THREE.Object3D();
  hull.name = 'shell792mmHi_m1 collision 0';
  root.add(hull);
  return root;
}

function weaponScene() {
  const group = new THREE.Group();
  group.name = 'K98';
  group.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
  return group;
}

const RIG_URL = 'models/poses/rigs/USSoldier.rig.glb';
const WEAPON_URL = 'models/K98.glb';
const MONO_URL = 'models/poses/USSoldier__Thompson.pose.glb';
const RECIPE_URL = 'models/poses/USSoldier__K98.pose.json';

// Deliberately not the rig's rest transforms: a composition that failed to
// apply the recipe would leave the rest values behind.
const STILL = [0.5, 0.5, 0.5, 0.5, 0.0, 0.25, 0.0];
const KEY_A = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0];
const KEY_B = [0.0, 0.0, 0.707107, 0.707107, 0.0, 0.0, 0.5];
const ATTACH = { bone: 'Bip01 R Hand', q: [0.0, 0.0, 0.0, 1.0], t: [0.02, 0.03, 0.04] };

function recipe() {
  return {
    format: `${RECIPE_FORMAT_PREFIX}1`,
    kind: 'weapon',
    soldier: 'USSoldier',
    weapon: 'K98',
    pose: 'K98',
    rig: 'rigs/USSoldier.rig.glb',
    root: { name: 'USSoldier holding K98', q: [0.707107, 0.0, 0.0, 0.707107] },
    joints: { 'bip01': STILL, 'bip01 pelvis': [0, 0, 0, 1, 0, 0.28, 0] },
    attach: ATTACH,
    clipNames: ['stand', 'crouch', 'fire'],
    clips: {
      stand: { still: { 'bip01': STILL } },
      crouch: { still: { 'bip01': KEY_A } },
      fire: { times: [0.0, 0.5], bones: { 'bip01 r hand': [KEY_A, KEY_B] } },
    },
    gaits: { run: { lowerClip: 'a', upperClip: 'b' } },
    gaitAssets: { grip: 'No4', lower: 'gaits/lower.gait.glb', upper: 'gaits/No4.gait.glb' },
  };
}

/** url -> a thunk, so a test can rebuild what it hands back. */
const RIG_DOC = { scene: rigScene(), animations: [] };
const HAVE = new Map([
  [RIG_URL, () => RIG_DOC],
  [WEAPON_URL, () => ({ scene: weaponScene(), animations: [] })],
  [MONO_URL, () => ({ scene: rigScene(), animations: [],
                      userData: { weapon: 'Thompson', soldier: 'USSoldier' } })],
]);
const asked = [];
const loader = {
  async loadAsync(url) {
    asked.push(url);
    if (!HAVE.has(url)) throw new Error(`404 ${url}`);
    return HAVE.get(url)();
  },
};

let recipeBody = recipe();
let recipeStatus = 200;
const fetched = [];
globalThis.fetch = async url => {
  fetched.push(url);
  if (recipeStatus !== 200) return { ok: false, status: recipeStatus };
  return { ok: true, status: 200, json: async () => recipeBody };
};

const composer = createPoseComposer({ loader, modelsBase: 'models', bust: '' });

// --- what counts as a joint, and what the page hides ------------------------
{
  const scene = rigScene();
  out.jointNodes = [...jointNodes(scene).keys()].sort();
  const skinned = [];
  scene.traverse(o => { if (o.isSkinnedMesh) skinned.push(o); });
  out.culling = { before: skinned[0].frustumCulled };
  hideUnlit(scene);
  out.culling.after = skinned[0].frustumCulled;
  out.hidden = {
    effect: scene.getObjectByName('e_MuzzGun').visible,
    collision: scene.getObjectByName('shell792mmHi_m1 collision 0').visible,
    body: scene.getObjectByName('USSoldier3PBody').visible,
  };
}

// --- bone lookup ------------------------------------------------------------
{
  const scene = rigScene();
  out.bones = {
    underscore: findBone(scene, 'Bip01_Pelvis')?.name ?? null,
    lower: findBone(scene, 'bip01 pelvis')?.name ?? null,
    missing: findBone(scene, 'Bip01 Tail')?.name ?? null,
  };
}

// --- joints and clips, straight off a recipe --------------------------------
{
  const scene = rigScene();
  applyJoints(scene, recipeBody.joints);
  out.joints = {
    root: vec(scene.getObjectByName('Bip01').quaternion.toArray()),
    rootPosition: vec(scene.getObjectByName('Bip01').position.toArray()),
    pelvisPosition: vec(scene.getObjectByName('Bip01 Pelvis').position.toArray()),
    // A bone the recipe leaves alone keeps the rig's own rest transform.
    handPosition: vec(scene.getObjectByName('Bip01 R Hand').position.toArray()),
  };
  out.clips = recipeClips(scene, recipeBody).map(c => ({
    name: c.name,
    duration: round(c.duration),
    tracks: c.tracks.length,
    // A track's binding is its node name, which is how a sidecar's clip
    // binds onto a different file's skeleton too.
    bones: [...new Set(c.tracks.map(t => t.name.split('.')[0]))].sort(),
    firstTrack: c.tracks[0].name,
  }));
}

// --- the clips actually drive the skeleton ----------------------------------
{
  const scene = rigScene();
  const mixer = new THREE.AnimationMixer(scene);
  const stand = mixer.clipAction(
    THREE.AnimationClip.findByName(recipeClips(scene, recipeBody), 'stand'));
  stand.play();
  mixer.update(0.25);
  const bone = scene.getObjectByName('Bip01');
  out.stillPlayed = {
    quaternion: vec(bone.quaternion.toArray()),
    position: vec(bone.position.toArray()),
    weight: round(stand.getEffectiveWeight()),
  };

  // A two-key timeline, read either side of the middle. `LoopOnce` and
  // `clampWhenFinished` so the end of the clip is its last key rather than the
  // wrap to the first (or a release back to the node's rest transform, which
  // three does once every action on the property has finished).
  const scene2 = rigScene();
  const mixer2 = new THREE.AnimationMixer(scene2);
  const fire = mixer2.clipAction(
    THREE.AnimationClip.findByName(recipeClips(scene2, recipeBody), 'fire'));
  fire.setLoop(THREE.LoopOnce, 1);
  fire.clampWhenFinished = true;
  fire.play();
  mixer2.update(0);
  const hand = scene2.getObjectByName('Bip01 R Hand');
  out.timeline = { atZero: vec(hand.quaternion.toArray()) };
  mixer2.update(0.25);
  out.timeline.atHalf = vec(hand.quaternion.toArray());
  mixer2.update(0.25);
  out.timeline.atEnd = vec(hand.quaternion.toArray());
}

// --- grafting ---------------------------------------------------------------
{
  const scene = rigScene();
  const wrapper = new THREE.Group();
  wrapper.name = 'K98 grip';
  wrapper.userData[GRAFT] = 'K98';
  const inner = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  wrapper.add(inner);
  scene.getObjectByName('Bip01 R Hand').add(wrapper);
  out.graft = {
    wrapper: isGraft(wrapper),
    inner: isGraft(inner),
    bone: isGraft(scene.getObjectByName('Bip01 R Hand')),
    removed: ungraft(scene),
    detached: wrapper.parent === null,
    // The graft is off the tree, so a disposal walk cannot reach it.
    stillAttached: Boolean(scene.getObjectByName('K98 grip')),
  };
}

// --- composition, end to end ------------------------------------------------
{
  const first = await composer.pose('USSoldier', 'K98');
  const wrapper = first.scene.getObjectByName('K98 grip');
  const body = first.scene.getObjectByName('USSoldier3PBody');
  out.composed = {
    root: first.scene.name,
    pitched: vec(first.scene.quaternion.toArray()),
    joints: vec(first.scene.getObjectByName('Bip01').quaternion.toArray()),
    clips: first.animations.map(c => c.name),
    weaponName: first.weaponName,
    userData: first.userData,
    // The root node carried the pose's own extras in the monolithic glb. A
    // reader that reaches for `scene.userData` still finds them.
    rootUserData: { weapon: first.scene.userData.weapon ?? null,
                    soldier: first.scene.userData.soldier ?? null,
                    state: first.scene.userData.state ?? null },
    graft: {
      found: Boolean(wrapper),
      parent: wrapper?.parent?.name ?? null,
      weldBone: wrapper?.userData.weldBone ?? null,
      weapon: wrapper?.userData.weapon ?? null,
      position: vec(wrapper?.position.toArray() ?? []),
      quaternion: vec(wrapper?.quaternion.toArray() ?? []),
      child: wrapper?.children[0]?.name ?? null,
    },
    // The rig's own muzzle effect is hidden by the composition.
    muzzleVisible: first.scene.getObjectByName('e_MuzzGun').visible,
    // The skin follows the clone's bones, not the cached rig's.
    skinRebound: body.skeleton.bones[0] === first.scene.getObjectByName('Bip01'),
    distinctFromCache: first.scene !== RIG_DOC.scene,
  };
  const second = await composer.pose('USSoldier', 'K98');
  out.cached = { samePromise: first === second, sameScene: first.scene === second.scene };
  // A second pose of the same soldier: a new scene, no second rig fetch.
  const sibling = await composer.pose('USSoldier', 'M1Garand');
  out.sibling = {
    got: Boolean(sibling),
    ownScene: sibling?.scene !== first.scene,
    rigLoads: asked.filter(u => u === RIG_URL).length,
    weaponLoads: asked.filter(u => u === WEAPON_URL).length,
    fetched: [...new Set(fetched)].sort(),
  };
}

// --- a tree with no recipe falls back to the monolithic glb -----------------
{
  recipeStatus = 404;
  const mono = createPoseComposer({ loader, modelsBase: 'models', bust: '' });
  const got = await mono.pose('USSoldier', 'Thompson');
  out.fallback = { got: got?.scene?.name ?? null, userData: got?.userData ?? null };

  // A recipe that is not a recipe is refused, whatever it is called.
  recipeStatus = 200;
  recipeBody = { pairs: [] };
  const wrong = createPoseComposer({ loader, modelsBase: 'models', bust: '' });
  const alsoMono = await wrong.pose('USSoldier', 'Thompson');
  out.fallback.notARecipe = alsoMono?.scene?.name ?? null;
  recipeBody = recipe();
}

// --- uncached composers -----------------------------------------------------
{
  const fresh = createPoseComposer({ loader, modelsBase: 'models', bust: '', cache: false });
  const a = await fresh.pose('USSoldier', 'K98');
  const b = await fresh.pose('USSoldier', 'K98');
  const shared = await composer.pose('USSoldier', 'K98');
  out.uncached = { distinct: a !== b, ownScenes: a.scene !== b.scene,
                   otherComposer: shared !== a };
}

console.log(JSON.stringify(out));
