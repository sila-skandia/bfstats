// Where the sidecar writes a remote vehicle's round (`ghost-writer.mjs`
// `_muzzle`), against where the server launched it. argv[2] is
// fixtures/sidecar_vehicle_launch.json: each row a hull pose, the aims the
// writer held for each seat and the server recorder's `p`/`d` for that
// round. The vanilla fallback specs serve (ghost/derived-specs.json, which
// carries the launch chains). Prints one JSON blob: per row the written
// `p`/`d`, and the same with the launch chain taken away (the pitch pivot
// the writer measured from until 2026-10-28).
import { readFileSync } from 'node:fs';
import { GhostWriter } from '../sidecar/ghost-writer.mjs';
import { specFor } from '../sidecar/ghost/children.mjs';

const fix = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const writer = Object.create(GhostWriter.prototype);
const out = [];
for (const row of fix.rows) {
  writer.poses = new Map([[1, [[0, row.pos, row.q]]]]);
  writer.aims = new Map(Object.entries(row.aims).map(([s, [y, p]]) => [`1:${s}`, [[0, y, p]]]));
  const now = writer._muzzle(1, row.seat, row.tmpl, 0, row.gun);
  const spec = specFor(row.tmpl);
  const launch = spec.launch;
  delete spec.launch;
  const before = writer._muzzle(1, row.seat, row.tmpl, 0, row.gun);
  spec.launch = launch;
  out.push({ tmpl: row.tmpl, w: row.w, now, before, server: row.server });
}
console.log(JSON.stringify({ rows: out }));
