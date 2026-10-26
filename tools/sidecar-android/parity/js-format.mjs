// Writes core/src/commonTest/resources/parity/js-format.json: doubles (as their
// IEEE bits) with V8's String(n), and strings with V8's JSON.stringify, so
// the Kotlin Js writer is checked against the engine the Node sidecar runs on.
//   node parity/js-format.mjs
import fs from 'node:fs';

let seed = 0x9e3779b9;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2 ** 32; };
const f32 = (x) => Math.fround(x);
const nums = [0, -0, 1, -1, 0.1, 0.5, 1 / 3, 2 / 3, 1e21, 1e-7, 1e-6, 123456789012345680000, 2 ** 53, 2 ** 53 + 2,
  2 ** 60, 1.5e300, -4.9e-324, Number.MAX_VALUE, Number.MIN_VALUE, 5e-324, 1e20, 999999999999999900000, 0.000001234,
  4294967295, -2147483649, 870.5, 97.25, 1073.0625];
for (let i = 0; i < 4000; i++) {
  const e = Math.floor(rnd() * 40) - 20;
  const v = (rnd() * 2 - 1) * 10 ** e;
  nums.push(v, f32(v), Math.round(v * 1000) / 1000, f32(v) * 2 - 1);
}
for (let i = 0; i < 500; i++) {
  const b = new DataView(new ArrayBuffer(8));
  b.setUint32(0, (rnd() * 2 ** 32) >>> 0); b.setUint32(4, (rnd() * 2 ** 32) >>> 0);
  const v = b.getFloat64(0);
  if (Number.isFinite(v)) nums.push(v);
}
const bits = (v) => { const b = new DataView(new ArrayBuffer(8)); b.setFloat64(0, v); return b.getBigUint64(0).toString(16).padStart(16, '0'); };
const strings = ['', 'a"b', 'back\\slash', 'tab\tnew\nline\r', '\b\f\u0001\u001f\u007f', 'café', '€',
  '😀', '\ud800', 'x\udc00y', '  ', 'Pvt. Ryan'];
const out = {
  numbers: nums.map((v) => [bits(v), String(v)]),
  strings: strings.map((s) => [[...s].flatMap((c) => [...Array(c.length).keys()].map((i) => c.charCodeAt(i))), JSON.stringify(s)]),
  objects: [[{ k: 's', t: 1.5, a: [1, null, -0, 2.5e-7], u: undefined, n: { x: 1e21 } }, null]],
};
out.objects[0][1] = JSON.stringify(out.objects[0][0]);
fs.writeFileSync(new URL('../core/src/commonTest/resources/parity/js-format.json', import.meta.url), JSON.stringify(out));
console.log(`${out.numbers.length} numbers, ${out.strings.length} strings`);
