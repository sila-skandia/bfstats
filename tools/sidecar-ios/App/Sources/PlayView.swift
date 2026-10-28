import SwiftUI
import UIKit
import WebKit
import SidecarCore

/// The game page in a fullscreen, landscape WKWebView, on play.bfstats.io with
/// the sidecar's socket in the query (as the tray app opens it in a browser,
/// and the Android app in its WebView). The page loads from the site, so
/// viewer fixes reach the app without a new build.
struct PlayView: UIViewControllerRepresentable {
  let url: URL
  let mode: SocketMode
  let join: JoinController
  let onClose: () -> Void
  var onDiag: ((String, String) -> Void)? = nil

  func makeUIViewController(context: Context) -> PlayViewController {
    PlayViewController(url: url, mode: mode, join: join, onClose: onClose, onDiag: onDiag)
  }

  func updateUIViewController(_ vc: PlayViewController, context: Context) {}
}

/// The pages the bridge serves: the game's own hosts, nothing else.
func isGameOrigin(_ host: String) -> Bool { host == "bfstats.io" || host.hasSuffix(".bfstats.io") }

final class PlayViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate, PageSink {
  private let url: URL
  private let mode: SocketMode
  private let join: JoinController
  private let onClose: () -> Void
  private let onDiag: ((String, String) -> Void)?
  private var web: WKWebView!
  /// Frames for the page, flushed once per run loop turn in one call per socket.
  private var pending: [Int: [String]] = [:]
  private var flushScheduled = false
  /// This page's bridged sockets: closed with the page, and only these.
  private var sockets: Set<Int> = []

  init(url: URL, mode: SocketMode, join: JoinController, onClose: @escaping () -> Void, onDiag: ((String, String) -> Void)?) {
    self.url = url; self.mode = mode; self.join = join; self.onClose = onClose; self.onDiag = onDiag
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError("not from a storyboard") }

