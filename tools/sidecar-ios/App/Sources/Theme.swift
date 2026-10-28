import SwiftUI
import UIKit

// The site's V4 "Neutral Depth" identity (ui/src/styles/modern-minimal.css),
// as the tray app's panel (tools/sidecar-desktop/src/ui/panel.css) and the
// Android app (tools/sidecar-android/app/.../ui/Theme.kt) carry it: keep the
// four in step. Dark only; density is the only thing that changes with the
// screen.
enum Bf {
  static let bg = Color(hex: 0x131313)
  static let bgSoft = Color(hex: 0x1A1A1A)
  static let bgMute = Color(hex: 0x222222)
  static let rule = Color(hex: 0x2D2D2D)
  static let ruleStrong = Color(hex: 0x3D3D3D)
  static let ink = Color(hex: 0xFFFFFF)
  static let inkSoft = Color(hex: 0xC8C8C8)
  static let inkMuted = Color(hex: 0x8A8A8A)
  static let inkFaint = Color(hex: 0x555555)
  static let accent = Color(hex: 0x7D8849)
  static let accentSoft = Color(hex: 0x9AA666)
  static let highlight = Color(hex: 0x847D4C)
  static let highlightInk = Color(hex: 0x000000)
  static let elite = Color(hex: 0xB4C060)
  static let success = Color(hex: 0x7DA34C)
  static let danger = Color(hex: 0xD65A5A)
  static let loadBusy = Color(hex: 0xC5A23A)
  static let joined = Color(hex: 0x2ECC40)
  static let joining = Color(hex: 0xFF9500)
  static let axis = Color(hex: 0xD65A5A)
  static let allies = Color(hex: 0x7DA34C)
  static let kill = Color(hex: 0xD65A5A)
  static let death = Color(hex: 0x8A8A8A)
  static let kdLow = Color(hex: 0x8A8A6A)
  static let bronze = Color(hex: 0xC08A4C)

  /// Team colours (the site's mmTokens.ts teamColor, panel.js teamColor).
  static func teamColor(_ label: String?, _ index: Int) -> Color {
    let l = (label ?? "team \(index)").lowercased()
    if l.range(of: "axis|german|red|north|nva|team 2", options: .regularExpression) != nil { return axis }
    if l.range(of: "alli|usa|blue|south|team 1", options: .regularExpression) != nil { return allies }
    return accent
  }

  /// The roster's score and ping tints (MmPlayersPanel.vue).
  static func scoreColor(_ score: Int) -> Color {
    score >= 100 ? elite : score >= 50 ? accent : score >= 25 ? ink : kdLow
  }

  static func pingColor(_ ping: Int) -> Color {
    ping == 0 ? inkFaint : ping <= 60 ? ink : ping <= 120 ? kdLow : ping <= 200 ? kill : danger
  }

  static func loadColor(_ load: Int) -> Color {
    load == 3 ? danger : load == 2 ? loadBusy : accent
  }

  // ---- type ------------------------------------------------------------------
  // Geist and Geist Mono, variable (Resources/Fonts, OFL: Resources/Geist-OFL.txt),
  // set to an exact weight on the font's own wght axis.

  static func text(_ size: CGFloat, _ weight: CGFloat = 400) -> Font { Font(BfFont.ui("Geist", size, weight)) }
  static func mono(_ size: CGFloat, _ weight: CGFloat = 500) -> Font { Font(BfFont.ui("Geist Mono", size, weight)) }
}

/// The mono eyebrow: small, tracked capitals (panel.css .eyebrow).
struct Eyebrow: View {
  let text: String
  var size: CGFloat = 10
  var color: Color = Bf.inkMuted
  var weight: CGFloat = 500
  var tracking: CGFloat = 0.12

  init(_ text: String, size: CGFloat = 10, color: Color = Bf.inkMuted, weight: CGFloat = 500, tracking: CGFloat = 0.12) {
    self.text = text; self.size = size; self.color = color; self.weight = weight; self.tracking = tracking
  }

  var body: some View {
    Text(text.uppercased()).font(Bf.mono(size, weight)).tracking(size * tracking).foregroundColor(color).lineLimit(1)
  }
}

enum BfFont {
  private static var cache: [String: UIFont] = [:]
  private static let lock = NSLock()
  /// 'wght', the variation axis tag.
  private static let wght = 0x7767_6874

  static func ui(_ family: String, _ size: CGFloat, _ weight: CGFloat) -> UIFont {
    let key = "\(family)|\(size)|\(weight)"
    lock.lock(); defer { lock.unlock() }
    if let f = cache[key] { return f }
    let base = UIFontDescriptor(fontAttributes: [.family: family])
    let d = base.addingAttributes([UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String): [wght: weight]])
    var f = UIFont(descriptor: d, size: size)
    if f.familyName != family {
      // Not registered (a test bundle): the system face at the nearest weight.
      f = family.contains("Mono") ? .monospacedSystemFont(ofSize: size, weight: uiWeight(weight)) : .systemFont(ofSize: size, weight: uiWeight(weight))
    }
    cache[key] = f
    return f
  }

  private static func uiWeight(_ w: CGFloat) -> UIFont.Weight {
    switch w {
    case ..<450: return .regular
    case ..<550: return .medium
    case ..<650: return .semibold
    default: return .bold
    }
  }
}

extension Color {
  init(hex: UInt32, alpha: Double = 1) {
    self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255, opacity: alpha)
  }

  /// 0xAARRGGBB, as the Android app writes its translucent colours.
  init(argb: UInt32) {
    self.init(hex: argb & 0xFFFFFF, alpha: Double((argb >> 24) & 0xFF) / 255)
  }
}
