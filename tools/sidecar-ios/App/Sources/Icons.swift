import SwiftUI

/// The tray panel's line icons (tools/sidecar-desktop/src/ui/panel.html, the
/// sprite's symbols), drawn from the same 24-unit paths as the Android app's
/// ui/Icons.kt. A line icon is stroked, a solid one filled.
enum BfIcon {
  case refresh, search, play, exit, user, close, arrow, back, check, external, clock, link, server, offline, lock, players

  var paths: [String] {
    switch self {
    case .refresh: return ["M19 12a7 7 0 1 1-2.05-4.95M19 4.5V8h-3.5"]
    case .search: return ["M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.5 15.5 20 20"]
    case .play: return ["M8 5.5v13l10.5-6.5z"]
    case .exit: return ["M14 4.5H6.5v15H14M10.5 12H20M16.5 8.5 20 12l-3.5 3.5"]
    case .user: return ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0"]
    case .close: return ["M6.5 6.5l11 11M17.5 6.5l-11 11"]
    case .arrow: return ["M5 12h14M13 6l6 6-6 6"]
    case .back: return ["M19 12H5M11 6l-6 6 6 6"]
    case .check: return ["M5 12.5l4.5 4.5L19 7.5"]
    case .external: return ["M13.5 5.5H18.5V10.5M18.5 5.5l-8 8M16.5 13.5v5h-11v-11h5"]
    case .clock: return ["M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 8v4.2l2.6 1.6"]
    case .link: return [
      "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1",
      "M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
    ]
    case .server: return ["M4.5 5h15v5.5h-15zM4.5 13.5h15V19h-15zM8 7.75h.01M8 16.25h.01"]
    case .offline: return ["M4 4l16 16", "M8.5 16.5a5 5 0 0 1 7 0M5 12.6a10 10 0 0 1 4.2-2.4M19 12.6a10 10 0 0 0-3-2", "M12 19.5h.01"]
    case .lock: return ["M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v8.5h-13zM12 14.5v2"]
    case .players: return ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 19.5a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 13.7a6.5 6.5 0 0 1 3 5.8"]
    }
  }

  var solid: Bool { self == .play }

  var lineWidth: CGFloat {
    switch self {
    case .search, .arrow, .back: return 1.8
    case .check: return 1.9
    case .user, .clock, .server, .lock, .players: return 1.6
    default: return 1.7
    }
  }
}

/// An icon at `size` points, tinted.
struct Icon: View {
  let icon: BfIcon
  var size: CGFloat = 20
  var color: Color = Bf.inkMuted

  init(_ icon: BfIcon, size: CGFloat = 20, color: Color = Bf.inkMuted) {
    self.icon = icon; self.size = size; self.color = color
  }

