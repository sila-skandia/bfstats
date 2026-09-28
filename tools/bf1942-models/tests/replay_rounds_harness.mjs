// The rounds a round replay leaves behind, under node: the smoke trail a
// seek used to strand, and the grenades, mines and packs the recording
// carries as objects of their own.
//
// Two reports from `replay_20260928-133433` (Bocage, 2026-09-29):
//
// - "phantom smoke trails left by tanks and bazooka shots" that stayed on
//   the map, smoking. `GunFire.clear` (every replay seek) dropped the rounds
//   in the air after emptying the list it then walked to stop their trails,
//   so a rocket's `e_rocketFume` or a shell's `e_PanzShootTrail`, looping
//   emitters with no life of their own, went on where the round had been.
// - mines that "linger for longer than they actually existed on the server",
//   and a jeep driving over one without it going off. The page fired every
//   recorded `f` through its own guns, a landmine included: it laid its own
//   LandmineProjectile beside the recorded one, and that lay for the
//   template's 360 s where no replayed hull could set it off. The recorded
//   one had gone off under the Kubelwagen.
//
// Same pattern as `replay_harness.mjs`: the viewer's modules imported in
// place through `sim/env.mjs`'s hooks, one JSON report on stdout.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { GunFire }, recording, props, { ReplayHull }, { ReplaySoldiers }] = await Promise.all([
  imp('vendor/three.module.js'), imp('gunfire.js'), imp('replay-recording.js'), imp('replay-props.js'),
  imp('replay-hulls.js'), imp('replay-bodies.js'),
]);

const results = {};
const line = o => JSON.stringify(o);

/** An EffectPlayer that keeps every handle it gives out. */
function fakeEffects() {
  const played = [];
  return {
    played,
    has: () => true,
    play(name, opts = {}) {
      const handle = { name, attached: Boolean(opts.attach), position: opts.position ?? null, stopped: false };
      handle.stop = () => { handle.stopped = true; };
      played.push(handle);
      return handle;
    },
  };
}

/** A FireArms node the way the exporter bakes one: the weapon, a muzzle and
 *  the round's own mesh. */
function fireArmsRig(name, fireArms) {
  const weapon = new THREE.Group();
  weapon.name = name;
  weapon.userData.fireArms = fireArms;
  const muzzle = new THREE.Object3D();
  muzzle.name = `${name} muzzle 1`;
  muzzle.userData.muzzle = { index: 0 };
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.6), new THREE.MeshBasicMaterial());
  body.name = `${name} projectile`;
  body.userData.projectileMesh = { template: fireArms.projectile.template };
  weapon.add(muzzle, body);
  return weapon;
}

const BAZOOKA = {
  roundOfFire: 1, magSize: 1, numOfMag: 5, velocity: 80, muzzles: 1, input: 'c_PIFire',
  projectile: { kind: 'shell', template: 'BazookaProjectile', timeToLive: 10, gravity: 0.2,
                trailBundle: 'e_rocketFume', damage: { radius: 3, hasCollisionEffect: true } },
};
// The shipped `models/Landmine.glb`'s FireArms, as the exporter writes it.
const LANDMINE = {
  roundOfFire: 1, magSize: 4, numOfMag: 1, magType: 0, reloadTime: 1, autoReload: false, velocity: 3,
  muzzles: 1, input: 'c_PIFire', throw: { fireDelay: 0.4, hideDuringFireTime: 0.2 },
  projectile: { kind: 'shell', template: 'LandmineProjectile', trail: null, timeToLive: 360, material: 230,
                mass: 130, hasPointPhysics: false, endEffect: 'e_ExplGranade',
                damage: { radius: 4, material2: 232, damageType: 4, hasCollisionEffect: false, dieAfterColl: false } },
};
const FLOATING_MINE = {
  roundOfFire: 0.5, velocity: 2, muzzles: 1, magSize: 4, numOfMag: 1, input: 'c_PIAltFire',
  projectile: { kind: 'shell', template: 'FloatingMine', timeToLive: 300, gravity: 1,
                damage: { hasCollisionEffect: false, dieAfterColl: false, damageType: 4, radius: 8 } },
};
const BOAT_GUN = {
  roundOfFire: 2, velocity: 200, muzzles: 1, magSize: -1, input: 'c_PIFire',
  projectile: { kind: 'shell', template: 'Elco80GunShell', timeToLive: 5, damage: { radius: 1 } },
};

