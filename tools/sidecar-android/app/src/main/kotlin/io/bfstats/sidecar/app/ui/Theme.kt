package io.bfstats.sidecar.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import io.bfstats.sidecar.app.R

// The site's V4 "Neutral Depth" identity (ui/src/styles/modern-minimal.css),
// as the tray app's panel carries it (tools/sidecar-desktop/src/ui/panel.css):
// keep the three in step.
object Bf {
  val bg = Color(0xFF131313)
  val bgSoft = Color(0xFF1A1A1A)
  val bgMute = Color(0xFF222222)
  val rule = Color(0xFF2D2D2D)
  val ruleStrong = Color(0xFF3D3D3D)
  val ink = Color(0xFFFFFFFF)
  val inkSoft = Color(0xFFC8C8C8)
  val inkMuted = Color(0xFF8A8A8A)
  val inkFaint = Color(0xFF555555)
  val accent = Color(0xFF7D8849)
  val accentSoft = Color(0xFF9AA666)
  val highlight = Color(0xFF847D4C)
  val highlightInk = Color(0xFF000000)
  val elite = Color(0xFFB4C060)
  val success = Color(0xFF7DA34C)
  val danger = Color(0xFFD65A5A)
  val loadBusy = Color(0xFFC5A23A)
  val joined = Color(0xFF2ECC40)
  val joining = Color(0xFFFF9500)
  val axis = Color(0xFFD65A5A)
  val allies = Color(0xFF7DA34C)
  val kill = Color(0xFFD65A5A)
  val death = Color(0xFF8A8A8A)
  val kdLow = Color(0xFF8A8A6A)

  // Geist and Geist Mono, variable (res/font, OFL: assets/licenses/Geist-OFL.txt).
  private fun geist(w: Int) = Font(R.font.geist, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))
  private fun mono(w: Int) = Font(R.font.geist_mono, FontWeight(w), variationSettings = FontVariation.Settings(FontVariation.weight(w)))
  val sans = FontFamily(geist(400), geist(500), geist(550), geist(600), geist(650), geist(700))
  val monoFamily = FontFamily(mono(400), mono(500), mono(600), mono(700))

  /** The mono eyebrow: small caps-tracked labels (panel.css .eyebrow). */
  fun eyebrow(size: TextUnit = 10.sp, color: Color = inkMuted, weight: Int = 500, tracking: Float = 0.12f) = TextStyle(
    fontFamily = monoFamily, fontWeight = FontWeight(weight), fontSize = size, letterSpacing = tracking.em, color = color,
  )

  fun mono(size: TextUnit, color: Color = inkSoft, weight: Int = 500) = TextStyle(
    fontFamily = monoFamily, fontWeight = FontWeight(weight), fontSize = size, color = color,
    fontFeatureSettings = "tnum",
  )

  fun text(size: TextUnit, color: Color = ink, weight: Int = 400) = TextStyle(
    fontFamily = sans, fontWeight = FontWeight(weight), fontSize = size, color = color,
  )

  /** Team colours (the site's mmTokens.ts teamColor, panel.js teamColor). */
  fun teamColor(label: String?, index: Int): Color {
    val l = (label ?: "team $index").lowercase()
    return when {
      Regex("axis|german|red|north|nva|team 2").containsMatchIn(l) -> axis
      Regex("alli|usa|blue|south|team 1").containsMatchIn(l) -> allies
      else -> accent
    }
  }

  /** The roster's score and ping tints (MmPlayersPanel.vue). */
  fun scoreColor(score: Int) = when { score >= 100 -> elite; score >= 50 -> accent; score >= 25 -> ink; else -> kdLow }
  fun pingColor(ping: Int) = when { ping == 0 -> inkFaint; ping <= 60 -> ink; ping <= 120 -> kdLow; ping <= 200 -> kill; else -> danger }
}

@Composable
fun BfTheme(content: @Composable () -> Unit) {
  val base = MaterialTheme.typography
  MaterialTheme(
    colorScheme = darkColorScheme(
      background = Bf.bg, surface = Bf.bgSoft, surfaceVariant = Bf.bgMute, primary = Bf.accent, onPrimary = Bf.ink,
      secondary = Bf.accentSoft, onBackground = Bf.ink, onSurface = Bf.ink, outline = Bf.ruleStrong, error = Bf.danger,
    ),
    typography = base.copy(
      bodyLarge = base.bodyLarge.copy(fontFamily = Bf.sans),
      bodyMedium = base.bodyMedium.copy(fontFamily = Bf.sans),
      bodySmall = base.bodySmall.copy(fontFamily = Bf.sans),
      labelLarge = base.labelLarge.copy(fontFamily = Bf.sans),
      titleMedium = base.titleMedium.copy(fontFamily = Bf.sans),
    ),
    content = content,
  )
}
