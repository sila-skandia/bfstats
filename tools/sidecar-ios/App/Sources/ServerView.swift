import SwiftUI
import SidecarCore

/// One server: the round, both sides, who is on them, and the join (the
/// Android app's servers/ServerScreen.kt).
struct ServerView: View {
  @StateObject var model: ServerModel
  @EnvironmentObject var live: LiveModel
  @EnvironmentObject var join: JoinController
  @EnvironmentObject var ticker: Ticker
  let onBack: () -> Void
  let onJoin: (Server) -> Void
  let onOpenGame: () -> Void

  var body: some View {
    GeometryReader { g in
      let landscape = g.size.width > g.size.height && g.size.width >= 600
      let wide = g.size.width >= 600
      let d = model.detail
      let left = (d == nil || model.gone) ? nil : d!.roundLeft(elapsed: ticker.now.timeIntervalSince(model.fetchedAt))
      VStack(spacing: 0) {
        if landscape {
          HStack(alignment: .top, spacing: 0) {
            ScrollView {
              VStack(spacing: 0) {
                ServerHeader(server: d, model: model, height: 172, topInset: g.safeAreaInsets.top, onBack: onBack)
                if let d { Scoreboard(server: d, left: left) }
                notices
              }
              .padding(.bottom, 16)
            }
            .frame(width: g.size.width * 0.42)
            ScrollView {
              players(d, twoUp: false).padding(.top, g.safeAreaInsets.top).padding(.bottom, 20)
            }
            .refreshable { await refreshAndWait() }
          }
        } else {
          ScrollView {
            VStack(spacing: 0) {
              ServerHeader(server: d, model: model, height: wide ? 200 : 252, topInset: g.safeAreaInsets.top, onBack: onBack)
              if let d { Scoreboard(server: d, left: left) }
              notices
              players(d, twoUp: wide)
            }
            .padding(.bottom, 20)
          }
          .refreshable { await refreshAndWait() }
        }
        JoinBar(server: d, gone: model.gone, onJoin: onJoin, onOpenGame: onOpenGame)
      }
      .ignoresSafeArea(edges: .top)
      .background(Bf.bg.ignoresSafeArea())
    }
    .toolbar(.hidden, for: .navigationBar)
    .onReceive(ticker.$now) { _ in if model.age >= LiveModel.serverRefresh { model.refresh() } }
    .onAppear { model.refresh() }
  }

  private func refreshAndWait() async {
    model.refresh()
    try? await Task.sleep(nanoseconds: 300_000_000)
    while model.loading { try? await Task.sleep(nanoseconds: 100_000_000) }
  }

  @ViewBuilder
  private var notices: some View {
    if model.detail != nil && model.gone {
      Notice(text: "This server has left the live list. These are the players last seen on it.", color: Bf.danger, icon: .offline)
        .padding(.horizontal, 16).padding(.vertical, 4)
    } else if model.detail != nil, let p = model.problem {
      Notice(text: "Not refreshed: \(p.detail.prefix(1).lowercased() + p.detail.dropFirst()). Pull down to try again.", color: Bf.loadBusy, icon: .offline)
        .padding(.horizontal, 16).padding(.vertical, 4)
    }
  }

  @ViewBuilder
  private func players(_ d: Server?, twoUp: Bool) -> some View {
    if let d {
      if d.players.isEmpty {
        EmptyState(icon: .players, title: "Nobody on yet", message: "No one is playing here right now. Join and be the first; the list refreshes every 10 seconds.")
      } else if twoUp && d.teams.count == 2 {
        HStack(alignment: .top, spacing: 16) {
          ForEach(d.teams) { TeamTable(team: $0).frame(maxWidth: .infinity) }
        }
        .padding(.horizontal, 16)
      } else {
        VStack(spacing: 0) {
          ForEach(d.teams) { TeamTable(team: $0) }
        }
        .padding(.horizontal, 16)
      }
    } else if let p = model.problem {
      EmptyState(icon: .offline, title: "Could not load the server", message: p.detail) {
        Btn(text: "Try again", kind: .soft, icon: .refresh) { model.refresh() }
      }
    } else {
      LoadingBody()
    }
  }
}

