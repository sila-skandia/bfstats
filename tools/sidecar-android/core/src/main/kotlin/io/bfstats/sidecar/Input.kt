package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/input.mjs; keep in step.
//
// The outbound half of playing: choose a team, a kit and a spawn point, then
// send PlayerAction records at the tick rate. This is roadmap phase E — what
// turns the sidecar from an observer into a client.
//
// Everything here is read from bf1942_lnxded.static (1.61 Linux dedicated
// server, the binary the lab runs); the addresses are the proof and the
// write-up is features/udp-sidecar/decodes/input.md.
//
//   PlayerActionManager::transmit       0x08148190  the input block (4-bit
//                                                   count, signed 32-bit first
//                                                   serial, then the records)
//   PlayerAction::writeToStream         0x08148750  six 12-bit axes, u32 buttons
//   PlayerAction::readFromStream        0x081486f0  the reader (the law)
//   PlayerAction::set                   0x081128a0  PlayerInput -> PlayerAction
//                                                   (channel order, button map)
//   PlayerAction::get                   0x0815c5a0  PlayerAction -> PlayerInput
//                                                   (the decode law)
//   floatToFixed                        0x08113480  v/16 clamped +-1, 12 bits
//   PlayerActionManager::processReceivedPacket 0x081484e0  the server's reader
//   PlayerActionManager::processRcvdPlayerActions 0x08148470  the serial check
//   PlayerActionManager::add            0x08148120  caps the client's own
//                                                   buffer at 3 records
//   SetTeamEvent::deSerialize           0x0811e340  u8 team, u8 playerId
//   ChangeKitEvent::deSerialize         0x0811ed10  u8 kit
//   SpawnRequestEvent::deSerialize      0x0811cd20  u8 spawnGroup, u8 spawnPoint
//   GameServer::handleGameEventManagerEvent 0x08135cb0  where they are consumed
//   GameServer::changeKit               0x08158700  key = team*256 + kit
//
// The three null-deref rules (see decodes/input.md §6). The server binds a
// BFPlayer to a connection while it handles CreatePlayer; before that:
//   - SpawnRequest  (0x08136be7) dereferences getPlayer() with no null check,
//   - the input stream dereferences this->player at +0x144
//     (processRcvdPlayerActions 0x08148470),
// while SetTeam (0x08136d11) and ChangeKit (0x08137080) both bail on a null
// player. So nothing but the join may be sent before the session is joined.
//
// Port notes. A page word or input spec is a JS object here too
// (`Map<String, Any?>`, as JsParse gives it) or an `Action`. Axes are doubles
// (a NaN axis is as possible as in the Node copy); buttons are a Long holding
// the JS value, int32 or uint32 as the Node copy left it. Date.now() is
// `scheduler.clock.wallMs()`, performance.now() `scheduler.clock.monoMs()`,
// setInterval `scheduler.every`, setTimeout `scheduler.schedule`.

// --- the input block ---------------------------------------------------------

const val STREAM_INPUT = 1 shl 0   // ClientConnection stream slot 0 (wire.md §2)
const val ACTION_BITS = 6 * 12 + 32 // 104: six 12-bit axes then u32 buttons
const val MAX_ACTIONS_PER_PACKET = 3 // PlayerActionManager::add 0x08148120 caps at 3
// The page's words are paced at one a server tick (`InputSender.enqueue`): a
// word made with the queue empty leaves at once if the last one left at least
// this much of a tick ago, and a sender slot releases the next waiting word if
// at least this much has passed. [free, numerics: margins for timer jitter]
private const val PACE_IMMEDIATE = 0.75
private const val PACE_SLOT = 0.5
// The records `InputSender.atAck` looks back over (a few seconds of them), and
// how long before a block arrives a record must have left to count as read
// by the server before that block's tick. [free, numerics: localhost's
// datagram is well under a millisecond; the server's own frame takes a few]
private const val RELEASED_KEEP = 128
private const val SQ_MARGIN_MS = 2
// The round trips `noteRtt` keeps (the session pings every 2 s), the least of
// which is taken out of each ack's wait: on an internet server the wait from
// a word reaching this sender to the block that says it ran is the round trip
// plus the server's buffer, and only the buffer is the page's to steer on.
private const val RTT_KEEP = 8
// The pacing's burst: page words that may leave at once above one a tick
// (`InputSender._mayRelease`). Two keep the server's buffer under D-2's four
// with a word standing, and let a frame that owed two ticks send both.
// [free, numerics]
private const val PACE_BURST = 2.0
// A queue longer than this is merged (`_mergePending`). Since 2026-10-25 the
// page holds its own margin (viewer/input-pace.js), which on a page with
// long frames is several words standing here on purpose, beyond the three
// the server is given (SERVER_KEEP): merging those ran one tick for several
// of the page's and starved the server for the rest. Twelve is the page's
// own catch-up cap (fixed-step.js MAX_CATCH_UP_TICKS), so only a page whose
// clock has run away from the server's gets here. [free, numerics]
private const val MERGE_ABOVE = 12.0
// 'server' pacing (2026-10-25): a page word leaves while the server, as this
// sender reckons it from the last ack (`_serverHeld`), would hold fewer than
// this many of our records at its next read. Its buffer keeps four (D-2), so
// three leave one spare for a reckoning a tick out. [free, numerics]
private const val SERVER_KEEP = 3
// ms from the server's tick to its block leaving, and from its read of the
// datagrams to the tick (D-1: one frame reads, ticks and sends). [free,
// numerics: the lab's frame takes a few ms]
private const val SERVER_SEND_MS = 1
private const val SERVER_READ_MS = 2
const val SERIAL_MAX = 0x3fffffffL    // writeSigned(32) = sign bit + 31 magnitude bits
const val DEFAULT_SERIAL = 1L         // the server starts at lastSerial 0, so 1 is the first it keeps

// --- axes --------------------------------------------------------------------
// The record's six channels, in wire order (PlayerAction::writeToStream
// 0x08148750 writes the short at +0, +2, +4, +6, +8, +10 in that order; the
// names are PlayerAction::set 0x081128a0's channel mapping and the c_PI* rodata
// at 0x086c86a5). Channel i of the PlayerInput is action channel i.
object AXIS {
  const val YAW = 0; const val PITCH = 1; const val ROLL = 2; const val THROTTLE = 3
  const val MOUSELOOK_X = 4; const val MOUSELOOK_Y = 5
}
val AXIS_NAMES = listOf("yaw", "pitch", "roll", "throttle", "mouseLookX", "mouseLookY")

const val AXIS_BITS = 12
const val AXIS_MAX = 4095        // (1 << 12) - 1
const val AXIS_SCALE = 16        // floatToFixed's third argument (0x41800000 = 16.0f)
const val AXIS_CENTRE = 2048     // encode(0)
const val AXIS_FULL = 2175       // encode(+1) = round(4095 * (1/16 + 1) / 2)
const val AXIS_SATURATE = 16     // a channel value's magnitude saturates here

// What the channels are, per the game's own control maps
// (Mods/bf1942/settings/default/controls/*.con in the lab install and the
// templates' setInputTo* bindings):
//
//   Yaw        A/D strafe (on foot), rudder/steering wheels (vehicles)
//   Pitch      elevator (air), boat/plane pitch trim
//   Roll       ailerons (air)
//   Throttle   W/S on foot (forward/back), engine power in a vehicle
//   MouseLookX mouse X: the aim/turret yaw
//   MouseLookY mouse Y: the aim/turret pitch
//
// A digital key press writes exactly 1.0 into its channel
// (Input::setInput 0x0815cfc0 stores (float)bool), and a joystick axis lives in
// [-1, 1]; the /16 in floatToFixed is headroom above 1.0, not the range of full
// deflection. So a full stick is 1.0 here, not 16.0. BFSoldier::handlePlayerInput
// 0x08273c70 shows what the sim does with them: Yaw and Throttle are reduced to
// their sign with a +-0.1 dead zone (`if (0.1 < throttle) 1.0 else if (< -0.1) -1.0`),
// so on foot the magnitude of the movement axes does not matter, only the sign;
// a vehicle's throttle and the mouse-look axes are the ones that use a magnitude.

