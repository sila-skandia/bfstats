import Foundation
import SidecarCore
import SwiftUI

// The companion's data, as Swift values. The core (SidecarCore, the Kotlin
// framework) fetches and parses: the live list with its players
// (ServerDetail.kt), one server, names decoded for display only. These
// structs copy what the screens draw, so SwiftUI diffs plain values and the
// views never hold a Kotlin object.

struct Player: Identifiable, Hashable {
  /// The stored name: the identifier. Never shown.
  let name: String
  /// Decoded for the eye only (decodeName).
  let displayName: String
  let score: Int
  let kills: Int
  let deaths: Int
  let ping: Int
  let bot: Bool
  var id: String { name }
}

struct Team: Identifiable, Hashable {
  let index: Int
  let label: String
  let tickets: Int?
  let players: [Player]
  var id: Int { index }
}

struct Server: Identifiable, Hashable {
  /// Decoded for display (the core's normaliseServer decodes it).
  let name: String
  let ip: String
  let port: Int
  let gameId: String?
  let mapId: String?
  let mapName: String?
  let gameType: String?
  let numPlayers: Int
  let maxPlayers: Int
  let anticheat: Bool
  let password: Bool
  let roundTimeRemain: Int?
  let tickets1: Int?
  let tickets2: Int?
  let team1: String?
  let team2: String?
  let country: String?
  let thumb: String?
  let teams: [Team]
  let online: Bool

  var id: String { address }
  var address: String { "\(ip):\(port)" }
  var players: [Player] { teams.flatMap(\.players) }
  var load: Int { Int(PhoneCore.shared.load(numPlayers: Int32(numPlayers), maxPlayers: Int32(maxPlayers))) }
  var mapTitle: String { PhoneCore.shared.title(s: mapName) }
  var modeTitle: String { PhoneCore.shared.gameType(type: gameType) }

  /// Map, mode and a mod that is not the base game, as a row's second line.
  var meta: [String] {
    [mapTitle, modeTitle, gameId.flatMap { $0.lowercased() == "bf1942" ? nil : $0 }].compactMap { $0?.isEmpty == false ? $0 : nil }
  }

  /// Seconds of the round left, fetched `elapsed` seconds ago.
  func roundLeft(elapsed: TimeInterval) -> Int? {
    guard let r = roundTimeRemain else { return nil }
    let v = Int(PhoneCore.shared.roundSeconds(remain: Int32(r), elapsedMs: Int64(elapsed * 1000)))
    return v < 0 ? nil : v
  }

  init(_ d: ServerDetail) {
    let s = d.server
    name = s.name; ip = s.ip; port = Int(s.port)
    gameId = s.gameId; mapId = s.mapId; mapName = s.mapName; gameType = s.gameType
    numPlayers = Int(s.numPlayers); maxPlayers = Int(s.maxPlayers)
    anticheat = s.anticheat; password = s.password
    roundTimeRemain = s.roundTimeRemain?.intValue
    tickets1 = s.tickets1?.intValue; tickets2 = s.tickets2?.intValue
    team1 = s.team1; team2 = s.team2; country = s.country; thumb = s.thumb
    online = d.online
    teams = d.teams.map { t in
      Team(index: Int(t.index), label: t.label, tickets: t.tickets?.intValue, players: t.players.map { p in
        Player(name: p.name, displayName: p.displayName, score: Int(p.score), kills: Int(p.kills), deaths: Int(p.deaths), ping: Int(p.ping), bot: p.bot)
      })
    }
  }
}

func clockText(_ seconds: Int) -> String { PhoneCore.shared.clock(seconds: Int32(seconds)) }

/// Why a fetch failed, in the words a screen shows.
struct Problem: Equatable {
  let offline: Bool
  let detail: String

  init(offline: Bool, detail: String) { self.offline = offline; self.detail = detail }

  init(_ error: Error) {
    let text = (error as NSError).userInfo["KotlinException"].map { "\($0)" } ?? error.localizedDescription
    let net = text.range(of: "UnresolvedAddress|Connect|timeout|Timeout|offline|NSURLErrorDomain|network", options: .regularExpression) != nil
    self.init(offline: net, detail: net ? "No connection to bfstats.io" : "Something went wrong")
  }
}

/// The work the core does off the main thread (its calls block).
let coreQueue = DispatchQueue(label: "io.bfstats.core", qos: .userInitiated, attributes: .concurrent)

/// The live list, the player name, and what the app remembers between screens.
final class LiveModel: ObservableObject {
  @Published private(set) var servers: [Server]? = nil
  @Published private(set) var fetchedAt = Date.distantPast
  @Published private(set) var loading = false
  @Published private(set) var problem: Problem? = nil
  @Published var name: String { didSet { UserDefaults.standard.set(name.trimmingCharacters(in: .whitespaces), forKey: "name") } }
  @Published var lastAddress: String { didSet { UserDefaults.standard.set(lastAddress, forKey: "address") } }

  /// The tray app's list refresh (sidecar-desktop main.js SERVER_REFRESH_MS).
  static let listRefresh: TimeInterval = 60
  /// The single-server endpoint is edge-cached 10 s.
  static let serverRefresh: TimeInterval = 10

  private var attemptAt = Date.distantPast

  init() {
    name = UserDefaults.standard.string(forKey: "name") ?? ""
    lastAddress = UserDefaults.standard.string(forKey: "address") ?? ""
  }

  /// Since the last fetch was started (a failed one retries a period later).
  var age: TimeInterval { Date().timeIntervalSince(attemptAt) }

  func refresh() {
    if loading { return }
    attemptAt = Date()
    loading = true
    coreQueue.async {
      do {
        let list = try PhoneCore.shared.liveList().map(Server.init)
        DispatchQueue.main.async {
          self.servers = list; self.fetchedAt = Date(); self.problem = nil; self.loading = false
        }
      } catch {
        DispatchQueue.main.async { self.problem = Problem(error); self.loading = false }
      }
    }
  }

  /// The list's copy of a server (players included), to draw at once.
  func seed(ip: String, port: Int) -> Server? { servers?.first { $0.ip == ip && $0.port == port } }
}

/// One server, refreshed from the single-server endpoint.
final class ServerModel: ObservableObject {
  let ip: String
  let port: Int
  @Published private(set) var detail: Server?
  @Published private(set) var fetchedAt: Date
  @Published private(set) var loading = false
  /// The site answered 404: the server is gone from the live list.
  @Published private(set) var gone = false
  @Published private(set) var problem: Problem? = nil
  private var attemptAt = Date.distantPast

  init(ip: String, port: Int, seed: Server?, seedAt: Date) {
    self.ip = ip; self.port = port; detail = seed; fetchedAt = seed == nil ? .distantPast : seedAt
  }

  var age: TimeInterval { Date().timeIntervalSince(attemptAt) }

  func refresh() {
    if loading { return }
    attemptAt = Date()
    loading = true
    let ip = ip, port = port
    coreQueue.async {
      do {
        let d = try PhoneCore.shared.serverDetail(ip: ip, port: Int32(port)).map(Server.init)
        DispatchQueue.main.async {
          if let d { self.detail = d; self.gone = false } else { self.gone = true }
          self.fetchedAt = Date(); self.problem = nil; self.loading = false
        }
      } catch {
        DispatchQueue.main.async { self.problem = Problem(error); self.loading = false }
      }
    }
  }
}

/// Ticks once a second, for the round clocks.
final class Ticker: ObservableObject {
  @Published private(set) var now = Date()
  private var timer: Timer?

  init() {
    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.now = Date() }
  }

  deinit { timer?.invalidate() }
}
