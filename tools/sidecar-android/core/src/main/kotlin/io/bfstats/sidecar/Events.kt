package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/events.mjs; keep in step.
//
// The game-event stream: the block framing and every event's wire layout.
//
// Read from bf1942_lnxded.static. The block is GameEventManager::transmit
// 0x0812d770 / processReceivedPacket 0x0812e040: an 8-bit event count, a
// 5-bit block index (the sender's counter mod 32), a 1-bit resend flag, then
// the events. Each event is its type in 7 bits (readGameEvent 0x0812e2f0,
// the rangedBits(0, 0x40) quirk) followed by its serialize() body. The ids
// are GameEvent::initEvents 0x0811bee0; the bodies are each class's
// serialize() at the address in the table.
//
// An event is a LinkedHashMap in the Node copy's key order: `type`, `id`,
// then the body. Integer fields are Long (BitReader's), floats Double, raw
// bytes ByteArray (Node's Buffer), strings String. A writer takes a body map
// whose values may be any Number, as the Node writers take any JS value: a
// missing key is the Node copy's `undefined`.

const val EVENT_TYPE_BITS = 7 // rangedBits(0, 0x40)
const val BLOCK_COUNT_BITS = 8
const val BLOCK_INDEX_BITS = 5
const val MAX_EVENTS_PER_BLOCK = 0xfe

class EventError(message: String) : RuntimeException(message)

// field kinds: u(n) unsigned, s(n) signed, b bool, f float32, bytes(n),
// str(n) fixed NUL-padded, lstr len-prefixed (8-bit length) string,
// ranged(min,max), vec3, custom
sealed class FieldKind {
  data class U(val n: Int) : FieldKind()
  data class S(val n: Int) : FieldKind()
  object B : FieldKind()
  object F : FieldKind()
  data class Bytes(val n: Int) : FieldKind()
  data class Str(val n: Int) : FieldKind()
  object LStr : FieldKind()
  data class Ranged(val min: Long, val max: Long) : FieldKind()
  object Vec3 : FieldKind()
}

private fun u(n: Int) = FieldKind.U(n)
private fun s(n: Int) = FieldKind.S(n)
private val b = FieldKind.B
private val f = FieldKind.F
private fun bytes(n: Int) = FieldKind.Bytes(n)
private fun str(n: Int) = FieldKind.Str(n)
private val lstr = FieldKind.LStr
private fun ranged(min: Long, max: Long) = FieldKind.Ranged(min, max)

typealias EventBody = LinkedHashMap<String, Any?>

class EventDef(
  val name: String,
  val id: Int,
  val addr: String?,
  val fields: List<Pair<String, FieldKind>>? = null,
  val read: ((BitReader) -> EventBody)? = null,
  val write: ((BitWriter, Map<String, Any?>) -> Unit)? = null,
)

private fun body(vararg kv: Pair<String, Any?>): EventBody = linkedMapOf(*kv)
private fun Map<String, Any?>.v(k: String): Any? = if (containsKey(k)) get(k) else Undefined

private fun latin1Text(bytes: ByteArray): String = String(bytes, Charsets.ISO_8859_1)

private fun def(name: String, id: Int, addr: String?, vararg fields: Pair<String, FieldKind>) =
  EventDef(name, id, addr, fields = fields.toList())

