import SwiftUI

/// How many rows draw before "Show all" (panel.js RENDER_MAX).
private let renderMax = 60

/// The live server list: busiest first, a tap opens the server (the Android
/// app's servers/ServersScreen.kt).
struct ServersView: View {
  @EnvironmentObject var live: LiveModel
  @EnvironmentObject var join: JoinController
  @EnvironmentObject var ticker: Ticker
  let onOpen: (Server) -> Void
  let onJoinAddress: () -> Void
  let onOpenGame: () -> Void
  @State private var query = ""
  @State private var showAll = false
  @FocusState private var searching: Bool

  var body: some View {
    GeometryReader { g in
      let cols = g.size.width >= 700 ? 2 : 1
      VStack(spacing: 0) {
        header(wide: cols > 1)
        if cols == 1 { search.padding(.horizontal, 16).padding(.vertical, 6) }
        content(cols: cols)
        if let info = join.info {
          SessionBar(info: info, live: join.live, over: join.over, onOpen: onOpenGame, onLeave: { join.leave() })
        }
      }
      .background(Bf.bg.ignoresSafeArea())
    }
    .onReceive(ticker.$now) { _ in if live.age >= LiveModel.listRefresh { live.refresh() } }
    .onAppear { if live.servers == nil || live.age >= LiveModel.listRefresh { live.refresh() } }
  }

  // ---- the header: the brand, the list's state, join by address, refresh ----

  private func header(wide: Bool) -> some View {
    HStack(spacing: 0) {
      Image("AppLogo").resizable().interpolation(.high).frame(width: 34, height: 34)
      VStack(alignment: .leading, spacing: 1) {
        HStack(alignment: .lastTextBaseline, spacing: 0) {
          Text("bfstats").font(Bf.text(17, 500)).foregroundColor(Bf.inkSoft)
          Text(".io").font(Bf.text(17, 650)).foregroundColor(Bf.ink)
        }
        HStack(spacing: 6) {
          let all = live.servers
          let ok = all != nil && live.problem == nil
          StatusDot(color: live.problem != nil ? Bf.danger : ok ? Bf.joined : Bf.joining, pulse: ok, blink: all == nil, size: 6)
            .frame(width: 9, height: 9)
          Eyebrow(statusWords, size: 10, color: Bf.inkMuted, weight: 500, tracking: 0.1)
        }
      }
      .padding(.leading, 12)
      Spacer(minLength: 8)
      if wide { search.frame(maxWidth: 420).padding(.horizontal, 12) }
      IconButton(icon: .link, label: "Join by address", action: onJoinAddress)
      IconButton(icon: .refresh, label: "Refresh", spin: live.loading) { live.refresh() }
    }
    .padding(.leading, 16).padding(.trailing, 6).padding(.top, 10).padding(.bottom, 6)
    .background(
      RadialGradient(colors: [Color(argb: 0x147D8849), .clear], center: .topTrailing, startRadius: 0, endRadius: 420)
        .ignoresSafeArea(edges: .top)
    )
  }

  private var statusWords: String {
    let all = live.servers
    if live.problem != nil { return all != nil ? "Offline · last list" : "Offline" }
    guard let all else { return "Loading" }
    return "Live · \(all.count) servers · \(all.reduce(0) { $0 + $1.numPlayers }) players"
  }

