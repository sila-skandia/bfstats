package io.bfstats.sidecar.app.servers

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.asPaddingValues
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
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.bfstats.sidecar.LivePlayer
import io.bfstats.sidecar.LiveTeam
import io.bfstats.sidecar.ServerDetail
import io.bfstats.sidecar.app.ServerViewModel
import io.bfstats.sidecar.app.ui.AcTag
import io.bfstats.sidecar.app.ui.Bf
import io.bfstats.sidecar.app.ui.BfIcons
import io.bfstats.sidecar.app.ui.Btn
import io.bfstats.sidecar.app.ui.BtnKind
import io.bfstats.sidecar.app.ui.Chip
import io.bfstats.sidecar.app.ui.CountryBadge
import io.bfstats.sidecar.app.ui.EmptyState
import io.bfstats.sidecar.app.ui.IconBtn
import io.bfstats.sidecar.app.ui.MapImage
import io.bfstats.sidecar.app.ui.Notice
import io.bfstats.sidecar.app.ui.PwTag
import io.bfstats.sidecar.app.ui.Shimmer
import io.bfstats.sidecar.app.ui.StatusDot
import io.bfstats.sidecar.app.ui.Tag
import io.bfstats.sidecar.app.ui.TicketSplit
import io.bfstats.sidecar.app.ui.topo
import io.bfstats.sidecar.clockText
import io.bfstats.sidecar.gameTypeTitle
import io.bfstats.sidecar.roundLeft
import io.bfstats.sidecar.sidecarNameError
import io.bfstats.sidecar.titleCase

/** Where the app's join stands relative to the server on screen. */
data class JoinHere(
  /** This server is the one joined. */
  val here: Boolean,
  /** The page socket is up (the game can open). */
  val live: Boolean,
  /** Another server is joined: its name or address. */
  val elsewhere: String?,
)

