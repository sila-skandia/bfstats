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
const { armTeamCloths, restoreFlagNodeNames } = await import(path.join(viewer, 'flag-cloth-teams.js'));

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

// 5. A level baked with every team's cloth (`flag-cloth-teams.js`): the whole
//    mesh swaps, for nations the atlas has no cell for as much as for those it
//    has, and no sibling, donor or legacy cloth is touched.
const FR = [0.004, -0.996, 0.838, -0.021]; // flagfr_m1: its own sheet, not a cell
function teamPole(name, { main, alts }) {
  const pole = new THREE.Group();
  pole.name = name;
  root.add(pole);
  const anchor = new THREE.Group();
  anchor.name = `${name}_flag`;
  anchor.userData.kind = 'flagAnchor';
  anchor.position.set(0, 8.2, 0);
  pole.add(anchor);
  const b0 = new THREE.Bone(); b0.name = `${name}_Bone01`;
  const b1 = new THREE.Bone(); b1.name = `${name}_Bone02`;
  b0.add(b1); anchor.add(b0);
  anchor.updateMatrixWorld(true);
  const inv = [new THREE.Matrix4(), new THREE.Matrix4()];
  const skin = new THREE.Skeleton([b0, b1], inv);
  const made = {};
  const make = (mesh, teams, cell, kind, label) => {
    const c = new THREE.SkinnedMesh(sheet(cell), new THREE.MeshBasicMaterial());
    c.name = label;
    c.userData = { kind, point: name, mesh, teams };
    c.bind(skin, new THREE.Matrix4());
    root.add(c);
    made[mesh] = c;
  };
  if (main) make(main.mesh, main.teams, main.cell, 'flagCloth', `${name}_cloth`);
  for (const a of alts) make(a.mesh, a.teams, a.cell, 'flagClothAlt', `${name}_cloth_${a.mesh}`);
  return made;
}
const T = (point, mesh) => teamClothsByMesh[point][mesh];
const teamClothsByMesh = {
  // Held German, may be taken by a French side: team 2 wears flagfr.
  gate: teamPole('gate', {
    main: { mesh: 'flagge_m1', teams: [1], cell: GER },
    alts: [{ mesh: 'flagfr_m1', teams: [2], cell: FR }],
  }),
  // Neutral, no team-0 mesh: no main cloth; both sides' meshes are alts.
  ford: teamPole('ford', {
    main: null,
    alts: [{ mesh: 'flagge_m1', teams: [1], cell: GER }, { mesh: 'flagfr_m1', teams: [2], cell: FR }],
  }),
};
nations[2] = 'fr';
extras.controlPoints.push({ name: 'gate', team: 1, flagMesh: 'flagge_m1' }, { name: 'ford', team: 0, flagMesh: null });
// What the page does at load: every cloth is a cull entry, then the alts leave.
cull.length = 0;
root.children.forEach(ch => { if (ch.isSkinnedMesh) cull.push(ch); });
const hiddenAtLoad = armTeamCloths(root, cull, () => {});
out.altsLeaveTheCull = hiddenAtLoad === 3 && !cull.includes(T('gate', 'flagfr_m1')) && !cull.includes(T('ford', 'flagge_m1'));
out.mainStaysDrawn = cull.includes(T('gate', 'flagge_m1')) && T('gate', 'flagge_m1').visible;
const legacyBefore = uv0(find('german_base_cloth'));

// 5a. A held German point is taken by the French side (no atlas cell).
cap.hoistCaptureFlag({ controlPointName: 'gate', team: 2 });
out.frenchCloth = T('gate', 'flagfr_m1').visible && cull.includes(T('gate', 'flagfr_m1'));
out.germanHidden = !T('gate', 'flagge_m1').visible && !cull.includes(T('gate', 'flagge_m1'));
out.frenchUvUntouched = near(uv0(T('gate', 'flagfr_m1'))[0], FR[0]) && near(uv0(T('gate', 'flagfr_m1'))[1], FR[1]);
out.sharesTheJoints = T('gate', 'flagfr_m1').skeleton === T('gate', 'flagge_m1').skeleton;
// 5b. And taken back.
cap.hoistCaptureFlag({ controlPointName: 'gate', team: 1 });
out.germanBack = T('gate', 'flagge_m1').visible && !T('gate', 'flagfr_m1').visible
  && cull.includes(T('gate', 'flagge_m1')) && !cull.includes(T('gate', 'flagfr_m1'));
// 5c. A neutral point nobody drew a cloth for is raised with the taker's own.
out.neutralBare = !T('ford', 'flagfr_m1').visible && !T('ford', 'flagge_m1').visible;
cap.hoistCaptureFlag({ controlPointName: 'ford', team: 2 });
out.neutralRaisesFrench = T('ford', 'flagfr_m1').visible && !T('ford', 'flagge_m1').visible;
cap.hoistCaptureFlag({ controlPointName: 'ford', team: 1 });
out.neutralSwapsToGerman = T('ford', 'flagge_m1').visible && !T('ford', 'flagfr_m1').visible;
// 5d. An owner that names no mesh draws no cloth.
cap.hoistCaptureFlag({ controlPointName: 'ford', team: 3 });
out.noMeshNoCloth = !T('ford', 'flagge_m1').visible && !T('ford', 'flagfr_m1').visible;
// 5e. Nothing leaked into the legacy poles.
out.legacyUntouched = uv0(find('german_base_cloth')).every((v, i) => near(v, legacyBefore[i]));
out.noRaisedCloth = find('ford_cloth') === null && find('gate_cloth') === T('gate', 'flagge_m1');