  var body: some View {
    let shape = SvgShape(paths: icon.paths)
    Group {
      if icon.solid {
        shape.fill(color)
      } else {
        shape.stroke(color, style: StrokeStyle(lineWidth: icon.lineWidth * size / 24, lineCap: .round, lineJoin: .round))
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

/// SVG path data in a 24-unit box, scaled to the frame.
struct SvgShape: Shape {
  let paths: [String]

  func path(in rect: CGRect) -> Path {
    var p = Path()
    for d in paths { p.addPath(SvgPath.parse(d)) }
    let k = min(rect.width, rect.height) / 24
    return p.applying(CGAffineTransform(scaleX: k, y: k).translatedBy(x: rect.minX / k, y: rect.minY / k))
  }
}

/// The subset of SVG path data the icons use: M L H V C S Q T A Z, absolute
/// and relative, with arcs as the circular ones they are (rx = ry, no rotation).
enum SvgPath {
  static func parse(_ d: String) -> Path {
    var p = Path()
    var tokens = Tokens(d)
    var cur = CGPoint.zero
    var start = CGPoint.zero
    var lastCtrl: CGPoint? = nil
    var cmd: Character = "M"
    while true {
      if let c = tokens.peekCommand() {
        tokens.skipCommand()
        cmd = c
      } else if !tokens.hasNumber {
        break
      } // else: the previous command repeats with the next numbers
      let rel = cmd.isLowercase
      func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { rel ? CGPoint(x: cur.x + x, y: cur.y + y) : CGPoint(x: x, y: y) }
      switch cmd.uppercased() {
      case "M":
        guard let x = tokens.number(), let y = tokens.number() else { return p }
        cur = pt(x, y); start = cur; p.move(to: cur); lastCtrl = nil
        cmd = rel ? "l" : "L" // further pairs are line-tos
      case "L":
        guard let x = tokens.number(), let y = tokens.number() else { return p }
        cur = pt(x, y); p.addLine(to: cur); lastCtrl = nil
      case "H":
        guard let x = tokens.number() else { return p }
        cur = CGPoint(x: rel ? cur.x + x : x, y: cur.y); p.addLine(to: cur); lastCtrl = nil
      case "V":
        guard let y = tokens.number() else { return p }
        cur = CGPoint(x: cur.x, y: rel ? cur.y + y : y); p.addLine(to: cur); lastCtrl = nil
      case "C":
        guard let x1 = tokens.number(), let y1 = tokens.number(), let x2 = tokens.number(), let y2 = tokens.number(),
              let x = tokens.number(), let y = tokens.number() else { return p }
        let c1 = pt(x1, y1), c2 = pt(x2, y2), e = pt(x, y)
        p.addCurve(to: e, control1: c1, control2: c2); cur = e; lastCtrl = c2
      case "S":
        guard let x2 = tokens.number(), let y2 = tokens.number(), let x = tokens.number(), let y = tokens.number() else { return p }
        let c1 = lastCtrl.map { CGPoint(x: 2 * cur.x - $0.x, y: 2 * cur.y - $0.y) } ?? cur
        let c2 = pt(x2, y2), e = pt(x, y)
        p.addCurve(to: e, control1: c1, control2: c2); cur = e; lastCtrl = c2
      case "Q":
        guard let x1 = tokens.number(), let y1 = tokens.number(), let x = tokens.number(), let y = tokens.number() else { return p }
        let c = pt(x1, y1), e = pt(x, y)
        p.addQuadCurve(to: e, control: c); cur = e; lastCtrl = c
      case "T":
        guard let x = tokens.number(), let y = tokens.number() else { return p }
        let c = lastCtrl.map { CGPoint(x: 2 * cur.x - $0.x, y: 2 * cur.y - $0.y) } ?? cur
        let e = pt(x, y)
        p.addQuadCurve(to: e, control: c); cur = e; lastCtrl = c
      case "A":
        guard let rx = tokens.number(), let ry = tokens.number(), let _ = tokens.number(),
              let large = tokens.flag(), let sweep = tokens.flag(),
              let x = tokens.number(), let y = tokens.number() else { return p }
        let e = pt(x, y)
        arc(&p, from: cur, to: e, r: (abs(rx) + abs(ry)) / 2, large: large, sweep: sweep)
        cur = e; lastCtrl = nil
      case "Z":
        p.closeSubpath(); cur = start; lastCtrl = nil
        cmd = "L" // stray numbers after a Z draw lines rather than loop
      default:
        return p
      }
    }
    return p
  }

  /// SVG's endpoint arc for a circle: the centre from the two ends, the
  /// radius scaled up when it cannot span them (SVG 1.1 F.6.6).
  static func arc(_ p: inout Path, from a: CGPoint, to b: CGPoint, r r0: CGFloat, large: Bool, sweep: Bool) {
    let dx = b.x - a.x, dy = b.y - a.y
    let chord = sqrt(dx * dx + dy * dy)
    if chord == 0 { return }
    if r0 == 0 { p.addLine(to: b); return }
    let r = max(r0, chord / 2)
    let mid = CGPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
    let h = sqrt(max(0, r * r - chord * chord / 4))
    // The centre is to the left or right of a->b; SVG picks it so the arc
    // drawn in the sweep direction has the asked size.
    let sign: CGFloat = (large != sweep) ? 1 : -1
    let c = CGPoint(x: mid.x - sign * h * dy / chord, y: mid.y + sign * h * dx / chord)
    let a0 = atan2(a.y - c.y, a.x - c.x)
    let a1 = atan2(b.y - c.y, b.x - c.x)
    // sweep = 1 is the positive-angle direction in SVG's y-down space, which
    // is CoreGraphics' clockwise = false in that same space.
    p.addArc(center: c, radius: r, startAngle: .radians(a0), endAngle: .radians(a1), clockwise: !sweep)
  }

  private struct Tokens {
    let s: [Character]
    var i = 0
    init(_ d: String) { s = Array(d) }

    private mutating func skipSpace() {
      while i < s.count, s[i] == " " || s[i] == "," || s[i] == "\n" || s[i] == "\t" { i += 1 }
    }

    mutating func peekCommand() -> Character? {
      skipSpace()
      guard i < s.count, s[i].isLetter, s[i] != "e", s[i] != "E" else { return nil }
      return s[i]
    }

    mutating func skipCommand() { i += 1 }

    var hasNumber: Bool {
      mutating get {
        skipSpace()
        guard i < s.count else { return false }
        return s[i].isNumber || s[i] == "-" || s[i] == "+" || s[i] == "."
      }
    }

    /// An arc flag: one digit, which may run into the next number ("0 1 1-2").
    mutating func flag() -> Bool? {
      skipSpace()
      guard i < s.count, s[i] == "0" || s[i] == "1" else { return nil }
      defer { i += 1 }
      return s[i] == "1"
    }

    mutating func number() -> CGFloat? {
      skipSpace()
      var j = i
      if j < s.count, s[j] == "-" || s[j] == "+" { j += 1 }
      var dot = false
      var digits = false
      while j < s.count {
        if s[j].isNumber { digits = true; j += 1 }
        else if s[j] == ".", !dot { dot = true; j += 1 }
        else { break }
      }
      if j < s.count, digits, s[j] == "e" || s[j] == "E" {
        var k = j + 1
        if k < s.count, s[k] == "-" || s[k] == "+" { k += 1 }
        if k < s.count, s[k].isNumber {
          j = k
          while j < s.count, s[j].isNumber { j += 1 }
        }
      }
      guard digits, let v = Double(String(s[i..<j])) else { return nil }
      i = j
      return CGFloat(v)
    }
  }
}
