import SwiftUI

// The tray panel's components (panel.css), as the Android app draws them
// (ui/Components.kt): map art, tags, the status dot and chip, bars, buttons,
// spinner, skeletons, empty states and notices.

/// Map images that failed this run (panel.js missingThumbs): not asked for
/// again; the fallback shows at once.
final class MissingImages: ObservableObject {
  static let shared = MissingImages()
  @Published private(set) var missing: Set<String> = []
  func isMissing(_ url: String?) -> Bool { url == nil || missing.contains(url!) }
  func add(_ url: String) { missing.insert(url) }
}

/// A map image that fades in once loaded, over `fallback` (drawn until then,
/// and for good when the image fails).
struct MapImage<Fallback: View>: View {
  let url: String?
  var saturation: Double = 0.85
  @ViewBuilder let fallback: () -> Fallback
  @ObservedObject private var missing = MissingImages.shared

  var body: some View {
    ZStack {
      fallback()
      if let url, !missing.isMissing(url), let u = URL(string: url) {
        AsyncImage(url: u, transaction: Transaction(animation: .easeOut(duration: 0.32))) { phase in
          switch phase {
          case .success(let image):
            // The panel's saturate(0.85): the art sits under the ink, not over it.
            image.resizable().scaledToFill().saturation(saturation).transition(.opacity)
          case .failure:
            Color.clear.onAppear { missing.add(url) }
          default:
            Color.clear
          }
        }
      }
    }
    .clipped()
  }
}

/// The panel's map art fallback: a dark olive wash with faint contour rings.
struct Topo: View {
  var body: some View {
    GeometryReader { g in
      let w = g.size.width, h = g.size.height
      ZStack {
        LinearGradient(colors: [Color(hex: 0x2A2D1D), Color(hex: 0x1B1C16), Color(hex: 0x161616)], startPoint: .topLeading, endPoint: .bottomTrailing)
        Path { p in
          let c = CGPoint(x: w * 0.78, y: h * 0.3)
          var r: CGFloat = 14
          while r < w + h {
            p.addEllipse(in: CGRect(x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r))
            r += 14
          }
        }
        .stroke(Color(argb: 0x129AA666), lineWidth: 1)
      }
    }
    .clipped()
  }
}

/// A row's thumbnail: the map image, or the first letters on the olive wash.
struct MapThumb: View {
  let url: String?
  let letters: String
  var width: CGFloat = 64
  var height: CGFloat = 48

  var body: some View {
    MapImage(url: url) {
      ZStack {
        LinearGradient(colors: [Color(hex: 0x2A2D1D), Color(hex: 0x181818)], startPoint: .topLeading, endPoint: .bottomTrailing)
        Text(letters).font(Bf.mono(12, 600)).foregroundColor(Color(argb: 0x8C9AA666))
      }
    }
    .frame(width: width, height: height)
    .clipShape(RoundedRectangle(cornerRadius: 6))
    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(argb: 0x0FFFFFFF), lineWidth: 1))
  }
}

/// [AC] / [PW] / BOT: a small mono tag (panel.css .badge).
struct Tag: View {
  let text: String
  var color: Color = Bf.inkMuted
  var border: Color = Bf.ruleStrong
  var fill: Color = .clear

  var body: some View {
    Text(text.uppercased()).font(Bf.mono(9, 600)).tracking(9 * 0.06).foregroundColor(color).lineLimit(1)
      .padding(.horizontal, 4).padding(.vertical, 1)
      .background(RoundedRectangle(cornerRadius: 3).fill(fill))
      .overlay(RoundedRectangle(cornerRadius: 3).stroke(border, lineWidth: 1))
  }
}

struct AcTag: View { var body: some View { Tag(text: "AC", color: Bf.loadBusy, border: Color(argb: 0x73C5A23A)) } }
struct PwTag: View { var body: some View { Tag(text: "PW", color: Bf.inkSoft) } }

/// A country as a styled ISO badge (the site's mm-country-badge): headers,
/// where a flag would be decoration.
struct CountryBadge: View {
  let code: String
  var body: some View { Tag(text: code, color: Bf.inkSoft, border: Bf.ruleStrong, fill: Color(argb: 0x99131313)) }
}

/// A country's flag, for the one place it is allowed: marking where a server
/// is in a list row (CLAUDE.md, No Emojis Policy).
func flagOf(_ code: String?) -> String? {
  guard let code, code.count == 2, code.allSatisfy({ $0 >= "A" && $0 <= "Z" }) else { return nil }
  var s = ""
  for u in code.unicodeScalars {
    if let f = Unicode.Scalar(0x1F1E6 + u.value - 65) { s.unicodeScalars.append(f) }
  }
  return s
}

/// The two letters a row shows when its map has no picture.
func lettersOf(_ s: String?) -> String {
  let t = (s ?? "?").trimmingCharacters(in: .whitespaces)
  let l = String(t.prefix(2)).uppercased()
  return l.isEmpty ? "?" : l
}

/// players/max fill (panel.css .bar), tinted by load.
struct LoadBar: View {
  let fraction: Double
  let color: Color