private struct ServerHeader: View {
  let server: Server?
  @ObservedObject var model: ServerModel
  let height: CGFloat
  let topInset: CGFloat
  let onBack: () -> Void

  var body: some View {
    ZStack(alignment: .topLeading) {
      MapImage(url: server?.thumb, saturation: 0.8) { Topo() }
      // The panel's scrim: the art gives way to the page towards the text.
      LinearGradient(stops: [
        .init(color: Color(argb: 0x8C131313), location: 0), .init(color: Color(argb: 0x66131313), location: 0.4),
        .init(color: Color(argb: 0xD9131313), location: 0.75), .init(color: Bf.bg, location: 1),
      ], startPoint: .top, endPoint: .bottom)
      LinearGradient(colors: [Color(argb: 0x8C131313), .clear], startPoint: .leading, endPoint: .trailing)
      VStack(alignment: .leading, spacing: 0) {
        HStack {
          IconButton(icon: .back, label: "Back", tint: Bf.ink, action: onBack)
            .background(Circle().fill(Color(argb: 0x80131313)))
          Spacer()
          chip
        }
        Spacer(minLength: 0)
        if let s = server {
          VStack(alignment: .leading, spacing: 0) {
            Text(s.name).font(Bf.text(23, 620)).foregroundColor(Bf.ink).lineLimit(2)
            Text(s.meta.joined(separator: "  ·  ")).font(Bf.text(14)).foregroundColor(Bf.inkSoft).lineLimit(1).padding(.top, 4)
            HStack(spacing: 8) {
              if let c = s.country { CountryBadge(code: c) }
              Text(s.address).font(Bf.mono(12, 400)).foregroundColor(Bf.inkMuted).lineLimit(1)
              if s.anticheat { AcTag() }
              if s.password { PwTag() }
              Spacer(minLength: 4)
              HStack(alignment: .lastTextBaseline, spacing: 0) {
                Text("\(s.numPlayers)").font(Bf.mono(13, 500)).foregroundColor(Bf.ink)
                Text("/\(s.maxPlayers)").font(Bf.mono(11)).foregroundColor(Bf.inkFaint)
              }
              Icon(.players, size: 14, color: Bf.inkFaint)
            }
            .padding(.top, 8)
          }
          .padding(.leading, 8)
        } else {
          Shimmer(height: 20).frame(maxWidth: 220).padding(.leading, 8)
          Shimmer(height: 12).frame(maxWidth: 140).padding(.leading, 8).padding(.top, 10)
        }
      }
      .padding(.leading, 8).padding(.trailing, 16).padding(.top, topInset + 4).padding(.bottom, 14)
    }
    .frame(height: height + topInset)
    .clipped()
  }

  @ViewBuilder
  private var chip: some View {
    if model.gone {
      Chip(word: "Offline", dot: Bf.danger)
    } else if server == nil && model.problem != nil {
      Chip(word: "No connection", dot: Bf.danger)
    } else if server == nil {
      Chip(word: "Loading", dot: Bf.joining, blink: true)
    } else if model.problem != nil {
      Chip(word: "Not refreshed", dot: Bf.loadBusy)
    } else {
      Chip(word: server!.players.isEmpty ? "Live · empty" : "Live", dot: Bf.joined, pulse: true)
    }
  }
}

/// Both sides' tickets in the headline treatment, the clock between them.
private struct Scoreboard: View {
  let server: Server
  let left: Int?

  var body: some View {
    let shown = Array(server.teams.prefix(2))
    if let a = shown.first {
      let b = shown.count > 1 ? shown[1] : nil
      VStack(spacing: 0) {
        HStack(alignment: .bottom, spacing: 0) {
          Side(team: a, alignment: .leading, leading: leads(a, b)).frame(maxWidth: .infinity, alignment: .leading)
          VStack(spacing: 3) {
            Text(left.map(clockText) ?? "--:--").font(Bf.mono(22, 500)).foregroundColor(left != nil ? Bf.ink : Bf.inkFaint)
            Eyebrow("Round left", size: 9)
          }
          .padding(.horizontal, 8).padding(.vertical, 2)
          if let b {
            Side(team: b, alignment: .trailing, leading: leads(b, a)).frame(maxWidth: .infinity, alignment: .trailing)
          } else {
            Spacer().frame(maxWidth: .infinity)
          }
        }
        if let b, let t1 = a.tickets, let t2 = b.tickets, t1 + t2 > 0 {
          TicketSplit(t1: t1, t2: t2, c1: Bf.teamColor(a.label, a.index), c2: Bf.teamColor(b.label, b.index), height: 6)
            .padding(.top, 12)
        }
      }
      .padding(.horizontal, 16).padding(.vertical, 8)
    }
  }

