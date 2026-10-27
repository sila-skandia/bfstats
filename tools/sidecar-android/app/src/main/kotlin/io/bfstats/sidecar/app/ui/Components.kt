package io.bfstats.sidecar.app.ui

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage

/** Map images that answered 404 this run (panel.js missingThumbs): not asked
 *  for again, the fallback shows at once. */
object MissingImages {
  private val missing = mutableStateMapOf<String, Boolean>()
  fun isMissing(url: String?) = url == null || missing[url] == true
  fun add(url: String) { missing[url] = true }
}

/** A map image that fades in once loaded, over [fallback] (drawn until then,
 *  and for good when the image 404s). */
@Composable
fun MapImage(url: String?, modifier: Modifier = Modifier, dim: Float = 0.85f, fallback: @Composable BoxScope.() -> Unit) {
  var loaded by remember(url) { mutableStateOf(false) }
  val alpha by animateFloatAsState(if (loaded) 1f else 0f, tween(320), label = "img")
  Box(modifier) {
    if (!loaded) fallback()
    if (!MissingImages.isMissing(url)) {
      AsyncImage(
        model = url, contentDescription = null, contentScale = ContentScale.Crop,
        // The panel's saturate(0.85): the art sits under the ink, not over it.
        colorFilter = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(dim) }),
        onSuccess = { loaded = true },
        onError = { url?.let(MissingImages::add) },
        modifier = Modifier.fillMaxSize().graphicsLayer { this.alpha = alpha },
      )
    }
  }
}

/** The panel's map art fallback: a dark olive wash with faint contour rings. */
fun Modifier.topo(): Modifier = drawBehind {
  drawRect(Brush.linearGradient(listOf(Color(0xFF2A2D1D), Color(0xFF1B1C16), Color(0xFF161616)), Offset.Zero, Offset(size.width, size.height)))
  val c = Offset(size.width * 0.78f, size.height * 0.3f)
  val step = 14.dp.toPx()
  var r = step
  val max = size.width + size.height
  while (r < max) {
    drawCircle(Color(0x129AA666), r, c, style = Stroke(1.dp.toPx()))
    r += step
  }
}

/** A row's thumbnail: the map image, or the first letters on the olive wash. */
@Composable
fun MapThumb(url: String?, letters: String, modifier: Modifier = Modifier) {
  val shape = RoundedCornerShape(6.dp)
  MapImage(url, modifier.clip(shape).border(1.dp, Color(0x0FFFFFFF), shape)) {
    Box(
      Modifier.fillMaxSize().background(Brush.linearGradient(listOf(Color(0xFF2A2D1D), Color(0xFF181818)))),
      contentAlignment = Alignment.Center,
    ) { Text(letters, style = Bf.mono(12.sp, Color(0x8C9AA666), 600)) }
  }
}

/** [AC] / [PW] / BOT: a small mono tag (panel.css .badge). */
@Composable
fun Tag(text: String, color: Color = Bf.inkMuted, border: Color = Bf.ruleStrong, fill: Color = Color.Transparent) {
  Box(
    Modifier.clip(RoundedCornerShape(3.dp)).background(fill).border(1.dp, border, RoundedCornerShape(3.dp))
      .padding(horizontal = 4.dp, vertical = 1.dp),
  ) { Text(text, style = Bf.eyebrow(9.sp, color, 600, 0.06f), maxLines = 1) }
}

@Composable fun AcTag() = Tag("AC", Bf.loadBusy, Color(0x73C5A23A))
@Composable fun PwTag() = Tag("PW", Bf.inkSoft)

/** A country as a styled ISO badge (the site's mm-country-badge): headers and
 *  prose, where a flag would be decoration. */
@Composable
fun CountryBadge(code: String) = Tag(code, Bf.inkSoft, Bf.ruleStrong, Color(0x99131313))

/** A country's flag, for the one place it is allowed: marking where a server
 *  is in a list row (CLAUDE.md, No Emojis Policy). */
fun flagOf(code: String?): String? {
  if (code == null || code.length != 2 || !code.all { it in 'A'..'Z' }) return null
  return String(Character.toChars(0x1F1E6 + (code[0] - 'A'))) + String(Character.toChars(0x1F1E6 + (code[1] - 'A')))
}

