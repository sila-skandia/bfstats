package io.bfstats.sidecar.app

import android.app.Application
import android.content.Context
import android.os.SystemClock
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.produceState
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation3.runtime.NavKey
import io.bfstats.sidecar.ServerDetail
import io.bfstats.sidecar.fetchLiveList
import io.bfstats.sidecar.fetchServerDetail
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import java.io.IOException

// ---- the companion's screens -------------------------------------------------
// A back stack of these keys (Navigation 3); a new screen (a player page, the
// stats) is one more key and one more entry in MainActivity's NavDisplay.

/** The live server list. */
@Serializable data object ServersKey : NavKey

/** One server: who is on it, and the join. ip and port are the identity. */
@Serializable data class ServerKey(val ip: String, val port: Int) : NavKey

/** Join a server that is not on the list (a LAN or lab server) by address. */
@Serializable data object JoinAddressKey : NavKey

// ---- data ------------------------------------------------------------------------

/** Why a fetch failed, in the words a screen shows. */
data class Problem(val offline: Boolean, val detail: String)

fun problemOf(e: Throwable) =
  if (e is IOException) Problem(true, "No connection to bfstats.io") else Problem(false, e.message ?: "Something went wrong")

/** The clock every countdown reads. */
fun now(): Long = SystemClock.elapsedRealtime()

/** [now], ticking once a second on the second. */
@Composable
fun rememberNow(): State<Long> = produceState(now()) {
  while (true) { delay(1000 - now() % 1000); value = now() }
}

/** Runs [refresh] while the screen is started: at once when the data is older
 *  than [periodMs], then every [periodMs]. */
@Composable
fun AutoRefresh(periodMs: Long, age: () -> Long, refresh: () -> Unit) {
  val owner = LocalLifecycleOwner.current
  LaunchedEffect(owner) {
    owner.repeatOnLifecycle(Lifecycle.State.STARTED) {
      while (true) {
        val a = age()
        if (a >= periodMs) refresh()
        delay((periodMs - a.coerceIn(0, periodMs)).coerceAtLeast(1000))
      }
    }
  }
}

/** The live list, the player name, and what the app remembers between screens. */
class LiveViewModel(app: Application) : AndroidViewModel(app) {
  data class ListState(
    val servers: List<ServerDetail>? = null,
    val fetchedAt: Long = 0,
    val loading: Boolean = false,
    val problem: Problem? = null,
  )

  private val prefs = app.getSharedPreferences("sidecar", Context.MODE_PRIVATE)
  private val _list = MutableStateFlow(ListState())
  val list: StateFlow<ListState> = _list.asStateFlow()
  private val _name = MutableStateFlow(prefs.getString(KEY_NAME, "") ?: "")
  val name: StateFlow<String> = _name.asStateFlow()
  val lastAddress: String get() = prefs.getString(KEY_ADDRESS, "") ?: ""

  /** The join whose game page was opened (its page socket's port), so a
   *  rotation does not open it again. */
  var openedPort = -1

  private var job: Job? = null

  fun setName(n: String) {
    _name.value = n
    prefs.edit().putString(KEY_NAME, n.trim()).apply()
  }

  fun rememberAddress(a: String) = prefs.edit().putString(KEY_ADDRESS, a.trim()).apply()

  private var attemptAt = 0L

  /** Since the last fetch was started (a failed one retries a period later). */
  fun age() = if (attemptAt == 0L) Long.MAX_VALUE else now() - attemptAt

  fun refresh() {
    if (job?.isActive == true) return
    attemptAt = now()
    _list.update { it.copy(loading = true) }
    job = viewModelScope.launch {
      try {
        val servers = withContext(Dispatchers.IO) { fetchLiveList() }
        _list.value = ListState(servers, now())
      } catch (e: Exception) {
        _list.update { it.copy(loading = false, problem = problemOf(e)) }
      }
    }
  }

  /** The list's copy of a server (players included), to draw at once. */
  fun seed(ip: String, port: Int): ServerDetail? =
    _list.value.servers?.firstOrNull { it.server.ip == ip && it.server.port == port }

  companion object {
    const val KEY_NAME = "name"
    const val KEY_ADDRESS = "address"
    /** The tray app's list refresh (sidecar-desktop main.js SERVER_REFRESH_MS). */
    const val LIST_REFRESH_MS = 60_000L
    /** The single-server endpoint is edge-cached 10 s. */
    const val SERVER_REFRESH_MS = 10_000L
  }
}

/** One server, refreshed from the single-server endpoint. */
class ServerViewModel(private val ip: String, private val port: Int, seed: ServerDetail?, seedAt: Long) : ViewModel() {
  data class State(
    val detail: ServerDetail?,
    val fetchedAt: Long,
    val loading: Boolean = false,
    /** The site answered 404: the server is gone from the live list. */
    val gone: Boolean = false,
    val problem: Problem? = null,
  )

  private val _state = MutableStateFlow(State(seed, if (seed == null) 0 else seedAt))
  val state: StateFlow<State> = _state.asStateFlow()
  private var job: Job? = null

  private var attemptAt = 0L

  fun age() = if (attemptAt == 0L) Long.MAX_VALUE else now() - attemptAt

  fun refresh() {
    if (job?.isActive == true) return
    attemptAt = now()
    _state.update { it.copy(loading = true) }
    job = viewModelScope.launch {
      try {
        val d = withContext(Dispatchers.IO) { fetchServerDetail(ip, port) }
        _state.update {
          if (d == null) it.copy(loading = false, gone = true, problem = null, fetchedAt = now())
          else State(d, now())
        }
      } catch (e: Exception) {
        _state.update { it.copy(loading = false, problem = problemOf(e)) }
      }
    }
  }
}
