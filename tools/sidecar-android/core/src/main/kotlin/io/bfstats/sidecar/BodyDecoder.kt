package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/body-decoder.mjs; keep in step.
//
// Decode framed ghost bodies by the class of the object they belong to.
//
// The wire never names an object's class, so a body picks its reader from what
// the events said: a createPlayer netId is a BFPlayer, a player's on-foot
// control object (SetDefaultVehicle, recorded as `control`) is a soldier, and
// everything else is its createObject template's class: the template class the
// level load gave that id (TemplateTable, and TemplateClass for the
// networkable class it makes). A netId with no createObject that sits within a
// hull's seat range is that hull's nested PlayerControlObject (a gunner seat),
// read with the root template's seat spec (Children).
//
// It is fed v5 recording rows (Record) rather than raw events, so the live
// session and the offline rebuild (Rebuild) decode the same way.

import io.bfstats.sidecar.JsOps.nullish
import io.bfstats.sidecar.JsOps.truthy
import io.bfstats.sidecar.ghost.Children
import io.bfstats.sidecar.ghost.ControlPoint
import io.bfstats.sidecar.ghost.Kit
import io.bfstats.sidecar.ghost.Pco
import io.bfstats.sidecar.ghost.Player
import io.bfstats.sidecar.ghost.Projectile
import io.bfstats.sidecar.ghost.ScoreManager
import io.bfstats.sidecar.ghost.SpawnManager

class BodyDecoder(opts: Map<String, Any?> = emptyMap()) {
  companion object {
    /** How far past a root's netId its seats' ids reach (viewer MAX_SEATS). */
    const val MAX_SEATS = 12
    // No BF1942 level reaches past 4096 m (the largest heightmaps are 4 km).
    private const val WORLD_LIMIT = 8192.0
    // The classes whose client networkable keeps a transform ring that every
    // record advances (`decode`, below).
    private val TRANSFORM_RING = setOf("BFSoldierNetworkable", "SimpleObjectNetworkable")
  }

  // The engine's animation state count, which sizes a soldier body's state
  // fields. An explicit count (a --names table) stays; otherwise each setLevel
  // takes it from the tables for the server's mod (GameTables).
  var animStates: Any? = JsOps.coalesce(opts.g("animStates")) { 0.0 }
  val animFixed = truthy(opts.g("animStates"))
  var mod: Any? = JsOps.coalesce(opts.g("mod")) { null }   // the server's mod, from its ServerInfo event
  val objects = HashMap<Any?, Any?>()      // netId -> tid, from createObject
  val playerNetIds = HashSet<Any?>()       // createPlayer netIds
  val soldiers = HashSet<Any?>()           // on-foot control objects
  val cameras = HashSet<Any?>()            // createPlayer camNetIds
  val lastRot = HashMap<Any?, Any?>()
  val lastPosOf = HashMap<Any?, Any?>()
  var scoreNet: Any? = null                // the ScoreManager's netId, once seen
  var spawnNet: Any? = null                // the BFSpawnPointManager's netId and group count
  var spawnGroupCount = 0
  // The level's template table, set on its setLevel.
  var level: String? = null
  var tidNames: Any? = JsOps.coalesce(opts.g("tidNames")) { null }
  var tidClasses: Any? = null
  var cpTemplates: Set<String>? = null
  private val infoCache = HashMap<Any?, MutableMap<String, Any?>?>()

  private fun k(v: Any?) = JsOps.key(v)

  fun setLevel(level: Any?, mode: Any? = null) {
    val n = Names.namesForLevel(level, mod, mode)
    this.level = JsOps.str(if (truthy(level)) level else "").replace(Regex("/+\\z"), "").split("/").last().lowercase().ifEmpty { null }
    tidNames = n["tidNames"]
    tidClasses = JsOps.coalesce(n["tidClasses"]) { null }
    // The level's hull specs, hulls and soldiers (Children), computed from the
    // same load; the vanilla fallback, loudly, when they could not be.
    Children.useLevelTemplates(TemplateTable.levelTemplates(mod, level, mode),
      "${if (nullish(mod)) "?" else JsOps.str(mod)} ${this.level ?: JsOps.str(level)} ${if (nullish(mode)) "" else JsOps.str(mode)}".trim())
    // The level's control points and the mod's animation table as the client
    // builds them from its install; the recorded ones only if that fails.
    val g = GameTables.gameTables(mod, level, mode)
    cpTemplates = TemplateClass.controlPointTemplates(level, JsOps.coalesce(g["cpNames"]) { n["cpNames"] })
    if (!animFixed) {
      val states = JsOps.coalesce(g["animStates"]) { n["animStates"] }
      if (states is List<*> && states.isNotEmpty()) animStates = states.size.toDouble()
    }
    infoCache.clear()
    // A level is a fresh set of the server's own networkables: the spawn
    // manager's first send on it names it again.
    spawnNet = null
    spawnGroupCount = 0
  }

