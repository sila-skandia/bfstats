// The round-detection tests' fixtures (features/replay-feed, "Rounds"): real recordings cut
// down to what a round fingerprint reads, so a test can share them as the feed would.
//
//   node tests/api/Recordings/Fixtures/rounds/make_round_fixtures.mjs
//
// A recording keeps its header, its events, its chat-box lines, its roster, the recording
// player's own first rounds (so the API still finds who recorded it) and its end; the
// samples, parts, engines, bodies, flags and tickets, which a fingerprint never reads, go.
//
// - bocage-a / bocage-b: the public Bocage round of 2026-09-28 (replay_20260928-133433, 34
//   players, 536 s) split by side as features/round-replay-merge measures it: A the original's
//   own player from the join, stopping 30 s early; B the Axis player it had in range longest,
//   begun 60 s in (held `ago` records and a roster), its clock 40 ppm fast, its events up to
//   30 ms off.
// - bocage-other: the first 600 s of another Bocage round on the same server, the next day
//   (replay_20260929-063300).
// - wake-001120 / wake-075756: two different co-op rounds of Wake on the lab server
//   (features/replay-feed names them as the pair that must not match).
//
// The originals are on the owner's PC; the tests read these.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../..');
const { indexRecording, splitRecording, playerAt } = await import(path.join(repo, 'tools/bf1942-models/tests/replay_split.mjs'));

const home = process.env.HOME ?? '';
const REPLAYS = path.join(home, '.wine/drive_c/EA Games/Battlefield 1942/replays');
const LAB = path.join(home, 'bf1942-lab/runs');

const KEEP = new Set(['h', 'e', 'chat', 'roster', 'end']);

/** The lines a fingerprint reads, and the recording player's first own rounds. */
function cut(text, { to = Infinity } = {}) {
  const out = [];
  let own = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof r.t === 'number' && r.t > to) {
      if (r.k === 'end') out.push(JSON.stringify({ ...r, t: to }));
      continue;
    }
    if (KEEP.has(r.k) || (r.k === 'f' && r.local && own++ < 3)) out.push(line.trim());
  }
  if (!out.some(l => l.startsWith('{"k":"end"'))) out.push(JSON.stringify({ k: 'end', t: to }));
  return `${out.join('\n')}\n`;
}

function write(name, text) {
  const file = path.join(here, `${name}.ndjson.gz`);
  fs.writeFileSync(file, zlib.gzipSync(text, { level: 9 }));
  console.log(`${name}: ${(text.length / 1024).toFixed(0)} KB, ${(fs.statSync(file).size / 1024).toFixed(0)} KB gzipped`);
}

/** The enemy the original had in range longest (tests/replay_merge_harness.mjs `enemyOf`,
 *  sampled every 2 s). */
function enemyOf(rec) {
  const side = playerAt(rec, rec.local, rec.end)?.[1];
  let best = null;
  for (const pid of rec.players.keys()) {
    let seconds = 0;
    for (let t = 0; t < rec.end; t += 2) {
      const e = playerAt(rec, pid, t);
      if (e && e[1] !== side) seconds += 2;
    }
    if (!best || seconds > best.seconds) best = { pid, seconds };
  }
  return best.pid;
}

const bocage = indexRecording(fs.readFileSync(path.join(REPLAYS, 'replay_20260928-133433.ndjson'), 'utf8'));
const enemy = enemyOf(bocage);
write('bocage-a', cut(splitRecording(bocage, { player: bocage.local, radius: 420, from: 0, to: bocage.end - 30 }).text));
write('bocage-b', cut(splitRecording(bocage, {
  player: enemy, radius: 420, from: 60, to: bocage.end, drift: 40e-6, jitter: 0.03, seed: 7,
}).text));
write('bocage-other', cut(fs.readFileSync(path.join(REPLAYS, 'replay_20260929-063300.ndjson'), 'utf8'), { to: 600 }));
write('wake-001120', cut(fs.readFileSync(path.join(LAB, '20260927-000617-wake-coop/client/replay_20260927-001120.ndjson'), 'utf8')));
write('wake-075756', cut(fs.readFileSync(path.join(LAB, '20260927-075736-wake-coop/client/replay_20260927-075756.ndjson'), 'utf8')));
