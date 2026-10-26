package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/record.mjs; keep in step.
//
// Map a decoded server event (events.mjs readEvent output) onto the bf42plus
// v5 replay-recording schema, so the sidecar's live stream is the same the
// replayer already reconstructs. Field names and event names are taken from
// bf42plus/src/replay.cpp verbatim.
//
// An event with no mapping returns null, and the caller writes a `raw` record
// and a review-log line: the same escape hatch bf42plus uses for events it does
// not model. A client-to-server event (and a chat fragment) returns Undefined:
// silently no record.

import io.bfstats.sidecar.JsOps.get
import io.bfstats.sidecar.JsOps.truthy

object Record {
  private fun V(v: Any?): Any? = if (v === Undefined) 0.0 else v
  // UpdateStaticObjectEvent::UpdateAction (bf42plus gameevent.h).
  private val STATIC_ACTIONS = listOf("move", "rotate", "scale", "delete")

  private fun round2(x: Any?): Double = JsOps.round(JsOps.toNumber(x) * 100) / 100
  private fun round3(x: Any?): Double = JsOps.round(JsOps.toNumber(x) * 1000) / 1000
  private fun mapList(v: Any?, f: (Any?) -> Any?): MutableList<Any?> = (v as List<*>).mapTo(ArrayList()) { f(it) }

  /** `a.slice(0, end)` with JS's end: truncated, negative from the end. */
  private fun slice0(a: List<*>, end: Double): List<*> {
    if (end.isNaN()) return emptyList<Any?>()
    var e = if (end.isInfinite()) (if (end > 0) a.size.toDouble() else 0.0) else (if (end < 0) Math.ceil(end) else Math.floor(end))
    if (e < 0) e = Math.max(0.0, a.size + e)
    return a.subList(0, Math.min(e, a.size.toDouble()).toInt())
  }