/** One server: the round, both sides, who is on them, and the join. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServerScreen(
  state: ServerViewModel.State,
  now: Long,
  name: String,
  onName: (String) -> Unit,
  join: JoinHere,
  onBack: () -> Unit,
  onRefresh: () -> Unit,
  onJoin: (ServerDetail) -> Unit,
  onOpenGame: () -> Unit,
  onLeave: () -> Unit,
) {
  val d = state.detail
  BoxWithConstraints(
    Modifier.fillMaxSize().background(Bf.bg)
      .windowInsetsPadding(WindowInsets.displayCutout.union(WindowInsets.navigationBars).only(WindowInsetsSides.Horizontal)),
  ) {
    // Landscape: the round on the left, the players beside it; portrait: one column.
    val landscape = maxWidth > maxHeight && maxWidth >= 600.dp
    val wide = maxWidth >= 600.dp
    val left = if (d == null || state.gone) null else roundLeft(d.server.roundTimeRemain, now - state.fetchedAt)
    val notices: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
      if (d != null && state.gone) item("gone") {
        Notice(
          "This server has left the live list. These are the players last seen on it.", Bf.danger, BfIcons.offline,
          Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
      } else if (d != null && state.problem != null) item("problem") {
        Notice(
          "Not refreshed: ${state.problem.detail.replaceFirstChar { it.lowercase() }}. Pull down to try again.",
          Bf.loadBusy, BfIcons.offline, Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
      }
    }
    val players: androidx.compose.foundation.lazy.LazyListScope.(Boolean) -> Unit = { twoUp ->
      if (d == null) item("loading") {
        if (state.problem != null) EmptyState(
          BfIcons.offline, "Could not load the server", state.problem.detail,
        ) { Btn("Try again", onRefresh, kind = BtnKind.SOFT, icon = BfIcons.refresh) }
        else LoadingBody()
      } else if (d.players.isEmpty()) item("empty") {
        EmptyState(BfIcons.players, "Nobody on yet", "No one is playing here right now. Join and be the first; the list refreshes every 10 seconds.")
      } else if (twoUp && d.teams.size == 2) item("teams") {
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
          d.teams.forEach { TeamTable(it, Modifier.weight(1f)) }
        }
      } else d.teams.forEach { t -> item("team-${t.index}") { TeamTable(t, Modifier.padding(horizontal = 16.dp)) } }
    }
    Column(Modifier.fillMaxSize()) {
      val pull = rememberPullToRefreshState()
      val refreshing = state.loading && d != null
      PullToRefreshBox(
        isRefreshing = refreshing, onRefresh = onRefresh, state = pull, modifier = Modifier.weight(1f),
        indicator = {
          PullToRefreshDefaults.Indicator(
            state = pull, isRefreshing = refreshing, containerColor = Bf.bgMute, color = Bf.accentSoft,
            modifier = Modifier.align(Alignment.TopCenter).windowInsetsPadding(WindowInsets.statusBars),
          )
        },
      ) {
        if (landscape) Row(Modifier.fillMaxSize()) {
          LazyColumn(Modifier.weight(0.42f).fillMaxHeight(), contentPadding = PaddingValues(bottom = 16.dp)) {
            item("header") { Header(d, state, 172.dp, onBack) }
            if (d != null) item("score") { Scoreboard(d, left) }
            notices()
          }
          LazyColumn(
            Modifier.weight(0.58f).fillMaxHeight(),
            contentPadding = PaddingValues(top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding(), bottom = 20.dp),
          ) { players(false) }
        } else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 20.dp)) {
          item("header") { Header(d, state, if (wide) 200.dp else 252.dp, onBack) }
          if (d != null) item("score") { Scoreboard(d, left) }
          notices()
          players(wide)
        }
      }
      JoinBar(d, state.gone, name, onName, join, onJoin, onOpenGame, onLeave)
    }
  }
}

@Composable
private fun Header(d: ServerDetail?, state: ServerViewModel.State, height: androidx.compose.ui.unit.Dp, onBack: () -> Unit) {
  val s = d?.server
  Box(Modifier.fillMaxWidth().height(height + WindowInsets.statusBars.asPaddingValues().calculateTopPadding())) {
    MapImage(s?.thumb, Modifier.fillMaxSize(), dim = 0.8f) { Box(Modifier.fillMaxSize().topo()) }
    // The panel's scrim: the art gives way to the page towards the text.
    Box(
      Modifier.fillMaxSize().background(
        Brush.verticalGradient(0f to Color(0x8C131313), 0.4f to Color(0x66131313), 0.75f to Color(0xD9131313), 1f to Bf.bg),
      ),
    )
    Box(Modifier.fillMaxSize().background(Brush.horizontalGradient(listOf(Color(0x8C131313), Color.Transparent))))
    Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.statusBars).padding(start = 8.dp, end = 16.dp, top = 4.dp, bottom = 14.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.clip(CircleShape).background(Color(0x80131313))) { IconBtn(BfIcons.back, "Back", onBack, tint = Bf.ink) }
        Spacer(Modifier.weight(1f))
        when {
          state.gone -> Chip("Offline", Bf.danger)
          d == null && state.problem != null -> Chip("No connection", Bf.danger)
          d == null -> Chip("Loading", Bf.joining, blink = true)
          state.problem != null -> Chip("Not refreshed", Bf.loadBusy)
          else -> Chip(if (d.players.isEmpty()) "Live · empty" else "Live", Bf.joined, pulse = true)
        }
      }
      Spacer(Modifier.weight(1f))
      if (s == null) {
        Shimmer(Modifier.padding(start = 8.dp).fillMaxWidth(0.6f).height(20.dp))
        Spacer(Modifier.height(10.dp))
        Shimmer(Modifier.padding(start = 8.dp).fillMaxWidth(0.4f).height(12.dp))
        return@Column
      }
      Column(Modifier.padding(start = 8.dp)) {
        Text(s.name, style = Bf.text(23.sp, Bf.ink, 620), maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 27.sp)
        Spacer(Modifier.height(4.dp))
        val meta = listOfNotNull(titleCase(s.mapName).ifEmpty { null }, gameTypeTitle(s.gameType).ifEmpty { null }, s.gameId?.takeIf { it.lowercase() != "bf1942" })
        Text(meta.joinToString("  ·  "), style = Bf.text(14.sp, Bf.inkSoft), maxLines = 1, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
          s.country?.let { CountryBadge(it); Spacer(Modifier.width(8.dp)) }
          Text(s.address, style = Bf.mono(12.sp, Bf.inkMuted, 400), maxLines = 1)
          if (s.anticheat) { Spacer(Modifier.width(8.dp)); AcTag() }
          if (s.password) { Spacer(Modifier.width(6.dp)); PwTag() }
          Spacer(Modifier.weight(1f))
          Text("${s.numPlayers}", style = Bf.mono(13.sp, Bf.ink, 500))
          Text("/${s.maxPlayers}", style = Bf.mono(11.sp, Bf.inkFaint))
          Spacer(Modifier.width(4.dp))
          Icon(BfIcons.players, null, tint = Bf.inkFaint, modifier = Modifier.size(14.dp))
        }
      }
    }
  }
}

/** Both sides' tickets in the headline treatment, the clock between them. */
@Composable
private fun Scoreboard(d: ServerDetail, left: Int?) {
  val shown = d.teams.take(2)
  if (shown.isEmpty()) return
  val a = shown[0]; val b = shown.getOrNull(1)
  Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
    Row(verticalAlignment = Alignment.Bottom) {
      Side(a, d, Alignment.Start, Modifier.weight(1f), leads(a, b))
      Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)) {
        Text(if (left != null) clockText(left) else "--:--", style = Bf.mono(22.sp, if (left != null) Bf.ink else Bf.inkFaint, 500))
        Spacer(Modifier.height(3.dp))
        Text("ROUND LEFT", style = Bf.eyebrow(9.sp, Bf.inkMuted))
      }
      if (b != null) Side(b, d, Alignment.End, Modifier.weight(1f), leads(b, a)) else Spacer(Modifier.weight(1f))
    }
    val t1 = a.tickets; val t2 = b?.tickets
    if (t1 != null && t2 != null && t1 + t2 > 0 && b != null) {
      Spacer(Modifier.height(12.dp))
      TicketSplit(t1, t2, Bf.teamColor(a.label, a.index), Bf.teamColor(b.label, b.index), Modifier.fillMaxWidth(), 6.dp)
    }
  }
}