  private func leads(_ t: Team, _ o: Team?) -> Bool {
    guard let x = t.tickets, let y = o?.tickets else { return false }
    return x > y
  }
}

private struct Side: View {
  let team: Team
  let alignment: HorizontalAlignment
  let leading: Bool

  var body: some View {
    VStack(alignment: alignment, spacing: 0) {
      HStack(spacing: 6) {
        Circle().fill(Bf.teamColor(team.label, team.index)).frame(width: 8, height: 8)
        Eyebrow(team.label, size: 11, color: Bf.inkSoft, weight: 600)
      }
      // Tickets are the standing: large and olive, the leader lifted (mm-headline-rank).
      Text(team.tickets.map(String.init) ?? "--")
        .font(Bf.text(44, 500)).monospacedDigit().tracking(-0.4)
        .foregroundColor(team.tickets == nil ? Bf.inkFaint : leading ? Bf.elite : Bf.accent)
      let bots = team.players.filter(\.bot).count
      let n = team.players.count
      Eyebrow((n == 1 ? "1 player" : "\(n) players") + (bots > 0 ? " · \(bots) bot\(bots == 1 ? "" : "s")" : ""),
              size: 9.5, weight: 500, tracking: 0.08)
    }
  }
}

/// One side's players, best first, under the site's olive table anchor.
private struct TeamTable: View {
  let team: Team

  var body: some View {
    VStack(spacing: 0) {
      HStack(spacing: 0) {
        Eyebrow("\(team.label) · \(team.players.count)", size: 11, color: Bf.highlightInk, weight: 650)
          .frame(maxWidth: .infinity, alignment: .leading)
        Eyebrow("Score", size: 10, color: Bf.highlightInk, weight: 600).frame(width: 52, alignment: .trailing)
        Eyebrow("K / D", size: 10, color: Bf.highlightInk, weight: 600).frame(width: 64, alignment: .trailing)
        Eyebrow("Ping", size: 10, color: Bf.highlightInk, weight: 600).frame(width: 46, alignment: .trailing)
      }
      .padding(.horizontal, 10).padding(.vertical, 7)
      .background(UnevenTop(radius: 3).fill(Bf.highlight))
      if team.players.isEmpty {
        Text("No players on this side").font(Bf.text(13)).foregroundColor(Bf.inkMuted)
          .frame(maxWidth: .infinity).padding(.vertical, 18)
          .overlay(Rectangle().stroke(Bf.rule, lineWidth: 1))
      }
      ForEach(Array(team.players.enumerated()), id: \.element.id) { i, p in PlayerRow(rank: i, player: p) }
    }
    .padding(.top, 14)
  }
}

/// Rounded top corners only (iOS 16 has no UnevenRoundedRectangle).
private struct UnevenTop: Shape {
  let radius: CGFloat
  func path(in r: CGRect) -> Path {
    Path(UIBezierPath(roundedRect: r, byRoundingCorners: [.topLeft, .topRight], cornerRadii: CGSize(width: radius, height: radius)).cgPath)
  }
}

private struct PlayerRow: View {
  let rank: Int
  let player: Player

