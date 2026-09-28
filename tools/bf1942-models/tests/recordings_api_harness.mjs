// `viewer/recordings-api.js` and the REPLAY feed's links under node (see
// `test_recordings_api.py`): which `?replay=` is a shared recording and on
// which API, the times in a comment, and the addresses the feed hands out.
// The feed's pages, the upload and the replay's comments need a page and an
// API and are checked in one (features/replay-feed, "Verification").

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
globalThis.location = new URL('https://play.bfstats.io/play/index.html?tab=replay');
const imp = name => import(pathToFileURL(path.join(viewer, name)).href);
const [api, feed] = await Promise.all([imp('recordings-api.js'), imp('play/recordings-feed.js')]);

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

process.stdout.write(JSON.stringify(results));
