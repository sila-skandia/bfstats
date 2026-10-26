#!/usr/bin/env node
// Cut a udp-relay.mjs capture down for a fixture: the head lines and every
// datagram up to --ms after the client's first, gzipped.
//   node parity/live/trim-capture.mjs capture.ndjson out.ndjson.gz --ms 30000
import fs from 'node:fs';
import zlib from 'node:zlib';

const [src, dst] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const i = process.argv.indexOf('--ms');
const ms = i >= 0 ? Number(process.argv[i + 1]) : 30000;
const rows = fs.readFileSync(src, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const t0 = rows.find((r) => r.dir === 'out').t;
const kept = rows.filter((r) => !r.dir || r.t - t0 <= ms);
fs.writeFileSync(dst, zlib.gzipSync(kept.map((r) => JSON.stringify(r)).join('\n') + '\n', { level: 9 }));
console.log(`${kept.length} of ${rows.length} lines, ${ms} ms from the first datagram out`);
