// `viewer/recorder-update.js` under node (see `test_recorder_update.py`): which
// recording headers come from a BF42++ older than the newest release.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { installModuleHooks, viewerDir } from '../sim/env.mjs';

const viewer = viewerDir();
installModuleHooks(viewer);
const m = await import(pathToFileURL(path.join(viewer, 'recorder-update.js')).href);

const header = extra => ({ k: 'h', v: 5, plus: '2.0', start: '2026-11-06T22:14:59', hz: 10, ...extra });
const blob = text => ({ slice: () => ({ text: async () => text }) });

const results = {
  // pqjc9t92fb: written by a build from before the stamp existed.
  noStamp: m.recorderStatus(header()),
  released: m.recorderStatus(header({ build: 'Oct 18 2026 13:34:34' })),
  sameDayEarlier: m.recorderStatus(header({ build: 'Oct 18 2026 01:00:00' })),
  dayBefore: m.recorderStatus(header({ build: 'Oct 17 2026 23:59:59' })),
  newer: m.recorderStatus(header({ build: 'Nov  5 2026 09:00:00' })),
  unreadableStamp: m.recorderStatus(header({ build: 'git-abc123' })),
  server: m.recorderStatus(header({ plus: 'server-replay-recorder/3' })),
  notHeader: m.recorderStatus({ k: 'e' }),
  nothing: m.recorderStatus(null),
  day: m.buildDay('Nov  5 2026 09:00:00'),
  dayBad: m.buildDay('Foo 5 2026'),
  read: await m.readHeader(blob('{"k":"h","v":5,"plus":"2.0"}\n{"k":"e"}\n')),
  readBad: await m.readHeader(blob('not json')),
  latest: { tag: m.LATEST.tag, fixes: m.LATEST.fixes.length, dll: m.LATEST.dll, release: m.LATEST.release },
  // Without a page there is nothing to show.
  shownWithoutDocument: await m.remindToUpdate([blob('{"k":"h","plus":"2.0"}')]),
};
process.stdout.write(JSON.stringify(results));
