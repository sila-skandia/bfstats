package io.bfstats.sidecar

// Port of tools/bf1942-models/sidecar/netconn.mjs; keep in step.
//
// The datagram layer: dice::ref2::io::NetServer / SWConnection, from the
// client's side. Every number here is read from bf1942_lnxded.static; the
// addresses are in features/udp-sidecar/wire.md.
//
// A datagram is a 7-byte header and a payload:
//   [0]    connection id (the one ConnectAccept assigned; anything before)
//   [1]    bits 0-5 sequence, bits 6-7 the two low bits of the ack sequence
//   [2]    bits 0-3 the four high bits of the ack sequence, bits 4-7 the type
//   [3..6] ack mask, little-endian: bit i says whether sequence (ack - i)
//          was received
// Types: 1 ConnectRequest (84 bytes), 2 ConnectAccept (13), 3 ConnectDenied
// (16), 4 ConnectAcceptAck (8), 5 Disconnect (524), 7 PingRequest (13),
// 8 PingResponse (17), 9 ServerInfoRequest, 0xa ServerInfo (136), 0xf Data.
//
// Node's dgram socket is the Transport below: UdpTransport is the real one (a
// DatagramSocket and a receive thread that posts onto the Scheduler's loop), and a
// test passes a fake. Math.random (the lab's loss and jitter) is `random`.

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.SocketTimeoutException
import kotlin.concurrent.thread

object PT {
  const val ConnectRequest = 1; const val ConnectAccept = 2; const val ConnectDenied = 3; const val ConnectAcceptAck = 4
  const val Disconnect = 5; const val PingRequest = 7; const val PingResponse = 8; const val ServerInfoRequest = 9; const val ServerInfo = 0xa
  const val Data = 0xf
}

val PRESULT: Map<Long, String> = mapOf(
  0L to "PROk", 1L to "PRNewConnection", 2L to "PRServerIsFull", 4L to "PRConnectFailed", 5L to "PRInvalidParam",
  6L to "PRSocketFailed", 7L to "PRAllocFailed", 8L to "PRNoPacket", 9L to "PRFailed", 10L to "PRTimeOut",
  11L to "PRIgnored", 12L to "PRSystem", 13L to "PRDisconnect", 14L to "PRRecvBufferOverflow",
  15L to "PRSendBufferOverflow", 16L to "PRPacketTooBig", 17L to "PRInvalidPassword", 18L to "PRConnecting",
  0x17L to "VersionTooOld", 0x18L to "VersionTooNew", 0x1eL to "PRInvalidReservedPassword",
  // Not PResults but the game's own disconnect and denial reasons, carried in
  // the same field (rejoin.mjs): GameServer::kickPlayers 0x08148b20 closes a
  // kicked player with 0x15 and a banned one with 0x16 (handleConnectRequest
  // 0x08436810 denies a banned address with 0x16 too), and gameStatusEndGame
  // 0x08152ca0 closes every connection with 0x19 before the server restarts
  // itself for the next level.
  0x15L to "Kicked", 0x16L to "Banned", 0x19L to "LevelChange",
  // 0x1b: handleGameEventManagerEvent closes a connection whose
  // ChallengeResponse checksum failed (0x081368d7) or whose content Ack did
  // not match the level's contentCrc32.con row (0x08136cc3, content-crc.mjs).
  0x1bL to "ContentCheckFailed",
)

/** PRESULT[reason] ?? `0x${reason.toString(16)}`. */
fun presultName(reason: Long): String = PRESULT[reason] ?: "0x${JsOps.hex(reason)}"

const val PROTOCOL_MAJOR = 0x1002L // NetServer::checkVersion 0x084367d0
const val PROTOCOL_MINOR = 1610L   // *(0x086b1580), passed to setVersion by GameServer::startServer
const val MAX_DATAGRAM = 0x5c0     // 1472, the server's receive buffer
const val MAX_PAYLOAD = 0x5c0 - 9  // addPacketToSendBuffer: payload + 9 < 0x5c1