  var body: some View {
    let p = player
    VStack(spacing: 0) {
      HStack(spacing: 0) {
        let rankColor = rank == 0 ? Bf.elite : rank == 1 ? Bf.ink : rank == 2 ? Bf.bronze : Bf.inkFaint
        Text(String(format: "%02d", rank + 1)).font(Bf.mono(11, rank < 3 ? 600 : 500)).foregroundColor(rankColor).frame(width: 26, alignment: .leading)
        HStack(spacing: 6) {
          Text(p.displayName).font(Bf.text(14, 500)).foregroundColor(p.bot ? Bf.inkSoft : Bf.ink).lineLimit(1)
          if p.bot { Tag(text: "BOT") }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        Text("\(p.score)").font(Bf.mono(14, 600)).foregroundColor(Bf.scoreColor(p.score)).frame(width: 52, alignment: .trailing)
        HStack(spacing: 0) {
          Text("\(p.kills)").foregroundColor(Bf.kill)
          Text(" / ").foregroundColor(Bf.inkFaint)
          Text("\(p.deaths)").foregroundColor(Bf.death)
        }
        .font(Bf.mono(13)).frame(width: 64, alignment: .trailing)
        Text(p.bot && p.ping == 0 ? "-" : "\(p.ping)").font(Bf.mono(13)).foregroundColor(Bf.pingColor(p.ping)).frame(width: 46, alignment: .trailing)
      }
      .padding(.horizontal, 10).padding(.vertical, 10)
      Rectangle().fill(Bf.rule).frame(height: 1)
    }
  }
}

private struct LoadingBody: View {
  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Shimmer(width: 90, height: 48)
        Spacer()
        Shimmer(width: 60, height: 30)
        Spacer()
        Shimmer(width: 90, height: 48)
      }
      Shimmer(height: 28).padding(.top, 24)
      ForEach(0..<6, id: \.self) { _ in Shimmer(height: 18).padding(.top, 12) }
    }
    .padding(16)
  }
}

/// The bottom bar: the name to play as and Join, or, once joined here, open
/// the game and leave.
private struct JoinBar: View {
  let server: Server?
  let gone: Bool
  let onJoin: (Server) -> Void
  let onOpenGame: () -> Void
  @EnvironmentObject var live: LiveModel
  @EnvironmentObject var join: JoinController

  var body: some View {
    VStack(spacing: 0) {
      Rectangle().fill(Bf.rule).frame(height: 1)
      Group {
        if let info = join.info, let s = server, info.address == s.address {
          HStack(spacing: 8) {
            StatusDot(color: join.over ? Bf.inkFaint : join.live ? Bf.joined : Bf.joining, pulse: join.live, blink: !join.live && !join.over, size: 6)
              .frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 1) {
              Eyebrow(join.over ? "Ended" : join.live ? "Joined" : "Joining", size: 10, tracking: 0.1)
              Text("Playing as \(info.name)").font(Bf.text(13)).foregroundColor(Bf.inkSoft).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Btn(text: "Open game", kind: .primary, icon: .play, enabled: join.live, busy: !join.live && !join.over, action: onOpenGame)
            Btn(text: "Leave", kind: .danger, icon: .exit) { join.leave() }
          }
        } else {
          joinForm
        }
      }
      .padding(.horizontal, 12).padding(.vertical, 10)
    }
    .background(Bf.bgSoft.ignoresSafeArea(edges: .bottom))
  }

  @ViewBuilder
  private var joinForm: some View {
    let nameError = PhoneCore.shared.nameError(name: live.name)
    let elsewhere = join.info.map { $0.serverName ?? $0.address }
    let why: String? = {
      guard let s = server else { return nil }
      if gone { return "The server is offline" }
      if s.password { return "Password protected: the app cannot join it yet" }
      if let e = nameError { return e }
      if let e = elsewhere { return "Joining leaves \(e)" }
      return nil
    }()
    VStack(alignment: .leading, spacing: 8) {
      if let why {
        let bad = gone || server?.password == true || nameError != nil
        Text(why).font(Bf.text(12)).foregroundColor(bad ? Bf.danger : Bf.inkMuted).padding(.leading, 4)
      }
      HStack(spacing: 10) {
        BfField(placeholder: "Player name", text: nameBinding, icon: .user, bad: nameError != nil) {
          if let s = server, can(s, nameError) { onJoin(s) }
        }
        Btn(text: "Join", kind: .primary, icon: .play, enabled: server.map { can($0, nameError) } ?? false, height: 46) {
          if let s = server { onJoin(s) }
        }
      }
    }
  }

  private var nameBinding: Binding<String> {
    Binding(get: { live.name }, set: { live.name = String($0.prefix(32)) })
  }

  private func can(_ s: Server, _ nameError: String?) -> Bool {
    !gone && !s.password && !live.name.trimmingCharacters(in: .whitespaces).isEmpty && nameError == nil
  }
}