// --- a seek leaves no trail behind --------------------------------------------------
{
  const scene = new THREE.Scene();
  const guns = new GunFire({ scene, viewportHeight: () => 800 });
  const fx = fakeEffects();
  guns.effects = fx;
  const group = guns.collect(fireArmsRig('Bazooka', BAZOOKA), {
    replace: true, speedScale: 1, roundLifetime: 'data',
    aimRay: () => ({ origin: { x: 0, y: 1.5, z: 0 }, dir: { x: 0, y: 0, z: -1 } }),
  })[0];
  guns.fireShot(group);
  guns.advance(1 / 30);
  const trail = fx.played.find(h => h.name === 'e_rocketFume');
  const shot = guns.projectiles[0];
  // A torpedo's wake rides the round the same way.
  const wake = { stopped: false, stop() { this.stopped = true; } };
  if (shot) shot.wake = wake;
  const before = { inFlight: guns.projectiles.length, trailStopped: trail?.stopped ?? null };
  guns.clear();
  results.clearStopsTrails = {
    before,
    trailAttached: Boolean(trail?.attached),
    inFlight: guns.projectiles.length,
    trailStopped: trail?.stopped ?? null,
    wakeStopped: wake.stopped,
    meshInScene: Boolean(shot?.mesh?.parent),
  };
}

// --- the six networked rounds, and what a recording adds -------------------------------
{
  const rec = recording.parseRecording([
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'e', t: 1, e: 'projPool', tid: 1400, tmpl: 'SatchelChargeProjectile', netId: 300, count: 2 }),
  ].join('\n'));
  const set = props.networkedRounds(rec);
  const group = tmpl => ({ stats: { projectile: { template: tmpl } } });
  results.networked = {
    six: props.NETWORKED_ROUNDS.map(t => set.has(t.toLowerCase())),
    modPool: set.has('satchelchargeprojectile'),
    landmine: props.roundIsRecorded(group('LandmineProjectile'), set),
    grenade: props.roundIsRecorded(group('GrenadeAxisProjectile'), set),
    floatingMine: props.roundIsRecorded(group('FloatingMine'), set),
    tankShell: props.roundIsRecorded(group('TigerProjectile'), set),
    bullet: props.roundIsRecorded(group('ThompsonProjectile'), set),
    noSet: props.roundIsRecorded(group('LandmineProjectile'), undefined),
  };
}

// --- a replayed engineer lays no mine of the page's own ------------------------------
//
// His recorded `f` for the Landmine still plays his torso's fire (the lay)
// and the report at him; the round itself is the recording's object. A
// bazooka's round, which no recording carries, still leaves the tube.
{
  const scene = new THREE.Scene();
  const guns = new GunFire({ scene, viewportHeight: () => 800 });
  guns.effects = fakeEffects();
  const rec = recording.parseRecording([
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'e', t: 1, e: 'projPool', tid: 1323, tmpl: 'LandmineProjectile', netId: 100, count: 4 }),
  ].join('\n'));
  const player = {
    rec, playing: true, root: new THREE.Group(), networkedRounds: props.networkedRounds(rec),
    ctx: { guns, scene, bust: () => '', modelsBase: 'models', loader: null },
  };
  const soldiers = new ReplaySoldiers(player);
  const rigs = { Landmine: fireArmsRig('Landmine', LANDMINE), Bazooka: fireArmsRig('Bazooka', BAZOOKA) };
  soldiers.handGun = async weapon => (rigs[weapon] ? { scene: rigs[weapon] } : null);
  const actor = { playerId: 'replay:5', state: { soldier: { x: 10, y: 0, z: 10, yaw: 0 } } };
  await soldiers.flash(actor, 'Landmine', { weapon: 'Landmine', dir: [0, -0.3, 1] });
  await soldiers.flash(actor, 'Bazooka', { weapon: 'Bazooka', dir: [0, 0, 1] });
  for (let i = 0; i < 3; i++) guns.advance(1 / 30);
  const templates = guns.projectiles.map(s => s.group.stats.projectile.template);
  // And without the recording's list (an older player object): the page
  // fired both, which is the lingering mine.
  const oldGuns = new GunFire({ scene, viewportHeight: () => 800 });
  const oldSoldiers = new ReplaySoldiers({ ...player, ctx: { ...player.ctx, guns: oldGuns }, networkedRounds: undefined });
  oldSoldiers.handGun = soldiers.handGun;
  await oldSoldiers.flash(actor, 'Landmine', { weapon: 'Landmine', dir: [0, -0.3, 1] });
  oldGuns.advance(1 / 30);
  const lingering = oldGuns.projectiles.find(s => s.group.stats.projectile.template === 'LandmineProjectile');
  results.soldierRounds = {
    templates,
    unfilteredMineTtl: lingering ? lingering.ttl : null,
  };
}

