// A player who mans a stationary gun, in a round replay of a mod level, under
// node: the gun is drawn, its gunner is drawn in its seat, the point of view
// is the seat's camera and the HUD is the gun's.
//
// The 2026-10-11 report on a Secret Weapons + Road to Rome round: "at 0:11 they
// enter a machine gun, and their player model entirely disappears". The gun
// went too, and in first person there was no HUD. A replay built every hull
// from `<models root>/<Template>.glb` with the mod's root alone, and a mod's
// tree holds what the mod adds or changes: the Stationary MG42, the flak gun,
// the AA mount and every hand weapon of that round are vanilla's files, a 404
// under `models/mods/xpack2/` (401 of the 415 templates the two trees share).
// No model, no hull; no hull, no seat for the soldier, no sight for the
// camera and no gun for the HUD. Locally the tree had been filled with copies
// that day, which is why only the published page showed it.
//
// Two halves, each a JSON key on stdout:
//
// - `fallback`: the loader of a mod tree that holds only `Flettner` (the
//   rest 404), through `ReplayAssets.model`, `weaponUrls` and the hand-gun
//   loader. Needs no asset trees: the loader is a fake.
// - `emplacements`: every manned emplacement of the three trees, entered by a
//   soldier in a synthetic round on the same mod tree, through the page's own
//   hull, bodies, camera and HUD modules. Reads the real glbs (textures
//   stripped, node decodes none) and is `skipped` where the trees are absent.
//
// Same pattern as `replay_harness.mjs`: the viewer's modules imported in place
// through `sim/env.mjs`'s hooks, one JSON report on stdout.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [THREE, { GLTFLoader }, recording, standins, { ReplayAssets }, { ReplayHull }, { ReplaySoldiers },
  { ReplayPlayer }, { ReplayCamera }, { ReplayHud }, poseBases, { createBotVisuals }, { bag }] = await Promise.all([
  imp('vendor/three.module.js'), imp('vendor/loaders/GLTFLoader.js'), imp('replay-recording.js'),
  imp('replay-standins.js'), imp('replay-assets.js'), imp('replay-hulls.js'), imp('replay-bodies.js'),
  imp('replay.js'), imp('replay-camera.js'), imp('replay-hud.js'), imp('pose-bases.js'),
  imp('bot-visuals.js'), imp('page-bag.js'),
]);
const { clone: skeletonClone } = await imp('vendor/utils/SkeletonUtils.js');

const results = {};
const line = o => JSON.stringify(o);

// --- a mod tree that holds only what the mod adds ------------------------------

const MOD_BASE = 'models/mods/xpack2';
/** What the (published) mod tree holds of the templates below; the rest is
 *  vanilla's, a 404 under the mod's root. */
const MOD_OWN = new Set(['Flettner', 'RocketPlatform', 'Pak40', 'AT25', 'Wasserfall']);

/** `url`'s file stem, `Name` of `<dir>/Name.glb?cb=1`. */
const stemOf = url => path.basename(url.split('?')[0]).replace(/\.glb$/i, '');

function treeLoader(read) {
  const requests = [];
  return {
    requests,
    loadAsync: async url => {
      requests.push(url);
      const bare = url.split('?')[0];
      if (bare.startsWith(`${MOD_BASE}/`) && !MOD_OWN.has(stemOf(bare).replace(/\.wreck$/i, ''))) {
        throw new Error(`404 ${url}`);
      }
      return read(bare);
    },
  };
}

// The fallback, on fakes: a scene per file that exists.
{
  const scene = name => {
    const root = new THREE.Group();
    root.name = name;
    root.userData = { templateKind: 'PlayerControlObject', control: name };
    const out = new THREE.Group();
    out.add(root);
    return out;
  };
  const loader = treeLoader(bare => {
    if (/NoSuchTemplate/.test(bare)) throw new Error(`404 ${bare}`);
    return { scene: scene(bare) };
  });
  const ctx = { modelsBase: MOD_BASE, bust: () => '?cb=1', loader, levelName: () => 'raid_on_agheila' };
  const assets = new ReplayAssets(ctx);
  const catalogues = {
    [`${MOD_BASE}/models.json`]: [{ name: 'Flettner', configuration: 'complex', variants: [] }],
    'models/models.json': [{
      name: 'Stationary_mg42', configuration: 'complex', variants: [
        { glb: 'Stationary_mg42.glb', level: null, configuration: 'complex' },
        { glb: 'Stationary_mg42.Raid_on_Agheila.glb', level: 'Raid_on_Agheila', configuration: 'complex' },
      ],
    }],
  };
  const keepFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const doc = catalogues[String(url).split('?')[0]];
    return doc ? { ok: true, status: 200, json: async () => doc } : { ok: false, status: 404, json: async () => null };
  };
  const names = await Promise.all(['Flettner', 'Stationary_mg42', 'flak38', 'Stationary_mg42.wreck', 'NoSuchTemplate']
    .map(async name => (await assets.model(name))?.children[0]?.name ?? null));
  globalThis.fetch = keepFetch;
  results.fallback = {
    names,
    // The mod's file is asked first and wins where it has one.
    flettnerFrom: loader.requests.filter(u => /Flettner/.test(u)),
    mgRequests: loader.requests.filter(u => /Stationary_mg42\.(Raid|glb)/.test(u) && !/wreck/.test(u)),
    weaponUrls: poseBases.weaponUrls(MOD_BASE, 'Colt', '?cb=1'),
    modelUrls: poseBases.modelUrls?.(MOD_BASE, 'flak38.glb') ?? null,
    vanillaOnly: poseBases.modelUrls?.('models', 'flak38.glb') ?? null,
  };
  // The hand gun of a soldier in a mod round: vanilla's file.
  const bodies = new ReplaySoldiers({ rec: recording.parseRecording(line({ k: 'h', v: 5, start: '', hz: 10 })), ctx });
  const hand = await bodies.handGun('Colt');
  results.handGun = { loaded: hand !== null, urls: loader.requests.filter(u => /Colt/.test(u)) };
}