/** players/max fill (panel.css .bar), tinted by load. */
@Composable
fun LoadBar(fraction: Float, color: Color, modifier: Modifier = Modifier) {
  Box(modifier.height(3.dp).clip(RoundedCornerShape(2.dp)).background(Bf.bgMute)) {
    if (fraction > 0f) Box(Modifier.fillMaxHeight().fillMaxWidth(fraction.coerceIn(0f, 1f)).clip(RoundedCornerShape(2.dp)).background(color))
  }
}

/** Tickets as one split bar, each side in its team's colour (panel.css .split). */
@Composable
fun TicketSplit(t1: Int, t2: Int, c1: Color, c2: Color, modifier: Modifier = Modifier, height: Dp = 4.dp) {
  val total = maxOf(1, t1 + t2).toFloat()
  val a by animateFloatAsState((t1 / total).coerceIn(0.001f, 0.999f), tween(500), label = "split")
  Row(modifier.height(height).clip(RoundedCornerShape(height / 2)).background(Bf.bgMute)) {
    Box(Modifier.weight(a).fillMaxHeight().background(c1))
    Spacer(Modifier.width(2.dp).fillMaxHeight().background(Bf.bg))
    Box(Modifier.weight(1f - a).fillMaxHeight().background(c2))
  }
}

/** The tray's status dot: green and pulsing when live, amber blinking while
 *  joining, grey otherwise. */
@Composable
fun StatusDot(color: Color, pulse: Boolean = false, blink: Boolean = false, size: Dp = 7.dp) {
  val t = rememberInfiniteTransition(label = "dot")
  val p by t.animateFloat(0f, 1f, infiniteRepeatable(tween(2200, easing = FastOutSlowInEasing)), label = "pulse")
  val b by t.animateFloat(1f, 0.3f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "blink")
  Canvas(Modifier.size(size + 14.dp)) {
    val c = center
    val r = size.toPx() / 2
    if (pulse) drawCircle(color.copy(alpha = 0.55f * (1 - p)), r + 7.dp.toPx() * p, c)
    drawCircle(color.copy(alpha = if (blink) b else 1f), r, c)
  }
}

/** The status pill (panel.css .chip): a dot and a mono word. */
@Composable
fun Chip(word: String, dot: Color, pulse: Boolean = false, blink: Boolean = false) {
  Row(
    Modifier.clip(CircleShape).background(Color(0x990A0A0A)).border(1.dp, Color(0x14FFFFFF), CircleShape)
      .padding(start = 0.dp, end = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Box(Modifier.padding(start = 0.dp)) { StatusDot(dot, pulse, blink) }
    Text(word.uppercase(), style = Bf.eyebrow(10.sp, Bf.ink, 500, 0.1f), modifier = Modifier.padding(start = 0.dp))
  }
}

/** The panel's square icon button (panel.css .icon-btn). */
@Composable
fun IconBtn(icon: ImageVector, label: String, onClick: () -> Unit, modifier: Modifier = Modifier, spin: Boolean = false, tint: Color = Bf.inkMuted, enabled: Boolean = true) {
  val t = rememberInfiniteTransition(label = "spin")
  val deg by t.animateFloat(0f, 360f, infiniteRepeatable(tween(800, easing = LinearEasing)), label = "deg")
  Box(
    modifier.size(40.dp).clip(RoundedCornerShape(10.dp)).clickable(enabled = enabled, onClickLabel = label, onClick = onClick),
    contentAlignment = Alignment.Center,
  ) {
    Icon(icon, label, tint = if (enabled) tint else Bf.inkFaint, modifier = Modifier.size(20.dp).rotate(if (spin) deg else 0f))
  }
}

enum class BtnKind { PRIMARY, GHOST, DANGER, SOFT }

/** The panel's buttons (panel.css .btn, .primary, .ghost, .danger). */
@Composable
fun Btn(
  text: String, onClick: () -> Unit, modifier: Modifier = Modifier, kind: BtnKind = BtnKind.GHOST,
  icon: ImageVector? = null, enabled: Boolean = true, height: Dp = 44.dp, busy: Boolean = false,
) {
  val (bg, fg, border) = when (kind) {
    BtnKind.PRIMARY -> Triple(Bf.accent, Bf.ink, Bf.accent)
    BtnKind.SOFT -> Triple(Color(0x297D8849), Color(0xFFE6EBCF), Color(0x809AA666))
    BtnKind.DANGER -> Triple(Color(0x99131313), Color(0xFFFFD9D9), Color(0x80D65A5A))
    BtnKind.GHOST -> Triple(Bf.bgMute, Bf.ink, Bf.ruleStrong)
  }
  val shape = RoundedCornerShape(10.dp)
  Row(
    modifier.height(height).graphicsLayer { alpha = if (enabled) 1f else 0.45f }.clip(shape).background(bg)
      .border(1.dp, border, shape).clickable(enabled = enabled && !busy, onClick = onClick).padding(horizontal = 16.dp),
    horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
  ) {
    if (busy) Spinner(fg, 16.dp) else if (icon != null) Icon(icon, null, tint = fg, modifier = Modifier.size(16.dp))
    if (busy || icon != null) Spacer(Modifier.width(8.dp))
    Text(text, style = Bf.text(14.sp, fg, 600), maxLines = 1, overflow = TextOverflow.Ellipsis)
  }
}

/** A ring with an olive arc (panel.css .acct-spin). */
@Composable
fun Spinner(color: Color = Bf.accentSoft, size: Dp = 18.dp) {
  val t = rememberInfiniteTransition(label = "spinner")
  val deg by t.animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing)), label = "deg")
  Canvas(Modifier.size(size).rotate(deg)) {
    val w = 2.dp.toPx()
    drawCircle(Bf.ruleStrong, this.size.minDimension / 2 - w / 2, style = Stroke(w))
    drawArc(color, -90f, 90f, false, topLeft = Offset(w / 2, w / 2), size = androidx.compose.ui.geometry.Size(this.size.width - w, this.size.height - w), style = Stroke(w))
  }
}

