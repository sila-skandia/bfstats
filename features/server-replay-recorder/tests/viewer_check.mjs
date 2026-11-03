// A server recording as the replay viewer reads it: nothing skipped, the
// shots, hits, impacts, flights and hit directions all parsed, and the
// Accuracy board taking each tallied player from the server's own tally.
//
//   node tests/viewer_check.mjs replay.ndjson
//
// Exit 1 on any failure.
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const viewer = resolve(dirname(fileURLToPath(import.meta.url)), '../../../tools/bf1942-models/viewer');
const { parseRecording } = await import(pathToFileURL(`${viewer}/replay-recording.js`));
const { accuracyBoard } = await import(pathToFileURL(`${viewer}/replay-accuracy.js`));

const file = process.argv[2];
const text = readFileSync(file, 'utf8');
const rec = parseRecording(text);
const count = (k) => (text.match(new RegExp(`"k":"${k}"`, 'g')) || []).length;
const fails = [];

if (rec.skipped) fails.push(`${rec.skipped} lines skipped`);
const want = { f: count('f'), hg: count('hg'), i: count('i') };
if (rec.fires.length < want.f) fails.push(`${rec.fires.length} fires parsed of ${want.f} f lines`);
if (rec.hitsGiven.length !== want.hg) fails.push(`${rec.hitsGiven.length} hits given of ${want.hg} hg lines`);
if (rec.impacts.length !== want.i) fails.push(`${rec.impacts.length} impacts of ${want.i} i lines`);
if (count('pn') && !rec.flights.length) fails.push('pn lines, and no flights');
const hitFrom = (text.match(/"e":"hitFrom"/g) || []).length;
if (hitFrom && (rec.hitsTaken?.length ?? 0) !== hitFrom) fails.push(`${rec.hitsTaken?.length ?? 0} hits taken of ${hitFrom} hitFrom`);

const board = accuracyBoard(rec);
// A player whose tally has only `destroyed` rows has no accuracy to show.
const tallied = [...(rec.roundStats ?? new Map()).entries()]
  .filter(([, e]) => (e.fired?.length ?? 0) + (e.hit?.length ?? 0) > 0).map(([pid]) => pid);
const fromServer = board.filter((e) => e.source === 'server');
if (tallied.length && fromServer.length !== tallied.length)
  fails.push(`Accuracy board: ${fromServer.length} of ${tallied.length} tallied players from the server's tally`);
const unnamed = fromServer.flatMap((e) => e.rows).filter((r) => /^template \d+$/.test(r.tmpl));

console.log(`${file}: viewer read ${rec.fires.length} fires, ${rec.hitsGiven.length} hits given, ` +
  `${rec.impacts.length} impacts, ${rec.flights.length} flights, ${rec.hitsTaken?.length ?? 0} hits taken; ` +
  `Accuracy board ${fromServer.length} of ${tallied.length} from the server, ${unnamed.length} rows unnamed; ` +
  `${rec.skipped} skipped`);
if (unnamed.length) fails.push(`${unnamed.length} Accuracy board rows have no weapon name`);
if (fails.length) {
  console.log(`FAIL\n  ${fails.join('\n  ')}`);
  process.exit(1);
}
console.log('ok');
