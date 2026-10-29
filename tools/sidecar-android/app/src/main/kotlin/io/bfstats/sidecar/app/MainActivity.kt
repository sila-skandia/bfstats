package io.bfstats.sidecar.app

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.navigation3.rememberViewModelStoreNavEntryDecorator
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.runtime.rememberSaveableStateHolderNavEntryDecorator
import androidx.navigation3.ui.NavDisplay
import io.bfstats.sidecar.ServerDetail
import io.bfstats.sidecar.app.join.JoinAddressScreen
import io.bfstats.sidecar.app.servers.JoinHere
import io.bfstats.sidecar.app.servers.ServerScreen
import io.bfstats.sidecar.app.servers.ServersScreen
import io.bfstats.sidecar.app.servers.SessionBar
import io.bfstats.sidecar.app.ui.BfTheme

/** The bfstats.io companion: the live list, a server's players, and the join
 *  (the sidecar in [SidecarService], the game in [PlayActivity]). */
class MainActivity : ComponentActivity() {
  private val live: LiveViewModel by viewModels()

  override fun onCreate(savedInstanceState: Bundle?) {
    // Neutral Depth is dark: light system bar icons over the app's own colours.
    enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
    super.onCreate(savedInstanceState)
    setContent { BfTheme { CompanionApp() } }
  }

  private fun startJoin(host: String, port: Int, name: String, d: ServerDetail?) {
    live.setName(name)
    val i = Intent(this, SidecarService::class.java)
      .setAction(SidecarService.ACTION_JOIN)
      .putExtra(SidecarService.EXTRA_HOST, host)
      .putExtra(SidecarService.EXTRA_PORT, port)
      .putExtra(SidecarService.EXTRA_NAME, name.trim())
    d?.server?.let {
      i.putExtra(SidecarService.EXTRA_MAP_ID, it.mapId)
        .putExtra(SidecarService.EXTRA_MAP_NAME, it.mapName)
        .putExtra(SidecarService.EXTRA_GAME_TYPE, it.gameType)
        .putExtra(SidecarService.EXTRA_SERVER_NAME, it.name)
    }
    startService(i)
  }

  private fun openPlay() = startActivity(Intent(this, PlayActivity::class.java))
  private fun leave() = SidecarService.leave(this)

  @Composable
  private fun CompanionApp() {
    val list by live.list.collectAsStateWithLifecycle()
    val name by live.name.collectAsStateWithLifecycle()
    val join by SidecarService.state.collectAsStateWithLifecycle()
    val now by rememberNow()
    val backStack = rememberNavBackStack(ServersKey)

    // Open the game once the join's page socket is up, as the tray app opens
    // the browser; once per join, so coming back to the app stays here.
    LaunchedEffect(join.wsPort) {
      if (join.wsPort > 0 && live.openedPort != join.wsPort) { live.openedPort = join.wsPort; openPlay() }
    }
    AutoRefresh(LiveViewModel.LIST_REFRESH_MS, live::age, live::refresh)

    val joinedAddress = join.config?.let { "${it.host}:${it.port}" }
    val joinedServer = joinedAddress?.let { a -> list.servers?.firstOrNull { it.server.address == a }?.server }
    val sessionBar: (@Composable () -> Unit)? = join.config?.let { cfg ->
      {
        SessionBar(
          title = joinedServer?.name ?: "${cfg.host}:${cfg.port}", thumb = joinedServer?.thumb,
          word = if (join.joined) "Joined" else "Joining", who = cfg.name, live = join.joined,
          onOpen = ::openPlay, onLeave = ::leave, canOpen = join.joined,
        )
      }
    }

    NavDisplay(
      backStack = backStack,
      onBack = { backStack.removeLastOrNull() },
      entryDecorators = listOf(rememberSaveableStateHolderNavEntryDecorator(), rememberViewModelStoreNavEntryDecorator()),
      entryProvider = entryProvider {
        entry<ServersKey> {
          ServersScreen(
            state = list, now = now, current = joinedAddress, onRefresh = live::refresh,
            onOpen = { backStack.add(ServerKey(it.server.ip, it.server.port)) },
            onJoinAddress = { backStack.add(JoinAddressKey) },
            sessionBar = sessionBar,
          )
        }
        entry<ServerKey> { key ->
          val vm = viewModel { ServerViewModel(key.ip, key.port, live.seed(key.ip, key.port), list.fetchedAt) }
          val state by vm.state.collectAsStateWithLifecycle()
          AutoRefresh(LiveViewModel.SERVER_REFRESH_MS, vm::age, vm::refresh)
          val address = "${key.ip}:${key.port}"
          ServerScreen(
            state = state, now = now, name = name, onName = live::setName,
            join = JoinHere(
              here = joinedAddress == address, live = join.joined,
              elsewhere = if (joinedAddress != null && joinedAddress != address) joinedServer?.name ?: joinedAddress else null,
            ),
            onBack = { backStack.removeLastOrNull() }, onRefresh = vm::refresh,
            onJoin = { d -> startJoin(d.server.ip, d.server.port, name, d) },
            onOpenGame = ::openPlay, onLeave = ::leave,
          )
        }
        entry<JoinAddressKey> {
          JoinAddressScreen(
            initial = remember { live.lastAddress }, name = name, onName = live::setName,
            onBack = { backStack.removeLastOrNull() },
            onJoin = { host, port, typed ->
              live.rememberAddress(typed)
              val listed = list.servers?.firstOrNull { it.server.ip == host && it.server.port == port }
              startJoin(host, port, name, listed)
              backStack.removeLastOrNull()
            },
          )
        }
      },
    )
  }
}