private fun leads(t: LiveTeam, o: LiveTeam?) = t.tickets != null && o?.tickets != null && t.tickets!! > o.tickets!!

@Composable
private fun Side(t: LiveTeam, d: ServerDetail, align: Alignment.Horizontal, modifier: Modifier, leading: Boolean) {
  Column(modifier, horizontalAlignment = align) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Box(Modifier.size(8.dp).clip(CircleShape).background(Bf.teamColor(t.label, t.index)))
      Spacer(Modifier.width(6.dp))
      Text(t.label.uppercase(), style = Bf.eyebrow(11.sp, Bf.inkSoft, 600), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    // Tickets are the standing: large and olive, the leader lifted (mm-headline-rank).
    Text(
      t.tickets?.toString() ?: "--", style = Bf.text(44.sp, if (t.tickets == null) Bf.inkFaint else if (leading) Bf.elite else Bf.accent, 500)
        .copy(fontFeatureSettings = "tnum", letterSpacing = (-0.01).sp),
      lineHeight = 48.sp,
    )
    val bots = t.players.count { it.bot }
    val n = t.players.size
    Text(
      (if (n == 1) "1 player" else "$n players") + if (bots > 0) " · $bots bot${if (bots == 1) "" else "s"}" else "",
      style = Bf.eyebrow(9.5.sp, Bf.inkMuted, 500, 0.08f),
    )
  }
}