// floatToFixed(v, 12, 16.0) — 0x08113480: v/16 clamped to +-1, then
// round((2^bits - 1) * (v/16 + 1) * 0.5). 0 -> 2048, +1 -> 2175, -1 -> 1920,
// +-16 saturates at 4095/0.
fun encodeAxis(channelValue: Any?): Double {
  val v = Math.max(-1.0, Math.min(1.0, JsNumber.num(channelValue) / AXIS_SCALE))
  return JsNumber.round(AXIS_MAX * (v + 1) * 0.5)
}

// PlayerAction::get 0x0815c5a0: ((2n/4095) - 1) * 16, rounded to 0.01.
fun decodeAxis(n: Double): Double = JsNumber.round((((2 * n) / AXIS_MAX) - 1) * AXIS_SCALE * 100) / 100

// --- buttons -----------------------------------------------------------------
// The 32-bit mask at record byte 12. Bit -> PlayerInput channel, from
// PlayerAction::set 0x081128a0 (which sets these bits) and PlayerAction::get
// 0x0815c5a0 (which reads them back with setInput(channel, maskBit)).
//
//   0 Fire (ch8)      1 Action (9)        2 Use (10)       3 MouseLook (11)
//   4 Walk (12)       5 Run (13)          6..14 MenuSelect1..9 (14..22)
//   15 AltFire (23)   16 Reload (24)      17 Drop (25)     18 ToggleCameraMode (26)
//   19 ToggleCamera (27) 20 Lie (28)      21 Crouch (29)   22..25 ch30..ch33
//
// Buttons are level-triggered: the mask bit means "the channel's value > 0.5",
// i.e. held, not pressed (W-1, netcode.md §1). ch48 (Communication) is not in
// the mask: it lives at byte 16, which writeToStream/readFromStream never cover
// (W-4), so it never crosses the wire and the receiver reconstructs it as 0.
object BUTTON {
  const val FIRE = 1L shl 0; const val ACTION = 1L shl 1; const val USE = 1L shl 2; const val MOUSELOOK = 1L shl 3
  const val WALK = 1L shl 4; const val RUN = 1L shl 5
  const val MENU1 = 1L shl 6; const val MENU2 = 1L shl 7; const val MENU3 = 1L shl 8; const val MENU4 = 1L shl 9
  const val MENU5 = 1L shl 10; const val MENU6 = 1L shl 11; const val MENU7 = 1L shl 12; const val MENU8 = 1L shl 13
  const val MENU9 = 1L shl 14
  const val ALT_FIRE = 1L shl 15; const val RELOAD = 1L shl 16; const val DROP = 1L shl 17
  const val TOGGLE_CAMERA_MODE = 1L shl 18; const val TOGGLE_CAMERA = 1L shl 19; const val LIE = 1L shl 20
  const val CROUCH = 1L shl 21
  const val CH30 = 1L shl 22; const val CH31 = 1L shl 23; const val CH32 = 1L shl 24; const val CH33 = 1L shl 25

  /** The table by name, in the Node copy's order. */
  val byName: Map<String, Long> = linkedMapOf(
    "FIRE" to FIRE, "ACTION" to ACTION, "USE" to USE, "MOUSELOOK" to MOUSELOOK, "WALK" to WALK, "RUN" to RUN,
    "MENU1" to MENU1, "MENU2" to MENU2, "MENU3" to MENU3, "MENU4" to MENU4, "MENU5" to MENU5,
    "MENU6" to MENU6, "MENU7" to MENU7, "MENU8" to MENU8, "MENU9" to MENU9,
    "ALT_FIRE" to ALT_FIRE, "RELOAD" to RELOAD, "DROP" to DROP, "TOGGLE_CAMERA_MODE" to TOGGLE_CAMERA_MODE,
    "TOGGLE_CAMERA" to TOGGLE_CAMERA, "LIE" to LIE, "CROUCH" to CROUCH,
    "CH30" to CH30, "CH31" to CH31, "CH32" to CH32, "CH33" to CH33,
  )
}
val BUTTON_CHANNEL: Map<String, Int> = linkedMapOf(
  "FIRE" to 8, "ACTION" to 9, "USE" to 10, "MOUSELOOK" to 11, "WALK" to 12, "RUN" to 13,
  "MENU1" to 14, "MENU2" to 15, "MENU3" to 16, "MENU4" to 17, "MENU5" to 18, "MENU6" to 19, "MENU7" to 20,
  "MENU8" to 21, "MENU9" to 22, "ALT_FIRE" to 23, "RELOAD" to 24, "DROP" to 25, "TOGGLE_CAMERA_MODE" to 26,
  "TOGGLE_CAMERA" to 27, "LIE" to 28, "CROUCH" to 29, "CH30" to 30, "CH31" to 31, "CH32" to 32, "CH33" to 33,
)
// "altFire" / "ALT_FIRE" / "alt_fire" all reach BUTTON.ALT_FIRE.
private val CAMEL_TO_SNAKE: Map<String, String> = BUTTON.byName.keys.associateBy { it.replace("_", "") }

class InputError(message: String) : RuntimeException(message)

private fun u32(v: Long) = v and 0xffffffffL
private fun i32(v: Long) = v.toInt()

/** JS `typeof`, for the error texts. */
private fun typeOf(v: Any?): String = when (v) {
  Undefined -> "undefined"; is Boolean -> "boolean"; is Number -> "number"; is String -> "string"
  is Function<*> -> "function"; else -> "object"
}

// A button mask from names: buttonMask('FIRE') / buttonMask(['FIRE','CROUCH']) /
// buttonMask('FIRE|CROUCH') / buttonMask({ fire: true }). Unknown names throw:
// a typo in a mask is a silent nothing in the game otherwise.
fun buttonMask(spec: Any?): Long {
  if (JsNumber.nullish(spec)) return 0
  if (spec is Number) return JsNumber.toUint32(spec)
  if (spec is String) return buttonMask(spec.split(Regex("[|,\\s]+")).filter { it.isNotEmpty() })
  if (spec is List<*>) {
    var m = 0
    for (s in spec) m = m or (if (s is Number) JsNumber.toInt32(s) else i32(lookupButton(s)))
    return u32(m.toLong())
  }
  if (spec is Map<*, *>) {
    var m = 0
    for ((k, v) in spec) if (JsNumber.truthy(v)) m = m or i32(lookupButton(k))
    return u32(m.toLong())
  }
  throw InputError("buttonMask: cannot read ${typeOf(spec)}")
}
private fun lookupButton(name: Any?): Long {
  val key = JsNumber.trim(JsNumber.str(name)).uppercase().replace(Regex("[^A-Z0-9]"), "_")
  val bit = BUTTON.byName[key] ?: CAMEL_TO_SNAKE[key.replace("_", "")]?.let { BUTTON.byName[it] }
  return bit ?: throw InputError("unknown button \"${JsNumber.str(name)}\"")
}

