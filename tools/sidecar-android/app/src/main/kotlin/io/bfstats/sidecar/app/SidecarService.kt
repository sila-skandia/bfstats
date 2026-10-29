package io.bfstats.sidecar.app

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import io.bfstats.sidecar.FsFile
import io.bfstats.sidecar.JoinConfig
import io.bfstats.sidecar.Sidecar
import io.bfstats.sidecar.SidecarHost
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** What the app shows about the current join. */
data class JoinState(
  val config: JoinConfig? = null,
  val wsPort: Int = -1,
  /** The joined server's name from the app's list, for the page's connect screen. */
  val serverName: String? = null,
  val log: List<String> = emptyList(),
) {
  val joined get() = config != null && wsPort > 0
}

/**
 * Runs one Sidecar per join (sidecar-desktop's child process per join). A
 * plain started service, not a foreground one: it outlives a rotation or the
 * hop between the list and the game, but not the app. Leave stops it, and so
 * does swiping the app away or Android stopping it once the app is in the
 * background, which leaves the server, as closing the game does.
 */
class SidecarService : Service() {
  private var sidecar: Sidecar? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_LEAVE -> { leave(); return START_NOT_STICKY }
      ACTION_JOIN -> {
        val cfg = JoinConfig(
          host = intent.getStringExtra(EXTRA_HOST) ?: return START_NOT_STICKY,
          port = intent.getIntExtra(EXTRA_PORT, 14567),
          name = intent.getStringExtra(EXTRA_NAME) ?: "sidecar",
          mapId = intent.getStringExtra(EXTRA_MAP_ID),
          mapName = intent.getStringExtra(EXTRA_MAP_NAME),
          gameType = intent.getStringExtra(EXTRA_GAME_TYPE),
          // The level tables and the CD keys live in the app's own folders.
          cacheDir = FsFile(java.io.File(cacheDir, "sidecar").path),
          configDir = FsFile(java.io.File(filesDir, "sidecar").path),
        )
        join(cfg, intent.getStringExtra(EXTRA_SERVER_NAME))
      }
    }
    return START_NOT_STICKY
  }

  private fun join(cfg: JoinConfig, serverName: String?) {
    sidecar?.stop()
    _state.value = JoinState(config = cfg, serverName = serverName)
    // The run ends by itself when the server refuses, kicks or is lost for good.
    val s = Sidecar(cfg, log = ::log, host = SidecarHost(exit = { code -> log("[sidecar] the run is over (exit $code)") }))
    sidecar = s
    Thread({
      try {
        val port = s.start()
        _state.update { it.copy(wsPort = port) }
      } catch (e: Exception) {
        log("could not start: ${e.message}")
      }
    }, "sidecar-start").start()
  }

  private fun leave() {
    sidecar?.stop()
    sidecar = null
    _state.value = JoinState(log = _state.value.log)
    stopSelf()
  }

  /** The app was swiped away: leave now rather than when Android gets round to it. */
  override fun onTaskRemoved(rootIntent: Intent?) {
    leave()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    sidecar?.stop()
    sidecar = null
    _state.value = JoinState(log = _state.value.log)
    super.onDestroy()
  }

  companion object {
    const val ACTION_JOIN = "io.bfstats.sidecar.JOIN"
    const val ACTION_LEAVE = "io.bfstats.sidecar.LEAVE"
    const val EXTRA_HOST = "host"
    const val EXTRA_PORT = "port"
    const val EXTRA_NAME = "name"
    const val EXTRA_MAP_ID = "mapId"
    const val EXTRA_MAP_NAME = "mapName"
    const val EXTRA_GAME_TYPE = "gameType"
    const val EXTRA_SERVER_NAME = "serverName"
    private const val LOG_LINES = 500

    private val _state = MutableStateFlow(JoinState())
    val state: StateFlow<JoinState> = _state.asStateFlow()

    fun log(line: String) {
      android.util.Log.i("sidecar", line)
      _state.update { it.copy(log = (it.log + line).takeLast(LOG_LINES)) }
    }

    /** stopService, not a LEAVE intent: it is allowed from the background
     *  (the game screen's onStop), and onDestroy stops the sidecar. */
    fun leave(context: Context) {
      context.stopService(Intent(context, SidecarService::class.java))
    }
  }
}
