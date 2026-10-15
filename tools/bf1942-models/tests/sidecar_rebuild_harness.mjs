// A sidecar recording rebuilt from its review log (sidecar/rebuild.mjs) and
// read by the replay viewer's own parser. The fixture is a live round on Wake
// Island: a player drives an M3A1 (netId 674), mans its .50 (seat 675, a
// nested PlayerControlObject with no createObject), then takes a Chi-ha (620)
// and destroys the M3A1. See test_sidecar_rebuild.py.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseRecording, rootOf, controlledAt, hpAt, lifeAt, crewOf } from '../viewer/replay-recording.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-rebuild-'));
const unzip = (name) => {
  const p = path.join(dir, name.replace(/\.gz$/, ''));
  fs.writeFileSync(p, zlib.gunzipSync(fs.readFileSync(path.join(here, 'fixtures', name))));
  return p;
};
const rec = unzip('sidecar_m3a1_round.ndjson.gz');
const review = unzip('sidecar_m3a1_round.review.ndjson.gz');
const out = path.join(dir, 'rebuilt.ndjson');
execFileSync('node', [path.join(here, '../sidecar/rebuild.mjs'), rec, review, out]);
const text = fs.readFileSync(out, 'utf8');
const rows = text.trim().split('\n').map(JSON.parse);
const r = parseRecording(text);

const at = (pid, t) => {
  const nid = controlledAt(r, pid, t);
  const root = rootOf(r, nid, t, pid);
  return { nid, root: root ? root.life.nid : null, seat: root ? root.seat : null };
};
const apc = r.lives.filter((l) => l.nid === 674);
const res = {
  seatObjects: rows.filter((x) => x.k === 'o' && x.id === 675).length,
  gunner: at(0, 62),
  driver: at(0, 58),
  crewWhileGunning: crewOf(r, lifeAt(r, 674, 62), 62),
  apcShownWhileGunning: apc.some((l) => l.replicated.some(([a, b]) => a <= 62 && 62 < b)),
  apcHpBefore: hpAt(lifeAt(r, 674, 100), 100),
  apcHpAfter: hpAt(lifeAt(r, 674, 110), 110),
  mgRounds: r.fires.filter((f) => f.t > 60 && f.t < 64).length,
  shellRounds: r.fires.filter((f) => f.t > 100 && f.t < 111).map((f) => ({ t: f.t, pid: f.pid, nid: f.nid, kind: f.kind })),
};
fs.rmSync(dir, { recursive: true, force: true });
console.log(JSON.stringify(res));
