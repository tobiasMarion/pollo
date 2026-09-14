#if DEBUG
import Foundation
import SwiftUI
import PolloWire

struct DeveloperScreen: View {
  @Bindable var controller: EventController

  private var onLight: Bool { controller.screenMode && controller.brightness > 0.46 }
  private var ink: Color { onLight ? .black : .white }
  private var mutedInk: Color { ink.opacity(0.56) }
  private var activePeers: [String] {
    guard let diagnostics = controller.diagnostics else { return [] }
    return Array(Set(diagnostics.assignedPeers).union(diagnostics.courtingPeers)).sorted()
  }
  private var measuredPeers: Int { controller.diagnostics?.sentDistances.count ?? 0 }

  var body: some View {
    ZStack {
      PolloBackdrop(controller: controller)
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 18) {
          introduction
          healthGrid
          graphSection
          peersSection
          activitySection
          deviceSection
          locationSection
          reconstructionSection
        }
        .padding(.horizontal, 18)
        .padding(.top, 16)
        .padding(.bottom, 44)
      }
      .scrollBounceBehavior(.basedOnSize)
    }
    .foregroundStyle(ink)
    .navigationTitle("Sinal local")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar(.visible, for: .navigationBar)
    .toolbarColorScheme(onLight ? .light : .dark, for: .navigationBar)
    .toolbarBackground(.hidden, for: .navigationBar)
  }

  private var introduction: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("ESTE APARELHO")
        .font(.system(size: 10, weight: .bold, design: .monospaced))
        .tracking(1.5)
        .foregroundStyle(mutedInk)
      Text(connectionTitle)
        .font(.system(size: 30, weight: .semibold, design: .rounded))
        .tracking(-0.65)
      HStack(spacing: 7) {
        Circle().fill(ink).frame(width: 5, height: 5)
        TimelineView(.periodic(from: .now, by: 1)) { context in
          Text("Última atividade \(age(since: controller.lastUpdatedAt, at: context.date))")
            .font(.system(size: 12, design: .monospaced))
            .monospacedDigit()
        }
      }
      .foregroundStyle(mutedInk)
    }
    .padding(.horizontal, 6)
  }

  private var healthGrid: some View {
    HStack(spacing: 8) {
      MetricTile(value: "\(activePeers.count)", label: "AGORA", ink: ink)
      MetricTile(value: "\(controller.seenPeers.count)", label: "VISTOS", ink: ink)
      MetricTile(value: "\(measuredPeers)", label: "MEDIDOS", ink: ink)
    }
  }

  private var graphSection: some View {
    DiagnosticCard(title: "Conectividade local", subtitle: "Somente as arestas conhecidas por este aparelho", ink: ink) {
      LocalGraph(
        deviceID: controller.deviceIdentifier,
        peers: activePeers,
        measured: Set(controller.diagnostics?.sentDistances.keys ?? Dictionary<String, Double>().keys),
        pending: Set(controller.diagnostics?.pendingDistances.keys ?? Dictionary<String, Double>().keys),
        ink: ink
      )
      .frame(height: 230)

      HStack(spacing: 16) {
        GraphLegend(label: "medida", style: .measured, ink: ink)
        GraphLegend(label: "pendente", style: .pending, ink: ink)
        GraphLegend(label: "sem leitura", style: .silent, ink: ink)
      }
      .frame(maxWidth: .infinity, alignment: .center)
    }
  }

  private var peersSection: some View {
    DiagnosticCard(title: "Vizinhos", subtitle: "\(activePeers.count) ativos · \(controller.seenPeers.count) vistos nesta sessão", ink: ink) {
      if controller.seenPeers.isEmpty {
        EmptyDiagnostic(text: "Nenhum vizinho atribuído até agora", ink: ink)
      } else {
        VStack(spacing: 0) {
          ForEach(controller.seenPeers.sorted(), id: \.self) { peer in
            PeerRow(peer: peer, controller: controller, active: activePeers.contains(peer), ink: ink)
            if peer != controller.seenPeers.sorted().last {
              Divider().overlay(ink.opacity(0.09)).padding(.leading, 42)
            }
          }
        }
      }
    }
  }

  private var activitySection: some View {
    DiagnosticCard(title: "Atividade", subtitle: "Contagem e idade da última mensagem por tipo", ink: ink) {
      VStack(spacing: 0) {
        ForEach(LocalActivityKind.allCases) { kind in
          ActivityRow(kind: kind, sample: controller.localActivity[kind], ink: ink)
          if kind != LocalActivityKind.allCases.last {
            Divider().overlay(ink.opacity(0.09)).padding(.leading, 34)
          }
        }
      }
      VStack(alignment: .leading, spacing: 7) {
        Text("ÚLTIMA ENTRADA")
          .font(.system(size: 9, weight: .bold, design: .monospaced))
          .tracking(1.1)
          .foregroundStyle(mutedInk)
        Text(controller.lastInput)
          .font(.system(size: 11, design: .monospaced))
          .foregroundStyle(ink.opacity(0.76))
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .padding(.top, 8)
    }
  }

  private var deviceSection: some View {
    DiagnosticCard(title: "Sessão", subtitle: controller.deviceIdentifier, ink: ink) {
      DataRow(label: "Estado", value: controller.phase.rawValue, ink: ink)
      DataRow(label: "UWB", value: uwbStatus, ink: ink)
      DataRow(label: "Capacidade", value: "\(activePeers.count) / \(controller.peerLimit) sessões", ink: ink)
      DataRow(label: "Frames recebidos", value: "\(controller.receivedFrameCount)", ink: ink)
      DataRow(label: "Frames enviados", value: "\(controller.sentFrameCount)", ink: ink)
      DataRow(label: "Comandos locais", value: "\(controller.commandCount)", ink: ink)
      if let error = controller.errorMessage {
        DataRow(label: "Último erro", value: error, ink: ink)
      }
    }
  }

  private var locationSection: some View {
    DiagnosticCard(title: "Localização e evento", subtitle: "Referência geográfica deste aparelho", ink: ink) {
      if let fix = controller.fix {
        DataRow(label: "Latitude", value: String(format: "%.7f°", fix.latitude), ink: ink)
        DataRow(label: "Longitude", value: String(format: "%.7f°", fix.longitude), ink: ink)
        DataRow(label: "Altitude", value: String(format: "%.2f m", fix.altitude), ink: ink)
        DataRow(label: "Precisão H", value: String(format: "± %.2f m", fix.horizontalAccuracy), ink: ink)
        DataRow(label: "Precisão V", value: String(format: "± %.2f m", fix.verticalAccuracy), ink: ink)
      } else {
        EmptyDiagnostic(text: "Sem leitura válida de GPS", ink: ink)
      }
      DataRow(label: "Evento", value: controller.event?.name ?? "—", ink: ink)
      DataRow(label: "ID", value: controller.event?.id ?? "—", ink: ink)
      DataRow(label: "Saída", value: controller.event?.type.rawValue ?? "—", ink: ink)
    }
  }

  private var reconstructionSection: some View {
    DiagnosticCard(title: "Reconstrução e efeito", subtitle: "O que este nó recebeu e está renderizando", ink: ink) {
      DataRow(label: "Posição", value: format(controller.diagnostics?.point), ink: ink)
      if let cue = controller.diagnostics?.cue {
        DataRow(label: "Efeito", value: cue.effect.name.rawValue, ink: ink)
        DataRow(label: "Centro", value: format(cue.center), ink: ink)
        DataRow(label: "Chegou", value: String(format: "%.3f s", cue.arrivedAt), ink: ink)
      } else {
        DataRow(label: "Efeito", value: "nenhum ativo", ink: ink)
      }
      DataRow(label: "Brilho", value: String(format: "%.3f", controller.brightness), ink: ink)
    }
  }

  private var connectionTitle: String {
    switch controller.phase {
    case .live: "Conectado e posicionado"
    case .positioning: "Conectado, calculando posição"
    case .connecting: "Abrindo a sessão"
    case .reconnecting: "Conexão interrompida"
    case .ready: "Pronto para participar"
    case .failed: "A sessão precisa de atenção"
    default: controller.message
    }
  }

  private var uwbStatus: String {
    if !controller.supported { return "indisponível" }
    if controller.diagnostics?.rangingAvailable == false { return "interrompido" }
    return "disponível"
  }

  private func format(_ point: Vector3?) -> String {
    guard let point else { return "ainda não posicionada" }
    return String(format: "x %.3f · y %.3f · z %.3f m", point.x, point.y, point.z)
  }

  private func format(_ point: Vector3) -> String { format(Optional(point)) }
}