/** One PlayerAction: six axes (12-bit values, as doubles) and the button mask. */
class Action(val axes: DoubleArray, val buttons: Long) {
  fun toJs(): LinkedHashMap<String, Any?> = linkedMapOf<String, Any?>("axes" to axes, "buttons" to buttons)
  /** The JS object view, for the shape tests below. */
  fun asInput(): Map<String, Any?> = linkedMapOf("axes" to axes.toList(), "buttons" to buttons)
}

val ZERO_ACTION = Action(DoubleArray(6) { AXIS_CENTRE.toDouble() }, 0)

private fun centres() = DoubleArray(6) { AXIS_CENTRE.toDouble() }
private fun Map<*, *>.js(k: String): Any? = if (containsKey(k)) get(k) else Undefined
private fun indexOf(v: Any?, i: Int): Any? = when (v) {
  is List<*> -> if (i < v.size) v[i] else Undefined
  is DoubleArray -> if (i < v.size) v[i] else Undefined
  is Map<*, *> -> v.js(i.toString())
  else -> Undefined
}

private fun asMap(input: Any?): Map<*, *> = when (input) {
  is Action -> input.asInput()
  is Map<*, *> -> input
  else -> emptyMap<String, Any?>()
}

// Encode one PlayerAction: axes in channel units (see the table above), buttons
// as a mask or names. Returns { axes: [6 ints], buttons: u32 } — the shape
// events.mjs's writeActionBlock takes.
fun encodeAction(input: Any? = emptyMap<String, Any?>()): Action {
  val inp = asMap(input)
  val axes = centres()
  val src = inp.js("axes")
  if (src is List<*> || src is DoubleArray) {
    for (i in 0 until 6) { val x = indexOf(src, i); if (x !== Undefined) axes[i] = encodeAxis(x) }
  } else if (src is Map<*, *>) {
    for (i in 0 until 6) {
      val v = JsNumber.coalesce(src.js(AXIS_NAMES[i])) { src.js(AXIS_NAMES[i].uppercase()) }
      if (v !== Undefined) axes[i] = encodeAxis(v)
    }
  } else if (JsNumber.truthy(inp.js("channels"))) {
    val ch = inp.js("channels")
    for (i in 0 until 6) { val x = indexOf(ch, i); if (x !== Undefined) axes[i] = encodeAxis(x) }
  }
  for (i in 0 until 6) {
    val k = AXIS_NAMES[i]
    if (inp.js(k) !== Undefined) axes[i] = encodeAxis(inp.js(k))
  }
  val buttons = if (inp.js("buttons") !== Undefined) buttonMask(inp.js("buttons"))
    else if (inp.js("mask") !== Undefined) buttonMask(inp.js("mask")) else 0L
  return Action(axes, buttons)
}

// The page's natural shape: held keys and a look delta. Everything is optional;
// what is not given is neutral, so a partial update is a full record (the
// engine's own buffers are full records too).
fun actionFor(state: Any? = emptyMap<String, Any?>()): Action {
  val st = asMap(state)
  val axes = centres()
  fun t(k: String) = JsNumber.truthy(st.js(k))
  fun set(i: Int, v: Any?) { if (JsNumber.truthy(v)) axes[i] = encodeAxis(v) }
  set(AXIS.THROTTLE, (if (t("forward")) 1 else 0) + (if (t("back")) -1 else 0))
  set(AXIS.YAW, (if (t("right")) 1 else 0) + (if (t("left")) -1 else 0))
  set(AXIS.PITCH, (if (t("pitchUp")) 1 else 0) + (if (t("pitchDown")) -1 else 0))
  set(AXIS.ROLL, (if (t("rollRight")) 1 else 0) + (if (t("rollLeft")) -1 else 0))
  set(AXIS.MOUSELOOK_X, JsNumber.coalesce(st.js("lookX")) { 0 })
  set(AXIS.MOUSELOOK_Y, JsNumber.coalesce(st.js("lookY")) { 0 })
  var buttons = 0
  if (t("fire")) buttons = buttons or BUTTON.FIRE.toInt()
  if (t("altFire")) buttons = buttons or BUTTON.ALT_FIRE.toInt()
  if (t("use")) buttons = buttons or BUTTON.USE.toInt()
  if (t("reload")) buttons = buttons or BUTTON.RELOAD.toInt()
  if (t("drop")) buttons = buttons or BUTTON.DROP.toInt()
  if (t("walk")) buttons = buttons or BUTTON.WALK.toInt()
  if (t("run")) buttons = buttons or BUTTON.RUN.toInt()
  if (t("crouch")) buttons = buttons or BUTTON.CROUCH.toInt()
  if (t("lie")) buttons = buttons or BUTTON.LIE.toInt()
  if (t("action")) buttons = buttons or BUTTON.ACTION.toInt()
  for (i in 1..9) if (t("menu$i")) buttons = buttons or BUTTON.byName["MENU$i"]!!.toInt()
  buttons = buttons or i32(buttonMask(JsNumber.coalesce(st.js("buttons")) { 0 }))
  return Action(axes, buttons.toLong())
}

// True when the object is meant as an encoded record or explicit axes/buttons
// rather than the key-state shape actionFor() reads. Used by InputSender so a
// page can send either.
private val ENCODED_KEYS = setOf("axes", "channels", "buttons", "mask") + AXIS_NAMES
fun isEncodedShape(input: Any?): Boolean {
  for (k in asMap(input).keys) if (k in ENCODED_KEYS) return true
  return false
}
// An already-quantised record is passed through as-is; anything else is encoded.
fun normaliseAction(input: Any?): Action {
  val inp = asMap(input)
  val a = inp.js("axes")
  val list: List<Any?>? = when (a) { is List<*> -> a; is DoubleArray -> a.toList(); else -> null }
  if (list != null && list.size == 6 && list.all { JsNumber.isInteger(it) && (it as Number).toDouble() >= 0 && it.toDouble() <= AXIS_MAX }) {
    val b = JsNumber.coalesce(inp.js("buttons")) { JsNumber.coalesce(inp.js("mask")) { 0 } }
    return Action(DoubleArray(6) { (list[it] as Number).toDouble() }, buttonMask(b))
  }
  return encodeAction(input)
}

// The input block for one datagram: the 6-bit stream-presence mask (bit 0 set)
// then PlayerActionManager::transmit's framing via events.mjs's writer.
// 6 + 4 + 32 + 104 * n bits, byte-aligned by the BitWriter (19 bytes for one
// action). The count is 4 bits (R-2), so at most 15 records parse; the client's
// own manager holds 3 (PlayerActionManager::add 0x08148120), which is the cap
// this module keeps.
fun inputPayload(actions: List<Action>, firstSerial: Long, maskBits: Int = STREAM_INPUT): ByteArray {
  if (actions.size > MAX_ACTIONS_PER_PACKET) {
    throw InputError("${actions.size} actions > $MAX_ACTIONS_PER_PACKET (PlayerActionManager::add caps at 3)")
  }
  val w = BitWriter(64)
  w.writeUnsigned(maskBits, 6)
  writeActionBlock(w, JsNumber.toInt32(firstSerial.toDouble()), actions)
  return w.bytes()
}

// Read an input block back: the mask, the count, the first serial and the
// records, with the axes decoded to channel units. The round-trip half of the
// encoder, and what selfTest() checks itself against.
fun decodeInputBlock(bytes: ByteArray, bitLength: Int = bytes.size * 8): LinkedHashMap<String, Any?> {
  val r = BitReader(bytes, bitLength)
  val mask = r.readUnsigned(6)
  val count = r.readUnsigned(4)
  val actions = ArrayList<Any?>()
  val out = linkedMapOf<String, Any?>("mask" to mask, "count" to count, "actions" to actions)
  if (count > 0) {
    val first = r.readSigned(32)
    out["firstSerial"] = first
    for (i in 0 until count) {
      val axes = ArrayList<Long>()
      for (a in 0 until 6) axes.add(r.readUnsigned(12))
      val buttons = r.readUnsigned(32)
      actions.add(linkedMapOf("axes" to axes, "buttons" to buttons, "serial" to first + i,
        "channels" to axes.map { decodeAxis(it.toDouble()) }))
    }
  }
  out["bits"] = r.pos
  return out
}

