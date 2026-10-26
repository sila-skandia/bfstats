// Writes core/src/commonTest/resources/parity/js-ops.json.gz: the V8 behaviour the
// decoder port leans on (JsOps.kt), from V8 itself: Number#toFixed and
// Math.round over awkward doubles, Math.hypot, Number(string), JSON.parse
// then JSON.stringify of awkward texts, bitstream.mjs rangedBits over
// non-integer bounds, Math.sin and Math.cos from tiny to huge arguments
// (JsMath.kt's fdlibm), ** (JsMath.kt's correctly rounded pow; the ghost
// writer's 0.5 ** ticks among them), and Number() of decimal strings at and
// around the midpoints between doubles (JsNumber.parseDecimal).
//   node parity/js-ops.mjs
import fs from 'node:fs';
import os from 'node:os';
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
const trigArgs = [0, -0, 1e-300, -1e-9, Math.PI / 4, Math.PI / 2, Math.PI, 3 * Math.PI / 4, 2 * Math.PI, 1e5, 1e10, 1e22, 1e300, -1e300,
  2 ** 19 * Math.PI / 2, 2 ** 20 * Math.PI / 2, 1.5707963267948966, 3.141592653589793, 0.7853981633974483, 2.356194490192345, NaN, Infinity, -Infinity];
for (let i = 0; i < 4000; i++) {
  const k = i % 5;
  trigArgs.push(k === 0 ? (rnd() * 2 - 1) * 7 : k === 1 ? (rnd() * 2 - 1) * 1000 : k === 2 ? (rnd() * 2 - 1) * 10 ** (rnd() * 300)
    : k === 3 ? (rnd() * 2 - 1) * 10 ** (rnd() * 20 - 10) : (Math.round(rnd() * 400) - 200) * Math.PI / 4 + (rnd() - 0.5) * 1e-9);
}
const trig = trigArgs.map((x) => [bits(x), bits(Math.sin(x)), bits(Math.cos(x))]);
// **: V8 calls the C library's pow (glibc's here, so Node on another OS can
// differ), which is within 0.52 ulp but not always the nearest double.
// `pow` is what must match to the bit: the special cases and every exact
// power, the sidecar's own 0.5 ** (a tick count) among them, into the
// subnormals and past them. `powLibm` is arbitrary arguments, where the
// port (correctly rounded) and glibc may differ by an ulp on a near tie.
const powArgs = [];
for (const x of [0, -0, 1, -1, 2, -2, 0.5, -0.5, Infinity, -Infinity, NaN, 3, 10, 0.25, 4])
  for (const y of [0, -0, 1, -1, 2, 3, -3, 0.5, -0.5, 1.5, Infinity, -Infinity, NaN, 1e10, -1e10, 1074, 1075, -1074, 2 ** 53, 2 ** 53 + 2]) powArgs.push([x, y]);
