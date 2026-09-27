// `viewer/replay-open.js` under node: what the page reads of a recording
// before its level loads, and how it names one it keeps (see
// `test_replay_open.py`). The modules are imported from the viewer tree in
// place through `sim/env.mjs`'s hooks, so the files under test are the files
// the page loads. The picker, the drop and the browser's store need a page
// and are checked in one (features/round-replay-ux, "Opening a recording").

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [open, { parseRecording, speakerOf }, level, { recordingPlayer }, assets] = await Promise.all([
  imp('replay-open.js'), imp('replay-recording.js'), imp('replay-level.js'), imp('replay-chapters.js'),
  imp('replay-assets.js'),
]);
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const summarize = text => open.recordingSummary(parseRecording(text));
const results = {};

results.recordedAt = {
  minutes: open.recordedAt('2026-09-27T14:09:21'),
  seconds: open.recordedAt('2026-09-27T14:09:21', { seconds: true }),
  midnight: open.recordedAt('2026-01-03T00:05:00'),
  empty: open.recordedAt(''),
  missing: open.recordedAt(undefined),
  garbage: open.recordedAt('yesterday'),
  badMonth: open.recordedAt('2026-13-01T10:00:00'),
};

// v2 and v3 files carry the server's info and the level as raw events
// (0x1A, 0x1B, 0x36); v4 on writes them as named ones.
results.v2 = summarize(fs.readFileSync(path.join(fixtures, 'replay_20260915-210619.ndjson'), 'utf8'));
results.v3 = summarize(fs.readFileSync(path.join(fixtures, 'replay_20260915-213110.ndjson'), 'utf8'));
const named = [
  '{"k":"h","v":5,"plus":"99.0.0-0-g9451721","start":"2026-09-27T14:09:21","hz":10}',
  '{"k":"e","t":0.000,"e":"serverName","name":"MoonGamers.com | Est. 2004"}',
  '{"k":"e","t":0.000,"e":"serverInfo","mapId":"BF1942","mod":"XPack1","gameId":"BF1942"}',
  '{"k":"e","t":0.460,"e":"setLevel","level":"bf1942/levels/anzio/","mode":"coop.con"}',
  '{"k":"s","t":12.5,"o":[]}',
].join('\n');
results.v5 = summarize(named);
results.note = open.loadingNote(results.v5);
results.noteBare = open.loadingNote({ start: '', server: '' });

results.titled = ['el_alamein', 'WAKE ISLAND', 'kursk', 'Battle_of_the_Bulge'].map(open.titled);

results.keys = [
  'replay_20260927-140921.ndjson', 'REPLAY_1.NDJSON', 'my round (2).ndjson', '.ndjson', 'a/b\\c.ndjson',
].map(open.keyFor);

const href = open.replayHref('replay_20260927-140921', 'bf1942', 'Kursk', '?map=wake&team=1&mode=coop&dev=1&room=abc');
const url = new URL(href);
results.href = {
  path: url.pathname.split('/').pop(),
  search: url.search,
  params: Object.fromEntries(url.searchParams),
};
results.local = [open.isLocalReplay('local:replay_1'), open.isLocalReplay('replays/replay_1.ndjson'), open.isLocalReplay(null)];

// A shared link (features/gameplay-recordings) names the file alone; the page
// came up in whichever mod the visitor browsed last.
const PLAY = 'https://play.bfstats.io/map.html';
const SHARED = `${PLAY}?replay=replays/replay_20260927-140921.ndjson&serverlog=replays/ev_14567-20260927_1409.xml`;
const MAPS = [{ id: 'bf1942' }, { id: 'xpack1' }, { id: 'dc' }];
const ownMod = (href, mod, current) => open.ownModHref(href, { mod }, current, MAPS);
results.ownMod = {
  remembered: await ownMod(SHARED, 'bf1942', 'dc'),
  pack: await ownMod(SHARED, 'XPack1', 'bf1942'),
  already: await ownMod(SHARED, 'bf1942', 'bf1942'),
  named: await ownMod(`${SHARED}&mod=dc`, 'bf1942', 'dc'),
  held: await ownMod(`${PLAY}?replay=local:replay_1`, 'bf1942', 'dc'),
  unnamed: await ownMod(SHARED, '', 'dc'),
  noMaps: await ownMod(SHARED, 'FHSW', 'bf1942'),
  noReplay: await ownMod(`${PLAY}?map=wake`, 'bf1942', 'dc'),
};