// --- the sender --------------------------------------------------------------

const val TICK_RATE = 30   // GameServer's fixed 30 Hz step (D-1/D-3)
private const val MAX_RATE = 60

/** What the sender needs of the session (session.mjs's `conn` and `joined`). */
interface InputConn {
  /** 'connected' when datagrams may go. */
  val state: String
  /** NetConn.sendData: returns the datagram's seq; may throw. */
  fun sendData(payload: ByteArray, meta: Map<String, Any?>): Any?
}
interface InputPlayer { val playerId: Any?; val team: Any? }
interface ChatOut { fun say(text: String, team: Boolean): Boolean }
interface InputSession {
  val conn: InputConn?
  val joined: Boolean
  val me: InputPlayer?
  fun queue(name: String, body: Map<String, Any?>)
  val chatOut: ChatOut?
}

class InputSenderOptions(
  val rate: Any? = null,
  val idle: String? = null,
  val idleAfterMs: Double? = null,
  val firstSerial: Long? = null,
  val action: Action? = null,
  val maxQueue: Int? = null,
  val idleButtons: (() -> Any?)? = null,
  val clock: (() -> Double)? = null,
  val mergeAbove: Double? = null,
  val pace: String? = null,
)

class InputStats {
  var ticks = 0; var sent = 0; var actions = 0; var skipped = 0; var errors = 0
  var lastError: String? = null
  /** Absent until the first drop, as the Node copy's `stats.dropped`. */
  var dropped: Int? = null
  fun toJs(): LinkedHashMap<String, Any?> = linkedMapOf<String, Any?>("ticks" to ticks, "sent" to sent, "actions" to actions,
    "skipped" to skipped, "errors" to errors, "lastError" to lastError).also { if (dropped != null) it["dropped"] = dropped }
}
class InputPath {
  var acks = 0; var ticks = 0.0; var starved = 0.0; var trimmed = 0.0; var merged = 0
  fun toJs(): LinkedHashMap<String, Any?> = linkedMapOf<String, Any?>("acks" to acks, "ticks" to ticks, "starved" to starved,
    "trimmed" to trimmed, "merged" to merged)
}
/** A page word: one engine record with its own serial. `recvAt` is null on no word the Node copy makes. */
class Word(val action: Action, val tag: Any?, val serial: Long, val recvAt: Double?, val merged: Int? = null)
class Released(val serial: Long, val recvAt: Double?, val relAt: Double)

/** `atAck`'s row. */
class AckPath(val iq: Int, val sq: Int, val starved: Double, val trimmed: Double, val lead: Double?, val hold: Double?, val rtt: Double) {
  fun toJs(): LinkedHashMap<String, Any?> = linkedMapOf<String, Any?>("iq" to iq, "sq" to sq, "starved" to starved,
    "trimmed" to trimmed, "lead" to lead, "hold" to hold, "rtt" to rtt)
}

// Streams PlayerAction records at `rate` through the session's connection.
//
//   val sender = InputSender(session, InputSenderOptions(), scheduler)  // 30 Hz, idle: 'zero'
//   sender.start()
//   sender.setInput(mapOf("forward" to true, "lookX" to 2.5))
//
// Behaviour when the page stops sending (the browser bridge owns this: a
// background tab's timers are throttled, so the sidecar must not depend on it):
//   idle: 'zero'  (default) keep sending a neutral record at the tick rate —
//                 the wire rhythm stays constant and the soldier stops.
//   idle: 'hold'  keep sending the last record (a held key stays held).
//   idle: 'stop'  send nothing; the server's empty buffer is simulated as zero
//                 input anyway (D-4), so the soldier stops with less traffic.
// The three differ only in traffic and in whether a key stays down; all three
// leave the server simulating zero input if the page never sends.
class InputSender(val session: InputSession?, opts: InputSenderOptions = InputSenderOptions(), val scheduler: Scheduler) {
  val rate: Double = clampRate(opts.rate ?: TICK_RATE)
  val idle: String = opts.idle ?: "zero"
  init { if (idle !in listOf("zero", "hold", "stop")) throw InputError("unknown idle mode \"$idle\"") }
  var idleAfterMs: Double = opts.idleAfterMs ?: 250.0
  var serial: Long = opts.firstSerial ?: DEFAULT_SERIAL
  var action: Action = opts.action ?: ZERO_ACTION
  val stats = InputStats()
  internal var _timer: Cancellable? = null
  internal var _nextAt = 0.0
  internal var _lastInputAt = 0.0
  internal var _sentOnce = false
  private val _listeners = ArrayList<Pair<String, (Any?) -> Unit>>()
  // The page's own words, one per world tick, each sent as exactly one
  // engine record (enqueue). The look axes are per-tick deltas
  // (c_PIMouseLookX/Y), so a word sent twice turns the server's soldier
  // twice and a word dropped turns him not at all: a latest-value slot
  // re-sampled on this timer duplicated and dropped them against the page's
  // bursty frames, and the server's facing walked away from the page's.
  var recent: List<Word> = emptyList()   // the last words sent, resent beside each new one
  var pending: MutableList<Word> = ArrayList()  // words not yet on the wire (before the join, or paced)
  val maxQueue: Int = opts.maxQueue ?: 24
  // When the last page word went on the wire (`_flushWords`), for the pacing.
  internal var _releasedAt = Double.NEGATIVE_INFINITY
  // Buttons an idle record carries (the caller's held presses): a press made
  // while the page sends no words (its deploy screen) still reaches the
  // server, as it would from a retail client, which never stops sending.
  val idleButtons: (() -> Any?)? = opts.idleButtons
  // Every record put on the wire as a new serial, oldest first: its serial,
  // when the page's word reached this sender (`recvAt`, null for an idle
  // record) and when it left (`relAt`), on `performance.now()`. What
  // `atAck` reads the server's buffer and its starved ticks from.
  val released = ArrayList<Released>()
  private var _ack: Pair<Long, Double?>? = null   // { serial, tick } of the previous acknowledgement
  val path = InputPath()
  // The clock those times are on (a test passes its own).
  val clock: () -> Double = opts.clock ?: { scheduler.clock.monoMs() }
  // A queue longer than this after a hitch is merged into two words at once
  // (`_mergePending`), rather than drained one a tick: Infinity turns it off.
  val mergeAbove: Double = opts.mergeAbove ?: MERGE_ABOVE
  // 'server' (2026-10-25): a page word leaves while the server would hold
  // fewer than SERVER_KEEP of ours (`_serverHeld`), checked at every pump,
  // and through the bucket until the first ack. 'bucket' (2026-10-24): a
  // page word leaves the moment one a tick allows, with a burst of
  // PACE_BURST; the bucket's refill is one a tick on this sender's clock at
  // whatever phase the page's frames gave it, so a word that had come in
  // time waited past the server's read (lab, 2026-10-25). 'slot': the law
  // before, which held a word that came less than 3/4 of a tick after the
  // last one for the sender's own 30 Hz slot, whose phase against the
  // server's tick is arbitrary.
  val pace: String = opts.pace ?: "server"
  private var _ackAt: Pair<Double, Long>? = null   // { at, serial } of the newest ack, on `clock`
  private var _viaBucket = false
  internal var _tokens = PACE_BURST
  internal var _tokensAt: Double? = null
  internal val _rtts = ArrayList<Double>()

