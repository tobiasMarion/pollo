import SwiftUI
import PolloWire

struct MainScreen: View {
  @Bindable var controller: EventController
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  #if DEBUG
  @State private var showDiagnostics = ProcessInfo.processInfo.arguments.contains("--diagnostics")
  #endif

  private var busy: Bool {
    [.locating, .searching, .connecting, .positioning, .reconnecting].contains(controller.phase)
  }
  private var onLight: Bool { controller.screenMode && controller.brightness > 0.46 }
  private var ink: Color { onLight ? .black : .white }
  private var mutedInk: Color { ink.opacity(0.58) }

  var body: some View {
    NavigationStack {
      ZStack {
        PolloBackdrop(controller: controller)
        GeometryReader { proxy in
          ScrollView {
            VStack(spacing: 0) {
              Spacer(minLength: 72)
              hero
              actions
              Spacer(minLength: 64)
              localSignal
            }
            .frame(maxWidth: .infinity, minHeight: proxy.size.height)
            .padding(.horizontal, 24)
            .padding(.bottom, 12)
          }
          .scrollBounceBehavior(.basedOnSize)
          .scrollIndicators(.hidden)
        }
      }
      .toolbar(.hidden, for: .navigationBar)
    }
    .tint(ink)
    .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: controller.phase)
    .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: onLight)
    #if DEBUG
    .fullScreenCover(isPresented: $showDiagnostics) {
      NavigationStack {
        DeveloperScreen(controller: controller)
          .toolbar {
            ToolbarItem(placement: .topBarLeading) {
              Button("Fechar") { showDiagnostics = false }
            }
          }
      }
    }
    #endif
  }

  private var hero: some View {
    VStack(spacing: 0) {
      VStack(spacing: 18) {
        GraphMark(active: busy, color: ink)
          .frame(width: 168, height: 168)
        Text("pollo")
          .font(.system(size: 25, weight: .semibold, design: .rounded))
          .tracking(1.4)
          .foregroundStyle(ink)
      }
      .padding(.bottom, 52)

      Text(controller.event?.name ?? "Vamos iluminar juntos")
        .font(.system(size: 29, weight: .semibold, design: .rounded))
        .tracking(-0.55)
        .multilineTextAlignment(.center)
        .foregroundStyle(ink)
        .frame(maxWidth: 330)

      Text(controller.message)
        .font(.system(size: 15, weight: .regular, design: .rounded))
        .foregroundStyle(mutedInk)
        .multilineTextAlignment(.center)
        .lineSpacing(3)
        .frame(maxWidth: 310)
        .padding(.top, 11)
        .accessibilityIdentifier("status")

    }
  }

  @ViewBuilder private var actions: some View {
    VStack(spacing: 10) {
      if controller.phase == .ready {
        Button("Participar", action: controller.join)
          .buttonStyle(PolloButton(inverted: onLight))
          .disabled(!controller.canJoin)
          .accessibilityIdentifier("join")
      }
      if controller.phase == .empty || controller.phase == .failed {
        Button("Buscar novamente", action: controller.retry)
          .buttonStyle(PolloButton(inverted: onLight))
        if controller.phase == .failed {
          Button("Abrir Ajustes") {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
            UIApplication.shared.open(url)
          }
          .font(.subheadline.weight(.medium))
          .foregroundStyle(ink)
          .frame(minHeight: 44)
        }
      }
      if controller.participating {
        Button("Sair do evento", action: controller.leave)
          .font(.subheadline.weight(.medium))
          .foregroundStyle(ink.opacity(0.72))
          .frame(maxWidth: .infinity, minHeight: 44)
          .accessibilityIdentifier("leave")
      }
    }
    .frame(maxWidth: 340)
    .padding(.top, 34)
  }

  @ViewBuilder private var localSignal: some View {
    #if DEBUG
    Button {
      showDiagnostics = true
    } label: {
      HStack(spacing: 9) {
        GraphGlyph(color: ink).frame(width: 19, height: 19)
        Text("SINAL LOCAL")
          .font(.system(size: 10, weight: .semibold, design: .monospaced))
          .tracking(1.15)
      }
      .foregroundStyle(mutedInk)
      .padding(.horizontal, 16)
      .frame(minHeight: 44)
      .contentShape(Rectangle())
    }
    .buttonStyle(PressableLinkStyle(reduceMotion: reduceMotion))
    .accessibilityIdentifier("diagnostics")
    #endif
  }
}

struct PolloBackdrop: View {
  let controller: EventController

  var body: some View {
    ZStack {
      Color.black
      if controller.screenMode { Color.white.opacity(controller.brightness) }
    }
    .ignoresSafeArea()
    .accessibilityHidden(true)
  }
}

struct PressableLinkStyle: ButtonStyle {
  let reduceMotion: Bool

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
      .opacity(configuration.isPressed ? 0.78 : 1)
      .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: configuration.isPressed)
  }
}

struct PolloButton: ButtonStyle {
  var inverted = false
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.system(size: 15, weight: .semibold, design: .rounded))
      .frame(maxWidth: .infinity, minHeight: 52)
      .background(inverted ? Color.black : Color.white, in: Capsule())
      .foregroundStyle(inverted ? Color.white : Color.black)
      .opacity(enabled ? 1 : 0.38)
      .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
      .animation(reduceMotion ? nil : .easeOut(duration: 0.14), value: configuration.isPressed)
  }
}

#if DEBUG
#Preview { MainScreen(controller: Demo.make()) }
#endif
