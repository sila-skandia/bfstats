// Writes core/src/test/resources/parity/player-name.json: validPlayerName over
// names a page sends, spaces JS's trim removes (and the ones it keeps),
// control characters, quotes, latin1's edge, surrogates, and long names, as
// UTF-16 code units so the Kotlin test builds the same strings.
//   node parity/player-name.mjs
import fs from 'node:fs';
import { validPlayerName, SERVER_NAME_BYTES } from '../../bf1942-models/sidecar/player-name.mjs';
import { rng } from './lib/fake-time.mjs';

const names = ['', ' ', 'Pvt. Ryan', '  padded  ', 'a"b', 'tab\tinside', 'line\nfeed', 'café', 'Zoë', '€uro', 'ÿ', 'Ā',
  '😀', '\ud800', 'x'.repeat(23), 'x'.repeat(24), 'abcdefghijklmnopqrstuv w', 'abcdefghijklmnopqrstuv w',
  ' nbsp ', '﻿bom', ' em ', '　ideo', ' ogham', ' ls', ' mm', ' nn',
  '\u001cfs', '\u0085nel', ' ', '\u000bvt', '\u007fdel', '\u009fapc', '¡', 'name_1', '[TAG]Player'];
const rand = rng(7);
const pool = [0x20, 0x41, 0x7a, 0x22, 0x09, 0x0a, 0x1c, 0x1f, 0x7f, 0x85, 0x9f, 0xa0, 0xe9, 0xff, 0x100, 0x2003, 0x3000, 0xfeff, 0xd83d];
for (let i = 0; i < 400; i++) {
  const n = Math.floor(rand() * 30);
  let s = '';
  for (let j = 0; j < n; j++) s += String.fromCharCode(rand() < 0.7 ? 0x61 + Math.floor(rand() * 26) : pool[Math.floor(rand() * pool.length)]);
  names.push(s);
}
const units = (s) => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));
const out = {
  serverNameBytes: SERVER_NAME_BYTES,
  strings: names.map((s) => [units(s), validPlayerName(s)]),
  nonStrings: [[5, validPlayerName(5)], [null, validPlayerName(null)], [true, validPlayerName(true)]],
};
fs.writeFileSync(new URL('../core/src/test/resources/parity/player-name.json', import.meta.url), JSON.stringify(out));
console.log(`${out.strings.length} names`);