for (let n = -1100; n <= 1200; n++) powArgs.push([0.5, n]);
// 3 ** n is exact to n = 33; 3 ** 34 is an exact tie, which glibc rounds up (to odd).
for (let n = 0; n <= 40; n++) powArgs.push(...(n <= 33 ? [[3, n], [-3, n]] : []), [10, n - 20], [1.5, n]);
const pow = powArgs.map(([x, y]) => [bits(x), bits(y), bits(x ** y)]);
const libmArgs = [[3, 34], [-3, 34], [3, 35], [3, 40]];
for (let i = 0; i < 3000; i++) {
  const k = i % 5;
  if (k === 0) libmArgs.push([0.5, rnd() * 60]);
  else if (k === 1) libmArgs.push([0.5, 1000 + rnd() * 90]); // the subnormal tail
  else if (k === 2) libmArgs.push([rnd() * 4, rnd() * 8 - 4]);
  else if (k === 3) libmArgs.push([10 ** (rnd() * 40 - 20), rnd() * 30 - 15]);
  else libmArgs.push([-(rnd() * 3), Math.floor(rnd() * 20) - 10]);
}
const powLibm = libmArgs.map(([x, y]) => [bits(x), bits(y), bits(x ** y)]);
// The exact decimal of a double's upper midpoint (2m+1) 2^(e-1), and V8's
// Number() of it, of it one less in the last digit, and of it with a 1 after.
const exactMid = (v) => {
  const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, v);
  const u = b.getBigUint64(0); const be = Number((u >> 52n) & 0x7ffn); const f = u & ((1n << 52n) - 1n);
  const m = be === 0 ? f : f | (1n << 52n); const e = (be === 0 ? -1074 : be - 1075) - 1;
  const n = 2n * m + 1n;
  if (e >= 0) return (n << BigInt(e)).toString();
  const digits = (n * 5n ** BigInt(-e)).toString().padStart(-e + 1, '0');
  return `${digits.slice(0, digits.length + e)}.${digits.slice(digits.length + e)}`;
};
const decStrs = ['0.1', '0.3', '1e23', '8.98846567431158e307', '1.7976931348623157e308', '1.7976931348623158e308', '1.7976931348623159e308',
  '2.2250738585072011e-308', '2.2250738585072012e-308', '4.9406564584124654e-324', '2.4703282292062327e-324', '2.4703282292062328e-324',
  '9007199254740993', '9007199254740992.5', '123456789012345678901234567890', '0.000000000000000000000000000001234567890123456789', '1e-400', '1e400'];
for (let i = 0; i < 1500; i++) {
  const k = i % 3;
  const v = k === 0 ? rnd() * 10 ** (rnd() * 40 - 20) : k === 1 ? rnd() * 2 ** (Math.floor(rnd() * 2000) - 1000) : Math.round(rnd() * 1e6) / 1e3;
  const mid = exactMid(v);
  decStrs.push(mid, mid.replace(/\d$/, (d) => String(Math.max(0, +d - 1))), `${mid}1`, String(v), v.toPrecision(17), v.toPrecision(21));
}
const decimals = decStrs.map((s) => [s, bits(Number(s))]);
// fs.statSync(p).mtimeMs from a real file's seconds and nanoseconds (the
// install-cache fingerprint rounds it): [sec, nsec, mtimeMs bits, Math.round].
const mdir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtime-'));
const mfile = path.join(mdir, 'f');
fs.writeFileSync(mfile, 'x');
const mtimes = [];
for (const t of [1700000000.0004999, 1700000000.0005, 1700000000.0005001, 1761456789.1234567, 1761456789.9999999, 0.0015, 1e9 + 0.25e-3, 2e9 + 0.7531]) {
  fs.utimesSync(mfile, t, t);
  const big = fs.statSync(mfile, { bigint: true });
  const s = fs.statSync(mfile);
  mtimes.push([String(big.mtimeNs / 1000000000n), String(big.mtimeNs % 1000000000n), bits(s.mtimeMs), Math.round(s.mtimeMs)]);
}
fs.rmSync(mdir, { recursive: true, force: true });
// path.posix.join, which the install readers' paths and messages use.
const joins = [['/a', 'b'], ['/a/', '/b/'], ['a', '..', 'b'], ['', 'Mods/x'], ['/a/./b', '../c'], ['..', '..', 'a'], ['/', '..'], ['', ''],
  ['a//b', 'c/'], ['/tmp/x', 'Mods', 'BF1942'], ['.', 'a'], ['a/..'], ['/a/b/../../..'], ['./'], ['a', '', 'b']].map((p) => [p, path.posix.join(...p)]);
writeGz(path.join(RES, 'js-ops.json.gz'), JSON.stringify({ toFixed, hyp, toNumber, parse, reject, ranged, trig, pow, powLibm, decimals, mtimes, joins }));
console.log(`${toFixed.length} numbers, ${hyp.length} hypots, ${trig.length} sin/cos, ${pow.length} + ${powLibm.length} pows, ${decimals.length} decimals`);