  /** A v5 recording row (Record.recordFor output, or a parsed k:"e" line). */
  fun note(row: Any?) {
    if (row !is Map<*, *>) return
    val e = row.g("e")
    if (e == "serverInfo") { if (truthy(row.g("mod"))) mod = row.g("mod"); return }
    if (e == "setLevel") { setLevel(row.g("level"), row.g("mode")); return }
    val netId = row.g("netId")
    if (e == "createObject" && !nullish(netId)) objects[k(netId)] = row.g("tid")
    // A pool of rounds (CreateMultipleObjectsEvent, 0x05): `count` objects of
    // one projectile template under consecutive netIds, and no createObject
    // for any of them (ledger J-5).
    else if (e == "projPool" && JsOps.isInt(netId) && (JsOps.num(row.g("count"))?.let { it > 0 } ?: false)) {
      val count = JsOps.num(row.g("count"))!!
      var i = 0
      while (i < Math.min(count, 16.0)) { objects[k((netId as Double) + i)] = row.g("tid"); i++ }
    }
    else if (e == "destroyObject") { objects.remove(k(netId)); lastPosOf.remove(k(netId)); lastRot.remove(k(netId)) }
    else if (e == "createPlayer" && !nullish(netId)) {
      playerNetIds.add(k(netId))
      if (!nullish(row.g("camNetId"))) cameras.add(k(row.g("camNetId")))
    }
    // A player handed back to his camera (after a death, `control` names his
    // camNetId) is not on foot: that id stays a FreeCamera.
    else if (e == "control" && !nullish(netId) && !cameras.contains(k(netId))) soldiers.add(k(netId))
  }

  fun info(netId: Any?): MutableMap<String, Any?>? {
    if (!objects.containsKey(k(netId))) return null
    val tid = objects[k(netId)]
    if (nullish(tid)) return null
    if (infoCache.containsKey(k(tid))) return infoCache[k(tid)]
    val tmpl = JsOps.at(tidNames, tid).let { if (nullish(it)) null else it }
    val tc = JsOps.at(tidClasses, tid).let { if (nullish(it)) null else it }
    val cls = TemplateClass.classForTemplate(tmpl, cpTemplates, tc)
    val info: MutableMap<String, Any?>? = if (cls != null) LinkedHashMap<String, Any?>().also { it["tid"] = tid; it.putAll(cls); it["tmpl"] = tmpl }
      else if (truthy(tmpl)) linkedMapOf("tid" to tid, "tmpl" to tmpl) else null
    infoCache[k(tid)] = info
    return info
  }

  /** The hull a seat belongs to, as { root, seat, tmpl }, or null. */
  fun seatOf(netId: Double): MutableMap<String, Any?>? {
    if (objects.containsKey(k(netId)) || soldiers.contains(k(netId)) || playerNetIds.contains(k(netId)) || cameras.contains(k(netId))) return null
    var root = netId - 1
    while (root >= netId - MAX_SEATS) {
      val inf = info(root)
      if (inf == null) { root--; continue }
      if (inf["objectClass"] != "PlayerControlObject") return null
      return linkedMapOf("root" to root, "seat" to netId - root, "tmpl" to JsOps.coalesce(inf["tmpl"]) { null })
    }
    return null
  }

  fun classOf(netId: Any?): String? {
    if (JsOps.eq(netId, scoreNet)) return "ScoreManager"
    if (JsOps.eq(netId, spawnNet)) return "SpawnPointManager"
    if (playerNetIds.contains(k(netId))) return "BFPlayer"
    if (soldiers.contains(k(netId))) return "BFSoldierNetworkable"
    if (cameras.contains(k(netId)) && !objects.containsKey(k(netId))) return "FreeCameraNetworkable"
    val inf = info(netId)
    if (inf != null) return inf["networkableClass"].let { if (nullish(it)) null else it as String }
    val n = JsOps.num(netId) ?: return null
    return if (seatOf(n) != null) "Seat" else null
  }

  private fun refOpt(rec: Map<String, Any?>, o: MutableMap<String, Any?>, key: String) { if (truthy(rec["ref"])) o[key] = rec["ref"] }