/** A loading placeholder bar with a slow sheen. */
@Composable
fun Shimmer(modifier: Modifier) {
  val t = rememberInfiniteTransition(label = "shimmer")
  val x by t.animateFloat(-1f, 2f, infiniteRepeatable(tween(1400, easing = LinearEasing)), label = "x")
  Box(
    modifier.clip(RoundedCornerShape(4.dp)).drawBehind {
      drawRect(Bf.bgSoft)
      val w = size.width
      drawRect(Brush.horizontalGradient(listOf(Color.Transparent, Color(0x10FFFFFF), Color.Transparent), startX = w * x - w * 0.4f, endX = w * x + w * 0.4f))
    },
  )
}

/** A designed empty or failed state: a dashed mark, a title, a line, an action. */
@Composable
fun EmptyState(icon: ImageVector, title: String, body: String, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
  Column(modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
    Box(
      Modifier.size(56.dp).drawBehind {
        drawRoundRect(
          Bf.ruleStrong, cornerRadius = androidx.compose.ui.geometry.CornerRadius(14.dp.toPx()),
          style = Stroke(1.dp.toPx(), pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(5.dp.toPx(), 4.dp.toPx()))),
        )
      },
      contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = Bf.inkFaint, modifier = Modifier.size(24.dp)) }
    Spacer(Modifier.height(16.dp))
    Text(title, style = Bf.text(16.sp, Bf.ink, 600), textAlign = TextAlign.Center)
    Spacer(Modifier.height(6.dp))
    Text(body, style = Bf.text(13.sp, Bf.inkMuted), textAlign = TextAlign.Center, modifier = Modifier.widthIn(max = 300.dp))
    if (action != null) { Spacer(Modifier.height(18.dp)); action() }
  }
}

/** A thin olive-tinted strip for a notice (panel.css .notice). */
@Composable
fun Notice(text: String, color: Color = Bf.loadBusy, icon: ImageVector? = null, modifier: Modifier = Modifier) {
  Row(
    modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Bf.bgSoft)
      .border(BorderStroke(1.dp, Bf.rule), RoundedCornerShape(8.dp))
      .drawBehind { drawRect(color, size = androidx.compose.ui.geometry.Size(2.dp.toPx(), size.height)) }
      .padding(PaddingValues(start = 14.dp, end = 12.dp, top = 10.dp, bottom = 10.dp)),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    if (icon != null) { Icon(icon, null, tint = color, modifier = Modifier.size(16.dp)); Spacer(Modifier.width(10.dp)) }
    Text(text, style = Bf.text(13.sp, Bf.inkSoft))
  }
}

/** The two letters a row shows when its map has no picture. */
fun lettersOf(s: String?): String = (s ?: "?").trim().take(2).uppercase().ifEmpty { "?" }

@Composable
fun RowScope.Grow() = Spacer(Modifier.weight(1f))
