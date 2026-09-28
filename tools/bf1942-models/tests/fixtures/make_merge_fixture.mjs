// Cut the merge tests' fixture out of a real round (features/round-replay-merge):
//
//   node tools/bf1942-models/tests/fixtures/make_merge_fixture.mjs \
//     "$HOME/.wine/drive_c/EA Games/Battlefield 1942/replays/replay_20260928-133433.ndjson" 350 385
//
// writes `merge_bocage_350-385.ndjson.gz` beside this script: 35 s of the
// public Bocage round of 2026-09-28 (34 players), everything its recording
// player's client had, as a file begun mid-round would hold it (the join's
// events, the players, the standing objects, pools and kits with `ago`, and a
// roster). The tests split it by side and merge the halves back.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { indexRecording, splitRecording } from '../replay_split.mjs';

const [file, from, to] = process.argv.slice(2);
if (!file || !from || !to) {
  console.error('usage: make_merge_fixture.mjs <recording> <from> <to>');
  process.exit(2);
}
const rec = indexRecording(fs.readFileSync(file, 'utf8'));
// Everything the recording had: its own player, and no range limit.
const { text } = splitRecording(rec, { player: rec.local, radius: Infinity, from: Number(from), to: Number(to) });
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), `merge_bocage_${from}-${to}.ndjson.gz`);
fs.writeFileSync(out, zlib.gzipSync(text, { level: 9 }));
console.log(`${out}: ${(text.length / 1024).toFixed(0)} KB, ${(fs.statSync(out).size / 1024).toFixed(0)} KB gzipped`);