  /** Decode one framed record in place: rec.cls, rec.body, and for an object
   *  with a transform rec.pos / rec.rot. Seats get rec.seat = { root, seat }. */
  fun decode(rec: MutableMap<String, Any?>) {
    val netId = rec.g("netId")
    val hex = rec.g("hex") as? String
    val bodyBits = JsOps.num(rec.g("bodyBits"))
    // The spawn manager has no createObject, and its id can sit inside a
    // hull's seat range, so it is asked for before the class guess; only a
    // classless id can be it.
    if (nullish(spawnNet) && !objects.containsKey(k(netId)) && !playerNetIds.contains(k(netId)) &&
        !soldiers.contains(k(netId)) && !cameras.contains(k(netId))) {
      val n = SpawnManager.looksLikeSpawnManagerBody(hex, bodyBits)
      if (n != 0) { spawnNet = netId; spawnGroupCount = n }
    }
    var cls = classOf(netId)
    if (cls == "SpawnPointManager") {
      rec["cls"] = cls
      val b = SpawnManager.decodeSpawnManagerBody(hex, bodyBits, spawnGroupCount.toDouble())
      if (b != null) rec["body"] = b
      return
    }
    if (cls == null && nullish(scoreNet) && ScoreManager.looksLikeScoreBody(hex, bodyBits)) {
      scoreNet = netId
      cls = "ScoreManager"
    }
    if (cls == "ScoreManager") {
      val b = ScoreManager.decodeScoreBody(hex, bodyBits)
      rec["cls"] = cls
      if (b != null) rec["body"] = b
      return
    }
    var b: MutableMap<String, Any?>? = null
    when (cls) {
      "BFSoldierNetworkable" -> {
        // The position's reference is the stream's compression vector: zero,
        // or the block's control-state root position (rec.ref, session). The
        // soldier template's hit points and aim limits size and scale its
        // fields (SoldierGhost); its createObject names it.
        val s = Children.soldierFor(info(netId)?.get("tmpl"))
        val o = linkedMapOf<String, Any?>("animStates" to animStates)
        refOpt(rec, o, "baselinePos")
        if (s != null) o["maxHp"] = s["maxHp"]
        if (s != null && !nullish(s.g("aimTwist"))) o["aimTwistLimit"] = s["aimTwist"]
        if (s != null && !nullish(s.g("aimPitch"))) o["aimPitchLimit"] = s["aimPitch"]
        b = SoldierGhost.decodeSoldierBody(hex, bodyBits, o)
      }
      "BFPlayer" -> b = Player.decodePlayerBody(hex, bodyBits, linkedMapOf("strict" to false))
      "SimpleObjectNetworkable" -> {
        val template = info(netId)?.get("tmpl")
        val hull = Children.hullFor(template)
        val o = LinkedHashMap<String, Any?>()
        if (truthy(template)) o["template"] = template
        refOpt(rec, o, "ref")
        if (hull != null) { o["maxHp"] = hull.g("maxHp"); o["mobile"] = hull.g("mobile") != false }
        o["strict"] = false
        b = Pco.decodePcoBody(hex, bodyBits, o)
      }
      "ControlPointNetworkable" -> b = ControlPoint.decodeControlPointBody(hex, bodyBits, linkedMapOf("strict" to false))
      "KitNetworkable" -> b = Kit.decodeKitBody(hex, bodyBits, linkedMapOf("strict" to false))
      "ProjectileNetworkable" -> {
        // A round: its position (mask 0x02, a compressed vector against the
        // stream's reference, scale 0.01) and rotation (0x01), the reader
        // ProjectileNetworkable::setNetUpdate 0x08232be0 (ghost/projectile).
        val o = LinkedHashMap<String, Any?>()
        refOpt(rec, o, "ref")
        o["strict"] = false
        b = Projectile.decodeProjectileBody(hex, bodyBits, o)
      }
      "Seat" -> {
        val seat = seatOf(JsOps.num(netId)!!)!!
        rec["seat"] = linkedMapOf("root" to seat["root"], "seat" to seat["seat"])
        val spec = Children.seatSpecFor(seat["tmpl"], seat["seat"])
        if (spec != null) b = Pco.decodeSeatBody(hex, bodyBits, spec, linkedMapOf("strict" to false))
      }
    }
    if (cls != null) rec["cls"] = cls
    if (b == null) return
    rec["body"] = b
    val posBit = truthy(b["pos"])
    // A position read in a compressed mode whose reference we do not know yet
    // comes out as raw counts (a Sherman at 460461, 220223): off the world.
    // Keep the last good one.
    val p = b["pos"]
    if (truthy(p) && !(p as List<*>).all { v -> val d = JsOps.num(v); d != null && d.isFinite() && Math.abs(d) < WORLD_LIMIT }) b["pos"] = null
    // A body carries what changed: position and rotation each under their own
    // mask bit. Either half updates the transform, the other from the last one
    // this object sent.
    if (truthy(b["rot"])) lastRot[k(netId)] = b["rot"]
    if (truthy(b["pos"])) lastPosOf[k(netId)] = b["pos"]
    // And a body with neither is a sample too, of the transform it last had:
    // the retail client's setNetUpdate (`BFSoldierNetworkable` 0x08224e40,
    // `SimpleObjectNetworkable` 0x08236d00) advances the object's 16-record
    // ring on every record (Wake, 2026-10-24).
    val pos = if (truthy(b["pos"])) b["pos"]
      else if (truthy(b["rot"]) || (!posBit && cls in TRANSFORM_RING)) lastPosOf[k(netId)] else null
    if (truthy(pos)) {
      rec["pos"] = pos
      rec["rot"] = if (truthy(b["rot"])) b["rot"] else lastRot[k(netId)].let { if (truthy(it)) it else null }
    }
  }
}
