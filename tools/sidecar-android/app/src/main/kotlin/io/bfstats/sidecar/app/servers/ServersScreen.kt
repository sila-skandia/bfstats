package io.bfstats.sidecar.app.servers

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.bfstats.sidecar.Load
import io.bfstats.sidecar.ServerDetail
import io.bfstats.sidecar.app.LiveViewModel
import io.bfstats.sidecar.app.R
import io.bfstats.sidecar.app.ui.AcTag
import io.bfstats.sidecar.app.ui.Bf
import io.bfstats.sidecar.app.ui.BfIcons
import io.bfstats.sidecar.app.ui.Btn
import io.bfstats.sidecar.app.ui.BtnKind
import io.bfstats.sidecar.app.ui.EmptyState
import io.bfstats.sidecar.app.ui.IconBtn
import io.bfstats.sidecar.app.ui.LoadBar
import io.bfstats.sidecar.app.ui.MapThumb
import io.bfstats.sidecar.app.ui.PwTag
import io.bfstats.sidecar.app.ui.Shimmer
import io.bfstats.sidecar.app.ui.StatusDot
import io.bfstats.sidecar.app.ui.TicketSplit
import io.bfstats.sidecar.app.ui.flagOf
import io.bfstats.sidecar.app.ui.lettersOf
import io.bfstats.sidecar.clockText
import io.bfstats.sidecar.gameTypeTitle
import io.bfstats.sidecar.loadOf
import io.bfstats.sidecar.roundLeft
import io.bfstats.sidecar.titleCase

/** How many rows draw before "Show all" (panel.js RENDER_MAX). */
private const val RENDER_MAX = 60

