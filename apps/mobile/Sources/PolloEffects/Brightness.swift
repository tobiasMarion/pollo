import Foundation
import PolloWire

/**
 How long after a cue fires each pixel lights up, and how bright it is.

 This is a port of `effects/preview` in `@pollo/contracts`, and it is a port on
 purpose: a cue carries parameters, not frames, so every client works its own
 light out and the crowd only stays in step while they all do the same
 arithmetic. `PolloEffectsTests` checks it against numbers the TypeScript
 produced, which is the only thing that keeps this honest as either side moves.
 */

/// Seconds a pixel at `point` waits before lighting up.
public func effectDelaySeconds(_ effect: Effect, at point: Vector3, center: Vector3) -> Double {
    let x = point.x - center.x
    let y = point.y - center.y
    let z = point.z - center.z

    switch effect {
    case let .pulse(pulse):
        // `coordinateType` is deliberately not read here. It says which frame the
        // panel draws the ring in; the distance from the centre is the same
        // number either way, and reading it would be a way to disagree.
        return (x * x + y * y + z * z).squareRoot() * pulse.spreadDelayPerUnit

    case let .wave(wave):
        let along =
            switch wave.direction {
            case .x: x
            case .y: y
            case .z: z
            }

        return abs(along) * wave.spreadDelayPerUnit

    case let .rotate(rotate):
        return sweepAngle(x: x, y: y) * rotate.spreadDelayPerRadian

    case let .spiral(spiral):
        let radius = (x * x + y * y).squareRoot()
        let angle = sweepAngle(x: x, y: y)

        let radial = spiral.radialSpeed > 0 ? radius / spiral.radialSpeed : 0
        let angular = spiral.angularSpeed > 0 ? angle / spiral.angularSpeed : 0

        return radial + angular
    }
}

/// 0 when dark, 1 at the peak of the pass — a quick rise and a softer fall.
public func effectBrightness(
    _ effect: Effect,
    at point: Vector3,
    center: Vector3,
    elapsedSeconds: Double
) -> Double {
    let delay = effectDelaySeconds(effect, at: point, center: center)
    let progress = (elapsedSeconds - delay) / max(effect.activeTime, 0.05)

    if progress < 0 || progress > 1 { return 0 }

    return pow(sin(progress * .pi), 0.7)
}

/// `atan2` returns (-π, π]; the sweep starts at one full turn's origin.
private func sweepAngle(x: Double, y: Double) -> Double {
    atan2(y, x) + .pi
}
