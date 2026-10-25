package io.bfstats.sidecar.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.ServiceCompat
import io.bfstats.sidecar.JoinConfig
import io.bfstats.sidecar.Sidecar
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** What the app shows about the current join. */
data class JoinState(
  val config: JoinConfig? = null,
  val wsPort: Int = -1,
  val log: List<String> = emptyList(),
) {
  val joined get() = config != null && wsPort > 0
}

/**
 * Runs one Sidecar per join (sidecar-desktop's child process per join) as a
 * foreground service, so the UDP session lives while the page plays and
 * survives the page going briefly behind another app. Leave stops it.
 */
class SidecarService : Service() {
  private var sidecar: Sidecar? = null
  private var wake: PowerManager.WakeLock? = null

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
        )
        join(cfg)
      }
    }
    return START_NOT_STICKY
  }

  private fun join(cfg: JoinConfig) {
    sidecar?.stop()
    _state.value = JoinState(config = cfg)
    ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(cfg), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    if (wake == null) {
      wake = (getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "bfstats:sidecar").apply { acquire(4 * 60 * 60 * 1000L) }
    }
    val s = Sidecar(cfg, log = ::log)
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
    wake?.let { if (it.isHeld) it.release() }
    wake = null
    _state.value = JoinState(log = _state.value.log)
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    sidecar?.stop()
    wake?.let { if (it.isHeld) it.release() }
    super.onDestroy()
  }

  private fun notification(cfg: JoinConfig): Notification {
    val nm = getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(CHANNEL, "Live game", NotificationManager.IMPORTANCE_LOW))
    val open = PendingIntent.getActivity(this, 0, Intent(this, PlayActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
    val leave = PendingIntent.getService(this, 1, Intent(this, SidecarService::class.java).setAction(ACTION_LEAVE), PendingIntent.FLAG_IMMUTABLE)
    return Notification.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.stat_sys_upload_done)
      .setContentTitle("Joined ${cfg.host}:${cfg.port}")
      .setContentText("Playing as ${cfg.name}")
      .setContentIntent(open)
      .addAction(Notification.Action.Builder(null, "Leave", leave).build())
      .setOngoing(true)
      .build()
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
    private const val CHANNEL = "join"
    private const val NOTIFICATION_ID = 1
    private const val LOG_LINES = 500

    private val _state = MutableStateFlow(JoinState())
    val state: StateFlow<JoinState> = _state.asStateFlow()

    fun log(line: String) {
      android.util.Log.i("sidecar", line)
      _state.update { it.copy(log = (it.log + line).takeLast(LOG_LINES)) }
    }

    fun leave(context: Context) {
      context.startService(Intent(context, SidecarService::class.java).setAction(ACTION_LEAVE))
    }
  }
}