// --- every manned emplacement, entered ----------------------------------------------

function strippedGlb(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)));
  const binAt = 20 + jsonLen;
  const bin = buf.subarray(binAt + 8, binAt + 8 + dv.getUint32(binAt, true));
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials ?? []) {
    const p = m.pbrMetallicRoughness;
    if (p) { delete p.baseColorTexture; delete p.metallicRoughnessTexture; }
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture; delete m.extensions;
  }
  delete json.extensionsRequired;
  const enc = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (enc.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + enc.length + jsonPad + 8 + bin.length + binPad;
  const out = new Uint8Array(total);
  const o = new DataView(out.buffer);
  o.setUint32(0, 0x46546c67, true); o.setUint32(4, 2, true); o.setUint32(8, total, true);
  o.setUint32(12, enc.length + jsonPad, true); o.setUint32(16, 0x4e4f534a, true);
  out.set(enc, 20); out.fill(0x20, 20 + enc.length, 20 + enc.length + jsonPad);
  const b = 20 + enc.length + jsonPad;
  o.setUint32(b, bin.length + binPad, true); o.setUint32(b + 4, 0x004e4942, true);
  out.set(bin, b + 8);
  return out.buffer;
}

const onDisk = rel => path.join(viewer, rel.split('?')[0]);
const parse = rel => new Promise((resolve, reject) =>
  new GLTFLoader().parse(strippedGlb(fs.readFileSync(onDisk(rel))), '', resolve, reject));

/** Every emplacement class of vanilla, Road to Rome and Secret Weapons that a
 *  player can man, with what the seat is expected to draw: a SeatObject
 *  (`body`), half a body, or nobody (SEAT-25: a seat with no SeatObject draws
 *  no occupant, the Defgun's and the radar towers'). */
const EMPLACEMENTS = [
  ['Stationary_mg42', { body: true }], ['Stationary_Browning', { body: true }], ['AA_Allies', { body: true }],
  ['flak38', { body: true }], ['Pak40', { body: true }], ['AT25', { body: true }],
  ['RocketPlatform', { body: true, half: true }], ['Defgun', { body: false }], ['Wasserfall', { body: false }],
  ['AA_Enterprise', { body: true }], ['Carrier_AA_Base', { body: true }],
];

const treeFile = tmpl => [`${MOD_BASE}/${tmpl}.glb`, `models/${tmpl}.glb`].find(rel => fs.existsSync(onDisk(rel)));
const present = EMPLACEMENTS.filter(([tmpl]) => treeFile(tmpl));
const haveBodies = fs.existsSync(onDisk(`${MOD_BASE}/poses/index.json`)) || fs.existsSync(onDisk('models/poses/index.json'));