/** name -> its definition, in the Node copy's order. */
val EVENTS: LinkedHashMap<String, EventDef> = linkedMapOf<String, EventDef>().apply {
  fun add(d: EventDef) { put(d.name, d) }
  // BF42++'s own events (wire.md section 30). A bf42++ client registers a
  // maker for each in its event table (bf42plus src/bf/gameevent.cpp:386-388);
  // a retail client has none and drops the rest of the block on one (it
  // crashes, unpatched: 0x004b403f). Only the client's deSerialize exists in
  // bf42plus (serialize returns false), so the layouts are its readers'.
  // `addr` is null: these are not lnxded's.
  //
  // HUDTextEvent (gameevent.cpp:329): 3-bit kind (0 centre top line 2, the
  // spawn message; 1 centre top line 3, the status message; 2 the centre kill
  // message; 3 the centre yellow message), 7-bit length, that many bytes of
  // ISO-8859-1, not NUL-terminated. Length 0 clears kinds 0, 1 and 3.
  add(EventDef("HUDText", 0x01, null,
    read = { r ->
      val kind = r.readUnsigned(3)
      val len = r.readUnsigned(7)
      body("kind" to kind, "text" to latin1Text(r.readBytes(len.toInt())))
    },
    write = { w, e ->
      val enc = latin1(JsNumber.str(JsNumber.coalesce(e.v("text")) { "" }))
      val bs = enc.copyOf(minOf(enc.size, 127))
      w.writeUnsigned(JsNumber.toUint32(JsNumber.coalesce(e.v("kind")) { 0 }), 3)
      w.writeUnsigned(bs.size, 7)
      w.writeBytes(bs)
    }))
  // CreateStaticObjectEvent (gameevent.cpp:288): u32 template id (the level's
  // own numbering, ObjectTemplateManager_getTemplate), u16 the server's id for
  // the object (its own namespace, not a networkable id), bool, and when set
  // two full vectors (readFullVector, three raw float32: BF1942.exe
  // 0x00583180), position then rotation (yaw, pitch, roll degrees, applied
  // with the engine's setRotation); bool, and when set a full vector scale
  // (read and never applied).
  add(EventDef("CreateStaticObject", 0x1c, null,
    read = { r ->
      val e = body("template" to r.readUnsigned(32), "objectId" to r.readUnsigned(16), "hasTransform" to r.readBool())
      if (e["hasTransform"] == true) { e["pos"] = readVec3(r); e["rot"] = readVec3(r) }
      e["hasScale"] = r.readBool()
      if (e["hasScale"] == true) e["scale"] = readVec3(r)
      e
    },
    write = { w, e ->
      w.writeUnsigned(JsNumber.toUint32(JsNumber.coalesce(e.v("template")) { 0 }), 32)
      w.writeUnsigned(JsNumber.toUint32(JsNumber.coalesce(e.v("objectId")) { 0 }), 16)
      val t = JsNumber.truthy(e.v("pos")) || JsNumber.truthy(e.v("rot"))
      w.writeBool(t)
      if (t) { writeVec3(w, e.v("pos")); writeVec3(w, e.v("rot")) }
      w.writeBool(JsNumber.truthy(e.v("scale")))
      if (JsNumber.truthy(e.v("scale"))) writeVec3(w, e.v("scale"))
    }))
  // UpdateStaticObjectEvent (gameevent.cpp:314): u16 object id, 2-bit action
  // (0 move, 1 rotate, 2 scale, 3 delete), and a full vector for every action
  // but delete.
  add(EventDef("UpdateStaticObject", 0x1d, null,
    read = { r ->
      val e = body("objectId" to r.readUnsigned(16), "action" to r.readUnsigned(2))
      if (e["action"] != 3L) e["value"] = readVec3(r)
      e
    },
    write = { w, e ->
      w.writeUnsigned(JsNumber.toUint32(JsNumber.coalesce(e.v("objectId")) { 0 }), 16)
      w.writeUnsigned(JsNumber.toUint32(JsNumber.coalesce(e.v("action")) { 0 }), 2)
      if (!JsNumber.strictEq(JsNumber.coalesce(e.v("action")) { 0 }, 3)) writeVec3(w, e.v("value"))
    }))

  add(def("Ack", 0x02, "0x0811ff70", "value" to u(32)))
  add(def("Debug", 0x03, "0x0811e120", "number" to s(32)))
  add(def("Simulation", 0x04, "0x0811e1e0", "running" to b, "worldTime" to f))
  add(def("CreateMultipleObjects", 0x05, "0x0811d500", "template" to u(32), "firstNetId" to u(16), "count" to u(4)))
  add(def("DestroyObject", 0x06, "0x0811d660", "netId" to u(16)))
  add(EventDef("CreateObject", 0x07, "0x0811d360",
    read = { r ->
      val e = body("template" to r.readUnsigned(32), "netId" to r.readUnsigned(16), "hasTransform" to r.readBool())
      if (e["hasTransform"] == true) { e["pos"] = readVec3(r); e["rot"] = readVec3(r) }
      e
    }))
  add(def("CreatePlayer", 0x08, "0x0811ca60",
    "team" to u(3), "spawnGroup" to u(4), "isRemote" to b, "playerId" to u(8),
    "playerNetId" to u(16), "vehicleNetId" to u(16), "cameraNetId" to u(16), "kitNetId" to u(16),
    "isAI" to b, "name" to str(32)))
  add(def("SetDefaultVehicle", 0x09, "0x0811d020", "playerId" to u(8), "netId" to u(16)))
  add(def("SetVehicle", 0x0a, "0x0811ce60", "playerId" to u(8), "netId" to u(16)))
  add(def("ExitVehicle", 0x0b, "0x0811d110", "flag" to b, "playerId" to u(8)))
  add(def("DestroyPlayer", 0x0c, "0x0811cbd0", "playerId" to u(8)))
  add(def("SetPlayerName", 0x0d, "0x0811fb80", "name" to lstr, "playerId" to u(8)))
  add(def("SetTempCamera", 0x0e, "0x0811cf40", "netId" to u(16)))
  add(def("ConnectionType", 0x0f, "0x0811e5a0", "connType" to ranged(0, 6)))
  add(def("UpdateRate", 0x10, "0x0811e4d0", "rate" to u(8)))
  add(def("CreatePlayerAck", 0x11, "0x0811cc90", "playerId" to u(8)))
  add(def("Vote", 0x12, "0x0811e8b0",
    "a" to u(8), "b" to u(8), "c" to u(8), "d" to u(8), "e" to u(8), "f" to bytes(4),
    "g" to ranged(0, 4), "h" to ranged(0, 3)))
  add(EventDef("Map", 0x13, "0x0811ec40",
    read = { r ->
      val add = r.readBool(); val mapLen = r.readUnsigned(8); val modLen = r.readUnsigned(8); val mode = r.readUnsigned(8)
      body("add" to add, "mode" to mode, "map" to r.readFixedString(mapLen.toInt()), "mod" to r.readFixedString(modLen.toInt()))
    }))
  add(EventDef("Challenge", 0x14, "0x0811f1c0",
    read = { r ->
      val challenge = r.readBytes(10); val xpack = r.readSigned(32); val modLen = r.readUnsigned(8)
      val mod = r.readFixedString(modLen.toInt()); val tail = r.readBytes(8)
      body("challenge" to challenge, "xpack" to xpack, "mod" to mod, "tail" to tail)
    }))
  add(def("ChallengeResponse", 0x15, "0x0811f4c0",
    "keyHash" to bytes(73), "a" to u(32), "b" to u(32), "c" to u(32), "xpack" to s(32),
    "statsResponse" to bytes(32), "flag" to u(1)))
  add(def("GameRules", 0x16, "0x0811f780",
    "soldierFF" to f, "externalViews" to b, "noseCam" to b, "ticketRatio" to f,
    "timeLimit" to u(32), "worldTime" to u(32), "crosshairCentre" to b))
  add(def("WelcomeMsg", 0x17, "0x0811f990", "message" to lstr, "index" to s(8)))
  add(def("ResetMap", 0x18, "0x0811fc60", "value" to u(32)))
  add(EventDef("CheckSum", 0x19, "0x0811c580",
    read = { r ->
      val n1 = r.readUnsigned(8); val a = r.readBits(n1.toInt()); val n2 = r.readUnsigned(8); val c = r.readBits(n2.toInt())
      body("n1" to n1, "a" to a, "n2" to n2, "c" to c, "value" to r.readUnsigned(32))
    }))
  add(def("ServerInfo", 0x1a, "0x08120880", "mapId" to lstr, "mod" to lstr, "gameId" to lstr))
  add(def("ServerInfo2", 0x1b, "0x08120c40", "serverName" to lstr))
  add(def("FlagHolder", 0x1e, "0x0811e2b0", "flag" to b, "playerId" to u(8)))
  add(def("HandlePickup", 0x23, "0x0811d1f0", "playerId" to u(8), "netId" to u(16)))
  // serialize 0x0811db80 / deSerialize 0x0811daf0: an 8-bit status code, and
  // the five raw bytes plus the length-prefixed text ONLY when the status is
  // 5. Any other status is the code alone — reading the tail unconditionally
  // runs 56 bits into the next event and makes it look like an unknown type 0.
  add(EventDef("GameStatus", 0x24, "0x0811db80",
    read = { r ->
      val status = r.readUnsigned(8)
      if (status != 5L) body("status" to status)
      else { val extra = r.readBytes(5); body("status" to status, "extra" to extra, "text" to r.readLenString()) }
    }))
  add(def("ControlPointCaptured", 0x25, "0x0811dc80", "a" to u(8), "b" to u(8)))
  add(def("ReqScoutCamera", 0x26, "0x0811fd60", "playerId" to u(8), "netId" to u(16)))
  // 2-bit action (serialize 0x0811fe70). lnxded sends only 0, the refill
  // (GameServer::triggerSpecialGameEvent 0x081591a0); 2 is bf42++'s "do not
  // load StaticObjects.con", honoured only before the SetLevel (bf42plus
  // gameevent.cpp:225-236).
  add(def("SpecialGame", 0x27, "0x0811fe70", "kind" to u(2)))
  // One piece of a chat line (chat.mjs has the protocol). serialize 0x08120e10
  // / deSerialize 0x08120f10: bool first; ONLY on a first piece, bool team
  // (+0xe, the line's SayTarget is 0, the sender's side), bool noSender (+0xd,
  // the server's own line), bool serverFlag (+0xf), u8 sender id unless
  // noSender, u8 the whole line's length; then on every piece a 4-bit length
  // and that many bytes. A later piece carries only its length and bytes.
  add(EventDef("ChatFragment", 0x28, "0x08120e10",
    read = { r ->
      val e = body("first" to r.readBool())
      if (e["first"] == true) {
        e["team"] = r.readBool()
        e["noSender"] = r.readBool()
        e["serverFlag"] = r.readBool()
        e["playerId"] = if (e["noSender"] == true) -1L else r.readUnsigned(8)
        e["total"] = r.readUnsigned(8)
      }
      val len = r.readUnsigned(4)
      e["text"] = latin1Text(r.readBytes(len.toInt()))
      e
    },
    write = { w, e ->
      w.writeBool(JsNumber.truthy(e.v("first")))
      if (JsNumber.truthy(e.v("first"))) {
        w.writeBool(JsNumber.truthy(e.v("team")))
        w.writeBool(JsNumber.truthy(e.v("noSender")))
        w.writeBool(JsNumber.truthy(e.v("serverFlag")))
        if (!JsNumber.truthy(e.v("noSender"))) w.writeUnsigned(JsNumber.toInt32(JsNumber.coalesce(e.v("playerId")) { -1 }) and 0xff, 8)
        w.writeUnsigned(JsNumber.toInt32(JsNumber.coalesce(e.v("total")) { 0 }) and 0xff, 8)
      }
      val enc = latin1(JsNumber.str(JsNumber.coalesce(e.v("text")) { "" }))
      val bs = enc.copyOf(minOf(enc.size, 15))
      w.writeUnsigned(bs.size, 4)
      w.writeBytes(bs)
    }))
  add(def("TimerSync", 0x29, "0x0811f5f0", "timeLimit" to u(32), "worldTime" to u(32)))
  add(EventDef("ScoreMsg", 0x2a, "0x0811c8d0",
    read = { r ->
      val e = body("scoreType" to r.readRanged(0, 10), "playerId" to r.readUnsigned(8))
      if (e["scoreType"] == 3L || e["scoreType"] == 6L) {
        e["victimId"] = r.readUnsigned(8); e["weapon"] = r.readUnsigned(32); e["bodyPart"] = r.readUnsigned(8)
      }
      e
    }))
  add(EventDef("PBFragment", 0x2b, "0x081210d0",
    read = { r ->
      val e = body("flag" to r.readBool(), "a" to r.readUnsigned(32), "b" to r.readUnsigned(16))
      val len = r.readUnsigned(16)
      e["data"] = r.readBytes(len.toInt())
      e
    }))
  add(def("SpawnRequest", 0x2f, "0x0811cd70", "spawnGroup" to u(8), "spawnPoint" to u(8)))
  add(EventDef("StatsKills", 0x30, "0x0811dd90", read = ::readStats))
  add(EventDef("StatsShots", 0x31, "0x0811ded0", read = ::readStats))
  add(EventDef("StatsHits", 0x32, "0x0811e010", read = ::readStats))
  add(def("Suicide", 0x33, "0x0811e420"))
  add(def("DataBaseComplete", 0x34, "0x0811c7b0", "a" to u(16), "b" to u(16)))
  add(def("DatabaseCompleteAck", 0x35, null))
  // The settings after the two paths are what GameServer::authentificationOk
  // 0x08139950 hands sendLevelPath: Game+0x6c (getTimeAllowedOutSideWorld
  // 0x08061810), round(+0x80) and round(+0x84) (getMaxNameTagDistance
  // 0x080618a0 and ...Scoop 0x080618b0, the server's nametag caps, HUD-16),
  // +0x318, +0xc4, +0xc8, +0xcc (getMinNrOfPlayers 0x080619f0), the game
  // play mode, and +0xe0 (getTimeLimit 0x08061a40). The retail client's
  // handler (BF1942.exe 0x0049496b) stores the two caps as floats at
  // GameClient+0x88 / +0x8c and re-applies the nametag distances
  // (0x004452c0) at once. The two u32 go time limit first: serialize
  // writes +0x9a before +0x8c (0x0811d8dc, 0x0811d8ee), and sendLevelPath
  // 0x0812cc10 stores its last argument, +0xe0 (pushed first at 0x081399bf),
  // at +0x9a and the play mode at +0x8c, which the client hands its
  // vt+0x80 (0x004949d2) and compares with 1 for CTF (0x0046ae6a).
  add(def("SetLevel", 0x36, "0x0811d7e0",
    "levelPath" to str(64), "modeFile" to str(64), "outsideWorldTime" to u(8), "nameTagNear" to u(8),
    "nameTagScope" to u(16), "u8d" to u(8), "u16e" to u(16), "u16f" to u(16), "minPlayers" to u(8),
    "timeLimit" to u(32), "gamePlayMode" to u(32)))
  add(def("SessionId", 0x37, "0x0811da60", "sessionId" to str(64)))
  add(def("SetTeam", 0x39, "0x0811e390", "team" to u(8), "playerId" to u(8)))
  add(def("RadioMessage", 0x3a, "0x0811c6b0", "message" to u(16), "broadcast" to b, "playerId" to u(8)))
  add(def("TriggerObjectSpawner", 0x3b, "0x0811e650", "value" to u(8)))
  add(def("HitFromPos", 0x3c, "0x0811e770", "sector" to u(3), "strength" to u(8)))
  add(def("RemoteCommand", 0x3d, "0x0811d980", "password" to str(9), "command" to str(64)))
  add(def("ChangeKit", 0x3e, "0x0811ed50", "kit" to u(8)))
}

