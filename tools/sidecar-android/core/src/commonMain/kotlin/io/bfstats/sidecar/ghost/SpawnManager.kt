package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/spawn-manager.mjs; keep in step.
//
// The BFSpawnPointManager's ghost body: every spawn group's side, whether a
// human can spawn on it now, and where its ring is.
//
// The manager is one of the server's own networkables (no createObject names
// it; on every level seen it is netId 513, beside the ScoreManager's 514).
// `BFSpawnPointManager::updateStateMask` (lnxded 0x081683f0) walks the group
// map (`+0x4c`, a std::map ordered by group id) and, per group, keeps { team,
// `BFSpawnGroup::getActive(false)` (0x08166c10), x and z of `getPos()`
// (`calcNewPos` 0x08166d90), each quantised to a byte of the terrain's width
// and height }. `getNetUpdate` (0x08168690) writes the mask in `+0x50` bits
// (the group count), then per set bit `writeUnsigned(team, 4)`,
// `writeBool(active)` and two `writeUnsigned(q, 8)`. `setNetUpdate`
// (0x081687f0) reads it back the same way.
//
// The wire never names a group: entry i is the i-th lowest group id the
// server's map holds. looksLikeSpawnManagerBody() is how the body decoder finds
// it: the first send is every group (all n mask bits) and exactly 22 bits a group.

import io.bfstats.sidecar.Math
import io.bfstats.sidecar.hexReader
import io.bfstats.sidecar.u

object SpawnManager {
  /** Bits per group in a body: team 4, active 1, x 8, z 8. */
  const val GROUP_BITS = 21

  /** The group count `n` when this is a whole first send, else 0. */
  fun looksLikeSpawnManagerBody(hex: String?, bodyBits: Double?): Int {
    if (hex.isNullOrEmpty() || bodyBits == null || !(bodyBits.isFinite() && Math.floor(bodyBits) == bodyBits) || bodyBits % (GROUP_BITS + 1) != 0.0) return 0
    val n = bodyBits / (GROUP_BITS + 1)
    if (n < 4 || n > 128) return 0
    val b = decodeSpawnManagerBody(hex, bodyBits, n) ?: return 0
    val rows = b["rows"] as List<*>
    if (rows.size.toDouble() != n) return 0
    return if (rows.all { ((it as List<*>)[1] as Double) <= 3 }) n.toInt() else 0
  }

  /** `{ n, rows: [[index, team, active, qx, qz]], consumed }` or null. */
  fun decodeSpawnManagerBody(hex: String?, bodyBits: Double?, n: Double?): MutableMap<String, Any?>? {
    if (hex.isNullOrEmpty() || n == null || !(n > 0) || bodyBits == null || bodyBits < n) return null
    val r = hexReader(hex, bodyBits)
    val set = ArrayList<Int>()
    var i = 0
    while (i < n) { if (r.readUnsigned(1) != 0L) set.add(i); i++ }
    if (n + set.size * GROUP_BITS != bodyBits) return null
    val rows = set.mapTo(ArrayList<Any?>()) { k -> mutableListOf<Any?>(k.toDouble(), r.u(4), r.u(1), r.u(8), r.u(8)) }
    return linkedMapOf("n" to n, "rows" to rows, "consumed" to r.pos.toDouble())
  }
}