// 6. A legacy cloth on its own sheet (flagfr_m1 baked into an old scene) is
//    not repainted into an atlas cell it does not sample.
const legacyFr = new THREE.SkinnedMesh(sheet(FR), new THREE.MeshBasicMaterial());
addPole('oldfr', true);
root.remove(find('oldfr_cloth'));
const oldFrCloth = (() => {
  const c = new THREE.SkinnedMesh(sheet(FR), new THREE.MeshBasicMaterial());
  c.name = 'oldfr_cloth'; c.userData.kind = 'flagCloth';
  const pole = root.getObjectByName('oldfr');
  const bones = []; pole.traverse(o => { if (o.isBone) bones.push(o); });
  c.bind(new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4())), new THREE.Matrix4());
  c.geometry.userData.flagUvCell = cap.unitRectOf(c.geometry.getAttribute('uv'));
  root.add(c);
  return c;
})();
nations[2] = 'us';
cap.hoistCaptureFlag({ controlPointName: 'oldfr', team: 2 });
out.legacyOwnSheetKept = near(uv0(oldFrCloth)[0], FR[0]) && near(uv0(oldFrCloth)[1], FR[1]);
out.legacyOwnSheetNoSecondCloth = !root.children.some(o => o !== oldFrCloth && o.name === 'oldfr_cloth');
void legacyFr;

// 7. The second game mode's points. GLTFLoader names the second set of a
//    duplicated node `<name>_1`; with the first mode's set pruned the live
//    pole is `house_1`, its cloth `house_cloth_1`, and a lookup by the point's
//    own name found nothing (Gold Beach SinglePlayer: no flag raised, none
//    swapped). The loader's `userData.name` is the file's spelling.
function secondModePole(name, cell) {
  const pole = new THREE.Group();
  pole.name = `${name}_1`; pole.userData.name = name;
  const group = new THREE.Group(); group.userData.kind = 'controlPoints'; group.name = 'controlPoints';
  group.add(pole); root.add(group);
  if (!cell) return pole;
  const anchor = new THREE.Group();
  anchor.name = `${name}_flag_1`; anchor.userData = { kind: 'flagAnchor', name: `${name} flag` };
  pole.add(anchor);
  const b0 = new THREE.Bone(); b0.name = `${name}_Bone01_1`; b0.userData = { joint: true, name: `${name} Bone01` };
  anchor.add(b0);
  const c = new THREE.SkinnedMesh(sheet(cell), new THREE.MeshBasicMaterial());
  c.name = `${name}_cloth_1`; c.userData = { kind: 'flagCloth', name: `${name} cloth` };
  c.bind(new THREE.Skeleton([b0, b0], [new THREE.Matrix4(), new THREE.Matrix4()]), new THREE.Matrix4());
  root.add(c);
  return pole;
}
secondModePole('house', GER);
secondModePole('front', null);
extras.controlPoints.push({ name: 'house', team: 1, flagMesh: 'flagge_m1' }, { name: 'front', team: 0, flagMesh: null });
nations[1] = 'ger'; nations[2] = 'brit';
const BRIT = [0.001, -0.734, 0.422, -0.484];
cap.hoistCaptureFlag({ controlPointName: 'house', team: 2 });
out.secondModeBeforeRestoreUntouched = root.getObjectByName('house_cloth_1')
  && near(uv0(root.getObjectByName('house_cloth_1'))[0], GER[0]);
out.restoredCount = restoreFlagNodeNames(root);
out.restoredNames = ['house', 'house_flag', 'house_cloth', 'house_Bone01', 'front'].every(n => root.getObjectByName(n));
// The level load seeds the UV cache after the rename; so does this.
root.traverse(o => { if (o.userData.kind === 'flagCloth' && !o.geometry.userData.flagUvCell) o.geometry.userData.flagUvCell = cap.unitRectOf(o.geometry.getAttribute('uv')); });
// 1 -> 2 in one tick (timeToGetControl 0): the held point repaints British.
cap.hoistCaptureFlag({ controlPointName: 'house', team: 2 });
out.secondModeHeldIsBrit = (() => { const [u, v] = uv0(root.getObjectByName('house_cloth')); return near(u, BRIT[0]) && near(v, BRIT[1]); })();
// A neutral point with a pole and no cloth raises the British flag.
cap.hoistCaptureFlag({ controlPointName: 'front', team: 2 });
out.secondModeNeutralRaises = !!find('front_cloth');

console.log(JSON.stringify(out));
