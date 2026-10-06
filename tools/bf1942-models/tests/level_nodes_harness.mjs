// A level's placed objects named the same way on both sides of a room: the
// page's GLTFLoader tree stamped by `viewer/level-nodes.js`, and the room
// server's own tree out of the same file (`server/glb-scene.mjs`), whose node
// index is the file's own. For every index both sides know, the two objects
// must be the same placement: the same name and the same world position. The
// stationary guns are the case that used to fail: GLTFLoader clones a mesh
// per use and shares one mapping object among the clones, so every
// Stationary_mg42 on Aberdeen read the last one's index.
//
//   node tests/level_nodes_harness.mjs <viewerDir> <level>...
// prints one JSON object. Run by `tests/test_level_nodes.py`.

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [viewerArg, ...levels] = process.argv.slice(2);
const { viewerDir, installModuleHooks } = await import(pathToFileURL(path.join(HERE, '..', 'sim', 'env.mjs')).href);
const viewer = viewerDir(viewerArg);
installModuleHooks(viewer);
const THREE = await import(pathToFileURL(path.join(viewer, 'vendor', 'three.module.js')).href);
const { GLTFLoader } = await import(pathToFileURL(path.join(viewer, 'vendor', 'loaders', 'GLTFLoader.js')).href);
const { stampLevelNodes } = await import(pathToFileURL(path.join(viewer, 'level-nodes.js')).href);
const { readGlb } = await import(pathToFileURL(path.join(HERE, '..', 'server', 'glb-tree.mjs')).href);
const { buildSceneTree } = await import(pathToFileURL(path.join(HERE, '..', 'server', 'glb-scene.mjs')).href);

/** The glb with no images, textures or samplers (node decodes none). */
function strippedGlb(file) {
  const buf = readFileSync(file);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)));
  const binAt = 20 + jsonLen;
  const bin = buf.subarray(binAt + 8, binAt + 8 + dv.getUint32(binAt, true));
  delete json.images; delete json.textures; delete json.samplers;
  for (const m of json.materials ?? []) {
    const p = m.pbrMetallicRoughness;
    if (p) { delete p.baseColorTexture; delete p.metallicRoughnessTexture; }
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
    delete m.extensions;
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

const results = {};
for (const level of levels) {
  const file = path.join(viewer, 'maps', level, 'scene.glb');
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(strippedGlb(file), '', resolve, reject));
  const stamped = stampLevelNodes(gltf);
  gltf.scene.updateMatrixWorld(true);
  const page = new Map();
  let duplicates = 0;
  gltf.scene.traverse(o => {
    if (o.levelNode == null) return;
    if (page.has(o.levelNode)) duplicates++;
    page.set(o.levelNode, o);
  });
  // What GLTFLoader's own associations would have said, for the record.
  let associationDuplicates = 0;
  const seen = new Set();
  gltf.scene.traverse(o => {
    const index = gltf.parser.associations.get(o)?.nodes;
    if (!Number.isInteger(index)) return;
    if (seen.has(index)) associationDuplicates++;
    seen.add(index);
  });
  const { json, bin } = readGlb(file);
  const { root } = buildSceneTree(json, bin);
  root.updateMatrixWorld(true);
  const server = new Map();
  root.traverse(o => { if (o.levelNode != null) server.set(o.levelNode, o); });
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  let compared = 0, nameMismatch = 0, placeMismatch = 0;
  const guns = [];
  for (const [index, s] of server) {
    const p = page.get(index);
    if (!p) continue;
    compared++;
    const want = THREE.PropertyBinding.sanitizeNodeName(s.name || '');
    if (want && p.name !== want && p.name.replace(/_\d+$/, '') !== want) nameMismatch++;
    s.getWorldPosition(a); p.getWorldPosition(b);
    if (a.distanceTo(b) > 1e-3) placeMismatch++;
    if (/stationary|defgun/i.test(s.name || '')) guns.push({ index, name: p.name, apart: Math.round(a.distanceTo(b) * 1000) / 1000 });
  }
  results[level] = { nodes: json.nodes.length, stamped, compared, nameMismatch, placeMismatch,
                     duplicates, associationDuplicates, guns: guns.length,
                     gunsApart: guns.filter(g => g.apart > 0).length };
}
console.log(JSON.stringify(results));
