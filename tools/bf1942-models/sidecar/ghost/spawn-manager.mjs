// The BFSpawnPointManager's ghost body: every spawn group's side, whether a
// human can spawn on it now, and where its ring is.
//
// The manager is one of the server's own networkables (no createObject names
// it; on every level seen it is netId 513, beside the ScoreManager's 514).
// `BFSpawnPointManager::updateStateMask` (lnxded 0x081683f0) walks the group
// map (`+0x4c`, a std::map ordered by group id) and, per group, keeps
// { team (`*group`), `BFSpawnGroup::getActive(false)` (0x08166c10: the human's
// test, SPAWN-5 and SPAWN-25 through every point), x and z of `getPos()`
// (`calcNewPos` 0x08166d90: the average of the points whose carrier is not
// critically damaged, (0,0,0) with none), each quantised to a byte of the
// terrain's width and height }. A group whose entry changed sets its bit.
// `getNetUpdate` (0x08168690) writes the mask in `+0x50` bits (the group
// count), then per set bit `writeUnsigned(team, 4)`, `writeBool(active)` and
// two `writeUnsigned(q, 8)`. `setNetUpdate` (0x081687f0) reads it back the
// same way and writes the team into the group (only when `+0x15`,
// enableToChangeTeam, is set), the active byte into `+0x14` and the position
// as (q/255 x width, 0, q/255 x height) into `+0x4..+0xc`.
//
// On the client that byte is the whole of `BFSpawnGroup::getActive`: the
// client's twin (BF1942.exe 0x00484bc0) returns it outright when the game is
// not the server (IID 0x1d4c1). The spawn map draws a dot only for a group of
// the player's side that passes it, and a click selects only such a group
// (`BfMap::update` 0x0046df22.., the pick at 0x004695d8). So the server's word
// is the screen's: a group no human can spawn on (Midway's helm group 72,
// whose door is beyond a human's 5 m) is not drawn at all.
//
// The wire never names a group: entry i is the i-th lowest group id the
// server's map holds, which is every group any script or spawn point named
// (GlobalSpawnGroups.con, the mode's spawnPointManagerSettings.con, each
// point's setGroup), with or without points. The page lines the entries up
// with the groups it knows (viewer/server-spawn-groups.js).
//
// looksLikeSpawnManagerBody() is how the body decoder finds it: the first
// send is every group (all n mask bits) and exactly 22 bits a group.

import { BitReader } from '../bitstream.mjs';

/** Bits per group in a body: team 4, active 1, x 8, z 8. */
export const GROUP_BITS = 21;

/** The group count `n` when this is a whole first send (every mask bit set,
 *  `n + 21 n` bits, every side 0..3), else 0. A group count below 4 is no
 *  level's: vanilla's GlobalSpawnGroups.con alone names twenty. */
export function looksLikeSpawnManagerBody(hex, bodyBits) {
  if (!hex || !Number.isInteger(bodyBits) || bodyBits % (GROUP_BITS + 1)) return 0;
  const n = bodyBits / (GROUP_BITS + 1);
  if (n < 4 || n > 128) return 0;
  const b = decodeSpawnManagerBody(hex, bodyBits, n);
  if (!b || b.rows.length !== n) return 0;
  return b.rows.every(([, team]) => team <= 3) ? n : 0;
}

/** One body for a manager of `n` groups: `{ mask, rows: [[index, team,
 *  active, qx, qz]] }` for the groups it carries, or null when the length does
 *  not match the mask. */
export function decodeSpawnManagerBody(hex, bodyBits, n) {
  if (!hex || !(n > 0) || bodyBits < n) return null;
  const r = new BitReader(Buffer.from(hex, 'hex'), bodyBits);
  const set = [];
  for (let i = 0; i < n; i++) if (r.readUnsigned(1)) set.push(i);
  if (n + set.length * GROUP_BITS !== bodyBits) return null;
  const rows = set.map((i) => [i, r.readUnsigned(4), r.readUnsigned(1), r.readUnsigned(8), r.readUnsigned(8)]);
  return { n, rows, consumed: r.pos };
}
