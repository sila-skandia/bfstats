package io.bfstats.sidecar

// The page socket with a second way in: a host that is not a TCP socket
// carries a page's frames (the iPhone app's WKWebView bridge,
// tools/sidecar-ios). The page's `WebSocket` there may be a stand-in the app
// injects, which posts each frame to the app and takes the sidecar's back
// from it; this hub is where those frames meet the sidecar. The real socket
// (`inner`, a WsPageHub) listens beside it, so a page may use either, and the
// sidecar cannot tell them apart: both are a PageSocket, handed over on the
// loop with their frames queued behind them (as WsPageHub does).
//
// Not part of the Node port (sidecar.mjs has only the WebSocket server), so
// it has no parity fixture; BridgedPageHubTest holds it.

/**
 * @param inner the real page socket, or null for bridged pages only.
 * @param out how a frame reaches a bridged page: its id and the text. Called
 *   on the loop's thread; the host hands it to the page's own thread.
 * @param closed how the host hears that the sidecar closed a bridged page.
 */
class BridgedPageHub(
  private val inner: PageHub?,
  private val loop: Scheduler,
  private val out: (id: Int, text: String) -> Unit,
  private val closed: (id: Int) -> Unit = {},
) : PageHub {
  private val lock = Lock()
  private val bridged = LinkedHashMap<Int, Sock>()
  private var connectionHandler: (PageSocket) -> Unit = {}
  private var refusedHandler: (String?) -> Unit = {}
  private var shut = false

  override var onConnection: (PageSocket) -> Unit
    get() = connectionHandler
    set(v) { connectionHandler = v; inner?.onConnection = v }
  override var onRefused: (String?) -> Unit
    get() = refusedHandler
    set(v) { refusedHandler = v; inner?.onRefused = v }

  override val clientCount: Int get() = (inner?.clientCount ?: 0) + lock.withLock { bridged.size }

  private inner class Sock(val id: Int) : PageSocket {
    override var onMessage: (ByteArray) -> Unit = {}
    override var onClose: () -> Unit = {}
    override fun send(text: String) { if (lock.withLock { bridged[id] === this }) out(id, text) }
  }

  /** The real socket's port, or 0 with bridged pages only. */
  override fun listen(): Int = inner?.listen() ?: 0

  /** A bridged page opened its socket. Any thread. False once the hub is
   *  closed, or when the id is taken. */
  fun open(id: Int): Boolean {
    val s = Sock(id)
    lock.withLock {
      if (shut || bridged.containsKey(id)) return false
      bridged[id] = s
    }
    loop.post { if (lock.withLock { bridged[id] === s }) connectionHandler(s) }
    return true
  }

  /** A frame from a bridged page. Any thread; frames reach the sidecar in
   *  the order they were given. */
  fun message(id: Int, frame: ByteArray) {
    val s = lock.withLock { bridged[id] } ?: return
    loop.post { if (lock.withLock { bridged[id] === s }) s.onMessage(frame) }
  }

  /** A bridged page's socket closed (the page closed it, or went away). Any thread. */
  fun close(id: Int) {
    val s = lock.withLock { bridged.remove(id) } ?: return
    loop.post { s.onClose() }
  }

  /** Every bridged page's socket closed (a navigation took the page away). */
  fun closeAll() { for (id in lock.withLock { bridged.keys.toList() }) close(id) }

  override fun broadcast(text: String) {
    inner?.broadcast(text)
    for (s in lock.withLock { bridged.values.toList() }) s.send(text)
  }

  override fun close() {
    inner?.close()
    val gone = lock.withLock { shut = true; bridged.keys.toList().also { bridged.clear() } }
    for (id in gone) closed(id)
  }
}