  private fun dateNow() = scheduler.clock.wallMs()

  // A ping's round trip (ms), from the session's 'pong'.
  fun noteRtt(ms: Double) {
    if (ms.isNaN() || ms.isInfinite() || ms < 0 || ms > 5000) return
    _rtts.add(ms)
    if (_rtts.size > RTT_KEEP) _rtts.removeAt(0)
  }

  // The least recent round trip, 0 before the first ping (localhost's).
  fun rttMs(): Double = if (_rtts.isNotEmpty()) _rtts.min() else 0.0

  // The bucket: refills one a tick up to PACE_BURST, and a word needs one.
  // Holding a word the server could have run is a tick added to it and to
  // every word behind it; at the server's buffer of four (D-2), two at once
  // above the rate are safe, and a slow frame's eleven (D-7) still leave one
  // a tick after the first two.
  internal fun _mayRelease(at: Double): Boolean {
    _viaBucket = false
    if (pace == "server") {
      val held = _serverHeld(clock())
      if (held != null) return held < SERVER_KEEP
    }
    _viaBucket = true
    val ta = _tokensAt
    if (ta != null && at > ta) {
      _tokens = Math.min(PACE_BURST, _tokens + (at - ta) / periodMs)
    }
    if (ta == null || at > ta) _tokensAt = at
    // Wall-clock ms are ~1.8e12, whose float step (~2e-4 ms) is ~1e-5 of a
    // tick: a refill of exactly one period can come back 0.99999, which held
    // a word a whole tick more.
    return _tokens >= 1 - 1e-4
  }

  internal fun _spend() { if (_viaBucket) _tokens -= 1 }

  /**
   * How many of our records the server will hold when a record released at
   * `now` (on `clock`) reaches it, reckoned from the newest ack: its tick
   * was a one-way trip (half the least round trip) and SERVER_SEND_MS
   * before the block arrived, and every 1/30 s since, the server read
   * whatever had reached it SERVER_READ_MS before its tick and ran the
   * oldest record it held (D-1, D-3). Every record released before `now`
   * lands before this one, so the reckoning runs to `now` plus the one-way
   * trip.
   *
   * Until 2026-10-25 it ran only to `now` and counted the records still in
   * flight as held: on an internet server those are a one-way trip of
   * words, 3.4 at MoonGamers' 228 ms, already past SERVER_KEEP with the
   * server's buffer empty. The sender then let a word go only when one left
   * the reckoning, about 23 a second for the page's 30; the page's words
   * stood here to twelve, were merged into one record, and the server ran
   * one tick of motion for twelve of the page's, so every 1.4 s the
   * correction pulled the player back about half a second of his run
   * (live, Kursk, 2026-10-25; tests/test_input_tick.py `owd115`). On
   * localhost the trip is nil and the two reckonings are one.
   *
   * Null with no ack, or one too old to reckon from (then the bucket paces).
   */
  internal fun _serverHeld(now: Double): Int? {
    val a = _ackAt ?: return null
    val half = rttMs() / 2
    val tick0 = a.first - half - SERVER_SEND_MS
    if (now - tick0 > 1000) return null
    val arrive = ArrayList<Double>()
    for (r in released) if (serialNewer(r.serial, a.second)) arrive.add(r.relAt + half)
    var ran = 0
    var t = tick0 + periodMs
    while (t <= now + half + SERVER_READ_MS) {
      if (ran < arrive.size && arrive[ran] <= t - SERVER_READ_MS) ran++
      t += periodMs
    }
    return arrive.size - ran
  }

  // Release waiting words while the pacing allows (the pump's, between slots).
  internal fun _drain() {
    while (pending.isNotEmpty() && _mayRelease(dateNow()) && _flushWords()) _spend()
  }

  private fun _noteReleased(serial: Long, recvAt: Double?) {
    released.add(Released(serial, recvAt, clock()))
    if (released.size > RELEASED_KEEP) released.subList(0, released.size - RELEASED_KEEP).clear()
  }

  /**
   * The input path's state at an acknowledgement: a control-object state
   * whose serial echo is `serial` (the newest record the server has run) for
   * server tick `tick`, read the moment its datagram arrived.
   *
   *   iq       page words waiting here, not yet on the wire (`pending`)
   *   sq       records on the wire the server holds unrun: released more than
   *            the round trip plus `SQ_MARGIN_MS` before this block arrived
   *            (the server reads its datagrams, ticks and sends in one frame,
   *            D-1, so those were read before the tick; a younger one was
   *            still in flight) with a serial newer than the echo
   *   starved  server ticks since the last acknowledgement that ran no record
   *            of ours (D-4's zeroed input): ticks advanced less records run
   *   trimmed  records the server skipped (D-2's trim), the other way round
   *   lead     ms from the acked word reaching this sender to the block that
   *            says it ran, less the round trip (null for an idle record):
   *            the page's word's wait for its tick, here and in the server's
   *            buffer. With the round trip in, a 170 ms internet server read
   *            as a 200 ms backlog, and the page ran its clock 6% slow for
   *            good: 1.8 ticks a second of zero input on the server.
   *   rtt      the round trip taken out (`rttMs`)
   *   hold     ms of that spent here, in `pending`
   *
   * `tick` null is the Node copy's `c.tick ?? null`.
   */
  fun atAck(serial: Long, tick: Double?): AckPath {
    val at = clock()
    val rtt = rttMs()
    val iq = pending.size
    var sq = 0; var run = 0
    var acked: Released? = null
    val prev = _ack
    for (r in released) {
      if (serialNewer(r.serial, serial)) { if (r.relAt < at - rtt - SQ_MARGIN_MS) sq++; continue }
      if (r.serial == serial) acked = r
      if (prev != null && serialNewer(r.serial, prev.first)) run++
    }
    var starved = 0.0; var trimmed = 0.0
    // A state with no tick (0: none yet, a free camera's) counts nothing.
    val pt = prev?.second
    if (prev != null && tick != null && tick > 0 && pt != null && pt > 0 && tick >= pt && !serialNewer(prev.first, serial)) {
      val dt = tick - pt
      if (dt > run) starved = dt - run else trimmed = run - dt
      path.ticks += dt
    }
    path.acks += 1
    path.starved += starved
    path.trimmed += trimmed
    _ack = serial to tick
    _ackAt = at to serial
    val ra = acked?.recvAt
    val lead = if (acked != null && ra != null) Math.max(0.0, at - ra - rtt) else null
    val hold = if (acked != null && ra != null) acked.relAt - ra else null
    return AckPath(iq, sq, starved, trimmed, lead, hold, rtt)
  }

