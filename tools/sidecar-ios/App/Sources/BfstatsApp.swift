import SwiftUI
import SidecarCore

@main
struct BfstatsApp: App {
  @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate
  @StateObject private var live = LiveModel()
  @StateObject private var join = JoinController()
  @StateObject private var ticker = Ticker()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environmentObject(live)
        .environmentObject(join)
        .environmentObject(ticker)
        .preferredColorScheme(.dark)
        .tint(Bf.accentSoft)
    }
  }
}

/// The companion's screens: a navigation stack of the list, a server and join
/// by address (the Android app's Navigation 3 back stack), and the game over
/// all of them.
enum Route: Hashable {
  case server(ip: String, port: Int)
  case address
}

struct RootView: View {
  @EnvironmentObject var live: LiveModel
  @EnvironmentObject var join: JoinController
  @Environment(\.scenePhase) private var phase
  @State private var path: [Route] = []
  @State private var playing = false
  /// The join whose game was opened (its page socket's port): opened once per join.
  @State private var openedPort = -1
  @StateObject private var smoke = Smoke()
  @State private var grace = BackgroundGrace()

  var body: some View {
    NavigationStack(path: $path) {
      ServersView(onOpen: { s in path.append(.server(ip: s.ip, port: s.port)) },
                  onJoinAddress: { path.append(.address) },
                  onOpenGame: { playing = true })
        .toolbar(.hidden, for: .navigationBar)
        .navigationDestination(for: Route.self) { route in
          switch route {
          case let .server(ip, port):
            ServerView(model: ServerModel(ip: ip, port: port, seed: live.seed(ip: ip, port: port), seedAt: live.fetchedAt),
                       onBack: { pop() }, onJoin: { s in joinServer(s) }, onOpenGame: { playing = true })
          case .address:
            JoinAddressView(onBack: { pop() }, onJoin: { host, port in joinAddress(host, port) })
          }
        }
    }
    .background(Bf.bg.ignoresSafeArea())
    .fullScreenCover(isPresented: $playing) {
      if let info = join.info, join.wsPort > 0, let url = URL(string: PhoneCore.shared.playUrl(port: Int32(join.wsPort), serverName: info.serverName)) {
        PlayView(url: url, mode: smoke.mode ?? SocketMode.current, join: join, onClose: { playing = false },
                 onDiag: { kind, detail in smoke.diag(kind, detail, join: join) })
          .ignoresSafeArea()
          .statusBarHidden(true)
          .persistentSystemOverlays(.hidden)
      } else {
        Color.black.ignoresSafeArea().onAppear { playing = false }
      }
    }
    .onChange(of: join.wsPort) { p in
      // The game opens once the page socket is up, once per join.
      if p > 0 && p != openedPort { openedPort = p; playing = true }
    }
    .onChange(of: join.info) { info in if info == nil { playing = false } }
    .onChange(of: phase) { p in
      switch p {
      case .background where join.joined:
        grace.entered { join.leave(); playing = false }
      case .active:
        grace.cancel()
      default:
        break
      }
    }
    .onChange(of: live.servers?.count ?? -1) { _ in smoke.listLoaded(live: live) { path.append($0) } }
    .onAppear { smoke.start(live: live, join: join) { path.append($0) } }
  }

  private func pop() { if !path.isEmpty { path.removeLast() } }

  private func joinServer(_ s: Server) {
    join.join(host: s.ip, port: s.port, name: live.name.trimmingCharacters(in: .whitespaces), serverName: s.name, thumb: s.thumb, server: s)
  }

  private func joinAddress(_ host: String, _ port: Int) {
    let known = live.servers?.first { $0.ip == host && $0.port == port }
    join.join(host: host, port: port, name: live.name.trimmingCharacters(in: .whitespaces),
              serverName: known?.name, thumb: known?.thumb, server: known)
    pop()
  }
}

/// The CI's simulator smoke test (.github/workflows/sidecar-ios.yml), driven
/// by launch arguments, which land in UserDefaults:
///   -smokeJoin 127.0.0.1:PORT   join a stand-in server and open the game
///   -smokeSocket auto|direct|bridge  the page socket to use
///   -smokeScreen server|address  open the first server, or join by address
///   -smokeServer <text>          with -smokeScreen server: open the server whose name holds it
/// What the page's socket did is written to Documents/smoke-<socket>.json.
final class Smoke: ObservableObject {
  let joinTarget = UserDefaults.standard.string(forKey: "smokeJoin")
  let screen = UserDefaults.standard.string(forKey: "smokeScreen")
  let serverName = UserDefaults.standard.string(forKey: "smokeServer")
  let mode = UserDefaults.standard.string(forKey: "smokeSocket").flatMap(SocketMode.init(rawValue:))
  private var events: [[String: String]] = []
  private var started = Date()
  private var written = false
  private var screenDone = false

  func start(live: LiveModel, join: JoinController, push: @escaping (Route) -> Void) {
    if screen == "address" && !screenDone { screenDone = true; push(.address) }
    guard let target = joinTarget, let a = PhoneCore.shared.address(text: target) else { return }
    started = Date()
    live.name = "ci-smoke"
    join.join(host: a.host, port: Int(a.port), name: "ci-smoke", serverName: "Smoke test server", thumb: nil, server: nil)
    DispatchQueue.main.asyncAfter(deadline: .now() + 60) { [weak self] in self?.write(join: join, why: "timeout") }
  }

  func listLoaded(live: LiveModel, push: (Route) -> Void) {
    guard screen == "server", !screenDone, let list = live.servers else { return }
    // -smokeServer <text>: the first populated server whose name holds it (the
    // store screenshots name one); otherwise the first populated server.
    let named = serverName.flatMap { n in list.first { $0.numPlayers > 0 && $0.name.localizedCaseInsensitiveContains(n) } }
    guard let s = named ?? list.first(where: { $0.numPlayers > 0 }) ?? list.first else { return }
    screenDone = true
    push(.server(ip: s.ip, port: s.port))
  }

  func diag(_ kind: String, _ detail: String, join: JoinController) {
    guard joinTarget != nil else { return }
    events.append(["t": String(format: "%.2f", Date().timeIntervalSince(started)), "kind": kind, "detail": detail])
    // Some frames have flowed; give the page a few seconds more to draw.
    if kind == "first-message" {
      DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in self?.write(join: join, why: "first-message") }
    }
  }

  private func write(join: JoinController, why: String) {
    guard !written, joinTarget != nil else { return }
    written = true
    let opened = events.first { $0["kind"] == "open" }?["detail"]
    let report: [String: Any] = [
      "socket": (mode ?? SocketMode.current).rawValue,
      "why": why,
      "transport": opened ?? "none",
      "opened": opened != nil,
      "firstMessage": events.contains { $0["kind"] == "first-message" },
      "events": events,
      "sidecar": Array(join.lines.suffix(80)),
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) else { return }
    let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    let file = dir.appendingPathComponent("smoke-\((mode ?? SocketMode.current).rawValue).json")
    try? data.write(to: file)
    NSLog("smoke: %@", String(data: data, encoding: .utf8) ?? "")
  }
}

extension UINavigationController: UIGestureRecognizerDelegate {
  // The screens draw their own headers (the bar is hidden), and a hidden bar
  // turns UIKit's edge swipe back off; this turns it on again.
  override open func viewDidLoad() {
    super.viewDidLoad()
    interactivePopGestureRecognizer?.delegate = self
  }

  public func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
    viewControllers.count > 1
  }
}