private struct DiagnosticCard<Content: View>: View {
  let title: String
  let subtitle: String
  let ink: Color
  @ViewBuilder let content: Content

  init(title: String, subtitle: String, ink: Color, @ViewBuilder content: () -> Content) {
    self.title = title
    self.subtitle = subtitle
    self.ink = ink
    self.content = content()
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 17) {
      VStack(alignment: .leading, spacing: 4) {
        Text(title)
          .font(.system(size: 17, weight: .semibold, design: .rounded))
        Text(subtitle)
          .font(.system(size: 11, design: .monospaced))
          .foregroundStyle(ink.opacity(0.48))
          .lineLimit(2)
      }
      content
    }
    .padding(18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(ink.opacity(0.055), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
  }
}

private struct MetricTile: View {
  let value: String
  let label: String
  let ink: Color

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(value)
        .font(.system(size: 20, weight: .semibold, design: .monospaced))
        .monospacedDigit()
        .minimumScaleFactor(0.72)
        .lineLimit(1)
      Text(label)
        .font(.system(size: 8, weight: .bold, design: .monospaced))
        .tracking(0.6)
        .foregroundStyle(ink.opacity(0.48))
        .lineLimit(1)
    }
    .padding(.horizontal, 12)
    .frame(maxWidth: .infinity, minHeight: 76, alignment: .leading)
    .background(ink.opacity(0.055), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
  }
}