if (!present.length || !haveBodies) {
  results.emplacements = { skipped: true };
} else {
  // The patched page: poses are fetched and parsed from disk, 404 where the
  // file is not there, as the static server answers.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    const p = onDisk(String(url));
    if (!fs.existsSync(p)) return { ok: false, status: 404, json: async () => null };
    const buf = fs.readFileSync(p);
    return { ok: true, status: 200, json: async () => JSON.parse(buf.toString('utf8')) };
  };
  const loader = treeLoader(rel => parse(rel));
  const bodyLoader = { loadAsync: async url => parse(url) };

  // One round: a soldier per emplacement, on foot at 1 s, in the gun from 3 s
  // (the soldier's object drops out of the samples, as the recording's does).
  const L = [line({ k: 'h', v: 5, start: '', hz: 10 })];
  const rows = [];
  present.forEach(([tmpl], i) => {
    const pid = 20 + i;
    const gun = 600 + i * 10;
    const man = 601 + i * 10;
    const x = i * 30;
    L.push(line({ k: 'e', t: 0.5, e: 'createPlayer', pid, name: `gunner${pid}`, team: 2, ai: 0 }));
    L.push(line({ k: 'e', t: 1, e: 'createObject', tid: 100 + i, netId: man, tmpl: 'BritishCommandoSoldier', pos: [x, 0, 0], rot: [0, 0, 0] }));
    L.push(line({ k: 'e', t: 1, e: 'control', pid, netId: man }));
    L.push(line({ k: 'o', t: 1.1, id: gun, gid: gun, tmpl, tid: 200 + i, team: 0, maxhp: 45, crit: 0 }));
    L.push(line({ k: 'o', t: 1.1, id: man, gid: man, tmpl: 'BritishCommandoSoldier', tid: 100 + i, team: 2, maxhp: 30 }));
    L.push(line({ k: 's', t: 1.1, o: [[gun, x + 2, 5, 0, 0, 0, 0, 1], [man, x, 5, 0, 0, 0, 0, 1]] }));
    L.push(line({ k: 's', t: 2.1, o: [[man, x + 1, 5, 0, 0, 0, 0, 1]] }));
    L.push(line({ k: 'e', t: 3, e: 'enterVehicle', pid, netId: gun }));
    L.push(line({ k: 'p', t: 3.05, p: [[pid, 2, gun, gun, 0, 0]] }));
    rows.push({ tmpl, pid, gun, man });
  });
  L.push(line({ k: 'end', t: 12 }));
  const rec = recording.parseRecording(L.join('\n'));
  standins.addStandIns(rec, []);

  const ctxBase = {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(60, 1.6, 0.5, 8000),
    bust: () => '', modelsBase: MOD_BASE, levelName: () => '', loadouts: () => null, loader,
    groundHeight: () => 0, waterLevel: () => -100,
    makeReplayBodies: shim => createBotVisuals(bag({
      footBodyLoader: bodyLoader, footBodyClips: () => new Promise(() => {}), footStateMachine: () => null,
      disposeFootBodyScene: () => {}, soldierDress: null, bindDynamicShading: () => {},
    }, shim)),
  };
  const assets = new ReplayAssets(ctxBase);
  const out = [];
  for (const row of rows) {
    const life = rec.lives.find(l => l.nid === row.gun);
    const scene = await assets.model(row.tmpl);
    const result = { tmpl: row.tmpl, model: scene !== null };
    out.push(result);
    if (!scene) continue;
    const ctx = { ...ctxBase };
    const player = Object.assign(Object.create(ReplayPlayer.prototype), {
      ctx, rec, time: 5, speed: 1, playing: false, lastFiredTime: 5, followPid: row.pid, recordingPid: row.pid,
      recordingPids: [row.pid], hulls: new Map(), entities: [], markers: [], showServer: false, showGhosts: true,
      root: new THREE.Group(),
      props: { update() {} }, feed: { update() {} },
      ui: { timeline: { takeScrub: () => null, plan() {} }, scrubbing: false, logOpen: false, update() {} },
    });
    const hull = new ReplayHull(player, life, skeletonClone(scene), null);
    player.hulls.set(life, hull);
    player.soldiers = new ReplaySoldiers(player);
    const stand = vis => { vis.rig ??= { kind: 'still', scene: new THREE.Group(), families: { idle: true }, anim: null, weaponNode: null, step() {} }; };
    for (let i = 0; i < 12; i++) {
      hull.update(5, 0.05);
      player.soldiers.update(5, 0.05, player.hulls);
      await new Promise(resolve => setTimeout(resolve, 10));
      for (const vis of player.soldiers.bodies.botVisuals.values()) stand(vis);
    }
    const vis = player.soldiers.bodies.botVisuals.get(`replay:${row.pid}`);
    const actor = player.soldiers.actors.get(row.pid);
    result.hull = { visible: hull.group.visible, kind: hull.kind, crew: hull.crew.length };
    result.actor = { vehicle: actor?.vehicle ?? null, seated: Boolean(actor?.seat) };
    result.body = { seated: Boolean(vis?.seat), visible: Boolean(vis?.seat?.scene.visible), half: Boolean(vis?.seat?.halfBody) };
    // The seat's own camera and the gun's HUD.
    player.camera = new ReplayCamera(player);
    player.hud = new ReplayHud(player);
    player.camera.setMode('pov');
    for (let i = 0; i < 4; i++) { hull.update(5, 0.05); player.camera.update(1 / 30, 5); }
    const sight = player.camera.sight;
    const hud = player.hud.update(5);
    const eye = hull.occupancy.cameraNodeOf(hull.seatIdAt(0) ?? hull.occupancy.rootId);
    const at = eye?.getWorldPosition(new THREE.Vector3());
    result.pov = {
      sight: sight?.kind ?? null,
      hud: hud?.kind ?? null,
      guns: hud?.guns?.length ?? 0,
      atEye: Boolean(at) && ctx.camera.position.distanceTo(at) < 1e-6,
    };
    player.soldiers.dispose();
  }
  globalThis.fetch = realFetch;
  results.emplacements = { rows: out, expected: Object.fromEntries(present) };
}

process.stdout.write(JSON.stringify(results));
