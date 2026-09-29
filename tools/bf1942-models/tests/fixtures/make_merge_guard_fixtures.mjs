// Cut the merge guard's fixtures out of the first real recordings shared to
// the REPLAY feed (features/round-replay-merge, "The guard"):
//
//   node tools/bf1942-models/tests/fixtures/make_merge_guard_fixtures.mjs \
//     kqqaqxdwtr.ndjson nj2dyh58te.ndjson replay_20260929-063300.ndjson
//
// - kqqaqxdwtr: skandia's public Bocage round of 2026-09-28 (536 s,
//   replay_20260928-133433 on this PC), https://play.bfstats.io/stats/recordings/kqqaqxdwtr.ndjson
// - nj2dyh58te: Instant Replay's whole Bocage round of 2026-09-29 (2732 s),
//   https://play.bfstats.io/stats/recordings/nj2dyh58te.ndjson
// - replay_20260929-063300: skandia's 21.5 min of that same round (Axis).
//
// The first two are two rounds an admin linked by hand; the last two are one
// round. The guard reads the events only, so only they are kept: every event
// but a recording player's own (his trigger presses, hits and refills), from
// the file's opening (its join) and from the stretch the fixture keeps, which
// ends with the file's `end`. No pose, no part, no chat-box line.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const [kq, nj, own] = process.argv.slice(2);
if (!kq || !nj || !own) {
  console.error('usage: make_merge_guard_fixtures.mjs <kqqaqxdwtr.ndjson> <nj2dyh58te.ndjson> <replay_20260929-063300.ndjson>');
  process.exit(2);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const OWN = new Set(['fire', 'hitFrom', 'special']);

/** `file`'s header, its opening (to its dbComplete and a second more), its
 *  events in `[from, to]`, and an `end` at `to`. */
function cut(file, from, to, name) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = [];
  let joined = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (r.k === 'h') {
      out.push(line);
      continue;
    }
    if (r.k !== 'e' || OWN.has(r.e)) continue;
    if (r.e === 'dbComplete' && joined === null && r.ago === undefined) joined = r.t;
    const opening = joined === null || r.t <= joined + 1;
    if (opening || (r.t >= from && r.t <= to)) out.push(line);
  }
  out.push(JSON.stringify({ k: 'end', t: to }));
  const text = `${out.join('\n')}\n`;
  const target = path.join(here, name);
  fs.writeFileSync(target, zlib.gzipSync(text, { level: 9 }));
  console.log(`${target}: ${out.length} lines, ${(text.length / 1024).toFixed(0)} KB, ${(fs.statSync(target).size / 1024).toFixed(0)} KB gzipped`);
}

// kqqaqxdwtr whole; nj2dyh58te from 1370 s to 1930 s, which holds the stretch
// the merge once fitted kqqaqxdwtr onto (1377.5 s on) and, 791.2 s after the
// start of skandia's 2026-09-29 file, that file's 580 s to 1135 s.
cut(kq, 0, 536.317, 'merge_guard_kqqaqxdwtr.ndjson.gz');
cut(nj, 1370, 1930, 'merge_guard_nj2dyh58te_1370-1930.ndjson.gz');
cut(own, 580, 1135, 'merge_guard_20260929-063300_580-1135.ndjson.gz');