private struct DataRow: View {
  let label: String
  let value: String
  let ink: Color

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 14) {
      Text(label)
        .font(.system(size: 12, design: .rounded))
        .foregroundStyle(ink.opacity(0.48))
        .frame(width: 108, alignment: .leading)
      Text(value)
        .font(.system(size: 12, design: .monospaced))
        .monospacedDigit()
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
  }
}

private struct EmptyDiagnostic: View {
  let text: String
  let ink: Color

  var body: some View {
    Text(text)
      .font(.system(size: 12, design: .monospaced))
      .foregroundStyle(ink.opacity(0.48))
      .frame(maxWidth: .infinity, minHeight: 52, alignment: .center)
  }
}

private struct PeerRow: View {
  let peer: String
  let controller: EventController
  let active: Bool
  let ink: Color

  private var distance: Double? { controller.diagnostics?.sentDistances[peer] }
  private var pending: Double? { controller.diagnostics?.pendingDistances[peer] }
  private var silence: Int { controller.diagnostics?.silentSweeps[peer] ?? 0 }

  var body: some View {
    HStack(spacing: 12) {
      ZStack {
        Circle().stroke(ink.opacity(active ? 0.42 : 0.14), lineWidth: 1).frame(width: 30, height: 30)
        Circle().fill(ink.opacity(distance == nil ? 0.3 : 1)).frame(width: 6, height: 6)
      }
      VStack(alignment: .leading, spacing: 3) {
        Text(shortID(peer))
          .font(.system(size: 12, weight: .medium, design: .monospaced))
        Text(peerState)
          .font(.system(size: 10, design: .monospaced))
          .foregroundStyle(ink.opacity(0.46))
      }
      Spacer(minLength: 8)
      VStack(alignment: .trailing, spacing: 3) {
        Text(distanceText)
          .font(.system(size: 12, weight: .medium, design: .monospaced))
          .monospacedDigit()
        if let last = controller.peerLastSeenAt[peer] {
          TimelineView(.periodic(from: .now, by: 1)) { context in
            Text(age(since: last, at: context.date))
              .font(.system(size: 10, design: .monospaced))
              .monospacedDigit()
              .foregroundStyle(ink.opacity(0.42))
          }
        }
      }
    }
    .padding(.vertical, 10)
  }

  private var peerState: String {
    if !active { return "visto anteriormente" }
    if distance != nil { return silence > 0 ? "ativo · silêncio \(silence)" : "medindo" }
    if pending != nil { return "leitura pendente" }
    return "aguardando leitura"
  }

  private var distanceText: String {
    if let distance { return String(format: "%.3f m", distance) }
    if let pending { return String(format: "%.3f m", pending) }
    return "—"
  }
}

private struct ActivityRow: View {
  let kind: LocalActivityKind
  let sample: LocalActivitySample?
  let ink: Color

  var body: some View {
    HStack(spacing: 12) {
      Circle().fill(ink.opacity(sample == nil ? 0.18 : 0.72)).frame(width: 5, height: 5)
      Text(kind.rawValue)
        .font(.system(size: 12, design: .rounded))
      Spacer()
      Text(sample.map { "\($0.count)×" } ?? "—")
        .font(.system(size: 11, design: .monospaced))
        .monospacedDigit()
        .foregroundStyle(ink.opacity(0.5))
      if let sample {
        TimelineView(.periodic(from: .now, by: 1)) { context in
          Text(age(since: sample.lastAt, at: context.date))
            .font(.system(size: 11, design: .monospaced))
            .monospacedDigit()
            .frame(width: 56, alignment: .trailing)
        }
      } else {
        Text("nunca")
          .font(.system(size: 11, design: .monospaced))
          .frame(width: 56, alignment: .trailing)
      }
    }
    .padding(.vertical, 9)
  }
}