  var body: some View {
    GeometryReader { g in
      ZStack(alignment: .leading) {
        RoundedRectangle(cornerRadius: 2).fill(Bf.bgMute)
        if fraction > 0 {
          RoundedRectangle(cornerRadius: 2).fill(color).frame(width: g.size.width * min(max(fraction, 0), 1))
        }
      }
    }
    .frame(height: 3)
  }
}

/// Tickets as one split bar, each side in its team's colour (panel.css .split).
struct TicketSplit: View {
  let t1: Int
  let t2: Int
  let c1: Color
  let c2: Color
  var height: CGFloat = 4

  var body: some View {
    GeometryReader { g in
      let a = min(max(Double(t1) / Double(max(1, t1 + t2)), 0.001), 0.999)
      let w = max(0, g.size.width - 2)
      HStack(spacing: 0) {
        Rectangle().fill(c1).frame(width: w * a)
        Rectangle().fill(Bf.bg).frame(width: 2)
        Rectangle().fill(c2)
      }
      .animation(.easeOut(duration: 0.5), value: a)
    }
    .frame(height: height)
    .background(Bf.bgMute)
    .clipShape(Capsule())
  }
}

/// The tray's status dot: green and pulsing when live, amber blinking while
/// joining, grey otherwise.
struct StatusDot: View {
  let color: Color
  var pulse = false
  var blink = false
  var size: CGFloat = 7
  @State private var phase = false

  var body: some View {
    ZStack {
      if pulse && Motion.enabled {
        Circle().fill(color.opacity(phase ? 0 : 0.55)).frame(width: phase ? size + 14 : size, height: phase ? size + 14 : size)
          .animation(.easeOut(duration: 2.2).repeatForever(autoreverses: false), value: phase)
      }
      Circle().fill(color).frame(width: size, height: size)
        .opacity(blink && Motion.enabled ? (phase ? 0.3 : 1) : 1)
        .animation(blink ? .easeInOut(duration: 0.9).repeatForever(autoreverses: true) : nil, value: phase)
    }
    .frame(width: size + 14, height: size + 14)
    .onAppear { if (pulse || blink) && Motion.enabled { phase = true } }
  }
}

/// The status pill (panel.css .chip): a dot and a mono word.
struct Chip: View {
  let word: String
  let dot: Color
  var pulse = false
  var blink = false

  var body: some View {
    HStack(spacing: 0) {
      StatusDot(color: dot, pulse: pulse, blink: blink)
      Eyebrow(word, size: 10, color: Bf.ink, weight: 500, tracking: 0.1).padding(.trailing, 10)
    }
    .background(Capsule().fill(Color(argb: 0x990A0A0A)))
    .overlay(Capsule().stroke(Color(argb: 0x14FFFFFF), lineWidth: 1))
  }
}

/// The panel's square icon button (panel.css .icon-btn).
struct IconButton: View {
  let icon: BfIcon
  let label: String
  var tint: Color = Bf.inkMuted
  var spin = false
  var enabled = true
  var side: CGFloat = 40
  let action: () -> Void
  @State private var turn = false

  var body: some View {
    Button(action: action) {
      Icon(icon, size: 20, color: enabled ? tint : Bf.inkFaint)
        .rotationEffect(.degrees(spin && turn ? 360 : 0))
        .animation(spin ? .linear(duration: 0.8).repeatForever(autoreverses: false) : .default, value: turn)
        .frame(width: side, height: side)
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(!enabled)
    .accessibilityLabel(label)
    .onAppear { turn = spin }
    .onChange(of: spin) { turn = $0 }
  }
}

enum BtnKind { case primary, ghost, danger, soft }

/// The panel's buttons (panel.css .btn, .primary, .ghost, .danger).
struct Btn: View {
  let text: String
  var kind: BtnKind = .ghost
  var icon: BfIcon? = nil
  var enabled = true
  var height: CGFloat = 44
  var busy = false
  var fill = false
  let action: () -> Void

  var body: some View {
    let (bg, fg, border): (Color, Color, Color) = {
      switch kind {
      case .primary: return (Bf.accent, Bf.ink, Bf.accent)
      case .soft: return (Color(argb: 0x297D8849), Color(hex: 0xE6EBCF), Color(argb: 0x809AA666))
      case .danger: return (Color(argb: 0x99131313), Color(hex: 0xFFD9D9), Color(argb: 0x80D65A5A))
      case .ghost: return (Bf.bgMute, Bf.ink, Bf.ruleStrong)
      }
    }()
    Button(action: action) {
      HStack(spacing: 8) {
        if busy { Spinner(color: fg, size: 16) } else if let icon { Icon(icon, size: 16, color: fg) }
        Text(text).font(Bf.text(14, 600)).foregroundColor(fg).lineLimit(1)
      }
      .padding(.horizontal, 16)
      .frame(maxWidth: fill ? .infinity : nil, minHeight: height, maxHeight: height)
      .background(RoundedRectangle(cornerRadius: 10).fill(bg))
      .overlay(RoundedRectangle(cornerRadius: 10).stroke(border, lineWidth: 1))
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .opacity(enabled ? 1 : 0.45)
    .disabled(!enabled || busy)
  }
}

/// A ring with an olive arc (panel.css .acct-spin).
struct Spinner: View {
  var color: Color = Bf.accentSoft
  var size: CGFloat = 18
  @State private var turn = false