/** The live server list: busiest first, a tap opens the server. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServersScreen(
  state: LiveViewModel.ListState,
  now: Long,
  current: String?,
  onRefresh: () -> Unit,
  onOpen: (ServerDetail) -> Unit,
  onJoinAddress: () -> Unit,
  sessionBar: (@Composable () -> Unit)?,
) {
  var query by rememberSaveable { mutableStateOf("") }
  var showAll by rememberSaveable { mutableStateOf(false) }
  val all = state.servers
  val q = query.trim().lowercase()
  val matches = all?.filter { q.isEmpty() || matchesQuery(it, q) }

  val navBottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
  androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize().background(Bf.bg).windowInsetsPadding(WindowInsets.displayCutout.union(WindowInsets.navigationBars).only(WindowInsetsSides.Horizontal))) {
  val cols = if (maxWidth >= 700.dp) 2 else 1
  val focus = LocalFocusManager.current
  // Search (panel.css .search): under the header, or in it on a wide screen.
  val search: @Composable (Modifier) -> Unit = { m ->
    Row(
      m.height(42.dp).clip(RoundedCornerShape(10.dp)).background(Bf.bgSoft).border(1.dp, Bf.rule, RoundedCornerShape(10.dp))
        .padding(horizontal = 12.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Icon(BfIcons.search, null, tint = Bf.inkFaint, modifier = Modifier.size(18.dp))
      Spacer(Modifier.width(10.dp))
      Box(Modifier.weight(1f)) {
        if (query.isEmpty()) Text("Server, map or mod", style = Bf.text(14.sp, Bf.inkFaint))
        BasicTextField(
          query, { query = it.take(64); showAll = false }, singleLine = true,
          textStyle = Bf.text(14.sp, Bf.ink), cursorBrush = SolidColor(Bf.accentSoft),
          keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
          keyboardActions = androidx.compose.foundation.text.KeyboardActions(onSearch = { focus.clearFocus() }),
          modifier = Modifier.fillMaxWidth(),
        )
      }
      if (query.isNotEmpty()) IconBtn(BfIcons.close, "Clear", { query = "" }, Modifier.size(32.dp))
    }
  }
  Column(Modifier.fillMaxSize()) {
    // Header: the brand, the list's state, join by address, refresh.
    Row(
      Modifier.fillMaxWidth().background(Brush.headerGlow).windowInsetsPadding(WindowInsets.statusBars)
        .padding(start = 16.dp, end = 6.dp, top = 10.dp, bottom = 6.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Image(
        painterResource(R.mipmap.ic_launcher), null,
        modifier = Modifier.size(34.dp),
      )
      Spacer(Modifier.width(12.dp))
      Column(Modifier.weight(1f)) {
        Row(verticalAlignment = Alignment.Bottom) {
          Text("bfstats", style = Bf.text(17.sp, Bf.inkSoft, 500))
          Text(".io", style = Bf.text(17.sp, Bf.ink, 650))
        }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 1.dp)) {
          val ok = all != null && state.problem == null
          Box(Modifier.size(9.dp), contentAlignment = Alignment.Center) {
            StatusDot(if (state.problem != null) Bf.danger else if (ok) Bf.joined else Bf.joining, pulse = ok, blink = all == null, size = 6.dp)
          }
          Spacer(Modifier.width(6.dp))
          val players = all?.sumOf { it.server.numPlayers } ?: 0
          val words = when {
            state.problem != null && all != null -> "Offline · last list"
            state.problem != null -> "Offline"
            all == null -> "Loading"
            else -> "Live · ${all.size} servers · $players players"
          }
          Text(words.uppercase(), style = Bf.eyebrow(10.sp, Bf.inkMuted, 500, 0.1f), maxLines = 1)
        }
      }
      if (cols > 1) search(Modifier.weight(1.3f).padding(horizontal = 12.dp))
      IconBtn(BfIcons.link, "Join by address", onJoinAddress)
      IconBtn(BfIcons.refresh, "Refresh", onRefresh, spin = state.loading)
    }

    if (cols == 1) search(Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth())

    val pull = rememberPullToRefreshState()
    PullToRefreshBox(
      isRefreshing = state.loading && all != null, onRefresh = onRefresh, state = pull, modifier = Modifier.weight(1f),
      indicator = {
        PullToRefreshDefaults.Indicator(
          state = pull, isRefreshing = state.loading && all != null, modifier = Modifier.align(Alignment.TopCenter),
          containerColor = Bf.bgMute, color = Bf.accentSoft,
        )
      },
    ) {
      when {
        all == null && state.problem != null -> Centered {
          EmptyState(
            BfIcons.offline, if (state.problem.offline) "No connection" else "The list did not load",
            if (state.problem.offline) "bfstats.io could not be reached. Check the connection and try again." else state.problem.detail,
          ) { Btn("Try again", onRefresh, kind = BtnKind.SOFT, icon = BfIcons.refresh) }
        }
        all == null -> SkeletonList()
        all.isEmpty() -> Centered {
          EmptyState(BfIcons.server, "No servers online", "Nothing is running right now. The list refreshes every minute.")
        }
        matches!!.isEmpty() -> Centered {
          EmptyState(BfIcons.search, "No match", "No server, map or mod matches \"${query.trim()}\".") {
            Btn("Clear search", { query = "" }, kind = BtnKind.GHOST, height = 38.dp)
          }
        }
        else -> {
          val shown = if (showAll) matches else matches.take(RENDER_MAX)
          val populated = shown.filter { it.server.numPlayers > 0 }
          val empty = shown.filter { it.server.numPlayers <= 0 }
          LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp + if (sessionBar == null) navBottom else 0.dp)) {
            if (state.problem != null) item("problem") {
              io.bfstats.sidecar.app.ui.Notice(
                "Showing the last list: ${state.problem.detail.replaceFirstChar { it.lowercase() }}.", Bf.danger, BfIcons.offline,
                Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
              )
            }
            if (populated.isNotEmpty()) {
              stickyHeader("h-pop") { Group("Populated", "${matches.sumOf { it.server.numPlayers }} players") }
              rows(populated, cols) { ServerRow(it, now - state.fetchedAt, current == it.server.address, onOpen) }
            }
            if (empty.isNotEmpty()) {
              stickyHeader("h-empty") { Group("Empty", "${matches.count { it.server.numPlayers <= 0 }}") }
              rows(empty, cols) { ServerRow(it, now - state.fetchedAt, current == it.server.address, onOpen) }
            }
            if (matches.size > shown.size) item("more") {
              Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                Btn("Show all ${matches.size}", { showAll = true }, Modifier.fillMaxWidth(), height = 38.dp)
              }
            }
          }
        }
      }
    }
    sessionBar?.invoke()
  }
  }
}

/** Rows one to a line, or two side by side on a wide screen (landscape). */
private fun androidx.compose.foundation.lazy.LazyListScope.rows(list: List<ServerDetail>, cols: Int, row: @Composable (ServerDetail) -> Unit) {
  if (cols == 1) items(list, key = { it.server.address }) { row(it) }
  else items(list.chunked(cols), key = { it.first().server.address }) { line ->
    Row(Modifier.padding(horizontal = 8.dp)) {
      line.forEach { Box(Modifier.weight(1f)) { row(it) } }
      repeat(cols - line.size) { Spacer(Modifier.weight(1f)) }
    }
  }
}

