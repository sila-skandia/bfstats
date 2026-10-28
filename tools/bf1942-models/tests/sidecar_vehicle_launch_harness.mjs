// Where the sidecar writes a remote vehicle's round (`ghost-writer.mjs`
// `_muzzle`), against where the server launched it. argv[2] is
// fixtures/sidecar_vehicle_launch.json: each row the ghost writer's pose and
// aim histories near one round (entries `[t, tick, ...]`), the round's ticks
// it derived (`tick` for the aims, `poseTick` for the hull), the arrival time
// it dated the round (`at`) and the server recorder's `p`/`d` for it. The
// vanilla fallback specs serve (ghost/derived-specs.json, which carries the
// launch chains). Prints one JSON blob: per row the written `p`/`d` and the
// same read other ways:
//   before      without the launch chain (the pitch pivot the writer measured
//               from until 2026-10-28)
//   noPivot     without the chain's last link (a seat camera's pivotPosition)
//   arrival     the pose and aims of the arrival time, not of the ticks
//   samePose    the hull's pose of the aims' tick
//   tickEarlier both ticks one earlier (a step the server sent a tick late)
import { readFileSync } from 'node:fs';
import { GhostWriter } from '../sidecar/ghost-writer.mjs';
import { specFor } from '../sidecar/ghost/children.mjs';

const fix = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const writer = Object.create(GhostWriter.prototype);
const out = [];
for (const row of fix.rows) {
  writer.poses = new Map([[1, row.poses.map(([t, tick, pos, q]) => [t, pos, q, tick])]]);
  writer.aims = new Map(Object.entries(row.aims).map(([s, l]) => [`1:${s}`, l.map(([t, tick, y, p]) => [t, y, p, tick])]));
  const muzzle = (tick = row.tick, poseTick = row.poseTick) => writer._muzzle(1, row.seat, row.tmpl, row.at, row.gun, tick, poseTick);
  const now = muzzle();
  const arrival = muzzle(null, null);
  const samePose = muzzle(row.tick, row.tick);
  const tickEarlier = muzzle(row.tick - 1, row.poseTick - 1);
  const spec = specFor(row.tmpl);
  const launch = spec.launch;
  const chain = launch?.[row.seat]?.[row.gun];
  let noPivot = now;
  if (chain) {
    launch[row.seat][row.gun] = chain.slice(0, -1);
    noPivot = muzzle();
    launch[row.seat][row.gun] = chain;
  }
  delete spec.launch;
  const before = muzzle();
  spec.launch = launch;
  out.push({ tmpl: row.tmpl, w: row.w, now, before, noPivot, arrival, samePose, tickEarlier, server: row.server });
}
console.log(JSON.stringify({ rows: out }));
