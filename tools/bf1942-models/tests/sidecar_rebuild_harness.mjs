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
  // Out of the M3A1 (90.4 s) and on foot to the Chi-ha (99.0 s): his soldier.
  onFoot: at(0, 94),
  inTank: at(0, 100),
  shellRounds: r.fires.filter((f) => f.t > 100 && f.t < 111).map((f) => ({ t: f.t, pid: f.pid, nid: f.nid, kind: f.kind })),
};
// The same round as a sidecar started without --names writes it: every
// template blank and no animation table. The rebuild names them from the
// level's saved map, or the replay has no model for anything and draws an
// empty map (the owner's 2026-10-16 round).
const blank = path.join(dir, 'blank.ndjson');
fs.writeFileSync(blank, fs.readFileSync(rec, 'utf8').trim().split('\n').map(JSON.parse)
  .filter((x) => x.k !== 'anim')
  .map((x) => JSON.stringify(x.tmpl != null ? { ...x, tmpl: '' } : x)).join('\n') + '\n');
const blankOut = path.join(dir, 'blank.rebuilt.ndjson');
execFileSync('node', [path.join(here, '../sidecar/rebuild.mjs'), blank, review, blankOut]);
const blankText = fs.readFileSync(blankOut, 'utf8');
const blankRows = blankText.trim().split('\n').map(JSON.parse);
const br = parseRecording(blankText);
res.unnamed = {
  anim: blankRows.some((x) => x.k === 'anim'),
  blankCreates: blankRows.filter((x) => x.e === 'createObject' && !x.tmpl && x.tid !== 1571).length,
  apcTmpl: br.lives.find((l) => l.nid === 674)?.tmpl ?? null,
};
fs.rmSync(dir, { recursive: true, force: true });
// Every transform row carries the server tick its block described, rising.
{
  const ticks = rows.filter((x) => x.k === 's').map((x) => x.tick);
  res.sTicks = { rows: ticks.length, withTick: ticks.filter(Number.isInteger).length,
    rising: ticks.every((v, i) => i === 0 || v >= ticks[i - 1]) };
}
console.log(JSON.stringify(res));
