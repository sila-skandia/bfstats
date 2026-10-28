package io.bfstats.sidecar.ios

// What the iPhone app (tools/sidecar-ios) calls: a small, Swift-shaped face on
// the core, exported in the SidecarCore framework. Swift sees `PhoneCore.shared`
// and `PhoneSession`; everything else it uses is the core's own data classes
// (ServerDetail, LiveServer, LiveTeam, LivePlayer). A Kotlin exception that
// reaches Swift undeclared ends the process, so every call that can fail is
// @Throws, and Swift sees it as `throws`.

import io.bfstats.sidecar.BridgedPageHub
import io.bfstats.sidecar.FsFile
import io.bfstats.sidecar.JoinConfig
import io.bfstats.sidecar.LIVE_URL
import io.bfstats.sidecar.ServerDetail
import io.bfstats.sidecar.Sidecar
import io.bfstats.sidecar.SidecarHost
import io.bfstats.sidecar.WsPageHub
import io.bfstats.sidecar.clockText
import io.bfstats.sidecar.decodeName
import io.bfstats.sidecar.fetchLiveList
import io.bfstats.sidecar.fetchServerDetail
import io.bfstats.sidecar.gameTypeTitle
import io.bfstats.sidecar.loadOf
import io.bfstats.sidecar.mapImageUrl
import io.bfstats.sidecar.parseAddress
import io.bfstats.sidecar.parseLiveList
import io.bfstats.sidecar.parseServerDetailBody
import io.bfstats.sidecar.roundLeft
import io.bfstats.sidecar.sidecarNameError
import io.bfstats.sidecar.titleCase
import io.bfstats.sidecar.viewerUrl
import kotlin.concurrent.Volatile
import kotlin.io.encoding.Base64

/** `host[:port]` as the join-by-address screen reads it. */
data class PhoneAddress(val host: String, val port: Int)

/** The core's companion data and the screens' words, for Swift. */
object PhoneCore {
  /** The live list with its players, busiest first. Blocking: call it off the main thread. */
  @Throws(Exception::class)
  fun liveList(): List<ServerDetail> = fetchLiveList(LIVE_URL)

  /** One server; null when the site no longer lists it (offline). Blocking. */
  @Throws(Exception::class)
  fun serverDetail(ip: String, port: Int): ServerDetail? = fetchServerDetail(ip, port)

  /** The same parsers over a body Swift already has (tests, fixtures). */
  fun parseList(body: String): List<ServerDetail> = parseLiveList(body)
  fun parseServer(body: String): ServerDetail? = parseServerDetailBody(body)

  /** A stored server or player name decoded for the eye only. */
  fun displayName(raw: String): String = decodeName(raw)

  fun mapImage(gameId: String?, mapName: String?): String? = mapImageUrl(gameId, mapName)

  /** Why a player name cannot be joined with, or null. */
  fun nameError(name: String): String? = sidecarNameError(name)

  fun address(text: String): PhoneAddress? = parseAddress(text)?.let { PhoneAddress(it.first, it.second) }

  /** The page a join opens. */
  fun playUrl(port: Int, serverName: String?): String = viewerUrl(port, serverName = serverName)

  fun gameType(type: String?): String = gameTypeTitle(type)
  fun title(s: String?): String = titleCase(s)

  /** Seconds of the round left, -1 when the server gives none. `remain` is
   *  the fetched value (-1 for none). */
  fun roundSeconds(remain: Int, elapsedMs: Long): Int = roundLeft(remain.takeIf { it >= 0 }, elapsedMs) ?: -1
  fun clock(seconds: Int): String = clockText(seconds)

  /** How full: 0 idle, 1 ok, 2 busy, 3 full. */
  fun load(numPlayers: Int, maxPlayers: Int): Int = loadOf(numPlayers, maxPlayers).ordinal
}

/** What a session tells the app. Called from the sidecar's threads. */
interface PhoneSessionListener {
  fun log(line: String)
  /** A frame for a bridged page's socket. */
  fun pageFrame(socketId: Int, text: String)
  /** The sidecar closed a bridged page's socket (the run ended). */
  fun pageClosed(socketId: Int)
  /** The run is over (left, refused, kicked, gave up): the exit code. */
  fun ended(code: Int)
}

/**
 * One join, as the Android app's SidecarService runs one: the sidecar with
 * its page socket on 127.0.0.1 (a real WebSocket) and, beside it, the bridge
 * a WKWebView page reaches through the app (pageOpen, pageText, pageBinary,
 * pageClose). The level tables go under `cacheDir`, the CD keys under
 * `configDir`.
 */
class PhoneSession(
  host: String,
  port: Int,
  name: String,
  password: String,
  mapId: String?,
  mapName: String?,
  gameType: String?,
  cacheDir: String,
  configDir: String,
  private val listener: PhoneSessionListener,
) {
  @Volatile private var hub: BridgedPageHub? = null

  private val sidecar = Sidecar(
    JoinConfig(
      host = host, port = port, name = name, password = password,
      mapId = mapId, mapName = mapName, gameType = gameType,
      cacheDir = FsFile(cacheDir), configDir = FsFile(configDir),
    ),
    log = { listener.log(it) },
    host = SidecarHost(
      pageHub = { p, origins, loop ->
        BridgedPageHub(WsPageHub(p, origins, loop), loop,
          out = { id, text -> listener.pageFrame(id, text) },
          closed = { id -> listener.pageClosed(id) }).also { hub = it }
      },
      exit = { code -> listener.ended(code) },
    ),
  )

  /** Bring the page socket up and start the join; the socket's port. Blocks
   *  briefly (call it off the main thread). */
  @Throws(Exception::class)
  fun start(): Int = sidecar.start()

  /** Leave the server cleanly and end the run. */
  fun leave() = sidecar.leave()

  /** Leave, then stop the sidecar's loop. */
  fun stop() = sidecar.stop()

  val done: Boolean get() = sidecar.done

  /** A bridged page opened its socket `socketId`. */
  fun pageOpen(socketId: Int): Boolean = hub?.open(socketId) ?: false
  fun pageText(socketId: Int, text: String) { hub?.message(socketId, text.encodeToByteArray()) }
  /** A binary frame, base64 (as the page's stand-in posts it). */
  fun pageBinary(socketId: Int, base64: String) {
    val b = try { Base64.Default.decode(base64) } catch (_: IllegalArgumentException) { return }
    hub?.message(socketId, b)
  }
  fun pageClose(socketId: Int) { hub?.close(socketId) }
  /** The page went away (a navigation, the view closed): every bridged socket closes. */
  fun pagesGone() { hub?.closeAll() }
}
