package io.bfstats.sidecar

// The entry point the Android app (and later the desktop app) drives: one
// Sidecar per join, as sidecar.mjs is one process per join. It owns the page's
// WebSocket on 127.0.0.1 and, once ported, the Session that talks to the game
// server. Until the Session port lands it only hosts the socket and logs what
// the page sends, which proves the WebView -> 127.0.0.1 bridge.

/** One join: the server, and who the player is (sidecar.mjs's CLI flags). */
data class JoinConfig(
  val host: String,
  val port: Int,
  val name: String = "sidecar",
  /** 0 = auto-assign (sidecar.mjs --team). */
  val team: Int = 0,
  val password: String = "",
  /** The level the live list says the server plays, for the pre-join table fetch. */
  val mapId: String? = null,
  val mapName: String? = null,
  val gameType: String? = null,
  /** 0 picks a free port. */
  val wsPort: Int = 0,
  val allowOrigins: List<String> = emptyList(),
)

class Sidecar(
  val config: JoinConfig,
  private val log: (String) -> Unit = {},
) {
  private var ws: WsServer? = null
  @Volatile var wsPort: Int = -1; private set
  @Volatile var running = false; private set

  /** Starts the page socket and returns its port. */
  fun start(): Int {
    check(!running) { "already started" }
    val server = WsServer(config.wsPort, allowOrigins = config.allowOrigins)
    server.onRefused = { log("refused a socket from origin $it") }
    server.onConnection = { sock ->
      log("page connected")
      sock.onMessage = { text, bin -> log(if (text != null) "page: ${text.take(200)}" else "page: ${bin?.size} bytes") }
      sock.onClose = { log("page disconnected") }
    }
    wsPort = server.listen()
    ws = server
    running = true
    log("socket on 127.0.0.1:$wsPort for ${config.host}:${config.port} as ${config.name}")
    return wsPort
  }

  fun stop() {
    if (!running) return
    running = false
    ws?.close()
    ws = null
    log("stopped")
  }
}

/** The page URL a join opens (sidecar-desktop main.js viewerUrl). */
fun viewerUrl(wsPort: Int, base: String = "https://play.bfstats.io/"): String =
  "${base}map.html?sidecar=127.0.0.1:$wsPort"