// --- a recording begun after the join ----------------------------------------
//
// replay_20260927-190946 was switched on 20 s into a Tobruk round: no
// setLevel, serverInfo or serverName, and no createPlayer for anyone already
// playing. Its seven flags are these (the recorder's `cp`, BF1942's frame);
// the names and the chat below are made up.
const TOBRUK_CP = [
  ['British_Base', 'ALLIES_BASE', 2546.28, 69.65, 817.94, 2],
  ['2nd_Line_Bunker', 'ALLIES_BASE_SECONDLINE_right', 2233.68, 73.73, 717.59, 2],
  ['2nd_Line_Bunker', 'ALLIES_BASE_SECONDLINE_left', 2217.26, 78.66, 842.97, 2],
  ['1st_Line_Bunker', 'ALLIES_BASE_FIRSTLINE_right', 2083.90, 69.27, 612.07, 2],
  ['1st_Line_Bunker', 'ALLIES_BASE_FIRSTLINE_middle', 2038.04, 71.58, 724.31, 2],
  ['1st_Line_Bunker', 'ALLIES_BASE_FIRSTLINE_left', 1976.10, 80.51, 841.52, 2],
  ['German_Base', 'AXIS_BASE', 1743.65, 67.14, 572.87, 1],
];
const cpLines = (moved = {}) => TOBRUK_CP.map(([name, tmpl, x, y, z, team], i) => JSON.stringify({
  k: 'cp', t: 0, id: 3184 + 2 * i, name, tmpl, pos: [x + (moved[i] ?? 0), y, z], team,
}));
const midRound = extra => [
  '{"k":"h","v":5,"plus":"2.0","start":"2026-09-27T19:09:46","hz":10}',
  '{"k":"o","t":0.000,"id":620,"gid":1,"tmpl":"BritishSoldier","tid":1,"team":2}',
  '{"k":"p","t":0.000,"p":[[11,2,620,620,0,0],[3,1,700,700,0,0],[255,2,701,701,0,0],[18,2,702,702,0,0]]}',
  ...cpLines(),
  ...extra,
  '{"k":"e","t":2.000,"e":"score","kind":7,"pid":11,"victim":3,"weapon":0,"bodypart":0}',
  '{"k":"e","t":1.729,"e":"chat","pid":11,"first":1,"global":0,"server":0,"total":5,"text":"teams"}',
  '{"k":"chat","t":1.729,"pid":11,"team":2,"text":"Sir Real: teams"}',
  '{"k":"chat","t":8.899,"pid":-1,"team":0,"text":"*Welcome\u0080to\u0080the\u0080server"}',
  '{"k":"chat","t":38.029,"pid":11,"team":2,"text":"Sir Real [allies]: on me"}',
  '{"k":"chat","t":40.569,"pid":3,"team":1,"text":"Tim [axis]: flag: now"}',
  '{"k":"f","t":66.930,"id":702,"pid":18,"w":"GrenadeAllies","p":[0,0,0],"d":[0,0,1],"local":1}',
  '{"k":"end","t":407.979}',
].join('\n');

const bare = parseRecording(midRound([]));
const who = rec => Object.fromEntries([...rec.players].map(([pid, p]) => [pid, { name: p.name ?? null, team: p.team, ai: p.ai, local: Boolean(p.local) }]));
results.midRound = {
  summary: open.recordingSummary(bare),
  players: who(bare),
  rows: bare.events.filter(e => e.kind === 'spawn').map(e => e.text),
  recordingPid: recordingPlayer(bare),
};

// Since bf42plus ea600c1 such a file opens with the join's events (each with
// "ago") and a roster.
const held = parseRecording(midRound([
  '{"k":"e","t":0.000,"e":"serverInfo","mapId":"BF1942","mod":"bf1942","gameId":"BF1942","ago":18.702}',
  '{"k":"e","t":0.000,"e":"serverName","name":"MoonGamers.com | Est. 2004","ago":18.702}',
  '{"k":"e","t":0.000,"e":"setLevel","level":"bf1942/levels/Tobruk/","mode":"conquest.con","ago":18.251}',
  '{"k":"roster","t":0.000,"p":[[11,2,0,"Sir Real",0],[3,1,0,"Tim",0],[255,2,1,"James Bamber",0],[18,2,0,"Recorder",1]]}',
]));
results.held = {
  summary: open.recordingSummary(held),
  players: who(held),
  recordingPid: recordingPlayer(held),
};
results.speakers = ['Name: hi', 'Name [allies]: hi', 'Name [Axis]: a: b', 'That\'s SIR to You: lol', '*Welcome',
  ': nobody', 'no colon', '', null].map(speakerOf);

