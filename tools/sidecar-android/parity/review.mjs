// Writes core/src/commonTest/resources/parity/review.json: a ReviewLog driven
// through every record kind at scripted instants (Date.now faked), with the
// file it wrote and its summary(). The records come from the repo's own
// review logs (run.review.ndjson's kinds, the fixtures' ghost records) and
// edge cases: fields left out, null bodyBits, ids either side of 9.
//   node parity/review.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { ReviewLog } from '../../bf1942-models/sidecar/review.mjs';
import { installFakeTime } from './lib/fake-time.mjs';
import { rng } from './lib/fixture.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const fixtures = path.join(here, '../../bf1942-models/tests/fixtures');
const ghost = zlib.gunzipSync(fs.readFileSync(path.join(fixtures, 'sidecar_wake_zero_sherman.review.ndjson.gz')))
  .toString('utf8').split('\n').filter(Boolean).slice(0, 120).map((l) => JSON.parse(l));

const rand = rng(3);
const ops = [];
let t = 0;
const at = () => (t += Math.floor(rand() * 400) + rand());
ops.push({ t: at(), op: 'unknownEvent', args: { id: 0, seq: 16, block: 15, bitOffset: 516, hex: '00f007000000606f0000e0e1290100806de001af' } });
ops.push({ t: at(), op: 'unknownEvent', args: { id: 0x4a, seq: 18, block: 17, bitOffset: 413, hex: '00e00f' } });
ops.push({ t: at(), op: 'unknownEvent', args: { id: 9 } });
ops.push({ t: at(), op: 'unknownEvent', args: { id: 0x4a, seq: 19 } });
ops.push({ t: at(), op: 'ghostBlockRaw', args: { seq: 22, reason: 'control-object-state', hex: '0400000000c69500' } });
ops.push({ t: at(), op: 'unknownDatagram', args: { type: 0x0f, hex: 'ff' } });
ops.push({ t: at(), op: 'unknownDatagram', args: { type: 3 } });
ops.push({ t: at(), op: 'decodeError', args: { where: 'event#2', seq: 40, message: 'BitReader underflow', hex: 'abcd' } });
ops.push({ t: at(), op: 'decodeError', args: { where: 'download-stream', seq: 41, message: 'download stream present (not decoded)' } });
for (const g of ghost) {
  const { tag, dt, ...args } = g;
  ops.push({ t: at(), op: 'ghostRecord', args });
}
ops.push({ t: at(), op: 'ghostRecord', args: { seq: 1, tick: 2, netId: 5, action: 3, bodyBits: null } });
ops.push({ t: at(), op: 'ghostRecord', args: { seq: 1, tick: 2, netId: 5, action: 3 } });
ops.push({ t: 1e9 + 0.0005, op: 'decodeError', args: { where: 'late', message: 'rounding' } });
ops.push({ t: 1e9 + 0.0015, op: 'decodeError', args: { where: 'late', message: 'rounding' } });

const time = installFakeTime(0);
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'review-')), 'r.ndjson');
const log = new ReviewLog(file);
const summaries = [];
for (const o of ops) {
  time.advanceTo(o.t);
  log[o.op](o.args);
  if (ops.indexOf(o) % 40 === 0) summaries.push(log.summary());
}
summaries.push(log.summary());
log.close();
await new Promise((r) => log.stream.on('finish', r));
time.restore();
const text = fs.readFileSync(file, 'utf8');
const out = { ops, lines: text.split('\n').filter(Boolean), summaries: summaries.map((s) => ({ ...s, path: null })), started: log.started };
fs.writeFileSync(new URL('../core/src/commonTest/resources/parity/review.json', import.meta.url), JSON.stringify(out));
console.log(`${ops.length} records, ${out.lines.length} lines`);
