// Writes core/src/commonTest/resources/parity/objects-checksum.json from the Node
// sidecar's objects-checksum.mjs: CRC-32/BZIP2 over fixed and seeded bytes,
// the bundled objects-crc.json as Node reads it (so a regenerated table that
// the Kotlin resource copy lacks fails the test), and objectsChecksum's
// answers without an install. ObjectsChecksumTest.kt replays them.
//   node parity/objects-checksum.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SIDECAR, sidecar, write, prng } from './lib/fixture.mjs';

const O = await sidecar('objects-checksum.mjs');
const out = {};
const r = prng(31337);
const seededBytes = Buffer.from(Array.from({ length: 4096 }, () => Math.floor(r() * 256)));
out.crc = [Buffer.from('123456789'), Buffer.alloc(0), Buffer.from([0]), Buffer.from([0xff, 0xff, 0xff, 0xff]), seededBytes, seededBytes.subarray(0, 1023)]
  .map((b) => [b.toString('hex'), O.crc32Bzip2(b)]);
out.bundled = O.bundledChecksums();
const noInstall = path.join(os.tmpdir(), 'no-such-bf1942-install');
const quiet = console.warn; console.warn = () => {};
out.lookups = ['BF1942', 'bf1942', 'XPack1', 'xpack2', 'DC_Final', 'FHSW', 'nope', '', null, 'Pirates'].flatMap((m) => [
  { mod: m, bundled: true, out: O.objectsChecksum(m ?? undefined, { dir: noInstall }) },
  { mod: m, bundled: false, out: O.objectsChecksum(m ?? undefined, { dir: noInstall, bundled: false }) },
]);
console.warn = quiet;

// A small fake install, Windows-cased as a real one is: the install answers
// first (resolveCi, any case), the bundled table the rest. A fresh module
// instance, so its warn-once set and CRC cache start empty, as the Kotlin
// test's do after resetObjectsChecksum(). The tree is in the fixture
// ([path, hex] files, [path] folders) for the test to build the same.
const I = await import(new URL('objects-checksum.mjs?install', SIDECAR).href);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'objects-install-'));
const tree = [
  ['Mods/BF1942/Archives/Objects.RFA', Buffer.from(seededBytes.subarray(0, 300)).toString('hex')],
  ['Mods/xpack1/archives/objects.rfa', Buffer.from('xpack1 objects').toString('hex')],
  ['Mods/Custom/Archives/objects.rfa', Buffer.from('a mod no table knows').toString('hex')],
  ['Mods/Empty/'],
  ['Mods/Broken/Archives/objects.rfa/'],
  ['Mods/readme.txt', Buffer.from('not a mod').toString('hex')],
  ['flat/Mods', Buffer.from('a file where Mods should be').toString('hex')],
];
const build = (base) => {
  for (const [rel, h] of tree) {
    const p = path.join(base, rel);
    if (h == null) fs.mkdirSync(p, { recursive: true });
    else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(h, 'hex')); }
  }
};
build(root);
out.installTree = tree;
const warns = [];
console.warn = (m) => warns.push(String(m).split(root).join('<dir>'));
const run = (mod, dirRel, bundled) => {
  const dir = dirRel == null ? null : path.join(root, dirRel);
  const got = I.objectsChecksum(mod ?? undefined, { dir, bundled });
  return { mod, dir: dirRel, bundled, out: got, warns: warns.splice(0) };
};
out.install = [];
for (const m of ['BF1942', 'bf1942', 'XPack1', 'xpack1', 'Custom', 'Empty', 'Broken', 'XPack2', 'nope', '', null, 'readme.txt']) {
  out.install.push(run(m, '', true), run(m, '', false));
}
for (const m of ['BF1942', 'XPack2', 'nope']) out.install.push(run(m, 'flat', true), run(m, 'missing', false), run(m, null, true));
// The cache: a rewritten archive (another size) is read again.
fs.writeFileSync(path.join(root, 'Mods/BF1942/Archives/Objects.RFA'), Buffer.from('a different archive'));
out.install.push({ rewrite: ['Mods/BF1942/Archives/Objects.RFA', Buffer.from('a different archive').toString('hex')] }, run('BF1942', '', true));
console.warn = quiet;
fs.rmSync(root, { recursive: true, force: true });
write('objects-checksum', out);
