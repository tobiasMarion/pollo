import SwiftUI
import PolloWire

struct MainScreen: View {
    @Bindable var controller: EventController
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var diagnostics = false
    private var busy: Bool { [.locating, .searching, .connecting, .reconnecting].contains(controller.phase) }
    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if controller.screenMode {
                Color.white.opacity(controller.brightness).ignoresSafeArea().accessibilityHidden(true)
            }
            VStack(spacing: 0) {
                Text("pollo").font(.system(size: 21, weight: .semibold, design: .rounded))
                    .tracking(2).padding(.top, 16).accessibilityLabel("Pollo")
                    .opacity(controller.screenMode ? 0 : 1)
                Spacer(minLength: 24)
                if !controller.screenMode {
                    ScrollView {
                        VStack(spacing: 16) {
                            LightMark(pulsing: busy && !controller.participating)
                                .frame(width: 128, height: 128).padding(.bottom, 16)
                            Text(controller.event?.name ?? "Vamos iluminar juntos")
                                .font(.title3.weight(.semibold)).multilineTextAlignment(.center)
                            Text(controller.message).font(.subheadline).foregroundStyle(.secondary)
                                .multilineTextAlignment(.center).accessibilityIdentifier("status")
                            if controller.phase == .ready {
                                Button("Participar", action: controller.join)
                                    .buttonStyle(PolloButton()).disabled(!controller.canJoin)
                                    .accessibilityIdentifier("join")
                            }
                            if controller.phase == .empty || controller.phase == .failed {
                                Button("Buscar novamente", action: controller.retry).buttonStyle(PolloButton())
                                if controller.phase == .failed {
                                    Button("Abrir Ajustes") {
                                        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                                    }.frame(minHeight: 44)
                                }
                            }
                        }.padding(.horizontal, 32).frame(maxWidth: .infinity)
                    }.scrollBounceBehavior(.basedOnSize).frame(maxHeight: 380)
                }
                Spacer(minLength: 24)
                if controller.participating {
                    Button("Sair", action: controller.leave)
                        .buttonStyle(PolloButton()).accessibilityIdentifier("leave")
                }
                #if DEBUG
                if diagnostics {
                    DeveloperPanel(controller: controller)
                        .frame(maxWidth: 680, maxHeight: controller.screenMode ? 330 : 360)
                        .transition(.opacity.combined(with: .offset(y: 6)))
                }
                Button(diagnostics ? "Ocultar informações do desenvolvedor" : "Mostrar informações do desenvolvedor") {
                    withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.2)) { diagnostics.toggle() }
                }.font(.caption).foregroundStyle(controller.screenMode ? .black.opacity(0.7) : .secondary).frame(minHeight: 44)
                #endif
            }.padding(24)
        }
        .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: controller.phase)
    }
}