  private var search: some View {
    HStack(spacing: 10) {
      Icon(.search, size: 18, color: Bf.inkFaint)
      ZStack(alignment: .leading) {
        if query.isEmpty { Text("Server, map or mod").font(Bf.text(14)).foregroundColor(Bf.inkFaint) }
        TextField("", text: $query)
          .font(Bf.text(14)).foregroundColor(Bf.ink).tint(Bf.accentSoft)
          .textInputAutocapitalization(.never).autocorrectionDisabled()
          .submitLabel(.search).focused($searching)
          .onChange(of: query) { q in
            if q.count > 64 { query = String(q.prefix(64)) }
            showAll = false
          }
          .accessibilityLabel("Search servers")
      }
      if !query.isEmpty { IconButton(icon: .close, label: "Clear", side: 32) { query = "" } }
    }
    .padding(.horizontal, 12)
    .frame(height: 42)
    .background(RoundedRectangle(cornerRadius: 10).fill(Bf.bgSoft))
    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Bf.rule, lineWidth: 1))
  }

  // ---- the list -----------------------------------------------------------------

  @ViewBuilder
  private func content(cols: Int) -> some View {
    let all = live.servers
    let q = query.trimmingCharacters(in: .whitespaces).lowercased()
    let matches = all?.filter { q.isEmpty || matchesQuery($0, q) }
    ScrollView {
      if all == nil, let p = live.problem {
        EmptyState(icon: .offline, title: p.offline ? "No connection" : "The list did not load",
                   message: p.offline ? "bfstats.io could not be reached. Check the connection and try again." : p.detail) {
          Btn(text: "Try again", kind: .soft, icon: .refresh) { live.refresh() }
        }
        .padding(.top, 60)
      } else if all == nil {
        SkeletonList()
      } else if all!.isEmpty {
        EmptyState(icon: .server, title: "No servers online", message: "Nothing is running right now. The list refreshes every minute.")
          .padding(.top, 60)
      } else if matches!.isEmpty {
        EmptyState(icon: .search, title: "No match", message: "No server, map or mod matches \"\(query.trimmingCharacters(in: .whitespaces))\".") {
          Btn(text: "Clear search", height: 38) { query = "" }
        }
        .padding(.top, 60)
      } else {
        let m = matches!
        let shown = showAll ? m : Array(m.prefix(renderMax))
        let populated = shown.filter { $0.numPlayers > 0 }
        let empty = shown.filter { $0.numPlayers <= 0 }
        LazyVStack(spacing: 0, pinnedViews: [.sectionHeaders]) {
          if let p = live.problem {
            Notice(text: "Showing the last list: \(p.detail.prefix(1).lowercased() + p.detail.dropFirst()).", color: Bf.danger, icon: .offline)
              .padding(.horizontal, 16).padding(.vertical, 6)
          }
          if !populated.isEmpty {
            Section(header: GroupHeader(left: "Populated", right: "\(m.reduce(0) { $0 + $1.numPlayers }) players")) {
              rows(populated, cols: cols)
            }
          }
          if !empty.isEmpty {
            Section(header: GroupHeader(left: "Empty", right: "\(m.filter { $0.numPlayers <= 0 }.count)")) {
              rows(empty, cols: cols)
            }
          }
          if m.count > shown.count {
            Btn(text: "Show all \(m.count)", height: 38, fill: true) { showAll = true }.padding(16)
          }
        }
        .padding(.bottom, 24)
      }
    }
    .scrollDismissesKeyboard(.immediately)
    .refreshable { await refreshAndWait() }
  }

  private func refreshAndWait() async {
    live.refresh()
    try? await Task.sleep(nanoseconds: 300_000_000)
    while live.loading { try? await Task.sleep(nanoseconds: 100_000_000) }
  }

  @ViewBuilder
  private func rows(_ list: [Server], cols: Int) -> some View {
    let elapsed = ticker.now.timeIntervalSince(live.fetchedAt)
    if cols == 1 {
      ForEach(list) { s in row(s, elapsed) }
    } else {
      let lines = stride(from: 0, to: list.count, by: cols).map { Array(list[$0..<min($0 + cols, list.count)]) }
      ForEach(lines, id: \.first!.id) { line in
        HStack(spacing: 0) {
          ForEach(line) { s in row(s, elapsed).frame(maxWidth: .infinity) }
          if line.count < cols { Color.clear.frame(maxWidth: .infinity) }
        }
        .padding(.horizontal, 8)
      }
    }
  }

  private func row(_ s: Server, _ elapsed: TimeInterval) -> some View {
    ServerRow(server: s, elapsed: elapsed, current: join.info?.address == s.address) { onOpen(s) }
  }

  private func matchesQuery(_ s: Server, _ q: String) -> Bool {
    [s.name, s.mapName, s.gameId, s.gameType, s.address].contains { $0?.lowercased().contains(q) == true } ||
      s.mapTitle.lowercased().contains(q)
  }
}

private struct GroupHeader: View {
  let left: String
  let right: String
  var body: some View {
    HStack {
      Eyebrow(left)
      Spacer()
      Eyebrow(right)
    }
    .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 6)
    .background(Bf.bg)
  }
}

struct ServerRow: View {
  let server: Server
  let elapsed: TimeInterval
  let current: Bool
  let onTap: () -> Void

