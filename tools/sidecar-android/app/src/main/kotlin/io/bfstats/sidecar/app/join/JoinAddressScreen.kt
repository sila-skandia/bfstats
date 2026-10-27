package io.bfstats.sidecar.app.join

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.bfstats.sidecar.app.servers.NameField
import io.bfstats.sidecar.app.ui.Bf
import io.bfstats.sidecar.app.ui.BfIcons
import io.bfstats.sidecar.app.ui.Btn
import io.bfstats.sidecar.app.ui.BtnKind
import io.bfstats.sidecar.app.ui.IconBtn
import io.bfstats.sidecar.parseAddress
import io.bfstats.sidecar.sidecarNameError

/** Join a server the live list does not carry (a LAN or lab server) by
 *  `host[:port]`, as the tray panel's address line does. */
@Composable
fun JoinAddressScreen(
  initial: String,
  name: String,
  onName: (String) -> Unit,
  onBack: () -> Unit,
  onJoin: (host: String, port: Int, typed: String) -> Unit,
) {
  var address by rememberSaveable { mutableStateOf(initial) }
  val parsed = parseAddress(address)
  val nameError = sidecarNameError(name)
  val can = parsed != null && name.isNotBlank() && nameError == null
  fun go() { if (can) onJoin(parsed!!.first, parsed.second, address) }

  Column(
    Modifier.fillMaxSize().background(Bf.bg)
      .windowInsetsPadding(WindowInsets.displayCutout.union(WindowInsets.navigationBars).only(WindowInsetsSides.Horizontal))
      .windowInsetsPadding(WindowInsets.statusBars),
  ) {
    Row(Modifier.padding(start = 8.dp, end = 16.dp, top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
      IconBtn(BfIcons.back, "Back", onBack, tint = Bf.ink)
      Spacer(Modifier.width(6.dp))
      Text("Join by address", style = Bf.text(18.sp, Bf.ink, 600))
    }
    Column(
      Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 12.dp).widthIn(max = 560.dp),
    ) {
      Text(
        "For a server the live list does not show: one on your network, or one that has just started. The port defaults to 14567.",
        style = Bf.text(14.sp, Bf.inkMuted), lineHeight = 20.sp,
      )
      Spacer(Modifier.height(22.dp))
      Text("SERVER", style = Bf.eyebrow())
      Spacer(Modifier.height(8.dp))
      var focused by remember { mutableStateOf(false) }
      val bad = address.isNotBlank() && parsed == null
      val shape = RoundedCornerShape(10.dp)
      Row(
        Modifier.fillMaxWidth().height(46.dp).clip(shape).background(Bf.bgSoft)
          .border(1.dp, if (bad) Bf.danger else if (focused) Bf.accentSoft else Bf.ruleStrong, shape).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Icon(BfIcons.server, null, tint = if (focused) Bf.accentSoft else Bf.inkFaint, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        Box(Modifier.weight(1f)) {
          if (address.isEmpty()) Text("host:port", style = Bf.mono(14.sp, Bf.inkFaint, 400))
          BasicTextField(
            address, { address = it.take(64) }, singleLine = true, textStyle = Bf.mono(14.sp, Bf.ink, 500),
            cursorBrush = SolidColor(Bf.accentSoft),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next, keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
            modifier = Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused },
          )
        }
      }
      Text(
        if (bad) "Not a host and port" else " ", style = Bf.text(12.sp, Bf.danger),
        modifier = Modifier.padding(start = 4.dp, top = 6.dp),
      )
      Spacer(Modifier.height(10.dp))
      Text("PLAY AS", style = Bf.eyebrow())
      Spacer(Modifier.height(8.dp))
      NameField(name, onName, nameError != null, Modifier.fillMaxWidth()) { go() }
      Text(nameError ?: " ", style = Bf.text(12.sp, Bf.danger), modifier = Modifier.padding(start = 4.dp, top = 6.dp))
    }
    Box(
      Modifier.fillMaxWidth().background(Bf.bgSoft).windowInsetsPadding(WindowInsets.navigationBars.union(WindowInsets.ime))
        .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
      Btn("Join", ::go, Modifier.fillMaxWidth(), kind = BtnKind.PRIMARY, icon = BfIcons.play, enabled = can, height = 48.dp)
    }
  }
}