private object Brush {
  /** The panel's olive glow in the top right (panel.css .shell). */
  val headerGlow = androidx.compose.ui.graphics.Brush.radialGradient(
    listOf(Color(0x147D8849), Color.Transparent), center = androidx.compose.ui.geometry.Offset(1200f, 0f), radius = 900f,
  )
}

private fun matchesQuery(d: ServerDetail, q: String): Boolean {
  val s = d.server
  return listOf(s.name, s.mapName, s.gameId, s.gameType, s.address).any { it != null && it.lowercase().contains(q) } ||
    titleCase(s.mapName).lowercase().contains(q)
}

@Composable
private fun Centered(content: @Composable () -> Unit) {
  // A column, so the pull-to-refresh gesture still has something to scroll.
  LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
    item { content() }
  }
}

@Composable
private fun Group(left: String, right: String) {
  Row(
    Modifier.fillMaxWidth().background(Bf.bg).padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 6.dp),
    horizontalArrangement = Arrangement.SpaceBetween,
  ) {
    Text(left.uppercase(), style = Bf.eyebrow())
    Text(right.uppercase(), style = Bf.eyebrow())
  }
}

private fun loadColor(l: Load) = when (l) {
  Load.FULL -> Bf.danger
  Load.BUSY -> Bf.loadBusy
  else -> Bf.accent
}