private enum GraphEdgeStyle { case measured, pending, silent }

private struct GraphLegend: View {
  let label: String
  let style: GraphEdgeStyle
  let ink: Color

  var body: some View {
    HStack(spacing: 6) {
      Group {
        if style == .measured {
          Capsule().fill(ink.opacity(0.7))
        } else {
          Capsule().stroke(ink.opacity(style == .pending ? 0.42 : 0.2), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
        }
      }
      .frame(width: 16, height: 1)
      Text(label).font(.system(size: 9, design: .monospaced)).foregroundStyle(ink.opacity(0.48))
    }
  }
}

private struct LocalGraph: View {
  let deviceID: String
  let peers: [String]
  let measured: Set<String>
  let pending: Set<String>
  let ink: Color

  var body: some View {
    Canvas { context, size in
      let center = CGPoint(x: size.width / 2, y: size.height / 2)
      let visible = Array(peers.prefix(12))
      let radiusX = max(60, size.width * 0.39)
      let radiusY = max(54, size.height * 0.37)

      for (index, peer) in visible.enumerated() {
        let angle = -Double.pi / 2 + Double(index) / Double(max(visible.count, 1)) * Double.pi * 2
        let point = CGPoint(x: center.x + cos(angle) * radiusX, y: center.y + sin(angle) * radiusY)
        var edge = Path()
        edge.move(to: center)
        edge.addLine(to: point)
        let style = StrokeStyle(lineWidth: measured.contains(peer) ? 1.4 : 1,
                                lineCap: .round,
                                dash: measured.contains(peer) ? [] : [4, 5])
        context.stroke(edge, with: .color(ink.opacity(measured.contains(peer) ? 0.54 : pending.contains(peer) ? 0.3 : 0.16)), style: style)
        context.fill(Path(ellipseIn: CGRect(x: point.x - 4, y: point.y - 4, width: 8, height: 8)),
                     with: .color(ink.opacity(measured.contains(peer) ? 0.92 : 0.44)))
        let peerText = context.resolve(Text(shortID(peer)).font(.system(size: 8, design: .monospaced)).foregroundColor(ink.opacity(0.56)))
        context.draw(peerText, at: CGPoint(x: point.x, y: point.y + 14), anchor: .center)
      }

      context.drawLayer { glow in
        glow.addFilter(.blur(radius: 9))
        glow.fill(Path(ellipseIn: CGRect(x: center.x - 17, y: center.y - 17, width: 34, height: 34)),
                  with: .color(ink.opacity(0.18)))
      }
      context.fill(Path(ellipseIn: CGRect(x: center.x - 7, y: center.y - 7, width: 14, height: 14)), with: .color(ink))
      let ownText = context.resolve(Text("VOCÊ · \(shortID(deviceID))").font(.system(size: 9, weight: .semibold, design: .monospaced)).foregroundColor(ink))
      context.draw(ownText, at: CGPoint(x: center.x, y: center.y + 24), anchor: .center)

      if peers.isEmpty {
        let empty = context.resolve(Text("aguardando vizinhos").font(.system(size: 10, design: .monospaced)).foregroundColor(ink.opacity(0.42)))
        context.draw(empty, at: CGPoint(x: center.x, y: size.height - 18), anchor: .center)
      } else if peers.count > visible.count {
        let remainder = context.resolve(Text("+\(peers.count - visible.count) nós").font(.system(size: 9, design: .monospaced)).foregroundColor(ink.opacity(0.46)))
        context.draw(remainder, at: CGPoint(x: size.width - 24, y: size.height - 12), anchor: .trailing)
      }
    }
    .accessibilityLabel("Grafo local com \(peers.count) vizinhos")
  }
}

private func shortID(_ id: String) -> String {
  guard id.count > 10 else { return id }
  return "\(id.prefix(5))…\(id.suffix(4))"
}

private func age(since date: Date, at now: Date) -> String {
  let seconds = max(0, Int(now.timeIntervalSince(date)))
  if seconds < 2 { return "agora" }
  if seconds < 60 { return "há \(seconds)s" }
  if seconds < 3_600 { return "há \(seconds / 60)min" }
  return "há \(seconds / 3_600)h"
}

#Preview { NavigationStack { DeveloperScreen(controller: Demo.make()) } }
#endif
