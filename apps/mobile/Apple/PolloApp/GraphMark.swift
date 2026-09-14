import SwiftUI

/// A small proximity graph whose topology emerges from motion. Nodes have
/// independent lifecycles and trajectories; edges exist only while two visible
/// nodes are close enough and their continuously varying link remains stable.
struct GraphMark: View {
  let active: Bool
  var color: Color = .white

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var startedAt = Date()
  @State private var system = GraphSystem.makeRandom()

  var body: some View {
    TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { timeline in
      Canvas(rendersAsynchronously: true) { context, size in
        draw(in: &context, size: size, at: timeline.date)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Grafo Pollo")
  }

  private func draw(in context: inout GraphicsContext, size: CGSize, at date: Date) {
    let elapsed = reduceMotion ? 9.0 : max(0, date.timeIntervalSince(startedAt))
    let pace = active ? 1.16 : 1.0
    let time = elapsed * pace
    let points = system.nodes.map { $0.position(at: time, in: size, moving: !reduceMotion) }
    let visibility = system.nodes.map { $0.visibility(at: time) }

    for first in system.nodes.indices {
      for second in system.nodes.indices where second > first {
        let start = points[first]
        let end = points[second]
        let distance = hypot(end.x - start.x, end.y - start.y) / max(size.width, 1)
        let proximity = smoothStep((0.39 - distance) / 0.11)
        let stability = linkStability(first, second, at: time)
        let opacity = proximity * stability * visibility[first] * visibility[second]
        guard opacity > 0.002 else { continue }

        var path = Path()
        path.move(to: start)
        path.addLine(to: end)
        context.stroke(
          path,
          with: .color(color.opacity(opacity * 0.42)),
          style: StrokeStyle(lineWidth: 0.85 + opacity * 0.25, lineCap: .round)
        )
      }
    }

    for (index, point) in points.enumerated() {
      let visible = visibility[index]
      guard visible > 0.01 else { continue }
      let breath = 0.5 + 0.5 * sin(time * system.nodes[index].breathSpeed + system.nodes[index].phaseX)
      let radius = (2.5 + breath * 0.75) * smoothStep(visible)

      if visible > 0.08 {
        context.drawLayer { layer in
          layer.addFilter(.blur(radius: 7))
          layer.fill(
            Path(ellipseIn: CGRect(x: point.x - 8, y: point.y - 8, width: 16, height: 16)),
            with: .color(color.opacity(visible * (0.025 + breath * 0.055)))
          )
        }
      }

      context.fill(
        Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius,
                               width: radius * 2, height: radius * 2)),
        with: .color(color.opacity(visible * (0.68 + breath * 0.24)))
      )
    }
  }

  /// Two slow oscillators create irregular but continuous disconnections. The
  /// smooth threshold is the visual equivalent of a probabilistic link drop:
  /// links spend most of their time stable, then fade out for uneven intervals.
  private func linkStability(_ first: Int, _ second: Int, at time: Double) -> Double {
    let seed = system.nodes[first].linkSeed + system.nodes[second].linkSeed * 1.73
    let slow = sin(time * (0.13 + seed.truncatingRemainder(dividingBy: 0.07)) + seed)
    let irregular = sin(time * (0.29 + seed.truncatingRemainder(dividingBy: 0.11)) + seed * 2.31)
    let signal = 0.68 * slow + 0.32 * irregular
    return smoothStep((signal + 0.52) / 0.42)
  }

  private func smoothStep(_ value: Double) -> Double {
    let clamped = min(max(value, 0), 1)
    return clamped * clamped * (3 - 2 * clamped)
  }
}

private struct GraphSystem {
  let nodes: [DriftingNode]

  static func makeRandom(count: Int = 10) -> GraphSystem {
    var origins: [CGPoint] = []
    for _ in 0..<count {
      var candidate = CGPoint(x: Double.random(in: 0.12...0.88),
                              y: Double.random(in: 0.10...0.88))
      for _ in 0..<48 {
        let farEnough = origins.allSatisfy { hypot(candidate.x - $0.x, candidate.y - $0.y) > 0.17 }
        if farEnough { break }
        candidate = CGPoint(x: Double.random(in: 0.12...0.88),
                            y: Double.random(in: 0.10...0.88))
      }
      origins.append(candidate)
    }

    return GraphSystem(nodes: origins.map { origin in
      DriftingNode(
        origin: origin,
        amplitudeX: Double.random(in: 0.035...0.085),
        amplitudeY: Double.random(in: 0.035...0.085),
        speedX: Double.random(in: 0.075...0.14),
        speedY: Double.random(in: 0.065...0.13),
        phaseX: Double.random(in: 0...(Double.pi * 2)),
        phaseY: Double.random(in: 0...(Double.pi * 2)),
        lifecycle: Double.random(in: 25...38),
        lifecycleOffset: Double.random(in: 0...38),
        breathSpeed: Double.random(in: 0.35...0.62),
        linkSeed: Double.random(in: 0.4...8.0)
      )
    })
  }
}

private struct DriftingNode {
  let origin: CGPoint
  let amplitudeX: Double
  let amplitudeY: Double
  let speedX: Double
  let speedY: Double
  let phaseX: Double
  let phaseY: Double
  let lifecycle: Double
  let lifecycleOffset: Double
  let breathSpeed: Double
  let linkSeed: Double

  func position(at time: Double, in size: CGSize, moving: Bool) -> CGPoint {
    guard moving else {
      return CGPoint(x: origin.x * size.width, y: origin.y * size.height)
    }
    let x = origin.x + sin(time * speedX + phaseX) * amplitudeX
      + sin(time * speedX * 0.37 + phaseY) * 0.018
    let y = origin.y + sin(time * speedY + phaseY) * amplitudeY
      + cos(time * speedY * 0.41 + phaseX) * 0.018
    return CGPoint(x: x * size.width, y: y * size.height)
  }

  func visibility(at time: Double) -> Double {
    let progress = ((time + lifecycleOffset).truncatingRemainder(dividingBy: lifecycle)) / lifecycle
    if progress < 0.12 { return ease(progress / 0.12) }
    if progress < 0.68 { return 1 }
    if progress < 0.84 { return 1 - ease((progress - 0.68) / 0.16) }
    return 0
  }

  private func ease(_ value: Double) -> Double {
    let clamped = min(max(value, 0), 1)
    return clamped * clamped * (3 - 2 * clamped)
  }
}

struct GraphGlyph: View {
  var color: Color = .white

  var body: some View {
    Canvas { context, size in
      let points = [
        CGPoint(x: size.width * 0.18, y: size.height * 0.63),
        CGPoint(x: size.width * 0.42, y: size.height * 0.22),
        CGPoint(x: size.width * 0.78, y: size.height * 0.34),
        CGPoint(x: size.width * 0.82, y: size.height * 0.76),
        CGPoint(x: size.width * 0.45, y: size.height * 0.82)
      ]
      for edge in [(0, 1), (1, 2), (2, 3), (3, 4), (4, 0), (1, 4)] {
        var path = Path()
        path.move(to: points[edge.0])
        path.addLine(to: points[edge.1])
        context.stroke(path, with: .color(color.opacity(0.35)), lineWidth: 1)
      }
      for point in points {
        context.fill(Path(ellipseIn: CGRect(x: point.x - 2, y: point.y - 2, width: 4, height: 4)),
                     with: .color(color))
      }
    }
    .accessibilityHidden(true)
  }
}