  var body: some View {
    ZStack {
      Circle().stroke(Bf.ruleStrong, lineWidth: 2)
      Circle().trim(from: 0, to: 0.25).stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .butt))
        .rotationEffect(.degrees(turn ? 270 : -90))
        .animation(Motion.enabled ? .linear(duration: 0.9).repeatForever(autoreverses: false) : nil, value: turn)
    }
    .frame(width: size, height: size)
    .onAppear { turn = true }
  }
}

/// A loading placeholder bar with a slow sheen.
struct Shimmer: View {
  var width: CGFloat? = nil
  var height: CGFloat
  @State private var x: CGFloat = 0.5

  var body: some View {
    GeometryReader { g in
      let w = g.size.width
      ZStack {
        Bf.bgSoft
        LinearGradient(colors: [.clear, Color(argb: 0x10FFFFFF), .clear], startPoint: .leading, endPoint: .trailing)
          .frame(width: w * 0.8)
          .offset(x: w * x - w / 2)
      }
    }
    .frame(width: width, height: height)
    .clipShape(RoundedRectangle(cornerRadius: 4))
    .onAppear {
      guard Motion.enabled else { return }
      withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) { x = 2 }
    }
  }
}

/// A designed empty or failed state: a dashed mark, a title, a line, an action.
struct EmptyState<Action: View>: View {
  let icon: BfIcon
  let title: String
  let message: String
  @ViewBuilder var action: () -> Action

  var body: some View {
    VStack(spacing: 0) {
      ZStack {
        RoundedRectangle(cornerRadius: 14).stroke(Bf.ruleStrong, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
        Icon(icon, size: 24, color: Bf.inkFaint)
      }
      .frame(width: 56, height: 56)
      Text(title).font(Bf.text(16, 600)).foregroundColor(Bf.ink).multilineTextAlignment(.center).padding(.top, 16)
      Text(message).font(Bf.text(13)).foregroundColor(Bf.inkMuted).multilineTextAlignment(.center)
        .frame(maxWidth: 300).padding(.top, 6)
      action().padding(.top, 18)
    }
    .padding(.horizontal, 32).padding(.vertical, 40)
    .frame(maxWidth: .infinity)
  }
}

extension EmptyState where Action == EmptyView {
  init(icon: BfIcon, title: String, message: String) {
    self.init(icon: icon, title: title, message: message) { EmptyView() }
  }
}

/// A thin strip for a notice, its colour down the left edge (panel.css .notice).
struct Notice: View {
  let text: String
  var color: Color = Bf.loadBusy
  var icon: BfIcon? = nil

  var body: some View {
    HStack(spacing: 10) {
      if let icon { Icon(icon, size: 16, color: color) }
      Text(text).font(Bf.text(13)).foregroundColor(Bf.inkSoft).frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(.leading, 14).padding(.trailing, 12).padding(.vertical, 10)
    .background(Bf.bgSoft)
    .overlay(alignment: .leading) { Rectangle().fill(color).frame(width: 2) }
    .clipShape(RoundedRectangle(cornerRadius: 8))
    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Bf.rule, lineWidth: 1))
  }
}

/// A text field in the panel's hand (panel.css .prof-input at phone size).
struct BfField: View {
  let placeholder: String
  @Binding var text: String
  var icon: BfIcon
  var bad = false
  var mono = true
  var keyboard: UIKeyboardType = .default
  var submitLabel: SubmitLabel = .go
  var onSubmit: () -> Void = {}
  @FocusState private var focused: Bool

  var body: some View {
    HStack(spacing: 10) {
      Icon(icon, size: 18, color: focused ? Bf.accentSoft : Bf.inkFaint)
      ZStack(alignment: .leading) {
        if text.isEmpty { Text(placeholder).font(mono ? Bf.mono(14, 400) : Bf.text(14)).foregroundColor(Bf.inkFaint) }
        TextField("", text: $text)
          .font(mono ? Bf.mono(14, 500) : Bf.text(14))
          .foregroundColor(Bf.ink)
          .tint(Bf.accentSoft)
          .keyboardType(keyboard)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .submitLabel(submitLabel)
          .focused($focused)
          .onSubmit(onSubmit)
          .accessibilityLabel(placeholder)
      }
    }
    .padding(.horizontal, 12)
    .frame(height: 46)
    .background(RoundedRectangle(cornerRadius: 10).fill(Bf.bg))
    .overlay(RoundedRectangle(cornerRadius: 10).stroke(bad ? Bf.danger : focused ? Bf.accentSoft : Bf.ruleStrong, lineWidth: 1))
  }
}

/// Endless motion (the pulse, the spinners, the sheen) can be switched off,
/// for a still render of a screen (the CI's screenshots).
enum Motion {
  static let enabled: Bool = !UserDefaults.standard.bool(forKey: "stillMotion")
}
