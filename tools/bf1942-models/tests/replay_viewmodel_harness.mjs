// A round replay's first person, under node: the weapon in his hands, his
// arms playing what his torso did (replay-viewmodel.js).
//
// The owner's report (2026-09-29): "We just added FPV HUD to the replay - to
// show ammo / health etc. But their weapon is not being wielded in the game
// (it's just a cross hair)."
//
// Same pattern as `replay_hud_harness.mjs`: the viewer's modules imported in
// place through `sim/env.mjs`'s hooks, one JSON report on stdout.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, recording, vm] = await Promise.all([
  imp('vendor/three.module.js'), imp('replay-recording.js'), imp('replay-viewmodel.js'),
]);

const results = {};
const line = o => JSON.stringify(o);
const r3 = v => +v.toFixed(3) + 0;

// --- the recorded upper states, as the arms read them ---------------------------
const weapons = ['K98Sniper', 'KnifeAllies', 'GrenadeAxis', 'Mp40', 'K98', 'DP'];
results.states = Object.fromEntries([
  'Ub_LieFireMp40', 'Ub_IdleMp402', 'Ub_FireKnifeAllies3', 'Ub_StandAimK98Sniper', 'Ub_StandReloadK98',
  'Ub_TurnMp40', 'Ub_StandMp40', 'Ub_CrouchToLieKnifeAllies', 'Ub_SwimForward', 'Ub_StandAimDP', 'Ub_HitChestStand',
].map(name => [name, vm.armsStateOf(name, weapons)]));

// --- what a rig without a family plays --------------------------------------------
{
  const full = new Set(['idle', 'walk', 'run', 'fire', 'reload', 'deploy', 'crouch', 'crouchWalk', 'prone', 'crawl',
    'proneFire', 'proneReload', 'crouchDeploy', 'proneDeploy', 'idle1', 'idle2', 'fire1', 'fire2', 'fire3']);
  const old = new Set(['idle', 'walk', 'run', 'fire', 'reload', 'deploy']);
  const grenade = new Set(['idle', 'walk', 'run', 'fire', 'deploy', 'prone', 'crawl', 'proneFire']);
  const on = set => name => set.has(name);
  results.resolve = {
    idle2: vm.resolveFamily('idle', 2, on(full)),
    idle3: vm.resolveFamily('idle', 3, on(full)),
    swing3: vm.resolveFamily('fire', 3, on(full)),
    oldCrawl: vm.resolveFamily('crawl', 0, on(old)),
    oldProneFire: vm.resolveFamily('proneFire', 0, on(old)),
    oldCrouch: vm.resolveFamily('crouch', 0, on(old)),
    grenadeReload: vm.resolveFamily('proneReload', 0, on(grenade)),
    none: vm.resolveFamily(null, 0, on(full)),
  };
}

// --- one life: his arms through a round ---------------------------------------------
//
// A German medic (pid 3, soldier 50) with an Mp40 (item 3) and a grenade (item
// 4). He raises the Mp40 at 1 s and aims; a burst of three at 3.0-3.22 s (9
// rounds a second, one hold of the trigger); a tap at 5 s; a magazine at 6
// s; runs at 11 s; dives prone at 11.8 s, fires lying at 13 s; a lying fire
// state with no round at 14 s; swims at 15 s; raises the Mp40 again at 16 s;
// his grenade from 17 s, thrown at 18 s (the round leaves 0.8 s after the
// click), raised again at 19 s; the medic pack's use at 20 s is not the Mp40's.
const states = [
  [0, 'Lb_Stand', 0], [1, 'Lb_RunForward', 0], [2, 'Lb_RunStandToLie', 0x40], [3, 'Lb_Lie', 0x40],
  [4, 'Lb_SwimForward', 0xa], [5, 'Ub_StandRaiseWeaponMp40', 0], [6, 'Ub_StandAimMp40', 0], [7, 'Ub_FireMp40', 0],
  [8, 'Ub_StandReloadMp40', 0], [9, 'Ub_RunForwardMp40', 0], [10, 'Ub_RunStandToLieMp40', 0], [11, 'Ub_LieMp40', 0],
  [12, 'Ub_LieFireMp40', 0], [13, 'Ub_SwimForward', 0], [14, 'Ub_StandRaiseWeaponGrenadeAxis', 0],
  [15, 'Ub_FireGrenadeAxis', 0], [16, 'Ub_StandAimGrenadeAxis', 0], [17, 'Ub_FireMedPack', 0], [18, 'Ub_StandAimMedPack', 0],
];
const st = (t, lower, upper, item = 3) => line({ k: 'st', t, o: [[50, lower, upper, 0, 0, item, 0]] });
const f = (t, w) => line({ k: 'f', t, id: 50, pid: 3, w, p: [0.5, 2.65, 1.5], d: [0, 0, 1], local: 1 });
const lines = [
  line({ k: 'h', v: 5, start: '', hz: 10 }),
  line({ k: 'anim', t: 0, states }),
  line({ k: 'e', t: 1, e: 'createObject', tid: 1727, netId: 50, tmpl: 'GermanSoldier', pos: [0, 1, 0], rot: [0, 0, 0] }),
  line({ k: 'e', t: 1, e: 'createPlayer', pid: 3, name: 'medic', team: 1, ai: 0, vehNetId: 50 }),
  line({ k: 'e', t: 1, e: 'control', pid: 3, netId: 50 }),
  line({ k: 'o', t: 1, id: 50, gid: 1, tmpl: 'GermanSoldier', tid: 1727, team: 1, maxhp: 30 }),
  line({ k: 's', t: 1, o: [[50, 0, 2, 0, 0, 0, 0, 1]] }),
  st(1, 0, 5), st(2, 0, 6), st(3.05, 0, 7), st(3.3, 0, 6), st(5.05, 0, 7), st(5.15, 0, 6),
  st(6, 0, 8), st(10.6, 0, 6), st(11, 1, 9), st(11.8, 2, 10), st(12, 3, 11), st(13.05, 3, 12), st(13.15, 3, 11),
  st(14, 3, 12), st(14.1, 3, 11), st(15, 4, 13), st(16, 0, 5), st(17, 0, 14, 4), st(18, 0, 15, 4), st(19, 0, 14, 4),
  st(19.9, 0, 16, 4), st(20, 0, 17, 5), st(21, 0, 18, 5),
  f(3.0, 'Mp40'), f(3.11, 'Mp40'), f(3.22, 'Mp40'), f(5.0, 'Mp40'), f(13.0, 'Mp40'), f(18.8, 'GrenadeAxis'),
  line({ k: 'end', t: 25 }),
];
const rec = recording.parseRecording(lines.join('\n'));
const life = rec.lives.find(l => l.nid === 50);