  override var prefersStatusBarHidden: Bool { true }
  override var prefersHomeIndicatorAutoHidden: Bool { true }
  override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge { .all }
  override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .landscape }

  override func loadView() {
    let config = WKWebViewConfiguration()
    config.allowsInlineMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []
    let content = WKUserContentController()
    let settings = "window.__bfstatsSocketConfig = { mode: \"\(mode.rawValue)\" };"
    content.addUserScript(WKUserScript(source: settings, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    if let path = Bundle.main.path(forResource: "socket-bridge", ofType: "js"), let js = try? String(contentsOfFile: path) {
      content.addUserScript(WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    // The handlers hold the controller weakly (WKUserContentController retains them).
    content.add(WeakHandler(self), name: "bfstatsSocket")
    content.add(WeakHandler(self), name: "bfstatsConsole")
    config.userContentController = content

    web = WKWebView(frame: .zero, configuration: config)
    web.isOpaque = false
    web.backgroundColor = .black
    web.scrollView.backgroundColor = .black
    web.scrollView.contentInsetAdjustmentBehavior = .never
    web.scrollView.isScrollEnabled = false
    web.scrollView.bounces = false
    web.navigationDelegate = self
    web.uiDelegate = self
    web.allowsBackForwardNavigationGestures = false
    if #available(iOS 16.4, *) {
      #if DEBUG
      web.isInspectable = true
      #endif
    }
    view = web
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    join.pageSink = self
    // Leaving the game (the join stays up): a small back mark in the corner,
    // as faint as it can be and still be found.
    let back = UIButton(type: .system)
    back.setImage(UIImage(systemName: "chevron.left", withConfiguration: UIImage.SymbolConfiguration(pointSize: 14, weight: .semibold)), for: .normal)
    back.tintColor = .white
    back.backgroundColor = UIColor(white: 0.07, alpha: 0.55)
    back.layer.cornerRadius = 16
    back.alpha = 0.6
    back.accessibilityLabel = "Back to the server list"
    back.addTarget(self, action: #selector(close), for: .touchUpInside)
    back.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(back)
    NSLayoutConstraint.activate([
      back.widthAnchor.constraint(equalToConstant: 32), back.heightAnchor.constraint(equalToConstant: 32),
      back.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 6),
      back.topAnchor.constraint(equalTo: view.topAnchor, constant: 8),
    ])
    web.load(URLRequest(url: url))
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Orientation.lock(.landscape, in: view.window)
    setNeedsStatusBarAppearanceUpdate()
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    Orientation.lock(.allButUpsideDown, in: view.window)
  }

  deinit {
    // The view went away with its page: its bridged sockets close.
    let j = join, ids = sockets
    DispatchQueue.main.async { for id in ids { j.pageClose(id) } }
  }

  private func closeSockets() {
    for id in sockets { join.pageClose(id) }
    sockets = []
  }

  @objc private func close() { onClose() }

  // ---- the bridge -----------------------------------------------------------

  func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.frameInfo.isMainFrame, isGameOrigin(message.frameInfo.securityOrigin.host) else { return }
    guard let body = message.body as? [String: Any] else { return }
    if message.name == "bfstatsConsole" {
      let text = body["text"] as? String ?? ""
      NSLog("page: %@", text)
      onDiag?("console", text)
      return
    }
    let id = (body["id"] as? NSNumber)?.intValue ?? 0
    switch body["op"] as? String {
    case "open":
      let ok = join.pageOpen(id)
      if ok { sockets.insert(id) }
      NSLog("bridge: page socket %d %@ (%@)", id, ok ? "open" : "refused", body["why"] as? String ?? "")
      web.evaluateJavaScript(ok ? "window.__bfstatsSocket.opened(\(id))" : "window.__bfstatsSocket.failed(\(id), 'no session')")
    case "text":
      if let d = body["data"] as? String { join.pageText(id, d) }
    case "bin":
      if let d = body["data"] as? String { join.pageBinary(id, d) }
    case "close":
      sockets.remove(id)
      join.pageClose(id)
    case "diag":
      let kind = body["kind"] as? String ?? "", detail = body["detail"] as? String ?? ""
      NSLog("bridge: %@ %@", kind, detail)
      onDiag?(kind, detail)
    default:
      break
    }
  }

  func deliver(_ id: Int, _ text: String) {
    pending[id, default: []].append(text)
    if flushScheduled { return }
    flushScheduled = true
    DispatchQueue.main.async { [weak self] in self?.flush() }
  }

  private func flush() {
    flushScheduled = false
    let batch = pending
    pending = [:]
    for (id, frames) in batch {
      guard let data = try? JSONSerialization.data(withJSONObject: frames), let json = String(data: data, encoding: .utf8) else { continue }
      web.evaluateJavaScript("window.__bfstatsSocket && window.__bfstatsSocket.deliver(\(id), \(json))")
    }
  }

  func closed(_ id: Int) {
    sockets.remove(id)
    flush()
    web.evaluateJavaScript("window.__bfstatsSocket && window.__bfstatsSocket.closed(\(id))")
  }

  // ---- navigation -------------------------------------------------------------

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    // A new document (the page reloads itself onto the server's level when
    // it joins): the old one's bridged sockets are gone with it.
    pending = [:]
    closeSockets()
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    // The game stays in the view; a link off the game's hosts opens in Safari.
    if action.targetFrame?.isMainFrame != false, let u = action.request.url, let host = u.host,
       u.scheme == "https" || u.scheme == "http", !isGameOrigin(host) {
      UIApplication.shared.open(u)
      decisionHandler(.cancel)
      return
    }
    decisionHandler(.allow)
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    // WebKit killed the page (memory): load it again; the sidecar keeps the session.
    NSLog("page: web content process ended, reloading")
    closeSockets()
    webView.reload()
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let u = action.request.url { UIApplication.shared.open(u) }
    return nil
  }
}

/// WKUserContentController retains its handlers; this keeps the controller free.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
  weak var target: WKScriptMessageHandler?
  init(_ t: WKScriptMessageHandler) { target = t }
  func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
    target?.userContentController(ucc, didReceive: message)
  }
}

/// Which way the screens may turn: everything but upside down, except the
/// game, which is landscape.
enum Orientation {
  static var mask: UIInterfaceOrientationMask = .allButUpsideDown

  static func lock(_ m: UIInterfaceOrientationMask, in window: UIWindow?) {
    mask = m
    guard let scene = window?.windowScene else { return }
    if #available(iOS 16.0, *) {
      scene.requestGeometryUpdate(.iOS(interfaceOrientations: m)) { _ in }
      window?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
    }
  }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
  func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
    Orientation.mask
  }
}