val EVENT_BY_ID: Map<Int, EventDef> = LinkedHashMap<Int, EventDef>().apply { for (e in EVENTS.values) put(e.id, e) }

private fun readVec3(r: BitReader): List<Double> = listOf(r.readFloat(), r.readFloat(), r.readFloat())

/** `for (const x of (v ?? [0, 0, 0])) w.writeFloat(x)`: as many floats as v holds. */
private fun writeVec3(w: BitWriter, v: Any?) {
  val xs: List<Any?> = when (v) {
    null, Undefined -> listOf(0, 0, 0)
    is List<*> -> v
    is DoubleArray -> v.toList()
    else -> throw EventError("vec3 is not iterable")
  }
  for (x in xs) w.writeFloat(JsNumber.num(x))
}

private fun readStats(r: BitReader): EventBody {
  val rows = ArrayList<Any?>()
  val e = body("rowsMinus1" to r.readUnsigned(8), "playerId" to r.readUnsigned(8), "rows" to rows)
  for (i in 0 until 10) rows.add(linkedMapOf("template" to r.readUnsigned(32), "count" to r.readUnsigned(16)))
  return e
}

private fun readField(r: BitReader, kind: FieldKind): Any? = when (kind) {
  is FieldKind.U -> r.readUnsigned(kind.n)
  is FieldKind.S -> r.readSigned(kind.n)
  FieldKind.B -> r.readBool()
  FieldKind.F -> r.readFloat()
  is FieldKind.Bytes -> r.readBytes(kind.n)
  is FieldKind.Str -> r.readFixedString(kind.n)
  FieldKind.LStr -> r.readLenString()
  is FieldKind.Ranged -> r.readRanged(kind.min, kind.max)
  FieldKind.Vec3 -> readVec3(r)
}