private const val SEQ_MASK = 0x3f
private const val SEQ_HALF = 0x20

/** Buffer#write(s, at, 'latin1'): as many of s's units as fit. */
private fun ByteArray.writeLatin1(s: String, at: Int) {
  val b = latin1(s)
  b.copyInto(this, at, 0, minOf(b.size, size - at))
}

// ConnectRequestPacket, 84 bytes (handleConnectRequest 0x08436810; the retail
// client's builder is BF1942.exe 0x0060f300): [8] u32 major, [12] u32 minor,
// [16..79] the server password, [80..83] the reconnect password. The client
// fills both with strncpy: the password to 0x20 bytes, the reconnect password
// to 4 (0x0060f332 / 0x0060f34f), so a shorter one is NUL-padded and an empty
// one is four zeros. The reconnect password is the four digits a server's
// GameStatus 5 carried before it restarted for the next level (rejoin.mjs);
// NetServer::checkReconnectPassword 0x08436750 compares exactly four bytes.
fun buildConnectRequest(password: String = "", reconnectPassword: String = ""): ByteArray {
  val b = ByteArray(0x54)
  b[2] = (PT.ConnectRequest shl 4).toByte()
  b.putU32le(8, PROTOCOL_MAJOR)
  b.putU32le(12, PROTOCOL_MINOR)
  // strncpy(+16, pw, 0x20) (0x0060f323): a longer password is cut at 32
  // bytes, so a server whose password is longer refuses retail and us alike.
  b.writeLatin1(password.take(0x20), 16)
  b.writeLatin1(reconnectPassword.take(4), 80)
  return b
}

// ServerInfoRequestPacket: the retail client's wait-for-server probe
// (BF1942.exe 0x004b7030) sends 8 bytes whose only set field is the type
// nibble 9; the server answers any length with a 136-byte ServerInfo
// (NetServer::_update 0x08433e60 dispatches type 9 before any connection
// lookup -> handleServerInfoRequest 0x08436e60 -> sendServerInfo 0x08436280:
// [0] 1, type 0xa, [8..] the server's name).
fun buildServerInfoRequest(): ByteArray {
  val b = ByteArray(8)
  b[2] = (PT.ServerInfoRequest shl 4).toByte()
  return b
}

fun parseServerInfo(buf: ByteArray?): Map<String, Any?>? {
  if (buf == null || buf.size < 7 || (buf.u8(2) shr 4) != PT.ServerInfo) return null
  return linkedMapOf("name" to if (buf.size > 8) cstr(buf.copyOfRange(8, buf.size)) else "")
}

// Ask a server whether it is up, as the retail client does while it waits for
// a restarting server: one ServerInfoRequest, and the answer or null.
// Blocking (the Node copy's promise); call it off the loop.
fun probeServerInfo(host: String, port: Int, timeoutMs: Int = 1500): Map<String, Any?>? {
  val deadline = System.nanoTime() + timeoutMs * 1_000_000L
  return try {
    DatagramSocket().use { sock ->
      val req = buildServerInfoRequest()
      sock.send(DatagramPacket(req, req.size, InetAddress.getByName(host), port))
      val buf = ByteArray(65536)
      while (true) {
        val left = ((deadline - System.nanoTime()) / 1_000_000L).toInt()
        if (left <= 0) return null
        sock.soTimeout = left
        val p = DatagramPacket(buf, buf.size)
        try { sock.receive(p) } catch (_: SocketTimeoutException) { return null }
        val info = parseServerInfo(buf.copyOf(p.length))
        if (info != null) return info
      }
      @Suppress("UNREACHABLE_CODE") null
    }
  } catch (_: Exception) { null }
}

/** Node's dgram socket, as NetConnection uses it. */
interface Transport {
  /** Called on the loop with each datagram and its sender. */
  var onMessage: (ByteArray, InetSocketAddress) -> Unit
  /** Bind an ephemeral port; returns the local address. */
  fun bind(): InetSocketAddress
  /** Queue a send; `done` runs on the loop once it has gone (or failed). */
  fun send(b: ByteArray, port: Int, host: String, done: (Throwable?) -> Unit)
  fun close()
}