  // One page word: one engine record with its own serial, on the wire the
  // moment the page produces it, the way the retail client sends each tick's
  // record as it builds it. Every datagram also carries the two words before
  // it under their own serials, so a lost datagram costs nothing:
  // processRcvdPlayerActions (0x08148470) drops any serial no newer than the
  // last it used (D-4), so a repeat is free and a burst never overflows the
  // server's buffer of four (D-1). `tag` rides to the 'sent' event (the
  // page's own seq, for the ack).
  //
  // **At most one new word per server tick.** The server keeps at most four
  // buffered actions a frame, dropping the oldest (`clearPlayerActions`
  // 0x0815bb90, D-2), and consumes one a tick (D-3). A page whose frame is
  // slow makes a frame's worth of ticks at once (11 words at 2.7 fps on DC El
  // Alamein, 2026-10-17); sent as made, about half were trimmed and the
  // server simulated zero input on the ticks it then had nothing for. Its
  // soldier walked at 0.73 m/s against 1.59 for the same words sent evenly
  // (live, `staticcol/burst.mjs`), and the page, which had run all eleven,
  // was corrected back 0.6 to 1.2 m on every ack. So words leave through a
  // bucket of one a tick with a burst of two (`_mayRelease`); the rest wait
  // in `pending` and leave as it refills (`_tick`). A page at 60 fps sees no
  // added delay; a slow one sees its words reach the server late but all of
  // them, in order, one a tick. Until 2026-10-24 a word left at once only
  // when the queue was empty and the previous one had left most of a tick
  // ago, else at the sender's own 30 Hz slot (`pace: 'slot'`); with a page's
  // frames jittering, that held a word past the tick it could have made, and
  // the server starved with a word waiting here (wire.md section 39).
  //
  // What this replaced: words queued and drained up to three NEW ones per
  // 30 Hz slot, with a held repeat filling any slot the page had not reached.
  // The repeats were ticks the server ran and the page never had, mapped to
  // the page's last word for the ack, so every correction was measured a
  // tick off (p90 0.21 m, one tick of a run) and the bursts of three new
  // words overflowed the server's buffer and dropped words the page had run:
  // the body stuttered and slid sideways while turning (live, 2026-10-16).
  fun enqueue(input: Any?, tag: Any? = null): Action {
    val action = if (JsNumber.truthy(input)) (if (isEncodedShape(input)) normaliseAction(input) else actionFor(input)) else ZERO_ACTION
    this.action = action
    _lastInputAt = dateNow()
    val word = Word(action, tag, serial, clock())
    serial = nextSerial(serial)
    pending.add(word)
    if (pending.size > mergeAbove) _mergePending()
    if (pending.size > maxQueue) { pending.removeAt(0); stats.dropped = (stats.dropped ?: 0) + 1 }
    if (pace == "slot") {
      if (pending.size == 1 && dateNow() - _releasedAt >= periodMs * PACE_IMMEDIATE) _flushWords()
    } else {
      _drain()
    }
    return action
  }

  // A hitch's backlog, at once: every waiting word but the newest becomes one
  // record, so the queue is two words and its latency goes with it rather
  // than draining one a tick. Nothing the page did is lost: the look axes
  // are per-tick deltas and are summed (saturating at the record's range,
  // AXIS_SATURATE a tick); a one-shot press in any of them is pressed once,
  // and the prone toggle once per odd number of changes; every other channel
  // and held button is the newest word's, a level. The record keeps the
  // newest merged word's serial and tag, so the ack maps to the page tick
  // whose state it reflects; the page's reconciler takes the newest of its
  // ticks at or below an ack (netcode-reconcile.js `accept`), and the server
  // ran one tick of motion for several of the page's, which is the
  // correction this costs. The skipped serials are free: the server keeps
  // any serial newer than its last (D-4).
  internal fun _mergePending() {
    val group = pending.subList(0, pending.size - 1).toList()
    if (group.size < 2) return
    val newest = group[group.size - 1]
    val axes = newest.action.axes.copyOf()
    for (ch in listOf(AXIS.MOUSELOOK_X, AXIS.MOUSELOOK_Y)) {
      var sum = 0.0
      for (w in group) sum += w.action.axes[ch] - AXIS_CENTRE
      axes[ch] = Math.max(0.0, Math.min(AXIS_MAX.toDouble(), AXIS_CENTRE + sum))
    }
    var presses = 0L; var toggles = 0L
    for (w in group) {
      presses = u32(presses or (w.action.buttons and ONE_SHOT_BUTTONS and TOGGLE_STATE_BUTTONS.inv()))
      toggles = u32(toggles xor (w.action.buttons and TOGGLE_STATE_BUTTONS))
    }
    val buttons = u32((newest.action.buttons and ONE_SHOT_BUTTONS.inv()) or presses or toggles)
    val merged = Word(Action(axes, buttons), newest.tag, newest.serial, group[0].recvAt, group.size)
    pending = arrayListOf(merged, pending[pending.size - 1])
    path.merged += group.size - 1
    _emit("merged", linkedMapOf("words" to group.size, "serial" to merged.serial, "tag" to merged.tag))
  }

  // Put the oldest waiting word on the wire, beside the two released before
  // it (oldest first, consecutive serials), once the connection can take it;
  // announce it as sent. One word a call: the pacing is the callers'.
  internal fun _flushWords(): Boolean {
    if (pending.isEmpty()) return false
    val conn = session?.conn
    if (conn == null || conn.state != "connected" || !session.joined) return false
    val word = pending[0]
    val last = recent.lastOrNull()
    val words = if (last != null && nextSerial(last.serial) == word.serial) (recent + word).toMutableList() else mutableListOf(word)
    if (words.size > MAX_ACTIONS_PER_PACKET) words.removeAt(0)
    try {
      val seq = conn.sendData(inputPayload(words.map { it.action }, words[0].serial), linkedMapOf("input" to words[0].serial))
      stats.sent += 1
      stats.actions += words.size
      _sentOnce = true
      recent = words
      pending.removeAt(0)
      _noteReleased(word.serial, word.recvAt)
      _releasedAt = dateNow()
      _emit("sent", linkedMapOf("serial" to word.serial, "seq" to seq, "action" to word.action, "tag" to word.tag,
        "idle" to false, "recvAt" to word.recvAt, "relAt" to clock()))
      return true
    } catch (e: Exception) {
      stats.errors += 1
      stats.lastError = e.message
      _emit("error", e)
      return false
    }
  }

  val periodMs: Double get() = 1000 / rate
  val running: Boolean get() = _timer != null

  // A page input update. Takes either the state shape actionFor() reads
  // ({ forward, fire, lookX, ... }) or an already-encoded record
  // ({ axes, buttons }). Encodes immediately, so a bad axis or button name
  // throws at the caller rather than inside the send timer.
  fun setInput(input: Any?): Action {
    if (!JsNumber.truthy(input)) { action = ZERO_ACTION; return action }
    action = if (isEncodedShape(input)) normaliseAction(input) else actionFor(input)
    _lastInputAt = dateNow()
    return action
  }

  fun setAction(action: Any?) = setInput(action)

  // Held-button helpers, for a page that tracks keyup/keydown separately.
  fun press(buttons: Any?) = setInput(linkedMapOf("axes" to action.axes.toList(), "buttons" to (i32(action.buttons) or i32(buttonMask(buttons))).toLong()))
  fun release(buttons: Any?) = setInput(linkedMapOf("axes" to action.axes.toList(), "buttons" to (i32(action.buttons) and i32(buttonMask(buttons)).inv()).toLong()))

  fun start(): InputSender {
    if (_timer != null) return this
    _nextAt = dateNow() + periodMs
    // Poll faster than the period so the wall-clock slots, not the timer, set
    // the cadence: setInterval alone drifts a few ms per second, and a rate
    // that falls below the server's tick rate leaves it simulating zero input
    // on the ticks nothing arrives for.
    val poll = Math.max(5.0, Math.floor(periodMs / 2))
    _timer = scheduler.every(poll) { _pump() }
    _emit("started", linkedMapOf("rate" to rate, "idle" to idle, "serial" to serial))
    return this
  }

  fun stop(): InputSender {
    val t = _timer ?: return this
    t.cancel()
    _timer = null
    _emit("stopped", linkedMapOf("sent" to stats.sent, "actions" to stats.actions))
    return this
  }

  fun on(name: String, fn: (Any?) -> Unit): InputSender { _listeners.add(name to fn); return this }
  private fun _emit(name: String, payload: Any?) { for ((n, fn) in _listeners.toList()) if (n == name) fn(payload) }

