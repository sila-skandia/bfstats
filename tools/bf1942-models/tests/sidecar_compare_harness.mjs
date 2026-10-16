// The sidecar's recording of a Wake round, rebuilt from its review log, set
// against the retail client's own bf42plus recording of the same round
// (sidecar/compare.mjs). The owner flew a Zero off the Shokaku firing its
// guns, drove a Sherman and fired three shells, ran on foot with a Type99,
// and watched a Daihatsu drop its ramp and sink. See test_sidecar_compare.py.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compare, readRec } from '../sidecar/compare.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-compare-'));
const unzip = (name) => {
  const p = path.join(dir, name.replace(/\.gz$/, ''));
  fs.writeFileSync(p, zlib.gunzipSync(fs.readFileSync(path.join(here, 'fixtures', name))));
  return p;
};
const rec = unzip('sidecar_wake_zero_sherman.ndjson.gz');
const review = unzip('sidecar_wake_zero_sherman.review.ndjson.gz');
const client = unzip('client_wake_zero_sherman.ndjson.gz');
const out = path.join(dir, 'rebuilt.ndjson');
execFileSync('node', [path.join(here, '../sidecar/rebuild.mjs'), rec, review, out]);
const side = readRec(out);
const rep = compare(side, readRec(client));
const obj = (id) => rep.objects.find((o) => o.id === id) ?? null;
const hp = (id) => rep.hp.find((h) => h.id === id) ?? null;
const res = {
  mismatches: rep.mismatches,
  zero: obj(562),
  sherman: obj(560),
  fires: rep.fires,
  hp: { defgun: hp(520)?.side, aa: hp(526)?.side, hatsuzuki: hp(539)?.side, daihatsu: hp(583)?.side },
  ramp: [rep.joints['583 DaihatsuLanding1']?.errMed, rep.joints['583 DaihatsuLanding2']?.errMed],
  events: rep.events,
  village: side.filter((r) => r.e === 'cp' && r.id === 519).map((r) => r.name),
};
fs.rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(res));