/** One side's players, best first, under the site's olive table anchor. */
@Composable
private fun TeamTable(t: LiveTeam, modifier: Modifier = Modifier) {
  Column(modifier.padding(top = 14.dp)) {
    Row(
      Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 3.dp, topEnd = 3.dp)).background(Bf.highlight)
        .padding(horizontal = 10.dp, vertical = 7.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      val ink = Bf.highlightInk
      Text("${t.label.uppercase()} · ${t.players.size}", style = Bf.eyebrow(11.sp, ink, 650), modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
      Text("SCORE", style = Bf.eyebrow(10.sp, ink, 600), textAlign = TextAlign.End, modifier = Modifier.width(52.dp))
      Text("K / D", style = Bf.eyebrow(10.sp, ink, 600), textAlign = TextAlign.End, modifier = Modifier.width(64.dp))
      Text("PING", style = Bf.eyebrow(10.sp, ink, 600), textAlign = TextAlign.End, modifier = Modifier.width(46.dp))
    }
    if (t.players.isEmpty()) {
      Box(Modifier.fillMaxWidth().border(1.dp, Bf.rule).padding(vertical = 18.dp), contentAlignment = Alignment.Center) {
        Text("No players on this side", style = Bf.text(13.sp, Bf.inkMuted))
      }
    }
    t.players.forEachIndexed { i, p -> PlayerRow(i, p) }
  }
}

@Composable
private fun PlayerRow(i: Int, p: LivePlayer) {
  Column {
    Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
      val rankColor = when (i) { 0 -> Bf.elite; 1 -> Bf.ink; 2 -> Color(0xFFC08A4C); else -> Bf.inkFaint }
      Text((i + 1).toString().padStart(2, '0'), style = Bf.mono(11.sp, rankColor, if (i < 3) 600 else 500), modifier = Modifier.width(26.dp))
      Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
        Text(
          p.displayName, style = Bf.text(14.sp, if (p.bot) Bf.inkSoft else Bf.ink, 500), maxLines = 1,
          overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
        )
        if (p.bot) { Spacer(Modifier.width(6.dp)); Tag("BOT", Bf.inkMuted) }
      }
      Text("${p.score}", style = Bf.mono(14.sp, Bf.scoreColor(p.score), 600), textAlign = TextAlign.End, modifier = Modifier.width(52.dp))
      Row(Modifier.width(64.dp), horizontalArrangement = Arrangement.End) {
        Text("${p.kills}", style = Bf.mono(13.sp, Bf.kill))
        Text(" / ", style = Bf.mono(13.sp, Bf.inkFaint))
        Text("${p.deaths}", style = Bf.mono(13.sp, Bf.death))
      }
      Text(if (p.bot && p.ping == 0) "-" else "${p.ping}", style = Bf.mono(13.sp, Bf.pingColor(p.ping)), textAlign = TextAlign.End, modifier = Modifier.width(46.dp))
    }
    Box(Modifier.fillMaxWidth().height(1.dp).background(Bf.rule))
  }
}

@Composable
private fun LoadingBody() {
  Column(Modifier.padding(16.dp)) {
    Row {
      Shimmer(Modifier.size(90.dp, 48.dp)); Spacer(Modifier.weight(1f)); Shimmer(Modifier.size(60.dp, 30.dp)); Spacer(Modifier.weight(1f)); Shimmer(Modifier.size(90.dp, 48.dp))
    }
    Spacer(Modifier.height(24.dp))
    Shimmer(Modifier.fillMaxWidth().height(28.dp))
    repeat(6) { Spacer(Modifier.height(12.dp)); Shimmer(Modifier.fillMaxWidth().height(18.dp)) }
  }
}

/** The bottom bar: the name to play as and Join, or, once joined here, open
 *  the game and leave. */
