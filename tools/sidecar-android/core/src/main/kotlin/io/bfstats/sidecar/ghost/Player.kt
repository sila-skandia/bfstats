package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/player.mjs; keep in step.
//
// Decode a player's ghost body: dice::bf::BFPlayer.
//
// Not a Networkable: a BFPlayer is the per-player object the server adds with
// NetworkManager::addPlayerNetworkable (0x0842c310), and it rides the ghost
// stream under its own netId, the `netId` a createPlayer event carries. Its
// reader is BFPlayer::setNetUpdate (0x08053a40); its writer
// BFPlayer::getNetUpdate (0x080534b0); its mask is built by
// BFPlayer::updateStateMask (0x08052f60). A single setNetUpdate, no child tail.
//
// THE BODY (in this order):
//
//   readUnsigned(24)     presence mask                      always, LSB-first
//   0x000002  u7  @ +0x90  readUnsigned(0,0x7f)
//   0x000004  b   @+0x13c  readBool
//   0x000008 .. 0x000400  the stat block's nine flat counters, readUnsigned(0,0xff)
//   0x000800  s16 @ +0xc0  readSigned(16)          the score
//   0x001000  b   @+0x14c  readBool                 call-for-medic / engineer
//   0x004000  b   @+0x148  readBool
//   0x008000  b   @+0x149  readBool
//   0x010000  u10 @ +0x94  readUnsigned(0,0x3ff)    the ping, 0..1023 ms
//   0x002000  u7  @ +0x8c  readUnsigned(0,0x7f)     the respawn wait, whole seconds
//   0x040000  u5  @ slot+0x3c readUnsigned(0,0x12)  controlled-object value
//   0x040000  b   @ slot+0x54 readBool              ** same guard bit 0x40000 **
//   0x080000  u8  @+0x178  readUnsigned(0,0xff)
//   0x100000  u8  @ +0xe8  readUnsigned(0,0xff)     \ the gold, silver and
//   0x200000  u8  @ +0xec  readUnsigned(0,0xff)     | bronze medal counters
//   0x400000  u8  @ +0xf0  readUnsigned(0,0xff)    /
//   0x800000  u8  @ +0x80  readUnsigned(0,0xff)
//   (no guard) b  @+0x164  readBool                 isConnected — ALWAYS
//
// TWO TRAPS: `readUnsigned(min,max)` (0x083da040) is the RANGED reader with the
// engine's off-by-one, so readUnsigned(0,0xff) is 9 bits and (0,0x3ff) 11; and
// mask bit 0x40000 guards TWO fields in a row. See the Node copy for the stat
// block's evidence (ScoreManager::scoreEvent 0x081617c0, bfPlayersCallback
// 0x0804d3f0, the client's score board 0x006e08f7..).
//
// An underflow propagates (no try/catch around the reads).

import io.bfstats.sidecar.hexReader
import io.bfstats.sidecar.rangedBits
import io.bfstats.sidecar.sgn
import io.bfstats.sidecar.u

object Player {
  const val MASK_WIDTH = 24

  class Field(val bit: Int, val name: String, val kind: Char, val max: Int = 0, val bits: Int = 0, val stat: String? = null)

  val FIELDS = listOf(
    Field(0x000002, "unk90", 'u', max = 0x7f),
    Field(0x000004, "f13c", 'b'),
    Field(0x000008, "stat1", 'u', max = 0xff, stat = "deaths"),
    Field(0x000010, "stat2", 'u', max = 0xff, stat = "kills"),
    Field(0x000020, "stat3", 'u', max = 0xff, stat = "captures"),
    Field(0x000040, "stat4", 'u', max = 0xff, stat = "defences"),
    Field(0x000080, "stat5", 'u', max = 0xff, stat = "objectives"),
    Field(0x000100, "stat6", 'u', max = 0xff, stat = "objectiveTeamKills"),
    Field(0x000200, "stat7", 'u', max = 0xff, stat = "attacks"),
    Field(0x000400, "stat8", 'u', max = 0xff, stat = "teamKills"),
    Field(0x000800, "stat9", 's', bits = 16, stat = "score"),
    Field(0x001000, "callMedic", 'b'),
    Field(0x004000, "callEngineer", 'b'),
    Field(0x008000, "f149", 'b'),
    Field(0x010000, "unk94", 'u', max = 0x3ff, stat = "ping"),
    Field(0x002000, "spawnWait", 'u', max = 0x7f),
    Field(0x040000, "vehValue", 'u', max = 0x12),
    Field(0x040000, "vehFlag", 'b'),
    Field(0x080000, "f178", 'u', max = 0xff),
    Field(0x100000, "score_e8", 'u', max = 0xff),
    Field(0x200000, "score_ec", 'u', max = 0xff),
    Field(0x400000, "score_f0", 'u', max = 0xff),
    Field(0x800000, "unk80", 'u', max = 0xff),
  )

  /** { score: 'stat9', kills: 'stat2', ... } */
  val STAT_FIELDS: Map<String, String> = LinkedHashMap<String, String>().also { m -> for (f in FIELDS) if (f.stat != null) m[f.stat] = f.name }

  val UNUSED_BITS = listOf(0x1, 0x20000)

  /** Returns { mask, connected, consumed, <field names> }. Underflow propagates. */
  fun decodePlayerBody(bodyHex: String?, bodyBits: Double?, opts: Map<String, Any?> = emptyMap()): MutableMap<String, Any?> {
    val r = hexReader(bodyHex, bodyBits)
    val out = linkedMapOf<String, Any?>("mask" to 0.0, "connected" to null, "consumed" to 0.0)
    for (f in FIELDS) out[f.name] = null
    val mask = r.u(MASK_WIDTH)
    out["mask"] = mask
    val m = mask.toInt()
    for (f in FIELDS) {
      if (m and f.bit == 0) continue
      out[f.name] = when (f.kind) {
        'b' -> r.readBool()
        's' -> r.sgn(f.bits)
        else -> r.u(rangedBits(0, f.max.toLong()))
      }
    }
    out["connected"] = r.readBool() // unconditional, BFPlayer+0x164
    out["consumed"] = r.pos.toDouble()
    return out
  }
}
