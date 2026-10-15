// Decode a recorded M3A1 drive (sidecar review log, netId 674) and print the
// hull's yaw against its direction of travel, one pair per second of motion.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decodePcoBody } from '../sidecar/ghost/pco.mjs';

const rows = zlib.gunzipSync(fs.readFileSync(process.argv[2])).toString().trim().split('\n').map(JSON.parse);
const out = [];
let prev = null, rot = null;
for (const d of rows) {
  const b = decodePcoBody(d.hex, d.bodyBits, { template: 'M3A1', strict: false });
  if (b.rot) rot = b.rot;
  if (!b.pos || !rot) continue;
  if (!prev) { prev = { t: d.dt, p: b.pos }; continue; }
  if (d.dt - prev.t < 0.9) continue;
  const dx = b.pos[0] - prev.p[0], dz = b.pos[2] - prev.p[2];
  if (Math.hypot(dx, dz) > 3) {
    const move = Math.atan2(dx, dz) * 180 / Math.PI;
    const yaw = 2 * Math.atan2(rot[1], rot[3]) * 180 / Math.PI;
    out.push([move, yaw]);
  }
  prev = { t: d.dt, p: b.pos };
}
console.log(JSON.stringify(out));