// The Mp40 rig's families and clips, as GermanSoldier__MP40.fp.glb's extras
// carry them; the grenade's.
const mp40 = {
  idle: { duration: 10, loop: true, morph: 0.7 }, walk: { duration: 2, loop: true, morph: 0.5 },
  run: { duration: 0.7092, loop: true, morph: 0.5 }, fire: { duration: 0.4219, loop: true, morph: 4 },
  reload: { duration: 4.5455, loop: false, morph: 10000 }, deploy: { duration: 1, loop: false, morph: 10000 },
  crouch: { duration: 2.9412, loop: true, morph: 0.7 }, crouchWalk: { duration: 2, loop: true, morph: 0.5 },
  prone: { duration: 5, loop: true, morph: 0.7 }, crawl: { duration: 1.2195, loop: true, morph: 0.5 },
  proneFire: { duration: 0.4219, loop: true, morph: 4 }, proneReload: { duration: 4.5455, loop: false, morph: 10000 },
  crouchDeploy: { duration: 1, loop: false, morph: 10000 }, proneDeploy: { duration: 1, loop: false, morph: 10000 },
  idle1: { duration: 3.8462, loop: false, morph: 5 }, idle2: { duration: 1.6667, loop: false, morph: 5 },
};
const grenade = {
  idle: { duration: 10, loop: true, morph: 0.7 }, run: { duration: 0.6897, loop: true, morph: 0.5 },
  fire: { duration: 1, loop: false, morph: 10000 }, deploy: { duration: 1, loop: false, morph: 10000 },
  prone: { duration: 5, loop: true, morph: 0.7 }, proneFire: { duration: 1, loop: false, morph: 10000 },
};
const rigOf = clips => ({ has: name => Object.hasOwn(clips, name), clip: family => clips[family] });
const poseAt = (track, clips, t) => vm.armsPose(track, t, family => clips[family])
  ?.map(p => ({ family: p.family, time: r3(p.time), weight: r3(p.weight) })) ?? null;
{
  const rig = rigOf(mp40);
  const track = vm.armsTrack(rec, life, 'MP40', { ...rig, data: { roundOfFire: 9 } });
  results.track = {
    base: track.base.map(b => [r3(b.start), b.hidden ? 'hidden' : b.family]),
    fires: track.fires.map(s => [r3(s.start), r3(s.end), s.family, s.loop]),
  };
  const at = t => poseAt(track, mp40, t);
  results.pose = {
    raise: at(1.5),
    aim: at(2.5),
    burstStart: at(3.05),
    burstEnd: at(3.3),
    settling: at(3.8),
    tap: at(5.05),
    reload: at(8),
    run: at(11.4),
    diving: at(11.9),
    prone: at(12.9),
    proneShot: at(13.05),
    unexplained: at(14.02),
    swimming: at(15.5),
    raisedAgain: at(16.4),
  };
  // Seeking is setting the clock: the same instant twice is the same pose,
  // whatever came before.
  results.seek = JSON.stringify(at(3.8)) === JSON.stringify((at(12.9), at(3.8)));
}
{
  const rig = rigOf(grenade);
  const data = { roundOfFire: 1, throw: { fireDelay: 0.8, hideDuringFireTime: 0.4 } };
  const track = vm.armsTrack(rec, life, 'GrenadeAxis', { ...rig, data });
  results.grenade = {
    fires: track.fires.map(s => [r3(s.start), r3(s.end), s.family, s.loop]),
    windUp: poseAt(track, grenade, 18.5),
    raise: poseAt(track, grenade, 19.2),
    thrown: [18.7, 18.9, 19.1, 19.3].map(t => vm.thrownAt(track, t, data.throw.hideDuringFireTime)),
  };
}

