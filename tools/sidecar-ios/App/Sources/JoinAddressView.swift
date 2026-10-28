import SwiftUI
import SidecarCore

/// Join a server the live list does not carry (a LAN or lab server) by
/// `host[:port]`, as the tray panel's address line does (the Android app's
/// join/JoinAddressScreen.kt).
struct JoinAddressView: View {
  @EnvironmentObject var live: LiveModel
  let onBack: () -> Void
  let onJoin: (_ host: String, _ port: Int) -> Void
  @State private var address = ""
  @State private var mode = SocketMode.current

  var body: some View {
    let parsed = PhoneCore.shared.address(text: address)
    let nameError = PhoneCore.shared.nameError(name: live.name)
    let can = parsed != nil && !live.name.trimmingCharacters(in: .whitespaces).isEmpty && nameError == nil
    let bad = !address.trimmingCharacters(in: .whitespaces).isEmpty && parsed == nil
    VStack(spacing: 0) {
      HStack(spacing: 6) {
        IconButton(icon: .back, label: "Back", tint: Bf.ink, action: onBack)
        Text("Join by address").font(Bf.text(18, 600)).foregroundColor(Bf.ink)
        Spacer()
      }
      .padding(.leading, 8).padding(.trailing, 16).padding(.top, 6)
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          Text("For a server the live list does not show: one on your network, or one that has just started. The port defaults to 14567.")
            .font(Bf.text(14)).foregroundColor(Bf.inkMuted).lineSpacing(4)
          Eyebrow("Server").padding(.top, 22)
          BfField(placeholder: "host:port", text: $address, icon: .server, bad: bad, keyboard: .URL, submitLabel: .next)
            .padding(.top, 8)
          Text(bad ? "Not a host and port" : " ").font(Bf.text(12)).foregroundColor(Bf.danger).padding(.leading, 4).padding(.top, 6)
          Eyebrow("Play as").padding(.top, 10)
          BfField(placeholder: "Player name", text: nameBinding, icon: .user, bad: nameError != nil) {
            if can, let p = parsed { go(p) }
          }
          .padding(.top, 8)
          Text(nameError ?? " ").font(Bf.text(12)).foregroundColor(Bf.danger).padding(.leading, 4).padding(.top, 6)
          socketChoice.padding(.top, 18)
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .frame(maxWidth: 560, alignment: .leading)
      }
      .scrollDismissesKeyboard(.interactively)
      VStack(spacing: 0) {
        Rectangle().fill(Bf.rule).frame(height: 1)
        Btn(text: "Join", kind: .primary, icon: .play, enabled: can, height: 48, fill: true) {
          if let p = parsed { go(p) }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
      }
      .background(Bf.bgSoft.ignoresSafeArea(edges: .bottom))
    }
    .background(Bf.bg.ignoresSafeArea())
    .toolbar(.hidden, for: .navigationBar)
    .onAppear { if address.isEmpty { address = live.lastAddress } }
  }

  /// How the game page reaches the sidecar: switchable, for a WebKit that
  /// treats the loopback socket differently (features/sidecar-ios-app).
  private var socketChoice: some View {
    VStack(alignment: .leading, spacing: 8) {
      Eyebrow("Page socket")
      Picker("Page socket", selection: $mode) {
        Text("Auto").tag(SocketMode.auto)
        Text("Direct").tag(SocketMode.direct)
        Text("Bridge").tag(SocketMode.bridge)
      }
      .pickerStyle(.segmented)
      .onChange(of: mode) { SocketMode.current = $0 }
      Text("How the game page talks to the app. Auto tries the page's own socket and falls back to the app's bridge.")
        .font(Bf.text(12)).foregroundColor(Bf.inkFaint)
    }
  }

  private var nameBinding: Binding<String> {
    Binding(get: { live.name }, set: { live.name = String($0.prefix(32)) })
  }

  private func go(_ p: PhoneAddress) {
    live.lastAddress = address.trimmingCharacters(in: .whitespaces)
    onJoin(p.host, Int(p.port))
  }
}