@Composable
private fun JoinBar(
  d: ServerDetail?, gone: Boolean, name: String, onName: (String) -> Unit, join: JoinHere,
  onJoin: (ServerDetail) -> Unit, onOpenGame: () -> Unit, onLeave: () -> Unit,
) {
  Column(Modifier.fillMaxWidth().background(Bf.bgSoft)) {
    Box(Modifier.fillMaxWidth().height(1.dp).background(Bf.rule))
    Column(Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars.union(WindowInsets.ime)).padding(horizontal = 12.dp, vertical = 10.dp)) {
      if (join.here) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Box(Modifier.size(9.dp), contentAlignment = Alignment.Center) { StatusDot(if (join.live) Bf.joined else Bf.joining, pulse = join.live, blink = !join.live, size = 6.dp) }
          Spacer(Modifier.width(8.dp))
          Column(Modifier.weight(1f)) {
            Text((if (join.live) "Joined" else "Joining").uppercase(), style = Bf.eyebrow(10.sp, Bf.inkMuted, 500, 0.1f))
            Text("Playing as ${name.trim()}", style = Bf.text(13.sp, Bf.inkSoft), maxLines = 1, overflow = TextOverflow.Ellipsis)
          }
          Btn("Open game", onOpenGame, kind = BtnKind.PRIMARY, icon = BfIcons.play, enabled = join.live, busy = !join.live)
          Spacer(Modifier.width(8.dp))
          Btn("Leave", onLeave, kind = BtnKind.DANGER, icon = BfIcons.exit)
        }
        return@Column
      }
      val nameError = sidecarNameError(name)
      val why = when {
        d == null -> null
        gone -> "The server is offline"
        d.server.password -> "Password protected: the app cannot join it yet"
        nameError != null -> nameError
        join.elsewhere != null -> "Joining leaves ${join.elsewhere}"
        else -> null
      }
      if (why != null) {
        val bad = gone || d?.server?.password == true || nameError != null
        Text(why, style = Bf.text(12.sp, if (bad) Bf.danger else Bf.inkMuted), modifier = Modifier.padding(start = 4.dp, bottom = 8.dp))
      }
      Row(verticalAlignment = Alignment.CenterVertically) {
        NameField(name, onName, nameError != null, Modifier.weight(1f)) { if (d != null) onJoin(d) }
        Spacer(Modifier.width(10.dp))
        val can = d != null && !gone && !d.server.password && name.isNotBlank() && nameError == null
        Btn("Join", { if (d != null) onJoin(d) }, kind = BtnKind.PRIMARY, icon = BfIcons.play, enabled = can, height = 46.dp)
      }
    }
  }
}

/** The name the app joins as (panel.css .prof-input, at phone size). */
@Composable
fun NameField(name: String, onName: (String) -> Unit, bad: Boolean, modifier: Modifier = Modifier, onDone: () -> Unit) {
  var focused by remember { mutableStateOf(false) }
  val focus = LocalFocusManager.current
  val shape = RoundedCornerShape(10.dp)
  Row(
    modifier.height(46.dp).clip(shape).background(Bf.bg)
      .border(1.dp, if (bad) Bf.danger else if (focused) Bf.accentSoft else Bf.ruleStrong, shape).padding(horizontal = 12.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    Icon(BfIcons.user, null, tint = if (focused) Bf.accentSoft else Bf.inkFaint, modifier = Modifier.size(18.dp))
    Spacer(Modifier.width(10.dp))
    Box(Modifier.weight(1f)) {
      if (name.isEmpty()) Text("Player name", style = Bf.text(14.sp, Bf.inkFaint))
      BasicTextField(
        name, { onName(it.take(32)) }, singleLine = true, textStyle = Bf.mono(14.sp, Bf.ink, 500),
        cursorBrush = SolidColor(Bf.accentSoft),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go, autoCorrectEnabled = false),
        keyboardActions = KeyboardActions(onGo = { focus.clearFocus(); onDone() }),
        modifier = Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused },
      )
    }
  }
}