@Composable
private fun ServerRow(d: ServerDetail, elapsedMs: Long, isCurrent: Boolean, onOpen: (ServerDetail) -> Unit) {
  val s = d.server
  val load = loadOf(s.numPlayers, s.maxPlayers)
  val shape = RoundedCornerShape(10.dp)
  Row(
    Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 1.dp).clip(shape)
      .then(if (isCurrent) Modifier.background(Color(0x1A7D8849)).border(1.dp, Color(0x597D8849), shape) else Modifier)
      .clickable(onClickLabel = "Open ${s.name}") { onOpen(d) }
      .padding(horizontal = 8.dp, vertical = 9.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    MapThumb(s.thumb, lettersOf(s.mapName ?: s.name), Modifier.size(64.dp, 48.dp))
    Spacer(Modifier.width(12.dp))
    Column(Modifier.weight(1f)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
          s.name, style = Bf.text(15.sp, if (load == Load.IDLE) Bf.inkSoft else Bf.ink, 550), maxLines = 1,
          overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
        )
        if (s.anticheat) { Spacer(Modifier.width(6.dp)); AcTag() }
        if (s.password) { Spacer(Modifier.width(6.dp)); PwTag() }
      }
      Spacer(Modifier.height(2.dp))
      Row(verticalAlignment = Alignment.CenterVertically) {
        flagOf(s.country)?.let { Text(it, fontSize = 12.sp, modifier = Modifier.padding(end = 6.dp)) }
        val sub = listOfNotNull(
          titleCase(s.mapName).ifEmpty { null }, gameTypeTitle(s.gameType).ifEmpty { null },
          s.gameId?.takeIf { it.lowercase() != "bf1942" },
        ).joinToString("  ·  ").ifEmpty { s.address }
        Text(sub, style = Bf.text(12.5.sp, Bf.inkMuted), maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
      // A populated round: the clock and the tickets, as the panel's card shows them.
      val left = roundLeft(s.roundTimeRemain, elapsedMs)
      if (s.numPlayers > 0 && (left != null || (s.tickets1 != null && s.tickets2 != null))) {
        Spacer(Modifier.height(5.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
          if (left != null) {
            Icon(BfIcons.clock, null, tint = Bf.inkFaint, modifier = Modifier.size(12.dp))
            Spacer(Modifier.width(4.dp))
            Text(clockText(left), style = Bf.mono(11.sp, Bf.inkSoft))
            Spacer(Modifier.width(12.dp))
          }
          val t1 = s.tickets1; val t2 = s.tickets2
          if (t1 != null && t2 != null && t1 + t2 > 0) {
            Text("$t1", style = Bf.mono(11.sp, Bf.inkSoft))
            Spacer(Modifier.width(6.dp))
            TicketSplit(t1, t2, Bf.teamColor(s.team1, 1), Bf.teamColor(s.team2, 2), Modifier.widthIn(max = 72.dp).weight(1f, fill = false).width(72.dp), 3.dp)
            Spacer(Modifier.width(6.dp))
            Text("$t2", style = Bf.mono(11.sp, Bf.inkSoft))
          }
        }
      }
    }
    Spacer(Modifier.width(12.dp))
    Column(Modifier.width(54.dp), horizontalAlignment = Alignment.End) {
      Row(verticalAlignment = Alignment.Bottom) {
        Text("${s.numPlayers}", style = Bf.mono(14.sp, if (load == Load.IDLE) Bf.inkFaint else Bf.ink, 500))
        Text("/${s.maxPlayers}", style = Bf.mono(11.sp, Bf.inkFaint))
      }
      Spacer(Modifier.height(5.dp))
      val pct = if (s.maxPlayers > 0) (s.numPlayers.toFloat() / s.maxPlayers).coerceAtMost(1f) else 0f
      LoadBar(if (s.numPlayers > 0) maxOf(pct, 0.04f) else 0f, loadColor(load), Modifier.fillMaxWidth())
    }
  }
}

@Composable
private fun SkeletonList() {
  Column(Modifier.fillMaxSize().padding(top = 8.dp)) {
    Shimmer(Modifier.padding(start = 16.dp, top = 8.dp, bottom = 10.dp).size(80.dp, 10.dp))
    repeat(8) {
      Row(Modifier.padding(horizontal = 16.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
        Shimmer(Modifier.size(64.dp, 48.dp))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
          Shimmer(Modifier.fillMaxWidth(0.7f).height(13.dp))
          Spacer(Modifier.height(8.dp))
          Shimmer(Modifier.fillMaxWidth(0.45f).height(10.dp))
        }
        Spacer(Modifier.width(12.dp))
        Shimmer(Modifier.size(40.dp, 12.dp))
      }
    }
  }
}

/** Shown under either screen while a join is up: where, how it is going,
 *  open the game, leave (the panel's session card, compact). */
@Composable
fun SessionBar(title: String, thumb: String?, word: String, who: String, live: Boolean, onOpen: () -> Unit, onLeave: () -> Unit, canOpen: Boolean) {
  Column(Modifier.fillMaxWidth().background(Bf.bgSoft)) {
    Box(Modifier.fillMaxWidth().height(1.dp).background(Bf.rule))
    Row(
      Modifier.fillMaxWidth().windowInsetsPadding(WindowInsets.navigationBars).padding(horizontal = 12.dp, vertical = 10.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      MapThumb(thumb, lettersOf(title), Modifier.size(44.dp, 33.dp))
      Spacer(Modifier.width(10.dp))
      Column(Modifier.weight(1f)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Box(Modifier.size(9.dp), contentAlignment = Alignment.Center) { StatusDot(if (live) Bf.joined else Bf.joining, pulse = live, blink = !live, size = 6.dp) }
          Spacer(Modifier.width(6.dp))
          Text(word.uppercase(), style = Bf.eyebrow(10.sp, Bf.inkMuted, 500, 0.1f))
          Text("  as $who", style = Bf.text(11.5.sp, Bf.inkMuted), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Text(title, style = Bf.text(13.5.sp, Bf.ink, 550), maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
      Spacer(Modifier.width(8.dp))
      Btn("Open", onOpen, kind = BtnKind.PRIMARY, icon = BfIcons.play, enabled = canOpen, height = 38.dp)
      Spacer(Modifier.width(6.dp))
      IconBtn(BfIcons.exit, "Leave", onLeave, tint = Bf.danger)
    }
  }
}