/** Uint8Array.from(v): each element ToUint8. */
private fun uint8From(v: Any?): ByteArray = when (v) {
  is ByteArray -> v
  is List<*> -> ByteArray(v.size) { (JsNumber.toInt32(v[it]) and 0xff).toByte() }
  is String -> ByteArray(v.length) { (JsNumber.toInt32(JsNumber.num(v[it].toString())) and 0xff).toByte() }
  else -> ByteArray(0)
}

private fun writeField(w: BitWriter, kind: FieldKind, v: Any?) {
  when (kind) {
    is FieldKind.U -> w.writeUnsigned(JsNumber.toUint32(JsNumber.coalesce(v) { 0 }), kind.n)
    is FieldKind.S -> w.writeSigned(JsNumber.toInt32(JsNumber.coalesce(v) { 0 }), kind.n)
    FieldKind.B -> w.writeBool(JsNumber.truthy(v))
    FieldKind.F -> w.writeFloat(JsNumber.num(JsNumber.coalesce(v) { 0 }))
    is FieldKind.Bytes -> {
      val out = ByteArray(kind.n)
      if (JsNumber.truthy(v)) { val src = uint8From(v); src.copyInto(out, 0, 0, minOf(src.size, kind.n)) }
      w.writeBytes(out)
    }
    is FieldKind.Str -> w.writeFixedString(JsNumber.str(JsNumber.coalesce(v) { "" }), kind.n)
    FieldKind.LStr -> {
      val enc = latin1(JsNumber.str(JsNumber.coalesce(v) { "" }))
      w.writeUnsigned(enc.size, 8)
      w.writeBytes(enc)
    }
    is FieldKind.Ranged -> {
      val x = JsNumber.coalesce(v) { kind.min }
      w.writeUnsigned(JsNumber.toUint32(JsNumber.num(x) - kind.min), rangedBits(kind.min, kind.max))
    }
    FieldKind.Vec3 -> writeVec3(w, v)
  }
}

