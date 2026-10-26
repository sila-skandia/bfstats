package io.bfstats.sidecar.ghost

// Port of tools/bf1942-models/sidecar/ghost/score-manager.mjs; keep in step.
//
// The ScoreManager's ghost body: both sides' scores, tickets among them.
//
// ScoreManager::setNetUpdate (lnxded 0x08162770) reads a 24-bit mask, then for
// each of bits 0..21 a readSigned(18) into the team record's ints (+0x4 ..
// +0x58), and for bits 22 and 23 a readSigned(3) into its two leading bytes.
// The 22 ints are two sides of 11: index 9 is side 1's tickets and index 20
// side 2's (live on the lab, 2026-10-16).
//
// The ScoreManager has no createObject, so nothing names its netId;
// looksLikeScoreBody() is how the body decoder finds it: a whole-record first
// send (all 24 mask bits) whose length is exactly what that mask implies.

import io.bfstats.sidecar.hexReader
import io.bfstats.sidecar.sgn
import io.bfstats.sidecar.u

object ScoreManager {
  val TICKETS = linkedMapOf("1" to 9, "2" to 20)
  // Each side's rounds won: setNetUpdate stores int 10 at +0xac and int 21 at
  // +0xfc, the counters ScoreManager::setWinner (0x08161b80) raises at
  // `team * 0x50 + 0x5c`. Mask bits 22 and 23 are the winner (+0x5c) and the
  // victory type (+0x5d).
  val ROUNDS_WON = linkedMapOf("1" to 10, "2" to 21)

  private fun expectedBits(mask: Long): Long {
    var n = 24L
    for (i in 0 until 22) if (mask and (1L shl i) != 0L) n += 18
    if (mask and (1L shl 22) != 0L) n += 3
    if (mask and (1L shl 23) != 0L) n += 3
    return n
  }

  fun looksLikeScoreBody(hex: String?, bodyBits: Double?): Boolean {
    if (hex.isNullOrEmpty() || bodyBits == null || bodyBits < 24) return false
    val r = hexReader(hex, bodyBits)
    val mask = r.readUnsigned(24)
    return mask == 0xffffffL && expectedBits(mask).toDouble() == bodyBits
  }

  /** Returns { mask, ints: {index: value}, bytes: [a, b], consumed } or null
   *  when the length does not match the mask. */
  fun decodeScoreBody(hex: String?, bodyBits: Double?): MutableMap<String, Any?>? {
    val r = hexReader(hex, bodyBits)
    val mask = r.readUnsigned(24)
    if (bodyBits == null || expectedBits(mask).toDouble() != bodyBits) return null
    val ints = linkedMapOf<String, Any?>()
    for (i in 0 until 22) if (mask and (1L shl i) != 0L) ints[i.toString()] = r.sgn(18)
    val bytes = mutableListOf<Any?>(null, null)
    if (mask and (1L shl 22) != 0L) bytes[0] = r.sgn(3)
    if (mask and (1L shl 23) != 0L) bytes[1] = r.sgn(3)
    return linkedMapOf("mask" to mask.toDouble(), "ints" to ints, "bytes" to bytes, "consumed" to r.pos.toDouble())
  }
}