/** The real socket: a DatagramSocket, a receive thread posting onto `loop`,
 *  and a send thread so a send's callback comes later, as dgram's does. */
class UdpTransport(private val loop: Scheduler) : Transport {
  override var onMessage: (ByteArray, InetSocketAddress) -> Unit = { _, _ -> }
  private val sock = DatagramSocket(null as java.net.SocketAddress?)
  private val sends = java.util.concurrent.Executors.newSingleThreadExecutor { r -> Thread(r, "sidecar-udp-send").apply { isDaemon = true } }
  @Volatile private var closed = false

  override fun bind(): InetSocketAddress {
    sock.bind(InetSocketAddress(0))
    thread(name = "sidecar-udp-recv", isDaemon = true) {
      val buf = ByteArray(65536)
      while (!closed) {
        val p = DatagramPacket(buf, buf.size)
        try { sock.receive(p) } catch (_: Exception) { if (closed) break else continue }
        val msg = buf.copyOf(p.length)
        val from = InetSocketAddress(p.address, p.port)
        loop.post { onMessage(msg, from) }
      }
    }
    return sock.localSocketAddress as InetSocketAddress
  }

  override fun send(b: ByteArray, port: Int, host: String, done: (Throwable?) -> Unit) {
    val copy = b.copyOf()
    sends.execute {
      val err = try { sock.send(DatagramPacket(copy, copy.size, InetAddress.getByName(host), port)); null } catch (e: Exception) { e }
      loop.post { done(err) }
    }
  }

  override fun close() {
    if (closed) return
    closed = true
    // Sends already queued still go, as dgram's do before the close.
    sends.execute { sock.close() }
    sends.shutdown()
  }
}

/** The lab's network stand-ins (SIDECAR_LAG_MS, SIDECAR_JITTER_MS, SIDECAR_LOSS). */
data class PathFaults(val lagMs: Double = 0.0, val jitterMs: Double = 0.0, val loss: Double = 0.0) {
  companion object {
    // SIDECAR_LAG_MS: a lab stand-in for an internet server's round trip,
    // half of it on each direction (a probe of a law at 170 ms, say).
    // SIDECAR_JITTER_MS adds a uniform 0..J ms to each datagram's delay, each
    // way (so datagrams reorder, as an internet path's do), and SIDECAR_LOSS
    // drops that share of them each way (0.02 is 2 %).
    fun fromEnv(env: Map<String, String?> = System.getenv()): PathFaults = PathFaults(
      lagMs = maxOf(0.0, JsOps.numberOr0(env["SIDECAR_LAG_MS"])) / 2,
      jitterMs = maxOf(0.0, JsOps.numberOr0(env["SIDECAR_JITTER_MS"])),
      loss = minOf(1.0, maxOf(0.0, JsOps.numberOr0(env["SIDECAR_LOSS"]))),
    )
  }
}

class NetStats {
  var sent = 0; var received = 0; var lost = 0; var duplicates = 0
  var rttMs: Long? = null
  fun toJs(): Map<String, Any?> = linkedMapOf("sent" to sent, "received" to received, "lost" to lost, "duplicates" to duplicates, "rttMs" to rttMs)
}

/**
 * Events (the Node copy's): connected {id, serverTime}; denied {reason, name};
 * disconnected {reason, name, message}; pong rttMs; data (payload, seq);
 * server-info {name}|null; unknown (type, buf); status {seq, delivered, tag};
 * raw-in (buf, from); raw-out buf.
 */