  internal fun _pump() {
    val now = dateNow()
    // The server's reckoning moves with its ticks, not this sender's slots.
    if (pace == "server" && pending.isNotEmpty()) _drain()
    var sent = 0
    while (now >= _nextAt && sent < 4) {   // catch up at most 4 slots
      _tick(_nextAt)
      _nextAt += periodMs
      sent += 1
    }
    if (now > _nextAt + periodMs * 8) _nextAt = now + periodMs // fell far behind
  }

  internal fun _tick(slotAt: Double = dateNow()) {
    stats.ticks += 1
    val conn = session?.conn
    if (conn == null || conn.state != "connected" || !session.joined) {
      // Never send input before the server has a BFPlayer bound to this
      // connection: processRcvdPlayerActions dereferences it (crash rule 2).
      stats.skipped += 1
      return
    }
    // A page driving the soldier owns every serial: its words go out as it
    // makes them (enqueue). A slot it has not reached is not filled, for the
    // server's empty buffer is zero input on its own (D-4) and a filler would
    // be a tick the page never ran. Only a page gone quiet hands the
    // cadence back to the idle records.
    if (pending.isNotEmpty()) {
      // A slot hard on a word released at once (`enqueue`) leaves the next
      // for the slot after: one new word a tick.
      // A late timer's catch-up slots are each a tick: timed by the slot.
      if (pace == "slot") {
        if (slotAt - _releasedAt >= periodMs * PACE_SLOT && _flushWords()) _releasedAt = slotAt
      } else {
        while (pending.isNotEmpty() && _mayRelease(slotAt) && _flushWords()) _spend()
      }
      return
    }
    val fresh = dateNow() - _lastInputAt < idleAfterMs
    if (fresh) { stats.skipped += 1; return }
    if (idle == "stop") { stats.skipped += 1; return }
    var held = if (idle == "hold") holdOf(action) else ZERO_ACTION
    val extra = if (idleButtons != null) JsNumber.toUint32(idleButtons.invoke()) else 0L
    if (extra != 0L) held = Action(held.axes, u32(held.buttons or extra))
    val batch = listOf(held to null as Any?)
    val idle = true
    recent = emptyList()
    val serial = this.serial
    try {
      val payload = inputPayload(batch.map { it.first }, serial)
      val seq = conn.sendData(payload, linkedMapOf("input" to serial))
      stats.sent += 1
      stats.actions += batch.size
      _sentOnce = true
      var sr = serial
      for (b in batch) {
        _noteReleased(sr, null)
        _emit("sent", linkedMapOf("serial" to sr, "seq" to seq, "action" to b.first, "tag" to b.second, "idle" to idle,
          "recvAt" to null, "relAt" to clock()))
        sr = nextSerial(sr)
      }
      this.serial = sr
    } catch (e: Exception) {
      // A full send window or a closed socket must not kill the sender: the
      // action is dropped, and the server's empty-buffer law covers the tick.
      stats.errors += 1
      stats.lastError = e.message
      _emit("error", e)
    }
  }
}

// The non-repetitive triggers (c_CMNonRepetive in Infantry.con: Action, the
// MenuSelects, Reload, Drop, Lie, the camera toggles) are one-tick presses on
// the wire; the push-and-hold ones stay down while held.
val ONE_SHOT_BUTTONS: Long = u32(BUTTON.ACTION or BUTTON.RELOAD or BUTTON.DROP or BUTTON.LIE
  or BUTTON.MENU1 or BUTTON.MENU2 or BUTTON.MENU3 or BUTTON.MENU4 or BUTTON.MENU5
  or BUTTON.MENU6 or BUTTON.MENU7 or BUTTON.MENU8 or BUTTON.MENU9
  or BUTTON.TOGGLE_CAMERA_MODE or BUTTON.TOGGLE_CAMERA)

// The room protocol's word (the page's) speaks levels: a push-and-hold key
// while held, its prone bit the page's toggle STATE, its jump bit the held
// key. The engine's record carries the client's control map already applied:
// push-and-hold triggers (Fire, Crouch, Walk, Use) down while held, and every
// c_CMNonRepetive trigger (Infantry.con: Action, Reload, Drop, Lie, the
// MenuSelects, the camera toggles) down for ONE tick per press, because
// BFSoldier::handlePlayerInput 0x08273c70 acts on every tick a channel is
// down (the Lie arm at 0x08275593 tests channel 28 each tick against the
// current state's flags). Held as a level, Lie toggled the server's soldier
// prone and back for as long as the page lay down (live, 2026-10-16). This
// turns one into the other for every bit at once: a non-repetitive bit is
// pressed on its rising edge, and a toggle-state bit (Lie) on each change.
val TOGGLE_STATE_BUTTONS: Long = BUTTON.LIE
class PageButtonEdges {
  var prev = 0L
  fun reset() { prev = 0 }
  fun apply(levels: Any?, extra: Any? = 0): Long {
    val now = JsNumber.toUint32(levels)
    val rising = u32(now and prev.inv())
    val changed = u32(now xor prev)
    var b = u32(now and ONE_SHOT_BUTTONS.inv())
    b = u32(b or (rising and ONE_SHOT_BUTTONS and TOGGLE_STATE_BUTTONS.inv()))
    if ((changed and TOGGLE_STATE_BUTTONS) != 0L) b = u32(b or (changed and TOGGLE_STATE_BUTTONS))
    prev = now
    return u32(b or JsNumber.toUint32(extra))
  }
}

// A held record's repeat: the same keys, no look delta, no one-shot press.
fun holdOf(action: Action): Action {
  val axes = action.axes.copyOf()
  axes[AXIS.MOUSELOOK_X] = AXIS_CENTRE.toDouble()
  axes[AXIS.MOUSELOOK_Y] = AXIS_CENTRE.toDouble()
  return Action(axes, u32(action.buttons and ONE_SHOT_BUTTONS.inv()))
}

private fun clampRate(rate: Any?): Double {
  val r = JsNumber.num(rate)
  if (r.isNaN() || r.isInfinite() || r <= 0) throw InputError("bad rate ${JsNumber.str(rate)}")
  if (r > MAX_RATE) throw InputError("rate ${JsNumber.str(r)} > $MAX_RATE")
  return r
}
/**
 * The input index the server runs a record at, from its serial (ledger
 * DEV-14): what `Game::getCurrentInputIndex` returns while that record's tick
 * runs, and so what `FireArms::fireBarrel` 0x0828aba0 draws a round's
 * deviation from (`(index + barrel) & 0x3ff`, DEV-9). The server queues a
 * human's records with `ActionBuffer::pushBack` 0x08112750
 * (`processRcvdPlayerActions` 0x08148470), which keeps the record's own
 * +0x14, and that is the serial the record came under (+0x88 of the received
 * entry, the field D-4 dedupes on); `simulatePlayerUpdate` 0x0815bd00 sets
 * Game+0x68 from it. `ActionBuffer::add` 0x081125c0, which would number them
 * by arrival, has no caller. So the index is the serial itself: idle records
 * count, and the serials a merge skips (`_mergePending`) are skipped by it
 * too. Measured on the lab with the recorder reading Game+0x68 at each
 * round (`lab/dev_index_probe.mjs`): 30 of 30 BAR rounds drew at their fire
 * word's serial, from serial 5623 on, through a merge and an idle spell.
 * A tick with nothing queued runs at the last record's index + 1.
 */
fun actionIndexOf(serial: Any?): Any? = if (JsNumber.isInteger(serial)) serial else null

