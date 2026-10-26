// Writes core/src/test/resources/parity/content-crc.json from the Node
// sidecar's content-crc.mjs: the mode and level name readers, the
// contentCrc32.con parser, the bundled content-crc.json as Node reads it, and
// contentCrc's answers without an install. ContentCrcTest.kt replays them.
//   node parity/content-crc.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SIDECAR, sidecar, write } from './lib/fixture.mjs';

const C = await sidecar('content-crc.mjs');
const out = {};
out.gpm = ['conquest.con', 'coop.con', 'CTF.con', 'tdm.con', 'ObjectiveMode.con', 'other.con', 'conquest', ' conquest.con', 'conquest.con.con', '', null, 'TDM.CON']
  .map((m) => [m, C.gpmFor(m)]);
out.level = ['bf1942/levels/market_garden/', 'XPack1\\Levels\\Anzio', '', null, 'wake', '//a//b//', 'a\\/b'].map((l) => [l, C.levelName(l)]);
out.parse = [
  'game.addContentCrc32 XPack1 Anzio GPM_CQ 2747151060\r\ngame.addContentCrc32 XPack1 Anzio GPM_CQ 7\n// x\n',
  '  GAME.ADDCONTENTCRC32\tBF1942  Wake  GPM_COOP  99999999999 trailing\n\ngame.addContentCrc32 a b c\ngame.addContentCrc32 a b c -5\n',
  'game.addContentCrc32 a b c 0123 \ngame.addContentCrc32 a b c 18446744073709551617\ngame.addContentCrc32 M L G 4294967296\n',
  '',
].map((t) => ({ text: t, out: Object.fromEntries(C.parseContentCrc32(t)) }));
// The table as content-crc.mjs bundles it (the Kotlin resource must match).
out.bundled = JSON.parse(fs.readFileSync(new URL('content-crc.json', SIDECAR), 'utf8')).rows;
const noInstall = path.join(os.tmpdir(), 'no-such-bf1942-install');
const quiet = console.warn; console.warn = () => {};
const cases = [
  { mod: 'bf1942', mapId: 'BF1942', levelPath: 'bf1942/levels/market_garden/', modeFile: 'conquest.con' },
  { mod: 'bf1942', mapId: 'BF1942', levelPath: 'bf1942/levels/no_such_level/', modeFile: 'conquest.con' },
  { mod: 'xpack2', mapId: 'XPack2', levelPath: 'xpack2/levels/peenemunde/', modeFile: 'conquest.con' },
  { mod: 'xpack1', mapId: '', levelPath: 'XPack1\\Levels\\Anzio', modeFile: 'Conquest.con' },
  { mod: 'BF1942', levelPath: 'bf1942/levels/Wake/', modeFile: 'coop.con' },
  { levelPath: 'bf1942/levels/wake/', modeFile: 'ctf.con' },
  { mod: 'bf1942', mapId: 'BF1942', levelPath: 'bf1942/levels/wake/', modeFile: 'weird.con' },
  { mod: 'bf1942', mapId: 'BF1942', levelPath: '', modeFile: 'conquest.con' },
  { mod: 'gcmod', mapId: 'GCMOD', levelPath: 'gcmod/levels/x/', modeFile: 'objectivemode.con' },
];
out.lookups = cases.flatMap((c) => [
  { in: c, dir: null, bundled: true, out: C.contentCrc(c, { dir: null }) },
  { in: c, dir: 'none', bundled: true, out: C.contentCrc(c, { dir: noInstall }) },
  { in: c, dir: 'none', bundled: false, out: C.contentCrc(c, { dir: noInstall, bundled: false }) },
]);
console.warn = quiet;
write('content-crc', out);
