package io.bfstats.sidecar.app.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp

/** The tray panel's line icons (tools/sidecar-desktop/src/ui/panel.html, the
 *  sprite's symbols), drawn from the same 24-unit paths, plus a few the
 *  companion needs in the same hand. Tint with Icon(tint = ...). */
object BfIcons {
  private fun line(name: String, width: Float, vararg d: String) = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
    for (p in d) addPath(
      PathParser().parsePathString(p).toNodes(), stroke = SolidColor(Color.White), strokeLineWidth = width,
      strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round,
    )
  }.build()

  private fun solid(name: String, d: String) = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
    addPath(PathParser().parsePathString(d).toNodes(), fill = SolidColor(Color.White))
  }.build()

  val refresh = line("refresh", 1.7f, "M19 12a7 7 0 1 1-2.05-4.95M19 4.5V8h-3.5")
  val search = line("search", 1.8f, "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 20 20")
  val play = solid("play", "M8 5.5v13l10.5-6.5z")
  val exit = line("exit", 1.7f, "M14 4.5H6.5v15H14M10.5 12H20M16.5 8.5 20 12l-3.5 3.5")
  val user = line("user", 1.6f, "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0")
  val close = line("close", 1.7f, "M6.5 6.5l11 11M17.5 6.5l-11 11")
  val arrow = line("arrow", 1.8f, "M5 12h14M13 6l6 6-6 6")
  val back = line("back", 1.8f, "M19 12H5M11 6l-6 6 6 6")
  val check = line("check", 1.9f, "M5 12.5l4.5 4.5L19 7.5")
  val external = line("external", 1.7f, "M13.5 5.5H18.5V10.5M18.5 5.5l-8 8M16.5 13.5v5h-11v-11h5")
  val clock = line("clock", 1.6f, "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 8v4.2l2.6 1.6")
  val link = line(
    "link", 1.7f,
    "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1",
    "M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  )
  val server = line("server", 1.6f, "M4.5 5h15v5.5h-15zM4.5 13.5h15V19h-15zM8 7.75h.01M8 16.25h.01")
  val offline = line("offline", 1.7f, "M4 4l16 16", "M8.5 16.5a5 5 0 0 1 7 0M5 12.6a10 10 0 0 1 4.2-2.4M19 12.6a10 10 0 0 0-3-2", "M12 19.5h.01")
  val lock = line("lock", 1.6f, "M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v8.5h-13zM12 14.5v2")
  val players = line("players", 1.6f, "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 19.5a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 13.7a6.5 6.5 0 0 1 3 5.8")
}
