// `viewer/recordings-api.js` and the REPLAY feed's links under node (see
// `test_recordings_api.py`): which `?replay=` is a shared recording and on
// which API, the times in a comment, and the addresses the feed hands out.
// The feed's pages, the upload and the replay's comments need a page and an
// API and are checked in one (features/replay-feed, "Verification").

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
globalThis.location = new URL('https://play.bfstats.io/play/index.html?tab=replay');
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [api, feed, { parseRecording }, { recorderName }] = await Promise.all([
  imp('recordings-api.js'), imp('play/recordings-feed.js'), imp('replay-recording.js'), imp('replay-chapters.js'),
]);

const page = new URL('https://play.bfstats.io/map.html');
const local = new URL('http://localhost:5273/map.html');
const results = {};

results.shared = {
  sameOrigin: api.sharedRecordingOf('/stats/recordings/abcdefghjk.ndjson', page.origin),
  absoluteSame: api.sharedRecordingOf('https://play.bfstats.io/stats/recordings/abcdefghjk.ndjson', page.origin),
  localApi: api.sharedRecordingOf('http://localhost:9222/stats/recordings/abcdefghjk.ndjson', local.origin),
  withQuery: api.sharedRecordingOf('/stats/recordings/abcdefghjk.ndjson?x=1', page.origin),
  file: api.sharedRecordingOf('replays/replay_20260927-203459.ndjson', page.origin),
  held: api.sharedRecordingOf('local:replay_20260927-203459', page.origin),
  shortSlug: api.sharedRecordingOf('/stats/recordings/abc.ndjson', page.origin),
  serverLog: api.sharedRecordingOf('/stats/recordings/abcdefghjk.xml', page.origin),
};

results.modes = {
  same: api.apiMode('', page),
  sameExplicit: api.apiMode('https://play.bfstats.io', page),
  local: api.apiMode('http://localhost:9222', local),
  remote: api.apiMode('https://bfstats.io', local),
};

results.runs = api.commentRuns('0:21 get rekt, then 12:40 and 1:02:03 or 12:3 and 20:61', 900);
results.runsPastEnd = api.commentRuns('at 59:00 then 0:30', 600);
results.query = api.readableQuery([['mod', 'bf1942'], ['map', 'midway'], ['replay', 'http://localhost:9222/stats/recordings/abcdefghjk.ndjson'], ['serverlog', null], ['t', 21], ['name', 'a b&c']]);
results.clock = [0, 59.9, 883.029, 3723, -5].map(api.clock);
results.count = [[0, 'view'], [1, 'view'], [2, 'view'], [1234, 'view'], [12500, 'view'], [1e6, 'view'], [3, 'comment']].map(([n, w]) => api.count(n, w));
const now = Date.parse('2026-09-28T12:00:00Z');
results.ago = ['2026-09-28T11:59:58Z', '2026-09-28T11:59:00Z', '2026-09-28T10:00:00Z', '2026-09-25T12:00:00Z', '2026-07-01T00:00:00Z', 'nonsense']
  .map(t => api.ago(t, now));
results.size = [0, 512 * 1024 ** 2, 1.5 * 1024 ** 3, 20 * 1024 ** 3].map(api.size);
// A player's page on bfstats.io, by the name the site has them under: raw,
// escaped for the path (the clan tag's bullets, a slash).
results.playerHref = ['skandia', '=\u2022NDR\u2022=Lapu', 'a/b?c#d'].map(api.playerHref);
results.signIn = {
  play: api.signInHref('https://play.bfstats.io/play/?tab=replay&rec=abcdefghjk', page),
  local: api.signInHref('http://localhost:5273/play/', local),
};

const recording = {
  mod: 'bf1942', level: 'midway', recordingUrl: '/stats/recordings/abcdefghjk.ndjson',
  serverLogUrl: '/stats/recordings/abcdefghjk.xml',
};
results.watch = {
  plain: feed.watchHref(recording, { root: '../' }),
  at: feed.watchHref({ ...recording, serverLogUrl: null }, { root: '../', at: 21.7 }),
  localApi: feed.watchHref(recording, { root: '../', fileUrl: p => `http://localhost:9222${p}` }),
};

