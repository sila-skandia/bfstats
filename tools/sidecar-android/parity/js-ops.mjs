// Writes core/src/commonTest/resources/parity/js-ops.json.gz: the V8 behaviour the
// decoder port leans on (JsOps.kt), from V8 itself: Number#toFixed and
// Math.round over awkward doubles, Math.hypot, Number(string), JSON.parse
// then JSON.stringify of awkward texts, and bitstream.mjs rangedBits over
// non-integer bounds.
//   node parity/js-ops.mjs
import path from 'node:path';
import { RES, SIDECAR, writeGz } from './lib/tables.mjs';

const { rangedBits } = await import(path.join(SIDECAR, 'bitstream.mjs'));
let seed = 0x2545f491;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2 ** 32; };
const bits = (v) => { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, v); return b.getBigUint64(0).toString(16).padStart(16, '0'); };

const nums = [0, -0, 0.5, -0.5, 1.5, 2.5, -2.5, 0.0005, 1.0005, 1.00049999, 0.49999999999999994, -0.49999999999999994, 1e21, -1e21, 9.995, 1.005,
  123.4565, -0.0001, -0.00049, 4503599627370495.5, 2 ** 53, 1e-7, 870.0004999, 1098.7405, NaN, Infinity, -Infinity];
for (let i = 0; i < 3000; i++) {
  const e = Math.floor(rnd() * 12) - 6;
  const v = (rnd() * 2 - 1) * 10 ** e;
  nums.push(v, Math.fround(v), Math.round(v * 1e4) / 1e4 + 0.00005, Math.round(v * 1000) / 1000 - 0.0005);
}
const toFixed = nums.map((v) => [bits(v), [0, 1, 2, 3, 4, 6].map((f) => v.toFixed(f)), String(Math.round(v)), Object.is(Math.round(v), -0)]);
const hyp = [];
for (let i = 0; i < 2000; i++) {
  const a = [rnd() * 2 - 1, rnd() * 10, -rnd(), rnd() * 1e-3].slice(0, 1 + (i % 4));
  hyp.push([a.map(bits), bits(Math.hypot(...a))]);
}
hyp.push([[], bits(Math.hypot())], [[bits(0), bits(-0)], bits(Math.hypot(0, -0))], [[bits(NaN), bits(Infinity)], bits(Math.hypot(NaN, Infinity))], [[bits(NaN), bits(1)], bits(Math.hypot(NaN, 1))]);
const strs = ['', ' 12 ', '0x1f', '0b101', '0o17', '-0x10', '1e3', '.5', '5.', '+5', '-', '1/2/3', 'Infinity', '-Infinity', 'infinity', '\t\n 7 ', '12abc', '0012', '1_000', ' -0 '];
const toNumber = strs.map((s) => { const v = Number(s); return [s, Number.isNaN(v) ? 'NaN' : bits(v)]; });
const texts = ['{"b":1,"a":2,"1":3,"0":4,"01":5,"-1":6,"4294967295":7,"4294967294":8}', '[1.50,-0,1e400,2E-3,0.1e1]', '"\\u00e9\\ud800x\\n\\/"',
  '{"a":{"z":1,"2":2},"a":3}', ' {"x" : [ ] , "y":{}} ', 'null', 'true', '-12.5e-1', '{"k":"\\u0000\\u001f\\u007f"}'];
const bad = ['{a:1}', "{'a':1}", '[1,]', '01', '1.', '.5', '+1', '"\\x41"', '"a\nb"', '[1 2]', '', 'nul', '{"a":1}x'];
const parse = texts.map((t) => [t, JSON.stringify(JSON.parse(t))]);
const reject = bad.map((t) => { try { JSON.parse(t); return [t, false]; } catch { return [t, true]; } });
const ranged = [[0, 0], [0, 1], [0, 2.5], [0, NaN], [0, -1], [1, 0], [0, 255], [0, 1023], [0, 30.4], [-1, 5], [0, 2 ** 31 - 3], [0, 2 ** 30],
  // Ranges past 2^31: the full 32-bit range is 0 bits (the engine's uint32
  // wrap), the rest 32 (the loop never ended on them).
  [0, 2 ** 31 - 2], [0, 2 ** 31 - 1], [0, 2 ** 32 - 2], [0, 2 ** 32 - 1], [0, 2 ** 32], [-5, 2 ** 31], [-(2 ** 31), 2 ** 31 - 1]].map(([a, b]) => [a, Number.isNaN(b) ? 'NaN' : b, rangedBits(a, b)]);
writeGz(path.join(RES, 'js-ops.json.gz'), JSON.stringify({ toFixed, hyp, toNumber, parse, reject, ranged }));
console.log(`${toFixed.length} numbers, ${hyp.length} hypots`);
