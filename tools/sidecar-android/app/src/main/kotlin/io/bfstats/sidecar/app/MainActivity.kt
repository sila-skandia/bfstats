package io.bfstats.sidecar.app

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import io.bfstats.sidecar.LiveServer
import io.bfstats.sidecar.fetchServers
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// The V4 "Neutral Depth" dark palette the site uses, in its plainest form.
private val Bg = Color(0xFF101114)
private val Surface = Color(0xFF1A1C21)
private val Muted = Color(0xFF8A8F98)
private val Olive = Color(0xFFA3B26B)

class MainActivity : ComponentActivity() {
  private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= 33 &&
      ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    setContent {
      MaterialTheme(colorScheme = darkColorScheme(background = Bg, surface = Surface, primary = Olive)) {
        ServerListScreen(onJoin = ::join, onOpen = ::openPlay, onLeave = { SidecarService.leave(this) })
      }
    }
  }

  private fun join(s: LiveServer, name: String) {
    prefs().edit().putString(KEY_NAME, name).apply()
    val i = Intent(this, SidecarService::class.java)
      .setAction(SidecarService.ACTION_JOIN)
      .putExtra(SidecarService.EXTRA_HOST, s.ip)
      .putExtra(SidecarService.EXTRA_PORT, s.port)
      .putExtra(SidecarService.EXTRA_NAME, name)
      .putExtra(SidecarService.EXTRA_MAP_ID, s.mapId)
      .putExtra(SidecarService.EXTRA_MAP_NAME, s.mapName)
      .putExtra(SidecarService.EXTRA_GAME_TYPE, s.gameType)
    ContextCompat.startForegroundService(this, i)
  }

  private fun openPlay() = startActivity(Intent(this, PlayActivity::class.java))

  private fun prefs() = getSharedPreferences("sidecar", Context.MODE_PRIVATE)

  @Composable
  private fun ServerListScreen(onJoin: (LiveServer, String) -> Unit, onOpen: () -> Unit, onLeave: () -> Unit) {
    var servers by remember { mutableStateOf<List<LiveServer>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var name by remember { mutableStateOf(prefs().getString(KEY_NAME, "") ?: "") }
    val join by SidecarService.state.collectAsState()
    val scope = rememberCoroutineScope()
    var opened by remember { mutableStateOf(false) }

    fun refresh() = scope.launch {
      error = null
      try { servers = withContext(Dispatchers.IO) { fetchServers() } } catch (e: Exception) { error = e.message ?: "Could not load the server list" }
    }
    LaunchedEffect(Unit) { while (true) { refresh(); delay(30_000) } }
    // Open the page once the join's socket is up, as the tray app opens the browser.
    LaunchedEffect(join.wsPort) {
      if (join.wsPort > 0 && !opened) { opened = true; onOpen() }
      if (join.wsPort <= 0) opened = false
    }

    Column(Modifier.fillMaxSize().background(Bg).safeDrawingPadding().padding(16.dp)) {
      Text("Live servers", fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
      Spacer(Modifier.height(12.dp))
      OutlinedTextField(
        value = name, onValueChange = { name = it.take(31) }, singleLine = true,
        label = { Text("Player name") }, modifier = Modifier.fillMaxWidth(),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
      )
      if (join.config != null) {
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth().background(Surface).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
          Column(Modifier.weight(1f)) {
            Text("Joined ${join.config!!.host}:${join.config!!.port}", color = Color.White)
            Text(join.log.lastOrNull() ?: "", color = Muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
          }
          Button(onClick = onOpen, enabled = join.joined) { Text("Open") }
          Spacer(Modifier.width(8.dp))
          OutlinedButton(onClick = onLeave) { Text("Leave") }
        }
      }
      Spacer(Modifier.height(12.dp))
      when {
        error != null && servers == null -> Text(error!!, color = Color(0xFFE07A6A))
        servers == null -> Row(verticalAlignment = Alignment.CenterVertically) {
          CircularProgressIndicator(Modifier.width(20.dp).height(20.dp), strokeWidth = 2.dp)
          Spacer(Modifier.width(12.dp)); Text("Loading servers", color = Muted)
        }
        servers!!.isEmpty() -> Text("No servers online", color = Muted)
        else -> LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(0.dp)) {
          items(servers!!, key = { it.address }) { s ->
            ServerRow(s, enabled = name.isNotBlank() && !s.password) { onJoin(s, name.trim()) }
            HorizontalDivider(color = Surface)
          }
        }
      }
    }
  }

  @Composable
  private fun ServerRow(s: LiveServer, enabled: Boolean, onClick: () -> Unit) {
    Row(
      Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = onClick).padding(vertical = 12.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Text(
        "${s.numPlayers}/${s.maxPlayers}", color = if (s.numPlayers > 0) Olive else Muted,
        fontFamily = FontFamily.Monospace, modifier = Modifier.width(64.dp),
      )
      Column(Modifier.weight(1f)) {
        Text(s.name, color = if (enabled) Color.White else Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        val marks = listOfNotNull(s.country, if (s.anticheat) "[AC]" else null, if (s.password) "[PW]" else null).joinToString(" ")
        Text(listOfNotNull(s.mapName, s.gameType, marks.ifEmpty { null }).joinToString("  "), color = Muted, fontSize = 12.sp, maxLines = 1)
      }
    }
  }

  companion object {
    private const val KEY_NAME = "name"
  }
}