class NetConnection(
  val host: String,
  val port: Int,
  val timers: Scheduler,
  val password: String = "",
  val reconnectPassword: String = "",
  // Identify as a bf42++ client in the ConnectAcceptAck (plus.mjs), or
  // null to send the retail ack. A server reads only the id and the type
  // of it, so a retail server is indifferent; a bf42++-aware one reads the
  // marker and may then send bf42++'s own events (events.mjs).
  val plus: PlusIdentity? = PlusIdentity(),
  val log: (String) -> Unit = {},
  faults: PathFaults = PathFaults.fromEnv(),
  /** Math.random, for the loss and jitter. */
  val random: () -> Double = Math::random,
  transport: Transport? = null,
) : Emitter(), InputConn {
  var sock: Transport = transport ?: UdpTransport(timers)
  val lagMs = faults.lagMs
  val jitterMs = faults.jitterMs
  val loss = faults.loss

  override var state = "closed" // closed | connecting | accepted | connected
  var id = -1
  val t0 = timers.now()
  // SWConnection::reset 0x0843b820
  var sendSeq = 1          // +0x5c, next sequence to send
  var lastRecv = 0         // +0x60, last sequence received
  var lastConfirmed = 0    // +0x64, last sequence the peer acked
  var recvMask = 0         // +0xec, received history, bit 0 = lastRecv (u32 bits)
  var lastSentSeq = -1     // +0x68
  /** seq -> tag, for delivery status. */
  val sentPackets = LinkedHashMap<Int, Any?>()
  val stats = NetStats()
  private var connectTimer: Cancellable? = null
  var serverTime: Long = 0
  /** The last datagram from the server (Session's quiet watchdog). */
  var lastHeardAt = timers.now()
  var pending = 0; private set
  private var closeWhenSent = false

  init {
    sock.onMessage = { msg, rinfo ->
      val ms = pathDelay()
      if (ms != null) {
        if (ms != 0.0) timers.schedule(ms) { onDatagram(msg, rinfo) }
        else onDatagram(msg, rinfo)
      }
    }
  }

  fun now(): Long = (timers.now() - t0) and 0xffffffffL

  fun bind(): InetSocketAddress = sock.bind()

  fun close() {
    connectTimer?.cancel()
    state = "closed"
    // dgram sends are queued: closing at once drops a goodbye still in the
    // queue, so the socket closes when the last send has gone.
    if (pending > 0) { closeWhenSent = true; return }
    try { sock.close() } catch (_: Exception) { /* already closed */ }
  }

  // --- the handshake -------------------------------------------------------

  // ConnectRequestPacket, 84 bytes (buildConnectRequest above).
  fun connect() {
    val b = buildConnectRequest(password = password, reconnectPassword = reconnectPassword)
    state = "connecting"
    val send = { if (state == "connecting") raw(b) }
    send()
    connectTimer = timers.every(1000.0, send)
  }

  private fun onConnectAccept(buf: ByteArray) {
    // 13 bytes: [8] the id this connection gets, [9..12] the server's ms clock
    // (sendConnectAccept 0x08436110). The ack is 8 bytes with our id in
    // byte 0 and type 4 (handleConnectAcceptAck 0x08436560).
    if (state != "connecting" && state != "accepted") return
    connectTimer?.cancel()
    // A short accept reads undefined in Node (id NaN -> byte 0, serverTime
    // throws); the server always sends 13.
    id = buf.u8(8)
    serverTime = buf.u32le(9)
    state = "accepted"
    val ack: ByteArray
    if (plus != null) {
      ack = buildPlusAcceptAck(id, plus.version, plus.protocol)
    } else {
      ack = ByteArray(8)
      ack[0] = id.toByte()
      ack[2] = (PT.ConnectAcceptAck shl 4).toByte()
    }
    raw(ack)
    state = "connected"
    emit("connected", linkedMapOf<String, Any?>("id" to id, "serverTime" to serverTime))
  }

  // DisconnectPacket, 0x20c bytes: [8] u32 reason, [12..] 512-char message
  // (sendDisconnect 0x08436360). The client sends reason 0xd (J-3), three
  // copies back to back (a retail leave from a 1.612 server, 2026-10-24:
  // three Disconnects with one sequence inside 0.2 ms), so one lost datagram
  // does not leave the server pinging a ghost until it times out.
  fun disconnect(reason: Long = 0xd, message: String = "") {
    if (state != "connected") return
    val b = header(PT.Disconnect, 0x20c)
    b.putU32le(8, reason)
    b.writeLatin1(message.take(511), 12)
    for (i in 0 until 3) raw(b)
    state = "closed"
  }

  // --- data ---------------------------------------------------------------

  // One datagram carrying one payload; the engine's u16 length prefix at
  // byte 7 (addPacketToSendBuffer 0x0843bb80). Returns the sequence used.
  /** InputConn: the input sender's tag is its meta object. */
  override fun sendData(payload: ByteArray, meta: Map<String, Any?>): Any? = sendData(payload, meta as Any?)

  fun sendData(payload: ByteArray, tag: Any? = null): Int {
    if (state != "connected") throw IllegalStateException("not connected")
    if (payload.size > MAX_PAYLOAD) throw IllegalStateException("payload ${payload.size} > $MAX_PAYLOAD")
    // SWConnection::send 0x0843be80: no more than 30 sequences ahead of the last ack.
    val seq = sendSeq and SEQ_MASK
    if (((seq - lastConfirmed) and SEQ_MASK) > 0x1e) throw IllegalStateException("send window full")
    val b = header(PT.Data, 9 + payload.size, seq)
    b.putU16le(7, payload.size)
    payload.copyInto(b, 9)
    raw(b)
    sendSeq++
    lastSentSeq = seq
    sentPackets[seq] = tag
    stats.sent++
    return seq
  }

  // PingRequestPacket, 13 bytes: [8] u32 our clock, [12] 1 if we ever sent
  // data (sendPingRequest 0x08436040 / SWConnection::sendPingRequest
  // 0x0843bae0). The sequence field repeats our last data sequence.
  fun pingRequest() {
    if (state != "connected") return
    val b = header(PT.PingRequest, 13, lastSentSeq and SEQ_MASK)
    b.putU32le(8, now())
    b[12] = if (lastSentSeq != -1) 1 else 0
    raw(b)
  }

  // PingResponsePacket, 17 bytes: [8] the request's clock, [12] ours,
  // [16] the same flag (sendPingResponse 0x08435f70).
  private fun pingResponse(echo: Long) {
    val b = header(PT.PingResponse, 17, lastSentSeq and SEQ_MASK)
    b.putU32le(8, echo)
    b.putU32le(12, now())
    b[16] = if (lastSentSeq != -1) 1 else 0
    raw(b)
  }

  private fun header(type: Int, size: Int, seq: Int = 0): ByteArray {
    val b = ByteArray(size)
    b[0] = (id and 0xff).toByte()
    b[1] = ((seq and SEQ_MASK) or ((lastRecv and 3) shl 6)).toByte()
    b[2] = ((type shl 4) or ((lastRecv shr 2) and 0xf)).toByte()
    b.putU32le(3, recvMask.toLong() and 0xffffffffL)
    return b
  }

  private fun sockClose() { try { sock.close() } catch (_: Exception) { /* already closed */ } }

  private fun raw(b: ByteArray) {
    pending++
    val ms = pathDelay()
    if (ms == null) {
      // Lost on the way: nothing goes out, and the close it may gate still runs.
      if (--pending == 0 && closeWhenSent) { closeWhenSent = false; sockClose() }
      emit("raw-out", b)
      return
    }
    if (ms != 0.0) { timers.schedule(ms) { send(b) }; emit("raw-out", b); return }
    send(b)
    emit("raw-out", b)
  }

  // One direction's delay for a datagram, ms, or null for one the path loses
  // (the lab's stand-ins above; 0 on a plain run).
  private fun pathDelay(): Double? {
    if (loss != 0.0 && random() < loss) return null
    return lagMs + (if (jitterMs != 0.0) random() * jitterMs else 0.0)
  }

  private fun send(b: ByteArray) {
    sock.send(b, port, host) {
      if (--pending == 0 && closeWhenSent) { closeWhenSent = false; sockClose() }
    }
  }

  // --- receive --------------------------------------------------------------

  fun onDatagram(buf: ByteArray, rinfo: InetSocketAddress?) {
    emit("raw-in", buf, rinfo)
    if (buf.size < 7) return
    lastHeardAt = timers.now()
    val type = buf.u8(2) shr 4
    when (type) {
      PT.ConnectAccept -> onConnectAccept(buf)
      PT.ConnectDenied -> {
        connectTimer?.cancel()
        val reason = if (buf.size >= 12) buf.u32le(8) else -1L
        state = "closed"
        emit("denied", linkedMapOf<String, Any?>("reason" to reason, "name" to presultName(reason)))
      }
      PT.Disconnect -> {
        val reason = if (buf.size >= 12) buf.u32le(8) else -1L
        val message = if (buf.size > 12) cstr(buf.copyOfRange(12, buf.size)) else ""
        state = "closed"
        emit("disconnected", linkedMapOf<String, Any?>("reason" to reason, "name" to presultName(reason), "message" to message))
      }
      PT.PingRequest -> {
        if (buf.size != 13 || state != "connected") return
        if (buf.u8(12) == 1) accountSeq(buf.u8(1) and SEQ_MASK, false)
        confirm(buf)
        pingResponse(buf.u32le(8))
      }
      PT.PingResponse -> {
        if (buf.size != 17 || state != "connected") return
        if (buf.u8(16) == 1) accountSeq(buf.u8(1) and SEQ_MASK, false)
        confirm(buf)
        val rtt = (now() - buf.u32le(8)) and 0xffffffffL
        stats.rttMs = rtt
        emit("pong", rtt)
      }
      PT.Data -> {
        if (state != "connected") return
        val seq = buf.u8(1) and SEQ_MASK
        // handleDataPacket 0x08436f30: a duplicate or an old sequence is dropped.
        val d = (seq - lastRecv) and SEQ_MASK
        if (seq == lastRecv || d >= SEQ_HALF) { stats.duplicates++; return }
        confirm(buf)
        accountSeq(seq, true)
        stats.received++
        val len = buf.u16le(7)
        // buf.subarray(9, 9 + len): clamped to the datagram.
        val payload = buf.copyOfRange(minOf(9, buf.size), minOf(9 + len, buf.size))
        emit("data", payload, seq)
      }
      PT.ServerInfo -> emit("server-info", parseServerInfo(buf))
      else -> emit("unknown", type, buf)
    }
  }

  // The receiver's bookkeeping for a sequenced packet (handleDataPacket for
  // data, handlePingRequestPacket 0x08436e70 for a ping that carries one): the
  // history mask shifts by the gap, then records this one as received (data)
  // or as lost (a ping repeating a sequence we never saw).
  private fun accountSeq(seq: Int, received: Boolean) {
    val d = (seq - lastRecv) and SEQ_MASK
    if (d == 0 || d >= SEQ_HALF) return
    if (d > 1) { stats.lost += d - 1; recvMask = recvMask shl (d - 1) }
    lastRecv = seq
    recvMask = (recvMask shl 1) or (if (received) 1 else 0)
    if (!received) stats.lost++
  }

  // SWConnection::confirmPacket 0x0843bfb0: walk the sequences between the
  // last confirmed and this ack, oldest first, and report each as delivered
  // or lost from the mask.
  private fun confirm(buf: ByteArray) {
    val ackSeq = ((buf.u8(2) and 0xf) shl 2) or (buf.u8(1) shr 6)
    val mask = buf.i32le(3)
    val d = (ackSeq - lastConfirmed) and SEQ_MASK
    if (d >= SEQ_HALF || d == 0) return
    lastConfirmed = ackSeq
    for (i in d - 1 downTo 0) {
      val seq = (ackSeq - i) and SEQ_MASK
      val delivered = (mask and (1 shl i)) != 0
      // Map#get of a sequence never sent is undefined, which the row leaves out.
      val tag: Any? = if (sentPackets.containsKey(seq)) sentPackets[seq] else Undefined
      sentPackets.remove(seq)
      emit("status", linkedMapOf("seq" to seq, "delivered" to delivered, "tag" to tag))
    }
  }
}
