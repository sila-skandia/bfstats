// Writes core/src/commonTest/resources/parity/content-crc.json from the Node
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

// A fake install: each mod's own contentCrc32.con (any case), the server's
// mod looked up first, then the others in name order, then the bundled
// table. A fresh module instance (empty caches), as the Kotlin test's after
// resetContentCrc(); the tree is in the fixture for the test to build.
const I = await import(new URL('content-crc.mjs?install', SIDECAR).href);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'content-install-'));
const tree = [
  ['Mods/BF1942/ContentCrc32.CON', 'game.addContentCrc32 BF1942 wake GPM_COOP 11\r\ngame.addContentCrc32 BF1942 wake GPM_COOP 12\r\ngame.addContentCrc32 BF1942 market_garden GPM_CQ 13\r\n'],
  ['Mods/XPack1/contentcrc32.con', 'game.addContentCrc32 XPack1 anzio GPM_CQ 21\ngame.addContentCrc32 BF1942 wake GPM_COOP 22\n'],
  ['Mods/Custom/contentCrc32.con', 'game.addContentCrc32 Custom secret GPM_TDM 31\ngame.addContentCrc32 BF1942 wake GPM_COOP 32\n'],
  ['Mods/Latin/contentCrc32.con', 'game.addContentCrc32 Latin caf\u00e9 GPM_CTF 41\n'],
  ['Mods/NoFile/'],
  ['Mods/Dir/contentCrc32.con/'],
  ['Mods/zz.txt', 'a file, not a mod'],
];
for (const [rel, text] of tree) {
  const p = path.join(root, rel);
  if (text == null) fs.mkdirSync(p, { recursive: true });
  else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(text, 'latin1')); }
}
out.installTree = tree;
const warns = [];
console.warn = (m) => warns.push(String(m).split(root).join('<dir>'));
const icases = [
  { mod: 'bf1942', mapId: 'BF1942', levelPath: 'bf1942/levels/wake/', modeFile: 'coop.con' },
  { mod: 'xpack1', mapId: 'BF1942', levelPath: 'bf1942/levels/wake/', modeFile: 'coop.con' },
  { mod: 'custom', mapId: 'BF1942', levelPath: 'bf1942/levels/wake/', modeFile: 'coop.con' },
  { mod: 'CUSTOM', mapId: 'Custom', levelPath: 'custom/levels/secret/', modeFile: 'tdm.con' },
  { mod: 'xpack1', mapId: 'XPack1', levelPath: 'XPack1/Levels/Anzio/', modeFile: 'conquest.con' },
  { mod: 'latin', mapId: 'Latin', levelPath: 'latin/levels/Caf\u00e9/', modeFile: 'ctf.con' },
  { mod: 'bf1942', mapId: 'BF1942', levelPath: 'bf1942/levels/market_garden/', modeFile: 'conquest.con' },
  { mod: 'bf1942', mapId: 'BF1942', levelPath: 'bf1942/levels/el_alamein/', modeFile: 'conquest.con' },
  { mod: 'nofile', mapId: 'NoFile', levelPath: 'nofile/levels/x/', modeFile: 'conquest.con' },
  { mod: 'bf1942', mapId: 'BF1942', levelPath: 'bf1942/levels/wake/', modeFile: 'coop.con\n' },
  { mod: 'bf1942', mapId: 'BF1942', levelPath: 'bf1942/levels/wake/', modeFile: 'weird.con' },
  { mod: '', mapId: '', levelPath: 'bf1942/levels/wake/', modeFile: 'coop.con' },
];
out.install = icases.flatMap((c) => [
  { in: c, dir: '', bundled: true, out: I.contentCrc(c, { dir: root }), warns: warns.splice(0) },
  { in: c, dir: '', bundled: false, out: I.contentCrc(c, { dir: root, bundled: false }), warns: warns.splice(0) },
]);
// A rewritten file is read again (its mtime moves).
const later = new Date(Date.now() + 5000);
fs.writeFileSync(path.join(root, 'Mods/BF1942/ContentCrc32.CON'), 'game.addContentCrc32 BF1942 wake GPM_COOP 99\n');
fs.utimesSync(path.join(root, 'Mods/BF1942/ContentCrc32.CON'), later, later);
out.installRewrite = { file: 'Mods/BF1942/ContentCrc32.CON', text: 'game.addContentCrc32 BF1942 wake GPM_COOP 99\n',
  out: I.contentCrc(icases[0], { dir: root }) };
console.warn = quiet;
fs.rmSync(root, { recursive: true, force: true });
// gpmFor's `$`: the end of the input, not before a final newline.
out.gpmNewline = ['conquest.con\n', 'coop.con\r\n', 'ctf.con\n\n', 'tdm.con \n'].map((m) => [m, C.gpmFor(m)]);
write('content-crc', out);