// Whom a shared recording goes up under: the recording player as the file
// names him, the same cases api/Recordings/RecordingInspector's tests read.
const lines = (...records) => records.map(r => JSON.stringify(r)).join('\n');
const recorded = text => recorderName(parseRecording(text));
const fixture = name => fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', name), 'utf8');
results.recorder = {
  v2Lab: recorded(fixture('replay_20260915-210619.ndjson')),
  v3Lab: recorded(fixture('replay_20260915-213110.ndjson')),
  roster: recorded(lines(
    { k: 'h', v: 5 },
    { k: 'roster', t: 0, p: [[0, 2, 0, 'Rut', 0], [8, 2, 0, 'skandia', 1], [3, 1, 1, 'Bot', 0]] },
    { k: 'end', t: 60 })),
  ownShots: recorded(lines(
    { k: 'h', v: 5 },
    { k: 'e', t: 1, e: 'createPlayer', pid: 23, name: 'Leaver', team: 1, ai: 0 },
    { k: 'e', t: 2, e: 'createPlayer', pid: 4, name: 'Darko', team: 2, ai: 0 },
    { k: 'e', t: 9, e: 'destroyPlayer', pid: 23 },
    { k: 'e', t: 16.5, e: 'createPlayer', pid: 23, name: 'skandia', team: 1, ai: 0 },
    { k: 'f', t: 18.1, id: 6424, pid: 4, w: 'MG42' },
    { k: 'f', t: 19.2, id: 6425, pid: 23, w: 'Thompson', local: 1 },
    { k: 'end', t: 60 })),
  v3Trigger: recorded(lines(
    { k: 'h', v: 3 },
    { k: 'e', t: 1, e: 'createPlayer', pid: 0, name: 'skandia', team: 1, ai: 0 },
    { k: 'e', t: 1.1, e: 'createPlayer', pid: 1, name: 'Darko', team: 2, ai: 0 },
    { k: 'e', t: 21.2, e: 'fire', pid: 0, kind: 2, weapon: 'USMarineSoldier' },
    { k: 'end', t: 60 })),
  chat: recorded(lines(
    { k: 'h', v: 5 },
    { k: 'e', t: 0, e: 'createPlayer', pid: 13, name: 'Kerem', ai: 0, ago: 3 },
    { k: 'chat', t: 1.7, pid: 13, team: 2, text: 'Kerem: teams' },
    { k: 'f', t: 5, id: 80, pid: 18, w: 'K98', local: 1 },
    { k: 'chat', t: 347.2, pid: 18, team: 2, text: 'skandia: gf' },
    { k: 'end', t: 400 })),
  severalHumans: recorded(lines(
    { k: 'h', v: 2 },
    { k: 'e', t: 1, e: 'createPlayer', pid: 1, name: 'Darko', ai: 0 },
    { k: 'e', t: 5.7, e: 'createPlayer', pid: 0, name: 'skandia', ai: 0 },
    { k: 'end', t: 60 })),
  nobody: recorded(lines({ k: 'h', v: 5 }, { k: 'o', t: 0, id: 1 }, { k: 'end', t: 60 })),
};

// The feed narrowed to a server and an uploader: the API's queries, and the
// page's own address.
const asked = [];
globalThis.fetch = async url => {
  asked.push(String(url));
  return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const client = api.createRecordingsApi({ base: 'https://bfstats.io', mode: 'remote' });
await client.list({ sort: 'views', page: 2, pageSize: 24, server: 'MoonGamers.com | Est. 2004', uploader: '' });
await client.list();
await client.filters({ server: '', uploader: 'a b&c' });
await client.filters();
results.filtered = {
  asked,
  href: feed.feedHref({ server: 'MoonGamers.com | Est. 2004', uploader: 'Rut' }),
  hrefAll: feed.feedHref({ server: '', uploader: '' }),
  of: feed.feedFilterOf(new URLSearchParams('tab=replay&server=+Moon%20Gamers+&uploader=')),
  ofNone: feed.feedFilterOf(new URLSearchParams('tab=replay&rec=abcdefghjk')),
};

// A round several players shared (features/replay-feed, "Rounds"): watched
// merged, one `replay` per recording, the one asked about first; its comments
// moved onto the merged clock, and one written there put on the recording
// whose stretch holds its moment, in that recording's clock.
const lead = { slug: 'bbbbbbbbbb', mod: 'bf1942', level: 'bocage', recordingUrl: '/stats/recordings/bbbbbbbbbb.ndjson', serverLogUrl: null };
const round = [
  { slug: 'aaaaaaaaaa', recordingUrl: '/stats/recordings/aaaaaaaaaa.ndjson', serverLogUrl: '/stats/recordings/aaaaaaaaaa.xml' },
  { ...lead },
  { slug: 'cccccccccc', recordingUrl: '/stats/recordings/cccccccccc.ndjson', serverLogUrl: null },
];
// The merged header's sources for [lead, a, c], as replay-merge.js writes them:
// the lead began 60 s into a's recording, whose clock ran 40 ppm slow.
const sources = [
  { offset: 60, drift: 0, duration: 476 },
  { offset: 0, drift: -4e-5, duration: 506 },
  { offset: 400, drift: 0, duration: 300 },
];
const clockA = api.sourceClock(sources[1]);
results.round = {
  urls: api.replayUrlsOf(new URLSearchParams('mod=bf1942&replay=/stats/recordings/bbbbbbbbbb.ndjson&replay=/stats/recordings/aaaaaaaaaa.ndjson&t=5')),
  one: api.replayUrlsOf(new URLSearchParams('replay=/stats/recordings/bbbbbbbbbb.ndjson')),
  watch: feed.watchRoundHref(lead, round, { root: '../' }),
  watchLocal: feed.watchRoundHref(round[0], round, { root: '../', fileUrl: p => `http://localhost:9222${p}` }),
  roundOf: [feed.roundOf({ round }), feed.roundOf({ round: [lead] }), feed.roundOf({})].map(r => (r ? r.length : null)),
  toRound: Number(clockA.toRound(500).toFixed(3)),
  back: Number(clockA.fromRound(clockA.toRound(123.4)).toFixed(6)),
  // The lead's own `0:21` is 1:21 of the round.
  runs: api.roundRuns('0:21 get rekt, 12:40 past its end', sources[0], 476),
  targets: [
    'no time at all',
    '1:21 in the lead',
    '0:30 before the lead began',
    '9:50 and 10:10 after the lead ended',
    '11:40 in the third only',
    '59:00 in none',
  ].map(text => api.commentTarget(text, sources)),
};

process.stdout.write(JSON.stringify(results));