// --- a PT boat's floating mine is the recording's, its gun is the page's -------------------
{
  const root = new THREE.Group();
  root.name = 'Elco80';
  root.userData = { templateKind: 'PlayerControlObject' };
  const launcher = fireArmsRig('FloatingMineLauncher', FLOATING_MINE);
  launcher.position.set(0, 1, 8);
  const gun = fireArmsRig('Elco80Gun', BOAT_GUN);
  gun.position.set(0, 2, -4);
  root.add(launcher, gun);
  const model = new THREE.Group();
  model.add(root);
  const rec = recording.parseRecording([
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 2100, netId: 700, tmpl: 'Elco80', pos: [0, 0, 0], rot: [0, 0, 0] }),
    line({ k: 'o', t: 1, id: 700, gid: 1, tmpl: 'Elco80', tid: 2100, team: 2, maxhp: 400, crit: 40 }),
    line({ k: 's', t: 1, o: [[700, 0, 0, 0, 0, 0, 0, 1]] }),
    line({ k: 'e', t: 1, e: 'projPool', tid: 2101, tmpl: 'FloatingMine', netId: 710, count: 4 }),
    line({ k: 'f', t: 3, id: 700, pid: 9, w: 'FloatingMineLauncher', p: [0, 1, -8], d: [0, 0, -1], alt: 1 }),
    line({ k: 'f', t: 3.2, id: 700, pid: 9, w: 'Elco80Gun', p: [0, 2, 4], d: [0, 0, 1] }),
  ].join('\n'));
  const scene = new THREE.Scene();
  const guns = new GunFire({ scene, viewportHeight: () => 800 });
  const player = { ctx: { guns, scene }, rec, showGhosts: true, networkedRounds: props.networkedRounds(rec) };
  const hull = new ReplayHull(player, rec.lives.find(l => l.nid === 700), model, null);
  hull.update(3, 0.05);
  for (const f of rec.fires) hull.fire(0, f.kind, f);
  results.hullRounds = {
    templates: guns.projectiles.map(s => s.group.stats.projectile.template),
    // The launcher's report still sounds while it lays.
    launcherSounding: Number.isFinite(hull.groups.find(g => g.node.name === 'FloatingMineLauncher')?.soundUntil),
  };
}

