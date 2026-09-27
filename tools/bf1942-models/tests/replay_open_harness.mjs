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
const [open, { parseRecording }] = await Promise.all([imp('replay-open.js'), imp('replay-recording.js')]);
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

process.stdout.write(JSON.stringify(results));