  var body: some View {
    let s = server
    let load = s.load
    Button(action: onTap) {
      HStack(spacing: 12) {
        MapThumb(url: s.thumb, letters: lettersOf(s.mapName ?? s.name))
        VStack(alignment: .leading, spacing: 2) {
          HStack(spacing: 6) {
            Text(s.name).font(Bf.text(15, 550)).foregroundColor(load == 0 ? Bf.inkSoft : Bf.ink).lineLimit(1)
            if s.anticheat { AcTag() }
            if s.password { PwTag() }
          }
          HStack(spacing: 6) {
            if let flag = flagOf(s.country) { Text(flag).font(.system(size: 12)) }
            Text(s.meta.isEmpty ? s.address : s.meta.joined(separator: "  ·  "))
              .font(Bf.text(12.5)).foregroundColor(Bf.inkMuted).lineLimit(1)
          }
          roundLine(s)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        VStack(alignment: .trailing, spacing: 5) {
          HStack(alignment: .lastTextBaseline, spacing: 0) {
            Text("\(s.numPlayers)").font(Bf.mono(14, 500)).foregroundColor(load == 0 ? Bf.inkFaint : Bf.ink)
            Text("/\(s.maxPlayers)").font(Bf.mono(11)).foregroundColor(Bf.inkFaint)
          }
          let pct = s.maxPlayers > 0 ? min(Double(s.numPlayers) / Double(s.maxPlayers), 1) : 0
          LoadBar(fraction: s.numPlayers > 0 ? max(pct, 0.04) : 0, color: Bf.loadColor(load))
        }
        .frame(width: 54)
      }
      .padding(.horizontal, 8).padding(.vertical, 9)
      .background(RoundedRectangle(cornerRadius: 10).fill(current ? Color(argb: 0x1A7D8849) : .clear))
      .overlay(RoundedRectangle(cornerRadius: 10).stroke(current ? Color(argb: 0x597D8849) : .clear, lineWidth: 1))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .padding(.horizontal, 8).padding(.vertical, 1)
    .accessibilityLabel("Open \(s.name)")
  }

  /// A populated round: the clock and the tickets, as the panel's card shows them.
  @ViewBuilder
  private func roundLine(_ s: Server) -> some View {
    let left = s.roundLeft(elapsed: elapsed)
    if s.numPlayers > 0, left != nil || (s.tickets1 != nil && s.tickets2 != nil) {
      HStack(spacing: 0) {
        if let left {
          Icon(.clock, size: 12, color: Bf.inkFaint)
          Text(clockText(left)).font(Bf.mono(11)).foregroundColor(Bf.inkSoft).padding(.leading, 4).padding(.trailing, 12)
        }
        if let t1 = s.tickets1, let t2 = s.tickets2, t1 + t2 > 0 {
          Text("\(t1)").font(Bf.mono(11)).foregroundColor(Bf.inkSoft)
          TicketSplit(t1: t1, t2: t2, c1: Bf.teamColor(s.team1, 1), c2: Bf.teamColor(s.team2, 2), height: 3)
            .frame(width: 72).padding(.horizontal, 6)
          Text("\(t2)").font(Bf.mono(11)).foregroundColor(Bf.inkSoft)
        }
      }
      .padding(.top, 3)
    }
  }
}

private struct SkeletonList: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Shimmer(width: 80, height: 10).padding(.leading, 16).padding(.top, 16).padding(.bottom, 10)
      ForEach(0..<8, id: \.self) { _ in
        HStack(spacing: 12) {
          Shimmer(width: 64, height: 48)
          VStack(alignment: .leading, spacing: 8) {
            Shimmer(height: 13).frame(maxWidth: 220)
            Shimmer(height: 10).frame(maxWidth: 140)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          Shimmer(width: 40, height: 12)
        }
        .padding(.horizontal, 16).padding(.vertical, 9)
      }
    }
  }
}

/// Shown under the list while a join is up: where, how it is going, open the
/// game, leave (the panel's session card, compact).
struct SessionBar: View {
  let info: JoinInfo
  let live: Bool
  let over: Bool
  let onOpen: () -> Void
  let onLeave: () -> Void

  var body: some View {
    let title = info.serverName ?? info.address
    VStack(spacing: 0) {
      Rectangle().fill(Bf.rule).frame(height: 1)
      HStack(spacing: 10) {
        MapThumb(url: info.thumb, letters: lettersOf(title), width: 44, height: 33)
        VStack(alignment: .leading, spacing: 1) {
          HStack(spacing: 6) {
            StatusDot(color: over ? Bf.inkFaint : live ? Bf.joined : Bf.joining, pulse: live, blink: !live && !over, size: 6)
              .frame(width: 9, height: 9)
            Eyebrow(over ? "Ended" : live ? "Joined" : "Joining", size: 10, tracking: 0.1)
            Text("as \(info.name)").font(Bf.text(11.5)).foregroundColor(Bf.inkMuted).lineLimit(1)
          }
          Text(title).font(Bf.text(13.5, 550)).foregroundColor(Bf.ink).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        Btn(text: "Open", kind: .primary, icon: .play, enabled: live, height: 38, action: onOpen)
        IconButton(icon: .exit, label: "Leave", tint: Bf.danger, action: onLeave)
      }
      .padding(.horizontal, 12).padding(.vertical, 10)
    }
    .background(Bf.bgSoft.ignoresSafeArea(edges: .bottom))
  }
}
