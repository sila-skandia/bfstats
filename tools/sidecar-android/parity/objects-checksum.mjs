// Writes core/src/commonTest/resources/parity/objects-checksum.json from the Node
// sidecar's objects-checksum.mjs: CRC-32/BZIP2 over fixed and seeded bytes,
// the bundled objects-crc.json as Node reads it (so a regenerated table that
// the Kotlin resource copy lacks fails the test), and objectsChecksum's
// answers without an install. ObjectsChecksumTest.kt replays them.
//   node parity/objects-checksum.mjs
import os from 'node:os';
import path from 'node:path';
import { sidecar, write, prng } from './lib/fixture.mjs';

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
write('objects-checksum', out);