// --- a recorded mine goes off where it went off, and nowhere else --------------------------
//
// Engineer pid 5 lays four mines from his kit's pool (100..103); the
// recording player, pid 3, stands 30 m off, then walks south.
// - 100 goes off at 20 s: its ghost ends, well inside the view distance.
// - 102 lies 395 m out; the recording loses it at 21 s, walking away, at
//   425 m: out of range, not a blast.
// - 101 and 103 go at 40 s with the engineer's kit, which expired: the pool
//   is deleted, the ghost ending in the same packet either side of it.
{
  const lines = [
    line({ k: 'h', v: 5, start: '', hz: 10 }),
    line({ k: 'roster', t: 0.5, p: [[3, 2, 0, 'recorder', 1], [5, 1, 0, 'engineer', 0]] }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1763, netId: 50, tmpl: 'USSoldier', pos: [10, 1, 10], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'control', pid: 3, netId: 50 }),
    line({ k: 'o', t: 1, id: 50, gid: 1, tmpl: 'USSoldier', tid: 1763, team: 2, maxhp: 30 }),
    line({ k: 's', t: 1, o: [[50, 10, 2, 10, 0, 0, 0, 1]] }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1727, netId: 60, tmpl: 'GermanSoldier', pos: [30, 1, 30], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'control', pid: 5, netId: 60 }),
    line({ k: 'e', t: 1, e: 'projPool', tid: 1323, tmpl: 'LandmineProjectile', netId: 100, count: 4 }),
    line({ k: 'e', t: 1, e: 'createObject', tid: 1470, netId: 110, tmpl: 'German_Engineer', pos: [30, 1, 30], rot: [0, 0, 0] }),
    line({ k: 'e', t: 1, e: 'pickupKit', pid: 5, netId: 110 }),
  ];
  const lay = (t, nid, [x, y, z]) => {
    lines.push(line({ k: 'o', t, id: nid, gid: nid, tmpl: 'LandmineProjectile', tid: 1323, team: -1 }));
    lines.push(line({ k: 's', t, o: [[nid, x, y + 0.5, z, 0, 0, 0, 1]] }));
    lines.push(line({ k: 's', t: t + 0.1, o: [[nid, x, y, z, 0, 0, 0, 1]] }));
  };
  lay(10, 100, [30, 0, 30]);
  lay(12, 101, [40, 0, 40]);
  lay(14, 102, [10, 0, 405]);
  lay(16, 103, [50, 0, 50]);
  lines.push(line({ k: 'd', t: 20, id: 100 }));
  // The recording player walks south, away from 102.
  lines.push(line({ k: 's', t: 20.5, o: [[50, 10, 2, 0, 0, 0, 0, 1]] }));
  lines.push(line({ k: 's', t: 20.9, o: [[50, 10, 2, -20, 0, 0, 0, 1]] }));
  lines.push(line({ k: 'd', t: 21, id: 102 }));
  // The kit expires: destroyed first for 101, its ghost first for 103.
  lines.push(line({ k: 'd', t: 39.998, id: 103 }));
  for (const nid of [110, 100, 101, 102, 103]) lines.push(line({ k: 'e', t: 40, e: 'destroyObject', netId: nid }));
  lines.push(line({ k: 'd', t: 40.003, id: 101 }));
  lines.push(line({ k: 'end', t: 45 }));
  const rec = recording.parseRecording(lines.join('\n'));
  const fx = fakeEffects();
  const player = {
    rec, recordingPid: 3, recordingPids: [3], playing: true, root: new THREE.Group(),
    ctx: { effects: fx, viewDistance: () => 400 },
  };
  const replayProps = new props.ReplayProps(player);
  for (const nid of [100, 101, 102, 103]) {
    const life = rec.lives.find(l => l.nid === nid);
    const node = new THREE.Object3D();
    node.visible = false;
    replayProps.props.push({ life, node, endEffect: 'e_ExplMine', wasShown: false, lastAt: null });
  }
  const shownAt = {};
  for (let i = 0; i <= 900; i++) {
    const t = 9 + i * 0.05;
    replayProps.update(t);
    for (const prop of replayProps.props) {
      if (prop.node.visible) shownAt[prop.life.nid] = +t.toFixed(2);
    }
  }
  const lifeOf = nid => rec.lives.find(l => l.nid === nid);
  const eyes = t => props.recorderPositions(rec, [3], t);
  results.propsEnd = {
    blasts: fx.played.map(h => ({ name: h.name, at: h.position.map(v => +v.toFixed(1)) })),
    lastShown: shownAt,
    wentOff: {
      detonated: props.wentOff(lifeOf(100), 19.98, 20.02, eyes, 400),
      outOfRange: props.wentOff(lifeOf(102), 20.98, 21.02, eyes, 400),
      withKitDestroyFirst: props.wentOff(lifeOf(101), 39.98, 40.02, eyes, 400),
      withKitGhostFirst: props.wentOff(lifeOf(103), 39.98, 40.02, eyes, 400),
      noRangeKnown: props.wentOff(lifeOf(102), 20.98, 21.02, null, null),
    },
    recorderAt20: props.recorderPositions(rec, [3], 20),
    // A merged recording: a second recording player beside mine 102 still
    // sees it go.
    secondEye: props.wentOff(lifeOf(102), 20.98, 21.02, t => [...eyes(t), [10, 1, 400]], 400),
  };
}

process.stdout.write(JSON.stringify(results));