fun readEvent(r: BitReader): EventBody {
  val id = r.readUnsigned(EVENT_TYPE_BITS)
  val def = EVENT_BY_ID[id.toInt()] ?: throw EventError("unknown event type 0x${id.toString(16)}")
  val body: EventBody
  if (def.read != null) body = def.read.invoke(r)
  else { body = EventBody(); for ((name, kind) in def.fields!!) body[name] = readField(r, kind) }
  val out = EventBody()
  out["type"] = def.name
  out["id"] = id
  out.putAll(body)
  return out
}

fun writeEvent(w: BitWriter, name: String, body: Map<String, Any?> = emptyMap()) {
  val def = EVENTS[name] ?: throw EventError("unknown event $name")
  w.writeUnsigned(def.id, EVENT_TYPE_BITS)
  if (def.write != null) return def.write.invoke(w, body)
  val fields = def.fields ?: throw EventError("event $name has no writer")
  for ((field, kind) in fields) writeField(w, kind, if (body.containsKey(field)) body[field] else Undefined)
}

class EventBlock(val count: Long, val index: Long, val resend: Boolean, val events: List<EventBody>)

// One event block as the GameEventManager frames it.
fun readEventBlock(r: BitReader): EventBlock {
  val count = r.readUnsigned(BLOCK_COUNT_BITS)
  val index = r.readUnsigned(BLOCK_INDEX_BITS)
  val resend = r.readBool()
  val events = ArrayList<EventBody>()
  for (i in 0 until count) events.add(readEvent(r))
  return EventBlock(count, index, resend, events)
}

fun writeEventBlock(w: BitWriter, index: Int, resend: Boolean, events: List<Pair<String, Map<String, Any?>>>) {
  if (events.size > MAX_EVENTS_PER_BLOCK) throw EventError("too many events in one block")
  w.writeUnsigned(events.size, BLOCK_COUNT_BITS)
  w.writeUnsigned(index and 0x1f, BLOCK_INDEX_BITS)
  w.writeBool(resend)
  for ((name, body) in events) writeEvent(w, name, body)
}

// The PlayerActionManager block: a 4-bit count, a signed 32-bit first serial,
// then count PlayerAction records of six 12-bit axes and a 32-bit button
// mask (transmit 0x08148190, PlayerAction::writeToStream 0x08148750).
fun writeActionBlock(w: BitWriter, firstSerial: Int, actions: List<Action>) {
  w.writeUnsigned(actions.size, 4)
  if (actions.isEmpty()) return
  w.writeSigned(firstSerial, 32)
  for (a in actions) {
    for (i in 0 until 6) w.writeUnsigned(if (i < a.axes.size) JsNumber.toUint32(a.axes[i]) else 2047L, 12)
    w.writeUnsigned(JsNumber.toUint32(a.buttons.toDouble()), 32)
  }
}