// The level it was recorded on, from its flags. Three vanilla levels and a
// pack that inherits one of them; every scene read is counted.
const sceneOf = points => ({ controlPoints: points.map(([name, x, y, z]) => ({ name, position: [x, y, -z] })) });
const SCENES = {
  aberdeen: sceneOf([['ALLIES_BASE', 900, 70, 800]]),
  tobruk: { controlPoints: [], modes: { Conquest: sceneOf(TOBRUK_CP.map(([, tmpl, x, y, z]) => [tmpl, x, y, z])) } },
  el_alamein: sceneOf([['ALLIES_BASE', 2546.28, 69.65, 900], ['AXIS_BASE', 1743.65, 67.14, 572.87]]),
  anzio: sceneOf([['ALLIES_BASE', 2546.28, 69.65, 817.94]]),
};
const vanilla = { id: 'bf1942', name: 'Battlefield 1942' };
const rtr = { id: 'xpack1', name: 'The Road to Rome' };
const eod = { id: 'eod', name: 'Eve of Destruction' };
const entry = (name, worldSize) => ({ name, worldSize, report: `${name.toLowerCase()}/scene.json` });
const vanillaLevels = [entry('Aberdeen', 1024), entry('El_Alamein', 4096), entry('Tobruk', 4096)];
const rtrLevels = [entry('Anzio', 4096), entry('Tobruk', 4096)];
async function recognise(rec, trees, options) {
  const reads = [];
  const found = await level.recogniseLevel(rec, trees, async (mod, e) => {
    reads.push(`${mod.id}/${e.name}`);
    return SCENES[e.name.toLowerCase()] ?? null;
  }, options);
  return { found: found && { mod: found.mod.id, level: found.entry.name, matched: found.matched, of: found.of }, reads: reads.sort() };
}
const moved = extra => parseRecording(`${cpLines(extra).join('\n')}\n`);
results.recognise = {
  tobruk: await recognise(bare, [{ mod: vanilla, levels: vanillaLevels }, { mod: rtr, levels: rtrLevels }]),
  packFirst: await recognise(bare, [{ mod: rtr, levels: rtrLevels }, { mod: vanilla, levels: vanillaLevels }]),
  // Nothing of vanilla's family in another mod is skipped for a name.
  otherMod: await recognise(bare, [{ mod: eod, levels: [entry('Tobruk', 4096)] }, { mod: vanilla, levels: vanillaLevels }]),
  oneMoved: await recognise(moved({ 3: 50 }), [{ mod: vanilla, levels: vanillaLevels }]),
  threeMoved: await recognise(moved({ 1: 50, 3: 50, 5: 50 }), [{ mod: vanilla, levels: vanillaLevels }]),
  tie: await recognise(moved({ 3: 50 }), [{ mod: vanilla, levels: vanillaLevels }, { mod: eod, levels: [entry('Tobruk', 4096)] }]),
  overBudget: await recognise(bare, [{ mod: vanilla, levels: vanillaLevels }], { most: 1 }),
  noFlags: await recognise(parseRecording('{"k":"h","v":5}\n'), [{ mod: vanilla, levels: vanillaLevels }]),
};
results.levelFlags = level.levelFlags(SCENES.tobruk).slice(0, 1);

// A replayed hull in the level's own paint.
const texture = name => ({ name });
const node = (...maps) => ({ material: maps.map(m => ({ map: m })) });
const tree = nodes => ({ traverse: fn => nodes.forEach(fn) });
const africa = texture('texture/Africa/sherma_i.dds');
const levelRoot = tree([
  node(africa, texture('texture/tankhatch_h.dds')),
  node(texture('bf1942/levels/Tobruk/Textures/palm_c.dds')),
  node(null),
]);
const skins = assets.levelSkins(levelRoot);
const hull = [node(texture('texture/Sherma_I.dds'), texture('texture/tankhatch_h.dds')),
  node(texture('bf1942/levels/Kasserine_Pass/AltTextures/sherma_i.dds'))];
const changed = assets.wearLevelSkin(tree(hull), skins);
results.skins = {
  keys: [...skins.keys()].sort(),
  changed,
  hull: hull.flatMap(n => n.material.map(m => m.map?.name ?? null)),
  sameTexture: hull[0].material[0].map === africa,
};
const replayAssets = new assets.ReplayAssets({ modelsBase: 'models', bust: () => '', levelName: () => '' });
replayAssets.cataloguePromise = Promise.resolve([{
  name: 'Sherman', configuration: 'complex', variants: [
    { glb: 'Sherman.glb', level: null, configuration: 'complex' },
    { glb: 'Sherman.Kasserine_Pass.glb', level: 'Kasserine_Pass', configuration: 'complex' },
    { glb: 'Sherman.wreck.glb', level: null, configuration: 'wreck' },
    { glb: 'Sherman.wreck.Kasserine_Pass.glb', level: 'Kasserine_Pass', configuration: 'wreck' },
    { glb: 'Sherman.cockpit.Kasserine_Pass.glb', level: 'Kasserine_Pass', configuration: 'complex', firstPerson: true },
  ],
}]);
results.modelFiles = await Promise.all([
  ['Sherman', 'kasserine_pass'], ['Sherman.wreck', 'kasserine_pass'], ['Sherman', 'tobruk'], ['Sherman', ''],
  ['Tiger', 'kasserine_pass'],
].map(([name, at]) => replayAssets.modelFile(name, at)));

process.stdout.write(JSON.stringify(results));