// Signed 32-bit serials wrap to 1 past SERIAL_MAX (nextSerial): newer is
// ahead by less than half the range.
internal fun serialNewer(a: Long, b: Long): Boolean {
  val d = (a - b).toDouble()
  return if (d > 0) d < SERIAL_MAX / 2.0 else d < -SERIAL_MAX / 2.0
}
internal fun nextSerial(serial: Long): Long {
  val n = serial + 1
  return if (n > SERIAL_MAX) 1 else n   // the server compares signed 32-bit, keeps strictly greater
}

// --- team, kit, spawn --------------------------------------------------------

const val SPAWN_GROUP_MAX = 0x7f   // BFSpawnPointTemplate::createObject 0x0816a650: "Spawngroup to big" above 0x7f
object TEAMS { const val AXIS = 1; const val ALLIES = 2 }  // what the lab's Wake round logs (Init.con game.setKit 1|2, spawnEvent team)

private fun requirePlayer(session: InputSession?) {
  if (session == null || session.me == null || JsNumber.nullish(session.me!!.playerId)) {
    throw InputError("no player bound to the connection yet: send nothing but the join until the server has created your player")
  }
}

// SetTeamEvent (0x39): u8 team, u8 playerId. The server ignores the playerId
// and applies the team to the connection's own player (0x08136d11 reads byte
// +0xd and calls vtable+0x51); it also bails out on a null player, so this is
// safe but pointless before the player exists.
fun sendTeam(session: InputSession?, team: Any?, playerId: Any? = null): Map<String, Any?> {
  requirePlayer(session)
  session!!.queue("SetTeam", linkedMapOf("team" to (JsNumber.toInt32(team) and 0xff),
    "playerId" to (JsNumber.toInt32(JsNumber.coalesce(playerId) { session.me!!.playerId }) and 0xff)))
  return linkedMapOf("team" to team)
}

// ChangeKitEvent (0x3e): u8 kit. The kit is the per-team slot index of the
// level's `game.setKit <team> <slot> <kit>` lines: GameServer::changeKit
// 0x08158700 looks the pair up as key (team << 8) | kit in its kit table.
// Wake: 1 -> 0 Jap_Scout 1 Jap_Assault 2 Jap_AT 3 Jap_Medic 4 Jap_Engineer,
//       2 -> 0 US_Scout 1 Us_Assault 2 Us_AT 3 US_Medic 4 US_Engineer.
fun sendKit(session: InputSession?, kit: Any?): Map<String, Any?> {
  requirePlayer(session)
  val k = JsNumber.num(kit)
  if (k < 0 || k > 0xff) throw InputError("kit ${JsNumber.str(kit)} out of range")
  session!!.queue("ChangeKit", linkedMapOf("kit" to (JsNumber.toInt32(kit) and 0xff)))
  return linkedMapOf("kit" to kit)
}

// A chat line (chat.mjs): queued on the session's ChatSender, which sends it
// as the retail client's StringManager does, a ChatFragment of up to 15 bytes
// every 0.5 s, the text cut to 63 and at most four lines waiting. `team` is
// team chat (SayTarget 0): the server relays it to the sender's side only.
// Returns false when the line was dropped (empty, or four already waiting).
// The server never sends a player his own line, so the caller shows it.
fun sendChat(session: InputSession?, text: String, team: Any? = false): Boolean {
  requirePlayer(session)
  val out = session!!.chatOut ?: throw InputError("Cannot read properties of undefined (reading 'say')")
  return out.say(text, JsNumber.truthy(team))
}

// SpawnRequestEvent (0x2f): u8 spawnGroup, u8 kit.
//
// The second byte is the KIT, not a spawn point: the handler stores it at
// BFPlayer+0x80, the field GameServer::changeKit 0x08158700 writes the kit
// index to, and the lab settles it (2026-10-16): ChangeKit 2 then
// SpawnRequest(3, 0) spawned a USMarine_Scout, ChangeKit 0 then
// SpawnRequest(3, 3) a USMarine_Medic. The point inside the group is the
// server's choice (GameServer::spawnPlayer 0x0814c990 asks
// BFSpawnGroup::getSpawnPoint): three spawns into group 3 landed on three
// different points. The wire field keeps its old name, spawnPoint.
// spawnGroup is the level's spawn group id — the control point's
// `ObjectTemplate.spawnGroupId` (Wake Conquest: The_Beach 1, The_Airfield 2,
// South_Base 3, North_Base 4, and the fifth flag 5), or 64..83 for the
// ship-borne groups declared in Game/GlobalSpawnGroups.con. 0..127 is legal
// (BFPlayer::init 0x08052c70 zeroes anything outside it); 0 clears the group
// and makes the server ignore the second byte (handler 0x08136be7).
fun sendSpawnRequest(session: InputSession?, spawnGroup: Any? = 0, spawnPoint: Any? = 0): Map<String, Any?> {
  requirePlayer(session)
  val g = JsNumber.num(spawnGroup)
  if (g < 0 || g > SPAWN_GROUP_MAX) throw InputError("spawnGroup ${JsNumber.str(spawnGroup)} > $SPAWN_GROUP_MAX")
  session!!.queue("SpawnRequest", linkedMapOf("spawnGroup" to (JsNumber.toInt32(spawnGroup) and 0xff),
    "spawnPoint" to (JsNumber.toInt32(spawnPoint) and 0xff)))
  return linkedMapOf("spawnGroup" to spawnGroup, "spawnPoint" to spawnPoint)
}

class SpawnOptions(val team: Any? = null, val kit: Any? = null, val spawnGroup: Any? = 0, val spawnPoint: Any? = 0, val stepMs: Double = 100.0)

// The spawn sequence: team, then kit, then the spawn request, one event per
// step and `stepMs` apart (the join's own rule is that events which bind state
// to a player must not share a datagram with the event that creates it, J-8;
// the session flushes every 33 ms, so a step is a tick or two).
//
// Ordering caveat, read but not settled live: SpawnRequest's second byte and
// ChangeKit's kit byte both land on BFPlayer+0x80 (0x08136c33 / 0x081588c8),
// so whichever goes last wins that field. ChangeKit after the spawn request is
// therefore the safe order if the kit comes out wrong — see decodes/input.md §5.
//
// The Node copy is async; here each delay is a `scheduler.schedule`, and
// `done` gets what the promise would settle with (a throw at any step is a
// failure, as the promise's rejection).
fun spawnSequence(session: InputSession?, opts: SpawnOptions, scheduler: Scheduler, done: (Result<List<String>>) -> Unit = {}) {
  val sent = ArrayList<String>()
  fun safe(fn: () -> Unit) { try { fn() } catch (e: Exception) { done(Result.failure(e)) } }
  fun step(next: () -> Unit) { if (opts.stepMs != 0.0 && !opts.stepMs.isNaN()) scheduler.schedule(opts.stepMs) { safe(next) } else next() }
  fun last() {
    // The request's second byte is the kit (above), so it carries the kit when
    // one is given; spawnPoint is only the fallback for callers that name none.
    sendSpawnRequest(session, opts.spawnGroup, JsNumber.coalesce(opts.kit) { opts.spawnPoint })
    sent.add("SpawnRequest")
    done(Result.success(sent))
  }
  fun kit() {
    if (!JsNumber.nullish(opts.kit)) {
      sendKit(session, opts.kit)
      sent.add("ChangeKit")
      step(::last)
    } else last()
  }
  safe {
    requirePlayer(session)
    if (!JsNumber.nullish(opts.team) && !JsNumber.strictEq(opts.team, session!!.me!!.team)) {
      sendTeam(session, opts.team)
      sent.add("SetTeam")
      step(::kit)
    } else kit()
  }
}