  /** decoded event -> { e, ...fields } (the caller adds k:"e" and t), null
   *  when unmapped, Undefined when it is never recorded. */
  fun recordFor(ev: Map<String, Any?>): Any? {
    fun f(k: String) = get(ev, k)
    return when (f("type")) {
      "ServerInfo" -> linkedMapOf("e" to "serverInfo", "mapId" to f("mapId"), "mod" to f("mod"), "gameId" to f("gameId"))
      "ServerInfo2" -> linkedMapOf("e" to "serverName", "name" to f("serverName"))
      "Challenge" -> linkedMapOf("e" to "challenge", "mod" to f("mod"), "xpack" to f("xpack"))
      // `nameTags`: the server's caps on the nametag distances, near and scope
      // in metres (ledger HUD-16). `minPlayers`: the players a round needs
      // before it starts (ledger HUD-24).
      "SetLevel" -> linkedMapOf<String, Any?>("e" to "setLevel", "level" to f("levelPath"), "mode" to f("modeFile")).also { r ->
        if (JsOps.isInt(f("nameTagNear")) && JsOps.isInt(f("nameTagScope"))) r["nameTags"] = mutableListOf(f("nameTagNear"), f("nameTagScope"))
        if (JsOps.isInt(f("minPlayers"))) r["minPlayers"] = f("minPlayers")
      }
      "Map" -> linkedMapOf("e" to "mapList", "add" to (if (truthy(f("add"))) 1.0 else 0.0), "map" to f("map"), "mode" to f("mode"), "mod" to f("mod"))
      "CreateMultipleObjects" -> linkedMapOf("e" to "projPool", "tid" to f("template"), "tmpl" to "", "netId" to f("firstNetId"), "count" to f("count"))
      "CreateObject" -> linkedMapOf(
        "e" to "createObject", "tid" to f("template"), "netId" to f("netId"), "tmpl" to "",
        "pos" to (if (truthy(f("pos"))) mapList(f("pos"), ::round2) else mutableListOf<Any?>(0.0, 0.0, 0.0)),
        "rot" to (if (truthy(f("rot"))) mapList(f("rot"), ::round2) else mutableListOf<Any?>(0.0, 0.0, 0.0)),
      )
      "CreatePlayer" -> linkedMapOf(
        "e" to "createPlayer", "pid" to f("playerId"), "name" to f("name"), "team" to f("team"), "ai" to (if (truthy(f("isAI"))) 1.0 else 0.0),
        "netId" to f("playerNetId"), "vehNetId" to f("vehicleNetId"), "camNetId" to f("cameraNetId"), "kitNetId" to f("kitNetId"),
      )
      "SetDefaultVehicle" -> linkedMapOf("e" to "control", "pid" to f("playerId"), "netId" to f("netId"))
      "SetVehicle" -> linkedMapOf("e" to "enterVehicle", "pid" to f("playerId"), "netId" to f("netId"))
      "ExitVehicle" -> if (truthy(f("flag"))) linkedMapOf("e" to "exitVehicle", "pid" to f("playerId"), "flag" to 1.0) else linkedMapOf("e" to "exitVehicle", "pid" to f("playerId"))
      "DestroyPlayer" -> linkedMapOf("e" to "destroyPlayer", "pid" to f("playerId"))
      "DestroyObject" -> linkedMapOf("e" to "destroyObject", "netId" to f("netId"))
      "PickupKit", "HandlePickup" -> linkedMapOf("e" to "pickupKit", "pid" to f("playerId"), "netId" to f("netId"))
      "GameRules" -> linkedMapOf(
        "e" to "gameRules", "extViews" to (if (truthy(f("externalViews"))) 1.0 else 0.0), "noseCam" to (if (truthy(f("noseCam"))) 1.0 else 0.0),
        "soldierFF" to round3(f("soldierFF")), "ticketRatio" to round3(f("ticketRatio")),
        "timeLimit" to V(f("timeLimit")), "worldTime" to V(f("worldTime")), "crosshair" to (if (truthy(f("crosshairCentre"))) 1.0 else 0.0),
      )
      "TimerSync" -> linkedMapOf("e" to "clock", "timeLimit" to f("timeLimit"), "worldTime" to f("worldTime"))
      "Simulation" -> linkedMapOf("e" to "simStart", "running" to (if (truthy(f("running"))) 1.0 else 0.0), "worldTime" to round3(f("worldTime")))
      "GameStatus" -> linkedMapOf("e" to "gameStatus", "status" to f("status"))
      "SetTeam" -> linkedMapOf("e" to "setTeam", "pid" to f("playerId"), "team" to f("team"))
      // A chat line, put back together from its ChatFragment pieces by the
      // session (chat.mjs). `team` 1 is the sender's side only; `pid` is -1
      // and `server` 1 for the server's own line.
      "Chat" -> linkedMapOf<String, Any?>("e" to "chat", "pid" to f("pid"), "text" to f("text"), "team" to (if (truthy(f("team"))) 1.0 else 0.0)).also {
        if (truthy(f("server"))) it["server"] = 1.0
      }
      "ChatFragment" -> Undefined // a piece; the session emits the line as 'Chat'
      "RadioMessage" -> linkedMapOf("e" to "radio", "pid" to f("playerId"), "msg" to f("message"), "global" to (if (truthy(f("broadcast"))) 1.0 else 0.0))
      "HitFromPos" -> linkedMapOf("e" to "hitFrom", "dir" to f("sector"), "strength" to f("strength"))
      "SessionId" -> linkedMapOf("e" to "sessionId", "id" to f("sessionId"))
      "WelcomeMsg" -> linkedMapOf("e" to "welcome", "id" to f("index"), "text" to f("message"))
      "SpecialGame" -> linkedMapOf("e" to "special", "action" to f("kind"))
      // bf42++'s own events (events.mjs, wire.md §30): the statics change the
      // world the server simulates.
      "HUDText" -> linkedMapOf("e" to "hudText", "kind" to f("kind"), "text" to f("text"))
      "CreateStaticObject" -> linkedMapOf<String, Any?>("e" to "createStatic", "tid" to f("template"), "tmpl" to "", "id" to f("objectId")).also { r ->
        if (truthy(f("hasTransform"))) { r["pos"] = mapList(f("pos"), ::round3); r["rot"] = mapList(f("rot"), ::round3) }
        if (truthy(f("hasScale"))) r["scale"] = mapList(f("scale"), ::round3)
      }
      "UpdateStaticObject" -> {
        val a = f("action")
        val name = if (JsOps.isInt(a) && (a as Double) >= 0 && a < STATIC_ACTIONS.size) STATIC_ACTIONS[a.toInt()] else null
        linkedMapOf<String, Any?>("e" to "updateStatic", "id" to f("objectId"), "action" to (name ?: a)).also { r ->
          if (truthy(f("value"))) r["value"] = mapList(f("value"), ::round3)
        }
      }
      "DataBaseComplete" -> linkedMapOf("e" to "dbComplete")
      "ScoreMsg" -> linkedMapOf<String, Any?>("e" to "score", "kind" to f("scoreType"), "pid" to f("playerId")).also { r ->
        if (f("victimId") !== Undefined) { r["victim"] = f("victimId"); r["weapon"] = f("weapon"); r["bodypart"] = f("bodyPart") }
      }
      "StatsKills", "StatsShots", "StatsHits" -> {
        val stat = when (f("type")) { "StatsKills" -> "kills"; "StatsShots" -> "shots"; else -> "hits" }
        val all = (if (truthy(f("rows"))) f("rows") else emptyList<Any?>()) as List<*>
        val rows = slice0(all, JsOps.toNumber(JsOps.coalesce(f("rowsMinus1")) { 0.0 }) + 1).mapTo(ArrayList<Any?>()) { x -> mutableListOf(get(x, "template"), get(x, "count")) }
        linkedMapOf("e" to "roundStats", "stat" to stat, "pid" to f("playerId"), "rows" to rows)
      }
      // Client-to-server events never arrive from the server; no record.
      "ConnectionType", "ChallengeResponse", "CreatePlayerAck", "DatabaseCompleteAck", "Ack", "SpawnRequest", "ChangeKit", "ReqScoutCamera" -> Undefined
      else -> null // unmapped server event -> caller writes `raw` + review
    }
  }

  /** The recording's head row; `now` is the clock in epoch ms (Node's new
   *  Date()), `start` its ISO form to the second. */
  fun header(hz: Any?, extra: Map<String, Any?> = emptyMap(), now: Long = wallMillis()): MutableMap<String, Any?> {
    val r = linkedMapOf<String, Any?>("k" to "h", "v" to 5.0, "plus" to "sidecar", "start" to isoString(now).substring(0, 19), "hz" to hz)
    return JsOps.spread(r, extra)
  }
}