#if DEBUG
private struct DeveloperPanel: View {
    let controller: EventController
    private let columns = [GridItem(.fixed(112), alignment: .leading), GridItem(.flexible(), alignment: .leading)]
    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                section("Cliente") {
                    row("Estado", controller.phase.rawValue)
                    row("Participando", controller.participating ? "sim" : "não")
                    row("Dispositivo", controller.deviceIdentifier)
                    row("Última entrada", controller.lastInput)
                    row("Atualização", controller.lastUpdatedAt.formatted(date: .omitted, time: .standard))
                    row("Contadores", "\(controller.receivedFrameCount) recebidos · \(controller.sentFrameCount) enviados · \(controller.commandCount) comandos")
                    if let error = controller.errorMessage { row("Erro", error) }
                }
                section("Evento") {
                    row("ID", controller.event?.id ?? "—")
                    row("Nome", controller.event?.name ?? "—")
                    row("Tipo", controller.event?.type.rawValue ?? "—")
                    if let event = controller.event { row("Origem", String(format: "%.6f, %.6f", event.latitude, event.longitude)) }
                }
                section("Localização") {
                    if let fix = controller.fix {
                        row("Latitude", String(format: "%.7f°", fix.latitude))
                        row("Longitude", String(format: "%.7f°", fix.longitude))
                        row("Altitude", String(format: "%.2f m", fix.altitude))
                        row("Precisão H", String(format: "± %.2f m", fix.horizontalAccuracy))
                        row("Precisão V", String(format: "± %.2f m", fix.verticalAccuracy))
                    } else { row("GPS", "sem leitura válida") }
                }
                section("Conectividade do grafo") {
                    if let diagnostics = controller.diagnostics {
                        let assigned = diagnostics.assignedPeers.count
                        let measured = diagnostics.sentDistances.count
                        let ratio = assigned == 0 ? 0 : Double(measured) / Double(assigned) * 100
                        row("Grau local", "\(measured) / \(assigned) arestas medidas (\(String(format: "%.0f", ratio))%)")
                        row("Capacidade", "\(diagnostics.assignedPeers.count + diagnostics.courtingPeers.count) / \(diagnostics.maxPeers) sessões")
                        row("Solicitados", diagnostics.assignedPeers.isEmpty ? "—" : diagnostics.assignedPeers.joined(separator: ", "))
                        row("Em negociação", diagnostics.courtingPeers.isEmpty ? "—" : diagnostics.courtingPeers.joined(separator: ", "))
                        row("Observação", "O cliente conhece apenas suas arestas; o grau global pertence ao servidor.")
                    } else { row("Grafo", "sessão ainda não iniciada") }
                }
                section("Distâncias para cada nó") {
                    if let diagnostics = controller.diagnostics {
                        let peers = Set(diagnostics.assignedPeers).union(diagnostics.courtingPeers).sorted()
                        if peers.isEmpty { row("Nós", "nenhum vizinho atribuído") }
                        ForEach(peers, id: \.self) { peer in
                            let distance = diagnostics.sentDistances[peer]
                            let pending = diagnostics.pendingDistances[peer]
                            let silence = diagnostics.silentSweeps[peer]
                            row(peer, distance.map { String(format: "%.3f m", $0) } ?? (pending.map { String(format: "%.3f m (pendente)", $0) } ?? "sem leitura") + (silence.map { " · silêncio \($0)" } ?? ""))
                        }
                    } else { row("Distâncias", "—") }
                }
                section("Reconstrução e efeito") {
                    if let diagnostics = controller.diagnostics {
                        row("UWB", diagnostics.rangingAvailable ? "disponível" : "indisponível")
                        row("Posição", format(diagnostics.point))
                        if let cue = diagnostics.cue {
                            row("Efeito", cue.effect.name.rawValue)
                            row("Centro", format(cue.center))
                            row("Chegou", String(format: "%.3f s", cue.arrivedAt))
                            row("Brilho", String(format: "%.3f", controller.brightness))
                        } else { row("Efeito", "nenhum ativo") }
                    } else { row("Worker", "sem posição recebida") }
                }
            }.font(.caption.monospacedDigit()).foregroundStyle(controller.screenMode ? .black : .secondary)
        }
        .padding(14)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(.secondary.opacity(0.2)))
    }
    @ViewBuilder private func section(_ title: String, @ViewBuilder content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title.uppercased()).font(.caption2.weight(.bold)).tracking(0.8)
            LazyVGrid(columns: columns, alignment: .leading, spacing: 4, content: content)
        }
    }
    private func row(_ label: String, _ value: String) -> some View {
        Group { Text(label).foregroundStyle(.secondary); Text(value).textSelection(.enabled) }
    }
    private func format(_ point: Vector3?) -> String {
        guard let point else { return "ainda não posicionada" }
        return String(format: "x %.3f · y %.3f · z %.3f m", point.x, point.y, point.z)
    }
    private func format(_ point: Vector3) -> String { format(Optional(point)) }
}
#endif

struct LightMark: View {
    let pulsing: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var expanded = false
    var body: some View {
        ZStack {
            Circle().fill(.white.opacity(0.1)).blur(radius: 18)
                .scaleEffect(expanded ? 1 : 0.72)
            Circle().fill(.white).frame(width: 36, height: 36)
                .shadow(color: .white.opacity(0.25), radius: 16)
        }
        .accessibilityHidden(true)
        .task(id: pulsing && !reduceMotion) {
            expanded = false
            guard pulsing && !reduceMotion else { return }
            while !Task.isCancelled {
                withAnimation(.easeInOut(duration: 1.4)) { expanded.toggle() }
                try? await Task.sleep(for: .milliseconds(1400))
            }
        }
    }
}

struct PolloButton: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.font(.subheadline.weight(.medium))
            .padding(.horizontal, 28).frame(minHeight: 48)
            .background(.white, in: Capsule()).foregroundStyle(.black)
            .opacity(enabled ? 1 : 0.4)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.96 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

#if DEBUG
#Preview { MainScreen(controller: Demo.make()) }
#endif
