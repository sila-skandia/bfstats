import Foundation
import SidecarCore
import UIKit

/// How the game page reaches the sidecar (features/sidecar-ios-app/README.md,
/// "The page socket"): `direct` is the page's own WebSocket to
/// ws://127.0.0.1:<port>; `bridge` carries its frames through the app
/// (WKScriptMessageHandler in, evaluateJavaScript out); `auto` tries direct
/// and falls back to the bridge if WebKit refuses it.
enum SocketMode: String, CaseIterable, Identifiable {
  case auto, direct, bridge
  var id: String { rawValue }

  static var current: SocketMode {
    get { SocketMode(rawValue: UserDefaults.standard.string(forKey: "socketMode") ?? "") ?? .auto }
    set { UserDefaults.standard.set(newValue.rawValue, forKey: "socketMode") }
  }
}

/// What the app shows about the current join.
struct JoinInfo: Equatable {
  let host: String
  let port: Int
  let name: String
  /// The joined server's name from the list, for the page's connect screen.
  let serverName: String?
  let thumb: String?
  var address: String { "\(host):\(port)" }
}

/// One join at a time: the Kotlin sidecar (a PhoneSession) and its page
/// socket, the Android app's SidecarService without the service. iOS runs it
/// only while the app is in front: a backgrounded app's sockets are
/// suspended, so going to the background leaves the server after a short
/// grace (BackgroundGrace), cleanly, rather than let it time the player out.
final class JoinController: ObservableObject {
  @Published private(set) var info: JoinInfo? = nil
  /// The page socket's port, once it listens.
  @Published private(set) var wsPort: Int = -1
  /// The run ended by itself (refused, kicked, the server lost for good).
  @Published private(set) var over = false
  @Published private(set) var lines: [String] = []

  private var session: PhoneSession?
  /// Which join a listener's calls belong to: a stopped session's late calls
  /// (its exit, its last frames) are dropped.
  private var generation = 0
  /// The bridged page's frames go here (the play screen's web view).
  weak var pageSink: PageSink?

  var joined: Bool { info != nil }
  var live: Bool { info != nil && wsPort > 0 && !over }

  func join(host: String, port: Int, name: String, serverName: String?, thumb: String?, server: Server?) {
    stop()
    generation += 1
    let fm = FileManager.default
    let support = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("sidecar", isDirectory: true)
    let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("sidecar", isDirectory: true)
    try? fm.createDirectory(at: support, withIntermediateDirectories: true)
    try? fm.createDirectory(at: caches, withIntermediateDirectories: true)
    // The CD key file (a per-install player identity, never a retail key)
    // lives in Application Support, which is backed up; the level tables in
    // Caches, which iOS may clear.
    let s = PhoneSession(
      host: host, port: Int32(port), name: name, password: "",
      mapId: server?.mapId, mapName: server?.mapName, gameType: server?.gameType,
      cacheDir: caches.path, configDir: support.path, listener: Listener(self, generation))
    session = s
    info = JoinInfo(host: host, port: port, name: name, serverName: serverName, thumb: thumb)
    wsPort = -1
    over = false
    UIApplication.shared.isIdleTimerDisabled = true
    coreQueue.async { [weak self] in
      do {
        let p = try s.start()
        DispatchQueue.main.async { if self?.session === s { self?.wsPort = Int(p) } }
      } catch {
        DispatchQueue.main.async { self?.append("could not start: \(error.localizedDescription)") }
      }
    }
  }

  /// Leave the server and forget the join.
  func leave() {
    stop()
    info = nil
    wsPort = -1
    over = false
    UIApplication.shared.isIdleTimerDisabled = false
  }

  private func stop() {
    if let s = session {
      session = nil
      coreQueue.async { s.stop() }
    }
  }

  // ---- the bridge: the page's frames in --------------------------------------

  func pageOpen(_ id: Int) -> Bool { session?.pageOpen(socketId: Int32(id)) ?? false }
  func pageText(_ id: Int, _ text: String) { session?.pageText(socketId: Int32(id), text: text) }
  func pageBinary(_ id: Int, _ base64: String) { session?.pageBinary(socketId: Int32(id), base64: base64) }
  func pageClose(_ id: Int) { session?.pageClose(socketId: Int32(id)) }
  func pagesGone() { session?.pagesGone() }

  // ---- what the sidecar says (its threads) ------------------------------------

  /// One session's listener: everything it hears goes to the main thread,
  /// and only while that session is the current one.
  private final class Listener: NSObject, PhoneSessionListener {
    private weak var owner: JoinController?
    private let generation: Int

    init(_ owner: JoinController, _ generation: Int) {
      self.owner = owner
      self.generation = generation
    }

    private func onMain(_ f: @escaping (JoinController) -> Void) {
      let gen = generation
      DispatchQueue.main.async { [weak owner] in
        if let o = owner, o.generation == gen { f(o) }
      }
    }

    func log(line: String) {
      NSLog("sidecar: %@", line)
      onMain { $0.append(line) }
    }

    func pageFrame(socketId: Int32, text: String) {
      onMain { $0.pageSink?.deliver(Int(socketId), text) }
    }

    func pageClosed(socketId: Int32) {
      onMain { $0.pageSink?.closed(Int(socketId)) }
    }

    func ended(code: Int32) {
      log(line: "[sidecar] the run is over (exit \(code))")
      onMain { $0.over = true }
    }
  }

  /// On the main thread.
  private func append(_ line: String) {
    lines.append(line)
    if lines.count > 500 { lines.removeFirst(lines.count - 500) }
  }
}

/// Where a bridged page's frames go (PlayViewController).
protocol PageSink: AnyObject {
  func deliver(_ id: Int, _ text: String)
  func closed(_ id: Int)
}

/// Going to the background leaves the server after a grace, cleanly
/// (Disconnects, as retail), unless the app comes back first: iOS gives a
/// backgrounded app a few seconds of run time and then suspends its sockets,
/// and the server times a silent client out by itself soon after.
final class BackgroundGrace {
  static let seconds: TimeInterval = 15
  private var task: UIBackgroundTaskIdentifier = .invalid
  private var timer: Timer?

  func entered(leave: @escaping () -> Void) {
    cancel()
    task = UIApplication.shared.beginBackgroundTask(withName: "leave-server") { [weak self] in
      leave()
      self?.cancel()
    }
    timer = Timer.scheduledTimer(withTimeInterval: Self.seconds, repeats: false) { [weak self] _ in
      leave()
      // Give the Disconnects a moment on the wire before iOS suspends us.
      DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self?.cancel() }
    }
  }

  func cancel() {
    timer?.invalidate()
    timer = nil
    if task != .invalid {
      UIApplication.shared.endBackgroundTask(task)
      task = .invalid
    }
  }
}
