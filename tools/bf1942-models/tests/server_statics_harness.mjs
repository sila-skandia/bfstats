// A BF42++ server's statics on the page, under node: `viewer/server-statics.js`
// fed by `viewer/net-sidecar.js`'s state from the sidecar's own record shapes
// (sidecar/record.mjs createStatic / updateStatic, the setLevel row's
// `statics: 0`), with the vendored three.js. The level is a synthetic scene in
// the bake's root order; the real bakes on this PC (viewer/maps/<level>) are
// read for that order too, from their glb's JSON chunk. See
// test_server_statics.py and features/udp-sidecar/wire.md section 30.
//
//   node server_statics_harness.mjs [<maps dir>]

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { viewerDir, installModuleHooks } = await import(path.join(HERE, '..', 'sim', 'env.mjs'));
const viewer = viewerDir(path.join(HERE, '..', 'viewer'));
installModuleHooks(viewer);
const imp = f => import(pathToFileURL(path.join(viewer, f)).href);
const THREE = await imp('vendor/three.module.js');
const S = await imp('server-statics.js');
const { createSidecarState } = await imp('net-sidecar.js');

const results = {};
const r4 = (v) => v.map((x) => Math.round(x * 1e4) / 1e4);

// The bake's root order (extract_map.py build_scene): terrain and fill tiles,
// the sky, the water, the StaticObjects.con placements, the mode scripts'
// statics, the spawners group, the flag cloths, the control points.
function bakedLevel(statics = ['stecrate1_M1', 'sandbag_2m_m1', 'stecrate1_M1']) {
  const root = new THREE.Group();
  const add = (name, userData = {}) => { const n = new THREE.Group(); n.name = name; n.userData = userData; root.add(n); return n; };
  add('Tx00x00', { kind: 'terrain' }); add('Tx01x00', { kind: 'terrain' });
  add('Fill00x00'); add('sky'); add('water', { kind: 'water' });
  statics.forEach((name, i) => {
    // three renames a repeated node `<name>_1`
    const n = add(statics.indexOf(name) < i ? `${name}_1` : name);
    n.position.set(i * 10, 0, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    mesh.name = `${name}_mesh`;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    hull.name = `${name}_collision`; hull.userData.collision = true; hull.visible = false;
    n.add(mesh, hull);
  });
  add('Telemark_turbine', { modes: ['Conquest'] });
  add('spawners');
  add('The_beach cloth');
  add('controlPoints');
  return root;
}

function fakeCollider() {
  const c = {
    owners: [], disabled: new Set(), moved: new Map(), log: [],
    statics: {
      ownerOf(node) { for (let n = node; n; n = n.parent) { const i = c.owners.indexOf(n); if (i >= 0) return i; } return -1; },
      disableOwner(id) { c.disabled.add(id); c.log.push(['disable', id]); },
      enableOwner(id) { c.disabled.delete(id); c.log.push(['enable', id]); },
    },
    addOwner(node) { c.owners.push(node); c.log.push(['add', node.name]); return c.owners.length - 1; },
    setMovedOwner(owner, fwd, inv, x, y, z) { c.moved.set(owner, [x, y, z]); },
    clearMovedOwner(owner) { c.moved.delete(owner); c.log.push(['clear', owner]); },
  };
  return c;
}

// --- marking, pruning, restoring ------------------------------------------------
{
  const root = bakedLevel();
  const collider = fakeCollider();
  const marked = S.markStaticObjectsCon(root, { objects: { placed: 3 } });
  const stamped = root.children.filter((n) => n.userData.staticObjectsCon).map((n) => n.name);
  // the collision index owns each placed static
  for (const n of root.children) if (n.userData.staticObjectsCon || n.name === 'Telemark_turbine') collider.owners.push(n);
  const pruned = S.pruneStaticObjectsCon(root, collider);
  const after = root.children.map((n) => n.name);
  const disabled = [...collider.disabled].sort();
  const restored = S.restoreStaticObjectsCon(root, collider);
  results.mark = { marked, stamped, pruned, after, disabled, restored, disabledAfter: [...collider.disabled], back: root.children.length };
  results.badLayout = {
    tooMany: S.markStaticObjectsCon(bakedLevel(), { objects: { placed: 5 } }),   // runs into the mode static
    noCount: S.markStaticObjectsCon(bakedLevel(), {}),
  };
}

// --- reconcile and pose ----------------------------------------------------------
{
  const want = new Map([[1, { id: 1, tmpl: 'a', rev: 3, made: 1 }], [2, { id: 2, tmpl: 'b', rev: 9, made: 2 }], [4, { id: 4, tmpl: 'd', rev: 1, made: 9 }]]);
  const have = new Map([[1, { tmpl: 'A', rev: 3, made: 1 }], [2, { tmpl: 'b', rev: 5, made: 2 }], [3, { tmpl: 'c', rev: 1, made: 3 }], [4, { tmpl: 'd', rev: 1, made: 4 }]]);
  const ops = S.reconcileStatics(want, have);
  results.reconcile = { create: ops.create.map((x) => x.id), pose: ops.pose.map((x) => x.id), remove: ops.remove };
  const p = S.poseOf({ pos: [1, 2, 3], rot: [90, 0, 0] });
  results.pose = { position: p.position, quaternion: r4(p.quaternion) };
}

// --- the whole path: sidecar records -> client state -> page copies -----------------
{
  const pure = createSidecarState();
  const root = bakedLevel();
  S.markStaticObjectsCon(root, { objects: { placed: 3 } });
  const collider = fakeCollider();
  for (const n of root.children) if (n.userData.staticObjectsCon) collider.owners.push(n);
  const lines = [];
  const page = {
    currentRoot: root, collider, loader: null, MODELS_BASE: '/models', bust: () => '',
    bindDynamicShading: () => {}, logToConsole: (t) => lines.push(t),
  };
  const statics = S.createServerStatics(page);
  const tick = async () => { statics.sync(pure.state.statics); for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  const e = (rec) => pure.ingest({ k: 'e', t: 1, ...rec });

  // SpecialGame 2 ahead of the load: sidecar.mjs marks the setLevel row.
  e({ e: 'setLevel', level: 'bf1942/levels/wake/', mode: 'conquest.con', statics: 0 });
  // The server sends a crate back, turned, and one with no transform.
  e({ e: 'createStatic', tid: 900, tmpl: 'stecrate1_M1', id: 7, pos: [100, 5, 200], rot: [90, 0, 0] });
  e({ e: 'createStatic', tid: 901, tmpl: 'sandbag_2m_m1', id: 8 });
  e({ e: 'createStatic', tid: 999, tmpl: '', id: 9, pos: [0, 0, 0], rot: [0, 0, 0] });
  await tick();
  const crate = () => statics.have.get(7)?.object;
  const step1 = {
    off: pure.state.statics.off,
    rootNames: root.children.map((n) => n.name),
    crate: crate() && { name: crate().name, pos: crate().position.toArray().map((x) => +x.toFixed(3)), q: r4(crate().quaternion.toArray()),
      hullHidden: crate().children.find((c) => c.userData.collision)?.visible === false, meshes: crate().children.length },
    bag: statics.have.get(8)?.object?.position.toArray(),
    unknown: statics.report.unknown,
    owners: collider.log.filter((x) => x[0] === 'add').map((x) => x[1]),
    disabled: [...collider.disabled].sort(),
  };
  e({ e: 'updateStatic', id: 7, action: 'move', value: [110, 6, 210] });
  e({ e: 'updateStatic', id: 7, action: 'scale', value: [5, 5, 5] });
  e({ e: 'updateStatic', id: 42, action: 'delete' });                     // unknown id: ignored
  await tick();
  const step2 = { pos: crate().position.toArray(), q: r4(crate().quaternion.toArray()), scale: crate().scale.toArray(),
    moved: collider.moved.get(statics.have.get(7).owner) };
  e({ e: 'updateStatic', id: 7, action: 'rotate', value: [180, 0, 0] });
  await tick();
  const step3 = { pos: crate().position.toArray(), q: r4(crate().quaternion.toArray()) };
  // The same id made again: the old object goes, a new one stands.
  const first = crate();
  e({ e: 'createStatic', tid: 900, tmpl: 'stecrate1_M1', id: 7, pos: [1, 1, 1], rot: [0, 0, 0] });
  await tick();
  const step4 = { replaced: crate() !== first, oldGone: !first.parent, pos: crate().position.toArray() };
  e({ e: 'updateStatic', id: 7, action: 'delete' });
  await tick();
  const step5 = { have: [...statics.have.keys()], inRoot: root.children.filter((n) => n.userData.serverStatic != null).length,
    log: collider.log.filter((x) => x[0] === 'clear').length };
  // The next load of the level says nothing: the file's statics are back.
  e({ e: 'setLevel', level: 'bf1942/levels/wake/', mode: 'conquest.con' });
  await tick();
  const step6 = { off: pure.state.statics.off, have: [...statics.have.keys()], statics: root.children.filter((n) => n.userData.staticObjectsCon).length,
    enabled: collider.log.filter((x) => x[0] === 'enable').length };
  results.flow = { step1, step2, step3, step4, step5, step6, report: statics.report, lines };
}

// --- the real bakes on this PC ----------------------------------------------------------
{
  const maps = process.argv[2] || path.join(viewer, 'maps');
  const out = {};
  for (const level of ['wake', 'el_alamein', 'berlin', 'midway', 'stalingrad', 'battle_of_the_bulge']) {
    const glb = path.join(maps, level, 'scene.glb');
    const scene = path.join(maps, level, 'scene.json');
    if (!existsSync(glb) || !existsSync(scene)) continue;
    const buf = readFileSync(glb);
    const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString('utf8'));
    const extras = JSON.parse(readFileSync(scene, 'utf8'));
    const root = new THREE.Group();
    const seen = new Map();
    for (const i of json.scenes[0].nodes) {
      const node = json.nodes[i];
      const n = new THREE.Group();
      // GLTFLoader's unique names: a repeat gets `_<n>`
      const k = seen.get(node.name) ?? 0;
      seen.set(node.name, k + 1);
      n.name = k ? `${node.name}_${k}` : (node.name ?? '');
      n.userData = { ...(node.extras || {}) };
      root.add(n);
    }
    out[level] = { placed: extras.objects?.placed ?? null, marked: S.markStaticObjectsCon(root, extras) };
  }
  results.real = out;
}

process.stdout.write(JSON.stringify(results));
