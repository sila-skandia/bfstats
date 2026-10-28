import SidecarCore
import SwiftUI
import XCTest
@testable import BfstatsIO

/// The Swift side of the iPhone app: the icon paths, the companion data as
/// the screens see it through the core, and the small helpers. The page
/// socket's JavaScript stand-in has its own test (scripts/test-socket-bridge.mjs),
/// and the simulator smoke test runs it against the real page.
final class BfstatsIOTests: XCTestCase {
  func testEveryIconDrawsInsideItsBox() {
    let all: [BfIcon] = [.refresh, .search, .play, .exit, .user, .close, .arrow, .back, .check, .external, .clock, .link, .server, .offline, .lock, .players]
    for icon in all {
      var p = Path()
      for d in icon.paths { p.addPath(SvgPath.parse(d)) }
      let b = p.boundingRect
      XCTAssertFalse(b.isEmpty && b.width == 0 && b.height == 0, "\(icon) is empty")
      XCTAssertGreaterThanOrEqual(b.minX, 0, "\(icon)")
      XCTAssertGreaterThanOrEqual(b.minY, 0, "\(icon)")
      XCTAssertLessThanOrEqual(b.maxX, 24.01, "\(icon)")
      XCTAssertLessThanOrEqual(b.maxY, 24.01, "\(icon)")
    }
  }

  func testArcsAreTheCirclesTheyName() {
    // The clock's face: two half circles of radius 8 about (12, 12).
    let b = SvgPath.parse("M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z").boundingRect
    XCTAssertEqual(b.minX, 4, accuracy: 0.05)
    XCTAssertEqual(b.maxX, 20, accuracy: 0.05)
    XCTAssertEqual(b.minY, 4, accuracy: 0.05)
    XCTAssertEqual(b.maxY, 20, accuracy: 0.05)
    // The refresh arc: most of a circle of radius 7 about (12, 12), open at the top right.
    let r = SvgPath.parse("M19 12a7 7 0 1 1-2.05-4.95").boundingRect
    XCTAssertEqual(r.minX, 5, accuracy: 0.05)
    XCTAssertEqual(r.maxY, 19, accuracy: 0.05)
  }

  func testNumbersRunTogetherAsSvgWritesThem() {
    let b = SvgPath.parse("M8 7.75h.01M8 16.25h.01").boundingRect
    XCTAssertEqual(b.minY, 7.75, accuracy: 0.001)
    XCTAssertEqual(b.maxY, 16.25, accuracy: 0.001)
    XCTAssertEqual(b.maxX, 8.01, accuracy: 0.001)
  }

  func testTheLiveListThroughTheCore() {
    let body = """
    {"servers":[
      {"ip":"203.0.113.9","port":14567,"name":"Quiet","numPlayers":0,"maxPlayers":32,"gameId":"bf1942","mapName":"wake","gameType":"conquest","players":[]},
      {"ip":"203.0.113.7","port":14567,"name":"\\u00cf\\u00f0\\u00e8\\u00e2\\u00e5\\u00f2 \\u00f1\\u00e5\\u00f0\\u00e2\\u00e5\\u00f0","numPlayers":3,"maxPlayers":32,
       "gameId":"bf1942","mapName":"battle_of_the_bulge","gameType":"ctf","country":"DE","roundTimeRemain":600,"tickets1":120,"tickets2":80,
       "teams":[{"index":1,"label":"Axis","tickets":120},{"index":2,"label":"Allied","tickets":80}],
       "players":[{"name":"b","score":5,"kills":1,"deaths":2,"ping":40,"team":1},{"name":"a","score":9,"kills":3,"deaths":1,"ping":0,"team":1,"aiBot":true},
                  {"name":"c","score":1,"kills":0,"deaths":0,"ping":80,"team":2}]}
    ]}
    """
    let list = PhoneCore.shared.parseList(body: body).map(Server.init)
    XCTAssertEqual(list.map(\.ip), ["203.0.113.7", "203.0.113.9"], "busiest first")
    let s = list[0]
    XCTAssertEqual(s.name, "Привет сервер", "the name decoded for the eye")
    XCTAssertEqual(s.address, "203.0.113.7:14567")
    XCTAssertEqual(s.teams.map(\.label), ["Axis", "Allied"])
    XCTAssertEqual(s.teams[0].players.map(\.name), ["a", "b"], "best first")
    XCTAssertTrue(s.teams[0].players[0].bot)
    XCTAssertEqual(s.meta, ["Battle Of The Bulge", "CTF"])
    XCTAssertEqual(s.roundLeft(elapsed: 30), 570)
    XCTAssertEqual(clockText(570), "9:30")
    XCTAssertEqual(s.thumb, "https://bfstats.io/stats/assets/maps/bf1942/battle_of_the_bulge")
    XCTAssertEqual(list[1].load, 0)
    XCTAssertNil(list[1].roundLeft(elapsed: 0))
  }

  func testAddressesAndNames() {
    let a = PhoneCore.shared.address(text: "lab.example.org")
    XCTAssertEqual(a?.host, "lab.example.org")
    XCTAssertEqual(a?.port, 14567)
    XCTAssertEqual(PhoneCore.shared.address(text: "10.0.0.5:14568")?.port, 14568)
    XCTAssertNil(PhoneCore.shared.address(text: "not an address"))
    XCTAssertNil(PhoneCore.shared.nameError(name: "skandia"))
    XCTAssertEqual(PhoneCore.shared.nameError(name: "has\"quote"), "No quotes")
    XCTAssertEqual(PhoneCore.shared.playUrl(port: 17942, serverName: "A B"), "https://play.bfstats.io/map.html?sidecar=127.0.0.1:17942&server=A%20B")
  }

  func testFlagsOnlyForCountryCodes() {
    XCTAssertEqual(flagOf("US")?.unicodeScalars.count, 2)
    XCTAssertNil(flagOf("us"))
    XCTAssertNil(flagOf("USA"))
    XCTAssertEqual(lettersOf(" wake "), "WA")
    XCTAssertEqual(lettersOf(""), "?")
  }

  func testTheBridgeServesOnlyTheGame() {
    XCTAssertTrue(isGameOrigin("play.bfstats.io"))
    XCTAssertTrue(isGameOrigin("bfstats.io"))
    XCTAssertFalse(isGameOrigin("bfstats.io.example.com"))
    XCTAssertFalse(isGameOrigin("evilbfstats.io"))
  }

  func testTheBridgeScriptShips() throws {
    let path = try XCTUnwrap(Bundle.main.path(forResource: "socket-bridge", ofType: "js"))
    let js = try String(contentsOfFile: path)
    XCTAssertTrue(js.contains("window.__bfstatsSocket"))
  }

  func testTheFontsAreRegistered() {
    XCTAssertEqual(BfFont.ui("Geist", 14, 500).familyName, "Geist")
    XCTAssertEqual(BfFont.ui("Geist Mono", 14, 500).familyName, "Geist Mono")
  }
}
