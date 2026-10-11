// A control point's cloth when it changes hands (`viewer/capture.js`
// `hoistCaptureFlag`): a held point's baked cloth is repainted into the
// taker's atlas cell, a neutral point (baked pole-only) has the cloth raised
// fresh from a sibling's, and a taker whose nation the atlas has no cell for
// leaves the point as it was rather than flying another nation's flag.
//
// Run by `tests/test_flag_cloth_swap.py`; prints one JSON object. The scene
// is built the way the glb loads (`<point>_cloth` skinned meshes of
// `kind: flagCloth`, `<point>_flag` anchors, `<point>_BoneNN` joints), and the
// UV cells are the surveyed `flags_o` cells `FLAG_UV_CELLS` names.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const THREE = await import(path.join(viewer, 'vendor', 'three.module.js'));
const { createFlagCapture } = await import(path.join(viewer, 'capture.js'));

const GER = [0.438, -0.734, 0.859, -0.484];
const US = [0.003, -1.0, 0.425, -0.75];

function sheet(cell) {
  const g = new THREE.BufferGeometry();
  const [u0, v0, u1, v1] = cell;
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v1], 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

const root = new THREE.Group();
function addPole(name, withCloth) {
  const pole = new THREE.Group();
  pole.name = name;
  root.add(pole);
  if (!withCloth) return pole;
  const anchor = new THREE.Group();
  anchor.name = `${name}_flag`;
  anchor.userData.kind = 'flagAnchor';
  anchor.position.set(0, 8.2, 0);
  pole.add(anchor);
  const b0 = new THREE.Bone(); b0.name = `${name}_Bone01`;
  const b1 = new THREE.Bone(); b1.name = `${name}_Bone02`; b1.position.set(0.5, 0, 0);
  b0.add(b1);
  anchor.add(b0);
  anchor.updateMatrixWorld(true);
  const inv = [new THREE.Matrix4().makeTranslation(0, -1, 0), new THREE.Matrix4().makeTranslation(0, -2, 0)];
  const cloth = new THREE.SkinnedMesh(sheet(GER), new THREE.MeshBasicMaterial());
  cloth.name = `${name}_cloth`;
  cloth.userData.kind = 'flagCloth';
  cloth.bind(new THREE.Skeleton([b0, b1], inv), new THREE.Matrix4());
  root.add(cloth);
  return pole;
}
addPole('commandpost', true);
addPole('german_base', true);
addPole('beach', false);

const nations = { 1: 'ger', 2: 'us' };
const extras = {
  controlPoints: [
    { name: 'commandpost', team: 1, flagMesh: 'flagge_m1' },
    { name: 'german_base', team: 1, flagMesh: 'flagge_m1' },
    { name: 'beach', team: 0, flagMesh: null },
  ],
};
const cull = [];
const mixer = new THREE.AnimationMixer(root);
const page = {
  currentRoot: root, extras, cull, levelClips: [],
  teamClothNation: team => nations[team] ?? null,
  teamNation: team => nations[team] ?? null,
  drawMinimap() {}, drawFullMap() {}, paintDeployChrome() {},
  tagCull() {}, flattenCull() {}, thaw() {}, ensureFlagMixer: () => mixer,
  localMapTeam: () => 2, world: { flags: [] },
};
const cap = createFlagCapture(page);
const find = name => { let r = null; root.traverse(o => { if (o.name === name && o.userData.kind === 'flagCloth') r = o; }); return r; };
const uv0 = cloth => { const uv = cloth.geometry.getAttribute('uv'); return [uv.getX(0), uv.getY(0)]; };
const out = {};
const near = (a, b) => Math.abs(a - b) < 1e-4;

// Seed the cache the page seeds at level load.
root.traverse(o => { if (o.userData.kind === 'flagCloth') o.geometry.userData.flagUvCell = cap.unitRectOf(o.geometry.getAttribute('uv')); });

// 1. The neutral point is taken by team 2: a cloth is raised on its pole.
cap.hoistCaptureFlag({ controlPointName: 'beach', team: 2 });
const beach = find('beach_cloth');
out.raised = !!beach;
out.raisedBones = beach?.skeleton.bones.length ?? 0;
out.raisedNames = beach?.skeleton.bones.map(b => b.name) ?? [];
out.raisedInverses = beach ? beach.skeleton.boneInverses.map(m => m.elements[13]) : [];
out.raisedUsCell = !!beach && near(uv0(beach)[0], US[0]) && near(uv0(beach)[1], US[1]);
out.raisedMeshIsSkinned = !!beach?.isSkinnedMesh;
out.raisedAnchorOnPole = root.getObjectByName('beach')?.children.some(c => c.userData.kind === 'flagAnchor') ?? false;
out.donorUntouchedByRaise = near(uv0(find('commandpost_cloth'))[0], GER[0]);

// 2. A held German point is taken by team 2: its own cloth repaints.
cap.hoistCaptureFlag({ controlPointName: 'commandpost', team: 2 });
const cp = find('commandpost_cloth');
out.swappedUs = near(uv0(cp)[0], US[0]) && near(uv0(cp)[1], US[1]);
out.swappedVisible = cp.visible;
out.siblingStaysGerman = near(uv0(find('german_base_cloth'))[0], GER[0]);
out.raisedUntouchedBySwap = near(uv0(find('beach_cloth'))[0], US[0]);
out.entryTeam = extras.controlPoints[0].team;
out.entryFounding = extras.controlPoints[0].foundingTeam;

// 3. Team 1 takes it back.
cap.hoistCaptureFlag({ controlPointName: 'commandpost', team: 1 });
out.backToGerman = near(uv0(find('commandpost_cloth'))[0], GER[0]);

// 4. A taker whose nation has no cell: the held cloth is not repainted into
//    another nation's colours, and a neutral point raises nothing.
nations[2] = 'fr';
addPole('bridge', false);
extras.controlPoints.push({ name: 'bridge', team: 0, flagMesh: null });
cap.hoistCaptureFlag({ controlPointName: 'bridge', team: 2 });
out.noCellRaisesNothing = find('bridge_cloth') === null;
const before = uv0(find('german_base_cloth'));
cap.hoistCaptureFlag({ controlPointName: 'german_base', team: 2 });
out.noCellKeepsUv = uv0(find('german_base_cloth')).every((v, i) => near(v, before[i]));

console.log(JSON.stringify(out));