// --- the viewmodel on a stub rig: loaded, shown in his first person only ---------
{
  // A rig as mountRig reads a glb: one bone the clips move, the extras.
  const clipNames = ['idle', 'fire', 'reload', 'deploy', 'prone', 'proneFire', 'run'];
  const makeGltf = weapon => {
    const scene = new THREE.Group();
    const bone = new THREE.Object3D();
    bone.name = 'Bip01';
    scene.add(bone);
    const muzzle = new THREE.Object3D();
    muzzle.name = `${weapon} grip`;
    muzzle.userData.weldBone = 'Bip01 R Hand';
    bone.add(muzzle);
    const animations = clipNames.map(name => new THREE.AnimationClip(name, mp40[name].duration, [
      new THREE.NumberKeyframeTrack('Bip01.position[x]', [0, mp40[name].duration], [0, 1]),
    ]));
    const clips = Object.fromEntries(clipNames.map(name => [name, {
      duration: mp40[name].duration, loop: mp40[name].loop, morphFactor: mp40[name].morph,
    }]));
    return {
      scene, animations,
      userData: {
        view: { center1pHands: [-0.12, -1.56, 0.1], fov1p: 0.47 },
        weaponStats: { roundOfFire: 9, view: { cameraPosition: [0.01, -0.04, 0.09], zoomPosition: [-0.02, 0, -0.08] },
                       zoom: { fov: 0.6, soldierFov: 0.9 } },
        clips,
      },
    };
  };
  const loads = [];
  const camera = new THREE.PerspectiveCamera(57.3, 1.6, 0.2, 8000);
  const fired = [];
  const guns = {
    collect: root => {
      const group = { node: root, stats: { input: 'c_PIFire', projectile: { template: 'Mp40Projectile' } }, muzzles: [{}] };
      return [group];
    },
    fireShot: group => fired.push({ firer: group.firer, view: group.view, replay: group.replay }),
    release: () => {},
    collider: null,
  };
  const player = {
    rec, followPid: 3, networkedRounds: new Set(['grenadeaxisprojectile']),
    camera: { sight: { kind: 'foot', life } },
    ctx: {
      camera, guns, modelsBase: 'models', bust: () => '',
      loader: { loadAsync: url => { loads.push(url.split('/').pop()); return Promise.resolve(makeGltf('Mp40')); } },
      loadouts: () => ({ kits: { Ger_Medic: { primary: 'MP40', weapons: [
        { slot: 3, weapon: 'MP40' }, { slot: 4, weapon: 'GrenadeAxis' }, { slot: 5, weapon: 'MedPack' }] } } }),
    },
  };
  life.kitTemplate = 'Ger_Medic';
  const view = new vm.ReplayViewmodel(player);
  view.update(2.5);
  const loading = view.shown;
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
  view.update(2.5);
  const entry = view.shown?.entry ?? null;
  const active = () => (entry ? [...entry.active].map(name => {
    const action = entry.actions[name];
    return [name, r3(action.time), r3(action.getEffectiveWeight())];
  }).sort() : null);
  const aim = { shown: Boolean(view.shown), visible: entry?.rig.visible ?? null, active: active(),
                key: entry?.key ?? null, bone: r3(entry?.rig.getObjectByName('Bip01').position.x ?? NaN) };
  view.update(3.05);
  const burst = active();
  // His round, through the rig: from his eye, flashed at the rig.
  // The recording's own round at 3.0 s, as the page's frame hands it over.
  const round = rec.fires.find(r => r.t === 3.0);
  const own = view.fire(3, 'Mp40', round);
  const otherPid = view.fire(4, 'Mp40', round);
  const otherWeapon = view.fire(3, 'Colt', round);
  const ray = { origin: entry?.ray.origin.toArray().map(r3), dir: entry?.ray.dir.toArray().map(r3) };
  // Out of his eyes: the orbit, a seat, his death.
  player.camera.sight = null;
  view.update(3.1);
  const orbit = { shown: Boolean(view.shown), visible: entry?.rig.visible ?? null };
  player.camera.sight = { kind: 'seat', life };
  view.update(3.1);
  const seat = { shown: Boolean(view.shown), visible: entry?.rig.visible ?? null };
  player.camera.sight = { kind: 'foot', life };
  view.update(15.5);
  const swimming = { shown: Boolean(view.shown), visible: entry?.rig.visible ?? null };
  view.update(12.9);
  const prone = active();
  results.viewmodel = {
    loading: Boolean(loading),
    loads,
    aim, burst, prone, orbit, seat, swimming,
    fire: { own, otherPid, otherWeapon, fired, ray },
  };
  view.dispose();
  results.viewmodel.disposed = { rigs: view.rigs.size, shown: view.shown };
}

process.stdout.write(JSON.stringify(results));
